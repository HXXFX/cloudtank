import { el, slider, numbers, color, choice, toggle, dial, section, button, repaintAll, text, pick, swatches } from './dom.js';
import { icon } from './icons.js';
import { SHAPES } from '../engine/shapes.js';
import { LIGHT_PRESETS, BACKGROUNDS, FINISHES, GROUND_PATTERNS, patternOf, copy } from '../engine/environment.js';
import { DETAIL, gridFor, MAX_SMOKE_CELLS, MAX_LIQUID_CELLS, MAX_PARTICLES, REGION_LIMITS, motionAt } from '../engine/viewport.js';
import { MATERIALS } from '../engine/physics.js';
import { sourceLabel, LIGHT_KINDS } from '../engine/scene.js';
import { hexToRgb, rgbToHex } from '../engine/settings.js';
import { fromAngles } from '../engine/math.js';
import { ASSET_BY_ID, OBJECT_FINISHES, SWATCHES } from '../engine/assets.js';
import { MARK_TYPES, LIVE, COUNTS, motionOn } from '../engine/marks.js';
import { FILTER_PRESETS, POST_DEFAULTS } from '../engine/post.wgsl.js';

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

export function scenePanel(app) {
  const vp = app.vp;
  const root = el('div');
  const list = el('div', { class: 'list', role: 'listbox', 'aria-label': 'In the scene' });
  const count = el('small');
  const props = el('div');
  root.append(section(null, el('h3', {}, 'In the scene', count), list), props);

  let shown = null;
  const paintList = () => {
    const keep = list.scrollTop;
    list.textContent = '';
    const items = vp.scene.items;
    const S = vp.scene;
    count.textContent = `${S.objects.length} objects · ${S.emitters.length} sources` + (S.lights.length ? ` · ${S.lights.length} lights` : '') + (S.marks.length ? ` · ${S.marks.length} marks` : '');
    if (!items.length) list.append(el('div', { class: 'empty' }, 'Empty. Add shapes, objects, sources, lights or marks from the tools on the left.'));
    for (const it of items) {
      const on = it === vp.scene.selected;
      const off = (it.kind === 'emitter' || it.kind === 'light') && it.on === false;
      const row = el('div', { class: 'item' + (on ? ' on' : '') + (off ? ' off' : ''), role: 'option', 'aria-selected': on ? 'true' : 'false' },
        icon(itemIcon(it), 18),
        el('span', { class: 'nm' }, it.name + (off ? ' (off)' : '')),
        el('span', { class: 'sw', style: `background:${swatchOf(it)}` }),
        el('button', { type: 'button', class: 'ib', title: 'Delete', 'aria-label': 'Delete ' + it.name,
          onclick: e => { e.stopPropagation(); app.remove(it); } }, icon('trash', 16)));
      row.addEventListener('click', () => vp.select(it));
      row.addEventListener('dblclick', () => { vp.select(it); vp.frameSelected(); });
      row.addEventListener('contextmenu', e => { e.preventDefault(); app.contextMenu(it, e.clientX, e.clientY); });
      list.append(row);
    }
    list.scrollTop = keep;
    const sel = list.querySelector('.item.on');
    if (vp.scene.selected !== shown && list.isConnected) {
      shown = vp.scene.selected;
      if (sel) {
        const r = sel.getBoundingClientRect(), l = list.getBoundingClientRect();
        if (r.top < l.top) list.scrollTop += r.top - l.top;
        else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
      }
    }
  };

  const paintProps = () => {
    props.textContent = '';
    const it = vp.scene.selected;
    if (!it) {
      props.append(section('Selected', el('p', { class: 'note' }, 'Nothing selected. Click a thing in the view or in the list above.')));
      return;
    }
    const commit = () => app.commit();
    const name = el('input', { class: 'name-in', value: it.name, 'aria-label': 'Name' });
    name.addEventListener('input', () => { it.name = name.value; paintList(); });
    name.addEventListener('change', commit);
    const a = assetOf(it);
    const title = it.kind === 'mark' ? MARK_TYPES[it.type].label : it.kind === 'emitter' ? sourceLabel(it) : it.kind === 'light' ? LIGHT_KINDS[it.type]
      : a ? a.label : it.model ? 'Model' : SHAPES[it.shape].label;
    props.append(section(null, el('h3', {}, title), name));

    if (it.kind === 'mark') props.append(...markSections(app, it, commit));
    else if (it.kind === 'object') props.append(...objectSections(app, it, commit));
    else if (it.kind === 'light') props.append(...lightSections(app, it, commit));
    else props.append(...sourceSections(app, it, commit));

    props.append(el('div', { class: 'btns' },
      button('Duplicate', () => app.duplicate(it), { title: 'Ctrl+D' }),
      it.kind !== 'mark' || it.pos ? button('Focus', () => vp.frameSelected(), { title: 'Bring the camera to it (F)' }) : null,
      app.confirmButton('Delete', () => app.remove(it))));
  };

  root.paint = () => { paintList(); paintProps(); };
  root.paintLight = () => { repaintAll(props); paintList(); };
  root.paintList = paintList;
  root.paint();
  return root;
}

