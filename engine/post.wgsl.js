export const POST_FLOATS = 56;

export const POST_DEFAULTS = {
  saturation: 1, contrast: 1, posterize: 0, grain: 0, grainSize: 1,
  split: 0, scan: 0, soften: 0,
  band: null,
  vignette: 0, lift: 0,
  tint: '#ffffff', tintAmount: 0,
  ink: 0,
  film: null, filmAmount: 1, highlights: 0, shadows: 0, colour: 0, warmth: 0, green: 0, chrome: 0, clarity: 0, sharpen: 0,
  bloom: 0, bloomFrom: 0.8, bloomSpread: 0.6, bloomTint: '#ffffff', veil: 0, softHigh: 0,
};
const oldGlow = p => { if (!p.glow || p.bloom !== undefined) return p; const d = p.glowFrom ?? 0.7; return { ...p, bloom: Math.min(p.glow * 0.8, 1), bloomFrom: Math.max(0.1, Math.pow(d, 2.2) * 1.2), bloomSpread: 0.5 }; };

export function postIsNone(p) {
  if (!p) return true;
  const q = { ...POST_DEFAULTS, ...oldGlow(p) };
  return q.saturation === 1 && q.contrast === 1 && !q.posterize && !q.grain && !q.split && !q.scan && !q.soften &&
    !(q.band && q.band.blur > 0) && !q.vignette && !q.lift && !q.tintAmount && !q.ink &&
    !q.film && !q.highlights && !q.shadows && !q.colour && !q.warmth && !q.green && !q.chrome && !q.clarity && !q.sharpen && !q.bloom && !q.veil && !q.softHigh;
}
export const wantsBloom = p => { if (!p) return false; const q = { ...POST_DEFAULTS, ...oldGlow(p) }; return q.bloom > 0 || q.veil > 0; };

const mono = (r, g, b) => [r, g, b, r, g, b, r, g, b];
export const FILM_LOOKS = {
  standard: { label: 'Standard slide', after: 'Provia', says: 'Neutral and true, a little warm: the everyday film.', m: [1.01, 0, -0.01, 0, 1, 0, -0.01, 0, 1.01], h: 0.1, s: 0.12, sat: 1.06, high: [0.006, 0.003, -0.006] },
  vivid: { label: 'Vivid slide', after: 'Velvia', says: 'Saturated, hard, deep shadows; rich blues, greens and reds.', m: [1.12, -0.07, -0.05, -0.06, 1.12, -0.06, -0.03, -0.09, 1.12], h: 0.16, s: 0.34, sat: 1.32, chrome: 0.35, low: [0.006, -0.002, 0.012] },
  soft: { label: 'Soft slide', after: 'Astia', says: 'Soft in the highlights, kind to skin, colours still bright.', m: [1.04, -0.03, -0.01, -0.01, 1.03, -0.02, 0, -0.03, 1.03], h: -0.08, s: 0.14, sat: 1.12, high: [0.006, 0.002, -0.002] },
  chrome: { label: 'Faded chrome', after: 'Classic Chrome', says: 'Quiet colour, hard shadows, blues gone toward cyan: documentary photographs.', m: [0.96, 0.05, -0.01, -0.01, 1.01, 0, -0.03, 0.12, 0.91], h: -0.04, s: 0.34, sat: 0.76, chrome: 0.25, satLow: 0.85, low: [-0.004, 0, 0.008], high: [0.008, 0.004, -0.008] },
  street: { label: 'Street negative', after: 'Classic Neg', says: 'Colour film from a chemist: hard highlights, teal shadows, warm light.', m: [1.02, 0, -0.02, -0.01, 1, 0.01, -0.03, 0.06, 0.97], h: 0.24, s: 0.18, sat: 0.84, lift: 0.012, low: [-0.012, 0.007, 0.006], high: [0.012, -0.002, -0.010] },
  portrait: { label: 'Soft portrait', after: 'Pro Neg Std', says: 'Very soft tones and quiet colour, for faces.', m: [1.02, -0.01, -0.01, 0, 1, 0, 0, -0.01, 1.01], h: -0.1, s: -0.08, sat: 0.88, lift: 0.01 },
  bright: { label: 'Bright portrait', after: 'Pro Neg Hi', says: 'The same colour with more snap.', m: [1.02, -0.01, -0.01, 0, 1, 0, 0, -0.01, 1.01], h: 0.08, s: 0.14, sat: 0.95 },
  cinema: { label: 'Soft cinema', after: 'Eterna', says: 'Film for the cinema: flat, quiet, room in the shadows and highlights.', m: [0.97, 0.04, -0.01, 0.01, 0.99, 0, -0.02, 0.07, 0.95], h: -0.16, s: -0.16, sat: 0.68, lift: 0.026, low: [-0.008, 0.003, 0.006] },
  bleach: { label: 'Bleached cinema', after: 'Eterna Bleach Bypass', says: 'Silver left in the film: little colour, very hard.', m: [0.99, 0.02, -0.01, 0, 1, 0, -0.01, 0.03, 0.98], h: 0.22, s: 0.46, sat: 0.42, satHigh: 0.7 },
  amber: { label: 'Amber negative', after: 'Nostalgic Neg', says: 'Colour photographs of the 1970s: amber highlights, rich shadows.', m: [1.03, 0, -0.03, 0.01, 1, -0.01, -0.02, 0.01, 1.01], h: 0.02, s: 0.14, sat: 1.08, chrome: 0.2, low: [0.005, 0, -0.004], high: [0.02, 0.008, -0.02] },
  true: { label: 'True negative', after: 'Reala Ace', says: 'Faithful colour with a little more bite.', m: [1.01, 0, -0.01, 0, 1, 0, 0, 0, 1], h: 0.08, s: 0.16, sat: 1.02 },
  mono: { label: 'Fine mono', after: 'Acros', says: 'Black and white: deep, fine grain, rich in the middle.', m: mono(0.25, 0.65, 0.1), h: 0.12, s: 0.26, sat: 1, grain: 0.05, grainSize: 1.3 },
};

