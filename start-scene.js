import { defaultLook, LIGHT_PRESETS, BACKGROUNDS, copy } from './engine/environment.js';
import { defaults, hexToRgb } from './engine/settings.js';
import { makeMark } from './engine/marks.js';

export const START_REGION = { size: [2.4, 1.0, 1.0], center: [0.1, 0] };
export const START_FINENESS = { smoke: 0.035, liquid: 0.025 };
export const START_CAMERA = { target: [0.5, 0.15, 0.05], distance: 6.2, yaw: 0.35, pitch: 0.72, fov: 30 };

const WHITE = '#efeee9', TILE = '#e2e1dc', GLASS = '#d6f3f7';
export const START_PAIR = { water: ['#d9262e', '#2a56d6'], smoke: ['#ff4a4a', '#3d6dff'], names: ['Red', 'Blue'] };

export function startLook() {
  const look = defaultLook();
  look.light = { preset: 'softStudio', ...copy(LIGHT_PRESETS.softStudio) };
  look.background = { preset: 'solid', ...copy(BACKGROUNDS.solid), top: '#e9e8e4', bottom: '#e9e8e4', haze: 0.2, image: null };
  look.ground = { color: '#ecebe7', finish: 'satin', grid: true, gridColor: '#bdbcb5', gridSpacing: 0.1, gridStrength: 0.35 };
  look.wind = { on: true, dir: 90, speed: 0.7, gusts: 0.1, turbulence: 0.5 };
  look.post = null;
  return look;
}

export function startSettings() {
  return { ...defaults(), liquidColor: '#2a8de8', clarity: 0.45, splash: 0.9, look: 'smooth',
    smokeColor: '#f2f2f0', smokeOpacity: 10, smokeAmount: 1.1, rise: 0.4, swirl: 0.5, fade: 0.7 };
}

export function testStrip(v, o = {}) {
  const put = (shape, name, pos, size, color, extra = {}) => {
    const b = v.scene.addObject({ shape, name, pos, size, color: hexToRgb(color), finish: extra.finish || 'matte', ...extra });
    b.home = { pos: [...b.pos], rot: [...b.rot] };
    return b;
  };
  const glass = { finish: 'glass' }, h = o.wall || 0.06;
  put('box', 'Strip wall', [0, h, -0.16], [0.77, h, 0.01], GLASS, glass);
  put('box', 'Strip wall', [0, h, 0.16], [0.77, h, 0.01], GLASS, glass);
  put('box', 'Strip wall', [-0.76, h, 0], [0.01, h, 0.15], GLASS, glass);
  put('box', 'Strip wall', [0.76, h, 0], [0.01, h, 0.15], GLASS, glass);
  const gaps = o.oneEnd ? [[-0.45, true], [-0.15, false], [0.15, true], [0.45, false]] : [[-0.45, true], [-0.15, false], [0.15, false], [0.45, true]];
  for (const [x, front] of gaps) {
    const z0 = front ? -0.15 : -0.06, z1 = front ? 0.06 : 0.15;
    put('box', 'Partition', [x, h, (z0 + z1) / 2], [0.01, h, (z1 - z0) / 2], GLASS, glass);
  }
  const P = o.pair || START_PAIR, top = o.top || 0.4;
  const towers = o.oneEnd ? [[-0.9, 0.08, P.water[0], P.names[0]], [-0.9, -0.08, P.water[1], P.names[1]]]
    : [[-0.9, 0, P.water[0], P.names[0]], [0.9, 0, P.water[1], P.names[1]]];
  for (const [x, z, color, name] of towers) {
    const s = Math.sign(x);
    put('column', name + ' tower', [x, top / 2, z * 1.6], [0.05, top / 2, 0.05], WHITE, { finish: 'gloss' });
    const src = v.addAsset('pour', [x, 0, z * 1.6], { lift: top + 0.08 }).sources[0];
    Object.assign(src, { name: name + ' pour', radius: 0.03, speed: o.pourSpeed || 1.0, rate: o.pourRate || 1.0, color: hexToRgb(color),
      dir: [-s, -0.25, o.oneEnd ? -z * 0.5 : 0] });
  }
  v.scene.addEmitter({ type: 'liquid', sink: true, name: 'Drain', pos: [o.oneEnd ? 0.6 : 0, -0.2, 0], radius: 0.27, rate: o.drain || 6, dir: [0, 1, 0], speed: 0, color: [0.2, 0.21, 0.23] });
  if (o.smoke === 'column') for (const [x, color, name] of [[-0.08, P.smoke[0], P.names[0] + ' smoke'], [0.08, P.smoke[1], P.names[1] + ' smoke']])
    v.scene.addEmitter({ type: 'smoke', name, pos: [x, 0.3, -0.05], radius: 0.08, dir: [-Math.sign(x) * 0.08, 1, 0], speed: 0.8, rate: 0.7, heat: 0.8, color: hexToRgb(color) });
  else if (o.smoke !== false) for (const [z, color, name] of [[0.06, P.smoke[0], P.names[0] + ' smoke'], [-0.06, P.smoke[1], P.names[1] + ' smoke']])
    v.scene.addEmitter({ type: 'smoke', name, pos: [-0.68, 0.3, z - 0.32], radius: 0.07, dir: [1, 0, -Math.sign(z) * 0.06], speed: 0.6, rate: 1.2, heat: 0.15, color: hexToRgb(color) });
}

