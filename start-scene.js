import { defaultLook, LIGHT_PRESETS, BACKGROUNDS, copy } from './engine/environment.js';
import { defaults, hexToRgb } from './engine/settings.js';
import { makeMark } from './engine/marks.js';
import { MOVES_BY_DEFAULT } from './engine/physics.js';
import { ASSET_BY_ID } from './engine/assets.js';
import { SHAPES } from './engine/shapes.js';

export const STRIP = 2;
export const START_REGION = { size: [4.4, 1.3, 1.5], center: [0.2, -0.25] };
export const START_FINENESS = { smoke: 0.06, liquid: 0.04 };
export const START_CAMERA = { target: [0.82, 0.15, -1.05], distance: 12.2, yaw: 0.28, pitch: 0.66, fov: 30 };

const WHITE = '#efeee9', TILE = '#e2e1dc', GLASS = '#d6f3f7';
export const START_PAIR = { water: ['#d9262e', '#2a56d6'], smoke: ['#ff4a4a', '#3d6dff'], names: ['Red', 'Blue'] };

export function startLook() {
  const look = defaultLook();
  look.light = { preset: 'softStudio', ...copy(LIGHT_PRESETS.softStudio) };
  look.background = { preset: 'solid', ...copy(BACKGROUNDS.solid), top: '#e9e8e4', bottom: '#e9e8e4', haze: 0.2, image: null };
  look.ground = { color: '#ecebe7', finish: 'satin', grid: true, gridColor: '#bdbcb5', gridSpacing: 0.1, gridStrength: 0.35 };
  look.wind = { on: true, dir: 90, speed: 1, gusts: 0.1, turbulence: 0.5 };
  look.post = null;
  return look;
}

export function startSettings() {
  return { ...defaults(), liquidColor: '#2a8de8', clarity: 0.45, splash: 0.9, look: 'smooth',
    smokeColor: '#f2f2f0', smokeOpacity: 5, smokeAmount: 1.1, rise: 0.4, swirl: 0.5, fade: 0.85 };
}

export function testStrip(v, o = {}) {
  const k = o.scale || 1, fast = Math.sqrt(k);
  const put = (shape, name, pos, size, color, extra = {}) => {
    const b = v.scene.addObject({ shape, name, pos, size, color: hexToRgb(color), finish: extra.finish || 'matte', ...extra });
    b.home = { pos: [...b.pos], rot: [...b.rot] };
    return b;
  };
  const glass = { finish: 'glass' }, h = (o.wall || 0.06) * k, t = (o.thick || 0.01) * k;
  put('box', 'Strip wall', [0, h, -0.16 * k], [0.77 * k, h, t], GLASS, glass);
  put('box', 'Strip wall', [0, h, 0.16 * k], [0.77 * k, h, t], GLASS, glass);
  put('box', 'Strip wall', [-0.76 * k, h, 0], [t, h, 0.15 * k], GLASS, glass);
  put('box', 'Strip wall', [0.76 * k, h, 0], [t, h, 0.15 * k], GLASS, glass);
  const gaps = o.oneEnd ? [[-0.45, true], [-0.15, false], [0.15, true], [0.45, false]] : [[-0.45, true], [-0.15, false], [0.15, false], [0.45, true]];
  for (const [x, front] of gaps) {
    const z0 = front ? -0.15 : -0.06, z1 = front ? 0.06 : 0.15;
    put('box', 'Partition', [x * k, h, (z0 + z1) / 2 * k], [t, h, (z1 - z0) / 2 * k], GLASS, glass);
  }
  const P = o.pair || START_PAIR, top = (o.top || 0.4) * k;
  const towers = o.oneEnd ? [[-0.9, 0.08, P.water[0], P.names[0]], [-0.9, -0.08, P.water[1], P.names[1]]]
    : [[-0.9, 0, P.water[0], P.names[0]], [0.9, 0, P.water[1], P.names[1]]];
  const RIM = 0.062 * k, OUTLET = top + 0.08 * k, half = 0.05 * k;
  for (const [x, z, color, name] of towers) {
    const s = Math.sign(x), fx = s * 0.708 * k, tx = fx + s * (RIM + half + 0.002 * k);
    const funnel = v.addAsset('pour', [fx, 0, z * k], { lift: OUTLET, scale: k / (o.funnelMade || 1) });
    const rim = funnel.object.pos[1] + funnel.object.size[1];
    put('column', name + ' tower', [tx, rim / 2, z * k], [half, rim / 2, half], WHITE, { finish: 'gloss' });
    Object.assign(funnel.sources[0], { name: name + ' pour', radius: 0.03 * k, speed: (o.pourSpeed || 1.0) * fast, rate: o.pourRate || 1.0, color: hexToRgb(color) });
  }
  v.scene.addEmitter({ type: 'liquid', sink: true, name: 'Drain', pos: [(o.oneEnd ? 0.6 : 0) * k, -0.2 * k, 0], radius: 0.27 * k, rate: o.drain || 6, dir: [0, 1, 0], speed: 0, color: [0.2, 0.21, 0.23] });
  if (o.smoke === 'column') for (const [x, color, name] of [[-0.08, P.smoke[0], P.names[0] + ' smoke'], [0.08, P.smoke[1], P.names[1] + ' smoke']])
    v.scene.addEmitter({ type: 'smoke', name, pos: [x * k, 0.3 * k, -0.05 * k], radius: 0.08 * k, dir: [-Math.sign(x) * 0.08, 1, 0], speed: 0.8 * fast, rate: 0.7, heat: 0.8, color: hexToRgb(color) });
  else if (o.smoke !== false) for (const [z, color, name] of [[0.06, P.smoke[0], P.names[0] + ' smoke'], [-0.06, P.smoke[1], P.names[1] + ' smoke']])
    v.scene.addEmitter({ type: 'smoke', name, pos: [-0.68 * k, 0.3 * k, (z - 0.32) * k], radius: 0.07 * k, dir: [1, 0, -Math.sign(z) * 0.06], speed: 0.6 * fast, rate: o.smokeRate || 1.2, heat: 0.15, color: hexToRgb(color) });
}