function positionRow(app, it, commit) {
  const moving = () => it.kind === 'object' && motionOn(it.motion) && it.home;
  return numbers({ label: 'Position (m)', keys: ['X', 'Y', 'Z'], step: 0.05, get: i => it.pos[i],
    set: (i, v) => {
      v = i === 1 ? Math.max(0, v) : v;
      if (moving()) it.home.pos[i] += v - it.pos[i];
      it.pos[i] = v;
    }, commit });
}

function objectSections(app, it, commit) {
  const vp = app.vp, out = [];
  const def = SHAPES[it.shape];
  const place = section('Place', positionRow(app, it, commit));
  if (def.sizing === 'radius') {
    place.append(numbers({ label: 'Size (m)', keys: ['R', 'H'], step: 0.05,
      get: i => i === 0 ? it.size[0] : it.size[1] * 2,
      set: (i, v) => { v = Math.max(0.02, v); if (i === 0) { it.size[0] = v; it.size[2] = v; } else it.size[1] = v / 2; }, commit }));
  } else if (def.sizing === 'uniform') {
    place.append(numbers({ label: 'Size (m)', keys: ['⌀'], step: 0.05, get: () => it.size[0] * 2,
      set: (i, v) => { v = Math.max(0.04, v) / 2; it.size = [v, v, v]; }, commit }));
  } else {
    place.append(numbers({ label: 'Size (m)', keys: ['W', 'H', 'D'], step: 0.05, get: i => it.size[i] * 2,
      set: (i, v) => { it.size[i] = Math.max(0.01, v / 2); }, commit }));
  }
  place.append(numbers({ label: 'Rotation (°)', keys: ['Tilt', 'Turn', 'Roll'], step: 1,
    get: i => it.rot[i] * DEG, set: (i, v) => { it.rot[i] = v / DEG; if (it.home && motionOn(it.motion)) it.home.rot[i] = v / DEG - (i === 1 ? (motionAt(it, vp.simTime) || { turn: 0 }).turn : 0); }, commit }));
  place.append(el('div', { class: 'btns' },
    button('Put on the ground', () => { dropToGround(vp, it); if (it.home) it.home.pos[1] = it.pos[1] - ((motionAt(it, vp.simTime) || { off: [0, 0, 0] }).off[1]); app.repaint(); commit(); },
      { title: 'Lower or raise it so its lowest point touches the ground.' })));
  out.push(place);

  const look = section('Look',
    color({ label: 'Colour', get: () => rgbToHex(it.color), set: v => { it.color = hexToRgb(v); app.scenePanelList(); }, commit }),
    choice({ label: 'Finish', options: OBJECT_FINISHES, wrap: true, get: () => it.finish || 'plain',
      set: v => { it.finish = v === 'plain' ? null : v; }, commit,
      titles: { plain: 'As objects have always been drawn', matte: 'No shine: paper, card, plaster', gloss: 'A sharp shine: printed plastic, lacquer',
        metal: 'Grainy metal that takes the colour of what it mirrors', glass: 'See-through, brighter at its edges (it does not bend what is behind it)' } }),
    el('p', { class: 'note' }, 'Ready materials: colour and finish together.'),
    swatches({ items: SWATCHES.map(s => ({ label: s.label, color: s.color, clear: s.finish === 'glass',
      apply: () => { it.color = hexToRgb(s.color); it.finish = s.finish; app.repaint(); } })), commit }));
  out.push(look);
  out.push(motionSection(app, it, commit));
  out.push(physicsSection(app, it, commit));
  out.push(labelButtons(app, it));
  if (it.model && !(assetOf(it) && assetOf(it).mesh)) {
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
  } else if (assetOf(it) && assetOf(it).mesh) {
    const m = vp.scene.models.get(it.model);
    out.push(section('From the library', el('p', { class: 'note' },
      m && m.ready ? 'Made by the app. The fluids flow round it.' : 'Made by the app. Working out its shape for the fluids…')));
  }
  return out;
}

