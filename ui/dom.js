import { icon } from './icons.js';

export const MIXED = Symbol('mixed');

function resetArrow(row, o, paint) {
  if (o.reset === undefined && !o.toDefault) return () => {};
  const isDefault = () => o.isDefault ? o.isDefault() : (() => { const v = o.get(); return v !== MIXED && Math.abs(+v - +o.reset) < 1e-9; })();
  const b = el('button', { type: 'button', class: 'rs', title: 'Put it back to its default', 'aria-label': `Put ${o.label} back to its default` }, icon('undo', 14));
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (o.toDefault) o.toDefault(); else o.set(o.reset); paint(); o.commit && o.commit(); });
  row.append(b);
  return () => { b.classList.toggle('show', !isDefault()); };
}

export function el(tag, attrs = {}, ...kids) {
  if (attrs instanceof Node || typeof attrs === 'string' || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

const fmt = (v, step) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return (Math.abs(+v) < 0.5 / 10 ** d ? 0 : +v).toFixed(d);
};

const fmtLog = x => { const v = +x; return v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3); };
const unitBesideName = o => !!o.unit && o.unitAt !== 'value' && !/^\s*(°|×)\s*$/.test(o.unit);
export function slider(o) {
  const out = el('output', { title: 'Click to type a value' });
  const log = !!o.log, side = unitBesideName(o);
  const toPos = v => (log ? Math.log(Math.max(v, o.min) / o.min) / Math.log(o.max / o.min) * 1000 : v);
  const fromPos = p => (log ? +(o.min * Math.pow(o.max / o.min, p / 1000)).toPrecision(3) : p);
  const words = v => (log ? fmtLog(v) : fmt(v, o.step)) + (side ? '' : o.unit || '');
  const input = el('input', { type: 'range', min: log ? 0 : o.min, max: log ? 1000 : o.max, step: log ? 1 : o.step, 'aria-label': o.label });
  let arrow = () => {};
  const fill = () => { const lo = +input.min, hi = +input.max; input.style.setProperty('--p', `${(+input.value - lo) / Math.max(hi - lo, 1e-9) * 100}%`); };
  const paint = () => {
    const v = o.get(), mixed = v === MIXED;
    input.value = toPos(mixed ? (o.first ? o.first() : o.min) : v);
    fill();
    out.textContent = mixed ? 'Mixed' : words(v);
    row.classList.toggle('mixed', mixed);
    arrow();
  };
  input.addEventListener('input', () => { const v = fromPos(+input.value); o.set(v); out.textContent = words(v); fill(); row.classList.remove('mixed'); arrow(); });
  input.addEventListener('change', () => o.commit && o.commit());
  if (o.reset !== undefined) input.addEventListener('dblclick', () => { o.set(o.reset); paint(); o.commit && o.commit(); });
  out.addEventListener('click', () => {
    if (row.querySelector('.typing')) return;
    const v = o.get();
    const box = el('input', { class: 'typing', type: 'text', inputmode: 'decimal', value: v === MIXED ? '' : log ? fmtLog(v) : fmt(v, o.step), 'aria-label': o.label });
    const end = keep => {
      if (!box.isConnected) return;
      const n = parseFloat(box.value);
      box.remove();
      if (keep && Number.isFinite(n)) { o.set(n); paint(); o.commit && o.commit(); }
    };
    box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
    box.addEventListener('blur', () => end(true));
    out.after(box);
    box.focus();
    box.select();
  });
  const row = el('div', { class: 'row slider' + (o.slot ? ' has-slot' : ''), title: o.help || undefined },
    el('label', side ? { 'data-unit': o.unit.trim() } : {}, o.label), input, out, o.slot || null);
  arrow = resetArrow(row, o, paint);
  row.paint = paint;
  paint();
  return row;
}

