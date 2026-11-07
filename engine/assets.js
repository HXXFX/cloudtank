import { eulerAxes } from './math.js';

const PI = Math.PI;


function box(P, N, c, h, rot = [0, 0, 0]) {
  const ax = eulerAxes(rot);
  const w = (x, y, z) => [0, 1, 2].map(k => c[k] + ax[0][k] * x * h[0] + ax[1][k] * y * h[1] + ax[2][k] * z * h[2]);
  const faces = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], [1, 0, 0]],
    [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1], [-1, 0, 0]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [0, 1, 0]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [0, -1, 0]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [0, 0, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [0, 0, -1]],
  ];
  for (const [a, b, d, e, n] of faces) {
    const nw = [0, 1, 2].map(k => ax[0][k] * n[0] + ax[1][k] * n[1] + ax[2][k] * n[2]);
    for (const v of [a, b, d, a, d, e]) { P.push(...w(...v)); N.push(...nw); }
  }
}

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function across(d) {
  const t = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = vnorm(vcross(d, t));
  return [u, vcross(d, u)];
}

function rod(P, N, a, b, r, seg = 12, rb = r) {
  const d = vnorm(vsub(b, a)), [u, v] = across(d);
  const at = (c, rr, t) => [0, 1, 2].map(k => c[k] + (u[k] * Math.cos(t) + v[k] * Math.sin(t)) * rr);
  const nr = t => [0, 1, 2].map(k => u[k] * Math.cos(t) + v[k] * Math.sin(t));
  for (let s = 0; s < seg; s++) {
    const t0 = s / seg * PI * 2, t1 = (s + 1) / seg * PI * 2;
    const a0 = at(a, r, t0), a1 = at(a, r, t1), b0 = at(b, rb, t0), b1 = at(b, rb, t1);
    for (const [p, n] of [[a0, nr(t0)], [b0, nr(t0)], [b1, nr(t1)], [a0, nr(t0)], [b1, nr(t1)], [a1, nr(t1)]]) { P.push(...p); N.push(...n); }
    const nb = d, na = d.map(x => -x);
    for (const p of [a, a1, a0]) { P.push(...p); N.push(...na); }
    for (const p of [b, b0, b1]) { P.push(...p); N.push(...nb); }
  }
}

function sphere(P, N, c, r, seg = 12, rings = 8) {
  const at = (i, j) => {
    const th = i / rings * PI, ph = j / seg * PI * 2;
    return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    for (const k of [0, 1, 2, 0, 2, 3]) { P.push(...q[k].map((x, m) => c[m] + x * r)); N.push(...q[k]); }
  }
}

function torusZ(P, N, c, R, r, seg = 48, side = 12) {
  const at = (i, j) => {
    const u = i / seg * PI * 2, v = j / side * PI * 2;
    const n = [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
    return [[c[0] + (R + r * Math.cos(v)) * Math.cos(u), c[1] + (R + r * Math.cos(v)) * Math.sin(u), c[2] + r * Math.sin(v)], n];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    for (const k of [0, 2, 1, 0, 3, 2]) { P.push(...q[k][0]); N.push(...q[k][1]); }
  }
}

function place(P, N, build, at = [0, 0, 0], rot = [0, 0, 0]) {
  const p = [], n = [];
  build(p, n);
  const ax = eulerAxes(rot);
  const tr = (v, i, o) => [0, 1, 2].map(k => ax[0][k] * v[i] + ax[1][k] * v[i + 1] + ax[2][k] * v[i + 2] + o[k]);
  for (let i = 0; i < p.length; i += 3) { P.push(...tr(p, i, at)); N.push(...tr(n, i, [0, 0, 0])); }
}
function lathe(P, N, prof, seg = 32) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
    const nr = dy / l, ny = -dr / l;
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * PI * 2, a1 = (s + 1) / seg * PI * 2;
      const pt = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
      const nm = a => [Math.cos(a) * nr, ny, Math.sin(a) * nr];
      const q = [[pt(r0, y0, a0), nm(a0)], [pt(r1, y1, a0), nm(a0)], [pt(r1, y1, a1), nm(a1)], [pt(r0, y0, a1), nm(a1)]];
      for (const k of [0, 2, 1, 0, 3, 2]) { P.push(...q[k][0]); N.push(...q[k][1]); }
    }
  }
}
function shell(P, N, outer, t, seg = 32, base = false) {
  const inner = outer.map(([r, y]) => [Math.max(r - t, 0), y]).reverse();
  const prof = [...outer, ...inner];
  if (base) prof.push([0, outer[0][1]], outer[0]); else prof.push(outer[0]);
  lathe(P, N, prof, seg);
}
function disc(P, N, r, y, up = true, seg = 32) { lathe(P, N, up ? [[r, y], [0, y]] : [[0, y], [r, y]], seg); }
function plate(P, N, c, [hx, hy, hz], r) {
  box(P, N, c, [hx - r, hy, hz]);
  box(P, N, c, [hx, hy, hz - r]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = c[0] + sx * (hx - r), z = c[2] + sz * (hz - r);
    rod(P, N, [x, c[1] - hy, z], [x, c[1] + hy, z], r, 14);
  }
}
function ringY(P, N, c, R, r, seg = 48) { place(P, N, (p, n) => torusZ(p, n, [0, 0, 0], R, r, seg, 10), c, [PI / 2, 0, 0]); }

