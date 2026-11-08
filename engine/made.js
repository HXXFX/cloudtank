import { shapeSdf } from './sdf.js';
import { eulerAxes } from './math.js';
import { ATLAS_RES, ATLAS_PAD } from './sdf.wgsl.js';

export const MADE_KINDS = { spin: 'Spin', channel: 'Channel', combine: 'Combined' };
export const PART_OPS = [['add', 'Add'], ['cut', 'Cut'], ['overlap', 'Overlap']];


function pieces(pts) {
  const S = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 1e-6) continue;
    S.push({ ax, ay, bx, by, dx: (bx - ax) / l, dy: (by - ay) / l, l,
      x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) });
  }
  return S;
}

function nearest(S, px, py) {
  let best = Infinity, cx = 0, cy = 0, at = S[0];
  for (const s of S) {
    const ox = px < s.x0 ? s.x0 - px : px > s.x1 ? px - s.x1 : 0, oy = py < s.y0 ? s.y0 - py : py > s.y1 ? py - s.y1 : 0;
    if (ox * ox + oy * oy >= best) continue;
    let t = (px - s.ax) * s.dx + (py - s.ay) * s.dy;
    t = t < 0 ? 0 : t > s.l ? s.l : t;
    const qx = s.ax + s.dx * t, qy = s.ay + s.dy * t;
    const d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d < best) { best = d; cx = qx; cy = qy; at = s; }
  }
  return { d: Math.sqrt(best), cx, cy, s: at };
}

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a, b, k) => -smin(-a, -b, k);


const cache = new Map();
export function madeShape(recipe) {
  const key = JSON.stringify(recipe);
  let s = cache.get(key);
  if (!s) {
    s = recipe.kind === 'spin' ? spinShape(recipe) : recipe.kind === 'channel' ? channelShape(recipe) : combineShape(recipe);
    if (cache.size > 24) cache.clear();
    cache.set(key, s);
  }
  return s;
}

function spinShape({ outline, wall }) {
  const pts = outline.map(([x, y]) => [Math.abs(x), y]);
  const S = pieces(pts), t = wall / 2;
  let R = 0, Y = 0;
  for (const [r, y] of pts) { R = Math.max(R, r); Y = Math.max(Y, y); }
  const f = (x, y, z) => Math.max(nearest(S, Math.sqrt(x * x + z * z), y).d - t, -y);
  return { f, lo: [-R - t, 0, -R - t], hi: [R + t, Y + t, R + t] };
}

function channelShape({ path, radius, wall }) {
  let pts = path.map(p => [p[0], p[1]]);
  if (pts[0][1] < pts[pts.length - 1][1]) pts.reverse();
  const S = pieces(pts);
  for (const s of S) { let nx = -s.dy, ny = s.dx; if (ny < 0) { nx = -nx; ny = -ny; } s.nx = nx; s.ny = ny; }
  const last = S[S.length - 1], ex = last.bx, ey = last.by;
  const mid = radius + wall / 2, half = wall / 2;
  const f = (x, y, z) => {
    const n = nearest(S, x, y);
    const d3 = Math.sqrt(n.d * n.d + z * z);
    const shell = Math.abs(d3 - mid) - half;
    const open = (x - n.cx) * n.s.nx + (y - n.cy) * n.s.ny;
    const end = (x - ex) * last.dx + (y - ey) * last.dy;
    return Math.max(shell, open, end, -y);
  };
  let lx = Infinity, hx = -Infinity, hy = -Infinity;
  for (const [x, y] of pts) { lx = Math.min(lx, x); hx = Math.max(hx, x); hy = Math.max(hy, y); }
  const o = radius + wall;
  return { f, lo: [lx - o, 0, -o], hi: [hx + o, hy + o, o] };
}

function partDist(part) {
  const it = part.item, ax = eulerAxes(it.rot), s = it.size, [px, py, pz] = it.pos;
  const local = (x, y, z) => {
    const dx = x - px, dy = y - py, dz = z - pz;
    return [dx * ax[0][0] + dy * ax[0][1] + dz * ax[0][2], dx * ax[1][0] + dy * ax[1][1] + dz * ax[1][2], dx * ax[2][0] + dy * ax[2][1] + dz * ax[2][2]];
  };
  if (it.made && part.frame) {
    const g = madeShape(it.made).f, C = part.frame.centre, F = part.frame.half;
    const k = Math.min(s[0] / F[0], s[1] / F[1], s[2] / F[2]);
    return (x, y, z) => { const [a, b, c] = local(x, y, z); return g(C[0] + a * F[0] / s[0], C[1] + b * F[1] / s[1], C[2] + c * F[2] / s[2]) * k; };
  }
  return (x, y, z) => { const [a, b, c] = local(x, y, z); return shapeSdf(a, b, c, it, null); };
}

