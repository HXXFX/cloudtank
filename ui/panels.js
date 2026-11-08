import { el, slider, numbers, color, choice, toggle, dial, section, button, repaintAll, text, pick, swatches } from './dom.js';
import { icon } from './icons.js';
import { SHAPES } from '../engine/shapes.js';
import { MADE_KINDS } from '../engine/made.js';
import { LIGHT_PRESETS, BACKGROUNDS, FINISHES, GROUND_PATTERNS, patternOf, copy } from '../engine/environment.js';
import { DETAIL, gridFor, MAX_SMOKE_CELLS, MAX_LIQUID_CELLS, MAX_PARTICLES, REGION_LIMITS } from '../engine/viewport.js';
import { sourceLabel, LIGHT_KINDS, MAX_EMITTERS } from '../engine/scene.js';
import { hexToRgb, rgbToHex, SETTINGS as FLUID_SETTINGS } from '../engine/settings.js';
import { ASSET_BY_ID } from '../engine/assets.js';
import { categoriesFor, category, filterRows, groundCategories } from './details.js';
import { MARK_TYPES, LIVE, COUNTS, motionOn } from '../engine/marks.js';
import { POST_DEFAULTS, FILM_LOOKS, DIFFUSIONS, CELL_SHAPES, DITHERS, autoAdjust, LOOKS, LOOK_LIST, RECIPES, effectivePost, upgradePost } from '../engine/post.wgsl.js';
import { MEDIA_DEFAULTS, MEDIA_PRESETS, MEDIA_LIST, effectiveMedia, upgradeMedia } from '../engine/media.wgsl.js';
import { LOOK_PRESETS } from '../engine/fluids.js';

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
  if (it.made) return MADE_ICON[it.made.kind];
  return it.model ? 'model' : it.shape;
}
const MADE_ICON = { spin: 'spin', channel: 'drawnChannel', combine: 'combine' };

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
    remakeMade: (o, recipe) => app.remakeMade(o, recipe), uncombine: o => app.uncombine(o),
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
        : a ? a.label : it.made ? MADE_KINDS[it.made.kind] : it.model ? 'Model' : SHAPES[it.shape].label;
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
    el('p', { class: 'note' }, 'For the whole scene. Each source can have its own: click one, and change it under This fluid, with its look above that.'),
    fluidList(app),
    category('f-smoke', 'Smoke', [row('smokeAmount'), row('fade'), row('cooling'), row('rise'), row('smokeWeight'), row('swirl'), row('smokeDetail'), row('smokeSteps'), row('smokeOpacity')]),
    category('f-liquid', 'Liquid', [row('flow'), row('splash'), row('liquidSteps'), row('clarity'), row('foam'), row('caustics'),
      choice({ label: 'Look', wrap: true, options: [['smooth', 'Smooth'], ['surface', 'Surface'], ['dots', 'Particles']],
        titles: { smooth: 'One smooth surface made from all the particles', surface: 'The particles drawn as balls and smoothed together (the look before November 2026)', dots: 'Each particle as a small ball' },
        get: () => S().look, set: set('look') }),
      live]));
  root.paint = () => repaintAll(root);
  root.tick = () => {
    region.check();
    root.querySelector('.fluidlist').paint();
    const f = vp.flip;
    live.textContent = f ? `${fmtN(f.live)} of ${fmtN(f.maxParticles)} particles` + (f.full ? '. Full: the oldest are reused at the sources.' : '.') : '';
  };
  return root;
}

