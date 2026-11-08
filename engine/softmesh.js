import { shapeSdf, shapeNormal } from './sdf.js';

const MAX_RENDER_TRIS = 60000;
const key3 = (x, y, z, tol) => (Math.round(x / tol) + 65536) * 17179869184 + (Math.round(y / tol) + 65536) * 131072 + (Math.round(z / tol) + 65536);


export function surfaceOf(o, mesh, uvs, parts) {
  const s = o.size;
  if (o.shape === 'plane') {
    const v = [-s[0], 0, -s[2], s[0], 0, -s[2], s[0], 0, s[2], -s[0], 0, s[2]];
    return { v, t: [0, 2, 1, 0, 3, 2], n: Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), uv: null, part: null };
  }
  const corners = mesh.length / 6, ext = Math.max(s[0], s[1], s[2]), tol = ext / 60000;
  const at = new Map(), v = [], t = [], n = [], uv = uvs ? [] : null, part = parts ? [] : null;
  let which = 0;
  for (let c = 0; c + 2 < corners; c += 3) {
    const ids = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const i = (c + k) * 6, x = mesh[i] * s[0], y = mesh[i + 1] * s[1], z = mesh[i + 2] * s[2], key = key3(x, y, z, tol);
      let id = at.get(key);
      if (id === undefined) { id = v.length / 3; v.push(x, y, z); at.set(key, id); }
      ids[k] = id;
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    t.push(ids[0], ids[1], ids[2]);
    for (let k = 0; k < 3; k++) {
      const i = (c + k) * 6, nx = mesh[i + 3] / s[0], ny = mesh[i + 4] / s[1], nz = mesh[i + 5] / s[2], l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      n.push(nx / l, ny / l, nz / l);
      if (uv) uv.push(uvs[(c + k) * 2], uvs[(c + k) * 2 + 1]);
    }
    if (part) {
      while (which < parts.length - 1 && c >= parts[which].first + parts[which].count) which++;
      part.push(which);
    }
  }
  return { v, t, n, uv, part };
}

const dist2 = (v, a, b) => { const dx = v[a * 3] - v[b * 3], dy = v[a * 3 + 1] - v[b * 3 + 1], dz = v[a * 3 + 2] - v[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; };

export function refine(S, h, maxTris = MAX_RENDER_TRIS) {
  const h2 = h * h * 1.21;
  for (let pass = 0; pass < 24; pass++) {
    const T = S.t.length / 3, t = [], n = [], uv = S.uv ? [] : null, part = S.part ? [] : null, mid = new Map(), v = S.v;
    let any = false;
    const base = v.length;
    const midOf = (a, b) => {
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      let m = mid.get(key);
      if (m === undefined) { m = v.length / 3; v.push((v[a * 3] + v[b * 3]) / 2, (v[a * 3 + 1] + v[b * 3 + 1]) / 2, (v[a * 3 + 2] + v[b * 3 + 2]) / 2); mid.set(key, m); }
      return m;
    };
    for (let f = 0; f < T; f++) {
      const id = [S.t[f * 3], S.t[f * 3 + 1], S.t[f * 3 + 2]];
      const longE = [dist2(v, id[0], id[1]) > h2, dist2(v, id[1], id[2]) > h2, dist2(v, id[2], id[0]) > h2];
      const cuts = longE[0] + longE[1] + longE[2];
      const nOf = c => [S.n[(f * 3 + c) * 3], S.n[(f * 3 + c) * 3 + 1], S.n[(f * 3 + c) * 3 + 2]];
      const uvOf = c => (S.uv ? [S.uv[(f * 3 + c) * 2], S.uv[(f * 3 + c) * 2 + 1]] : null);
      const out = (a, b, c) => {
        for (const q of [a, b, c]) {
          t.push(q.v); n.push(q.n[0], q.n[1], q.n[2]);
          if (uv) uv.push(q.uv[0], q.uv[1]);
        }
        if (part) part.push(S.part[f]);
      };
      const corner = c => ({ v: id[c], n: nOf(c), uv: uvOf(c) });
      const between = (a, b) => {
        const x = [a.n[0] + b.n[0], a.n[1] + b.n[1], a.n[2] + b.n[2]], l = Math.sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) || 1;
        return { v: midOf(a.v, b.v), n: [x[0] / l, x[1] / l, x[2] / l], uv: a.uv ? [(a.uv[0] + b.uv[0]) / 2, (a.uv[1] + b.uv[1]) / 2] : null };
      };
      if (!cuts) { out(corner(0), corner(1), corner(2)); continue; }
      any = true;
      const start = cuts === 3 ? 0 : cuts === 1 ? longE.indexOf(true) : !longE[2] ? 0 : !longE[0] ? 1 : 2;
      const A = corner(start), B = corner((start + 1) % 3), C = corner((start + 2) % 3);
      if (cuts === 1) { const m = between(A, B); out(A, m, C); out(m, B, C); }
      else if (cuts === 2) {
        const m = between(A, B), p = between(B, C);
        out(m, B, p);
        if (dist2(v, A.v, p.v) < dist2(v, m.v, C.v)) { out(A, m, p); out(A, p, C); } else { out(A, m, C); out(m, p, C); }
      } else {
        const m = between(A, B), p = between(B, C), q = between(C, A);
        out(A, m, q); out(m, B, p); out(q, p, C); out(m, p, q);
      }
    }
    S.t = t; S.n = n; S.uv = uv; S.part = part;
    if (!any || t.length / 3 > maxTris) break;
  }
  return S;
}

