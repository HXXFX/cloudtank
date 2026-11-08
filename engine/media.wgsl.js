export const MEDIA_FLOATS = 84;

export const MEDIA_DEFAULTS = {
  preset: 'none',
  res: 0, aspect: 0, bezel: '#0c0c0e', snap: 0,
  gain: 1, contrast: 1, gamma: 1, invert: 0, edge: 0, threshold: 0, soft: 0.05,
  bits: 0, dither: 0, ditherSize: 1, palette: 0, smoothPalette: 0, c0: '#000000', c1: '#555555', c2: '#aaaaaa', c3: '#ffffff',
  tear: 0, roll: 0, jitter: 0, blocks: 0, split: 0, noise: 0, flicker: 0,
  curve: 0, scan: 0, mask: 0, grid: 0, glow: 0, ghost: 0, vignette: 0,
  halftone: 0, angle: 45, cmyk: 0, hatch: 0, carve: 0, inks: 0, ink1: '#141414', ink2: '#ff4f6e', misreg: 0, paper: '#f4f1e8', paperGrain: 0,
  speck: 0, streak: 0, dropout: 0, skew: 0,
  radar: 0, sweep: 0.25, rings: 4, beam: '#7dff9a',
  amount: 1,
};

export const MEDIA_PRESETS = {
  none: { label: 'None', says: 'The picture as it is.', p: {} },
  copier: { label: 'Broken copier', says: 'A worn black and white copier: hard tones, streaks along the page, toner missing, specks, the page crooked.', p: { contrast: 1.5, threshold: 0.66, soft: 0.09, inks: 1, ink1: '#111111', paper: '#f1efe6', paperGrain: 0.3, skew: 0.7, streak: 0.6, dropout: 0.55, speck: 0.55, tear: 0.06, vignette: 0.35 } },
  crt: { label: 'Glitching CRT', says: 'A failing tube monitor: lines torn sideways, blocks out of place, colours apart, static, curved glass.', p: { res: 640, curve: 0.45, scan: 0.5, mask: 0.4, glow: 0.5, tear: 0.55, jitter: 0.35, blocks: 0.3, split: 3, noise: 0.1, flicker: 0.14, vignette: 0.75, ghost: 0.18 } },
  xray: { label: 'Medical X-ray', says: 'A film on a light box: light and dark turned round, in blue-grey, edges standing out.', p: { invert: 1, contrast: 1.25, gamma: 1.05, palette: 4, smoothPalette: 1, c0: '#04070d', c1: '#2b4a66', c2: '#9fc3d6', c3: '#f4fbff', edge: 0.9, glow: 0.3, noise: 0.06, vignette: 0.55 } },
  radar: { label: 'Old radar', says: 'What a radar finds, edges and dark places, as steady green echoes over the whole picture.', p: { radar: 1, beam: '#7dff9a', noise: 0.05, glow: 0.55, scan: 0.12 } },
  woodcut: { label: 'Woodcut', says: 'One black ink on paper, in carved lines.', p: { contrast: 1.35, carve: 0.85, inks: 1, ink1: '#15120f', paper: '#efe6d2', paperGrain: 0.35, edge: -0.5 } },
  linocut: { label: 'Linocut', says: 'One red ink on paper, in broad carved lines.', p: { contrast: 1.5, carve: 0.6, inks: 1, ink1: '#b3261e', paper: '#f2eadb', paperGrain: 0.3, edge: -0.3 } },
  etching: { label: 'Etching', says: 'Fine crossed lines in black ink: the darker, the more of them.', p: { hatch: 1, inks: 1, ink1: '#1a1712', paper: '#ece5d4', paperGrain: 0.3, edge: -0.4, contrast: 1.2 } },
  riso: { label: 'Risograph', says: 'Two bright inks out of register, grainy, on off-white paper.', p: { inks: 2, ink1: '#1f4fd1', ink2: '#ff4f6e', misreg: 3, paper: '#f6f2e7', paperGrain: 0.45, contrast: 1.15 } },
  screenprint: { label: 'Screen print', says: 'Four flat colours, no tones between them.', p: { palette: 4, c0: '#1a1a2e', c1: '#e94560', c2: '#f5c518', c3: '#f7f3e9', contrast: 1.15, gamma: 0.72, dither: 0, paperGrain: 0.25, paper: '#ffffff' } },
  newspaper: { label: 'Newspaper', says: 'Black dots on grey paper.', p: { halftone: 6, angle: 45, inks: 1, ink1: '#1a1a1a', paper: '#e9e4d8', paperGrain: 0.2, contrast: 1.15 } },
  comic: { label: 'Colour dots', says: 'Cyan, magenta, yellow and black dots, each at its own angle, as in an old comic.', p: { halftone: 7, cmyk: 1, paper: '#fbf8ef', contrast: 1.1 } },
  console32: { label: '32-bit console', says: 'In the manner of the first Sony PlayStation: low resolution, few colours with ordered dither between them, shapes that wobble on the pixel grid.', p: { res: 320, bits: 5, dither: 0.85, snap: 1, contrast: 1.05 } },
  handheld: { label: 'Pocket handheld', says: 'In the manner of the Nintendo Game Boy: 160 by 144, four shades of green, a grid of pixels, a slow screen, in its frame.', p: { res: 160, aspect: 0.9, palette: 4, c0: '#0f380f', c1: '#306230', c2: '#8bac0f', c3: '#9bbc0f', gamma: 0.72, contrast: 1.25, dither: 0.35, grid: 0.4, ghost: 0.45, bezel: '#8b8d7a' } },
  home8bit: { label: '8-bit computer', says: 'A home computer of the 1980s: big pixels, four levels of each colour, a soft tube.', p: { res: 256, bits: 2, dither: 0.7, scan: 0.25, glow: 0.25, vignette: 0.3 } },
  vhs: { label: 'VHS tape', says: 'A worn tape: colours pulled apart, lines wandering, a torn band, snow.', p: { res: 480, split: 2.5, jitter: 0.25, tear: 0.22, noise: 0.09, scan: 0.1, glow: 0.3, contrast: 0.95 } },
  night: { label: 'Night vision', says: 'A green image tube: bright, grainy, dark at the edge.', p: { gain: 1.1, gamma: 0.8, palette: 4, smoothPalette: 1, c0: '#000000', c1: '#0a3a12', c2: '#3fd35a', c3: '#d6ffdc', noise: 0.2, vignette: 1.1, glow: 0.6, scan: 0.08 } },
  thermal: { label: 'Heat camera', says: 'Bright parts as hot: from dark purple through orange to pale yellow.', p: { res: 320, palette: 4, smoothPalette: 1, c0: '#0a0420', c1: '#7a1fa2', c2: '#ff7a18', c3: '#fff6b0', contrast: 1.1 } },
  blueprint: { label: 'Blueprint', says: 'White lines on blue paper.', p: { edge: 1.4, invert: 1, contrast: 1.4, palette: 4, smoothPalette: 1, c0: '#0b2a6b', c1: '#0f3a8a', c2: '#6ea0ff', c3: '#ffffff', paperGrain: 0.15, paper: '#ffffff' } },
  fax: { label: 'Fax', says: 'Black and white only, coarse, lines slipping sideways.', p: { res: 480, threshold: 0.72, soft: 0.01, inks: 1, ink1: '#0d0d0d', paper: '#f4f2ea', streak: 0.3, tear: 0.12, contrast: 1.3 } },
};

