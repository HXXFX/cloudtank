
import { project } from './gizmo.js';

export const BADGE = { m: 0.02, min: 5, max: 11, icon: 7, fade: 3.5, gone: 2 };
export const FAINT = 0.42;
export const BEHIND = 1 / 3;
export const MARKER_RULES = { when: 'faint', kits: 'withKit' };
const TAKER = [0.13, 0.14, 0.16];
const OFF = [0.62, 0.64, 0.67];

export function markerOf(vp, e) {
  const S = vp.scene, kit = vp.kitOf(e) || null;
  return { e, kit, pos: e.pos, dir: e.dir || [0, 1, 0], r: Math.max(e.radius * vp.markerSize.k, vp.markerSize.min) * vp.partScale(e),
    reach: e.radius, speed: e.speed || 0, takes: !!e.sink, smoke: e.type === 'smoke', color: e.color, on: vp.isOn(e), part: !!kit,
    picked: S.isPicked(e) || !!(kit && S.isPicked(kit)), hidden: !!(e.hidden || (kit && kit.hidden)) };
}

export function kindShown(vp, e) {
  const D = vp.display, part = !!(e.attach && vp.kitOf(e));
  return (e.sink ? D.takers !== false : D.sources !== false) && (!part || D.parts !== false);
}

export const markerIcon = m => (m.takes ? (m.smoke ? 'extractor' : 'drain') : m.smoke ? 'smoke' : 'liquid');
export const markerColor = m => (!m.on ? OFF : m.takes ? TAKER : m.color);

const css = c => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
const lum = c => { const f = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const darkEdge = c => { const L = lum(c); return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05); };
export const pxOf = (view, p, r) => { const c = view.P(p), e = view.P([p[0] + view.right[0] * r, p[1] + view.right[1] * r, p[2] + view.right[2] * r]); return Math.hypot(e[0] - c[0], e[1] - c[1]); };

const SHAPES = new WeakMap();
function shapesOf(iconFn, name) {
  let byName = SHAPES.get(iconFn);
  if (!byName) SHAPES.set(iconFn, byName = new Map());
  if (byName.has(name)) return byName.get(name);
  const out = [];
  for (const n of iconFn(name, 24).children) {
    const g = k => parseFloat(n.getAttribute(k) || 0), p = new Path2D();
    if (n.tagName === 'path') p.addPath(new Path2D(n.getAttribute('d')));
    else if (n.tagName === 'circle') p.arc(g('cx'), g('cy'), g('r'), 0, Math.PI * 2);
    else if (n.tagName === 'ellipse') p.ellipse(g('cx'), g('cy'), g('rx'), g('ry'), 0, 0, Math.PI * 2);
    else if (n.tagName === 'rect') p.rect(g('x'), g('y'), g('width'), g('height'));
    out.push({ p, fill: n.getAttribute('fill') === 'currentColor' });
  }
  byName.set(name, out);
  return out;
}

export function drawBadge(ctx, m, view, o = {}) {
  const alpha = o.alpha ?? 1, strong = !!o.strong;
  const c = view.P(m.pos);
  if (alpha <= 0 || c[2] <= 0) return null;
  const natural = pxOf(view, m.pos, BADGE.m);
  const away = strong ? 1 : Math.min(Math.max((natural - BADGE.gone) / (BADGE.fade - BADGE.gone), 0), 1);
  if (away < 0.05) { o.out = 'far'; return null; }
  let R = Math.min(Math.max(natural, BADGE.min), BADGE.max);
  if (strong) R = Math.max(R + 2, BADGE.icon + 2);
  const col = markerColor(m), pic = R >= BADGE.icon;
  ctx.save();
  ctx.globalAlpha = alpha * away;
  ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI * 2);
  if (pic) {
    ctx.fillStyle = 'rgba(16, 18, 21, 0.66)'; ctx.fill();
    ctx.lineWidth = strong ? 2.5 : 1.75; ctx.strokeStyle = css(col); ctx.stroke();
    const s = (R * 1.25) / 24;
    ctx.translate(c[0] - 12 * s, c[1] - 12 * s); ctx.scale(s, s);
    ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'; ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    if (o.icon) for (const sh of shapesOf(o.icon, markerIcon(m))) { if (sh.fill) ctx.fill(sh.p); else ctx.stroke(sh.p); }
    else { ctx.beginPath(); ctx.arc(12, 12, 3, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = css(col); ctx.fill();
    ctx.lineWidth = 1.25; ctx.strokeStyle = darkEdge(col) ? 'rgba(8, 10, 12, 0.7)' : 'rgba(255, 255, 255, 0.8)'; ctx.stroke();
  }
  ctx.restore();
  return [c[0] - R - 1, c[1] - R - 1, c[0] + R + 1, c[1] + R + 1];
}

export function pointedAt(vp) {
  const m = vp.mouseAt, W = vp.canvas.clientWidth, H = vp.canvas.clientHeight;
  if (!vp.mouseIn || !m || !W || !H || vp.drag) return null;
  const hit = vp.scene.pick(vp.camera.ray(m[0] / W, m[1] / H), { ground: false });
  return hit ? hit.item : null;
}

const SEEN = new WeakMap();
export function behindThing(vp, mk, frame = 0) {
  const had = SEEN.get(mk.e);
  if (had && frame - had.frame < 4 && frame >= had.frame) return had.behind;
  const S = vp.scene, eye = vp.camera.eye, d = [mk.pos[0] - eye[0], mk.pos[1] - eye[1], mk.pos[2] - eye[2]], len = Math.hypot(d[0], d[1], d[2]);
  let behind = false;
  if (len > 1e-6) {
    const objects = S.objects.filter(o => o !== mk.kit && o.finish !== 'glass');
    const hit = S.pick.call({ emitters: [], lights: [], objects, softBodyOf: o => S.softBodyOf(o), meshOf: o => S.meshOf(o) },
      { origin: [...eye], dir: d.map(x => x / len) }, { ground: false, emitters: false });
    behind = !!hit && hit.t < len - 0.01;
  }
  SEEN.set(mk.e, { frame, behind });
  return behind;
}

export function markerAlpha(vp, mk, hot, rules = MARKER_RULES) {
  if (mk.hidden) return [0, 'eye'];
  if (vp.clean) return [0, 'clean'];
  if (!kindShown(vp, mk.e)) return [0, 'menu'];
  const active = mk.picked || (hot && (hot === mk.e || (mk.kit && hot === mk.kit)));
  if (mk.part && rules.kits === 'withKit' && !active) return [0, 'kit'];
  if (rules.when === 'selected' && !active) return [0, 'when'];
  return [rules.when === 'faint' && !active ? FAINT : 1, active ? 'strong' : ''];
}

export function drawMarkers(ctx, vp, W, H, rules = MARKER_RULES) {
  const view = { P: p => project(vp.camera, p, W, H), right: vp.camera.right };
  const hot = pointedAt(vp), frame = (vp.markerFrame = (vp.markerFrame || 0) + 1), rows = [];
  for (const e of vp.scene.emitters) {
    const mk = markerOf(vp, e), [a, why] = markerAlpha(vp, mk, hot, rules);
    const row = { e, name: e.name, part: mk.part, takes: mk.takes, alpha: a, why, behind: false, box: null };
    rows.push(row);
    if (a <= 0) continue;
    row.behind = behindThing(vp, mk, frame);
    const o = { alpha: a * (row.behind ? BEHIND : 1), strong: why === 'strong', icon: vp.markerIcon };
    row.box = drawBadge(ctx, mk, view, o);
    if (!row.box && o.out) { row.alpha = 0; row.why = o.out; }
  }
  return rows;
}
