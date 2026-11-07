import { SHAPES_WGSL } from './sdf.wgsl.js';

export const MAX_LIGHTS = 8, LIGHT_LAYERS = 24, LIGHT_SHADOW_SIZE = 2048, LIGHT_NEAR = 0.05;
export const LIGHT_FLOATS = 24;
export const FRAME_FLOATS = 192 + 24 + MAX_LIGHTS * LIGHT_FLOATS + LIGHT_LAYERS * 16;

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
  shadowSpan: vec4<f32>,
  fieldMin: vec4<f32>,
  fieldMax: vec4<f32>,
  waterMore: vec4<f32>,
  causticBox: vec4<f32>,
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

const GLASS_DENSITY = 8.0;
const GLASS_BEND = 0.4;
const GLASS_PANE = 0.1;
const GLASS_FROST = 10.0;
const GLASS_FROST_TAKES = 0.25;
fn glassStops(c: vec3<f32>) -> vec3<f32> {
  return -log(clamp(c, vec3<f32>(0.02), vec3<f32>(1.0))) * GLASS_DENSITY + vec3<f32>(0.03);
}
fn glassMirror(cosA: f32) -> f32 {
  return 0.04 + 0.96 * pow(1.0 - clamp(cosA, 0.0, 1.0), 5.0);
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
const LIGHT_NEAR_M = ${LIGHT_NEAR};
var<private> POISSON: array<vec2<f32>, 12> = array<vec2<f32>, 12>(
  vec2<f32>(-0.326, -0.406), vec2<f32>(-0.840, -0.074), vec2<f32>(-0.696, 0.457), vec2<f32>(-0.203, 0.621),
  vec2<f32>(0.962, -0.195), vec2<f32>(0.473, -0.480), vec2<f32>(0.519, 0.767), vec2<f32>(0.185, -0.893),
  vec2<f32>(0.507, 0.064), vec2<f32>(0.896, 0.412), vec2<f32>(-0.322, -0.933), vec2<f32>(-0.792, -0.598));

const SHADOW_SEARCH = 10;
const SHADOW_TAPS = 20;
fn spiral(i: i32, n: i32, turn: f32) -> vec2<f32> {
  let a = f32(i) * 2.39996323 + turn;
  return vec2<f32>(cos(a), sin(a)) * sqrt((f32(i) + 0.5) / f32(n));
}
fn pixelTurn(wp: vec3<f32>) -> f32 {
  let c = F.viewProj * vec4<f32>(wp, 1.0);
  let q = floor((c.xy / max(c.w, 1e-4) * 0.5 + 0.5) * F.screen.xy);
  return fract(52.9829189 * fract(dot(q, vec2<f32>(0.06711056, 0.00583715)))) * 6.2831853;
}
fn planeSlope(proj: mat4x4<f32>, wp: vec3<f32>, n: vec3<f32>, z: f32, uv: vec2<f32>) -> vec2<f32> {
  var a = cross(n, vec3<f32>(0.0, 1.0, 0.0));
  if (dot(a, a) < 1e-4) { a = cross(n, vec3<f32>(1.0, 0.0, 0.0)); }
  a = normalize(a) * 0.02;
  let b = normalize(cross(n, a)) * 0.02;
  let pa = proj * vec4<f32>(wp + a, 1.0);
  let pb = proj * vec4<f32>(wp + b, 1.0);
  let qa = pa.xyz / pa.w;
  let qb = pb.xyz / pb.w;
  let ua = vec2<f32>(qa.x * 0.5 + 0.5, 0.5 - qa.y * 0.5) - uv;
  let ub = vec2<f32>(qb.x * 0.5 + 0.5, 0.5 - qb.y * 0.5) - uv;
  let det = ua.x * ub.y - ua.y * ub.x;
  if (abs(det) < 1e-9) { return vec2<f32>(0.0); }
  let za = qa.z - z;
  let zb = qb.z - z;
  return vec2<f32>(za * ub.y - zb * ua.y, zb * ua.x - za * ub.x) / det;
}

fn shadowAt(wp: vec3<f32>, n: vec3<f32>, taps: i32) -> f32 {
  if (F.keyCol.w < 0.5) { return 1.0; }
  let lp = F.shadowVP * vec4<f32>(wp + n * 0.02, 1.0);
  let uv = vec2<f32>(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || lp.z > 1.0) { return 1.0; }
  let bias = 0.0012;
  if (taps <= 1) { return textureSampleCompareLevel(shadowMap, shadowSamp, uv, lp.z - bias); }
  let size = 2048.0;
  let perDepth = F.keyDir.w * 0.012 * 69.0 / F.shadowSpan.x;
  let slope = planeSlope(F.shadowVP, wp + n * 0.02, n, lp.z, uv);
  let turn = pixelTurn(wp);
  let search = clamp(F.keyDir.w * 6.0 / size, 2.0 / size, 40.0 / size);
  var far = 0.0;
  var count = 0.0;
  let px = vec2<f32>(size) * uv;
  for (var i = 0; i < SHADOW_SEARCH; i = i + 1) {
    let o = spiral(i, SHADOW_SEARCH, turn) * search;
    let d = textureLoad(shadowMap, clamp(vec2<i32>(px + o * size), vec2<i32>(0), vec2<i32>(2047)), 0);
    let z = lp.z + clamp(dot(slope, o), -0.02, 0.02) - bias;
    if (d < z) { far = far + (z - d); count = count + 1.0; }
  }
  if (count < 0.5) { return 1.0; }
  let r = clamp((far / count) * perDepth, 1.0 / size, 40.0 / size);
  var s = 0.0;
  for (var i = 0; i < SHADOW_TAPS; i = i + 1) {
    let o = spiral(i, SHADOW_TAPS, turn) * r;
    let z = lp.z + clamp(dot(slope, o), -0.02, 0.02) - bias;
    s = s + textureSampleCompareLevel(shadowMap, shadowSamp, uv + o, z);
  }
  return s / f32(SHADOW_TAPS);
}

fn smokeShadow(wp: vec3<f32>) -> vec3<f32> {
  if (F.smokeMin.w < 0.5) { return vec3<f32>(1.0); }
  let h = boxHit(wp, F.keyDir.xyz, F.smokeMin.xyz, F.smokeMax.xyz);
  if (h.x > h.y || h.y < 0.0) { return vec3<f32>(1.0); }
  let e = wp + F.keyDir.xyz * max(h.x, 0.0);
  let uvw = (e - F.smokeMin.xyz) / (F.smokeMax.xyz - F.smokeMin.xyz);
  let T = textureSampleLevel(smokeLight, linSamp, uvw, 0.0).rgb;
  return shadeOfSmoke(T);
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
  if (taps <= 1) { return textureSampleCompareLevel(localShadow, shadowSamp, uv, layer, p.z - bias); }
  let size = f32(textureDimensions(localShadow).x);
  let radius = sqrt(max(L.right.w, 0.005) * max(select(L.right.w, L.up.w, u32(L.pos.w + 0.5) == 1u), 0.005));
  let toUv = 1.0 / (L.sh.w * ${LIGHT_SHADOW_SIZE}.0 * lp.w);
  let search = clamp(radius * toUv, 1.5 / size, 60.0 / size);
  let slope = planeSlope(F.lightVP[layer], wp + n * min(slack, 0.08), n, p.z, uv);
  let turn = pixelTurn(wp);
  let px = vec2<f32>(size) * uv;
  var near = 0.0;
  var count = 0.0;
  for (var i = 0; i < SHADOW_SEARCH; i = i + 1) {
    let o = spiral(i, SHADOW_SEARCH, turn) * search;
    let d = textureLoad(localShadow, clamp(vec2<i32>(px + o * size), vec2<i32>(0), vec2<i32>(i32(size) - 1)), layer, 0);
    let z = p.z + clamp(dot(slope, o), -0.002, 0.002) - bias;
    if (d < z) { near = near + LIGHT_NEAR_M / max(1.0 - d, 1e-5); count = count + 1.0; }
  }
  if (count < 0.5) { return 1.0; }
  let block = near / count;
  let r = clamp(radius * max(lp.w - block, 0.0) / max(block, 1e-3) * toUv, 1.0 / size, 60.0 / size);
  var s = 0.0;
  for (var i = 0; i < SHADOW_TAPS; i = i + 1) {
    let o = spiral(i, SHADOW_TAPS, turn) * r;
    let z = p.z + clamp(dot(slope, o), -0.002, 0.002) - bias;
    s = s + textureSampleCompareLevel(localShadow, shadowSamp, uv + o, layer, z);
  }
  return s / f32(SHADOW_TAPS);
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

fn placedLight(li: i32, L: Light, wp: vec3<f32>, n: vec3<f32>, v: vec3<f32>, albedo: vec3<f32>, spec: f32, rough: f32, taps: i32) -> vec3<f32> {
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
  if (max(c.r, max(c.g, c.b)) > 1e-5) {
    c = c * smokeOnPlaced(li, L, wp);
    if (L.sh.x > -0.5) { c = c * localShadowAt(L, wp, n, taps) * clearLocal(L, wp); }
  }
  return c;
}

fn mirrorOfLight(L: Light, wp: vec3<f32>, r: vec3<f32>, soft: f32) -> vec3<f32> {
  let kind = u32(L.pos.w + 0.5);
  let to = L.pos.xyz - wp;
  if (kind == 1u) {
    let den = dot(r, L.dir.xyz);
    if (den > -1e-3) { return vec3<f32>(0.0); }
    let t = dot(to, L.dir.xyz) / den;
    if (t <= 0.0) { return vec3<f32>(0.0); }
    let h = wp + r * t - L.pos.xyz;
    let e = soft * t + 1e-3;
    let m = (1.0 - smoothstep(L.right.w - e, L.right.w + e, abs(dot(h, L.right.xyz)))) * (1.0 - smoothstep(L.up.w - e, L.up.w + e, abs(dot(h, L.up.xyz))));
    return L.col.rgb * m * PI / (4.0 * (L.right.w + e) * (L.up.w + e));
  }
  let along = dot(to, r);
  if (along <= 0.0) { return vec3<f32>(0.0); }
  let radius = max(L.right.w, 0.02);
  let e = soft * along + 1e-3;
  let off = sqrt(max(dot(to, to) - along * along, 0.0));
  var c = L.col.rgb * (1.0 - smoothstep(max(radius - e, 0.0), radius + e, off)) / ((radius + e) * (radius + e));
  if (kind == 3u) { c = c * smoothstep(L.dir.w, L.col.w, dot(-r, L.dir.xyz)); }
  return c;
}
fn placedGlint(L: Light, wp: vec3<f32>, n: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
  var q = L.pos.xyz;
  if (u32(L.pos.w + 0.5) == 1u) { q = faceNearest(L, wp, reflect(-v, n)); }
  let l = normalize(q - wp);
  return L.col.rgb * lightReach(L, wp, q, l) * pow(max(dot(n, normalize(l + v)), 0.0), 400.0) * 4.0;
}

fn shadeOfSmoke(T: vec3<f32>) -> vec3<f32> {
  return T * 0.65 + pow(max(T, vec3<f32>(1e-9)), vec3<f32>(0.25)) * 0.35;
}
struct LocalLight { r: vec4<f32>, g: vec4<f32>, b: vec4<f32> };
fn localThrough(uvw: vec3<f32>) -> LocalLight {
  let hz = ceil(F.smokeDims.z * 0.5);
  let whole = 3.0 * hz + 2.0;
  let z = clamp(uvw.z * hz, 0.5, hz - 0.5);
  return LocalLight(textureSampleLevel(smokeLocal, linSamp, vec3<f32>(uvw.xy, z / whole), 0.0),
                    textureSampleLevel(smokeLocal, linSamp, vec3<f32>(uvw.xy, (z + hz + 1.0) / whole), 0.0),
                    textureSampleLevel(smokeLocal, linSamp, vec3<f32>(uvw.xy, (z + 2.0 * hz + 2.0) / whole), 0.0));
}
fn smokeOnPlaced(li: i32, L: Light, wp: vec3<f32>) -> vec3<f32> {
  if (F.smokeMin.w < 0.5 || li >= 4) { return vec3<f32>(1.0); }
  let l = normalize(L.pos.xyz - wp);
  let h = boxHit(wp, l, F.smokeMin.xyz, F.smokeMax.xyz);
  if (h.x > h.y || h.y < 0.0) { return vec3<f32>(1.0); }
  let t = localThrough((wp + l * max(h.x, 0.0) - F.smokeMin.xyz) / (F.smokeMax.xyz - F.smokeMin.xyz));
  return shadeOfSmoke(vec3<f32>(t.r[li], t.g[li], t.b[li]));
}

var<private> rimK: f32 = 1.0;

fn shade(wp: vec3<f32>, n: vec3<f32>, albedo: vec3<f32>, spec: f32, rough: f32, taps: i32) -> vec3<f32> {
  let v = normalize(F.eye.xyz - wp);
  let contact = mix(0.55, 1.0, clamp(wp.y * 3.0 + 0.2, 0.0, 1.0));
  var c = albedo * ambientAt(n) * contact;
  let sh = shadowAt(wp, n, taps) * smokeShadow(wp) * clearKey(wp);
  c = c + lightOne(F.keyDir.xyz, F.keyCol.rgb, n, v, albedo, spec, rough) * sh;
  c = c + lightOne(F.fillDir.xyz, F.fillCol.rgb, n, v, albedo, spec, rough);
  c = c + lightOne(F.rimDir.xyz, F.rimCol.rgb * rimK, n, v, albedo, spec, rough);
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) { c = c + placedLight(i, F.lights[i], wp, n, v, albedo, spec, rough, min(taps, 6)); }
  return c;
}
`;



export const MATERIAL_WGSL =  `
struct Mat {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  f: vec4<f32>,
  g: vec4<f32>,
  h: vec4<f32>,
  i: vec4<f32>,
};
struct Decal {
  c: vec4<f32>,
  u: vec4<f32>,
  v: vec4<f32>,
  n: vec4<f32>,
  t: vec4<f32>,
  m: vec4<f32>,
  k: vec4<f32>,
  f: vec4<f32>,
};

fn tileOf(q: vec2<f32>, M: Mat) -> vec2<f32> {
  let r = vec2<f32>(M.h.x * q.x + M.h.y * q.y, -M.h.y * q.x + M.h.x * q.y);
  return vec2<f32>(r.x / M.g.x, -r.y / M.g.y);
}
fn faceOf(axis: u32, p: vec3<f32>, s: f32) -> vec2<f32> {
  if (axis == 0u) { return vec2<f32>(-p.z * s, p.y); }
  if (axis == 1u) { return vec2<f32>(p.x, -p.z * s); }
  return vec2<f32>(p.x * s, p.y);
}
fn wrapOf(uv: vec2<f32>, mode: u32) -> vec2<f32> {
  if (mode == 1u) { return vec2<f32>(1.0) - abs(vec2<f32>(1.0) - (uv - 2.0 * floor(uv * 0.5))); }
  return uv;
}
fn dispAt(M: Mat, lp: vec3<f32>, ln: vec3<f32>, muv: vec2<f32>, R: f32) -> f32 {
  if (M.f.z < 0.0) { return 0.0; }
  let kind = u32(M.f.w + 0.5);
  var uv: vec2<f32>;
  if (kind == 0u) {
    let a = abs(ln);
    if (a.y >= a.x && a.y >= a.z) { uv = tileOf(faceOf(1u, lp, select(-1.0, 1.0, ln.y >= 0.0)) - M.g.zw, M); }
    else if (a.z >= a.x) { uv = tileOf(faceOf(2u, lp, select(-1.0, 1.0, ln.z >= 0.0)) - M.g.zw, M); }
    else { uv = tileOf(faceOf(0u, lp, select(-1.0, 1.0, ln.x >= 0.0)) - M.g.zw, M); }
  } else if (kind == 1u) { uv = tileOf(faceOf(u32(M.h.w + 0.5), lp, 1.0) - M.g.zw, M); }
  else if (kind == 4u) { uv = mat2x2<f32>(M.h.x, -M.h.y, M.h.y, M.h.x) * (muv - vec2<f32>(0.5) - M.g.zw) / M.g.xy; }
  else if (kind == 2u) { uv = tileOf(vec2<f32>(atan2(lp.x, lp.z) * R, lp.y) - M.g.zw, M); }
  else { uv = tileOf(vec2<f32>(atan2(lp.x, lp.z), atan2(lp.y, length(lp.xz))) * R - M.g.zw, M); }
  uv = uv + vec2<f32>(0.5);
  let wrap = u32(M.h.z + 0.5);
  if (wrap == 2u && (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)))) { return 0.0; }
  return textureSampleLevel(texArr, texSamp, wrapOf(uv, wrap), i32(M.f.z), 0.0).r * M.i.z;
}
`;

export const MAX_DRAW = 1024;
const SCENE_BINDINGS =  `
const GROUND_MAT = ${MAX_DRAW}u;
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
@group(0) @binding(12) var clearLight: texture_2d_array<f32>;
@group(0) @binding(13) var<storage, read> MAT: array<Mat>;
@group(0) @binding(14) var<storage, read> DEC: array<Decal>;
@group(0) @binding(15) var texArr: texture_2d_array<f32>;
@group(0) @binding(16) var texArrC: texture_2d_array<f32>;
@group(0) @binding(17) var texSamp: sampler;
@group(0) @binding(18) var envTex: texture_2d<f32>;
@group(0) @binding(19) var envSamp: sampler;
@group(0) @binding(20) var smokeLocal: texture_3d<f32>;
@group(0) @binding(21) var causticTex: texture_2d<f32>;
@group(1) @binding(0) var opaqueDepth: texture_depth_2d;
@group(1) @binding(1) var glassFirst: texture_2d<f32>;
`;

export const SCENE_SHADER = FRAME_WGSL + MATERIAL_WGSL + SCENE_BINDINGS + SKY_WGSL + LIGHTING_WGSL +  `
fn clearNear(layer: i32, uv: vec2<f32>) -> f32 {
  let a = textureGather(3, clearLight, linSamp, uv, layer);
  return min(a.x, min(a.y, min(a.z, a.w)));
}
fn clearThrough(layer: i32, uv: vec2<f32>, along: f32, search: f32, spread: f32, wp: vec3<f32>) -> vec3<f32> {
  let turn = pixelTurn(wp);
  var near = 0.0;
  var count = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    let a = clearNear(layer, uv + spiral(i, 8, turn) * search);
    if (along > a + 0.03) { near = near + a; count = count + 1.0; }
  }
  if (count < 0.5) { return vec3<f32>(1.0); }
  let block = near / count;
  let r = clamp(spread * max(along - block, 0.0) / max(block, 1e-3), 1.0 / 1024.0, search * 1.5);
  var t = vec3<f32>(0.0);
  for (var i = 0; i < 24; i = i + 1) {
    let q = uv + spiral(i, 24, turn) * r;
    let g = textureSampleLevel(clearLight, linSamp, q, layer, 0.0);
    t = t + select(vec3<f32>(1.0), exp(-max(g.rgb, vec3<f32>(0.0))), along > clearNear(layer, q) + 0.03);
  }
  return t / 24.0;
}
fn causticAt(layer: i32, uv: vec2<f32>, along: f32, spread: f32, wp: vec3<f32>) -> f32 {
  let q = (uv - F.causticBox.xy) / F.causticBox.zw;
  if (any(q < vec2<f32>(0.0)) || any(q > vec2<f32>(1.0))) { return 1.0; }
  let near = clearNear(layer, uv);
  if (near < 5e4 && along < near - 0.03) { return 1.0; }
  let under = select(0.02, max(along - near, 0.0), near < 5e4);
  let r = spread * under / max(along, 0.05) / max(F.causticBox.z, 1e-4);
  let turn = pixelTurn(wp);
  var sum = 0.0;
  for (var i = 0; i < 6; i = i + 1) {
    let g = textureSampleLevel(causticTex, linSamp, q + spiral(i, 6, turn) * r, 0.0);
    var m = 1.0 - g.g + g.r;
    if (m > 2.0) { m = 2.0 + (m - 2.0) / (1.0 + (m - 2.0) * 0.5); }
    sum = sum + max(m, 0.2);
  }
  return mix(1.0, sum / 6.0, F.waterMore.y);
}
fn clearKey(wp: vec3<f32>) -> vec3<f32> {
  if (F.lightN.z < 0.5 || F.keyCol.w < 0.5) { return vec3<f32>(1.0); }
  let lp = F.shadowVP * vec4<f32>(wp, 1.0);
  let uv = vec2<f32>(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) { return vec3<f32>(1.0); }
  let r = max(F.keyDir.w, 1.0) * 2.0 / 1024.0;
  let along = -dot(wp, F.keyDir.xyz);
  var t = clearThrough(0, uv, along, r, r, wp);
  if (F.waterMore.z < -1.5) { t = t * causticAt(0, uv, along, 0.002, wp); }
  return t;
}
fn clearLocal(L: Light, wp: vec3<f32>) -> vec3<f32> {
  if (F.lightN.z < 0.5) { return vec3<f32>(1.0); }
  let layer = lightLayer(L, wp);
  let lp = F.lightVP[layer] * vec4<f32>(wp, 1.0);
  if (lp.w <= 1e-4) { return vec3<f32>(1.0); }
  let p = lp.xyz / lp.w;
  let uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) { return vec3<f32>(1.0); }
  let radius = sqrt(max(L.right.w, 0.005) * max(select(L.right.w, L.up.w, u32(L.pos.w + 0.5) == 1u), 0.005));
  let away = length(wp - L.pos.xyz);
  let toUv = 1.0 / (L.sh.w * ${LIGHT_SHADOW_SIZE}.0 * lp.w);
  var t = clearThrough(layer + 1, uv, away, clamp(radius * toUv, 1.5 / 1024.0, 60.0 / 1024.0), radius * toUv, wp);
  if (i32(F.waterMore.z) == layer) { t = t * causticAt(layer + 1, uv, away, radius * toUv * lp.w, wp); }
  return t;
}

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