export const MEDIA_LIST = [
  { key: 'copier', name: 'Photocopier', also: ['fax'] },
  { key: 'crt', name: 'CRT monitor', also: ['vhs'] },
  { key: 'xray', name: 'Medical X-ray', also: ['night', 'thermal', 'blueprint', 'screenprint'], says: 'A film on a light box: light and dark turned round, in blue-grey, edges standing out. Its four map colours make night vision, a heat camera, a blueprint or a screen print.' },
  { key: 'radar', name: 'Old radar', also: [] },
  { key: 'woodcut', name: 'Woodcut', also: ['linocut', 'etching'], says: 'One black ink on paper, in carved lines. Red ink and broader lines make a linocut; crosshatch in place of carving, an etching.' },
  { key: 'riso', name: 'Risograph', also: ['newspaper', 'comic'], says: 'Two bright inks out of register, grainy, on off-white paper. One ink in halftone dots makes a newspaper; CMYK dots, a comic.' },
  { key: 'console32', name: 'PlayStation', also: ['home8bit'], says: 'In the manner of the first Sony PlayStation: low resolution, few colours with ordered dither between them, shapes that wobble on the pixel grid. Fewer colours and a soft tube make an 8-bit home computer.' },
  { key: 'handheld', name: 'Game Boy', also: [] },
].map(m => ({ ...m, says: m.says || MEDIA_PRESETS[m.key].says }));

