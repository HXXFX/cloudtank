import { el, slider, numbers, color, choice, toggle, dial, section, button, repaintAll, text, pick, swatches } from './dom.js';
import { icon } from './icons.js';
import { SHAPES } from '../engine/shapes.js';
import { LIGHT_PRESETS, BACKGROUNDS, FINISHES, GROUND_PATTERNS, patternOf, copy } from '../engine/environment.js';
import { DETAIL, gridFor, MAX_SMOKE_CELLS, MAX_LIQUID_CELLS, MAX_PARTICLES, REGION_LIMITS } from '../engine/viewport.js';
import { sourceLabel, LIGHT_KINDS, MAX_EMITTERS } from '../engine/scene.js';
import { hexToRgb, rgbToHex, SETTINGS as FLUID_SETTINGS } from '../engine/settings.js';
import { ASSET_BY_ID } from '../engine/assets.js';
import { categoriesFor, category, filterRows, groundCategories } from './details.js';
import { MARK_TYPES, LIVE, COUNTS, motionOn } from '../engine/marks.js';
import { FILTER_PRESETS, POST_DEFAULTS, FILM_LOOKS, DIFFUSIONS } from '../engine/post.wgsl.js';

const DEG = 180 / Math.PI;
const fmtN = n => Math.round(n).toLocaleString('en-US');

export const TABS = [
  ['scene', 'Scene'], ['fluids', 'Fluids'], ['wind', 'Wind'], ['light', 'Light'], ['world', 'World'], ['filters', 'Filters'],
];


export const assetOf = it => !it ? null : it.asset ? ASSET_BY_ID[it.asset] || null : it.model && it.model.startsWith('asset:') ? ASSET_BY_ID[it.model.slice(6)] || null : null;

export function itemIcon(it) {
  if (it.kind === 'emitter') return it.sink ? (it.type === 'smoke' ? 'extractor' : 'drain') : it.type === 'smoke' ? 'smoke' : 'liquid';
  if (it.kind === 'mark') return MARK_TYPES[it.type].icon;
  if (it.kind === 'light') return { area: 'lightArea', point: 'lightPoint', spot: 'lightSpot' }[it.type];
  const a = assetOf(it);
  if (a) return a.icon;
  return it.model ? 'model' : it.shape;
}

const swatchOf = it => it.kind === 'mark' ? (it.color || '#ffffff') : rgbToHex(it.color);

const isHiddenThing = it => it.kind === 'light' ? it.show === false : !!it.hidden;
const KIND_WORD = { object: 'object', emitter: 'source', light: 'light', mark: 'mark' };