const done = (name, P, N) => ({ name, positions: new Float32Array(P), normals: new Float32Array(N) });
export { box, rod, sphere, torusZ, done, place, lathe, shell, disc, plate, ringY };


export function figure(pose = 'walk') {
  const P = [], N = [];
  const stride = pose === 'stand' ? 0.05 : 0.38;
  for (const [side, sw] of [[-1, stride], [1, -stride]]) {
    const hipX = side * 0.09;
    box(P, N, [hipX, 0.72, Math.sin(sw) * 0.2], [0.07, 0.21, 0.08], [sw, 0, 0]);
    const knee = [hipX, 0.72 - Math.cos(sw) * 0.4, Math.sin(sw) * 0.4];
    const shin = sw > 0 ? sw * 0.2 : sw * 1.2;
    box(P, N, [hipX, knee[1] - 0.2, knee[2] - Math.sin(shin) * 0.2], [0.06, 0.21, 0.065], [shin, 0, 0]);
    box(P, N, [hipX, 0.04, knee[2] - Math.sin(shin) * 0.42 + 0.05], [0.055, 0.04, 0.12]);
  }
  box(P, N, [0, 0.95, 0], [0.16, 0.08, 0.1]);
  box(P, N, [0, 1.2, 0.02], [0.18, 0.2, 0.11], [0.08, 0, 0]);
  box(P, N, [0, 1.47, 0.01], [0.21, 0.08, 0.12]);
  box(P, N, [0, 1.56, 0.02], [0.045, 0.04, 0.045]);
  box(P, N, [0, 1.68, 0.03], [0.085, 0.1, 0.1], [0.1, 0, 0]);
  if (pose === 'rifle') {
    box(P, N, [0, 1.77, 0.02], [0.12, 0.05, 0.13]);
    box(P, N, [0, 1.25, -0.16], [0.13, 0.17, 0.07]);
    box(P, N, [-0.2, 1.3, 0.12], [0.05, 0.16, 0.05], [-1.0, 0, 0]);
    box(P, N, [0.2, 1.32, 0.1], [0.05, 0.16, 0.05], [-0.8, 0.2, 0]);
    box(P, N, [0.02, 1.3, 0.36], [0.025, 0.04, 0.42], [0.12, -0.12, 0]);
  } else {
    const sw = pose === 'stand' ? 0.05 : 0.45;
    for (const [side, a] of [[-1, -sw], [1, sw]]) {
      box(P, N, [side * 0.25, 1.38 - Math.cos(a) * 0.15, Math.sin(a) * 0.15], [0.05, 0.15, 0.05], [a, 0, side * 0.08]);
      box(P, N, [side * 0.27, 1.1 - Math.cos(a) * 0.1, Math.sin(a) * 0.32], [0.045, 0.14, 0.045], [a * 1.3, 0, side * 0.05]);
    }
  }
  return done(pose === 'rifle' ? 'Figure with rifle' : pose === 'stand' ? 'Figure, standing' : 'Figure, walking', P, N);
}

