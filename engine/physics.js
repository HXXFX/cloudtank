import { shapeSdf, shapeNormal } from './sdf.js';
import { SHAPES, unitMesh } from './shapes.js';
import { eulerAxes } from './math.js';

export const MATERIALS = {
  foam:    { label: 'Foam',    density: 60,   friction: 0.8,  bounce: 0.2 },
  wood:    { label: 'Wood',    density: 600,  friction: 0.6,  bounce: 0.25 },
  plastic: { label: 'Plastic', density: 950,  friction: 0.45, bounce: 0.35 },
  rubber:  { label: 'Rubber',  density: 1100, friction: 0.95, bounce: 0.7 },
  stone:   { label: 'Stone',   density: 2500, friction: 0.7,  bounce: 0.1 },
  metal:   { label: 'Metal',   density: 7800, friction: 0.4,  bounce: 0.15 },
};

export const MOVES_BY_DEFAULT = new Set(['box', 'ball', 'cone', 'ring']);

let G = 9.81;
export function setGravity(v) { G = v; }
export const blocksFluid = o => o.blocksFluid ?? (o.collides !== false);
const softThing = o => !!(o.soft && o.soft.on !== false);
const WATER = 1000, AIR = 1.2;
const ITER = 12;
const SLOP = 0.001, BETA = 0.25, MARGIN = 0.01;
const SLEEP_V = 0.06, SLEEP_W = 0.1, SLEEP_T = 0.6;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);

function quatFromEuler([tilt, turn, roll]) {
  const qy = [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)];
  const qx = [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)];
  const qz = [0, 0, Math.sin(roll / 2), Math.cos(roll / 2)];
  return qmul(qmul(qy, qx), qz);
}
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qnorm(q) { const l = Math.hypot(...q) || 1; return q.map(v => v / l); }
function axesOf(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}
function eulerOf(ax) {
  const r12 = ax[2][1], r02 = ax[2][0], r22 = ax[2][2], r10 = ax[0][1], r11 = ax[1][1];
  const tilt = Math.asin(Math.max(-1, Math.min(1, -r12)));
  if (Math.abs(r12) < 0.9999) return [tilt, Math.atan2(r02, r22), Math.atan2(r10, r11)];
  return [tilt, Math.atan2(-ax[0][2], ax[0][0]), 0];
}
const toWorld = (ax, v) => [
  ax[0][0] * v[0] + ax[1][0] * v[1] + ax[2][0] * v[2],
  ax[0][1] * v[0] + ax[1][1] * v[1] + ax[2][1] * v[2],
  ax[0][2] * v[0] + ax[1][2] * v[1] + ax[2][2] * v[2],
];
const toLocal = (ax, v) => [dot(v, ax[0]), dot(v, ax[1]), dot(v, ax[2])];


class Body {
  constructor(o) {
    this.o = o;
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.force = [0, 0, 0];
    this.torque = [0, 0, 0];
    this.sleep = 0;
    this.asleep = false;
    this.key = '';
    this.fromObject();
  }

  fromObject() {
    const o = this.o;
    this.pos = [...o.pos];
    this.q = quatFromEuler(o.rot);
    this.ax = axesOf(this.q);
    this.written = { pos: [...o.pos], rot: [...o.rot] };
  }