function motionSection(app, it, commit) {
  const vp = app.vp;
  const M = () => (it.motion ||= { travel: 'none', dir: 90, speed: 0.3, distance: 4, spin: 0, bob: 0 });
  const travelRows = el('div');
  const showRows = () => { travelRows.hidden = !it.motion || it.motion.travel === 'none'; };
  const changed = () => {
    if (motionOn(it.motion)) {
      if (it.moves) { it.moves = false; app.panels.scene.paintLight(); }
      const m = motionAt(it, vp.simTime);
      it.home = { pos: it.pos.map((v, k) => v - m.off[k]), rot: [it.rot[0], it.rot[1] - m.turn, it.rot[2]] };
    }
    showRows();
  };
  travelRows.append(
    dial({ label: 'Toward', get: () => M().dir, set: v => { M().dir = v; }, commit }),
    slider({ label: 'Speed', min: 0, max: 3, step: 0.01, unit: ' m/s', get: () => M().speed, set: v => { M().speed = v; }, commit,
      help: '0.3 m/s is a slow walk at full size; a model figure a quarter the size walks at about 0.1.' }),
    slider({ label: 'Distance', min: 0.1, max: 16, step: 0.1, unit: ' m', get: () => M().distance, set: v => { M().distance = v; }, commit,
      help: 'How far it goes before it starts again (or turns back).' }));
  const sec = section('Motion',
    el('p', { class: 'note' }, 'Moves on its own while the simulation plays; the fluids feel it. It starts again with the fluids.'),
    choice({ label: 'Travel', options: [['none', 'Stays'], ['loop', 'Loop'], ['swing', 'There and back']], wrap: true, get: () => (it.motion && it.motion.travel) || 'none',
      set: v => { M().travel = v; changed(); }, commit,
      titles: { none: 'Stays where it was put', loop: 'Goes the distance, then starts again from where it was put', swing: 'Goes the distance and comes back' } }),
    travelRows,
    slider({ label: 'Spin', min: -180, max: 180, step: 1, unit: '°/s', reset: 0, get: () => (it.motion && it.motion.spin) || 0,
      set: v => { M().spin = v; changed(); }, commit, help: 'Turns about up, degrees a second (minus: the other way).' }),
    slider({ label: 'Bob', min: 0, max: 10, step: 0.5, unit: ' cm', reset: 0, get: () => ((it.motion && it.motion.bob) || 0) * 100,
      set: v => { M().bob = v / 100; changed(); }, commit, help: 'A walker\'s bounce.' }));
  showRows();
  return sec;
}

function labelButtons(app, it) {
  return section('Marks',
    el('p', { class: 'note' }, 'Live data and drawn elements over the view. More in the Marks tool on the left.'),
    el('div', { class: 'btns' },
      button('Label it', () => app.addMark('label', { target: it.id, text: it.kind === 'emitter' ? '{name}' : '{name}\n{height}' }),
        { title: 'A label on it that follows it, with its name and height (change the text to show other live numbers).' }),
      button('Link from it…', () => app.startLink(it), { title: 'A line from it to another thing: click the other thing next.' })));
}

function attachedNote(app, it) {
  const o = it.attach && app.vp.scene.objects.find(x => x.id === it.attach.to);
  return o ? el('p', { class: 'note' }, `Part of ${o.name}: it moves, turns, is copied and deleted with it. Move it to change where it sits on it.`) : null;
}

