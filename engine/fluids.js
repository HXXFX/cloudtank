import { FLUID_FLOATS, FLUID_ROWS, MAX_EMITTERS } from './sdf.wgsl.js';
import { lightOf, hexToRgb } from './settings.js';

export const SHADES = { real: 0, flat: 1, xray: 2, glow: 3, metal: 4 };
export const FORMS = { natural: 0, blocks: 1, balls: 2, text: 3, dots: 4, pixels: 5, lines: 6 };
export const isSolidForm = f => f === 'blocks' || f === 'balls';
export const isCellForm = f => f === 'text' || f === 'dots' || f === 'pixels' || f === 'lines';

export const OWN_SETTINGS = {
  smoke: ['smokeOpacity', 'rise', 'smokeWeight', 'swirl', 'fade', 'cooling', 'smokeDetail'],
  liquid: ['splash', 'clarity', 'foam'],
};

export const LOOK_DEFAULTS = {
  preset: 'real', form: 'natural', shade: 'real',
  blockSize: 0.12, shape: 'cube', fill: 0.12, pixels: 16, grain: 0.25,
  cellSize: 12, chars: ' .:-=+*#%@', repeat: false, backing: 0, backColor: '#05070a',
  colorMode: 'own', colorA: '#3ad1ff', colorB: '#ffffff',
  strength: 1, opacity: 1, bands: 4, edge: 0.5, emission: 0, rough: 0.12, metal: 1,
  picture: null, tile: 1, picMix: 1, drift: 0,
  shadow: 1,
};
export const lookValue = (L, k) => (L && L[k] !== undefined ? L[k] : LOOK_DEFAULTS[k]);

export const LOOK_PRESETS = {
  real: { label: 'Photo real', says: 'As it really looks: light through it, mirrors, shadows. The app\'s own look.', p: {} },
  blocks: { label: 'Blocks', says: 'Built of pixel-textured cubes on a lattice, like a voxel world. They are real things: they cast shadows and water mirrors them.', p: { form: 'blocks', blockSize: 0.12, pixels: 16, grain: 0.3 } },
  clearblocks: { label: 'Clear blocks', says: 'See-through cubes.', p: { form: 'blocks', blockSize: 0.12, pixels: 16, grain: 0.15, opacity: 0.55 } },
  marbles: { label: 'Marbles', says: 'Made of shiny balls on a lattice.', p: { form: 'balls', blockSize: 0.08, rough: 0.08, grain: 0 } },
  ascii: { label: 'ASCII', says: 'Letters and signs in screen cells, denser where the fluid is brighter, on a dark ground.', p: { form: 'text', cellSize: 13, chars: ' .:-=+*#%@', colorMode: 'one', colorA: '#7dff9a', backing: 0.985 } },
  matrix: { label: 'Binary', says: 'Noughts and ones, flickering, on a dark ground.', p: { form: 'text', cellSize: 13, chars: '01', repeat: true, colorMode: 'one', colorA: '#3cff6e', backing: 0.985 } },
  halftone: { label: 'Dots', says: 'Dots in screen cells, larger where it is brighter, as in a printed picture.', p: { form: 'dots', cellSize: 9, colorMode: 'own' } },
  mosaic: { label: 'Pixels', says: 'Big square pixels in screen cells.', p: { form: 'pixels', cellSize: 12, colorMode: 'own' } },
  hatch: { label: 'Lines', says: 'Lines in screen cells, thicker where it is brighter.', p: { form: 'lines', cellSize: 7, colorMode: 'own' } },
  xray: { label: 'X-ray', says: 'As on a film: dark where it is thin, white where there is most of it on a line, with bright edges.', p: { shade: 'xray', colorMode: 'ramp', colorA: '#0d2747', colorB: '#eaf6ff', strength: 1, edge: 0.6, opacity: 0.92, shadow: 0.2 } },
  neon: { label: 'Neon', says: 'It gives off light in one strong colour. Bloom (Filters) makes it spread.', p: { shade: 'glow', colorMode: 'one', colorA: '#ff2fd0', strength: 1.4, edge: 0.7, shadow: 0.05 } },
  cartoon: { label: 'Cartoon', says: 'A few flat bands of colour and a dark edge.', p: { shade: 'flat', bands: 3, edge: 0.6 } },
  mercury: { label: 'Liquid metal', says: 'A mirror: its colour tints what it reflects.', p: { shade: 'metal', colorMode: 'one', colorA: '#d7dde6', rough: 0.08 } },
  lava: { label: 'Lava', says: 'Glowing, with a dark moving crust.', p: { colorMode: 'one', colorA: '#ff5a14', emission: 2.5, grain: 0.75 } },
};

export function lookFromPreset(key, old) {
  const P = LOOK_PRESETS[key];
  if (key === 'real') return null;
  return { ...P.p, preset: key, ...(old && old.picture ? { picture: old.picture, tile: old.tile, picMix: old.picMix, drift: old.drift } : {}) };
}

