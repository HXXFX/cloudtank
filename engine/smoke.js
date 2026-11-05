import { makeLayout, makeGroup, makeBuffer, UNIFORM, shaderModule, computePipeline } from './gpu.js';
import { SCENE_WGSL, SOLVER_GROUP0 } from './sdf.wgsl.js';

const HEADER = SCENE_WGSL +  `
struct SP {
  dims: vec4<f32>,
  origin: vec4<f32>,
  forces: vec4<f32>,
  misc: vec4<f32>,
  push0: vec4<f32>,
  push1: vec4<f32>,
  pushVel: vec4<f32>,
  light: vec4<f32>,
  light2: vec4<f32>,
  wind: vec4<f32>,
  turb: vec4<f32>,
};
` + SOLVER_GROUP0('SP') +  `

fn N() -> vec3<i32> { return vec3<i32>(P.dims.xyz); }
fn inside(c: vec3<i32>) -> bool { return all(c >= vec3<i32>(0)) && all(c < N()); }
fn worldOf(c: vec3<i32>) -> vec3<f32> { return P.origin.xyz + (vec3<f32>(c) + 0.5) * P.dims.w; }
fn uvw(q: vec3<f32>) -> vec3<f32> { return (q + 0.5) / P.dims.xyz; }
fn emitterWeight(p: vec3<f32>, e: Emitter) -> f32 {
  let x = clamp(1.0 - length(p - e.a.xyz) / e.a.w, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}
fn smokeOf(c: vec3<f32>) -> vec4<f32> {
  let k = 1.0 / max(c, vec3<f32>(0.04)) - 1.0;
  let s = 1.0 / (1.0 + min(k.r, min(k.g, k.b)));
  return vec4<f32>(k * s, s);
}
fn amountOf(d: vec4<f32>) -> f32 { return d.a + min(d.r, min(d.g, d.b)); }
const X = vec3<i32>(1, 0, 0);
const Y = vec3<i32>(0, 1, 0);
const Z = vec3<i32>(0, 0, 1);
`;

const SOLID =  `
@group(1) @binding(0) var solidOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let p = worldOf(c);
  let hit = sceneSdf(p, u32(P.misc.z));
  var s = vec4<f32>(0.0);
  if (hit.x < 0.0) { s = vec4<f32>(solidVelAt(p, O[u32(hit.y)]), 1.0); }
  textureStore(solidOut, c, s);
}`;

const ADVECT_V =  `
@group(1) @binding(0) var velIn: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var solid: texture_3d<f32>;
@group(1) @binding(3) var velOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let s = textureLoad(solid, c, 0);
  if (s.w > 0.5) { textureStore(velOut, c, vec4<f32>(s.xyz, 0.0)); return; }
  let dt = P.origin.w;
  let v = textureLoad(velIn, c, 0);
  let back = vec3<f32>(c) - dt * v.xyz / P.dims.w;
  var nv = textureSampleLevel(velIn, samp, uvw(back), 0.0);
  nv.w = min(nv.w * exp(-P.forces.w * dt), 6.0);
  textureStore(velOut, c, nv);
}`;

const CURL =  `
@group(1) @binding(0) var velIn: texture_3d<f32>;
@group(1) @binding(1) var curlOut: texture_storage_3d<rgba16float, write>;
fn V(c: vec3<i32>) -> vec3<f32> { return textureLoad(velIn, clamp(c, vec3<i32>(0), N() - vec3<i32>(1)), 0).xyz; }
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let dx = V(c + X) - V(c - X);
  let dy = V(c + Y) - V(c - Y);
  let dz = V(c + Z) - V(c - Z);
  let w = vec3<f32>(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) * (0.5 / P.dims.w);
  textureStore(curlOut, c, vec4<f32>(w, length(w)));
}`;

