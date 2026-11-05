import { openGPU, makeBuffer, UNIFORM } from './gpu.js';
import { OrbitCamera } from './camera.js';
import { Scene, packObject, nameFor, SINK_RATE, lightAxes } from './scene.js';
import { Smoke } from './smoke.js';
import { Flip, dyeOf, carriedCount, FIELD } from './flip.js';
import { Renderer, MAX_DRAW, linear } from './renderer.js';
import { defaultLook, LIGHT_PRESETS, BACKGROUNDS, LEGACY, copy } from './environment.js';
import { defaults, hexToRgb, lightOf } from './settings.js';
import { MAX_OBJECTS, MAX_EMITTERS, ATLAS_RES, ATLAS_SLOTS, ATLAS_PAD, OBJ_FLOATS } from './sdf.wgsl.js';
import { toUnitSpace, interleave } from './importers.js';
import { Physics, eulerOf } from './physics.js';
import { Gizmo } from './gizmo.js';
import { ASSET_BY_ID, assetModel, assetModelId } from './assets.js';
import { drawMarks, pickMark, MARK_TYPES, motionOn } from './marks.js';
import { drawBox, drawLanding, hitBoxHandle, beginBoxDrag, moveBoxDrag } from './boxhandles.js';
import { postIsNone } from './post.wgsl.js';
import { add, sub, scale, normalize, fromAngles, clamp, toHalf, eulerAxes } from './math.js';

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
    this.display = { box: true, sources: true, smoke: true, liquid: true, marks: true };
    this.simFrames = 0;
    this.markHits = new Map();
    this.stats = { fps: 0, simMs: 0, drawMs: 0, frames: 0 };
    this.handlers = {};
    this.emitterData = new Float32Array(MAX_EMITTERS * 16);
    this.objectData = new Float32Array(MAX_OBJECTS * OBJ_FLOATS);
    this.drawData = new Float32Array(MAX_DRAW * OBJ_FLOATS);
    this.stirMove = null;
    this.placing = null;
    this.windNow = [0, 0, 0];
    this.physics = new Physics();
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

  putBack() { this.physics.putBack(this.scene); }

  resetFluids() {
    if (this.smoke) this.smoke.reset();
    if (this.flip) this.flip.reset();
    if (this.config.refill) this.config.refill(this);
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
    this.scene.selected = item;
    this.emit('select', item);
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
    const sources = [];
    const ax = eulerAxes(o.rot), k = opts.scale || 1;
    for (const s of a.sources || []) {
      const l = s.at.map((v, i) => (v - centre[i]) * k);
      const pos = [0, 1, 2].map(i => o.pos[i] + ax[0][i] * l[0] + ax[1][i] * l[1] + ax[2][i] * l[2]);
      const dir = [0, 1, 2].map(i => ax[0][i] * s.dir[0] + ax[1][i] * s.dir[1] + ax[2][i] * s.dir[2]);
      const e = this.scene.addEmitter({ type: s.type, pos, dir, radius: s.radius * k, speed: s.speed ?? 0, rate: s.rate, heat: s.heat ?? 1,
        color: hexToRgb(s.color || '#2a2d33'), sink: !!s.sink, attach: { to: o.id },
        name: `${a.label} ${s.sink ? 'intake' : s.type === 'smoke' ? (s.heat === 0 ? 'mist' : 'smoke') : 'pour'}` });
      if (e) sources.push(e);
    }
    return { object: o, sources };
  }

  followObjects() {
    const S = this.scene;
    const same = (a, b) => !!b && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-7;
    for (const e of S.emitters) {
      const at = e.attach;
      if (!at) continue;
      const o = S.objects.find(x => x.id === at.to);
      if (!o) { e.attach = null; continue; }
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

  applyMotion(t) {
    for (const o of this.scene.objects) {
      if (o.held || !o.motion || !o.home) continue;
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
      color: parsed.color || null, zUp: !!parsed.zUp, asset: parsed.asset || null, design: parsed.design || null };
    this.scene.models.set(modelId, entry);
    this.renderer.addMesh('model:' + modelId, mesh);
    entry.whenReady = this.bakeModel(entry);
    return modelId;
  }

  whenModelsReady(all = false) { return Promise.all([...this.scene.models.values()].filter(m => all || m.asset).map(m => m.whenReady)); }

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
    for (const id of this.scene.models.keys()) this.renderer.removeMesh('model:' + id);
    this.scene.models.clear();
    this.freeSlots = [...Array(ATLAS_SLOTS).keys()];
  }

  dropUnusedModels(keep = new Set()) {
    for (const [id, m] of this.scene.models) {
      if (keep.has(id) || this.scene.objects.some(o => o.model === id)) continue;
      this.scene.models.delete(id);
      this.renderer.removeMesh('model:' + id);
      this.freeSlots.push(m.slot);
    }
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
    if (running) this.physics.step(this.scene, frameDt, Math.max(2, Math.ceil(S.speed * 2)), look.wind.on ? wind : null);
    this.followObjects();
    if (this.flip) {
      if (running) this.flip.planEmission(this.scene.emitters.filter(e => this.isOn(e)), frameDt, S.flow);
      else this.flip.newCount = 0;
    }
    this.packEmitters();
    const d = this.gpu.device;
    d.queue.writeBuffer(this.shared.emitters, 0, this.emitterData);
    d.queue.writeBuffer(this.shared.objects, 0, this.packSolidObjects());

    const stir = this.takeStir(realDt);
    const nE = this.scene.emitters.length, nO = this.solidCount;
    const light = look.light;
    const windParams = look.wind.on ? { vel: wind, uptake: 1.2, turbulence: look.wind.turbulence, turbScale: 0.9, time: this.simTime, grip: 2.0 } : null;
    if (this.smoke && running) {
      this.smoke.writeParams({ dt: frameDt, rise: S.rise, sink: 0.3, swirl: S.swirl * 3, cooling: 0.5,
        fade: S.fade, absorb: S.smokeOpacity, emitterCount: nE, objectCount: nO,
        light: fromAngles(light.key.az, light.key.el),
        rim: light.rim.power > 0 ? fromAngles(light.rim.az, light.rim.el) : null, stir, wind: windParams });
    }
    const substeps = Math.max(2, Math.ceil(S.speed * 2));
    if (this.flip && running) {
      this.flip.writeParams({ dt: frameDt / substeps, frameDt, gravity: 9.81, splash: S.splash, drift: 0.08,
        objectCount: nO, emitterCount: nE, stir, wind: windParams });
    }

    const enc = d.createCommandEncoder();
    const cp = enc.beginComputePass(this.querySet ? { timestampWrites: { querySet: this.querySet,
      beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    if (this.smoke && running) this.smoke.step(cp);
    if (this.flip && running) this.flip.step(cp, substeps);
    const smooth = this.flip && S.look === 'smooth' && this.flip.live > 0 && this.display.liquid;
    if (smooth) this.flip.buildField(cp);
    const lights = this.lightsForFrame();
    if (this.smoke && this.display.smoke && lights.length) this.smoke.lightLocal(cp, lights.map(l => l.pos));
    cp.end();
    if (this.flip && running) this.flip.endFrame(enc);

    const meshes = this.packDraws();
    this.renderer.post = postIsNone(look.post) ? null : look.post;
    const drawWater = this.flip && this.flip.live > 0 && this.display.liquid;
    const lookCode = !drawWater ? 0 : S.look === 'dots' ? 1 : S.look === 'smooth' ? 3 : 2;
    const radius = this.flip ? (lookCode === 1 ? this.flip.cell * 0.32 : lookCode === 3 ? this.flip.cell * 0.7 : this.flip.cell * 0.5) : 0;
    this.renderer.packFrame({
      camera: this.camera, look, time: this.time, wind,
      smoke: this.display.smoke ? this.smoke : null, smokeAbsorb: S.smokeOpacity,
      liquidView: { look: lookCode, radius, clarity: S.clarity, color: hexToRgb(S.liquidColor),
        min: this.flip ? this.flip.min : [0, 0, 0], max: this.flip ? this.flip.max : [0, 0, 0], cell: this.flip ? this.flip.cell : 1,
        fine: smooth ? this.flip.field.fine : 0, soften: FIELD.soften },
      box: this.flip && this.display.box ? { min: this.flip.min, max: this.flip.max } : null,
      shadowReach: Math.max(7, Math.hypot(this.region.size[0], this.region.size[2]) * 0.6),
      shadowCenter: [this.region.center[0], 1, this.region.center[1]],
      lights,
    });
    this.renderer.render(enc, {
      drawData: this.drawData, meshes, objectCount: this.scene.objects.length,
      glass: this.scene.objects.some(o => o.finish === 'glass'),
      particles: this.flip && this.display.liquid ? { pos: this.flip.buf.pos, col: this.flip.buf.col, count: this.flip.live, look: this.flip.lookView,
        field: smooth ? this.flip.field.view : null } : null,
      smoke: this.smoke, look: lookCode, timestamps: this.querySet,
    });

    let copied = false;
    if (this.querySet) {
      enc.resolveQuerySet(this.querySet, 0, 4, this.qResolve, 0);
      if (!this.qBusy) { enc.copyBufferToBuffer(this.qResolve, 0, this.qRead, 0, 32); copied = true; }
    }
    const probe = this.probe && !this.probeBusy ? this.encodeProbe(enc) : null;
    d.queue.submit([enc.finish()]);
    this.drawOverlay();
    if (copied) this.readTimes();
    if (probe) this.readProbe(probe);
    if (this.flip) {
      const pr = this.flip.readWater();
      if (pr) pr.then(w => { if (w) this.physics.setWater(w); });
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
        out.set([...e.pos, e.radius, ...c, 7 * e.rate * S.smokeAmount, ...vel, 4 * (e.heat ?? 1), kind, 0, 0, 0], i * 16);
      } else {
        out.set([...e.pos, e.radius, ...c, 0, ...vel, 0, kind, e.newFirst || 0, e.newCount || 0, 0], i * 16);
      }
    });
  }

  packSolidObjects() {
    const out = this.objectData.fill(0), S = this.scene;
    let n = 0;
    this.solidIds = [];
    for (const o of S.objects) {
      if (o.model && !(S.models.get(o.model) || {}).ready) continue;
      if (o.collides === false) continue;
      packObject(out, n++, o, 0, S.models);
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

  packDraws() {
    const out = this.drawData.fill(0), meshes = [], S = this.scene, sel = S.selected;
    let i = 0;
    for (const o of S.objects) {
      packObject(out, i++, o, o === sel ? 1 : 0, S.models);
      meshes.push(o.model ? 'model:' + o.model : (o.shape === 'wall' || o.shape === 'slab' ? 'box' : o.shape));
    }
    if (this.display.sources) for (const e of S.emitters) {
      const r = Math.max(e.radius * 0.45, 0.07);
      const flag = e === sel ? 3 : 2;
      const col = e.sink ? (this.isOn(e) ? [0.12, 0.13, 0.15] : [0.5, 0.52, 0.55]) : !this.isOn(e) ? e.color.map(c => c * 0.3) : e.color;
      packObject(out, i++, { pos: e.pos, shape: 'ball', size: [r, r, r], rot: [0, 0, 0], vel: [0, 0, 0], color: col }, flag, S.models);
      meshes.push('ball');
    }
    for (const l of S.lights) {
      if (l.show === false || i >= MAX_DRAW) continue;
      const c = lightOf(l.color), top = Math.max(...c, 1e-3);
      const col = c.map(v => v / top * (l.on === false ? 0.08 : 1));
      const point = l.type === 'point', chosen = l === sel ? 1 : 0;
      const r = Math.max(l.radius, 0.025);
      const shape = l.type === 'area' ? 'box' : point ? 'ball' : 'column';
      const size = l.type === 'area' ? [l.radius, 0.008, l.radius * (l.aspect ?? 0.6)] : point ? [r, r, r] : [r, r * 1.3, r];
      packObject(out, i++, { pos: l.pos, shape, size, rot: point ? [0, 0, 0] : eulerOf(lightAxes(l)), vel: [0, 0, 0], color: col },
        (point ? 6 : 4) + chosen, S.models);
      meshes.push(shape);
    }
    return meshes;
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
    c.addEventListener('pointerleave', () => { if (!this.drag) this.gizmo.hover = null; });
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
    if (!this.overlay || !it || this.placing || !HANDLE_TOOLS.has(this.tool)) return null;
    if (it.kind === 'mark') {
      if (!it.pos || it.target != null || MARK_TYPES[it.type].screen) return null;
      if (this.tool !== 'move' && !it.rot) return null;
    }
    return it;
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
    const dr = this.drag && this.drag.mode === 'box' ? this.drag : null;
    if (this.previewRegion) drawBox(ctx, this.previewRegion, this.camera, W, H, { handles: false });
    else if (this.boxHandles) drawBox(ctx, this.region, this.camera, W, H,
      { hot: dr ? dr.h : this.boxHover, readout: dr && dr.readout, mouse: this.mouseAt });
    if (this.dropPreview) drawLanding(ctx, this.camera, this.dropPreview.p, W, H);
    if (this.display.marks) drawMarks(ctx, this, W, H, this.markHits);
    else this.markHits.clear();
    const it = this.gizmoTarget();
    if (it) this.gizmo.draw(ctx, it, this.camera, W, H, this.mouseAt);
  }

  cancelDrag() {
    const dr = this.drag;
    if (dr && dr.mode === 'box') {
      this.drag = null;
      if (dr.moved) { this.setSimulation({ region: dr.R0, keep: true }); this.emit('region'); }
      return true;
    }
    if (!dr || dr.mode !== 'gizmo') return false;
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
    const right = this.config.rightDrag || 'stir';
    if (e.button === 1 || (e.button === 2 && right === 'pan')) { e.preventDefault(); this.drag = { mode: 'pan', last: m, start: m, button: e.button }; return; }
    if (e.button === 2 || (e.button === 0 && this.tool === 'stir')) { this.drag = { mode: 'stir', last: m }; return; }
    const tgt = this.gizmoTarget();
    if (tgt && e.button === 0) {
      const h = this.gizmo.hit(tgt, this.camera, m.w, m.h, m.cx, m.cy);
      if (h && this.gizmo.begin(tgt, h, this.camera, m.w, m.h, m.cx, m.cy)) {
        if (tgt.kind === 'object') tgt.held = true;
        this.drag = { mode: 'gizmo', item: tgt, last: m, moved: false };
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
      this.select(it);
      if (MARK_TYPES[it.type].screen) this.drag = { mode: 'mark-screen', item: it, x0: it.x, y0: it.y, m0: m, last: m, moved: false };
      else if (it.type === 'label' && mk.part === 'text') this.drag = { mode: 'mark-text', item: it, dx0: it.dx, dy0: it.dy, m0: m, last: m, moved: false };
      else if (it.pos && it.target == null) {
        const y = it.pos[1], t = Math.abs(ray.dir[1]) > 1e-4 ? (y - ray.origin[1]) / ray.dir[1] : -1;
        const p = t > 0 ? add(ray.origin, scale(ray.dir, t)) : it.pos;
        this.drag = { mode: 'move', item: it, grabY: y, offset: sub(it.pos, p), last: m, moved: false };
      } else this.drag = { mode: 'orbit', last: m };
      return;
    }
    if (hit && hit.item) {
      this.select(hit.item);
      if (hit.item.kind === 'object') hit.item.held = true;
      this.drag = { mode: e.shiftKey ? 'lift' : 'move', item: hit.item, grabY: hit.point[1],
        offset: sub(hit.item.pos, hit.point), last: m, moved: false };
    } else {
      this.select(null);
      this.drag = { mode: 'orbit', last: m };
    }
  }

  onMove(e) {
    const m = this.mouse(e);
    this.mouseAt = [m.cx, m.cy];
    if (!this.drag) {
      const tgt = this.gizmoTarget();
      this.gizmo.hover = tgt ? this.gizmo.hit(tgt, this.camera, m.w, m.h, m.cx, m.cy) : null;
      this.boxHover = !this.gizmo.hover && this.boxHandles && !this.previewRegion ? hitBoxHandle(this.region, this.camera, m.w, m.h, m.cx, m.cy) : null;
      this.canvas.style.cursor = this.gizmo.hover || this.boxHover ? 'pointer' : '';
      return;
    }
    const dr = this.drag;
    const dx = m.px - dr.last.px, dy = m.py - dr.last.py;
    dr.last = m;
    if (dr.mode === 'gizmo') {
      if (this.gizmo.move(this.camera, m.w, m.h, m.cx, m.cy, e.ctrlKey || e.metaKey)) { dr.moved = true; this.emit('moving', dr.item); }
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
          dr.item.pos[0] = clamp(p[0] + dr.offset[0], -12, 12);
          dr.item.pos[2] = clamp(p[2] + dr.offset[2], -12, 12);
          dr.moved = true;
          this.emit('moving', dr.item);
        }
      }
    } else if (dr.mode === 'lift') {
      dr.item.pos[1] = clamp(dr.item.pos[1] - dy * this.metresPerPixel(m.h), 0, 12);
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
    if (dr && dr.mode === 'pan' && dr.button === 2 && e && e.type === 'pointerup' && Math.hypot(e.clientX - dr.start.px, e.clientY - dr.start.py) < 5) {
      const m = this.mouse(e);
      const mk = this.display.marks ? pickMark(this, this.markHits, m.cx, m.cy) : null;
      const hit = mk ? null : this.scene.pick(this.camera.ray(m.x, m.y), { ground: false });
      const item = mk ? mk.mark : hit && hit.item;
      if (item) this.select(item);
      this.emit('context', { item, x: e.clientX, y: e.clientY });
    }
    if (dr && dr.mode === 'gizmo') { this.gizmo.end(); this.letGo(dr.item); }
    if (dr && dr.item && dr.item.kind === 'object') dr.item.held = false;
    if (dr && dr.mode === 'box') { if (dr.moved) this.emit('region-done'); }
    else if (dr && dr.moved) this.emit('commit');
    this.drag = null;
  }

  metresPerPixel(h) { return 2 * Math.tan(this.camera.fov / 2) * this.camera.distance / Math.max(h, 1); }

  landingAt(x, y) {
    const ray = this.camera.ray(x, y), hit = this.scene.pick(ray);
    if (!hit) return null;
    const q = add(hit.point, scale(ray.dir, -0.01));
    const p = [clamp(q[0], -12, 12), 0, clamp(q[2], -12, 12)];
    const below = this.scene.pick({ origin: [p[0], Math.max(q[1], 0.01), p[2]], dir: [0, -1, 0] }, { emitters: false });
    p[1] = below ? Math.max(0, below.point[1]) : 0;
    return { p, item: hit.item, point: hit.point };
  }

  placeWith(placer, x, y) {
    const at = this.landingAt(x, y);
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
