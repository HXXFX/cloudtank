import { toHalf } from './math.js';
import { ATLAS_RES, ATLAS_PAD } from './sdf.wgsl.js';

const N = ATLAS_RES, FAR = 1;
const COARSEST = 4;

export class SoftField {
  constructor() {
    this.dist = new Float32Array(N * N * N);
    this.half = new Uint16Array(N * N * N);
    this.flood = new Uint8Array(N * N * N);
    this.stack = new Int32Array(N * N * N);
    this.farHalf = toHalf(FAR);
    this.touched = new Int32Array(N * N * N);
    this.coarse = new Map();
    this.factor = 1;
    this.coarsest = COARSEST;
  }

  build(b, thick) {
    const x = b.x, surf = b.surf, nS = surf.length, dist = this.dist, half = this.half;
    let lx = 1e9, ly = 1e9, lz = 1e9, hx = -1e9, hy = -1e9, hz = -1e9, vx = 0, vy = 0, vz = 0;
    const vel = b.vel;
    for (let c = 0; c < nS; c++) {
      const i = surf[c] * 3, X = x[i], Y = x[i + 1], Z = x[i + 2];
      if (X < lx) lx = X; if (X > hx) hx = X;
      if (Y < ly) ly = Y; if (Y > hy) hy = Y;
      if (Z < lz) lz = Z; if (Z > hz) hz = Z;
      vx += vel[i]; vy += vel[i + 1]; vz += vel[i + 2];
    }
    const pos = [(lx + hx) / 2, (ly + hy) / 2, (lz + hz) / 2];
    const size = [Math.max((hx - lx) / 2 + thick * 1.6, 0.02), Math.max((hy - ly) / 2 + thick * 1.6, 0.02), Math.max((hz - lz) / 2 + thick * 1.6, 0.02)];
    const big = Math.max(size[0], size[1], size[2]);
    const prop = [size[0] / big, size[1] / big, size[2] / big];
    const fullCell = 2 * ATLAS_PAD * big / N;
    let f = 1;
    while (f < this.coarsest && fullCell * f * 2 <= thick / 3) f *= 2;
    const M = N / f, MM = M * M, MMM = MM * M;
    this.factor = f;
    const cell = [2 * ATLAS_PAD * size[0] / M, 2 * ATLAS_PAD * size[1] / M, 2 * ATLAS_PAD * size[2] / M];
    const ix = 1 / cell[0], iy = 1 / cell[1], iz = 1 / cell[2];
    const ox = pos[0] - ATLAS_PAD * size[0], oy = pos[1] - ATLAS_PAD * size[1], oz = pos[2] - ATLAS_PAD * size[2];
    const prev = this.touchedCount || 0, touched = this.touched;
    for (let c = 0; c < prev; c++) { const k = touched[c]; dist[k] = 0; half[k] = 0; }
    let count = 0;
    const reach = thick + b.meanEdge * 0.45;
    const rx = Math.ceil(reach * ix), ry = Math.ceil(reach * iy), rz = Math.ceil(reach * iz), r2 = reach * reach;
    const mA = b.midA, mB = b.midB, nM = mA.length;
    for (let c = 0; c < nS + nM; c++) {
      let X, Y, Z;
      if (c < nS) { const i = surf[c] * 3; X = x[i]; Y = x[i + 1]; Z = x[i + 2]; }
      else { const a = mA[c - nS] * 3, e = mB[c - nS] * 3; X = (x[a] + x[e]) * 0.5; Y = (x[a + 1] + x[e + 1]) * 0.5; Z = (x[a + 2] + x[e + 2]) * 0.5; }
      const gx = Math.floor((X - ox) * ix - 0.5), gy = Math.floor((Y - oy) * iy - 0.5), gz = Math.floor((Z - oz) * iz - 0.5);
      for (let kz = Math.max(gz - rz, 0), ez = Math.min(gz + rz + 1, M - 1); kz <= ez; kz++) {
        const dz = oz + (kz + 0.5) * cell[2] - Z;
        for (let ky = Math.max(gy - ry, 0), ey = Math.min(gy + ry + 1, M - 1); ky <= ey; ky++) {
          const dy = oy + (ky + 0.5) * cell[1] - Y, d2yz = dy * dy + dz * dz;
          if (d2yz > r2) continue;
          for (let kx = Math.max(gx - rx, 0), ex = Math.min(gx + rx + 1, M - 1); kx <= ex; kx++) {
            const dx = ox + (kx + 0.5) * cell[0] - X, d2 = dx * dx + d2yz;
            if (d2 > r2) continue;
            const k = kx + M * (ky + M * kz), d = Math.sqrt(d2) + 1e-6;
            const was = dist[k];
            if (was === 0) { touched[count++] = k; dist[k] = d; }
            else if (d < was) dist[k] = d;
          }
        }
      }
    }
    this.touchedCount = count;
    if (!b.fieldFrom || b.fieldFrom.length !== nS * 3) b.fieldFrom = new Float32Array(nS * 3);
    for (let c = 0; c < nS; c++) { const i = surf[c] * 3; b.fieldFrom[c * 3] = x[i]; b.fieldFrom[c * 3 + 1] = x[i + 1]; b.fieldFrom[c * 3 + 2] = x[i + 2]; }
    const inside = b.closed;
    const flood = this.flood;
    let closedInside = false;
    if (inside) {
      flood.fill(0, 0, MMM);
      const stack = this.stack, wall = Math.max(b.meanEdge * 0.75, Math.max(cell[0], cell[1], cell[2]) * 0.9);
      let top = 0;
      const push = k => { if (!flood[k] && !(dist[k] > 0 && dist[k] < wall)) { flood[k] = 1; stack[top++] = k; } };
      for (let a = 0; a < M; a++) for (let c = 0; c < M; c++) { push(a + M * (c + M * 0)); push(a + M * (c + M * (M - 1))); push(a + M * (0 + M * c)); push(a + M * ((M - 1) + M * c)); push(0 + M * (a + M * c)); push((M - 1) + M * (a + M * c)); }
      while (top) {
        const k = stack[--top], kx = k % M, ky = ((k / M) | 0) % M, kz = (k / MM) | 0;
        if (kx > 0) push(k - 1); if (kx < M - 1) push(k + 1);
        if (ky > 0) push(k - M); if (ky < M - 1) push(k + M);
        if (kz > 0) push(k - MM); if (kz < M - 1) push(k + MM);
      }
      closedInside = true;
    }
    const toGrid = 1 / big, farH = this.farHalf, surfaceAt = thick;
    if (f === 1) {
      half.fill(farH);
      for (let c = 0; c < count; c++) { const k = touched[c]; half[k] = toHalf((dist[k] - surfaceAt) * toGrid); }
      if (closedInside) {
        const deep = toHalf(-big * 0.5 * toGrid);
        for (let k = 0; k < flood.length; k++) if (!flood[k] && !(dist[k] > 0)) half[k] = deep;
      }
    } else {
      const C = this.coarseFor(f), V = C.values, edge = Math.fround((reach - surfaceAt) * toGrid);
      V.fill(edge);
      for (let c = 0; c < count; c++) { const k = touched[c]; V[k] = (dist[k] - surfaceAt) * toGrid; }
      if (closedInside) {
        const deep = -big * 0.5 * toGrid;
        for (let k = 0; k < MMM; k++) if (!flood[k] && !(dist[k] > 0)) V[k] = deep;
      }
      this.spread(C, M, edge);
    }
    return { pos, size, prop, vel: [vx / Math.max(nS, 1), vy / Math.max(nS, 1), vz / Math.max(nS, 1)], spin: [0, 0, 0] };
  }

