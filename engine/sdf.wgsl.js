import { ARCH, STEPS } from './shapes.js';

export const MAX_OBJECTS = 64;
export const OBJ_FLOATS = 32;
export const MAX_EMITTERS = 8;
export const ATLAS_RES = 64;
export const ATLAS_SLOTS = 32;
export const ATLAS_PAD = 1.15;

export const SHAPES_WGSL =  `
struct Obj {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  f: vec4<f32>,
  g: vec4<f32>,
  h: vec4<f32>,
};

struct Emitter {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
};

fn localOf(p: vec3<f32>, o: Obj) -> vec3<f32> {
  let d = p - o.a.xyz;
  return vec3<f32>(dot(d, o.e.xyz), dot(d, o.f.xyz), dot(d, o.g.xyz));
}
fn worldOfLocal(q: vec3<f32>, o: Obj) -> vec3<f32> {
  return o.a.xyz + o.e.xyz * q.x + o.f.xyz * q.y + o.g.xyz * q.z;
}
fn worldDir(v: vec3<f32>, o: Obj) -> vec3<f32> {
  return o.e.xyz * v.x + o.f.xyz * v.y + o.g.xyz * v.z;
}
fn solidVelAt(p: vec3<f32>, o: Obj) -> vec3<f32> {
  return o.c.xyz + cross(o.h.xyz, p - o.a.xyz);
}

fn sdBox(q: vec3<f32>, s: vec3<f32>) -> f32 {
  let d = abs(q) - s;
  return length(max(d, vec3<f32>(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

fn sdCone(p: vec3<f32>, h: f32, r1: f32) -> f32 {
  let q = vec2<f32>(length(p.xz), p.y);
  let k1 = vec2<f32>(0.0, h);
  let k2 = vec2<f32>(-r1, 2.0 * h);
  let ca = vec2<f32>(q.x - min(q.x, select(0.0, r1, q.y < 0.0)), abs(q.y) - h);
  let cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

`;

