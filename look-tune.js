import { MATERIAL_KINDS } from './glass.js';
import { MATERIALS } from './liquid.js';

export const SHIPPED = {
  blur: 2.2, saturate: 1.9, brightness: 0.95, lens: 56, band: 39, radius: 8,
  light: { rim: 0.73, rimW: 1.7, back: 0.45, ring: 0.45, line: 0.07, shadow: 0, shadowBlur: 10, sheen: 0.58, sheenAngle: 135, sheenLen: 54,
    solid: 0.72, halo: 0.69, base: 0.06, most: 0.76, aim: 7.4, tint: '#ffffff', accent: '#c6e4f0', accentInk: '#0c1a20' },
  dark: { rim: 0.5, rimW: 1.5, back: 0.15, ring: 0.14, line: 0.25, shadow: 0.3, shadowBlur: 34, sheen: 0.14, sheenAngle: 135, sheenLen: 55,
    solid: 0.8, halo: 0.6, base: 0.06, most: 0.75, aim: 4.5, tint: '#0c0e12', accent: '#7fc4de', accentInk: '#0c1a20' },
};
export const SUGGESTED = {
  blur: 2, saturate: 1.8, brightness: 1.06, lens: 56, band: 28, radius: 14,
  light: { rim: 0.9, rimW: 1.5, back: 0.35, ring: 0.3, line: 0.1, shadow: 0.18, shadowBlur: 34, sheen: 0.32, sheenAngle: 135, sheenLen: 55,
    solid: 0.72, halo: 0.65, base: 0.06, most: 0.8, aim: 4.5, tint: '#ffffff', accent: '#3b9fc6', accentInk: '#0c1a20' },
  dark: { rim: 0.5, rimW: 1.5, back: 0.15, ring: 0.14, line: 0.25, shadow: 0.3, shadowBlur: 34, sheen: 0.14, sheenAngle: 135, sheenLen: 55,
    solid: 0.8, halo: 0.6, base: 0.06, most: 0.75, aim: 4.5, tint: '#0c0e12', accent: '#7fc4de', accentInk: '#0c1a20' },
};
export const ROUND24 = {
  blur: 1.2, saturate: 1.5, brightness: 1.03, lens: 34, band: 22, radius: 10,
  light: { rim: 0.55, rimW: 1, back: 0.16, ring: 0.14, line: 0, shadow: 0.16, shadowBlur: 30, sheen: 0.2, sheenAngle: 135, sheenLen: 40,
    solid: 0.72, halo: 0.65, base: 0.06, most: 0.8, aim: 4.5, tint: '#ffffff', accent: '#2b7891', accentInk: '#ffffff' },
  dark: { rim: 0.32, rimW: 1, back: 0.08, ring: 0.08, line: 0, shadow: 0.28, shadowBlur: 30, sheen: 0.1, sheenAngle: 135, sheenLen: 40,
    solid: 0.8, halo: 0.6, base: 0.06, most: 0.75, aim: 4.5, tint: '#0c0e12', accent: '#7fb6c9', accentInk: '#0c1a20' },
};

export const DIALS = [
  ['Glass', [
    ['blur', 'Blur', 0, 12, 0.1, 'px', 'How much the picture behind is softened.'],
    ['saturate', 'Colour lift', 0.5, 3, 0.05, '×', 'How much stronger the colours behind look through the glass.'],
    ['brightness', 'Brightness', 0.7, 1.4, 0.01, '×', 'Lighter or darker through the glass.'],
    ['radius', 'Corner radius', 4, 28, 1, 'px', 'Rounder corners bend the picture round them.'],
  ]],
  ['Edge bend', [
    ['lens', 'Bend', 0, 140, 1, 'px', 'How far the edge pulls what is behind it, as a thick lens does.'],
    ['band', 'Bend width', 4, 70, 1, 'px', 'How far in from the edge the bend reaches.'],
  ]],
  ['Light on the glass', [
    ['rim', 'Rim, lit side', 0, 1, 0.01, '', 'The bright line along the top and left edges.', true],
    ['rimW', 'Rim width', 0.5, 4, 0.1, 'px', '', true],
    ['back', 'Rim, far side', 0, 1, 0.01, '', 'The fainter line along the bottom and right edges.', true],
    ['ring', 'Edge, light', 0, 0.8, 0.01, '', 'A light hairline all round.', true],
    ['line', 'Edge, dark', 0, 0.5, 0.01, '', 'A dark hairline all round: keeps the edge visible over white.', true],
    ['sheen', 'Sheen', 0, 0.8, 0.01, '', 'A soft gleam across the glass.', true],
    ['sheenAngle', 'Sheen angle', 0, 360, 1, '°', '', true],
    ['sheenLen', 'Sheen length', 10, 100, 1, '%', '', true],
    ['shadow', 'Shadow', 0, 0.6, 0.01, '', 'The shadow under the glass.', true],
    ['shadowBlur', 'Shadow softness', 0, 80, 1, 'px', '', true],
  ]],
  ['Tint and text', [
    ['base', 'Least tint', 0, 0.7, 0.01, '', 'How clear the glass is where the text needs no help.', true],
    ['most', 'Most tint', 0.2, 0.98, 0.01, '', 'The most it may tint over a busy picture.', true],
    ['aim', 'Text contrast', 3, 10, 0.1, ': 1', 'How readable the text is kept: the glass tints just enough for it.', true],
    ['halo', 'Text halo', 0, 1, 0.01, '', 'A soft glow under the text.', true],
    ['solid', 'Under the pointer', 0.2, 1, 0.01, '', 'How firm the glass gets under the pointer.', true],
    ['tint', 'Tint colour', null, null, null, 'colour', '', true],
  ]],
  ['Colour', [
    ['accent', 'Accent', null, null, null, 'colour', 'The colour of chosen buttons, switches and the selection.', true],
    ['accentInk', 'Text on the accent', null, null, null, 'colour', '', true],
  ]],
];