export function scenePanel(app) {
  const vp = app.vp;
  const root = el('div');
  const find = el('input', { class: 'find', type: 'search', placeholder: 'Search the scene', 'aria-label': 'Search the scene', spellcheck: 'false' });
  const list = el('div', { class: 'list', role: 'listbox', 'aria-label': 'In the scene', 'aria-multiselectable': 'true' });
  const count = el('small');
  const props = el('div');
  const grip = el('div', { class: 'split', role: 'separator', 'aria-orientation': 'horizontal', title: 'Drag: more or less room for the list' }, el('i'));
  root.append(section(null, el('h3', {}, 'In the scene', count), find, list, grip), props);

  try { const h = +localStorage.getItem('cloudtank.listH'); if (h >= 90) list.style.maxHeight = `${h}px`; } catch {   }
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const y0 = e.clientY, h0 = list.getBoundingClientRect().height;
    const move = ev => { list.style.maxHeight = `${Math.max(90, Math.min(innerHeight * 0.7, h0 + ev.clientY - y0))}px`; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      try { localStorage.setItem('cloudtank.listH', parseFloat(list.style.maxHeight)); } catch {   } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  const tree = () => {
    const S = vp.scene, q = find.value.trim().toLowerCase();
    const hit = it => !q || `${it.name} ${KIND_WORD[it.kind]} ${it.kind === 'emitter' ? sourceLabel(it) : ''}`.toLowerCase().includes(q);
    const loose = S.emitters.filter(e => !e.attach || !S.objects.some(o => o.id === e.attach.to));
    const groups = [];
    for (const [title, things] of [['Objects', S.objects], ['Sources', loose], ['Lights', S.lights], ['Marks', S.marks]]) {
      const rows = [];
      for (const it of things) {
        const parts = it.kind === 'object' ? S.emitters.filter(e => e.attach && e.attach.to === it.id) : [];
        const own = hit(it), kept = own ? parts : parts.filter(hit);
        if (own || kept.length) { rows.push({ it, depth: 0 }); for (const e of kept) rows.push({ it: e, depth: 1 }); }
      }
      if (rows.length) groups.push({ title, rows });
    }
    return groups;
  };

  let anchor = null;
  const clickRow = (e, it) => {
    const S = vp.scene;
    if (e.shiftKey) {
      const rows = tree().flatMap(g => g.rows).map(r => r.it);
      const from = rows.find(i => i.id === anchor && S.isPicked(i)) || S.selected || it;
      const a = Math.max(rows.indexOf(from), 0), b = rows.indexOf(it);
      anchor = from.id;
      vp.selectAll([...rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter(i => i !== it), it]);
      return;
    }
    anchor = it.id;
    if (e.ctrlKey || e.metaKey) vp.togglePick(it); else vp.select(it);
  };

  let shown = null, drawnItems = null, drawnKey = null;
  const paintList = () => {
    const S = vp.scene, groups = tree(), rows = groups.flatMap(g => g.rows);
    const total = S.items.length;
    count.textContent = find.value.trim() ? `${rows.length} of ${total}` : `${S.objects.length} objects · ${S.emitters.length} of ${MAX_EMITTERS} sources` + (S.lights.length ? ` · ${S.lights.length} lights` : '') + (S.marks.length ? ` · ${S.marks.length} marks` : '');
    const isOff = it => (it.kind === 'emitter' || it.kind === 'light') && it.on === false;
    const key = rows.map(({ it, depth }) => [it.id, it.name, S.isPicked(it), isOff(it), isHiddenThing(it), depth, swatchOf(it)].join('|')).join('\n');
    const same = drawnItems && key === drawnKey && drawnItems.length === rows.length && rows.every((r, i) => r.it === drawnItems[i]);
    if (!same) {
      drawnItems = rows.map(r => r.it); drawnKey = key;
      const keep = list.scrollTop;
      list.textContent = '';
      if (!S.items.length) list.append(el('div', { class: 'empty' }, 'Empty. Add shapes, objects, sources, lights or marks from the tools on the left.'));
      else if (!rows.length) list.append(el('div', { class: 'empty' }, 'Nothing here matches the search.'));
      for (const g of groups) {
        list.append(el('div', { class: 'ghead' }, g.title));
        for (const { it, depth } of g.rows) {
          const on = S.isPicked(it), off = isOff(it), hid = isHiddenThing(it);
          const row = el('div', { class: 'item' + (on ? ' on' : '') + (off ? ' off' : '') + (hid ? ' hid' : '') + (depth ? ' part' : ''), role: 'option', 'aria-selected': on ? 'true' : 'false' },
            icon(itemIcon(it), 18),
            el('span', { class: 'nm' }, it.name + (off ? ' (off)' : '')),
            el('span', { class: 'sw', style: `background:${swatchOf(it)}` }),
            el('button', { type: 'button', class: 'ib', title: (hid ? 'Show it' : 'Hide it') + ' (H). Hidden things still work.', 'aria-label': (hid ? 'Show ' : 'Hide ') + it.name,
              onclick: e => { e.stopPropagation(); app.toggleHidden(S.isPicked(it) ? vp.selectedItems() : [it]); } }, icon(hid ? 'eyeOff' : 'eye', 16)));
          row.addEventListener('click', e => clickRow(e, it));
          row.addEventListener('dblclick', () => { vp.select(it); vp.frameSelected(); });
          row.addEventListener('contextmenu', e => { e.preventDefault(); app.contextMenu(it, e.clientX, e.clientY); });
          list.append(row);
        }
      }
      list.scrollTop = keep;
    }
    if (S.selected !== shown && list.isConnected) {
      shown = S.selected;
      const sel = [...list.querySelectorAll('.item.on')][rows.filter(r => S.isPicked(r.it)).findIndex(r => r.it === S.selected)] || list.querySelector('.item.on');
      if (sel) {
        const r = sel.getBoundingClientRect(), l = list.getBoundingClientRect();
        if (r.top < l.top) list.scrollTop += r.top - l.top;
        else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
      }
    }
  };
  find.addEventListener('input', paintList);

  let findDetails = '';
  const ctx = { vp, commit: () => app.commit(), repaint: () => { repaintAll(props); app.showDecalHandles(); }, repaintSoon: () => setTimeout(() => repaintAll(props), 50), paintList,
    showTab: k => document.querySelector(`[data-tab="${k}"]`).click(),
    menu: (x, y, items) => app.smallMenu(x, y, items), say: t => app.toast(t, true),
    editDecal: () => app.showDecalHandles(),
    rebuild: () => { const body = document.getElementById('body'), keep = body ? body.scrollTop : 0; paintProps(); app.showDecalHandles(); if (body) body.scrollTop = keep; } };

  const paintProps = () => {
    props.textContent = '';
    const group = vp.selectedItems(), it = vp.scene.selected;
    if (!group.length) {
      props.append(section('Details', el('p', { class: 'note' }, 'Nothing selected. Click a thing in the view or in the list above. In the view, Shift-click selects more than one; in the list, Shift-click selects everything between two rows.')));
      return;
    }
    const commit = () => app.commit();
    const finder = el('input', { class: 'find', type: 'search', placeholder: 'Search its settings', 'aria-label': 'Search its settings', spellcheck: 'false', value: findDetails });
    const none = el('p', { class: 'note', hidden: true }, 'No setting here matches. Clear the search to see them all.');
    if (group.length > 1) {
      const names = group.map(g => g.name);
      props.append(section(`${group.length} selected`,
        el('p', { class: 'note' }, names.length > 6 ? names.slice(0, 5).join(', ') + ` and ${names.length - 5} more` : names.join(', ')), finder, none));
    } else {
      const name = el('input', { class: 'name-in', value: it.name, 'aria-label': 'Name' });
      name.addEventListener('input', () => { it.name = name.value; paintList(); });
      name.addEventListener('change', commit);
      const a = assetOf(it);
      const title = it.kind === 'mark' ? MARK_TYPES[it.type].label : it.kind === 'emitter' ? sourceLabel(it) : it.kind === 'light' ? LIGHT_KINDS[it.type]
        : a ? a.label : it.model ? 'Model' : SHAPES[it.shape].label;
      props.append(section(null, el('h3', {}, title), name, finder, none));
    }
    if (group.length === 1) { const k = kitStatus(app, it, commit); if (k) props.append(k); }
    const cats = group.length === 1 && it.kind === 'mark' ? [...markSections(app, it, commit), ...categoriesFor([it], ctx)] : categoriesFor(group, ctx);
    props.append(...cats);
    if (group.length === 1) props.append(...aboutSections(app, it, commit));
    const refind = () => { const n = filterRows(props, findDetails); none.hidden = !findDetails.trim() || n > 0; };
    finder.addEventListener('input', () => { findDetails = finder.value; refind(); });
    refind();
    const many = group.length > 1 ? ` ${group.length}` : '';
    props.append(el('div', { class: 'btns' },
      button('Duplicate' + many, () => app.duplicateAll(group), { title: 'Ctrl+D' }),
      group.length === 1 && (it.kind !== 'mark' || it.pos) ? button('Focus', () => vp.frameSelected(), { title: 'Bring the camera to it (F)' }) : null,
      app.confirmButton('Delete' + many, () => app.removeAll(group))));
  };

  root.paint = () => { paintList(); paintProps(); };
  root.paintLight = () => { repaintAll(props); paintList(); };
  root.paintList = paintList;
  root.paint();
  return root;
}

function kitStatus(app, it, commit) {
  const vp = app.vp, a = assetOf(it);
  if (it.kind !== 'object' || !a || !a.sources || !a.sources.length) return null;
  if (vp.scene.emitters.some(e => e.attach && e.attach.to === it.id)) return null;
  const s = a.sources[0], word = s.sink ? (s.type === 'smoke' ? 'extractor' : 'drain') : s.type === 'smoke' ? 'smoke source' : 'pour';
  const B = vp.regionBox, inBox = it.pos[0] >= B.min[0] && it.pos[0] <= B.max[0] && it.pos[2] >= B.min[2] && it.pos[2] <= B.max[2];
  const need = a.sources.length, full = vp.scene.emitters.length + need > MAX_EMITTERS;
  if (it.whenInBox && it.whenInBox.parts) {
    if (inBox && full) return section('Not working yet', el('p', { class: 'note warn' }, `Its ${word} waits for a free source: a scene holds ${MAX_EMITTERS}, all in use. Delete one and it starts.`));
    if (!inBox) return section('Not working yet', el('p', { class: 'note warn' }, `Its ${word} starts when it is in the simulation box. Move it there, or:`),
      el('div', { class: 'btns' }, button('Bring the box to it', () => { const R = vp.boxToTake([it]); if (R) app.setSimulation({ region: { size: R.size, center: R.center }, keep: true }); },
        { title: 'Grow the simulation box to take it in. A bigger box costs more card time.' })));
    return null;
  }
  return section('Not working', el('p', { class: 'note warn' }, `Its ${word} is gone: it was deleted, or there was no free source when it was made.`),
    el('div', { class: 'btns' }, button(`Add its ${word}`, () => { it.whenInBox = { parts: true }; commit(); app.repaint(); })));
}

function aboutSections(app, it, commit) {
  const vp = app.vp, out = [];
  if (it.kind !== 'mark') out.push(labelButtons(app, it));
  if (it.kind === 'object' && it.model && !(assetOf(it) && assetOf(it).mesh)) {
    const m = vp.scene.models.get(it.model);
    const half = m.fileHalf ? m.fileHalf.map(v => (v * 2).toPrecision(3)).join(' × ') + ' file units' : '';
    out.push(section('From file',
      el('p', { class: 'note' }, el('b', {}, m.name), ` · ${fmtN(m.triangles)} triangles`, half ? ` · ${half}` : ''),
      el('p', { class: 'note' }, m.ready ? `The fluids flow round it (its shape was worked out in ${Math.round(m.bakeMs || 0)} ms).` : 'Working out its shape for the fluids…'),
      el('div', { class: 'btns' },
        button('Stand it up', () => { it.rot[0] = it.rot[0] ? 0 : -Math.PI / 2; dropToGround(vp, it); app.repaint(); commit(); },
          { title: 'For models made with Z pointing up (CAD, 3D printing): turn them upright, or back.' }),
        button('Keep proportions', () => { const k = Math.max(...it.size); it.size = m.prop.map(p => p * k); dropToGround(vp, it); app.repaint(); commit(); },
          { title: 'Undo any stretching: size it in the model\'s own proportions.' }))));
  } else if (it.kind === 'object' && assetOf(it) && assetOf(it).mesh) {
    const m = vp.scene.models.get(it.model);
    out.push(section('From the library', el('p', { class: 'note' },
      m && m.ready ? 'Made by the app. The fluids flow round it.' : 'Made by the app. Working out its shape for the fluids…')));
  }
  return out;
}

function labelButtons(app, it) {
  return section('Marks',
    el('p', { class: 'note' }, 'Live data and drawn elements over the view. More in the Marks tool on the left.'),
    el('div', { class: 'btns' },
      button('Label it', () => app.addMark('label', { target: it.id, text: it.kind === 'emitter' ? '{name}' : '{name}\n{height}' }),
        { title: 'A label on it that follows it, with its name and height (change the text to show other live numbers).' }),
      button('Link from it…', () => app.startLink(it), { title: 'A line from it to another thing: click the other thing next.' })));
}


const FONT_CHOICES = [['sans', 'Sans'], ['mono', 'Mono'], ['serif', 'Serif']];
const FIELDS_NOTE = 'Live numbers in braces: {timecode} {time} {frame} {fps} {card} {particles} {wind} {objects} {moving} {sources}.';

function markSections(app, m, commit) {
  const vp = app.vp, T = MARK_TYPES[m.type], out = [];
  const things = () => [['', '(nothing)'], ...vp.scene.objects.map(o => [String(o.id), o.name]), ...vp.scene.emitters.map(e => [String(e.id), e.name]),
    ...vp.scene.lights.map(l => [String(l.id), l.name])];
  const idOf = v => v == null ? null : +v;
  const style = () => {
    const rows = [
      choice({ label: 'Font', options: FONT_CHOICES, get: () => m.font, set: v => { m.font = v; }, commit }),
      slider({ label: 'Size', min: 8, max: 48, step: 1, unit: ' px', get: () => m.size, set: v => { m.size = v; }, commit }),
      color({ label: 'Colour', get: () => m.color, set: v => { m.color = v; app.scenePanelList(); }, commit }),
    ];
    if (m.type === 'text') rows.push(toggle({ label: 'Italic', get: () => !!m.italic, set: v => { m.italic = v; }, commit }));
    if ('bg' in T.defaults && m.type !== 'label') {
      rows.push(toggle({ label: 'Box behind', get: () => !!m.bg, set: v => { m.bg = v ? (m.lastBg || '#ffffff') : ''; if (!v) m.lastBg = m.bg || m.lastBg; app.repaint(); }, commit }));
      if (m.bg) rows.push(color({ label: 'Box colour', get: () => m.bg, set: v => { m.bg = v; m.lastBg = v; }, commit }));
    }
    return section('Style', ...rows);
  };
  const screenPlace = () => section('Place',
    el('p', { class: 'note' }, 'Drag it in the view to move it.'),
    numbers({ label: 'Position (%)', keys: ['X', 'Y'], step: 1, get: i => (i ? m.y : m.x) * 100,
      set: (i, v) => { const f = Math.min(98, Math.max(0, v)) / 100; if (i) m.y = f; else m.x = f; }, commit }));
  const worldPlace = (sized) => {
    const sec = section('Place', numbers({ label: 'Position (m)', keys: ['X', 'Y', 'Z'], step: 0.05, get: i => m.pos[i],
      set: (i, v) => { m.pos[i] = v; }, commit }));
    if (sized === 'sheet') sec.append(numbers({ label: 'Size (m)', keys: ['W', 'H'], step: 0.05, get: i => m.size[i] * 2, set: (i, v) => { m.size[i] = Math.max(0.02, v / 2); }, commit }));
    if (sized === 'box') sec.append(numbers({ label: 'Size (m)', keys: ['W', 'H', 'D'], step: 0.05, get: i => m.size[i] * 2, set: (i, v) => { m.size[i] = Math.max(0.01, v / 2); }, commit }));
    if (sized) sec.append(numbers({ label: 'Rotation (°)', keys: ['Tilt', 'Turn', 'Roll'], step: 1, get: i => m.rot[i] * DEG, set: (i, v) => { m.rot[i] = v / DEG; }, commit }));
    return sec;
  };

  if (m.type === 'text') {
    out.push(section('Shows', text({ label: 'Says', lines: 3, get: () => m.text, set: v => { m.text = v; }, commit }),
      el('p', { class: 'note' }, FIELDS_NOTE)), style(), screenPlace());
  } else if (m.type === 'timer') {
    out.push(section('Shows',
      choice({ label: 'Shows', options: [['timecode', 'Time code'], ['seconds', 'Seconds'], ['clock', 'Minutes']], wrap: true, get: () => m.format, set: v => { m.format = v; }, commit,
        titles: { timecode: 'Hours, minutes, seconds and frames (24 a second)', seconds: '12.3 s', clock: '01:02.3' } }),
      text({ label: 'In front', placeholder: 'nothing', get: () => m.label, set: v => { m.label = v; }, commit }),
      el('p', { class: 'note' }, 'Simulated time: it starts again with the fluids, and runs at the simulation\'s speed.')), style(), screenPlace());
  } else if (m.type === 'counter') {
    const custom = el('div');
    custom.append(
      slider({ label: 'Starts at', min: 0, max: 10000, step: 1, get: () => m.start, set: v => { m.start = v; }, commit }),
      slider({ label: 'A second', min: -100, max: 100, step: 0.1, get: () => m.perSecond, set: v => { m.perSecond = v; }, commit, help: 'How much it goes up every simulated second.' }));
    custom.hidden = m.counts !== 'custom';
    out.push(section('Shows',
      pick({ label: 'Counts', options: COUNTS, get: () => m.counts, set: v => { m.counts = v; custom.hidden = v !== 'custom'; }, commit }),
      custom,
      slider({ label: 'Digits', min: 1, max: 9, step: 1, get: () => m.digits, set: v => { m.digits = v; }, commit, help: 'Zeros in front up to this many digits.' }),
      text({ label: 'In front', placeholder: 'nothing', get: () => m.label, set: v => { m.label = v; }, commit })), style(), screenPlace());
  } else if (m.type === 'readout') {
    out.push(section('Shows',
      text({ label: 'Title', placeholder: 'none', get: () => m.title, set: v => { m.title = v; }, commit }),
      color({ label: 'Title bar', get: () => m.accent, set: v => { m.accent = v; }, commit }),
      el('h3', {}, 'Rows'),
      ...Object.entries(LIVE).map(([k, L]) => toggle({ label: L.label, get: () => m.rows.includes(k),
        set: v => { m.rows = v ? Object.keys(LIVE).filter(q => q === k || m.rows.includes(q)) : m.rows.filter(q => q !== k); }, commit }))),
    style(), screenPlace());
  } else if (m.type === 'legend') {
    out.push(section('Shows',
      text({ label: 'Title', placeholder: 'none', get: () => m.title, set: v => { m.title = v; }, commit }),
      el('p', { class: 'note' }, 'Lists every source by its name, with its colour and whether it is on now (sources on a timer switch as it runs). Rename a source to change its line.')),
    style(), screenPlace());
  } else if (m.type === 'label') {
    out.push(section('Shows',
      pick({ label: 'On', options: things, get: () => m.target, set: v => { m.target = idOf(v); if (m.target == null && !m.pos) m.pos = [0, 1, 0]; app.repaint(); }, commit }),
      text({ label: 'Says', lines: 2, get: () => m.text, set: v => { m.text = v; }, commit }),
      el('p', { class: 'note' }, 'On a thing, also: {name} {height} {speed} {x} {y} {z} {on}. ' + FIELDS_NOTE),
      choice({ label: 'Style', options: [['leader', 'Line'], ['tag', 'Tag'], ['plain', 'Plain']], get: () => m.style, set: v => { m.style = v; }, commit,
        titles: { leader: 'A thin line from the thing to the text', tag: 'The text in a box, on a line', plain: 'Just the text' } }),
      m.target != null && vp.scene.objects.some(o => o.id === m.target)
        ? toggle({ label: 'Box round it on screen', get: () => !!m.box, set: v => { m.box = v; }, commit }) : null,
      numbers({ label: 'Offset (px)', keys: ['X', 'Y'], step: 1, get: i => i ? m.dy : m.dx, set: (i, v) => { if (i) m.dy = v; else m.dx = v; }, commit })),
    section('Style',
      choice({ label: 'Font', options: FONT_CHOICES, get: () => m.font, set: v => { m.font = v; }, commit }),
      slider({ label: 'Size', min: 8, max: 40, step: 1, unit: ' px', get: () => m.size, set: v => { m.size = v; }, commit }),
      color({ label: 'Colour', get: () => m.color, set: v => { m.color = v; app.scenePanelList(); }, commit }),
      m.style === 'tag' ? color({ label: 'Tag colour', get: () => m.bg || '#ffffff', set: v => { m.bg = v; }, commit }) : null));
    if (m.target == null) out.push(worldPlace(null));
  } else if (m.type === 'tracker') {
    const nameRow = text({ label: 'Name has', placeholder: 'figure', get: () => m.name, set: v => { m.name = v; }, commit });
    nameRow.hidden = m.which !== 'named';
    out.push(section('Shows',
      el('p', { class: 'note' }, 'A box round each matching object on screen, numbered, following it as it moves.'),
      choice({ label: 'Round', options: [['models', 'Models'], ['moving', 'Moving'], ['named', 'Named'], ['all', 'All objects']], wrap: true,
        get: () => m.which, set: v => { m.which = v; nameRow.hidden = v !== 'named'; }, commit,
        titles: { models: 'Objects from the library and imported models (figures, stands…)', moving: 'Objects with weight or motion', named: 'Objects whose name has some words', all: 'Every object' } }),
      nameRow,
      toggle({ label: 'Numbers', get: () => !!m.numbers, set: v => { m.numbers = v; }, commit }),
      toggle({ label: 'Screen position', get: () => !!m.coords, set: v => { m.coords = v; }, commit })),
    section('Style',
      choice({ label: 'Font', options: FONT_CHOICES, get: () => m.font, set: v => { m.font = v; }, commit }),
      slider({ label: 'Size', min: 8, max: 24, step: 1, unit: ' px', get: () => m.size, set: v => { m.size = v; }, commit }),
      color({ label: 'Colour', get: () => m.color, set: v => { m.color = v; app.scenePanelList(); }, commit })));
  } else if (m.type === 'link') {
    out.push(section('Joins',
      pick({ label: 'From', options: things, get: () => m.from, set: v => { m.from = idOf(v); }, commit }),
      pick({ label: 'To', options: things, get: () => m.to, set: v => { m.to = idOf(v); }, commit }),
      color({ label: 'Colour', get: () => m.color, set: v => { m.color = v; app.scenePanelList(); }, commit }),
      color({ label: 'Fades to', get: () => m.color2 || m.color, set: v => { m.color2 = v; }, commit }),
      slider({ label: 'Width', min: 0.5, max: 8, step: 0.5, unit: ' px', get: () => m.width, set: v => { m.width = v; }, commit }),
      toggle({ label: 'Dashed', get: () => !!m.dash, set: v => { m.dash = v; }, commit })));
  } else if (m.type === 'grid') {
    out.push(section('Lines',
      slider({ label: 'Spacing', min: 2, max: 100, step: 1, unit: ' cm', get: () => m.spacing * 100, set: v => { m.spacing = v / 100; }, commit }),
      color({ label: 'Colour', get: () => m.color, set: v => { m.color = v; app.scenePanelList(); }, commit }),
      slider({ label: 'Line width', min: 0.5, max: 4, step: 0.5, unit: ' px', get: () => m.width, set: v => { m.width = v; }, commit })), worldPlace('sheet'));
  } else if (m.type === 'outline') {
    out.push(section('Lines',
      color({ label: 'Colour', get: () => m.color, set: v => { m.color = v; app.scenePanelList(); }, commit }),
      slider({ label: 'Line width', min: 0.5, max: 4, step: 0.5, unit: ' px', get: () => m.width, set: v => { m.width = v; }, commit }),
      toggle({ label: 'Dashed', get: () => !!m.dash, set: v => { m.dash = v; }, commit })), worldPlace('box'));
  }
  return out;
}

export function dropToGround(vp, o) { vp.dropToGround(o); }


export function fluidsPanel(app) {
  const vp = app.vp, S = () => vp.settings;
  const set = k => v => { vp.set(k, v); app.markDirty(); };
  const row = k => {
    const d = FLUID_SETTINGS.find(x => x.key === k);
    return slider({ label: d.label, min: d.min, max: d.max, step: d.step, unit: d.unit, reset: d.value, get: () => S()[k] ?? d.value, set: set(k),
      help: [d.help, d.also].filter(Boolean).join('\n') });
  };
  const live = el('p', { class: 'note' });
  const region = regionSection(app);
  const root = el('div', {},
    region,
    category('f-time', 'Time and gravity', [row('speed'), row('gravity'),
      el('div', { class: 'btns' }, button('Empty the fluids', () => vp.resetFluids(), { title: 'Removes all smoke and liquid; keeps everything else.' }))]),
    category('f-smoke', 'Smoke', [row('smokeAmount'), row('fade'), row('cooling'), row('rise'), row('smokeWeight'), row('swirl'), row('smokeDetail'), row('smokeSteps'), row('smokeOpacity')]),
    category('f-liquid', 'Liquid', [row('flow'), row('splash'), row('liquidSteps'), row('clarity'), row('foam'), row('caustics'),
      choice({ label: 'Look', wrap: true, options: [['smooth', 'Smooth'], ['surface', 'Surface'], ['dots', 'Particles']],
        titles: { smooth: 'One smooth surface made from all the particles', surface: 'The particles drawn as balls and smoothed together (the look before November 2026)', dots: 'Each particle as a small ball' },
        get: () => S().look, set: set('look') }),
      live]));
  root.paint = () => repaintAll(root);
  root.tick = () => {
    region.check();
    const f = vp.flip;
    live.textContent = f ? `${fmtN(f.live)} of ${fmtN(f.maxParticles)} particles` + (f.full ? '. Full: the oldest are reused at the sources.' : '.') : '';
  };
  return root;
}

function regionSection(app) {
  const vp = app.vp;
  const running = () => JSON.stringify({ region: vp.region, fineness: vp.fineness });
  const stale = () => app.regionDraft && app.regionDraft.base !== running();
  const draft = () => {
    if (stale()) { app.regionDraft = null; vp.previewRegion = null; }
    return (app.regionDraft ||= { base: running(), region: JSON.parse(JSON.stringify(vp.region)), fineness: { ...vp.fineness } });
  };
  const changed = () => { const d = draft(); return JSON.stringify({ region: d.region, fineness: d.fineness }) !== running(); };
  const info = el('p', { class: 'note' });
  const apply = () => {
    if (!changed()) return;
    const d = draft();
    app.regionDraft = null;
    vp.previewRegion = null;
    app.setSimulation({ region: d.region, fineness: d.fineness, keep: true });
    sec.paint();
  };
  const touched = () => { vp.previewRegion = changed() ? draft().region : null; paintInfo(); };
  const L = REGION_LIMITS;
  const sec = section('Simulation box',
    el('p', { class: 'note' }, 'Smoke and liquid live in this box, standing on the ground. Drag its handles in the view, or type here: the smoke and water stay.'),
    numbers({ label: 'Size (m)', keys: ['W', 'H', 'D'], step: 0.1, get: i => draft().region.size[i],
      set: (i, v) => { draft().region.size[i] = Math.min(L.max, Math.max(L.min, v)); touched(); }, commit: apply }),
    numbers({ label: 'Centre (m)', keys: ['X', 'Z'], step: 0.1, get: i => draft().region.center[i],
      set: (i, v) => { draft().region.center[i] = Math.min(20, Math.max(-20, v)); touched(); }, commit: apply }),
    el('div', { class: 'btns' },
      button('Fit round the scene', () => { draft().region = fitRegion(vp); apply(); },
        { title: 'Size the box to hold every object and source, with half a metre to spare.' })),
    el('h3', {}, 'Fineness', el('small', {}, 'smaller cells: finer, more card time')),
    choice({ options: Object.entries(DETAIL).map(([k, d]) => [k, d.label]), wrap: true,
      get: () => Object.keys(DETAIL).find(k => Math.abs(DETAIL[k].smoke - draft().fineness.smoke) < 1e-6 && Math.abs(DETAIL[k].liquid - draft().fineness.liquid) < 1e-6) || '',
      set: k => { draft().fineness = { smoke: DETAIL[k].smoke, liquid: DETAIL[k].liquid }; touched(); }, commit: apply }),
    slider({ label: 'Smoke cell', min: 2, max: 20, step: 0.1, unit: ' cm', get: () => draft().fineness.smoke * 100,
      set: v => { draft().fineness.smoke = v / 100; touched(); }, commit: apply, help: 'Size of one smoke cell. Houdini: Division size.' }),
    slider({ label: 'Liquid cell', min: 2, max: 20, step: 0.1, unit: ' cm', get: () => draft().fineness.liquid * 100,
      set: v => { draft().fineness.liquid = v / 100; touched(); }, commit: apply, help: 'Size of one liquid cell; 8 particles fill a cell. Houdini: the particle separation is half of it.' }),
    info);
  function paintInfo() {
    const d = draft(), R = d.region.size;
    const sg = gridFor(R, d.fineness.smoke, MAX_SMOKE_CELLS), lg = gridFor(R, d.fineness.liquid, MAX_LIQUID_CELLS);
    const sc = sg.dims[0] * sg.dims[1] * sg.dims[2], lc = lg.dims[0] * lg.dims[1] * lg.dims[2];
    const parts = Math.min(MAX_PARTICLES, Math.round(lc * 8 * 0.4));
    info.textContent = `Smoke ${sg.dims.join(' × ')} = ${fmtN(sc)} cells${sg.coarsened ? ` (too many: widened to ${(sg.cell * 100).toFixed(1)} cm)` : ''}. ` +
      `Liquid ${lg.dims.join(' × ')} = ${fmtN(lc)} cells, room for ${fmtN(parts)} particles${lg.coarsened ? ` (widened to ${(lg.cell * 100).toFixed(1)} cm)` : ''}.` +
      (changed() ? ' Not running yet: press Enter or leave the field (the view shows the new box).' : '');
  }
  sec.paint = () => { repaintAll(sec); paintInfo(); };
  sec.check = () => { if (stale()) sec.paint(); };
  sec.paint();
  return sec;
}

function fitRegion(vp) {
  const s = vp.scene, lo = [Infinity, 0, Infinity], hi = [-Infinity, 0, -Infinity];
  const grow = (p, r) => { for (const k of [0, 2]) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r); } hi[1] = Math.max(hi[1], p[1] + r); };
  for (const o of s.objects) grow(o.pos, Math.hypot(...o.size));
  for (const e of s.emitters) grow(e.pos, e.radius + 0.3);
  if (!Number.isFinite(lo[0])) return { size: [4, 4, 4], center: [0, 0] };
  const pad = 0.5, L = REGION_LIMITS;
  const size = [hi[0] - lo[0] + 2 * pad, Math.max(hi[1] + 1.5, 2), hi[2] - lo[2] + 2 * pad].map(v => Math.min(L.max, Math.max(2, +v.toFixed(1))));
  return { size, center: [+((lo[0] + hi[0]) / 2).toFixed(2), +((lo[2] + hi[2]) / 2).toFixed(2)] };
}