export function effectiveMedia(m) {
  if (!m) return null;
  const L = m.look && MEDIA_PRESETS[m.look];
  const out = L ? { ...L.p } : {};
  for (const [k, v] of Object.entries(m)) if (k !== 'look' && k !== 'preset' && v !== undefined) out[k] = v;
  return out;
}
const same = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 1e-9 : JSON.stringify(x ?? null) === JSON.stringify(y ?? null));
export function upgradeMedia(m) {
  if (!m || m.look !== undefined) return m;
  const id = m.preset;
  delete m.preset;
  if (!id || id === 'none' || !MEDIA_PRESETS[id]) return m;
  m.look = id;
  const b = MEDIA_PRESETS[id].p;
  for (const k of Object.keys(m)) if (k !== 'look' && k !== 'amount' && MEDIA_DEFAULTS[k] !== undefined && same(m[k], b[k] !== undefined ? b[k] : MEDIA_DEFAULTS[k])) delete m[k];
  return m;
}

export function mediaIsNone(m) {
  if (!m) return true;
  const q = { ...MEDIA_DEFAULTS, ...m };
  if (!(q.amount > 0)) return true;
  return !q.res && !q.aspect && q.gain === 1 && q.contrast === 1 && q.gamma === 1 && !q.invert && !q.edge && !q.threshold && !q.bits && !q.palette && !q.tear && !q.roll && !q.jitter && !q.blocks && !q.split && !q.noise && !q.flicker &&
    !q.curve && !q.scan && !q.mask && !q.grid && !q.glow && !q.ghost && !q.vignette && !q.halftone && !q.hatch && !q.carve && !q.inks && !q.speck && !q.streak && !q.dropout && !q.skew && !q.radar;
}