export const DIFFUSIONS = {
  none: { label: 'Off', p: { bloom: 0, veil: 0, softHigh: 0 } },
  mist: { label: 'Light mist', says: 'A small glow round bright things and a slight softening.', p: { bloom: 0.2, bloomFrom: 0.7, bloomSpread: 0.55, bloomTint: '#ffffff', veil: 0.02, softHigh: 0.2 } },
  highlight: { label: 'Highlight diffusion', says: 'In the manner of the filter in the Ricoh GR III HDF: bright parts bloom softly, and the picture\'s contrast falls a little.', p: { bloom: 0.42, bloomFrom: 0.45, bloomSpread: 0.72, bloomTint: '#fffaf4', veil: 0.05, softHigh: 0.5 } },
  heavy: { label: 'Heavy mist', says: 'A strong haze from every light.', p: { bloom: 0.8, bloomFrom: 0.25, bloomSpread: 0.85, bloomTint: '#ffffff', veil: 0.12, softHigh: 0.6 } },
  halation: { label: 'Halation', says: 'The red-orange ring film gets round its brightest parts.', p: { bloom: 0.5, bloomFrom: 1.1, bloomSpread: 0.45, bloomTint: '#ff6a3c', veil: 0, softHigh: 0 } },
};

export const FILTER_PRESETS = {
  none:      { label: 'None', p: {} },
  photocopy: { label: 'Photocopy', p: { saturation: 0, contrast: 1.5, grain: 0.13, soften: 0.8, vignette: 0.7 } },
  haze:      { label: 'Haze', p: { soften: 1.6, split: 3, saturation: 1.45, contrast: 1.06, vignette: 0.35, grain: 0.03, bloom: 0.25, bloomFrom: 0.45, bloomSpread: 0.55 } },
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

const lit = hex => hexRgb(hex).map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));