fn groundAlbedo(wp: vec3<f32>) -> vec3<f32> {
  var albedo = F.ground.rgb * (0.96 + 0.06 * vnoise(wp.xz * 3.0));
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
  return albedo;
}

@fragment fn fsGround(i: GroundOut) -> @location(0) vec4<f32> {
  let wp = i.wp;
  let finish = u32(F.ground.w + 0.5);
  var albedo = groundAlbedo(wp);
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


struct Set { uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32> };
struct Where { a: Set, b: Set, c: Set, w: vec3<f32> };
fn faceSet(axis: u32, s: f32, lp: vec3<f32>, dlx: vec3<f32>, dly: vec3<f32>, M: Mat) -> Set {
  return Set(tileOf(faceOf(axis, lp, s) - M.g.zw, M) + vec2<f32>(0.5), tileOf(faceOf(axis, dlx, s), M), tileOf(faceOf(axis, dly, s), M));
}
fn sideOf(x: f32) -> f32 { return select(-1.0, 1.0, x >= 0.0); }
fn whereOn(M: Mat, lp: vec3<f32>, ln: vec3<f32>, dlx: vec3<f32>, dly: vec3<f32>, muv: vec2<f32>, mdx: vec2<f32>, mdy: vec2<f32>, R: f32) -> Where {
  let kind = u32(M.f.w + 0.5);
  let none = Set(vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0));
  if (kind == 0u) {
    let a = abs(ln);
    var w = a * a;
    w = w * w;
    w = w * w;
    w = w / max(w.x + w.y + w.z, 1e-5);
    let sx = faceSet(0u, sideOf(ln.x), lp, dlx, dly, M);
    let sy = faceSet(1u, sideOf(ln.y), lp, dlx, dly, M);
    let sz = faceSet(2u, sideOf(ln.z), lp, dlx, dly, M);
    if (a.y >= a.x && a.y >= a.z) { return Where(sy, sx, sz, w.yxz); }
    if (a.z >= a.x) { return Where(sz, sx, sy, w.zxy); }
    return Where(sx, sy, sz, w);
  }
  if (kind == 1u) { return Where(faceSet(u32(M.h.w + 0.5), 1.0, lp, dlx, dly, M), none, none, vec3<f32>(1.0, 0.0, 0.0)); }
  if (kind == 4u) {
    let t = vec2<f32>(M.g.x, M.g.y);
    let c = muv - vec2<f32>(0.5) - M.g.zw;
    let turn = mat2x2<f32>(M.h.x, -M.h.y, M.h.y, M.h.x);
    return Where(Set(turn * c / t + vec2<f32>(0.5), turn * mdx / t, turn * mdy / t), none, none, vec3<f32>(1.0, 0.0, 0.0));
  }
  let az = atan2(lp.x, lp.z);
  let r2 = max(lp.x * lp.x + lp.z * lp.z, 1e-8);
  let azx = (lp.z * dlx.x - lp.x * dlx.z) / r2;
  let azy = (lp.z * dly.x - lp.x * dly.z) / r2;
  if (kind == 2u) {
    let q = vec2<f32>(az * R, lp.y) - M.g.zw;
    return Where(Set(tileOf(q, M) + vec2<f32>(0.5), tileOf(vec2<f32>(azx * R, dlx.y), M), tileOf(vec2<f32>(azy * R, dly.y), M)), none, none, vec3<f32>(1.0, 0.0, 0.0));
  }
  let up = atan2(lp.y, sqrt(r2));
  let upx = atan2(lp.y + dlx.y, length((lp + dlx).xz)) - up;
  let upy = atan2(lp.y + dly.y, length((lp + dly).xz)) - up;
  let q = vec2<f32>(az, up) * R - M.g.zw;
  return Where(Set(tileOf(q, M) + vec2<f32>(0.5), tileOf(vec2<f32>(azx, upx) * R, M), tileOf(vec2<f32>(azy, upy) * R, M)), none, none, vec3<f32>(1.0, 0.0, 0.0));
}
fn readSet(tex: texture_2d_array<f32>, layer: f32, S: Set, wrap: u32) -> vec4<f32> {
  if (wrap == 2u && (any(S.uv < vec2<f32>(0.0)) || any(S.uv > vec2<f32>(1.0)))) { return vec4<f32>(0.0); }
  return textureSampleGrad(tex, texSamp, wrapOf(S.uv, wrap), i32(layer), S.dx, S.dy);
}
fn readMap(tex: texture_2d_array<f32>, layer: f32, T: Where, wrap: u32) -> vec4<f32> {
  var s = readSet(tex, layer, T.a, wrap) * T.w.x;
  if (T.w.y > 0.01) { s = s + readSet(tex, layer, T.b, wrap) * T.w.y; }
  if (T.w.z > 0.01) { s = s + readSet(tex, layer, T.c, wrap) * T.w.z; }
  return s;
}
struct Slopes { gu: vec3<f32>, gv: vec3<f32> };
fn slopesOf(N: vec3<f32>, dwx: vec3<f32>, dwy: vec3<f32>, dx: vec2<f32>, dy: vec2<f32>) -> Slopes {
  let p2 = cross(dwy, N);
  let p1 = cross(N, dwx);
  let det = dot(dwx, p2);
  let k = select(1.0 / det, 0.0, abs(det) < 1e-14);
  return Slopes((p2 * dx.x + p1 * dy.x) * k, (p2 * dx.y + p1 * dy.y) * k);
}
fn heightPush(layer: f32, S: Set, wrap: u32, h: f32, G: Slopes) -> vec3<f32> {
  let e = clamp(max(length(S.dx), length(S.dy)), 1.0 / 2048.0, 0.05);
  let l = readSet(texArr, layer, Set(S.uv - vec2<f32>(e, 0.0), S.dx, S.dy), wrap).r;
  let r = readSet(texArr, layer, Set(S.uv + vec2<f32>(e, 0.0), S.dx, S.dy), wrap).r;
  let t = readSet(texArr, layer, Set(S.uv - vec2<f32>(0.0, e), S.dx, S.dy), wrap).r;
  let b = readSet(texArr, layer, Set(S.uv + vec2<f32>(0.0, e), S.dx, S.dy), wrap).r;
  return (G.gu * (r - l) + G.gv * (b - t)) * (h / (2.0 * e));
}
fn applyMaps(S: ptr<function, Surf>, M: Mat, T: Where, dwx: vec3<f32>, dwy: vec3<f32>) -> f32 {
  let wrap = u32(M.h.z + 0.5);
  if (M.e.x >= 0.0) {
    let s = readMap(texArrC, M.e.x, T, wrap);
    if (s.a > 0.002) { (*S).albedo = mix((*S).albedo, s.rgb / s.a, s.a * M.c.x); }
  }
  if (M.e.y >= 0.0) {
    var s = readMap(texArr, M.e.y, T, wrap);
    (*S).rough = mix((*S).rough, (*S).rough * s[u32(M.c.y)], s.a);
  }
  if (M.e.z >= 0.0) {
    var s = readMap(texArr, M.e.z, T, wrap);
    (*S).metal = mix((*S).metal, (*S).metal * s[u32(M.c.z)], s.a);
  }
  var n = (*S).n;
  if (M.f.x >= 0.0 || M.f.y >= 0.0 || M.f.z >= 0.0) {
    let G = slopesOf(n, dwx, dwy, T.a.dx, T.a.dy);
    if (M.f.x >= 0.0) { n = n - heightPush(M.f.x, T.a, wrap, M.i.x, G); }
    if (M.f.z >= 0.0) { n = n - heightPush(M.f.z, T.a, wrap, M.i.z, G); }
    if (M.f.y >= 0.0) {
      let s = readSet(texArr, M.f.y, T.a, wrap);
      if (s.a > 0.5) {
        var ts = s.xyz * 2.0 - vec3<f32>(1.0);
        ts = vec3<f32>(ts.xy * M.i.y, ts.z);
        if (M.i.w > 0.5) { ts.y = -ts.y; }
        let tu = G.gu / max(length(G.gu), 1e-6);
        let tv = -G.gv / max(length(G.gv), 1e-6);
        n = tu * ts.x + tv * ts.y + n * ts.z;
      }
    }
    (*S).n = normalize(n);
  }
  if (M.e.w >= 0.0) {
    var s = readMap(texArr, M.e.w, T, wrap);
    return s[u32(M.d.z)];
  }
  return 1.0;
}
fn applyDecals(S: ptr<function, Surf>, M: Mat, lp: vec3<f32>, ln: vec3<f32>, dlx: vec3<f32>, dly: vec3<f32>, dwx: vec3<f32>, dwy: vec3<f32>) -> f32 {
  var cover = 0.0;
  let first = u32(M.d.x);
  let count = u32(M.d.y);
  for (var j = 0u; j < count; j = j + 1u) {
    let d = DEC[first + j];
    let q = lp - d.c.xyz;
    let wrapped = d.k.w < -1.5;
    let faces = dot(ln, d.n.xyz);
    if (!wrapped && faces < d.k.w) { continue; }
    var x: f32; var y: f32; var xdx: f32; var xdy: f32; var ydx: f32; var ydy: f32;
    var fade = 1.0;
    if (wrapped) {
      if (dot(ln.xz, normalize(lp.xz + vec2<f32>(1e-6))) < 0.0) { continue; }
      var da = atan2(lp.x, lp.z) - d.f.w;
      da = da - 6.2831853 * round(da / 6.2831853);
      let r2 = max(lp.x * lp.x + lp.z * lp.z, 1e-8);
      x = da * d.f.z;
      y = q.y;
      xdx = (lp.z * dlx.x - lp.x * dlx.z) / r2 * d.f.z; xdy = (lp.z * dly.x - lp.x * dly.z) / r2 * d.f.z;
      ydx = dlx.y; ydy = dly.y;
      let c = dot(d.u.xyz, normalize(cross(vec3<f32>(0.0, 1.0, 0.0), d.n.xyz) + vec3<f32>(1e-6)));
      let s = dot(d.u.xyz, vec3<f32>(0.0, 1.0, 0.0));
      let x2 = c * x + s * y; let y2 = -s * x + c * y;
      let xx2 = c * xdx + s * ydx; let yx2 = -s * xdx + c * ydx;
      let xy2 = c * xdy + s * ydy; let yy2 = -s * xdy + c * ydy;
      x = x2; y = y2; xdx = xx2; ydx = yx2; xdy = xy2; ydy = yy2;
    } else {
      let along = dot(q, d.n.xyz);
      if (abs(along) > d.n.w) { continue; }
      fade = smoothstep(d.n.w, d.n.w * 0.8, abs(along)) * smoothstep(d.k.w, d.k.w + 0.15, faces);
      x = dot(q, d.u.xyz); y = dot(q, d.v.xyz);
      xdx = dot(dlx, d.u.xyz); xdy = dot(dly, d.u.xyz);
      ydx = dot(dlx, d.v.xyz); ydy = dot(dly, d.v.xyz);
    }
    var uv = vec2<f32>(x * d.u.w, -y * d.v.w);
    var gx = vec2<f32>(xdx * d.u.w, -ydx * d.v.w);
    var gy = vec2<f32>(xdy * d.u.w, -ydy * d.v.w);
    if (any(abs(uv) > vec2<f32>(0.5))) { continue; }
    if (d.f.x > 0.5) { uv.x = -uv.x; gx.x = -gx.x; gy.x = -gy.x; }
    if (d.f.y > 0.5) { uv.y = -uv.y; gx.y = -gx.y; gy.y = -gy.y; }
    uv = uv + vec2<f32>(0.5);
    let s = textureSampleGrad(texArrC, texSamp, uv, i32(d.c.w), gx, gy);
    var a = s.a * d.t.a * fade;
    if (a <= 0.002) { continue; }
    let col = s.rgb / max(s.a, 0.002);
    let key = u32(d.k.x + 0.5);
    if (key == 1u) { a = a * smoothstep(d.k.y, d.k.y + d.k.z, 1.0 - min(col.r, min(col.g, col.b))); }
    if (key == 2u) { a = a * smoothstep(d.k.y, d.k.y + d.k.z, max(col.r, max(col.g, col.b))); }
    if (a <= 0.002) { continue; }
    let tinted = col * d.t.rgb;
    let blend = u32(d.m.w + 0.5);
    if (blend == 1u) { (*S).albedo = (*S).albedo * mix(vec3<f32>(1.0), tinted, a); }
    else if (blend == 2u) { (*S).glow = (*S).glow + a; (*S).albedo = mix((*S).albedo, tinted, a); }
    else {
      (*S).albedo = mix((*S).albedo, tinted, a);
      if (d.m.x >= 0.0) { (*S).rough = mix((*S).rough, d.m.x, a); (*S).metal = mix((*S).metal, d.m.y, a); }
    }
    if (abs(d.m.z) > 0.0) {
      let G = slopesOf((*S).n, dwx, dwy, gx, gy);
      let e = clamp(max(length(gx), length(gy)), 1.0 / 2048.0, 0.05);
      let lt = textureSampleGrad(texArrC, texSamp, uv - vec2<f32>(e, 0.0), i32(d.c.w), gx, gy);
      let rt = textureSampleGrad(texArrC, texSamp, uv + vec2<f32>(e, 0.0), i32(d.c.w), gx, gy);
      let up = textureSampleGrad(texArrC, texSamp, uv - vec2<f32>(0.0, e), i32(d.c.w), gx, gy);
      let dn = textureSampleGrad(texArrC, texSamp, uv + vec2<f32>(0.0, e), i32(d.c.w), gx, gy);
      let lw = vec4<f32>(0.3, 0.59, 0.11, 0.0);
      let push = (G.gu * (dot(rt, lw) - dot(lt, lw)) + G.gv * (dot(dn, lw) - dot(up, lw))) * (d.m.z / (2.0 * e));
      (*S).n = normalize((*S).n - push * min(a * 2.0, 1.0));
    }
    cover = max(cover, a);
  }
  return cover;
}

