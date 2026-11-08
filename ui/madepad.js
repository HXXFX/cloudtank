import { el } from './dom.js';
import { madeShape, tidyStroke } from '../engine/made.js';

const css = n => getComputedStyle(document.body).getPropertyValue(n).trim();

function fitView(r) {
  let x0, x1, y1;
  if (r.kind === 'spin') {
    const R = Math.max(...r.outline.map(p => Math.abs(p[0]))) + r.wall;
    x1 = R * 1.3; x0 = -x1; y1 = Math.max(...r.outline.map(p => p[1])) + r.wall;
  } else {
    const o = r.radius + r.wall, xs = r.path.map(p => p[0]);
    x0 = Math.min(...xs) - o; x1 = Math.max(...xs) + o; y1 = Math.max(...r.path.map(p => p[1])) + o;
    const m = (x1 - x0) * 0.12; x0 -= m; x1 += m;
  }
  let h = Math.max(y1 * 1.25, 0.4), w = x1 - x0;
  if (w / h < 1.5) { const c = (x0 + x1) / 2; w = h * 1.5; x0 = c - w / 2; x1 = c + w / 2; } else h = w / 1.5;
  const y0 = -h * 0.06;
  return { x0, x1, y0, y1: y0 + h };
}

export function madePad(t, ctx) {
  const r0 = t.made, spin = r0.kind === 'spin';
  const canvas = el('canvas', { class: 'madepad', 'aria-label': spin ? 'Drawing pad: half the outline, seen from the side' : 'Drawing pad: the path, seen from the side' });
  const hint = el('p', { class: 'note' }, spin
    ? 'Draw half the outline, from the dashed line out: it spins round the line. Start on the line to give it a floor. The wheel zooms the pad.'
    : 'Draw the path from the side: the channel runs along it, closed at its high end and open at its low end. The wheel zooms the pad.');
  const box = el('div', { class: 'stackrow madepadrow' }, canvas, hint);
  const g = canvas.getContext('2d');
  let V = fitView(r0), stroke = null, W = 0, H = 0, k = 1, slice = null, sliceKey = '';

  const px = x => (x - V.x0) * k, py = y => H - (y - V.y0) * k;
  const at = e => { const b = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; return [V.x0 + (e.clientX - b.left) * d / k, V.y0 + (H - (e.clientY - b.top) * d) / k]; };

  function paintSlice() {
    const key = JSON.stringify([t.made, V]);
    if (key === sliceKey && slice) return;
    sliceKey = key;
    const sw = Math.max(40, Math.round(W / 3)), sh = Math.max(30, Math.round(H / 3));
    slice = document.createElement('canvas'); slice.width = sw; slice.height = sh;
    const c = slice.getContext('2d'), img = c.createImageData(sw, sh), f = madeShape(t.made).f;
    const dx = (V.x1 - V.x0) / sw, dy = (V.y1 - V.y0) / sh;
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      const d = f(V.x0 + (i + 0.5) * dx, V.y1 - (j + 0.5) * dy, 0), a = Math.max(0, Math.min(1, 0.5 - d / dx));
      const o = (j * sw + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 200; img.data[o + 3] = a * 150;
    }
    c.putImageData(img, 0, 0);
  }

  function line(pts, colour, w) {
    if (pts.length < 2) return;
    g.strokeStyle = colour; g.lineWidth = w * (devicePixelRatio || 1);
    g.beginPath(); g.moveTo(px(pts[0][0]), py(pts[0][1]));
    for (const [x, y] of pts.slice(1)) g.lineTo(px(x), py(y));
    g.stroke();
  }

  function paint() {
    const d = devicePixelRatio || 1, b = canvas.getBoundingClientRect();
    if (!b.width) return;
    if (canvas.width !== Math.round(b.width * d)) { canvas.width = Math.round(b.width * d); canvas.height = Math.round(b.width / 1.5 * d); }
    W = canvas.width; H = canvas.height; k = W / (V.x1 - V.x0);
    g.clearRect(0, 0, W, H);
    const step = (V.x1 - V.x0) > 3 ? 0.5 : 0.1;
    g.lineWidth = d; g.strokeStyle = css('--line');
    g.beginPath();
    for (let x = Math.ceil(V.x0 / step) * step; x <= V.x1; x += step) { g.moveTo(px(x), 0); g.lineTo(px(x), py(0)); }
    for (let y = step; y <= V.y1; y += step) { g.moveTo(0, py(y)); g.lineTo(W, py(y)); }
    g.stroke();
    g.fillStyle = css('--field'); g.fillRect(0, py(0), W, H - py(0));
    g.fillStyle = css('--ink3'); g.font = `${11 * d}px Inter, system-ui, sans-serif`;
    g.fillText(`Squares: ${Math.round(step * 100)} cm`, 6 * d, 14 * d);
    paintSlice();
    g.imageSmoothingEnabled = true;
    g.drawImage(slice, 0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const r = t.made, accent = css('--accent');
    if (r.kind === 'spin') {
      g.setLineDash([5 * d, 5 * d]); g.strokeStyle = css('--ink3'); g.lineWidth = 1.5 * d;
      g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), py(0)); g.stroke(); g.setLineDash([]);
      line(r.outline.map(([x, y]) => [Math.abs(x), y]), accent, 2.5);
    } else line(r.path, accent, 2.5);
    if (stroke) line(stroke, css('--ink'), 2);
    const top = r.kind === 'spin' ? Math.max(...r.outline.map(p => p[1])) + r.wall / 2 : Math.max(...r.path.map(p => p[1]));
    g.fillStyle = css('--ink3'); g.textAlign = 'right';
    g.fillText(`${Math.round(top * 100)} cm tall`, W - 6 * d, 14 * d);
    g.textAlign = 'left';
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {   }
    const [x, y] = at(e);
    stroke = [[x, Math.max(y, 0)]];
    paint();
  });
  canvas.addEventListener('pointermove', e => {
    if (!stroke) return;
    const [x, y] = at(e);
    stroke.push([x, Math.max(y, 0)]);
    paint();
  });
  const finish = () => {
    if (!stroke) return;
    const pts = stroke; stroke = null;
    const r = t.made;
    const span = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
    if (pts.length < 3 || span < 0.05) { paint(); return; }
    let next;
    if (r.kind === 'spin') {
      const half = pts.map(([x, y]) => [Math.abs(x), y]);
      for (const i of [0, half.length - 1]) if (half[i][0] < 0.03) half[i] = [0, half[i][1]];
      next = { ...r, outline: tidyStroke(half, r.wall / 2) };
    } else next = { ...r, path: tidyStroke(pts, 0) };
    if (ctx.remakeMade(t, next)) { ctx.commit(); V = fitView(t.made); ctx.rebuild(); }
    else paint();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { stroke = null; paint(); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const m = e.deltaY > 0 ? 1.15 : 1 / 1.15, c = (V.x0 + V.x1) / 2, w = (V.x1 - V.x0) * m, h = (V.y1 - V.y0) * m;
    V = { x0: c - w / 2, x1: c + w / 2, y0: -h * 0.06, y1: h * 0.94 };
    paint();
  }, { passive: false });

  box.paint = paint;
  requestAnimationFrame(paint);
  new ResizeObserver(() => paint()).observe(canvas);
  return box;
}