export function collapseShort(S, h) {
  const V = S.v.length / 3, T = S.t.length / 3, v = S.v.slice(), t = S.t.slice();
  const nbrs = Array.from({ length: V }, () => new Set()), tris = Array.from({ length: V }, () => []);
  const on = new Map();
  const ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let f = 0; f < T; f++) {
    for (let k = 0; k < 3; k++) {
      const a = t[f * 3 + k], b = t[f * 3 + (k + 1) % 3];
      nbrs[a].add(b); nbrs[b].add(a); tris[a].push(f);
      const e = ek(a, b); on.set(e, (on.get(e) || 0) + 1);
    }
  }
  const boundary = new Uint8Array(V);
  for (const [e, c] of on) if (c !== 2) { boundary[Math.floor(e / 4294967296)] = 1; boundary[e % 4294967296] = 1; }
  const parent = new Int32Array(V).map((_, i) => i), alive = new Uint8Array(T).fill(1);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const h2 = h * h;
  for (let pass = 0; pass < 6; pass++) {
    const list = [];
    for (let f = 0; f < T; f++) if (alive[f]) for (let k = 0; k < 3; k++) {
      const a = find(t[f * 3 + k]), b = find(t[f * 3 + (k + 1) % 3]);
      if (a < b) { const d = dist2(v, a, b); if (d < h2) list.push([d, a, b]); }
    }
    if (!list.length) break;
    list.sort((p, q) => p[0] - q[0]);
    let did = 0;
    for (const [d0, a0, b0] of list) {
      let a = find(a0), b = find(b0);
      if (a === b || dist2(v, a, b) > h2) continue;
      if (boundary[a] && !boundary[b]) { const c = a; a = b; b = c; }
      if (boundary[a] && boundary[b] && !nbrs[a].has(b)) continue;
      let shared = 0;
      for (const w of nbrs[a]) { if (w !== b && nbrs[b].has(w)) shared++; }
      if (shared !== (boundary[a] && boundary[b] ? 1 : 2)) continue;
      if (!boundary[b]) for (let k = 0; k < 3; k++) v[b * 3 + k] = (v[a * 3 + k] + v[b * 3 + k]) / 2;
      parent[a] = b;
      for (const w of nbrs[a]) { nbrs[w].delete(a); if (w !== b) { nbrs[w].add(b); nbrs[b].add(w); } }
      nbrs[b].delete(a);
      for (const f of tris[a]) {
        if (!alive[f]) continue;
        const p = find(t[f * 3]), q = find(t[f * 3 + 1]), r = find(t[f * 3 + 2]);
        if (p === q || q === r || p === r) alive[f] = 0; else tris[b].push(f);
      }
      did++;
    }
    if (!did) break;
  }
  const newId = new Int32Array(V).fill(-1), nv = [], nt = [], nn = [], nuv = S.uv ? [] : null, np = S.part ? [] : null;
  for (let f = 0; f < T; f++) {
    if (!alive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const p = find(t[f * 3 + k]);
      if (newId[p] < 0) { newId[p] = nv.length / 3; nv.push(v[p * 3], v[p * 3 + 1], v[p * 3 + 2]); }
      nt.push(newId[p]);
      const c = f * 3 + k;
      nn.push(S.n[c * 3], S.n[c * 3 + 1], S.n[c * 3 + 2]);
      if (nuv) nuv.push(S.uv[c * 2], S.uv[c * 2 + 1]);
    }
    if (np) np.push(S.part[f]);
  }
  const from = new Int32Array(V);
  for (let i = 0; i < V; i++) from[i] = newId[find(i)];
  return { v: nv, t: nt, n: nn, uv: nuv, part: np, from };
}