struct Surf { albedo: vec3<f32>, metal: f32, rough: f32, f0: f32, coat: f32, glow: f32, n: vec3<f32> };
fn surfOf(M: Mat, base: vec3<f32>, n: vec3<f32>, wp: vec3<f32>) -> Surf {
  var S = Surf(base, M.a.y, M.a.x, M.a.z, M.a.w, M.b.x, n);
  if (M.b.y > 0.0) {
    let gr = vnoise(wp.xz * 140.0 + wp.y * 97.0) * 0.6 + vnoise(wp.zy * 260.0) * 0.4;
    S.albedo = S.albedo * mix(1.0, 0.78 + 0.32 * gr, M.b.y);
  }
  return S;
}
fn lobe(ndh: f32, ndl: f32, ndv: f32, a: f32) -> f32 {
  let a2 = a * a;
  let dd = ndh * ndh * (a2 - 1.0) + 1.0;
  let vis = 0.5 / max(ndl * sqrt(ndv * ndv * (1.0 - a2) + a2) + ndv * sqrt(ndl * ndl * (1.0 - a2) + a2), 1e-5);
  return a2 / max(dd * dd, 1e-8) * vis;
}
fn pbrLight(l: vec3<f32>, col: vec3<f32>, S: Surf, v: vec3<f32>, diffuseToo: bool) -> vec3<f32> {
  let ndl = dot(S.n, l);
  if (ndl <= 0.0) { return vec3<f32>(0.0); }
  let h = normalize(l + v);
  let ndh = max(dot(S.n, h), 0.0);
  let ndv = max(dot(S.n, v), 1e-3);
  let vdh = 1.0 - max(dot(v, h), 0.0);
  let vdh5 = vdh * vdh * vdh * vdh * vdh;
  let f0c = mix(vec3<f32>(S.f0), S.albedo, S.metal);
  let fr = f0c + (vec3<f32>(1.0) - f0c) * vdh5;
  var out = fr * lobe(ndh, ndl, ndv, max(S.rough * S.rough, 0.015));
  if (diffuseToo) { out = out + S.albedo * (1.0 - S.metal); }
  if (S.coat > 0.0) {
    let fc = (0.04 + 0.96 * vdh5) * S.coat;
    out = out * (1.0 - fc) + vec3<f32>(fc * lobe(ndh, ndl, ndv, 0.04));
  }
  return col * ndl * out;
}
fn placedPbr(li: i32, L: Light, wp: vec3<f32>, S: Surf, v: vec3<f32>, taps: i32) -> vec3<f32> {
  var c = vec3<f32>(0.0);
  if (u32(L.pos.w + 0.5) == 1u) {
    for (var a = -1; a <= 1; a = a + 1) {
      for (var b = -1; b <= 1; b = b + 1) {
        let q = L.pos.xyz + L.right.xyz * (L.right.w * f32(a) * 0.667) + L.up.xyz * (L.up.w * f32(b) * 0.667);
        let l = normalize(q - wp);
        let ndl = max(dot(S.n, l), 0.0);
        c = c + S.albedo * (1.0 - S.metal) * L.col.rgb * (lightReach(L, wp, q, l) / 9.0) * ndl;
      }
    }
    let q = faceNearest(L, wp, reflect(-v, S.n));
    let l = normalize(q - wp);
    c = c + pbrLight(l, L.col.rgb * lightReach(L, wp, q, l), S, v, false);
  } else {
    let l = normalize(L.pos.xyz - wp);
    c = pbrLight(l, L.col.rgb * lightReach(L, wp, L.pos.xyz, l), S, v, true);
  }
  if (max(c.r, max(c.g, c.b)) > 1e-5) {
    c = c * smokeOnPlaced(li, L, wp);
    if (L.sh.x > -0.5) { c = c * localShadowAt(L, wp, S.n, taps) * clearLocal(L, wp); }
  }
  return c;
}
fn envAt(d: vec3<f32>, rough: f32) -> vec3<f32> {
  let u = atan2(d.x, -d.z) / (2.0 * PI) + 0.5;
  let w = acos(clamp(d.y, -1.0, 1.0)) / PI;
  return textureSampleLevel(envTex, envSamp, vec2<f32>(u, w), sqrt(rough) * 5.0).rgb;
}
fn envShare(f0: vec3<f32>, rough: f32, ndv: f32) -> vec3<f32> {
  let r = rough * vec4<f32>(-1.0, -0.0275, -0.572, 0.022) + vec4<f32>(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(r.x * r.x, exp(-9.28 * ndv)) * r.x + r.y;
  let ab = vec2<f32>(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + vec3<f32>(ab.y);
}
fn litSurface(wp: vec3<f32>, S: Surf) -> vec3<f32> {
  let v = normalize(F.eye.xyz - wp);
  let n = S.n;
  let ndv = max(dot(n, v), 1e-3);
  let contact = mix(0.55, 1.0, clamp(wp.y * 3.0 + 0.2, 0.0, 1.0));
  let r = reflect(-v, n);
  let f0c = mix(vec3<f32>(S.f0), S.albedo, S.metal);
  let share = envShare(f0c, S.rough, ndv);
  var c = S.albedo * (1.0 - S.metal) * ambientAt(n) * contact * (vec3<f32>(1.0) - share);
  c = c + (envAt(r, S.rough) + ambientAt(r) * 0.5) * share * contact;
  if (S.coat > 0.0) {
    let fc = (0.04 + 0.96 * pow(1.0 - ndv, 5.0)) * S.coat;
    c = c * (1.0 - fc) + envAt(r, 0.04) * fc * contact;
  }
  let sh = shadowAt(wp, n, 12) * smokeShadow(wp) * clearKey(wp);
  c = c + pbrLight(F.keyDir.xyz, F.keyCol.rgb, S, v, true) * sh;
  c = c + pbrLight(F.fillDir.xyz, F.fillCol.rgb, S, v, true);
  c = c + pbrLight(F.rimDir.xyz, F.rimCol.rgb * rimK, S, v, true);
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) { c = c + placedPbr(i, F.lights[i], wp, S, v, 6); }
  return c + S.albedo * S.glow;
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
    let ly = normalize(worldDir(vec3<f32>(0.0, 1.0, 0.0), o));
    let point = flag > 5.5;
    let face = point || dot(n, ly) > 0.6;
    let c = select(vec3<f32>(0.035), o.d.rgb * 3.0 / max(F.env.y, 0.3), face);
    return vec4<f32>(c, 1.0);
  }
  if (flag > 1.5) {
    let v = normalize(F.eye.xyz - i.wp);
    let edge = 1.0 - max(dot(n, v), 0.0);
    let c = o.d.rgb * (0.55 + 0.45 * max(dot(n, F.keyDir.xyz), 0.0)) + o.d.rgb * edge * 0.6;
    return vec4<f32>(c * 1.2 / max(F.env.y, 0.3), 1.0);
  }
  let fin = u32(o.h.w + 0.5);
  if (fin == 3u || fin == 5u) { discard; }
  let S = surfOf(MAT[i.id], o.d.rgb, n, i.wp);
  return vec4<f32>(fogged(litSurface(i.wp, S), i.wp), 1.0);
}


