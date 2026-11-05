import { SHAPES_WGSL } from './sdf.wgsl.js';

export const MAX_LIGHTS = 8, LIGHT_LAYERS = 24, LIGHT_SHADOW_SIZE = 1024, LIGHT_NEAR = 0.05;
export const LIGHT_FLOATS = 24;
export const FRAME_FLOATS = 192 + 4 + MAX_LIGHTS * LIGHT_FLOATS + LIGHT_LAYERS * 16;

export const FRAME_WGSL = SHAPES_WGSL +  `
struct Light {
  pos: vec4<f32>,
  dir: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  col: vec4<f32>,
  sh: vec4<f32>,
};
struct Frame {
  viewProj: mat4x4<f32>,
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  shadowVP: mat4x4<f32>,
  eye: vec4<f32>,
  screen: vec4<f32>,
  keyDir: vec4<f32>,
  keyCol: vec4<f32>,
  fillDir: vec4<f32>,
  fillCol: vec4<f32>,
  rimDir: vec4<f32>,
  rimCol: vec4<f32>,
  ambSky: vec4<f32>,
  ambGround: vec4<f32>,
  ground: vec4<f32>,
  groundB: vec4<f32>,
  fog: vec4<f32>,
  env: vec4<f32>,
  smokeMin: vec4<f32>,
  smokeMax: vec4<f32>,
  smokeDims: vec4<f32>,
  liquid: vec4<f32>,
  liquidCol: vec4<f32>,
  boxMin: vec4<f32>,
  boxMax: vec4<f32>,
  shadowRight: vec4<f32>,
  shadowUp: vec4<f32>,
  bgTop: vec4<f32>,
  bgBottom: vec4<f32>,
  wind: vec4<f32>,
  liqMin: vec4<f32>,
  liqMax: vec4<f32>,
  lightN: vec4<f32>,
  lights: array<Light, 8>,
  lightVP: array<mat4x4<f32>, 24>,
};

const PI = 3.14159265;

fn hash11(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn hash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x),
             mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn boxHit(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec2<f32> {
  let safe = select(rd, vec3<f32>(1e-6), abs(rd) < vec3<f32>(1e-6));
  let inv = 1.0 / safe;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let a = min(t0, t1);
  let b = max(t0, t1);
  return vec2<f32>(max(max(a.x, a.y), a.z), min(min(b.x, b.y), b.z));
}

fn fogged(c: vec3<f32>, wp: vec3<f32>) -> vec3<f32> {
  let dist = length(wp - F.eye.xyz);
  return mix(c, F.fog.rgb, 1.0 - exp(-dist * F.fog.w));
}

fn quadCorner(vi: u32) -> vec2<f32> {
  var c = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
                              vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));
  return c[vi];
}

fn viewTurn() -> mat3x3<f32> { return mat3x3<f32>(F.view[0].xyz, F.view[1].xyz, F.view[2].xyz); }
fn ndcOf(fc: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(fc.x * F.screen.z * 2.0 - 1.0, 1.0 - fc.y * F.screen.w * 2.0);
}
fn viewPos(fc: vec2<f32>, d: f32) -> vec3<f32> {
  let ndc = ndcOf(fc);
  return vec3<f32>(ndc.x / F.proj[0][0] * d, ndc.y / F.proj[1][1] * d, -d);
}
`;

export const SKY_WGSL =  `
fn shown(c: vec3<f32>) -> vec3<f32> {
  let y = min(c, vec3<f32>(0.98));
  let a = 2.43 * y - 2.51;
  let b = 0.59 * y - 0.03;
  let k = 0.14 * y;
  let x = (-b - sqrt(max(b * b - 4.0 * a * k, vec3<f32>(0.0)))) / (2.0 * a);
  return max(x, vec3<f32>(0.0)) / max(F.env.y, 1e-3);
}

fn skyColor(d: vec3<f32>) -> vec3<f32> {
  let kind = u32(F.env.x + 0.5);
  let up = d.y;
  let top = F.bgTop.rgb;
  let bottom = F.bgBottom.rgb;
  if (kind == 0u) {
    return mix(bottom, top, smoothstep(-0.3, 0.7, up)) * (1.0 + 0.25 * exp(-abs(up - 0.05) * 6.0));
  }
  if (kind == 1u) {
    var c = mix(bottom, top, pow(clamp(up, 0.0, 1.0), 0.5));
    if (up > 0.0) {
      let uv = d.xz / (up + 0.12) + F.wind.xz * F.eye.w * 0.004;
      let cl = smoothstep(0.55, 0.85, vnoise(uv * 1.2) * 0.65 + vnoise(uv * 3.3) * 0.35);
      c = mix(c, vec3<f32>(1.0, 0.99, 0.97), cl * 0.6 * smoothstep(0.0, 0.25, up));
    }
    return c;
  }
  if (kind == 2u || kind == 3u) {
    var c = mix(bottom, top, clamp(up * 1.6, 0.0, 1.0));
    if (kind == 3u) {
      let az = atan2(d.z, d.x);
      for (var layer = 0; layer < 3; layer = layer + 1) {
        let fl = f32(layer);
        let x = (az / 6.2831853 + 0.5) * (60.0 + fl * 40.0);
        let id = floor(x);
        let h = 0.03 + hash11(id + fl * 91.7) * (0.17 - fl * 0.045);
        if (up < h && up > -0.08) {
          let s = 0.15 + fl * 0.075;
          var b = vec3<f32>(s, s * 1.04, s * 1.12);
          let wx = fract(x * 5.0);
          let wy = fract(up * 160.0);
          if (wx > 0.3 && wx < 0.7 && wy > 0.45 && hash21(vec2<f32>(floor(x * 5.0), floor(up * 160.0)) + fl) > 0.72) {
            b = b + vec3<f32>(0.32, 0.27, 0.16) * (1.0 - fl * 0.35);
          }
          c = mix(c, b, 1.0 - fl * 0.2);
          break;
        }
      }
    }
    return c;
  }
  if (kind == 4u) { return mix(bottom, top, clamp(up * 0.5 + 0.5, 0.0, 1.0)); }
  if (kind == 5u) { return top; }
  if (F.env.w > 0.5) {
    let u = atan2(d.x, -d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return shown(textureSampleLevel(bgTex, bgSamp, vec2<f32>(u, v), 0.0).rgb);
  }
  return mix(bottom, top, clamp(up * 0.5 + 0.5, 0.0, 1.0));
}
`;