export function orient(S) {
  const T = S.t.length / 3, on = new Map(), ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let f = 0; f < T; f++) for (let k = 0; k < 3; k++) {
    const e = ek(S.t[f * 3 + k], S.t[f * 3 + (k + 1) % 3]);
    if (!on.has(e)) on.set(e, []);
    on.get(e).push(f);
  }
  let open = 0, tangled = 0;
  for (const l of on.values()) { if (l.length === 1) open++; else if (l.length > 2) tangled++; }
  const seen = new Int8Array(T), stack = [], flipTri = new Uint8Array(T);
  const dirOn = (f, a, b) => { for (let k = 0; k < 3; k++) { const p = S.t[f * 3 + k], q = S.t[f * 3 + (k + 1) % 3]; if (p === a && q === b) return 1; if (p === b && q === a) return -1; } return 0; };
  const pieces = [];
  for (let f0 = 0; f0 < T; f0++) {
    if (seen[f0]) continue;
    seen[f0] = 1; stack.push(f0);
    const piece = [f0];
    while (stack.length) {
      const f = stack.pop();
      for (let k = 0; k < 3; k++) {
        const a = S.t[f * 3 + k], b = S.t[f * 3 + (k + 1) % 3], l = on.get(ek(a, b));
        const mine = flipTri[f] ? -1 : 1;
        for (const g of l) {
          if (g === f || seen[g]) continue;
          flipTri[g] = dirOn(g, a, b) * mine === 1 ? 1 : 0;
          seen[g] = 1; stack.push(g); piece.push(g);
        }
      }
    }
    pieces.push(piece);
  }
  const flip = f => {
    const a = f * 3 + 1, b = f * 3 + 2, x = S.t[a]; S.t[a] = S.t[b]; S.t[b] = x;
    for (let k = 0; k < 3; k++) { const q = S.n[a * 3 + k]; S.n[a * 3 + k] = S.n[b * 3 + k]; S.n[b * 3 + k] = q; }
    if (S.uv) for (let k = 0; k < 2; k++) { const q = S.uv[a * 2 + k]; S.uv[a * 2 + k] = S.uv[b * 2 + k]; S.uv[b * 2 + k] = q; }
  };
  for (let f = 0; f < T; f++) if (flipTri[f]) flip(f);
  for (const piece of pieces) {
    let vol = 0;
    for (const f of piece) {
      const a = S.t[f * 3] * 3, b = S.t[f * 3 + 1] * 3, c = S.t[f * 3 + 2] * 3, v = S.v;
      vol += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
    }
    if (vol < 0) for (const f of piece) flip(f);
  }
  S.closed = open === 0 && tangled === 0 && T > 0;
  S.openEdges = open;
  S.tangledEdges = tangled;
  return S;
}

export function volumeOf(v, t) {
  let vol = 0;
  for (let f = 0; f + 2 < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) + v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return vol / 6;
}

export function areaOf(v, t) {
  let area = 0;
  for (let f = 0; f + 2 < t.length; f += 3) {
    const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }
  return area;
}


const cot = (ax, ay, az, bx, by, bz) => {
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return (ax * bx + ay * by + az * bz) / Math.max(Math.sqrt(cx * cx + cy * cy + cz * cz), 1e-12);
};

function colourOrder(count, pointsOf, V) {
  const lastColour = new Int32Array(V * 32).fill(-1);
  const colours = [], used = new Int32Array(64);
  for (let c = 0; c < count; c++) {
    used.fill(-1);
    const pts = pointsOf(c);
    for (const p of pts) {
      for (let k = 0; k < 32; k++) { const u = lastColour[p * 32 + k]; if (u < 0) break; if (u < 64) used[u] = c; }
    }
    let col = 0;
    while (col < 63 && used[col] === c) col++;
    for (const p of pts) { for (let k = 0; k < 32; k++) { if (lastColour[p * 32 + k] < 0) { lastColour[p * 32 + k] = col; break; } } }
    (colours[col] ||= []).push(c);
  }
  return colours.flat();
}

