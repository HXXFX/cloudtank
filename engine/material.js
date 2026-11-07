import { eulerAxes } from './math.js';

export const MAT_FLOATS = 36;
export const DECAL_FLOATS = 32;
export const MAX_DECALS = 64;

export const FINISH_LOOK = {
  plain:   { rough: 0.45, metal: 0, spec: 0.5, coat: 0, glow: 0, grain: 0 },
  matte:   { rough: 0.9, metal: 0, spec: 0.25, coat: 0, glow: 0, grain: 0 },
  gloss:   { rough: 0.12, metal: 0, spec: 0.5, coat: 0, glow: 0, grain: 0 },
  metal:   { rough: 0.32, metal: 1, spec: 0.5, coat: 0, glow: 0, grain: 1 },
  glass:   { rough: 0, metal: 0, spec: 0.5, coat: 0, glow: 0, grain: 0, ior: 1.5, depth: 1 },
  frosted: { rough: 0.5, metal: 0, spec: 0.5, coat: 0, glow: 0, grain: 0, ior: 1.5, depth: 1 },
};
export const isGlassLook = t => t.finish === 'glass' || t.finish === 'frosted';
export const finishOf = t => FINISH_LOOK[t.finish] ? t.finish : 'plain';
export const pbrValue = (t, k) => (t.pbr && t.pbr[k] !== undefined ? t.pbr[k] : FINISH_LOOK[finishOf(t)][k]);
export function setPbr(t, k, v) {
  t.pbr ||= {};
  if (Math.abs(v - FINISH_LOOK[finishOf(t)][k]) < 1e-6) delete t.pbr[k]; else t.pbr[k] = v;
  if (!Object.keys(t.pbr).length) delete t.pbr;
}

export const MAP_SLOTS = {
  color: { label: 'Colour', kind: 'color' },
  rough: { label: 'Roughness', kind: 'data' },
  metal: { label: 'Metallic', kind: 'data' },
  bump: { label: 'Bump', kind: 'data' },
  normal: { label: 'Normal', kind: 'data' },
  disp: { label: 'Displacement', kind: 'data' },
  alpha: { label: 'Opacity', kind: 'data' },
};
export function guessSlot(name) {
  const n = name.toLowerCase().replace(/\.[^.]+$/, '');
  const has = re => re.test(n);
  if (has(/(^|[^a-z])(normal|nrm|nor|norm)([^a-z]|$)|normalgl|normaldx/)) return 'normal';
  if (has(/(^|[^a-z])(rough|roughness|rgh|gloss)([^a-z]|$)/)) return 'rough';
  if (has(/(^|[^a-z])(metal|metallic|metalness|mtl)([^a-z]|$)/)) return 'metal';
  if (has(/(^|[^a-z])(disp|displace|displacement|height)([^a-z]|$)/)) return 'disp';
  if (has(/(^|[^a-z])(bump)([^a-z]|$)/)) return 'bump';
  if (has(/(^|[^a-z])(opacity|alpha|mask)([^a-z]|$)/)) return 'alpha';
  return 'color';
}

export const MAPPINGS = [['box', 'Box'], ['plane', 'Flat'], ['cylinder', 'Cylinder'], ['ball', 'Ball'], ['uv', 'Model']];
const MAP_KIND = { box: 0, plane: 1, cylinder: 2, ball: 3, uv: 4 };
const WRAP_KIND = { repeat: 0, mirror: 1, once: 2 };
const AXIS_KIND = { x: 0, y: 1, z: 2 };

export const TEX_DEFAULTS = { map: 'box', axis: 'z', wrap: 'repeat', w: 1, h: 1, x: 0, y: 0, rot: 0, mix: 1, bump: 0.01, normalK: 1, flipG: false, disp: 0.03, roughCh: 0, metalCh: 0, alphaCh: 0 };
export const texValue = (t, k) => (t.tex && t.tex[k] !== undefined ? t.tex[k] : TEX_DEFAULTS[k]);
export const hasMap = (t, slot) => !!(t.tex && t.tex.maps && t.tex.maps[slot]);
export const anyMap = t => !!(t.tex && t.tex.maps && Object.values(t.tex.maps).some(Boolean));
export const lookNeedsTex = t => anyMap(t) || !!(t.decals && t.decals.length);

export const DECAL_DEFAULTS = { x: 0, y: 0, rot: 0, opacity: 1, tint: [1, 1, 1], key: 'none', keyAt: 0.12, keySoft: 0.08, blend: 'normal', own: false, rough: 0.5, metal: 0, bump: 0, depth: 0.1, wrap: false, flipX: false, flipY: false };
export const decalValue = (d, k) => (d[k] !== undefined ? d[k] : DECAL_DEFAULTS[k]);
const BLEND_KIND = { normal: 0, multiply: 1, add: 2 };
const KEY_KIND = { none: 0, white: 1, black: 2 };

