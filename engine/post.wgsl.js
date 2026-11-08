export const POST_FLOATS = 80;
export const PIXEL_REF = 1974;

export const POST_DEFAULTS = {
  saturation: 1, contrast: 1, posterize: 0, grain: 0, grainSize: 1,
  split: 0, scan: 0, soften: 0,
  band: null,
  vignette: 0, lift: 0,
  tint: '#ffffff', tintAmount: 0,
  ink: 0,
  film: null, filmAmount: 1, highlights: 0, shadows: 0, colour: 0, warmth: 0, green: 0, chrome: 0, clarity: 0, sharpen: 0,
  bloom: 0, bloomFrom: 0.8, bloomSpread: 0.6, bloomTint: '#ffffff', veil: 0, softHigh: 0,
  aperture: 0, focus: 0, distort: 0, fringe: 0, flare: 0,
  lightAreas: 0, darkAreas: 0, resolution: 100, cellShape: 'square', dither: 'none', noise: 0, seed: 137, border: false, borderWidth: 30, keyline: true,
};

export const CELL_SHAPES = [
  ['square', 'Square', 'A solid block: plain pixels.'], ['circle', 'Circle'], ['ring', 'Ring'], ['diamond', 'Diamond'], ['triangle', 'Triangle'],
  ['hex', 'Hexagon'], ['plus', 'Plus', 'A crosshair.'], ['cross', 'Cross', 'An X.'], ['across', 'Lines across', 'Scan lines, one a cell.'], ['down', 'Lines down'],
  ['bars', 'Bars (print)', 'Black ink on paper: a bar rising in each cell as it darkens.'], ['dots', 'Dots (print)', 'A halftone: black dots on paper, larger where darker.'],
  ['squares', 'Squares (print)'], ['diamonds', 'Diamonds (print)'], ['lines', 'Line screen (print)', 'Lines that thicken as it darkens, as a thermal printer\'s.'],
].map(([id, label, says], i) => ({ id, label, says: says || label + '.', i, print: i >= 10 }));
export const DITHERS = [
  ['none', 'None', 'Keeps the grey levels.'], ['threshold', 'Black or white', 'Every cell black or white, split at mid grey.'],
  ['bayer4', 'Ordered 4 x 4', 'Black and white cells in a fixed pattern that reads as grey: a receipt.'], ['bayer8', 'Ordered 8 x 8', 'The same, finer.'],
  ['scatter', 'Scattered', 'Black and white cells scattered so they read as grey, like War Optics\' error diffusion (Floyd-Steinberg). True error diffusion works pixel after pixel, which the graphics card cannot do in one pass, so this is a fixed scatter.'],
].map(([id, label, says], i) => ({ id, label, says, i }));
function cover(i, x, y, a, aa) {
  const edge = d => (aa <= 0 ? (d > 0 ? 1 : 0) : Math.min(1, Math.max(0, d / aa + 0.5))), s = Math.sqrt(a), ax = Math.abs(x), ay = Math.abs(y);
  switch (i) {
    case 0: return 1;
    case 1: return edge(0.5 * s - Math.hypot(x, y));
    case 2: { const r = Math.hypot(x, y); return edge(Math.min(0.5 * s - r, r - 0.28 * s)); }
    case 3: return edge(0.5 * s * Math.SQRT2 - (ax + ay));
    case 4: { if (s <= 0) return 0; const nx = x / s, ny = y / s; return edge(Math.min(0.5 - ny, (ny + 0.5) * 0.5 - Math.abs(nx)) * s); }
    case 5: return edge(0.5 * s - Math.max(ax * 0.8660254 + ay * 0.5, ay));
    case 6: return edge(Math.max(Math.min(0.5 * s - ax, 0.16 * s - ay), Math.min(0.16 * s - ax, 0.5 * s - ay)));
    case 7: { const rx = Math.abs((x + y) * 0.7071068), ry = Math.abs((x - y) * 0.7071068); return edge(Math.max(Math.min(0.5 * s - rx, 0.15 * s - ry), Math.min(0.15 * s - rx, 0.5 * s - ry))); }
    case 8: return edge(0.34 * s - ay);
    case 9: return edge(0.34 * s - ax);
    default: return 0;
  }
}
const GAINS = CELL_SHAPES.map(S => {
  if (S.print) return 1;
  let sum = 0;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) sum += cover(S.i, (i + 0.5) / 32 - 0.5, (j + 0.5) / 32 - 0.5, 1, 0);
  const c = sum / 1024;
  return c > 0.001 ? Math.min(2.6, 1 / c) : 1;
});
export function cellsAcross(width, resolution, shape) {
  const t = Math.min(1, Math.max(0, 1 - resolution / 100));
  const cols = t === 0 ? width : Math.round(Math.exp(Math.log(2000) + (Math.log(18) - Math.log(2000)) * Math.pow(t, 0.65)));
  const most = Math.floor(width / (shape === 'square' ? 1 : 3));
  return Math.min(Math.max(cols, 18), Math.max(18, most));
}
export function buildOn(p) {
  if (!p) return false;
  const q = { ...POST_DEFAULTS, ...p };
  return q.resolution < 100 || q.cellShape !== 'square' || q.dither !== 'none' || q.noise > 0 || !!q.border;
}
const oldGlow = p => { if (!p.glow || p.bloom !== undefined) return p; const d = p.glowFrom ?? 0.7; return { ...p, bloom: Math.min(p.glow * 0.8, 1), bloomFrom: Math.max(0.1, Math.pow(d, 2.2) * 1.2), bloomSpread: 0.5 }; };