export function windPanel(app) {
  const vp = app.vp, W = () => vp.look.wind;
  const root = el('div', {},
    section('Wind',
      el('p', { class: 'note' }, 'Wind carries the smoke, ripples and pushes the liquid\'s surface, blows spray, and slants the rain. Its arrow shows in the corner of the view.'),
      toggle({ label: 'Wind', get: () => W().on, set: v => { W().on = v; } }),
      dial({ label: 'Blows toward', get: () => W().dir, set: v => { W().dir = v; } }),
      slider({ label: 'Strength', min: 0, max: 15, step: 0.1, unit: ' m/s', reset: 2, get: () => W().speed, set: v => { W().speed = v; },
        help: '2 m/s is a breeze, 8 a strong wind, 15 a gale.' }),
      slider({ label: 'Gusts', min: 0, max: 1, step: 0.01, reset: 0.45, get: () => W().gusts, set: v => { W().gusts = v; },
        help: 'How much the wind rises, falls and veers over time.' }),
      slider({ label: 'Turbulence', min: 0, max: 1, step: 0.01, reset: 0.5, get: () => W().turbulence, set: v => { W().turbulence = v; },
        help: 'Small random swirls carried along with the wind.' })),
    section('Rain',
      el('p', { class: 'note' }, 'Rain falls across the view and makes shiny ground ripple. It does not add water to the liquid.'),
      slider({ label: 'Amount', min: 0, max: 1, step: 0.01, reset: 0, get: () => vp.look.weather.rain, set: v => { vp.look.weather.rain = v; } })));
  root.paint = () => repaintAll(root);
  return root;
}