export function catalogue(v, items, o = {}) {
  const tile = o.tile || 0.26, made = [], tiles = o.tiles ?? !!o.display, base = tiles ? 0.008 : 0;
  const keep = b => { b.home = { pos: [...b.pos], rot: [...b.rot] }; return b; };
  let n = o.from || 1;
  for (const [kind, id, x, z, f = {}] of items) {
    if (tiles) keep(v.scene.addObject({ shape: 'box', name: 'Tile', pos: [x, 0.004, z], size: [tile / 2, 0.004, tile / 2],
      color: hexToRgb(TILE), finish: 'matte', collides: !o.display }));
    let thing = null;
    if (kind === 'shape') {
      const sz = f.size || SHAPES[id].size, weight = !o.display && MOVES_BY_DEFAULT.has(id);
      thing = keep(v.scene.addObject({ shape: id, name: f.name, pos: [x, (f.lift || 0) + sz[1] + base, z], size: sz, rot: f.rot || [0, 0, 0],
        color: hexToRgb(f.color || WHITE), finish: f.finish || null, collides: o.collides,
        moves: weight && !f.weightInBox, whenInBox: weight && f.weightInBox ? { moves: true } : null,
        material: !o.display && id === 'ball' ? 'rubber' : 'wood' }));
      v.dropToGround(thing, base + (f.lift || 0)); thing.home.pos = [...thing.pos];
    } else {
      const r = v.addAsset(id, [x, 0, z], { on: base, lift: (f.lift ?? 0) + base, scale: f.scale, color: f.color || WHITE });
      if (!r) continue;
      thing = r.object;
      if (f.rot) { thing.rot = f.rot; v.dropToGround(thing, base + (f.lift || 0)); thing.home = { pos: [...thing.pos], rot: [...thing.rot] }; }
      if (o.collides === false) thing.collides = false;
      if (o.display) thing.moves = false;
      thing.finish = f.finish || null;
      for (const e of r.sources) v.scene.remove(e);
      if (r.sources.length && !o.display) thing.whenInBox = { parts: true };
    }
    made.push(thing);
    if (o.labels) v.scene.addMark(makeMark('label', { target: thing.id, text: `${String(n).padStart(2, '0')} ${f.label || id.replace('-', ' ')}`.toUpperCase(),
      style: 'tag', bg: '', color: '#8a8880', size: 10, dx: -24, dy: 34 }));
    n++;
  }
  return made;
}