const FORCES =  `
@group(1) @binding(0) var velIn: texture_3d<f32>;
@group(1) @binding(1) var curlIn: texture_3d<f32>;
@group(1) @binding(2) var dyeIn: texture_3d<f32>;
@group(1) @binding(3) var solid: texture_3d<f32>;
@group(1) @binding(4) var velOut: texture_storage_3d<rgba16float, write>;
fn W(c: vec3<i32>) -> f32 { return textureLoad(curlIn, clamp(c, vec3<i32>(0), N() - vec3<i32>(1)), 0).w; }
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let s = textureLoad(solid, c, 0);
  if (s.w > 0.5) { textureStore(velOut, c, vec4<f32>(s.xyz, 0.0)); return; }
  let dt = P.origin.w;
  var v = textureLoad(velIn, c, 0);
  let grad = vec3<f32>(W(c + X) - W(c - X), W(c + Y) - W(c - Y), W(c + Z) - W(c - Z));
  let gl = length(grad);
  if (gl > 1e-5) {
    let w = textureLoad(curlIn, c, 0).xyz;
    v = vec4<f32>(v.xyz + dt * P.forces.z * P.dims.w * cross(grad / gl, w), v.w);
  }
  let dens = amountOf(textureLoad(dyeIn, c, 0));
  v.y = v.y + dt * (P.forces.x * v.w - P.forces.y * dens);
  let p = worldOf(c);
  for (var i = 0u; i < u32(P.misc.y); i = i + 1u) {
    let e = E[i];
    if (e.d.x != 1.0) { continue; }
    let f = emitterWeight(p, e);
    if (f > 0.0) {
      let seed = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (u32(P.light.w) * 2654435761u);
      let jitter = (hash3(seed) - 0.5) * (1.2 + length(e.c.xyz));
      v = vec4<f32>(mix(v.xyz, e.c.xyz + jitter, f * 0.5), min(v.w + e.c.w * f * dt, 6.0));
    }
  }
  if (P.wind.w > 0.0) {
    var w = P.wind.xyz;
    let speed = length(w);
    if (P.turb.x > 0.0) {
      w = w + noiseVec(p * P.turb.y - w * P.turb.z * P.turb.y) * (2.5 * P.turb.x * (speed + 0.3));
    }
    let ground = smoothstep(0.0, 0.8, p.y);
    let k = 1.0 - exp(-P.wind.w * dt);
    let goal = w * (0.35 + 0.65 * ground);
    v = vec4<f32>(v.x + (goal.x - v.x) * k, v.y + (goal.y - v.y) * k * 0.3, v.z + (goal.z - v.z) * k, v.w);
  }
  if (P.push1.w > 0.0) {
    let f = stirWeight(p, P.push0.xyz, P.push1.xyz, P.push0.w);
    if (f > 0.0) { v = vec4<f32>(mix(v.xyz, P.pushVel.xyz, f * 0.6), v.w); }
  }
  textureStore(velOut, c, v);
}`;

const DIVERGENCE =  `
@group(1) @binding(0) var velIn: texture_3d<f32>;
@group(1) @binding(1) var solid: texture_3d<f32>;
@group(1) @binding(2) var divOut: texture_storage_3d<r32float, write>;
fn Vb(c: vec3<i32>, own: vec3<f32>) -> vec3<f32> {
  if (c.y < 0) { return vec3<f32>(0.0); }
  if (!inside(c)) { return own; }
  let s = textureLoad(solid, c, 0);
  if (s.w > 0.5) { return s.xyz; }
  return textureLoad(velIn, c, 0).xyz;
}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  if (textureLoad(solid, c, 0).w > 0.5) { textureStore(divOut, c, vec4<f32>(0.0)); return; }
  let own = textureLoad(velIn, c, 0).xyz;
  var d = (Vb(c + X, own).x - Vb(c - X, own).x + Vb(c + Y, own).y - Vb(c - Y, own).y
         + Vb(c + Z, own).z - Vb(c - Z, own).z) * (0.5 / P.dims.w);
  let p = worldOf(c);
  for (var i = 0u; i < u32(P.misc.y); i = i + 1u) {
    let e = E[i];
    if (e.d.x != 3.0) { continue; }
    d = d + e.b.w * sinkWeight(p, e);
  }
  textureStore(divOut, c, vec4<f32>(d, 0.0, 0.0, 0.0));
}`;

