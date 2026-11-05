
export const SHAPES = {
  box:    { code: 1, label: 'Box',    size: [0.35, 0.35, 0.35], sizing: 'xyz' },
  ball:   { code: 2, label: 'Ball',   size: [0.3, 0.3, 0.3],    sizing: 'xyz' },
  column: { code: 3, label: 'Column', size: [0.15, 0.7, 0.15],  sizing: 'radius' },
  cone:   { code: 4, label: 'Cone',   size: [0.35, 0.45, 0.35], sizing: 'radius' },
  ring:   { code: 5, label: 'Ring',   size: [0.45, 0.45, 0.45], sizing: 'uniform' },
  ramp:   { code: 6, label: 'Ramp',   size: [0.6, 0.3, 0.4],    sizing: 'xyz' },
  arch:   { code: 7, label: 'Arch',   size: [0.6, 0.6, 0.15],   sizing: 'xyz' },
  stairs: { code: 8, label: 'Stairs', size: [0.6, 0.35, 0.4],   sizing: 'xyz' },
  wall:   { code: 1, label: 'Wall',   size: [0.8, 0.5, 0.05],   sizing: 'xyz', mesh: 'box' },
  slab:   { code: 1, label: 'Slab',   size: [0.8, 0.05, 0.6],   sizing: 'xyz', mesh: 'box' },
  model:  { code: 9, label: 'Model',  size: [0.5, 0.5, 0.5],    sizing: 'xyz' },
};

export const ARCH = { r: 0.55, spring: 0.15 };
export const STEPS = 5;


function tri(out, a, b, c, n) {
  out.push(...a, ...n, ...b, ...n, ...c, ...n);
}
function triN(out, a, na, b, nb, c, nc) {
  out.push(...a, ...na, ...b, ...nb, ...c, ...nc);
}
function quad(out, a, b, c, d, n) { tri(out, a, b, c, n); tri(out, a, c, d, n); }
function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