export function numbers(o) {
  const shown = i => { const v = o.get(i); return v === MIXED ? '' : fmt(v, o.step || 0.05); };
  const inputs = o.keys.map((k, i) => {
    const input = el('input', { type: 'number', step: o.step || 0.05, 'aria-label': `${o.label} ${k}`, title: k });
    input.addEventListener('input', () => { if (input.value !== '' && Number.isFinite(+input.value)) o.set(i, +input.value); });
    input.addEventListener('change', () => { if (o.commit) o.commit(); input.value = shown(i); });
    const tag = el('span', { class: 'tag' }, k);
    tag.addEventListener('pointerdown', e => {
      e.preventDefault();
      const v0 = o.get(i);
      let start = e.clientX, last = 0;
      const move = ev => {
        const d = (ev.clientX - start) * (o.step || 0.05) * 0.5;
        if (o.add) { o.add(i, d - last); last = d; }
        else o.set(i, +(v0 + d).toFixed(3));
        input.value = shown(i);
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); o.commit && o.commit(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return el('span', { class: 'num' }, tag, input);
  });
  const row = el('div', { class: 'row nums', title: o.help || undefined }, el('label', {}, o.label), el('div', { class: 'numset' }, inputs));
  let arrow = () => {};
  row.paint = () => {
    inputs.forEach((w, i) => {
      const input = w.querySelector('input');
      if (document.activeElement !== input) {
        input.value = shown(i);
        input.placeholder = o.get(i) === MIXED ? '—' : '';
        input.title = o.get(i) === MIXED ? 'Multiple values: typing sets them all' : o.keys[i];
      }
    });
    arrow();
  };
  arrow = resetArrow(row, { ...o, isDefault: o.isDefault || (() => o.keys.every((k, i) => { const v = o.get(i); return v !== MIXED && Math.abs(v - o.reset) < 1e-6; })) }, row.paint);
  row.paint();
  return row;
}

export function color(o) {
  const input = el('input', { type: 'color', 'aria-label': o.label }), tag = el('span', { class: 'mix' });
  input.addEventListener('input', () => { o.set(input.value); tag.textContent = ''; });
  input.addEventListener('change', () => o.commit && o.commit());
  const row = el('div', { class: 'row' + (o.slot ? ' has-slot' : ''), title: o.help || undefined }, el('label', {}, o.label), input, tag, o.slot || null);
  row.paint = () => { const v = o.get(), mixed = v === MIXED; input.value = mixed ? (o.first ? o.first() : '#808080') : v; tag.textContent = mixed ? 'Mixed' : ''; };
  row.paint();
  return row;
}

export function choice(o) {
  const seg = el('div', { class: 'seg' + (o.wrap ? ' wrap' : '') + (o.fit ? ' fit' : '') });
  const buttons = o.options.map(([value, text]) => {
    const b = el('button', { type: 'button', title: o.titles ? o.titles[value] : undefined }, text);
    b.addEventListener('click', () => { o.set(value); paint(); o.commit && o.commit(); });
    b.dataset.value = value;
    seg.append(b);
    return b;
  });
  let arrow = () => {};
  const paint = () => {
    const v = o.get();
    for (const b of buttons) b.classList.toggle('on', v !== MIXED && String(b.dataset.value) === String(v));
    row.classList.toggle('mixed', v === MIXED);
    arrow();
  };
  const row = o.label ? el('div', { class: 'row stack', title: o.help || undefined }, el('label', {}, o.label), seg) : seg;
  if (o.label) arrow = resetArrow(row, { ...o, reset: undefined, toDefault: o.toDefault, isDefault: o.isDefault }, paint);
  row.paint = paint;
  paint();
  return row;
}

export function toggle(o) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': o.label });
  input.addEventListener('change', () => { o.set(input.checked); input.indeterminate = false; row.classList.remove('mixed'); o.commit && o.commit(); });
  const row = el('label', { class: 'row toggle', title: o.help }, el('span', { class: 'lab' }, o.label), input, el('span', { class: 'knob' }));
  row.paint = () => { const v = o.get(), mixed = v === MIXED; input.indeterminate = mixed; input.checked = mixed ? false : !!v; row.classList.toggle('mixed', mixed); };
  row.paint();
  return row;
}

export function dial(o) {
  const size = 64;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-32 -32 64 64');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('class', 'dial');
  svg.innerHTML = `<circle r="27" class="dial-ring"/>
    <text y="-17" class="dial-n">N</text>
    <line x1="0" y1="0" x2="0" y2="-24" class="dial-hand"/><circle r="3" class="dial-hub"/>`;
  const hand = svg.querySelector('.dial-hand');
  const input = el('input', { type: 'number', min: 0, max: 359, step: 1, 'aria-label': o.label });
  const paint = () => {
    const got = o.get(), mixed = got === MIXED, v = mixed ? 0 : ((got % 360) + 360) % 360;
    hand.setAttribute('transform', `rotate(${v})`);
    hand.style.visibility = mixed ? 'hidden' : '';
    if (document.activeElement !== input) { input.value = mixed ? '' : Math.round(v); input.placeholder = mixed ? '—' : ''; }
  };
  const fromPointer = e => {
    const r = svg.getBoundingClientRect();
    const a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
    o.set(Math.round((a + 360) % 360));
    paint();
  };
  svg.addEventListener('pointerdown', e => {
    e.preventDefault();
    fromPointer(e);
    const move = ev => fromPointer(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); o.commit && o.commit(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  input.addEventListener('input', () => { if (input.value !== '') { o.set(+input.value); paint(); } });
  input.addEventListener('change', () => o.commit && o.commit());
  const row = el('div', { class: 'row dialrow', title: o.help }, el('label', {}, o.label), svg, el('span', { class: 'deg' }, input, '°'));
  row.paint = paint;
  paint();
  return row;
}

export function text(o) {
  const input = o.lines > 1 ? el('textarea', { rows: o.lines, 'aria-label': o.label, placeholder: o.placeholder, spellcheck: 'false' })
    : el('input', { type: 'text', 'aria-label': o.label, placeholder: o.placeholder, spellcheck: 'false' });
  input.classList.add('text-in');
  input.addEventListener('input', () => o.set(input.value));
  input.addEventListener('change', () => o.commit && o.commit());
  const row = el('div', { class: 'row stack', title: o.help }, el('label', {}, o.label), input);
  row.paint = () => { if (document.activeElement !== input) input.value = o.get() ?? ''; };
  row.paint();
  return row;
}

export function pick(o) {
  const sel = el('select', { 'aria-label': o.label });
  sel.addEventListener('change', () => { if (sel.value === '\u0000') return; o.set(sel.value === '' ? null : sel.value); o.commit && o.commit(); row.paint(); });
  const row = el('div', { class: o.inline ? 'row pickrow' : 'row stack', title: o.help }, el('label', {}, o.label), sel);
  let arrow = () => {};
  const optionOf = ([x, t]) => el('option', { value: x ?? '', title: o.titles ? o.titles[x] : undefined }, t);
  row.paint = () => {
    const opts = typeof o.options === 'function' ? o.options() : o.options, v = o.get(), mixed = v === MIXED;
    sel.replaceChildren(...(mixed ? [el('option', { value: '\u0000' }, 'Mixed')] : []), ...opts.map(it => (Array.isArray(it[1]) ? el('optgroup', { label: it[0] }, it[1].map(optionOf)) : optionOf(it))));
    sel.title = (o.titles && o.titles[v]) || '';
    sel.value = mixed ? '\u0000' : v == null ? '' : String(v);
    arrow();
  };
  arrow = resetArrow(row, { ...o, reset: undefined }, row.paint);
  row.paint();
  return row;
}

export function swatches(o) {
  return el('div', { class: 'swatches' }, ...o.items.map(s => el('button', { type: 'button', class: 'chip', title: s.label, 'aria-label': s.label,
    onclick: () => { s.apply(); o.commit && o.commit(); } }, el('i', { style: `background:${s.color}` + (s.clear ? ';opacity:.45' : '') }), el('span', {}, s.label))));
}

export function section(title, ...kids) {
  return el('section', { class: 'sec' }, title ? el('h3', {}, title) : null, ...kids);
}

export function button(text, onclick, attrs = {}) {
  return el('button', { type: 'button', class: 'btn', ...attrs, onclick }, text);
}

export function mapSlot(o) {
  const pic = el('img', { alt: '' });
  const b = el('button', { type: 'button', class: 'slot', title: `${o.label}: click for a picture, or drop one here`, 'aria-label': `${o.label} picture` }, icon('plus', 14), pic);
  let shown = null;
  b.paint = () => {
    const id = o.get();
    b.classList.toggle('full', !!id);
    if (id && id !== shown) { shown = id; o.thumb(id).then(u => { if (shown === id) pic.src = u; }); }
    if (!id) { shown = null; pic.removeAttribute('src'); }
  };
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (o.get()) o.menu(e.clientX, e.clientY); else o.pick(); });
  b.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('over'); });
  b.addEventListener('dragleave', () => b.classList.remove('over'));
  b.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    b.classList.remove('over');
    window.dispatchEvent(new Event('dragend'));
    const f = [...e.dataTransfer.files][0];
    if (f) o.dropped(f);
  });
  b.paint();
  return b;
}

export function repaintAll(root) {
  for (const n of [...root.querySelectorAll('*')].reverse()) if (n.paint) n.paint();
}
