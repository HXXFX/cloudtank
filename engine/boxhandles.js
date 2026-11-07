import { clamp } from './math.js';
import { project, lineParam, planeHit, HOT } from './gizmo.js';
import { seg3 } from './marks.js';

export const BOX_BLUE = '#40a6ff';
const PICK = 11;
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
export const FACES = [{ axis: 0, side: 1 }, { axis: 0, side: -1 }, { axis: 2, side: 1 }, { axis: 2, side: -1 }, { axis: 1, side: 1 }];
const UNIT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const mm = v => Math.round(v * 1000) / 1000;

export function regionBox(R) {
  return { min: [R.center[0] - R.size[0] / 2, 0, R.center[1] - R.size[2] / 2],
    max: [R.center[0] + R.size[0] / 2, R.size[1], R.center[1] + R.size[2] / 2] };
}

export function boxHandles(R, cam, W, H) {
  const b = regionBox(R), mid = [(b.min[0] + b.max[0]) / 2, b.max[1] / 2, (b.min[2] + b.max[2]) / 2];
  const faces = FACES.map((f, i) => {
    const p = [...mid];
    p[f.axis] = f.side > 0 ? b.max[f.axis] : b.min[f.axis];
    return { ...f, i, world: p, s: project(cam, p, W, H) };
  });
  const base = [mid[0], 0, mid[2]];
  return { faces, base: { world: base, s: project(cam, base, W, H) } };
}

export function hitBoxHandle(R, cam, W, H, mx, my) {
  const L = boxHandles(R, cam, W, H);
  let best = null, bestD = PICK;
  for (const f of L.faces) {
    if (f.s[2] <= 0) continue;
    const d = Math.hypot(f.s[0] - mx, f.s[1] - my);
    if (d < bestD) { best = { type: 'face', i: f.i }; bestD = d; }
  }
  const s = L.base.s;
  if (s[2] > 0 && Math.max(Math.abs(s[0] - mx), Math.abs(s[1] - my)) < bestD) best = { type: 'base' };
  return best;
}

const rayAt = (cam, W, H, mx, my) => cam.ray(mx / W, my / H);

export function beginBoxDrag(R, h, cam, W, H, mx, my) {
  const L = boxHandles(R, cam, W, H), ray = rayAt(cam, W, H, mx, my);
  const R0 = { size: [...R.size], center: [...R.center] };
  if (h.type === 'face') {
    const f = L.faces[h.i], s0 = lineParam(f.world, UNIT[f.axis], ray);
    return s0 === null ? null : { h, R0, c0: f.world, s0 };
  }
  const p0 = planeHit(L.base.world, [0, 1, 0], ray);
  return p0 ? { h, R0, p0 } : null;
}

export function moveBoxDrag(dr, cam, W, H, mx, my, limits, steps = false) {
  const ray = rayAt(cam, W, H, mx, my), R0 = dr.R0;
  const snap = v => steps ? Math.round(v * 10) / 10 : v;
  const R = { size: [...R0.size], center: [...R0.center] };
  const done = readout => ({ region: { size: R.size.map(mm), center: R.center.map(v => Math.round(v * 2000) / 2000) }, readout });
  if (dr.h.type === 'base') {
    const p = planeHit(dr.p0, [0, 1, 0], ray);
    if (!p) return null;
    R.center = [clamp(snap(R0.center[0] + p[0] - dr.p0[0]), -20, 20), clamp(snap(R0.center[1] + p[2] - dr.p0[2]), -20, 20)];
    return done(`Box at X ${R.center[0].toFixed(2)}, Z ${R.center[1].toFixed(2)} m`);
  }
  const f = FACES[dr.h.i], s = lineParam(dr.c0, UNIT[f.axis], ray);
  if (s === null) return null;
  const d = s - dr.s0;
  const name = ['Width', 'Height', 'Depth'][f.axis];
  if (f.axis === 1) {
    R.size[1] = clamp(snap(R0.size[1] + d), limits.min, limits.max);
    return done(`${name} ${R.size[1].toFixed(2)} m`);
  }
  const k = f.axis === 0 ? 0 : 1, b = regionBox(R0);
  const lo = b.min[f.axis], hi = b.max[f.axis];
  const size = clamp(snap(R0.size[f.axis] + d * f.side), limits.min, limits.max);
  R.size[f.axis] = size;
  R.center[k] = clamp(f.side > 0 ? lo + size / 2 : hi - size / 2, -20, 20);
  return done(`${name} ${size.toFixed(2)} m`);
}