const mean = v => (v[0] + v[1] + v[2]) / 3;
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function decalAxes(d) {
  const n = norm3(d.dir);
  const ref = Math.abs(n[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
  const v0 = norm3(cross3(n, cross3(ref, n)));
  const u0 = cross3(v0, n);
  const a = decalValue(d, 'rot') * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { n, u0, v0, u: u0.map((x, k) => c * x + s * v0[k]), v: v0.map((x, k) => -s * u0[k] + c * x) };
}
export function decalPlace(d, half) {
  const { n, u0, v0, u, v } = decalAxes(d), k = half && d.ref ? mean(half) / d.ref : 1;
  const h = half || [1, 1, 1], x = decalValue(d, 'x') * k, y = decalValue(d, 'y') * k;
  const c = d.at.map((p, j) => p * h[j] + u0[j] * x + v0[j] * y);
  return { c, n, u, v, w: d.w * k, h: d.h * k, grown: k };
}

export function packLook(mats, i, t, { layer, half, outline = 0, decalData, decalAt = 0, finish = null, groundLook = null }) {
  const k = i * MAT_FLOATS, P = q => pbrValue(t, q);
  const maps = (t.tex && t.tex.maps) || {};
  const lay = slot => (maps[slot] ? layer(maps[slot], MAP_SLOTS[slot].kind) : -1);
  const T = q => texValue(t, q);
  const a = T('rot') * Math.PI / 180;
  const ownDecals = (t.decals || []).slice(0, Math.max(0, MAX_DECALS - decalAt));
  let shown = 0;
  for (const d of ownDecals) {
    const l = layer(d.image, 'color');
    if (l < 0) continue;
    packDecal(decalData, decalAt + shown, d, half, l);
    shown++;
  }
  const rough = groundLook && !(t.pbr && t.pbr.rough !== undefined) ? groundLook.rough : P('rough');
  const spec = groundLook && !(t.pbr && t.pbr.spec !== undefined) ? groundLook.spec * 0.5 : P('spec');
  mats.set([
    rough, P('metal'), 0.08 * spec, P('coat'),
    P('glow'), P('grain'), (t.pbr && t.pbr.ior) || 1.5, (t.pbr && t.pbr.depth !== undefined) ? t.pbr.depth : 1,
    T('mix'), T('roughCh'), T('metalCh'), outline,
    decalAt, shown, T('alphaCh'), 0,
    lay('color'), lay('rough'), lay('metal'), lay('alpha'),
    lay('bump'), lay('normal'), lay('disp'), MAP_KIND[T('map')] ?? 0,
    Math.max(T('w'), 1e-4), Math.max(T('h'), 1e-4), T('x'), T('y'),
    Math.cos(a), Math.sin(a), WRAP_KIND[T('wrap')] ?? 0, AXIS_KIND[T('axis')] ?? 2,
    T('bump'), T('normalK'), T('disp'), T('flipG') ? 1 : 0,
  ], k);
  return shown;
}

function packDecal(out, j, d, half, layer) {
  const p = decalPlace(d, half), V = q => decalValue(d, q);
  const w = Math.max(p.w, 1e-4), h = Math.max(p.h, 1e-4);
  const tint = V('tint');
  const az = Math.atan2(p.c[0], p.c[2]), radius = Math.max(Math.hypot(p.c[0], p.c[2]), 1e-3);
  out.set([
    ...p.c, layer,
    ...p.u, 1 / w,
    ...p.v, 1 / h,
    ...p.n, V('depth') * p.grown,
    ...tint, V('opacity'),
    V('own') ? V('rough') : -1, V('metal'), V('bump') * p.grown, BLEND_KIND[V('blend')] ?? 0,
    KEY_KIND[V('key')] ?? 0, V('keyAt'), Math.max(V('keySoft'), 1e-3), V('wrap') ? -2 : 0.05,
    V('flipX') ? 1 : 0, V('flipY') ? 1 : 0, V('wrap') ? radius : 0, az,
  ], j * DECAL_FLOATS);
}

export function newDecal(image, at, dir, half, aspect) {
  const big = half ? Math.max(...half) : 1;
  const w = Math.min(big * 0.9, 1.5), h = w / Math.max(aspect || 1, 1e-3);
  return { image, at: [...at], dir: norm3(dir), w, h, ref: half ? mean(half) : 1, depth: Math.max(0.03, big * 0.5) };
}

export function fitTile(half, aspect) {
  const w = half ? 2 * Math.max(half[0], half[1], half[2]) : 2;
  return { w: +w.toFixed(3), h: +(w / Math.max(aspect || 1, 1e-3)).toFixed(3) };
}

export function lookData(t) {
  const out = {};
  if (t.pbr) out.pbr = { ...t.pbr };
  if (t.tex) out.tex = JSON.parse(JSON.stringify(t.tex));
  if (t.decals && t.decals.length) out.decals = JSON.parse(JSON.stringify(t.decals));
  return out;
}

export function imagesOf(t, out = new Set()) {
  if (t.tex && t.tex.maps) for (const id of Object.values(t.tex.maps)) if (id) out.add(id);
  for (const d of t.decals || []) out.add(d.image);
  return out;
}

export { eulerAxes };
