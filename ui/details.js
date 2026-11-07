import { el, slider, numbers, color, choice, toggle, dial, section, button, repaintAll, pick, swatches, mapSlot, MIXED } from './dom.js';
import { FINISH_LOOK, finishOf, isGlassLook, pbrValue, setPbr, MAP_SLOTS, MAPPINGS, hasMap, anyMap, texValue, decalValue, DECAL_DEFAULTS, fitTile } from '../engine/material.js';
import { imageThumb } from '../engine/images.js';
import { setMap, removeMap, addDecal, pickImageFile } from './imagedrop.js';
import { icon } from './icons.js';
import { SHAPES } from '../engine/shapes.js';
import { motionAt } from '../engine/viewport.js';
import { MATERIALS, blocksFluid } from '../engine/physics.js';
import { hexToRgb, rgbToHex } from '../engine/settings.js';
import { fromAngles } from '../engine/math.js';
import { ASSET_BY_ID, OBJECT_FINISHES, SWATCHES } from '../engine/assets.js';
import { motionOn } from '../engine/marks.js';

const DEG = 180 / Math.PI;
const fmtN = n => Math.round(n).toLocaleString('en-US');
const same = (a, b) => (Array.isArray(a) && Array.isArray(b)) ? a.length === b.length && a.every((v, i) => same(v, b[i]))
  : typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;
const readAll = (ts, get) => { const v = get(ts[0]); return ts.every(t => same(get(t), v)) ? v : MIXED; };


const isObject = it => it.kind === 'object';
const isLight = it => it.kind === 'light';
const self = test => it => test(it) ? [it] : [];
const objects = self(isObject);
const lights = self(isLight);
const sourcesOf = (it, vp) => it.kind === 'emitter' ? [it] : isObject(it) ? vp.scene.emitters.filter(e => e.attach && e.attach.to === it.id) : [];
const kindOf = e => e.sink ? (e.type === 'smoke' ? 'extractor' : 'drain') : e.type;
const sourcesKind = kind => (it, vp) => sourcesOf(it, vp).filter(e => kindOf(e) === kind);
const anySource = (it, vp) => sourcesOf(it, vp);
const placed = it => (it.kind === 'emitter' && !it.attach) || isLight(it) || isObject(it);
const baseOf = (o, vp) => { const m = o.model ? vp.scene.models.get(o.model) : null; return m ? m.fileHalf : SHAPES[o.shape].size; };

const TOOL_SOURCE = { extractor: { rate: 1, radius: 0.3 }, drain: { rate: 1, radius: 0.15 }, smoke: { rate: 1, radius: 0.24, speed: 0.6, heat: 1 }, liquid: { rate: 1, radius: 0.08, speed: 1.5 } };
function sourceDefault(e, key, vp) {
  const o = e.attach ? vp.scene.objects.find(x => x.id === e.attach.to) : null, a = o && ASSET_BY_ID[o.asset];
  if (a && a.sources) {
    const n = vp.scene.emitters.filter(x => x.attach && x.attach.to === o.id).indexOf(e), s = a.sources[Number.isInteger(e.attach.part) ? e.attach.part : Math.max(n, 0)] || a.sources[0];
    if (s[key] !== undefined) return s[key];
  }
  return TOOL_SOURCE[kindOf(e)][key];
}
const aim = t => { const d = t.dir; return { az: (Math.atan2(d[0], d[2]) * DEG + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, d[1] / Math.hypot(...d)))) * DEG }; };
const round1 = v => Math.round(v * 10) / 10;

function keepFoot(o, vp, change) {
  const y0 = o.pos[1]; vp.dropToGround(o, 0); const up = y0 - o.pos[1]; o.pos[1] = y0;
  change();
  vp.dropToGround(o, up);
  if (o.home) o.home.pos[1] = o.pos[1];
}


const CATS = {
  extractor: 'Extractor', drain: 'Drain', smoke: 'Smoke source', liquid: 'Liquid source', aim: 'Direction', timer: 'Timer',
  light: 'Light', transform: 'Transform', material: 'Material', texture: 'Texture', decals: 'Decals', physics: 'Physics', collision: 'Collision', motion: 'Motion', draw: 'Rendering',
};
const CAT_ORDER = ['extractor', 'drain', 'smoke', 'liquid', 'light', 'aim', 'timer', 'transform', 'material', 'texture', 'decals', 'physics', 'collision', 'motion', 'draw'];

const on = { kind: 'toggle', label: 'On', get: t => t.on !== false, set: (t, v) => { t.on = v; }, def: () => true, also: 'Auto Activate, Enabled' };
const M = t => (t.motion ||= { travel: 'none', dir: 90, speed: 0.3, distance: 4, spin: 0, bob: 0 });
const motionChanged = (t, ctx) => {
  if (motionOn(t.motion)) {
    t.moves = false;
    const m = motionAt(t, ctx.vp.simTime);
    t.home = { pos: t.pos.map((v, k) => v - m.off[k]), rot: [t.rot[0], t.rot[1] - m.turn, t.rot[2]] };
  }
  ctx.repaint();
};
const PULSE = t => (t.pulse ||= { on: 3, off: 3, delay: 0 });
const timed = t => !!(t.pulse && t.pulse.on > 0 && t.pulse.off > 0);

const looksOf = (it, vp) => {
  if (it.kind === 'ground') return [vp.look.ground];
  if (!isObject(it)) return [];
  if (it.partLooks) { const k = it.partPick ?? -1; return it.partLooks[k] ? [it.partLooks[k]] : it.partLooks; }
  return [it];
};
const objLooks = (it, vp) => (it.kind === 'ground' ? [] : looksOf(it, vp));
const glassy = isGlassLook;
const solid = t => !isGlassLook(t);
const ownerOf = (look, vp) => vp.scene.objects.find(o => o === look || (o.partLooks || []).includes(look)) || null;
const noPbr = (t, k) => !(t.pbr && t.pbr[k] !== undefined);
const clearPbr = (t, k) => { if (t.pbr) { delete t.pbr[k]; if (!Object.keys(t.pbr).length) delete t.pbr; } };
const pbrRow = (label, key, min, max, step, extra = {}) => ({ cat: 'material', kind: 'slider', label, min, max, step, on: looksOf,
  get: t => pbrValue(t, key), set: (t, v) => setPbr(t, key, v), isDef: t => noPbr(t, key), toDef: t => clearPbr(t, key), ...extra });
const setTex = (t, k, v) => { (t.tex ||= {})[k] = v; };
const texRow = (label, key, extra) => ({ cat: 'texture', label, on: looksOf, when: anyMap, get: t => texValue(t, key), set: (t, v) => setTex(t, key, v), ...extra });
const thumbFor = (vp, id) => { const m = vp.scene.images.get(id); return m ? (m.thumb ? Promise.resolve(m.thumb) : imageThumb(m.blob).then(u => (m.thumb = u))) : Promise.resolve(''); };