export function packPost(p, w, h, time, out = new Float32Array(POST_FLOATS)) {
  const q = { ...POST_DEFAULTS, ...oldGlow(p) };
  const b = q.band || { center: 0.5, half: 1, blur: 0 };
  const F = (q.film && FILM_LOOKS[q.film]) || null, a = F ? q.filmAmount : 0;
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1], m = I.map((v, k) => v + ((F ? F.m[k] : v) - v) * a);
  const num = (k, d) => (F && F[k] !== undefined ? d + (F[k] - d) * a : d);
  const vec = k => (F && F[k] ? F[k].map(v => v * a) : [0, 0, 0]);
  const on = F || q.highlights || q.shadows || q.colour || q.warmth || q.green || q.chrome ? 1 : 0;
  const hi = num('h', 0) + q.highlights * 0.45, lo = num('s', 0) + q.shadows * 0.45;
  const sat = num('sat', 1) * (1 + q.colour * 0.7), satLow = num('satLow', 1), satHigh = num('satHigh', 1);
  const grain = Math.max(q.grain, F && F.grain ? F.grain * a : 0), grainSize = q.grain ? q.grainSize : F && F.grainSize ? F.grainSize : q.grainSize;
  const wb = [1 + q.warmth * 0.1, 1 + q.green * 0.06, 1 - q.warmth * 0.12];
  out.set([q.saturation, q.contrast, q.posterize, grain,
    q.split, q.scan, q.soften, time,
    b.center, b.half, b.blur, q.vignette,
    q.lift, w, h, grainSize,
    ...hexRgb(q.tint), q.tintAmount,
    wantsBloom(q) ? 1 : 0, q.sharpen, q.ink, q.clarity,
    on, sat, satLow, satHigh,
    m[0], m[1], m[2], hi,
    m[3], m[4], m[5], lo,
    m[6], m[7], m[8], num('lift', 0),
    ...vec('low'), num('chrome', 0) + q.chrome,
    ...vec('high'), q.softHigh,
    ...wb, q.veil,
    ...lit(q.bloomTint), q.bloom,
  ]);
  return out;
}
export function bloomNumbers(p) {
  const q = { ...POST_DEFAULTS, ...oldGlow(p) };
  return [q.bloomFrom, 0.5, 0.25 + q.bloomSpread * 0.85, 0];
}

