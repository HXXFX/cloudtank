import { project } from './gizmo.js';
import { eulerAxes } from './math.js';

export const MARK_FONTS = {
  sans: 'Inter, system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};

const pad2 = n => String(Math.floor(n)).padStart(2, '0');
export function timecode(t, fps = 24) { return `${pad2(t / 3600)}:${pad2(t / 60 % 60)}:${pad2(t % 60)}:${pad2((t % 1) * fps)}`; }
const fmtN = n => Math.round(n).toLocaleString('en-US');

export const LIVE = {
  timecode:  { label: 'Time code', short: 'TC', get: vp => timecode(vp.simTime) },
  time:      { label: 'Time', short: 'TIME', get: vp => `${vp.simTime.toFixed(1)} s` },
  frame:     { label: 'Frame', short: 'FRM', get: vp => String(vp.simFrames || 0).padStart(6, '0') },
  fps:       { label: 'Frames a second', short: 'FPS', get: vp => vp.stats.fps.toFixed(1) },
  card:      { label: 'Card time', short: 'CARD', get: vp => `${(vp.stats.simMs + vp.stats.drawMs).toFixed(1)} ms` },
  particles: { label: 'Liquid particles', short: 'PART', get: vp => fmtN(vp.flip ? vp.flip.remaining : 0) },
  wind:      { label: 'Wind', short: 'WND', get: vp => `${Math.hypot(...vp.windNow).toFixed(1)} m/s` },
  objects:   { label: 'Objects', short: 'OBJ', get: vp => String(vp.scene.objects.length).padStart(3, '0') },
  moving:    { label: 'Objects moving', short: 'MOV', get: vp => String(vp.scene.objects.filter(o => isMoving(vp, o)).length).padStart(3, '0') },
  sources:   { label: 'Sources on', short: 'SRC', get: vp => `${vp.scene.emitters.filter(e => vp.isOn(e)).length}/${vp.scene.emitters.length}` },
  selected:  { label: 'Selected', short: 'SEL', get: vp => vp.scene.selected ? vp.scene.selected.name : '-' },
};
const isMoving = (vp, o) => (o.moves && Math.hypot(...(o.vel || [0, 0, 0])) > 0.02) || !!(o.motion && motionOn(o.motion));
export const motionOn = m => !!m && ((m.travel && m.travel !== 'none') || !!m.spin || !!m.bob);

function itemField(vp, it, key) {
  if (!it) return null;
  if (key === 'name') return it.name;
  if (key === 'x') return it.pos[0].toFixed(2);
  if (key === 'y') return it.pos[1].toFixed(2);
  if (key === 'z') return it.pos[2].toFixed(2);
  if (key === 'height') return `${(it.kind === 'object' ? it.pos[1] - (it.size ? it.size[1] : 0) : it.pos[1]).toFixed(2)} m`;
  if (key === 'speed') return `${Math.hypot(...(it.vel || [0, 0, 0])).toFixed(2)} m/s`;
  if (key === 'on') return it.kind === 'emitter' ? (vp.isOn(it) ? 'on' : 'off') : '';
  return null;
}

export function fillText(vp, text, it = null) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => {
    const v = itemField(vp, it, k);
    if (v !== null) return v;
    return LIVE[k] ? LIVE[k].get(vp) : m;
  });
}