function slotFor(key, ts, ctx) {
  const vp = ctx.vp;
  const box = mapSlotOf(key, ts, ctx);
  if (!['color', 'bump', 'normal'].includes(key)) { const inner = box.paint; box.paint = () => { inner(); box.hidden = ts.every(glassy); }; box.paint(); }
  return box;
}
function mapSlotOf(key, ts, ctx) {
  const vp = ctx.vp;
  const put = async file => {
    try {
      const id = await vp.addImage(file, file.name);
      for (const t of ts) setMap(vp, t, ownerOf(t, vp), key, id);
      ctx.commit(); ctx.repaint();
    } catch (e) { console.error(e); ctx.say && ctx.say('Could not use it: ' + e.message); }
  };
  return mapSlot({ label: MAP_SLOTS[key].label, get: () => { const t = ts.find(x => hasMap(x, key)); return t ? t.tex.maps[key] : null; },
    thumb: id => thumbFor(vp, id), pick: () => pickImageFile(put), dropped: put,
    menu: (x, y) => ctx.menu(x, y, [
      ['open', 'Another picture…', () => pickImageFile(put)],
      ['trash', 'Take it out', () => { for (const t of ts) removeMap(t, key); ctx.commit(); ctx.repaint(); }],
    ]) });
}
const decalOf = t => (t.decals && t.decals[t.decalPick ?? -1]) || null;
const decalsPicked = (it, vp) => looksOf(it, vp).map(decalOf).filter(Boolean);
const decalRow = (label, key, extra) => ({ cat: 'decals', label, on: decalsPicked, get: d => decalValue(d, key), set: (d, v) => { d[key] = v; }, def: () => DECAL_DEFAULTS[key], ...extra });