export function postIsNone(p) {
  if (!p) return true;
  const q = { ...POST_DEFAULTS, ...oldGlow(p) };
  return q.saturation === 1 && q.contrast === 1 && !q.posterize && !q.grain && !q.split && !q.scan && !q.soften &&
    !(q.band && q.band.blur > 0) && !q.vignette && !q.lift && !q.tintAmount && !q.ink &&
    !q.film && !q.highlights && !q.shadows && !q.colour && !q.warmth && !q.green && !q.chrome && !q.clarity && !q.sharpen && !q.bloom && !q.veil && !q.softHigh &&
    !q.aperture && !q.distort && !q.fringe && !q.flare && !q.lightAreas && !q.darkAreas && !buildOn(q);
}
export const wantsBloom = p => { if (!p) return false; const q = { ...POST_DEFAULTS, ...oldGlow(p) }; return q.bloom > 0 || q.veil > 0 || q.flare > 0; };

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
  rPositive: { label: 'Street slide', after: 'Ricoh GR III Positive Film', says: 'Saturated and contrasty, reds and blues pushed, deep shadows.', m: [1.1, -0.06, -0.04, -0.03, 1.07, -0.04, -0.04, -0.05, 1.09], h: 0.12, s: 0.3, sat: 1.28, chrome: 0.2, low: [0, -0.002, 0.008] },
  rNegative: { label: 'Quiet negative', after: 'Ricoh GR III Negative Film', says: 'Low contrast, soft colour, a little green in the shadows and warm in the light.', m: [1, 0.01, -0.01, 0, 1, 0, -0.01, 0.03, 0.98], h: -0.06, s: -0.04, sat: 0.82, lift: 0.018, low: [-0.006, 0.006, 0.002], high: [0.01, 0.004, -0.008] },
  rHard: { label: 'Hard mono', after: 'Ricoh GR III Hi-Contrast B&W', says: 'Black and white with little between: the street look, gritty.', m: mono(0.3, 0.6, 0.1), h: 0.45, s: 0.7, sat: 1, grain: 0.14, grainSize: 1.6 },
  rBleach: { label: 'Bleached street', after: 'Ricoh GR III Bleach Bypass', says: 'Colour drained, contrast high, cool.', m: [0.98, 0.02, 0, 0, 1, 0, 0, 0.02, 1], h: 0.25, s: 0.42, sat: 0.38, low: [-0.004, 0, 0.006] },
  rCross: { label: 'Cross process', after: 'Ricoh GR III Cross Process', says: 'Slide film in the wrong chemistry: green shadows, yellow light, hard.', m: [1.04, 0, -0.04, -0.02, 1.06, -0.04, -0.08, 0.06, 0.92], h: 0.2, s: 0.28, sat: 1.15, low: [-0.012, 0.012, 0.012], high: [0.016, 0.014, -0.03] },
  lClassic: { label: 'Classic rangefinder', after: 'Leica Classic', says: 'Calm, warm, rich in the middle tones and gentle in the highlights.', m: [1.03, 0, -0.03, 0, 1.01, -0.01, -0.02, -0.01, 1.01], h: -0.04, s: 0.2, sat: 0.96, high: [0.012, 0.006, -0.01], low: [0.002, 0, 0.002] },
  lContemporary: { label: 'Clean rangefinder', after: 'Leica Contemporary', says: 'Clean and neutral with a little more snap and clear blues.', m: [1.03, -0.02, -0.01, -0.01, 1.02, -0.01, -0.02, -0.01, 1.04], h: 0.06, s: 0.18, sat: 1.06 },
  lChrome: { label: 'Rangefinder chrome', after: 'Leica Chrome', says: 'The colour of old slide film: dense, a little muted, deep reds.', m: [1.06, -0.03, -0.03, -0.02, 1.01, 0.01, -0.03, 0.04, 0.96], h: 0.02, s: 0.32, sat: 0.92, chrome: 0.35, low: [0.002, 0, 0.004] },
  lMono: { label: 'Deep mono', after: 'Leica Monochrom', says: 'Black and white only: long smooth tones, very fine grain.', m: mono(0.3, 0.59, 0.11), h: -0.02, s: 0.16, sat: 1, grain: 0.025, grainSize: 1.1 },
  kPortra: { label: 'Portrait print', after: 'Kodak Portra 400', says: 'Warm and creamy, low contrast, kind to skin, soft greens.', m: [1.03, -0.01, -0.02, 0.01, 1, -0.01, -0.01, 0.01, 0.98], h: -0.08, s: 0.04, sat: 0.92, lift: 0.012, high: [0.014, 0.008, -0.008], grain: 0.03, grainSize: 1.4 },
  kChrome: { label: 'Slide of the 60s', after: 'Kodachrome', says: 'Deep saturated reds and yellows, cool shadows, hard.', m: [1.12, -0.05, -0.07, -0.02, 1.05, -0.03, -0.05, -0.05, 1.08], h: 0.1, s: 0.34, sat: 1.18, chrome: 0.4, low: [-0.004, 0, 0.012], high: [0.012, 0.004, -0.01] },
  kTri: { label: 'Press mono', after: 'Kodak Tri-X 400', says: 'Black and white with big grain and bite.', m: mono(0.28, 0.62, 0.1), h: 0.24, s: 0.36, sat: 1, grain: 0.13, grainSize: 1.9 },
  cTungsten: { label: 'Night tungsten', after: 'CineStill 800T', says: 'Cool film for lamplight: blue shadows; add its red halo with Halation below.', m: [0.98, 0.02, 0, 0, 1, 0, 0.02, 0.02, 1.04], h: 0.06, s: 0.18, sat: 1.02, low: [-0.01, 0, 0.016], grain: 0.05, grainSize: 1.5 },
  pInstant: { label: 'Instant print', after: 'Polaroid', says: 'Faded blacks, soft, green-blue shadows and warm light.', m: [0.98, 0.04, -0.02, 0, 0.98, 0.02, 0, 0.04, 0.94], h: -0.1, s: -0.1, sat: 0.84, lift: 0.05, low: [-0.012, 0.012, 0.018], high: [0.014, 0.01, -0.014] },
};

