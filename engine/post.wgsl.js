export const POST_FLOATS = 24;

export const POST_DEFAULTS = {
  saturation: 1, contrast: 1, posterize: 0, grain: 0,
  split: 0, scan: 0, soften: 0,
  band: null,
  vignette: 0, lift: 0,
  tint: '#ffffff', tintAmount: 0,
  glow: 0, glowFrom: 0.7,
  ink: 0,
};

export function postIsNone(p) {
  if (!p) return true;
  const q = { ...POST_DEFAULTS, ...p };
  return q.saturation === 1 && q.contrast === 1 && !q.posterize && !q.grain && !q.split && !q.scan && !q.soften &&
    !(q.band && q.band.blur > 0) && !q.vignette && !q.lift && !q.tintAmount && !q.glow && !q.ink;
}

export const FILTER_PRESETS = {
  none:      { label: 'None', p: {} },
  photocopy: { label: 'Photocopy', p: { saturation: 0, contrast: 1.5, grain: 0.13, soften: 0.8, vignette: 0.7 } },
  haze:      { label: 'Haze', p: { soften: 1.6, split: 3, saturation: 1.45, contrast: 1.06, vignette: 0.35, grain: 0.03, glow: 0.25, glowFrom: 0.6 } },
  tape:      { label: 'Video tape', p: { split: 2.2, scan: 0.16, soften: 0.5, grain: 0.05, saturation: 1.3, contrast: 1.08 } },
  miniature: { label: 'Miniature', p: { band: { center: 0.56, half: 0.13, blur: 5 }, saturation: 1.05, contrast: 1.03 } },
  drawing:   { label: 'Drawing', p: { posterize: 5, saturation: 0.5, contrast: 1.1, ink: 0.5 } },
  crisp:     { label: 'Crisp', p: { contrast: 1.08, saturation: 1.15 } },
  studio:    { label: 'Studio', p: { vignette: 0.25, contrast: 1.03 } },
  cyanotype: { label: 'Cyanotype', p: { saturation: 0, contrast: 1.2, tint: '#2f63d8', tintAmount: 0.75, lift: 0.04 } },
  sepia:     { label: 'Sepia', p: { saturation: 0, contrast: 1.1, tint: '#b8864f', tintAmount: 0.6, grain: 0.04, vignette: 0.3 } },
};

function hexRgb(hex) {
  const n = parseInt((hex || '#ffffff').slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function packPost(p, w, h, time, out = new Float32Array(POST_FLOATS)) {
  const q = { ...POST_DEFAULTS, ...p };
  const b = q.band || { center: 0.5, half: 1, blur: 0 };
  out.set([q.saturation, q.contrast, q.posterize, q.grain,
    q.split, q.scan, q.soften, time,
    b.center, b.half, b.blur, q.vignette,
    q.lift, w, h, 0,
    ...hexRgb(q.tint), q.tintAmount,
    q.glow, q.glowFrom, q.ink, 0]);
  return out;
}

export const POST_SHADER =  `
struct Post {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  f: vec4<f32>,
};
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var pic: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}

fn hashP(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }
fn lumP(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }

fn soft(uv: vec2<f32>, r: f32) -> vec3<f32> {
  var s = textureSampleLevel(pic, samp, uv, 0.0).rgb;
  if (r < 0.35) { return s; }
  let px = r / P.d.yz;
  for (var i = 0; i < 12; i++) {
    let odd = f32(i % 2);
    let a = f32(i) * 0.5236 + odd * 0.26;
    s = s + textureSampleLevel(pic, samp, uv + vec2<f32>(cos(a), sin(a)) * px * mix(0.5, 1.0, odd), 0.0).rgb;
  }
  return s / 13.0;
}

@fragment fn fsPost(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let res = P.d.yz;
  let uv = fc.xy / res;
  var r = P.b.z;
  if (P.c.z > 0.0) {
    let d = max(abs(uv.y - P.c.x) - P.c.y, 0.0);
    r = r + P.c.z * clamp(d / 0.3, 0.0, 1.0);
  }
  var col: vec3<f32>;
  if (P.b.x > 0.0) {
    let o = vec2<f32>(P.b.x / res.x, 0.0);
    col = vec3<f32>(soft(uv + o, r).r, soft(uv, r).g, soft(uv - o, r).b);
  } else {
    col = soft(uv, r);
  }
  if (P.f.x > 0.0) {
    let wide = soft(uv, 9.0) * 0.5 + soft(uv, 20.0) * 0.5;
    col = col + max(wide - vec3<f32>(P.f.y), vec3<f32>(0.0)) * P.f.x * 2.5;
  }
  if (P.f.z > 0.0) {
    let t = 1.5 / res;
    let gx = lumP(textureSampleLevel(pic, samp, uv + vec2<f32>(t.x, 0.0), 0.0).rgb) - lumP(textureSampleLevel(pic, samp, uv - vec2<f32>(t.x, 0.0), 0.0).rgb);
    let gy = lumP(textureSampleLevel(pic, samp, uv + vec2<f32>(0.0, t.y), 0.0).rgb) - lumP(textureSampleLevel(pic, samp, uv - vec2<f32>(0.0, t.y), 0.0).rgb);
    let edge = smoothstep(0.04, 0.2, length(vec2<f32>(gx, gy)));
    col = mix(col, col * 0.12, edge * P.f.z);
  }
  let l = lumP(col);
  col = mix(vec3<f32>(l), col, P.a.x);
  if (P.e.w > 0.0) {
    let t = P.e.rgb / max(lumP(P.e.rgb), 0.15);
    col = mix(col, col * t, P.e.w);
  }
  col = (col - 0.5) * P.a.y + 0.5;
  col = col + P.d.x * (1.0 - col);
  if (P.a.z > 0.5) { col = floor(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)) * P.a.z + 0.5) / P.a.z; }
  if (P.b.y > 0.0) { col = col * (1.0 - P.b.y * (0.5 + 0.5 * cos(fc.y * 2.0944))); }
  if (P.c.w > 0.0) { let q = uv - 0.5; col = col * (1.0 - P.c.w * dot(q, q) * 2.0); }
  if (P.a.w > 0.0) { col = col + (hashP(floor(fc.xy) + fract(P.b.w * 7.13) * 311.0) - 0.5) * P.a.w; }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