export const SETTINGS = [
  { cat: 'extractor', ...on, on: sourcesKind('extractor') },
  { cat: 'extractor', kind: 'slider', label: 'Strength', min: 0, max: 4, step: 0.05, on: sourcesKind('extractor'), get: t => t.rate, set: (t, v) => { t.rate = v; },
    def: (t, vp) => sourceDefault(t, 'rate', vp), help: 'How hard it draws the air in. At 1, the air beside a 30 cm one moves in at about 0.3 m/s. Smoke well outside its Reach hardly feels it: raise Reach first.', also: 'Velocity Mult, sink' },
  { cat: 'extractor', kind: 'slider', label: 'Reach', min: 0.05, max: 1.5, step: 0.01, unit: ' m', on: sourcesKind('extractor'), get: t => t.radius, set: (t, v) => { t.radius = v; },
    def: (t, vp) => sourceDefault(t, 'radius', vp), help: 'How far round it the smoke is taken: the dashed ring in the view. This matters most: the smoke must reach the ring.', also: 'Radius, Size' },
  { cat: 'drain', ...on, on: sourcesKind('drain') },
  { cat: 'drain', kind: 'slider', label: 'Strength', min: 0, max: 4, step: 0.05, on: sourcesKind('drain'), get: t => t.rate, set: (t, v) => { t.rate = v; },
    def: (t, vp) => sourceDefault(t, 'rate', vp), help: 'How hard it pulls the water in. At 1, a 15 cm one takes about what a liquid source pours, some 30 litres a second.', also: 'sink' },
  { cat: 'drain', kind: 'slider', label: 'Reach', min: 0.05, max: 1.5, step: 0.01, unit: ' m', on: sourcesKind('drain'), get: t => t.radius, set: (t, v) => { t.radius = v; },
    def: (t, vp) => sourceDefault(t, 'radius', vp), help: 'How far round it the water is taken: the dashed ring in the view.', also: 'Radius, Size' },
  ...['smoke', 'liquid'].flatMap(k => [
    { cat: k, ...on, on: sourcesKind(k) },
    { cat: k, kind: 'color', label: 'Colour', on: sourcesKind(k), get: t => rgbToHex(t.color), set: (t, v) => { t.color = hexToRgb(v); }, list: true, also: 'Color' },
    { cat: k, kind: 'slider', label: 'Amount', min: 0, max: 3, step: 0.05, on: sourcesKind(k), get: t => t.rate, set: (t, v) => { t.rate = v; },
      def: (t, vp) => sourceDefault(t, 'rate', vp), help: k === 'smoke' ? 'How much smoke it puts out.' : 'How much liquid it sprays.', also: 'Density Mult, Spawn Rate' },
    { cat: k, kind: 'slider', label: 'Size', min: 0.03, max: 1, step: 0.01, unit: ' m', on: sourcesKind(k), get: t => t.radius, set: (t, v) => { t.radius = v; },
      def: (t, vp) => sourceDefault(t, 'radius', vp), help: k === 'smoke' ? 'Radius of the ball the smoke comes out of: the dashed ring in the view.' : 'Radius of the nozzle: the dashed ring in the view.', also: 'Radius, Splat Size' },
    { cat: k, kind: 'slider', label: 'Speed', min: 0, max: k === 'smoke' ? 4 : 8, step: 0.1, unit: ' m/s', on: sourcesKind(k), get: t => t.speed, set: (t, v) => { t.speed = v; },
      def: (t, vp) => sourceDefault(t, 'speed', vp), help: 'How fast it comes out.', also: 'Velocity Mult' },
    { cat: k, kind: 'action', label: k === 'smoke' ? 'All smoke settings…' : 'All liquid settings…', noCommit: true, title: 'How smoke and water behave in the whole scene: the Fluids tab.', on: sourcesKind(k), run: (t, c) => c.showTab('fluids'), also: 'Emitter Summary, Simulation' },
  ]),
  { cat: 'smoke', kind: 'slider', label: 'Heat', min: 0, max: 3, step: 0.05, on: sourcesKind('smoke'), get: t => t.heat ?? 1, set: (t, v) => { t.heat = v; },
    def: (t, vp) => sourceDefault(t, 'heat', vp), help: 'Hot smoke rises faster; 0 is a cold mist that sinks.', also: 'Temperature Mult' },

  { cat: 'aim', kind: 'dial', label: 'Compass', on: it => (it.kind === 'emitter' && !it.attach && !it.sink) || (isLight(it) && it.type !== 'point') ? [it] : [], get: t => aim(t).az,
    set: (t, v) => { t.dir = fromAngles(v, aim(t).el); }, also: 'Rotation' },
  { cat: 'aim', kind: 'slider', label: 'Up or down', min: -90, max: 90, step: 1, unit: '°', on: it => (it.kind === 'emitter' && !it.attach && !it.sink) || (isLight(it) && it.type !== 'point') ? [it] : [], get: t => aim(t).el,
    set: (t, v) => { t.dir = fromAngles(aim(t).az, v); }, help: '90 points straight up, -90 straight down.', also: 'Rotation Pitch' },

  { cat: 'timer', kind: 'toggle', label: 'On a timer', on: anySource, get: timed, set: (t, v, c) => { if (v) { PULSE(t); if (!(t.pulse.on > 0)) t.pulse.on = 3; if (!(t.pulse.off > 0)) t.pulse.off = 3; } else t.pulse = null; c.repaint(); },
    help: 'Switches itself on and off as the simulation plays, starting again with the fluids. Give sources the same times to group them.', also: 'Spawn Burst' },
  { cat: 'timer', kind: 'slider', label: 'On for', min: 0.1, max: 20, step: 0.1, unit: ' s', on: anySource, when: timed, get: t => (t.pulse && t.pulse.on) || 3, set: (t, v) => { PULSE(t).on = v; } },
  { cat: 'timer', kind: 'slider', label: 'Off for', min: 0.1, max: 20, step: 0.1, unit: ' s', on: anySource, when: timed, get: t => (t.pulse && t.pulse.off) || 3, set: (t, v) => { PULSE(t).off = v; } },
  { cat: 'timer', kind: 'slider', label: 'Starts after', min: 0, max: 20, step: 0.1, unit: ' s', on: anySource, when: timed, get: t => (t.pulse && t.pulse.delay) || 0, set: (t, v) => { PULSE(t).delay = v; } },

  { cat: 'light', ...on, on: lights, list: true },
  { cat: 'light', kind: 'color', label: 'Colour', on: lights, get: t => rgbToHex(t.color), set: (t, v) => { t.color = hexToRgb(v); }, list: true, also: 'Light Color' },
  { cat: 'light', kind: 'slider', label: 'Strength', min: 0, max: 40, step: 0.1, on: lights, get: t => t.power, set: (t, v) => { t.power = v; }, def: t => ({ area: 6, point: 3, spot: 12 }[t.type]),
    help: 'At 1, it lights a white wall a metre in front of it to mid-grey; twice as far, a quarter as bright.', also: 'Intensity' },
  { cat: 'light', kind: 'slider', label: 'Width', min: 0.04, max: 6, step: 0.01, unit: ' m', on: self(t => isLight(t) && t.type === 'area'), get: t => t.radius * 2, set: (t, v) => { t.radius = v / 2; },
    help: 'A bigger panel gives softer light and softer shadows.', also: 'Source Width' },
  { cat: 'light', kind: 'slider', label: 'Height', min: 0.04, max: 6, step: 0.01, unit: ' m', on: self(t => isLight(t) && t.type === 'area'), get: t => t.radius * 2 * (t.aspect ?? 0.6), set: (t, v) => { t.aspect = v / (t.radius * 2); }, also: 'Source Height' },
  { cat: 'light', kind: 'slider', label: 'Size', min: 0.01, max: 1, step: 0.005, unit: ' m', on: self(t => isLight(t) && t.type !== 'area'), get: t => t.radius, set: (t, v) => { t.radius = v; },
    help: 'Radius of the lamp: a bigger one gives softer shadows.', also: 'Source Radius' },
  { cat: 'light', kind: 'slider', label: 'Beam', min: 2, max: 170, step: 1, unit: '°', on: self(t => isLight(t) && t.type === 'spot'), get: t => t.angle ?? 40, set: (t, v) => { t.angle = v; }, def: () => 40,
    help: 'How wide the cone of light is, edge to edge.', also: 'Outer Cone Angle' },
  { cat: 'light', kind: 'slider', label: 'Soft edge', min: 0, max: 1, step: 0.01, on: self(t => isLight(t) && t.type === 'spot'), get: t => t.soft ?? 0.3, set: (t, v) => { t.soft = v; }, def: () => 0.3,
    help: 'How much of the beam fades out toward its edge.', also: 'Inner Cone Angle' },
  { cat: 'light', kind: 'toggle', label: 'Casts shadows', on: lights, get: t => t.shadows !== false, set: (t, v) => { t.shadows = v; }, def: () => true, also: 'Cast Shadows' },
  { cat: 'light', kind: 'toggle', label: 'Show the light', on: lights, get: t => t.show !== false, set: (t, v) => { t.show = v; }, def: () => true, help: 'Draw the lamp itself in the picture. Off, it still lights the scene.', also: 'Visible' },

  { cat: 'transform', kind: 'numbers', label: 'Position (m)', keys: ['X', 'Y', 'Z'], step: 0.05, on: self(placed), get: (t, i) => t.pos[i], also: 'Location',
    set: (t, i, v) => { v = i === 1 ? Math.max(0, v) : v; if (isObject(t) && t.home) t.home.pos[i] += v - t.pos[i]; t.pos[i] = v; },
    add: (t, i, d) => { const v = i === 1 ? Math.max(0, t.pos[i] + d) : t.pos[i] + d; if (isObject(t) && t.home) t.home.pos[i] += v - t.pos[i]; t.pos[i] = v; } },
  { cat: 'transform', kind: 'numbers', label: 'Rotation (°)', keys: ['Tilt', 'Turn', 'Roll'], step: 1, reset: 0, on: objects, get: (t, i) => t.rot[i] * DEG, also: 'Rotation Pitch Yaw',
    set: (t, i, v, c) => { t.rot[i] = v / DEG; if (t.home) t.home.rot[i] = v / DEG - (i === 1 && motionOn(t.motion) ? (motionAt(t, c.vp.simTime) || { turn: 0 }).turn : 0); },
    add: (t, i, d) => { t.rot[i] += d / DEG; if (t.home) t.home.rot[i] += d / DEG; } },
  { cat: 'transform', kind: 'numbers', label: 'Size (m)', keys: ['W', 'H', 'D'], step: 0.05, on: objects, get: (t, i) => t.size[i] * 2, also: 'Extent, Dimensions',
    set: (t, i, v, c) => {
      const how = SHAPES[t.shape].sizing, s = Math.max(0.01, v / 2);
      keepFoot(t, c.vp, () => {
        if (how === 'uniform') t.size = [s, s, s];
        else if (how === 'radius' && i !== 1) { t.size[0] = s; t.size[2] = s; }
        else t.size[i] = s;
      });
    } },
  { cat: 'transform', kind: 'numbers', label: 'Scale', keys: ['×'], step: 0.05, on: objects, also: 'Scale3D',
    get: (t, i, c) => { const b = baseOf(t, c.vp), k = t.size.map((v, j) => v / b[j]); return Math.abs(k[0] - k[1]) + Math.abs(k[1] - k[2]) < 1e-4 ? k[0] : MIXED; },
    set: (t, i, v, c) => { const b = baseOf(t, c.vp), k = Math.max(0.01, v); keepFoot(t, c.vp, () => { t.size = b.map(x => x * k); }); },
    def: () => 1, help: 'Against the size the tools make it: 1 is what you get when you drop it in.' },
  { cat: 'transform', kind: 'action', label: 'Put on the ground', title: 'Lower or raise it so its lowest point touches the ground (End).', on: objects, also: 'Snap to Floor, End',
    run: (t, c) => { const y = t.pos[1]; c.vp.dropToGround(t); if (t.home) t.home.pos[1] += t.pos[1] - y; } },

  { cat: 'material', kind: 'partpick', label: 'Part', on: it => (isObject(it) && it.partLooks ? [it] : []), also: 'Element, Material Slot', help: 'A model\'s parts each have their own material. Choose one, or All parts. Dropping an image on a part picks it too.' },
  { cat: 'material', kind: 'color', label: 'Colour', slot: 'color', on: objLooks, get: t => rgbToHex(t.color), set: (t, v) => { t.color = hexToRgb(v); }, list: true, also: 'Base Color, Diffuse' },
  { cat: 'material', kind: 'slider', label: 'Strength', min: 0, max: 1, step: 0.01, on: looksOf, when: t => hasMap(t, 'color'), get: t => texValue(t, 'mix'), set: (t, v) => setTex(t, 'mix', v), def: () => 1, help: 'How much of the colour picture shows over the colour above.' },
  { cat: 'material', kind: 'choice', label: 'Finish', options: OBJECT_FINISHES, wrap: true, on: objLooks, get: t => (solid(t) && t.pbr ? 'custom' : finishOf(t)), set: (t, v, c) => { t.finish = v === 'plain' ? null : v; delete t.pbr; c.repaint(); }, also: 'Material, Metallic, Roughness, Opacity',
    titles: { plain: 'In between: roughness 0.45', matte: 'No shine: paper, card, plaster. Roughness 0.9', gloss: 'A sharp shine: printed plastic, lacquer. Roughness 0.12', metal: 'Grainy metal that takes the colour of what it mirrors. Metallic 1, roughness 0.32', glass: 'Glass: mirrors what is round it, bends what is behind it, deepens in colour along its length', frosted: 'Frosted glass: glass with roughness 0.5, a pale skin, what is behind it blurred' } },
  pbrRow('Roughness', 'rough', 0, 1, 0.01, { slot: 'rough', also: 'Roughness, Glossiness', help: 'How blurred its reflections and highlights are: 0 a mirror, 1 chalk. With a picture on it, this is the picture\'s strength.' }),
  pbrRow('Metallic', 'metal', 0, 1, 0.01, { slot: 'metal', when: solid, also: 'Metallic', help: 'How much it is a metal: its colour goes from its paint to its reflections. Real things are 0 or 1.' }),
  pbrRow('Specular', 'spec', 0, 1, 0.01, { when: solid, also: 'Specular, Refractive Index', help: 'How much a non-metal mirrors head on. 0.5 is plastic, paint or wood (4 %).' }),
  pbrRow('Clear coat', 'coat', 0, 1, 0.01, { when: solid, also: 'Clearcoat', help: 'A sharp shiny layer over the surface, as on car paint or varnish.' }),
  pbrRow('Glow', 'glow', 0, 10, 0.05, { when: solid, also: 'Emissive', help: 'It gives off light in its own colour, seen, and bloom picks it up (Filters). It lights nothing else.' }),
  pbrRow('Grain', 'grain', 0, 1, 0.01, { when: solid, help: 'A fine sandblasted speckle over it.' }),
  { cat: 'material', kind: 'slider', label: 'Refraction', min: 1, max: 2.4, step: 0.01, on: looksOf, when: glassy, get: t => pbrValue(t, 'ior'), set: (t, v) => setPbr(t, 'ior', v), isDef: t => noPbr(t, 'ior'), toDef: t => clearPbr(t, 'ior'), also: 'Refractive Index, IOR', help: 'How much it bends what is behind it and how strongly it mirrors: 1 is air, 1.33 water, 1.5 glass, 2.4 diamond.' },
  { cat: 'material', kind: 'slider', label: 'Tint depth', min: 0, max: 5, step: 0.01, on: looksOf, when: glassy, get: t => pbrValue(t, 'depth'), set: (t, v) => setPbr(t, 'depth', v), isDef: t => noPbr(t, 'depth'), toDef: t => clearPbr(t, 'depth'), also: 'Transmission Color, Absorption', help: 'How fast its colour deepens along the way through it.' },
  { cat: 'material', kind: 'slider', label: 'Bump', slot: 'bump', min: -5, max: 5, step: 0.01, unit: ' cm', on: looksOf, when: t => hasMap(t, 'bump'), get: t => texValue(t, 'bump') * 100, set: (t, v) => setTex(t, 'bump', v / 100), def: () => 1, also: 'Bump Height', help: 'How high white stands over black in the picture. Only the light changes, not the outline. Below 0: black is high.' },
  { cat: 'material', kind: 'slider', label: 'Normal', slot: 'normal', min: 0, max: 3, step: 0.01, on: looksOf, when: t => hasMap(t, 'normal'), get: t => texValue(t, 'normalK'), set: (t, v) => setTex(t, 'normalK', v), def: () => 1, also: 'Normal Intensity', help: 'How strongly the normal map tilts the light.' },
  { cat: 'material', kind: 'toggle', label: 'Normal map made for DirectX', on: looksOf, when: t => hasMap(t, 'normal'), get: t => !!texValue(t, 'flipG'), set: (t, v) => setTex(t, 'flipG', v), also: 'Flip Green', help: 'Its green runs the other way: light looks as if it comes from below if this is wrong.' },
  { cat: 'material', kind: 'slider', label: 'Displacement', slot: 'disp', min: 0, max: 50, step: 0.1, unit: ' cm', on: looksOf, when: t => hasMap(t, 'disp') && solid(t), get: t => texValue(t, 'disp') * 100, set: (t, v) => setTex(t, 'disp', v / 100), def: () => 3, also: 'Displacement Height, World Displacement', help: 'How far white moves the surface out. It changes the outline and the shadow. Water and smoke still flow round the original shape.' },
  { cat: 'material', kind: 'slotonly', label: 'Opacity', slot: 'alpha', on: looksOf, when: t => hasMap(t, 'alpha') && solid(t), also: 'Opacity Mask', help: 'Where the picture is dark, the surface is cut away. Its shadow is not.' },
  { cat: 'material', kind: 'addmaps', label: 'Add a picture', on: looksOf, also: 'Texture, Map, Bump, Normal, Displacement, Opacity' },
  { cat: 'material', kind: 'swatches', label: 'Ready materials', on: objLooks, also: 'Material Instance' },

  texRow('Lies', 'map', { kind: 'pick', options: (ts, c) => MAPPINGS.filter(([k]) => k !== 'uv' || ts.every(t => { const o = ownerOf(t, c.vp), m = o && o.model ? c.vp.scene.models.get(o.model) : null; return m && m.uvs; })), also: 'Mapping Type, Texture Coordinate, UV', help: 'Box: each side takes it square on. Flat: from one side, through the whole thing. Cylinder and Ball: round it. Model: as the file laid it out.' }),
  texRow('Flat from', 'axis', { kind: 'choice', options: [['x', 'Side'], ['y', 'Top'], ['z', 'Front']], when: t => anyMap(t) && texValue(t, 'map') === 'plane' }),
  texRow('Repeat', 'wrap', { kind: 'choice', options: [['repeat', 'Repeat'], ['mirror', 'Mirror'], ['once', 'Once']], also: 'Tiling, Wrap, Tile', titles: { repeat: 'Tile after tile', mirror: 'Every other tile flipped, so the joins do not show', once: 'One tile, the plain surface round it' } }),
  { cat: 'texture', kind: 'slider', label: 'Tile size', log: true, min: 0.01, max: 20, step: 1, on: looksOf, when: anyMap, unit: ' m', get: t => texValue(t, 'w'), set: (t, v) => { const r = texValue(t, 'h') / Math.max(texValue(t, 'w'), 1e-6); setTex(t, 'w', v); setTex(t, 'h', +(v * r).toFixed(4)); }, also: 'Scale, Tiling, UV Scale', help: 'How wide one tile of the picture is, its height following. With the Model mapping, 1 is the model\'s own layout.' },
  { cat: 'texture', kind: 'numbers', label: 'Tile (m)', keys: ['W', 'H'], step: 0.01, on: looksOf, when: anyMap, get: (t, i) => texValue(t, i ? 'h' : 'w'), set: (t, i, v) => setTex(t, i ? 'h' : 'w', Math.max(1e-3, v)), also: 'Scale X, Scale Y', help: 'Its width and height apart: stretches the picture.' },
  { cat: 'texture', kind: 'slider', label: 'Rotation', min: -180, max: 180, step: 1, unit: '°', on: looksOf, when: anyMap, get: t => texValue(t, 'rot'), set: (t, v) => setTex(t, 'rot', v), def: () => 0, also: 'Angle, Rotation' },
  { cat: 'texture', kind: 'slider', label: 'Move across', min: -3, max: 3, step: 0.005, unit: ' m', on: looksOf, when: anyMap, get: t => texValue(t, 'x'), set: (t, v) => setTex(t, 'x', v), def: () => 0, also: 'Offset, Shift, Position' },
  { cat: 'texture', kind: 'slider', label: 'Move up', min: -3, max: 3, step: 0.005, unit: ' m', on: looksOf, when: anyMap, get: t => texValue(t, 'y'), set: (t, v) => setTex(t, 'y', v), def: () => 0, also: 'Offset, Shift, Position' },
  { cat: 'texture', kind: 'action', label: 'Fit once across it', title: 'One tile as wide as the thing, in the picture\'s proportions', on: looksOf, when: anyMap, noCommit: false, also: 'Fit, Reset',
    run: (t, c) => { const o = ownerOf(t, c.vp), id = Object.values(t.tex.maps)[0]; Object.assign(t.tex, fitTile(o ? o.size : null, c.vp.imageAspect(id)), { x: 0, y: 0, rot: 0 }); } },

  { cat: 'decals', kind: 'decals', label: 'Decals', on: looksOf, also: 'Label, Decal, Sticker' },
  decalRow('Size', 'w', { kind: 'slider', log: true, min: 0.01, max: 10, step: 1, unit: ' m', def: undefined, get: d => d.w, set: (d, v) => { const k = v / d.w; d.w = v; d.h *= k; }, also: 'Scale', help: 'Its width, its height following.' }),
  decalRow('Width, height', 'w', { kind: 'numbers', keys: ['W', 'H'], step: 0.01, def: undefined, get: (d, i) => (i ? d.h : d.w), set: (d, i, v) => { if (i) d.h = Math.max(1e-3, v); else d.w = Math.max(1e-3, v); }, help: 'Apart: stretches it.' }),
  decalRow('Opacity', 'opacity', { kind: 'slider', min: 0, max: 1, step: 0.01 }),
  decalRow('Rotation', 'rot', { kind: 'slider', min: -180, max: 180, step: 1, unit: '°', also: 'Angle' }),
  decalRow('Move across', 'x', { kind: 'slider', min: -2, max: 2, step: 0.002, unit: ' m', also: 'Position', help: 'Or drag it in the view.' }),
  decalRow('Move up', 'y', { kind: 'slider', min: -2, max: 2, step: 0.002, unit: ' m', also: 'Position' }),
  decalRow('Lies', 'wrap', { kind: 'choice', options: [[false, 'Flat'], [true, 'Wrapped']], get: d => !!decalValue(d, 'wrap'), set: (d, v) => { d.wrap = v === true || v === 'true'; }, also: 'Mapping, Projection', titles: { false: 'Thrown straight onto the surface, like a slide projector', true: 'Wrapped round its upright axis, like a label on a bottle' } }),
  decalRow('Reach', 'depth', { kind: 'slider', log: true, min: 0.002, max: 5, step: 1, unit: ' m', def: undefined, also: 'Depth', help: 'How far from where it lies it still prints: too far, and it comes through to the back of a thin thing.' }),
  decalRow('Tint', 'tint', { kind: 'color', get: d => rgbToHex(decalValue(d, 'tint')), set: (d, v) => { d.tint = hexToRgb(v); }, def: undefined, also: 'Color' }),
  decalRow('Take out', 'key', { kind: 'choice', options: [['none', 'Nothing'], ['white', 'White'], ['black', 'Black']], also: 'Alpha, Transparent, Background', titles: { none: 'As the picture is (a picture with transparency keeps it)', white: 'Takes out a white background: a logo on paper', black: 'Takes out a black background' } }),
  decalRow('Cut from', 'keyAt', { kind: 'slider', min: 0, max: 1, step: 0.01, when: d => decalValue(d, 'key') !== 'none', help: 'How far from the background colour a pixel must be to stay.' }),
  decalRow('Cut softness', 'keySoft', { kind: 'slider', min: 0, max: 0.5, step: 0.01, when: d => decalValue(d, 'key') !== 'none' }),
  decalRow('Blend', 'blend', { kind: 'choice', options: [['normal', 'Paint'], ['multiply', 'Stain'], ['add', 'Light']], also: 'Blend Mode, Multiply, Additive', titles: { normal: 'Covers the surface', multiply: 'Darkens it, the surface showing through', add: 'Glows' } }),
  decalRow('Its own finish', 'own', { kind: 'toggle', get: d => !!decalValue(d, 'own'), def: undefined, help: 'Off: ink on the surface, whose shine shows through. On: a sticker, with its own roughness and metal.' }),
  decalRow('Roughness', 'rough', { kind: 'slider', min: 0, max: 1, step: 0.01, when: d => !!decalValue(d, 'own') }),
  decalRow('Metallic', 'metal', { kind: 'slider', min: 0, max: 1, step: 0.01, when: d => !!decalValue(d, 'own') }),
  decalRow('Bump', 'bump', { kind: 'slider', min: -2, max: 2, step: 0.01, unit: ' cm', get: d => decalValue(d, 'bump') * 100, set: (d, v) => { d.bump = v / 100; }, also: 'Normal, Height', help: 'Raises its bright parts. Below 0: its dark parts.' }),
  decalRow('Flip across', 'flipX', { kind: 'toggle', def: undefined, get: d => !!decalValue(d, 'flipX') }),
  decalRow('Flip up', 'flipY', { kind: 'toggle', def: undefined, get: d => !!decalValue(d, 'flipY') }),

  { cat: 'physics', kind: 'toggle', label: 'Has weight: falls, can be pushed', on: objects, get: t => !!t.moves, also: 'Simulate Physics',
    set: (t, v, c) => { t.moves = v; if (v && motionOn(t.motion)) { t.motion.travel = 'none'; t.motion.spin = 0; t.motion.bob = 0; c.repaint(); } t.home = { pos: [...t.pos], rot: [...t.rot] }; c.repaintSoon(); },
    help: 'On: it falls, stacks, tumbles, and water and wind push it. Off: it stays where it is put (or follows its motion).' },
  { cat: 'physics', kind: 'pick', label: 'Made of', options: Object.entries(MATERIALS).map(([k, m]) => [k, `${m.label} (${m.density} kg/m³)`]), on: objects, get: t => t.material || 'wood', set: (t, v, c) => { t.material = v; c.repaintSoon(); },
    def: () => 'wood', help: 'Sets how heavy it is for its size, whether it floats, and its grip and bounce.', also: 'Phys Material Override, Density' },
  { cat: 'physics', kind: 'readout', label: 'Mass', on: objects, also: 'Mass in KG' },
  { cat: 'physics', kind: 'numbers', label: 'Mass (kg)', keys: ['kg'], step: 0.1, on: objects, when: t => !!t.moves, also: 'Mass in KG, Override Mass',
    get: (t, i, c) => { const m = c.vp.physics.massOf(t); return t.massKg > 0 ? t.massKg : m ? +m.mass.toFixed(3) : 0; }, set: (t, i, v, c) => { t.massKg = Math.max(0, v); c.repaintSoon(); },
    isDef: t => !t.massKg, toDef: (t, c) => { delete t.massKg; c.repaintSoon(); }, help: 'Type a mass to set it by hand; the arrow goes back to what its material and size give.' },
  { cat: 'physics', kind: 'toggle', label: 'Gravity', on: objects, when: t => !!t.moves, get: t => !t.noGravity, set: (t, v) => { if (v) delete t.noGravity; else t.noGravity = true; }, def: () => true, also: 'Enable Gravity', help: 'Off: it floats where it is until something pushes it.' },
  { cat: 'physics', kind: 'slider', label: 'Air drag', min: 0, max: 5, step: 0.05, on: objects, when: t => !!t.moves, get: t => t.linDamp || 0, set: (t, v) => { t.linDamp = v; }, def: () => 0, also: 'Linear Damping', help: 'Slows it down as it moves.' },
  { cat: 'physics', kind: 'slider', label: 'Spin drag', min: 0, max: 5, step: 0.05, on: objects, when: t => !!t.moves, get: t => t.angDamp || 0, set: (t, v) => { t.angDamp = v; }, def: () => 0, also: 'Angular Damping', help: 'Slows its turning.' },
  { cat: 'physics', kind: 'slider', label: 'Bounce', min: 0, max: 1, step: 0.01, on: objects, get: t => t.bounce ?? (MATERIALS[t.material] || MATERIALS.wood).bounce, set: (t, v) => { t.bounce = v; },
    isDef: t => t.bounce === undefined, toDef: t => { delete t.bounce; }, also: 'Restitution', help: 'How much it bounces back. The arrow goes back to what its material gives.' },
  { cat: 'physics', kind: 'slider', label: 'Grip', min: 0, max: 1.5, step: 0.01, on: objects, get: t => t.grip ?? (MATERIALS[t.material] || MATERIALS.wood).friction, set: (t, v) => { t.grip = v; },
    isDef: t => t.grip === undefined, toDef: t => { delete t.grip; }, also: 'Friction', help: 'How much it slides. The arrow goes back to what its material gives.' },
  { cat: 'physics', kind: 'action', label: 'Put back', title: 'Back to where it was put, still.', on: objects, when: t => !!t.moves, run: t => { if (t.home) { t.pos = [...t.home.pos]; t.rot = [...t.home.rot]; } }, also: 'Reset' },

  { cat: 'collision', kind: 'choice', label: 'Blocks', wrap: true, options: [['all', 'All'], ['objects', 'Objects'], ['fluids', 'Fluids'], ['none', 'None']], on: objects, also: 'Collision Presets, BlockAll, NoCollision',
    get: t => t.collides !== false ? (blocksFluid(t) ? 'all' : 'objects') : blocksFluid(t) ? 'fluids' : 'none',
    set: (t, v) => { t.collides = v === 'all' || v === 'objects'; t.blocksFluid = v === 'all' || v === 'fluids'; },
    def: () => 'all', titles: { all: 'Objects bump it, and smoke and water flow round it', objects: 'Objects bump it; smoke and water pass through', fluids: 'Smoke and water flow round it; objects pass through', none: 'Everything passes through (with weight, it still lands on the ground)' } },

  { cat: 'motion', kind: 'choice', label: 'Travel', options: [['none', 'Stays'], ['loop', 'Loop'], ['swing', 'There and back']], wrap: true, on: objects, get: t => (t.motion && t.motion.travel) || 'none', also: 'Rotating Movement, Interp To Movement',
    set: (t, v, c) => { M(t).travel = v; motionChanged(t, c); }, titles: { none: 'Stays where it was put', loop: 'Goes the distance, then starts again from where it was put', swing: 'Goes the distance and comes back' }, help: 'Moves on its own while the simulation plays; the fluids feel it.' },
  { cat: 'motion', kind: 'dial', label: 'Toward', on: objects, when: t => t.motion && t.motion.travel !== 'none', get: t => M(t).dir, set: (t, v) => { M(t).dir = v; } },
  { cat: 'motion', kind: 'slider', label: 'Speed', min: 0, max: 3, step: 0.01, unit: ' m/s', on: objects, when: t => t.motion && t.motion.travel !== 'none', get: t => M(t).speed, set: (t, v) => { M(t).speed = v; }, def: () => 0.3 },
  { cat: 'motion', kind: 'slider', label: 'Distance', min: 0.1, max: 16, step: 0.1, unit: ' m', on: objects, when: t => t.motion && t.motion.travel !== 'none', get: t => M(t).distance, set: (t, v) => { M(t).distance = v; }, def: () => 4, help: 'How far it goes before it starts again (or turns back).' },
  { cat: 'motion', kind: 'slider', label: 'Spin', min: -180, max: 180, step: 1, unit: '°/s', on: objects, get: t => (t.motion && t.motion.spin) || 0, set: (t, v, c) => { M(t).spin = v; motionChanged(t, c); }, def: () => 0, help: 'Turns about up, degrees a second (minus: the other way).', also: 'Rotation Rate' },
  { cat: 'motion', kind: 'slider', label: 'Bob', min: 0, max: 10, step: 0.5, unit: ' cm', on: objects, get: t => ((t.motion && t.motion.bob) || 0) * 100, set: (t, v, c) => { M(t).bob = v / 100; motionChanged(t, c); }, def: () => 0, help: "A walker's bounce." },

  { cat: 'draw', kind: 'toggle', label: 'Visible', on: it => (isObject(it) || it.kind === 'emitter' || it.kind === 'mark') ? [it] : [], get: t => !t.hidden, set: (t, v) => { if (v) delete t.hidden; else t.hidden = true; }, def: () => true, list: true, also: 'Visible, Actor Hidden In Game',
    help: 'Off: not drawn and not clickable in the view (the eye in the list); it still works: the fluids and objects still feel it.' },
  { cat: 'draw', kind: 'toggle', label: 'Casts a shadow', on: objects, get: t => !t.noShadow, set: (t, v) => { if (v) delete t.noShadow; else t.noShadow = true; }, def: () => true, also: 'Cast Shadow' },
];