export function sweep(width = 3.2, depth = 1.8, radius = 0.6, height = 2.4, thick = 0.03) {
  const P = [], N = [];
  const prof = [[depth, 0]];
  for (let i = 0; i <= 32; i++) {
    const a = PI / 2 * i / 32;
    prof.push([radius - Math.sin(a) * radius, radius - Math.cos(a) * radius]);
  }
  prof.push([0, height]);
  const segN = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const tz = prof[i + 1][0] - prof[i][0], ty = prof[i + 1][1] - prof[i][1], l = Math.hypot(tz, ty) || 1;
    segN.push([ty / l, -tz / l]);
  }
  const ptN = prof.map((_, i) => {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  });
  const off = prof.map(([z, y], i) => [z - ptN[i][0] * thick, y - ptN[i][1] * thick]);
  const x0 = -width / 2, x1 = width / 2;
  const put = (p, n) => { P.push(...p); N.push(...n); };
  const quad = (a, b, c, d, n) => { for (const v of [a, b, c, a, c, d]) put(v, n); };
  for (let i = 0; i < prof.length - 1; i++) {
    const [z0, y0] = prof[i], [z1, y1] = prof[i + 1], [w0, v0] = off[i], [w1, v1] = off[i + 1];
    const n0 = [0, ptN[i][1], ptN[i][0]], n1 = [0, ptN[i + 1][1], ptN[i + 1][0]];
    for (const [p, n] of [[[x0, y0, z0], n0], [[x1, y0, z0], n0], [[x1, y1, z1], n1], [[x0, y0, z0], n0], [[x1, y1, z1], n1], [[x0, y1, z1], n1]]) put(p, n);
    const b0 = n0.map(v => -v), b1 = n1.map(v => -v);
    for (const [p, n] of [[[x0, v0, w0], b0], [[x0, v1, w1], b1], [[x1, v1, w1], b1], [[x0, v0, w0], b0], [[x1, v1, w1], b1], [[x1, v0, w0], b0]]) put(p, n);
    quad([x0, y0, z0], [x0, y1, z1], [x0, v1, w1], [x0, v0, w0], [-1, 0, 0]);
    quad([x1, y0, z0], [x1, v0, w0], [x1, v1, w1], [x1, y1, z1], [1, 0, 0]);
  }
  const L = prof.length - 1;
  quad([x0, prof[0][1], prof[0][0]], [x0, off[0][1], off[0][0]], [x1, off[0][1], off[0][0]], [x1, prof[0][1], prof[0][0]], [0, 0, 1]);
  quad([x0, prof[L][1], prof[L][0]], [x1, prof[L][1], prof[L][0]], [x1, off[L][1], off[L][0]], [x0, off[L][1], off[L][0]], [0, 1, 0]);
  return done('Backdrop', P, N);
}

function lightStand() {
  const P = [], N = [];
  const hub = [0, 0.75, 0];
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * PI * 2 + PI / 6;
    rod(P, N, hub, [Math.cos(a) * 0.42, 0.01, Math.sin(a) * 0.42], 0.011, 8);
  }
  rod(P, N, [0, 0.6, 0], [0, 2.35, 0], 0.016, 10);
  rod(P, N, [0, 2.35, 0], [0, 2.42, 0.06], 0.02, 8);
  box(P, N, [0, 2.48, 0.16], [0.26, 0.2, 0.09], [0.45, 0, 0]);
  return done('Light stand', P, N);
}

function gearRing() {
  const P = [], N = [];
  torusZ(P, N, [0, 0, 0], 0.5, 0.065, 56, 12);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * PI * 2;
    box(P, N, [Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0], [0.065, 0.045, 0.055], [0, 0, a]);
  }
  return done('Toothed ring', P, N);
}

function blower() {
  const P = [], N = [];
  rod(P, N, [-0.02, 0, 0], [0.24, 0, 0], 0.075, 16);
  rod(P, N, [-0.2, 0, 0], [-0.02, 0, 0], 0.035, 14, 0.06);
  box(P, N, [0.13, -0.15, 0], [0.034, 0.12, 0.03], [0, 0, -0.18]);
  return done('Blower', P, N);
}

function channel() {
  const P = [], N = [];
  box(P, N, [0, 0.012, 0], [0.6, 0.012, 0.095]);
  box(P, N, [0, 0.062, 0.085], [0.6, 0.05, 0.01]);
  box(P, N, [0, 0.062, -0.085], [0.6, 0.05, 0.01]);
  return done('Clear channel', P, N);
}

function tray() {
  const P = [], N = [];
  const w = 0.5, d = 0.35, h = 0.07, t = 0.01;
  box(P, N, [0, 0.012, 0], [w, 0.012, d]);
  box(P, N, [0, h, d - t], [w, h, t]);
  box(P, N, [0, h, -d + t], [w, h, t]);
  box(P, N, [w - t, h, 0], [t, h, d - 2 * t]);
  box(P, N, [-w + t, h, 0], [t, h, d - 2 * t]);
  return done('Clear basin', P, N);
}