function partBox(it) {
  const ax = eulerAxes(it.rot), s = it.size;
  const e = [0, 1, 2].map(k => Math.abs(ax[0][k]) * s[0] + Math.abs(ax[1][k]) * s[1] + Math.abs(ax[2][k]) * s[2]);
  return { lo: it.pos.map((v, k) => v - e[k]), hi: it.pos.map((v, k) => v + e[k]) };
}

function combineShape({ parts, blend }) {
  const k = Math.max(blend || 0, 0);
  const add = [], cut = [], keep = [];
  for (const p of parts) (p.op === 'cut' ? cut : p.op === 'overlap' ? keep : add).push(partDist(p));
  const f = (x, y, z) => {
    let d = 1e9;
    for (const g of add) d = smin(d, g(x, y, z), k);
    if (cut.length) { let c = 1e9; for (const g of cut) c = Math.min(c, g(x, y, z)); d = smax(d, -c, k); }
    for (const g of keep) d = smax(d, g(x, y, z), k);
    return d;
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    if (p.op === 'cut') continue;
    const b = partBox(p.item);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i] - k); hi[i] = Math.max(hi[i], b.hi[i] + k); }
  }
  if (!Number.isFinite(lo[0])) for (let i = 0; i < 3; i++) { lo[i] = -0.1; hi[i] = 0.1; }
  return { f, lo, hi };
}

export function partsBox(items) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const it of items) { const b = partBox(it); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]); } }
  return { lo, hi };
}


export function tidyStroke(pts, floor = 0) {
  let out = [pts[0]];
  for (const p of pts) { const q = out[out.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.02) out.push(p); }
  if (out.length < 2) out.push(pts[pts.length - 1]);
  for (let n = 0; n < 2; n++) {
    const r = [out[0]];
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      r.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    r.push(out[out.length - 1]); out = r;
  }
  out = thin(out, 0.001);
  return out.map(([x, y]) => [+x.toFixed(4), +Math.max(y, floor).toFixed(4)]);
}
function thin(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), [ax, ay] = pts[a], [bx, by] = pts[b], l = Math.hypot(bx - ax, by - ay) || 1e-9;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / l; if (d > fd) { fd = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}


const VASE = [[0, 0.025], [0.2, 0.025], [0.3, 0.1], [0.34, 0.25], [0.3, 0.42], [0.2, 0.56], [0.17, 0.66], [0.22, 0.74]];
const SLIDE = [[-0.7, 0.95], [-0.45, 0.82], [-0.2, 0.62], [0.05, 0.45], [0.3, 0.33], [0.55, 0.28], [0.75, 0.27]];
export function startRecipe(kind, cell = 0.03) {
  const wall = +Math.max(0.04, 1.5 * cell).toFixed(3);
  if (kind === 'spin') return { kind, outline: tidyStroke(VASE.map(([x, y]) => [x * 0.7, y * 0.7]), wall / 2), wall };
  return { kind, path: tidyStroke(SLIDE.map(([x, y]) => [x * 0.6, y * 0.6]), 0), radius: +Math.max(0.07, 1.2 * cell).toFixed(3), wall };
}


const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function sampleGrid(f, L, n, cell, skip = true) {
  const [nx, ny, nz] = n, val = new Float32Array(nx * ny * nz), B = skip ? 4 : 1;
  const reach = (B / 2 * Math.sqrt(3) + 2.5) * cell;
  let evals = 0;
  for (let bz = 0; bz < nz; bz += B) for (let by = 0; by < ny; by += B) for (let bx = 0; bx < nx; bx += B) {
    const ex = Math.min(bx + B, nx), ey = Math.min(by + B, ny), ez = Math.min(bz + B, nz);
    const d = f(L[0] + (bx + ex - 1) / 2 * cell, L[1] + (by + ey - 1) / 2 * cell, L[2] + (bz + ez - 1) / 2 * cell); evals++;
    const far = skip && Math.abs(d) > reach;
    if (!skip) { val[bx + nx * (by + ny * bz)] = d; continue; }
    for (let k = bz; k < ez; k++) for (let j = by; j < ey; j++) for (let i = bx; i < ex; i++) {
      const at = i + nx * (j + ny * k);
      if (far) val[at] = d;
      else { val[at] = f(L[0] + i * cell, L[1] + j * cell, L[2] + k * cell); evals++; }
    }
  }
  return { val, evals };
}

