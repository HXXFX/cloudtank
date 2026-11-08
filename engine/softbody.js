import { softValue, isSolid, isBalloon } from './softpresets.js';
import { surfaceOf, refine, collapseShort, orient, areaOf, volumeOf, shellJoints, coarseLevels, latticeTets, solidJoints, carryInTets, carryOnSurface, drawnOf } from './softmesh.js';
import { shapeSdf, shapeNormal } from './sdf.js';
import { eulerAxes } from './math.js';

const G_DEFAULT = 9.81;
const AIR = 1.2, WATER = 1000, HELIUM = 0.17;
const P_ATM = 101325;
const SHEET_THICK = 0.0005;
const SLEEP_MEAN = 0.01, SLEEP_MAX = 0.06, SLEEP_AFTER = 1;
const MAX_SPEED = 40;
export const MAX_POINTS = 30000;

export const softOn = o => !!(o && o.soft && o.soft.on !== false);

const AUTO_POINTS = 2500, AUTO_TETS = 2600;
const NET_SHARE = 0.25;
const TURNS_MOST = 24;


export class SoftBody {
  constructor(o, scene) {
    this.o = o;
    this.buildKey = keyOf(o);
    this.build(scene);
    this.restart();
  }

  build(scene) {
    const o = this.o, s = o.soft, kind = softValue(s, 'kind');
    const model = o.model ? scene.models.get(o.model) : null;
    const mesh = o.shape === 'plane' ? null : scene.meshOf(o);
    const S = surfaceOf(o, mesh, model ? model.uvs : null, model ? model.parts : null);
    const area0 = Math.max(areaOf(S.v, S.t), 1e-6);
    const ask = softValue(s, 'cell') / 100;
    orient(S);
    this.kind = kind;
    let v, t;
    if (kind === 'solid') {
      const vol0 = S.closed ? Math.max(volumeOf(S.v, S.t), 1e-6) : 8 * o.size[0] * o.size[1] * o.size[2] * 0.5;
      const h = ask > 0 ? ask : Math.cbrt(12 * vol0 / AUTO_TETS);
      const L = latticeTets(o, model, h, 30000);
      if (!L.tets.length) { this.failed = 'It is too thin to fill: use Cloth.'; }
      const J = solidJoints(L.v, L.tets);
      this.J = J; this.tets = L.tets; v = L.v; t = J.skinT;
      this.cell = L.cell;
      refine(S, Math.max(L.cell * 0.75, Math.sqrt(area0 / 40000)));
      this.closed = true;
      const rv = S.v;
      const carried = carryInTets(rv, L.v, L.tets, L.cell);
      this.skinTet = carried;
      this.R = S;
      this.drawn = drawnOf(S, model ? model.parts : null);
      this.nR = rv.length / 3;
    } else {
      const h = Math.max(ask > 0 ? ask : Math.sqrt(2.3 * area0 / AUTO_POINTS), Math.sqrt(area0 / 40000));
      refine(S, h);
      orient(S);
      this.cell = h;
      let R = S;
      if (R.t.length / 3 > 60000) R = collapseShort(R, Math.sqrt(2.3 * area0 / 30000));
      const Sim = collapseShort(R, h * 0.5);
      orient(Sim);
      this.closed = Sim.closed;
      this.openEdges = Sim.openEdges;
      this.R = R;
      this.drawn = drawnOf(R, model ? model.parts : null);
      this.nR = R.v.length / 3;
      v = Float64Array.from(Sim.v);
      t = Sim.t;
      this.J = shellJoints(Sim.v, Sim.t);
      if (Sim.v.length !== R.v.length) this.skinTri = carryOnSurface(R.v, Sim.v, Sim.t, h);
      else this.direct = Sim.from;
    }
    const n = v.length / 3;
    if (n > MAX_POINTS) this.failed = `It would take ${n} points: make its cells bigger.`;
    this.n = n;
    this.r = v;
    this.x = new Float64Array(n * 3);
    this.xp = new Float64Array(n * 3);
    this.vel = new Float64Array(n * 3);
    this.acc = new Float64Array(n * 3);
    this.w = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.pinned = new Uint8Array(n);
    this.tri = Int32Array.from(t);
    this.nT = t.length / 3;
    const on = new Uint8Array(n);
    for (const p of t) on[p] = 1;
    this.surf = Int32Array.from(Array.from({ length: n }, (_, i) => i).filter(i => on[i]));
    {
      const seen = new Set(), ea = [], eb = [];
      const nn = n + 1;
      for (let f = 0; f < t.length; f += 3) for (let k = 0; k < 3; k++) {
        const a = t[f + k], c = t[f + (k + 1) % 3], key = a < c ? a * nn + c : c * nn + a;
        if (!seen.has(key)) { seen.add(key); ea.push(a); eb.push(c); }
      }
      this.midA = Int32Array.from(ea); this.midB = Int32Array.from(eb);
    }
    this.volume0 = this.closed ? volumeOf(v, t) : 0;
    this.area0 = areaOf(v, t);
    let sum = 0, cnt = 0;
    for (let f = 0; f < this.nT; f++) { const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3; sum += Math.sqrt((v[a] - v[b]) ** 2 + (v[a + 1] - v[b + 1]) ** 2 + (v[a + 2] - v[b + 2]) ** 2); cnt++; }
    this.meanEdge = cnt ? sum / cnt : 0.03;
    this.rx = new Float64Array(this.nR * 3);
    this.drawData = new Float32Array(this.drawn.corners * 6);
    this.setN = new Float64Array(this.drawn.nSets * 3);
    this.drawDirty = true;
    this.paramKey = '';
    this.near = [];
    this.contacts = { count: 0, i: new Int32Array(n * 2 + 16), n: new Float64Array((n * 2 + 16) * 3), vs: new Float64Array((n * 2 + 16) * 3), vn0: new Float64Array(n * 2 + 16) };
    this.field = null;
  }

  restart() {
    const o = this.o, ax = eulerAxes((o.home || o).rot), P = (o.home || o).pos, r = this.r, x = this.x;
    for (let i = 0; i < this.n; i++) {
      const a = r[i * 3], b = r[i * 3 + 1], c = r[i * 3 + 2];
      x[i * 3] = P[0] + ax[0][0] * a + ax[1][0] * b + ax[2][0] * c;
      x[i * 3 + 1] = P[1] + ax[0][1] * a + ax[1][1] * b + ax[2][1] * c;
      x[i * 3 + 2] = P[2] + ax[0][2] * a + ax[1][2] * b + ax[2][2] * c;
    }
    this.xp.set(x);
    this.vel.fill(0);
    this.acc.fill(0);
    this.t = 0;
    this.growNow = 1;
    this.airNow = 1;
    this.asleep = false;
    this.stillFor = 0;
    if (o.home) { o.pos = [...o.home.pos]; o.rot = [...o.home.rot]; }
    this.frameP = [...(o.home || o).pos];
    this.frameRot = [...(o.home || o).rot];
    this.written = { pos: [...o.pos], rot: [...o.rot] };
    this.homeSeen = JSON.stringify(o.home || null);
    this.centre0 = this.centroid();
    this.posAt0 = null;
    this.growBase = undefined; this.airBase = undefined;
    this.pressureNow = 0;
    this.volumeNow = this.volume0;
    this.paramKey = '';
    this.applyParams();
    this.drawDirty = true;
  }

  centroid() {
    let mx = 0, my = 0, mz = 0;
    const x = this.x, n = this.n;
    for (let i = 0; i < n; i++) { mx += x[i * 3]; my += x[i * 3 + 1]; mz += x[i * 3 + 2]; }
    return [mx / Math.max(n, 1), my / Math.max(n, 1), mz / Math.max(n, 1)];
  }

  applyParams() {
    const o = this.o, s = o.soft, key = JSON.stringify(s) + '|' + (o.massKg || 0);
    if (key === this.paramKey) return;
    const first = !this.paramKey;
    this.paramKey = key;
    const V = this.n;
    this.P = {
      stretch: Math.max(softValue(s, 'stretch'), 1e-3), compress: Math.max(softValue(s, 'compress'), 1e-3), shear: Math.max(softValue(s, 'shear'), 1e-3),
      bend: softValue(s, 'bend'), young: Math.max(softValue(s, 'young'), 1), poisson: Math.min(Math.max(softValue(s, 'poisson'), 0), 0.49),
      air: Math.max(softValue(s, 'air'), 0), gas: softValue(s, 'gas'), pressure: softValue(s, 'pressure'), grow: Math.max(softValue(s, 'grow'), 0.05), over: Math.max(softValue(s, 'over'), 0),
      damp: Math.max(softValue(s, 'damp'), 0), drag: softValue(s, 'drag'), lift: softValue(s, 'lift'),
      thick: Math.max(softValue(s, 'thick') / 100, 0.0005), grip: Math.max(softValue(s, 'grip'), 0), bounce: softValue(s, 'bounce'),
      self: softValue(s, 'self') !== false && this.kind !== 'solid',
      selfGap: softValue(s, 'selfGap') > 0 ? softValue(s, 'selfGap') / 100 : Math.max(this.meanEdge * 0.75, softValue(s, 'thick') / 100 * 2),
      steps: Math.max(1, Math.round(softValue(s, 'steps'))), tether: softValue(s, 'tether') !== false,
      holdsAir: isBalloon(s) && this.closed,
    };
    const P = this.P;
    const m = this.mass;
    m.fill(0);
    if (this.kind === 'solid') {
      const d = softValue(s, 'density'), vv = this.J.vVol;
      for (let i = 0; i < V; i++) m[i] = vv[i] * d;
      this.total = 0; for (let i = 0; i < V; i++) this.total += m[i];
    } else {
      const d = softValue(s, 'sheet'), aa = this.J.vArea;
      for (let i = 0; i < V; i++) m[i] = aa[i] * d;
      this.total = 0; for (let i = 0; i < V; i++) this.total += m[i];
    }
    if (o.massKg > 0 && this.total > 0) { const k = o.massKg / this.total; for (let i = 0; i < V; i++) m[i] *= k; this.total = o.massKg; }
    for (let i = 0; i < V; i++) if (!(m[i] > 0)) m[i] = 1e-6;
    this.meanMass = this.total / Math.max(V, 1);
    if (this.kind !== 'solid') {
      const J = this.J;
      if (!this.eT) { this.eT = new Float64Array(J.nE); this.eC = new Float64Array(J.nE); this.eLnow = new Float64Array(J.nE); }
      const nets = P.holdsAir ? 0 : 2, share = 1 - NET_SHARE * nets * 0.5;
      this.netK = P.stretch * NET_SHARE;
      this.netGam = Math.min(P.damp * 1.5, 8);
      for (let e = 0; e < J.nE; e++) {
        const w = Math.max(J.eW[e], 1e-6);
        this.eT[e] = 1 / ((J.eLong[e] ? P.shear : P.stretch * share) * w);
        this.eC[e] = 1 / (Math.min(J.eLong[e] ? P.shear : P.stretch, P.compress) * w);
      }
      this.hB = P.bend > 0 ? 1 / P.bend : -1;
      this.skinK = 0;
      for (let e = 0; e < J.nE; e++) this.skinK += J.eL[e] * J.eL[e] / this.eT[e];
      const L = Math.sqrt(this.area0), rho = this.total / Math.max(this.area0, 1e-9);
      const wE = Math.PI / (2 * L) * Math.sqrt(P.stretch / rho), wB = 3.516 / (L * L) * Math.sqrt(Math.max(P.bend, 1e-9) / rho);
      this.tauE = 2 * P.damp / (wE * wE);
      this.tauB = 2 * P.damp / (wB * wB);
    } else {
      const nu = P.poisson, E = P.young;
      this.mu = E / (2 * (1 + nu));
      this.bulk = E / (3 * (1 - 2 * nu));
      const L = Math.cbrt(Math.max(this.volume0, 1e-9)), rho = this.total / Math.max(this.volume0, 1e-9), wE = Math.PI / (2 * L) * Math.sqrt(E / rho);
      this.tauT = 2 * P.damp / (wE * wE);
    }
    this.pinsFrom(s);
    if (first) { this.growNow = 1; this.airNow = 1; }
    this.asleep = false;
  }

