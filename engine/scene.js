import { sub, dot, add, scale, cross, eulerAxes, toLocal, length, normalize } from './math.js';
import { SHAPES, unitMesh } from './shapes.js';
import { MAX_OBJECTS, MAX_EMITTERS, OBJ_FLOATS } from './sdf.wgsl.js';
import { MARK_TYPES } from './marks.js';
import { MAX_LIGHTS } from './render.wgsl.js';

export { MAX_OBJECTS, MAX_EMITTERS, MAX_LIGHTS };
export const MAX_MARKS = 40;

let nextId = 1;
export function takeId() { return nextId++; }
export function seenId(id) { nextId = Math.max(nextId, id + 1); }

const count = {};
export function nameFor(label) { count[label] = (count[label] || 0) + 1; return `${label} ${count[label]}`; }

export function sourceLabel(e) {
  if (e.sink) return e.type === 'smoke' ? 'Extractor' : 'Drain';
  return e.type === 'smoke' ? 'Smoke source' : 'Liquid source';
}
export const SINK_RATE = { smoke: 24, liquid: 18 };

export const LIGHT_KINDS = { area: 'Area light', point: 'Point light', spot: 'Spot light' };
export function lightAxes(l) {
  const y = normalize(l.dir);
  const ref = Math.abs(y[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const x = normalize(cross(ref, y));
  return [x, y, cross(x, y)];
}

export class Scene {
  constructor() {
    this.objects = [];
    this.emitters = [];
    this.marks = [];
    this.lights = [];
    this.selected = null;
    this.models = new Map();
  }

  get items() { return [...this.objects, ...this.emitters, ...this.lights, ...this.marks]; }

  addObject({ shape = 'box', pos = [0, 0.5, 0], size, rot = [0, 0, 0], color = [0.8, 0.8, 0.8], model = null, name, id,
    moves = false, collides = true, material = 'wood', home = null, finish = null, motion = null, asset = null }) {
    if (this.objects.length >= MAX_OBJECTS) return null;
    const def = SHAPES[shape];
    const o = { id: id || takeId(), kind: 'object', shape, name: name || nameFor(model ? this.models.get(model).name : def.label),
      pos: [...pos], size: [...(size || def.size)], rot: [...rot], color: [...color], model,
      moves, collides, material, home: home ? { pos: [...home.pos], rot: [...home.rot] } : { pos: [...pos], rot: [...rot] },
      finish: finish || null, motion: motion ? { ...motion } : null, asset: asset || null,
      vel: [0, 0, 0], spin: [0, 0, 0], last: [...pos] };
    if (id) seenId(id);
    this.objects.push(o);
    return o;
  }

  addEmitter({ type = 'smoke', pos = [0, 0.3, 0], radius = 0.25, color = [0.9, 0.9, 0.9], dir = [0, 1, 0], speed = 1, rate = 1, on = true, name, id,
    heat = 1, pulse = null, sink = false, attach = null }) {
    if (this.emitters.length >= MAX_EMITTERS) return null;
    const e = { id: id || takeId(), kind: 'emitter', type, name: name || nameFor(sourceLabel({ type, sink })),
      pos: [...pos], radius, color: [...color], dir: [...dir], speed, rate, on, heat, pulse: pulse ? { ...pulse } : null, sink: !!sink,
      attach: attach && attach.to != null ? { to: attach.to } : null, vel: [0, 0, 0], last: [...pos] };
    if (id) seenId(id);
    this.emitters.push(e);
    return e;
  }

  addLight({ type = 'area', pos = [0, 2, 0], dir = [0, -1, 0], color = [1, 1, 1], power = 6, radius = 0.4, aspect = 0.6, angle = 40,
    soft = 0.3, shadows = true, show = true, on = true, name, id }) {
    if (this.lights.length >= MAX_LIGHTS || !LIGHT_KINDS[type]) return null;
    const l = { id: id || takeId(), kind: 'light', type, name: name || nameFor(LIGHT_KINDS[type]), pos: [...pos], dir: normalize(dir),
      color: [...color], power, radius, aspect, angle, soft, shadows: shadows !== false, show: show !== false, on: on !== false };
    if (id) seenId(id);
    this.lights.push(l);
    return l;
  }

  addMark(d) {
    if (this.marks.length >= MAX_MARKS || !MARK_TYPES[d.type]) return null;
    const m = { ...JSON.parse(JSON.stringify(d)), kind: 'mark', id: d.id || takeId(), name: d.name || nameFor(MARK_TYPES[d.type].label) };
    if (d.id) seenId(d.id);
    this.marks.push(m);
    return m;
  }

  remove(item) {
    const gone = [item, ...(item.kind === 'object' ? this.emitters.filter(e => e.attach && e.attach.to === item.id) : [])];
    this.objects = this.objects.filter(o => o !== item);
    this.emitters = this.emitters.filter(e => !gone.includes(e));
    this.lights = this.lights.filter(l => l !== item);
    this.marks = this.marks.filter(m => m !== item);
    for (const g of gone) for (const m of this.marks) {
      if (m.target === g.id) m.target = null;
      if (m.from === g.id) m.from = null;
      if (m.to === g.id) m.to = null;
    }
    if (gone.includes(this.selected)) this.selected = null;
  }

  tick(dt) {
    for (const it of [...this.objects, ...this.emitters]) {
      const v = scale(sub(it.pos, it.last), 1 / Math.max(dt, 1e-4));
      it.vel = add(scale(it.vel, 0.5), scale(v, 0.5));
      it.last = [...it.pos];
    }
  }

  meshOf(o) { return o.model ? this.models.get(o.model).mesh : unitMesh(o.shape); }

  pick(ray, { ground = true, emitters = true } = {}) {
    let best = null;
    if (emitters) for (const e of this.emitters) {
      const t = raySphere(ray, e.pos, Math.max(e.radius * 0.6, 0.1));
      if (t !== null && (!best || t < best.t)) best = { item: e, t };
    }
    if (emitters) for (const l of this.lights) {
      const t = raySphere(ray, l.pos, Math.max(l.radius * 0.8, 0.1));
      if (t !== null && (!best || t < best.t)) best = { item: l, t };
    }
    for (const o of this.objects) {
      const t = rayObject(ray, o, this.meshOf(o));
      if (t !== null && (!best || t < best.t)) best = { item: o, t };
    }
    if (!best && ground && ray.dir[1] < -1e-4) best = { item: null, t: -ray.origin[1] / ray.dir[1] };
    if (best) best.point = add(ray.origin, scale(ray.dir, best.t));
    return best;
  }

  packObjects(out = new Float32Array(MAX_OBJECTS * OBJ_FLOATS)) {
    out.fill(0);
    this.objects.forEach((o, i) => packObject(out, i, o, this.selected === o ? 1 : 0, this.models));
    return out;
  }
}

export const OBJECT_FINISH = { matte: 1, metal: 2, glass: 3, gloss: 4 };

export function packObject(out, i, o, flag, models) {
  const ax = eulerAxes(o.rot);
  const m = o.model ? models.get(o.model) : null;
  const prop = m ? m.prop : [1, 1, 1];
  const code = SHAPES[o.shape].code;
  const spin = o.spin || [0, 0, 0];
  out.set([...o.pos, code, ...o.size, m ? m.slot : 0, ...o.vel, length(o.size) * 1.2,
    ...o.color, flag, ...ax[0], prop[0], ...ax[1], prop[1], ...ax[2], prop[2], ...spin, OBJECT_FINISH[o.finish] || 0], i * OBJ_FLOATS);
}

function raySphere(ray, c, r) {
  const oc = sub(ray.origin, c);
  const b = dot(oc, ray.dir), cc = dot(oc, oc) - r * r;
  const h = b * b - cc;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t > 0 ? t : null;
}

function rayObject(ray, o, mesh) {
  const ax = eulerAxes(o.rot);
  const s = o.size;
  if (raySphere(ray, o.pos, length(s) * 1.05) === null && length(sub(ray.origin, o.pos)) > length(s) * 1.05) return null;
  const lo = toLocal(ray.origin, o.pos, ax).map((v, k) => v / s[k]);
  const ld = [dot(ray.dir, ax[0]) / s[0], dot(ray.dir, ax[1]) / s[1], dot(ray.dir, ax[2]) / s[2]];
  let best = null;
  for (let i = 0; i < mesh.length; i += 18) {
    const t = rayTri(lo, ld, mesh, i);
    if (t !== null && t > 1e-5 && (best === null || t < best)) best = t;
  }
  return best;
}

function rayTri(o, d, m, i) {
  const ax = m[i], ay = m[i + 1], az = m[i + 2];
  const e1 = [m[i + 6] - ax, m[i + 7] - ay, m[i + 8] - az];
  const e2 = [m[i + 12] - ax, m[i + 13] - ay, m[i + 14] - az];
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tv = [o[0] - ax, o[1] - ay, o[2] - az];
  const u = dot(tv, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(tv, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  return dot(e2, q) * inv;
}