export const LIGHTING_WGSL =  `
var<private> POISSON: array<vec2<f32>, 12> = array<vec2<f32>, 12>(
  vec2<f32>(-0.326, -0.406), vec2<f32>(-0.840, -0.074), vec2<f32>(-0.696, 0.457), vec2<f32>(-0.203, 0.621),
  vec2<f32>(0.962, -0.195), vec2<f32>(0.473, -0.480), vec2<f32>(0.519, 0.767), vec2<f32>(0.185, -0.893),
  vec2<f32>(0.507, 0.064), vec2<f32>(0.896, 0.412), vec2<f32>(-0.322, -0.933), vec2<f32>(-0.792, -0.598));

fn shadowAt(wp: vec3<f32>, n: vec3<f32>, taps: i32) -> f32 {
  if (F.keyCol.w < 0.5) { return 1.0; }
  let lp = F.shadowVP * vec4<f32>(wp + n * 0.02, 1.0);
  let uv = vec2<f32>(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || lp.z > 1.0) { return 1.0; }
  let r = F.keyDir.w / 2048.0;
  var s = 0.0;
  for (var i = 0; i < taps; i = i + 1) {
    s = s + textureSampleCompareLevel(shadowMap, shadowSamp, uv + POISSON[i] * r, lp.z - 0.0012);
  }
  return s / f32(taps);
}

fn smokeShadow(wp: vec3<f32>) -> vec3<f32> {
  if (F.smokeMin.w < 0.5) { return vec3<f32>(1.0); }
  let h = boxHit(wp, F.keyDir.xyz, F.smokeMin.xyz, F.smokeMax.xyz);
  if (h.x > h.y || h.y < 0.0) { return vec3<f32>(1.0); }
  let e = wp + F.keyDir.xyz * max(h.x, 0.0);
  let uvw = (e - F.smokeMin.xyz) / (F.smokeMax.xyz - F.smokeMin.xyz);
  return textureSampleLevel(smokeLight, linSamp, uvw, 0.0).rgb;
}

fn lightOne(l: vec3<f32>, col: vec3<f32>, n: vec3<f32>, v: vec3<f32>, albedo: vec3<f32>, spec: f32, rough: f32) -> vec3<f32> {
  let ndl = dot(n, l);
  if (ndl <= 0.0) { return vec3<f32>(0.0); }
  let hv = normalize(l + v);
  let shin = mix(600.0, 6.0, rough);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(hv, v), 0.0), 5.0);
  let s = pow(max(dot(n, hv), 0.0), shin) * (shin + 8.0) / 32.0 * spec * fres;
  return col * ndl * (albedo + vec3<f32>(s));
}

fn ambientAt(n: vec3<f32>) -> vec3<f32> {
  return mix(F.ambGround.rgb, F.ambSky.rgb, n.y * 0.5 + 0.5) * F.ambSky.w;
}


fn lightLayer(L: Light, wp: vec3<f32>) -> i32 {
  var layer = i32(L.sh.x);
  if (L.sh.y > 1.5) {
    let d = wp - L.pos.xyz;
    let a = abs(d);
    if (a.x >= a.y && a.x >= a.z) { layer = layer + select(1, 0, d.x > 0.0); }
    else if (a.y >= a.z) { layer = layer + select(3, 2, d.y > 0.0); }
    else { layer = layer + select(5, 4, d.z > 0.0); }
  }
  return layer;
}

fn localShadowAt(L: Light, wp: vec3<f32>, n: vec3<f32>, taps: i32) -> f32 {
  if (L.sh.x < -0.5) { return 1.0; }
  let layer = lightLayer(L, wp);
  let l = normalize(L.pos.xyz - wp);
  let ndl = select(1.0, clamp(abs(dot(n, l)), 0.08, 1.0), dot(n, n) > 0.5);
  let away = max(dot(L.pos.xyz - wp, L.pos.xyz - wp), 1e-4);
  let pix = sqrt(away) * L.sh.w;
  let slack = 0.01 + pix * (1.5 + 2.0 * sqrt(1.0 - ndl * ndl) / ndl);
  let lp = F.lightVP[layer] * vec4<f32>(wp + n * min(slack, 0.08), 1.0);
  if (lp.w <= 1e-4) { return 1.0; }
  let p = lp.xyz / lp.w;
  let uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || p.z > 1.0 || p.z < 0.0) { return 1.0; }
  let bias = 0.05 * slack / (lp.w * lp.w);
  let r = L.sh.z / 1024.0;
  var s = 0.0;
  for (var i = 0; i < taps; i = i + 1) {
    s = s + textureSampleCompareLevel(localShadow, shadowSamp, uv + POISSON[i] * r, layer, p.z - bias);
  }
  return s / f32(taps);
}

fn faceNearest(L: Light, o: vec3<f32>, r: vec3<f32>) -> vec3<f32> {
  let den = dot(r, L.dir.xyz);
  var h = o - L.pos.xyz;
  if (den < -1e-3) {
    let t = dot(L.pos.xyz - o, L.dir.xyz) / den;
    if (t > 0.0) { h = o + r * t - L.pos.xyz; }
  }
  return L.pos.xyz + L.right.xyz * clamp(dot(h, L.right.xyz), -L.right.w, L.right.w)
                   + L.up.xyz * clamp(dot(h, L.up.xyz), -L.up.w, L.up.w);
}

fn lightReach(L: Light, wp: vec3<f32>, q: vec3<f32>, l: vec3<f32>) -> f32 {
  let kind = u32(L.pos.w + 0.5);
  let d = q - wp;
  var k = 1.0 / max(dot(d, d), max(L.right.w * L.right.w * select(1.0, 0.0, kind == 1u), 1e-4));
  if (kind == 3u) { k = k * smoothstep(L.dir.w, L.col.w, dot(-l, L.dir.xyz)); }
  if (kind == 1u) { k = k * max(dot(-l, L.dir.xyz), 0.0); }
  return k;
}

fn placedLight(L: Light, wp: vec3<f32>, n: vec3<f32>, v: vec3<f32>, albedo: vec3<f32>, spec: f32, rough: f32, taps: i32) -> vec3<f32> {
  var c = vec3<f32>(0.0);
  if (u32(L.pos.w + 0.5) == 1u) {
    for (var a = -1; a <= 1; a = a + 1) {
      for (var b = -1; b <= 1; b = b + 1) {
        let q = L.pos.xyz + L.right.xyz * (L.right.w * f32(a) * 0.667) + L.up.xyz * (L.up.w * f32(b) * 0.667);
        let l = normalize(q - wp);
        c = c + lightOne(l, L.col.rgb * (lightReach(L, wp, q, l) / 9.0), n, v, albedo, 0.0, rough);
      }
    }
    if (spec > 0.0) {
      let q = faceNearest(L, wp, reflect(-v, n));
      let l = normalize(q - wp);
      c = c + lightOne(l, L.col.rgb * lightReach(L, wp, q, l), n, v, vec3<f32>(0.0), spec, rough);
    }
  } else {
    let l = normalize(L.pos.xyz - wp);
    c = lightOne(l, L.col.rgb * lightReach(L, wp, L.pos.xyz, l), n, v, albedo, spec, rough);
  }
  if (L.sh.x > -0.5 && max(c.r, max(c.g, c.b)) > 1e-5) { c = c * localShadowAt(L, wp, n, taps); }
  return c;
}

fn placedGlint(L: Light, wp: vec3<f32>, n: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
  var q = L.pos.xyz;
  if (u32(L.pos.w + 0.5) == 1u) { q = faceNearest(L, wp, reflect(-v, n)); }
  let l = normalize(q - wp);
  return L.col.rgb * lightReach(L, wp, q, l) * pow(max(dot(n, normalize(l + v)), 0.0), 400.0) * 4.0;
}

var<private> rimK: f32 = 1.0;

fn shade(wp: vec3<f32>, n: vec3<f32>, albedo: vec3<f32>, spec: f32, rough: f32, taps: i32) -> vec3<f32> {
  let v = normalize(F.eye.xyz - wp);
  let contact = mix(0.55, 1.0, clamp(wp.y * 3.0 + 0.2, 0.0, 1.0));
  var c = albedo * ambientAt(n) * contact;
  let sh = shadowAt(wp, n, taps) * smokeShadow(wp);
  c = c + lightOne(F.keyDir.xyz, F.keyCol.rgb, n, v, albedo, spec, rough) * sh;
  c = c + lightOne(F.fillDir.xyz, F.fillCol.rgb, n, v, albedo, spec, rough);
  c = c + lightOne(F.rimDir.xyz, F.rimCol.rgb * rimK, n, v, albedo, spec, rough);
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) { c = c + placedLight(F.lights[i], wp, n, v, albedo, spec, rough, min(taps, 6)); }
  return c;
}
`;