export const POST_SHADER =  `
struct Post {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  f: vec4<f32>,
  g: vec4<f32>,
  h: vec4<f32>,
  i: vec4<f32>,
  j: vec4<f32>,
  k: vec4<f32>,
  l: vec4<f32>,
  m: vec4<f32>,
  n: vec4<f32>,
};
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var pic: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var hdr: texture_2d<f32>;
@group(0) @binding(4) var glow: texture_2d<f32>;

@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}

fn hashP(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }
fn toned(x: vec3<f32>) -> vec3<f32> {
  let c = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
  return pow(c, vec3<f32>(1.0 / 2.2));
}
fn grainAt(p: vec2<f32>, s: f32, seed: f32) -> f32 {
  let q = p / s;
  let i = floor(q);
  let f = fract(q);
  let u = f * f * (3.0 - 2.0 * f);
  let n = mix(mix(hashP(i + seed), hashP(i + vec2<f32>(1.0, 0.0) + seed), u.x), mix(hashP(i + vec2<f32>(0.0, 1.0) + seed), hashP(i + vec2<f32>(1.0, 1.0) + seed), u.x), u.y);
  return n - 0.5;
}
fn filmOf(c0: vec3<f32>) -> vec3<f32> {
  var c = c0 * P.m.rgb;
  c = vec3<f32>(dot(c, P.h.rgb), dot(c, P.i.rgb), dot(c, P.j.rgb));
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  let hi = c * c * (vec3<f32>(1.0) - c);
  let lo = c * (vec3<f32>(1.0) - c) * (vec3<f32>(1.0) - c);
  c = c + hi * P.h.a * 1.2 - lo * P.i.a * 1.2;
  let l = lumP(c);
  let sat = P.g.y * mix(P.g.z, P.g.w, smoothstep(0.1, 0.9, l));
  c = mix(vec3<f32>(l), c, sat);
  let strong = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = c * (1.0 - P.k.a * 0.4 * strong * strong);
  let d = (1.0 - l) * (1.0 - l);
  c = c + P.k.rgb * d + P.l.rgb * l * l;
  return c + vec3<f32>(P.j.a) * (vec3<f32>(1.0) - c);
}
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
  if (P.l.a > 0.0) {
    let near = soft(uv, 2.5 + 3.0 * P.l.a) * 0.6 + soft(uv, 7.0) * 0.4;
    let bright = smoothstep(0.55, 0.95, max(lumP(col), lumP(near)));
    col = mix(col, max(col, near), P.l.a * bright);
  }
  if (abs(P.f.w) > 0.0) { col = col + (col - soft(uv, 12.0)) * P.f.w * 0.8; }
  if (P.f.y > 0.0) { col = col + (col - soft(uv, 1.2)) * P.f.y * 1.5; }
  if (P.f.x > 0.5) {
    let h = max(textureSampleLevel(hdr, samp, uv, 0.0).rgb, vec3<f32>(0.0));
    let g = textureSampleLevel(glow, samp, uv, 0.0).rgb * P.n.rgb * P.n.a;
    let mean = textureSampleLevel(glow, samp, uv, f32(textureNumLevels(glow) - 1u)).a * P.m.a;
    let lessOwn = 1.0 - min(P.n.a * 0.25 + P.m.a, 0.6);
    col = col + toned(h * lessOwn + g + vec3<f32>(mean)) - toned(h);
  }
  if (P.f.z > 0.0) {
    let t = 1.5 / res;
    let gx = lumP(textureSampleLevel(pic, samp, uv + vec2<f32>(t.x, 0.0), 0.0).rgb) - lumP(textureSampleLevel(pic, samp, uv - vec2<f32>(t.x, 0.0), 0.0).rgb);
    let gy = lumP(textureSampleLevel(pic, samp, uv + vec2<f32>(0.0, t.y), 0.0).rgb) - lumP(textureSampleLevel(pic, samp, uv - vec2<f32>(0.0, t.y), 0.0).rgb);
    let edge = smoothstep(0.04, 0.2, length(vec2<f32>(gx, gy)));
    col = mix(col, col * 0.12, edge * P.f.z);
  }
  if (P.g.x > 0.5) { col = filmOf(col); }
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
  if (P.a.w > 0.0) {
    let t = lumP(col);
    let mid = 0.35 + 0.65 * (1.0 - abs(2.0 * clamp(t, 0.0, 1.0) - 1.0));
    col = col + vec3<f32>(grainAt(fc.xy, max(P.d.w, 1.0), fract(P.b.w * 7.13) * 311.0) * P.a.w * mid * 1.6);
  }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

export const BLOOM_SHADER =  `
@group(0) @binding(0) var<uniform> U: vec4<f32>;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn at(uv: vec2<f32>) -> vec4<f32> { return textureSampleLevel(src, samp, uv, 0.0); }
fn thirteen(uv: vec2<f32>, t: vec2<f32>) -> vec4<f32> {
  let o = (at(uv + t * vec2<f32>(-1.0, -1.0)) + at(uv + t * vec2<f32>(1.0, -1.0)) + at(uv + t * vec2<f32>(-1.0, 1.0)) + at(uv + t * vec2<f32>(1.0, 1.0))) * 0.125;
  let a = (at(uv + t * vec2<f32>(-2.0, -2.0)) + at(uv + t * vec2<f32>(2.0, -2.0)) + at(uv + t * vec2<f32>(-2.0, 2.0)) + at(uv + t * vec2<f32>(2.0, 2.0))) * 0.03125;
  let b = (at(uv + t * vec2<f32>(-2.0, 0.0)) + at(uv + t * vec2<f32>(2.0, 0.0)) + at(uv + t * vec2<f32>(0.0, -2.0)) + at(uv + t * vec2<f32>(0.0, 2.0))) * 0.0625;
  return o + a + b + at(uv) * 0.125;
}
@fragment fn fsFirst(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(src));
  let uv = fc.xy * 2.0 / size;
  let c = thirteen(uv, 1.0 / size);
  let top = max(c.r, max(c.g, c.b));
  let soft = U.x * U.y + 1e-4;
  let knee = clamp(top - U.x + soft, 0.0, 2.0 * soft);
  let k = max(knee * knee / (4.0 * soft), top - U.x) / max(top, 1e-4);
  return vec4<f32>(min(c.rgb * k, vec3<f32>(30.0)), dot(min(c.rgb, vec3<f32>(4.0)), vec3<f32>(0.33)));
}
@fragment fn fsDown(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(src));
  return thirteen(fc.xy * 2.0 / size, 1.0 / size);
}
@fragment fn fsUp(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(src));
  let uv = fc.xy / (size * 2.0);
  let t = 1.0 / size;
  var c = at(uv) * 4.0;
  c = c + (at(uv + t * vec2<f32>(1.0, 0.0)) + at(uv - t * vec2<f32>(1.0, 0.0)) + at(uv + t * vec2<f32>(0.0, 1.0)) + at(uv - t * vec2<f32>(0.0, 1.0))) * 2.0;
  c = c + at(uv + t) + at(uv - t) + at(uv + t * vec2<f32>(1.0, -1.0)) + at(uv + t * vec2<f32>(-1.0, 1.0));
  return vec4<f32>(c.rgb / 16.0 * U.z, 0.0);
}
`;