function labStand() {
  const P = [], N = [];
  box(P, N, [0, 0.012, 0], [0.15, 0.012, 0.016]);
  box(P, N, [0, 0.012, 0], [0.016, 0.012, 0.15]);
  rod(P, N, [0, 0.02, 0], [0, 0.52, 0], 0.016, 10);
  box(P, N, [0, 0.53, 0], [0.02, 0.01, 0.13]);
  box(P, N, [0, 0.57, 0.12], [0.02, 0.04, 0.01]);
  box(P, N, [0, 0.57, -0.12], [0.02, 0.04, 0.01]);
  return done('Stand', P, N);
}

function ribbed() {
  const P = [], N = [];
  box(P, N, [0, 0.004, 0], [0.31, 0.004, 0.26]);
  for (let i = 0; i < 10; i++) {
    const x = -0.27 + i * 0.06;
    rod(P, N, [x, 0.035, -0.25], [x, 0.035, 0.25], 0.029, 12);
  }
  return done('Ribbed panel', P, N);
}

function spring() {
  const P = [], N = [];
  const turns = 7, per = 20, R = 0.05, h = 0.26;
  let prev = null;
  for (let i = 0; i <= turns * per; i++) {
    const t = i / per * PI * 2;
    const p = [Math.cos(t) * R, 0.01 + (i / (turns * per)) * h, Math.sin(t) * R];
    if (prev) rod(P, N, prev, p, 0.0045, 6);
    prev = p;
  }
  return done('Spring', P, N);
}

function waffle() {
  const P = [], N = [];
  const n = 5, half = 0.8, h = 0.12, t = 0.01;
  for (let i = 0; i < n; i++) {
    const s = -half + i * (2 * half / (n - 1));
    box(P, N, [0, h, s], [half + t, h, t]);
    box(P, N, [s, h, 0], [t, h, half + t]);
  }
  return done('Waffle base', P, N);
}

function fence() {
  const P = [], N = [];
  for (const x of [-0.45, 0.45]) box(P, N, [x, 0.45, 0], [0.016, 0.45, 0.016]);
  box(P, N, [0, 0.84, 0], [0.45, 0.012, 0.012]);
  box(P, N, [0, 0.07, 0], [0.45, 0.012, 0.012]);
  for (let i = 1; i < 10; i++) box(P, N, [-0.45 + i * 0.09, 0.455, 0], [0.006, 0.385, 0.006]);
  return done('Fence', P, N);
}

function tree() {
  const P = [], N = [];
  rod(P, N, [0, 0, 0], [0, 0.34, 0], 0.016, 8);
  sphere(P, N, [0, 0.48, 0], 0.17, 10, 7);
  return done('Model tree', P, N);
}

function slats() {
  const P = [], N = [];
  for (let i = 0; i < 12; i++) box(P, N, [i * 0.012, 0.008 + (i % 3) * 0.01, -0.3 + i * 0.05], [0.62, 0.008, 0.012]);
  return done('Slats', P, N);
}

function frame() {
  const P = [], N = [];
  for (const x of [-0.62, 0.62]) box(P, N, [x, 1.17, 0], [0.05, 1.17, 0.05]);
  box(P, N, [0, 2.3, 0], [0.67, 0.05, 0.05]);
  box(P, N, [0, 0.03, 0], [0.67, 0.03, 0.05]);
  box(P, N, [0, 2.03, 0], [0.42, 0.02, 0.02]);
  return done('Frame', P, N);
}

function nozzle() {
  const P = [], N = [];
  box(P, N, [0, 0.24, 0], [0.05, 0.012, 0.05]);
  rod(P, N, [0, 0.04, 0], [0, 0.23, 0], 0.011, 10);
  rod(P, N, [0, 0, 0], [0, 0.045, 0], 0.006, 10, 0.02);
  return done('Mist nozzle', P, N);
}

function nozzleRail() {
  const P = [], N = [];
  box(P, N, [0, 0.25, 0], [0.8, 0.015, 0.025]);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    rod(P, N, [x, 0.04, 0], [x, 0.24, 0], 0.011, 10);
    rod(P, N, [x, 0, 0], [x, 0.045, 0], 0.006, 10, 0.02);
  }
  return done('Nozzle rail', P, N);
}

function spout() {
  const P = [], N = [];
  rod(P, N, [0, 0, 0], [0, 0.14, 0], 0.022, 14);
  rod(P, N, [0, 0.14, 0], [0, 0.26, 0], 0.024, 16, 0.09);
  return done('Pour spout', P, N);
}