  rebuild(scene) {
    const o = this.o, model = o.model ? scene.models.get(o.model) : null;
    if (o.model && !model) return;
    const key = `${o.shape}|${o.model}|${o.size.join(',')}|${o.material}|${model && model.field ? 1 : 0}|${o.massKg || 0}|${o.bounce ?? ''}|${o.grip ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    const mat = MATERIALS[o.material] || MATERIALS.wood;
    const n = 16, s = o.size;
    let inside = 0, ixx = 0, iyy = 0, izz = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n * 2 - 1) * s[0], y = ((j + 0.5) / n * 2 - 1) * s[1], z = ((k + 0.5) / n * 2 - 1) * s[2];
      if (shapeSdf(x, y, z, o, model) < 0) { inside++; ixx += y * y + z * z; iyy += x * x + z * z; izz += x * x + y * y; }
    }
    const cellV = 8 * s[0] * s[1] * s[2] / (n * n * n);
    this.volume = Math.max(inside * cellV, 1e-5);
    this.mass = o.massKg > 0 ? o.massKg : mat.density * this.volume;
    const k = this.mass / this.volume * cellV;
    const I = [Math.max(ixx * k, 1e-6), Math.max(iyy * k, 1e-6), Math.max(izz * k, 1e-6)];
    this.invI = I.map(v => 1 / v);
    this.friction = o.grip ?? mat.friction;
    this.bounce = o.bounce ?? mat.bounce;
    this.radius = Math.hypot(...s);
    this.samples = surfacePoints(scene.meshOf(o), s);
    this.vol = [];
    for (let k = 0; k < 7; k++) for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
      const x = ((i + 0.5) / 7 * 2 - 1) * s[0], y = ((j + 0.5) / 7 * 2 - 1) * s[1], z = ((k + 0.5) / 7 * 2 - 1) * s[2];
      if (shapeSdf(x, y, z, o, model) < 0) this.vol.push([x, y, z]);
    }
    if (!this.vol.length) this.vol.push([0, 0, 0]);
    this.normals = this.samples.map(lp => shapeNormal(lp[0], lp[1], lp[2], o, model));
    this.sampleArea = surfaceArea(scene.meshOf(o), s) / Math.max(this.samples.length, 1);
  }

  get dynamic() { return !!this.o.moves && !this.o.held && !softThing(this.o); }
  get free() { return this.dynamic && !this.asleep; }
  get invMass() { return this.free ? 1 / this.mass : 0; }

  applyInvI(t) {
    if (!this.free) return [0, 0, 0];
    const l = toLocal(this.ax, t);
    return toWorld(this.ax, [l[0] * this.invI[0], l[1] * this.invI[1], l[2] * this.invI[2]]);
  }

  velAt(p) { return add(this.v, cross(this.w, sub(p, this.pos))); }

  impulse(J, p) {
    if (!this.free) return;
    this.v = add(this.v, mul(J, 1 / this.mass));
    this.w = add(this.w, this.applyInvI(cross(sub(p, this.pos), J)));
  }

  wake() { this.asleep = false; this.sleep = 0; }
}

function surfacePoints(mesh, s) {
  const pts = [];
  const tris = mesh.length / 18;
  let total = 0;
  const areas = new Float64Array(tris);
  const P = (t, c) => [mesh[t * 18 + c * 6] * s[0], mesh[t * 18 + c * 6 + 1] * s[1], mesh[t * 18 + c * 6 + 2] * s[2]];
  for (let t = 0; t < tris; t++) { areas[t] = len(cross(sub(P(t, 1), P(t, 0)), sub(P(t, 2), P(t, 0)))) / 2; total += areas[t]; }
  const cell = Math.max(...s) * 2 / 10;
  const seen = new Set();
  const keep = p => {
    const k = p.map(v => Math.round(v / cell)).join(',');
    if (seen.has(k)) return;
    seen.add(k);
    pts.push(p);
  };
  for (let t = 0; t < tris; t++) for (let c = 0; c < 3; c++) keep(P(t, c));
  const want = 300;
  let r = 0.5;
  for (let t = 0; t < tris; t++) {
    const count = Math.round(areas[t] / total * want);
    for (let i = 0; i < count; i++) {
      r = (r * 9301 + 0.49297) % 1; let a = r; r = (r * 9301 + 0.49297) % 1; let b = r;
      if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const A = P(t, 0), B = P(t, 1), C = P(t, 2);
      keep(add(A, add(mul(sub(B, A), a), mul(sub(C, A), b))));
    }
  }
  return pts;
}

function surfaceArea(mesh, s) {
  let a = 0;
  for (let t = 0; t < mesh.length; t += 18) {
    const P = c => [mesh[t + c * 6] * s[0], mesh[t + c * 6 + 1] * s[1], mesh[t + c * 6 + 2] * s[2]];
    a += len(cross(sub(P(1), P(0)), sub(P(2), P(0)))) / 2;
  }
  return a;
}


export class Physics {
  constructor() {
    this.bodies = new Map();
    this.warm = new Map();
    this.water = null;
    this.stats = { bodies: 0, contacts: 0, ms: 0, awake: 0 };
  }

  sync(scene) {
    const ids = new Set();
    for (const o of scene.objects) {
      ids.add(o.id);
      let b = this.bodies.get(o.id);
      if (!b) { b = new Body(o); this.bodies.set(o.id, b); }
      b.o = o;
      b.rebuild(scene);
      const w = b.written;
      if (o.pos.some((v, k) => Math.abs(v - w.pos[k]) > 1e-9) || o.rot.some((v, k) => Math.abs(v - w.rot[k]) > 1e-9)) {
        const held = o.held;
        b.fromObject();
        if (!held) { b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
        b.wake();
        this.wakeNear(b);
      }
      if (!o.moves) { b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
      const flags = `${o.moves}|${o.collides}|${o.material}|${o.noGravity || 0}|${blocksFluid(o)}`;
      if (b.flags !== undefined && b.flags !== flags) { b.wake(); this.wakeNear(b); }
      b.flags = flags;
    }
    for (const id of [...this.bodies.keys()]) if (!ids.has(id)) this.bodies.delete(id);
  }

  wakeNear(b) {
    for (const c of this.bodies.values()) if (c !== b && len(sub(c.pos, b.pos)) < c.radius + b.radius + 0.1) c.wake();
  }

  step(scene, dt, steps, wind, afterStep = null) {
    const t0 = performance.now();
    this.scene = scene;
    this.sync(scene);
    const all = [...this.bodies.values()];
    this.lastAll = all;
    if (wind) {
      for (const b of all) {
        if (b.asleep && b.dynamic && blocksFluid(b.o) && len(this.windForce(b, wind).f) > 0.05 * G * b.mass) b.wake();
      }
    }
    const h = dt / steps;
    let contacts = 0;
    for (let s = 0; s < steps; s++) {
      contacts = this.substep(all, h, wind);
      if (afterStep) afterStep(h);
    }
    this.writeBack();
    this.stats = { bodies: all.length, contacts, ms: performance.now() - t0, awake: all.filter(b => b.free).length };
  }

  writeBack() {
    for (const b of this.lastAll || []) {
      const o = b.o;
      if (!o.moves || o.held || softThing(o)) continue;
      o.pos = [...b.pos];
      o.rot = eulerOf(b.ax);
      o.vel = [...b.v];
      o.spin = [...b.w];
      o.last = [...o.pos];
      b.written = { pos: [...o.pos], rot: [...o.rot] };
    }
  }

  substep(all, h, wind) {
    for (const b of all) {
      if (b.wasHeld && !b.o.held && b.o.moves) {
        const v = b.o.vel || [0, 0, 0], sp = len(v);
        b.v = sp > 8 ? mul(v, 8 / sp) : [...v];
        b.w = [0, 0, 0];
        b.wake();
      }
      b.wasHeld = !!b.o.held;
      if (b.o.held) {
        const p = b.o.pos;
        b.v = mul(sub(p, b.pos), 1 / h);
        b.pos = [...p];
        b.q = quatFromEuler(b.o.rot); b.ax = axesOf(b.q);
        b.w = [0, 0, 0];
        b.written = { pos: [...p], rot: [...b.o.rot] };
        b.wake();
      } else if (!b.o.moves) {
        b.pos = [...b.o.pos]; b.q = quatFromEuler(b.o.rot); b.ax = axesOf(b.q);
      }
    }
    const moving = all.filter(b => b.free);
    for (const b of moving) {
      let f = [0, b.o.noGravity ? 0 : -G * b.mass, 0], t = [0, 0, 0];
      const wet = blocksFluid(b.o) ? this.buoyancy(b) : null;
      if (wind && blocksFluid(b.o)) {
        const w = this.windForce(b, wind);
        f = add(f, w.f); t = add(t, w.t);
      }
      let mEff = b.mass;
      if (wet && wet.frac > 0) {
        mEff = b.mass + 0.5 * WATER * b.volume * wet.frac;
        f = add(f, wet.f);
        t = add(t, wet.t);
      }
      b.v = add(b.v, mul(f, h / mEff));
      b.w = add(b.w, b.applyInvI(mul(t, h * b.mass / mEff)));
      if (b.o.linDamp > 0) b.v = mul(b.v, Math.exp(-b.o.linDamp * h));
      if (b.o.angDamp > 0) b.w = mul(b.w, Math.exp(-b.o.angDamp * h));
      if (wet && wet.frac > 0) {
        const rel = sub(b.v, wet.flow);
        const area = Math.pow(b.volume, 2 / 3);
        const rate = wet.frac * (2 + 0.5 * WATER * area * len(rel) / mEff);
        b.v = sub(b.v, mul(rel, Math.min(1, rate * h)));
        b.w = mul(b.w, Math.exp(-3 * wet.frac * h));
      }
      b.v = mul(b.v, Math.exp(-0.05 * h));
      b.w = mul(b.w, Math.exp(-0.2 * h));
      b.wetFrac = wet ? wet.frac : 0;
    }
    const cs = this.findContacts(all);
    this.solve(cs, h);
    for (const b of moving) {
      b.pos = add(b.pos, mul(b.v, h));
      const wq = [b.w[0], b.w[1], b.w[2], 0];
      const dq = qmul(wq, b.q);
      b.q = qnorm(b.q.map((v, k) => v + dq[k] * h * 0.5));
      b.ax = axesOf(b.q);
      if (len(b.v) < SLEEP_V && len(b.w) < SLEEP_W) {
        b.sleep += h;
        if (b.sleep > (b.wetFrac > 0 ? 3 : SLEEP_T)) {
          b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.sleptWet = b.wetFrac || 0;
        }
      } else b.sleep = 0;
    }
    return cs.length;
  }

  setWater(w) {
    if (!w) { this.water = null; return; }
    const { nx, nz, cols } = w;
    const level = new Float32Array(nx * nz), vx = new Float32Array(nx * nz), vz = new Float32Array(nx * nz);
    for (let i = 0; i < nx * nz; i++) { level[i] = cols[i * 4]; vx[i] = cols[i * 4 + 1]; vz[i] = cols[i * 4 + 2]; }
    this.water = { min: w.min, cell: w.cell, nx, nz, level, vx, vz };
    for (const b of this.bodies.values()) {
      if (b.asleep && b.dynamic && b.o.collides !== false) {
        const wet = this.buoyancy(b);
        if (wet && Math.abs(wet.frac - (b.sleptWet || 0)) > 0.05) b.wake();
      }
    }
  }

  buoyancy(b) {
    const W = this.water;
    if (!W || !b.vol) return null;
    const dry = { frac: 0, f: [0, 0, 0], t: [0, 0, 0], flow: [0, 0, 0] };
    const around = this.levelAround(b);
    if (!around) return dry;
    const dV = b.volume / b.vol.length;
    let f = 0, tx = 0, tz = 0, under = 0;
    for (const lp of b.vol) {
      const p = add(b.pos, toWorld(b.ax, lp));
      const cx = Math.floor((p[0] - W.min[0]) / W.cell), cz = Math.floor((p[2] - W.min[1]) / W.cell);
      if (cx < 0 || cz < 0 || cx >= W.nx || cz >= W.nz || W.level[cx + W.nx * cz] === -1) continue;
      if (p[1] >= around.level) continue;
      under++;
      const lift = WATER * G * dV;
      f += lift;
      const r = sub(p, b.pos);
      tx += -r[2] * lift; tz += r[0] * lift;
    }
    if (!under) return dry;
    return { frac: under / b.vol.length, f: [0, f, 0], t: [tx, 0, tz], flow: around.flow };
  }

  levelAround(b) {
    const W = this.water;
    const cx = (b.pos[0] - W.min[0]) / W.cell, cz = (b.pos[2] - W.min[1]) / W.cell;
    const inner = b.radius / W.cell;
    const levels = [];
    let fx = 0, fz = 0;
    for (let ring = 0; ring < 4 && !levels.length; ring++) {
      const r0 = inner + ring * 2, r1 = r0 + 2;
      for (let z = Math.max(0, Math.floor(cz - r1)); z <= Math.min(W.nz - 1, Math.floor(cz + r1)); z++) {
        for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(W.nx - 1, Math.floor(cx + r1)); x++) {
          const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(z + 0.5 - cz));
          if (d <= r0 || d > r1) continue;
          const i = x + W.nx * z, L = W.level[i];
          if (L < 0) continue;
          levels.push(L);
          fx += W.vx[i]; fz += W.vz[i];
        }
      }
    }
    if (!levels.length) return null;
    levels.sort((p, q) => p - q);
    return { level: levels[levels.length >> 1], flow: [fx / levels.length, 0, fz / levels.length] };
  }

  windForce(b, wind) {
    let f = [0, 0, 0], t = [0, 0, 0];
    const area = b.sampleArea;
    for (let i = 0; i < b.samples.length; i++) {
      const lp = b.samples[i];
      const n = toWorld(b.ax, b.normals[i]);
      const p = add(b.pos, toWorld(b.ax, lp));
      const rel = sub(wind, b.velAt(p));
      const into = -dot(rel, n);
      if (into <= 0) continue;
      const push = mul(n, -0.5 * AIR * into * into * area);
      f = add(f, push);
      t = add(t, cross(sub(p, b.pos), push));
    }
    return { f, t };
  }

  placePoints(all) {
    for (const b of all) {
      const n = b.samples.length;
      if (!b.wp || b.wp.length !== n * 3) b.wp = new Float64Array(n * 3);
      const a = b.ax, P = b.pos, wp = b.wp;
      for (let i = 0; i < n; i++) {
        const l = b.samples[i];
        wp[i * 3] = P[0] + a[0][0] * l[0] + a[1][0] * l[1] + a[2][0] * l[2];
        wp[i * 3 + 1] = P[1] + a[0][1] * l[0] + a[1][1] * l[1] + a[2][1] * l[2];
        wp[i * 3 + 2] = P[2] + a[0][2] * l[0] + a[1][2] * l[1] + a[2][2] * l[2];
      }
    }
  }

  findContacts(all) {
    const cs = [];
    this.placePoints(all);
    const alive = all.filter(b => b.o.collides !== false && !softThing(b.o));
    for (let i = 0; i < alive.length; i++) {
      const A = alive[i];
      if (A.free && A.pos[1] - A.radius < MARGIN) this.groundContacts(A, cs);
      if (A.free && A.wetFrac > 0 && this.water) this.wallContacts(A, cs);
      for (let j = i + 1; j < alive.length; j++) {
        const B = alive[j];
        if (!A.free && !B.free) continue;
        const dx = A.pos[0] - B.pos[0], dy = A.pos[1] - B.pos[1], dz = A.pos[2] - B.pos[2];
        const r = A.radius + B.radius + MARGIN;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        this.pointsInto(A, B, cs);
        this.pointsInto(B, A, cs);
      }
    }
    for (const b of all) if (b.o.collides === false && b.free && b.pos[1] - b.radius < MARGIN) this.groundContacts(b, cs);
    return cs;
  }

  groundContacts(A, cs) {
    const found = [];
    const wp = A.wp, n = A.samples.length;
    for (let i = 0; i < n; i++) if (wp[i * 3 + 1] < MARGIN) found.push(i);
    found.sort((a, b) => wp[a * 3 + 1] - wp[b * 3 + 1]);
    for (const i of found.slice(0, 24)) {
      cs.push(this.contact(A, null, wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2], 0, 1, 0, -wp[i * 3 + 1], `g${A.o.id}:${i}`, A.friction, A.bounce));
    }
  }

  wallContacts(A, cs) {
    const W = this.water;
    const lo = [W.min[0], W.min[1]], hi = [W.min[0] + W.nx * W.cell, W.min[1] + W.nz * W.cell];
    if (A.pos[0] < lo[0] || A.pos[0] > hi[0] || A.pos[2] < lo[1] || A.pos[2] > hi[1]) return;
    const wp = A.wp, n = A.samples.length;
    for (const [axis, at, dir] of [[0, lo[0], 1], [0, hi[0], -1], [2, lo[1], 1], [2, hi[1], -1]]) {
      if ((A.pos[axis] - at) * dir > A.radius + MARGIN) continue;
      const found = [];
      for (let i = 0; i < n; i++) if ((wp[i * 3 + axis] - at) * dir < MARGIN) found.push(i);
      found.sort((a, b) => (wp[a * 3 + axis] - at) * dir - (wp[b * 3 + axis] - at) * dir);
      for (const i of found.slice(0, 12)) {
        const depth = -(wp[i * 3 + axis] - at) * dir;
        cs.push(this.contact(A, null, wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2], axis === 0 ? dir : 0, 0, axis === 2 ? dir : 0,
          depth, `w${A.o.id}:${axis}${dir}:${i}`, A.friction * 0.3, A.bounce));
      }
    }
  }

  pointsInto(A, B, cs) {
    const model = B.o.model ? this.scene.models.get(B.o.model) : null;
    const a = B.ax, P = B.pos, S = B.o.size, wp = A.wp, n = A.samples.length;
    const lx = S[0] * 1.3 + MARGIN, ly = S[1] * 1.3 + MARGIN, lz = S[2] * 1.3 + MARGIN;
    const found = [];
    for (let i = 0; i < n; i++) {
      const px = wp[i * 3] - P[0], py = wp[i * 3 + 1] - P[1], pz = wp[i * 3 + 2] - P[2];
      const qx = px * a[0][0] + py * a[0][1] + pz * a[0][2];
      if (qx > lx || qx < -lx) continue;
      const qy = px * a[1][0] + py * a[1][1] + pz * a[1][2];
      if (qy > ly || qy < -ly) continue;
      const qz = px * a[2][0] + py * a[2][1] + pz * a[2][2];
      if (qz > lz || qz < -lz) continue;
      const d = shapeSdf(qx, qy, qz, B.o, model);
      if (d < MARGIN) found.push({ i, d, qx, qy, qz });
    }
    found.sort((x, y) => x.d - y.d);
    const mu = Math.sqrt(A.friction * B.friction), e = Math.max(A.bounce, B.bounce);
    for (const c of found.slice(0, 24)) {
      const ln = shapeNormal(c.qx, c.qy, c.qz, B.o, model);
      const nx = a[0][0] * ln[0] + a[1][0] * ln[1] + a[2][0] * ln[2];
      const ny = a[0][1] * ln[0] + a[1][1] * ln[1] + a[2][1] * ln[2];
      const nz = a[0][2] * ln[0] + a[1][2] * ln[1] + a[2][2] * ln[2];
      const i = c.i;
      cs.push(this.contact(A, B, wp[i * 3], wp[i * 3 + 1], wp[i * 3 + 2], nx, ny, nz, -c.d, `${A.o.id}>${B.o.id}:${i}`, mu, e));
    }
  }

  contact(A, B, px, py, pz, nx, ny, nz, depth, key, mu, e) {
    let tx, ty, tz;
    if (Math.abs(nx) < 0.9) { tx = 0; ty = nz; tz = -ny; } else { tx = -nz; ty = 0; tz = nx; }
    let tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const sx = ny * tz - nz * ty, sy = nz * tx - nx * tz, sz = nx * ty - ny * tx;
    const c = { A, B, key, mu, depth,
      rA: [px - A.pos[0], py - A.pos[1], pz - A.pos[2]],
      rB: B ? [px - B.pos[0], py - B.pos[1], pz - B.pos[2]] : null,
      dirs: [[nx, ny, nz], [tx, ty, tz], [sx, sy, sz]],
      angA: [], angB: [], k: [], j: [0, 0, 0] };
    for (let d = 0; d < 3; d++) {
      const dir = c.dirs[d];
      let m = A.invMass + (B ? B.invMass : 0);
      const ra = cross(c.rA, dir), ia = A.applyInvI(ra);
      c.angA.push(ia);
      m += dot(cross(ia, c.rA), dir);
      if (B) {
        const rb = cross(c.rB, dir), ib = B.applyInvI(rb);
        c.angB.push(ib);
        m += dot(cross(ib, c.rB), dir);
      }
      c.k.push(m > 1e-12 ? 1 / m : 0);
    }
    const vn = this.relVel(c, 0);
    if (vn < -0.15) {
      if (A.asleep && A.dynamic) A.wake();
      if (B && B.asleep && B.dynamic) B.wake();
    }
    const into = (A.v[0] - (B ? B.v[0] : 0)) * nx + (A.v[1] - (B ? B.v[1] : 0)) * ny + (A.v[2] - (B ? B.v[2] : 0)) * nz;
    c.bounce = vn < -1 && into < -1 ? -e * vn : 0;
    return c;
  }

  relVel(c, d) {
    const A = c.A, B = c.B, r = c.rA, n = c.dirs[d];
    let vx = A.v[0] + A.w[1] * r[2] - A.w[2] * r[1];
    let vy = A.v[1] + A.w[2] * r[0] - A.w[0] * r[2];
    let vz = A.v[2] + A.w[0] * r[1] - A.w[1] * r[0];
    if (B) {
      const q = c.rB;
      vx -= B.v[0] + B.w[1] * q[2] - B.w[2] * q[1];
      vy -= B.v[1] + B.w[2] * q[0] - B.w[0] * q[2];
      vz -= B.v[2] + B.w[0] * q[1] - B.w[1] * q[0];
    }
    return vx * n[0] + vy * n[1] + vz * n[2];
  }

  push(c, d, j) {
    const A = c.A, B = c.B, n = c.dirs[d];
    if (A.free) {
      const im = j / A.mass, an = c.angA[d];
      A.v[0] += n[0] * im; A.v[1] += n[1] * im; A.v[2] += n[2] * im;
      A.w[0] += an[0] * j; A.w[1] += an[1] * j; A.w[2] += an[2] * j;
    }
    if (B && B.free) {
      const im = j / B.mass, an = c.angB[d];
      B.v[0] -= n[0] * im; B.v[1] -= n[1] * im; B.v[2] -= n[2] * im;
      B.w[0] -= an[0] * j; B.w[1] -= an[1] * j; B.w[2] -= an[2] * j;
    }
  }

  solve(cs, h) {
    for (const c of cs) {
      const w = this.warm.get(c.key);
      if (!w) continue;
      for (let d = 0; d < 3; d++) { c.j[d] = w[d] * 0.9; this.push(c, d, c.j[d]); }
    }
    for (let it = 0; it < ITER; it++) {
      for (const c of cs) {
        const vn = this.relVel(c, 0);
        const bias = c.depth > SLOP ? BETA / h * (c.depth - SLOP) : c.depth < 0 ? c.depth / h : 0;
        const goal = c.bounce > 0 ? Math.max(c.bounce, bias) : bias;
        const jn = Math.max(c.j[0] + c.k[0] * (goal - vn), 0);
        this.push(c, 0, jn - c.j[0]);
        c.j[0] = jn;
        const maxF = c.mu * jn;
        for (let d = 1; d < 3; d++) {
          const jt = Math.max(-maxF, Math.min(maxF, c.j[d] - c.k[d] * this.relVel(c, d)));
          this.push(c, d, jt - c.j[d]);
          c.j[d] = jt;
        }
      }
    }
    this.warm = new Map(cs.map(c => [c.key, c.j]));
  }

  putBack(scene) {
    for (const o of scene.objects) {
      if (!o.moves || !o.home) continue;
      o.pos = [...o.home.pos];
      o.rot = [...o.home.rot];
      const b = this.bodies.get(o.id);
      if (b) { b.fromObject(); b.v = [0, 0, 0]; b.w = [0, 0, 0]; b.wake(); }
      o.vel = [0, 0, 0]; o.spin = [0, 0, 0];
    }
  }

  massOf(o) { const b = this.bodies.get(o.id); return b ? { mass: b.mass, volume: b.volume } : null; }
}

export { quatFromEuler, axesOf, eulerOf };