export function lightPanel(app) {
  const vp = app.vp, L = () => vp.look.light;
  const custom = () => { L().preset = 'custom'; presetRow.paint(); presetNote.paint(); };
  const presetNote = el('p', { class: 'note' });
  presetNote.paint = () => {
    presetNote.textContent = L().preset === 'custom' || !LIGHT_PRESETS[L().preset] ? 'Custom: changed from a starting setup.' : `${LIGHT_PRESETS[L().preset].label}. Change anything below to make it your own.`;
  };
  const presetRow = choice({ options: Object.entries(LIGHT_PRESETS).map(([k, p]) => [k, p.label]), wrap: true, get: () => L().preset,
    set: v => { vp.look.light = { preset: v, ...copy(LIGHT_PRESETS[v]) }; root.paint(); } });
  const lamp = (key, title, max, withSoft) => section(title,
    dial({ label: 'Comes from', get: () => L()[key].az, set: v => { L()[key].az = v; custom(); } }),
    slider({ label: 'Height', min: 0, max: 90, step: 1, unit: '°', get: () => L()[key].el, set: v => { L()[key].el = v; custom(); },
      help: 'Height above the horizon: 0 is level, 90 straight overhead.' }),
    color({ label: 'Colour', get: () => L()[key].color, set: v => { L()[key].color = v; custom(); } }),
    slider({ label: 'Strength', min: 0, max, step: 0.05, get: () => L()[key].power, set: v => { L()[key].power = v; custom(); } }),
    withSoft ? slider({ label: 'Soft shadows', min: 0.3, max: 12, step: 0.1, get: () => L()[key].soft, set: v => { L()[key].soft = v; custom(); },
      help: 'Sharp shadows from a small bright light, or soft ones from a big or cloudy one.' }) : null);
  const root = el('div', {},
    section('Start from', presetRow, presetNote,
      el('p', { class: 'note' }, 'Lighting only: the background and the ground (World tab) stay as they are.'),
      el('p', { class: 'note' }, 'Lights of your own (area, point, spot): the Lights tool on the left. For a scene lit only by them: None here, and the Black background in the World tab.')),
    lamp('key', 'Key light (main, casts shadows)', 8, true),
    lamp('fill', 'Fill light (softens the dark side)', 3, false),
    lamp('rim', 'Rim light (from behind, outlines)', 8, false),
    section('Light from all round',
      color({ label: 'From above', get: () => L().ambSky, set: v => { L().ambSky = v; custom(); } }),
      color({ label: 'From below', get: () => L().ambGround, set: v => { L().ambGround = v; custom(); } }),
      slider({ label: 'Strength', min: 0, max: 2, step: 0.01, get: () => L().ambPower, set: v => { L().ambPower = v; custom(); } })),
    section('Camera',
      slider({ label: 'Exposure', min: 0.2, max: 2.5, step: 0.01, get: () => L().exposure, set: v => { L().exposure = v; custom(); },
        help: 'Brighter or darker overall, like a camera.' }),
      slider({ label: 'Lens', min: 14, max: 200, step: 1, unit: ' mm', reset: 31, get: () => 12 / Math.tan(vp.camera.fov / 2),
        set: v => { vp.camera.fov = 2 * Math.atan(12 / v); },
        help: 'Wide (small numbers) sees more and stretches depth; long (large numbers) flattens it, like a diagram or a close photograph of a model. Step back with the wheel after a longer lens. 31 mm is the standard view.' })));
  root.paint = () => { repaintAll(root); presetNote.paint(); };
  root.paint();
  return root;
}