function floorDrain() {
  const P = [], N = [];
  const h = 0.18, t = 0.02, y = 0.006;
  box(P, N, [0, y, h - t], [h, y, t]);
  box(P, N, [0, y, -h + t], [h, y, t]);
  box(P, N, [h - t, y, 0], [t, y, h - 2 * t]);
  box(P, N, [-h + t, y, 0], [t, y, h - 2 * t]);
  for (const x of [-0.105, -0.0525, 0, 0.0525, 0.105]) box(P, N, [x, y, 0], [0.008, y, h - 2 * t]);
  return done('Floor drain', P, N);
}

function hood() {
  const P = [], N = [];
  const w = 0.35, d = 0.25, sk = 0.06, t = 0.008, top = 0.12, th = 0.09, dh = 0.16;
  box(P, N, [0, sk, d - t], [w, sk, t]);
  box(P, N, [0, sk, -d + t], [w, sk, t]);
  box(P, N, [w - t, sk, 0], [t, sk, d - 2 * t]);
  box(P, N, [-w + t, sk, 0], [t, sk, d - 2 * t]);
  box(P, N, [0, top, (d + th) / 2], [w, t, (d - th) / 2]);
  box(P, N, [0, top, -(d + th) / 2], [w, t, (d - th) / 2]);
  box(P, N, [(w + th) / 2, top, 0], [(w - th) / 2, t, th]);
  box(P, N, [-(w + th) / 2, top, 0], [(w - th) / 2, t, th]);
  box(P, N, [0, top + dh, th - t], [th, dh, t]);
  box(P, N, [0, top + dh, -th + t], [th, dh, t]);
  box(P, N, [th - t, top + dh, 0], [t, dh, th - 2 * t]);
  box(P, N, [-th + t, top + dh, 0], [t, dh, th - 2 * t]);
  return done('Extractor hood', P, N);
}