export const PHOTO_GROUPS = [
  ['Fujifilm', ['standard', 'vivid', 'soft', 'chrome', 'street', 'portrait', 'bright', 'cinema', 'bleach', 'amber', 'true', 'mono']],
  ['Ricoh GR III', ['rPositive', 'rNegative', 'rHard', 'rBleach', 'rCross', 'grHdf']],
  ['Leica', ['lClassic', 'lContemporary', 'lChrome', 'lMono', 'lSummilux']],
  ['film stocks', ['kPortra', 'kChrome', 'kTri', 'cTungsten', 'pInstant']],
];
export const PHOTO_PRESETS = {
  grHdf: { label: 'Street diffusion', after: 'Ricoh GR III HDF with Positive Film', says: 'Its colour and the highlight diffusion filter built into the HDF: bright parts bloom softly.', p: { film: 'rPositive', sharpen: 0.2, vignette: 0.18, bloom: 0.42, bloomFrom: 0.45, bloomSpread: 0.72, bloomTint: '#fffaf4', veil: 0.05, softHigh: 0.5, diffusion: 'highlight' } },
  lSummilux: { label: 'Wide open', after: 'a Leica Summilux lens wide open with Classic colour', says: 'Very shallow focus, a soft glow round bright parts, dark corners.', p: { film: 'lClassic', aperture: 0.75, vignette: 0.55, bloom: 0.25, bloomFrom: 0.55, bloomSpread: 0.6, softHigh: 0.25, diffusion: 'custom' } },
  rHard: { p: { film: 'rHard', vignette: 0.3, sharpen: 0.35 } },
  cTungsten: { p: { film: 'cTungsten', bloom: 0.5, bloomFrom: 1.1, bloomSpread: 0.45, bloomTint: '#ff6a3c', veil: 0, softHigh: 0, diffusion: 'halation' } },
  pInstant: { p: { film: 'pInstant', vignette: 0.4, soften: 0.4 } },
};
export const photoLabel = k => (PHOTO_PRESETS[k] && PHOTO_PRESETS[k].label) || (FILM_LOOKS[k] && FILM_LOOKS[k].label) || k;
export function photoTitle(k) {
  const P = PHOTO_PRESETS[k], F = FILM_LOOKS[k];
  const says = (P && P.says) || (F && F.says) || '', after = (P && P.after) || (F && F.after) || '';
  return `${says} In the manner of ${after.startsWith('a ') || /^(Ricoh|Leica|Kodak|Kodachrome|CineStill|Polaroid)/.test(after) ? after : 'Fujifilm ' + after}.`;
}

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
  waroptics: { label: 'War Optics', p: { saturation: 0, contrast: 1.19, lightAreas: 0.3, darkAreas: -0.3, resolution: 76, cellShape: 'hex', dither: 'none',
    grain: 0.19, grainSize: 2.4, noise: 0.72, seed: 178, distort: -0.45, vignette: 0.6, border: true, borderWidth: 3, keyline: false } },
};