export const SCENE_SDF_WGSL =  `
fn shapeSdf(q: vec3<f32>, o: Obj) -> f32 {
  let s = o.b.xyz;
  let k = u32(o.a.w + 0.5);
  let m = min(s.x, min(s.y, s.z));
  if (k == 1u) { return sdBox(q, s); }
  if (k == 2u) {
    let k0 = length(q / s);
    let k1 = length(q / (s * s));
    return k0 * (k0 - 1.0) / max(k1, 1e-6);
  }
  if (k == 3u) {
    let d = vec2<f32>(length(q.xz) - s.x, abs(q.y) - s.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
  }
  if (k == 4u) { return sdCone(q, s.y, s.x); }
  if (k == 5u) {
    let u = q / s;
    let t = vec2<f32>(length(u.xz) - 0.7, u.y);
    return (length(t) - 0.3) * m;
  }
  if (k == 6u) {
    let n = normalize(vec2<f32>(s.y, s.x));
    return max(sdBox(q, s), dot(q.xy, n));
  }
  if (k == 7u) {
    let u = q / s;
    let r = ${ARCH.r};
    let sp = ${ARCH.spring};
    let slot = vec2<f32>(abs(u.x) - r, u.y - sp);
    let dSlot = length(max(slot, vec2<f32>(0.0))) + min(max(slot.x, slot.y), 0.0);
    let dRound = length(u.xy - vec2<f32>(0.0, sp)) - r;
    let opening = min(dSlot, dRound);
    return max(sdBox(q, s), -opening * min(s.x, s.y));
  }
  if (k == 8u) {
    var d = 1e9;
    let w = 2.0 / ${STEPS}.0;
    for (var i = 0; i < ${STEPS}; i = i + 1) {
      let x1 = 1.0 - f32(i) * w;
      let y1 = -1.0 + f32(i + 1) * w;
      let lo = vec3<f32>(x1 - w, -1.0, -1.0) * s;
      let hi = vec3<f32>(x1, y1, 1.0) * s;
      d = min(d, sdBox(q - (lo + hi) * 0.5, (hi - lo) * 0.5));
    }
    return d;
  }
  return modelSdf(q, o);
}

fn modelSdf(q: vec3<f32>, o: Obj) -> f32 {
  let s = o.b.xyz;
  let u = q / s;
  let pad = ${ATLAS_PAD};
  let inside = clamp(u, vec3<f32>(-pad), vec3<f32>(pad));
  let res = ${ATLAS_RES}.0;
  var t = (inside / pad) * 0.5 + 0.5;
  t = clamp(t, vec3<f32>(0.5 / res), vec3<f32>(1.0 - 0.5 / res));
  let coord = vec3<f32>(t.x, t.y, (o.b.w + t.z) / ${ATLAS_SLOTS}.0);
  let d = textureSampleLevel(atlas, atlasSamp, coord, 0.0).r;
  let prop = vec3<f32>(o.e.w, o.f.w, o.g.w);
  let k = min(s.x / prop.x, min(s.y / prop.y, s.z / prop.z));
  return d * k + length((u - inside) * s);
}

fn sceneSdf(p: vec3<f32>, count: u32) -> vec2<f32> {
  var best = vec2<f32>(1e9, 0.0);
  for (var i = 0u; i < count; i = i + 1u) {
    let o = O[i];
    if (length(p - o.a.xyz) - o.c.w > best.x) { continue; }
    let d = shapeSdf(localOf(p, o), o);
    if (d < best.x) { best = vec2<f32>(d, f32(i)); }
  }
  return best;
}

fn sceneNormal(p: vec3<f32>, count: u32) -> vec3<f32> {
  let e = 0.004;
  let n = vec3<f32>(
    sceneSdf(p + vec3<f32>(e, 0.0, 0.0), count).x - sceneSdf(p - vec3<f32>(e, 0.0, 0.0), count).x,
    sceneSdf(p + vec3<f32>(0.0, e, 0.0), count).x - sceneSdf(p - vec3<f32>(0.0, e, 0.0), count).x,
    sceneSdf(p + vec3<f32>(0.0, 0.0, e), count).x - sceneSdf(p - vec3<f32>(0.0, 0.0, e), count).x);
  return normalize(n + vec3<f32>(0.0, 1e-6, 0.0));
}

fn stirWeight(p: vec3<f32>, ro: vec3<f32>, rd: vec3<f32>, radius: f32) -> f32 {
  let t = max(dot(p - ro, rd), 0.0);
  let d = length(p - (ro + rd * t));
  let x = clamp(1.0 - d / radius, 0.0, 1.0);
  return x * x;
}

fn sinkWeight(p: vec3<f32>, e: Emitter) -> f32 {
  let x = clamp(1.0 - length(p - e.a.xyz) / e.a.w, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

fn pcg(n: u32) -> u32 {
  let s = n * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn hash3(n: u32) -> vec3<f32> {
  let x = pcg(n);
  let y = pcg(x);
  let z = pcg(y);
  return vec3<f32>(f32(x), f32(y), f32(z)) / 4294967295.0;
}

fn hashp(p: vec3<f32>) -> f32 {
  let q = fract(p * 0.3183099 + vec3<f32>(0.1, 0.2, 0.3)) * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}
fn vnoise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hashp(i), hashp(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
              mix(hashp(i + vec3<f32>(0.0, 1.0, 0.0)), hashp(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hashp(i + vec3<f32>(0.0, 0.0, 1.0)), hashp(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
              mix(hashp(i + vec3<f32>(0.0, 1.0, 1.0)), hashp(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
fn noiseVec(p: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(vnoise3(p), vnoise3(p + vec3<f32>(31.4, 7.1, 19.7)), vnoise3(p + vec3<f32>(-12.9, 43.3, 5.5))) - 0.5;
}
`;

export const SCENE_WGSL = SHAPES_WGSL + SCENE_SDF_WGSL;

export const SOLVER_GROUP0 = (paramsType) =>  `
@group(0) @binding(0) var<uniform> P: ${paramsType};
@group(0) @binding(1) var<uniform> E: array<Emitter, ${MAX_EMITTERS}>;
@group(0) @binding(2) var<uniform> O: array<Obj, ${MAX_OBJECTS}>;
@group(0) @binding(3) var atlas: texture_3d<f32>;
@group(0) @binding(4) var atlasSamp: sampler;
`;