  coarseFor(f) {
    let C = this.coarse.get(f);
    if (C) return C;
    const M = N / f, lo = new Int32Array(N), hi = new Int32Array(N), t = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = (i + 0.5) / f - 0.5;
      let a = Math.floor(c), u = c - a;
      if (a < 0) { a = 0; u = 0; }
      if (a >= M - 1) { a = M - 1; u = 0; }
      lo[i] = a; hi[i] = Math.min(a + 1, M - 1); t[i] = u;
    }
    C = { values: new Float32Array(M * M * M), alongX: new Float32Array(N * M * M), alongXY: new Float32Array(N * N * M), lo, hi, t };
    this.coarse.set(f, C);
    return C;
  }

  spread(C, M, edge) {
    const V = C.values, A = C.alongX, B = C.alongXY, lo = C.lo, hi = C.hi, t = C.t, half = this.half, farH = this.farHalf, NN = N * N;
    for (let z = 0; z < M; z++) for (let y = 0; y < M; y++) {
      const r = M * (y + M * z), w = N * (y + M * z);
      for (let i = 0; i < N; i++) { const a = V[r + lo[i]]; A[w + i] = a + (V[r + hi[i]] - a) * t[i]; }
    }
    for (let z = 0; z < M; z++) for (let j = 0; j < N; j++) {
      const r0 = N * (lo[j] + M * z), r1 = N * (hi[j] + M * z), w = N * (j + N * z), u = t[j];
      for (let i = 0; i < N; i++) { const a = A[r0 + i]; B[w + i] = a + (A[r1 + i] - a) * u; }
    }
    for (let k = 0; k < N; k++) {
      const p0 = NN * lo[k], p1 = NN * hi[k], w = NN * k, u = t[k];
      for (let i = 0; i < NN; i++) { const a = B[p0 + i], v = a + (B[p1 + i] - a) * u; half[w + i] = v >= edge ? farH : toHalf(v); }
    }
  }

  still(b, tol) {
    const F = b.fieldFrom, x = b.x, surf = b.surf, nS = surf.length, vel = b.vel, t2 = tol * tol;
    if (!F || F.length !== nS * 3) return null;
    let vx = 0, vy = 0, vz = 0;
    for (let c = 0; c < nS; c++) {
      const i = surf[c] * 3, dx = x[i] - F[c * 3], dy = x[i + 1] - F[c * 3 + 1], dz = x[i + 2] - F[c * 3 + 2];
      if (dx * dx + dy * dy + dz * dz > t2) return null;
      vx += vel[i]; vy += vel[i + 1]; vz += vel[i + 2];
    }
    return [vx / Math.max(nS, 1), vy / Math.max(nS, 1), vz / Math.max(nS, 1)];
  }
}