const COLOUR_NAMES = {
  studio: ['Top', 'Floor edge'], sky: ['Overhead', 'Horizon'], overcast: ['Overhead', 'Horizon'], city: ['Overhead', 'Horizon'],
  gradient: ['Top', 'Bottom'], paper: ['Top', 'Bottom'], solid: ['Colour', null], image: [null, null], black: [null, null],
};

export function worldPanel(app) {
  const vp = app.vp, B = () => vp.look.background, G = () => vp.look.ground;
  const colours = el('div');
  const imageInfo = el('div');
  const paintColours = () => {
    colours.textContent = '';
    const [t, b] = COLOUR_NAMES[B().preset] || ['Top', 'Bottom'];
    if (t) colours.append(color({ label: t, get: () => B().top, set: v => { B().top = v; if (B().preset === 'solid') B().bottom = v; } }));
    if (b) colours.append(color({ label: b, get: () => B().bottom, set: v => { B().bottom = v; } }));
    imageInfo.textContent = '';
    if (B().preset === 'image') {
      const img = vp.bgImage;
      imageInfo.append(
        el('p', { class: 'note' }, img ? el('b', {}, img.name) : 'No picture yet.', img ? ` · ${img.width} × ${img.height} · ${Math.abs(img.width / img.height - 2) < 0.15 ? 'a panorama, wraps all round' : 'stands behind the scene'}` : ''),
        el('p', { class: 'note' }, 'A panorama (twice as wide as tall) wraps all round and shows in reflections; any other picture stands behind the scene.'),
        el('div', { class: 'btns' }, button(img ? 'Choose another picture…' : 'Choose a picture…', () => app.pickImage())));
    }
  };
  const kind = choice({ options: Object.entries(BACKGROUNDS).map(([k, b]) => [k, b.label]), wrap: true, get: () => B().preset,
    set: v => {
      const keep = B().image;
      vp.look.background = { preset: v, ...copy(BACKGROUNDS[v]), image: keep };
      if (v === 'image' && vp.bgImage) app.applyImageColours();
      if (v === 'image' && !vp.bgImage) app.pickImage();
      paintColours();
      repaintAll(root);
    } });
  const groundBox = el('div');
  const groundCtx = { vp, commit: () => app.commit(), repaint: () => { repaintAll(groundBox); app.showDecalHandles(); }, repaintSoon: () => setTimeout(() => repaintAll(groundBox), 50), paintList: () => {},
    showTab: k => document.querySelector(`[data-tab="${k}"]`).click(), menu: (x, y, items) => app.smallMenu(x, y, items), say: t => app.toast(t, true),
    editDecal: () => app.showDecalHandles(), rebuild: () => { paintGround(); app.showDecalHandles(); } };
  const lines = el('div');
  lines.append(
    color({ label: 'Line colour', get: () => G().gridColor || '#808080', set: v => { G().gridColor = v; } }),
    slider({ label: 'Spacing', min: 2, max: 200, step: 1, unit: ' cm', get: () => (G().gridSpacing || 1) * 100, set: v => { G().gridSpacing = v / 100; },
      help: 'Between the lines. Grid paper: 20 cm or less. Fainter lines run at a quarter of it.' }),
    slider({ label: 'Strength', min: 0, max: 1, step: 0.01, get: () => G().gridStrength || 0.22, set: v => { G().gridStrength = v; } }));
  const paintPattern = () => { lines.hidden = patternOf(G()) !== 'lines'; };
  const root = el('div', {},
    section('Background', el('p', { class: 'note' }, 'What is behind the scene. It does not change the lighting.'), kind, colours, imageInfo,
      slider({ label: 'Haze', min: 0, max: 1, step: 0.01, get: () => B().haze, set: v => { B().haze = v; },
        help: 'How much the distance fades into the horizon colour.' })),
    section('Ground',
      color({ label: 'Colour', get: () => G().color, set: v => { G().color = v; } }),
      choice({ label: 'Finish', options: Object.entries(FINISHES).map(([k, f]) => [k, f.label]), wrap: true, get: () => G().finish, set: v => { G().finish = v; } }),
      choice({ label: 'Pattern', options: GROUND_PATTERNS, get: () => patternOf(G()),
        set: v => { G().grid = v === 'bricks' ? 'bricks' : v === 'lines'; paintPattern(); },
        titles: { none: 'A plain floor', lines: 'Grid lines: a guide, or grid paper with a colour and a fine spacing', bricks: 'Brick paving, 21.5 by 6.5 cm' } }),
      lines),
    groundBox);
  const paintGround = () => {
    const body = document.getElementById('body'), keep = body ? body.scrollTop : 0;
    groundBox.replaceChildren(...groundCategories(groundCtx));
    if (body) body.scrollTop = keep;
  };
  root.paint = () => { paintColours(); paintPattern(); paintGround(); repaintAll(root); };
  root.paint();
  return root;
}