struct ObjTexOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) wp: vec3<f32>,
  @location(1) n: vec3<f32>,
  @location(2) @interpolate(flat) id: u32,
  @location(3) lp: vec3<f32>,
  @location(4) ln: vec3<f32>,
  @location(5) uv: vec2<f32>,
};
@vertex fn vsObjTex(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @builtin(instance_index) id: u32) -> ObjTexOut {
  let o = D[id];
  let lp = p * o.b.xyz;
  let wp = worldOfLocal(lp, o);
  let ln = normalize(nrm / o.b.xyz);
  return ObjTexOut(F.viewProj * vec4<f32>(wp, 1.0), wp, normalize(worldDir(ln, o)), id, lp, ln, vec2<f32>(0.0));
}
@vertex fn vsObjUv(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @location(2) uv: vec2<f32>, @builtin(instance_index) id: u32) -> ObjTexOut {
  let o = D[id];
  let lp = p * o.b.xyz;
  let wp = worldOfLocal(lp, o);
  let ln = normalize(nrm / o.b.xyz);
  return ObjTexOut(F.viewProj * vec4<f32>(wp, 1.0), wp, normalize(worldDir(ln, o)), id, lp, ln, uv);
}
@vertex fn vsObjDisp(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @location(2) puff: vec3<f32>, @location(3) uv: vec2<f32>, @builtin(instance_index) id: u32) -> ObjTexOut {
  let o = D[id];
  let lp = p * o.b.xyz;
  let ln = normalize(nrm / o.b.xyz);
  let wp = worldOfLocal(lp + normalize(puff / o.b.xyz) * dispAt(MAT[id], lp, ln, uv, max(o.b.x, o.b.z)), o);
  return ObjTexOut(F.viewProj * vec4<f32>(wp, 1.0), wp, normalize(worldDir(ln, o)), id, lp, ln, uv);
}
@fragment fn fsObjTex(i: ObjTexOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let dlx = dpdx(i.lp);
  let dly = dpdy(i.lp);
  let duvx = dpdx(i.uv);
  let duvy = dpdy(i.uv);
  let o = D[i.id];
  let M = MAT[i.id];
  var n = normalize(i.n);
  var ln = normalize(i.ln);
  if (!front && dot(n, F.eye.xyz - i.wp) < 0.0) { n = -n; ln = -ln; }
  let dwx = worldDir(dlx, o);
  let dwy = worldDir(dly, o);
  var S = surfOf(M, o.d.rgb, n, i.wp);
  let fin = u32(o.h.w + 0.5);
  let glass = fin == 3u || fin == 5u;
  if (!glass) {
    let T = whereOn(M, i.lp, ln, dlx, dly, i.uv, duvx, duvy, max(o.b.x, o.b.z));
    if (applyMaps(&S, M, T, dwx, dwy) < 0.5) { discard; }
  }
  let cover = applyDecals(&S, M, i.lp, ln, dlx, dly, dwx, dwy);
  if (glass && cover < 0.5) { discard; }
  return vec4<f32>(fogged(litSurface(i.wp, S), i.wp), 1.0);
}
@fragment fn fsGroundTex(i: GroundOut) -> @location(0) vec4<f32> {
  let wp = i.wp;
  let dlx = dpdx(wp);
  let dly = dpdy(wp);
  let M = MAT[GROUND_MAT];
  let up = vec3<f32>(0.0, 1.0, 0.0);
  var S = surfOf(M, groundAlbedo(wp), up, wp);
  let T = whereOn(M, wp, up, dlx, dly, vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), 1.0);
  _ = applyMaps(&S, M, T, dlx, dly);
  _ = applyDecals(&S, M, wp, up, dlx, dly, dlx, dly);
  rimK = 0.0;
  return vec4<f32>(fogged(litSurface(wp, S), wp), 1.0);
}

fn mirrored(wp: vec3<f32>, r: vec3<f32>) -> vec3<f32> {
  let sky = skyColor(r);
  if (r.y > -0.002) { return sky; }
  let p = wp + r * (max(wp.y, 0.0) / -r.y);
  let k = 1.0 - smoothstep(0.7, 1.0, length(p.xz) / F.groundB.z);
  if (k <= 0.0) { return sky; }
  let up = vec3<f32>(0.0, 1.0, 0.0);
  let v = normalize(F.eye.xyz - p);
  var lit = F.ground.rgb * ambientAt(up);
  lit = lit + lightOne(F.keyDir.xyz, F.keyCol.rgb, up, v, F.ground.rgb, 0.0, 1.0);
  lit = lit + lightOne(F.fillDir.xyz, F.fillCol.rgb, up, v, F.ground.rgb, 0.0, 1.0);
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) {
    let l = normalize(F.lights[i].pos.xyz - p);
    lit = lit + lightOne(l, F.lights[i].col.rgb * lightReach(F.lights[i], p, F.lights[i].pos.xyz, l), up, v, F.ground.rgb, 0.0, 1.0);
  }
  return mix(sky, fogged(lit * 0.5, p), k);
}