function rowFor(p, things, ctx) {
  const vp = ctx.vp, commit = ctx.commit;
  const ts = [...new Set(things.flatMap(it => p.on(it, vp)))];
  if (!ts.length) return null;
  const live = () => ts.filter(t => !p.when || p.when(t));
  const get = i => { const l = live(); if (!l.length) return p.kind === 'numbers' ? 0 : false; return readAll(l, p.kind === 'numbers' ? t => p.get(t, i, ctx) : t => p.get(t, ctx)); };
  const first = () => p.get(live()[0] || ts[0], ctx);
  const after = () => { if (p.list) ctx.paintList(); if ((p.cat === 'texture' || p.cat === 'decals') && ['choice', 'toggle', 'pick'].includes(p.kind)) ctx.repaint(); };
  const set = v => { for (const t of ts) p.set(t, v, ctx); after(); };
  const tag = p.also ? `\nUnreal: ${p.also}` : '';
  const help = (p.help || '') + tag;
  const val = t => p.kind === 'numbers' ? p.get(t, 0, ctx) : p.get(t, ctx), put = (t, v) => { if (p.kind === 'numbers') p.set(t, 0, v, ctx); else p.set(t, v, ctx); };
  const resets = p.isDef ? { isDefault: () => ts.every(t => p.isDef(t)), toDefault: () => { for (const t of ts) p.toDef(t, ctx); after(); } }
    : p.def ? { isDefault: () => ts.every(t => same(val(t), p.def(t, vp))), toDefault: () => { for (const t of ts) put(t, p.def(t, vp)); after(); } } : {};
  let row;
  switch (p.kind) {
    case 'slider': row = slider({ label: p.label, min: p.min, max: p.max, step: p.step, unit: p.unit, log: p.log, slot: p.slot ? slotFor(p.slot, ts, ctx) : p.cat === 'material' ? el('span') : undefined, help, commit, get, first, set, ...resets }); break;
    case 'toggle': row = toggle({ label: p.label, help, commit, get, set }); break;
    case 'color': row = color({ label: p.label, slot: p.slot ? slotFor(p.slot, ts, ctx) : undefined, help, commit, get, first, set }); break;
    case 'choice': row = choice({ label: p.label, options: p.options, wrap: p.wrap, titles: p.titles, help, commit, get, set, ...resets }); break;
    case 'pick': row = pick({ label: p.label, options: typeof p.options === 'function' ? () => p.options(ts, ctx) : p.options, help, commit, get, set, ...resets }); break;
    case 'slotonly': row = el('div', { class: 'row has-slot', title: help }, el('label', {}, p.label), el('span'), el('span'), slotFor(p.slot, ts, ctx)); break;
    case 'partpick': {
      const o = ts[0], m = vp.scene.models.get(o.model);
      row = pick({ label: p.label, help, options: () => [['-1', 'All parts'], ...m.parts.map((x, k) => [String(k), x.name])], get: () => String(o.partPick ?? -1),
        set: v => { o.partPick = +v; ctx.rebuild(); } });
      break;
    }
    case 'addmaps': {
      const list = ['bump', 'normal', 'disp', 'alpha'].filter(k => !(k === 'disp' && !ts.every(t => ownerOf(t, vp))));
      const chips = list.map(k => {
        const s = slotFor(k, ts, ctx), box = el('span', { class: 'addmap' }, s, el('small', {}, MAP_SLOTS[k].label));
        box.paint = () => { box.hidden = ts.some(t => hasMap(t, k)) || (k === 'disp' && ts.some(glassy)) || (k === 'alpha' && ts.some(glassy)); };
        box.paint();
        return box;
      });
      row = el('div', { class: 'addmaps', title: help }, ...chips);
      row.paint = () => { row.hidden = chips.every(c => c.hidden); };
      row.paint();
      break;
    }
    case 'decals': {
      const box = el('div', { class: 'decals' });
      const paintList = () => {
        box.textContent = '';
        ts.forEach(t => (t.decals || []).forEach((d, k) => {
          const pic = el('img', { alt: '' });
          thumbFor(vp, d.image).then(u => { pic.src = u; });
          const m = vp.scene.images.get(d.image);
          box.append(el('div', { class: 'decal' + (t.decalPick === k ? ' on' : ''), onclick: () => { t.decalPick = t.decalPick === k ? -1 : k; ctx.editDecal(t, t.decalPick); ctx.rebuild(); } }, pic, el('span', {}, m ? m.name : 'image'),
            el('button', { type: 'button', class: 'ib', title: 'Take it off', 'aria-label': 'Take this decal off', onclick: e => { e.stopPropagation(); t.decals.splice(k, 1); t.decalPick = -1; if (!t.decals.length) delete t.decals; ctx.editDecal(t, -1); commit(); ctx.rebuild(); } }, icon('trash', 16))));
        }));
        box.append(el('div', { class: 'btns' }, button('Add a decal…', () => pickImageFile(async file => {
          try {
            const id = await vp.addImage(file, file.name), t = ts[0], o = ownerOf(t, vp);
            const at = vp.facingPoint(o);
            addDecal(vp, t, o, id, at.at, at.dir);
            ctx.editDecal(t, t.decalPick); commit(); ctx.rebuild();
          } catch (e) { console.error(e); ctx.say && ctx.say('Could not use it: ' + e.message); }
        }), { title: 'A picture on one place: on the side facing you. Or drop an image on it in the view.' })));
      };
      paintList();
      row = box;
      break;
    }
    case 'dial': row = dial({ label: p.label, help, commit, get, set }); break;
    case 'numbers': row = numbers({ label: p.label, keys: p.keys, step: p.step, help, commit, get,
      set: (i, v) => { for (const t of ts) p.set(t, i, v, ctx); }, add: p.add ? (i, d) => { for (const t of ts) p.add(t, i, d, ctx); } : undefined, reset: p.reset,
      ...(p.reset !== undefined ? { isDefault: () => p.keys.every((k, i) => ts.every(t => Math.abs(p.get(t, i, ctx) - p.reset) < 1e-6)),
        toDefault: () => p.keys.forEach((k, i) => { for (const t of ts) p.set(t, i, p.reset, ctx); }) } : resets) }); break;
    case 'swatches': row = el('div', { class: 'stackrow', title: help }, el('label', {}, p.label), swatches({ commit, items: SWATCHES.map(s => ({ label: s.label, color: s.color, clear: s.finish === 'glass' || s.finish === 'frosted',
      apply: () => { for (const t of ts) { t.color = hexToRgb(s.color); t.finish = s.finish; delete t.pbr; } ctx.repaint(); ctx.paintList(); } })) })); break;
    case 'action': row = el('div', { class: 'btns' }, button(p.label, () => { for (const t of live()) p.run(t, ctx); ctx.repaint(); if (!p.noCommit) commit(); }, { title: p.title })); break;
    case 'readout': {
      const text = el('p', { class: 'note' });
      row = text;
      text.paint = () => {
        const m = ts.map(t => vp.physics.massOf(t)).filter(Boolean);
        if (!m.length) { text.textContent = ''; return; }
        if (ts.length > 1) { text.textContent = `Together ${fmtN(m.reduce((a, x) => a + x.mass, 0))} kg.`; return; }
        const t = ts[0], mat = MATERIALS[t.material] || MATERIALS.wood, x = m[0], density = x.mass / x.volume;
        text.textContent = `${x.mass < 10 ? x.mass.toFixed(2) : fmtN(x.mass)} kg, ${(x.volume * 1000).toFixed(x.volume < 0.01 ? 2 : 0)} litres; ${density < 1000 ? 'floats' : 'sinks'} in water.`;
      };
      setTimeout(() => text.paint(), 50);
      break;
    }
  }
  if (p.when) {
    const inner = row.paint;
    row.paint = () => { row.hidden = !live().length; if (!row.hidden && inner) inner(); };
    row.paint();
  }
  row.dataset.find = `${p.label} ${CATS[p.cat]} ${p.also || ''}`.toLowerCase();
  return { row, count: things.filter(it => p.on(it, vp).length).length };
}