const filmLook = k => ({ label: FILM_LOOKS[k].label, says: FILM_LOOKS[k].says, after: FILM_LOOKS[k].after, p: { film: k, ...((PHOTO_PRESETS[k] || {}).p || {}) } });
export const LOOK_GROUPS = [
  ['Fujifilm', ['standard', 'vivid', 'true', 'chrome', 'street', 'amber', 'cinema', 'bleach', 'mono']],
  ['Ricoh GR III', ['grHdf', 'rHard', 'rCross']],
  ['Leica', ['lClassic']],
  ['film stocks', ['kPortra', 'kChrome', 'cTungsten', 'pInstant']],
  ['Styles', ['waroptics', 'cyanotype', 'sepia', 'haze', 'drawing']],
];
const STYLE_SAYS = {
  waroptics: ['War Optics', 'Hard black and white, crushed blacks, blown whites, hexagon cells, grain over digital noise, a thin white border.', 'War Optics (waroptics.windnoise.org), a photo filter by the same maker'],
  cyanotype: ['Cyanotype', 'Blue and white, like a sun print.'], sepia: ['Sepia', 'Brown and cream, like an old print.'],
  haze: ['Haze', 'Soft and glowing, colours pushed up and a little apart.'], drawing: ['Drawing', 'A few flat tones and dark lines, like a diagram.'],
};
export const LOOKS = Object.fromEntries(LOOK_GROUPS.flatMap(([, keys]) => keys.map(k => {
  if (STYLE_SAYS[k]) { const [label, says, after] = STYLE_SAYS[k]; return [k, { label, says, after, p: FILTER_PRESETS[k].p }]; }
  if (PHOTO_PRESETS[k] && PHOTO_PRESETS[k].label) return [k, { label: PHOTO_PRESETS[k].label, says: PHOTO_PRESETS[k].says, after: PHOTO_PRESETS[k].after, p: PHOTO_PRESETS[k].p }];
  return [k, filmLook(k)];
})));
export const LOOK_LIST = [
  { key: 'kPortra', name: 'Kodak Portra', also: ['standard', 'true', 'amber', 'lClassic', 'street'] },
  { key: 'chrome', name: 'Classic Chrome', also: ['cinema', 'bleach', 'pInstant'] },
  { key: 'vivid', name: 'Fuji Velvia', also: ['kChrome'] },
  { key: 'grHdf', name: 'Ricoh GR HDF', also: ['haze'], says: 'Bright parts bloom softly, as through the diffusion filter built into the camera.' },
  { key: 'mono', name: 'Fuji Acros', also: ['rHard', 'sepia', 'cyanotype'], says: 'Black and white: deep, fine grain, rich in the middle. Colour grading tints it: brown for sepia, blue for a cyanotype.' },
  { key: 'rCross', name: 'Cross process', also: [] },
  { key: 'cTungsten', name: 'CineStill 800T', also: [], says: 'Cool film for lamplight: blue shadows and a red glow round bright lights.' },
  { key: 'waroptics', name: 'War Optics', also: [] },
].map(L => ({ ...L, says: L.says || LOOKS[L.key].says }));
export const RECIPES = { standard: { lightAreas: 0.25, saturation: 1.13, warmth: -0.12, green: -0.12 },
  true: { lightAreas: 0.25, warmth: -0.19, green: -0.19 }, amber: { saturation: 1.25, green: -0.12 },
  lClassic: { darkAreas: -0.37, saturation: 1.13 }, street: { lightAreas: 0.5, saturation: 0.81, warmth: -0.12 }, cinema: { lift: 0.09 },
  bleach: { saturation: 0.44, lightAreas: 0.31, green: 0.19 },
  pInstant: { lightAreas: 0.94, contrast: 0.63, darkAreas: -0.94, green: 0.38, vignette: 0.34, lift: 0.05 },
  kChrome: { saturation: 0.88, warmth: 0.13 }, haze: { vignette: 0.33 },
  rHard: { clarity: 1, lightAreas: 0.5, darkAreas: -0.5, green: -0.69, grain: 0.11, vignette: 0.3 },
  sepia: { tintAmount: 0.53, green: -0.87, contrast: 1.28, clarity: -0.5, vignette: 0.3 },
  cyanotype: { tintAmount: 0.78, clarity: -1, green: -0.94, warmth: -0.94, contrast: 1.33, lift: 0.13 } };

export function lookTitle(k) {
  const L = LOOKS[k];
  if (!L) return '';
  if (!L.after) return L.says;
  return `${L.says} In the manner of ${/^(a |War Optics|Ricoh|Leica|Kodak|Kodachrome|CineStill|Polaroid)/.test(L.after) ? L.after : 'Fujifilm ' + L.after}.`;
}
const KEPT_WHOLE = new Set(['seed', 'grainSize', 'borderWidth', 'focus', 'bloomFrom', 'bloomSpread', 'posterize']);
export function effectivePost(p) {
  if (!p) return null;
  const L = p.look && LOOKS[p.look];
  if (!L) return p;
  const a = p.amount ?? 1, out = {};
  for (const [k, v] of Object.entries(L.p)) {
    const d = POST_DEFAULTS[k];
    if (k === 'resolution') out[k] = Math.round(d + (v - d) * a);
    else if (typeof v === 'number' && typeof d === 'number' && !KEPT_WHOLE.has(k)) out[k] = d + (v - d) * a;
    else if (k === 'band' && v) out.band = { ...v, blur: v.blur * a };
    else out[k] = v;
  }
  if (L.p.film) out.filmAmount = a;
  for (const [k, v] of Object.entries(p)) if (k !== 'look' && k !== 'amount' && v !== undefined) out[k] = v;
  return out;
}