export function shellJoints(v, t) {
  const V = v.length / 3, T = t.length / 3, on = new Map(), ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const tArea = new Float64Array(T), vArea = new Float64Array(V);
  for (let f = 0; f < T; f++) {
    const a = t[f * 3], b = t[f * 3 + 1], c = t[f * 3 + 2];
    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2], wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, A = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    tArea[f] = A; vArea[a] += A / 3; vArea[b] += A / 3; vArea[c] += A / 3;
    for (let k = 0; k < 3; k++) {
      const p = t[f * 3 + k], q = t[f * 3 + (k + 1) % 3], other = t[f * 3 + (k + 2) % 3], e = ek(p, q);
      if (!on.has(e)) on.set(e, { a: Math.min(p, q), b: Math.max(p, q), tris: [], others: [] });
      const E = on.get(e); E.tris.push(f); E.others.push(other);
    }
  }
  const edges = [...on.values()];
  const order = colourOrder(edges.length, c => [edges[c].a, edges[c].b], V);
  const nE = edges.length, ei = new Int32Array(nE), ej = new Int32Array(nE), eL = new Float64Array(nE), eW = new Float64Array(nE), eLong = new Uint8Array(nE);
  order.forEach((c, n) => {
    const E = edges[c], L2 = dist2(v, E.a, E.b);
    ei[n] = E.a; ej[n] = E.b; eL[n] = Math.sqrt(L2);
    let A = 0;
    for (const f of E.tris) A += tArea[f];
    eW[n] = A / Math.max(L2, 1e-12);
    for (let g = 0; g < E.tris.length; g++) {
      const f = E.tris[g], o = E.others[g];
      if (L2 > dist2(v, E.a, o) * 1.15 && L2 > dist2(v, E.b, o) * 1.15) eLong[n] = 1;
    }
  });
  const hinges = [];
  for (const E of edges) {
    if (E.tris.length < 2) continue;
    for (let g = 0; g + 1 < E.tris.length; g++) hinges.push([E.a, E.b, E.others[g], E.others[g + 1], tArea[E.tris[g]] + tArea[E.tris[g + 1]]]);
  }
  const hOrder = colourOrder(hinges.length, c => hinges[c].slice(0, 4), V);
  const nH = hinges.length, hx = new Int32Array(nH * 4), hK = new Float64Array(nH * 4), hQ = new Float64Array(nH), hC = new Float64Array(nH);
  hOrder.forEach((c, n) => {
    const [x0, x1, x2, x3, A] = hinges[c];
    hx.set([x0, x1, x2, x3], n * 4);
    const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], p0 = P(x0), p1 = P(x1), p2 = P(x2), p3 = P(x3);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const e0 = sub(p1, p0), e1 = sub(p2, p0), e2 = sub(p3, p0), e3 = sub(p2, p1), e4 = sub(p3, p1), m0 = [-e0[0], -e0[1], -e0[2]];
    const c01 = cot(...e0, ...e1), c02 = cot(...e0, ...e2), c03 = cot(...m0, ...e3), c04 = cot(...m0, ...e4);
    const K = [c03 + c04, c01 + c02, -c01 - c03, -c02 - c04];
    hK.set(K, n * 4);
    hQ[n] = 3 / Math.max(A, 1e-12);
    const cx = K[0] * p0[0] + K[1] * p1[0] + K[2] * p2[0] + K[3] * p3[0], cy = K[0] * p0[1] + K[1] * p1[1] + K[2] * p2[1] + K[3] * p3[1], cz = K[0] * p0[2] + K[1] * p1[2] + K[2] * p2[2] + K[3] * p3[2];
    const mag = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (mag > 1e-6) {
      const n1 = crossNorm(p0, p1, p2), n2 = crossNorm(p1, p0, p3);
      hC[n] = Math.sign((cx * (n1[0] + n2[0]) + cy * (n1[1] + n2[1]) + cz * (n1[2] + n2[2])) || 1) * mag;
    }
  });
  return { ei, ej, eL, eW, eLong, hx, hK, hQ, hC, vArea, tArea, nE, nH };
}
function crossNorm(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / l, ny / l, nz / l];
}