export function catalogue(v, items, o = {}) {
  const tile = o.tile || 0.26, made = [];
  const keep = b => { b.home = { pos: [...b.pos], rot: [...b.rot] }; return b; };
  let n = o.from || 1;
  for (const [kind, id, x, z, f = {}] of items) {
    if (o.tiles !== false) keep(v.scene.addObject({ shape: 'box', name: 'Tile', pos: [x, 0.004, z], size: [tile / 2, 0.004, tile / 2],
      color: hexToRgb(TILE), finish: 'matte', collides: false }));
    let thing = null;
    if (kind === 'shape') {
      const sz = f.size || [0.075, 0.075, 0.075];
      thing = keep(v.scene.addObject({ shape: id, name: f.name, pos: [x, (f.lift || 0) + sz[1] + 0.008, z], size: sz, rot: f.rot || [0, 0, 0],
        color: hexToRgb(f.color || WHITE), finish: f.finish || null, collides: o.collides }));
      v.dropToGround(thing, 0.008 + (f.lift || 0)); thing.home.pos = [...thing.pos];
    } else {
      const r = v.addAsset(id, [x, 0, z], { on: 0.008, lift: (f.lift ?? 0) + 0.008, scale: f.scale, color: f.color || WHITE });
      if (!r) continue;
      thing = r.object;
      if (f.rot) { thing.rot = f.rot; v.dropToGround(thing, 0.008 + (f.lift || 0)); thing.home = { pos: [...thing.pos], rot: [...thing.rot] }; }
      if (o.collides === false) thing.collides = false;
      thing.moves = false;
      thing.finish = f.finish || null;
      for (const e of r.sources) v.scene.remove(e);
    }
    made.push(thing);
    if (o.labels) v.scene.addMark(makeMark('label', { target: thing.id, text: `${String(n).padStart(2, '0')} ${f.label || id.replace('-', ' ')}`.toUpperCase(),
      style: 'tag', bg: '', color: '#8a8880', size: 10, dx: -24, dy: 34 }));
    n++;
  }
  return made;
}

const rowX = i => -1.05 + i * 0.3;
const FINISH = { matte: '#efeee9', gloss: '#efeee9', metal: '#c4c8cd', glass: '#e8f2f4' };
export const shapeRow = z => ['box', 'ball', 'column', 'cone', 'ring', 'ramp', 'arch', 'stairs'].map((id, i) => {
  const finish = ['matte', 'gloss', 'metal', 'glass'][i % 4];
  return ['shape', id, rowX(i), z, { finish, color: FINISH[finish],
    size: id === 'column' ? [0.05, 0.08, 0.05] : ['arch', 'stairs', 'ramp'].includes(id) ? [0.09, 0.07, 0.07] : [0.07, 0.07, 0.07],
    rot: id === 'ring' ? [Math.PI / 2, 0, 0] : [0, 0, 0] }];
});
export const toolRow = z => [['blower', 0.45, 'fan', 'gloss'], ['hood', 0.35, null, 'metal'], ['floor-drain', 0.6, 'drain', 'metal'], ['spring', 0.8, null, 'metal'],
  ['metal-block', 1, 'block', 'metal'], ['frosted-ball', 1.4, 'ball', 'glass'], ['tree', 0.4, null, 'matte'], ['fence', 0.25, null, 'gloss']]
  .map(([id, scale, label, finish], i) => ['asset', id, rowX(i), z, { scale, label: label || id, finish, color: finish === 'metal' ? '#b9bdc2' : finish === 'glass' ? '#eef5f6' : '#efeee9' }]);

export function buildStartScene(v) {
  testStrip(v, { oneEnd: true, drain: 7, pourRate: 0.5, wall: 0.07, pair: START_PAIR });
  catalogue(v, shapeRow(-0.8));
  catalogue(v, toolRow(0.8));
}