function sinkSections(app, it, commit) {
  const water = it.type === 'liquid';
  return [section('Place', positionRow(app, it, commit), attachedNote(app, it)),
    section(water ? 'Drain' : 'Extractor',
      el('p', { class: 'note' }, water ? 'Water that reaches the dark ball is taken away, and the water round it flows toward it.'
        : 'Smoke that reaches the dark ball is taken away, and the air round it is drawn toward it, as into a kitchen hood.'),
      toggle({ label: 'On', get: () => it.on !== false, set: v => { it.on = v; }, commit }),
      slider({ label: 'Strength', min: 0, max: 4, step: 0.05, reset: 1, get: () => it.rate, set: v => { it.rate = v; }, commit,
        help: water ? 'How hard it pulls the water in. At 1, one of the Drain tool\'s size takes about what a liquid source pours, some 30 litres a second.'
          : 'How hard it draws the air in. At 1, the air beside one of the Extractor tool\'s size moves in at about 0.3 m/s.' }),
      slider({ label: 'Size', min: 0.05, max: 1, step: 0.01, unit: ' m', get: () => it.radius, set: v => { it.radius = v; }, commit,
        help: 'Radius of the ball it takes in through: bigger takes in more.' })),
    timerSection(app, it, commit),
    labelButtons(app, it)];
}

function timerSection(app, it, commit) {
  const P = () => (it.pulse ||= { on: 3, off: 3, delay: 0 });
  return section('Timer',
    el('p', { class: 'note' }, 'Switches itself on and off as the simulation plays, starting again with the fluids. Group sources by giving them the same times.'),
    toggle({ label: 'On a timer', get: () => !!(it.pulse && it.pulse.on > 0 && it.pulse.off > 0), set: v => { if (v) { P(); if (!(it.pulse.on > 0)) it.pulse.on = 3; if (!(it.pulse.off > 0)) it.pulse.off = 3; } else it.pulse = null; app.repaint(); }, commit }),
    slider({ label: 'On for', min: 0.1, max: 20, step: 0.1, unit: ' s', get: () => (it.pulse && it.pulse.on) || 3, set: v => { P().on = v; }, commit }),
    slider({ label: 'Off for', min: 0.1, max: 20, step: 0.1, unit: ' s', get: () => (it.pulse && it.pulse.off) || 3, set: v => { P().off = v; }, commit }),
    slider({ label: 'Starts after', min: 0, max: 20, step: 0.1, unit: ' s', get: () => (it.pulse && it.pulse.delay) || 0, set: v => { P().delay = v; }, commit }));
}

function sourceSections(app, it, commit) {
  if (it.sink) return sinkSections(app, it, commit);
  const out = [section('Place', positionRow(app, it, commit), attachedNote(app, it))];
  const src = section('Source',
    toggle({ label: 'On', get: () => it.on !== false, set: v => { it.on = v; }, commit }),
    color({ label: 'Colour', get: () => rgbToHex(it.color), set: v => { it.color = hexToRgb(v); app.scenePanelList(); }, commit }),
    slider({ label: 'Amount', min: 0, max: 3, step: 0.05, reset: 1, get: () => it.rate, set: v => { it.rate = v; }, commit,
      help: it.type === 'smoke' ? 'How much smoke it puts out.' : 'How much liquid it sprays.' }),
    slider({ label: 'Size', min: 0.03, max: 1, step: 0.01, unit: ' m', get: () => it.radius, set: v => { it.radius = v; }, commit,
      help: it.type === 'smoke' ? 'Radius of the ball the smoke comes out of.' : 'Radius of the nozzle.' }),
    slider({ label: 'Speed', min: 0, max: it.type === 'smoke' ? 4 : 8, step: 0.1, unit: ' m/s', get: () => it.speed, set: v => { it.speed = v; }, commit,
      help: 'How fast it comes out.' }));
  if (it.type === 'smoke') {
    src.append(slider({ label: 'Heat', min: 0, max: 3, step: 0.05, reset: 1, get: () => it.heat ?? 1, set: v => { it.heat = v; }, commit,
      help: 'Hot smoke rises faster; 0 is a cold mist that sinks. Houdini: Temperature.' }));
  }
  const aim = () => { const d = it.dir; return { az: (Math.atan2(d[0], d[2]) * DEG + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, d[1] / Math.hypot(...d)))) * DEG }; };
  out.push(src, section('Direction',
    dial({ label: 'Compass', get: () => aim().az, set: v => { it.dir = fromAngles(v, aim().el); }, commit }),
    slider({ label: 'Up or down', min: -90, max: 90, step: 1, unit: '°', get: () => aim().el, set: v => { it.dir = fromAngles(aim().az, v); }, commit,
      help: '90 points straight up, -90 straight down.' })),
  timerSection(app, it, commit),
  labelButtons(app, it));
  return out;
}