const PRESSURE_FN =  `
fn Pn(c: vec3<i32>, pc: f32) -> f32 {
  if (c.y < 0) { return pc; }
  if (!inside(c)) { return 0.0; }
  if (textureLoad(solid, c, 0).w > 0.5) { return pc; }
  return textureLoad(pIn, c, 0).x;
}`;

const JACOBI =  `
@group(1) @binding(0) var pIn: texture_3d<f32>;
@group(1) @binding(1) var divIn: texture_3d<f32>;
@group(1) @binding(2) var solid: texture_3d<f32>;
@group(1) @binding(3) var pOut: texture_storage_3d<r32float, write>;
${PRESSURE_FN}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  if (textureLoad(solid, c, 0).w > 0.5) { textureStore(pOut, c, vec4<f32>(0.0)); return; }
  let pc = textureLoad(pIn, c, 0).x;
  let sum = Pn(c + X, pc) + Pn(c - X, pc) + Pn(c + Y, pc) + Pn(c - Y, pc) + Pn(c + Z, pc) + Pn(c - Z, pc);
  let h = P.dims.w;
  textureStore(pOut, c, vec4<f32>((sum - textureLoad(divIn, c, 0).x * h * h) / 6.0, 0.0, 0.0, 0.0));
}`;

const PROJECT =  `
@group(1) @binding(0) var velIn: texture_3d<f32>;
@group(1) @binding(1) var pIn: texture_3d<f32>;
@group(1) @binding(2) var solid: texture_3d<f32>;
@group(1) @binding(3) var velOut: texture_storage_3d<rgba16float, write>;
${PRESSURE_FN}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let s = textureLoad(solid, c, 0);
  if (s.w > 0.5) { textureStore(velOut, c, vec4<f32>(s.xyz, 0.0)); return; }
  let v = textureLoad(velIn, c, 0);
  let pc = textureLoad(pIn, c, 0).x;
  let gp = vec3<f32>(Pn(c + X, pc) - Pn(c - X, pc), Pn(c + Y, pc) - Pn(c - Y, pc),
                     Pn(c + Z, pc) - Pn(c - Z, pc)) * (0.5 / P.dims.w);
  textureStore(velOut, c, vec4<f32>(v.xyz - gp, v.w));
}`;

const ADVECT_DYE =  `
@group(1) @binding(0) var dyeIn: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var velIn: texture_3d<f32>;
@group(1) @binding(3) var solid: texture_3d<f32>;
@group(1) @binding(4) var dyeOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let back = vec3<f32>(c) - P.origin.w * textureLoad(velIn, c, 0).xyz / P.dims.w;
  textureStore(dyeOut, c, textureSampleLevel(dyeIn, samp, uvw(back), 0.0));
}`;

const CORRECT_DYE =  `
@group(1) @binding(0) var dyeOld: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var dyeFwd: texture_3d<f32>;
@group(1) @binding(3) var velIn: texture_3d<f32>;
@group(1) @binding(4) var solid: texture_3d<f32>;
@group(1) @binding(5) var dyeOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  if (textureLoad(solid, c, 0).w > 0.5) { textureStore(dyeOut, c, vec4<f32>(0.0)); return; }
  let dt = P.origin.w;
  let v = textureLoad(velIn, c, 0).xyz / P.dims.w;
  let fwd = textureLoad(dyeFwd, c, 0);
  let roundTrip = textureSampleLevel(dyeFwd, samp, uvw(vec3<f32>(c) + dt * v), 0.0);
  var d = fwd + 0.5 * (textureLoad(dyeOld, c, 0) - roundTrip);
  let back = vec3<f32>(c) - dt * v;
  let b = vec3<i32>(floor(back));
  var lo = vec4<f32>(1e9);
  var hi = vec4<f32>(-1e9);
  for (var k = 0; k < 8; k = k + 1) {
    let q = clamp(b + vec3<i32>(k & 1, (k >> 1) & 1, (k >> 2) & 1), vec3<i32>(0), N() - vec3<i32>(1));
    let s = textureLoad(dyeOld, q, 0);
    lo = min(lo, s);
    hi = max(hi, s);
  }
  d = clamp(d, lo, hi);
  d = d * exp(-P.misc.x * dt);
  let p = worldOf(c);
  for (var i = 0u; i < u32(P.misc.y); i = i + 1u) {
    let e = E[i];
    if (e.d.x == 3.0) { d = d * exp(-e.b.w * sinkWeight(p, e) * dt); continue; }
    if (e.d.x != 1.0) { continue; }
    let f = emitterWeight(p, e);
    if (f > 0.0) { d = d + smokeOf(e.b.rgb) * (e.b.w * f * dt); }
  }
  let n = N();
  if (c.x == 0 || c.z == 0 || c.x == n.x - 1 || c.y == n.y - 1 || c.z == n.z - 1) { d = d * 0.8; }
  let m = amountOf(d);
  if (m > 4.0) { d = d * (4.0 / m); }
  textureStore(dyeOut, c, max(d, vec4<f32>(0.0)));
}`;