export function meshOf(shape, most = 110, { skip = true } = {}) {
  const t0 = performance.now();
  const { f } = shape;
  const span = Math.max(...shape.hi.map((v, k) => v - shape.lo[k]));
  const cell = Math.max(span / most, 0.004);
  const L = shape.lo.map(v => v - 2 * cell), H = shape.hi.map(v => v + 2 * cell);
  const n = L.map((v, k) => Math.ceil((H[k] - v) / cell) + 1), [nx, ny, nz] = n;
  const { val, evals } = sampleGrid(f, L, n, cell, skip);
  const at = (i, j, k) => i + nx * (j + ny * k);

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const vertOf = new Int32Array(cx * cy * cz).fill(-1);
  const V = [], v8 = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) { const C = CORNERS[c]; v8[c] = val[at(i + C[0], j + C[1], k + C[2])]; if (v8[c] < 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [e0, e1] of EDGES) {
      const a = v8[e0], b = v8[e1];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b), A = CORNERS[e0], B = CORNERS[e1];
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; m++;
    }
    vertOf[i + cx * (j + cy * k)] = V.length / 3;
    V.push(L[0] + (i + sx / m) * cell, L[1] + (j + sy / m) * cell, L[2] + (k + sz / m) * cell);
  }

  const N = new Float32Array(V.length), e = cell * 0.5;
  for (let v = 0; v < V.length; v += 3) {
    const x = V[v], y = V[v + 1], z = V[v + 2];
    const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    N[v] = gx / l; N[v + 1] = gy / l; N[v + 2] = gz / l;
  }

  const tris = [];
  const cellAt = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) ? -1 : vertOf[i + cx * (j + cy * k)];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = val[at(i, j, k)];
    for (let ax = 0; ax < 3; ax++) {
      const i1 = i + (ax === 0), j1 = j + (ax === 1), k1 = k + (ax === 2);
      if (i1 >= nx || j1 >= ny || k1 >= nz) continue;
      if ((a < 0) === (val[at(i1, j1, k1)] < 0)) continue;
      let q;
      if (ax === 0) q = [cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k)];
      else if (ax === 1) q = [cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1)];
      else q = [cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k)];
      if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[3] < 0) continue;
      const out = a < 0 ? 1 : -1;
      const p0 = q[0] * 3, p1 = q[1] * 3, p2 = q[2] * 3;
      const u = [V[p1] - V[p0], V[p1 + 1] - V[p0 + 1], V[p1 + 2] - V[p0 + 2]], w = [V[p2] - V[p0], V[p2 + 1] - V[p0 + 1], V[p2 + 2] - V[p0 + 2]];
      const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if (c[ax] * out < 0) q.reverse();
      tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  }
  const positions = new Float32Array(tris.length * 3), normals = new Float32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) for (let c = 0; c < 3; c++) {
    positions[t * 3 + c] = V[tris[t] * 3 + c];
    normals[t * 3 + c] = N[tris[t] * 3 + c];
  }
  return { positions, normals, triangles: tris.length / 3, cell, evals, ms: performance.now() - t0 };
}

export function boundsOf(positions) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = positions[i + k];
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  return { centre: lo.map((v, k) => (v + hi[k]) / 2), half: lo.map((v, k) => (hi[k] - v) / 2) };
}

export function fieldOf(shape, centre, h) {
  const t0 = performance.now(), N = ATLAS_RES, P = ATLAS_PAD, big = Math.max(...h);
  const step = 2 * P / N, L = centre.map((c, k) => c + (-P + 0.5 * step) * h[k]);
  const f = shape.f, field = new Float32Array(N * N * N);
  for (let k = 0; k < N; k++) {
    const z = L[2] + k * step * h[2];
    for (let j = 0; j < N; j++) {
      const y = L[1] + j * step * h[1];
      for (let i = 0; i < N; i++) field[i + N * (j + N * k)] = f(L[0] + i * step * h[0], y, z) / big;
    }
  }
  return { field, ms: performance.now() - t0 };
}

export const guardHalf = half => { const big = Math.max(...half); return half.map(v => Math.max(v, big * 0.01)); };
