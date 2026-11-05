
self.onmessage = e => {
  const { positions, prop, res: N, pad: P } = e.data;
  const t0 = performance.now();
  const field = bake(positions, prop, N, P);
  self.postMessage({ field, ms: performance.now() - t0 }, [field.buffer]);
};

function bake(pos, prop, N, P) {
  const cells = N * N * N;
  const dist = new Float32Array(cells).fill(Infinity);
  const side = new Int8Array(cells);
  const cell = [2 * P / N * prop[0], 2 * P / N * prop[1], 2 * P / N * prop[2]];
  const band = 1.5;
  const toIdx = (v, k) => (v / prop[k] + P) / (2 * P) * N - 0.5;
  const tri = new Float64Array(9);
  for (let t = 0; t < pos.length; t += 9) {
    for (let k = 0; k < 9; k++) tri[k] = pos[t + k] * prop[k % 3];
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = toIdx(tri[k], k), b = toIdx(tri[3 + k], k), c = toIdx(tri[6 + k], k);
      lo[k] = Math.max(0, Math.floor(Math.min(a, b, c) - band));
      hi[k] = Math.min(N - 1, Math.ceil(Math.max(a, b, c) + band));
    }
    const nx0 = (tri[4] - tri[1]) * (tri[8] - tri[2]) - (tri[5] - tri[2]) * (tri[7] - tri[1]);
    const ny0 = (tri[5] - tri[2]) * (tri[6] - tri[0]) - (tri[3] - tri[0]) * (tri[8] - tri[2]);
    const nz0 = (tri[3] - tri[0]) * (tri[7] - tri[1]) - (tri[4] - tri[1]) * (tri[6] - tri[0]);
    for (let z = lo[2]; z <= hi[2]; z++) {
      const pz = (-P + (z + 0.5) * 2 * P / N) * prop[2];
      for (let y = lo[1]; y <= hi[1]; y++) {
        const py = (-P + (y + 0.5) * 2 * P / N) * prop[1];
        for (let x = lo[0]; x <= hi[0]; x++) {
          const px = (-P + (x + 0.5) * 2 * P / N) * prop[0];
          const c = closest(px, py, pz, tri);
          const dx = px - c[0], dy = py - c[1], dz = pz - c[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const i = x + N * (y + N * z);
          if (d < dist[i]) { dist[i] = d; side[i] = dx * nx0 + dy * ny0 + dz * nz0 >= 0 ? 1 : -1; }
        }
      }
    }
  }

  const wall = 0.6 * Math.max(...cell);
  const out = new Uint8Array(cells);
  const queue = new Int32Array(cells);
  let qh = 0, qt = 0;
  const push = i => { if (!out[i] && !(dist[i] < wall)) { out[i] = 1; queue[qt++] = i; } };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x === 0 || y === 0 || z === 0 || x === N - 1 || y === N - 1 || z === N - 1) push(x + N * (y + N * z));
  }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
    if (x > 0) push(i - 1); if (x < N - 1) push(i + 1);
    if (y > 0) push(i - N); if (y < N - 1) push(i + N);
    if (z > 0) push(i - N * N); if (z < N - 1) push(i + N * N);
  }

  const offs = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue;
    offs.push([dx, dy, dz, Math.hypot(dx * cell[0], dy * cell[1], dz * cell[2])]);
  }
  const before = offs.filter(([dx, dy, dz]) => dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))));
  const after = offs.filter(o => !before.includes(o));
  const sweep = (list, forward) => {
    for (let zz = 0; zz < N; zz++) {
      const z = forward ? zz : N - 1 - zz;
      for (let yy = 0; yy < N; yy++) {
        const y = forward ? yy : N - 1 - yy;
        for (let xx = 0; xx < N; xx++) {
          const x = forward ? xx : N - 1 - xx;
          const i = x + N * (y + N * z);
          let d = dist[i];
          for (const [dx, dy, dz, w] of list) {
            const X = x + dx, Y = y + dy, Z = z + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N) continue;
            const v = dist[X + N * (Y + N * Z)] + w;
            if (v < d) d = v;
          }
          dist[i] = d;
        }
      }
    }
  };
  for (let r = 0; r < 2; r++) { sweep(before, true); sweep(after, false); }

  const field = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    const d = Number.isFinite(dist[i]) ? dist[i] : 2 * P;
    const inside = dist[i] < wall ? side[i] < 0 : !out[i];
    field[i] = inside ? -d : d;
  }
  return field;
}

function closest(px, py, pz, t) {
  const ax = t[0], ay = t[1], az = t[2], bx = t[3], by = t[4], bz = t[5], cx = t[6], cy = t[7], cz = t[8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [bx, by, bz];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [ax + v * abx, ay + v * aby, az + v * abz]; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [cx, cy, cz];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [ax + w * acx, ay + w * acy, az + w * acz]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)];
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}