const LIGHT =  `
@group(1) @binding(0) var dyeIn: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var lightOut: texture_storage_3d<rgba16float, write>;
@group(1) @binding(3) var skyOut: texture_storage_3d<rgba8unorm, write>;
fn opticalDepth(c: vec3<i32>, dir: vec3<f32>) -> vec4<f32> {
  let n = P.dims.xyz;
  let L = normalize(dir);
  var q = vec3<f32>(c) + 0.5 + L * 0.5;
  var tau = vec4<f32>(0.0);
  for (var i = 0; i < 160; i = i + 1) {
    if (any(q < vec3<f32>(0.0)) || any(q > n)) { break; }
    tau = tau + textureSampleLevel(dyeIn, samp, q / n, 0.0);
    q = q + L;
  }
  return tau;
}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let n = P.dims.xyz;
  let tau = opticalDepth(c, P.light.xyz);
  var tauRim = vec4<f32>(0.0);
  if (P.light2.w > 0.5) { tauRim = opticalDepth(c, P.light2.xyz); }
  var q2 = vec3<f32>(c) + vec3<f32>(0.5, 1.0, 0.5);
  var tau2 = vec4<f32>(0.0);
  for (var i = 0; i < 24; i = i + 1) {
    if (q2.y > n.y) { break; }
    tau2 = tau2 + textureSampleLevel(dyeIn, samp, q2 / n, 0.0);
    q2.y = q2.y + 1.0;
  }
  let k = P.misc.w * P.dims.w * 0.55;
  let key = exp(-(vec3<f32>(tau.a) + tau.rgb) * k);
  let sky = exp(-(vec3<f32>(tau2.a) + tau2.rgb) * k * 0.5);
  textureStore(lightOut, c, vec4<f32>(key, exp(-tauRim.a * k)));
  textureStore(skyOut, c, vec4<f32>(sky, 1.0));
}`;

const LOCAL =  `
@group(1) @binding(0) var dyeIn: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var<uniform> LL: array<vec4<f32>, 4>;
@group(1) @binding(3) var localOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let n = P.dims.xyz;
  let c = vec3<i32>(g);
  if (any(c >= vec3<i32>(ceil(n * 0.5)))) { return; }
  let q0 = (vec3<f32>(c) + 0.5) * 2.0;
  let k = P.misc.w * P.dims.w * 0.55;
  var out = vec4<f32>(1.0);
  for (var i = 0; i < 4; i = i + 1) {
    if (LL[i].w < 0.5) { continue; }
    let span = (LL[i].xyz - P.origin.xyz) / P.dims.w - q0;
    let steps = clamp(i32(length(span) / 2.0), 1, 32);
    let stepv = span / f32(steps);
    var q = q0 + stepv * 0.5;
    var tau = vec4<f32>(0.0);
    for (var s = 0; s < steps; s = s + 1) {
      if (any(q < vec3<f32>(0.0)) || any(q > n)) { break; }
      tau = tau + textureSampleLevel(dyeIn, samp, q / n, 0.0);
      q = q + stepv;
    }
    out[i] = exp(-(tau.a + (tau.r + tau.g + tau.b) / 3.0) * k * length(stepv));
  }
  textureStore(localOut, c, out);
}`;

