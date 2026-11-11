import { openGPU, makeBuffer, UNIFORM } from './gpu.js';
import { OrbitCamera } from './camera.js';
import { Scene, packObject, nameFor, SINK_RATE, lightAxes } from './scene.js';
import { Smoke } from './smoke.js';
import { Flip, dyeOf, carriedCount, FIELD } from './flip.js';
import { Renderer, MAX_DRAW, linear } from './renderer.js';
import { MAT_FLOATS, DECAL_FLOATS, MAX_DECALS, packLook, lookNeedsTex, hasMap, anyMap, texValue, isGlassLook, imagesOf } from './material.js';
import { bitmapForCard, imageSize, subdivide, MAX_IMAGE_LAYERS } from './images.js';
import { defaultLook, LIGHT_PRESETS, BACKGROUNDS, LEGACY, FINISHES, copy } from './environment.js';
import { defaults, hexToRgb, lightOf } from './settings.js';
import { MAX_OBJECTS, MAX_EMITTERS, ATLAS_RES, ATLAS_SLOTS, ATLAS_PAD, OBJ_FLOATS, FLUID_ROWS, FLUID_FLOATS } from './sdf.wgsl.js';
import { toUnitSpace, interleave } from './importers.js';
import { Physics, eulerOf, blocksFluid, setGravity } from './physics.js';
import { Gizmo, project } from './gizmo.js';
import { drawMarkers, kindShown } from './markers.js';
import { drawPins, pinAtScreen, removePin } from './pins.js';
import { ASSET_BY_ID, assetModel, assetModelId } from './assets.js';
import { drawMarks, pickMark, MARK_TYPES, motionOn } from './marks.js';
import { drawBox, drawLanding, drawReach, hitBoxHandle, beginBoxDrag, moveBoxDrag } from './boxhandles.js';
import { postIsNone, effectivePost, wantsBloom } from './post.wgsl.js';
import { mediaIsNone, effectiveMedia } from './media.wgsl.js';
import { FluidTable, thicknessOf } from './fluids.js';
import { FluidForms } from './fluidforms.js';
import { add, sub, scale, normalize, fromAngles, clamp, toHalf, eulerAxes, length, toLocal } from './math.js';
import { decalPlace } from './material.js';
import { SHAPES } from './shapes.js';
import { SoftWorld, softOn } from './softbody.js';
import { madeShape, meshOf, fieldOf, boundsOf, guardHalf, MADE_KINDS } from './made.js';
import { SoftField } from './softfield.js';

const HANDLE_TOOLS = new Set(['move', 'turn', 'size']);
const BAKED = new Map();

export function motionAt(o, t) {
  const m = o.motion;
  if (!motionOn(m)) return null;
  const dist = Math.max(m.distance || 0, 0.01), v = m.speed || 0;
  let d = 0;
  if (m.travel === 'loop') d = ((v * t) % dist + dist) % dist;
  else if (m.travel === 'swing') { const u = ((v * t) % (2 * dist) + 2 * dist) % (2 * dist); d = u < dist ? u : 2 * dist - u; }
  const a = (m.dir || 0) * Math.PI / 180;
  const bob = m.bob ? Math.abs(Math.sin(t * 5.2 + (o.id % 7))) * m.bob : 0;
  return { off: [Math.sin(a) * d, bob, Math.cos(a) * d], turn: (m.spin || 0) * Math.PI / 180 * t };
}

export const DETAIL = {
  draft:  { label: 'Draft',  smoke: 4 / 48,  liquid: 4 / 48 },
  normal: { label: 'Normal', smoke: 4 / 64,  liquid: 4 / 64 },
  high:   { label: 'High',   smoke: 4 / 96,  liquid: 4 / 80 },
  ultra:  { label: 'Ultra',  smoke: 4 / 128, liquid: 4 / 96 },
};
export const MAX_SMOKE_CELLS = 2_400_000;
export const MAX_LIQUID_CELLS = 1_800_000;
export const MAX_PARTICLES = 1 << 20;
export const REGION_LIMITS = { min: 1, max: 16 };


export function gridFor(size, cell, maxCells) {
  let c = cell;
  const dims = () => size.map(s => Math.max(8, Math.round(s / c)));
  let n = dims();
  while (n[0] * n[1] * n[2] > maxCells) { c *= 1.05; n = dims(); }
  return { cell: c, dims: n, coarsened: c > cell * 1.0001 };
}

export class Viewport {
  constructor(canvas, config = {}) {
    this.canvas = canvas;
    this.config = config;
    this.scene = new Scene();
    this.camera = new OrbitCamera(config.camera);
    this.settings = { ...defaults(), ...(config.settings || {}) };
    this.look = config.look ? copy(config.look) : defaultLook();
    const A = config.area || 4, D = DETAIL[config.detail || 'normal'];
    this.region = config.region ? copy(config.region) : { size: [A, A, A], center: [0, 0] };
    this.fineness = config.fineness ? { ...config.fineness } : { smoke: D.smoke, liquid: D.liquid };
    this.time = 0;
    this.simTime = 0;
    this.playing = true;
    this.display = { box: true, sources: true, takers: true, parts: true, smoke: true, liquid: true, marks: true };
    this.markerStyle = 'badge';
    this.pinStyle = 'pushpin';
    this.pinHot = null;
    this.pinRows = [];
    this.mouseIn = false;
    this.clean = false;
    this.markerSize = { k: 0.2, min: 0.018 };    this.simFrames = 0;
    this.markHits = new Map();
    this.stats = { fps: 0, simMs: 0, drawMs: 0, frames: 0 };
    this.handlers = {};
    this.emitterData = new Float32Array(MAX_EMITTERS * 16);
    this.fluids = new FluidTable();
    this.objectData = new Float32Array(MAX_OBJECTS * OBJ_FLOATS);
    this.drawData = new Float32Array(MAX_DRAW * OBJ_FLOATS);
    this.matData = new Float32Array((MAX_DRAW + 1) * MAT_FLOATS);
    this.decalData = new Float32Array(MAX_DECALS * DECAL_FLOATS);
    this.stirMove = null;
    this.placing = null;
    this.windNow = [0, 0, 0];
    this.physics = new Physics();
    this.soft = new SoftWorld();
    this.softField = new SoftField();
    this.overlay = config.overlay || null;
    this.gizmo = new Gizmo();
    this.tool = 'move';
    if (config.env) this.setEnv(config.env);
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, arg) { for (const fn of this.handlers[name] || []) fn(arg); }