export function upgradePost(p) {
  if (!p || p.look) return p;
  const id = [p.camera, p.preset].find(x => x && LOOKS[x]);
  if (!id) return p;
  p.look = id;
  const b = effectivePost({ look: id, amount: p.amount ?? 1 });
  const same = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 1e-9 : JSON.stringify(x ?? null) === JSON.stringify(y ?? null));
  for (const k of Object.keys(p)) if (k !== 'look' && k !== 'amount' && POST_DEFAULTS[k] !== undefined && same(p[k], b[k] !== undefined ? b[k] : POST_DEFAULTS[k])) delete p[k];
  return p;
}

function hexRgb(hex) {
  const n = parseInt((hex || '#ffffff').slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

const lit = hex => hexRgb(hex).map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));

export function packPost(p, w, h, time, out = new Float32Array(POST_FLOATS), depthKnown = null) {
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
    q.aperture, q.focus, q.distort, q.fringe,
    q.flare, depthKnown ? depthKnown[0] : 0, depthKnown ? depthKnown[1] : 0, depthKnown && depthKnown[2] ? 1 : 0,
    ...buildNumbers(q, w, h),
  ]);
  return out;
}
function buildNumbers(q, w, h) {
  const on = buildOn(q), shape = CELL_SHAPES.find(s => s.id === q.cellShape) || CELL_SHAPES[0], dither = DITHERS.find(d => d.id === q.dither) || DITHERS[0];
  const cellsOn = q.resolution < 100 || shape.i !== 0 || dither.i !== 0;
  const cols = cellsOn ? cellsAcross(w, q.resolution, shape.id) : 0, rows = cols ? Math.max(1, Math.round(cols * h / w)) : 0;
  const band = q.border && q.borderWidth > 0 ? Math.max(1, Math.round(Math.min(w, h) * 0.14 * q.borderWidth / 100)) : 0;
  return [q.lightAreas, q.darkAreas, Math.max(w, h) / PIXEL_REF, on ? 1 : 0,
    cols, rows, shape.i, dither.i,
    q.noise, q.seed, band, q.keyline ? 1 : 0,
    GAINS[shape.i], shape.print ? 1 : 0, 0, 0];
}

const DRIFT = { contrast: 0.08, lightAreas: 0.1, darkAreas: 0.1, warmth: 0.06, clarity: 0.08, resolution: 6,
  grain: 0.04, noise: 0.16, distort: 0.1, vignette: 0.14, bloom: 0.08, borderWidth: 2, saturation: 0.1 };
const LIMITS = { contrast: [0.5, 2], lightAreas: [-1, 1], darkAreas: [-1, 1], warmth: [-1, 1], clarity: [-1, 1],
  resolution: [0, 99], grain: [0, 0.3], noise: [0, 1], distort: [-1, 1], vignette: [0, 1.2], bloom: [0, 1.5], borderWidth: [1, 100], saturation: [0, 2] };
export function autoAdjust(anchor, now = {}, random = Math.random) {
  const a = { ...POST_DEFAULTS, ...anchor }, out = { ...anchor };
  const jitter = () => random() + random() - 1;
  for (const [k, range] of Object.entries(DRIFT)) {
    const rest = POST_DEFAULTS[k];
    if (a[k] === rest || (k === 'saturation' && a[k] === 0) || (k === 'resolution' && a.resolution >= 100) || (k === 'borderWidth' && !a.border)) continue;
    const [lo, hi] = LIMITS[k], step = k === 'resolution' || k === 'borderWidth' ? 1 : 0.01;
    out[k] = Math.min(hi, Math.max(lo, +(Math.round((a[k] + jitter() * range) / step) * step).toFixed(step === 1 ? 0 : 2)));
  }
  out.seed = 1 + Math.floor(random() * 999);
  if (out.seed === (now.seed ?? a.seed)) out.seed = (out.seed % 999) + 1;
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
  o: vec4<f32>,
  q: vec4<f32>,
  r: vec4<f32>,
  s: vec4<f32>,
  t: vec4<f32>,
  u: vec4<f32>,
};
@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var pic: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var hdr: texture_2d<f32>;
@group(0) @binding(4) var glow: texture_2d<f32>;
@group(0) @binding(5) var sceneDepth: texture_depth_2d;
@group(0) @binding(6) var waterDepth: texture_2d<f32>;

@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}

fn hashU(x: i32, y: i32, seed: u32) -> f32 {
  var h = bitcast<u32>(x) * 374761393u + bitcast<u32>(y) * 668265263u + seed * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}