const SCENE_BINDINGS =  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> D: array<Obj>;
@group(0) @binding(2) var<storage, read> PP: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> PC: array<vec4<f32>>;
@group(0) @binding(4) var shadowMap: texture_depth_2d;
@group(0) @binding(5) var shadowSamp: sampler_comparison;
@group(0) @binding(6) var smokeDye: texture_3d<f32>;
@group(0) @binding(7) var smokeLight: texture_3d<f32>;
@group(0) @binding(8) var linSamp: sampler;
@group(0) @binding(9) var bgTex: texture_2d<f32>;
@group(0) @binding(10) var bgSamp: sampler;
@group(0) @binding(11) var localShadow: texture_depth_2d_array;
`;

export const SCENE_SHADER = FRAME_WGSL + SCENE_BINDINGS + SKY_WGSL + LIGHTING_WGSL +  `
struct SkyOut { @builtin(position) pos: vec4<f32> };
@vertex fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return SkyOut(vec4<f32>(p[vi], 1.0, 1.0));
}
@fragment fn fsSky(i: SkyOut) -> @location(0) vec4<f32> {
  if (u32(F.env.x + 0.5) == 6u && F.env.w < 0.5) {
    let dims = vec2<f32>(textureDimensions(bgTex));
    let screenAspect = F.screen.x / F.screen.y;
    let picAspect = dims.x / dims.y;
    var uv = i.pos.xy * F.screen.zw;
    if (screenAspect > picAspect) { uv.y = 0.5 + (uv.y - 0.5) * picAspect / screenAspect; }
    else { uv.x = 0.5 + (uv.x - 0.5) * screenAspect / picAspect; }
    return vec4<f32>(shown(textureSampleLevel(bgTex, bgSamp, uv, 0.0).rgb), 1.0);
  }
  let ndc = vec2<f32>(i.pos.x * F.screen.z * 2.0 - 1.0, 1.0 - i.pos.y * F.screen.w * 2.0);
  let far = F.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let d = normalize(far.xyz / far.w - F.eye.xyz);
  return vec4<f32>(skyColor(d), 1.0);
}

struct GroundOut { @builtin(position) pos: vec4<f32>, @location(0) wp: vec3<f32> };
@vertex fn vsGround(@builtin(vertex_index) vi: u32) -> GroundOut {
  let c = quadCorner(vi);
  let r = F.groundB.z;
  let wp = vec3<f32>(c.x * r, 0.0, c.y * r);
  return GroundOut(F.viewProj * vec4<f32>(wp, 1.0), wp);
}

fn ripples(p: vec2<f32>, t: f32) -> vec2<f32> {
  var n = vec2<f32>(0.0);
  for (var k = 0; k < 2; k = k + 1) {
    let fk = f32(k);
    let q = p * 2.6 + fk * 17.3;
    let cid = floor(q);
    let f = fract(q) - 0.5;
    let h = hash21(cid + fk * 3.1);
    let age = fract(t * 0.8 + h);
    let ctr = vec2<f32>(hash21(cid + 1.7), hash21(cid + 5.3)) - 0.5;
    let dv = f - ctr * 0.5;
    let r = length(dv);
    let ring = sin((r - age * 0.5) * 70.0) * exp(-r * 9.0) * (1.0 - age);
    n = n + dv / max(r, 1e-3) * ring * 0.12;
  }
  return n;
}

fn gridLine(p: vec2<f32>, spacing: f32, width: f32) -> f32 {
  let q = p / spacing;
  let w = fwidth(q) * width;
  let g = abs(fract(q - 0.5) - 0.5) / max(w, vec2<f32>(1e-4));
  return 1.0 - min(min(g.x, g.y), 1.0);
}