function lightSections(app, it, commit) {
  const area = it.type === 'area', spot = it.type === 'spot', point = it.type === 'point';
  const out = [section('Place', positionRow(app, it, commit))];
  const lamp = section('Light',
    toggle({ label: 'On', get: () => it.on !== false, set: v => { it.on = v; app.scenePanelList(); }, commit }),
    color({ label: 'Colour', get: () => rgbToHex(it.color), set: v => { it.color = hexToRgb(v); app.scenePanelList(); }, commit }),
    slider({ label: 'Strength', min: 0, max: 40, step: 0.1, reset: area ? 6 : point ? 3 : 12, get: () => it.power, set: v => { it.power = v; }, commit,
      help: 'At 1, it lights a white wall a metre in front of it to mid-grey; twice as far, a quarter as bright.' }));
  if (area) {
    lamp.append(slider({ label: 'Width', min: 0.04, max: 6, step: 0.01, unit: ' m', get: () => it.radius * 2, set: v => { it.radius = v / 2; }, commit,
      help: 'A bigger panel gives softer light and softer shadows.' }),
    slider({ label: 'Height', min: 0.04, max: 6, step: 0.01, unit: ' m', get: () => it.radius * 2 * (it.aspect ?? 0.6), set: v => { it.aspect = v / (it.radius * 2); }, commit }));
  } else {
    lamp.append(slider({ label: 'Size', min: 0.01, max: 1, step: 0.005, unit: ' m', get: () => it.radius, set: v => { it.radius = v; }, commit,
      help: point ? 'Radius of the bulb: a bigger one gives softer shadows.' : 'Radius of the lamp: a bigger one gives softer shadows.' }));
  }
  if (spot) {
    lamp.append(slider({ label: 'Beam', min: 2, max: 170, step: 1, unit: '°', get: () => it.angle ?? 40, set: v => { it.angle = v; }, commit,
      help: 'How wide the cone of light is, edge to edge.' }),
    slider({ label: 'Soft edge', min: 0, max: 1, step: 0.01, get: () => it.soft ?? 0.3, set: v => { it.soft = v; }, commit,
      help: 'How much of the beam fades out toward its edge: 0 a sharp circle, 1 a fade from the middle.' }));
  }
  lamp.append(toggle({ label: 'Casts shadows', get: () => it.shadows !== false, set: v => { it.shadows = v; }, commit }),
    toggle({ label: 'Show the light', get: () => it.show !== false, set: v => { it.show = v; }, commit,
      help: 'Draw the lamp itself in the picture. Off, it still lights the scene.' }));
  out.push(lamp);
  if (!point) {
    const aim = () => { const d = it.dir; return { az: (Math.atan2(d[0], d[2]) * DEG + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, d[1] / Math.hypot(...d)))) * DEG }; };
    out.push(section('Direction',
      dial({ label: 'Compass', get: () => aim().az, set: v => { it.dir = fromAngles(v, aim().el); }, commit }),
      slider({ label: 'Up or down', min: -90, max: 90, step: 1, unit: '°', get: () => aim().el, set: v => { it.dir = fromAngles(aim().az, v); }, commit,
        help: '-90 shines straight down, 90 straight up.' })));
  }
  out.push(labelButtons(app, it));
  return out;
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
  const set = k => v => vp.set(k, v);
  const live = el('p', { class: 'note' });
  const region = regionSection(app);
  const root = el('div', {},
    region,
    section('Display',
      toggle({ label: 'Show the simulation box', get: () => vp.display.box, set: v => { vp.display.box = v; } }),
      toggle({ label: 'Show sources', get: () => vp.display.sources, set: v => { vp.display.sources = v; } }),
      toggle({ label: 'Show marks', get: () => vp.display.marks, set: v => { vp.display.marks = v; } }),
      el('div', { class: 'btns' }, button('Empty the fluids', () => vp.resetFluids(), { title: 'Removes all smoke and liquid; keeps everything else.' }))),
    section('Time',
      slider({ label: 'Speed', min: 0.1, max: 2, step: 0.05, reset: 1, get: () => S().speed, set: set('speed'), help: 'How fast time runs. Houdini: Time scale.' })),
    section('Smoke',
      slider({ label: 'Density', min: 0, max: 3, step: 0.05, reset: 1, get: () => S().smokeAmount, set: set('smokeAmount'), help: 'How much smoke every source puts out. Houdini: Density · Blender: Flow density.' }),
      slider({ label: 'Thickness', min: 1, max: 40, step: 0.5, reset: 10, get: () => S().smokeOpacity, set: set('smokeOpacity'), help: 'How much light the smoke blocks: haze or dense smoke. Houdini: Density scale.' }),
      slider({ label: 'Rise', min: 0, max: 8, step: 0.1, reset: 2.5, get: () => S().rise, set: set('rise'), help: 'How strongly hot smoke rises. Houdini: Buoyancy lift · Blender: Heat.' }),
      slider({ label: 'Swirl', min: 0, max: 3, step: 0.05, reset: 1, get: () => S().swirl, set: set('swirl'), help: 'How many small curls the smoke keeps. Houdini: Confinement · Blender: Vorticity.' }),
      slider({ label: 'Fade', min: 0, max: 1.5, step: 0.01, reset: 0.12, get: () => S().fade, set: set('fade'), help: 'How quickly smoke thins away. Houdini: Dissipation · Blender: Dissolve.' })),
    section('Liquid',
      slider({ label: 'Flow', min: 0, max: 3, step: 0.05, reset: 1, get: () => S().flow, set: set('flow'), help: 'How much every liquid source sprays.' }),
      slider({ label: 'Splash', min: 0, max: 0.99, step: 0.01, reset: 0.95, get: () => S().splash, set: set('splash'), help: 'Lively and splashy (high) or calm and thick (low). Houdini and Blender: FLIP ratio.' }),
      slider({ label: 'Clarity', min: 0, max: 1, step: 0.01, reset: 0.85, get: () => S().clarity, set: set('clarity'), help: 'Clear like water (high) or solid like paint (low).' }),
      choice({ label: 'Look', fit: true, options: [['smooth', 'Smooth'], ['surface', 'Surface'], ['dots', 'Particles']],
        titles: { smooth: 'One smooth surface made from all the particles', surface: 'The particles drawn as balls and smoothed together (the look before November 2026)', dots: 'Each particle as a small ball' },
        get: () => S().look, set: set('look') }),
      live));
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


