import { add, sub, scale, dot, cross, normalize, length, transform, eulerAxes, clamp } from './math.js';
import { eulerOf } from './physics.js';
import { SHAPES } from './shapes.js';

export const SIZE = 96;
const RING = 0.85;
const COLORS = ['#ef5b5b', '#74cc4f', '#4f8ff7'];
export const HOT = '#ffd447';
const WORLD = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const NAMES = ['X', 'Y', 'Z'];
const STEP = { move: 0.1, turn: Math.PI / 12, size: 0.1 };
const LIMIT = { x: 12, y: 12 };

export function project(cam, p, W, H) {
  const c = transform(cam.viewProj, [p[0], p[1], p[2], 1]);
  return [(c[0] / c[3] * 0.5 + 0.5) * W, (0.5 - c[1] / c[3] * 0.5) * H, c[3]];
}

export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = dot(k, v);
  const kx = cross(k, v);
  return [v[0] * c + kx[0] * s + k[0] * kv * (1 - c), v[1] * c + kx[1] * s + k[1] * kv * (1 - c), v[2] * c + kx[2] * s + k[2] * kv * (1 - c)];
}

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const len2 = a => Math.hypot(a[0], a[1]);
const norm2 = a => { const l = len2(a) || 1; return [a[0] / l, a[1] / l]; };
function segDist(p, a, b) {
  const ab = sub2(b, a), t = clamp(dot2(sub2(p, a), ab) / Math.max(dot2(ab, ab), 1e-9), 0, 1);
  return len2(sub2(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
}
function inQuad(p, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
  }
  return true;
}
export function lineParam(c, a, ray) {
  const w = sub(c, ray.origin), b = dot(a, ray.dir), den = 1 - b * b;
  if (den < 1e-5) return null;
  return (b * dot(ray.dir, w) - dot(a, w)) / den;
}
export function planeHit(c, n, ray) {
  const dn = dot(ray.dir, n);
  if (Math.abs(dn) < 1e-5) return null;
  const t = dot(sub(c, ray.origin), n) / dn;
  return t > 0 ? add(ray.origin, scale(ray.dir, t)) : null;
}

export class Gizmo {
  constructor() {
    this.mode = 'move';
    this.space = 'world';
    this.hover = null;
    this.drag = null;
  }

  axesFor(item) {
    if (!item.rot) return WORLD;
    return this.mode === 'size' || this.space === 'object' ? eulerAxes(item.rot) : WORLD;
  }

  layout(item, cam, W, H) {
    const c = item.pos, S = project(cam, c, W, H);
    const depth = dot(sub(c, cam.eye), cam.forward);
    if (depth < 0.1 || S[2] <= 0) return null;
    const L = SIZE * 2 * Math.tan(cam.fov / 2) * depth / H;
    const axes = this.drag ? this.drag.axes : this.axesFor(item);
    const toCam = normalize(sub(cam.eye, c));
    const P = p => project(cam, p, W, H);
    const out = { c, S, L, axes, toCam, axis: [], plane: [], ring: [] };
    for (let i = 0; i < 3; i++) {
      const a = axes[i], tip = P(add(c, scale(a, L))), d = sub2(tip, S), dl = len2(d);
      out.axis.push({ i, a, tip, dir: norm2(d), lenPx: dl, shown: dl > SIZE * 0.2 && tip[2] > 0,
        start: P(add(c, scale(a, L * 0.2))) });
      const j = (i + 1) % 3, k = (i + 2) % 3;
      const corner = (u, v) => P(add(c, add(scale(axes[j], L * u), scale(axes[k], L * v))));
      out.plane.push({ i, quad: [corner(0.24, 0.24), corner(0.46, 0.24), corner(0.46, 0.46), corner(0.24, 0.46)],
        shown: Math.abs(dot(a, toCam)) > 0.22 });
      const u = axes[j], v = axes[k], R = L * RING, pts = [];
      for (let n = 0; n <= 72; n++) {
        const t = n / 72 * Math.PI * 2, rad = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
        pts.push({ t, rad, s: P(add(c, scale(rad, R))), front: dot(rad, toCam) > -0.06 });
      }
      out.ring.push({ i, a, pts });
    }
    return out;
  }

  hit(item, cam, W, H, mx, my) {
    const g = this.layout(item, cam, W, H);
    if (!g) return null;
    const m = [mx, my];
    if (this.mode === 'turn') {
      let best = null, bd = 8;
      for (const r of g.ring) for (let n = 0; n < 72; n++) {
        const p = r.pts[n], q = r.pts[n + 1];
        if (!p.front || !q.front) continue;
        const d = segDist(m, p.s, q.s);
        if (d < bd) { bd = d; best = { type: 'ring', i: r.i }; }
      }
      return best;
    }
    if (len2(sub2(m, g.S)) < (this.mode === 'size' ? 9 : 10)) return { type: 'center', i: -1 };
    let best = null, bd = 9;
    for (const ax of g.axis) {
      if (!ax.shown) continue;
      const d = this.mode === 'size' ? Math.min(len2(sub2(m, ax.tip)) - 2, segDist(m, ax.start, ax.tip))
        : segDist(m, ax.start, [ax.tip[0] + ax.dir[0] * 4, ax.tip[1] + ax.dir[1] * 4]);
      if (d < bd) { bd = d; best = { type: 'axis', i: ax.i }; }
    }
    if (best) return best;
    if (this.mode === 'move') for (const pl of g.plane) if (pl.shown && inQuad(m, pl.quad)) return { type: 'plane', i: pl.i };
    return null;
  }

  begin(item, h, cam, W, H, mx, my) {
    const g = this.layout(item, cam, W, H);
    if (!g) return false;
    const ray = cam.ray(mx / W, my / H);
    const dr = this.drag = { h, item, mx, my, axes: g.axes, c0: [...item.pos], L: g.L,
      pos0: [...item.pos], rot0: item.rot ? [...item.rot] : null, size0: item.size ? [...item.size] : null,
      radius0: item.radius, dir0: item.dir ? [...item.dir] : null, angle: 0, readout: '' };
    if (this.mode === 'move') {
      if (h.type === 'axis') dr.s0 = lineParam(dr.c0, g.axes[h.i], ray);
      else {
        dr.n = h.type === 'plane' ? g.axes[h.i] : scale(cam.forward, -1);
        dr.p0 = planeHit(dr.c0, dr.n, ray);
      }
    } else if (this.mode === 'turn') {
      const r = g.ring[h.i];
      let best = r.pts[0], bd = Infinity;
      for (const p of r.pts) { const d = len2(sub2([mx, my], p.s)); if (p.front && d < bd) { bd = d; best = p; } }
      const R = g.L * RING, P0 = add(dr.c0, scale(best.rad, R));
      const tan = cross(g.axes[h.i], best.rad);
      const a = project(cam, P0, W, H), b = project(cam, add(P0, scale(tan, R * 0.1)), W, H);
      const d = sub2(b, a);
      if (len2(d) > SIZE * RING * 0.1 * 0.25) dr.tdir = norm2(d);
      else {
        const out = norm2(sub2(a, g.S)), toward = dot(g.axes[h.i], g.toCam) >= 0 ? 1 : -1;
        dr.tdir = [-out[1] * toward, out[0] * toward];
      }
      dr.rpx = SIZE * RING;
      dr.rad0 = best.rad;
    } else {
      if (h.type === 'axis') { const ax = g.axis[h.i]; dr.sdir = ax.dir; dr.lpx = Math.max(ax.lenPx, 1); }
    }
    return true;
  }

  move(cam, W, H, mx, my, steps = false) {
    const dr = this.drag;
    if (!dr) return false;
    const it = dr.item, h = dr.h, ray = cam.ray(mx / W, my / H);
    if (this.mode === 'move') {
      let delta;
      if (h.type === 'axis') {
        const s = lineParam(dr.c0, dr.axes[h.i], ray);
        if (s === null || dr.s0 === null) return false;
        let d = s - dr.s0;
        if (steps) d = Math.round(d / STEP.move) * STEP.move;
        delta = scale(dr.axes[h.i], d);
      } else {
        const p = planeHit(dr.c0, dr.n, ray);
        if (!p || !dr.p0) return false;
        delta = sub(p, dr.p0);
        if (length(delta) > dr.L * 60) return false;
        if (steps) delta = dr.axes.reduce((acc, a) => add(acc, scale(a, Math.round(dot(delta, a) / STEP.move) * STEP.move)), [0, 0, 0]);
      }
      const p = add(dr.pos0, delta);
      it.pos = [clamp(p[0], -LIMIT.x, LIMIT.x), clamp(p[1], 0, LIMIT.y), clamp(p[2], -LIMIT.x, LIMIT.x)];
      dr.readout = it.pos.map((v, k) => `${NAMES[k]} ${v.toFixed(2)}`).join('   ') + ' m';
      return true;
    }
    if (this.mode === 'turn') {
      let a = dot2([mx - dr.mx, my - dr.my], dr.tdir) / dr.rpx;
      if (steps) a = Math.round(a / STEP.turn) * STEP.turn;
      dr.angle = a;
      const k = dr.axes[h.i];
      if (dr.rot0) it.rot = eulerOf(eulerAxes(dr.rot0).map(col => rotate(col, k, a)));
      else if (dr.dir0) it.dir = normalize(rotate(dr.dir0, k, a));
      else return false;
      const deg = a * 180 / Math.PI;
      dr.readout = `${deg > 0 ? '+' : ''}${deg.toFixed(Math.abs(deg) < 10 ? 1 : 0)}°`;
      return true;
    }
    let f;
    if (h.type === 'axis') f = 1 + dot2([mx - dr.mx, my - dr.my], dr.sdir) / dr.lpx;
    else f = 1 + ((mx - dr.mx) - (my - dr.my)) / SIZE;
    f = Math.max(0.05, f);
    if (steps) f = Math.max(STEP.size, Math.round(f / STEP.size) * STEP.size);
    if (it.kind === 'emitter') {
      it.radius = clamp(dr.radius0 * f, 0.03, 1);
      dr.readout = `${(it.radius * 2).toFixed(2)} m across`;
      return true;
    }
    if (it.kind === 'light') {
      it.radius = clamp(dr.radius0 * f, 0.01, 3);
      dr.readout = it.type === 'area' ? `${(it.radius * 2).toFixed(2)} × ${(it.radius * 2 * (it.aspect ?? 0.6)).toFixed(2)} m` : `${(it.radius * 2).toFixed(2)} m across`;
      return true;
    }
    if (!dr.size0) return false;
    const s = [...dr.size0], how = it.shape ? SHAPES[it.shape].sizing : 'xyz', i = h.type === 'axis' ? h.i : -1;
    const grow = k => { s[k] = clamp(dr.size0[k] * f, 0.005, 8); };
    if (i < 0 || how === 'uniform') [0, 1, 2].forEach(grow);
    else if (how === 'radius' && i !== 1) { grow(0); grow(2); }
    else grow(i);
    it.size = s;
    dr.readout = how === 'uniform' ? `${(s[0] * 2).toFixed(2)} m across`
      : how === 'radius' ? `R ${s[0].toFixed(2)}   H ${(s[1] * 2).toFixed(2)} m`
      : `${(s[0] * 2).toFixed(2)} × ${(s[1] * 2).toFixed(2)} × ${(s[2] * 2).toFixed(2)} m`;
    return true;
  }

  end() { const d = this.drag; this.drag = null; return d; }


  draw(ctx, item, cam, W, H, mouse) {
    const g = this.layout(item, cam, W, H);
    if (!g) return;
    const dr = this.drag, act = dr ? dr.h : this.hover;
    const isHot = (type, i) => !!act && act.type === type && act.i === i;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (pts, color, width, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      pts.forEach((p, n) => n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = width + 2; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const fill = (pts, color, alpha) => {
      ctx.beginPath();
      pts.forEach((p, n) => n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.closePath();
      ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    };
    const square = (p, r, color) => fill([[p[0] - r, p[1] - r], [p[0] + r, p[1] - r], [p[0] + r, p[1] + r], [p[0] - r, p[1] + r]], color, 1);

    if (dr && this.mode === 'move' && dr.h.type === 'axis') {
      const a = dr.axes[dr.h.i], far = g.L * 40;
      const p = project(cam, add(dr.c0, scale(a, -far)), W, H), q = project(cam, add(dr.c0, scale(a, far)), W, H);
      if (p[2] > 0 && q[2] > 0) line([p, q], COLORS[dr.h.i], 1, 0.6);
    }

    if (this.mode === 'turn') {
      for (const r of g.ring) {
        const color = isHot('ring', r.i) ? HOT : COLORS[r.i];
        for (const front of [false, true]) {
          let run = [];
          const flush = () => { if (run.length > 1) line(run, color, front ? (isHot('ring', r.i) ? 3.5 : 2.5) : 1.5, front ? 1 : 0.28); run = []; };
          for (const p of r.pts) { if (p.front === front) run.push(p.s); else { if (run.length) run.push(p.s); flush(); } }
          flush();
        }
      }
      if (dr && dr.angle) {
        const k = dr.axes[dr.h.i], R = g.L * RING, pts = [g.S], n = Math.max(2, Math.ceil(Math.abs(dr.angle) / 0.05));
        for (let s = 0; s <= n; s++) pts.push(project(cam, add(dr.c0, scale(rotate(dr.rad0, k, dr.angle * s / n), R)), W, H));
        fill(pts, HOT, 0.22);
      }
    } else {
      if (this.mode === 'move') for (const pl of g.plane) {
        if (!pl.shown) continue;
        fill(pl.quad, isHot('plane', pl.i) ? HOT : COLORS[pl.i], isHot('plane', pl.i) ? 0.6 : 0.32);
      }
      const order = [...g.axis].sort((p, q) => dot(p.a, g.toCam) - dot(q.a, g.toCam));
      for (const ax of order) {
        if (!ax.shown) continue;
        const hot = isHot('axis', ax.i), color = hot ? HOT : COLORS[ax.i];
        if (this.mode === 'move') {
          const head = 15, half = 5.5, base = [ax.tip[0] - ax.dir[0] * head, ax.tip[1] - ax.dir[1] * head];
          line([ax.start, base], color, hot ? 3.5 : 2.5);
          fill([ax.tip, [base[0] - ax.dir[1] * half, base[1] + ax.dir[0] * half], [base[0] + ax.dir[1] * half, base[1] - ax.dir[0] * half]], color, 1);
        } else {
          line([ax.start, ax.tip], color, hot ? 3.5 : 2.5);
          square(ax.tip, hot ? 6 : 5, color);
        }
      }
      const hot = isHot('center', -1);
      if (this.mode === 'size') square(g.S, hot ? 7 : 6, hot ? HOT : '#f2f4f6');
      else {
        ctx.beginPath(); ctx.arc(g.S[0], g.S[1], hot ? 7 : 5.5, 0, Math.PI * 2);
        ctx.fillStyle = hot ? HOT : '#f2f4f6'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    if (dr && dr.readout && mouse) {
      ctx.font = '500 12px Inter, system-ui, sans-serif';
      const w = ctx.measureText(dr.readout).width + 14, x = Math.min(mouse[0] + 16, W - w - 4), y = Math.min(mouse[1] + 18, H - 26);
      ctx.fillStyle = 'rgba(16,18,21,0.82)';
      ctx.beginPath(); ctx.roundRect(x, y, w, 22, 6); ctx.fill();
      ctx.fillStyle = '#eef0f2'; ctx.textBaseline = 'middle';
      ctx.fillText(dr.readout, x + 7, y + 11.5);
    }
  }
}