const PASSES = {
  solid: [SOLID, ['store3d:rgba16float']],
  advectV: [ADVECT_V, ['tex3d', 'sampler', 'tex3d', 'store3d:rgba16float']],
  curl: [CURL, ['tex3d', 'store3d:rgba16float']],
  forces: [FORCES, ['tex3d', 'tex3d', 'tex3d', 'tex3d', 'store3d:rgba16float']],
  div: [DIVERGENCE, ['tex3d', 'tex3d', 'store3d:r32float']],
  jacobi: [JACOBI, ['tex3d-u', 'tex3d-u', 'tex3d', 'store3d:r32float']],
  project: [PROJECT, ['tex3d', 'tex3d-u', 'tex3d', 'store3d:rgba16float']],
  advectD: [ADVECT_DYE, ['tex3d', 'sampler', 'tex3d', 'tex3d', 'store3d:rgba16float']],
  correctD: [CORRECT_DYE, ['tex3d', 'sampler', 'tex3d', 'tex3d', 'tex3d', 'store3d:rgba16float']],
  light: [LIGHT, ['tex3d', 'sampler', 'store3d:rgba16float', 'store3d:rgba8unorm']],
  local: [LOCAL, ['tex3d', 'sampler', 'uniform', 'store3d:rgba16float']],
};

const CARRY =  `
struct CP {
  o: vec4<f32>,
  od: vec4<f32>,
  n: vec4<f32>,
  nd: vec4<f32>,
};
@group(0) @binding(0) var<uniform> C: CP;
@group(0) @binding(1) var oldVel: texture_3d<f32>;
@group(0) @binding(2) var oldDye: texture_3d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var vel: texture_storage_3d<rgba16float, write>;
@group(0) @binding(5) var dye: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (any(c >= vec3<i32>(C.nd.xyz))) { return; }
  let p = C.n.xyz + (vec3<f32>(c) + 0.5) * C.n.w;
  let q = (p - C.o.xyz) / C.o.w;
  var v = vec4<f32>(0.0);
  var d = vec4<f32>(0.0);
  if (all(q >= vec3<f32>(0.0)) && all(q <= C.od.xyz)) {
    v = textureSampleLevel(oldVel, samp, q / C.od.xyz, 0.0);
    d = textureSampleLevel(oldDye, samp, q / C.od.xyz, 0.0);
  }
  textureStore(vel, c, v);
  textureStore(dye, c, d);
}`;
const carryPipes = new WeakMap();
async function carryPipe(d) {
  if (!carryPipes.has(d)) {
    const layout = makeLayout(d, ['uniform', 'tex3d', 'tex3d', 'sampler', 'store3d:rgba16float', 'store3d:rgba16float']);
    const module = await shaderModule(d, CARRY, 'smoke carry');
    carryPipes.set(d, { layout, pipe: computePipeline(d, module, [layout], 'main', 'smoke carry') });
  }
  return carryPipes.get(d);
}

