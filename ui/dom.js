
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

export function slider(o) {
  const out = el('output');
  const input = el('input', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': o.label });
  const paint = () => { const v = o.get(); input.value = v; out.textContent = fmt(v, o.step) + (o.unit || ''); };
  input.addEventListener('input', () => { o.set(+input.value); out.textContent = fmt(input.value, o.step) + (o.unit || ''); });
  input.addEventListener('change', () => o.commit && o.commit());
  if (o.reset !== undefined) input.addEventListener('dblclick', () => { o.set(o.reset); paint(); o.commit && o.commit(); });
  const row = el('div', { class: 'row slider', title: [o.help, o.reset !== undefined ? 'Double-click to put it back.' : ''].filter(Boolean).join('\n') || undefined },
    el('label', {}, o.label), input, out);
  row.paint = paint;
  paint();
  return row;
}

export function numbers(o) {
  const inputs = o.keys.map((k, i) => {
    const input = el('input', { type: 'number', step: o.step || 0.05, 'aria-label': `${o.label} ${k}`, title: k });
    input.addEventListener('input', () => { if (input.value !== '' && Number.isFinite(+input.value)) o.set(i, +input.value); });
    input.addEventListener('change', () => { if (o.commit) o.commit(); input.value = fmt(o.get(i), o.step || 0.05); });
    const tag = el('span', { class: 'tag' }, k);
    tag.addEventListener('pointerdown', e => {
      e.preventDefault();
      const start = e.clientX, v0 = o.get(i);
      const move = ev => { const v = v0 + (ev.clientX - start) * (o.step || 0.05) * 0.5; o.set(i, +v.toFixed(3)); input.value = fmt(o.get(i), o.step || 0.05); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); o.commit && o.commit(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return el('span', { class: 'num' }, tag, input);
  });
  const row = el('div', { class: 'row nums' }, el('label', {}, o.label), el('div', { class: 'numset' }, inputs));
  row.paint = () => inputs.forEach((w, i) => {
    const input = w.querySelector('input');
    if (document.activeElement !== input) input.value = fmt(o.get(i), o.step || 0.05);
  });
  row.paint();
  return row;
}

export function color(o) {
  const input = el('input', { type: 'color', 'aria-label': o.label });
  input.addEventListener('input', () => o.set(input.value));
  input.addEventListener('change', () => o.commit && o.commit());
  const row = el('div', { class: 'row' }, el('label', {}, o.label), input, el('span'));
  row.paint = () => { input.value = o.get(); };
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
  const paint = () => { const v = o.get(); for (const b of buttons) b.classList.toggle('on', String(b.dataset.value) === String(v)); };
  const row = o.label ? el('div', { class: 'row stack' }, el('label', {}, o.label), seg) : seg;
  row.paint = paint;
  paint();
  return row;
}

export function toggle(o) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': o.label });
  input.addEventListener('change', () => { o.set(input.checked); o.commit && o.commit(); });
  const row = el('label', { class: 'row toggle', title: o.help }, el('span', { class: 'lab' }, o.label), input, el('span', { class: 'knob' }));
  row.paint = () => { input.checked = !!o.get(); };
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
    const v = ((o.get() % 360) + 360) % 360;
    hand.setAttribute('transform', `rotate(${v})`);
    if (document.activeElement !== input) input.value = Math.round(v);
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
  sel.addEventListener('change', () => { o.set(sel.value === '' ? null : sel.value); o.commit && o.commit(); });
  const row = el('div', { class: 'row stack', title: o.help }, el('label', {}, o.label), sel);
  row.paint = () => {
    const opts = typeof o.options === 'function' ? o.options() : o.options;
    sel.replaceChildren(...opts.map(([v, t]) => el('option', { value: v ?? '' }, t)));
    const v = o.get();
    sel.value = v == null ? '' : String(v);
  };
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

export function repaintAll(root) {
  for (const n of root.querySelectorAll('*')) if (n.paint) n.paint();
}