fn valueN(p: vec2<f32>, c: f32, seed: u32) -> f32 {
  let f = p / c;
  let i = vec2<i32>(floor(f));
  let t = fract(f);
  let s = t * t * (3.0 - 2.0 * t);
  let a = hashU(i.x, i.y, seed);
  let b = hashU(i.x + 1, i.y, seed);
  let cc = hashU(i.x, i.y + 1, seed);
  let d = hashU(i.x + 1, i.y + 1, seed);
  return mix(mix(a, b, s.x), mix(cc, d, s.x), s.y);
}
fn seedNow(k: u32) -> u32 { return u32(max(P.t.y, 0.0)) * 7919u + u32(P.b.w * 60.0) * 104729u + k; }
fn grainOn(col: vec3<f32>, fc: vec2<f32>) -> vec3<f32> {
  let fine = max(P.d.w * P.r.z, 0.6);
  let field = (valueN(fc, fine * 2.6, seedNow(0u)) * 0.55 + valueN(fc, fine, seedNow(9871u)) * 0.45) * 2.0 - 1.0;
  let l = clamp(dot(col, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let response = 0.3 + 0.7 * (4.0 * l * (1.0 - l)) * (1.0 - 0.45 * l);
  return col + vec3<f32>(field * P.a.w * 1.2 * response);
}
fn areas(c0: vec3<f32>) -> vec3<f32> {
  var c = clamp(c0, vec3<f32>(0.0), vec3<f32>(1.0));
  if (P.r.x != 0.0) { c = mix(c, vec3<f32>(select(0.0, 1.0, P.r.x > 0.0)), smoothstep(vec3<f32>(0.45), vec3<f32>(1.0), c) * abs(P.r.x) * 0.75); }
  if (P.r.y != 0.0) { c = mix(c, vec3<f32>(select(0.0, 1.0, P.r.y > 0.0)), (vec3<f32>(1.0) - smoothstep(vec3<f32>(0.0), vec3<f32>(0.55), c)) * abs(P.r.y) * 0.75); }
  return c;
}
fn toned(x: vec3<f32>) -> vec3<f32> {
  let c = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
  return pow(c, vec3<f32>(1.0 / 2.2));
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

const FLARE_FROM = 1.6;
fn distAt(px: vec2<i32>) -> f32 {
  let z = textureLoad(sceneDepth, px, 0);
  var d = 1e4;
  if (z < 1.0) { d = P.q.z / min(z + P.q.y, -1e-6); }
  if (P.q.w > 0.5) { let w = textureLoad(waterDepth, px, 0).x; if (w < d) { d = w; } }
  return d;
}
fn blurAt(d: f32, f: f32, most: f32) -> f32 { return min(abs(d - f) / max(d, 1e-3) * most, most); }
fn focused(uv: vec2<f32>, fc: vec2<f32>) -> vec3<f32> {
  let size = vec2<i32>(P.d.yz);
  var f = P.o.y;
  if (f <= 0.0) { f = distAt(size / 2); }
  let most = P.o.x * 26.0 * P.d.z / 800.0;
  let px = vec2<i32>(fc);
  let d0 = distAt(px);
  let c0 = blurAt(d0, f, most);
  var sum = textureSampleLevel(pic, samp, uv, 0.0).rgb;
  var weight = 1.0;
  let turn = fract(52.9829189 * fract(dot(floor(fc), vec2<f32>(0.06711056, 0.00583715)))) * 6.2831853;
  for (var i = 0; i < 40; i = i + 1) {
    let fi = f32(i);
    let at2 = sqrt((fi + 0.5) / 40.0) * most;
    let a = fi * 2.39996 + turn;
    let o = vec2<f32>(cos(a), sin(a)) * at2;
    let dt = distAt(clamp(px + vec2<i32>(o), vec2<i32>(0), size - vec2<i32>(1)));
    var ct = blurAt(dt, f, most);
    if (dt > d0) { ct = min(ct, c0 * 2.0); }
    let w = smoothstep(at2 - 1.0, at2 + 1.0, ct);
    sum = sum + textureSampleLevel(pic, samp, uv + o / P.d.yz, 0.0).rgb * w;
    weight = weight + w;
  }
  return sum / weight;
}
@fragment fn fsPost(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let res = P.d.yz;
  var uv = fc.xy / res;
  if (P.o.z != 0.0) {
    let q = uv - 0.5;
    let k = P.o.z * 0.45;
    uv = 0.5 + q * (1.0 + k * dot(q, q)) / (1.0 + max(k, 0.0) * 0.25);
  }
  let k = P.r.z;
  var r = P.b.z * k;
  if (P.c.z > 0.0) {
    let d = max(abs(uv.y - P.c.x) - P.c.y, 0.0);
    r = r + P.c.z * k * clamp(d / 0.3, 0.0, 1.0);
  }
  var col: vec3<f32>;
  if (P.b.x > 0.0) {
    let o = vec2<f32>(P.b.x * k / res.x, 0.0);
    col = vec3<f32>(soft(uv + o, r).r, soft(uv, r).g, soft(uv - o, r).b);
  } else {
    col = soft(uv, r);
  }
  if (P.o.x > 0.0) { col = focused(uv, fc.xy); }
  if (P.o.w > 0.0) {
    let q = uv - 0.5;
    let s = dot(q, q) * P.o.w * 0.012;
    col = vec3<f32>(textureSampleLevel(pic, samp, uv + q * s, 0.0).r, col.g, textureSampleLevel(pic, samp, uv - q * s, 0.0).b);
  }
  if (P.l.a > 0.0) {
    let near = soft(uv, (2.5 + 3.0 * P.l.a) * k) * 0.6 + soft(uv, 7.0 * k) * 0.4;
    let bright = smoothstep(0.55, 0.95, max(lumP(col), lumP(near)));
    col = mix(col, max(col, near), P.l.a * bright);
  }
  if (abs(P.f.w) > 0.0) { col = col + (col - soft(uv, 12.0 * k)) * P.f.w * 0.8; }
  if (P.f.y > 0.0) { col = col + (col - soft(uv, 1.2 * k)) * P.f.y * 1.5; }
  if (P.f.x > 0.5) {
    let h = max(textureSampleLevel(hdr, samp, uv, 0.0).rgb, vec3<f32>(0.0));
    let g = textureSampleLevel(glow, samp, uv, 0.0).rgb * P.n.rgb * P.n.a;
    let mean = textureSampleLevel(glow, samp, uv, f32(textureNumLevels(glow) - 1u)).a * P.m.a;
    let lessOwn = 1.0 - min(P.n.a * 0.25 + P.m.a, 0.6);
    col = col + toned(h * lessOwn + g + vec3<f32>(mean)) - toned(h);
    if (P.q.x > 0.0) {
      let c = vec2<f32>(1.0) - uv;
      var ghost = vec3<f32>(0.0);
      for (var i = 0; i < 3; i = i + 1) {
        let k2 = 0.5 + f32(i) * 0.7;
        ghost = ghost + max(textureSampleLevel(glow, samp, vec2<f32>(0.5) + (c - vec2<f32>(0.5)) * k2, 1.0).rgb - vec3<f32>(FLARE_FROM), vec3<f32>(0.0)) * vec3<f32>(1.0 - f32(i) * 0.25, 0.8, 0.55 + f32(i) * 0.2);
      }
      var streak = vec3<f32>(0.0);
      for (var i = -12; i <= 12; i = i + 1) { streak = streak + max(textureSampleLevel(glow, samp, uv + vec2<f32>(f32(i) * 0.016, 0.0), 3.0).rgb - vec3<f32>(FLARE_FROM), vec3<f32>(0.0)); }
      col = col + (ghost * 0.03 + streak * vec3<f32>(0.5, 0.7, 1.0) * 0.0035) * P.q.x * 4.0;
    }
  }
  if (P.f.z > 0.0) {
    let t = 1.5 * k / res;
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
  if (P.r.x != 0.0 || P.r.y != 0.0) { col = areas(col); }
  if (P.a.z > 0.5) { col = floor(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)) * P.a.z + 0.5) / P.a.z; }
  if (P.r.w < 0.5) {
    if (P.b.y > 0.0) { col = col * (1.0 - P.b.y * (0.5 + 0.5 * cos(fc.y / k * 2.0944))); }
    if (P.c.w > 0.0) { let q = uv - 0.5; col = col * (1.0 - P.c.w * dot(q, q) * 2.0); }
    if (P.a.w > 0.0) { col = grainOn(col, fc.xy); }
  }
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

fn edgeOf(d: f32, aa: f32) -> f32 { return clamp(d / aa + 0.5, 0.0, 1.0); }
fn coverOf(i: u32, x: f32, y: f32, a: f32, aa: f32) -> f32 {
  let s = sqrt(max(a, 0.0));
  let ax = abs(x);
  let ay = abs(y);
  switch (i) {
    case 0u: { return 1.0; }
    case 1u: { return edgeOf(0.5 * s - length(vec2<f32>(x, y)), aa); }
    case 2u: { let r = length(vec2<f32>(x, y)); return edgeOf(min(0.5 * s - r, r - 0.28 * s), aa); }
    case 3u: { return edgeOf(0.5 * s * 1.4142136 - (ax + ay), aa); }
    case 4u: {
      if (s <= 0.0) { return 0.0; }
      let nx = x / s;
      let ny = y / s;
      return edgeOf(min(0.5 - ny, (ny + 0.5) * 0.5 - abs(nx)) * s, aa);
    }
    case 5u: { return edgeOf(0.5 * s - max(ax * 0.8660254 + ay * 0.5, ay), aa); }
    case 6u: { return edgeOf(max(min(0.5 * s - ax, 0.16 * s - ay), min(0.16 * s - ax, 0.5 * s - ay)), aa); }
    case 7u: {
      let rx = abs((x + y) * 0.7071068);
      let ry = abs((x - y) * 0.7071068);
      return edgeOf(max(min(0.5 * s - rx, 0.15 * s - ry), min(0.15 * s - rx, 0.5 * s - ry)), aa);
    }
    case 8u: { return edgeOf(0.34 * s - ay, aa); }
    case 9u: { return edgeOf(0.34 * s - ax, aa); }
    case 10u: { return edgeOf(min(y - (0.5 - a), 0.5 - y), aa); }
    case 11u: { return edgeOf(0.62 * s - length(vec2<f32>(x, y)), aa); }
    case 12u: { return edgeOf(0.5 * s - max(ax, ay), aa); }
    case 13u: { return edgeOf(0.5 * s * 1.4142136 - (ax + ay), aa); }
    default: { return edgeOf(0.5 * a - ay, aa); }
  }
}
fn ditherAt(mode: u32, c: vec2<i32>) -> f32 {
  if (mode == 1u) { return 0.5; }
  if (mode == 2u) {
    var m = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    let q = vec2<u32>(c) % vec2<u32>(4u);
    return (m[q.y * 4u + q.x] + 0.5) / 16.0;
  }
  if (mode == 3u) {
    var m = array<f32, 64>(0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0, 48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0, 12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0,
      60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0, 3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0, 51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
      15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0, 63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0);
    let q = vec2<u32>(c) % vec2<u32>(8u);
    return (m[q.y * 8u + q.x] + 0.5) / 64.0;
  }
  return fract(52.9829189 * fract(dot(vec2<f32>(c), vec2<f32>(0.06711056, 0.00583715))));
}

@fragment fn fsBuild(@builtin(position) fc4: vec4<f32>) -> @location(0) vec4<f32> {
  let size = P.d.yz;
  var fc = fc4.xy;
  if (P.t.z > 0.0) {
    let b = P.t.z;
    let full = size + vec2<f32>(2.0 * b);
    let fit = min(size.x / full.x, size.y / full.y);
    let p = (fc - (size - full * fit) * 0.5) / fit;
    if (any(p < vec2<f32>(0.0)) || any(p > full)) { return vec4<f32>(vec3<f32>(0.502), 1.0); }
    let q = p - vec2<f32>(b);
    if (any(q < vec2<f32>(0.0)) || any(q > size)) {
      let away = max(max(-q.x, q.x - size.x), max(-q.y, q.y - size.y));
      let th = max(1.0, round(b * 0.06));
      let gap = max(1.0, round(b * 0.2));
      if (P.t.w > 0.5 && away > gap && away <= gap + th) { return vec4<f32>(vec3<f32>(26.0 / 255.0), 1.0); }
      return vec4<f32>(1.0);
    }
    fc = q;
  }
  let uv = fc / size;
  var col: vec3<f32>;
  if (P.s.x > 0.0) {
    let grid = P.s.xy;
    let at2 = uv * grid;
    let ci = floor(at2);
    let local = fract(at2) - vec2<f32>(0.5);
    var sum = vec3<f32>(0.0);
    for (var j = 0; j < 4; j = j + 1) {
      for (var i = 0; i < 4; i = i + 1) {
        sum = sum + textureSampleLevel(pic, samp, (ci + (vec2<f32>(f32(i), f32(j)) + 0.5) / 4.0) / grid, 0.0).rgb;
      }
    }
    var c = sum / 16.0;
    var v = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (P.s.w > 0.5) {
      let on = v >= ditherAt(u32(P.s.w + 0.5), vec2<i32>(ci));
      v = select(0.0, 1.0, on);
      c = vec3<f32>(v);
    }
    let cellPx = size / grid;
    let aa = min(0.5, 1.0 / max(min(cellPx.x, cellPx.y), 1.0));
    let shape = u32(P.s.z + 0.5);
    if (P.u.y > 0.5) {
      col = vec3<f32>(1.0 - coverOf(shape, local.x, local.y, 1.0 - v, aa));
    } else {
      col = min(c * P.u.x, vec3<f32>(1.0)) * coverOf(shape, local.x, local.y, 1.0, aa);
    }
  } else {
    col = textureSampleLevel(pic, samp, uv, 0.0).rgb;
  }
  let k = P.r.z;
  if (P.b.y > 0.0) { col = col * (1.0 - P.b.y * (0.5 + 0.5 * cos(fc4.y / k * 2.0944))); }
  if (P.a.w > 0.0) { col = grainOn(col, fc); }
  if (P.t.x > 0.0) {
    let cell = 1.5 * max(size.x, size.y) / 1400.0;
    let n = hashU(i32(floor(fc.x / cell)), i32(floor(fc.y / cell)), seedNow(4242u));
    let hot = P.t.x * 0.035;
    if (n < hot) { col = vec3<f32>(select(1.0, 0.0, n < hot * 0.5)); }
    else { col = col + vec3<f32>((n - 0.5) * 2.0 * P.t.x * 110.0 / 255.0); }
  }
  if (P.c.w > 0.0) { let q = uv - 0.5; col = col * (1.0 - P.c.w * dot(q, q) * 2.0); }
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
