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
  fine: vec4<f32>,
  misc2: f32,
};
` + SOLVER_GROUP0('SP') +  `

fn N() -> vec3<i32> { return vec3<i32>(P.dims.xyz); }
fn cellIdx(c: vec3<i32>) -> u32 { return u32(c.x + i32(P.dims.x) * (c.y + i32(P.dims.y) * c.z)); }
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
fn modelInCell(p: vec3<f32>, o: Obj, d: f32, reach: f32) -> bool {
  let stretch = o.b.xyz / vec3<f32>(o.e.w, o.f.w, o.g.w);
  let side = reach / 3.0;
  let box = side * vec3<f32>(dot(abs(o.e.xyz), vec3<f32>(1.0)), dot(abs(o.f.xyz), vec3<f32>(1.0)), dot(abs(o.g.xyz), vec3<f32>(1.0))) / stretch;
  let near = length(box) * min(stretch.x, min(stretch.y, stretch.z));
  if (d > reach * 1.155 + near) { return false; }
  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let q = p + vec3<f32>(f32(x), f32(y), f32(z)) * side * 2.0;
        if (shapeSdf(localOf(q, o), o) < near) { return true; }
      }
    }
  }
  return false;
}
fn solidAt(p: vec3<f32>) -> i32 {
  let reach = P.turb.w;
  for (var i = 0u; i < u32(P.misc.z); i = i + 1u) {
    let o = O[i];
    if (length(p - o.a.xyz) - o.c.w > reach * 2.2) { continue; }
    let d = shapeSdf(localOf(p, o), o);
    if (d < 0.0) { return i32(i); }
    if (reach <= 0.0 || o.d.w > 0.5) { continue; }
    if (u32(o.a.w + 0.5) == 9u) { if (modelInCell(p, o, d, reach)) { return i32(i); } }
    else if (d < reach) { return i32(i); }
  }
  return -1;
}
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let p = worldOf(c);
  let i = solidAt(p);
  var s = vec4<f32>(0.0);
  if (i >= 0) { s = vec4<f32>(solidVelAt(p, O[u32(i)]), 1.0); }
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
  let v = textureLoad(velIn, c, 0);
  let back = vec3<f32>(c) - P.origin.w * v.xyz / P.dims.w;
  textureStore(velOut, c, textureSampleLevel(velIn, samp, uvw(back), 0.0));
}`;

const CORRECT_V =  `
@group(1) @binding(0) var velOld: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var velFwd: texture_3d<f32>;
@group(1) @binding(3) var solid: texture_3d<f32>;
@group(1) @binding(4) var velOut: texture_storage_3d<rgba16float, write>;
@group(1) @binding(5) var<storage, read> who: array<u32>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let s = textureLoad(solid, c, 0);
  if (s.w > 0.5) { textureStore(velOut, c, vec4<f32>(s.xyz, 0.0)); return; }
  let dt = P.origin.w;
  let old = textureLoad(velOld, c, 0);
  let moved = dt * old.xyz / P.dims.w;
  let fwd = textureLoad(velFwd, c, 0);
  let round2 = textureSampleLevel(velFwd, samp, uvw(vec3<f32>(c) + moved), 0.0);
  var nv = fwd + 0.5 * P.fine.w * (old - round2);
  let b = vec3<i32>(floor(vec3<f32>(c) - moved));
  var lo = vec4<f32>(1e9);
  var hi = vec4<f32>(-1e9);
  for (var k = 0; k < 8; k = k + 1) {
    let q = clamp(b + vec3<i32>(k & 1, (k >> 1) & 1, (k >> 2) & 1), vec3<i32>(0), N() - vec3<i32>(1));
    let t = textureLoad(velOld, q, 0);
    lo = min(lo, t);
    hi = max(hi, t);
  }
  nv = clamp(nv, lo, hi);
  let m = N() - vec3<i32>(1);
  let around = (textureLoad(velOld, clamp(c + X, vec3<i32>(0), m), 0) + textureLoad(velOld, clamp(c - X, vec3<i32>(0), m), 0)
              + textureLoad(velOld, clamp(c + Y, vec3<i32>(0), m), 0) + textureLoad(velOld, clamp(c - Y, vec3<i32>(0), m), 0)
              + textureLoad(velOld, clamp(c + Z, vec3<i32>(0), m), 0) + textureLoad(velOld, clamp(c - Z, vec3<i32>(0), m), 0)) / 6.0;
  nv = nv + P.misc2 * (around - old);
  nv.w = min(nv.w * exp(-FT[who[cellIdx(c)]].a.y * dt), 6.0);
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
@group(1) @binding(5) var<storage, read> who: array<u32>;
fn W(c: vec3<i32>) -> f32 { return textureLoad(curlIn, clamp(c, vec3<i32>(0), N() - vec3<i32>(1)), 0).w; }
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let s = textureLoad(solid, c, 0);
  if (s.w > 0.5) { textureStore(velOut, c, vec4<f32>(s.xyz, 0.0)); return; }
  let dt = P.origin.w;
  var v = textureLoad(velIn, c, 0);
  let dens = amountOf(textureLoad(dyeIn, c, 0));
  let own = who[cellIdx(c)];
  let grad = vec3<f32>(W(c + X) - W(c - X), W(c + Y) - W(c - Y), W(c + Z) - W(c - Z));
  let gl = length(grad);
  if (gl > 1e-5) {
    let w = textureLoad(curlIn, c, 0).xyz;
    v = vec4<f32>(v.xyz + dt * FT[own].b.x * P.dims.w * smoothstep(0.0, 0.05, dens) * cross(grad / gl, w), v.w);
  }
  v.y = v.y + dt * (FT[own].a.z * v.w - FT[own].a.w * dens);
  let p = worldOf(c);
  for (var i = 0u; i < u32(P.misc.y); i = i + 1u) {
    let e = E[i];
    if (e.d.x != 1.0) { continue; }
    let f = emitterWeight(p, e);
    if (f > 0.0) {
      let t = P.fine.z;
      let jitter = noiseVec(p * (1.0 / max(e.a.w, 0.05)) + vec3<f32>(0.0, -t * 1.3, t * 0.4)) * 2.0 * (0.12 + 0.4 * length(e.c.xyz));
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
  let top = 10.0 + 1.5 * length(P.wind.xyz);
  let speed = length(v.xyz);
  if (speed > top) { v = vec4<f32>(v.xyz * (top / speed), v.w); }
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

const SMOKE_FLOW =  `
fn NF() -> vec3<i32> { return N() * i32(P.fine.x); }
fn fineCell() -> f32 { return P.dims.w / P.fine.x; }
fn uvwOf(c: vec3<i32>) -> vec3<f32> { return (vec3<f32>(c) + 0.5) / vec3<f32>(NF()); }
fn detailAt(q: vec3<f32>) -> f32 { return FT[who[cellIdx(clamp(vec3<i32>(q * P.dims.xyz), vec3<i32>(0), N() - vec3<i32>(1)))]].b.y; }
fn flowAt(q: vec3<f32>) -> vec3<f32> {
  let v = textureSampleLevel(velIn, samp, q, 0.0).xyz;
  let detail = detailAt(q);
  if (detail <= 0.0) { return v; }
  let speed = length(v) + 0.1;
  let w = q * P.dims.xyz;
  let t = P.fine.z;
  let a = textureSampleLevel(swirls, swirlSamp, w / 7.5 + vec3<f32>(0.11, -0.37, 0.19) * t, 0.0).xyz;
  let b = textureSampleLevel(swirls, swirlSamp, w / 3.75 + vec3<f32>(-0.23, -0.71, 0.13) * t, 0.0).xyz;
  return v + (a + 0.6 * b) * speed * 0.45 * detail;
}
`;
const ADVECT_DYE =  `
@group(1) @binding(0) var dyeIn: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var velIn: texture_3d<f32>;
@group(1) @binding(3) var solid: texture_3d<f32>;
@group(1) @binding(4) var dyeOut: texture_storage_3d<rgba16float, write>;
@group(1) @binding(5) var swirls: texture_3d<f32>;
@group(1) @binding(6) var swirlSamp: sampler;
@group(1) @binding(7) var<storage, read> who: array<u32>;
` + SMOKE_FLOW +  `
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (any(c >= NF())) { return; }
  let q = uvwOf(c);
  let back = q - P.origin.w * flowAt(q) / (P.dims.xyz * P.dims.w);
  textureStore(dyeOut, c, textureSampleLevel(dyeIn, samp, back, 0.0));
}`;

const CORRECT_DYE =  `
@group(1) @binding(0) var dyeOld: texture_3d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var dyeFwd: texture_3d<f32>;
@group(1) @binding(3) var velIn: texture_3d<f32>;
@group(1) @binding(4) var solid: texture_3d<f32>;
@group(1) @binding(5) var dyeOut: texture_storage_3d<rgba16float, write>;
@group(1) @binding(6) var swirls: texture_3d<f32>;
@group(1) @binding(7) var swirlSamp: sampler;
@group(1) @binding(8) var<storage, read> who: array<u32>;
` + SMOKE_FLOW +  `
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  let n = NF();
  if (any(c >= n)) { return; }
  let q = uvwOf(c);
  if (textureSampleLevel(solid, samp, q, 0.0).w > 0.5) { textureStore(dyeOut, c, vec4<f32>(0.0)); return; }
  let dt = P.origin.w;
  let h = fineCell();
  let v = flowAt(q);
  let fwd = textureLoad(dyeFwd, c, 0);
  let moved = dt * v / (P.dims.xyz * P.dims.w);
  let roundTrip = textureSampleLevel(dyeFwd, samp, q + moved, 0.0);
  var d = fwd + 0.5 * (textureLoad(dyeOld, c, 0) - roundTrip);
  let back = vec3<f32>(c) - dt * v / h;
  let b = vec3<i32>(floor(back));
  var lo = vec4<f32>(1e9);
  var hi = vec4<f32>(-1e9);
  for (var k = 0; k < 8; k = k + 1) {
    let s = textureLoad(dyeOld, clamp(b + vec3<i32>(k & 1, (k >> 1) & 1, (k >> 2) & 1), vec3<i32>(0), n - vec3<i32>(1)), 0);
    lo = min(lo, s);
    hi = max(hi, s);
  }
  d = clamp(d, lo, hi);
  let own = who[cellIdx(clamp(c / i32(P.fine.x), vec3<i32>(0), N() - vec3<i32>(1)))];
  d = d * exp(-FT[own].a.x * dt);
  let p = P.origin.xyz + (vec3<f32>(c) + 0.5) * h;
  for (var i = 0u; i < u32(P.misc.y); i = i + 1u) {
    let e = E[i];
    if (e.d.x == 3.0) { d = d * exp(-e.b.w * sinkWeight(p, e) * dt); continue; }
    if (e.d.x != 1.0) { continue; }
    let f = emitterWeight(p, e);
    if (f > 0.0) {
      let t = P.fine.z;
      let patchy = textureSampleLevel(swirls, swirlSamp, p / (max(e.a.w, 0.03) * 5.0) + vec3<f32>(0.0, -0.3, 0.17) * t + e.a.xyz, 0.0).x;
      d = d + smokeOf(e.b.rgb) * (e.b.w * f * dt * clamp(1.0 + 1.6 * patchy * min(FT[u32(e.d.w)].b.y, 1.0), 0.1, 2.0));
    }
  }
  if (c.x == 0 || c.z == 0 || c.x == n.x - 1 || c.y == n.y - 1 || c.z == n.z - 1) { d = d * 0.8; }
  let m = amountOf(d);
  if (m > 4.0) { d = d * (4.0 / m); }
  textureStore(dyeOut, c, max(d, vec4<f32>(0.0)));
}`;

const DYE_DOWN =  `
@group(1) @binding(0) var fineIn: texture_3d<f32>;
@group(1) @binding(1) var lowOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let by = i32(P.fine.x);
  var sum = vec4<f32>(0.0);
  for (var z = 0; z < by; z = z + 1) {
    for (var y = 0; y < by; y = y + 1) {
      for (var x = 0; x < by; x = x + 1) {
        sum = sum + textureLoad(fineIn, c * by + vec3<i32>(x, y, z), 0);
      }
    }
  }
  textureStore(lowOut, c, sum / f32(by * by * by));
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
  let k = P.misc.w * P.dims.w * 0.8;
  let key = exp(-(vec3<f32>(tau.a) + tau.rgb) * k);
  let sky = exp(-(vec3<f32>(tau2.a) + tau2.rgb) * k * 0.5);
  textureStore(lightOut, c, vec4<f32>(key, exp(-tauRim.a * k)));
  textureStore(skyOut, c, vec4<f32>(sky, clamp(amountOf(textureLoad(dyeIn, c, 0)) * 400.0, 0.0, 1.0)));
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
  let half2 = vec3<i32>(ceil(n * 0.5));
  if (any(c >= half2)) { return; }
  let q0 = (vec3<f32>(c) + 0.5) * 2.0;
  let k = P.misc.w * P.dims.w * 0.8;
  var r = vec4<f32>(1.0);
  var gr = vec4<f32>(1.0);
  var b = vec4<f32>(1.0);
  for (var i = 0; i < 4; i = i + 1) {
    if (LL[i].w < 0.5) { continue; }
    let span = (LL[i].xyz - P.origin.xyz) / P.dims.w - q0;
    let steps = clamp(i32(length(span)), 1, 96);
    let stepv = span / f32(steps);
    var q = q0 + stepv * 0.5;
    var tau = vec4<f32>(0.0);
    for (var s = 0; s < steps; s = s + 1) {
      if (any(q < vec3<f32>(0.0)) || any(q > n)) { break; }
      tau = tau + textureSampleLevel(dyeIn, samp, q / n, 0.0);
      q = q + stepv;
    }
    let t = exp(-(vec3<f32>(tau.a) + tau.rgb) * k * length(stepv));
    r[i] = t.r;
    gr[i] = t.g;
    b[i] = t.b;
  }
  let hz = half2.z;
  textureStore(localOut, c, r);
  textureStore(localOut, c + vec3<i32>(0, 0, hz + 1), gr);
  textureStore(localOut, c + vec3<i32>(0, 0, 2 * hz + 2), b);
}`;

const WHO =  `
@group(1) @binding(0) var velIn: texture_3d<f32>;
@group(1) @binding(1) var<storage, read> whoIn: array<u32>;
@group(1) @binding(2) var<storage, read_write> whoOut: array<u32>;
@group(1) @binding(3) var dyeNow: texture_3d<f32>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!inside(c)) { return; }
  let moved = P.origin.w * textureLoad(velIn, c, 0).xyz / P.dims.w;
  let r = hash3(g.x + g.y * 1009u + g.z * 1000003u + u32(P.light.w) * 7919u);
  let up = vec3<i32>(floor(vec3<f32>(c) + 0.5 - moved + r - 0.5));
  var id = 0u;
  if (inside(up)) { id = whoIn[cellIdx(up)]; }
  if (amountOf(textureLoad(dyeNow, c, 0)) < 5e-4) { id = 0u; }
  else if (id == 0u) {
    var most = 0.0;
    for (var k = 0u; k < 3u; k = k + 1u) {
      for (var s = -1; s <= 1; s = s + 2) {
        var q = c;
        q[k] = q[k] + s;
        if (!inside(q)) { continue; }
        let v = whoIn[cellIdx(q)];
        let a = amountOf(textureLoad(dyeNow, q, 0));
        if (v != 0u && a > most) { most = a; id = v; }
      }
    }
  }
  let p = worldOf(c);
  for (var i = 0u; i < u32(P.misc.y); i = i + 1u) {
    let e = E[i];
    if (e.d.x == 1.0 && emitterWeight(p, e) > 0.02) { id = u32(e.d.w); }
  }
  whoOut[cellIdx(c)] = id;
}`;

const PASSES = {
  solid: [SOLID, ['store3d:rgba16float']],
  advectV: [ADVECT_V, ['tex3d', 'sampler', 'tex3d', 'store3d:rgba16float']],
  correctV: [CORRECT_V, ['tex3d', 'sampler', 'tex3d', 'tex3d', 'store3d:rgba16float', 'read']],
  curl: [CURL, ['tex3d', 'store3d:rgba16float']],
  forces: [FORCES, ['tex3d', 'tex3d', 'tex3d', 'tex3d', 'store3d:rgba16float', 'read']],
  div: [DIVERGENCE, ['tex3d', 'tex3d', 'store3d:r32float']],
  jacobi: [JACOBI, ['tex3d-u', 'tex3d-u', 'tex3d', 'store3d:r32float']],
  project: [PROJECT, ['tex3d', 'tex3d-u', 'tex3d', 'store3d:rgba16float']],
  advectD: [ADVECT_DYE, ['tex3d', 'sampler', 'tex3d', 'tex3d', 'store3d:rgba16float', 'tex3d', 'sampler', 'read']],
  correctD: [CORRECT_DYE, ['tex3d', 'sampler', 'tex3d', 'tex3d', 'tex3d', 'store3d:rgba16float', 'tex3d', 'sampler', 'read']],
  down: [DYE_DOWN, ['tex3d', 'store3d:rgba16float']],
  light: [LIGHT, ['tex3d', 'sampler', 'store3d:rgba16float', 'store3d:rgba8unorm']],
  local: [LOCAL, ['tex3d', 'sampler', 'uniform', 'store3d:rgba16float']],
  who: [WHO, ['tex3d', 'read', 'storage', 'tex3d']],
};

const CARRY =  `
struct CP {
  o: vec4<f32>,
  od: vec4<f32>,
  n: vec4<f32>,
  nd: vec4<f32>,
};
@group(0) @binding(0) var<uniform> C: CP;
@group(0) @binding(1) var from3: texture_3d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var to3: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (any(c >= vec3<i32>(C.nd.xyz))) { return; }
  let p = C.n.xyz + (vec3<f32>(c) + 0.5) * C.n.w;
  let q = (p - C.o.xyz) / C.o.w;
  var v = vec4<f32>(0.0);
  if (all(q >= vec3<f32>(0.0)) && all(q <= C.od.xyz)) { v = textureSampleLevel(from3, samp, q / C.od.xyz, 0.0); }
  textureStore(to3, c, v);
}`;
const CARRY_WHO =  `
struct CP { o: vec4<f32>, od: vec4<f32>, n: vec4<f32>, nd: vec4<f32> };
@group(0) @binding(0) var<uniform> C: CP;
@group(0) @binding(1) var<storage, read> whoOld: array<u32>;
@group(0) @binding(2) var<storage, read_write> whoNew: array<u32>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (any(c >= vec3<i32>(C.nd.xyz))) { return; }
  let q = vec3<i32>(floor((C.n.xyz + (vec3<f32>(c) + 0.5) * C.n.w - C.o.xyz) / C.o.w));
  let od = vec3<i32>(C.od.xyz);
  var id = 0u;
  if (all(q >= vec3<i32>(0)) && all(q < od)) { id = whoOld[u32(q.x + od.x * (q.y + od.y * q.z))]; }
  whoNew[u32(c.x + i32(C.nd.x) * (c.y + i32(C.nd.y) * c.z))] = id;
}`;
const carryPipes = new WeakMap();
async function carryPipe(d) {
  if (!carryPipes.has(d)) {
    const layout = makeLayout(d, ['uniform', 'tex3d', 'sampler', 'store3d:rgba16float']);
    const module = await shaderModule(d, CARRY, 'smoke carry');
    const whoLayout = makeLayout(d, ['uniform', 'read', 'storage']);
    const whoModule = await shaderModule(d, CARRY_WHO, 'smoke carry, which fluid');
    carryPipes.set(d, { layout, pipe: computePipeline(d, module, [layout], 'main', 'smoke carry'), whoLayout, whoPipe: computePipeline(d, whoModule, [whoLayout], 'main', 'smoke carry, which fluid') });
  }
  return carryPipes.get(d);
}

const DYE_MOST = 6e6;
const swirlTextures = new WeakMap();
function swirlTexture(d) {
  if (swirlTextures.has(d)) return swirlTextures.get(d);
  const N = 32, at = (x, y, z) => ((x + N) % N) + N * (((y + N) % N) + N * ((z + N) % N));
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5;
  const smooth = () => {
    let a = Float32Array.from({ length: N * N * N }, rnd);
    for (let pass = 0; pass < 3; pass++) for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const b = new Float32Array(a.length);
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        b[at(x, y, z)] = 0.25 * a[at(x - dx, y - dy, z - dz)] + 0.5 * a[at(x, y, z)] + 0.25 * a[at(x + dx, y + dy, z + dz)];
      }
      a = b;
    }
    return a;
  };
  const A = smooth(), B = smooth(), C = smooth(), out = new Float32Array(N * N * N * 3);
  let sum = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dy = F => F[at(x, y + 1, z)] - F[at(x, y - 1, z)], dz = F => F[at(x, y, z + 1)] - F[at(x, y, z - 1)], dx = F => F[at(x + 1, y, z)] - F[at(x - 1, y, z)];
    const v = [dy(C) - dz(B), dz(A) - dx(C), dx(B) - dy(A)], i = at(x, y, z) * 3;
    out.set(v, i);
    sum += v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  }
  const k = 0.5 / Math.sqrt(sum / (N * N * N)), bytes = new Int8Array(N * N * N * 4);
  for (let i = 0; i < N * N * N; i++) for (let c = 0; c < 3; c++) bytes[i * 4 + c] = Math.max(-127, Math.min(127, Math.round(out[i * 3 + c] * k * 127)));
  const tex = d.createTexture({ size: [N, N, N], dimension: '3d', format: 'rgba8snorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'small swirls' });
  d.queue.writeTexture({ texture: tex }, bytes, { bytesPerRow: N * 4, rowsPerImage: N }, [N, N, N]);
  const made = { view: tex.createView(), sampler: d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }) };
  swirlTextures.set(d, made);
  return made;
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
    this.params = new Float32Array(52);
    this.airEven = 0.02;
    this.k = 0;
    this.solidReach = 0.5;
    const cells = dims[0] * dims[1] * dims[2];
    this.fineBy = cells * 27 <= DYE_MOST ? 3 : cells * 8 <= DYE_MOST ? 2 : 1;
    this.clock = 0;
    this.airSharp = 0.6;
  }

  async init() {
    const d = this.device;
    const size = { width: this.dims[0], height: this.dims[1], depthOrArrayLayers: this.dims[2] };
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    const tex = (format, label) => d.createTexture({ size, format, usage, dimension: '3d', label });
    const by = this.fineBy, fineTex = label => d.createTexture({ size: { width: this.dims[0] * by, height: this.dims[1] * by, depthOrArrayLayers: this.dims[2] * by }, format: 'rgba16float', usage, dimension: '3d', label });
    const dye = [tex('rgba16float', 'smoke amount A'), tex('rgba16float', 'smoke amount B')];
    this.tex = {
      vel: [tex('rgba16float', 'smoke velocity A'), tex('rgba16float', 'smoke velocity B')],
      velFwd: tex('rgba16float', 'smoke velocity, plain move'),
      dye,
      fine: by > 1 ? [fineTex('fine smoke A'), fineTex('fine smoke B')] : dye,
      dyeFwd: by > 1 ? fineTex('fine smoke, plain move') : tex('rgba16float', 'smoke amount, plain move'),
      p: [tex('r32float', 'pressure A'), tex('r32float', 'pressure B')],
      solid: tex('rgba16float', 'solid cells'),
      curl: tex('rgba16float', 'curl'),
      div: tex('r32float', 'divergence'),
      light: tex('rgba16float', 'light through smoke'),
      sky: tex('rgba8unorm', 'sky light through smoke'),
      local: d.createTexture({ size: { width: Math.ceil(this.dims[0] / 2), height: Math.ceil(this.dims[1] / 2), depthOrArrayLayers: Math.ceil(this.dims[2] / 2) * 3 + 2 },
        format: 'rgba16float', usage, dimension: '3d', label: 'placed lights through smoke, a stack per colour' }),
    };
    const v = t => t.createView();
    const T = this.tex;
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.paramBuf = makeBuffer(d, this.params.byteLength, UNIFORM(), 'smoke settings');

    const l0 = makeLayout(d, ['uniform', 'uniform', 'uniform', 'tex3d', 'sampler', 'uniform']);
    this.group0 = makeGroup(d, l0, [this.paramBuf, this.shared.emitters, this.shared.objects, this.shared.atlasView, this.shared.atlasSampler, this.shared.fluids]);
    this.who = [0, 1].map(k => makeBuffer(d, this.cellCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, 'which smoke where ' + k));
    this.pipes = {};
    this.layouts = {};
    for (const [name, [code, spec]] of Object.entries(PASSES)) {
      const module = await shaderModule(d, HEADER + code, 'smoke ' + name);
      this.layouts[name] = makeLayout(d, spec);
      this.pipes[name] = computePipeline(d, module, [l0, this.layouts[name]], 'main', 'smoke ' + name);
    }
    const g = (name, res) => makeGroup(d, this.layouts[name], res, name);
    const S = this.sampler, sv = v(T.solid), sw = swirlTexture(d);
    this.groups = { solid: g('solid', [sv]), jacobi: [
      g('jacobi', [v(T.p[0]), v(T.div), sv, v(T.p[1])]),
      g('jacobi', [v(T.p[1]), v(T.div), sv, v(T.p[0])]),
    ] };
    this.byParity = [0, 1].map(k => {
      const V0 = v(T.vel[k]), V1 = v(T.vel[1 - k]), D1 = v(T.dye[1 - k]), F0 = v(T.fine[k]), F1 = v(T.fine[1 - k]), VF = v(T.velFwd), W0 = this.who[k];
      return {
        advectV: g('advectV', [V0, S, sv, VF]),
        correctV: g('correctV', [V0, S, VF, sv, V1, W0]),
        curl: g('curl', [V1, v(T.curl)]),
        forces: g('forces', [V1, v(T.curl), v(T.dye[k]), sv, V0, W0]),
        div: g('div', [V0, sv, v(T.div)]),
        project: g('project', [V0, v(T.p[0]), sv, V1]),
        advectD: g('advectD', [F0, S, V1, sv, v(T.dyeFwd), sw.view, sw.sampler, W0]),
        correctD: g('correctD', [F0, S, v(T.dyeFwd), V1, sv, F1, sw.view, sw.sampler, W0]),
        down: by > 1 ? g('down', [F1, D1]) : null,
        light: g('light', [D1, S, v(T.light), v(T.sky)]),
        who: g('who', [V1, W0, this.who[1 - k], D1]),
      };
    });
    this.localBuf = makeBuffer(d, 64, UNIFORM(), 'placed lights for smoke');
    this.localGroups = [0, 1].map(k => g('local', [v(T.dye[k]), S, this.localBuf, v(T.local)]));
    this.localView = v(T.local);
    this.dyeViews = [v(T.fine[0]), v(T.fine[1])];
    this.lightView = v(T.light);
    this.skyView = v(T.sky);
    this.carry = await carryPipe(d);
    this.reset();
  }

  reset() {
    const q = this.device.queue;
    const [x, y, z] = this.dims;
    for (const b of this.who) q.writeBuffer(b, 0, new Uint8Array(x * y * z * 4));
    const zero8 = new Uint8Array(x * y * z * 8), zero4 = new Uint8Array(x * y * z * 4);
    const write = (t, data, bpp) => q.writeTexture({ texture: t }, data, { bytesPerRow: x * bpp, rowsPerImage: y }, [x, y, z]);
    for (const t of [...this.tex.vel, this.tex.velFwd, ...this.tex.dye, this.tex.solid, this.tex.curl]) write(t, zero8, 8);
    for (const t of [...this.tex.p, this.tex.div]) write(t, zero4, 4);
    const by = this.fineBy, [fx, fy, fz] = [x * by, y * by, z * by];
    const zeroF = by > 1 ? new Uint8Array(fx * fy * fz * 8) : zero8;
    for (const t of by > 1 ? [...this.tex.fine, this.tex.dyeFwd] : [this.tex.dyeFwd]) q.writeTexture({ texture: t }, zeroF, { bytesPerRow: fx * 8, rowsPerImage: fy }, [fx, fy, fz]);
    write(this.tex.light, new Uint16Array(x * y * z * 4).fill(0x3c00), 8);
    const sky = new Uint8Array(x * y * z * 4).fill(255);
    for (let i = 3; i < sky.length; i += 4) sky[i] = 0;
    write(this.tex.sky, sky, 4);
    const [hx, hy, hz0] = [x, y, z].map(v => Math.ceil(v / 2)), hz = hz0 * 3 + 2;
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
    this.k = 0;
    const enc = d.createCommandEncoder({ label: 'smoke carry' });
    const pass = enc.beginComputePass();
    pass.setPipeline(c.pipe);
    const bufs = [];
    const one = (from, to, cell, dims) => {
      const u = makeBuffer(d, 64, UNIFORM(), 'smoke carry settings');
      bufs.push(u);
      d.queue.writeBuffer(u, 0, new Float32Array([...old.min, old.cell, ...old.dims, 0, ...this.min, cell, ...dims, 0]));
      pass.setBindGroup(0, makeGroup(d, c.layout, [u, from.createView(), this.sampler, to.createView()], 'smoke carry'));
      pass.dispatchWorkgroups(...dims.map(n => Math.ceil(n / 4)));
    };
    one(old.tex.vel[old.k], this.tex.vel[0], this.cell, this.dims);
    one(old.tex.fine[old.k], this.tex.fine[0], this.cell / this.fineBy, this.dims.map(n => n * this.fineBy));
    if (this.fineBy > 1) one(old.tex.dye[old.k], this.tex.dye[0], this.cell, this.dims);
    {
      const u = makeBuffer(d, 64, UNIFORM(), 'smoke carry settings');
      bufs.push(u);
      d.queue.writeBuffer(u, 0, new Float32Array([...old.min, old.cell, ...old.dims, 0, ...this.min, this.cell, ...this.dims, 0]));
      pass.setPipeline(c.whoPipe);
      pass.setBindGroup(0, makeGroup(d, c.whoLayout, [u, old.who[old.k], this.who[0]], 'smoke carry, which fluid'));
      pass.dispatchWorkgroups(...this.dims.map(n => Math.ceil(n / 4)));
    }
    pass.end();
    d.queue.submit([enc.finish()]);
    d.queue.onSubmittedWorkDone().then(() => bufs.forEach(u => u.destroy()));
    this.clock = old.clock;
  }

  get dyeView() { return this.dyeViews[this.k]; }
  get whoNow() { return this.who[this.k]; }

  get cellCount() { return this.dims[0] * this.dims[1] * this.dims[2]; }

  destroy() {
    for (const t of Object.values(this.tex).flat()) t.destroy();
    this.paramBuf.destroy();
    if (this.localBuf) this.localBuf.destroy();
    for (const b of this.who) b.destroy();
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
    const w = s.wind, reach = this.solidReach * this.cell;
    p.set(w ? [...w.vel, w.uptake] : [0, 0, 0, 0], 36);
    p.set(w ? [w.turbulence, w.turbScale, w.time, reach] : [0, 0, 0, reach], 40);
    this.clock += s.dt;
    p.set([this.fineBy, s.detail ?? 1, this.clock, this.airSharp, this.airEven], 44);
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
    run('correctV', G.correctV);
    run('curl', G.curl);
    run('forces', G.forces);
    run('div', G.div);
    for (let i = 0; i < this.iterations; i++) run('jacobi', this.groups.jacobi[i % 2]);
    run('project', G.project);
    const by = this.fineBy, runFine = (name, group) => {
      pass.setPipeline(this.pipes[name]);
      pass.setBindGroup(1, group);
      pass.dispatchWorkgroups(Math.ceil(x * by / 4), Math.ceil(y * by / 4), Math.ceil(z * by / 4));
    };
    runFine('advectD', G.advectD);
    runFine('correctD', G.correctD);
    if (G.down) run('down', G.down);
    run('light', G.light);
    run('who', G.who);
    this.k = 1 - this.k;
  }
}