function boxInto(out, lo, hi) {
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
  quad(out, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  quad(out, [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]);
  quad(out, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
  quad(out, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]);
  quad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad(out, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
}

function box() { const o = []; boxInto(o, [-1, -1, -1], [1, 1, 1]); return o; }

function ball(seg = 40, rings = 22) {
  const o = [];
  const P = (r, s) => {
    const th = r / rings * Math.PI, ph = s / seg * Math.PI * 2;
    return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  };
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const a = P(r, s), b = P(r + 1, s), c = P(r + 1, s + 1), d = P(r, s + 1);
    triN(o, a, a, b, b, c, c); triN(o, a, a, c, c, d, d);
  }
  return o;
}

function column(seg = 48) {
  const o = [];
  for (let s = 0; s < seg; s++) {
    const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    triN(o, [c0, -1, s0], [c0, 0, s0], [c0, 1, s0], [c0, 0, s0], [c1, 1, s1], [c1, 0, s1]);
    triN(o, [c0, -1, s0], [c0, 0, s0], [c1, 1, s1], [c1, 0, s1], [c1, -1, s1], [c1, 0, s1]);
    tri(o, [0, 1, 0], [c1, 1, s1], [c0, 1, s0], [0, 1, 0]);
    tri(o, [0, -1, 0], [c0, -1, s0], [c1, -1, s1], [0, -1, 0]);
  }
  return o;
}

function cone(seg = 48) {
  const o = [];
  for (let s = 0; s < seg; s++) {
    const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const n = a => { const l = Math.hypot(2, 1); return [2 * Math.cos(a) / l, 1 / l, 2 * Math.sin(a) / l]; };
    triN(o, [c0, -1, s0], n(a0), [0, 1, 0], n(am), [c1, -1, s1], n(a1));
    tri(o, [0, -1, 0], [c0, -1, s0], [c1, -1, s1], [0, -1, 0]);
  }
  return o;
}

function ring(seg = 64, side = 24) {
  const o = [], R = 0.7, r = 0.3;
  const P = (i, j) => {
    const u = i / seg * Math.PI * 2, v = j / side * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    return [[(R + r * cv) * cu, r * sv, (R + r * cv) * su], [cv * cu, sv, cv * su]];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
    const [a, na] = P(i, j), [b, nb] = P(i + 1, j), [c, nc] = P(i + 1, j + 1), [d, nd] = P(i, j + 1);
    triN(o, a, na, c, nc, b, nb); triN(o, a, na, d, nd, c, nc);
  }
  return o;
}

function ramp() {
  const o = [];
  const A = [-1, -1, 1], B = [1, -1, 1], C = [-1, 1, 1], A2 = [-1, -1, -1], B2 = [1, -1, -1], C2 = [-1, 1, -1];
  tri(o, A, B, C, [0, 0, 1]);
  tri(o, B2, A2, C2, [0, 0, -1]);
  quad(o, A2, B2, B, A, [0, -1, 0]);
  quad(o, A, C, C2, A2, [-1, 0, 0]);
  quad(o, B, B2, C2, C, faceNormal(B, B2, C2));
  return o;
}

function arch(seg = 32) {
  const o = [], { r, spring } = ARCH;
  boxInto(o, [-1, -1, -1], [-r, spring, 1]);
  boxInto(o, [r, -1, -1], [1, spring, 1]);
  const top = 1;
  for (let s = 0; s < seg; s++) {
    const a0 = Math.PI - s / seg * Math.PI, a1 = Math.PI - (s + 1) / seg * Math.PI;
    const p0 = [Math.cos(a0) * r, spring + Math.sin(a0) * r], p1 = [Math.cos(a1) * r, spring + Math.sin(a1) * r];
    const edge = p => {
      const t = Math.atan2(p[1] - spring, p[0]);
      const x = Math.cos(t), y = Math.sin(t);
      const k = Math.min(Math.abs(x) > 1e-6 ? 1 / Math.abs(x) : 1e9, y > 1e-6 ? (top - spring) / y : 1e9);
      return [x * k, spring + y * k];
    };
    const e0 = edge(p0), e1 = edge(p1);
    for (const z of [1, -1]) {
      const n = [0, 0, z];
      if (z > 0) quad(o, [p0[0], p0[1], z], [p1[0], p1[1], z], [e1[0], e1[1], z], [e0[0], e0[1], z], n);
      else quad(o, [p1[0], p1[1], z], [p0[0], p0[1], z], [e0[0], e0[1], z], [e1[0], e1[1], z], n);
    }
    const n0 = [-Math.cos(a0), -Math.sin(a0), 0], n1 = [-Math.cos(a1), -Math.sin(a1), 0];
    triN(o, [p0[0], p0[1], -1], n0, [p1[0], p1[1], -1], n1, [p1[0], p1[1], 1], n1);
    triN(o, [p0[0], p0[1], -1], n0, [p1[0], p1[1], 1], n1, [p0[0], p0[1], 1], n0);
  }
  quad(o, [-1, top, -1], [-1, top, 1], [1, top, 1], [1, top, -1], [0, 1, 0]);
  quad(o, [1, spring, -1], [1, top, -1], [1, top, 1], [1, spring, 1], [1, 0, 0]);
  quad(o, [-1, spring, 1], [-1, top, 1], [-1, top, -1], [-1, spring, -1], [-1, 0, 0]);
  return o;
}

function stairs() {
  const o = [], w = 2 / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const x1 = 1 - i * w, x0 = x1 - w, y1 = -1 + (i + 1) * w;
    boxInto(o, [x0, -1, -1], [x1, y1, 1]);
  }
  return o;
}

const BUILDERS = { box, ball, column, cone, ring, ramp, arch, stairs };
const cache = {};

export function unitMesh(shape) {
  const name = SHAPES[shape] && SHAPES[shape].mesh ? SHAPES[shape].mesh : shape;
  if (!cache[name]) cache[name] = new Float32Array(BUILDERS[name]());
  return cache[name];
}

export const BUILT_IN = Object.keys(BUILDERS);