  pinsFrom(s) {
    const n = this.n, r = this.r, o = this.o, pinned = this.pinned;
    pinned.fill(0);
    const ax = eulerAxes((o.home || o).rot);
    const world = i => [ax[0][0] * r[i * 3] + ax[1][0] * r[i * 3 + 1] + ax[2][0] * r[i * 3 + 2], ax[0][1] * r[i * 3] + ax[1][1] * r[i * 3 + 1] + ax[2][1] * r[i * 3 + 2], ax[0][2] * r[i * 3] + ax[1][2] * r[i * 3 + 1] + ax[2][2] * r[i * 3 + 2]];
    const how = softValue(s, 'pin');
    if (how !== 'none' && n) {
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      const W = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) { const p = world(i); W.set(p, i * 3); for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; } }
      const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], big = Math.max(...ext);
      const upright = ext[1] > big * 0.2;
      const up = upright ? [0, 1, 0] : ext[2] >= ext[0] ? [0, 0, -1] : [-1, 0, 0];
      const across = upright ? (ext[0] >= ext[2] ? [1, 0, 0] : [0, 0, 1]) : ext[2] >= ext[0] ? [1, 0, 0] : [0, 0, 1];
      const dot3 = (i, d) => W[i * 3] * d[0] + W[i * 3 + 1] * d[1] + W[i * 3 + 2] * d[2];
      let top = -1e9, loA = 1e9, hiA = -1e9;
      for (let i = 0; i < n; i++) { top = Math.max(top, dot3(i, up)); const a = dot3(i, across); loA = Math.min(loA, a); hiA = Math.max(hiA, a); }
      const band = Math.max(this.meanEdge * 0.75, 1e-4);
      if (how === 'edge') { for (let i = 0; i < n; i++) if (dot3(i, up) > top - band) pinned[i] = 1; }
      else if (how === 'two' || how === 'four') {
        const best = (fn) => { let b = -1, bv = -1e18; for (let i = 0; i < n; i++) { const q = fn(i); if (q > bv) { bv = q; b = i; } } return b; };
        const pick = (u, a) => best(i => dot3(i, up) * u + dot3(i, across) * a);
        pinned[pick(1, 1)] = 1; pinned[pick(1, -1)] = 1;
        if (how === 'four') { pinned[pick(-1, 1)] = 1; pinned[pick(-1, -1)] = 1; }
      } else if (how === 'middle') {
        let b = 0, bd = 1e18;
        const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        for (let i = 0; i < n; i++) { const d = (W[i * 3] - c[0]) ** 2 + (W[i * 3 + 1] - c[1]) ** 2 + (W[i * 3 + 2] - c[2]) ** 2; if (d < bd) { bd = d; b = i; } }
        pinned[b] = 1;
      }
    }
    const at = softValue(s, 'pinAt');
    if (at) for (const q of at) {
      const px = q[0] * o.size[0], py = q[1] * o.size[1], pz = q[2] * o.size[2];
      let b = -1, bd = 1e18;
      for (let i = 0; i < n; i++) { const d = (r[i * 3] - px) ** 2 + (r[i * 3 + 1] - py) ** 2 + (r[i * 3 + 2] - pz) ** 2; if (d < bd) { bd = d; b = i; } }
      if (b >= 0) pinned[b] = 1;
    }
    this.nPinned = 0;
    for (let i = 0; i < n; i++) if (pinned[i]) this.nPinned++;
    for (let i = 0; i < n; i++) this.w[i] = pinned[i] ? 0 : 1 / this.mass[i];
    this.pinKey = (how || '') + JSON.stringify(at || null);
    this.tethersFrom();
    this.levels = this.kind !== 'solid' && !this.P.holdsAir ? coarseLevels(this.r, this.J, pinned, this.mass) : null;
    if (this.levels) for (const L of this.levels) L.iM = Float64Array.from(L.M, (m, I) => (pinned[L.seeds[I]] ? 0 : 1 / Math.max(m, 1e-9)));
    this.pinList = Int32Array.from(Array.from({ length: n }, (_, i) => i).filter(i => pinned[i]));
  }

  tethersFrom() {
    if (this.kind === 'solid' || !this.nPinned) { this.tetherTo = null; return; }
    const n = this.n, J = this.J, head = new Int32Array(n).fill(-1), next = new Int32Array(J.nE * 2), to = new Int32Array(J.nE * 2), len = new Float64Array(J.nE * 2);
    for (let e = 0; e < J.nE; e++) {
      to[e * 2] = J.ej[e]; len[e * 2] = J.eL[e]; next[e * 2] = head[J.ei[e]]; head[J.ei[e]] = e * 2;
      to[e * 2 + 1] = J.ei[e]; len[e * 2 + 1] = J.eL[e]; next[e * 2 + 1] = head[J.ej[e]]; head[J.ej[e]] = e * 2 + 1;
    }
    const dist = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
    const r = this.r, t = this.tri, nT = this.nT, tHead = new Int32Array(n).fill(-1), tNext = new Int32Array(nT * 3);
    for (let s = 0; s < nT * 3; s++) { tNext[s] = tHead[t[s]]; tHead[t[s]] = s; }
    const across = (a, b, c) => {
      const a3 = a * 3, ux = r[b * 3] - r[a3], uy = r[b * 3 + 1] - r[a3 + 1], uz = r[b * 3 + 2] - r[a3 + 2], l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (l < 1e-12) return Infinity;
      const vx = r[c * 3] - r[a3], vy = r[c * 3 + 1] - r[a3 + 1], vz = r[c * 3 + 2] - r[a3 + 2];
      const cx = (vx * ux + vy * uy + vz * uz) / l, cy2 = vx * vx + vy * vy + vz * vz - cx * cx;
      const dA = dist[a], dB = dist[b], sx = (dA * dA - dB * dB + l * l) / (2 * l), sy2 = dA * dA - sx * sx;
      if (cy2 <= 0 || sy2 < 0) return Infinity;
      const cy = Math.sqrt(cy2), sy = -Math.sqrt(sy2), cross = sx + (-sy / (cy - sy)) * (cx - sx);
      return cross < 0 || cross > l ? Infinity : Math.sqrt((cx - sx) * (cx - sx) + (cy - sy) * (cy - sy));
    };
    const q = [];
    const offer = (c, d, src) => { if (d < dist[c] * (1 - 1e-9) - 1e-12) { dist[c] = d; from[c] = src; q.push(c); } };
    for (let i = 0; i < n; i++) if (this.pinned[i]) { dist[i] = 0; from[i] = i; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const a = q[k], src = from[a];
      for (let e = head[a]; e >= 0; e = next[e]) offer(to[e], dist[a] + len[e], src);
      for (let s = tHead[a]; s >= 0; s = tNext[s]) {
        const f = s - s % 3, b = t[f + (s % 3 + 1) % 3], c = t[f + (s % 3 + 2) % 3];
        if (from[b] === src && dist[b] < Infinity) offer(c, across(a, b, c), src);
        if (from[c] === src && dist[c] < Infinity) offer(b, across(a, c, b), src);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = from[i];
      if (j >= 0) dist[i] = Math.max(dist[i], Math.hypot(r[i * 3] - r[j * 3], r[i * 3 + 1] - r[j * 3 + 1], r[i * 3 + 2] - r[j * 3 + 2]));
    }
    this.tetherTo = from; this.tetherL = dist;
  }

  easeTowards(dt) {
    const P = this.P;
    const rate = P.over > 0 ? dt / P.over : 1;
    const mv = (now, want, base) => { const d = want - now, stp = Math.abs(want - base || 1) * rate; return Math.abs(d) <= stp || P.over <= 0 ? want : now + Math.sign(d) * stp; };
    if (this.growBase === undefined || this.growWant !== P.grow) { this.growBase = this.growNow; this.growWant = P.grow; }
    if (this.airBase === undefined || this.airWant !== P.air) { this.airBase = this.airNow; this.airWant = P.air; }
    this.growNow = mv(this.growNow, P.grow, this.growBase);
    this.airNow = mv(this.airNow, P.air, this.airBase);
  }

  updateDraw() {
    const D = this.drawn, x = this.x, rx = this.rx, nR = this.nR;
    if (this.skinTet) {
      const { tetOf, tetW } = this.skinTet, tx = this.J.tx;
      const tets = this.tets;
      for (let i = 0; i < nR; i++) {
        const q = tets[tetOf[i]], a = q[0] * 3, b = q[1] * 3, c = q[2] * 3, d = q[3] * 3, w0 = tetW[i * 4], w1 = tetW[i * 4 + 1], w2 = tetW[i * 4 + 2], w3 = tetW[i * 4 + 3];
        rx[i * 3] = w0 * x[a] + w1 * x[b] + w2 * x[c] + w3 * x[d];
        rx[i * 3 + 1] = w0 * x[a + 1] + w1 * x[b + 1] + w2 * x[c + 1] + w3 * x[d + 1];
        rx[i * 3 + 2] = w0 * x[a + 2] + w1 * x[b + 2] + w2 * x[c + 2] + w3 * x[d + 2];
      }
    } else if (this.skinTri) {
      const { triOf, triW, triD } = this.skinTri, t = this.tri;
      for (let i = 0; i < nR; i++) {
        const f = triOf[i] * 3, a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3, w0 = triW[i * 3], w1 = triW[i * 3 + 1], w2 = triW[i * 3 + 2], dd = triD[i];
        let nx = 0, ny = 0, nz = 0;
        if (dd !== 0) {
          const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2], vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
          nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
          const l = dd / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1); nx *= l; ny *= l; nz *= l;
        }
        rx[i * 3] = w0 * x[a] + w1 * x[b] + w2 * x[c] + nx;
        rx[i * 3 + 1] = w0 * x[a + 1] + w1 * x[b + 1] + w2 * x[c + 1] + ny;
        rx[i * 3 + 2] = w0 * x[a + 2] + w1 * x[b + 2] + w2 * x[c + 2] + nz;
      }
    } else if (this.direct) {
      const from = this.direct;
      for (let i = 0; i < nR; i++) { const p = from[i] * 3; rx[i * 3] = x[p]; rx[i * 3 + 1] = x[p + 1]; rx[i * 3 + 2] = x[p + 2]; }
    }
    const setN = this.setN.fill(0), vid = D.vid, setId = D.setId, corners = D.corners;
    for (let c = 0; c < corners; c += 3) {
      const a = vid[c] * 3, b = vid[c + 1] * 3, d = vid[c + 2] * 3;
      const ux = rx[b] - rx[a], uy = rx[b + 1] - rx[a + 1], uz = rx[b + 2] - rx[a + 2], vx = rx[d] - rx[a], vy = rx[d + 1] - rx[a + 1], vz = rx[d + 2] - rx[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) { const q = setId[c + k] * 3; setN[q] += nx; setN[q + 1] += ny; setN[q + 2] += nz; }
    }
    const O = this.o, A = eulerAxes((O.home || O).rot), S = O.size;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < nR; i++) { mx += rx[i * 3]; my += rx[i * 3 + 1]; mz += rx[i * 3 + 2]; }
    mx /= Math.max(nR, 1); my /= Math.max(nR, 1); mz /= Math.max(nR, 1);
    this.drawRecord = { pos: [mx, my, mz], size: S, rot: (O.home || O).rot, color: O.color };
    const a00 = A[0][0], a01 = A[0][1], a02 = A[0][2], a10 = A[1][0], a11 = A[1][1], a12 = A[1][2], a20 = A[2][0], a21 = A[2][1], a22 = A[2][2], isx = 1 / S[0], isy = 1 / S[1], isz = 1 / S[2], sx = S[0], sy = S[1], sz = S[2];
    const out = this.drawData;
    for (let c = 0; c < corners; c++) {
      const p = vid[c] * 3, q = setId[c] * 3, nx = setN[q], ny = setN[q + 1], nz = setN[q + 2], l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1), o = c * 6;
      const X = rx[p] - mx, Y = rx[p + 1] - my, Z = rx[p + 2] - mz;
      out[o] = (X * a00 + Y * a01 + Z * a02) * isx; out[o + 1] = (X * a10 + Y * a11 + Z * a12) * isy; out[o + 2] = (X * a20 + Y * a21 + Z * a22) * isz;
      out[o + 3] = (nx * a00 + ny * a01 + nz * a02) * l * sx; out[o + 4] = (nx * a10 + ny * a11 + nz * a12) * l * sy; out[o + 5] = (nx * a20 + ny * a21 + nz * a22) * l * sz;
    }
    this.drawDirty = false;
    this.drawStamp = (this.drawStamp || 0) + 1;
  }

  rayHit(origin, dir) {
    if (this.drawDirty) this.updateDraw();
    const d = this.rx, D = this.drawn, vid = D.vid;
    let best = null, tri = -1, bu = 0, bv = 0;
    for (let c = 0; c < D.corners; c += 3) {
      const a = vid[c] * 3, b = vid[c + 1] * 3, e = vid[c + 2] * 3;
      const e1x = d[b] - d[a], e1y = d[b + 1] - d[a + 1], e1z = d[b + 2] - d[a + 2], e2x = d[e] - d[a], e2y = d[e + 1] - d[a + 1], e2z = d[e + 2] - d[a + 2];
      const px = dir[1] * e2z - dir[2] * e2y, py = dir[2] * e2x - dir[0] * e2z, pz = dir[0] * e2y - dir[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = origin[0] - d[a], ty = origin[1] - d[a + 1], tz = origin[2] - d[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-5 && (best === null || t < best)) { best = t; tri = c; bu = u; bv = v; }
    }
    if (best === null) return null;
    const lp = D.lp, w = 1 - bu - bv;
    const local = [0, 1, 2].map(k => w * lp[tri * 3 + k] + bu * lp[(tri + 1) * 3 + k] + bv * lp[(tri + 2) * 3 + k]);
    let part = -1;
    if (D.parts) part = D.parts.findIndex(p => tri >= p.first && tri < p.first + p.count);
    return { t: best, point: [origin[0] + dir[0] * best, origin[1] + dir[1] * best, origin[2] + dir[2] * best], local, part, corner: tri };
  }

  nearestPoint(p) {
    let b = -1, bd = 1e18;
    const x = this.x;
    for (let i = 0; i < this.n; i++) { const d = (x[i * 3] - p[0]) ** 2 + (x[i * 3 + 1] - p[1]) ** 2 + (x[i * 3 + 2] - p[2]) ** 2; if (d < bd) { bd = d; b = i; } }
    return b;
  }

  reading() {
    let mxs = 0;
    const vv = this.vel;
    for (let i = 0; i < this.n; i++) { const s = vv[i * 3] ** 2 + vv[i * 3 + 1] ** 2 + vv[i * 3 + 2] ** 2; if (s > mxs) mxs = s; }
    return { points: this.n, joints: this.kind === 'solid' ? this.J.nT : this.J.nE + this.J.nH, triangles: this.nT, mass: this.total, closed: !!this.closed, cell: this.cell, volume: this.closed ? volumeOf(this.x, this.tri) : 0, volume0: this.volume0, pressure: this.pressureNow, maxSpeed: Math.sqrt(mxs), asleep: this.asleep, area: areaOf(this.x, this.tri), area0: this.area0 };
  }
}