const foldKey = cat => 'cloudtank.fold.' + cat;
const folded = cat => { try { return localStorage.getItem(foldKey(cat)) === '1'; } catch { return false; } };
function setFolded(cat, v) { try { if (v) localStorage.setItem(foldKey(cat), '1'); else localStorage.removeItem(foldKey(cat)); } catch {   } }

export function category(cat, title, rows, note = '') {
  const head = el('h3', { class: 'cat', role: 'button', tabindex: '0', 'aria-expanded': 'true' }, el('span', { class: 'cat-t' }, icon('play', 12), title), note ? el('small', {}, note) : null);
  const sec = el('section', { class: 'sec' }, head, ...rows);
  sec.dataset.cat = cat;
  const paintFold = () => { const f = folded(cat); sec.classList.toggle('fold', f); head.setAttribute('aria-expanded', !f); };
  const flip = () => { setFolded(cat, !folded(cat)); paintFold(); };
  head.addEventListener('click', flip);
  head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  paintFold();
  return sec;
}

export function categoriesFor(things, ctx) {
  const out = [];
  for (const cat of CAT_ORDER) {
    const rows = [];
    let most = 0;
    for (const p of SETTINGS) {
      if (p.cat !== cat) continue;
      const r = rowFor(p, things, ctx);
      if (r) { rows.push(r.row); most = Math.max(most, r.count); }
    }
    if (!rows.length) continue;
    const n = things.length;
    const sec = category(cat, CATS[cat], rows, n > 1 && most < n ? `${most} of ${n}` : '');
    sec.paint = () => { sec.hidden = rows.every(r => r.hidden); };
    sec.paint();
    out.push(sec);
  }
  return out;
}
export function groundCategories(ctx) {
  const ground = { kind: 'ground', name: 'Ground' }, out = [];
  for (const cat of ['material', 'texture', 'decals']) {
    const rows = [];
    for (const p of SETTINGS) {
      if (p.cat !== cat) continue;
      const r = rowFor(p, [ground], ctx);
      if (r) rows.push(r.row);
    }
    if (!rows.length) continue;
    const sec = category('ground-' + cat, cat === 'material' ? 'Ground material' : cat === 'texture' ? 'Ground texture' : 'Ground decals', rows);
    sec.paint = () => { sec.hidden = rows.every(r => r.hidden); };
    sec.paint();
    out.push(sec);
  }
  return out;
}

export function filterRows(root, text) {
  const q = text.trim().toLowerCase();
  let shown = 0;
  for (const sec of root.querySelectorAll('section[data-cat]')) {
    let any = false;
    for (const r of sec.children) {
      if (r.tagName === 'H3') continue;
      const hit = !q || (r.dataset.find || '').includes(q);
      r.classList.toggle('nofind', !hit);
      if (hit && !r.hidden) any = true;
    }
    sec.classList.toggle('nofind', !any);
    sec.classList.toggle('finding', !!q);
    if (any) shown++;
  }
  return shown;
}

export { repaintAll, section };
