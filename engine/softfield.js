import { toHalf } from './math.js';
import { ATLAS_RES, ATLAS_PAD } from './sdf.wgsl.js';

const N = ATLAS_RES, FAR = 1;

export class SoftField {
  constructor() {
    this.dist = new Float32Array(N * N * N);
    this.half = new Uint16Array(N * N * N);
    this.flood = new Uint8Array(N * N * N);
    this.stack = new Int32Array(N * N * N);
    this.farHalf = toHalf(FAR);
    this.touched = new Int32Array(N * N * N);
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
    const cell = [2 * ATLAS_PAD * size[0] / N, 2 * ATLAS_PAD * size[1] / N, 2 * ATLAS_PAD * size[2] / N];
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
      for (let kz = Math.max(gz - rz, 0), ez = Math.min(gz + rz + 1, N - 1); kz <= ez; kz++) {
        const dz = oz + (kz + 0.5) * cell[2] - Z;
        for (let ky = Math.max(gy - ry, 0), ey = Math.min(gy + ry + 1, N - 1); ky <= ey; ky++) {
          const dy = oy + (ky + 0.5) * cell[1] - Y, d2yz = dy * dy + dz * dz;
          if (d2yz > r2) continue;
          for (let kx = Math.max(gx - rx, 0), ex = Math.min(gx + rx + 1, N - 1); kx <= ex; kx++) {
            const dx = ox + (kx + 0.5) * cell[0] - X, d2 = dx * dx + d2yz;
            if (d2 > r2) continue;
            const k = kx + N * (ky + N * kz), d = Math.sqrt(d2) + 1e-6;
            const was = dist[k];
            if (was === 0) { touched[count++] = k; dist[k] = d; }
            else if (d < was) dist[k] = d;
          }
        }
      }
    }
    this.touchedCount = count;
    const inside = b.closed;
    const flood = this.flood;
    let closedInside = false;
    if (inside) {
      flood.fill(0);
      const stack = this.stack, wall = Math.max(b.meanEdge * 0.75, Math.max(cell[0], cell[1], cell[2]) * 0.9);
      let top = 0;
      const push = k => { if (!flood[k] && !(dist[k] > 0 && dist[k] < wall)) { flood[k] = 1; stack[top++] = k; } };
      for (let a = 0; a < N; a++) for (let c = 0; c < N; c++) { push(a + N * (c + N * 0)); push(a + N * (c + N * (N - 1))); push(a + N * (0 + N * c)); push(a + N * ((N - 1) + N * c)); push(0 + N * (a + N * c)); push((N - 1) + N * (a + N * c)); }
      const NN = N * N;
      while (top) {
        const k = stack[--top], kx = k % N, ky = ((k / N) | 0) % N, kz = (k / NN) | 0;
        if (kx > 0) push(k - 1); if (kx < N - 1) push(k + 1);
        if (ky > 0) push(k - N); if (ky < N - 1) push(k + N);
        if (kz > 0) push(k - NN); if (kz < N - 1) push(k + NN);
      }
      closedInside = true;
    }
    const toGrid = 1 / big, farH = this.farHalf, surfaceAt = thick;
    half.fill(farH);
    for (let c = 0; c < count; c++) { const k = touched[c]; half[k] = toHalf((dist[k] - surfaceAt) * toGrid); }
    if (closedInside) {
      const deep = toHalf(-big * 0.5 * toGrid);
      for (let k = 0; k < flood.length; k++) if (!flood[k] && !(dist[k] > 0)) half[k] = deep;
    }
    return { pos, size, prop, vel: [vx / Math.max(nS, 1), vy / Math.max(nS, 1), vz / Math.max(nS, 1)], spin: [0, 0, 0] };
  }
}