export function coarseLevels(v, J, pinned, mass, { hops = 3, minSeeds = 12 } = {}) {
  const n = v.length / 3, head = new Int32Array(n).fill(-1), next = new Int32Array(J.nE * 2), to = new Int32Array(J.nE * 2), len = new Float64Array(J.nE * 2);
  for (let e = 0; e < J.nE; e++) {
    to[e * 2] = J.ej[e]; len[e * 2] = J.eL[e]; next[e * 2] = head[J.ei[e]]; head[J.ei[e]] = e * 2;
    to[e * 2 + 1] = J.ei[e]; len[e * 2 + 1] = J.eL[e]; next[e * 2 + 1] = head[J.ej[e]]; head[J.ej[e]] = e * 2 + 1;
  }
  const levels = [];
  let current = Int32Array.from(Array.from({ length: n }, (_, i) => i));
  let spacing = hops;
  for (let lv = 0; lv < 3; lv++) {
    const seen = new Int32Array(n).fill(-1), seeds = [];
    const claim = s => {
      const q = [s], ring = new Map([[s, 0]]);
      for (let k = 0; k < q.length; k++) {
        const a = q[k], d = ring.get(a);
        seen[a] = 1;
        if (d >= spacing) continue;
        for (let e = head[a]; e >= 0; e = next[e]) if (!ring.has(to[e])) { ring.set(to[e], d + 1); q.push(to[e]); }
      }
    };
    for (const i of current) if (pinned[i] && seen[i] < 0) { seeds.push(i); claim(i); }
    for (const i of current) if (seen[i] < 0) { seeds.push(i); claim(i); }
    if (seeds.length < minSeeds || seeds.length >= current.length * 0.7) break;
    const owner = new Int32Array(n).fill(-1), dist = new Float64Array(n).fill(Infinity), q = [];
    seeds.forEach((s, I) => { owner[s] = I; dist[s] = 0; q.push(s); });
    for (let k = 0; k < q.length; k++) {
      const a = q[k];
      for (let e = head[a]; e >= 0; e = next[e]) { const b = to[e], d = dist[a] + len[e]; if (d < dist[b] - 1e-9) { dist[b] = d; owner[b] = owner[a]; q.push(b); } }
    }
    const pair = new Set(), ci = [], cj = [], cL = [];
    for (let e = 0; e < J.nE; e++) {
      const A = owner[J.ei[e]], B = owner[J.ej[e]];
      if (A === B || A < 0 || B < 0) continue;
      const key = A < B ? A * 1048576 + B : B * 1048576 + A;
      if (pair.has(key)) continue;
      pair.add(key);
      const a = seeds[A] * 3, b = seeds[B] * 3;
      ci.push(A); cj.push(B); cL.push(Math.sqrt((v[a] - v[b]) ** 2 + (v[a + 1] - v[b + 1]) ** 2 + (v[a + 2] - v[b + 2]) ** 2));
    }
    const P = 3, pI = new Int32Array(n * P).fill(-1), pW = new Float64Array(n * P), isSeed = new Uint8Array(n);
    for (const s of seeds) isSeed[s] = 1;
    const M = new Float64Array(seeds.length);
    for (let i = 0; i < n; i++) {
      if (isSeed[i]) { M[owner[i]] += mass[i]; continue; }
      const seenA = new Map(), add = I => { if (I >= 0 && !seenA.has(I)) seenA.set(I, 1); };
      add(owner[i]);
      for (let e = head[i]; e >= 0; e = next[e]) { add(owner[to[e]]); for (let f = head[to[e]]; f >= 0; f = next[f]) add(owner[to[f]]); }
      const list = [...seenA.keys()].map(I => { const a = seeds[I] * 3, d2 = (v[a] - v[i * 3]) ** 2 + (v[a + 1] - v[i * 3 + 1]) ** 2 + (v[a + 2] - v[i * 3 + 2]) ** 2; return [I, 1 / Math.max(d2, 1e-10)]; }).sort((x, y) => y[1] - x[1]).slice(0, P);
      const sum = list.reduce((t, x) => t + x[1], 0);
      list.forEach(([I, w], k) => { pI[i * P + k] = I; pW[i * P + k] = w / sum; M[I] += mass[i] * w / sum; });
    }
    levels.push({ seeds: Int32Array.from(seeds), ci: Int32Array.from(ci), cj: Int32Array.from(cj), cL: Float64Array.from(cL), M, pI, pW, isSeed, old: new Float64Array(seeds.length * 3) });
    current = Int32Array.from(seeds);
    spacing *= 3;
  }
  return levels;
}