function snorkel() {
  const P = [], N = [];
  shell(P, N, [[0.15, 0], [0.15, 0.02], [0.05, 0.1], [0.04, 0.16]], 0.005, 40);
  rod(P, N, [0, 0.16, 0], [0, 0.35, 0], 0.035, 18);
  sphere(P, N, [0, 0.36, 0], 0.045, 16, 10);
  rod(P, N, [0, 0.36, 0], [0.32, 0.55, 0], 0.035, 18);
  sphere(P, N, [0.32, 0.55, 0], 0.045, 16, 10);
  rod(P, N, [0.32, 0.55, 0], [0.32, 0.8, 0], 0.035, 18);
  return done('Extractor hood', P, N);
}
function deskFan() {
  const P = [], N = [];
  place(P, N, (p, n) => { shell(p, n, [[0.15, -0.04], [0.15, 0.04]], 0.008, 48); for (const r of [0.05, 0.1]) ringY(p, n, [0, 0.04, 0], r, 0.003); disc(p, n, 0.04, -0.03, false, 24); }, [0, 0.55, 0], [0, 0, PI / 2]);
  rod(P, N, [0, 0.03, 0], [0, 0.4, 0], 0.014, 14);
  lathe(P, N, [[0, 0], [0.12, 0], [0.12, 0.015], [0.11, 0.03], [0, 0.03]], 40);
  return done('Blower', P, N);
}
function funnel() {
  const P = [], N = [];
  shell(P, N, [[0.009, 0], [0.009, 0.12], [0.06, 0.2], [0.062, 0.205]], 0.003, 40);
  return done('Pour spout', P, N);
}
function bell() {
  const P = [], N = [];
  lathe(P, N, [[0.15, 0], [0.15, 0.02], [0.05, 0.1], [0.04, 0.16], [0, 0.16], [0, 0.155], [0.035, 0.155], [0.045, 0.1],
    [0.145, 0.02], [0.145, 0], [0.15, 0]], 40);
  return done('Extractor hood', P, N);
}
function funnelCone() {
  const P = [], N = [];
  shell(P, N, [[0.009, 0], [0.06, 0.08], [0.062, 0.085]], 0.003, 40);
  return done('Pour spout', P, N);
}
function funnelWide() {
  const P = [], N = [];
  shell(P, N, [[0.018, 0], [0.12, 0.16], [0.124, 0.17]], 0.006, 40);
  return done('Pour spout', P, N);
}
function pendant() {
  const P = [], N = [];
  disc(P, N, 0.03, 0.25, true, 24); lathe(P, N, [[0.03, 0.245], [0.03, 0.25]], 24); disc(P, N, 0.03, 0.245, false, 24);
  rod(P, N, [0, 0.05, 0], [0, 0.245, 0], 0.004, 10);
  lathe(P, N, [[0, 0], [0.012, 0.004], [0.016, 0.03], [0.008, 0.055], [0, 0.055]], 24);
  return done('Mist nozzle', P, N);
}
function roundRail() {
  const P = [], N = [];
  rod(P, N, [-0.8, 0.12, 0], [0.8, 0.12, 0], 0.01, 16);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) { rod(P, N, [x, 0.04, 0], [x, 0.12, 0], 0.004, 10); place(P, N, (p, n) => lathe(p, n, [[0, 0], [0.01, 0.004], [0.013, 0.025], [0.006, 0.045], [0, 0.045]], 20), [x, 0, 0]); }
  return done('Nozzle rail', P, N);
}
function gridDrain() {
  const P = [], N = [];
  const h = 0.18, t = 0.012, y = 0.005;
  for (const s of [-1, 1]) { box(P, N, [0, y, s * (h - t)], [h, y, t]); box(P, N, [s * (h - t), y, 0], [t, y, h - 2 * t]); }
  for (let i = -3; i <= 3; i++) { box(P, N, [i * 0.045, y, 0], [0.0035, y, h - 2 * t]); box(P, N, [0, y, i * 0.045], [h - 2 * t, y, 0.0035]); }
  return done('Floor drain', P, N);
}
function panelLight() {
  const P = [], N = [];
  lathe(P, N, [[0, 0], [0.2, 0], [0.2, 0.015], [0.18, 0.03], [0, 0.03]], 48);
  rod(P, N, [0, 0.03, 0], [0, 2.1, 0], 0.012, 12);
  place(P, N, (p, n) => plate(p, n, [0, 0, 0], [0.25, 0.01, 0.175], 0.02), [0, 2.25, 0.05], [-PI / 2 + 0.45, 0, 0]);
  return done('Light stand', P, N);
}
function fineGear() {
  const P = [], N = [];
  torusZ(P, N, [0, 0, 0], 0.52, 0.035, 72, 12);
  for (let i = 0; i < 32; i++) { const a = i / 32 * PI * 2; box(P, N, [Math.cos(a) * 0.575, Math.sin(a) * 0.575, 0], [0.028, 0.022, 0.03], [0, 0, a]); }
  return done('Toothed ring', P, N);
}
function trough() {
  const P = [], N = [];
  const prof = [];
  for (let i = 0; i <= 20; i++) { const a = PI + PI * i / 20; prof.push([Math.cos(a) * 0.095, 0.095 + Math.sin(a) * 0.095]); }
  const inner = prof.map(([x, y]) => { const dx = x, dy = y - 0.095, l = Math.hypot(dx, dy); return [dx / l * 0.075, 0.095 + dy / l * 0.075]; }).reverse();
  const ring = [...prof, ...inner, prof[0]];
  for (let i = 0; i < ring.length - 1; i++) {
    const [z0, y0] = ring[i], [z1, y1] = ring[i + 1], dz = z1 - z0, dy = y1 - y0, l = Math.hypot(dz, dy) || 1, n = [0, -dz / l, dy / l];
    const q = [[-0.6, y0, z0], [0.6, y0, z0], [0.6, y1, z1], [-0.6, y1, z1]];
    for (const k of [0, 1, 2, 0, 2, 3]) { P.push(...q[k]); N.push(...n); }
  }
  for (const x of [-0.6, 0.6]) for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1], c = inner[inner.length - 2 - i], d = inner[inner.length - 1 - i], n = [Math.sign(x), 0, 0];
    for (const v of [a, b, c, a, c, d]) { P.push(x, v[1], v[0]); N.push(...n); }
  }
  return done('Clear channel', P, N);
}
function slimFence() {
  const P = [], N = [];
  for (const x of [-0.45, 0.45]) rod(P, N, [x, 0, 0], [x, 0.9, 0], 0.012, 12);
  for (const y of [0.1, 0.8]) rod(P, N, [-0.45, y, 0], [0.45, y, 0], 0.006, 10);
  for (let i = 1; i < 15; i++) rod(P, N, [-0.45 + i * 0.06, 0.04, 0], [-0.45 + i * 0.06, 0.86, 0], 0.003, 8);
  return done('Fence', P, N);
}
function coneTree() {
  const P = [], N = [];
  rod(P, N, [0, 0, 0], [0, 0.12, 0], 0.012, 10);
  lathe(P, N, [[0, 0.1], [0.14, 0.12], [0, 0.62]], 24);
  return done('Model tree', P, N);
}
function thinFrame() {
  const P = [], N = [];
  for (const x of [-0.62, 0.62]) box(P, N, [x, 1.15, 0], [0.02, 1.15, 0.02]);
  box(P, N, [0, 2.3, 0], [0.64, 0.02, 0.02]);
  box(P, N, [0, 2.03, 0], [0.6, 0.008, 0.008]);
  return done('Frame', P, N);
}