export function filtersPanel(app) {
  const vp = app.vp;
  const P = () => vp.look.post;
  const ensure = () => (vp.look.post ||= {});
  const val = k => { const p = P(); return p && p[k] !== undefined ? p[k] : POST_DEFAULTS[k]; };
  const put = k => v => { ensure()[k] = v; ensure().preset = 'custom'; presetRow.paint(); };
  const s = (label, k, min, max, step, unit, help) => slider({ label, min, max, step, unit, reset: POST_DEFAULTS[k], get: () => val(k), set: put(k), help });
  const filmRow = choice({ options: [['none', 'None'], ...Object.entries(FILM_LOOKS).map(([k, f]) => [k, f.label])], wrap: true,
    get: () => (P() && P().film) || 'none',
    set: v => { ensure().film = v === 'none' ? null : v; repaintAll(root); },
    titles: Object.fromEntries([['none', 'No film look'], ...Object.entries(FILM_LOOKS).map(([k, f]) => [k, `${f.says} In the manner of Fujifilm ${f.after}.`])]) });
  const dSet = k => v => { ensure()[k] = v; ensure().diffusion = 'custom'; diffRow.paint(); };
  const ds = (label, k, min, max, step, help) => slider({ label, min, max, step, reset: POST_DEFAULTS[k], get: () => val(k), set: dSet(k), help });
  const diffRow = choice({ options: Object.entries(DIFFUSIONS).map(([k, f]) => [k, f.label]), wrap: true,
    get: () => (P() && P().diffusion) || (val('bloom') || val('veil') || val('softHigh') ? 'custom' : 'none'),
    set: v => { Object.assign(ensure(), DIFFUSIONS[v].p, { diffusion: v }); repaintAll(root); },
    titles: Object.fromEntries(Object.entries(DIFFUSIONS).map(([k, f]) => [k, f.says || 'None'])) });
  const band = () => (P() && P().band) || null;
  const setBand = (k, v) => { const b = ensure().band ||= { center: 0.56, half: 0.13, blur: 5 }; b[k] = v; ensure().preset = 'custom'; presetRow.paint(); };
  const presetRow = choice({ options: Object.entries(FILTER_PRESETS).map(([k, f]) => [k, f.label]), wrap: true,
    get: () => (P() && P().preset) || 'none',
    set: v => {
      const keep = Object.fromEntries(Object.entries(P() || {}).filter(([k]) => ['film', 'filmAmount', 'highlights', 'shadows', 'colour', 'warmth', 'green', 'chrome', 'clarity', 'sharpen', 'bloom', 'bloomFrom', 'bloomSpread', 'bloomTint', 'veil', 'softHigh', 'diffusion'].includes(k)));
      vp.look.post = v === 'none' && !Object.keys(keep).length ? null : { ...keep, ...(v === 'none' ? {} : copy(FILTER_PRESETS[v].p)), preset: v };
      app.markDirty(); root.paint();
    },
    titles: {
      none: 'The picture as rendered', photocopy: 'Black and white, hard, grainy, dark corners', haze: 'Soft, glowing, colours pulled apart and pushed up',
      tape: 'A worn video tape: colours pulled sideways, scan lines, a little blur', miniature: 'A sharp band in a soft picture, like a close photograph of a model',
      drawing: 'A few flat tones and dark lines, like a diagram', crisp: 'A little more contrast and colour', studio: 'Darker corners, a little contrast',
      cyanotype: 'Blue and white, like a sun print', sepia: 'Brown and cream, like an old print' } });
  const bandRows = el('div');
  bandRows.append(
    slider({ label: 'Where', min: 0, max: 1, step: 0.01, get: () => (band() || { center: 0.56 }).center, set: v => setBand('center', v), help: 'Height of the sharp band: 0 the top of the picture, 1 the bottom.' }),
    slider({ label: 'Band height', min: 0.02, max: 0.5, step: 0.01, get: () => (band() || { half: 0.13 }).half, set: v => setBand('half', v) }),
    slider({ label: 'Blur', min: 0, max: 14, step: 0.5, unit: ' px', get: () => (band() || { blur: 5 }).blur, set: v => setBand('blur', v), help: 'How soft the picture gets above and below the band.' }));
  const root = el('div', {},
    section('Film', filmRow,
      el('p', { class: 'note' }, 'Made by hand after each film\'s published character; not measured against a camera. Its name is in each tooltip.'),
      s('Strength', 'filmAmount', 0, 1, 0.01, '', 'How much of the film look.'),
      s('Highlights', 'highlights', -1, 1, 0.01, '', 'Over the film: harder or softer bright parts.'),
      s('Shadows', 'shadows', -1, 1, 0.01, '', 'Over the film: deeper or more open dark parts.'),
      s('Colour', 'colour', -1, 1, 0.01, '', 'Over the film: more or less colour.'),
      s('Colour depth', 'chrome', 0, 1, 0.01, '', 'Strong colours deepen and keep their detail.'),
      s('Warmth', 'warmth', -1, 1, 0.01, '', 'White balance: toward orange or toward blue.'),
      s('Green or pink', 'green', -1, 1, 0.01, '', 'White balance: toward green or toward magenta.'),
      s('Clarity', 'clarity', -1, 1, 0.01, '', 'More or less contrast in the middle sizes: minus goes dreamy.'),
      s('Sharpen', 'sharpen', 0, 1, 0.01),
      s('Grain', 'grain', 0, 0.3, 0.005),
      s('Grain size', 'grainSize', 1, 4, 0.05, ' px')),
    section('Diffusion and bloom', diffRow,
      el('p', { class: 'note' }, 'Light spreading from bright parts, as through a diffusion filter. It works on the light before the tone curve, so a lamp spreads more than a white wall.'),
      ds('Amount', 'bloom', 0, 1.5, 0.01, 'How much light spreads.'),
      ds('From', 'bloomFrom', 0, 3, 0.01, 'How bright a part must be to spread: 0 is all of it, as with a real filter; 1 is a white wall in full light.'),
      ds('Spread', 'bloomSpread', 0, 1, 0.01, 'How wide: a small halo, or a wide haze.'),
      color({ label: 'Its colour', get: () => val('bloomTint'), set: dSet('bloomTint'), help: 'White for a filter; red-orange for the halation of film.' }),
      ds('Veil', 'veil', 0, 0.5, 0.005, 'The light scattered over the whole picture: darks lift, contrast falls.'),
      ds('Soften whites', 'softHigh', 0, 1, 0.01, 'Blurs the edges of bright parts, leaving the rest sharp.')),
    section('Picture effects', presetRow,
      el('p', { class: 'note' }, 'Filters work on the finished picture, like a photo editor\'s. They are saved with the scene. Marks stay sharp over them.')),
    section('Colour',
      s('Saturation', 'saturation', 0, 2, 0.01, '', '0 is black and white.'),
      s('Contrast', 'contrast', 0.5, 2, 0.01),
      s('Lift darks', 'lift', 0, 0.5, 0.01, '', 'Raises the darks toward white, like faded paper.'),
      color({ label: 'Tint', get: () => val('tint'), set: put('tint') }),
      s('Tint amount', 'tintAmount', 0, 1, 0.01, '', 'Pulls every colour toward the tint. With saturation at 0: a picture in one colour.'),
      s('Posterize', 'posterize', 0, 12, 1, ' steps', 'A few flat tones (0: off).')),
    section('Print and screen',
      s('Scan lines', 'scan', 0, 0.5, 0.01),
      s('Vignette', 'vignette', 0, 1.2, 0.01, '', 'Darker corners.')),
    section('Lens',
      s('Soften', 'soften', 0, 4, 0.1, ' px'),
      s('Colour split', 'split', 0, 8, 0.1, ' px', 'Red and blue pulled sideways, like a worn tape or a cheap lens.'),
      s('Ink lines', 'ink', 0, 1, 0.01, '', 'Dark lines where the picture changes sharply, like a drawing.')),
    section('Miniature',
      toggle({ label: 'Sharp band, soft above and below', get: () => !!band(), set: v => { ensure().band = v ? { center: 0.56, half: 0.13, blur: 5 } : null; ensure().preset = 'custom'; presetRow.paint(); bandRows.hidden = !v; repaintAll(bandRows); } }),
      bandRows),
    el('div', { class: 'btns' }, button('No filters', () => { vp.look.post = null; root.paint(); })));
  root.paint = () => { bandRows.hidden = !band(); repaintAll(root); };
  root.paint();
  return root;
}