export function latticeTets(o, model, h, maxTets) {
  const s = o.size, sdf = (x, y, z) => shapeSdf(x, y, z, o, model);
  const cellsFor = hh => s.map(v => Math.max(2, Math.round(2 * v / hh)));
  let n = cellsFor(h);
  for (let tries = 0; tries < 12 && n[0] * n[1] * n[2] * 12 > maxTets * 2.2; tries++) { h *= 1.12; n = cellsFor(h); }
  const hx = 2 * s[0] / n[0], hy = 2 * s[1] / n[1], hz = 2 * s[2] / n[2], hMin = Math.min(hx, hy, hz);
  const corner = (i, j, k) => (i + 1) + (n[0] + 3) * ((j + 1) + (n[1] + 3) * (k + 1));
  const centre = (i, j, k) => (n[0] + 3) * (n[1] + 3) * (n[2] + 3) + (i + 1) + (n[0] + 3) * ((j + 1) + (n[1] + 3) * (k + 1));
  const posOf = new Map(), tets = [];
  const P = (id, x, y, z) => { if (!posOf.has(id)) posOf.set(id, [x, y, z]); return id; };
  const at = (i, j, k) => P(corner(i, j, k), -s[0] + i * hx, -s[1] + j * hy, -s[2] + k * hz);
  const mid = (i, j, k) => P(centre(i, j, k), -s[0] + (i + 0.5) * hx, -s[1] + (j + 0.5) * hy, -s[2] + (k + 0.5) * hz);
  const add = (c1, c2, ring) => { for (let r = 0; r < 4; r++) tets.push([c1, c2, ring[r], ring[(r + 1) % 4]]); };
  for (let k = -1; k <= n[2]; k++) for (let j = -1; j <= n[1]; j++) for (let i = -1; i <= n[0]; i++) {
    const c = mid(i, j, k);
    if (i < n[0]) add(c, mid(i + 1, j, k), [at(i + 1, j, k), at(i + 1, j + 1, k), at(i + 1, j + 1, k + 1), at(i + 1, j, k + 1)]);
    if (j < n[1]) add(c, mid(i, j + 1, k), [at(i, j + 1, k), at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), at(i + 1, j + 1, k)]);
    if (k < n[2]) add(c, mid(i, j, k + 1), [at(i, j, k + 1), at(i + 1, j, k + 1), at(i + 1, j + 1, k + 1), at(i, j + 1, k + 1)]);
  }
  const keep = [];
  const inward = hMin * 0.02;
  for (const q of tets) {
    let cx = 0, cy = 0, cz = 0;
    for (const id of q) { const p = posOf.get(id); cx += p[0]; cy += p[1]; cz += p[2]; }
    if (sdf(cx / 4, cy / 4, cz / 4) < inward) keep.push(q);
  }
  const number = new Map(), pts = [];
  for (const q of keep) for (const id of q) if (!number.has(id)) { number.set(id, pts.length); pts.push([...posOf.get(id)]); }
  const counts = new Map();
  const fKey = (a, b, c) => { const l = [a, b, c].sort((x, y) => x - y); return l[0] + '_' + l[1] + '_' + l[2]; };
  const list = keep.map(q => q.map(id => number.get(id)));
  for (const q of list) for (const f of [[q[0], q[1], q[2]], [q[0], q[1], q[3]], [q[0], q[2], q[3]], [q[1], q[2], q[3]]]) { const K = fKey(...f); counts.set(K, (counts.get(K) || 0) + 1); }
  const onSkin = new Uint8Array(pts.length);
  for (const [K, c] of counts) if (c === 1) for (const id of K.split('_')) onSkin[+id] = 1;
  for (let i = 0; i < pts.length; i++) {
    if (!onSkin[i]) continue;
    const p = pts[i];
    for (let it = 0; it < 3; it++) {
      const d = sdf(p[0], p[1], p[2]);
      if (Math.abs(d) < hMin * 1e-3 || Math.abs(d) > hMin * 1.5) break;
      const g = shapeNormal(p[0], p[1], p[2], o, model, Math.min(0.002, hMin * 0.05));
      p[0] -= g[0] * d; p[1] -= g[1] * d; p[2] -= g[2] * d;
    }
  }
  const ideal = hx * hy * hz / 12, good = [];
  for (const q of list) {
    const [a, b, c, d] = q.map(i => pts[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], x = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let vol = (u[0] * (w[1] * x[2] - w[2] * x[1]) + u[1] * (w[2] * x[0] - w[0] * x[2]) + u[2] * (w[0] * x[1] - w[1] * x[0])) / 6;
    if (vol < 0) { const t = q[2]; q[2] = q[3]; q[3] = t; vol = -vol; }
    if (vol > ideal * 0.04) good.push(q);
  }
  const renumber = new Int32Array(pts.length).fill(-1), P2 = [];
  for (const q of good) for (let k = 0; k < 4; k++) { if (renumber[q[k]] < 0) { renumber[q[k]] = P2.length; P2.push(pts[q[k]]); } q[k] = renumber[q[k]]; }
  const v = new Float64Array(P2.length * 3);
  P2.forEach((p, i) => { v[i * 3] = p[0]; v[i * 3 + 1] = p[1]; v[i * 3 + 2] = p[2]; });
  return { v, tets: good, cell: hMin, cells: [hx, hy, hz] };
}

export function solidJoints(v, tets) {
  const nT = tets.length, V = v.length / 3;
  const order = colourOrder(nT, c => tets[c], V);
  const tx = new Int32Array(nT * 4), tInv = new Float64Array(nT * 9), tV = new Float64Array(nT), vVol = new Float64Array(V);
  const K = V + 1, faces = new Map(), fKey = (a, b, c) => { const l = [a, b, c].sort((x, y) => x - y); return (l[0] * K + l[1]) * K + l[2]; };
  order.forEach((c, n) => {
    const q = tets[c];
    tx.set(q, n * 4);
    const a = q[0] * 3, ax = v[a], ay = v[a + 1], az = v[a + 2];
    const col = i => [v[q[i] * 3] - ax, v[q[i] * 3 + 1] - ay, v[q[i] * 3 + 2] - az];
    const c1 = col(1), c2 = col(2), c3 = col(3);
    const det = c1[0] * (c2[1] * c3[2] - c3[1] * c2[2]) - c2[0] * (c1[1] * c3[2] - c3[1] * c1[2]) + c3[0] * (c1[1] * c2[2] - c2[1] * c1[2]);
    const id = 1 / det;
    tInv.set([
      (c2[1] * c3[2] - c3[1] * c2[2]) * id, (c3[0] * c2[2] - c2[0] * c3[2]) * id, (c2[0] * c3[1] - c3[0] * c2[1]) * id,
      (c3[1] * c1[2] - c1[1] * c3[2]) * id, (c1[0] * c3[2] - c3[0] * c1[2]) * id, (c3[0] * c1[1] - c1[0] * c3[1]) * id,
      (c1[1] * c2[2] - c2[1] * c1[2]) * id, (c2[0] * c1[2] - c1[0] * c2[2]) * id, (c1[0] * c2[1] - c2[0] * c1[1]) * id,
    ], n * 9);
    tV[n] = det / 6;
    for (const p of q) vVol[p] += det / 24;
    for (const [i0, i1, i2] of [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]]) {
      const K = fKey(q[i0], q[i1], q[i2]);
      if (faces.has(K)) faces.set(K, null); else faces.set(K, [q[i0], q[i1], q[i2]]);
    }
  });
  const t = [];
  for (const f of faces.values()) if (f) t.push(f[0], f[1], f[2]);
  return { tx, tInv, tV, vVol, nT, skinT: t };
}