function physicsSection(app, it, commit) {
  const vp = app.vp;
  const weight = el('p', { class: 'note' });
  const paintWeight = () => {
    const m = vp.physics.massOf(it), mat = MATERIALS[it.material] || MATERIALS.wood;
    const floats = mat.density < 1000 ? 'floats in water' : 'sinks in water';
    weight.textContent = m ? `${mat.label}: ${m.mass < 10 ? m.mass.toFixed(2) : fmtN(m.mass)} kg, ${(m.volume * 1000).toFixed(m.volume < 0.01 ? 2 : 0)} litres; ${floats}.` : '';
  };
  weight.paint = paintWeight;
  const sec = section('Physics',
    toggle({ label: 'Has weight: falls, can be pushed', get: () => !!it.moves,
      set: v => {
        it.moves = v;
        if (v && motionOn(it.motion)) { it.motion.travel = 'none'; it.motion.spin = 0; it.motion.bob = 0; app.repaint(); }
        it.home = { pos: [...it.pos], rot: [...it.rot] };
      }, commit,
      help: 'On: it falls, stacks, tumbles, and water and wind push it. Off: it stays where it is put (or follows its motion).' }),
    toggle({ label: 'Collision', get: () => it.collides !== false, set: v => { it.collides = v; }, commit,
      help: 'Off: other objects, smoke and liquid all pass through it. (A moving object still lands on the ground.)' }),
    choice({ label: 'Material', options: Object.entries(MATERIALS).map(([k, m]) => [k, m.label]), wrap: true,
      get: () => it.material || 'wood', set: v => { it.material = v; setTimeout(paintWeight, 50); }, commit,
      titles: Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, `${m.density} kg per cubic metre; grip ${m.friction}, bounce ${m.bounce}`])) }),
    weight,
    el('div', { class: 'btns' },
      button('Put back', () => { if (it.home) { it.pos = [...it.home.pos]; it.rot = [...it.home.rot]; app.repaint(); } },
        { title: 'Back to where it was put, still.' })));
  setTimeout(paintWeight, 50);
  return sec;
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
      lines));
  root.paint = () => { paintColours(); paintPattern(); repaintAll(root); };
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
  const band = () => (P() && P().band) || null;
  const setBand = (k, v) => { const b = ensure().band ||= { center: 0.56, half: 0.13, blur: 5 }; b[k] = v; ensure().preset = 'custom'; presetRow.paint(); };
  const presetRow = choice({ options: Object.entries(FILTER_PRESETS).map(([k, f]) => [k, f.label]), wrap: true,
    get: () => (P() && P().preset) || 'none',
    set: v => { vp.look.post = v === 'none' ? null : { ...copy(FILTER_PRESETS[v].p), preset: v }; app.markDirty(); root.paint(); },
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
    section('Start from', presetRow,
      el('p', { class: 'note' }, 'Filters work on the finished picture, like a photo editor\'s. They are saved with the scene. Marks stay sharp over them.')),
    section('Colour',
      s('Saturation', 'saturation', 0, 2, 0.01, '', '0 is black and white.'),
      s('Contrast', 'contrast', 0.5, 2, 0.01),
      s('Lift darks', 'lift', 0, 0.5, 0.01, '', 'Raises the darks toward white, like faded paper.'),
      color({ label: 'Tint', get: () => val('tint'), set: put('tint') }),
      s('Tint amount', 'tintAmount', 0, 1, 0.01, '', 'Pulls every colour toward the tint. With saturation at 0: a picture in one colour.'),
      s('Posterize', 'posterize', 0, 12, 1, ' steps', 'A few flat tones (0: off).')),
    section('Film',
      s('Grain', 'grain', 0, 0.3, 0.005),
      s('Scan lines', 'scan', 0, 0.5, 0.01),
      s('Vignette', 'vignette', 0, 1.2, 0.01, '', 'Darker corners.')),
    section('Lens',
      s('Soften', 'soften', 0, 4, 0.1, ' px'),
      s('Colour split', 'split', 0, 8, 0.1, ' px', 'Red and blue pulled sideways, like a worn tape or a cheap lens.'),
      s('Glow', 'glow', 0, 1, 0.01, '', 'Bright parts spread a soft light round them.'),
      s('Glow from', 'glowFrom', 0.2, 1, 0.01, '', 'How bright a part must be to glow.'),
      s('Ink lines', 'ink', 0, 1, 0.01, '', 'Dark lines where the picture changes sharply, like a drawing.')),
    section('Miniature',
      toggle({ label: 'Sharp band, soft above and below', get: () => !!band(), set: v => { ensure().band = v ? { center: 0.56, half: 0.13, blur: 5 } : null; ensure().preset = 'custom'; presetRow.paint(); bandRows.hidden = !v; repaintAll(bandRows); } }),
      bandRows),
    el('div', { class: 'btns' }, button('No filters', () => { vp.look.post = null; root.paint(); })));
  root.paint = () => { bandRows.hidden = !band(); repaintAll(root); };
  root.paint();
  return root;
}