const hexRgb = hex => { const n = parseInt((hex || '#ffffff').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export function packMedia(m, w, h, time, out = new Float32Array(MEDIA_FLOATS)) {
  const q = { ...MEDIA_DEFAULTS, ...m };
  out.set([
    q.res, q.aspect, time, q.ditherSize,
    w, h, q.gain, q.contrast,
    q.gamma, q.invert, q.edge, q.threshold,
    q.soft, q.bits, q.dither, q.palette,
    q.smoothPalette, q.tear, q.roll, q.jitter,
    ...hexRgb(q.c0), q.blocks,
    ...hexRgb(q.c1), q.split,
    ...hexRgb(q.c2), q.noise,
    ...hexRgb(q.c3), q.flicker,
    q.curve, q.scan, q.mask, q.grid,
    q.glow, q.ghost, q.vignette, q.halftone,
    q.angle, q.cmyk, q.hatch, q.carve,
    ...hexRgb(q.ink1), q.inks,
    ...hexRgb(q.ink2), q.misreg,
    ...hexRgb(q.paper), q.paperGrain,
    ...hexRgb(q.bezel), q.speck,
    q.streak, q.dropout, q.skew, q.radar,
    ...hexRgb(q.beam), q.sweep,
    q.rings, q.amount ?? 1, 0, 0,
  ]);
  return out;
}

export const MEDIA_SHADER =  `
struct Media {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  d: vec4<f32>,
  e: vec4<f32>,
  c0: vec4<f32>,
  c1: vec4<f32>,
  c2: vec4<f32>,
  c3: vec4<f32>,
  f: vec4<f32>,
  g: vec4<f32>,
  h: vec4<f32>,
  i: vec4<f32>,
  j: vec4<f32>,
  k: vec4<f32>,
  l: vec4<f32>,
  m: vec4<f32>,
  n: vec4<f32>,
  o: vec4<f32>,
};
@group(0) @binding(0) var<uniform> M: Media;
@group(0) @binding(1) var pic: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var last: texture_2d<f32>;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn at(uv: vec2<f32>) -> vec3<f32> { return textureSampleLevel(pic, samp, uv, 0.0).rgb; }
fn lum(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.299, 0.587, 0.114)); }
fn rnd(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn lump(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rnd(i), rnd(i + vec2<f32>(1.0, 0.0)), u.x), mix(rnd(i + vec2<f32>(0.0, 1.0)), rnd(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn clouds(p: vec2<f32>) -> f32 { return lump(p) * 0.55 + lump(p * 2.1 + 7.3) * 0.3 + lump(p * 4.3 + 3.1) * 0.15; }
fn bayer(p: vec2<f32>) -> f32 {
  var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  let q = vec2<u32>(p) % vec2<u32>(4u);
  return (m[q.y * 4u + q.x] + 0.5) / 16.0;
}
fn tone(c0: vec3<f32>) -> vec3<f32> {
  var c = c0;
  if (M.c.y > 0.5) { c = vec3<f32>(1.0) - c; }
  c = c * M.b.z;
  c = (c - 0.5) * M.b.w + 0.5;
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / max(M.c.x, 0.01)));
}
fn rot(p: vec2<f32>, deg: f32) -> vec2<f32> {
  let a = deg * 0.0174533;
  let s = sin(a);
  let k = cos(a);
  return vec2<f32>(p.x * k - p.y * s, p.x * s + p.y * k);
}
fn dots(fc: vec2<f32>, cell: f32, deg: f32, which: i32) -> f32 {
  let r = rot(fc, deg) / cell;
  let mid = (floor(r) + 0.5) * cell;
  let c = rot(mid, -deg) / M.b.xy;
  let s = tone(at(c));
  var dark = 1.0 - lum(s);
  if (which >= 0) {
    let k = 1.0 - max(s.r, max(s.g, s.b));
    if (which == 3) { dark = k * 0.9; }
    else { dark = clamp((1.0 - s[which] - k) / max(1.0 - k, 0.01), 0.0, 1.0); }
  }
  let d = length(fract(r) - vec2<f32>(0.5)) * cell;
  let rr = sqrt(clamp(dark, 0.0, 1.0)) * cell * 0.72;
  return 1.0 - smoothstep(rr - 0.8, rr + 0.8, d);
}
fn hatchLine(fc: vec2<f32>, deg: f32, gap: f32, weight: f32) -> f32 {
  let y = rot(fc, deg).y + (lump(rot(fc, deg + 90.0) * 0.02) - 0.5) * 3.0;
  return 1.0 - smoothstep(weight, weight + 0.9, abs(fract(y / gap) - 0.5) * gap);
}
@fragment fn fsMedia(@builtin(position) fc4: vec4<f32>) -> @location(0) vec4<f32> {
  let c = mediaAt(fc4);
  if (M.o.y >= 1.0) { return c; }
  return vec4<f32>(mix(at(fc4.xy / M.b.xy), c.rgb, M.o.y), 1.0);
}
fn mediaAt(fc4: vec4<f32>) -> vec4<f32> {
  let size = M.b.xy;
  let fc = fc4.xy;
  var uv = fc / size;
  let t = M.a.z;
  let tick = floor(t * 24.0);
  if (M.a.y > 0.0) {
    let have = size.y / size.x;
    var fit = vec2<f32>(1.0);
    if (have > M.a.y) { fit.y = M.a.y / have; } else { fit.x = have / M.a.y; }
    fit = fit * 0.94;
    uv = (uv - 0.5) / fit + 0.5;
  }
  if (M.f.x > 0.0) { let q = uv - 0.5; uv = 0.5 + q * (1.0 + M.f.x * dot(q, q) * 0.9) / (1.0 + M.f.x * 0.11); }
  if (M.m.z != 0.0) {
    let q = (uv - 0.5) * size;
    uv = rot(q, M.m.z + sin(floor(t * 0.5)) * M.m.z * 0.15) / size + 0.5;
  }
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) {
    let c = select(M.l.rgb, M.l.rgb * 0.04, M.m.z != 0.0);
    return vec4<f32>(c, 1.0);
  }
  if (M.m.w > 0.5) {
    let side = min(size.x, size.y) * 0.47;
    let q = (fc - size * 0.5) / side;
    let r = length(q);
    let ang = fract(atan2(q.x, -q.y) / 6.2831853 + 1.0);
    let bin = vec2<f32>((floor(ang * 240.0) + 0.5) / 240.0 * 6.2831853, (floor(r * 72.0) + 0.5) / 72.0);
    let s = vec2<f32>(sin(bin.x), -cos(bin.x)) * bin.y;
    let cuv = clamp((size * 0.5 + s * side) / size, vec2<f32>(0.0), vec2<f32>(1.0));
    let e = 3.0 / size;
    let a0 = lum(at(cuv));
    let echo0 = abs(a0 - lum(at(cuv + vec2<f32>(e.x, 0.0)))) + abs(a0 - lum(at(cuv + vec2<f32>(0.0, e.y))));
    let echo = clamp(smoothstep(0.015, 0.09, echo0) + smoothstep(0.75, 0.95, 1.0 - a0) * 0.8, 0.0, 1.0) * (0.75 + 0.25 * rnd(floor(vec2<f32>(ang * 240.0, r * 72.0))));
    var col = M.n.rgb * (echo * 0.85 + 0.03);
    let nn = (rnd(fc + tick) - 0.5) * M.c2.w * 0.6;
    col = col + M.n.rgb * nn;
    if (M.g.x > 0.0) { col = col + M.n.rgb * echo * M.g.x * 0.35; }
    if (M.f.y > 0.0) { col = col * (1.0 - M.f.y * (0.5 + 0.5 * cos(fc.y * 2.0944))); }
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }
  var su = uv;
  if (M.e.z > 0.0) { su.y = fract(su.y + M.e.z * t * 0.21 + sin(t * 0.7) * M.e.z * 0.05); }
  let line = floor(su.y * size.y * 0.5);
  if (M.e.w > 0.0) { su.x = su.x + (rnd(vec2<f32>(line, tick)) - 0.5) * M.e.w * 0.008 + sin(su.y * 22.0 + t * 3.0) * M.e.w * 0.0025; }
  if (M.e.y > 0.0) {
    for (var b = 0.0; b < 3.0; b = b + 1.0) {
      let slow = floor(t * 7.0 + b * 13.0);
      let where2 = rnd(vec2<f32>(slow, b));
      let thick2 = 0.008 + 0.09 * rnd(vec2<f32>(b, slow)) * rnd(vec2<f32>(slow + 4.0, b));
      if (rnd(vec2<f32>(slow, b + 9.0)) < 0.25 + M.e.y * 0.6 && abs(su.y - where2) < thick2) {
        su.x = su.x + (rnd(vec2<f32>(slow, b + 3.0)) - 0.5) * M.e.y * 0.35;
      }
    }
  }
  var swap = 0.0;
  if (M.c0.w > 0.0) {
    let slow = floor(t * 11.0);
    let grid2 = floor(su * vec2<f32>(18.0, 26.0));
    let h = rnd(grid2 + slow);
    if (h > 1.0 - M.c0.w * 0.22 * step(0.45, rnd(vec2<f32>(slow, 5.0)))) {
      su = su + (vec2<f32>(rnd(grid2 + 2.0 + slow), rnd(grid2 + 5.0 + slow)) - 0.5) * vec2<f32>(0.2, 0.05);
      swap = h;
    }
  }
  su = fract(su);
  var cellPx = vec2<f32>(1.0);
  var vp = fc;
  if (M.a.x > 0.0) {
    let across = M.a.x;
    let aspect = select(size.y / size.x, M.a.y, M.a.y > 0.0);
    let V = floor(vec2<f32>(across, across * aspect));
    let q = floor(su * V);
    vp = q;
    su = (q + 0.5) / V;
    cellPx = size / V;
  }
  let sp = M.c1.w / size.x;
  var col = at(su);
  if (sp > 0.0) { col = vec3<f32>(at(su + vec2<f32>(sp, 0.0)).r, col.g, at(su - vec2<f32>(sp, 0.0)).b); }
  if (swap > 0.0) { col = select(col.gbr, col.brg, swap > 0.95); }
  var edgeV = 0.0;
  if (M.c.z != 0.0) {
    let e = max(cellPx, vec2<f32>(1.3)) / size;
    let gx = lum(at(su + vec2<f32>(e.x, 0.0))) - lum(at(su - vec2<f32>(e.x, 0.0)));
    let gy = lum(at(su + vec2<f32>(0.0, e.y))) - lum(at(su - vec2<f32>(0.0, e.y)));
    edgeV = smoothstep(0.03, 0.28, length(vec2<f32>(gx, gy)));
  }
  let toned = tone(col);
  col = toned;
  if (M.c.z > 0.0) { col = col + vec3<f32>(edgeV * M.c.z); }
  if (M.c.z < 0.0) { col = col * (1.0 - edgeV * min(-M.c.z, 1.0)); }
  if (M.c.w > 0.0) { col = vec3<f32>(smoothstep(M.c.w - M.d.x, M.c.w + M.d.x, lum(col))); }
  let dth = bayer(vp / max(M.a.w, 1.0));
  let inks = M.i.w;
  var usedPaper = false;
  if (M.g.w > 0.0) {
    if (M.h.y > 0.5) {
      let c1 = dots(fc, M.g.w, 15.0, 0);
      let m1 = dots(fc, M.g.w, 75.0, 1);
      let y1 = dots(fc, M.g.w, 0.0, 2);
      let k1 = dots(fc, M.g.w, 45.0, 3);
      col = M.k.rgb * (vec3<f32>(1.0) - c1 * vec3<f32>(0.95, 0.15, 0.02)) * (vec3<f32>(1.0) - m1 * vec3<f32>(0.05, 0.95, 0.2)) * (vec3<f32>(1.0) - y1 * vec3<f32>(0.0, 0.08, 0.92)) * (1.0 - k1);
      usedPaper = true;
    } else {
      let ink = dots(fc, M.g.w, M.h.x, -1);
      col = mix(M.k.rgb, M.i.rgb, ink);
      usedPaper = true;
    }
  } else if (M.h.z > 0.0) {
    let dark = 1.0 - lum(col);
    var ink = 0.0;
    let gap = 5.0;
    if (dark > 0.14) { ink = max(ink, hatchLine(fc, 45.0, gap, 0.5 + dark * 0.6)); }
    if (dark > 0.4) { ink = max(ink, hatchLine(fc, -45.0, gap, 0.5 + dark * 0.5)); }
    if (dark > 0.62) { ink = max(ink, hatchLine(fc, 10.0, gap * 0.8, 0.5 + dark * 0.4)); }
    if (dark > 0.82) { ink = max(ink, hatchLine(fc, 100.0, gap * 0.7, 0.8)); }
    col = mix(M.k.rgb, M.i.rgb, ink * M.h.z);
    usedPaper = true;
  } else if (M.h.w > 0.0) {
    let warp = clouds(fc * 0.012) * 26.0;
    let along = rot(fc, 28.0 + warp * 0.6).y;
    let wave = 0.5 + 0.5 * sin(along * 0.9 + warp);
    let v = lum(col) + (wave - 0.5) * M.h.w;
    let ink = 1.0 - smoothstep(0.44, 0.56, v);
    col = mix(M.k.rgb, M.i.rgb, ink);
    usedPaper = true;
  } else if (inks > 1.5) {
    let off = vec2<f32>(M.j.w, M.j.w * 0.6) / size;
    let A = tone(at(su + off));
    let B = tone(at(su - off));
    let stip = rnd(floor(fc * 0.75)) * 0.75 + 0.125;
    let a = smoothstep(stip - 0.08, stip + 0.08, 1.0 - lum(A));
    let warm = clamp(B.r - B.b * 0.6 + 0.25 * (1.0 - lum(B)), 0.0, 1.0);
    let b = smoothstep(stip - 0.08, stip + 0.08, warm * 0.95);
    col = M.k.rgb * mix(vec3<f32>(1.0), M.i.rgb, a * 0.92) * mix(vec3<f32>(1.0), M.j.rgb, b * 0.92);
    usedPaper = true;
  } else if (inks > 0.5) {
    col = mix(M.i.rgb, M.k.rgb, lum(col));
    usedPaper = true;
  }
  if (M.m.x > 0.0) {
    let page = floor(t * 3.0);
    let s0 = lump(vec2<f32>(fc.x * 0.09, page * 0.13));
    let s1 = lump(vec2<f32>(fc.x * 0.55, 9.0));
    let dark2 = smoothstep(0.72, 0.9, s1) * M.m.x * 0.8;
    let thin = smoothstep(0.62, 0.92, s0) * M.m.x * 0.7;
    col = mix(col, M.k.rgb, thin * 0.8);
    col = mix(col, M.i.rgb, dark2 * (0.4 + 0.6 * rnd(vec2<f32>(fc.y * 0.3, fc.x))));
  }
  if (M.m.y > 0.0) {
    let hole = clouds(fc * 0.009 + vec2<f32>(3.1, floor(t * 0.6) * 1.7));
    let bite = smoothstep(0.62 - M.m.y * 0.2, 0.74 - M.m.y * 0.2, hole);
    let grainy = step(0.32, rnd(floor(fc * 0.7)));
    col = mix(col, M.k.rgb, bite * grainy * M.m.y);
  }
  if (M.l.w > 0.0) {
    let page = floor(t * 3.0);
    let dust = rnd(floor(fc / 2.0) + page * 3.7);
    if (dust > 1.0 - M.l.w * 0.012) { col = M.i.rgb; }
    let fibre = rnd(floor(fc / 2.0) * 0.5 + 91.0);
    if (fibre > 1.0 - M.l.w * 0.006) { col = M.k.rgb; }
  }
  if (usedPaper || M.k.w > 0.0) {
    let g = clouds(fc * 0.35) - 0.5;
    col = col * (1.0 + g * M.k.w * 0.35) + (rnd(fc) - 0.5) * M.k.w * 0.05;
  }
  if (M.d.w >= 2.0) {
    let n = M.d.w - 1.0;
    let l = clamp(lum(col) + (dth - 0.5) * M.d.z / n, 0.0, 1.0);
    if (M.e.x > 0.5) {
      let f = l * n;
      let i = min(floor(f), n - 1.0);
      let u = f - i;
      col = mix(palAt(i), palAt(i + 1.0), u);
    } else {
      col = palAt(min(floor(l * n + 0.5), 3.0));
    }
  }
  if (M.d.y > 0.0) {
    let n = pow(2.0, M.d.y) - 1.0;
    col = floor(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)) * n + vec3<f32>(dth * mix(0.5, 1.0, M.d.z) + (1.0 - M.d.z) * 0.25)) / n;
  }
  if (M.g.x > 0.0) {
    var g = vec3<f32>(0.0);
    let e = (max(cellPx, vec2<f32>(1.0)) * 2.5) / size;
    for (var i = 0.0; i < 8.0; i = i + 1.0) {
      let a = i * 0.7854;
      let c = tone(at(su + vec2<f32>(cos(a), sin(a)) * e));
      g = g + c * c;
    }
    col = col + g / 8.0 * M.g.x * 0.65;
  }
  if (M.f.y > 0.0) {
    let period = select(3.0, max(cellPx.y, 2.0), M.a.x > 0.0);
    col = col * (1.0 - M.f.y * (0.5 + 0.5 * cos((uv.y * size.y) * 6.2831853 / period)));
  }
  if (M.f.z > 0.0) {
    let k = i32(fc.x) % 3;
    var stripe = vec3<f32>(1.0 - M.f.z);
    stripe[k] = 1.0 + M.f.z * 0.5;
    col = col * stripe;
  }
  if (M.f.w > 0.0) {
    let inCell = fract(uv * size / cellPx);
    let border = min(min(inCell.x, 1.0 - inCell.x), min(inCell.y, 1.0 - inCell.y)) * min(cellPx.x, cellPx.y);
    col = col * (1.0 - M.f.w * (1.0 - smoothstep(0.3, 1.1, border)));
  }
  if (M.g.y > 0.0) {
    col = max(col, mix(col, textureSampleLevel(last, samp, fc / size, 0.0).rgb, M.g.y));
    col = mix(col, textureSampleLevel(last, samp, fc / size, 0.0).rgb, M.g.y * 0.5);
  }
  if (M.c2.w > 0.0) { col = col + (rnd(fc + tick * 1.7) - 0.5) * M.c2.w; }
  if (M.c3.w > 0.0) { col = col * (1.0 - M.c3.w * rnd(vec2<f32>(tick, 3.0))); }
  if (M.g.z > 0.0) { let q = uv - 0.5; col = col * (1.0 - M.g.z * dot(q, q) * 2.0); }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
fn palAt(i: f32) -> vec3<f32> {
  if (i < 0.5) { return M.c0.rgb; }
  if (i < 1.5) { return M.c1.rgb; }
  if (i < 2.5) { return M.c2.rgb; }
  return M.c3.rgb;
}
`;