  async init() {
    this.gpu = await openGPU();
    const d = this.gpu.device;
    const atlas = d.createTexture({ size: [ATLAS_RES, ATLAS_RES, ATLAS_RES * ATLAS_SLOTS], dimension: '3d', format: 'r16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'model shapes' });
    this.shared = {
      emitters: makeBuffer(d, MAX_EMITTERS * 64, UNIFORM(), 'sources'),
      fluids: makeBuffer(d, FLUID_ROWS * FLUID_FLOATS * 4, UNIFORM(), 'each fluid\'s numbers'),
      objects: makeBuffer(d, MAX_OBJECTS * OBJ_FLOATS * 4, UNIFORM(), 'objects'),
      atlas,
      atlasView: atlas.createView(),
      atlasSampler: d.createSampler({ magFilter: 'linear', minFilter: 'linear',
        addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
    };
    this.freeSlots = [...Array(ATLAS_SLOTS).keys()];
    await this.buildSolvers();
    this.renderer = new Renderer(this.gpu, this.canvas);
    await this.renderer.init();
    this.renderer.fluidBuf = this.shared.fluids;
    this.forms = new FluidForms(this.gpu, this.renderer);
    if (this.gpu.timestamps) {
      this.querySet = d.createQuerySet({ type: 'timestamp', count: 4 });
      this.qResolve = d.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.qRead = d.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      this.qBusy = false;
    }
    this.populate();
    this.attachInput();
    this.ready = true;
  }

  async buildSolvers(keep = false) {
    const c = this.config, R = this.region, F = this.fineness;
    const cornerFor = cell => [Math.round((R.center[0] - R.size[0] / 2) / cell) * cell, 0, Math.round((R.center[1] - R.size[2] / 2) / cell) * cell];
    const old = [this.smoke, this.flip];
    let smoke = null, flip = null;
    this.gridNote = [];
    if (c.smoke !== false && c.smoke !== null) {
      let o = c.smoke;
      if (typeof o !== 'object') {
        const g = gridFor(R.size, F.smoke, MAX_SMOKE_CELLS);
        if (g.coarsened) this.gridNote.push(`smoke cells widened to ${(g.cell * 100).toFixed(1)} cm to fit the card`);
        o = { dims: g.dims, min: cornerFor(g.cell), cell: g.cell };
      }
      smoke = new Smoke(this.gpu, this.shared, o);
      await smoke.init();
    }
    if (c.liquid !== false && c.liquid !== null) {
      let o = c.liquid;
      if (typeof o !== 'object') {
        const g = gridFor(R.size, F.liquid, MAX_LIQUID_CELLS);
        if (g.coarsened) this.gridNote.push(`liquid cells widened to ${(g.cell * 100).toFixed(1)} cm to fit the card`);
        const cells = g.dims[0] * g.dims[1] * g.dims[2];
        const carried = keep && this.flip ? carriedCount(this.flip, g.cell) + (1 << 16) : 0;
        const maxParticles = Math.min(MAX_PARTICLES, Math.round(Math.max(1 << 16, cells * 8 * 0.4, carried) / 256) * 256);
        o = { dims: g.dims, min: cornerFor(g.cell), cell: g.cell, maxParticles };
      }
      flip = new Flip(this.gpu, this.shared, o);
      await flip.init();
    }
    if (keep && smoke && old[0]) smoke.carryFrom(old[0]);
    if (keep && flip && old[1]) flip.carryFrom(old[1]);
    this.smoke = smoke;
    this.flip = flip;
    if (this.physics) this.physics.setWater(null);
    if (this.renderer) this.renderer.groupCache.clear();
    await this.gpu.device.queue.onSubmittedWorkDone();
    for (const s of old) if (s) s.destroy();
  }

  setSimulation({ region, fineness, area, detail, keep = false } = {}) {
    if (area) region = { size: [area, area, area], center: [0, 0] };
    if (detail) fineness = { smoke: DETAIL[detail].smoke, liquid: DETAIL[detail].liquid };
    if (region) {
      const L = REGION_LIMITS;
      this.region = { size: region.size.map(v => clamp(+v || 4, L.min, L.max)), center: region.center.map(v => clamp(+v || 0, -20, 20)) };
    }
    if (fineness) this.fineness = { smoke: clamp(fineness.smoke, 0.02, 0.25), liquid: clamp(fineness.liquid, 0.02, 0.25) };
    this.config = { ...this.config, smoke: this.config.smoke === null ? null : true, liquid: this.config.liquid === null ? null : true };
    this.buildKeep = this.building ? this.buildKeep && keep : keep;
    if (this.building) { this.buildAgain = true; return this.building; }
    this.building = (async () => {
      try {
        do { this.buildAgain = false; const k = this.buildKeep; this.buildKeep = true; await this.buildSolvers(k); } while (this.buildAgain);
      } finally { this.building = null; }
    })();
    return this.building;
  }

  extentOf(it) {
    if (it.kind === 'emitter') return { lo: it.pos.map(v => v - it.radius), hi: it.pos.map(v => v + it.radius) };
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    if (it.model && !this.scene.models.has(it.model)) return { lo: it.pos.map((v, k) => v - it.size[k]), hi: it.pos.map((v, k) => v + it.size[k]) };
    const mesh = this.scene.meshOf(it), ax = eulerAxes(it.rot);
    for (let i = 0; i < mesh.length; i += 6) {
      const x = mesh[i] * it.size[0], y = mesh[i + 1] * it.size[1], z = mesh[i + 2] * it.size[2];
      for (let k = 0; k < 3; k++) {
        const v = it.pos[k] + ax[0][k] * x + ax[1][k] * y + ax[2][k] * z;
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    return { lo, hi };
  }

  boxToTake(items, room = 0.2) {
    const S = this.scene, B = this.regionBox, lo = [...B.min], hi = [...B.max];
    const all = [...items];
    for (const it of items) if (it.kind === 'object') all.push(...S.emitters.filter(e => e.attach && e.attach.to === it.id && !all.includes(e)));
    let out = false;
    for (const it of all) {
      if (it.kind !== 'object' && it.kind !== 'emitter') continue;
      const x = this.extentOf(it);
      for (const k of [0, 1, 2]) {
        if (k !== 1 && x.lo[k] < B.min[k]) { lo[k] = Math.min(lo[k], x.lo[k] - room); out = true; }
        if (x.hi[k] > B.max[k]) { hi[k] = Math.max(hi[k], x.hi[k] + room); out = true; }
      }
    }
    if (!out) return null;
    const cm = v => Math.ceil(v * 100 - 1e-6) / 100, L = REGION_LIMITS;
    const want = [hi[0] - lo[0], hi[1], hi[2] - lo[2]].map(cm);
    return { size: want.map(v => Math.min(L.max, v)), center: [+((lo[0] + hi[0]) / 2).toFixed(3), +((lo[2] + hi[2]) / 2).toFixed(3)],
      clipped: want.some(v => v > L.max) };
  }

  get regionBox() {
    const R = this.region;
    return { min: [R.center[0] - R.size[0] / 2, 0, R.center[1] - R.size[2] / 2],
      max: [R.center[0] + R.size[0] / 2, R.size[1], R.center[1] + R.size[2] / 2] };
  }

  async setSmokeDetail(n) {
    const old = this.smoke;
    const size = old.max[0] - old.min[0];
    this.config = { ...this.config, smoke: { dims: [n, n, n], min: old.min, cell: size / n } };
    const next = new Smoke(this.gpu, this.shared, this.config.smoke);
    await next.init();
    this.smoke = next;
    this.renderer.groupCache.clear();
    await this.gpu.device.queue.onSubmittedWorkDone();
    old.destroy();
  }

  populate() {
    const models = this.scene.models;
    this.scene = new Scene();
    this.scene.models = models;
    if (this.config.build) this.config.build(this);
    this.emit('select', null);
    this.emit('change');
  }

  putBack() { this.physics.putBack(this.scene); this.soft.restart(); }

  resetFluids() {
    if (this.smoke) this.smoke.reset();
    if (this.flip) this.flip.reset();
    if (this.config.refill) this.config.refill(this);
    this.fluids.forgetGone(this.scene.emitters);
    this.fluidRun = (this.fluidRun || 0) + 1;
    if (this.physics) this.physics.setWater(null);
    this.simTime = 0;
    this.simFrames = 0;
  }

  reset() {
    if (this.smoke) this.smoke.reset();
    if (this.flip) this.flip.reset();
    this.populate();
  }

  set(key, value) {
    this.settings[key] = value;
    if (key === 'smokeColor') for (const e of this.scene.emitters) if (e.type === 'smoke' && !e.sink) e.color = hexToRgb(value);
    if (key === 'liquidColor') for (const e of this.scene.emitters) if (e.type === 'liquid' && !e.sink) e.color = hexToRgb(value);
    if (key === 'objectColor') for (const o of this.scene.objects) o.color = hexToRgb(value);
  }

  setEnv(name) {
    const L = LEGACY[name];
    if (!L) return;
    this.envName = name;
    this.look.light = { preset: L.light, ...copy(LIGHT_PRESETS[L.light]) };
    this.look.background = { preset: L.background, ...copy(BACKGROUNDS[L.background]), image: null };
    if (L.bg) { this.look.background.top = L.bg; this.look.background.bottom = L.bg; }
    this.look.ground = { ...L.ground };
    this.look.weather.rain = L.rain;
  }

  setBackgroundImage(bitmap) { this.renderer.setBackgroundImage(bitmap); }

  setPost(p) { this.look.post = p ? copy(p) : null; }

  select(item) {
    if (!item || !softOn(item)) this.pinTool = false;
    this.scene.selected = item;
    this.scene.picks = item ? [item] : [];
    this.emit('select', item);
  }
  selectAll(items) {
    this.scene.picks = [...new Set(items.filter(Boolean))];
    this.scene.selected = this.scene.picks[this.scene.picks.length - 1] || null;
    this.emit('select', this.scene.selected);
  }
  togglePick(item) {
    const S = this.scene;
    if (!item) return;
    const had = S.picks.length ? S.picks : S.selected ? [S.selected] : [];
    const picks = had.filter(p => p !== item);
    if (picks.length === had.length) picks.push(item);
    S.picks = picks;
    S.selected = picks.includes(item) ? item : picks[picks.length - 1] || null;
    this.emit('select', S.selected);
  }
  selectedItems() {
    const S = this.scene, all = S.items;
    return [...new Set(S.picks.length ? S.picks : S.selected ? [S.selected] : [])].filter(it => all.includes(it));
  }
  movers() {
    const out = [];
    for (const it of this.selectedItems()) {
      const t = this.kitOf(it) || it;
      if (t.kind === 'mark' && (!t.pos || t.target != null || MARK_TYPES[t.type].screen)) continue;
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }
  groupFor(movers) {
    if (this.drag && this.drag.mode === 'gizmo' && this.drag.item.kind === 'group') return this.drag.item;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of movers) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[k]); hi[k] = Math.max(hi[k], m.pos[k]); }
    const pos = lo.map((v, k) => (v + hi[k]) / 2), g = this.group;
    if (g && g.members.length === movers.length && g.members.every((m, i) => m === movers[i]) && g.pos.every((v, k) => Math.abs(v - pos[k]) < 1e-9)) return g;
    return (this.group = { kind: 'group', name: `${movers.length} selected`, pos, rot: [0, 0, 0], size: [1, 1, 1], members: movers });
  }
  applyGroup(dr) {
    const g = dr.item, c0 = dr.c0, T = sub(g.pos, c0), R = eulerAxes(g.rot), Sz = g.size;
    const rot = v => [0, 1, 2].map(i => R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2]);
    for (const s of dr.starts) {
      const m = s.m, d = sub(s.pos, c0), p = add(add(c0, T), rot([d[0] * Sz[0], d[1] * Sz[1], d[2] * Sz[2]]));
      m.pos = [clamp(p[0], -12, 12), clamp(p[1], 0, 12), clamp(p[2], -12, 12)];
      if (s.rot) m.rot = eulerOf(eulerAxes(s.rot).map(rot));
      if (s.dir) m.dir = normalize(rot(s.dir));
      if (s.size && m.kind === 'object') {
        let k = eulerAxes(s.rot || [0, 0, 0]).map(a => Math.hypot(a[0] * Sz[0], a[1] * Sz[1], a[2] * Sz[2]));
        const how = m.shape && SHAPES[m.shape] ? SHAPES[m.shape].sizing : 'xyz';
        if (how === 'uniform') { const u = (k[0] + k[1] + k[2]) / 3; k = [u, u, u]; }
        else if (how === 'radius') { const u = (k[0] + k[2]) / 2; k = [u, k[1], u]; }
        m.size = s.size.map((v, j) => clamp(v * k[j], 0.005, 8));
      }
      if (s.radius !== undefined && (m.kind === 'emitter' || m.kind === 'light')) {
        const f = (Sz[0] + Sz[1] + Sz[2]) / 3;
        m.radius = m.kind === 'emitter' ? clamp(s.radius * f, 0.03, 1) : clamp(s.radius * f, 0.01, 3);
      }
    }
    const t = this.gizmo.drag;
    if (t && this.gizmo.mode === 'size') t.readout = `× ${Sz.reduce((a, v) => Math.abs(v - 1) > Math.abs(a - 1) ? v : a, 1).toFixed(2)}`;
  }
  startsOf(members) {
    return members.map(m => ({ m, pos: [...m.pos], rot: m.rot ? [...m.rot] : null, size: m.size ? [...m.size] : null,
      dir: m.dir && m.kind !== 'object' ? [...m.dir] : null, radius: m.radius }));
  }

  isOn(e) {
    if (e.on === false) return false;
    const p = e.pulse;
    if (!p || !(p.on > 0) || !(p.off > 0)) return true;
    const t = this.simTime - (p.delay || 0);
    if (t < 0) return false;
    return t % (p.on + p.off) < p.on;
  }

  dropToGround(o, y = 0) {
    const mesh = this.scene.meshOf(o), ax = eulerAxes(o.rot);
    let low = Infinity;
    for (let i = 0; i < mesh.length; i += 6) {
      const x = mesh[i] * o.size[0], yy = mesh[i + 1] * o.size[1], z = mesh[i + 2] * o.size[2];
      low = Math.min(low, ax[0][1] * x + ax[1][1] * yy + ax[2][1] * z);
    }
    o.pos[1] = y - low;
  }

  addAsset(id, at, opts = {}) {
    const a = ASSET_BY_ID[id];
    if (!a) return null;
    const base = { rot: [...(a.rot || [0, 0, 0])], pos: [at[0], 0, at[2]], color: hexToRgb(opts.color || a.color), finish: a.finish || null,
      moves: !!a.moves, collides: a.collides !== false, material: a.material || 'wood', name: opts.name || nameFor(a.name || a.label), asset: id };
    let o, centre = [0, 0, 0];
    if (a.shape) o = this.scene.addObject({ ...base, shape: a.shape, size: [...a.size] });
    else {
      const mid = assetModelId(id), made = assetModel(id);
      if (this.scene.objects.length >= MAX_OBJECTS) return null;
      if (!this.scene.models.has(mid)) this.addModel(made, { id: mid });
      const m = this.scene.models.get(mid), k = opts.scale || 1;
      centre = made.centre;
      o = this.scene.addObject({ ...base, shape: 'model', model: mid, size: m.fileHalf.map(v => v * k) });
    }
    if (!o) return null;
    this.dropToGround(o, opts.lift ?? (a.lift ?? 0) + (opts.on || 0));
    o.home = { pos: [...o.pos], rot: [...o.rot] };
    const k = opts.scale || 1, need = (a.sources || []).length;
    if (need && this.scene.emitters.length + need > MAX_EMITTERS) { o.whenInBox = { parts: true }; return { object: o, sources: [], waiting: true }; }
    return { object: o, sources: this.addKitParts(o, a, [k, k, k], centre) };
  }

  addKitParts(o, a, ks, centre = [0, 0, 0], fullSize = false) {
    const sources = [], ax = eulerAxes(o.rot);
    const kr = fullSize ? 1 : ks[0] === ks[1] && ks[1] === ks[2] ? ks[0] : (ks[0] + ks[1] + ks[2]) / 3;
    for (const [part, s] of (a.sources || []).entries()) {
      const l = s.at.map((v, i) => (v - centre[i]) * ks[i]);
      const pos = [0, 1, 2].map(i => o.pos[i] + ax[0][i] * l[0] + ax[1][i] * l[1] + ax[2][i] * l[2]);
      const dir = [0, 1, 2].map(i => ax[0][i] * s.dir[0] + ax[1][i] * s.dir[1] + ax[2][i] * s.dir[2]);
      const e = this.scene.addEmitter({ type: s.type, pos, dir, radius: s.radius * kr, speed: s.speed ?? 0, rate: s.rate, heat: s.heat ?? 1,
        color: hexToRgb(s.color || '#2a2d33'), sink: !!s.sink, attach: { to: o.id, part },
        name: `${a.label} ${s.sink ? 'intake' : s.type === 'smoke' ? (s.heat === 0 ? 'mist' : 'smoke') : 'pour'}` });
      if (e) sources.push(e);
    }
    return sources;
  }

  giveOnEntry() {
    const S = this.scene, B = this.regionBox;
    let changed = false;
    for (const o of S.objects) {
      const w = o.whenInBox;
      if (!w) continue;
      if (o.pos[0] < B.min[0] || o.pos[0] > B.max[0] || o.pos[2] < B.min[2] || o.pos[2] > B.max[2]) { o.full = false; continue; }
      if (w.moves) { o.moves = true; delete w.moves; changed = true; }
      const a = ASSET_BY_ID[o.asset], need = a && a.sources ? a.sources.length : 0;
      if (w.parts && !need) delete w.parts;
      if (w.parts) {
        const m = o.model ? S.models.get(o.model) : null;
        if (o.model && !m) continue;
        if (S.emitters.length + need > MAX_EMITTERS) {
          if (!o.full) this.emit('notice', `${o.name} is in the box, but a scene holds ${MAX_EMITTERS} sources, drains and extractors, so its working part is not added yet. Delete one and it will be.`);
          o.full = true;
        } else {
          const ks = m ? o.size.map((v, i) => v / m.fileHalf[i]) : o.size.map((v, i) => v / a.size[i]);
          const made = m ? assetModel(o.asset, m.design || 1) : null;
          this.addKitParts(o, a, ks, made ? made.centre : [0, 0, 0], true);
          delete w.parts; o.full = false; changed = true;
        }
      }
      if (!w.moves && !w.parts) o.whenInBox = null;
    }
    if (changed) this.emit('change');
  }

  partSpot(o, part) {
    const a = ASSET_BY_ID[o.asset], list = a && a.sources;
    if (!list || !list.length) return null;
    const s = list[Math.min(Math.max(part | 0, 0), list.length - 1)];
    const m = o.model ? this.scene.models.get(o.model) : null;
    if (o.model && !m) return null;
    const ks = m ? o.size.map((v, k) => v / m.fileHalf[k]) : o.size.map((v, k) => v / a.size[k]);
    const centre = m ? assetModel(o.asset, m.design || 1).centre : [0, 0, 0];
    const ax = eulerAxes(o.rot), l = s.at.map((v, k) => (v - centre[k]) * ks[k]);
    return { pos: [0, 1, 2].map(k => o.pos[k] + ax[0][k] * l[0] + ax[1][k] * l[1] + ax[2][k] * l[2]),
      dir: [0, 1, 2].map(k => ax[0][k] * s.dir[0] + ax[1][k] * s.dir[1] + ax[2][k] * s.dir[2]) };
  }
  kitOf(it) {
    return it && it.kind === 'emitter' && it.attach ? this.scene.objects.find(o => o.id === it.attach.to) || null : null;
  }

  followObjects() {
    const S = this.scene;
    const same = (a, b) => !!b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-7;
    const count = new Map();
    for (const e of S.emitters) {
      const at = e.attach;
      if (!at) continue;
      const o = S.objects.find(x => x.id === at.to);
      if (!o) { e.attach = null; continue; }
      const n = count.get(o) || 0;
      count.set(o, n + 1);
      const spot = this.partSpot(o, Number.isInteger(at.part) ? at.part : n);
      if (spot) { e.pos = spot.pos; e.dir = spot.dir; at.lastPos = [...e.pos]; at.lastDir = [...e.dir]; continue; }
      const ax = eulerAxes(o.rot), sz = o.size.map(v => Math.max(v, 1e-6));
      if (!at.spot || !same(e.pos, at.lastPos)) {
        const d = sub(e.pos, o.pos);
        at.spot = [0, 1, 2].map(k => (ax[k][0] * d[0] + ax[k][1] * d[1] + ax[k][2] * d[2]) / sz[k]);
      }
      if (!at.aim || !same(e.dir, at.lastDir)) at.aim = [0, 1, 2].map(k => ax[k][0] * e.dir[0] + ax[k][1] * e.dir[1] + ax[k][2] * e.dir[2]);
      e.pos = [0, 1, 2].map(i => o.pos[i] + ax[0][i] * at.spot[0] * sz[0] + ax[1][i] * at.spot[1] * sz[1] + ax[2][i] * at.spot[2] * sz[2]);
      e.dir = [0, 1, 2].map(i => ax[0][i] * at.aim[0] + ax[1][i] * at.aim[1] + ax[2][i] * at.aim[2]);
      at.lastPos = [...e.pos];
      at.lastDir = [...e.dir];
    }
  }

  togglePinAt(o, b, local) {
    const s = o.soft, near = (b.meanEdge * 2) ** 2, list = [...(s.pinAt || [])];
    const at = local.map((v, k) => v / o.size[k]);
    const dist2 = q => (q[0] * o.size[0] - local[0]) ** 2 + (q[1] * o.size[1] - local[1]) ** 2 + (q[2] * o.size[2] - local[2]) ** 2;
    const kept = list.filter(q => dist2(q) > near);
    if (kept.length === list.length) kept.push(at);
    s.pinAt = kept.length ? kept : null;
    s.preset = s.preset || 'custom';
    this.emit('change');
  }

  applyMotion(t) {
    for (const o of this.scene.objects) {
      if (o.held || !o.motion || !o.home || softOn(o)) continue;
      const m = motionAt(o, t);
      if (!m) continue;
      o.pos = add(o.home.pos, m.off);
      o.rot = [o.home.rot[0], o.home.rot[1] + m.turn, o.home.rot[2]];
    }
  }


  addModel(parsed, { id } = {}) {
    if (!this.freeSlots.length) throw new Error(`A scene can hold ${ATLAS_SLOTS} different models; delete one first.`);
    const unit = parsed.positions && parsed.prop ? parsed : toUnitSpace(parsed);
    const mesh = interleave(unit.positions, unit.normals);
    const slot = this.freeSlots.shift();
    const modelId = id || `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const entry = { id: modelId, name: parsed.name, mesh, positions: unit.positions, normals: unit.normals,
      prop: unit.prop, fileHalf: unit.fileHalf || null, slot, triangles: unit.positions.length / 9, ready: false,
      color: parsed.color || null, zUp: !!parsed.zUp, asset: parsed.asset || null, design: parsed.design || null,
      uvs: parsed.uvs || null, parts: parsed.parts && parsed.parts.length > 1 ? parsed.parts.map(p => ({ name: p.name, first: p.first, count: p.count })) : null };
    if (parsed.madeKey) { entry.madeKey = parsed.madeKey; entry.madeCentre = parsed.madeCentre; }
    this.scene.models.set(modelId, entry);
    this.renderer.addMesh('model:' + modelId, mesh, { uvs: entry.uvs });
    entry.whenReady = parsed.field ? Promise.resolve(this.writeField(entry, parsed.field, 0)) : this.bakeModel(entry);
    return modelId;
  }

  writeField(entry, f, ms) {
    const half = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) half[i] = toHalf(f[i]);
    entry.field = f;
    this.gpu.device.queue.writeTexture({ texture: this.shared.atlas, origin: [0, 0, entry.slot * ATLAS_RES] }, half,
      { bytesPerRow: ATLAS_RES * 2, rowsPerImage: ATLAS_RES }, [ATLAS_RES, ATLAS_RES, ATLAS_RES]);
    entry.ready = true;
    entry.bakeMs = ms;
    return entry;
  }


  modelForRecipe(recipe, { id, keep } = {}) {
    const key = JSON.stringify(recipe);
    for (const m of this.scene.models.values()) if (m.madeKey === key) return m.id;
    const t0 = performance.now();
    const shape = madeShape(recipe), mesh = meshOf(shape, recipe.kind === 'spin' ? 90 : 100);
    if (!mesh.triangles) throw new Error('There is nothing to make: the drawing has no inside.');
    const b = boundsOf(mesh.positions), h = guardHalf(b.half);
    const grid = fieldOf(shape, b.centre, h);
    const parsed = { name: MADE_KINDS[recipe.kind] || 'Made', positions: mesh.positions, normals: mesh.normals, madeKey: key, madeCentre: b.centre, field: grid.field };
    if (!this.freeSlots.length) this.dropUnusedModels(new Set([...(keep || [])].filter(k => { const m = this.scene.models.get(k); return m && !m.madeKey; })));
    const made = this.addModel(parsed, id && !this.scene.models.has(id) ? { id } : {});
    const entry = this.scene.models.get(made);
    entry.makeMs = { mesh: mesh.ms, grid: grid.ms, all: performance.now() - t0, triangles: mesh.triangles };
    return made;
  }

  ensureMade(keep) {
    for (const o of this.scene.objects) {
      if (!o.made) continue;
      const m = o.model && this.scene.models.get(o.model);
      if (m && m.madeKey === JSON.stringify(o.made)) continue;
      o.model = this.modelForRecipe(o.made, { id: o.model, keep });
    }
  }

  remakeMade(o, recipe, keep) {
    const was = this.scene.models.get(o.model);
    const id = this.modelForRecipe(recipe, { keep });
    const m = this.scene.models.get(id), ax = eulerAxes(o.rot);
    if (was && was.madeCentre) {
      const k = o.size.map((s, i) => s / was.fileHalf[i]);
      const anchor = add(o.pos, this.toWorldOf(ax, was.madeCentre.map((c, i) => -c * k[i])));
      o.size = m.fileHalf.map((v, i) => v * k[i]);
      o.pos = add(anchor, this.toWorldOf(ax, m.madeCentre.map((c, i) => c * k[i])));
      if (o.home) o.home = { pos: [...o.pos], rot: [...o.rot] };
    }
    o.made = recipe;
    o.model = id;
    this.dropUnusedModels(keep);
    return id;
  }
  toWorldOf(ax, v) { return [0, 1, 2].map(i => ax[0][i] * v[0] + ax[1][i] * v[1] + ax[2][i] * v[2]); }

  whenModelsReady(all = false) { return Promise.all([...this.scene.models.values()].filter(m => all || m.asset || m.madeKey).map(m => m.whenReady)); }

  bakeModel(entry) {
    const known = entry.asset && BAKED.get(entry.asset);
    if (known) {
      entry.field = known.field;
      this.gpu.device.queue.writeTexture({ texture: this.shared.atlas, origin: [0, 0, entry.slot * ATLAS_RES] }, known.half,
        { bytesPerRow: ATLAS_RES * 2, rowsPerImage: ATLAS_RES }, [ATLAS_RES, ATLAS_RES, ATLAS_RES]);
      entry.ready = true;
      entry.bakeMs = 0;
      return Promise.resolve(entry);
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./meshsdf.worker.js', import.meta.url));
      worker.onmessage = e => {
        worker.terminate();
        const f = e.data.field, half = new Uint16Array(f.length);
        entry.field = f;
        for (let i = 0; i < f.length; i++) half[i] = toHalf(f[i]);
        this.gpu.device.queue.writeTexture({ texture: this.shared.atlas, origin: [0, 0, entry.slot * ATLAS_RES] }, half,
          { bytesPerRow: ATLAS_RES * 2, rowsPerImage: ATLAS_RES }, [ATLAS_RES, ATLAS_RES, ATLAS_RES]);
        entry.ready = true;
        entry.bakeMs = e.data.ms;
        if (entry.asset) BAKED.set(entry.asset, { field: f, half });
        resolve(entry);
      };
      worker.onerror = err => { worker.terminate(); reject(new Error('Working out the model\'s shape failed: ' + err.message)); };
      worker.postMessage({ positions: entry.positions, prop: entry.prop, res: ATLAS_RES, pad: ATLAS_PAD });
    });
  }

  clearModels() {
    this.soft.clear();
    this.releaseSoft();
    this.clearImages();
    this.decalEdit = null;
    for (const id of this.scene.models.keys()) this.dropDisplaced('model:' + id);
    for (const id of this.scene.models.keys()) this.renderer.removeMesh('model:' + id);
    this.scene.models.clear();
    this.freeSlots = [...Array(ATLAS_SLOTS).keys()];
  }

  dropUnusedModels(keep = new Set()) {
    for (const [id, m] of this.scene.models) {
      if (keep.has(id) || this.scene.objects.some(o => o.model === id)) continue;
      this.scene.models.delete(id);
      this.dropDisplaced('model:' + id);
      this.renderer.removeMesh('model:' + id);
      this.freeSlots.push(m.slot);
    }
  }


  async addImage(blob, name, { id } = {}) {
    if (this.scene.images.size >= MAX_IMAGE_LAYERS) this.dropUnusedImages(this.imagesKeep ? this.imagesKeep() : new Set());
    if (this.scene.images.size >= MAX_IMAGE_LAYERS) throw new Error(`a scene holds ${MAX_IMAGE_LAYERS} pictures`);
    const size = await imageSize(blob);
    const imageId = id || `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dataUrl = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
    this.scene.images.set(imageId, { id: imageId, name: name || 'image', blob, dataUrl, width: size.width, height: size.height, layers: {} });
    return imageId;
  }
  imageAspect(id) { const m = this.scene.images.get(id); return m ? m.width / Math.max(m.height, 1) : 1; }
  layerOf(id, kind) {
    const m = this.scene.images.get(id);
    if (!m) return -1;
    const have = m.layers[kind];
    if (have !== undefined) return have;
    m.layers[kind] = -1;
    bitmapForCard(m.blob).then(b => { m.layers[kind] = this.renderer.uploadImage(b, kind); b.close(); this.emit('imageReady', m); })
      .catch(e => { console.error('Could not read the image', e); });
    return -1;
  }
  dropUnusedImages(keep = new Set()) {
    const used = new Set(keep);
    imagesOf(this.look.ground, used);
    for (const o of this.scene.objects) { imagesOf(o, used); for (const p of o.partLooks || []) imagesOf(p, used); }
    for (const e of this.scene.emitters) if (e.look && e.look.picture) used.add(e.look.picture);
    for (const [id, m] of this.scene.images) {
      if (used.has(id)) continue;
      for (const l of Object.values(m.layers)) if (l >= 0) this.renderer.freeImage(l);
      this.scene.images.delete(id);
    }
  }
  clearImages() {
    for (const m of this.scene.images.values()) for (const l of Object.values(m.layers)) if (l >= 0) this.renderer.freeImage(l);
    this.scene.images.clear();
  }

  surfaceAt(px, py) {
    const r = this.canvas.getBoundingClientRect();
    if (px < r.left || px > r.right || py < r.top || py > r.bottom) return null;
    const ray = this.camera.ray((px - r.left) / r.width, (py - r.top) / r.height);
    const hit = this.scene.pick(ray, { emitters: false });
    if (!hit) return { kind: 'sky' };
    if (hit.item) {
      const s = this.scene.surfaceHit(ray, hit.item);
      if (s) return { kind: 'object', item: hit.item, ...s };
    }
    if (length(hit.point) > this.renderer.frameData[126] * 0.98) return { kind: 'sky' };
    return { kind: 'ground', at: [hit.point[0], 0, hit.point[2]], dir: [0, 1, 0], part: -1 };
  }
  facingPoint(o) {
    const ray = this.camera.ray(0.5, 0.5);
    if (!o) { const t = ray.dir[1] < -1e-3 ? -ray.origin[1] / ray.dir[1] : 3; const p = add(ray.origin, scale(ray.dir, t)); return { at: [p[0], 0, p[2]], dir: [0, 1, 0] }; }
    const toward = normalize(sub(o.pos, ray.origin));
    return this.scene.surfaceHit({ origin: ray.origin, dir: toward }, o) || { at: [0, 0, 1], dir: [0, 0, 1] };
  }

  displacedMesh(meshName, unit, uvs, first = 0, count = -1) {
    const name = `${meshName}#d${first}`;
    if (!this.renderer.meshes.has(name)) this.renderer.addMesh(name, subdivide(unit, uvs, { first, count }), { stride: 11 });
    return name;
  }
  dropDisplaced(meshName) {
    for (const k of [...this.renderer.meshes.keys()]) if (k.startsWith(meshName + '#d')) this.renderer.removeMesh(k);
  }


  frame(now) {
    if (!this.ready) return;
    const realDt = this.lastNow ? clamp((now - this.lastNow) / 1000, 0, 0.1) : 1 / 60;
    this.lastNow = now;
    this.countFps(now);
    this.time += realDt;
    const S = this.settings;
    const running = this.playing || this.stepOnce;
    this.stepOnce = false;
    const frameDt = running ? S.speed / 60 : 0;
    if (running) { this.simTime += frameDt; this.simFrames++; }
    this.applyMotion(this.simTime);
    this.scene.tick(realDt);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(16, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(16, Math.round(this.canvas.clientHeight * dpr));
    this.renderer.resize(w, h);
    this.camera.update(w / h);
    const look = this.look;

    const wind = this.windAt(this.simTime);
    this.windNow = wind;
    this.giveOnEntry();
    this.scene.softWorld = this.soft;
    this.soft.gravity = S.gravity ?? 9.81;
    this.soft.sync(this.scene, running);
    const rigidSteps = Math.max(2, Math.ceil(S.speed * 2)), windNow = look.wind.on ? wind : null;
    if (running && this.soft.any) {
      this.physics.sync(this.scene);
      const n = this.soft.begin(this.scene, frameDt, rigidSteps, windNow, this.physics, { turbulence: look.wind.turbulence || 0, time: this.simTime });
      if (this.soft.awake.length) this.physics.step(this.scene, frameDt, n, windNow, h => this.soft.substep(h));
      else this.physics.step(this.scene, frameDt, rigidSteps, windNow);
      this.soft.end();
    } else if (running) this.physics.step(this.scene, frameDt, rigidSteps, windNow);
    this.prepareSoft();
    this.followObjects();
    if (this.flip) {
      if (running) this.flip.planEmission(this.scene.emitters.filter(e => this.isOn(e)), frameDt, S.flow);
      else this.flip.newCount = 0;
    }
    const fluidPlan = this.fluids.pack(S, this.scene.emitters);
    this.fluidPlan = fluidPlan;
    this.packEmitters();
    const d = this.gpu.device;
    this.forms.prepare(fluidPlan, this);
    d.queue.writeBuffer(this.shared.emitters, 0, this.emitterData);
    d.queue.writeBuffer(this.shared.fluids, 0, this.fluids.data);
    d.queue.writeBuffer(this.shared.objects, 0, this.packSolidObjects());

    const stir = this.takeStir(realDt);
    const nE = this.scene.emitters.length, nO = this.solidCount;
    const light = look.light;
    const windParams = look.wind.on ? { vel: wind, uptake: 1.2, turbulence: look.wind.turbulence, turbScale: 0.9, time: this.simTime, grip: 2.0 } : null;
    if (this.smoke && running) {
      this.smoke.iterations = (S.smokeSteps ?? 30) + ((S.smokeSteps ?? 30) % 2);
      this.smoke.writeParams({ dt: frameDt, detail: S.smokeDetail ?? 1, rise: S.rise, sink: S.smokeWeight ?? 0.3, swirl: S.swirl * 3, cooling: S.cooling ?? 0.5,
        fade: S.fade, absorb: S.smokeOpacity, emitterCount: nE, objectCount: nO,
        light: fromAngles(light.key.az, light.key.el),
        rim: light.rim.power > 0 ? fromAngles(light.rim.az, light.rim.el) : null, stir, wind: windParams });
    }
    const substeps = Math.max(2, Math.ceil(S.speed * 2));
    setGravity(S.gravity ?? 9.81);
    if (this.flip && running) {
      this.flip.iterations = S.liquidSteps ?? 40;
      this.flip.writeParams({ dt: frameDt / substeps, frameDt, gravity: S.gravity ?? 9.81, splash: S.splash, drift: 0.08,
        objectCount: nO, emitterCount: nE, stir, wind: windParams });
    }

    const enc = d.createCommandEncoder();
    const cp = enc.beginComputePass(this.querySet ? { timestampWrites: { querySet: this.querySet,
      beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    if (this.smoke && running) this.smoke.step(cp);
    if (this.flip && running) this.flip.step(cp, substeps);
    const smooth = this.flip && S.look === 'smooth' && this.flip.live > 0 && this.display.liquid;
    if (this.flip && fluidPlan.waterOwn) this.flip.buildWho(cp);
    if (smooth) this.flip.buildField(cp);
    this.forms.runBlocks(cp, fluidPlan, this);
    const lights = this.lightsForFrame();
    if (this.smoke && this.display.smoke && lights.length) this.smoke.lightLocal(cp, lights.map(l => l.pos));
    cp.end();
    if (this.flip && running) this.flip.endFrame(enc);

    const meshes = this.packDraws();
    const post = effectivePost(look.post);
    this.renderer.post = postIsNone(post) ? null : post;
    const media = effectiveMedia(look.media);
    this.renderer.media = mediaIsNone(media) ? null : media;
    const G = look.ground;
    const world = JSON.stringify([look.light, look.background, G.color, lights.map(l => [l.pos, l.col])]);
    this.envAge = (this.envAge || 0) + 1;
    if (world !== this.envWorld || (look.background.preset === 'sky' && this.envAge > 15)) { this.envWorld = world; this.envAge = 0; this.renderer.envDirty = true; }
    const drawWater = this.flip && this.flip.live > 0 && this.display.liquid;
    const lookCode = !drawWater ? 0 : S.look === 'dots' ? 1 : S.look === 'smooth' ? 3 : 2;
    const radius = this.flip ? (lookCode === 1 ? this.flip.cell * 0.32 : lookCode === 3 ? this.flip.cell * 0.7 : this.flip.cell * 0.5) : 0;
    this.renderer.packFrame({
      camera: this.camera, look, time: this.time, wind, smokeLook: fluidPlan.smokeLook, waterOwn: fluidPlan.waterOwn,
      smoke: this.display.smoke ? this.smoke : null, smokeAbsorb: S.smokeOpacity,
      liquidView: { look: lookCode, radius, clarity: S.clarity, color: hexToRgb(S.liquidColor),
        min: this.flip ? this.flip.min : [0, 0, 0], max: this.flip ? this.flip.max : [0, 0, 0], cell: this.flip ? this.flip.cell : 1,
        fine: smooth ? this.flip.field.fine : 0, soften: FIELD.soften,
        fieldMin: smooth ? this.flip.field.corner : null, fieldSize: smooth ? this.flip.field.dims.map(v => v * this.flip.field.fine) : null,
        foam: S.foam ?? 1, caustics: S.caustics ?? 1,
        causticOf: smooth && this.flip.waterExtent() ? { extent: this.flip.waterExtent(), top: (this.flip.levelTop || 0) + 0.05 } : null },
      box: this.flip && this.display.box && !this.clean ? { min: this.flip.min, max: this.flip.max } : null,
      shadowReach: Math.max(7, Math.hypot(this.region.size[0], this.region.size[2]) * 0.6),
      shadowCenter: [this.region.center[0], 1, this.region.center[1]],
      lights, glass: this.glassDraws.length > 0, snap: media && media.snap > 0 && media.res > 0 ? media.res : 0,
    });
    const pics = this.picJobs && this.picJobs.length ? this.picJobs.slice(0, 3) : null;
    this.renderer.render(enc, {
      keepScene: !!pics, keepLight: !!pics && pics.some(j => j.post && !postIsNone(j.post) && wantsBloom(j.post)),
      drawData: this.drawData, meshes, objectCount: this.shadowCount, picked: this.clean ? [] : this.pickedDraws,
      glass: this.glassDraws, matData: this.matData, decalData: this.decalData, decals: this.decalCount, groundTex: this.groundTex,
      particles: this.flip && this.display.liquid ? { pos: this.flip.buf.pos, col: this.flip.buf.col, count: this.flip.live, look: this.flip.lookView, foam: this.flip.foamView,
        field: smooth ? this.flip.field.view : null, who: this.flip.buf.who } : null,
      smoke: this.smoke, look: lookCode, timestamps: this.querySet, fluidData: this.fluids.data,
      blocks: this.forms.blocksToDraw(fluidPlan), cellsPass: this.forms.cellsPassFor(fluidPlan, this),
    });

    let copied = false;
    if (this.querySet) {
      enc.resolveQuerySet(this.querySet, 0, 4, this.qResolve, 0);
      if (!this.qBusy) { enc.copyBufferToBuffer(this.qResolve, 0, this.qRead, 0, 32); copied = true; }
    }
    const probe = this.probe && !this.probeBusy ? this.encodeProbe(enc) : null;
    d.queue.submit([enc.finish()]);
    if (this.picJobs && this.picJobs.length) this.runPictures();
    this.drawOverlay();
    if (copied) this.readTimes();
    if (probe) this.readProbe(probe);
    if (this.flip) {
      const pr = this.flip.readWater();
      const run = this.fluidRun;
      if (pr) pr.then(w => { if (w && run === this.fluidRun) this.physics.setWater(w); });
    } else this.physics.setWater(null);
  }

  windAt(t) {
    const W = this.look.wind;
    if (!W.on || W.speed <= 0) return [0, 0, 0];
    const g = W.gusts;
    const swell = 1 + g * (0.55 * Math.sin(t * 0.9) + 0.35 * Math.sin(t * 2.3 + 1.7) + 0.2 * Math.sin(t * 5.1 + 0.4));
    const turn = g * 14 * (Math.sin(t * 0.6 + 2.1) + 0.5 * Math.sin(t * 1.7));
    const dir = fromAngles(W.dir + turn, 0);
    return scale([dir[0], 0, dir[2]], W.speed * Math.max(swell, 0));
  }

  sampleScreen(rects) { return new Promise(resolve => { this.probe = { rects, resolve }; }); }

  filterPictures(jobs, w, h) {
    if (this.picAsk) this.picAsk.resolve(this.picAsk.out);
    return new Promise(resolve => {
      this.picAsk = { resolve, out: jobs.map(() => null), w, h, waits: [] };
      this.picJobs = jobs.map((j, i) => ({ ...j, i, ask: this.picAsk }));
    });
  }
  runPictures() {
    const batch = this.picJobs.splice(0, 3), A = batch[0].ask;
    const made = this.renderer.filterPictures(batch.map(j => ({ post: postIsNone(j.post) ? null : j.post, media: mediaIsNone(j.media) ? null : j.media })), A.w, A.h);
    batch.forEach((j, k) => { const p = made[k]; A.waits.push(p ? p.then(img => { A.out[j.i] = img; }, () => {}) : Promise.resolve()); });
    if (A.waits.length === A.out.length) Promise.all(A.waits).then(() => { if (this.picAsk === A) this.picAsk = null; A.resolve(A.out); });
  }

  encodeProbe(enc) {
    const tex = this.renderer.screenTexture, d = this.gpu.device;
    if (!tex) return null;
    const k = this.renderer.width / Math.max(this.canvas.clientWidth, 1);
    const rows = [];
    let size = 0;
    for (const [ri, r] of this.probe.rects.entries()) {
      const x0 = Math.max(0, Math.round(r.x * k)), x1 = Math.min(tex.width, Math.round((r.x + r.w) * k));
      if (x1 - x0 < 8 || tex.width < 64) continue;
      const w = Math.max(64, Math.min(1024, Math.floor((x1 - x0) / 64) * 64));
      const x = Math.max(0, Math.min(tex.width - w, x0 + Math.floor((x1 - x0 - w) / 2)));
      for (let i = 0; i < 10; i++) {
        const y = Math.round((r.y + 4 + (r.h - 8) * (i + 0.5) / 10) * k);
        if (y < 0 || y >= tex.height) continue;
        rows.push({ ri, x, y, w, offset: size });
        size += w * 4;
      }
    }
    if (!rows.length) { const p = this.probe; this.probe = null; p.resolve(p.rects.map(() => [])); return null; }
    const buf = d.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    for (const r of rows) enc.copyTextureToBuffer({ texture: tex, origin: [r.x, r.y] }, { buffer: buf, offset: r.offset, bytesPerRow: r.w * 4 }, [r.w, 1]);
    const p = this.probe;
    this.probe = null;
    this.probeBusy = true;
    return { buf, rows, n: p.rects.length, resolve: p.resolve, bgra: this.gpu.format.startsWith('bgra') };
  }

  readProbe(pr) {
    pr.buf.mapAsync(GPUMapMode.READ).then(() => {
      const px = new Uint8Array(pr.buf.getMappedRange());
      const out = Array.from({ length: pr.n }, () => []);
      for (const r of pr.rows) {
        for (let i = 0; i < r.w; i += 2) {
          const o = r.offset + i * 4;
          const a = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
          out[r.ri].push(pr.bgra ? [b, g, a] : [a, g, b]);
        }
      }
      pr.buf.unmap(); pr.buf.destroy();
      this.probeBusy = false;
      pr.resolve(out);
    }).catch(() => { this.probeBusy = false; pr.resolve(Array.from({ length: pr.n }, () => [])); });
  }

  readTimes() {
    this.qBusy = true;
    this.qRead.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigInt64Array(this.qRead.getMappedRange());
      const sim = Number(t[1] - t[0]) / 1e6, draw = Number(t[3] - t[2]) / 1e6;
      this.qRead.unmap();
      this.qBusy = false;
      if (sim >= 0 && sim < 1000 && draw >= 0 && draw < 1000) {
        const k = this.stats.simMs ? 0.9 : 0;
        this.stats.simMs = this.stats.simMs * k + sim * (1 - k);
        this.stats.drawMs = this.stats.drawMs * k + draw * (1 - k);
      }
    }).catch(() => { this.qBusy = false; });
  }

  countFps(now) {
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    this.stats.frames++;
    if (!this.fpsStart) this.fpsStart = now;
    if (now - this.fpsStart >= 1000) {
      this.stats.fps = this.fpsFrames * 1000 / (now - this.fpsStart);
      this.fpsFrames = 0;
      this.fpsStart = now;
    }
  }

  packEmitters() {
    const out = this.emitterData.fill(0), S = this.settings;
    this.scene.emitters.forEach((e, i) => {
      const vel = scale(normalize(e.dir), e.speed);
      const kind = !this.isOn(e) ? 0 : e.sink ? (e.type === 'smoke' ? 3 : 4) : e.type === 'smoke' ? 1 : 2;
      if (e.sink) {
        out.set([...e.pos, e.radius, 0, 0, 0, SINK_RATE[e.type] * e.rate, 0, 0, 0, 0, kind, 0, 0, 0], i * 16);
        return;
      }
      const c = lightOf(e.color);
      if (e.type === 'smoke') {
        const shadow = e.look && e.look.shadow !== undefined ? Math.max(e.look.shadow, 0.02) : 1;
        out.set([...e.pos, e.radius, ...c, 7 * e.rate * S.smokeAmount * thicknessOf(e, S) * shadow, ...vel, 4 * (e.heat ?? 1), kind, 0, 0, e.row || 0], i * 16);
      } else {
        out.set([...e.pos, e.radius, ...c, 0, ...vel, 0, kind, e.newFirst || 0, e.newCount || 0, e.row || 0], i * 16);
      }
    });
  }

  packSolidObjects() {
    const out = this.objectData.fill(0), S = this.scene;
    let n = 0;
    this.solidIds = [];
    const kits = new Set(S.emitters.filter(e => e.attach).map(e => e.attach.to));
    for (const o of S.objects) {
      if (o.model && !(S.models.get(o.model) || {}).ready) continue;
      if (!blocksFluid(o)) continue;
      const sb = softOn(o) ? this.soft.bodies.get(o.id) : null;
      if (softOn(o)) {
        if (sb && sb.fieldNow) { packObject(out, n, sb.fieldNow.record, 0, sb.fieldNow.models); out[n * OBJ_FLOATS + 31] = -1; n++; this.solidIds.push(o.id); }
        continue;
      }
      packObject(out, n++, o, kits.has(o.id) || (ASSET_BY_ID[o.asset] || {}).porous ? 1 : 0, S.models);
      this.solidIds.push(o.id);
    }
    this.solidCount = n;
    return out;
  }

  lightsForFrame() {
    return this.scene.lights.filter(l => l.on !== false && l.power > 0).map(l => {
      const [right, dir, up] = lightAxes(l);
      const half = clamp(l.angle ?? 40, 2, 170) / 2 * Math.PI / 180;
      const cosOuter = Math.cos(half);
      return { type: l.type, pos: [...l.pos], dir, right, up,
        halfW: l.type === 'area' ? l.radius : Math.max(l.radius, 0.01), halfH: l.type === 'area' ? l.radius * (l.aspect ?? 0.6) : l.radius,
        col: lightOf(l.color).map(c => c * l.power), cosOuter,
        cosInner: Math.max(Math.cos(half * (1 - clamp(l.soft ?? 0.3, 0, 0.98))), cosOuter + 1e-4),
        shadows: l.shadows !== false, blur: clamp(1 + l.radius * 12, 1, 8) };
    });
  }

  partScale(e) {
    const S = this.scene, o = e.attach && S.objects.find(x => x.id === e.attach.to), a = o && ASSET_BY_ID[o.asset];
    if (!a) return 1;
    const m = o.model ? S.models.get(o.model) : null, base = m ? m.fileHalf : a.size;
    if (!base) return 1;
    return Math.min(1, (o.size[0] / base[0] + o.size[1] / base[1] + o.size[2] / base[2]) / 3);
  }

  packDraws() {
    const out = this.drawData, mats = this.matData, meshes = [], S = this.scene;
    let i = 0;
    this.pickedDraws = [];
    this.glassDraws = [];
    this.decalCount = 0;
    const lineOf = new Map();
    const outlineNumber = it => { if (!lineOf.has(it)) lineOf.set(it, lineOf.size + 1); return lineOf.get(it); };
    const lineFor = it => (S.isPicked(it) ? outlineNumber(it) : 0);
    const layer = (id, kind) => this.layerOf(id, kind);
    const looks = [];
    for (const o of S.objects) {
      if (o.hidden) continue;
      const m = o.model ? S.models.get(o.model) : null;
      const sb = softOn(o) ? this.soft.bodies.get(o.id) : null;
      if (sb) {
        const parts = sb.drawn.parts;
        if (parts && o.partLooks) parts.forEach((p, k) => looks.push({ o, look: o.partLooks[k] || o, first: p.first, count: p.count, m, part: k, sb }));
        else looks.push({ o, look: o, first: 0, count: -1, m, part: -1, sb });
        continue;
      }
      if (m && m.parts && o.partLooks) m.parts.forEach((p, k) => looks.push({ o, look: o.partLooks[k] || o, first: p.first, count: p.count, m, part: k }));
      else looks.push({ o, look: o, first: 0, count: -1, m, part: -1 });
    }
    const casts = l => !l.o.noShadow && !isGlassLook(l.look), ordered = [...looks.filter(casts), ...looks.filter(l => !casts(l))];
    this.shadowCount = Math.min(looks.filter(casts).length, MAX_DRAW);
    for (const l of ordered) {
      if (i >= MAX_DRAW - S.emitters.length - S.lights.length) break;
      const { o, look, m } = l;
      const H = this.dropHover;
      const chosen = H ? H.item === o && (H.part < 0 || H.part === l.part) : S.isPicked(o) && ((o.partPick ?? -1) < 0 || !o.partLooks || o.partPick === l.part);
      if (chosen) this.pickedDraws.push(i);
      const glass = isGlassLook(look);
      if (glass) this.glassDraws.push(i);
      packObject(out, i, l.sb ? { ...l.sb.drawRecord, shape: o.shape, model: o.model, vel: o.vel, spin: [0, 0, 0] } : o, S.isPicked(o) ? 1 : 0, S.models, look);
      this.decalCount += packLook(mats, i, look, { layer, half: o.size, outline: chosen ? outlineNumber(o) : 0, decalData: this.decalData, decalAt: this.decalCount });
      const base = m ? 'model:' + o.model : (o.shape === 'wall' || o.shape === 'slab' || o.shape === 'plane' ? 'box' : o.shape);
      const pics = lookNeedsTex(look);
      const dr = { mesh: base, first: l.first, count: l.count, kind: 0 };
      if (l.sb) {
        dr.mesh = 'soft:' + o.id;
        if (pics) dr.kind = 4;
        if (glass) { dr.glassKind = 0; if (!(look.decals && look.decals.length)) dr.skip = true; else dr.kind = 4; }
        meshes.push(dr);
        i++;
        continue;
      }
      if (pics) {
        dr.kind = m && m.uvs && texValue(look, 'map') === 'uv' ? 2 : 1;
        if (hasMap(look, 'disp') && !glass) {
          dr.mesh = this.displacedMesh(base, S.meshOf(o), m ? m.uvs : null, l.first, l.count);
          dr.kind = 3; dr.first = 0; dr.count = -1;
        }
      }
      if (glass) {
        dr.glassKind = !anyMap(look) ? 0 : m && m.uvs && texValue(look, 'map') === 'uv' ? 2 : 1;
        if (!(look.decals && look.decals.length)) dr.skip = true; else dr.kind = 1;
      }
      meshes.push(dr);
      i++;
    }
    const G = this.look.ground;
    this.groundTex = lookNeedsTex(G) || !!G.pbr;
    if (this.groundTex) this.decalCount += packLook(mats, MAX_DRAW, G, { layer, half: null, decalData: this.decalData, decalAt: this.decalCount, groundLook: FINISHES[G.finish] || FINISHES.matte });
    const marker = (name, picked, it) => { mats.fill(0, i * MAT_FLOATS, (i + 1) * MAT_FLOATS); mats[i * MAT_FLOATS + 11] = lineFor(it); meshes.push({ mesh: name, first: 0, count: -1, kind: 0 }); };
    if (this.markerStyle === 'ball' && !this.clean) for (const e of S.emitters) {
      const onKit = this.kitOf(e);
      if (e.hidden || (onKit && onKit.hidden) || !kindShown(this, e)) continue;
      const r = Math.max(e.radius * this.markerSize.k, this.markerSize.min) * this.partScale(e);
      if (S.isPicked(e)) this.pickedDraws.push(i);
      const flag = S.isPicked(e) ? 3 : 2;
      const col = e.sink ? (this.isOn(e) ? [0.12, 0.13, 0.15] : [0.5, 0.52, 0.55]) : !this.isOn(e) ? e.color.map(c => c * 0.3) : e.color;
      marker('ball', S.isPicked(e), e);
      packObject(out, i++, { pos: e.pos, shape: 'ball', size: [r, r, r], rot: [0, 0, 0], vel: [0, 0, 0], color: col }, flag, S.models);
    }
    for (const l of S.lights) {
      if (l.show === false || i >= MAX_DRAW || this.clean) continue;
      const c = lightOf(l.color), top = Math.max(...c, 1e-3);
      const col = c.map(v => v / top * (l.on === false ? 0.08 : 1));
      const point = l.type === 'point', chosen = S.isPicked(l) ? 1 : 0;
      const r = Math.max(l.radius, 0.025);
      if (chosen) this.pickedDraws.push(i);
      const shape = l.type === 'area' ? 'box' : point ? 'ball' : 'column';
      const size = l.type === 'area' ? [l.radius, 0.008, l.radius * (l.aspect ?? 0.6)] : point ? [r, r, r] : [r, r * 1.3, r];
      marker(shape, S.isPicked(l), l);
      packObject(out, i++, { pos: l.pos, shape, size, rot: point ? [0, 0, 0] : eulerOf(lightAxes(l)), vel: [0, 0, 0], color: col },
        (point ? 6 : 4) + chosen, S.models);
    }
    return meshes;
  }


  prepareSoft() {
    const R = this.renderer;
    for (const b of this.softGone()) {
      R.removeMesh('soft:' + b.o.id);
      if (b.fieldSlot !== undefined && !this.soft.bodies.has(b.o.id)) { this.freeSlots.push(b.fieldSlot); b.fieldSlot = undefined; }
    }
    const fluidsHere = this.scene.emitters.length > 0 || (this.flip && this.flip.live > 0) || (this.smoke && this.scene.emitters.some(e => e.type === 'smoke'));
    for (const b of this.soft.bodies.values()) {
      if (b.failed) continue;
      const name = 'soft:' + b.o.id;
      if (!R.meshes.has(name) || b.meshFor !== b) {
        const D = b.drawn, rest = new Float32Array(D.corners * 8);
        for (let c = 0; c < D.corners; c++) {
          rest.set([D.lp[c * 3], D.lp[c * 3 + 1], D.lp[c * 3 + 2], D.ln[c * 3], D.ln[c * 3 + 1], D.ln[c * 3 + 2], D.uv ? D.uv[c * 2] : 0, D.uv ? D.uv[c * 2 + 1] : 0], c * 8);
        }
        R.addSoftMesh(name, D.corners, rest);
        b.meshFor = b;
        b.drawDirty = true;
      }
      if (b.drawDirty) { b.updateDraw(); R.writeSoftMesh(name, b.drawData); }
      const o = b.o;
      if (!blocksFluid(o) || !fluidsHere) { b.fieldNow = null; continue; }
      if (b.fieldNow && b.asleep && b.fieldAt === b.drawStamp) continue;
      if (b.fieldSlot === undefined) {
        if (!this.freeSlots.length) { if (!b.saidFull) { b.saidFull = true; this.emit('notice', `${o.name} is soft, but a scene's ${ATLAS_SLOTS} places for shapes are all in use, so the fluids pass through it.`); } continue; }
        b.fieldSlot = this.freeSlots.shift();
      }
      const cell = Math.max(this.flip ? this.flip.cell : 0.06, this.smoke ? this.smoke.cell || 0 : 0);
      const thick = Math.max(b.P.thick, cell * 0.75);
      const still = b.fieldNow && b.fieldMadeIn === b.fieldSlot && b.fieldThick === thick ? this.softField.still(b, cell * 0.1) : null;
      if (still) { b.fieldNow.record.vel = still; continue; }
      const F = this.softField.build(b, thick);
      b.fieldMadeIn = b.fieldSlot; b.fieldThick = thick;
      this.gpu.device.queue.writeTexture({ texture: this.shared.atlas, origin: [0, 0, b.fieldSlot * ATLAS_RES] }, this.softField.half, { bytesPerRow: ATLAS_RES * 2, rowsPerImage: ATLAS_RES }, [ATLAS_RES, ATLAS_RES, ATLAS_RES]);
      const entry = { slot: b.fieldSlot, prop: F.prop };
      b.fieldNow = { record: { pos: F.pos, size: F.size, rot: [0, 0, 0], shape: 'model', model: 'x', vel: F.vel, spin: F.spin, color: o.color }, models: { get: () => entry } };
      b.fieldAt = b.drawStamp;
    }
  }

  softGone() {
    const seen = this.softSeen || (this.softSeen = new Map()), out = [];
    for (const [id, b] of seen) if (this.soft.bodies.get(id) !== b) { out.push(b); seen.delete(id); }
    for (const [id, b] of this.soft.bodies) if (!seen.has(id)) seen.set(id, b);
    return out;
  }

  releaseSoft() {
    if (!this.renderer) return;
    for (const b of (this.softSeen || new Map()).values()) { this.renderer.removeMesh('soft:' + b.o.id); b.fieldSlot = undefined; }
    this.softSeen = new Map();
  }


  view(name) {
    const c = this.camera;
    const presets = { perspective: [0.7, 0.32], front: [0, 0.05], side: [Math.PI / 2, 0.05], back: [Math.PI, 0.05], top: [0.0001, 1.45] };
    const p = presets[name];
    if (!p) return;
    c.yaw = p[0]; c.pitch = p[1];
  }

  frameSelected() {
    const it = this.scene.selected;
    if (!it) { const R = this.region; this.camera.target = [R.center[0], Math.min(1, R.size[1] / 3), R.center[1]]; this.camera.distance = Math.max(...R.size) * 1.9; return; }
    if (it.kind === 'mark') {
      const t = it.target != null ? this.scene.items.find(i => i.id === it.target) : null;
      const p = t ? t.pos : it.pos;
      if (p) { this.camera.target = [...p]; this.camera.distance = clamp(it.size && it.size.length ? Math.hypot(...it.size) * 4 : 3, 2, 40); }
      return;
    }
    const r = it.kind === 'emitter' ? it.radius * 3 : it.kind === 'light' ? Math.max(it.radius * 4, 0.6) : Math.hypot(...it.size);
    this.camera.target = [...it.pos];
    this.camera.distance = clamp(r * 4, 2, 40);
  }


  attachInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => this.onDown(e));
    c.addEventListener('pointermove', e => this.onMove(e));
    c.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointercancel', e => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.mouseIn = false; if (!this.drag) this.gizmo.hover = null; });
    c.addEventListener('wheel', e => { e.preventDefault(); this.camera.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }

  mouse(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, px: e.clientX, py: e.clientY,
      cx: e.clientX - r.left, cy: e.clientY - r.top, w: r.width, h: r.height };
  }

  setTool(t) {
    if (this.drag && this.drag.mode === 'gizmo') this.cancelDrag();
    this.tool = t;
    if (HANDLE_TOOLS.has(t)) this.gizmo.mode = t;
    this.gizmo.hover = null;
  }

  setAxes(space) { this.gizmo.space = space; }

  gizmoTarget() {
    const it = this.scene.selected;
    if (!this.overlay || !it || this.placing || !HANDLE_TOOLS.has(this.tool) || this.decalEdit) return null;
    const movers = this.movers();
    if (movers.length > 1) return this.groupFor(movers);
    if (it.kind === 'mark') {
      if (!it.pos || it.target != null || MARK_TYPES[it.type].screen) return null;
      if (this.tool !== 'move' && !it.rot) return null;
    }
    const kit = this.kitOf(it);
    return kit && ASSET_BY_ID[kit.asset] && ASSET_BY_ID[kit.asset].sources ? kit : it;
  }

  drawOverlay() {
    const cv = this.overlay;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1, W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.clean) {
      if (this.display.marks) drawMarks(ctx, this, W, H, this.markHits); else this.markHits.clear();
      this.markerRows = [];
      this.pinRows = [];
      return;
    }
    const dr = this.drag && this.drag.mode === 'box' ? this.drag : null;
    if (this.previewRegion) drawBox(ctx, this.previewRegion, this.camera, W, H, { handles: false });
    else if (this.boxHandles) drawBox(ctx, this.region, this.camera, W, H,
      { hot: dr ? dr.h : this.boxHover, readout: dr && dr.readout, mouse: this.mouseAt });
    for (const it of this.selectedItems()) {
      const parts = it.kind === 'emitter' ? [it] : it.kind === 'object' ? this.scene.emitters.filter(e => e.attach && e.attach.to === it.id) : [];
      for (const e of parts) if (kindShown(this, e)) drawReach(ctx, e, this.camera, W, H);
    }
    if (this.dropPreview) drawLanding(ctx, this.camera, this.dropPreview.at || this.dropPreview.p, W, H);
    if (this.display.marks) drawMarks(ctx, this, W, H, this.markHits);
    else this.markHits.clear();
    this.markerRows = this.markerStyle === 'badge' ? drawMarkers(ctx, this, W, H) : [];
    this.pinRows = this.pinStyle === 'pushpin' ? drawPins(ctx, this, W, H) : [];
    const it = this.gizmoTarget();
    if (it) this.gizmo.draw(ctx, it, this.camera, W, H, this.mouseAt);
    this.drawDecalHandles(ctx, W, H);
  }

  decalScreen(W, H) {
    const E = this.decalEdit;
    if (!E) return null;
    const o = E.owner, p = decalPlace(E.decal, o ? o.size : null);
    const ax = o ? eulerAxes(o.rot) : null;
    const world = v => (o ? add(o.pos, add(add(scale(ax[0], v[0]), scale(ax[1], v[1])), scale(ax[2], v[2]))) : v);
    const at = (a, b) => project(this.camera, world([0, 1, 2].map(k => p.c[k] + p.u[k] * a * p.w / 2 + p.v[k] * b * p.h / 2 + p.n[k] * 0.002)), W, H);
    const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    if (corners.some(c => c[2] <= 0)) return null;
    return { corners, middle: at(0, 0), knob: at(0, 1.35), top: at(0, 1) };
  }
  drawDecalHandles(ctx, W, H) {
    const s = this.decalScreen(W, H);
    if (!s) return;
    ctx.lineWidth = 1.5;
    for (const [width, color, dash] of [[3, 'rgba(0, 0, 0, 0.45)', []], [1.5, '#ffd140', [5, 4]]]) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.setLineDash(dash);
      ctx.beginPath();
      s.corners.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
      ctx.closePath();
      ctx.moveTo(s.top[0], s.top[1]); ctx.lineTo(s.knob[0], s.knob[1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd140'; ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'; ctx.lineWidth = 1;
    for (const c of s.corners) { ctx.beginPath(); ctx.rect(c[0] - 4, c[1] - 4, 8, 8); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(s.knob[0], s.knob[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  decalHit(mx, my, W, H) {
    const s = this.decalScreen(W, H);
    if (!s) return null;
    const near = (p, r) => Math.hypot(p[0] - mx, p[1] - my) <= r;
    if (near(s.knob, 10)) return 'turn';
    if (s.corners.some(c => near(c, 10))) return 'size';
    let inside = true, sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = s.corners[i], b = s.corners[(i + 1) % 4], k = Math.sign((b[0] - a[0]) * (my - a[1]) - (b[1] - a[1]) * (mx - a[0]));
      if (k && sign && k !== sign) inside = false;
      if (k) sign = k;
    }
    return inside ? 'move' : null;
  }

  cancelDrag() {
    const dr = this.drag;
    if (dr && dr.mode === 'box') {
      this.drag = null;
      if (dr.moved) { this.setSimulation({ region: dr.R0, keep: true }); this.emit('region'); }
      return true;
    }
    if (!dr || dr.mode !== 'gizmo') return false;
    if (dr.item.kind === 'group') {
      this.gizmo.end();
      for (const s of dr.starts) {
        const m = s.m;
        m.pos = [...s.pos];
        if (s.rot) m.rot = [...s.rot];
        if (s.size) m.size = [...s.size];
        if (s.dir) m.dir = [...s.dir];
        if (s.radius !== undefined) m.radius = s.radius;
        this.letGo(m);
      }
      this.drag = null;
      this.group = null;
      this.emit('moving', dr.item);
      return true;
    }
    const g = this.gizmo.end(), it = dr.item;
    it.pos = [...g.pos0];
    if (g.rot0) it.rot = [...g.rot0];
    if (g.size0) it.size = [...g.size0];
    if (g.dir0) it.dir = [...g.dir0];
    if (g.radius0 !== undefined) it.radius = g.radius0;
    this.letGo(it);
    this.drag = null;
    this.emit('moving', it);
    return true;
  }

  letGo(it) {
    if (it.kind === 'object') { it.held = false; it.vel = [0, 0, 0]; it.last = [...it.pos]; }
  }

  onDown(e) {
    this.emit('activate');
    try { this.canvas.setPointerCapture(e.pointerId); } catch {   }
    const m = this.mouse(e);
    this.mouseAt = [m.cx, m.cy];
    this.mouseIn = true;
    const right = this.config.rightDrag || 'stir';
    if (e.button === 1 || (e.button === 2 && right === 'pan')) { e.preventDefault(); this.drag = { mode: 'pan', last: m, start: m, button: e.button }; return; }
    if (this.clean) { if (e.button === 0) this.drag = { mode: 'orbit', last: m }; return; }
    if (e.button === 2 || (e.button === 0 && this.tool === 'stir')) { this.drag = { mode: 'stir', last: m }; return; }
    if (this.decalEdit && e.button === 0) {
      const h = this.decalHit(m.cx, m.cy, m.w, m.h);
      if (h) {
        const s = this.decalScreen(m.w, m.h), D = this.decalEdit.decal;
        this.drag = { mode: 'decal', how: h, last: m, moved: false, c: s.middle, d0: Math.hypot(m.cx - s.middle[0], m.cy - s.middle[1]), a0: Math.atan2(m.cy - s.middle[1], m.cx - s.middle[0]), w0: D.w, h0: D.h, rot0: D.rot || 0 };
        return;
      }
    }
    if (this.pinTool && e.button === 0 && !e.shiftKey) {
      const ph = pinAtScreen(this, m.cx, m.cy), po = ph && this.scene.objects.find(o => o.id === ph.id);
      if (po) { removePin(po, ph.k); this.pinHot = null; this.emit('commit'); this.emit('change'); this.drag = null; return; }
      const ray = this.camera.ray(m.x, m.y), hit = this.scene.pick(ray, { emitters: false }), b = hit && hit.item && softOn(hit.item) ? this.soft.bodies.get(hit.item.id) : null;
      const h = b ? b.rayHit(ray.origin, ray.dir) : null;
      if (h) { this.select(hit.item); this.togglePinAt(hit.item, b, h.local); this.emit('commit'); this.drag = null; return; }
    }
    const tgt = this.gizmoTarget();
    if (tgt && e.button === 0) {
      const h = this.gizmo.hit(tgt, this.camera, m.w, m.h, m.cx, m.cy);
      if (h && this.gizmo.begin(tgt, h, this.camera, m.w, m.h, m.cx, m.cy)) {
        if (tgt.kind === 'object') tgt.held = true;
        this.drag = { mode: 'gizmo', item: tgt, last: m, moved: false };
        if (tgt.kind === 'group') {
          Object.assign(this.drag, { c0: [...tgt.pos], starts: this.startsOf(tgt.members) });
          for (const o of tgt.members) if (o.kind === 'object') o.held = true;
        }
        return;
      }
    }
    if (this.boxHandles && e.button === 0 && !this.placing) {
      const h = hitBoxHandle(this.region, this.camera, m.w, m.h, m.cx, m.cy);
      const b = h && beginBoxDrag(this.region, h, this.camera, m.w, m.h, m.cx, m.cy);
      if (b) { this.drag = { mode: 'box', ...b, last: m, moved: false }; return; }
    }
    if (this.placing) {
      const f = this.placing;
      this.placing = null;
      this.placeWith(f, m.x, m.y);
      this.drag = null;
      return;
    }
    const ray = this.camera.ray(m.x, m.y);
    const hit = this.scene.pick(ray);
    const mk = this.display.marks && e.button === 0 ? pickMark(this, this.markHits, m.cx, m.cy) : null;
    if (mk) {
      const it = mk.mark;
      if (e.shiftKey) { this.togglePick(it); this.drag = null; return; }
      this.select(it);
      if (MARK_TYPES[it.type].screen) this.drag = { mode: 'mark-screen', item: it, x0: it.x, y0: it.y, m0: m, last: m, moved: false };
      else if (it.type === 'label' && mk.part === 'text') this.drag = { mode: 'mark-text', item: it, dx0: it.dx, dy0: it.dy, m0: m, last: m, moved: false };
      else if (it.pos && it.target == null) {
        const y = it.pos[1], t = Math.abs(ray.dir[1]) > 1e-4 ? (y - ray.origin[1]) / ray.dir[1] : -1;
        const p = t > 0 ? add(ray.origin, scale(ray.dir, t)) : it.pos;
        this.drag = { mode: 'move', item: it, grabY: y, offset: sub(it.pos, p), last: m, moved: false, group: [it], starts: this.startsOf([it]) };
      } else this.drag = { mode: 'orbit', last: m };
      return;
    }
    if (hit && hit.item && !e.shiftKey && softOn(hit.item) && this.soft.bodies.get(hit.item.id)) {
      const b = this.soft.bodies.get(hit.item.id);
      if (this.pinTool) {
        const h = b.rayHit(ray.origin, ray.dir);
        if (h) { this.select(hit.item); this.togglePinAt(hit.item, b, h.local); this.emit('commit'); }
        this.drag = null;
        return;
      }
      if (this.playing) {
        if (this.scene.selected !== hit.item || this.movers().length > 1) this.select(hit.item);
        this.drag = { mode: 'softgrab', item: hit.item, grab: this.soft.grab(b, hit.point), depth: hit.t, last: m, moved: false };
        return;
      }
    }
    if (hit && hit.item) {
      const item = this.kitOf(hit.item) || hit.item;
      const movers = this.movers(), inGroup = movers.length > 1 && movers.includes(item);
      const wasAlone = this.scene.selected === item && movers.length <= 1;
      let pending = null, group = [item];
      if (e.shiftKey) { pending = 'toggle'; if (movers.includes(item)) group = movers; }
      else if (inGroup) { pending = 'alone'; group = movers; }
      else this.select(item);
      for (const o of group) if (o.kind === 'object') o.held = true;
      this.drag = { mode: e.shiftKey ? 'lift' : 'move', item, grabY: hit.point[1], wasAlone,
        offset: sub(item.pos, hit.point), last: m, moved: false, pending, group, starts: this.startsOf(group) };
    } else {
      this.select(null);
      this.drag = { mode: 'orbit', last: m };
    }
  }

  onMove(e) {
    const m = this.mouse(e);
    this.mouseAt = [m.cx, m.cy];
    this.mouseIn = true;
    if (!this.drag) {
      const tgt = this.gizmoTarget();
      this.gizmo.hover = tgt ? this.gizmo.hit(tgt, this.camera, m.w, m.h, m.cx, m.cy) : null;
      this.boxHover = !this.gizmo.hover && this.boxHandles && !this.previewRegion ? hitBoxHandle(this.region, this.camera, m.w, m.h, m.cx, m.cy) : null;
      const onDecal = this.decalEdit ? this.decalHit(m.cx, m.cy, m.w, m.h) : null;
      const pinning = this.pinTool ? (pinAtScreen(this, m.cx, m.cy) ? 'pointer' : 'crosshair') : '';
      this.canvas.style.cursor = pinning || (onDecal === 'move' ? 'move' : onDecal === 'size' ? 'nwse-resize' : onDecal === 'turn' ? 'grab' : this.gizmo.hover || this.boxHover ? 'pointer' : '');
      return;
    }
    const dr = this.drag;
    const dx = m.px - dr.last.px, dy = m.py - dr.last.py;
    dr.last = m;
    if (dr.mode === 'decal') {
      const E = this.decalEdit, D = E.decal;
      if (dr.how === 'size') {
        const k = Math.max(Math.hypot(m.cx - dr.c[0], m.cy - dr.c[1]) / Math.max(dr.d0, 1), 0.02);
        D.w = dr.w0 * k; D.h = dr.h0 * k;
      } else if (dr.how === 'turn') {
        D.rot = dr.rot0 - (Math.atan2(m.cy - dr.c[1], m.cx - dr.c[0]) - dr.a0) * 180 / Math.PI;
      } else {
        const ray = this.camera.ray(m.x, m.y);
        if (E.owner) {
          const s = this.scene.surfaceHit(ray, E.owner);
          if (s) { D.at = s.at; if (!D.wrap) D.dir = s.dir; D.x = 0; D.y = 0; }
        } else if (ray.dir[1] < -1e-4) {
          const t = -ray.origin[1] / ray.dir[1];
          D.at = [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t]; D.x = 0; D.y = 0;
        }
      }
      dr.moved = true;
      this.emit('moving', E.owner);
      return;
    }
    if (dr.mode === 'softgrab') {
      const ray = this.camera.ray(m.x, m.y);
      dr.grab.at = add(ray.origin, scale(ray.dir, dr.depth));
      return;
    }
    if (dr.mode === 'gizmo') {
      if (this.gizmo.move(this.camera, m.w, m.h, m.cx, m.cy, e.ctrlKey || e.metaKey)) {
        if (dr.item.kind === 'group') this.applyGroup(dr);
        dr.moved = true;
        this.emit('moving', dr.item);
      }
    } else if (dr.mode === 'box') {
      const r = moveBoxDrag(dr, this.camera, m.w, m.h, m.cx, m.cy, REGION_LIMITS, e.ctrlKey || e.metaKey);
      if (r && JSON.stringify(r.region) !== JSON.stringify(this.region)) {
        dr.readout = r.readout;
        dr.moved = true;
        this.setSimulation({ region: r.region, keep: true });
        this.emit('region');
      }
    } else if (dr.mode === 'mark-screen') {
      dr.item.x = clamp(dr.x0 + (m.cx - dr.m0.cx) / Math.max(m.w, 1), 0, 0.98);
      dr.item.y = clamp(dr.y0 + (m.cy - dr.m0.cy) / Math.max(m.h, 1), 0, 0.98);
      dr.moved = true;
      this.emit('moving', dr.item);
    } else if (dr.mode === 'mark-text') {
      dr.item.dx = Math.round(dr.dx0 + m.cx - dr.m0.cx);
      dr.item.dy = Math.round(dr.dy0 + m.cy - dr.m0.cy);
      dr.moved = true;
      this.emit('moving', dr.item);
    } else if (dr.mode === 'orbit') this.camera.orbit(dx, dy);
    else if (dr.mode === 'pan') this.camera.pan(dx, dy, this.metresPerPixel(m.h));
    else if (dr.mode === 'move') {
      const ray = this.camera.ray(m.x, m.y);
      if (Math.abs(ray.dir[1]) > 1e-4) {
        const t = (dr.grabY - ray.origin[1]) / ray.dir[1];
        if (t > 0) {
          const p = add(ray.origin, scale(ray.dir, t));
          const s0 = dr.starts[dr.group.indexOf(dr.item)].pos;
          const dx0 = clamp(p[0] + dr.offset[0], -12, 12) - s0[0], dz0 = clamp(p[2] + dr.offset[2], -12, 12) - s0[2];
          for (const s of dr.starts) { s.m.pos[0] = clamp(s.pos[0] + dx0, -12, 12); s.m.pos[2] = clamp(s.pos[2] + dz0, -12, 12); }
          dr.moved = true;
          this.emit('moving', dr.item);
        }
      }
    } else if (dr.mode === 'lift') {
      const y = clamp(dr.item.pos[1] - dy * this.metresPerPixel(m.h), 0, 12), up = y - dr.starts[dr.group.indexOf(dr.item)].pos[1];
      for (const s of dr.starts) s.m.pos[1] = clamp(s.pos[1] + up, 0, 12);
      dr.moved = true;
      this.emit('moving', dr.item);
    } else if (dr.mode === 'stir') {
      const k = this.metresPerPixel(m.h);
      const move = add(scale(this.camera.right, dx * k), scale(this.camera.up, -dy * k));
      const ray = this.camera.ray(m.x, m.y);
      this.stirMove = this.stirMove || { move: [0, 0, 0] };
      this.stirMove.move = add(this.stirMove.move, move);
      this.stirMove.ray = ray;
    }
  }

  onUp(e) {
    const dr = this.drag;
    if (dr && dr.mode === 'pan' && dr.button === 2 && !this.clean && e && e.type === 'pointerup' && Math.hypot(e.clientX - dr.start.px, e.clientY - dr.start.py) < 5) {
      const m = this.mouse(e);
      const mk = this.display.marks ? pickMark(this, this.markHits, m.cx, m.cy) : null;
      const hit = mk ? null : this.scene.pick(this.camera.ray(m.x, m.y), { ground: false });
      const item = mk ? mk.mark : hit && (this.kitOf(hit.item) || hit.item);
      if (item && !(this.movers().length > 1 && this.selectedItems().concat(this.movers()).includes(item))) this.select(item);
      this.emit('context', { item, x: e.clientX, y: e.clientY });
    }
    if (dr && dr.mode === 'softgrab') this.soft.letGo(dr.grab);
    if (dr && dr.mode === 'gizmo') {
      this.gizmo.end(); this.letGo(dr.item);
      if (dr.item.kind === 'group') for (const s of dr.starts) this.letGo(s.m);
    }
    if (dr && dr.item && dr.item.kind === 'object') dr.item.held = false;
    for (const o of (dr && dr.group) || []) if (o.kind === 'object') o.held = false;
    if (dr && !dr.moved && dr.pending === 'toggle') this.togglePick(dr.item);
    else if (dr && !dr.moved && dr.pending === 'alone') this.select(dr.item);
    else if (dr && !dr.moved && dr.mode === 'move' && dr.wasAlone && dr.item.partLooks && e && e.type === 'pointerup') {
      const m = this.mouse(e), s = this.scene.surfaceHit(this.camera.ray(m.x, m.y), dr.item);
      if (s && s.part >= 0) { dr.item.partPick = dr.item.partPick === s.part ? -1 : s.part; this.emit('select', dr.item); }
    }
    if (dr && dr.mode === 'box') { if (dr.moved) this.emit('region-done'); }
    else if (dr && dr.moved) this.emit('commit');
    this.drag = null;
  }

  metresPerPixel(h) { return 2 * Math.tan(this.camera.fov / 2) * this.camera.distance / Math.max(h, 1); }

  landingAt(x, y, lift = 0) {
    const ray = this.camera.ray(x, y), hit = this.scene.pick(ray);
    if (!hit) return null;
    const q = add(hit.point, scale(ray.dir, -0.01));
    const p = [clamp(q[0], -12, 12), 0, clamp(q[2], -12, 12)];
    const below = this.scene.pick({ origin: [p[0], Math.max(q[1], 0.01), p[2]], dir: [0, -1, 0] }, { emitters: false });
    p[1] = below ? Math.max(0, below.point[1]) : 0;
    if (lift > 0 && ray.dir[1] < -1e-3) {
      const H = p[1] + lift, t = (H - ray.origin[1]) / ray.dir[1];
      if (t > 0) {
        p[0] = clamp(ray.origin[0] + ray.dir[0] * t, -12, 12);
        p[2] = clamp(ray.origin[2] + ray.dir[2] * t, -12, 12);
        return { p, at: [p[0], H, p[2]], item: hit.item, point: hit.point };
      }
    }
    return { p, item: hit.item, point: hit.point };
  }

  placeWith(placer, x, y) {
    const at = this.landingAt(x, y, placer.lift || 0);
    const made = placer(at ? at.p : [0, 0, 0], at ? at.item : null, at ? at.point : [0, 0, 0]);
    this.emit('placed', made);
    if (made) { this.select(made); this.emit('change'); this.emit('commit'); }
    return made;
  }

  takeStir(realDt) {
    const s = this.stirMove;
    this.stirMove = null;
    if (!s || !s.ray) return null;
    let vel = scale(s.move, 1 / Math.max(realDt, 1 / 120));
    const sp = Math.hypot(...vel);
    if (sp > 8) vel = scale(vel, 8 / sp);
    return { origin: s.ray.origin, dir: s.ray.dir, radius: 0.35, vel };
  }
}

export { linear, dyeOf };