const mist = (at, extra = {}) => ({ type: 'smoke', at, dir: [0, -1, 0], radius: 0.08, speed: 1.4, rate: 2, heat: 0, color: '#eeeeec', ...extra });

export const ASSET_GROUPS = ['People', 'Studio', 'Table top', 'Model making', 'Fluid kits'];

export const ASSETS = [
  { id: 'figure-stand', group: 'People', label: 'Standing', name: 'Figure', icon: 'figure', mesh: () => figure('stand'), color: '#d8d3ca', finish: 'matte' },
  { id: 'figure-walk', group: 'People', label: 'Walking', name: 'Walker', icon: 'figureWalk', mesh: () => figure('walk'), color: '#d8d3ca', finish: 'matte' },
  { id: 'figure-rifle', group: 'People', label: 'With rifle', name: 'Soldier', icon: 'soldier', mesh: () => figure('rifle'), color: '#2a3122', finish: 'matte' },

  { id: 'backdrop', group: 'Studio', label: 'Backdrop', icon: 'backdrop', mesh: () => sweep(3.2, 1.8, 0.9, 2.4, 0.015), design: 2, before: { 1: () => sweep() }, color: '#d9d7d2', finish: 'matte' },
  { id: 'light-stand', group: 'Studio', label: 'Light stand', icon: 'lightStand', mesh: panelLight, design: 2, before: { 1: lightStand }, color: '#34373c', finish: 'metal' },
  { id: 'gear-ring', group: 'Studio', label: 'Toothed ring', icon: 'gear', mesh: fineGear, design: 2, before: { 1: gearRing }, color: '#8d939b', finish: 'matte' },
  { id: 'blower', group: 'Studio', label: 'Blower', icon: 'blower', mesh: deskFan, design: 2, before: { 1: blower }, color: '#6d7178', finish: 'gloss',
    sources: [{ type: 'smoke', at: [-0.13, 0.55, 0], dir: [-1, 0.05, 0], radius: 0.08, speed: 2.6, rate: 2, heat: 0.3, color: '#f4f6fa' }] },

  { id: 'channel', group: 'Table top', label: 'Clear channel', icon: 'channel', mesh: trough, design: 2, before: { 1: channel }, color: '#d6f3f7', finish: 'glass' },
  { id: 'tray', group: 'Table top', label: 'Clear basin', icon: 'tray', mesh: tray, color: '#d6f3f7', finish: 'glass' },
  { id: 'lab-stand', group: 'Table top', label: 'Stand', icon: 'labStand', mesh: labStand, color: '#0f7a30', finish: 'gloss' },
  { id: 'tube', group: 'Table top', label: 'Tube', icon: 'tube', shape: 'column', size: [0.045, 0.35, 0.045], rot: [PI / 2, 0, 0], color: '#efd3c9', finish: 'gloss' },
  { id: 'ribbed', group: 'Table top', label: 'Ribbed panel', icon: 'ribbed', mesh: ribbed, color: '#efd3c9', finish: 'gloss' },
  { id: 'frosted-ball', group: 'Table top', label: 'Frosted ball', icon: 'frosted', shape: 'ball', size: [0.07, 0.07, 0.07], color: '#ffffff', finish: 'frosted', moves: true, material: 'plastic' },
  { id: 'metal-block', group: 'Table top', label: 'Metal block', icon: 'block', shape: 'box', size: [0.09, 0.05, 0.07], color: '#7d8289', finish: 'metal', moves: true, material: 'metal' },
  { id: 'spring', group: 'Table top', label: 'Spring', icon: 'spring', mesh: spring, color: '#b9bdc2', finish: 'metal', porous: true },

  { id: 'waffle', group: 'Model making', label: 'Waffle base', icon: 'waffle', mesh: waffle, color: '#c48e58', finish: 'matte', porous: true },
  { id: 'post', group: 'Model making', label: 'Post', icon: 'post', shape: 'column', size: [0.018, 0.5, 0.018], color: '#d9ea1c', finish: 'gloss' },
  { id: 'fence', group: 'Model making', label: 'Fence', icon: 'fence', mesh: slimFence, design: 2, before: { 1: fence }, color: '#d9ea1c', finish: 'gloss', porous: true },
  { id: 'tree', group: 'Model making', label: 'Model tree', icon: 'tree', mesh: coneTree, design: 2, before: { 1: tree }, color: '#a9bf93', finish: 'matte' },
  { id: 'slats', group: 'Model making', label: 'Slats', icon: 'slats', mesh: slats, color: '#f3c8a8', finish: 'gloss', porous: true },
  { id: 'frame', group: 'Model making', label: 'Frame', icon: 'frame', mesh: thinFrame, design: 2, before: { 1: frame }, color: '#e9e9e9', finish: 'matte' },

  { id: 'nozzle', group: 'Fluid kits', label: 'Mist nozzle', icon: 'nozzle', mesh: pendant, design: 2, before: { 1: nozzle }, color: '#2a2a2a', finish: 'matte', lift: 2,
    sources: [mist([0, -0.01, 0])] },
  { id: 'nozzle-rail', group: 'Fluid kits', label: 'Nozzle rail', icon: 'rail', mesh: roundRail, design: 2, before: { 1: nozzleRail }, color: '#2a2a2a', finish: 'matte', lift: 2.2,
    sources: [-0.6, -0.2, 0.2, 0.6].map(x => mist([x, -0.01, 0], { radius: 0.07 })) },
  { id: 'pour', group: 'Fluid kits', label: 'Pour spout', icon: 'pour', mesh: funnelWide, design: 4, before: { 1: spout, 2: funnel, 3: funnelCone }, color: '#e8e8e6', finish: 'gloss', lift: 1.1,
    sources: [{ type: 'liquid', at: [0, -0.01, 0], dir: [0, -1, 0], radius: 0.05, speed: 1.2, rate: 1, color: '#2a8de8' }] },
  { id: 'floor-drain', group: 'Fluid kits', label: 'Floor drain', icon: 'floorDrain', mesh: gridDrain, design: 2, before: { 1: floorDrain }, color: '#9aa0a8', finish: 'metal', collides: false,
    sources: [{ type: 'liquid', sink: true, at: [0, 0.03, 0], dir: [0, 1, 0], radius: 0.15, rate: 1 }] },
  { id: 'hood', group: 'Fluid kits', label: 'Extractor hood', icon: 'hood', mesh: bell, design: 3, before: { 1: hood, 2: snorkel }, color: '#c9ccd1', finish: 'metal', lift: 0.6,
    sources: [{ type: 'smoke', sink: true, at: [0, 0.045, 0], dir: [0, 1, 0], radius: 0.3, rate: 2 }] },
];