@fragment fn fsGround(i: GroundOut) -> @location(0) vec4<f32> {
  let wp = i.wp;
  let finish = u32(F.ground.w + 0.5);
  var albedo = F.ground.rgb * (0.96 + 0.06 * vnoise(wp.xz * 3.0));
  var n = vec3<f32>(0.0, 1.0, 0.0);
  var spec = F.groundB.w;
  var rough = F.groundB.y;
  var puddle = 0.0;
  let rain = F.env.z;
  if (finish == 3u) {
    puddle = smoothstep(0.48, 0.62, vnoise(wp.xz * 0.33) * 0.7 + vnoise(wp.xz * 1.3) * 0.3);
    albedo = albedo * mix(0.85 + 0.3 * vnoise(wp.xz * 6.0), 0.55, puddle);
    rough = mix(0.35, 0.03, puddle);
  }
  if (rain > 0.0 && finish >= 2u) {
    let rp = ripples(wp.xz, F.eye.w) * (0.35 + 0.65 * puddle) * rain;
    n = normalize(vec3<f32>(rp.x, 1.0, rp.y));
  }
  if (F.groundB.x > 1.5) {
    let q = wp.xz / vec2<f32>(0.215, 0.065);
    let row = floor(q.y);
    let shift = 0.5 * (row - 2.0 * floor(row * 0.5));
    let bx = fract(q.x + shift);
    let by = fract(q.y);
    let w = fwidth(q);
    let inX = smoothstep(0.0, 0.05 + w.x, min(bx, 1.0 - bx));
    let inY = smoothstep(0.0, 0.16 + w.y, min(by, 1.0 - by));
    let mortar = 1.0 - inX * inY;
    let face = 0.88 + 0.24 * hash21(vec2<f32>(floor(q.x + shift), row));
    albedo = albedo * mix(face, 0.45, mortar);
  } else if (F.groundB.x > 0.5) {
    let fade = exp(-length(wp.xz - F.eye.xz) * 0.06);
    let lum = dot(albedo, vec3<f32>(0.33));
    var ink = select(vec3<f32>(1.0), vec3<f32>(0.0), lum > 0.35);
    var k = select(0.22, 0.10, lum < 0.35);
    let gc = u32(F.bgTop.w + 0.5);
    if (gc > 0u) {
      ink = pow(vec3<f32>(f32((gc >> 16u) & 255u), f32((gc >> 8u) & 255u), f32(gc & 255u)) / 255.0, vec3<f32>(2.2));
    }
    if (F.wind.w > 0.0) { k = F.wind.w; }
    let sp = select(1.0, F.bgBottom.w, F.bgBottom.w > 0.0);
    albedo = mix(albedo, ink, (gridLine(wp.xz, sp, 1.2) * k + gridLine(wp.xz, sp * 0.25, 1.0) * k * 0.35) * fade);
  }
  rimK = 0.0;
  var c = shade(wp, n, albedo, spec, rough, 12);
  if (finish >= 1u) {
    let v = normalize(F.eye.xyz - wp);
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    let refl = skyColor(reflect(-v, n));
    var k = fres * spec;
    if (finish == 3u) { k = clamp(fres * (0.3 + 0.5 * puddle) + puddle * 0.2, 0.0, 1.0); }
    c = mix(c, refl * 0.85, clamp(k, 0.0, 1.0));
  }
  return vec4<f32>(fogged(c, wp), 1.0);
}

struct ObjOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) n: vec3<f32>,
  @location(2) @interpolate(flat) id: u32,
};
@vertex fn vsObj(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @builtin(instance_index) id: u32) -> ObjOut {
  let o = D[id];
  let wp = worldOfLocal(p * o.b.xyz, o);
  let wn = normalize(worldDir(nrm / o.b.xyz, o));
  return ObjOut(F.viewProj * vec4<f32>(wp, 1.0), wp, wn, id);
}
@fragment fn fsObj(i: ObjOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let o = D[i.id];
  var n = normalize(i.n);
  if (!front && dot(n, F.eye.xyz - i.wp) < 0.0) { n = -n; }
  let flag = o.d.w;
  if (flag > 3.5) {
    let v = normalize(F.eye.xyz - i.wp);
    let ly = normalize(worldDir(vec3<f32>(0.0, 1.0, 0.0), o));
    let point = flag > 5.5;
    let face = point || dot(n, ly) > 0.6;
    var c = select(vec3<f32>(0.035), o.d.rgb * 3.0 / max(F.env.y, 0.3), face);
    let sel = (point && flag > 6.5) || (!point && flag > 4.5);
    if (sel) { c = mix(c, vec3<f32>(1.0, 0.85, 0.3) * 1.5 / max(F.env.y, 0.3), smoothstep(0.55, 0.8, 1.0 - abs(dot(n, v)))); }
    return vec4<f32>(c, 1.0);
  }
  if (flag > 1.5) {
    let v = normalize(F.eye.xyz - i.wp);
    let edge = 1.0 - max(dot(n, v), 0.0);
    var c = o.d.rgb * (0.55 + 0.45 * max(dot(n, F.keyDir.xyz), 0.0)) + o.d.rgb * edge * 0.6;
    if (flag > 2.5) { c = mix(c, vec3<f32>(1.0, 0.85, 0.3), smoothstep(0.55, 0.8, edge)); }
    return vec4<f32>(c * 1.2 / max(F.env.y, 0.3), 1.0);
  }
  let fin = u32(o.h.w + 0.5);
  if (fin == 3u) { discard; }
  var albedo = o.d.rgb;
  var spec = 0.35;
  var rough = 0.45;
  if (fin == 1u) { spec = 0.04; rough = 0.9; }
  if (fin == 2u) {
    let gr = vnoise(i.wp.xz * 140.0 + i.wp.y * 97.0) * 0.6 + vnoise(i.wp.zy * 260.0) * 0.4;
    albedo = albedo * (0.78 + 0.32 * gr);
    spec = 0.9; rough = 0.32;
  }
  if (fin == 4u) { spec = 0.9; rough = 0.12; }
  var c = shade(i.wp, n, albedo, spec, rough, 12);
  if (fin == 2u || fin == 4u) {
    let v = normalize(F.eye.xyz - i.wp);
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    let refl = skyColor(reflect(-v, n));
    c = mix(c, refl * select(vec3<f32>(0.6), albedo * 0.9, fin == 2u), clamp(fres * select(0.5, 0.8, fin == 2u), 0.0, 1.0));
  }
  if (flag > 0.5) {
    let v = normalize(F.eye.xyz - i.wp);
    let edge = smoothstep(0.6, 0.95, 1.0 - abs(dot(n, v)));
    c = mix(c, vec3<f32>(1.0, 0.82, 0.25) * 1.5 / max(F.env.y, 0.3), edge * 0.85);
  }
  return vec4<f32>(fogged(c, i.wp), 1.0);
}