export function keyOf(o) {
  const s = o.soft;
  return [softValue(s, 'kind'), o.shape, o.model || '', o.size.map(v => v.toFixed(5)).join(','), softValue(s, 'cell')].join('|');
}


export class SoftWorld {
  constructor() {
    this.bodies = new Map();
    this.stats = { bodies: 0, points: 0, ms: 0, contacts: 0, pairs: 0, steps: 0, awake: 0 };
    this.gravity = G_DEFAULT;
    this.pairs = new Int32Array(1 << 14);
    this.nPairs = 0;
    this.grabs = [];
  }

  get any() { return this.bodies.size > 0; }

  sync(scene, running = true) {
    const ids = new Set();
    for (const o of scene.objects) {
      if (!softOn(o)) continue;
      ids.add(o.id);
      let b = this.bodies.get(o.id);
      const key = keyOf(o);
      if (o.model && !(scene.models.get(o.model) || {}).ready && softValue(o.soft, 'kind') === 'solid') continue;
      if (!b || b.buildKey !== key) {
        const now = performance.now();
        if (b && o.held && now - (b.builtAt || 0) < 150) continue;
        if (b && o.home) { const w = b.written; o.home.pos = o.home.pos.map((v, k) => v + o.pos[k] - w.pos[k]); o.home.rot = [...o.rot]; }
        const had = b;
        if (had) had.released = true;
        b = new SoftBody(o, scene);
        b.builtAt = now;
        b.fieldSlot = had ? had.fieldSlot : undefined;
        this.bodies.set(o.id, b);
        this.changed = true;
        continue;
      }
      if (b.o !== o) {
        b.o = o;
        const hs = JSON.stringify(o.home || null);
        if (hs !== b.homeSeen) { b.restart(); }
        else { b.written = { pos: [...o.pos], rot: [...o.rot] }; b.frameP = [...o.pos]; b.frameRot = [...o.rot]; }
      }
      b.applyParams();
      const pk = softValue(o.soft, 'pin') + JSON.stringify(softValue(o.soft, 'pinAt') || null);
      if (pk !== b.pinKey) b.pinsFrom(o.soft);
      const w = b.written, moved = o.pos.some((v, k) => Math.abs(v - w.pos[k]) > 1e-9), turned = o.rot.some((v, k) => Math.abs(v - w.rot[k]) > 1e-9);
      if (moved || turned) this.movedByHand(b, running);
    }
    for (const [id, b] of this.bodies) if (!ids.has(id)) { b.released = true; this.bodies.delete(id); this.changed = true; }
  }

  movedByHand(b, running) {
    const o = b.o, w = b.written;
    const d = [o.pos[0] - w.pos[0], o.pos[1] - w.pos[1], o.pos[2] - w.pos[2]];
    const A0 = eulerAxes(w.rot), A1 = eulerAxes(o.rot);
    const turned = o.rot.some((v, k) => Math.abs(v - w.rot[k]) > 1e-9);
    if (o.home) { o.home.pos = o.home.pos.map((v, k) => v + d[k]); if (turned) o.home.rot = [...o.rot]; b.homeSeen = JSON.stringify(o.home); }
    b.frameP = [...o.pos]; b.frameRot = [...o.rot];
    b.asleep = false; b.stillFor = 0;
    if (b.nPinned && running) {
      w.pos = [...o.pos]; w.rot = [...o.rot];
      return;
    }
    const x = b.x, xp = b.xp, n = b.n;
    if (turned) {
      for (let i = 0; i < n; i++) {
        const px = x[i * 3] - w.pos[0], py = x[i * 3 + 1] - w.pos[1], pz = x[i * 3 + 2] - w.pos[2];
        const lx = A0[0][0] * px + A0[0][1] * py + A0[0][2] * pz, ly = A0[1][0] * px + A0[1][1] * py + A0[1][2] * pz, lz = A0[2][0] * px + A0[2][1] * py + A0[2][2] * pz;
        x[i * 3] = o.pos[0] + A1[0][0] * lx + A1[1][0] * ly + A1[2][0] * lz;
        x[i * 3 + 1] = o.pos[1] + A1[0][1] * lx + A1[1][1] * ly + A1[2][1] * lz;
        x[i * 3 + 2] = o.pos[2] + A1[0][2] * lx + A1[1][2] * ly + A1[2][2] * lz;
      }
    } else for (let i = 0; i < n; i++) { x[i * 3] += d[0]; x[i * 3 + 1] += d[1]; x[i * 3 + 2] += d[2]; }
    xp.set(x);
    if (!o.held) b.vel.fill(0);
    w.pos = [...o.pos]; w.rot = [...o.rot];
    b.drawDirty = true;
    b.centre0 = b.centroid();
    b.posAt0 = [...o.pos];
  }

  restart() { for (const b of this.bodies.values()) { b.restart(); b.o.pos = [...b.o.home.pos]; b.o.rot = [...b.o.home.rot]; b.written = { pos: [...b.o.pos], rot: [...b.o.rot] }; b.posAt0 = null; } }
  clear() { for (const b of this.bodies.values()) b.released = true; this.bodies.clear(); this.changed = true; }

  stepsFor(dt) {
    let want = 1;
    for (const b of this.bodies.values()) if (!b.asleep) want = Math.max(want, b.P.steps);
    return Math.max(1, Math.ceil(want * dt * 60 - 1e-6));
  }

  begin(scene, dt, nSteps, wind, physics, windInfo) {
    this.t0 = performance.now();
    this.scene = scene; this.dt = dt; this.nSteps = nSteps; this.wind = wind; this.physics = physics; this.windInfo = windInfo || {};
    this.stepNo = 0;
    this.frameNo = (this.frameNo || 0) + 1;
    this.awake = [];
    this.contactCount = 0;
    for (const b of this.bodies.values()) {
      if (b.failed) continue;
      if (b.asleep) {
        let wake = !!wind || !!this.grabs.find(g => g.b === b) || (physics && physics.water && this.inWater(b));
        if (!wake) wake = this.movingNear(b, scene, physics);
        if (wake) { b.asleep = false; b.stillFor = 0; }
      }
      if (b.asleep) continue;
      if (b.o.held && !b.nPinned) { b.drawDirty = true; continue; }
      b.t += dt;
      b.easeTowards(dt);
      if (b.P.holdsAir) this.airBalance(b);
      this.awake.push(b);
      this.scaleRest(b);
      this.findNear(b, scene, physics, dt);
      if (b.nPinned) {
        const A = eulerAxes(b.frameRot), P = b.frameP, r = b.r;
        if (!b.pinFrom || b.pinFrom.length !== b.pinList.length * 3) { b.pinFrom = new Float64Array(b.pinList.length * 3); b.pinTo = new Float64Array(b.pinList.length * 3); }
        for (let k = 0; k < b.pinList.length; k++) {
          const i = b.pinList[k], a = r[i * 3], c = r[i * 3 + 1], e = r[i * 3 + 2];
          for (let q = 0; q < 3; q++) {
            b.pinFrom[k * 3 + q] = b.x[i * 3 + q];
            b.pinTo[k * 3 + q] = P[q] + A[0][q] * a + A[1][q] * c + A[2][q] * e;
          }
        }
      }
      b.grabList = this.grabs.filter(g => g.b === b);
    }
    this.findPairs();
    this.nSteps = Math.max(nSteps, this.stepsFor(dt));
    return this.nSteps;
  }

  inWater(b) { const W = this.physics && this.physics.water; if (!W) return false; const c = b.centroid(); const cx = Math.floor((c[0] - W.min[0]) / W.cell), cz = Math.floor((c[2] - W.min[1]) / W.cell); return cx >= 0 && cz >= 0 && cx < W.nx && cz < W.nz && W.level[cx + W.nx * cz] > 0; }

  movingNear(b, scene, physics) {
    if (!physics) return false;
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    const x = b.x;
    for (let i = 0; i < b.n; i++) for (let k = 0; k < 3; k++) { const q = x[i * 3 + k]; if (q < lo[k]) lo[k] = q; if (q > hi[k]) hi[k] = q; }
    for (const o of scene.objects) {
      if (o === b.o || softOn(o) || o.collides === false) continue;
      const rb = physics.bodies.get(o.id);
      const moving = rb ? (rb.free || !!o.held) : false;
      const speed = (o.vel ? Math.abs(o.vel[0]) + Math.abs(o.vel[1]) + Math.abs(o.vel[2]) : 0) + (o.spin ? Math.abs(o.spin[0]) + Math.abs(o.spin[1]) + Math.abs(o.spin[2]) : 0);
      if (!moving && speed < 1e-3) continue;
      const r = Math.sqrt(o.size[0] * o.size[0] + o.size[1] * o.size[1] + o.size[2] * o.size[2]) + 0.1;
      if (o.pos[0] + r > lo[0] && o.pos[0] - r < hi[0] && o.pos[1] + r > lo[1] && o.pos[1] - r < hi[1] && o.pos[2] + r > lo[2] && o.pos[2] - r < hi[2]) return true;
    }
    for (const c of this.bodies.values()) {
      if (c === b || c.asleep) continue;
      const q = c.centroid(), d = (q[0] - (lo[0] + hi[0]) / 2) ** 2 + (q[1] - (lo[1] + hi[1]) / 2) ** 2 + (q[2] - (lo[2] + hi[2]) / 2) ** 2;
      if (d < ((hi[0] - lo[0]) + (hi[1] - lo[1]) + (hi[2] - lo[2]) + 2) ** 2) return true;
    }
    return false;
  }

  scaleRest(b) {
    if (b.kind === 'solid') { b.restScale = b.growNow; return; }
    let g = b.growNow;
    if (b.P.holdsAir && b.airTarget) {
      const s = Math.cbrt(b.airTarget / Math.max(b.volume0 * g * g * g, 1e-9));
      if (s > 1) g *= 1 + (s - 1) * 0.6;
    }
    const eL = b.J.eL, L = b.eLnow;
    for (let e = 0; e < b.J.nE; e++) L[e] = eL[e] * g;
  }