export function carryInTets(rv, v, tets, cell) {
  const R = rv.length / 3, nT = tets.length, grid = new Map(), size = cell * 1.5;
  const k3 = (x, y, z) => (x + 2048) * 16777216 + (y + 2048) * 4096 + (z + 2048);
  for (let q = 0; q < nT; q++) {
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const p of tets[q]) for (let k = 0; k < 3; k++) { const c = v[p * 3 + k]; if (c < lo[k]) lo[k] = c; if (c > hi[k]) hi[k] = c; }
    for (let z = Math.floor(lo[2] / size); z <= Math.floor(hi[2] / size); z++) for (let y = Math.floor(lo[1] / size); y <= Math.floor(hi[1] / size); y++) for (let x = Math.floor(lo[0] / size); x <= Math.floor(hi[0] / size); x++) {
      const K = k3(x, y, z);
      if (!grid.has(K)) grid.set(K, []);
      grid.get(K).push(q);
    }
  }
  const tetOf = new Int32Array(R), tetW = new Float64Array(R * 4);
  const shares = (q, x, y, z, out) => {
    const [a, b, c, d] = tets[q], A = a * 3, B = b * 3, C = c * 3, D = d * 3;
    const m = [v[B] - v[A], v[C] - v[A], v[D] - v[A], v[B + 1] - v[A + 1], v[C + 1] - v[A + 1], v[D + 1] - v[A + 1], v[B + 2] - v[A + 2], v[C + 2] - v[A + 2], v[D + 2] - v[A + 2]];
    const rx = x - v[A], ry = y - v[A + 1], rz = z - v[A + 2];
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const w1 = (rx * (m[4] * m[8] - m[5] * m[7]) - m[1] * (ry * m[8] - m[5] * rz) + m[2] * (ry * m[7] - m[4] * rz)) / det;
    const w2 = (m[0] * (ry * m[8] - m[5] * rz) - rx * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * rz - ry * m[6])) / det;
    const w3 = (m[0] * (m[4] * rz - ry * m[7]) - m[1] * (m[3] * rz - ry * m[6]) + rx * (m[3] * m[7] - m[4] * m[6])) / det;
    out[0] = 1 - w1 - w2 - w3; out[1] = w1; out[2] = w2; out[3] = w3;
    return Math.min(out[0], w1, w2, w3);
  };
  const w = [0, 0, 0, 0];
  for (let i = 0; i < R; i++) {
    const x = rv[i * 3], y = rv[i * 3 + 1], z = rv[i * 3 + 2];
    let best = -1e9, who = -1;
    for (let reach = 0; reach < 5 && (who < 0 || best < -0.01); reach++) {
      const ix = Math.floor(x / size), iy = Math.floor(y / size), iz = Math.floor(z / size);
      for (let dz = -reach; dz <= reach; dz++) for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== reach) continue;
        const list = grid.get(k3(ix + dx, iy + dy, iz + dz));
        if (!list) continue;
        for (const q of list) { const m = shares(q, x, y, z, w); if (m > best) { best = m; who = q; } }
      }
    }
    if (who < 0) { for (let q = 0; q < nT; q++) { const m = shares(q, x, y, z, w); if (m > best) { best = m; who = q; } } }
    shares(who, x, y, z, w);
    tetOf[i] = who;
    tetW[i * 4] = w[0]; tetW[i * 4 + 1] = w[1]; tetW[i * 4 + 2] = w[2]; tetW[i * 4 + 3] = w[3];
  }
  return { tetOf, tetW };
}