export class Smoke {
  constructor(gpu, shared, { dims = [64, 64, 64], min = [-2, 0, -2], cell = 0.0625, pressureIterations = 30 } = {}) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.shared = shared;
    this.dims = dims;
    this.min = min;
    this.cell = cell;
    this.max = [min[0] + dims[0] * cell, min[1] + dims[1] * cell, min[2] + dims[2] * cell];
    this.iterations = pressureIterations + (pressureIterations % 2);
    this.params = new Float32Array(44);
    this.k = 0;
  }

  async init() {
    const d = this.device;
    const size = { width: this.dims[0], height: this.dims[1], depthOrArrayLayers: this.dims[2] };
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    const tex = (format, label) => d.createTexture({ size, format, usage, dimension: '3d', label });
    this.tex = {
      vel: [tex('rgba16float', 'smoke velocity A'), tex('rgba16float', 'smoke velocity B')],
      dye: [tex('rgba16float', 'smoke amount A'), tex('rgba16float', 'smoke amount B')],
      dyeFwd: tex('rgba16float', 'smoke amount, plain move'),
      p: [tex('r32float', 'pressure A'), tex('r32float', 'pressure B')],
      solid: tex('rgba16float', 'solid cells'),
      curl: tex('rgba16float', 'curl'),
      div: tex('r32float', 'divergence'),
      light: tex('rgba16float', 'light through smoke'),
      sky: tex('rgba8unorm', 'sky light through smoke'),
      local: d.createTexture({ size: { width: Math.ceil(this.dims[0] / 2), height: Math.ceil(this.dims[1] / 2), depthOrArrayLayers: Math.ceil(this.dims[2] / 2) },
        format: 'rgba16float', usage, dimension: '3d', label: 'placed lights through smoke' }),
    };
    const v = t => t.createView();
    const T = this.tex;
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.paramBuf = makeBuffer(d, this.params.byteLength, UNIFORM(), 'smoke settings');

    const l0 = makeLayout(d, ['uniform', 'uniform', 'uniform', 'tex3d', 'sampler']);
    this.group0 = makeGroup(d, l0, [this.paramBuf, this.shared.emitters, this.shared.objects, this.shared.atlasView, this.shared.atlasSampler]);
    this.pipes = {};
    this.layouts = {};
    for (const [name, [code, spec]] of Object.entries(PASSES)) {
      const module = await shaderModule(d, HEADER + code, 'smoke ' + name);
      this.layouts[name] = makeLayout(d, spec);
      this.pipes[name] = computePipeline(d, module, [l0, this.layouts[name]], 'main', 'smoke ' + name);
    }
    const g = (name, res) => makeGroup(d, this.layouts[name], res, name);
    const S = this.sampler, sv = v(T.solid);
    this.groups = { solid: g('solid', [sv]), jacobi: [
      g('jacobi', [v(T.p[0]), v(T.div), sv, v(T.p[1])]),
      g('jacobi', [v(T.p[1]), v(T.div), sv, v(T.p[0])]),
    ] };
    this.byParity = [0, 1].map(k => {
      const V0 = v(T.vel[k]), V1 = v(T.vel[1 - k]), D0 = v(T.dye[k]), D1 = v(T.dye[1 - k]);
      return {
        advectV: g('advectV', [V0, S, sv, V1]),
        curl: g('curl', [V1, v(T.curl)]),
        forces: g('forces', [V1, v(T.curl), v(T.dye[k]), sv, V0]),
        div: g('div', [V0, sv, v(T.div)]),
        project: g('project', [V0, v(T.p[0]), sv, V1]),
        advectD: g('advectD', [D0, S, V1, sv, v(T.dyeFwd)]),
        correctD: g('correctD', [D0, S, v(T.dyeFwd), V1, sv, D1]),
        light: g('light', [D1, S, v(T.light), v(T.sky)]),
      };
    });
    this.localBuf = makeBuffer(d, 64, UNIFORM(), 'placed lights for smoke');
    this.localGroups = [0, 1].map(k => g('local', [v(T.dye[k]), S, this.localBuf, v(T.local)]));
    this.localView = v(T.local);
    this.dyeViews = [v(T.dye[0]), v(T.dye[1])];
    this.lightView = v(T.light);
    this.skyView = v(T.sky);
    this.carry = await carryPipe(d);
    this.reset();
  }

  reset() {
    const q = this.device.queue;
    const [x, y, z] = this.dims;
    const zero8 = new Uint8Array(x * y * z * 8), zero4 = new Uint8Array(x * y * z * 4);
    const write = (t, data, bpp) => q.writeTexture({ texture: t }, data, { bytesPerRow: x * bpp, rowsPerImage: y }, [x, y, z]);
    for (const t of [...this.tex.vel, ...this.tex.dye, this.tex.dyeFwd, this.tex.solid, this.tex.curl]) write(t, zero8, 8);
    for (const t of [...this.tex.p, this.tex.div]) write(t, zero4, 4);
    write(this.tex.light, new Uint16Array(x * y * z * 4).fill(0x3c00), 8);
    write(this.tex.sky, new Uint8Array(x * y * z * 4).fill(255), 4);
    const [hx, hy, hz] = [x, y, z].map(v => Math.ceil(v / 2));
    q.writeTexture({ texture: this.tex.local }, new Uint16Array(hx * hy * hz * 4).fill(0x3c00), { bytesPerRow: hx * 8, rowsPerImage: hy }, [hx, hy, hz]);
  }

  lightLocal(pass, places) {
    const u = new Float32Array(16);
    places.slice(0, 4).forEach((p, i) => u.set([...p, 1], i * 4));
    this.device.queue.writeBuffer(this.localBuf, 0, u);
    pass.setPipeline(this.pipes.local);
    pass.setBindGroup(0, this.group0);
    pass.setBindGroup(1, this.localGroups[this.k]);
    const [x, y, z] = this.dims.map(v => Math.ceil(v / 2));
    pass.dispatchWorkgroups(Math.ceil(x / 4), Math.ceil(y / 4), Math.ceil(z / 4));
  }

  carryFrom(old) {
    const d = this.device, c = this.carry;
    const u = makeBuffer(d, 64, UNIFORM(), 'smoke carry settings');
    d.queue.writeBuffer(u, 0, new Float32Array([...old.min, old.cell, ...old.dims, 0, ...this.min, this.cell, ...this.dims, 0]));
    this.k = 0;
    const group = makeGroup(d, c.layout, [u, old.tex.vel[old.k].createView(), old.tex.dye[old.k].createView(), this.sampler,
      this.tex.vel[0].createView(), this.tex.dye[0].createView()], 'smoke carry');
    const enc = d.createCommandEncoder({ label: 'smoke carry' });
    const pass = enc.beginComputePass();
    pass.setPipeline(c.pipe);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 4), Math.ceil(this.dims[1] / 4), Math.ceil(this.dims[2] / 4));
    pass.end();
    d.queue.submit([enc.finish()]);
    d.queue.onSubmittedWorkDone().then(() => u.destroy());
  }

  get dyeView() { return this.dyeViews[this.k]; }

  get cellCount() { return this.dims[0] * this.dims[1] * this.dims[2]; }

  destroy() {
    for (const t of Object.values(this.tex).flat()) t.destroy();
    this.paramBuf.destroy();
    if (this.localBuf) this.localBuf.destroy();
  }

  writeParams(s) {
    const p = this.params;
    p.set([...this.dims, this.cell], 0);
    p.set([...this.min, s.dt], 4);
    p.set([s.rise, s.sink, s.swirl, s.cooling], 8);
    p.set([s.fade, s.emitterCount, s.objectCount, s.absorb], 12);
    const st = s.stir;
    p.set(st ? [...st.origin, st.radius, ...st.dir, 1, ...st.vel, 0] : new Array(12).fill(0), 16);
    this.frame = (this.frame || 0) + 1;
    p.set([...s.light, this.frame], 28);
    p.set(s.rim ? [...s.rim, 1] : [0, 1, 0, 0], 32);
    const w = s.wind;
    p.set(w ? [...w.vel, w.uptake] : [0, 0, 0, 0], 36);
    p.set(w ? [w.turbulence, w.turbScale, w.time, 0] : [0, 0, 0, 0], 40);
    this.device.queue.writeBuffer(this.paramBuf, 0, p);
  }

  step(pass) {
    const [x, y, z] = this.dims;
    const run = (name, group) => {
      pass.setPipeline(this.pipes[name]);
      pass.setBindGroup(1, group);
      pass.dispatchWorkgroups(Math.ceil(x / 4), Math.ceil(y / 4), Math.ceil(z / 4));
    };
    const G = this.byParity[this.k];
    pass.setBindGroup(0, this.group0);
    run('solid', this.groups.solid);
    run('advectV', G.advectV);
    run('curl', G.curl);
    run('forces', G.forces);
    run('div', G.div);
    for (let i = 0; i < this.iterations; i++) run('jacobi', this.groups.jacobi[i % 2]);
    run('project', G.project);
    run('advectD', G.advectD);
    run('correctD', G.correctD);
    run('light', G.light);
    this.k = 1 - this.k;
  }
}
