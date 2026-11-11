import { project } from './gizmo.js';

export const PIN = { needle: 19, head: 7, hot: '#c6e4f0' };
const DARK = 'rgba(16, 18, 21, 0.82)', WHITE = 'rgba(255, 255, 255, 0.96)';

export const holds = q => q.length < 4 || q[3] !== 0;

export function pinPlaces(vp, o) {
  const b = vp.soft && vp.soft.bodies.get(o.id), at = (o.soft && o.soft.pinAt) || [];
  if (!b) return [];
  return at.map((q, k) => {
    const px = q[0] * o.size[0], py = q[1] * o.size[1], pz = q[2] * o.size[2];
    let best = -1, bd = 1e18;
    for (let i = 0; i < b.n; i++) { const d = (b.r[i * 3] - px) ** 2 + (b.r[i * 3 + 1] - py) ** 2 + (b.r[i * 3 + 2] - pz) ** 2; if (d < bd) { bd = d; best = i; } }
    return { k, n: k + 1, q, hold: holds(q), pos: best >= 0 ? [b.x[best * 3], b.x[best * 3 + 1], b.x[best * 3 + 2]] : null };
  });
}

export function drawPushpin(ctx, c, o = {}) {
  const strong = !!o.strong, hold = o.hold !== false, H = strong ? PIN.needle + 3 : PIN.needle, R = strong ? PIN.head + 1 : PIN.head;
  const hx = c[0], hy = c[1] - H;
  ctx.save();
  ctx.globalAlpha = hold ? 1 : 0.55;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(hx, hy + R - 1);
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = DARK;
  if (!hold) ctx.setLineDash([2, 2]);
  ctx.stroke(); ctx.setLineDash([]);
  if (hold) { ctx.beginPath(); ctx.arc(c[0], c[1], 2, 0, Math.PI * 2); ctx.fillStyle = DARK; ctx.fill(); }
  ctx.beginPath(); ctx.arc(hx, hy, R, 0, Math.PI * 2);
  ctx.fillStyle = hold ? DARK : 'rgba(255, 255, 255, 0.9)'; ctx.fill();
  ctx.lineWidth = strong ? 2.5 : 1.6; ctx.strokeStyle = strong ? PIN.hot : hold ? WHITE : DARK; ctx.stroke();
  if (o.n != null) {
    ctx.font = `600 10px ${o.font || 'Inter, system-ui, sans-serif'}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = hold ? WHITE : DARK; ctx.fillText(String(o.n), hx, hy + 0.5);
  }
  ctx.restore();
  return { head: [hx, hy, R], box: [Math.floor(hx - R - 1), Math.floor(hy - R - 1), Math.ceil(hx + R + 1), Math.ceil(c[1] + 3)] };
}

export function drawPins(ctx, vp, W, H) {
  const rows = [];
  if (vp.clean) return rows;
  const font = getComputedStyle(document.body).fontFamily, hot = vp.pinHot;
  for (const o of vp.selectedItems()) {
    if (o.kind !== 'object' || !o.soft || o.soft.on === false || o.hidden) continue;
    for (const p of pinPlaces(vp, o)) {
      if (!p.pos) continue;
      const c = project(vp.camera, p.pos, W, H);
      if (c[2] <= 0) continue;
      const strong = !!hot && hot.id === o.id && hot.k === p.k;
      const d = drawPushpin(ctx, c, { n: p.n, hold: p.hold, strong, font });
      rows.push({ id: o.id, k: p.k, n: p.n, hold: p.hold, ...d });
    }
  }
  return rows;
}

export function pinAtScreen(vp, x, y) {
  let best = null, bd = 1e9;
  for (const r of vp.pinRows || []) {
    const d = Math.hypot(x - r.head[0], y - r.head[1]);
    if (d <= r.head[2] + 2 && d < bd) { bd = d; best = { id: r.id, k: r.k }; }
  }
  return best;
}

export function removePin(o, k) {
  const at = [...(o.soft.pinAt || [])];
  at.splice(k, 1);
  o.soft.pinAt = at.length ? at : null;
}

export function setHold(o, k, on) {
  const at = [...(o.soft.pinAt || [])];
  if (!at[k]) return;
  at[k] = on ? at[k].slice(0, 3) : [...at[k].slice(0, 3), 0];
  o.soft.pinAt = at;
}

export function whereWords(q, o) {
  const flat = o.shape === 'plane' || Math.min(...o.size) < 0.02;
  const w = [];
  if (!flat && q[1] > 0.5) w.push('top'); else if (!flat && q[1] < -0.5) w.push('bottom');
  if (q[2] < -0.5) w.push(flat ? 'far edge' : 'back'); else if (q[2] > 0.5) w.push(flat ? 'near edge' : 'front');
  if (q[0] < -0.5) w.push('left'); else if (q[0] > 0.5) w.push('right');
  return w.length ? w.join(', ') : 'middle';
}