export function carryOnSurface(rv, v, t, cell) {
  const R = rv.length / 3, T = t.length / 3, grid = new Map(), size = cell * 1.5;
  const k3 = (x, y, z) => (x + 2048) * 16777216 + (y + 2048) * 4096 + (z + 2048);
  for (let f = 0; f < T; f++) {
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) { const q = v[t[f * 3 + c] * 3 + k]; if (q < lo[k]) lo[k] = q; if (q > hi[k]) hi[k] = q; }
    for (let z = Math.floor(lo[2] / size); z <= Math.floor(hi[2] / size); z++) for (let y = Math.floor(lo[1] / size); y <= Math.floor(hi[1] / size); y++) for (let x = Math.floor(lo[0] / size); x <= Math.floor(hi[0] / size); x++) {
      const K = k3(x, y, z);
      if (!grid.has(K)) grid.set(K, []);
      grid.get(K).push(f);
    }
  }
  const triOf = new Int32Array(R), triW = new Float64Array(R * 3), triD = new Float64Array(R);
  const near = [0, 0, 0, 0, 0];
  const closest = (f, x, y, z) => {
    const a = t[f * 3] * 3, b = t[f * 3 + 1] * 3, c = t[f * 3 + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const px = x - v[a], py = y - v[a + 1], pz = z - v[a + 2];
    const uu = ux * ux + uy * uy + uz * uz, uw = ux * wx + uy * wy + uz * wz, ww = wx * wx + wy * wy + wz * wz, pu = px * ux + py * uy + pz * uz, pw = px * wx + py * wy + pz * wz;
    const den = Math.max(uu * ww - uw * uw, 1e-18);
    let s = (ww * pu - uw * pw) / den, q = (uu * pw - uw * pu) / den;
    if (s < 0 || q < 0 || s + q > 1) {
      if (s < 0) s = 0; if (q < 0) q = 0;
      const sum = s + q; if (sum > 1) { s /= sum; q /= sum; }
    }
    const dx = px - s * ux - q * wx, dy = py - s * uy - q * wy, dz = pz - s * uz - q * wz;
    near[0] = dx * dx + dy * dy + dz * dz; near[1] = 1 - s - q; near[2] = s; near[3] = q;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    near[4] = (dx * nx + dy * ny + dz * nz) / l;
    return near[0];
  };
  for (let i = 0; i < R; i++) {
    const x = rv[i * 3], y = rv[i * 3 + 1], z = rv[i * 3 + 2];
    let best = 1e18, who = -1;
    for (let reach = 0; reach < 6 && who < 0; reach++) {
      const ix = Math.floor(x / size), iy = Math.floor(y / size), iz = Math.floor(z / size);
      for (let dz = -reach; dz <= reach; dz++) for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== reach) continue;
        const list = grid.get(k3(ix + dx, iy + dy, iz + dz));
        if (!list) continue;
        for (const f of list) { const d = closest(f, x, y, z); if (d < best) { best = d; who = f; } }
      }
    }
    if (who < 0) for (let f = 0; f < T; f++) { const d = closest(f, x, y, z); if (d < best) { best = d; who = f; } }
    closest(who, x, y, z);
    triOf[i] = who; triW[i * 3] = near[1]; triW[i * 3 + 1] = near[2]; triW[i * 3 + 2] = near[3]; triD[i] = near[4];
  }
  return { triOf, triW, triD };
}

export function drawnOf(R, parts) {
  const T = R.t.length / 3, corners = T * 3;
  let order = null;
  if (R.part) { order = Array.from({ length: T }, (_, i) => i).sort((a, b) => R.part[a] - R.part[b] || a - b); }
  const vid = new Int32Array(corners), setId = new Int32Array(corners), lp = new Float32Array(corners * 3), ln = new Float32Array(corners * 3), uv = R.uv ? new Float32Array(corners * 2) : null;
  const setsOf = Array.from({ length: R.v.length / 3 }, () => []);
  let nSets = 0;
  const partList = parts ? parts.map(() => ({ first: 0, count: 0 })) : null;
  for (let g = 0; g < T; g++) {
    const f = order ? order[g] : g;
    if (partList) { const P = partList[R.part[f]]; if (!P.count) P.first = g * 3; P.count += 3; }
    for (let k = 0; k < 3; k++) {
      const c = f * 3 + k, out = g * 3 + k, p = R.t[c], nx = R.n[c * 3], ny = R.n[c * 3 + 1], nz = R.n[c * 3 + 2];
      vid[out] = p;
      lp.set([R.v[p * 3], R.v[p * 3 + 1], R.v[p * 3 + 2]], out * 3);
      ln.set([nx, ny, nz], out * 3);
      if (uv) { uv[out * 2] = R.uv[c * 2]; uv[out * 2 + 1] = R.uv[c * 2 + 1]; }
      let set = -1;
      for (const S of setsOf[p]) if (S.x * nx + S.y * ny + S.z * nz > 0.82) { set = S.id; break; }
      if (set < 0) { set = nSets++; setsOf[p].push({ id: set, x: nx, y: ny, z: nz }); }
      setId[out] = set;
    }
  }
  return { corners, vid, setId, nSets, lp, ln, uv, parts: partList };
}