@fragment fn fsGlass(i: ObjOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let o = D[i.id];
  if (u32(o.h.w + 0.5) != 3u || o.d.w > 1.5) { discard; }
  var n = normalize(i.n);
  if (!front) { n = -n; }
  let v = normalize(F.eye.xyz - i.wp);
  let fres = 0.06 + 0.94 * pow(1.0 - abs(dot(n, v)), 4.0);
  let lit = shade(i.wp, n, o.d.rgb, 1.0, 0.08, 4);
  let refl = skyColor(reflect(-v, n));
  var c = mix(lit * 0.75, refl, fres * 0.6);
  var a = clamp(0.24 + fres * 0.8, 0.0, 0.94);
  if (o.d.w > 0.5) {
    c = mix(c, vec3<f32>(1.0, 0.82, 0.25) * 1.5 / max(F.env.y, 0.3), 0.5);
    a = max(a, 0.5);
  }
  return vec4<f32>(fogged(c, i.wp), a);
}

struct DotOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) vc: vec3<f32>,
  @location(2) wc: vec3<f32>,
  @location(3) col: vec3<f32>,
};
struct DotFrag { @location(0) color: vec4<f32>, @builtin(frag_depth) depth: f32 };
@vertex fn vsDots(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  let c = quadCorner(vi);
  let wp = PP[ii].xyz;
  let vc = (F.view * vec4<f32>(wp, 1.0)).xyz;
  let r = F.liquid.y;
  var o: DotOut;
  o.pos = F.proj * vec4<f32>(vc + vec3<f32>(c * r, 0.0), 1.0);
  if (PP[ii].w > 0.5) { o.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0); }
  o.uv = c;
  o.vc = vc;
  o.wc = wp;
  o.col = exp(-PC[ii].xyz);
  return o;
}
@fragment fn fsDots(i: DotOut) -> DotFrag {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let nv = vec3<f32>(i.uv, sqrt(1.0 - r2));
  let vp = i.vc + nv * F.liquid.y;
  let clip = F.proj * vec4<f32>(vp, 1.0);
  let nw = transpose(viewTurn()) * nv;
  let wp = i.wc + nw * F.liquid.y;
  let c = shade(wp, nw, i.col, 0.8, 0.12, 4);
  var o: DotFrag;
  o.color = vec4<f32>(fogged(c, wp), 1.0);
  o.depth = clip.z / clip.w;
  return o;
}

@vertex fn vsLines(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var e = array<vec3<f32>, 24>(
    vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 1.0),
    vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 1.0),
    vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 0.0),
    vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 1.0, 1.0));
  let p = mix(F.boxMin.xyz, F.boxMax.xyz, e[vi]);
  return F.viewProj * vec4<f32>(p, 1.0);
}
@fragment fn fsLines() -> @location(0) vec4<f32> {
  return vec4<f32>(vec3<f32>(F.boxMax.w), 0.35);
}
`;


export const SHADOW_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> D: array<Obj>;
@group(0) @binding(2) var<storage, read> PP: array<vec4<f32>>;

@vertex fn vsShadowObj(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @builtin(instance_index) id: u32) -> @builtin(position) vec4<f32> {
  let o = D[id];
  return F.shadowVP * vec4<f32>(worldOfLocal(p * o.b.xyz, o), 1.0);
}

struct SDot { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsShadowDots(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SDot {
  let c = quadCorner(vi);
  let wp = PP[ii].xyz + (F.shadowRight.xyz * c.x + F.shadowUp.xyz * c.y) * F.liquid.y * 1.3;
  if (PP[ii].w > 0.5) { return SDot(vec4<f32>(0.0, 0.0, 2.0, 1.0), c); }
  return SDot(F.shadowVP * vec4<f32>(wp, 1.0), c);
}
@fragment fn fsShadowDots(i: SDot) {
  if (dot(i.uv, i.uv) > 1.0) { discard; }
}
`;


export const LIQUID_WGSL =  `
fn liquidAt(p: vec3<f32>) -> vec4<f32> {
  let uvw = (p - F.liqMin.xyz) / (F.liqMax.xyz - F.liqMin.xyz);
  return textureSampleLevel(liquidLook, linSamp, clamp(uvw, vec3<f32>(0.0), vec3<f32>(1.0)), 0.0);
}

struct Body { dye: vec3<f32>, depth: f32, end: f32, last: f32 };
fn throughBody(o: vec3<f32>, d: vec3<f32>) -> Body {
  let cell = F.liqMin.w;
  let stepLen = cell * 0.5;
  var b = Body(vec3<f32>(0.0), 0.0, 0.0, 0.0);
  let span = boxHit(o, d, F.liqMin.xyz, F.liqMax.xyz);
  if (span.y <= max(span.x, 0.0)) { return b; }
  b.end = max(span.x, 0.0);
  b.last = b.end;
  var entered = false;
  var air = 0.0;
  for (var i = 0; i < 200; i = i + 1) {
    if (b.end >= span.y) { break; }
    let s = liquidAt(o + d * b.end);
    if (s.a > 0.02) {
      entered = true;
      air = 0.0;
      b.last = b.end;
      b.dye = b.dye + s.rgb * stepLen;
      b.depth = b.depth + s.a * stepLen;
    } else {
      air = air + stepLen;
      if (air > cell * select(2.0, 1.5, entered)) { break; }
    }
    b.end = b.end + stepLen;
  }
  return b;
}
`;


export const FLUID_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> PP: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> PC: array<vec4<f32>>;
@group(0) @binding(3) var sceneDepth: texture_depth_2d;
@group(0) @binding(4) var bodyFar: texture_2d<f32>;

struct FOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) vc: vec3<f32>,
  @location(2) dye: vec3<f32>,
};
@vertex fn vsFluid(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  let c = quadCorner(vi);
  let vc = (F.view * vec4<f32>(PP[ii].xyz, 1.0)).xyz;
  var o: FOut;
  o.pos = F.proj * vec4<f32>(vc + vec3<f32>(c * F.liquid.y, 0.0), 1.0);
  if (PP[ii].w > 0.5) { o.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0); }
  o.uv = c;
  o.vc = vc;
  o.dye = PC[ii].xyz;
  return o;
}

struct DepthFrag { @location(0) lin: vec4<f32>, @builtin(frag_depth) depth: f32 };
@fragment fn fsFluidDepth(i: FOut) -> DepthFrag {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let vp = i.vc + vec3<f32>(0.0, 0.0, sqrt(1.0 - r2) * F.liquid.y);
  let clip = F.proj * vec4<f32>(vp, 1.0);
  let z = clip.z / clip.w;
  if (z > textureLoad(sceneDepth, vec2<i32>(i.pos.xy), 0)) { discard; }
  var o: DepthFrag;
  o.lin = vec4<f32>(-vp.z, 0.0, 0.0, 1.0);
  o.depth = z;
  return o;
}