export function drawLanding(ctx, cam, p, W, H) {
  const ring = [];
  for (let i = 0; i <= 32; i++) {
    const a = i / 32 * Math.PI * 2, s = project(cam, [p[0] + Math.cos(a) * 0.25, p[1] + 0.005, p[2] + Math.sin(a) * 0.25], W, H);
    if (s[2] <= 0) return;
    ring.push(s);
  }
  const foot = project(cam, p, W, H), top = project(cam, [p[0], p[1] + 0.3, p[2]], W, H);
  ctx.lineCap = 'round';
  for (const [width, color] of [[4, 'rgba(0, 0, 0, 0.45)'], [2, BOX_BLUE]]) {
    ctx.beginPath();
    ring.forEach((s, i) => i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]));
    if (top[2] > 0) { ctx.moveTo(foot[0], foot[1]); ctx.lineTo(top[0], top[1]); }
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(foot[0], foot[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = BOX_BLUE; ctx.fill();
}

export function drawReach(ctx, e, cam, W, H) {
  const c = project(cam, e.pos, W, H), edge = project(cam, [e.pos[0] + cam.right[0] * e.radius, e.pos[1] + cam.right[1] * e.radius, e.pos[2] + cam.right[2] * e.radius], W, H);
  if (c[2] <= 0 || edge[2] <= 0) return;
  const r = Math.hypot(edge[0] - c[0], edge[1] - c[1]);
  if (r < 2) return;
  ctx.save();
  ctx.setLineDash([5, 4]);
  for (const [width, color] of [[3, 'rgba(255, 255, 255, 0.55)'], [1.5, e.sink ? 'rgba(20, 24, 28, 0.9)' : BOX_BLUE]]) {
    ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  }
  ctx.restore();
}

export function drawBox(ctx, R, cam, W, H, { handles = true, hot = null, readout = null, mouse = null } = {}) {
  const b = regionBox(R);
  const corner = i => [(i & 1 ? b.max : b.min)[0], (i & 2 ? b.max : b.min)[1], (i & 4 ? b.max : b.min)[2]];
  const segs = EDGES.map(([i, j]) => seg3(cam, corner(i), corner(j), W, H)).filter(Boolean);
  ctx.lineCap = 'round';
  for (const [width, color] of [[4, 'rgba(0, 0, 0, 0.45)'], [2, BOX_BLUE]]) {
    ctx.beginPath();
    for (const [p, q] of segs) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  }
  if (!handles) return;
  const L = boxHandles(R, cam, W, H);
  const isHot = h => hot && hot.type === h.type && hot.i === h.i;
  for (const f of L.faces) {
    if (f.s[2] <= 0) continue;
    const on = isHot({ type: 'face', i: f.i });
    ctx.beginPath(); ctx.arc(f.s[0], f.s[1], on ? 8 : 6.5, 0, Math.PI * 2);
    ctx.fillStyle = on ? HOT : '#f2f4f6'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = on ? 'rgba(0, 0, 0, 0.55)' : BOX_BLUE; ctx.stroke();
  }
  const s = L.base.s;
  if (s[2] > 0) {
    const on = isHot({ type: 'base' }), r = on ? 7.5 : 6;
    ctx.beginPath(); ctx.rect(s[0] - r, s[1] - r, r * 2, r * 2);
    ctx.fillStyle = on ? HOT : BOX_BLUE; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'; ctx.stroke();
  }
  if (readout && mouse) {
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    const w = ctx.measureText(readout).width + 14, x = Math.min(mouse[0] + 16, W - w - 4), y = Math.min(mouse[1] + 18, H - 26);
    ctx.fillStyle = 'rgba(16,18,21,0.82)';
    ctx.beginPath(); ctx.roundRect(x, y, w, 22, 6); ctx.fill();
    ctx.fillStyle = '#eef0f2'; ctx.textBaseline = 'middle';
    ctx.fillText(readout, x + 7, y + 11.5);
  }
}