const KEY = 'fluidsim.look';
const copy = x => JSON.parse(JSON.stringify(x));
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

export function stored() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; }
}
export function merge(base, diff) {
  const out = copy(base);
  for (const [k, v] of Object.entries(diff || {})) {
    if (v && typeof v === 'object' && out[k] && typeof out[k] === 'object') Object.assign(out[k], v);
    else if (k in out) out[k] = v;
  }
  return out;
}
export const tuned = () => merge(SHIPPED, stored());
export function diffOf(T) {
  const d = {};
  for (const [k, v] of Object.entries(T)) {
    if (v && typeof v === 'object') {
      const sub = {};
      for (const [k2, v2] of Object.entries(v)) if (SHIPPED[k][k2] !== v2) sub[k2] = v2;
      if (Object.keys(sub).length) d[k] = sub;
    } else if (SHIPPED[k] !== v) d[k] = v;
  }
  return d;
}
export function keep(T) {
  try { const d = diffOf(T); if (Object.keys(d).length) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch {}
}

export function cssOf(T, kind) {
  const K = T[kind], w = K.rimW;
  const white = a => `rgba(255, 255, 255, ${a})`;
  const solidRgb = kind === 'light' ? '255, 255, 255' : '22, 24, 28';
  return {
    '--glass-filter': `blur(${T.blur}px) saturate(${T.saturate}) brightness(${T.brightness})`,
    '--glass-edge': [`inset ${w}px ${w}px 0 ${white(K.rim)}`, `inset ${-w}px ${-w}px 0 ${white(K.back)}`,
      `inset 0 0 0 1px ${white(K.ring)}`, `0 0 0 1px rgba(0, 0, 0, ${K.line})`, `0 10px ${K.shadowBlur}px rgba(0, 0, 0, ${K.shadow})`].join(', '),
    '--glass-sheen': `linear-gradient(${K.sheenAngle}deg, ${white(K.sheen)}, rgba(255, 255, 255, 0) ${K.sheenLen}%)`,
    '--glass-solid': `rgba(${solidRgb}, ${K.solid})`,
    '--halo': kind === 'light' ? white(K.halo) : `rgba(0, 0, 0, ${K.halo})`,
    '--r': `${T.radius}px`,
  };
}

export function apply(app, T = tuned()) {
  app.lookTune = T;
  const root = document.documentElement, kind = root.dataset.theme === 'light' ? 'light' : 'dark';
  const clear = app.glassMaterial === 'clear';
  for (const [k, v] of Object.entries(cssOf(T, kind))) {
    if (clear) root.style.setProperty(k, v); else root.style.removeProperty(k);
  }
  root.style.setProperty('--accent', T[kind].accent);
  root.style.setProperty('--accent-ink', T[kind].accentInk);
  for (const kd of ['light', 'dark']) Object.assign(MATERIAL_KINDS.clear[kd], { base: T[kd].base, most: T[kd].most, aim: T[kd].aim, tint: hexRgb(T[kd].tint) });
  if (app.glass) { app.glass.last.clear(); for (const p of app.glass.panels) p.style.removeProperty('--glass'); }
  Object.assign(MATERIALS.clear, { lens: T.lens, band: T.band });
  if (app.liquid) { app.liquid.seen.clear(); app.liquid.refresh(); }
}

export function contrast(a, b) {
  const L = h => { const c = hexRgb(h).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const x = L(a), y = L(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