@fragment fn fsFluidThick(i: FOut) -> @location(0) vec4<f32> {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let vp = i.vc + vec3<f32>(0.0, 0.0, sqrt(1.0 - r2) * F.liquid.y);
  let clip = F.proj * vec4<f32>(vp, 1.0);
  if (clip.z / clip.w > textureLoad(sceneDepth, vec2<i32>(i.pos.xy), 0)) { discard; }
  if (length(vp) > textureLoad(bodyFar, vec2<i32>(i.pos.xy), 0).x) { discard; }
  let t = 2.0 * sqrt(1.0 - r2) * F.liquid.y;
  return vec4<f32>(i.dye * t, t);
}
`;

export const BODY_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var fluidRaw: texture_2d<f32>;
@group(0) @binding(2) var liquidLook: texture_3d<f32>;
@group(0) @binding(3) var linSamp: sampler;
` + LIQUID_WGSL +  `
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsBody(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let d = textureLoad(fluidRaw, vec2<i32>(fc.xy), 0).x;
  if (d > 1e8) { return vec4<f32>(1e9, 0.0, 0.0, 1.0); }
  let vp = viewPos(fc.xy, d);
  let dist = length(vp);
  let rd = normalize(transpose(viewTurn()) * vp);
  let b = throughBody(F.eye.xyz + rd * dist, rd);
  return vec4<f32>(dist + b.last + F.liqMin.w, 0.0, 0.0, 1.0);
}
`;

export const FIELD_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var fluidRaw: texture_2d<f32>;
@group(0) @binding(2) var field: texture_3d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn fieldAt(p: vec3<f32>) -> f32 {
  let uvw = (p - F.liqMin.xyz) / (F.liqMax.xyz - F.liqMin.xyz);
  if (any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0))) { return 1.0; }
  return textureSampleLevel(field, linSamp, uvw, 0.0).x;
}
struct FieldOut { @location(0) depth: vec4<f32>, @location(1) thick: vec4<f32> };
fn noWater() -> FieldOut { var o: FieldOut; o.depth = vec4<f32>(1e9, 0.0, 0.0, 1.0); o.thick = vec4<f32>(0.0); return o; }
@fragment fn fsField(@builtin(position) fc: vec4<f32>) -> FieldOut {
  let d = textureLoad(fluidRaw, vec2<i32>(fc.xy), 0).x;
  if (d > 1e8) { return noWater(); }
  let vp = viewPos(fc.xy, d);
  let dist = length(vp);
  let rd = normalize(transpose(viewTurn()) * vp);
  let h = F.liqMax.w;
  var a = max(dist - 3.0 * h, 0.0);
  var hit = -1.0;
  if (fieldAt(F.eye.xyz + rd * a) < 0.0) { hit = a; }
  var fa = fieldAt(F.eye.xyz + rd * a);
  for (var i = 0; i < 64 && hit < 0.0; i = i + 1) {
    let b = a + clamp(fa * 0.8, 0.5 * h, 4.0 * h);
    let fb = fieldAt(F.eye.xyz + rd * b);
    if (fb < 0.0) {
      var lo = a;
      var hi = b;
      for (var k = 0; k < 6; k = k + 1) {
        let m = 0.5 * (lo + hi);
        if (fieldAt(F.eye.xyz + rd * m) < 0.0) { hi = m; } else { lo = m; }
      }
      hit = hi;
      break;
    }
    if (fb > 0.99) { break; }
    a = b;
    fa = fb;
  }
  if (hit < 0.0) { return noWater(); }
  var t = hit;
  for (var i = 0; i < 96; i = i + 1) {
    let n = t + h;
    if (fieldAt(F.eye.xyz + rd * n) >= 0.0) { break; }
    t = n;
  }
  var o: FieldOut;
  o.depth = vec4<f32>(d * hit / dist, 0.0, 0.0, 1.0);
  o.thick = vec4<f32>(t - hit + 0.5 * h, 0.0, 0.0, 1.0);
  return o;
}
`;

export const BLUR_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> dir: vec4<f32>;
@group(0) @binding(2) var src: texture_2d<f32>;

@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsBlur(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let px = vec2<i32>(fc.xy);
  let size = vec2<i32>(F.screen.xy) - vec2<i32>(1);
  let d0 = textureLoad(src, px, 0).x;
  if (d0 > 1e8) { return vec4<f32>(d0, 0.0, 0.0, 1.0); }
  let rPix = F.liquid.y * F.proj[1][1] * 0.5 * F.screen.y / d0;
  let radius = i32(clamp(rPix * select(2.5, F.liquid.w, F.liquid.x > 2.5), 1.0, 16.0));
  let sigma = max(f32(radius) * 0.5, 0.5);
  let falloff = F.liquid.y * 4.0;
  let along = vec2<i32>(dir.xy);
  var sum = 0.0;
  var wsum = 0.0;
  for (var i = -16; i <= 16; i = i + 1) {
    if (abs(i) > radius) { continue; }
    let d = textureLoad(src, clamp(px + along * i, vec2<i32>(0), size), 0).x;
    if (d > 1e8) { continue; }
    let fi = f32(i);
    let dd = (d - d0) / falloff;
    let w = exp(-fi * fi / (2.0 * sigma * sigma)) * exp(-dd * dd);
    sum = sum + d * w;
    wsum = wsum + w;
  }
  return vec4<f32>(sum / max(wsum, 1e-6), 0.0, 0.0, 1.0);
}
`;


export const COMPOSITE_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var sceneColor: texture_2d<f32>;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@group(0) @binding(3) var fluidDepth: texture_2d<f32>;
@group(0) @binding(4) var thick: texture_2d<f32>;
@group(0) @binding(5) var smokeDye: texture_3d<f32>;
@group(0) @binding(6) var smokeLight: texture_3d<f32>;
@group(0) @binding(7) var linSamp: sampler;
@group(0) @binding(8) var shadowMap: texture_depth_2d;
@group(0) @binding(9) var shadowSamp: sampler_comparison;
@group(0) @binding(10) var bgTex: texture_2d<f32>;
@group(0) @binding(11) var bgSamp: sampler;
@group(0) @binding(12) var smokeSky: texture_3d<f32>;
@group(0) @binding(13) var liquidLook: texture_3d<f32>;
@group(0) @binding(14) var bodyFar: texture_2d<f32>;
@group(0) @binding(15) var fieldThick: texture_2d<f32>;
@group(0) @binding(16) var localShadow: texture_depth_2d_array;
@group(0) @binding(17) var smokeLocal: texture_3d<f32>;
const FIELD_DEPTH = 1.4;
` + SKY_WGSL + LIGHTING_WGSL + LIQUID_WGSL +  `
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}