export const MARK_TYPES = {
  text:    { label: 'Text', icon: 'markText', screen: true,
    defaults: { text: 'Fluid experiment 01', x: 0.1, y: 0.86, size: 17, color: '#1b1d20', font: 'serif', italic: true, bg: '' } },
  timer:   { label: 'Timer', icon: 'markTimer', screen: true,
    defaults: { format: 'timecode', label: '', x: 0.1, y: 0.12, size: 13, color: '#ffffff', font: 'mono', bg: '#000000' } },
  counter: { label: 'Counter', icon: 'markCounter', screen: true,
    defaults: { counts: 'frame', start: 0, perSecond: 1, digits: 6, label: 'Count', x: 0.1, y: 0.18, size: 13, color: '#1b1d20', font: 'mono', bg: '' } },
  readout: { label: 'Data panel', icon: 'markPanel', screen: true,
    defaults: { title: 'FLUID WATCH_', rows: ['timecode', 'frame', 'fps', 'objects', 'sources', 'wind'], x: 0.1, y: 0.2, size: 11,
      color: '#6e6e6e', accent: '#e8902e', font: 'mono', bg: '' } },
  legend:  { label: 'Legend', icon: 'markLegend', screen: true,
    defaults: { title: '', x: 0.1, y: 0.74, size: 12, color: '#222222', font: 'mono', bg: '' } },
  label:   { label: 'Label', icon: 'markLabel', screen: false,
    defaults: { target: null, pos: [0, 1, 0], text: '{name}', dx: 10, dy: -26, style: 'leader', size: 12, color: '#c0392b', font: 'mono', bg: '#ffffff' } },
  tracker: { label: 'Tracking boxes', icon: 'markTrack', screen: false,
    defaults: { which: 'models', name: '', numbers: true, coords: false, size: 11, color: '#3c3c3c', font: 'mono' } },
  link:    { label: 'Link line', icon: 'markLink', screen: false,
    defaults: { from: null, to: null, color: '#ff9a1f', color2: '#ff3fa0', width: 2.5, dash: false } },
  grid:    { label: 'Wire grid', icon: 'markGrid', screen: false,
    defaults: { pos: [0, 1, -1], rot: [0, 0, 0], size: [1, 1, 0.02], spacing: 0.25, color: '#7ade42', width: 1 } },
  outline: { label: 'Outline', icon: 'markOutline', screen: false,
    defaults: { pos: [0, 0.5, 0], rot: [0, 0, 0], size: [0.5, 0.5, 0.5], color: '#1fb83a', width: 1.6, dash: true } },
};

export const MARK_ORDER = ['text', 'timer', 'counter', 'readout', 'legend', 'label', 'tracker', 'link', 'grid', 'outline'];

export const COUNTS = [['frame', 'Frames'], ['seconds', 'Seconds'], ['particles', 'Particles'], ['objects', 'Objects'],
  ['moving', 'Moving'], ['sourcesOn', 'Sources on'], ['custom', 'Its own']];

function counterValue(vp, m) {
  switch (m.counts) {
    case 'seconds': return Math.floor(vp.simTime);
    case 'particles': return vp.flip ? vp.flip.remaining : 0;
    case 'objects': return vp.scene.objects.length;
    case 'moving': return vp.scene.objects.filter(o => isMoving(vp, o)).length;
    case 'sourcesOn': return vp.scene.emitters.filter(e => vp.isOn(e)).length;
    case 'custom': return Math.floor((m.start || 0) + (m.perSecond || 0) * vp.simTime);
    default: return vp.simFrames || 0;
  }
}