export const thicknessOf = (e, S) => (e && e.own && e.own.smokeOpacity !== undefined ? e.own.smokeOpacity / Math.max(S.smokeOpacity, 1e-3) : 1);

const lit = hex => lightOf(hexToRgb(hex));

function packRow(out, i, S, e) {
  const own = (e && e.own) || {}, L = (e && e.look) || null;
  const v = (k, d) => (own[k] !== undefined ? own[k] : S[k] !== undefined ? S[k] : d);
  const q = k => lookValue(L, k);
  const T = thicknessOf(e, S);
  const form = q('form'), solidForm = isSolidForm(form), cell = isCellForm(form);
  const see = e && e.type === 'smoke' && L ? 1 / Math.max(q('shadow'), 0.02) : 1;
  const a = lit(q('colorA')), b = lit(q('colorB'));
  const mode = { own: 0, one: 1, ramp: 2 }[q('colorMode')] ?? 0;
  out.set([
    v('fade', 0.12), v('cooling', 0.5), v('rise', 2.5), v('smokeWeight', 0.3) * see / T,
    v('swirl', 1) * 3, v('smokeDetail', 1), v('splash', 0.95), v('clarity', 0.85),
    v('foam', 1), v('caustics', 1), see, solidForm ? 1 : cell ? 2 : 0,
    SHADES[q('shade')] ?? 0, FORMS[form] ?? 0, cell ? q('cellSize') : q('blockSize'), q('opacity'),
    ...a, mode,
    ...b, q('strength'),
    q('picture') ? -2 : -1, q('tile'), q('picMix'), q('drift'),
    q('bands'), q('edge'), 0, 0,
    q('fill'), q('pixels'), q('grain'), q('shape') === 'ball' || form === 'balls' ? 1 : 0,
    q('repeat') ? 1 : 0, q('emission'), q('rough'), q('metal'),
    ...lit(q('backColor')), q('backing'),
  ], i * FLUID_FLOATS);
}

export class FluidTable {
  constructor() {
    this.data = new Float32Array(FLUID_ROWS * FLUID_FLOATS);
    this.bySource = new Map();
    this.rows = new Array(MAX_EMITTERS + 1).fill(null);
    this.age = 0;
    this.used = new Array(MAX_EMITTERS + 1).fill(0);
  }

  assign(emitters) {
    const alive = new Set();
    for (const e of emitters) {
      if (e.sink) { e.row = 0; continue; }
      let r = this.bySource.get(e.id);
      if (!r) {
        r = this.freeRow(emitters);
        this.bySource.set(e.id, r);
      }
      e.row = r;
      this.rows[r] = e;
      this.used[r] = ++this.age;
      alive.add(r);
    }
    this.alive = alive;
  }
  freeRow(emitters) {
    const live = new Set(emitters.map(e => this.bySource.get(e.id)));
    let best = 0, bestAge = Infinity;
    for (let r = 1; r <= MAX_EMITTERS; r++) {
      if (live.has(r)) continue;
      if (!this.rows[r]) return r;
      if (this.used[r] < bestAge) { bestAge = this.used[r]; best = r; }
    }
    for (const [id, x] of this.bySource) if (x === best) this.bySource.delete(id);
    return best || 1;
  }
  forgetGone(emitters) {
    const live = new Set(emitters.map(e => e.id));
    for (const [id, r] of [...this.bySource]) if (!live.has(id)) { this.bySource.delete(id); this.rows[r] = null; }
    for (let r = 1; r <= MAX_EMITTERS; r++) if (this.rows[r] && !live.has(this.rows[r].id)) this.rows[r] = null;
  }

  pack(S, emitters) {
    this.assign(emitters);
    const d = this.data;
    d.fill(0);
    packRow(d, 0, S, null);
    const out = { smokeLook: false, waterOwn: false, solids: [], cells: [] };
    for (let r = 1; r <= MAX_EMITTERS; r++) {
      const e = this.rows[r];
      packRow(d, r, S, e);
      if (!e) continue;
      const L = e.look, form = lookValue(L, 'form'), smoke = e.type === 'smoke';
      const styled = !!L && (form !== 'natural' || lookValue(L, 'shade') !== 'real' || lookValue(L, 'emission') > 0 || !!lookValue(L, 'picture') || lookValue(L, 'shadow') !== 1);
      if (styled && smoke) out.smokeLook = true;
      if (!smoke && (styled || (e.own && Object.keys(e.own).length))) out.waterOwn = true;
      if (isSolidForm(form)) out.solids.push({ row: r, e, smoke, size: lookValue(L, 'blockSize') });
      if (isCellForm(form)) out.cells.push({ row: r, e, smoke, size: Math.max(4, Math.round(lookValue(L, 'cellSize'))), live: this.alive.has(r) });
    }
    out.cells.sort((a, b) => b.live - a.live);
    return out;
  }
}