  findNear(b, scene, physics, dt) {
    const near = b.near;
    near.length = 0;
    const x = b.x, n = b.n, surf = b.surf, thick = b.P.thick;
    if (b.o.collides === false) return;
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], vmax = 0;
    for (let c = 0; c < surf.length; c++) {
      const i = surf[c];
      for (let k = 0; k < 3; k++) { const q = x[i * 3 + k]; if (q < lo[k]) lo[k] = q; if (q > hi[k]) hi[k] = q; }
      const s = b.vel[i * 3] ** 2 + b.vel[i * 3 + 1] ** 2 + b.vel[i * 3 + 2] ** 2;
      if (s > vmax) vmax = s;
    }
    vmax = Math.sqrt(vmax);
    for (const o of scene.objects) {
      if (softOn(o) || o.collides === false) continue;
      if (o.model && !(scene.models.get(o.model) || {}).field) continue;
      const rb = physics ? physics.bodies.get(o.id) : null;
      const P = rb ? rb.pos : o.pos, ax = rb ? rb.ax : eulerAxes(o.rot);
      const speed = rb && rb.free ? Math.sqrt(rb.v[0] ** 2 + rb.v[1] ** 2 + rb.v[2] ** 2) : Math.sqrt((o.vel || [0, 0, 0]).reduce((a, q) => a + q * q, 0));
      const S = o.size, R = Math.sqrt(S[0] * S[0] + S[1] * S[1] + S[2] * S[2]);
      const margin = thick + 0.02 + (vmax + speed + 2) * dt;
      if (P[0] + R + margin < lo[0] || P[0] - R - margin > hi[0] || P[1] + R + margin < lo[1] || P[1] - R - margin > hi[1] || P[2] + R + margin < lo[2] || P[2] - R - margin > hi[2]) continue;
      const model = o.model ? scene.models.get(o.model) : null;
      const list = [], R2 = (R + margin) * (R + margin);
      const a00 = ax[0][0], a01 = ax[0][1], a02 = ax[0][2], a10 = ax[1][0], a11 = ax[1][1], a12 = ax[1][2], a20 = ax[2][0], a21 = ax[2][1], a22 = ax[2][2];
      const lx = S[0] * 1.2 + margin, ly = S[1] * 1.2 + margin, lz = S[2] * 1.2 + margin;
      for (let c = 0; c < surf.length; c++) {
        const i = surf[c];
        const px = x[i * 3] - P[0], py = x[i * 3 + 1] - P[1], pz = x[i * 3 + 2] - P[2];
        if (px * px + py * py + pz * pz > R2) continue;
        const qx = px * a00 + py * a01 + pz * a02;
        if (qx > lx || qx < -lx) continue;
        const qy = px * a10 + py * a11 + pz * a12;
        if (qy > ly || qy < -ly) continue;
        const qz = px * a20 + py * a21 + pz * a22;
        if (qz > lz || qz < -lz) continue;
        const d = shapeSdf(qx, qy, qz, o, model);
        if (d < margin) list.push(i);
      }
      let mids = null;
      if (list.length) {
        const isNear = b.nearMark || (b.nearMark = new Uint8Array(n));
        isNear.fill(0);
        for (const i of list) isNear[i] = 1;
        const out = [], A = b.midA, B = b.midB;
        for (let e = 0; e < A.length; e++) if (isNear[A[e]] && isNear[B[e]]) out.push(e);
        mids = Int32Array.from(out);
      }
      if (list.length) near.push({ o, rb, model, list: Int32Array.from(list), d: new Float64Array(list.length * 7).fill(1e9), mids, md: new Float64Array(mids.length * 7).fill(1e9), margin });
    }
  }

  findPairs() {
    const list = this.awake.filter(b => b.o.collides !== false);
    let fast = 0;
    for (const b of list) for (let c = 0; c < b.surf.length; c += 3) { const i = b.surf[c] * 3, s = b.vel[i] ** 2 + b.vel[i + 1] ** 2 + b.vel[i + 2] ** 2; if (s > fast) fast = s; }
    const key = list.map(b => b.o.id).join(',');
    if (this.frameNo % 2 === 1 && this.pairsKey === key && Math.sqrt(fast) < 0.4) return;
    this.pairsKey = key;
    this.nPairs = 0;
    const needSelf = list.some(b => b.P.self), asleepOthers = [...this.bodies.values()].filter(b => b.asleep && b.o.collides !== false);
    if (!needSelf && list.length + asleepOthers.length < 2) return;
    const all = [...list, ...(list.length ? asleepOthers : [])];
    let N = 0;
    for (const b of all) N += b.surf.length;
    if (!this.gx || this.gx.length < N * 3) { this.gx = new Float64Array(N * 3 + 300); this.gb = new Int32Array(N + 100); this.gi = new Int32Array(N + 100); this.gn = new Int32Array(N + 100); }
    const gx = this.gx, gb = this.gb, gi = this.gi;
    let gap = 0, vmax = 0, g = 0;
    all.forEach((b, bi) => {
      gap = Math.max(gap, b.P.selfGap);
      for (let c = 0; c < b.surf.length; c++) {
        const i = b.surf[c];
        gx[g * 3] = b.x[i * 3]; gx[g * 3 + 1] = b.x[i * 3 + 1]; gx[g * 3 + 2] = b.x[i * 3 + 2];
        gb[g] = bi; gi[g] = i; g++;
        const s = b.vel[i * 3] ** 2 + b.vel[i * 3 + 1] ** 2 + b.vel[i * 3 + 2] ** 2;
        if (s > vmax) vmax = s;
      }
    });
    this.pairBodies = all;
    const reach = gap + Math.min(Math.sqrt(vmax), 1.5) * this.dt * 3 + 0.002;
    const cell = reach, table = (N * 2) | 1;
    if (!this.hStart || this.hStart.length < table + 1) { this.hStart = new Int32Array(table + 1); }
    const start = this.hStart.fill(0, 0, table + 1), order = this.gn;
    const hash = (ix, iy, iz) => { const h = (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499) ^ Math.imul(iz, 283923481)) >>> 0; return h % table; };
    for (let k = 0; k < N; k++) start[hash(Math.floor(gx[k * 3] / cell), Math.floor(gx[k * 3 + 1] / cell), Math.floor(gx[k * 3 + 2] / cell))]++;
    let sum = 0;
    for (let k = 0; k < table; k++) { sum += start[k]; start[k] = sum; }
    start[table] = sum;
    for (let k = 0; k < N; k++) order[--start[hash(Math.floor(gx[k * 3] / cell), Math.floor(gx[k * 3 + 1] / cell), Math.floor(gx[k * 3 + 2] / cell))]] = k;
    let pairs = this.pairs, np = 0;
    const r2 = reach * reach;
    for (let a = 0; a < N; a++) {
      const ax = gx[a * 3], ay = gx[a * 3 + 1], az = gx[a * 3 + 2], ix = Math.floor(ax / cell), iy = Math.floor(ay / cell), iz = Math.floor(az / cell);
      const A = all[gb[a]], ia = gi[a], ra = A.r;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const h = hash(ix + dx, iy + dy, iz + dz);
        for (let q = start[h], end = start[h + 1]; q < end; q++) {
          const c = order[q];
          if (c <= a) continue;
          const ex = gx[c * 3] - ax, ey = gx[c * 3 + 1] - ay, ez = gx[c * 3 + 2] - az, d2 = ex * ex + ey * ey + ez * ez;
          if (d2 > r2) continue;
          const C = all[gb[c]], i2 = gi[c] * 3, i1 = ia * 3;
          const rx = A.vel[i1] - C.vel[i2], ry = A.vel[i1 + 1] - C.vel[i2 + 1], rz = A.vel[i1 + 2] - C.vel[i2 + 2];
          const could = (A.P.selfGap + C.P.selfGap) * 0.5 + Math.sqrt(rx * rx + ry * ry + rz * rz) * this.dt * 3 + 0.002;
          if (d2 > could * could) continue;
          const sameBody = gb[c] === gb[a];
          if (sameBody && !A.P.self) continue;
          if (sameBody) {
            const ic = gi[c], fx = ra[ia * 3] - ra[ic * 3], fy = ra[ia * 3 + 1] - ra[ic * 3 + 1], fz = ra[ia * 3 + 2] - ra[ic * 3 + 2];
            if (fx * fx + fy * fy + fz * fz < A.P.selfGap * A.P.selfGap * 1.05 / (A.growNow * A.growNow)) continue;
          }
          if ((np + 1) * 2 > pairs.length) { const bigger = new Int32Array(pairs.length * 2); bigger.set(pairs); pairs = this.pairs = bigger; }
          pairs[np * 2] = a; pairs[np * 2 + 1] = c; np++;
        }
      }
    }
    this.nPairs = np;
  }

  substep(h) {
    const physics = this.physics;
    this.stepStamp = (this.stepStamp || 0) + 1;
    const u = (this.stepNo + 1) / this.nSteps;
    for (const b of this.awake) {
      if (this.stepNo % 2 === 0) this.forces(b, h * 2);
      this.integrate(b, h, u);
    }
    for (const b of this.awake) { this.solve(b, h); b.contacts.count = 0; }
    if (this.nPairs) this.collideSoft(h);
    for (const b of this.awake) {
      this.collideWorld(b, h, physics);
      if (b.levels) {
        let heavy = 0;
        for (const N of b.near) if (N.rb && N.rb.free && N.rb.mass > heavy) heavy = N.rb.mass;
        if (heavy > b.total * 0.25) {
          const turns = Math.min(TURNS_MOST, 2 + Math.ceil(Math.log2(Math.max(heavy / Math.max(b.total, 1e-6), 1)) * 1.5)), ih2 = 1 / (h * h);
          this.edgesNear(b);
          this.extraTurn = true;
          for (let k = 0; k < turns; k++) {
            for (let l = b.levels.length - 1; l >= 0; l--) this.solveNet(b, b.levels[l], ih2);
            this.solveLocalEdges(b, ih2);
            if (b.P.tether && b.tetherTo) this.solveTethers(b);
            this.collideWorld(b, h, physics);
          }
          this.extraTurn = false;
        }
      }
    }
    for (const b of this.awake) this.finish(b, h);
    this.stepNo++;
  }

  integrate(b, h, u) {
    const n = b.n, x = b.x, xp = b.xp, v = b.vel, w = b.w, acc = b.acc, g = this.gravity, hg = h * g;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      xp[i3] = x[i3]; xp[i3 + 1] = x[i3 + 1]; xp[i3 + 2] = x[i3 + 2];
      if (w[i] === 0) continue;
      v[i3] += h * acc[i3];
      v[i3 + 1] += h * acc[i3 + 1] - hg;
      v[i3 + 2] += h * acc[i3 + 2];
      x[i3] += h * v[i3]; x[i3 + 1] += h * v[i3 + 1]; x[i3 + 2] += h * v[i3 + 2];
    }
    if (b.nPinned) {
      const L = b.pinList, f = b.pinFrom, T = b.pinTo;
      for (let k = 0; k < L.length; k++) {
        const i = L[k] * 3;
        x[i] = f[k * 3] + (T[k * 3] - f[k * 3]) * u;
        x[i + 1] = f[k * 3 + 1] + (T[k * 3 + 1] - f[k * 3 + 1]) * u;
        x[i + 2] = f[k * 3 + 2] + (T[k * 3 + 2] - f[k * 3 + 2]) * u;
      }
    }
  }

  forces(b, hold) {
    const P = b.P, n = b.n, acc = b.acc, x = b.x, v = b.vel, t = b.tri, nT = b.nT, m = b.mass, w = b.w;
    acc.fill(0);
    const wind = this.wind, Wa = this.physics ? this.physics.water : null;
    const useAero = P.drag > 0 || P.lift > 0 || wind;
    const closed = b.closed;
    let Lv = null;
    if (Wa && closed) Lv = this.levelRound(b, Wa);
    const turb = this.windInfo.turbulence || 0, time = this.windInfo.time || 0, g = this.gravity;
    const pressure = P.pressure;
    if (!useAero && !pressure && !Wa) return;
    const onIt = Wa && !closed ? this.onItMap(Wa) : null;
    for (let f = 0; f < nT; f++) {
      const a = t[f * 3], c = t[f * 3 + 1], e = t[f * 3 + 2], A3 = a * 3, C3 = c * 3, E3 = e * 3;
      const ux = x[C3] - x[A3], uy = x[C3 + 1] - x[A3 + 1], uz = x[C3 + 2] - x[A3 + 2], wx = x[E3] - x[A3], wy = x[E3 + 1] - x[A3 + 1], wz = x[E3 + 2] - x[A3 + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-14) continue;
      const area = nl * 0.5, il = 1 / nl;
      nx *= il; ny *= il; nz *= il;
      const cx = (x[A3] + x[C3] + x[E3]) / 3, cy = (x[A3 + 1] + x[C3 + 1] + x[E3 + 1]) / 3, cz = (x[A3 + 2] + x[C3 + 2] + x[E3 + 2]) / 3;
      let fx = 0, fy = 0, fz = 0;
      if (pressure) { const q = pressure * area; fx += q * nx; fy += q * ny; fz += q * nz; }
      let rho = AIR, flowx = wind ? wind[0] : 0, flowy = 0, flowz = wind ? wind[2] : 0, level = -1;
      if (Wa) {
        const ci = Math.floor((cx - Wa.min[0]) / Wa.cell), cj = Math.floor((cz - Wa.min[1]) / Wa.cell);
        if (ci >= 0 && cj >= 0 && ci < Wa.nx && cj < Wa.nz) {
          const id = ci + Wa.nx * cj, L = Wa.level[id];
          if (onIt) {
            const above = onIt[id];
            if (above > 1e-3) { const q = WATER * g * above * area * Math.abs(ny); fy -= q; }
          }
          level = closed && Lv ? Lv.level : L;
          if (level > cy) {
            rho = WATER;
            b.wetNow = true;
            flowx = (Lv ? Lv.flow[0] : Wa.vx[id]); flowy = 0; flowz = (Lv ? Lv.flow[2] : Wa.vz[id]);
            if (closed) { const q = WATER * g * (level - cy) * area; fx -= q * nx; fy -= q * ny; fz -= q * nz; }
          }
        }
      }
      if (useAero) {
        let wxx = flowx, wyy = flowy, wzz = flowz;
        if (turb > 0 && wind && rho === AIR) {
          const sp = Math.abs(wind[0]) + Math.abs(wind[2]);
          const q = turb * sp * 0.5;
          wxx += q * Math.sin(cx * 2.3 + cz * 1.1 + time * 4.1 + cy * 0.7);
          wyy += q * Math.sin(cy * 2.9 + cx * 1.7 + time * 5.3);
          wzz += q * Math.sin(cz * 2.1 + cy * 1.3 + time * 3.7 + cx * 0.9);
        }
        const vx = wxx - (v[A3] + v[C3] + v[E3]) / 3, vy = wyy - (v[A3 + 1] + v[C3 + 1] + v[E3 + 1]) / 3, vz = wzz - (v[A3 + 2] + v[C3 + 2] + v[E3 + 2]) / 3;
        const sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > 1e-8) {
          const sp = Math.sqrt(sp2), vn = vx * nx + vy * ny + vz * nz, avn = Math.abs(vn);
          let dq = 0.5 * rho * area * P.drag * avn, ax = dq * vx, ay = dq * vy, az = dq * vz;
          if (P.lift > 0 && avn > 1e-6) {
            const s = vn > 0 ? 1 : -1, lx = nx * s - vx * avn / sp2, ly = ny * s - vy * avn / sp2, lz = nz * s - vz * avn / sp2, ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
            if (ll > 1e-6) { const lq = 0.5 * rho * area * P.lift * avn * sp / ll; ax += lq * lx; ay += lq * ly; az += lq * lz; }
          }
          const mt = m[a] + m[c] + m[e], fm = Math.sqrt(ax * ax + ay * ay + az * az);
          if (fm * hold > sp * mt) { const k = sp * mt / (fm * hold); ax *= k; ay *= k; az *= k; }
          fx += ax; fy += ay; fz += az;
        }
      }
      const third = 1 / 3;
      if (w[a]) { const k = w[a] * third; acc[A3] += fx * k; acc[A3 + 1] += fy * k; acc[A3 + 2] += fz * k; }
      if (w[c]) { const k = w[c] * third; acc[C3] += fx * k; acc[C3 + 1] += fy * k; acc[C3 + 2] += fz * k; }
      if (w[e]) { const k = w[e] * third; acc[E3] += fx * k; acc[E3 + 1] += fy * k; acc[E3 + 2] += fz * k; }
    }
    if (b.closed && P.holdsAir && P.gas === 'helium') {
      const V = Math.max(b.volumeNow || 0, 0), lift = (AIR - HELIUM) * g * V, each = lift / Math.max(b.total, 1e-6);
      for (let i = 0; i < n; i++) if (w[i]) acc[i * 3 + 1] += each;
    }
    if (Wa && !closed) {
      for (let c = 0; c < b.surf.length; c++) {
        const i = b.surf[c], ci = Math.floor((x[i * 3] - Wa.min[0]) / Wa.cell), cj = Math.floor((x[i * 3 + 2] - Wa.min[1]) / Wa.cell);
        if (ci < 0 || cj < 0 || ci >= Wa.nx || cj >= Wa.nz) continue;
        let L = Wa.level[ci + Wa.nx * cj];
        if (L > x[i * 3 + 1] && w[i]) acc[i * 3 + 1] += WATER * g * SHEET_THICK * b.J.vArea[i] * w[i];
      }
    }
  }

  onItMap(W) {
    if (this.onItFor === this.frameNo && this.onItW === W && this.onIt) return this.onIt;
    const nx = W.nx, nz = W.nz, N = nx * nz, R = 2, k = 1 / ((2 * R + 1) * (2 * R + 1));
    if (!this.onIt || this.onIt.length !== N) { this.onIt = new Float64Array(N); this.onItRaw = new Float64Array(N); this.onItRow = new Float64Array(N); }
    const raw = this.onItRaw, row = this.onItRow, out = this.onIt;
    for (let i = 0; i < N; i++) { const L = W.level[i]; raw[i] = L < -1.5 ? Math.min(Math.max(-L - 2, 0), 2) : 0; }
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let d = -R; d <= R; d++) { const xx = x + d; if (xx >= 0 && xx < nx) s += raw[xx + nx * z]; }
      row[x + nx * z] = s;
    }
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let d = -R; d <= R; d++) { const zz = z + d; if (zz >= 0 && zz < nz) s += row[x + nx * zz]; }
      out[x + nx * z] = s * k;
    }
    this.onItFor = this.frameNo; this.onItW = W;
    return out;
  }

  levelRound(b, W) {
    const c = b.centroid();
    let r = 0;
    for (let k = 0; k < b.surf.length; k += 7) { const i = b.surf[k], d = (b.x[i * 3] - c[0]) ** 2 + (b.x[i * 3 + 2] - c[2]) ** 2; if (d > r) r = d; }
    r = Math.sqrt(r);
    const cx = (c[0] - W.min[0]) / W.cell, cz = (c[2] - W.min[1]) / W.cell, inner = r / W.cell, levels = [];
    let fx = 0, fz = 0;
    for (let ring = 0; ring < 4 && !levels.length; ring++) {
      const r0 = inner + ring * 2, r1 = r0 + 2;
      for (let z = Math.max(0, Math.floor(cz - r1)); z <= Math.min(W.nz - 1, Math.floor(cz + r1)); z++) for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(W.nx - 1, Math.floor(cx + r1)); x++) {
        const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(z + 0.5 - cz));
        if (d <= r0 || d > r1) continue;
        const i = x + W.nx * z, L = W.level[i];
        if (L < 0) continue;
        levels.push(L); fx += W.vx[i]; fz += W.vz[i];
      }
    }
    if (!levels.length) return null;
    levels.sort((p, q) => p - q);
    return { level: levels[levels.length >> 1], flow: [fx / levels.length, 0, fz / levels.length] };
  }

  solve(b, h) {
    const x = b.x, xp = b.xp, w = b.w, P = b.P, ih2 = 1 / (h * h);
    if (b.kind === 'solid') this.solveTets(b, h);
    else {
      const J = b.J, ei = J.ei, ej = J.ej, L = b.eLnow, eT = b.eT, eC = b.eC, nE = J.nE;
      if (b.levels) for (let l = b.levels.length - 1; l >= 0; l--) this.solveNet(b, b.levels[l], ih2);
      const gam = Math.min(b.tauE / h, 0.25), oldWay = P.holdsAir;
      const eLam = b.eLam || (b.eLam = new Float64Array(nE));
      for (let e = 0; e < nE; e++) {
        const i = ei[e] * 3, j = ej[e] * 3, wi = w[ei[e]], wj = w[ej[e]], ws = wi + wj;
        if (ws === 0) continue;
        const dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-12) continue;
        const C = len - L[e];
        let nx, ny, nz;
        if (oldWay) {
          const ox = xp[j] - xp[i], oy = xp[j + 1] - xp[i + 1], oz = xp[j + 2] - xp[i + 2], ol = 1 / (Math.sqrt(ox * ox + oy * oy + oz * oz) || 1);
          nx = ox * ol; ny = oy * ol; nz = oz * ol;
        } else { const il = 1 / len; nx = dx * il; ny = dy * il; nz = dz * il; }
        const a = (C > 0 ? eT[e] : eC[e]) * ih2;
        const rv = ((x[j] - xp[j]) - (x[i] - xp[i])) * nx + ((x[j + 1] - xp[j + 1]) - (x[i + 1] - xp[i + 1])) * ny + ((x[j + 2] - xp[j + 2]) - (x[i + 2] - xp[i + 2])) * nz;
        const dl = -(C + gam * rv) / ((1 + gam) * ws + a);
        eLam[e] = dl;
        const pj = wj * dl, pi = wi * dl;
        x[j] += nx * pj; x[j + 1] += ny * pj; x[j + 2] += nz * pj;
        x[i] -= nx * pi; x[i + 1] -= ny * pi; x[i + 2] -= nz * pi;
      }
      if (b.hB > 0) this.solveHinges(b, h, ih2);
      if (P.tether && b.tetherTo) this.solveTethers(b);
      if (P.holdsAir) this.solveAir(b, h, ih2);
    }
    this.solveGrabs(b, ih2);
  }

  edgesNear(b) {
    if (b.localFrame === this.frameNo) return;
    b.localFrame = this.frameNo;
    if (!b.inLocal) b.inLocal = new Uint8Array(b.n);
    b.inLocal.fill(0);
    for (const N of b.near) if (N.rb && N.rb.free) for (let c = 0; c < N.list.length; c++) b.inLocal[N.list[c]] = 1;
    const J = b.J, out = b.localEdges || (b.localEdges = new Int32Array(J.nE));
    let m = 0;
    for (let e = 0; e < J.nE; e++) if (b.inLocal[J.ei[e]] || b.inLocal[J.ej[e]]) out[m++] = e;
    b.nLocal = m;
  }
  solveLocalEdges(b, ih2) {
    const x = b.x, w = b.w, J = b.J, ei = J.ei, ej = J.ej, L = b.eLnow, eT = b.eT, eC = b.eC, list = b.localEdges, m = b.nLocal, eLam = b.eLam;
    for (let k = 0; k < m; k++) {
      const e = list[k], A = ei[e], B = ej[e], i = A * 3, j = B * 3, wi = w[A], wj = w[B], ws = wi + wj;
      if (ws === 0) continue;
      const dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-12) continue;
      const C = len - L[e], a = (C > 0 ? eT[e] : eC[e]) * ih2, lam = eLam[e];
      const dl = -(C + a * lam) / (ws + a), il = 1 / len, pj = wj * dl * il, pi = wi * dl * il;
      eLam[e] = lam + dl;
      x[j] += dx * pj; x[j + 1] += dy * pj; x[j + 2] += dz * pj;
      x[i] -= dx * pi; x[i + 1] -= dy * pi; x[i + 2] -= dz * pi;
    }
  }

  solveNet(b, L, ih2) {
    const x = b.x, xp = b.xp, s = L.seeds, ci = L.ci, cj = L.cj, cL = L.cL, iM = L.iM, old = L.old, g = b.growNow, nS = s.length, nE = ci.length, al = ih2 / b.netK, gam = b.netGam;
    if (!L.lam || L.lam.length !== nE) L.lam = new Float64Array(nE);
    const lamAll = L.lam;
    if (L.lamStep !== this.stepStamp) { lamAll.fill(0); L.lamStep = this.stepStamp; }
    let any = false;
    for (let pass = 0; pass < 2; pass++) {
      for (let e = 0; e < nE; e++) {
        const A = ci[e], B = cj[e], i = s[A] * 3, j = s[B] * 3, dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2], rest = cL[e] * g, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= rest * rest && lamAll[e] === 0) continue;
        const wa = iM[A], wb = iM[B], ws = wa + wb;
        if (ws === 0) continue;
        const len = Math.sqrt(d2);
        if (!any) { any = true; for (let I = 0; I < nS; I++) { const q = s[I] * 3; old[I * 3] = x[q]; old[I * 3 + 1] = x[q + 1]; old[I * 3 + 2] = x[q + 2]; } }
        const il = 1 / len, rv = (((x[j] - xp[j]) - (x[i] - xp[i])) * dx + ((x[j + 1] - xp[j + 1]) - (x[i + 1] - xp[i + 1])) * dy + ((x[j + 2] - xp[j + 2]) - (x[i + 2] - xp[i + 2])) * dz) * il;
        const lam = lamAll[e], next = Math.min(lam - (len - rest + al * lam + gam * rv) / ((1 + gam) * ws + al), 0), dl = (next - lam) * il, pj = wb * dl, pi = wa * dl;
        lamAll[e] = next;
        if (dl === 0) continue;
        x[j] += dx * pj; x[j + 1] += dy * pj; x[j + 2] += dz * pj;
        x[i] -= dx * pi; x[i + 1] -= dy * pi; x[i + 2] -= dz * pi;
      }
    }
    if (!any) return;
    for (let I = 0; I < nS; I++) { const q = s[I] * 3; old[I * 3] = x[q] - old[I * 3]; old[I * 3 + 1] = x[q + 1] - old[I * 3 + 1]; old[I * 3 + 2] = x[q + 2] - old[I * 3 + 2]; }
    const n = b.n, w = b.w, pI = L.pI, pW = L.pW;
    for (let i = 0; i < n; i++) {
      if (L.isSeed[i] || w[i] === 0) continue;
      const o = i * 3;
      const a = pI[o];
      if (a < 0) continue;
      let k = pW[o], q = a * 3;
      x[o] += old[q] * k; x[o + 1] += old[q + 1] * k; x[o + 2] += old[q + 2] * k;
      const c = pI[o + 1];
      if (c < 0) continue;
      k = pW[o + 1]; q = c * 3;
      x[o] += old[q] * k; x[o + 1] += old[q + 1] * k; x[o + 2] += old[q + 2] * k;
      const d = pI[o + 2];
      if (d < 0) continue;
      k = pW[o + 2]; q = d * 3;
      x[o] += old[q] * k; x[o + 1] += old[q + 1] * k; x[o + 2] += old[q + 2] * k;
    }
  }

  solveHinges(b, h, ih2) {
    const x = b.x, xp = b.xp, w = b.w, J = b.J, hx = J.hx, hK = J.hK, hQ = J.hQ, hC = J.hC, nH = J.nH, iB = b.hB, gam = Math.min(b.tauB / h, 0.5);
    for (let q = 0; q < nH; q++) {
      const o = q * 4, p0 = hx[o], p1 = hx[o + 1], p2 = hx[o + 2], p3 = hx[o + 3], a = p0 * 3, c = p1 * 3, d = p2 * 3, e = p3 * 3;
      const k0 = hK[o], k1 = hK[o + 1], k2 = hK[o + 2], k3 = hK[o + 3];
      let cx = k0 * x[a] + k1 * x[c] + k2 * x[d] + k3 * x[e], cy = k0 * x[a + 1] + k1 * x[c + 1] + k2 * x[d + 1] + k3 * x[e + 1], cz = k0 * x[a + 2] + k1 * x[c + 2] + k2 * x[d + 2] + k3 * x[e + 2];
      const rest = hC[q];
      if (rest !== 0) {
        const ax = x[c] - x[a], ay = x[c + 1] - x[a + 1], az = x[c + 2] - x[a + 2], bx = x[d] - x[a], by = x[d + 1] - x[a + 1], bz = x[d + 2] - x[a + 2], ex = x[e] - x[a], ey = x[e + 1] - x[a + 1], ez = x[e + 2] - x[a + 2];
        const n1x = ay * bz - az * by, n1y = az * bx - ax * bz, n1z = ax * by - ay * bx, n2x = ey * az - ez * ay, n2y = ez * ax - ex * az, n2z = ex * ay - ey * ax;
        const mx = n1x + n2x, my = n1y + n2y, mz = n1z + n2z, ml = Math.sqrt(mx * mx + my * my + mz * mz);
        if (ml > 1e-14) { const s = rest / ml; cx -= mx * s; cy -= my * s; cz -= mz * s; }
      }
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (len < 1e-10) continue;
      const il = 1 / len, nx = cx * il, ny = cy * il, nz = cz * il;
      const w0 = w[p0], w1 = w[p1], w2 = w[p2], w3 = w[p3];
      const den = w0 * k0 * k0 + w1 * k1 * k1 + w2 * k2 * k2 + w3 * k3 * k3;
      if (den === 0) continue;
      const al = iB / hQ[q] * ih2;
      const rv = k0 * ((x[a] - xp[a]) * nx + (x[a + 1] - xp[a + 1]) * ny + (x[a + 2] - xp[a + 2]) * nz) + k1 * ((x[c] - xp[c]) * nx + (x[c + 1] - xp[c + 1]) * ny + (x[c + 2] - xp[c + 2]) * nz)
        + k2 * ((x[d] - xp[d]) * nx + (x[d + 1] - xp[d + 1]) * ny + (x[d + 2] - xp[d + 2]) * nz) + k3 * ((x[e] - xp[e]) * nx + (x[e + 1] - xp[e + 1]) * ny + (x[e + 2] - xp[e + 2]) * nz);
      const dl = -(len + gam * rv) / ((1 + gam) * den + al);
      let s = w0 * k0 * dl; x[a] += nx * s; x[a + 1] += ny * s; x[a + 2] += nz * s;
      s = w1 * k1 * dl; x[c] += nx * s; x[c + 1] += ny * s; x[c + 2] += nz * s;
      s = w2 * k2 * dl; x[d] += nx * s; x[d + 1] += ny * s; x[d + 2] += nz * s;
      s = w3 * k3 * dl; x[e] += nx * s; x[e + 1] += ny * s; x[e + 2] += nz * s;
    }
  }

  solveTethers(b) {
    const x = b.x, w = b.w, to = b.tetherTo, L = b.tetherL, n = b.n, g = b.growNow * 1.03;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      const a = to[i];
      if (a < 0) continue;
      const i3 = i * 3, a3 = a * 3, dx = x[i3] - x[a3], dy = x[i3 + 1] - x[a3 + 1], dz = x[i3 + 2] - x[a3 + 2], d2 = dx * dx + dy * dy + dz * dz, max = L[i] * g;
      if (d2 <= max * max) continue;
      const d = Math.sqrt(d2), k = (d - max) / d;
      x[i3] -= dx * k; x[i3 + 1] -= dy * k; x[i3 + 2] -= dz * k;
    }
  }

  solveAir(b, h, ih2) {
    const x = b.x, xp = b.xp, w = b.w, t = b.tri, nT = b.nT, n = b.n;
    if (!b.gradV) b.gradV = new Float64Array(n * 3);
    const g = b.gradV.fill(0);
    let vol = 0;
    for (let f = 0; f < nT; f++) {
      const a = t[f * 3] * 3, c = t[f * 3 + 1] * 3, e = t[f * 3 + 2] * 3;
      vol += x[a] * (x[c + 1] * x[e + 2] - x[c + 2] * x[e + 1]) + x[a + 1] * (x[c + 2] * x[e] - x[c] * x[e + 2]) + x[a + 2] * (x[c] * x[e + 1] - x[c + 1] * x[e]);
      const ax = xp[a], ay = xp[a + 1], az = xp[a + 2], bx = xp[c], by = xp[c + 1], bz = xp[c + 2], cx = xp[e], cy = xp[e + 1], cz = xp[e + 2];
      g[a] += by * cz - bz * cy; g[a + 1] += bz * cx - bx * cz; g[a + 2] += bx * cy - by * cx;
      g[c] += cy * az - cz * ay; g[c + 1] += cz * ax - cx * az; g[c + 2] += cx * ay - cy * ax;
      g[e] += ay * bz - az * by; g[e + 1] += az * bx - ax * bz; g[e + 2] += ax * by - ay * bx;
    }
    vol /= 6;
    b.volumeNow = vol;
    if (!(vol > 1e-9)) return;
    let den = 0;
    for (let i = 0; i < n; i++) { if (!w[i]) continue; const a = i * 3; den += w[i] * (g[a] * g[a] + g[a + 1] * g[a + 1] + g[a + 2] * g[a + 2]); }
    den /= 36;
    if (!(den > 0)) return;
    const n0 = b.airNow * b.volume0, kGas = P_ATM * Math.max(n0, 1e-9) / (vol * vol);
    const al = ih2 / kGas;
    const dl = -(vol - b.airTarget) / (den + al);
    b.airApplied = dl * ih2;
    const s = dl / 6;
    for (let i = 0; i < n; i++) { if (!w[i]) continue; const a = i * 3, k = w[i] * s; x[a] += g[a] * k; x[a + 1] += g[a + 1] * k; x[a + 2] += g[a + 2] * k; }
  }

  airBalance(b) {
    const g = b.growNow, Vr = Math.max(b.volume0 * g * g * g, 1e-9), n0 = Math.max(b.airNow * b.volume0, 1e-9), K = b.skinK * g * g;
    const skin = V => { const s = Math.cbrt(V / Vr); return s > 1 ? K * (s - 1) / (3 * Vr * s * s) : 0; };
    let lo = 1e-9, hi = Math.max(n0, Vr) * 2;
    for (let i = 0; i < 40; i++) {
      const V = (lo + hi) / 2;
      if (P_ATM * (n0 / V - 1) > skin(V)) lo = V; else hi = V;
    }
    b.airTarget = (lo + hi) / 2;
    b.pressureNow = P_ATM * (n0 / b.airTarget - 1);
  }

  dampInner(b, dt) {
    const k = 1 - Math.exp(-b.P.damp * dt);
    if (!(k > 0)) return;
    const n = b.n, x = b.x, v = b.vel, m = b.mass;
    let M = 0, cx = 0, cy = 0, cz = 0, ux = 0, uy = 0, uz = 0;
    for (let i = 0; i < n; i++) {
      const q = m[i], a = i * 3;
      M += q; cx += q * x[a]; cy += q * x[a + 1]; cz += q * x[a + 2]; ux += q * v[a]; uy += q * v[a + 1]; uz += q * v[a + 2];
    }
    const iM = 1 / M; cx *= iM; cy *= iM; cz *= iM; ux *= iM; uy *= iM; uz *= iM;
    let Lx = 0, Ly = 0, Lz = 0, I00 = 0, I01 = 0, I02 = 0, I11 = 0, I12 = 0, I22 = 0;
    for (let i = 0; i < n; i++) {
      const q = m[i], a = i * 3, rx = x[a] - cx, ry = x[a + 1] - cy, rz = x[a + 2] - cz, sx = v[a] - ux, sy = v[a + 1] - uy, sz = v[a + 2] - uz;
      Lx += q * (ry * sz - rz * sy); Ly += q * (rz * sx - rx * sz); Lz += q * (rx * sy - ry * sx);
      const xx = rx * rx, yy = ry * ry, zz = rz * rz;
      I00 += q * (yy + zz); I11 += q * (xx + zz); I22 += q * (xx + yy); I01 -= q * rx * ry; I02 -= q * rx * rz; I12 -= q * ry * rz;
    }
    const c00 = I11 * I22 - I12 * I12, c01 = I02 * I12 - I01 * I22, c02 = I01 * I12 - I02 * I11, det = I00 * c00 + I01 * c01 + I02 * c02;
    let wx = 0, wy = 0, wz = 0;
    if (Math.abs(det) > 1e-18) {
      const id = 1 / det, c11 = I00 * I22 - I02 * I02, c12 = I01 * I02 - I00 * I12, c22 = I00 * I11 - I01 * I01;
      wx = (c00 * Lx + c01 * Ly + c02 * Lz) * id; wy = (c01 * Lx + c11 * Ly + c12 * Lz) * id; wz = (c02 * Lx + c12 * Ly + c22 * Lz) * id;
    }
    for (let i = 0; i < n; i++) {
      const a = i * 3, rx = x[a] - cx, ry = x[a + 1] - cy, rz = x[a + 2] - cz;
      v[a] += (ux + wy * rz - wz * ry - v[a]) * k;
      v[a + 1] += (uy + wz * rx - wx * rz - v[a + 1]) * k;
      v[a + 2] += (uz + wx * ry - wy * rx - v[a + 2]) * k;
    }
  }

  solveTets(b, h) {
    const x = b.x, xp = b.xp, w = b.w, J = b.J, tx = J.tx, inv = J.tInv, tV = J.tV, nT = J.nT, ih2 = 1 / (h * h), mu = b.mu, s = b.restScale || 1;
    const is = 1 / s, s3 = s * s * s;
    const gam = Math.min(b.tauT / h, 0.5);
    for (let q = 0; q < nT; q++) {
      const o = q * 4, p0 = tx[o], p1 = tx[o + 1], p2 = tx[o + 2], p3 = tx[o + 3], A = p0 * 3, B = p1 * 3, C = p2 * 3, D = p3 * 3, m = q * 9;
      const w0 = w[p0], w1 = w[p1], w2 = w[p2], w3 = w[p3];
      if (w0 + w1 + w2 + w3 === 0) continue;
      const i00 = inv[m] * is, i01 = inv[m + 1] * is, i02 = inv[m + 2] * is, i10 = inv[m + 3] * is, i11 = inv[m + 4] * is, i12 = inv[m + 5] * is, i20 = inv[m + 6] * is, i21 = inv[m + 7] * is, i22 = inv[m + 8] * is;
      const V = tV[q] * s3;
      const d1x = x[B] - x[A], d1y = x[B + 1] - x[A + 1], d1z = x[B + 2] - x[A + 2], d2x = x[C] - x[A], d2y = x[C + 1] - x[A + 1], d2z = x[C + 2] - x[A + 2], d3x = x[D] - x[A], d3y = x[D + 1] - x[A + 1], d3z = x[D + 2] - x[A + 2];
      const f1x = d1x * i00 + d2x * i10 + d3x * i20, f1y = d1y * i00 + d2y * i10 + d3y * i20, f1z = d1z * i00 + d2z * i10 + d3z * i20;
      const f2x = d1x * i01 + d2x * i11 + d3x * i21, f2y = d1y * i01 + d2y * i11 + d3y * i21, f2z = d1z * i01 + d2z * i11 + d3z * i21;
      const f3x = d1x * i02 + d2x * i12 + d3x * i22, f3y = d1y * i02 + d2y * i12 + d3y * i22, f3z = d1z * i02 + d2z * i12 + d3z * i22;
      const c1x = f2y * f3z - f2z * f3y, c1y = f2z * f3x - f2x * f3z, c1z = f2x * f3y - f2y * f3x;
      const c2x = f3y * f1z - f3z * f1y, c2y = f3z * f1x - f3x * f1z, c2z = f3x * f1y - f3y * f1x;
      const c3x = f1y * f2z - f1z * f2y, c3y = f1z * f2x - f1x * f2z, c3z = f1x * f2y - f1y * f2x;
      const det = f1x * c1x + f1y * c1y + f1z * c1z;
      let c13 = Math.cbrt(det);
      if (c13 > -0.3 && c13 < 0.3) c13 = c13 < 0 ? -0.3 : 0.3;
      const r2 = f1x * f1x + f1y * f1y + f1z * f1z + f2x * f2x + f2y * f2y + f2z * f2z + f3x * f3x + f3y * f3y + f3z * f3z;
      const C12 = r2 - 3 * c13 * c13, r = C12 > 1e-10 ? Math.sqrt(C12) : 0;
      const ic = 1 / c13, ir = r > 0 ? 1 / r : 0;
      const h1x = (f1x - c1x * ic) * ir, h1y = (f1y - c1y * ic) * ir, h1z = (f1z - c1z * ic) * ir, h2x = (f2x - c2x * ic) * ir, h2y = (f2y - c2y * ic) * ir, h2z = (f2z - c2z * ic) * ir, h3x = (f3x - c3x * ic) * ir, h3y = (f3y - c3y * ic) * ir, h3z = (f3z - c3z * ic) * ir;
      const a1x = h1x * i00 + h2x * i01 + h3x * i02, a1y = h1y * i00 + h2y * i01 + h3y * i02, a1z = h1z * i00 + h2z * i01 + h3z * i02;
      const a2x = h1x * i10 + h2x * i11 + h3x * i12, a2y = h1y * i10 + h2y * i11 + h3y * i12, a2z = h1z * i10 + h2z * i11 + h3z * i12;
      const a3x = h1x * i20 + h2x * i21 + h3x * i22, a3y = h1y * i20 + h2y * i21 + h3y * i22, a3z = h1z * i20 + h2z * i21 + h3z * i22;
      const a0x = -(a1x + a2x + a3x), a0y = -(a1y + a2y + a3y), a0z = -(a1z + a2z + a3z);
      const b1x = c1x * i00 + c2x * i01 + c3x * i02, b1y = c1y * i00 + c2y * i01 + c3y * i02, b1z = c1z * i00 + c2z * i01 + c3z * i02;
      const b2x = c1x * i10 + c2x * i11 + c3x * i12, b2y = c1y * i10 + c2y * i11 + c3y * i12, b2z = c1z * i10 + c2z * i11 + c3z * i12;
      const b3x = c1x * i20 + c2x * i21 + c3x * i22, b3y = c1y * i20 + c2y * i21 + c3y * i22, b3z = c1z * i20 + c2z * i21 + c3z * i22;
      const b0x = -(b1x + b2x + b3x), b0y = -(b1y + b2y + b3y), b0z = -(b1z + b2z + b3z);
      const al1 = ih2 / (mu * V), al2 = ih2 / (b.bulk * V);
      const G11 = w0 * (a0x * a0x + a0y * a0y + a0z * a0z) + w1 * (a1x * a1x + a1y * a1y + a1z * a1z) + w2 * (a2x * a2x + a2y * a2y + a2z * a2z) + w3 * (a3x * a3x + a3y * a3y + a3z * a3z);
      const G22 = w0 * (b0x * b0x + b0y * b0y + b0z * b0z) + w1 * (b1x * b1x + b1y * b1y + b1z * b1z) + w2 * (b2x * b2x + b2y * b2y + b2z * b2z) + w3 * (b3x * b3x + b3y * b3y + b3z * b3z);
      const G12 = w0 * (a0x * b0x + a0y * b0y + a0z * b0z) + w1 * (a1x * b1x + a1y * b1y + a1z * b1z) + w2 * (a2x * b2x + a2y * b2y + a2z * b2z) + w3 * (a3x * b3x + a3y * b3y + a3z * b3z);
      const rv = a0x * (x[A] - xp[A]) + a0y * (x[A + 1] - xp[A + 1]) + a0z * (x[A + 2] - xp[A + 2]) + a1x * (x[B] - xp[B]) + a1y * (x[B + 1] - xp[B + 1]) + a1z * (x[B + 2] - xp[B + 2])
        + a2x * (x[C] - xp[C]) + a2y * (x[C + 1] - xp[C + 1]) + a2z * (x[C + 2] - xp[C + 2]) + a3x * (x[D] - xp[D]) + a3y * (x[D + 1] - xp[D + 1]) + a3z * (x[D + 2] - xp[D + 2]);
      const A11 = (1 + gam) * G11 + al1, A12 = (1 + gam) * G12, A21 = G12, A22 = G22 + al2, R1 = -(r + gam * rv), R2 = -(det - 1);
      const D2 = A11 * A22 - A12 * A21;
      if (!(Math.abs(D2) > 1e-30)) continue;
      const l1 = (R1 * A22 - A12 * R2) / D2, l2 = (A11 * R2 - A21 * R1) / D2;
      let k = w0; x[A] += (a0x * l1 + b0x * l2) * k; x[A + 1] += (a0y * l1 + b0y * l2) * k; x[A + 2] += (a0z * l1 + b0z * l2) * k;
      k = w1; x[B] += (a1x * l1 + b1x * l2) * k; x[B + 1] += (a1y * l1 + b1y * l2) * k; x[B + 2] += (a1z * l1 + b1z * l2) * k;
      k = w2; x[C] += (a2x * l1 + b2x * l2) * k; x[C + 1] += (a2y * l1 + b2y * l2) * k; x[C + 2] += (a2z * l1 + b2z * l2) * k;
      k = w3; x[D] += (a3x * l1 + b3x * l2) * k; x[D + 1] += (a3y * l1 + b3y * l2) * k; x[D + 2] += (a3z * l1 + b3z * l2) * k;
    }
  }

  solveGrabs(b, ih2) {
    const list = b.grabList;
    if (!list || !list.length) return;
    const x = b.x, w = b.w;
    for (const g of list) {
      const a = ih2 / Math.max(g.k, 1);
      for (let c = 0; c < g.points.length; c++) {
        const i = g.points[c], i3 = i * 3;
        if (!w[i]) continue;
        const tx = g.at[0] + g.off[c * 3], ty = g.at[1] + g.off[c * 3 + 1], tz = g.at[2] + g.off[c * 3 + 2];
        const k = w[i] / (w[i] + a);
        x[i3] += (tx - x[i3]) * k; x[i3 + 1] += (ty - x[i3 + 1]) * k; x[i3 + 2] += (tz - x[i3 + 2]) * k;
      }
    }
  }

  collideSoft(h) {
    const pairs = this.pairs, np = this.nPairs, gb = this.gb, gi = this.gi, all = this.pairBodies;
    for (let q = 0; q < np; q++) {
      const a = pairs[q * 2], c = pairs[q * 2 + 1], A = all[gb[a]], B = all[gb[c]], i = gi[a], j = gi[c];
      const xa = A.x, xb = B.x, i3 = i * 3, j3 = j * 3;
      const dx = xb[j3] - xa[i3], dy = xb[j3 + 1] - xa[i3 + 1], dz = xb[j3 + 2] - xa[i3 + 2], d2 = dx * dx + dy * dy + dz * dz;
      let gap = (A.P.selfGap + B.P.selfGap) * 0.5;
      if (A === B) {
        const ra = A.r, fx = ra[i3] - ra[j3], fy = ra[i3 + 1] - ra[j3 + 1], fz = ra[i3 + 2] - ra[j3 + 2], rest2 = (fx * fx + fy * fy + fz * fz) * A.growNow * A.growNow;
        if (rest2 < gap * gap) gap = Math.sqrt(rest2);
      }
      if (d2 >= gap * gap || d2 < 1e-16) continue;
      const wa = A.asleep ? 0 : A.w[i], wb = B.asleep ? 0 : B.w[j], ws = wa + wb;
      if (ws === 0) continue;
      const d = Math.sqrt(d2), pen = gap - d, il = 1 / d, nx = dx * il, ny = dy * il, nz = dz * il, k = pen / ws;
      xa[i3] -= nx * wa * k; xa[i3 + 1] -= ny * wa * k; xa[i3 + 2] -= nz * wa * k;
      xb[j3] += nx * wb * k; xb[j3 + 1] += ny * wb * k; xb[j3 + 2] += nz * wb * k;
      const mu = Math.sqrt(A.P.grip * B.P.grip);
      if (mu > 0) {
        const rx = (xb[j3] - B.xp[j3]) - (xa[i3] - A.xp[i3]), ry = (xb[j3 + 1] - B.xp[j3 + 1]) - (xa[i3 + 1] - A.xp[i3 + 1]), rz = (xb[j3 + 2] - B.xp[j3 + 2]) - (xa[i3 + 2] - A.xp[i3 + 2]);
        const rn = rx * nx + ry * ny + rz * nz, tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz, tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-9) {
          const s = Math.min(1, mu * pen / tl) / ws;
          xa[i3] += tx * wa * s; xa[i3 + 1] += ty * wa * s; xa[i3 + 2] += tz * wa * s;
          xb[j3] -= tx * wb * s; xb[j3 + 1] -= ty * wb * s; xb[j3 + 2] -= tz * wb * s;
        }
      }
    }
  }

  collideWorld(b, h, physics) {
    const x = b.x, xp = b.xp, w = b.w, P = b.P, vel = b.vel, t = P.thick, mu0 = P.grip, surf = b.surf, C = b.contacts;
    let count = C.count;
    const add = (i, nx, ny, nz, sx, sy, sz, vn0) => {
      if (count >= C.i.length) return;
      C.i[count] = i;
      C.n[count * 3] = nx; C.n[count * 3 + 1] = ny; C.n[count * 3 + 2] = nz;
      C.vs[count * 3] = sx; C.vs[count * 3 + 1] = sy; C.vs[count * 3 + 2] = sz;
      C.vn0[count] = vn0;
      count++;
    };
    for (const N of b.near) {
      const o = N.o, rb = N.rb, model = N.model, list = N.list, d0 = N.d;
      const P0 = rb ? rb.pos : o.pos, ax = rb ? rb.ax : eulerAxes(o.rot);
      const dynamic = !!(rb && rb.free);
      const vR = rb && rb.free ? rb.v : o.vel || [0, 0, 0], wR = rb && rb.free ? rb.w : o.spin || [0, 0, 0];
      const mu = Math.sqrt(mu0 * (o.grip ?? (rb ? rb.friction : 0.6)));
      const invM = dynamic ? 1 / rb.mass : 0;
      for (let c = 0; c < list.length; c++) {
        const i = list[c], wi = w[i];
        if (wi === 0) continue;
        const i3 = i * 3, c7 = c * 7;
        const px = x[i3] - P0[0], py = x[i3 + 1] - P0[1], pz = x[i3 + 2] - P0[2];
        const qx = px * ax[0][0] + py * ax[0][1] + pz * ax[0][2], qy = px * ax[1][0] + py * ax[1][1] + pz * ax[1][2], qz = px * ax[2][0] + py * ax[2][1] + pz * ax[2][2];
        const q0x = d0[c7 + 4], q0y = d0[c7 + 5], q0z = d0[c7 + 6];
        let dd = d0[c7], nx = d0[c7 + 1], ny = d0[c7 + 2], nz = d0[c7 + 3];
        const fresh = dd >= 1e8;
        let est = fresh ? -1 : dd + nx * (qx - q0x) + ny * (qy - q0y) + nz * (qz - q0z);
        if (!fresh && est > t + 0.01) continue;
        const moved = (qx - q0x) ** 2 + (qy - q0y) ** 2 + (qz - q0z) ** 2;
        if (fresh || moved > 1.6e-5) {
          dd = shapeSdf(qx, qy, qz, o, model);
          const g = shapeNormal(qx, qy, qz, o, model, 0.002);
          nx = g[0]; ny = g[1]; nz = g[2];
          d0[c7] = dd; d0[c7 + 1] = nx; d0[c7 + 2] = ny; d0[c7 + 3] = nz; d0[c7 + 4] = qx; d0[c7 + 5] = qy; d0[c7 + 6] = qz;
          est = dd;
        }
        if (est >= t) continue;
        const pen = t - est;
        const wnx = ax[0][0] * nx + ax[1][0] * ny + ax[2][0] * nz, wny = ax[0][1] * nx + ax[1][1] * ny + ax[2][1] * nz, wnz = ax[0][2] * nx + ax[1][2] * ny + ax[2][2] * nz;
        const svx = vR[0] + wR[1] * pz - wR[2] * py, svy = vR[1] + wR[2] * px - wR[0] * pz, svz = vR[2] + wR[0] * py - wR[1] * px;
        let wr = 0, lx = 0, ly = 0, lz = 0, tl0 = 0, ly2 = 0, lz2 = 0;
        if (dynamic) {
          const rxnx = py * wnz - pz * wny, rxny = pz * wnx - px * wnz, rxnz = px * wny - py * wnx;
          const ia = rb.invI;
          lx = rxnx * ax[0][0] + rxny * ax[0][1] + rxnz * ax[0][2]; ly = rxnx * ax[1][0] + rxny * ax[1][1] + rxnz * ax[1][2]; lz = rxnx * ax[2][0] + rxny * ax[2][1] + rxnz * ax[2][2];
          wr = invM + lx * lx * ia[0] + ly * ly * ia[1] + lz * lz * ia[2];
        }
        let wiE = wi;
        if (dynamic && b.tetherTo && P.tether) {
          const pa = b.tetherTo[i];
          if (pa >= 0 && pa !== i) {
            const ex = x[i3] - x[pa * 3], ey = x[i3 + 1] - x[pa * 3 + 1], ez = x[i3 + 2] - x[pa * 3 + 2], ed = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (ed >= b.tetherL[i] * b.growNow * 1.03 * 0.995 && (ex * wnx + ey * wny + ez * wnz) > 0) wiE = 0;
          }
        }
        const dl = pen / (wiE + wr);
        const sp = wiE * dl;
        x[i3] += wnx * sp; x[i3 + 1] += wny * sp; x[i3 + 2] += wnz * sp;
        if (dynamic && wr > 0) this.pushRigidTaut(rb, wnx, wny, wnz, lx, ly, lz, px, py, pz, dl, wr, vel[i3], vel[i3 + 1], vel[i3 + 2], wiE === 0, h);
        const rx = x[i3] - xp[i3] - svx * h, ry = x[i3 + 1] - xp[i3 + 1] - svy * h, rz = x[i3 + 2] - xp[i3 + 2] - svz * h, rn = rx * wnx + ry * wny + rz * wnz;
        const tx = rx - rn * wnx, ty = ry - rn * wny, tz = rz - rn * wnz, tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-10 && mu > 0) {
          const s = Math.min(1, mu * pen / tl);
          x[i3] -= tx * s; x[i3 + 1] -= ty * s; x[i3 + 2] -= tz * s;
          if (dynamic && !this.extraTurn) { const k = s / wi * invM / h; rb.v[0] += tx * k; rb.v[1] += ty * k; rb.v[2] += tz * k; }
        }
        const v0n = (vel[i3] - svx) * wnx + (vel[i3 + 1] - svy) * wny + (vel[i3 + 2] - svz) * wnz;
        add(i, wnx, wny, wnz, svx, svy, svz, v0n);
      }
      const mids = N.mids, md = N.md, mA = b.midA, mB = b.midB;
      for (let c = 0; c < mids.length; c++) {
        const e = mids[c], ia = mA[e], ib = mB[e], wa = w[ia], wb = w[ib];
        if (wa + wb === 0) continue;
        const a3 = ia * 3, b3 = ib * 3, c7 = c * 7;
        const px = (x[a3] + x[b3]) * 0.5 - P0[0], py = (x[a3 + 1] + x[b3 + 1]) * 0.5 - P0[1], pz = (x[a3 + 2] + x[b3 + 2]) * 0.5 - P0[2];
        const qx = px * ax[0][0] + py * ax[0][1] + pz * ax[0][2], qy = px * ax[1][0] + py * ax[1][1] + pz * ax[1][2], qz = px * ax[2][0] + py * ax[2][1] + pz * ax[2][2];
        const q0x = md[c7 + 4], q0y = md[c7 + 5], q0z = md[c7 + 6];
        let dd = md[c7], nx = md[c7 + 1], ny = md[c7 + 2], nz = md[c7 + 3];
        const fresh = dd >= 1e8;
        let est = fresh ? -1 : dd + nx * (qx - q0x) + ny * (qy - q0y) + nz * (qz - q0z);
        if (!fresh && est > t + 0.01) continue;
        if (fresh || (qx - q0x) ** 2 + (qy - q0y) ** 2 + (qz - q0z) ** 2 > 1.6e-5) {
          dd = shapeSdf(qx, qy, qz, o, model);
          const g = shapeNormal(qx, qy, qz, o, model, 0.002);
          nx = g[0]; ny = g[1]; nz = g[2];
          md[c7] = dd; md[c7 + 1] = nx; md[c7 + 2] = ny; md[c7 + 3] = nz; md[c7 + 4] = qx; md[c7 + 5] = qy; md[c7 + 6] = qz;
          est = dd;
        }
        if (est >= t) continue;
        const pen = t - est;
        const wnx = ax[0][0] * nx + ax[1][0] * ny + ax[2][0] * nz, wny = ax[0][1] * nx + ax[1][1] * ny + ax[2][1] * nz, wnz = ax[0][2] * nx + ax[1][2] * ny + ax[2][2] * nz;
        let wr = 0, lx = 0, ly = 0, lz = 0;
        if (dynamic) {
          const rxnx = py * wnz - pz * wny, rxny = pz * wnx - px * wnz, rxnz = px * wny - py * wnx, ia2 = rb.invI;
          lx = rxnx * ax[0][0] + rxny * ax[0][1] + rxnz * ax[0][2]; ly = rxnx * ax[1][0] + rxny * ax[1][1] + rxnz * ax[1][2]; lz = rxnx * ax[2][0] + rxny * ax[2][1] + rxnz * ax[2][2];
          wr = invM + lx * lx * ia2[0] + ly * ly * ia2[1] + lz * lz * ia2[2];
        }
        const dl = pen / ((wa + wb) * 0.25 + wr), sa = wa * 0.5 * dl, sb = wb * 0.5 * dl;
        x[a3] += wnx * sa; x[a3 + 1] += wny * sa; x[a3 + 2] += wnz * sa;
        x[b3] += wnx * sb; x[b3 + 1] += wny * sb; x[b3 + 2] += wnz * sb;
        if (dynamic && wr > 0) this.pushRigidTaut(rb, wnx, wny, wnz, lx, ly, lz, px, py, pz, dl, wr, (vel[a3] + vel[b3]) * 0.5, (vel[a3 + 1] + vel[b3 + 1]) * 0.5, (vel[a3 + 2] + vel[b3 + 2]) * 0.5, false, h);
      }
    }
    const n = surf.length;
    for (let c = 0; c < n; c++) {
      const i = surf[c], i3 = i * 3, y = x[i3 + 1];
      if (y >= t) continue;
      if (w[i] === 0) continue;
      const pen = t - y;
      x[i3 + 1] = t;
      if (mu0 > 0) {
        const rx = x[i3] - xp[i3], rz = x[i3 + 2] - xp[i3 + 2], tl = Math.sqrt(rx * rx + rz * rz);
        if (tl > 1e-10) { const s = Math.min(1, mu0 * pen / tl); x[i3] -= rx * s; x[i3 + 2] -= rz * s; }
      }
      add(i, 0, 1, 0, 0, 0, 0, vel[i3 + 1]);
    }
    const Wa = physics ? physics.water : null;
    if (Wa && b.wetNow) {
      const lo0 = Wa.min[0], hi0 = Wa.min[0] + Wa.nx * Wa.cell, lo2 = Wa.min[1], hi2 = Wa.min[1] + Wa.nz * Wa.cell;
      for (let c = 0; c < n; c++) {
        const i = surf[c] * 3;
        if (x[i] < lo0) x[i] = lo0; else if (x[i] > hi0) x[i] = hi0;
        if (x[i + 2] < lo2) x[i + 2] = lo2; else if (x[i + 2] > hi2) x[i + 2] = hi2;
      }
    }
    C.count = count;
    this.contactCount += count;
  }

  pushRigid(rb, nx, ny, nz, lx, ly, lz, dl, h) {
    const invM = 1 / rb.mass, ia = rb.invI, ax = rb.ax, k = dl * invM;
    rb.pos[0] -= nx * k; rb.pos[1] -= ny * k; rb.pos[2] -= nz * k;
    const iv = 1 / h;
    rb.v[0] -= nx * k * iv; rb.v[1] -= ny * k * iv; rb.v[2] -= nz * k * iv;
    const t0 = lx * ia[0], t1 = ly * ia[1], t2 = lz * ia[2];
    const tx = (ax[0][0] * t0 + ax[1][0] * t1 + ax[2][0] * t2) * dl, ty = (ax[0][1] * t0 + ax[1][1] * t1 + ax[2][1] * t2) * dl, tz = (ax[0][2] * t0 + ax[1][2] * t1 + ax[2][2] * t2) * dl;
    rb.w[0] -= tx * iv; rb.w[1] -= ty * iv; rb.w[2] -= tz * iv;
    rb.sleep = 0;
    rb.softTouched = true;
    rb.softTurn = rb.softTurn || [0, 0, 0];
    rb.softTurn[0] -= tx; rb.softTurn[1] -= ty; rb.softTurn[2] -= tz;
    if (!this.touched) this.touched = new Set();
    this.touched.add(rb);
  }

  pushRigidTaut(rb, nx, ny, nz, lx, ly, lz, px, py, pz, dl, wr, pvx, pvy, pvz, taut, h) {
    const invM = 1 / rb.mass, ia = rb.invI, ax = rb.ax, k = dl * invM;
    rb.pos[0] -= nx * k; rb.pos[1] -= ny * k; rb.pos[2] -= nz * k;
    const t0 = lx * ia[0], t1 = ly * ia[1], t2 = lz * ia[2];
    const tx = ax[0][0] * t0 + ax[1][0] * t1 + ax[2][0] * t2, ty = ax[0][1] * t0 + ax[1][1] * t1 + ax[2][1] * t2, tz = ax[0][2] * t0 + ax[1][2] * t1 + ax[2][2] * t2;
    rb.softTurn = rb.softTurn || [0, 0, 0];
    rb.softTurn[0] -= tx * dl; rb.softTurn[1] -= ty * dl; rb.softTurn[2] -= tz * dl;
    const v = rb.v, w = rb.w;
    if (!taut) {
      const iv = 1 / h; v[0] -= nx * k * iv; v[1] -= ny * k * iv; v[2] -= nz * k * iv; w[0] -= tx * dl * iv; w[1] -= ty * dl * iv; w[2] -= tz * dl * iv;
      rb.sleep = 0; rb.softTouched = true;
      if (!this.touched) this.touched = new Set();
      this.touched.add(rb);
      return;
    }
    const vx = v[0] + w[1] * pz - w[2] * py, vy = v[1] + w[2] * px - w[0] * pz, vz = v[2] + w[0] * py - w[1] * px;
    void pvx; void pvy; void pvz;
    const into = vx * nx + vy * ny + vz * nz;
    if (into > 0) {
      const J = into / wr;
      v[0] -= nx * J * invM; v[1] -= ny * J * invM; v[2] -= nz * J * invM;
      w[0] -= tx * J; w[1] -= ty * J; w[2] -= tz * J;
    }
    rb.sleep = 0;
    rb.softTouched = true;
    if (!this.touched) this.touched = new Set();
    this.touched.add(rb);
  }

  finish(b, h) {
    const n = b.n, x = b.x, xp = b.xp, v = b.vel, ih = 1 / h;
    for (let i = 0; i < n; i++) {
      const a = i * 3;
      v[a] = (x[a] - xp[a]) * ih; v[a + 1] = (x[a + 1] - xp[a + 1]) * ih; v[a + 2] = (x[a + 2] - xp[a + 2]) * ih;
    }
    const C = b.contacts, e = b.P.bounce;
    for (let c = 0; c < C.count; c++) {
      const a = C.i[c] * 3;
      const nx = C.n[c * 3], ny = C.n[c * 3 + 1], nz = C.n[c * 3 + 2], sx = C.vs[c * 3], sy = C.vs[c * 3 + 1], sz = C.vs[c * 3 + 2];
      const vn = (v[a] - sx) * nx + (v[a + 1] - sy) * ny + (v[a + 2] - sz) * nz, was = C.vn0[c];
      const want = was < -0.2 ? -e * was : 0;
      if (vn > want) { const k = want - vn; v[a] += nx * k; v[a + 1] += ny * k; v[a + 2] += nz * k; }
    }
    if (this.touched && this.touched.size) {
      for (const rb of this.touched) {
        const T = rb.softTurn;
        if (T && (T[0] || T[1] || T[2])) {
          const q = rb.q, dx = T[0] * 0.5, dy = T[1] * 0.5, dz = T[2] * 0.5;
          const nq = [q[0] + dx * q[3] + dy * q[2] - dz * q[1], q[1] + dy * q[3] + dz * q[0] - dx * q[2], q[2] + dz * q[3] + dx * q[1] - dy * q[0], q[3] - dx * q[0] - dy * q[1] - dz * q[2]];
          const l = 1 / Math.sqrt(nq[0] * nq[0] + nq[1] * nq[1] + nq[2] * nq[2] + nq[3] * nq[3]);
          rb.q = nq.map(c => c * l);
          const [X, Y, Z, W] = rb.q;
          rb.ax = [[1 - 2 * (Y * Y + Z * Z), 2 * (X * Y + Z * W), 2 * (X * Z - Y * W)], [2 * (X * Y - Z * W), 1 - 2 * (X * X + Z * Z), 2 * (Y * Z + X * W)], [2 * (X * Z + Y * W), 2 * (Y * Z - X * W), 1 - 2 * (X * X + Y * Y)]];
          T[0] = T[1] = T[2] = 0;
        }
      }
      this.touched.clear();
    }
  }

  end() {
    let points = 0, awake = 0;
    for (const b of this.bodies.values()) points += b.n;
    for (const b of this.awake) {
      awake++;
      const x = b.x, v = b.vel, n = b.n;
      let max2 = 0, bad = false, sx = 0, sy = 0, sz = 0, mean = 0;
      for (let i = 0; i < n; i++) {
        const a = i * 3, vx = v[a], vy = v[a + 1], vz = v[a + 2], s = vx * vx + vy * vy + vz * vz;
        if (s > max2) max2 = s;
        mean += Math.sqrt(s);
        if (s > MAX_SPEED * MAX_SPEED) { const k = MAX_SPEED / Math.sqrt(s); v[a] *= k; v[a + 1] *= k; v[a + 2] *= k; }
        sx += x[a]; sy += x[a + 1]; sz += x[a + 2];
        if (!(x[a] === x[a]) || !(x[a + 1] === x[a + 1]) || !(x[a + 2] === x[a + 2])) bad = true;
      }
      if (bad || !(sx === sx)) { b.restart(); b.hadTrouble = (b.hadTrouble || 0) + 1; continue; }
      this.dampInner(b, this.dt);
      const speed = Math.sqrt(max2);
      if (speed < SLEEP_MAX && mean / n < SLEEP_MEAN && !this.grabs.find(g => g.b === b)) { b.stillFor += this.dt; if (b.stillFor > SLEEP_AFTER && Math.abs(b.growNow - b.P.grow) < 1e-6 && Math.abs(b.airNow - b.P.air) < 1e-6) { b.asleep = true; v.fill(0); } }
      else b.stillFor = 0;
      const o = b.o;
      if (!b.nPinned) {
        if (!b.posAt0) b.posAt0 = [...(o.home || o).pos];
        const c0 = b.centre0;
        o.pos = [b.posAt0[0] + sx / n - c0[0], b.posAt0[1] + sy / n - c0[1], b.posAt0[2] + sz / n - c0[2]];
        if (o.pos[1] < 0) o.pos[1] = 0;
        b.written = { pos: [...o.pos], rot: [...o.rot] };
        o.last = [...o.pos];
      }
      b.drawDirty = true;
    }
    if (this.physics) this.physics.writeBack();
    this.stats = { bodies: this.bodies.size, points, ms: performance.now() - this.t0, contacts: this.contactCount, pairs: this.nPairs, steps: this.nSteps, awake };
  }

  grab(b, at, reach = 0) {
    const r = Math.max(reach, b.meanEdge * 1.6), x = b.x, points = [], off = [];
    for (let i = 0; i < b.n; i++) {
      const dx = x[i * 3] - at[0], dy = x[i * 3 + 1] - at[1], dz = x[i * 3 + 2] - at[2];
      if (dx * dx + dy * dy + dz * dz < r * r) { points.push(i); off.push(dx, dy, dz); }
    }
    if (!points.length) { const i = b.nearestPoint(at); points.push(i); off.push(x[i * 3] - at[0], x[i * 3 + 1] - at[1], x[i * 3 + 2] - at[2]); }
    const g = { b, at: [...at], points: Int32Array.from(points), off: Float64Array.from(off), k: Math.max(b.total * this.gravity * 40 / points.length, 40) };
    this.grabs.push(g);
    b.asleep = false; b.stillFor = 0;
    return g;
  }
  letGo(g) { this.grabs = this.grabs.filter(x => x !== g); if (g && g.b) g.b.asleep = false; }

  bodyOf(o) { return this.bodies.get(o.id) || null; }
}