fn vpAt(q: vec2<i32>) -> vec4<f32> {
  let qc = clamp(q, vec2<i32>(0), vec2<i32>(F.screen.xy) - vec2<i32>(1));
  let d = textureLoad(fluidDepth, qc, 0).x;
  if (d > 1e8) { return vec4<f32>(0.0); }
  return vec4<f32>(viewPos(vec2<f32>(qc) + 0.5, d), 1.0);
}

fn hg(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 0.5 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}

struct SmokeSeen { light: vec3<f32>, through: vec3<f32> };
fn marchSmoke(ro: vec3<f32>, rd: vec3<f32>, tMax: f32, fc: vec2<f32>) -> SmokeSeen {
  let bmin = F.smokeMin.xyz;
  let bmax = F.smokeMax.xyz;
  let hit = boxHit(ro, rd, bmin, bmax);
  let t0 = max(hit.x, 0.0);
  let t1 = min(hit.y, tMax);
  if (t1 <= t0) { return SmokeSeen(vec3<f32>(0.0), vec3<f32>(1.0)); }
  let stepLen = F.smokeDims.w * 0.8;
  let jit = fract(hash21(fc) + F.eye.w * 7.31);
  let size = bmax - bmin;
  var s0 = t0;
  var s1 = t0 + stepLen * max(jit, 0.05);
  var dA = textureSampleLevel(smokeDye, linSamp, (ro + rd * s0 - bmin) / size, 0.0);
  let absorb = F.smokeMax.w;
  let phK = hg(dot(rd, F.keyDir.xyz), 0.35);
  let phF = hg(dot(rd, F.fillDir.xyz), 0.35);
  let phR = hg(dot(rd, F.rimDir.xyz), 0.35);
  let bounce = F.ground.rgb * F.keyCol.rgb * max(F.keyDir.y, 0.0) * 0.35;
  let amb = (F.ambSky.rgb * 0.6 + F.ambGround.rgb * 0.4) * F.ambSky.w + bounce;
  var T = vec3<f32>(1.0);
  var L = vec3<f32>(0.0);
  for (var i = 0; i < 400; i = i + 1) {
    if (s0 >= t1 || max(T.r, max(T.g, T.b)) < 0.01) { break; }
    let sEnd = min(s1, t1);
    let len = sEnd - s0;
    let dB = textureSampleLevel(smokeDye, linSamp, (ro + rd * sEnd - bmin) / size, 0.0);
    let d = (dA + dB) * 0.5;
    dA = dB;
    let p = ro + rd * (s0 + sEnd) * 0.5;
    let uvw = (p - bmin) / size;
    if (d.a + min(d.r, min(d.g, d.b)) > 0.002) {
      let stop = vec3<f32>(d.a) + d.rgb;
      let albedo = d.a / max(stop, vec3<f32>(1e-6));
      let lt = textureSampleLevel(smokeLight, linSamp, uvw, 0.0);
      let sky = textureSampleLevel(smokeSky, linSamp, uvw, 0.0).rgb;
      let rim = pow(vec3<f32>(lt.a), stop / max(d.a, 1e-6));
      var shK = 1.0;
      if (F.keyCol.w > 0.5) {
        let lp = F.shadowVP * vec4<f32>(p, 1.0);
        let suv = vec2<f32>(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
        if (all(suv > vec2<f32>(0.0)) && all(suv < vec2<f32>(1.0))) {
          shK = textureSampleCompareLevel(shadowMap, shadowSamp, suv, lp.z - 0.003);
        }
      }
      var lightIn = F.keyCol.rgb * lt.rgb * (shK * phK)
                  + F.rimCol.rgb * rim * phR
                  + F.fillCol.rgb * phF * (0.35 + 0.65 * sky)
                  + amb * (0.4 + 0.6 * sky);
      let nl = i32(F.lightN.x);
      if (nl > 0) {
        let through = textureSampleLevel(smokeLocal, linSamp, uvw, 0.0);
        for (var li = 0; li < nl; li = li + 1) {
          let PL = F.lights[li];
          let l = normalize(PL.pos.xyz - p);
          var t = 1.0;
          if (li < 4) { t = through[li]; }
          let k = lightReach(PL, p, PL.pos.xyz, l) * t * localShadowAt(PL, p, vec3<f32>(0.0), 1);
          lightIn = lightIn + PL.col.rgb * k * hg(dot(rd, l), 0.35);
        }
      }
      let a = exp(-stop * absorb * len);
      L = L + T * albedo * lightIn * (vec3<f32>(1.0) - a);
      T = T * a;
    }
    s0 = sEnd;
    s1 = sEnd + stepLen;
  }
  return SmokeSeen(L, T);
}

fn waterBehind(start: vec3<f32>, rd: vec3<f32>, travelled: f32, tScene: f32, behind: vec3<f32>, k: f32, murk: f32) -> vec3<f32> {
  let cell = F.liqMin.w;
  let span = boxHit(start, rd, F.liqMin.xyz, F.liqMax.xyz);
  if (span.y <= max(span.x, 0.0)) { return behind; }
  var t = max(span.x, 0.0);
  var hit = false;
  for (var i = 0; i < 160; i = i + 1) {
    if (travelled + t > tScene || t >= span.y) { break; }
    let s = liquidAt(start + rd * t);
    if (s.a > 0.02) { hit = true; break; }
    t = t + cell;
  }
  if (!hit) { return behind; }
  let p = start + rd * t;
  let h = cell;
  let grad = vec3<f32>(liquidAt(p + vec3<f32>(h, 0.0, 0.0)).a - liquidAt(p - vec3<f32>(h, 0.0, 0.0)).a,
                       liquidAt(p + vec3<f32>(0.0, h, 0.0)).a - liquidAt(p - vec3<f32>(0.0, h, 0.0)).a,
                       liquidAt(p + vec3<f32>(0.0, 0.0, h)).a - liquidAt(p - vec3<f32>(0.0, 0.0, h)).a);
  var n = vec3<f32>(0.0, 1.0, 0.0);
  if (length(grad) > 1e-4) { n = -normalize(grad); }
  if (dot(n, rd) > 0.0) { n = -n; }
  let b = throughBody(p, refract(rd, n, 1.0 / 1.33));
  if (b.depth < 1e-5) { return behind; }
  let dye = b.dye / b.depth;
  let depthM = b.depth * 1.25;
  let base = exp(-dye);
  let seen = behind * exp(-dye * depthM * k * 0.72 - depthM * 0.15);
  let opacity = 1.0 - exp(-depthM * 60.0 * murk * murk * murk);
  let body = mix(seen, shade(p, n, base, 0.0, 0.6, 1), opacity);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  return body * (1.0 - fres) + skyColor(reflect(rd, n)) * fres;
}

fn liquidSurface(px: vec2<i32>, fc: vec2<f32>, vp: vec3<f32>, rd: vec3<f32>, tScene: f32) -> vec3<f32> {
  let r = vpAt(px + vec2<i32>(1, 0));
  let l = vpAt(px - vec2<i32>(1, 0));
  let u = vpAt(px + vec2<i32>(0, 1));
  let b = vpAt(px - vec2<i32>(0, 1));
  var ddx = vec3<f32>(1.0, 0.0, 0.0);
  if (r.w > 0.5 && (l.w < 0.5 || abs(r.z - vp.z) < abs(vp.z - l.z))) { ddx = r.xyz - vp; }
  else if (l.w > 0.5) { ddx = vp - l.xyz; }
  var ddy = vec3<f32>(0.0, -1.0, 0.0);
  if (u.w > 0.5 && (b.w < 0.5 || abs(u.z - vp.z) < abs(vp.z - b.z))) { ddy = u.xyz - vp; }
  else if (b.w > 0.5) { ddy = vp - b.xyz; }
  var nv = normalize(cross(ddx, ddy));
  if (dot(nv, -vp) < 0.0) { nv = -nv; }
  let nw = normalize(transpose(viewTurn()) * nv);
  let wp = F.eye.xyz + rd * length(vp);
  let v = -rd;

  let uv = fc * F.screen.zw;
  let th = textureSampleLevel(thick, linSamp, uv, 0.0);
  var depthM = th.a * 0.3;
  if (F.liquid.x > 2.5) { depthM = textureLoad(fieldThick, px, 0).x * FIELD_DEPTH; }
  let dye = th.rgb / max(th.a, 1e-5);
  let base = exp(-dye);
  let clarity = F.liquid.z;

  let ndv = max(dot(nw, v), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  let bend = nv.xy * vec2<f32>(1.0, -1.0) * 0.04 * clamp(depthM * 5.0, 0.0, 1.0);
  let k = mix(30.0, 1.5, clarity);
  let murk = 1.0 - clarity;
  var behind = textureSampleLevel(sceneColor, linSamp, uv - bend, 0.0).rgb;
  let far = textureLoad(bodyFar, px, 0).x;
  if (far < 1e8) { behind = waterBehind(F.eye.xyz + rd * far, rd, far, tScene, behind, k, murk); }
  let trans = exp(-dye * depthM * k * 0.72 - depthM * 0.15);
  let seen = behind * trans;
  let lit = shade(wp, nw, base, 0.0, 0.6, 4);
  let opacity = 1.0 - exp(-depthM * 60.0 * murk * murk * murk);
  let body = mix(seen + lit * 0.08 * clarity, lit, opacity);

  let refl = skyColor(reflect(rd, nw));
  var spec = vec3<f32>(0.0);
  let sh = shadowAt(wp, nw, 4);
  spec = spec + F.keyCol.rgb * pow(max(dot(nw, normalize(F.keyDir.xyz + v)), 0.0), 500.0) * 6.0 * sh;
  spec = spec + F.fillCol.rgb * pow(max(dot(nw, normalize(F.fillDir.xyz + v)), 0.0), 300.0) * 3.0;
  spec = spec + F.rimCol.rgb * pow(max(dot(nw, normalize(F.rimDir.xyz + v)), 0.0), 300.0) * 4.0;
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) { spec = spec + placedGlint(F.lights[i], wp, nw, v) * localShadowAt(F.lights[i], wp, nw, 1); }
  return body * (1.0 - fres) + refl * fres + spec;
}

fn rain(uv: vec2<f32>, c: vec3<f32>) -> vec3<f32> {
  let t = F.eye.w;
  let amount = F.env.z;
  let side = dot(F.wind.xyz, transpose(viewTurn())[0]);
  let lean = clamp(0.6 + side * 0.12, -1.5, 2.5);
  var r = 0.0;
  for (var k = 0; k < 3; k = k + 1) {
    let fk = f32(k);
    var q = vec2<f32>(uv.x * F.screen.x * F.screen.w, uv.y) * vec2<f32>(70.0 + fk * 50.0, 5.0 + fk * 2.5);
    q.x = q.x + q.y * lean;
    q.y = q.y - t * (7.0 + fk * 3.0);
    let cid = floor(q.x);
    let h = hash11(cid * 1.31 + fk * 7.0);
    let fx = fract(q.x) - 0.5;
    let fy = fract(q.y + h * 13.7);
    let streak = smoothstep(0.08, 0.0, abs(fx)) * smoothstep(0.0, 0.04, fy) * smoothstep(0.45, 0.06, fy) * step(1.0 - 0.5 * amount, h);
    r = r + streak * (0.7 - fk * 0.2);
  }
  return c * (1.0 - 0.03 * amount) + vec3<f32>(0.62, 0.67, 0.74) * r * 0.20;
}

@fragment fn fsComposite(@builtin(position) fc4: vec4<f32>) -> @location(0) vec4<f32> {
  let fc = fc4.xy;
  let px = vec2<i32>(fc);
  let uv = fc * F.screen.zw;
  let ndc = ndcOf(fc);
  let far = F.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let rd = normalize(far.xyz / far.w - F.eye.xyz);
  let zs = textureLoad(sceneDepth, px, 0);
  var tScene = 1e9;
  if (zs < 1.0) {
    let w = F.invViewProj * vec4<f32>(ndc, zs, 1.0);
    tScene = length(w.xyz / w.w - F.eye.xyz);
  }
  var col = textureSampleLevel(sceneColor, linSamp, uv, 0.0).rgb;
  var tMax = tScene;
  if (F.liquid.x > 1.5) {
    let ld = textureLoad(fluidDepth, px, 0).x;
    if (ld < 1e8) {
      let vp = viewPos(fc, ld);
      let dist = length(vp);
      if (dist < tScene + 0.02) {
        col = liquidSurface(px, fc, vp, rd, tScene);
        tMax = dist;
      }
    }
  }
  if (F.smokeMin.w > 0.5) {
    let s = marchSmoke(F.eye.xyz, rd, tMax, fc);
    col = col * s.through + s.light;
  }
  if (F.env.z > 0.0) { col = rain(uv, col); }
  col = aces(col * F.env.y);
  col = pow(col, vec3<f32>(1.0 / 2.2)) + (hash21(fc) - 0.5) / 255.0;
  return vec4<f32>(col, 1.0);
}
`;