function timerText(vp, m) {
  const t = vp.simTime;
  if (m.format === 'seconds') return `${t.toFixed(1)} s`;
  if (m.format === 'clock') return `${pad2(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  return timecode(t);
}

export function trackedBy(vp, m) {
  const objs = vp.scene.objects;
  if (m.which === 'all') return objs;
  if (m.which === 'moving') return objs.filter(o => o.moves || motionOn(o.motion));
  if (m.which === 'named') { const s = (m.name || '').toLowerCase(); return s ? objs.filter(o => o.name.toLowerCase().includes(s)) : []; }
  return objs.filter(o => o.model);
}


const font = (m, k = 1) => `${m.italic ? 'italic ' : ''}${m.weight || 400} ${Math.round((m.size || 12) * k)}px ${MARK_FONTS[m.font] || MARK_FONTS.sans}`;

export function seg3(cam, a, b, W, H) {
  let p = project(cam, a, W, H), q = project(cam, b, W, H);
  const near = 0.05;
  if (p[2] <= near && q[2] <= near) return null;
  const cut = (u, v, pu, pv) => { const t = (pu[2] - near) / (pu[2] - pv[2]); return project(cam, u.map((x, k) => x + (v[k] - x) * t), W, H); };
  if (p[2] <= near) p = cut(a, b, p, q);
  else if (q[2] <= near) q = cut(b, a, q, p);
  return [p, q];
}

function stroke(ctx, pts, color, width = 1, dash = null) {
  ctx.beginPath();
  pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
}

export function screenBox(cam, o, W, H) {
  const ax = eulerAxes(o.rot);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const s = [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
    const p = [0, 1, 2].map(k => o.pos[k] + ax[0][k] * s[0] * o.size[0] + ax[1][k] * s[1] * o.size[1] + ax[2][k] * s[2] * o.size[2]);
    const q = project(cam, p, W, H);
    if (q[2] <= 0) return null;
    x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]);
  }
  return { x0, y0, x1, y1 };
}

function textBox(ctx, m, lines, x, y, { color = m.color, bg = m.bg, padX = 6, padY = 4 } = {}) {
  ctx.font = font(m);
  const lh = Math.round((m.size || 12) * 1.3);
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + (bg ? padX * 2 : 0);
  const h = lines.length * lh + (bg ? padY * 2 : 0);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); }
  ctx.fillStyle = color; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + (bg ? padX : 0), y + (bg ? padY : 0) + lh * (i + 0.5)));
  return [x, y, x + w, y + h];
}

function anchorOf(vp, m) {
  if (m.target != null) {
    const it = vp.scene.objects.find(o => o.id === m.target) || vp.scene.emitters.find(e => e.id === m.target);
    if (it) return { it, p: it.kind === 'object' ? [it.pos[0], it.pos[1] + it.size[1], it.pos[2]] : it.pos };
  }
  return { it: null, p: m.pos };
}

function centreOf(vp, id, W, H) {
  const it = vp.scene.objects.find(o => o.id === id) || vp.scene.emitters.find(e => e.id === id);
  if (!it) return null;
  if (it.kind === 'object') {
    const b = screenBox(vp.camera, it, W, H);
    return b ? [(b.x0 + b.x1) / 2, b.y0 + (b.y1 - b.y0) * 0.3] : null;
  }
  const q = project(vp.camera, it.pos, W, H);
  return q[2] > 0 ? [q[0], q[1]] : null;
}

export function drawMarks(ctx, vp, W, H, hits) {
  hits.clear();
  const cam = vp.camera, sel = vp.scene.selected;
  for (const m of vp.scene.marks) {
    const hit = { rect: null, segs: [], anchor: null };
    hits.set(m.id, hit);
    ctx.save();
    if (MARK_TYPES[m.type].screen) {
      const x = m.x * W, y = m.y * H;
      let lines;
      if (m.type === 'text') lines = fillText(vp, m.text).split('\n');
      else if (m.type === 'timer') lines = [(m.label ? m.label + ' ' : '') + timerText(vp, m)];
      else if (m.type === 'counter') lines = [(m.label ? m.label + ' ' : '') + String(counterValue(vp, m)).padStart(m.digits || 1, '0')];
      if (lines) hit.rect = textBox(ctx, m, lines, x, y);
      else if (m.type === 'readout') hit.rect = drawReadout(ctx, vp, m, x, y);
      else if (m.type === 'legend') hit.rect = drawLegend(ctx, vp, m, x, y);
    } else if (m.type === 'label') {
      const { it, p } = anchorOf(vp, m);
      const a = project(cam, p, W, H);
      if (a[2] > 0) {
        hit.anchor = [a[0], a[1]];
        const t = [a[0] + (m.dx || 0), a[1] + (m.dy || 0)];
        const lines = fillText(vp, m.text, it).split('\n');
        if (m.box && it && it.kind === 'object') {
          const b = screenBox(cam, it, W, H);
          if (b) { ctx.strokeStyle = m.color; ctx.lineWidth = 1; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
        }
        if (m.style !== 'plain' && (m.dx || m.dy)) stroke(ctx, [[a[0], a[1]], t], m.color, 1);
        ctx.font = font(m);
        const lh = Math.round(m.size * 1.3);
        const ty = t[1] - (m.style === 'tag' ? lh * lines.length / 2 + 4 : lh * lines.length / 2);
        hit.rect = m.style === 'tag' ? textBox(ctx, m, lines, t[0], ty, { color: m.color, bg: m.bg || '#ffffff' })
          : textBox(ctx, m, lines, t[0] + 2, ty, { bg: '' });
      }
    } else if (m.type === 'tracker') {
      drawTracker(ctx, vp, m, W, H, hit);
    } else if (m.type === 'link') {
      const a = m.from != null ? centreOf(vp, m.from, W, H) : null, b = m.to != null ? centreOf(vp, m.to, W, H) : null;
      if (a && b) {
        let col = m.color;
        if (m.color2 && m.color2 !== m.color) { col = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); col.addColorStop(0, m.color); col.addColorStop(1, m.color2); }
        ctx.lineCap = 'round';
        stroke(ctx, [a, b], col, m.width || 2, m.dash ? [8, 6] : null);
        hit.segs.push([a, b]);
        hit.anchor = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      }
    } else if (m.type === 'grid' || m.type === 'outline') {
      drawFrame3(ctx, vp, m, W, H, hit);
    }
    if (m === sel) highlight(ctx, hit);
    ctx.restore();
  }
}

function drawReadout(ctx, vp, m, x, y) {
  ctx.font = font(m);
  const lh = Math.round(m.size * 1.3), rows = (m.rows || []).filter(k => LIVE[k]);
  const keyW = Math.max(30, ...rows.map(k => ctx.measureText(LIVE[k].short).width)) + 10;
  const vals = rows.map(k => LIVE[k].get(vp));
  const w = Math.max(keyW + Math.max(40, ...vals.map(v => ctx.measureText(v).width)), m.title ? ctx.measureText(m.title).width + 12 : 0) + 8;
  let yy = y;
  ctx.textBaseline = 'middle';
  if (m.title) {
    ctx.fillStyle = m.accent; ctx.fillRect(x, yy, w, lh + 4);
    ctx.fillStyle = '#1b1208'; ctx.fillText(m.title, x + 5, yy + (lh + 4) / 2);
    yy += lh + 8;
  }
  if (m.bg) { ctx.fillStyle = m.bg; ctx.fillRect(x, yy - 2, w, rows.length * lh + 4); }
  ctx.fillStyle = m.color;
  rows.forEach((k, i) => { ctx.fillText(LIVE[k].short, x + 4, yy + lh * (i + 0.5)); ctx.fillText(vals[i], x + 4 + keyW, yy + lh * (i + 0.5)); });
  return [x, y, x + w, yy + rows.length * lh + 2];
}

function drawLegend(ctx, vp, m, x, y) {
  ctx.font = font(m);
  const lh = Math.round(m.size * 1.45), E = vp.scene.emitters.filter(e => !e.sink);
  const lines = E.map(e => `${e.name}:`);
  const nameW = Math.max(40, ...lines.map(l => ctx.measureText(l).width));
  const w = 14 + nameW + 10 + ctx.measureText('off').width + 8;
  let yy = y;
  if (m.bg) { ctx.fillStyle = m.bg; ctx.fillRect(x - 6, y - 4, w + 12, (E.length + (m.title ? 1 : 0)) * lh + 8); }
  ctx.textBaseline = 'middle';
  if (m.title) { ctx.fillStyle = m.color; ctx.fillText(m.title, x, yy + lh / 2); yy += lh; }
  E.forEach((e, i) => {
    const on = vp.isOn(e), cy = yy + lh * (i + 0.5);
    ctx.globalAlpha = on ? 1 : 0.45;
    ctx.fillStyle = `rgb(${e.color.map(c => Math.round(c * 255)).join(',')})`;
    ctx.fillRect(x, cy - 4, 8, 8);
    ctx.fillStyle = m.color;
    ctx.fillText(lines[i], x + 14, cy);
    ctx.fillText(on ? 'on' : 'off', x + 14 + nameW + 10, cy);
    ctx.globalAlpha = 1;
  });
  return [x, y, x + w, yy + E.length * lh];
}

function drawTracker(ctx, vp, m, W, H, hit) {
  ctx.font = font(m);
  ctx.textBaseline = 'top';
  const list = trackedBy(vp, m);
  list.forEach((o, i) => {
    const b = screenBox(vp.camera, o, W, H);
    if (!b) return;
    ctx.strokeStyle = m.color; ctx.lineWidth = 1;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    hit.segs.push([[b.x0, b.y0], [b.x1, b.y0]], [[b.x1, b.y0], [b.x1, b.y1]], [[b.x1, b.y1], [b.x0, b.y1]], [[b.x0, b.y1], [b.x0, b.y0]]);
    ctx.fillStyle = m.color;
    let ty = b.y0;
    if (m.numbers) { ctx.fillText(String(i + 1).padStart(2, '0'), b.x1 + 3, ty); ty += m.size * 1.25; }
    if (m.coords) {
      ctx.fillText(`X${Math.round((b.x0 + b.x1) / 2)}`, b.x1 + 3, ty);
      ctx.fillText(`Y${Math.round((b.y0 + b.y1) / 2)}`, b.x1 + 3, ty + m.size * 1.25);
    }
    if (!hit.anchor) hit.anchor = [b.x0, b.y0];
  });
}

function drawFrame3(ctx, vp, m, W, H, hit) {
  const cam = vp.camera, ax = eulerAxes(m.rot || [0, 0, 0]), s = m.size;
  const at = (u, v, w) => [0, 1, 2].map(k => m.pos[k] + ax[0][k] * u + ax[1][k] * v + ax[2][k] * w);
  const segs = [];
  if (m.type === 'grid') {
    const sp = Math.max(m.spacing || 0.25, 0.01);
    const nx = Math.min(200, Math.round(2 * s[0] / sp)), ny = Math.min(200, Math.round(2 * s[1] / sp));
    for (let i = 0; i <= nx; i++) { const u = -s[0] + (2 * s[0]) * i / nx; segs.push([at(u, -s[1], 0), at(u, s[1], 0)]); }
    for (let j = 0; j <= ny; j++) { const v = -s[1] + (2 * s[1]) * j / ny; segs.push([at(-s[0], v, 0), at(s[0], v, 0)]); }
  } else {
    const c = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([u, v, w]) => at(u * s[0], v * s[1], w * s[2]));
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) segs.push([c[i], c[j]]);
  }
  const dash = m.type === 'outline' && m.dash ? [7, 5] : null;
  ctx.beginPath();
  for (const [a, b] of segs) {
    const sgm = seg3(cam, a, b, W, H);
    if (!sgm) continue;
    ctx.moveTo(sgm[0][0], sgm[0][1]); ctx.lineTo(sgm[1][0], sgm[1][1]);
    hit.segs.push(sgm);
  }
  ctx.strokeStyle = m.color; ctx.lineWidth = m.width || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  const q = project(cam, m.pos, W, H);
  if (q[2] > 0) hit.anchor = [q[0], q[1]];
}

function highlight(ctx, hit) {
  ctx.strokeStyle = '#ffd447'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  if (hit.rect) { const [x0, y0, x1, y1] = hit.rect; ctx.strokeRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8); }
  else if (hit.anchor) { ctx.beginPath(); ctx.arc(hit.anchor[0], hit.anchor[1], 9, 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
}

export function pickMark(vp, hits, mx, my) {
  const marks = vp.scene.marks;
  for (let i = marks.length - 1; i >= 0; i--) {
    const h = hits.get(marks[i].id);
    if (!h) continue;
    if (h.rect && mx >= h.rect[0] - 3 && mx <= h.rect[2] + 3 && my >= h.rect[1] - 3 && my <= h.rect[3] + 3) return { mark: marks[i], part: 'text' };
    if (h.anchor && Math.hypot(mx - h.anchor[0], my - h.anchor[1]) < 10) return { mark: marks[i], part: 'anchor' };
    for (const [a, b] of h.segs) if (segDist(mx, my, a, b) < 4) return { mark: marks[i], part: 'edge' };
  }
  return null;
}

function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0;
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
}

export function makeMark(type, opts = {}) {
  const T = MARK_TYPES[type];
  return { kind: 'mark', type, ...JSON.parse(JSON.stringify(T.defaults)), ...opts };
}