struct GlassOut {
  @location(0) nearLight: vec4<f32>,
  @location(1) nearTaken: vec4<f32>,
  @location(2) farLight: vec4<f32>,
  @location(3) farTaken: vec4<f32>,
};
@fragment fn fsGlassFirst(i: ObjOut) -> @location(0) vec4<f32> {
  return vec4<f32>(length(i.wp - F.eye.xyz), 0.0, 0.0, 1.0);
}
@fragment fn fsGlass(i: ObjOut) -> GlassOut { return glassSurface(i.pos, i.wp, normalize(i.n), i.id, D[i.id].d.rgb); }
@fragment fn fsGlassTex(i: ObjTexOut) -> GlassOut {
  let dlx = dpdx(i.lp);
  let dly = dpdy(i.lp);
  let duvx = dpdx(i.uv);
  let duvy = dpdy(i.uv);
  let o = D[i.id];
  let M = MAT[i.id];
  var S = surfOf(M, o.d.rgb, normalize(i.n), i.wp);
  let T = whereOn(M, i.lp, normalize(i.ln), dlx, dly, i.uv, duvx, duvy, max(o.b.x, o.b.z));
  if (applyMaps(&S, M, T, worldDir(dlx, o), worldDir(dly, o)) < 0.5) { discard; }
  return glassSurface(i.pos, i.wp, S.n, i.id, S.albedo);
}
fn glassSurface(pos: vec4<f32>, wp: vec3<f32>, outward: vec3<f32>, id: u32, tint: vec3<f32>) -> GlassOut {
  let to = wp - F.eye.xyz;
  let d = length(to);
  let rd = to / d;
  let n = select(outward, -outward, dot(outward, rd) > 0.0);
  let v = -rd;
  let M = MAT[id];
  let rough = M.a.x;
  let f0 = pow((M.b.z - 1.0) / (M.b.z + 1.0), 2.0);
  let mirror = glassMirror(dot(n, v)) - 0.04 + f0;

  var seen = select(mirrored(wp, reflect(rd, n)), envAt(reflect(rd, n), rough), rough > 0.02) * mirror;
  let keySh = shadowAt(wp, n, 4);
  seen = seen + F.keyCol.rgb * pow(max(dot(n, normalize(F.keyDir.xyz + v)), 0.0), 900.0) * 25.0 * mirror * keySh;
  seen = seen + F.fillCol.rgb * pow(max(dot(n, normalize(F.fillDir.xyz + v)), 0.0), 500.0) * 12.0 * mirror;
  seen = seen + F.rimCol.rgb * pow(max(dot(n, normalize(F.rimDir.xyz + v)), 0.0), 500.0) * 16.0 * mirror;
  for (var k = 0; k < i32(F.lightN.x); k = k + 1) { seen = seen + placedGlint(F.lights[k], wp, n, v) * mirror * localShadowAt(F.lights[k], wp, n, 1); }

  let px = vec2<i32>(pos.xy);
  let first = textureLoad(glassFirst, px, 0).x;
  let path = select(d - first, first - d, dot(outward, rd) < 0.0);
  var taken = glassStops(tint) * M.b.w * path - log(1.0 - min(mirror, 0.97));

  var way = path;
  if (rough > 0.0) {
    let k = min(rough * 2.0, 1.0);
    seen = seen + shade(wp, n, tint, 0.0, 0.5, 4) * 0.22 * k;
    taken = taken + GLASS_FROST_TAKES * k;
    way = way + GLASS_FROST * max(round(rough * 8.0), 1.0);
  }
  seen = seen * exp(-d * F.fog.w);

  let zs = textureLoad(opaqueDepth, px, 0);
  var left = 1.0;
  if (zs < 1.0) {
    let w = F.invViewProj * vec4<f32>(ndcOf(pos.xy), zs, 1.0);
    left = 1.0 - d / max(length(w.xyz / w.w - F.eye.xyz), d);
  }
  let bend = -GLASS_BEND * (M.b.z - 1.0) * 2.0 * (viewTurn() * outward).xy * left;

  var g: GlassOut;
  g.nearLight = vec4<f32>(0.0, 0.0, 0.0, d);
  g.nearTaken = vec4<f32>(0.0, 0.0, 0.0, bend.x);
  g.farLight = vec4<f32>(0.0, 0.0, 0.0, bend.y);
  g.farTaken = vec4<f32>(0.0, 0.0, 0.0, way);
  if (d < first + GLASS_PANE) { g.nearLight = vec4<f32>(seen, d); g.nearTaken = vec4<f32>(taken, bend.x); }
  else { g.farLight = vec4<f32>(seen, bend.y); g.farTaken = vec4<f32>(taken, way); }
  return g;
}