function fluidList(app) {
  const vp = app.vp, box = el('div', { class: 'fluidlist' });
  let shown = '';
  box.paint = () => {
    const list = vp.scene.emitters.filter(e => !e.sink);
    const key = JSON.stringify(list.map(e => [e.id, e.name, e.color, e.look ? e.look.preset : '', e.own ? 1 : 0, vp.scene.selected === e]));
    if (key === shown) return;
    shown = key;
    box.replaceChildren(...list.map(e => el('button', { type: 'button', class: 'fluidrow' + (vp.scene.selected === e ? ' on' : ''), title: 'Its settings and look', onclick: () => { vp.select(e); document.querySelector('[data-tab="scene"]').click(); } },
      el('i', { style: `background:${rgbToHex(e.color)}` }), el('span', {}, e.name), el('small', {}, [e.look ? (LOOK_PRESETS[e.look.preset] || { label: 'Own look' }).label : 'Photo real', e.own ? 'own settings' : ''].filter(Boolean).join(', ')))));
    box.hidden = !list.length;
  };
  box.paint();
  return box;
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


const MOVED = ['resolution', 'cellShape', 'dither', 'posterize', 'ink', 'border', 'borderWidth', 'keyline'];
const without = (o, keys) => { if (!o) return null; const c = { ...o }; for (const k of keys) delete c[k]; return c; };
const only = (o, keys) => { const c = {}; if (o) for (const k of keys) if (o[k] !== undefined) c[k] = o[k]; return c; };

function lookTiles({ items, get, set }) {
  const box = el('div', { class: 'lk-grid', role: 'listbox' });
  const tiles = items.map(it => {
    const canvas = el('canvas', { width: 192, height: 119, 'aria-hidden': 'true' });
    const pic = el('div', { class: it.key === 'none' ? 'pic off' : 'pic' }, canvas);
    const b = el('button', { type: 'button', class: 'lk', role: 'option', title: it.tip || it.says || it.name }, pic, el('span', { class: 'nm' }, it.name));
    b.dataset.key = it.key;
    b.addEventListener('click', () => set(it.key));
    box.append(b);
    return { b, canvas, it };
  });
  box.paint = () => { const v = get(); for (const t of tiles) { t.b.classList.toggle('on', t.it.key === v); t.b.setAttribute('aria-selected', t.it.key === v ? 'true' : 'false'); } };
  box.tiles = tiles;
  box.paint();
  return box;
}
function lookLine(p, items, L, older) {
  p.replaceChildren();
  const it = items.find(x => x.key === L);
  if (it && L !== 'none') p.append(el('b', {}, it.name), ': ' + it.says);
  else if (L !== 'none' && older) p.append(el('b', {}, older), ': from an earlier list, kept as this scene had it.');
  p.hidden = !p.childNodes.length;
}
const ROW_NAME = { contrast: 'Contrast', lightAreas: 'Highlights', darkAreas: 'Shadows', lift: 'Fade', saturation: 'Saturation', warmth: 'Temperature', green: 'Tint', clarity: 'Clarity', grain: 'Grain', vignette: 'Vignette', tintAmount: 'Colour grading' };
function lookTip(L) {
  const lines = [L.says];
  for (const k of L.also) {
    const r = RECIPES[k], name = (LOOKS[k] && LOOKS[k].label) || k;
    const colour = row => (row === 'tintAmount' && LOOKS[k] && LOOKS[k].p.tint ? ` in ${LOOKS[k].p.tint}` : '');
    lines.push(r && Object.keys(r).length ? `${name}: ${Object.entries(r).map(([row, v]) => `${ROW_NAME[row] || row} ${v}${colour(row)}`).join(', ')}` : `${name}: close to it as it is`);
  }
  return lines.join('\n');
}

export function filtersPanel(app) {
  const vp = app.vp;
  const camera = cameraFilters(app), medium = mediumFilters(app, camera);
  const which = choice({ options: [['photo', 'Camera'], ['media', 'Medium']], fit: false,
    titles: { photo: 'The camera takes the picture: its look, its colour and grain, the lens', media: 'The medium shows it: cells, prints, screens, an X-ray film, a radar' },
    get: () => app.filterSide || 'photo', set: v => { app.filterSide = v; paintSide(); pictures(true); } });
  const paintSide = () => { const s = app.filterSide || 'photo'; camera.hidden = s !== 'photo'; medium.hidden = s !== 'media'; which.paint(); };
  const root = el('div', {}, el('section', { class: 'sec' }, which,
    el('p', { class: 'note' }, 'The camera takes the picture; the medium shows it. Both work on the finished picture and are saved with the scene. Marks stay sharp over them.')), camera, medium);
  root.paint = () => { paintSide(); camera.paint(); medium.paint(); pictures(true); };
  let asked = false, last = 0, again = false;
  const pictures = soon => {
    if (soon) { last = 0; again = asked; }
    const side = (app.filterSide || 'photo') === 'photo' ? camera : medium;
    if (asked || !root.isConnected || !side.tiles.isConnected || !side.tiles.offsetParent || document.hidden || !vp.filterPictures) return;
    asked = true; last = performance.now();
    const T = side.tiles.tiles, c0 = T[0].canvas;
    vp.filterPictures(T.map(t => side.job(t.it.key)), c0.width, c0.height).then(pics => {
      pics.forEach((img, i) => { if (img) T[i].canvas.getContext('2d').putImageData(img, 0, 0); });
    }).catch(() => {}).finally(() => { asked = false; if (again) { again = false; last = 0; } });
  };
  root.pictures = pictures;
  setInterval(() => { if (performance.now() - last > 2000) pictures(); }, 250);
  paintSide();
  return root;
}

function cameraFilters(app) {
  const vp = app.vp;
  const P = () => vp.look.post;
  const ensure = () => (vp.look.post ||= {});
  const E = () => effectivePost(P()) || {};
  const val = k => { const e = E(); return e[k] !== undefined ? e[k] : POST_DEFAULTS[k]; };
  const own = k => !!P() && P()[k] !== undefined;
  const base = k => { const p = P(), b = p && p.look ? effectivePost({ look: p.look, amount: p.amount ?? 1 }) : {}; return b[k] !== undefined ? b[k] : POST_DEFAULTS[k]; };
  const same = (x, y) => (typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 1e-9 : JSON.stringify(x ?? null) === JSON.stringify(y ?? null));
  const changedByHand = k => own(k) && !same(P()[k], base(k));
  const shows = [];
  const showRows = () => { for (const [row, fn] of shows) row.hidden = !fn(); };
  const when = (row, fn) => { if (fn) shows.push([row, fn]); return row; };
  const changed = () => { app.markDirty(); showRows(); newPattern.classList.toggle('off', !grainy()); };
  const tidy = () => { const p = P(); if (p && !Object.values(p).some(v => v !== undefined)) vp.look.post = null; };
  const put = (k, v) => { ensure()[k] = v; };
  const unset = (...ks) => { const p = P(); if (p) for (const k of ks) delete p[k]; tidy(); changed(); };
  const owned = (...ks) => ks.some(k => changedByHand(k));
  const s = (label, k, min, max, step, unit, help, onlyIf) => when(slider({ label, min, max, step, unit, help, get: () => val(k), set: v => { put(k, v); changed(); },
    toDefault: () => unset(k), isDefault: () => !changedByHand(k) }), onlyIf);
  const merged = (label, keys, min, max, step, unit, help, get, set, onlyIf, slot) => when(slider({ label, min, max, step, unit, help, slot, get, set: v => { set(v); changed(); },
    toDefault: () => unset(...keys), isDefault: () => !owned(...keys) }), onlyIf);
  const swatch = (k, label) => {
    const input = el('input', { type: 'color', class: 'swatch', 'aria-label': label, title: label });
    input.addEventListener('input', () => { put(k, input.value); changed(); });
    input.paint = () => { input.value = val(k); };
    return input;
  };

  const lookOf = () => (P() && P().look) || 'none';
  const items = [{ key: 'none', name: 'None', says: 'No camera look: the picture as the scene draws it.' }, ...LOOK_LIST.map(L => ({ ...L, tip: lookTip(L) }))];
  const choose = v => { const kept = only(P(), MOVED); vp.look.post = v === 'none' ? (Object.keys(kept).length ? kept : null) : { look: v, amount: 1, ...kept }; anchor = null; app.markDirty(); repaintFilters(); };
  const repaintFilters = () => (app.panels && app.panels.filters ? app.panels.filters.paint() : root.paint());
  const tiles = lookTiles({ items, get: lookOf, set: choose });
  const lookNote = el('p', { class: 'lk-cap' });
  const amount = when(slider({ label: 'Amount', min: 0, max: 1, step: 0.01, reset: 1, help: 'How much of the look, from none to all of it. What you set by hand stays as you set it.',
    get: () => (P() && P().amount !== undefined ? P().amount : 1), set: v => { put('amount', v); changed(); } }), () => lookOf() !== 'none');
  let anchor = null, lastAuto = null;
  const autoAdjustNow = () => {
    if (!P() || !P().look) vp.look.post = { look: 'waroptics', amount: 1, ...only(P(), MOVED) };
    const now = E();
    if (!anchor || JSON.stringify(P()) !== lastAuto) anchor = copy(now);
    const next = autoAdjust(anchor, now), p = ensure();
    for (const [k, v] of Object.entries(next)) if (v !== now[k]) p[k] = v;
    lastAuto = JSON.stringify(P());
    app.markDirty(); repaintFilters();
  };
  const reset = () => { const L = P() && P().look, kept = only(P(), MOVED); vp.look.post = L ? { look: L, amount: P().amount ?? 1, ...kept } : Object.keys(kept).length ? kept : null; anchor = null; app.markDirty(); repaintFilters(); };
  const lookButtons = el('div', { class: 'btns' },
    button('Auto Adjust', autoAdjustNow, { title: 'A variation of the look, a new one each press: what it uses drifts a little and the grain and noise get a new pattern. With nothing on, it starts from War Optics.' }),
    button('Reset', reset, { title: 'Takes off everything set by hand on this tab: back to the look as it comes.' }));

  const toneColour = swatch('tint', 'Colour grading colour');
  const grading = merged('Colour grading', ['tintAmount', 'tint'], 0, 1, 0.01, '', 'Pulls every colour toward the colour at the end of the row, keeping its brightness. With Saturation at 0: one colour, as sepia or a cyanotype. (Camera Raw: Color Grading.)',
    () => val('tintAmount'), v => put('tintAmount', v), null, toneColour);
  const sharpening = merged('Sharpening', ['sharpen', 'soften'], -1, 1, 0.01, '', 'Plus makes edges crisper; minus softens the whole picture, as a lens a little out of focus.',
    () => (val('sharpen') > 0 ? val('sharpen') : -val('soften') / 3), v => { put('sharpen', Math.max(v, 0)); put('soften', Math.max(-v, 0) * 3); });
  const newPattern = el('button', { type: 'button', class: 'slotbtn', title: 'A new pattern of grain and noise, the same amount', 'aria-label': 'A new pattern of grain and noise' }, icon('restart', 14));
  newPattern.addEventListener('click', () => { put('seed', 1 + Math.floor(Math.random() * 999)); changed(); });
  const grainy = () => val('grain') > 0 || val('noise') > 0 || !!(FILM_LOOKS[val('film')] || {}).grain;
  const grain = merged('Grain', ['grain', 'seed'], 0, 0.3, 0.005, '', 'Film grain: clumps of two sizes, most in the middle tones. The button at the end gives a new pattern.',
    () => val('grain'), v => put('grain', v), null, newPattern);
  const diffusionOf = () => val('diffusion') || (val('bloom') > 0 ? 'custom' : 'none');
  const DIFF_KEYS = ['diffusion', 'bloom', 'bloomFrom', 'bloomSpread', 'bloomTint', 'veil', 'softHigh'];
  const diffusionMenu = pick({ label: 'Diffuse glow', inline: true, help: 'Light spreading from bright parts, as through a diffusion filter: from before the tone curve, so a lamp spreads more than a white wall. (Photoshop: Diffuse Glow.)',
    options: () => [...Object.entries(DIFFUSIONS).map(([k, f]) => [k, f.label]), ...(diffusionOf() === 'custom' ? [['custom', 'Your own']] : [])],
    titles: Object.fromEntries(Object.entries(DIFFUSIONS).map(([k, f]) => [k, f.says || 'None'])),
    get: diffusionOf, set: v => { if (DIFFUSIONS[v]) { for (const [k, x] of Object.entries(DIFFUSIONS[v].p)) put(k, x); put('diffusion', v); } changed(); repaintFilters(); },
    toDefault: () => unset(...DIFF_KEYS), isDefault: () => !owned(...DIFF_KEYS) });
  const glowColour = swatch('bloomTint', 'Glow colour');
  const glow = merged('Glow', DIFF_KEYS, 0, 1.5, 0.01, '', 'How much light the glow spreads, and its colour at the end of the row: white for a filter, red-orange for film\'s halation.',
    () => val('bloom'), v => {
      const b = (DIFFUSIONS[diffusionOf()] || {}).p, b0 = b && b.bloom > 0 ? b.bloom : val('bloom') || 1;
      const veil0 = b ? b.veil : val('veil'), soft0 = b ? b.softHigh : val('softHigh');
      put('bloom', v); put('veil', veil0 * v / b0); put('softHigh', soft0 * v / b0);
    }, () => diffusionOf() !== 'none', glowColour);
  const band = () => val('band');
  const tiltShift = merged('Tilt-shift', ['band'], 0, 1, 0.01, '', 'A sharp band across the picture, soft above and below it, as in a close photograph of a model. (Photoshop: Tilt-Shift.)',
    () => (band() ? Math.min(1, band().blur / 10) : 0), v => put('band', v > 0 ? { center: (band() || {}).center ?? 0.56, half: (band() || {}).half ?? 0.13, blur: v * 10 } : null));
  const bandAt = merged('Band at', ['band'], 0, 1, 0.01, '', 'Where the sharp band is: 0 the top of the picture, 1 the bottom.',
    () => (band() || {}).center ?? 0.56, v => put('band', { ...(band() || { half: 0.13, blur: 5 }), center: v }), () => !!band());

  const root = el('div', { class: 'photo-side' },
    section('Look', tiles, lookNote, amount, lookButtons),
    section('Light',
      s('Contrast', 'contrast', 0.5, 2, 0.01, '', 'The difference between light and dark, round mid grey.'),
      s('Highlights', 'lightAreas', -1, 1, 0.01, '', 'Only the tones above mid grey: up blows bright parts out to white, down holds them back.'),
      s('Shadows', 'darkAreas', -1, 1, 0.01, '', 'Only the tones below mid grey: down crushes dark parts to black, up opens them.'),
      s('Fade', 'lift', 0, 0.5, 0.01, '', 'Raises the blacks toward white, like faded paper.'),
      s('Saturation', 'saturation', 0, 2, 0.01, '', 'How much colour: 0 is black and white, 1 as it is.'),
      s('Temperature', 'warmth', -1, 1, 0.01, '', 'White balance: toward orange, or toward blue. (Camera Raw: Temperature.)'),
      s('Tint', 'green', -1, 1, 0.01, '', 'White balance: toward green, or toward magenta. (Camera Raw: Tint.)'),
      grading,
      s('Clarity', 'clarity', -1, 1, 0.01, '', 'Contrast in the middle sizes: more for grit, less for a dreamy softness.')),
    section('Detail',
      sharpening, grain,
      s('Grain size', 'grainSize', 1, 4, 0.05, ' px', 'How big the grain\'s clumps are, in pixels of a picture 1974 across: the same in any window.', () => val('grain') > 0 || !!(FILM_LOOKS[val('film')] || {}).grain),
      s('Noise', 'noise', 0, 1, 0.01, '', 'Digital noise: flat grey speckle in every tone, some pixels stuck black or white, as a small sensor pushed hard. (Photoshop: Add Noise.)')),
    section('Optics',
      slider({ label: 'Focal length', min: 14, max: 200, step: 1, unit: ' mm', reset: 31, get: () => 12 / Math.tan(vp.camera.fov / 2), set: v => { vp.camera.fov = 2 * Math.atan(12 / v); },
        help: 'Wide (small numbers) sees more and stretches depth; long (large numbers) flattens it. Step back with the wheel after a longer lens.' }),
      s('Depth of field', 'aperture', 0, 1, 0.01, '', 'What is out of focus blurs, as through a lens wide open. 0: everything sharp. (Photoshop: Lens Blur.)'),
      s('Focus distance', 'focus', 0, 30, 0.05, ' m', 'How far off it focuses, along the camera\'s axis. 0: on whatever is at the middle of the picture.', () => val('aperture') > 0),
      s('Distortion', 'distort', -1, 1, 0.01, '', 'Straight lines bend toward the corners: minus as a long lens does (a pincushion), plus as a wide one (a barrel).'),
      s('Aberration', 'fringe', 0, 8, 0.05, '', 'Chromatic aberration: red and blue focused a little apart, more toward the corners, as in a cheap lens.'),
      s('Vignette', 'vignette', 0, 1.2, 0.01, '', 'Less light toward the corners.'),
      s('Lens flare', 'flare', 0, 1, 0.01, '', 'Bright things throw ghosts across the picture through its middle, and a streak level with them.'),
      diffusionMenu, glow, tiltShift, bandAt));
  root.tiles = tiles;
  root.job = k => ({ post: effectivePost(k === 'none' ? only(P(), MOVED) : { look: k, amount: 1, ...only(P(), MOVED) }), media: effectiveMedia(vp.look.media) });
  const cellsOn = () => val('resolution') < 100;
  root.forMedium = {
    Picture: [
      s('Mosaic', 'resolution', 0, 100, 1, '', 'The picture rebuilt from cells counted across it, the same cells in any window: 100 is the picture\'s own pixels, 0 about 18 cells. (Photoshop: Mosaic.)'),
      when(pick({ label: 'Cell shape', inline: true, help: 'What each cell is drawn as. Print shapes are black ink on paper that grows as the cell darkens.',
        options: CELL_SHAPES.map(c => [c.id, c.label]), titles: Object.fromEntries(CELL_SHAPES.map(c => [c.id, c.says])),
        get: () => val('cellShape'), set: v => { put('cellShape', v); changed(); }, toDefault: () => unset('cellShape'), isDefault: () => !changedByHand('cellShape') }), cellsOn)],
    Levels: [s('Poster edges', 'ink', 0, 1, 0.01, '', 'Dark lines where the picture changes sharply, like a drawing. (Photoshop: Poster Edges.)')],
    Colours: [
      s('Posterize', 'posterize', 0, 12, 1, ' steps', 'A few flat tones (0: off). (Photoshop: Posterize.)'),
      when(pick({ label: 'Dither', inline: true, help: 'Every cell black or white, in a pattern that reads as grey: the look of a receipt.',
        options: DITHERS.map(d => [d.id, d.label]), titles: Object.fromEntries(DITHERS.map(d => [d.id, d.says])),
        get: () => val('dither'), set: v => { put('dither', v); changed(); }, toDefault: () => unset('dither'), isDefault: () => !changedByHand('dither') }), cellsOn)],
    Print: [
      merged('Border', ['border', 'borderWidth', 'keyline'], 0, 100, 1, '', 'A white paper border round the picture, as a darkroom print, never over it: its width, as a share of the picture\'s short side (100 is 14 % of it). 0: none.',
        () => (val('border') ? val('borderWidth') : 0), v => { put('border', v > 0); if (v > 0) put('borderWidth', v); }),
      when(toggle({ label: 'Keyline', help: 'A thin dark rule in the paper, just out from the picture\'s edge.', get: () => !!val('keyline'), set: v => { put('keyline', v); changed(); } }), () => !!val('border'))],
  };
  root.showRows = showRows;
  root.paint = () => {
    if (P()) upgradePost(P());
    const L = lookOf();
    lookLine(lookNote, items, L, LOOKS[L] && LOOKS[L].label);
    toneColour.paint(); glowColour.paint();
    newPattern.classList.toggle('off', !grainy());
    tiles.paint();
    showRows();
    repaintAll(root);
  };
  root.paint();
  return root;
}

const MEDIUM_ROWS = [
  ['Picture', [
    ['res', 'Pixels across', 0, 1024, 1, '', 'The picture is drawn at this many pixels across, then shown large. 0: as it is. A first 3D console was 320, a pocket handheld 160.'],
    ['aspect', 'Screen shape', 0, 2, 0.01, '', 'Height over width of the screen inside the frame: 0.9 a pocket handheld. 0: the whole picture.'],
    ['snap', 'Wobbling shapes', 0, 1, 1, '', 'On: objects\' corners are held to the coarse pixels, as the first 3D consoles held them, so shapes wobble as the camera moves. Needs Pixels across.']]],
  ['Levels', [
    ['gain', 'Brightness', 0, 3, 0.01, '', 'The medium\'s own brightness. (Photoshop: Brightness/Contrast.)'], ['contrast', 'Contrast', 0, 3, 0.01, '', 'The medium\'s own contrast: a copier makes everything harder.'],
    ['gamma', 'Midtones', 0.2, 3, 0.01, '', 'Lightens or darkens the middle tones. (Photoshop: Levels, the middle slider.)'],
    ['invert', 'Invert', 0, 1, 1, '', 'Light and dark turned round. (Photoshop: Invert.)'],
    ['edge', 'Find edges', -1, 2, 0.01, '', 'Edges in the picture stand out: above 0 bright, below 0 dark. (Photoshop: Find Edges.)'],
    ['threshold', 'Threshold', 0, 1, 0.01, '', 'Only black and white: white from this brightness up. 0: off. (Photoshop: Threshold.)'], ['soft', 'How hard', 0, 0.3, 0.005, '', 'How soft that step is.']]],
  ['Colours', [
    ['bits', 'Colour depth', 0, 8, 1, '', 'Bits for each of red, green and blue: 5 is what the first 3D consoles had. 0: off.'],
    ['dither', 'Dither amount', 0, 1, 0.01, '', 'Between two levels of colour depth or of the map, a fixed pattern of pixels of each.'], ['ditherSize', 'Dither size', 1, 8, 1, ' px'],
    ['palette', 'Gradient map', 0, 4, 1, '', 'Every brightness becomes one of these colours, the darkest first. 0: off. (Photoshop: Gradient Map.)'],
    ['smoothPalette', 'Smooth map', 0, 1, 1, '', 'On: a smooth ramp through the colours. Off: only they.'],
    ['c0', 'Map colour 1', 'color'], ['c1', 'Map colour 2', 'color'], ['c2', 'Map colour 3', 'color'], ['c3', 'Map colour 4', 'color']]],
  ['Print', [
    ['inks', 'Inks', 0, 2, 1, '', '1: one ink on paper, by brightness. 2: two inks out of register, grainy.'], ['ink1', 'First ink', 'color'], ['ink2', 'Second ink', 'color'],
    ['misreg', 'Ink offset', 0, 16, 0.1, ' px', 'How far the two inks are out of register.'], ['paper', 'Paper', 'color'], ['paperGrain', 'Paper grain', 0, 1, 0.01],
    ['halftone', 'Halftone', 0, 24, 0.5, ' px', 'A screen of dots this far apart, larger where it is darker. 0: off. (Photoshop: Color Halftone.)'],
    ['angle', 'Screen angle', 0, 90, 1, '°'], ['cmyk', 'CMYK', 0, 1, 1, '', 'Cyan, magenta, yellow and black dots, each at its own angle.'],
    ['hatch', 'Crosshatch', 0, 1, 0.01, '', 'Etched lines: the darker the place, the more sets of them. (Photoshop: Crosshatch.)'], ['carve', 'Carved lines', 0, 1.5, 0.01, '', 'The lines of a woodcut, bending with the wood.']]],
  ['Copier', [
    ['streak', 'Streaks', 0, 1, 0.01, '', 'Lines along the page, from a dirty drum or a scratched glass.'], ['dropout', 'Toner missing', 0, 1, 0.01, '', 'Patches where the ink did not take.'],
    ['speck', 'Specks', 0, 1, 0.01], ['skew', 'Crooked page', -5, 5, 0.05, '°']]],
  ['Screen', [
    ['curve', 'Spherize', 0, 1.5, 0.01, '', 'The curved glass of a tube. (Photoshop: Spherize.)'], ['scan', 'Scan lines', 0, 1, 0.01], ['mask', 'Colour stripes', 0, 1, 0.01, '', 'The red, green and blue stripes of a tube.'],
    ['grid', 'Pixel grid', 0, 1, 0.01, '', 'The gaps between an LCD\'s pixels. Needs Pixels across.'], ['glow', 'Screen glow', 0, 1.5, 0.01, '', 'Light from the screen spreading round bright parts.'],
    ['ghost', 'Slow screen', 0, 0.95, 0.01, '', 'What was shown stays a moment and fades.'], ['vignette', 'Dark edges', 0, 2, 0.01, '', 'The screen or print darker toward its edges.'], ['bezel', 'Frame colour', 'color']]],
  ['Signal', [
    ['tear', 'Torn lines', 0, 1, 0.01, '', 'Bands of the picture slip sideways.'], ['jitter', 'Line wander', 0, 1, 0.01], ['roll', 'Rolling', 0, 1, 0.01, '', 'The picture rolls upward, as when a set loses its hold.'],
    ['blocks', 'Stray blocks', 0, 1, 0.01, '', 'Blocks of the picture out of place, some with their colours swapped.'], ['split', 'Colours apart', 0, 12, 0.1, ' px'],
    ['noise', 'Static', 0, 0.6, 0.005, '', 'Snow over the picture, as on a weak signal.'], ['flicker', 'Flicker', 0, 0.6, 0.005]]],
  ['Radar', [
    ['radar', 'Radar echoes', 0, 1, 1, '', 'What a radar finds, edges and dark places, as steady echoes over the whole picture, read in slices round its middle.'], ['beam', 'Echo colour', 'color']]],
];
function mediumFilters(app, camera) {
  const vp = app.vp;
  const M = () => vp.look.media;
  const E = () => effectiveMedia(M()) || {};
  const val = k => { const e = E(); return e[k] !== undefined ? e[k] : MEDIA_DEFAULTS[k]; };
  const lookOf = () => (M() && M().look) || 'none';
  const lookVal = k => { const L = MEDIA_PRESETS[lookOf()]; return L && L.p[k] !== undefined ? L.p[k] : MEDIA_DEFAULTS[k]; };
  const own = k => !!M() && M()[k] !== undefined;
  const changedByHand = k => own(k) && M()[k] !== lookVal(k);
  const tidy = () => { const m = M(); if (m && !Object.keys(m).some(k => m[k] !== undefined && k !== 'amount')) vp.look.media = null; };
  const put = k => v => { (vp.look.media ||= {})[k] = v; app.markDirty(); paintRows(); };
  const repaintFilters = () => (app.panels && app.panels.filters ? app.panels.filters.paint() : root.paint());
  let all = false;
  const stages = MEDIUM_ROWS.map(([title, list]) => {
    const made = list.map(([k, label, a, b, step, unit, help]) => (a === 'color' ? color({ label, get: () => val(k), set: put(k) })
      : a === 0 && b === 1 && step === 1 ? toggle({ label, help, get: () => !!val(k), set: v => put(k)(v ? 1 : 0) })
      : slider({ label, min: a, max: b, step, unit, help, get: () => val(k), set: put(k),
        toDefault: () => { const m = M(); if (m) delete m[k]; tidy(); app.markDirty(); paintRows(); repaintAll(root); }, isDefault: () => !changedByHand(k) })));
    const joined = camera.forMedium[title] || [];
    const sec = section(title, ...joined, ...made);
    sec.made = made; sec.list = list; sec.joined = joined.length;
    return sec;
  });
  const paintRows = () => {
    for (const s of stages) {
      s.list.forEach(([k], i) => { s.made[i].hidden = !all && !own(k) && val(k) === MEDIA_DEFAULTS[k]; });
      s.hidden = !s.joined && s.made.every(r => r.hidden);
    }
  };
  const items = [{ key: 'none', name: 'None', says: 'No medium: the picture as the camera gives it.' },
    ...MEDIA_LIST.map(m => ({ ...m, tip: [m.says, ...m.also.map(k => `${MEDIA_PRESETS[k].label}: the same rows, other values`)].join('\n') }))];
  const clearMoved = () => { const p = vp.look.post; if (p) { for (const k of MOVED) delete p[k]; if (!Object.values(p).some(v => v !== undefined)) vp.look.post = null; } };
  const choose = v => { vp.look.media = v === 'none' ? null : { look: v, amount: 1 }; clearMoved(); app.markDirty(); repaintFilters(); };
  const tiles = lookTiles({ items, get: lookOf, set: choose });
  const cap = el('p', { class: 'lk-cap' });
  const amount = slider({ label: 'Amount', min: 0, max: 1, step: 0.01, reset: 1, help: 'How much of the medium: 0 the picture as the camera gives it, 1 all of it.',
    get: () => (M() && M().amount !== undefined ? M().amount : 1), set: v => { (vp.look.media ||= {}).amount = v; app.markDirty(); } });
  const reset = () => { const L = lookOf(); vp.look.media = L !== 'none' ? { look: L, amount: (M() && M().amount) ?? 1 } : null; clearMoved(); app.markDirty(); repaintFilters(); };
  const allRow = toggle({ label: 'Show every setting', help: 'Off: what this medium uses. On: every setting of every stage, to add one to it.', get: () => all, set: v => { all = v; paintRows(); } });
  const root = el('div', {},
    section('Medium', tiles, cap, amount, el('div', { class: 'btns' }, button('Reset', reset, { title: 'Takes off everything set by hand on this tab: back to the medium as it comes.' })), allRow),
    ...stages);
  root.tiles = tiles;
  root.job = k => ({ post: effectivePost(without(vp.look.post, MOVED)), media: k === 'none' ? null : effectiveMedia({ look: k, amount: 1 }) });
  root.paint = () => {
    if (M()) upgradeMedia(M());
    const L = lookOf();
    lookLine(cap, items, L, MEDIA_PRESETS[L] && MEDIA_PRESETS[L].label);
    amount.hidden = L === 'none';
    tiles.paint();
    paintRows();
    camera.showRows();
    repaintAll(root);
  };
  root.paint();
  return root;
}