const FINISH = { matte: '#efeee9', gloss: '#efeee9', metal: '#c4c8cd', glass: '#e8f2f4' };
function spaced(pieces, z, gap) {
  let x = -(pieces.reduce((a, p) => a + p.w, 0) + gap * (pieces.length - 1)) / 2;
  return pieces.map(p => { const at = x + p.w / 2; x += p.w + gap; return [p.kind, p.id, at, z, p.f]; });
}
const shapePiece = (id, i) => {
  const finish = ['matte', 'gloss', 'metal', 'glass'][i % 4];
  return { kind: 'shape', id, w: SHAPES[id].size[0] * 2, f: { finish, color: FINISH[finish],
    rot: id === 'ring' ? [Math.PI / 2, 0, 0] : [0, 0, 0], weightInBox: id === 'ring' } };
};
export const shapeRows = (z1, z2, gap) => [...spaced(['box', 'ball', 'column', 'cone'].map(shapePiece), z1, gap), ...spaced(['ring', 'ramp', 'arch', 'stairs'].map((id, i) => shapePiece(id, i + 4)), z2, gap)];
export const toolRow = (z, gap) => spaced([['blower', 0.24, 'fan', 'gloss'], ['hood', 0.3, null, 'metal'], ['floor-drain', 0.36, 'drain', 'metal'], ['spring', 0.11, null, 'metal'],
  ['metal-block', 0.18, 'block', 'metal'], ['frosted-ball', 0.14, 'ball', 'frosted'], ['tree', 0.28, null, 'matte'], ['fence', 0.92, null, 'gloss']]
  .map(([id, w, label, finish]) => ({ kind: 'asset', id, w, f: { label: label || id, finish, color: finish === 'metal' ? '#b9bdc2' : finish === 'glass' || finish === 'frosted' ? '#eef5f6' : '#efeee9' } })), z, gap);

export function wakeOldKits(scene) {
  let n = 0;
  for (const o of scene.objects) {
    const a = ASSET_BY_ID[o.asset];
    if (!a || !a.sources || !a.sources.length || o.whenInBox) continue;
    if (scene.emitters.some(e => e.attach && e.attach.to === o.id)) continue;
    o.whenInBox = { parts: true };
    n++;
  }
  return n;
}

export function clearOldTiles(v) {
  const S = v.scene, near = (a, b) => Math.abs(a - b) < 1e-4;
  const tiles = S.objects.filter(o => o.name === 'Tile' && o.shape === 'box' && !o.model && near(o.size[0], 0.13) && near(o.size[1], 0.004) && near(o.size[2], 0.13));
  for (const t of tiles) S.remove(t);
  let setDown = 0;
  if (tiles.length) for (const o of [...S.objects]) {
    if (o.model && !S.models.has(o.model)) continue;
    const y0 = o.pos[1];
    v.dropToGround(o, 0);
    const up = y0 - o.pos[1];
    const k = S.objects.indexOf(o);
    S.objects.splice(k, 1);
    const under = S.pick({ origin: [o.pos[0], up + 0.001, o.pos[2]], dir: [0, -1, 0] }, { emitters: false });
    S.objects.splice(k, 0, o);
    if (up > 0.002 && up < 0.012 && under && !under.item) {
      if (o.home) o.home.pos[1] -= up;
      setDown++;
    } else o.pos[1] = y0;
  }
  return { tiles: tiles.length, setDown };
}

export function buildStartScene(v) {
  testStrip(v, { oneEnd: true, drain: 4, pourRate: 0.35, wall: 0.07, thick: 0.015, pair: START_PAIR, scale: STRIP, funnelMade: 2, smokeRate: 0.85 });
  catalogue(v, shapeRows(-1.5, -3.2, 0.3));
  catalogue(v, toolRow(1.5, 0.3));
}