export const ASSET_BY_ID = Object.fromEntries(ASSETS.map(a => [a.id, a]));

const made = {};
export const designOf = id => (ASSET_BY_ID[id] && ASSET_BY_ID[id].design) || 1;
export const assetModelId = (id, design = designOf(id)) => 'asset:' + id + (design > 1 ? '@' + design : '');
export function assetModel(id, design = designOf(id)) {
  const a = ASSET_BY_ID[id];
  if (!a || !a.mesh) return null;
  const make = design === designOf(id) ? a.mesh : a.before && a.before[design];
  if (!make) return null;
  const key = id + '@' + design;
  if (!made[key]) {
    const m = make(), p = m.positions, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
    made[key] = { ...m, name: a.label, asset: id, design, triangles: p.length / 9, centre: lo.map((v, k) => (v + hi[k]) / 2) };
  }
  return made[key];
}

export const OBJECT_FINISHES = [['plain', 'Plain'], ['matte', 'Matte'], ['gloss', 'Gloss'], ['metal', 'Metal'], ['glass', 'Clear'], ['frosted', 'Frosted']];

export const SWATCHES = [
  { label: 'Plaster', color: '#f1efea', finish: 'matte' },
  { label: 'Cardboard', color: '#cfb495', finish: 'matte' },
  { label: 'Wood', color: '#c48e58', finish: 'matte' },
  { label: 'Lime print', color: '#d9ea1c', finish: 'gloss' },
  { label: 'Blush', color: '#efd3c9', finish: 'gloss' },
  { label: 'Signal red', color: '#c4101a', finish: 'gloss' },
  { label: 'Studio blue', color: '#1636c8', finish: 'matte' },
  { label: 'Lab green', color: '#0f7a30', finish: 'gloss' },
  { label: 'Steel', color: '#7d8289', finish: 'metal' },
  { label: 'Aluminium', color: '#b9bdc2', finish: 'metal' },
  { label: 'Acrylic', color: '#d6f3f7', finish: 'glass' },
  { label: 'Frosted', color: '#ffffff', finish: 'frosted' },
  { label: 'Graphite', color: '#2a2c30', finish: 'matte' },
  { label: 'Figure grey', color: '#2a3122', finish: 'matte' },
];