@fragment fn fsPickMaskDisp(i: ObjTexOut) -> @location(0) vec4<f32> {
  let id = MAT[i.id].c.w / 255.0;
  return vec4<f32>(id, id, 0.0, 1.0);
}
@fragment fn fsPickMask(i: ObjOut) -> @location(0) vec4<f32> {
  let id = MAT[i.id].c.w / 255.0;
  return vec4<f32>(id, id, 0.0, 1.0);
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


export const SHADOW_SHADER = FRAME_WGSL + MATERIAL_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> D: array<Obj>;
@group(0) @binding(2) var<storage, read> PP: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> PC: array<vec4<f32>>;

@vertex fn vsShadowObj(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @builtin(instance_index) id: u32) -> @builtin(position) vec4<f32> {
  let o = D[id];
  return F.shadowVP * vec4<f32>(worldOfLocal(p * o.b.xyz, o), 1.0);
}
@group(1) @binding(0) var<storage, read> MAT: array<Mat>;
@group(1) @binding(1) var texArr: texture_2d_array<f32>;
@group(1) @binding(2) var texSamp: sampler;
@vertex fn vsShadowDisp(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @location(2) puff: vec3<f32>, @location(3) uv: vec2<f32>, @builtin(instance_index) id: u32) -> @builtin(position) vec4<f32> {
  let o = D[id];
  let lp = p * o.b.xyz;
  let ln = normalize(nrm / o.b.xyz);
  return F.shadowVP * vec4<f32>(worldOfLocal(lp + normalize(puff / o.b.xyz) * dispAt(MAT[id], lp, ln, uv, max(o.b.x, o.b.z)), o), 1.0);
}

struct GlassLit { @builtin(position) pos: vec4<f32>, @location(0) wp: vec3<f32>, @location(1) n: vec3<f32>, @location(2) @interpolate(flat) id: u32 };
@vertex fn vsGlassLight(@location(0) p: vec3<f32>, @location(1) nrm: vec3<f32>, @builtin(instance_index) id: u32) -> GlassLit {
  let o = D[id];
  let wp = worldOfLocal(p * o.b.xyz, o);
  return GlassLit(F.shadowVP * vec4<f32>(wp, 1.0), wp, normalize(worldDir(nrm / o.b.xyz, o)), id);
}
fn glassTaken(i: GlassLit, toLight: vec3<f32>, along: f32, middle: f32) -> vec4<f32> {
  let facing = dot(normalize(i.n), toLight);
  let c = abs(facing);
  let path = select(along - middle, middle - along, facing > 0.0);
  var lost = (1.0 - c) * (1.0 - c) - log(1.0 - min(glassMirror(c), 0.97));
  if (u32(D[i.id].h.w + 0.5) == 5u) { lost = lost + GLASS_FROST_TAKES; }
  return vec4<f32>(glassStops(D[i.id].d.rgb) * path + lost, along);
}
@fragment fn fsGlassKey(i: GlassLit) -> @location(0) vec4<f32> {
  return glassTaken(i, F.keyDir.xyz, -dot(i.wp, F.keyDir.xyz), -dot(D[i.id].a.xyz, F.keyDir.xyz));
}
@fragment fn fsGlassPlaced(i: GlassLit) -> @location(0) vec4<f32> {
  let to = F.lightN.yzw - i.wp;
  let along = length(to);
  return glassTaken(i, to / along, along, length(D[i.id].a.xyz - F.lightN.yzw));
}

struct WaterLit { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) at: vec3<f32>, @location(2) dye: vec3<f32> };
@vertex fn vsWaterLight(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> WaterLit {
  let c = quadCorner(vi);
  if (PP[ii].w > 0.5) { return WaterLit(vec4<f32>(0.0, 0.0, 2.0, 1.0), c, vec3<f32>(0.0), vec3<f32>(0.0)); }
  let wp = PP[ii].xyz + (F.shadowRight.xyz * c.x + F.shadowUp.xyz * c.y) * F.liquid.y * 1.3;
  return WaterLit(F.shadowVP * vec4<f32>(wp, 1.0), c, PP[ii].xyz, PC[ii].xyz);
}
fn waterTaken(i: WaterLit, along: f32) -> vec4<f32> {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let cell = F.liqMin.w;
  let R = F.liquid.y * 1.3;
  let depth = 3.0 * (cell * cell * cell / 8.0) / (2.0 * PI * R * R) * sqrt(1.0 - r2);
  let clarity = F.liquid.z;
  let murk = 1.0 - clarity;
  return vec4<f32>(depth * (i.dye * mix(30.0, 1.5, clarity) * 0.72 + vec3<f32>(0.15 + 60.0 * murk * murk * murk)), along);
}
@fragment fn fsWaterKey(i: WaterLit) -> @location(0) vec4<f32> {
  return waterTaken(i, -dot(i.at, F.keyDir.xyz));
}
@fragment fn fsWaterPlaced(i: WaterLit) -> @location(0) vec4<f32> {
  return waterTaken(i, length(i.at - F.lightN.yzw));
}
`;

export const CAUSTIC_SIZE = 512, CAUSTIC_LINES = 256;
const CAUSTIC_BLOCK =  `
struct CausticQ { vp: mat4x4<f32>, inv: mat4x4<f32>, box: vec4<f32>, from3: vec4<f32>, more: vec4<f32> };
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> Q: CausticQ;
`;
export const CAUSTIC_SURFACE_SHADER = FRAME_WGSL + CAUSTIC_BLOCK +  `
@group(0) @binding(2) var field: texture_3d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn fieldIn(p: vec3<f32>) -> f32 {
  return textureSampleLevel(field, linSamp, clamp((p - F.fieldMin.xyz) / (F.fieldMax.xyz - F.fieldMin.xyz), vec3<f32>(0.0), vec3<f32>(1.0)), 0.0).x;
}
struct SurfaceOut { @location(0) hit: vec4<f32>, @location(1) nrm: vec4<f32> };
@fragment fn fsCausticSurface(@builtin(position) fc: vec4<f32>) -> SurfaceOut {
  var o: SurfaceOut;
  o.hit = vec4<f32>(0.0);
  o.nrm = vec4<f32>(0.0, 1.0, 0.0, 0.0);
  let m = Q.box.xy + fc.xy / Q.more.z * Q.box.zw;
  let ndc = vec2<f32>(m.x * 2.0 - 1.0, 1.0 - m.y * 2.0);
  let a = Q.inv * vec4<f32>(ndc, 0.0, 1.0);
  let b = Q.inv * vec4<f32>(ndc, 1.0, 1.0);
  let A = a.xyz / a.w;
  let rd = normalize(b.xyz / b.w - A);
  let span = boxHit(A, rd, F.fieldMin.xyz, F.fieldMax.xyz);
  if (span.y <= max(span.x, 0.0)) { return o; }
  let h = F.liqMax.w;
  var t = max(span.x, 0.0);
  var last = t;
  var hitAt = -1.0;
  for (var i = 0; i < 64 && t < span.y; i = i + 1) {
    let f = fieldIn(A + rd * t);
    if (f < 0.0) {
      var lo = last;
      var hi = t;
      for (var k = 0; k < 5; k = k + 1) {
        let c = 0.5 * (lo + hi);
        if (fieldIn(A + rd * c) < 0.0) { hi = c; } else { lo = c; }
      }
      hitAt = hi;
      break;
    }
    last = t;
    t = t + clamp(f * 0.8, 0.5 * h, 6.0 * h);
  }
  if (hitAt < 0.0) { return o; }
  let p = A + rd * hitAt;
  let g = vec3<f32>(fieldIn(p + vec3<f32>(h, 0.0, 0.0)) - fieldIn(p - vec3<f32>(h, 0.0, 0.0)),
                    fieldIn(p + vec3<f32>(0.0, h, 0.0)) - fieldIn(p - vec3<f32>(0.0, h, 0.0)),
                    fieldIn(p + vec3<f32>(0.0, 0.0, h)) - fieldIn(p - vec3<f32>(0.0, 0.0, h)));
  o.hit = vec4<f32>(p, 1.0);
  o.nrm = vec4<f32>(select(-rd, normalize(g), dot(g, g) > 1e-10), 1.0);
  return o;
}
`;
export const CAUSTIC_MESH_SHADER = key => FRAME_WGSL + CAUSTIC_BLOCK +  `
@group(0) @binding(2) var hitTex: texture_2d<f32>;
@group(0) @binding(3) var nrmTex: texture_2d<f32>;
@group(0) @binding(4) var depthMap: ${key ? 'texture_depth_2d' : 'texture_depth_2d_array'};
struct SheetOut { @builtin(position) pos: vec4<f32>, @location(0) old: vec2<f32>, @location(1) keep: f32 };
fn cropOf(p: vec3<f32>) -> vec2<f32> {
  let c = Q.vp * vec4<f32>(p, 1.0);
  let s = c.xy / c.w;
  return (vec2<f32>(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5) - Q.box.xy) / Q.box.zw;
}
fn pastTo(p: vec3<f32>, l: vec3<f32>) -> f32 {
  var far = 60.0;
  if (l.y < -1e-3) { far = p.y / -l.y; }
  let c = Q.vp * vec4<f32>(p, 1.0);
  let s = c.xyz / c.w;
  let uv = vec2<f32>(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
  let size = vec2<i32>(textureDimensions(depthMap));
  let at = clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
  let z = textureLoad(depthMap, at, ${key ? '' : 'i32(Q.more.x), '}0);
  if (z < 1.0 && z > s.z) {
    let w = Q.inv * vec4<f32>(s.xy, z, 1.0);
    far = min(far, length(w.xyz / w.w - p));
  }
  return far;
}
@vertex fn vsCausticFold(@builtin(vertex_index) vi: u32) -> SheetOut {
  let n = u32(Q.more.z);
  let c = vec2<i32>(i32(vi % n), i32(vi / n));
  let old = (vec2<f32>(c) + 0.5) / f32(n);
  let hit = textureLoad(hitTex, c, 0);
  var o: SheetOut;
  o.old = old;
  o.keep = hit.w;
  var q = old;
  if (hit.w > 0.5) {
    var l = -Q.from3.xyz;
    if (Q.from3.w > 0.5) { l = normalize(hit.xyz - Q.from3.xyz); }
    var nr = textureLoad(nrmTex, c, 0).xyz;
    if (dot(nr, l) > 0.0) { nr = -nr; }
    let facing = dot(nr, -l);
    if (facing < 0.77) { nr = normalize(nr + (-l) * (0.77 - facing) * 1.6); }
    let bent = refract(l, nr, 1.0 / 1.33);
    var d = pastTo(hit.xyz, l);
    if (bent.y < -1e-3) { d = min(d, hit.y / -bent.y); }
    q = cropOf(hit.xyz + bent * d);
  }
  o.pos = vec4<f32>(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
  return o;
}
@fragment fn fsCausticFold(i: SheetOut) -> @location(0) vec4<f32> {
  let dx = dpdx(i.old);
  let dy = dpdy(i.old);
  if (i.keep < 0.99) { discard; }
  let was = abs(dx.x * dy.y - dx.y * dy.x) * Q.more.y * Q.more.y;
  return vec4<f32>(min(was, 24.0), 0.0, 0.0, 0.0);
}
@vertex fn vsCausticBase(@builtin(vertex_index) vi: u32) -> SheetOut {
  let n = u32(Q.more.z);
  let c = vec2<i32>(i32(vi % n), i32(vi / n));
  let old = (vec2<f32>(c) + 0.5) / f32(n);
  var o: SheetOut;
  o.old = old;
  o.keep = textureLoad(hitTex, c, 0).w;
  o.pos = vec4<f32>(old.x * 2.0 - 1.0, 1.0 - old.y * 2.0, 0.0, 1.0);
  return o;
}
@fragment fn fsCausticBase(i: SheetOut) -> @location(0) vec4<f32> {
  if (i.keep < 0.99) { discard; }
  return vec4<f32>(0.0, 1.0, 0.0, 0.0);
}
`;
export const CAUSTIC_SOFT_SHADER =  `
@group(0) @binding(0) var from2: texture_2d<f32>;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsCausticSoft(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let c = vec2<i32>(fc.xy);
  let m = vec2<i32>(textureDimensions(from2)) - vec2<i32>(1);
  var sum = vec4<f32>(0.0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      sum = sum + textureLoad(from2, clamp(c + vec2<i32>(x, y), vec2<i32>(0), m), 0) * f32((2 - abs(x)) * (2 - abs(y)));
    }
  }
  return sum / 16.0;
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
  if (d > 1e8) { return vec4<f32>(6e4, 0.0, 0.0, 1.0); }
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
@group(0) @binding(4) var liquidLook: texture_3d<f32>;
@group(0) @binding(5) var foamLook: texture_3d<f32>;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn fieldAt(p: vec3<f32>) -> f32 {
  let uvw = (p - F.fieldMin.xyz) / (F.fieldMax.xyz - F.fieldMin.xyz);
  if (any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0))) { return 1.0; }
  return textureSampleLevel(field, linSamp, uvw, 0.0).x;
}
fn fieldIn(p: vec3<f32>) -> f32 {
  return textureSampleLevel(field, linSamp, clamp((p - F.fieldMin.xyz) / (F.fieldMax.xyz - F.fieldMin.xyz), vec3<f32>(0.0), vec3<f32>(1.0)), 0.0).x;
}
struct FieldOut { @location(0) depth: vec4<f32>, @location(1) thick: vec4<f32>, @location(2) dye: vec4<f32> };
fn noWater() -> FieldOut { var o: FieldOut; o.depth = vec4<f32>(1e9, 0.0, 0.0, 1.0); o.thick = vec4<f32>(0.0); o.dye = vec4<f32>(0.0); return o; }
fn octOf(n: vec3<f32>) -> vec2<f32> {
  let s = n / (abs(n.x) + abs(n.y) + abs(n.z));
  if (s.y >= 0.0) { return s.xz; }
  return (vec2<f32>(1.0) - abs(s.zx)) * vec2<f32>(select(-1.0, 1.0, s.x >= 0.0), select(-1.0, 1.0, s.z >= 0.0));
}
@fragment fn fsField(@builtin(position) fc: vec4<f32>) -> FieldOut {
  let d = textureLoad(fluidRaw, vec2<i32>(fc.xy), 0).x;
  if (d > 1e8) { return noWater(); }
  let vp = viewPos(fc.xy, d);
  let dist = length(vp);
  let rd = normalize(transpose(viewTurn()) * vp);
  let h = F.liqMax.w;
  let foot = dist * 2.0 / (F.proj[1][1] * F.screen.y);
  var a = max(dist - 3.0 * h, 0.0);
  var hit = -1.0;
  var fa = fieldAt(F.eye.xyz + rd * a);
  if (fa < 0.0) { hit = a; }
  var nearest = fa;
  var nearAt = a;
  for (var i = 0; i < 96 && hit < 0.0; i = i + 1) {
    let b = a + clamp(fa * 0.8, 0.34 * h, 4.0 * h);
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
    if (fb < nearest) { nearest = fb; nearAt = b; }
    if (fb > 0.99 && fa < 0.99) { break; }
    a = b;
    fa = fb;
  }
  var cover = 1.0;
  if (hit < 0.0) {
    if (nearest >= foot) { return noWater(); }
    cover = 1.0 - nearest / foot;
    hit = nearAt;
  }
  var t = hit;
  var inside = min(fieldAt(F.eye.xyz + rd * hit), -1e-4);
  var dye = vec4<f32>(0.0);
  for (var i = 0; i < 96; i = i + 1) {
    let q = F.eye.xyz + rd * (t + 0.5 * h);
    dye = dye + textureSampleLevel(liquidLook, linSamp, (q - F.liqMin.xyz) / (F.liqMax.xyz - F.liqMin.xyz), 0.0);
    let n = fieldAt(F.eye.xyz + rd * (t + h));
    if (n >= 0.0) { t = t + h * inside / min(inside - n, -1e-4); break; }
    inside = min(n, -1e-4);
    t = t + h;
  }
  let p = F.eye.xyz + rd * hit;
  let e = max(h * F.liquid.w, foot);
  var g = vec3<f32>(fieldIn(p + vec3<f32>(e, 0.0, 0.0)) - fieldIn(p - vec3<f32>(e, 0.0, 0.0)),
                    fieldIn(p + vec3<f32>(0.0, e, 0.0)) - fieldIn(p - vec3<f32>(0.0, e, 0.0)),
                    fieldIn(p + vec3<f32>(0.0, 0.0, e)) - fieldIn(p - vec3<f32>(0.0, 0.0, e)));
  if (dot(g, g) < 1e-10) { g = -rd; }
  let nrm = normalize(g);
  var o: FieldOut;
  o.depth = vec4<f32>(d * hit / dist, 0.0, 0.0, 1.0);
  let oct = octOf(nrm);
  o.thick = vec4<f32>(t - hit + 0.5 * h, oct.x, oct.y, cover);
  let fq = (F.eye.xyz + rd * (hit + h) - F.liqMin.xyz) / (F.liqMax.xyz - F.liqMin.xyz);
  o.dye = vec4<f32>(dye.rgb / max(dye.a, 1e-4), textureSampleLevel(foamLook, linSamp, fq, 0.0).r);
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


export const OUTLINE_SHADER =  `
@group(0) @binding(0) var<uniform> U: vec4<f32>;
@group(0) @binding(1) var mask: texture_2d<f32>;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsOutline(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let c = vec2<i32>(fc.xy);
  let last = vec2<i32>(textureDimensions(mask)) - vec2<i32>(1);
  let here = textureLoad(mask, c, 0).rg;
  let reach = i32(ceil(U.w + 1.0));
  var seen = 1e9;
  var hidden = 1e9;
  for (var y = -reach; y <= reach; y = y + 1) {
    for (var x = -reach; x <= reach; x = x + 1) {
      let s = textureLoad(mask, clamp(c + vec2<i32>(x, y), vec2<i32>(0), last), 0).rg;
      if (s.g == here.g) { continue; }
      let d = length(vec2<f32>(f32(x), f32(y)));
      if (max(s.r, here.r) > 0.0) { seen = min(seen, d); } else { hidden = min(hidden, d); }
    }
  }
  let a = max(clamp(U.w + 1.0 - seen, 0.0, 1.0), clamp(U.w + 1.0 - hidden, 0.0, 1.0) * 0.35);
  if (a <= 0.0) { discard; }
  return vec4<f32>(U.rgb, a);
}`;

export const GLASS_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var behind: texture_2d<f32>;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@group(0) @binding(3) var nearLight: texture_2d<f32>;
@group(0) @binding(4) var nearTaken: texture_2d<f32>;
@group(0) @binding(5) var farLight: texture_2d<f32>;
@group(0) @binding(6) var farTaken: texture_2d<f32>;
@group(0) @binding(7) var linSamp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
const FROST_TAPS = 12;
var<private> FROST: array<vec2<f32>, 12> = array<vec2<f32>, 12>(
  vec2<f32>(-0.326, -0.406), vec2<f32>(-0.840, -0.074), vec2<f32>(-0.696, 0.457), vec2<f32>(-0.203, 0.621),
  vec2<f32>(0.962, -0.195), vec2<f32>(0.473, -0.480), vec2<f32>(0.519, 0.767), vec2<f32>(0.185, -0.893),
  vec2<f32>(0.507, 0.064), vec2<f32>(0.896, 0.412), vec2<f32>(-0.322, -0.933), vec2<f32>(-0.792, -0.598));
@fragment fn fsGlassResolve(@builtin(position) fc4: vec4<f32>) -> @location(0) vec4<f32> {
  let fc = fc4.xy;
  let px = vec2<i32>(fc);
  let first = textureLoad(nearLight, px, 0).a;
  if (first > 1e4) { return textureLoad(behind, px, 0); }
  let uv = fc * F.screen.zw;
  let across = textureLoad(nearTaken, px, 0).a;
  let far = textureLoad(farLight, px, 0);
  let taken = textureLoad(farTaken, px, 0);
  let frost = floor(max(taken.a, 0.0) / GLASS_FROST + 0.5);
  let way = max(taken.a - frost * GLASS_FROST, 0.0);
  let most = mix(0.08, 0.3, smoothstep(0.03, 0.4, way));
  let shift = clamp(vec2<f32>(across * F.proj[0][0], far.a * F.proj[1][1]), vec2<f32>(-most), vec2<f32>(most)) * vec2<f32>(0.5, -0.5);
  var at = uv;
  for (var k = 4; k > 0; k = k - 1) {
    let tryAt = uv + shift * f32(k) * 0.25;
    let q = clamp(vec2<i32>(tryAt * F.screen.xy), vec2<i32>(0), vec2<i32>(F.screen.xy) - vec2<i32>(1));
    let zs = textureLoad(sceneDepth, q, 0);
    var clear = true;
    if (zs < 1.0) {
      let w = F.invViewProj * vec4<f32>(ndcOf(vec2<f32>(q) + 0.5), zs, 1.0);
      let p = w.xyz / w.w;
      clear = p.y <= 0.003 || length(p - F.eye.xyz) >= first;
    }
    if (clear) { at = tryAt; break; }
  }
  var c = vec3<f32>(0.0);
  if (frost > 0.0) {
    let r = frost * 0.0015 * vec2<f32>(F.screen.y * F.screen.z, 1.0);
    for (var i = 0; i < FROST_TAPS; i = i + 1) { c = c + textureSampleLevel(behind, linSamp, at + FROST[i] * r, 0.0).rgb; }
    c = c / f32(FROST_TAPS);
  } else {
    c = textureSampleLevel(behind, linSamp, at, 0.0).rgb;
  }
  return vec4<f32>(c * exp(-max(taken.rgb, vec3<f32>(0.0))) + far.rgb, 1.0);
}
`;

export const ENV_SIZE = [256, 128], ENV_LEVELS = 6;
export const ENV_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var bgTex: texture_2d<f32>;
@group(0) @binding(2) var bgSamp: sampler;
` + SKY_WGSL +  `
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsEnv(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / vec2<f32>(256.0, 128.0);
  let az = (uv.x - 0.5) * 2.0 * PI;
  let th = uv.y * PI;
  let d = vec3<f32>(sin(az) * sin(th), cos(th), -cos(az) * sin(th));
  let raw = skyColor(d);
  let sky = raw / (vec3<f32>(1.0) + raw * 0.5);
  if (d.y > -0.002) { return vec4<f32>(sky, 1.0); }
  let p = d * (1.0 / -d.y);
  let k = 1.0 - smoothstep(0.7, 1.0, length(p.xz) / F.groundB.z);
  var lit = F.ambSky.rgb * F.ambSky.w * 0.64;
  lit = lit + F.keyCol.rgb * max(F.keyDir.y, 0.0) + F.fillCol.rgb * max(F.fillDir.y, 0.0);
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) {
    let to = F.lights[i].pos.xyz - vec3<f32>(p.x, 0.0, p.z);
    let l = normalize(to);
    lit = lit + F.lights[i].col.rgb * max(l.y, 0.0) / max(dot(to, to), 0.01);
  }
  return vec4<f32>(mix(sky, lit * F.ground.rgb, k), 1.0);
}
`;
export const ENV_BLUR_SHADER =  `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsBlurDown(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(src));
  let uv = fc.xy / (size * 0.5);
  let sn = max(sin(uv.y * 3.14159265), 0.15);
  let t = 1.0 / size * vec2<f32>(1.5 / sn, 1.5);
  var c = textureSampleLevel(src, samp, uv, 0.0) * 0.25;
  c = c + (textureSampleLevel(src, samp, uv + vec2<f32>(t.x, 0.0), 0.0) + textureSampleLevel(src, samp, uv - vec2<f32>(t.x, 0.0), 0.0)
         + textureSampleLevel(src, samp, uv + vec2<f32>(0.0, t.y), 0.0) + textureSampleLevel(src, samp, uv - vec2<f32>(0.0, t.y), 0.0)) * 0.125;
  c = c + (textureSampleLevel(src, samp, uv + t, 0.0) + textureSampleLevel(src, samp, uv - t, 0.0)
         + textureSampleLevel(src, samp, uv + vec2<f32>(t.x, -t.y), 0.0) + textureSampleLevel(src, samp, uv - vec2<f32>(t.x, -t.y), 0.0)) * 0.0625;
  return vec4<f32>(c.rgb, 1.0);
}`;

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
@group(0) @binding(14) var field: texture_3d<f32>;
@group(0) @binding(15) var fieldThick: texture_2d<f32>;
@group(0) @binding(16) var localShadow: texture_depth_2d_array;
@group(0) @binding(17) var smokeLocal: texture_3d<f32>;
@group(0) @binding(18) var glassNear: texture_2d<f32>;
@group(0) @binding(19) var glassNearTaken: texture_2d<f32>;
const FIELD_DEPTH = 1.4;
fn clearKey(wp: vec3<f32>) -> vec3<f32> { return vec3<f32>(1.0); }
fn clearLocal(L: Light, wp: vec3<f32>) -> vec3<f32> { return vec3<f32>(1.0); }
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

fn scattered(T: vec3<f32>, c: f32) -> vec3<f32> {
  let t = max(T, vec3<f32>(1e-9));
  return t * hg(c, 0.45) * 0.55 + pow(t, vec3<f32>(0.4)) * hg(c, 0.2) * 0.3 + pow(t, vec3<f32>(0.13)) * 0.5 * 0.15;
}

fn closeShade(p: vec3<f32>, toward: vec3<f32>) -> vec3<f32> {
  let fine = F.shadowSpan.y;
  let dn = textureSampleLevel(smokeDye, linSamp, (p + toward * fine * 1.5 - F.smokeMin.xyz) / (F.smokeMax.xyz - F.smokeMin.xyz), 0.0);
  return exp(-(vec3<f32>(dn.a) + dn.rgb) * F.smokeMax.w * fine * 1.2);
}

struct SmokeSeen { light: vec3<f32>, through: vec3<f32> };
struct NearGlass { at: f32, light: vec3<f32>, through: vec3<f32> };
fn marchSmoke(ro: vec3<f32>, rd: vec3<f32>, tMin: f32, tMax: f32, fc: vec2<f32>, G: NearGlass) -> SmokeSeen {
  let bmin = F.smokeMin.xyz;
  let bmax = F.smokeMax.xyz;
  let hit = boxHit(ro, rd, bmin, bmax);
  let t0 = max(max(hit.x, 0.0), tMin);
  let t1 = min(hit.y, tMax);
  if (t1 <= t0) { return SmokeSeen(G.light, G.through); }
  let fine = F.shadowSpan.y;
  let stepLen = fine * 0.8;
  let jit = fract(52.9829189 * fract(dot(floor(fc), vec2<f32>(0.06711056, 0.00583715))));
  let size = bmax - bmin;
  var s0 = t0;
  var s1 = t0 + stepLen * max(jit, 0.05);
  var dA = textureSampleLevel(smokeDye, linSamp, (ro + rd * s0 - bmin) / size, 0.0);
  var haveA = true;
  let absorb = F.smokeMax.w;
  let cosK = dot(rd, F.keyDir.xyz);
  let cosR = dot(rd, F.rimDir.xyz);
  let phF = hg(dot(rd, F.fillDir.xyz), 0.35);
  let bounce = F.ground.rgb * F.keyCol.rgb * max(F.keyDir.y, 0.0) * 0.35;
  let amb = (F.ambSky.rgb * 0.6 + F.ambGround.rgb * 0.4) * F.ambSky.w + bounce;
  var T = vec3<f32>(1.0);
  var L = vec3<f32>(0.0);
  var glassPassed = false;
  var lightRest = vec3<f32>(0.0);
  var lightMain = vec3<f32>(0.0);
  var mainWay = vec3<f32>(0.0, 1.0, 0.0);
  var nextLight = -1.0;
  for (var i = 0; i < 700; i = i + 1) {
    if (s0 >= t1 || max(T.r, max(T.g, T.b)) < 0.01) { break; }
    if (textureSampleLevel(smokeSky, linSamp, (ro + rd * s0 - bmin) / size, 0.0).a < 0.002) {
      s0 = s0 + F.smokeDims.w;
      s1 = s0 + stepLen;
      haveA = false;
      continue;
    }
    if (!haveA) { dA = textureSampleLevel(smokeDye, linSamp, (ro + rd * s0 - bmin) / size, 0.0); haveA = true; }
    let sEnd = min(s1, t1);
    let len = sEnd - s0;
    if (!glassPassed && G.at <= sEnd) { L = L + T * G.light; T = T * G.through; glassPassed = true; }
    let dB = textureSampleLevel(smokeDye, linSamp, (ro + rd * sEnd - bmin) / size, 0.0);
    let d = (dA + dB) * 0.5;
    dA = dB;
    let p = ro + rd * (s0 + sEnd) * 0.5;
    let amount = d.a + min(d.r, min(d.g, d.b));
    if (amount > 0.002) {
      let stop = vec3<f32>(d.a) + d.rgb;
      let albedo = d.a / max(stop, vec3<f32>(1e-6));
      if (s0 >= nextLight) {
      nextLight = s0 + F.smokeDims.w * 0.75;
      let uvw = (p - bmin) / size;
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
      lightRest = F.rimCol.rgb * scattered(rim, cosR)
                + F.fillCol.rgb * phF * (0.35 + 0.65 * sky)
                + amb * (0.4 + 0.6 * sky);
      lightMain = vec3<f32>(0.0);
      if (F.keyCol.r + F.keyCol.g + F.keyCol.b > 0.0) { lightMain = F.keyCol.rgb * scattered(lt.rgb, cosK) * shK; mainWay = F.keyDir.xyz; }
      let nl = i32(F.lightN.x);
      if (nl > 0) {
        let through = localThrough(uvw);
        for (var li = 0; li < nl; li = li + 1) {
          let PL = F.lights[li];
          let l = normalize(PL.pos.xyz - p);
          var t = vec3<f32>(1.0);
          if (li < 4) { t = vec3<f32>(through.r[li], through.g[li], through.b[li]); }
          let k = lightReach(PL, p, PL.pos.xyz, l) * localShadowAt(PL, p, vec3<f32>(0.0), 1);
          let lit = PL.col.rgb * k * scattered(t, dot(rd, l));
          if (li == 0 && F.keyCol.r + F.keyCol.g + F.keyCol.b <= 0.0) { lightMain = lit; mainWay = l; } else { lightRest = lightRest + lit; }
          let fp = vec3<f32>(p.x, 0.0, p.z);
          let fl = normalize(PL.pos.xyz - fp);
          lightRest = lightRest + PL.col.rgb * lightReach(PL, fp, PL.pos.xyz, fl) * max(fl.y, 0.0) * F.ground.rgb * 0.25 * exp(-p.y * 1.5) * t;
        }
      }
      }
      let lightIn = lightRest + lightMain * closeShade(p, mainWay);
      let a = exp(-stop * absorb * len);
      L = L + T * albedo * lightIn * (vec3<f32>(1.0) - a);
      T = T * a;
    }
    s0 = sEnd;
    s1 = sEnd + clamp(0.06 / max(amount * absorb, 1e-3), stepLen, F.smokeDims.w);
  }
  if (!glassPassed) { L = L + T * G.light; T = T * G.through; }
  return SmokeSeen(L, T);
}

fn fieldNear(p: vec3<f32>) -> f32 {
  return textureSampleLevel(field, linSamp, clamp((p - F.fieldMin.xyz) / (F.fieldMax.xyz - F.fieldMin.xyz), vec3<f32>(0.0), vec3<f32>(1.0)), 0.0).x;
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
  var grad = vec3<f32>(0.0);
  if (F.liquid.x > 2.5) {
    grad = vec3<f32>(fieldNear(p + vec3<f32>(h, 0.0, 0.0)) - fieldNear(p - vec3<f32>(h, 0.0, 0.0)),
                     fieldNear(p + vec3<f32>(0.0, h, 0.0)) - fieldNear(p - vec3<f32>(0.0, h, 0.0)),
                     fieldNear(p + vec3<f32>(0.0, 0.0, h)) - fieldNear(p - vec3<f32>(0.0, 0.0, h)));
    grad = -grad;
  } else {
    grad = vec3<f32>(liquidAt(p + vec3<f32>(h, 0.0, 0.0)).a - liquidAt(p - vec3<f32>(h, 0.0, 0.0)).a,
                     liquidAt(p + vec3<f32>(0.0, h, 0.0)).a - liquidAt(p - vec3<f32>(0.0, h, 0.0)).a,
                     liquidAt(p + vec3<f32>(0.0, 0.0, h)).a - liquidAt(p - vec3<f32>(0.0, 0.0, h)).a);
  }
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

fn octUp(e: vec2<f32>) -> vec3<f32> {
  let y = 1.0 - abs(e.x) - abs(e.y);
  if (y >= 0.0) { return normalize(vec3<f32>(e.x, y, e.y)); }
  let s = (vec2<f32>(1.0) - abs(e.yx)) * vec2<f32>(select(-1.0, 1.0, e.x >= 0.0), select(-1.0, 1.0, e.y >= 0.0));
  return normalize(vec3<f32>(s.x, y, s.y));
}
fn sunGlint(n: vec3<f32>, v: vec3<f32>, toL: vec3<f32>, col: vec3<f32>) -> vec3<f32> {
  let h = normalize(toL + v);
  let a2 = 0.045 * 0.045;
  let dd = max(dot(n, h), 0.0);
  let q = dd * dd * (a2 - 1.0) + 1.0;
  let f = 0.02 + 0.98 * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  return col * (a2 / max(q * q, 1e-8)) * f * 0.25;
}
fn mirrored(wp: vec3<f32>, r: vec3<f32>) -> vec3<f32> {
  var t = 0.03;
  let size = F.screen.xy;
  for (var i = 0; i < 18; i = i + 1) {
    let q = wp + r * t;
    let c = F.viewProj * vec4<f32>(q, 1.0);
    if (c.w <= 1e-3) { break; }
    let s = c.xyz / c.w;
    if (any(abs(s.xy) > vec2<f32>(0.999))) { break; }
    let uv = vec2<f32>(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
    let z = textureLoad(sceneDepth, vec2<i32>(uv * size), 0);
    if (z < 1.0 && s.z > z) {
      let w = F.invViewProj * vec4<f32>(s.xy, z, 1.0);
      let gap = length(w.xyz / w.w - q);
      if (gap < t * 0.4 + 0.03) {
        let edge = clamp((1.0 - max(abs(s.x), abs(s.y))) * 12.0, 0.0, 1.0);
        return mix(skyColor(r), textureSampleLevel(sceneColor, linSamp, uv, 0.0).rgb, edge);
      }
    }
    t = t * 1.32;
  }
  if (r.y < -1e-3) {
    let q = wp + r * (-wp.y / r.y);
    let c = F.viewProj * vec4<f32>(q, 1.0);
    if (c.w > 1e-3) {
      let s = c.xyz / c.w;
      if (all(abs(s.xy) < vec2<f32>(0.999))) { return textureSampleLevel(sceneColor, linSamp, vec2<f32>(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5), 0.0).rgb; }
    }
  }
  return skyColor(r);
}
fn liquidSurface(px: vec2<i32>, fc: vec2<f32>, vp: vec3<f32>, rd: vec3<f32>, tScene: f32, G: NearGlass) -> vec3<f32> {
  let wp = F.eye.xyz + rd * length(vp);
  let v = -rd;
  let uv = fc * F.screen.zw;
  let th = textureSampleLevel(thick, linSamp, uv, 0.0);
  let smoothLook = F.liquid.x > 2.5;
  var nw: vec3<f32>;
  var cover = 1.0;
  var depthM = th.a * 0.3;
  if (smoothLook) {
    let ft = textureLoad(fieldThick, px, 0);
    nw = octUp(ft.yz);
    depthM = ft.x * FIELD_DEPTH;
    cover = ft.w;
  } else {
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
    nw = normalize(transpose(viewTurn()) * nv);
  }
  let lean = dot(nw, v);
  if (lean < 0.04) { nw = normalize(nw + v * (max(-lean, 0.04) - lean)); }
  var dye = th.rgb / max(th.a, 1e-4);
  var foam = 0.0;
  if (smoothLook) { dye = th.rgb; foam = th.a * F.waterMore.x; }
  let base = exp(-dye);
  let clarity = F.liquid.z;

  let ndv = max(dot(nw, v), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  let inWater = refract(rd, nw, 1.0 / 1.33);
  let gap = max(tScene - length(vp), 0.0);
  let bendBy = min(mix(depthM, gap, 0.2), 0.5);
  let bc = F.viewProj * vec4<f32>(wp + inWater * bendBy, 1.0);
  var bentUv = uv;
  if (bc.w > 1e-3) {
    let q = vec2<f32>(bc.x / bc.w * 0.5 + 0.5, 0.5 - bc.y / bc.w * 0.5);
    let zHere = F.viewProj * vec4<f32>(wp, 1.0);
    if (all(q > vec2<f32>(0.0)) && all(q < vec2<f32>(1.0)) && textureLoad(sceneDepth, vec2<i32>(q * F.screen.xy), 0) > zHere.z / zHere.w) { bentUv = q; }
  }
  let k = mix(30.0, 1.5, clarity);
  let murk = 1.0 - clarity;
  let straight = textureSampleLevel(sceneColor, linSamp, uv, 0.0).rgb;
  var behind = textureSampleLevel(sceneColor, linSamp, bentUv, 0.0).rgb;
  var far = textureLoad(fieldThick, px, 0).x;
  if (smoothLook) { far = length(vp) + far + F.liqMin.w; }
  if (far < 5e4) { behind = waterBehind(F.eye.xyz + rd * far, rd, far, tScene, behind, k, murk); }
  var past = NearGlass(1e9, vec3<f32>(0.0), vec3<f32>(1.0));
  if (G.at >= length(vp)) { past = G; }
  var straightSeen = straight;
  if (F.smokeMin.w > 0.5) {
    let s = marchSmoke(F.eye.xyz, rd, min(far, tScene), tScene, fc, past);
    behind = behind * s.through + s.light;
    straightSeen = straight * s.through + s.light;
  } else {
    behind = behind * past.through + past.light;
    straightSeen = straight * past.through + past.light;
  }
  let trans = exp(-dye * depthM * k * 0.72 - depthM * 0.15);
  let seen = behind * trans;
  let lit = shade(wp, nw, base, 0.0, 0.6, 1);
  let opacity = 1.0 - exp(-depthM * 60.0 * murk * murk * murk);
  let body = mix(seen + lit * 0.08 * clarity * (1.0 - exp(-depthM * 8.0)), lit, opacity);

  let r = reflect(rd, nw);
  let refl = mirrored(wp, r);
  var spec = vec3<f32>(0.0);
  let sh = shadowAt(wp, nw, 1);
  spec = spec + sunGlint(nw, v, F.keyDir.xyz, F.keyCol.rgb) * sh;
  spec = spec + sunGlint(nw, v, F.fillDir.xyz, F.fillCol.rgb);
  spec = spec + sunGlint(nw, v, F.rimDir.xyz, F.rimCol.rgb);
  for (var i = 0; i < i32(F.lightN.x); i = i + 1) { spec = spec + mirrorOfLight(F.lights[i], wp, r, 0.02) * fres * localShadowAt(F.lights[i], wp, nw, 1); }
  var water = body * (1.0 - fres) + refl * fres + spec;
  if (foam > 0.01) {
    let t = F.eye.w;
    let pat = 0.55 * vnoise(wp.xz * 70.0 + vec2<f32>(wp.y * 50.0, t * 0.5)) + 0.45 * vnoise(wp.zx * 170.0 + vec2<f32>(-wp.y * 90.0, -t * 0.4));
    let a = clamp(foam, 0.0, 1.0);
    let f = smoothstep(1.0 - a * 1.1, 1.45 - a * 0.8, pat) * (0.25 + 0.75 * a);
    water = mix(water, shade(wp, nw, vec3<f32>(0.93), 0.0, 0.85, 1), f * 0.92);
  }
  return mix(straightSeen, water, cover);
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

fn finalLight(fc4: vec4<f32>) -> vec3<f32> {
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
  var G = NearGlass(1e9, vec3<f32>(0.0), vec3<f32>(1.0));
  if (F.lightN.y > 0.5) {
    let g = textureLoad(glassNear, px, 0);
    if (g.a < tScene) { G = NearGlass(g.a, g.rgb, exp(-max(textureLoad(glassNearTaken, px, 0).rgb, vec3<f32>(0.0)))); }
  }
  if (F.liquid.x > 1.5) {
    let ld = textureLoad(fluidDepth, px, 0).x;
    if (ld < 1e8) {
      let vp = viewPos(fc, ld);
      let dist = length(vp);
      if (dist < tScene + 0.02) {
        col = liquidSurface(px, fc, vp, rd, tScene, G);
        tMax = dist;
        if (G.at >= dist) { G = NearGlass(1e9, vec3<f32>(0.0), vec3<f32>(1.0)); }
      }
    }
  }
  if (F.smokeMin.w > 0.5) {
    let s = marchSmoke(F.eye.xyz, rd, 0.0, tMax, fc, G);
    col = col * s.through + s.light;
  } else {
    col = col * G.through + G.light;
  }
  if (F.env.z > 0.0) { col = rain(uv, col); }
  return col * F.env.y;
}
@fragment fn fsComposite(@builtin(position) fc4: vec4<f32>) -> @location(0) vec4<f32> {
  let col = pow(aces(finalLight(fc4)), vec3<f32>(1.0 / 2.2)) + (hash21(fc4.xy) - 0.5) / 255.0;
  return vec4<f32>(col, 1.0);
}
struct FinalOut { @location(0) shown: vec4<f32>, @location(1) light: vec4<f32> };
@fragment fn fsCompositeLight(@builtin(position) fc4: vec4<f32>) -> FinalOut {
  let x = finalLight(fc4);
  return FinalOut(vec4<f32>(pow(aces(x), vec3<f32>(1.0 / 2.2)) + (hash21(fc4.xy) - 0.5) / 255.0, 1.0), vec4<f32>(x, 1.0));
}
`;
