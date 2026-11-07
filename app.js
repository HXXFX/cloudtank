import { Viewport, motionAt } from './engine/viewport.js';
import { cardName } from './engine/gpu.js';
import { SHAPES } from './engine/shapes.js';
import { readModelFiles, looksFromFile } from './engine/importers.js';
import { imageMenu } from './ui/imagedrop.js';
import { isImageFile } from './engine/images.js';
import { lookData } from './engine/material.js';
import { hexToRgb } from './engine/settings.js';
import { MOVES_BY_DEFAULT } from './engine/physics.js';
import { MAX_OBJECTS, MAX_EMITTERS, MAX_MARKS, MAX_LIGHTS, LIGHT_KINDS, optionsOf } from './engine/scene.js';
import { ATLAS_SLOTS } from './engine/sdf.wgsl.js';
import { ASSETS, ASSET_GROUPS, ASSET_BY_ID } from './engine/assets.js';
import { MARK_TYPES, MARK_ORDER, makeMark, motionOn } from './engine/marks.js';
import { el, toggle } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { TABS, scenePanel, fluidsPanel, windPanel, lightPanel, worldPanel, filtersPanel, dropToGround } from './ui/panels.js';
import { History } from './history.js';
import { openScene, downloadScene, autosaveWrite, autosaveRead, autosaveClear, setImage, averageColours, FILE_EXT } from './store.js';
import { startScene, START_CAMERA } from './start-scene.js';
import { Glass } from './glass.js';
import { Liquid, MATERIALS } from './liquid.js';
import * as LookTune from './look-tune.js';
import { NAME, lockup } from './logo.js';

const $ = id => document.getElementById(id);
const fmtN = n => Math.round(n).toLocaleString('en-US');
const app = { tab: 'scene', tool: 'move', axes: 'world', dirty: false, panels: {} };
window.fluidApp = app;


const PARAMS = new URLSearchParams('');
const THEMES = ['dark', 'light', 'scene', 'system'];
app.themeMode = THEMES.includes(PARAMS.get('theme')) ? PARAMS.get('theme') : 'scene';
app.glassMaterial = MATERIALS[PARAMS.get('glass')] ? PARAMS.get('glass') : 'clear';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const pageKind = kind => { document.documentElement.dataset.theme = kind; if (app.tune) app.tune.apply(); };
pageKind(app.themeMode === 'dark' || (app.themeMode === 'system' && systemDark.matches) ? 'dark' : 'light');
app.setTheme = mode => {
  app.themeMode = mode;
  const kind = mode === 'system' ? (systemDark.matches ? 'dark' : 'light') : mode;
  if (kind !== 'scene') pageKind(kind);
  if (app.glass) app.glass.setMode(kind);
};
systemDark.addEventListener('change', () => { if (app.themeMode === 'system') app.setTheme('system'); });

async function boot() {
  const sceneParam = PARAMS.get('scene');
  app.noSave = !!sceneParam;
  const saved = sceneParam === 'start' ? startScene() : sceneParam ? await fetch(sceneParam).then(r => r.json()) : (await autosaveRead()) || startScene();
  const vp = new Viewport($('view'), {
    overlay: $('gizmo'),
    rightDrag: 'pan',
    region: saved.region,
    fineness: saved.fineness,
    area: saved.region ? undefined : saved.area,
    detail: saved.region ? undefined : saved.detail,
    look: saved.look,
    camera: { ...START_CAMERA },
  });
  app.vp = vp;
  vp.display.box = false;
  try {
    await vp.init();
    try { await openScene(vp, saved); }
    catch (e) { console.error(e); await openScene(vp, startScene()); toast('The last scene could not be opened, so a new one was started: ' + e.message, true); }
  } catch (e) {
    $('loading-err').textContent = 'The app could not start: ' + e.message;
    console.error(e);
    return;
  }
  await vp.whenModelsReady();
  vp.resetFluids();
  app.history = new History(vp, paintTop);
  buildTop();
  buildTools();
  buildPanel();
  buildInfo();
  wire();
  app.history.reset();
  app.glass = new Glass(vp, [...document.querySelectorAll('.glass')], { kind: document.documentElement.dataset.theme, onKind: pageKind });
  app.liquid = new Liquid([...document.querySelectorAll('.glass')]);
  app.setGlass = m => { app.glassMaterial = MATERIALS[m] ? m : 'frosted'; app.liquid.set(app.glassMaterial); app.glass.setMaterial(app.glassMaterial); if (app.tune) app.tune.apply(); };
  app.setGlass(app.glassMaterial);
  app.tune = { apply: () => LookTune.apply(app, app.lookTune || LookTune.tuned()), set: T => LookTune.apply(app, T), module: LookTune };
  app.tune.apply();
  app.setTheme(app.themeMode);
  let t = performance.now();
  for (let i = 0; i < 120; i++) vp.frame(t += 1000 / 60);
  await vp.gpu.device.queue.onSubmittedWorkDone();
  vp.lastNow = 0;
  $('loading').classList.add('gone');
  setTimeout(() => $('loading').remove(), 500);
  if (localStorage.getItem('fluidsim.hint') === 'seen') $('hint').classList.add('gone');
  requestAnimationFrame(loop);
  setInterval(tick, 500);
  setInterval(() => { if (app.dirty) save(); }, 2000);
}

function loop(t) {
  app.vp.frame(t);
  paintCompass();
  requestAnimationFrame(loop);
}

function tick() {
  paintStatus();
  if (app.panels.fluids) app.panels.fluids.tick();
  const sel = app.vp.scene.selected;
  if (app.tab === 'scene' && sel && sel.kind === 'object' && sel.moves) app.panels.scene.paintLight();
  if (app.tab === 'scene' && app.waitingBake && app.vp.scene.selected) {
    const m = app.vp.scene.selected.model && app.vp.scene.models.get(app.vp.scene.selected.model);
    if (m && m.ready) { app.waitingBake = false; app.panels.scene.paint(); }
  }
}

async function save() {
  app.dirty = false;
  if (app.noSave) return;
  try { await autosaveWrite(app.vp); app.savedAt = new Date(); }
  catch (e) { console.error(e); app.saveError = e.message; }
}

app.commit = () => {
  for (const sel of app.vp.movers()) {
    if (sel.kind !== 'object') continue;
    const m = motionOn(sel.motion) ? motionAt(sel, app.vp.simTime) : null;
    sel.home = m ? { pos: sel.pos.map((v, k) => v - m.off[k]), rot: [sel.rot[0], sel.rot[1] - m.turn, sel.rot[2]] }
      : { pos: [...sel.pos], rot: [...sel.rot] };
  }
  growBox();
  app.history.commit();
  app.dirty = true;
};

function growBox() {
  const H = app.history, vp = app.vp, S = vp.scene;
  if (!H || !H.stack[H.at]) return;
  const prev = JSON.parse(H.stack[H.at]);
  const was = new Map([...prev.objects, ...prev.emitters].map(d => [d.id, d]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), movers = vp.movers();
  const touched = [...S.objects, ...S.emitters].filter(it => {
    const d = was.get(it.id);
    if (!d) return true;
    return movers.includes(it) && (!same(d.pos, it.pos) || (it.kind === 'object' ? !same(d.size, it.size) || !same(d.rot, it.rot) : d.radius !== it.radius));
  });
  const R = touched.length ? vp.boxToTake(touched) : null;
  if (!R) return;
  const names = [...new Set(touched.filter(it => !(it.kind === 'emitter' && it.attach)).map(it => it.name))];
  app.setSimulation({ region: { size: R.size, center: R.center }, keep: true });
  toast(R.clipped ? `The simulation box is at its largest (16 m a side), so part of ${names.join(', ')} is still outside it.`
    : `The simulation box grew to ${R.size.map(v => v.toFixed(1)).join(' × ')} m to take in ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}.`, R.clipped);
}
app.markDirty = () => { app.dirty = true; };
app.scenePanelList = () => { if (app.panels.scene && app.tab === 'scene') app.panels.scene.paintList(); };


function buildTop() {
  const vp = app.vp, top = $('top');
  const brand = lockup('a', { href: './', title: NAME });
  const ib = (name, title, onclick, id) => el('button', { type: 'button', class: 'ib', title, 'aria-label': title, onclick, id }, icon(name));
  app.playBtn = ib('pause', 'Pause (Space)', () => togglePlay());
  const speed = el('select', { 'aria-label': 'Speed', title: 'How fast time runs' },
    ...[0.25, 0.5, 1, 1.5, 2].map(v => el('option', { value: v, selected: vp.settings.speed === v }, `${v}×`)));
  speed.addEventListener('change', () => { vp.set('speed', +speed.value); app.markDirty(); repaintPanel(); });
  app.speedSelect = speed;
  app.timer = el('span', { class: 'timer', title: 'Simulated time' }, '0.0 s');
  const view = el('select', { 'aria-label': 'View', title: 'Look from' },
    el('option', { value: '' }, 'View…'), ...['perspective', 'front', 'side', 'back', 'top'].map(v => el('option', { value: v }, v[0].toUpperCase() + v.slice(1))));
  view.addEventListener('change', () => { vp.view(view.value); view.value = ''; });
  app.undoBtn = ib('undo', 'Undo (Ctrl+Z)', () => undo());
  app.redoBtn = ib('redo', 'Redo (Ctrl+Shift+Z)', () => redo());
  app.undoBtn.dataset.label = 'Undo'; app.redoBtn.dataset.label = 'Redo';
  const tb = (name, text, title, onclick) => el('button', { type: 'button', class: 'tb', title, onclick }, icon(name, 18), el('span', { class: 'tx' }, text));
  const newBtn = app.confirmButton('New', () => newScene(), { cls: 'tb', title: 'Start a new scene (the current one is replaced)' });
  app.infoBtn = el('button', { type: 'button', class: 'ib info-btn', title: 'About this app, what does the work, shortcuts', 'aria-label': 'Information',
    onclick: () => toggleInfo() }, icon('info'), el('span', { class: 'dot' }));
  const speedBox = el('div', { class: 'speed' }, el('span', {}, 'Speed'), speed);
  const undoGroup = el('div', { class: 'group' }, app.undoBtn, app.redoBtn);
  const fileGroup = el('div', { class: 'group' }, newBtn, tb('open', 'Open', 'Open a scene file (Ctrl+O)', () => $('scene-file').click()),
    tb('save', 'Save', 'Save the scene as a file (Ctrl+S). It is also kept in this browser automatically.', () => saveFile()));
  app.showBtn = tb('eye', 'Show', 'What the view draws: the simulation box, sources, marks, smoke, liquid', () => toggleShow());
  app.showBtn.setAttribute('aria-haspopup', 'menu');
  $('show').replaceChildren(...[['box', 'Simulation box'], ['sources', 'Sources'], ['marks', 'Marks'], ['smoke', 'Smoke'], ['liquid', 'Liquid']]
    .map(([k, label]) => toggle({ label, get: () => vp.display[k], set: v => { vp.display[k] = v; } })));
  const focus = ib('focus', 'Bring the camera to the selection (F)', () => vp.frameSelected());
  focus.dataset.label = 'Bring the camera to the selection';
  app.cleanBtn = ib('clean', 'Clean scene: hide all the panels (G)', () => setClean(true));
  app.cleanBtn.dataset.label = 'Clean scene';
  app.moreBtn = ib('more', 'More', () => toggleMore());
  app.moreBtn.setAttribute('aria-haspopup', 'menu');
  const sepUndo = el('span', { class: 'sep' }), sepFile = el('span', { class: 'sep' });
  top.append(brand, el('span', { class: 'sep' }),
    el('div', { class: 'group' }, app.playBtn, ib('step', 'One step (when paused)', () => { vp.stepOnce = true; }),
      ib('restart', 'Start again: empty the fluids and put moving objects back where they were put', () => { vp.resetFluids(); vp.putBack(); })),
    speedBox, app.timer,
    el('span', { class: 'spacer' }),
    undoGroup, sepUndo, fileGroup, sepFile, app.showBtn, view, focus, app.cleanBtn, app.moreBtn,
    el('span', { class: 'sep' }), app.infoBtn);
  const order = new Map([speedBox, app.timer, undoGroup, fileGroup, app.showBtn, view, focus, app.cleanBtn].map((e, i) => [e, i]));
  app.overflow = [[[app.cleanBtn], []], [[focus], []], [[view], []], [[app.showBtn], []], [[app.timer], []], [[fileGroup], [sepFile]], [[undoGroup], [sepUndo]], [[speedBox], []]]
    .map(([els, hide]) => ({ els: els.map(e => { const m = document.createComment('top'); e.before(m); return { e, m }; }), hide }));
  app.overflowOrder = e => order.get(e);
  const exit = el('button', { type: 'button', class: 'ib clean-exit', title: 'Bring the panels back (G)', 'aria-label': 'Bring the panels back', onclick: () => setClean(false) }, icon('clean'));
  document.body.append(exit);
  let asleep = 0;
  addEventListener('pointermove', () => {
    if (!app.clean) return;
    exit.classList.add('awake');
    clearTimeout(asleep);
    asleep = setTimeout(() => exit.classList.remove('awake'), 1800);
  });
  paintTop();
  fitTop();
  document.fonts.ready.then(fitTop);
  new ResizeObserver(() => fitTop()).observe(top);
  app.fitTop = fitTop;
}

function fitTop() {
  const top = $('top'), menu = $('more');
  const fits = () => {
    const r = top.getBoundingClientRect(), last = top.lastElementChild.getBoundingClientRect();
    return last.right <= r.right - parseFloat(getComputedStyle(top).paddingRight) + 0.5;
  };
  top.classList.remove('compact', 'tiny');
  app.moreBtn.hidden = true;
  for (const s of app.overflow) { for (const { e, m } of s.els) m.after(e); for (const h of s.hide) h.hidden = false; }
  if (!fits()) {
    top.classList.add('compact');
    if (!fits()) {
      app.moreBtn.hidden = false;
      for (const s of app.overflow) {
        menu.append(...s.els.map(x => x.e));
        menu.append(...[...menu.children].sort((a, b) => app.overflowOrder(a) - app.overflowOrder(b)));
        for (const h of s.hide) h.hidden = true;
        if (fits()) break;
      }
      if (!fits()) top.classList.add('tiny');
    }
  }
  if (app.moreBtn.hidden) toggleMore(false);
  else if (!menu.hidden) placeMore();
}

function placeMore() {
  const b = app.moreBtn.getBoundingClientRect(), menu = $('more');
  menu.style.top = `${b.bottom + 10}px`;
  menu.style.right = `${Math.max(8, innerWidth - b.right)}px`;
}

function toggleShow(open = $('show').hidden) {
  const menu = $('show');
  menu.hidden = !open;
  app.showBtn.classList.toggle('on', open);
  if (!open) return;
  for (const r of menu.children) if (r.paint) r.paint();
  const from = app.showBtn.offsetParent ? app.showBtn : app.moreBtn, b = from.getBoundingClientRect();
  menu.style.top = `${b.bottom + 10}px`;
  menu.style.right = `${Math.max(8, innerWidth - b.right)}px`;
}

function toggleMore(open = $('more').hidden) {
  const menu = $('more');
  menu.hidden = !open;
  app.moreBtn.classList.toggle('on', open);
  app.moreBtn.setAttribute('aria-expanded', open);
  if (open) placeMore();
}

function paintTop() {
  if (!app.undoBtn) return;
  app.undoBtn.disabled = !app.history.canUndo;
  app.redoBtn.disabled = !app.history.canRedo;
  const playing = app.vp.playing;
  app.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
  app.playBtn.title = playing ? 'Pause (Space)' : 'Play (Space)';
  app.playBtn.classList.toggle('play-start', !playing);
  app.playBtn.classList.toggle('play-stop', playing);
}

function setClean(on) {
  const vp = app.vp;
  if (app.clean === on) return;
  app.clean = on;
  vp.clean = on;
  document.body.classList.toggle('clean', on);
  if (!on) return;
  vp.cancelDrag();
  if (vp.placing) cancelPlacing();
  $('flyout').hidden = true; $('info').hidden = true; $('ctx').hidden = true; toggleMore(false); toggleShow(false);
  toast('Clean scene. G or Esc brings the panels back.');
}
app.setClean = setClean;

function togglePlay() { app.vp.playing = !app.vp.playing; paintTop(); paintStatus(); }

app.confirmButton = (text, action, { cls = 'btn danger', title } = {}) => {
  const b = el('button', { type: 'button', class: cls, title });
  const label = el('span', { class: 'tx' }, text);
  if (cls === 'tb') b.append(icon('plus', 18));
  b.append(label);
  let armed = null;
  b.addEventListener('click', () => {
    if (armed) { clearTimeout(armed); armed = null; b.classList.remove('confirm'); label.textContent = text; action(); return; }
    b.classList.add('confirm');
    label.textContent = 'Sure? Click again';
    armed = setTimeout(() => { armed = null; b.classList.remove('confirm'); label.textContent = text; }, 3000);
  });
  return b;
};


const ADD_SHAPES = ['box', 'ball', 'column', 'cone', 'ring', 'ramp', 'arch', 'stairs', 'wall', 'slab'];
const FLYOUTS = new Set(['shapes', 'objects', 'marks', 'smoke', 'liquid', 'lights']);

function buildTools() {
  const tools = $('tools');
  const tool = (name, label, title, onclick, iconName = name) => {
    const b = el('button', { type: 'button', class: 'tool', title, 'aria-label': label, onclick }, icon(iconName, 22), el('span', {}, label));
    b.dataset.tool = name;
    return b;
  };
  app.tool_ = tool;
  app.toolButtons = [
    tool('move', 'Move', 'Move: arrows and squares on the selected thing (W)', () => setTool('move')),
    tool('turn', 'Turn', 'Turn: rings on the selected thing (E)', () => setTool('turn')),
    tool('size', 'Size', 'Size: handles with square ends on the selected thing (R)', () => setTool('size')),
    app.axesButton = tool('world', 'World', '', () => { app.axes = app.axes === 'world' ? 'object' : 'world'; app.vp.setAxes(app.axes); paintTools(); }),
    el('hr'),
    tool('stir', 'Stir', 'Drag through the fluid to push it', () => setTool('stir')),
    el('hr'),
    tool('shapes', 'Shapes', 'Add a shape', e => { e.stopPropagation(); toggleFlyout('shapes'); }),
    tool('objects', 'Objects', 'Add a ready-made object: figures, studio pieces, table-top things, model pieces, fluid kits', e => { e.stopPropagation(); toggleFlyout('objects'); }),
    tool('smoke', 'Smoke', 'Smoke: drag this into the view for a smoke source, or click for a source or an extractor', e => { e.stopPropagation(); toggleFlyout('smoke'); }),
    tool('liquid', 'Liquid', 'Liquid: drag this into the view for a liquid source, or click for a source or a drain', e => { e.stopPropagation(); toggleFlyout('liquid'); }),
    tool('lights', 'Lights', 'Lights you place: an area light, a point light or a spot light', e => { e.stopPropagation(); toggleFlyout('lights'); }, 'light'),
    tool('marks', 'Marks', 'Add live data and drawn elements: labels, timers, counters, a data panel, tracking boxes, lines, grids', e => { e.stopPropagation(); toggleFlyout('marks'); }),
    el('hr'),
    tool('model', 'Model', 'Import your own 3D model: GLB/glTF, FBX, USDZ, OBJ or STL (or drop a file on the window)', () => $('model-file').click()),
  ];
  tools.append(...app.toolButtons);
  for (const [k, label] of [['smoke', 'Smoke source'], ['liquid', 'Liquid source']]) draggable(app.toolButtons.find(b => b.dataset && b.dataset.tool === k), k, label, k);
  document.addEventListener('click', e => { if (app.justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
  paintTools();
}

function fillFlyout(kind) {
  const fly = $('flyout'), tool = app.tool_;
  fly.replaceChildren();
  fly.dataset.kind = kind;
  const close = () => { fly.hidden = true; };
  const dragTool = (name, label, title, kind) => {
    const b = tool(name, label, title, () => { close(); startPlacing(kind); });
    draggable(b, kind, label, name);
    return b;
  };
  if (kind === 'shapes') {
    fly.append(el('h4', {}, 'Add a shape: drag it into the view, or pick one and click'),
      ...ADD_SHAPES.map(s => dragTool(s, SHAPES[s].label, `Add a ${SHAPES[s].label.toLowerCase()}: drag it to where it goes`, s)));
  } else if (kind === 'objects') {
    fly.append(el('h4', {}, 'Add an object: drag it into the view, or pick one and click'));
    for (const g of ASSET_GROUPS) {
      fly.append(el('h5', {}, g));
      for (const a of ASSETS.filter(x => x.group === g)) {
        const kit = a.sources ? ` It comes with ${a.sources.length > 1 ? a.sources.length + ' sources' : 'a source'}.` : '';
        const b = dragTool(a.icon, a.label, `${a.label}.${kit} Drag it to where it goes.`, 'asset:' + a.id);
        b.classList.add('pic');
        b.prepend(el('img', { class: 'thumb', src: `thumbs/${a.id}.jpg`, alt: '', draggable: 'false' }));
        fly.append(b);
      }
    }
  } else if (kind === 'smoke' || kind === 'liquid') {
    const smoke = kind === 'smoke';
    fly.append(el('h4', {}, smoke ? 'Add smoke, or take it out' : 'Add liquid, or take it out'),
      dragTool(kind, smoke ? 'Smoke source' : 'Liquid source', smoke ? 'Puts out smoke: drag it to where it goes' : 'Pours liquid: drag it to where it goes', kind),
      smoke ? dragTool('extractor', 'Extractor', 'Takes smoke out: draws the air round it in, like a kitchen hood. Drag it to where it goes', 'extractor')
        : dragTool('drain', 'Drain', 'Takes water out: the water round it flows in and is gone, like a plug hole. Drag it to where it goes', 'drain'));
  } else if (kind === 'lights') {
    fly.append(el('h4', {}, 'Add a light: drag it into the view, or pick one and click'),
      dragTool('lightArea', 'Area light', 'A glowing panel: broad, soft light and soft shadows, like a softbox or a window. Drag it to where it goes', 'light:area'),
      dragTool('lightPoint', 'Point light', 'A bulb: light all round, fading with distance. Drag it to where it goes', 'light:point'),
      dragTool('lightSpot', 'Spot light', 'A beam in a cone, like a stage light. Drag it to where it goes', 'light:spot'));
  } else {
    fly.append(el('h4', {}, 'Add a mark: live data and drawn elements over the view'));
    for (const t of MARK_ORDER) {
      const T = MARK_TYPES[t];
      fly.append(tool(T.icon, T.label, MARK_HELP[t], () => { close(); addMarkFromTool(t); }));
    }
  }
}

const MARK_HELP = {
  text: 'Text on the picture: a caption, a title (it can show live numbers)',
  timer: 'The simulated time: a time code, seconds or minutes',
  counter: 'A number that counts: frames, seconds, particles, objects, or its own',
  readout: 'A panel of live numbers: time, frame, speed, card time, wind…',
  legend: 'Every source, its colour, and whether it is on',
  label: 'A label on a thing (click it) or at a point (click the ground)',
  tracker: 'A numbered box round every matching object, following it',
  link: 'A line from one thing to another: click the first, then the second',
  grid: 'A wire grid standing in the scene: click the ground to place it',
  outline: 'A box\'s edges, dashed, round part of the scene: click the ground to place it',
};

function toggleFlyout(kind) {
  const fly = $('flyout'), btn = app.toolButtons.find(b => b.dataset && b.dataset.tool === kind);
  const same = !fly.hidden && fly.dataset.kind === kind;
  if (same) { fly.hidden = true; return; }
  fillFlyout(kind);
  fly.hidden = false;
  const r = btn.getBoundingClientRect();
  fly.style.left = `${r.right + 12}px`;
  const bar = document.querySelector('.top'), under = bar ? bar.getBoundingClientRect().bottom + 8 : 8, foot = 56;
  fly.style.maxHeight = `${Math.max(120, window.innerHeight - under - foot)}px`;
  fly.style.top = '0px';
  const h = fly.getBoundingClientRect().height;
  fly.style.top = `${Math.max(under, Math.min(r.top - 6, window.innerHeight - h - foot))}px`;
}


app.addMark = (type, opts = {}) => {
  const vp = app.vp, S = vp.scene;
  const same = S.marks.filter(m => m.type === type).length;
  const T = MARK_TYPES[type];
  const extra = T.screen ? { y: Math.min(0.9, T.defaults.y + same * 0.05) } : {};
  const m = S.addMark(makeMark(type, { ...extra, ...opts }));
  if (!m) { toast(`A scene can hold ${MAX_MARKS} marks; delete one first.`, true); return null; }
  vp.select(m);
  vp.emit('change');
  app.commit();
  showTab('scene');
  return m;
};

function addMarkFromTool(type) {
  const vp = app.vp, sel = vp.scene.selected;
  const thing = sel && sel.kind !== 'mark' ? sel : null;
  if (MARK_TYPES[type].screen || type === 'tracker') { app.addMark(type); return; }
  if (type === 'label' && thing) { app.addMark('label', { target: thing.id }); return; }
  if (type === 'link') { if (thing) app.startLink(thing); else startPicking('link-from'); return; }
  startPicking(type);
}

app.startLink = from => {
  app.linkFrom = from;
  startPicking('link-to');
};

function startPicking(what) {
  const vp = app.vp;
  if (app.tool === 'stir') setTool('move');
  vp.placing = (p, item, point) => {
    if (what === 'link-from') {
      if (!item) { toast('Click a thing to start the line from. Esc cancels.'); setTimeout(() => startPicking('link-from'), 0); return null; }
      setTimeout(() => app.startLink(item), 0);
      return null;
    }
    if (what === 'link-to') {
      if (!item || item === app.linkFrom) { toast('Click another thing to end the line on. Esc cancels.'); setTimeout(() => startPicking('link-to'), 0); return null; }
      const from = app.linkFrom;
      app.linkFrom = null;
      return app.vp.scene.addMark(makeMark('link', { from: from.id, to: item.id }));
    }
    if (what === 'label') {
      return item ? vp.scene.addMark(makeMark('label', { target: item.id }))
        : vp.scene.addMark(makeMark('label', { pos: [p[0], 1, p[2]], text: 'Label' }));
    }
    if (what === 'grid') return vp.scene.addMark(makeMark('grid', { pos: [p[0], 1, p[2]] }));
    if (what === 'outline') return vp.scene.addMark(makeMark('outline', { pos: [p[0], 0.5, p[2]] }));
    return null;
  };
  app.placingKind = 'marks';
  document.body.classList.add('placing');
  toast({ 'link-from': 'Click the thing the line starts from. Esc cancels.', 'link-to': 'Click the thing the line goes to. Esc cancels.',
    label: 'Click a thing to label it, or the ground for a label on its own. Esc cancels.',
    grid: 'Click the ground where the wire grid stands. Esc cancels.', outline: 'Click the ground where the outline goes. Esc cancels.' }[what]);
  paintTools();
}

function setTool(t) {
  app.tool = t;
  app.vp.setTool(t);
  cancelPlacing();
  document.body.classList.toggle('stirring', t === 'stir');
  paintTools();
}

function paintTools() {
  for (const b of app.toolButtons) if (b.dataset) b.classList.toggle('on', b.dataset.tool === app.tool || b.dataset.tool === app.placingKind);
  const w = app.axes === 'world', A = app.axesButton;
  A.replaceChildren(icon(w ? 'world' : 'box', 22), el('span', {}, w ? 'World' : 'Object'));
  A.title = (w ? "Handles follow the world: up is up. Click for the object's own axes." : "Handles follow the object's own axes. Click for the world's.") +
    " Sizing always uses the object's own.";
  A.setAttribute('aria-label', w ? 'Axes: world' : 'Axes: object');
}

const SOURCE_KINDS = new Set(['smoke', 'liquid', 'drain', 'extractor']);

function placerFor(kind) {
  const vp = app.vp, S = vp.settings;
  const asset = kind.startsWith('asset:') ? ASSET_BY_ID[kind.slice(6)] : null;
  const place = p => {
    let made;
    if (kind === 'smoke') made = vp.scene.addEmitter({ type: 'smoke', pos: [p[0], p[1] + 0.22, p[2]], radius: 0.24, color: hexToRgb(S.smokeColor), dir: [0, 1, 0], speed: 0.6 });
    else if (kind === 'liquid') made = vp.scene.addEmitter({ type: 'liquid', pos: [p[0], Math.max(1.4, p[1] + 0.6), p[2]], radius: 0.08, color: hexToRgb(S.liquidColor), dir: [0, -1, 0], speed: 1.5 });
    else if (kind === 'drain') made = vp.scene.addEmitter({ type: 'liquid', sink: true, pos: [p[0], p[1] + 0.03, p[2]], radius: 0.15, rate: 1, dir: [0, 1, 0], speed: 0, color: [0.2, 0.21, 0.23] });
    else if (kind === 'extractor') made = vp.scene.addEmitter({ type: 'smoke', sink: true, pos: [p[0], p[1] + 0.6, p[2]], radius: 0.3, rate: 1, dir: [0, 1, 0], speed: 0, color: [0.2, 0.21, 0.23] });
    else if (kind === 'light:area') made = vp.scene.addLight({ type: 'area', pos: [p[0], p[1] + 1.5, p[2]], dir: [0, -1, 0], radius: 0.4, aspect: 0.6, power: 6 });
    else if (kind === 'light:point') made = vp.scene.addLight({ type: 'point', pos: [p[0], p[1] + 1.0, p[2]], radius: 0.05, power: 3 });
    else if (kind === 'light:spot') made = vp.scene.addLight({ type: 'spot', pos: [p[0], p[1] + 2.0, p[2]], dir: [0, -1, 0], radius: 0.06, angle: 40, soft: 0.3, power: 12 });
    else if (asset) {
      let r = null;
      try { r = vp.addAsset(asset.id, p, { on: p[1] }); }
      catch (e) {
        vp.dropUnusedModels(app.history.modelsInUse());
        try { r = vp.addAsset(asset.id, p, { on: p[1] }); } catch (e2) { toast(e2.message, true); return null; }
      }
      made = r && r.object;
      if (r && r.waiting) toast(`${asset.label} added, but a scene holds ${MAX_EMITTERS} sources and they are all in use: it will start working when you delete one.`, true);
    } else {
      made = vp.scene.addObject({ shape: kind, pos: [p[0], 0, p[2]], color: hexToRgb(S.objectColor),
        moves: MOVES_BY_DEFAULT.has(kind), material: kind === 'ball' ? 'rubber' : 'wood' });
      if (made) { vp.dropToGround(made, p[1]); made.home = { pos: [...made.pos], rot: [...made.rot] }; }
    }
    if (!made) toast(SOURCE_KINDS.has(kind) ? `A scene can hold ${MAX_EMITTERS} sources, drains and extractors; delete one first.`
      : kind.startsWith('light:') ? `A scene can hold ${MAX_LIGHTS} lights; delete one first.` : `A scene can hold ${MAX_OBJECTS} objects; delete one first.`, true);
    return made;
  };
  place.lift = asset ? asset.lift || 0 : kind === 'extractor' ? 0.6 : 0;
  return place;
}

function readyToAdd(kind) {
  if (app.tool === 'stir') app.tool = 'move';
  app.vp.setTool(app.tool);
  document.body.classList.remove('stirring');
  app.placingKind = kind === 'smoke' || kind === 'extractor' ? 'smoke' : kind === 'liquid' || kind === 'drain' ? 'liquid'
    : kind.startsWith('asset:') ? 'objects' : kind.startsWith('light:') ? 'lights' : 'shapes';
}

function startPlacing(kind) {
  const vp = app.vp, asset = kind.startsWith('asset:') ? ASSET_BY_ID[kind.slice(6)] : null;
  readyToAdd(kind);
  vp.placing = placerFor(kind);
  document.body.classList.add('placing');
  const what = SOURCE_KINDS.has(kind) ? { smoke: 'smoke source', liquid: 'liquid source', drain: 'drain', extractor: 'extractor' }[kind]
    : asset ? asset.label.toLowerCase() : kind.startsWith('light:') ? LIGHT_KINDS[kind.slice(6)].toLowerCase() : SHAPES[kind].label.toLowerCase();
  toast(`Click where the ${what} goes (or drag its icon into the view next time). Esc cancels.`);
  paintTools();
}

function draggable(b, kind, label, iconName) {
  b.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const vp = app.vp, x0 = e.clientX, y0 = e.clientY;
    let ghost = null;
    const inView = ev => document.elementFromPoint(ev.clientX, ev.clientY) === vp.canvas;
    const at = ev => { const r = vp.canvas.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]; };
    const move = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        cancelPlacing();
        $('flyout').hidden = true;
        ghost = el('div', { class: 'ghost' }, icon(iconName, 20), el('span', {}, label));
        document.body.append(ghost);
        document.body.classList.add('dragging-in');
        readyToAdd(kind);
        paintTools();
      }
      ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
      vp.dropPreview = inView(ev) ? vp.landingAt(...at(ev), placerFor(kind).lift) : null;
    };
    const end = (ev, drop) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', esc, true);
      if (!ghost) return;
      ghost.remove();
      document.body.classList.remove('dragging-in');
      vp.dropPreview = null;
      app.justDragged = true;
      setTimeout(() => { app.justDragged = false; }, 0);
      if (drop && inView(ev)) vp.placeWith(placerFor(kind), ...at(ev));
      else { app.placingKind = null; paintTools(); }
    };
    const up = ev => end(ev, true);
    const cancel = ev => end(ev, false);
    const esc = ev => { if (ev.key === 'Escape' && ghost) { ev.stopPropagation(); end(ev, false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', esc, true);
  });
}

function cancelPlacing() {
  app.vp.placing = null;
  app.placingKind = null;
  document.body.classList.remove('placing');
  hideToast();
  paintTools();
}


function buildPanel() {
  const tabs = $('tabs');
  for (const [key, label] of TABS) {
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': key === app.tab ? 'true' : 'false' }, label);
    b.dataset.tab = key;
    b.addEventListener('click', () => showTab(key));
    tabs.append(b);
  }
  app.panels = {
    scene: scenePanel(app), fluids: fluidsPanel(app), wind: windPanel(app), light: lightPanel(app), world: worldPanel(app), filters: filtersPanel(app),
  };
  $('body').addEventListener('input', app.markDirty);
  $('body').addEventListener('click', app.markDirty);
  showTab(app.tab);
}

function showTab(key) {
  app.tab = key;
  if (app.showDecalHandles && app.panels) setTimeout(app.showDecalHandles);
  for (const b of $('tabs').children) {
    b.classList.toggle('on', b.dataset.tab === key);
    b.setAttribute('aria-selected', b.dataset.tab === key ? 'true' : 'false');
  }
  app.vp.boxHandles = key === 'fluids';
  const body = $('body');
  body.replaceChildren(app.panels[key]);
  app.panels[key].paint();
  body.scrollTop = 0;
}

function repaintPanel() { const p = app.panels[app.tab]; if (p) p.paint(); }
app.repaint = repaintPanel;


function contextMenu(item, x, y) {
  const menu = $('ctx'), vp = app.vp;
  if (!item) { menu.hidden = true; return; }
  const group = vp.selectedItems(), many = group.length > 1 && (group.includes(item) || vp.movers().includes(item));
  if (!many && vp.scene.selected !== item) vp.select(item);
  const items = many ? group : [item], n = many ? ' ' + items.length : '';
  const row = (name, text, key, action) => el('button', { type: 'button', class: 'tb', role: 'menuitem',
    onclick: () => { menu.hidden = true; action(); } }, icon(name, 18), el('span', { class: 'tx' }, text), el('span', { class: 'k' }, key));
  const allHidden = items.every(hiddenOf);
  menu.replaceChildren(
    row('copy', 'Duplicate' + n, 'Ctrl D', () => app.duplicateAll(items)),
    ...(!many && (item.kind !== 'mark' || item.pos) ? [row('focus', 'Focus', 'F', () => vp.frameSelected())] : []),
    row(allHidden ? 'eye' : 'eyeOff', (allHidden ? 'Show' : 'Hide') + n, 'H', () => app.toggleHidden(items)),
    ...(items.some(i => i.kind === 'object') ? [row('move', 'Put on the ground' + n, 'End', () => app.groundAll(items))] : []),
    row('objects', 'Select all like this', '', () => app.selectLike(item)),
    row('trash', 'Delete' + n, 'Del', () => app.removeAll(items)));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x + 2, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y + 2, innerHeight - r.height - 8))}px`;
}
app.contextMenu = contextMenu;


const hiddenOf = it => it.kind === 'light' ? it.show === false : !!it.hidden;
app.toggleHidden = items => {
  const hide = !items.every(hiddenOf);
  for (const it of items) { if (it.kind === 'light') it.show = !hide; else if (hide) it.hidden = true; else delete it.hidden; }
  app.vp.emit('change');
  app.commit();
};
app.groundAll = items => {
  for (const it of items) {
    const o = app.vp.kitOf(it) || it;
    if (o.kind !== 'object') continue;
    const y = o.pos[1];
    app.vp.dropToGround(o);
    if (o.home) o.home.pos[1] += o.pos[1] - y;
  }
  app.vp.emit('change');
  app.commit();
};
app.selectLike = it => {
  const S = app.vp.scene, sort = x => x.kind === 'object' ? (x.asset || x.model || x.shape) : x.kind === 'emitter' ? `${x.type}|${!!x.sink}` : `${x.kind}|${x.type}`;
  app.vp.selectAll(S.items.filter(x => x.kind === it.kind && sort(x) === sort(it)));
};
app.remove = item => app.removeAll([item]);
app.removeAll = items => {
  const vp = app.vp;
  for (const it of items) vp.scene.remove(it);
  vp.selectAll(vp.scene.picks);
  vp.emit('change');
  app.commit();
};

app.duplicate = item => app.duplicateAll([item]);
app.duplicateAll = items => {
  const vp = app.vp, done = [], copies = [];
  for (const it of items) {
    const item = vp.kitOf(it) || it;
    if (done.includes(item)) continue;
    done.push(item);
    const c = copyOf(item);
    if (!c) break;
    copies.push(c);
  }
  if (!copies.length) return;
  vp.selectAll(copies);
  vp.emit('change');
  app.commit();
};
function copyOf(item) {
  const vp = app.vp;
  let copy;
  const off = [0.4, 0, 0.4];
  if (item.kind === 'object') {
    copy = vp.scene.addObject({ shape: item.shape, pos: item.pos.map((v, k) => v + off[k]), size: [...item.size], rot: [...item.rot],
      color: [...item.color], model: item.model, name: item.name + ' copy',
      moves: item.moves, collides: item.collides, material: item.material, finish: item.finish, motion: item.motion, asset: item.asset,
      whenInBox: item.whenInBox, home: item.home ? { pos: item.home.pos.map((v, k) => v + off[k]), rot: [...item.home.rot] } : null, ...optionsOf(item), ...lookData(item),
      ...(item.partLooks ? { partLooks: item.partLooks.map(p => ({ color: [...p.color], finish: p.finish || null, ...lookData(p) })) } : {}) });
  } else if (item.kind === 'emitter') {
    copy = vp.scene.addEmitter({ type: item.type, pos: item.pos.map((v, k) => v + off[k]), radius: item.radius, color: [...item.color],
      dir: [...item.dir], speed: item.speed, rate: item.rate, on: item.on, heat: item.heat ?? 1, pulse: item.pulse, name: item.name + ' copy',
      sink: !!item.sink, attach: item.attach ? { to: item.attach.to } : null });
  } else if (item.kind === 'light') {
    const { id, kind, name, ...rest } = JSON.parse(JSON.stringify(item));
    copy = vp.scene.addLight({ ...rest, pos: item.pos.map((v, k) => v + off[k]), name: item.name + ' copy' });
  } else {
    const { id, held, ...rest } = item;
    const d = JSON.parse(JSON.stringify(rest));
    d.name = item.name + ' copy';
    if (MARK_TYPES[item.type].screen) d.y = Math.min(0.95, d.y + 0.05);
    else if (d.pos) d.pos = d.pos.map((v, k) => v + off[k]);
    copy = vp.scene.addMark(d);
  }
  if (!copy) { toast(`The scene is full: ${MAX_OBJECTS} objects, ${MAX_EMITTERS} sources, ${MAX_LIGHTS} lights and ${MAX_MARKS} marks at most.`, true); return null; }
  if (item.kind === 'object') {
    const parts = vp.scene.emitters.filter(e => e.attach && e.attach.to === item.id);
    let left = 0;
    for (const e of parts) {
      const c = vp.scene.addEmitter({ type: e.type, pos: e.pos.map((v, k) => v + off[k]), radius: e.radius, color: [...e.color], dir: [...e.dir],
        speed: e.speed, rate: e.rate, on: e.on, heat: e.heat ?? 1, pulse: e.pulse, sink: !!e.sink, attach: { to: copy.id, part: e.attach.part }, name: e.name + ' copy' });
      if (!c) left++;
    }
    if (left) toast(`Copied without ${left > 1 ? left + ' of its parts' : 'one of its parts'}: a scene holds ${MAX_EMITTERS} sources.`, true);
  }
  return copy;
}

app.setSimulation = async opts => {
  await app.vp.setSimulation(opts);
  app.markDirty();
  repaintPanel();
};

function undo() { app.history.undo(); repaintPanel(); app.markDirty(); }
function redo() { app.history.redo(); repaintPanel(); app.markDirty(); }

async function newScene() {
  await openScene(app.vp, startScene());
  app.history.reset();
  app.speedSelect.value = String(app.vp.settings.speed);
  await autosaveClear();
  app.dirty = true;
  for (const p of Object.values(app.panels)) p.paint();
  toast('New scene.');
}

function saveFile() {
  const bytes = downloadScene(app.vp, 'scene');
  toast(`Saved scene.${FILE_EXT} (${(bytes / 1e6).toFixed(bytes > 1e6 ? 1 : 2)} MB) to your downloads.`);
}

async function openFile(file) {
  try {
    const data = JSON.parse(await file.text());
    toast('Opening ' + file.name + '…');
    await openScene(app.vp, data);
    app.history.reset();
    for (const p of Object.values(app.panels)) p.paint();
    app.speedSelect.value = String(app.vp.settings.speed);
    app.dirty = true;
    toast('Opened ' + file.name + '.');
  } catch (e) { console.error(e); toast('Could not open it: ' + e.message, true); }
}

async function importModel(files) {
  const vp = app.vp;
  try {
    toast('Reading the model…');
    const parsed = await readModelFiles(files);
    let id;
    try { id = vp.addModel(parsed); }
    catch (e) {
      vp.dropUnusedModels(app.history.modelsInUse());
      id = vp.addModel(parsed);
    }
    const m = vp.scene.models.get(id);
    const size = m.prop.map(p => p * 0.5);
    const t = vp.camera.target;
    const looks = await looksFromFile(parsed, (blob, name) => vp.addImage(blob, name));
    const several = looks.length > 1;
    const own = !several && looks[0] ? looks[0] : {};
    const o = vp.scene.addObject({ shape: 'model', model: id, name: parsed.name, pos: [t[0], 0, t[2]], size,
      rot: parsed.zUp ? [-Math.PI / 2, 0, 0] : [0, 0, 0], color: own.color || parsed.color || hexToRgb('#c9c4bb'),
      finish: own.finish || null, pbr: own.pbr, tex: own.tex, partLooks: several ? looks : null });
    if (!o) { toast('The scene is full: 64 objects at most.', true); return; }
    dropToGround(vp, o);
    vp.select(o);
    vp.emit('change');
    app.commit();
    showTab('scene');
    app.waitingBake = true;
    const notes = parsed.notes && parsed.notes.length ? ' ' + parsed.notes.join(' ') : '';
    toast(`Added ${parsed.name}: ${fmtN(parsed.triangles)} triangles${several ? `, ${looks.length} parts` : ''}, 1 m across.${notes} Working out its shape for the fluids…`, !!notes);
    m.whenReady.then(() => { toast(`${parsed.name} is ready: the fluids now flow round it.`); app.panels.scene.paint(); });
  } catch (e) { console.error(e); toast('Could not import it: ' + e.message, true); }
}

app.pickImage = () => $('image-file').click();
app.useBackground = file => { useImage(file); };
app.keepImages = () => { app.vp.imagesKeep = () => app.history.imagesInUse(); };
app.toast = (t, bad) => toast(t, bad);
app.showTab = k => showTab(k);
app.repaintAllPanels = () => { for (const p of Object.values(app.panels)) p.paint(); };
app.showDecalHandles = () => {
  const vp = app.vp, S = vp.scene;
  let edit = null;
  const pickOn = (look, owner) => { const d = look && look.decals && look.decals[look.decalPick ?? -1]; if (d) edit = { owner, decal: d }; };
  if (app.tab === 'world') pickOn(vp.look.ground, null);
  else if (S.selected && S.selected.kind === 'object' && vp.selectedItems().length === 1) {
    const o = S.selected;
    if (o.partLooks) for (const p of o.partLooks) pickOn(p, o); else pickOn(o, o);
  }
  vp.decalEdit = edit;
  app.decalOwner = edit ? edit.owner : null;
};
app.smallMenu = (x, y, items) => {
  const menu = $('ctx');
  menu.replaceChildren(...items.map(([name, text, action]) => el('button', { type: 'button', class: 'tb', role: 'menuitem',
    onclick: () => { menu.hidden = true; action(); } }, icon(name, 18), el('span', { class: 'tx' }, text))));
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x + 2, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y + 2, innerHeight - r.height - 8))}px`;
};

app.applyImageColours = () => {
  const vp = app.vp;
  if (!vp.bgImageBitmap) return;
  const c = averageColours(vp.bgImageBitmap);
  vp.look.background.top = c.top;
  vp.look.background.bottom = c.bottom;
};

async function useImage(file) {
  const vp = app.vp;
  try {
    const bitmap = await setImage(vp, file, file.name);
    vp.bgImageBitmap = bitmap;
    vp.look.background = { ...vp.look.background, preset: 'image' };
    app.applyImageColours();
    app.markDirty();
    repaintPanel();
  } catch (e) { toast('Could not use that picture: ' + e.message, true); }
}


function paintStatus() {
  const vp = app.vp, s = vp.stats;
  const parts = [];
  if (!vp.playing) parts.push(el('span', { class: 'warn' }, 'Paused'));
  parts.push(el('span', {}, `${s.fps.toFixed(0)} `, el('span', { class: 'k' }, 'frames/s')));
  if (s.simMs) parts.push(el('span', {}, el('span', { class: 'k' }, 'card '), `${(s.simMs + s.drawMs).toFixed(1)} ms`));
  if (vp.flip) parts.push(el('span', {}, `${fmtN(vp.flip.remaining)} `, el('span', { class: 'k' }, 'particles')));
  const baking = [...vp.scene.models.values()].filter(m => !m.ready).length;
  if (baking) parts.push(el('span', { class: 'warn' }, `Working out ${baking} model shape${baking > 1 ? 's' : ''}…`));
  $('status').replaceChildren(...parts);
  app.timer.textContent = `${vp.simTime.toFixed(1)} s`;
  const dot = app.infoBtn.querySelector('.dot');
  dot.classList.toggle('warn', s.fps > 0 && s.fps < 40);
  if (!$('info').hidden) paintInfo();
}

function paintCompass() {
  const vp = app.vp, W = vp.look.wind, svg = $('compass');
  svg.toggleAttribute('hidden', !W.on);
  if (!W.on) return;
  const yaw = vp.camera.yaw;
  const north = (180 - yaw * 180 / Math.PI);
  const w = vp.windNow, speed = Math.hypot(w[0], w[2]);
  const windAz = Math.atan2(w[0], w[2]) * 180 / Math.PI;
  const rot = north + windAz;
  svg.innerHTML = `<circle r="34" class="ring"/>
    ${Math.abs(((north % 360) + 360) % 360 - 180) < 32 ? '' : `<g transform="rotate(${north})"><text y="-25" class="n">N</text></g>`}
    <g transform="rotate(${rot})"><path class="arrow" d="M0 -22 L7 -6 L2 -8 L2 18 L-2 18 L-2 -8 L-7 -6 Z"/></g>
    <text y="31" class="spd">${speed.toFixed(1)} m/s</text>`;
}

function buildInfo() {
  $('info').append(el('div'));
}

function paintInfo() {
  const vp = app.vp, s = vp.stats, info = vp.gpu.info;
  const D = vp.smoke ? `${fmtN(vp.smoke.cellCount)} smoke cells (${vp.smoke.dims.join(' × ')})` : 'no smoke grid';
  const L = vp.flip ? `${fmtN(vp.flip.remaining)} of ${fmtN(vp.flip.maxParticles)} liquid particles on a ${vp.flip.dims.join(' × ')} grid` : 'no liquid';
  const box = $('info');
  box.replaceChildren(
    el('button', { type: 'button', class: 'ib x', title: 'Close', 'aria-label': 'Close', onclick: () => toggleInfo() }, '✕'),
    el('h2', {}, lockup('span', { 'aria-label': NAME })),
    el('p', {}, 'Smoke and liquid simulated live on your graphics card, in the browser. Made for Chrome or Edge on a computer.'),
    el('h3', {}, 'What does the work'),
    el('table', {},
      el('tr', {}, el('td', {}, 'Graphics card'), el('td', {}, cardName(info) + ' (as the browser reports it)')),
      el('tr', {}, el('td', {}, 'Card time per frame'), el('td', {}, s.simMs ? `${s.simMs.toFixed(1)} ms simulating, ${s.drawMs.toFixed(1)} ms drawing` : 'not measured by this browser')),
      el('tr', {}, el('td', {}, 'Frames per second'), el('td', {}, s.fps.toFixed(0) + (s.fps < 40 && s.fps > 0 ? '. A coarser Fineness (Fluids tab) helps if this stays low.' : ''))),
      el('tr', {}, el('td', {}, 'Smoke'), el('td', {}, D + '. Method: Houdini Pyro / Blender smoke')),
      el('tr', {}, el('td', {}, 'Liquid'), el('td', {}, L + '. Method: FLIP, as Houdini and Blender')),
      el('tr', {}, el('td', {}, 'Processor'), el('td', {}, `prepares each frame and runs the physics (${vp.physics.stats.bodies} objects, ${vp.physics.stats.awake} moving, ${vp.physics.stats.ms.toFixed(1)} ms last frame); model shapes are worked out on a separate thread`))),
    el('p', { class: 'note' }, 'A laptop card slows its clock when lightly loaded, so card times read higher at an easy 60 frames a second than when it is busy.'),
    el('h3', {}, 'Mouse and keys'),
    el('table', {},
      ...[['Drag empty space', 'turn the view'], ['Click a thing', 'select it: its handles appear'],
        ['Drag a handle', 'move, turn or size it; hold Ctrl for steps of 10 cm, 15° or a tenth'],
        [el('span', {}, el('kbd', {}, 'W'), ' ', el('kbd', {}, 'E'), ' ', el('kbd', {}, 'R')), 'move, turn or size handles'],
        ['Drag a thing', 'slide it along the ground; let go to throw it'], ['Shift-drag a thing', 'lift or lower it'],
        ['Drag a mark', 'move it on the screen (a label: move its text)'],
        ['Right-drag (or middle-drag)', 'slide the view'], ['Right-click a thing', 'its menu: duplicate, focus, delete'],
        ['Wheel', 'closer or further'], ['Drag with the Stir tool', 'stir the fluid'],
        [el('span', {}, el('kbd', {}, 'Space')), 'pause or play'], [el('span', {}, el('kbd', {}, 'Delete')), 'delete the selection'],
        [el('span', {}, el('kbd', {}, 'Ctrl'), ' ', el('kbd', {}, 'D')), 'duplicate'], [el('span', {}, el('kbd', {}, 'Ctrl'), ' ', el('kbd', {}, 'Z')), 'undo'],
        [el('span', {}, el('kbd', {}, 'Ctrl'), ' ', el('kbd', {}, 'Y')), 'redo (or Ctrl Shift Z)'],
        [el('span', {}, el('kbd', {}, 'F')), 'bring the camera to the selection'], [el('span', {}, el('kbd', {}, 'Esc')), 'cancel a handle drag or placing'],
        [el('span', {}, el('kbd', {}, 'G')), 'clean scene: hide all the panels; G or Esc brings them back'],
        [el('span', {}, el('kbd', {}, 'Ctrl'), ' ', el('kbd', {}, 'S')), 'save the scene as a file'], [el('span', {}, el('kbd', {}, 'Ctrl'), ' ', el('kbd', {}, 'O')), 'open a scene file']]
        .map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', {}, b)))),
    el('h3', {}, 'The start scene'),
    el('p', {}, 'The app opens on a clear basin turned over on a dark floor: two soft colours of smoke rise under it, two pours land on it and spread across the floor to a drain, with one area light and a film look. It opens empty and fills in about 20 seconds. New brings it back.'),
    el('h3', {}, 'Colour and the look of water'),
    el('p', {}, 'Each source has its own colour (Scene tab, with the source selected). Colours mix as dye does: water colours spread where the water is stirred, so yellow and blue make green, and smoke tints what is behind it and its shadow. The Fluids tab sets how the liquid is drawn: Smooth (one surface made from all the particles), Surface (the particles drawn as balls, smoothed together) or Particles.'),
    el('h3', {}, 'Wind and rain'),
    el('p', {}, 'The Wind tab: wind carries the smoke, ripples and pushes the water, blows spray and slants the rain, with gusts and small swirls; its arrow shows in the corner of the view. Rain falls across the view and makes shiny ground ripple; it adds no water.'),
    el('h3', {}, 'Simulation box'),
    el('p', {}, 'Smoke and liquid live in a box standing on the ground. With the Fluids tab open, the box shows round handles on its sides and top: drag one to move that side, or the square on the floor to slide the box. The smoke and water stay, and a side moved in pushes the water. The tab also sets its size, where it stands, and how fine the fluids are (smaller cells look finer and cost more card time); a typed number takes effect on Enter. Esc while dragging puts the box back.'),
    el('h3', {}, 'Physics'),
    el('p', {}, 'Objects with weight fall, stack and collide, and water and wind push them: light materials float, heavy ones sink. Drag one and let go to throw it; lifted with the handles it drops straight down when let go (pause first, with Space, to set things up in the air). Collision off lets objects and fluids pass through. The circular-arrow button starts everything again: fluids empty, moving objects back where they were put, timers and motions from the start.'),
    el('h3', {}, 'Objects'),
    el('p', {}, 'To add a shape, an object or a source, drag its icon from the tools into the view: a ring shows where it will stand, on whatever is under the pointer (a table top, or the ground). Or click the icon, then the place. Ready-made pieces in the Objects tool: figures, a studio backdrop, light stands, a toothed ring, clear channels and a clear basin, lab stands, tubes, a ribbed panel, frosted balls, metal blocks, springs, a waffle base, posts, fences, model trees, slats, a frame, and kits that bring their own sources (a mist nozzle, a rail of four, a blower, a pour spout) or take fluid out (a floor drain, an extractor hood); the parts of a kit move, turn, copy and delete with it. Any object can move on its own (Motion) and any source can switch itself on and off (Timer).'),
    el('h3', {}, 'Materials'),
    el('p', {}, 'Click a thing: its Material settings are in the Scene tab. Roughness, Metallic, Specular, Clear coat, Glow and Grain are sliders; click a value to type it. The Finish buttons and Ready materials are shortcuts to them; Clear and Frosted make it glass, with Roughness, Refraction and Tint depth. An imported model\'s parts each have their own: click a part of a selected model to choose it, or use the Part row.'),
    el('h3', {}, 'Pictures on things'),
    el('p', {}, 'Drag an image from a folder onto a thing in the view, or onto the floor. A box asks Texture (all over it, and as what: colour, roughness, metallic, bump, normal, displacement or opacity) or Decal (on that one place). Or use the small squares in the Material settings. The Texture settings say how it lies: box, flat, cylinder, ball or the model\'s own layout, tile size, repeat, rotation, position. Choose a decal in the Decals settings and drag it in the view; its corners size it and its dot turns it. The floor\'s are in the World tab. Displacement changes what you see and the shadow; the fluids flow round the original shape. Up to 24 pictures in a scene, each held at 2048 by 2048.'),
    el('h3', {}, 'Taking water and smoke out'),
    el('p', {}, 'Click the Liquid tool for a Drain, the Smoke tool for an Extractor (dragging the button itself still adds a source). A drain pulls the water round it in and it is gone; an extractor draws the air round it in, and the smoke with it, like a kitchen hood. Strength and size are in the Scene tab: at 1, a drain as big as the tool makes it takes about what a liquid source pours, and an extractor draws the air beside it at about 0.3 m/s. Put an extractor right over the smoke: beside it, a stronger pull draws more smoke out of a strong source.'),
    el('h3', {}, 'Lights'),
    el('p', {}, `The Lights tool puts lights in the scene: an area light (a glowing panel, soft light and soft shadows), a point light (a bulb) and a spot light (a beam). Each lights the objects, the ground, the water and the smoke, and casts its own shadows. Move and aim them with the handles; colour, strength, size, beam and shadows are in the Scene tab, and a switch hides the light itself from the picture. For a scene lit only by your lights: the Light tab's None, and the World tab's Black background. Up to ${MAX_LIGHTS} lights; shadows for as many as fit in 24 maps (an area or spot light takes 1, a point light 6).`),
    el('h3', {}, 'Marks'),
    el('p', {}, 'Live data and drawn elements over the view, in the Marks tool: text, a timer, a counter, a panel of live numbers, a legend of the sources, labels that follow things, numbered tracking boxes, lines between things, wire grids and outlines. Text can show live numbers in braces, such as {timecode} or {height}. Marks stay sharp over the filters.'),
    el('h3', {}, 'Filters'),
    el('p', {}, 'The Filters tab works on the finished picture like a photo editor. Film looks, each after one of Fujifilm\'s film simulations (named in its tooltip; made by hand, not measured against a camera), with highlights, shadows, colour, warmth, clarity, sharpen and grain over them. Diffusion and bloom spread light from bright parts, as the filter in the Ricoh GR III HDF does: a lamp spreads further than a white wall. And colour, tint, posterize, scan lines, vignette, soften, colour split, ink lines and a sharp band for a miniature look. Saved with the scene.'),
    el('h3', {}, 'Your own models'),
    el('p', {}, `GLB or glTF, FBX, USDZ (or USD, USDC, USDA), OBJ with its MTL, or STL. Use the Model tool or drop the file on the window; pick an OBJ or FBX together with its pictures. Each part keeps its material and pictures. Compressed glTF, and skinning and animation in any file, are not read. Up to ${ATLAS_SLOTS} different models (library objects count) and ${MAX_OBJECTS} objects in a scene.`),
    el('h3', {}, 'The panels'),
    el('p', {}, 'The panels are clear glass that follows the picture: light glass over a light scene, dark glass over a dark one, so their text stays readable.'),
    el('h3', {}, 'Saving'),
    el('p', {}, 'The scene is kept in this browser as you work and comes back when you open the app again' +
      (app.savedAt ? ` (last kept at ${app.savedAt.toLocaleTimeString()}).` : '.') + ` Nothing you make is uploaded. Save writes a .${FILE_EXT} file you can open anywhere; older .fluidsim files open too.`),
    el('h3', {}, 'Credits'),
    el('p', {}, 'Fonts: Inter by Rasmus Andersson and, for the name, Fredoka by the Fredoka Project Authors (both SIL Open Font License 1.1). The smoke and liquid follow the methods Houdini and Blender use; Cloudtank is not made by or connected with their makers.'),
    el('p', { class: 'plate' },
      el('span', {}, `${NAME} · `,
        el('a', { href: 'https://windnoise.org', target: '_blank', rel: 'noopener', 'aria-label': 'A Windnoise solution: windnoise.org (opens in a new tab)' }, 'A Windnoise solution'),
        ' · ',
        el('a', { href: 'https://github.com/HXXFX/cloudtank', target: '_blank', rel: 'noopener', 'aria-label': `HXXFX: the source of ${NAME} on GitHub (opens in a new tab)` }, 'HXXFX')),
      el('span', {}, '© 2026 Windnoise · All rights reserved')));
}

function toggleInfo() {
  const box = $('info');
  box.hidden = !box.hidden;
  if (!box.hidden) paintInfo();
}

let toastTimer = null;
function toast(text, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, bad ? 7000 : 4000);
}
function hideToast() { $('toast').hidden = true; }
app.toast = toast;


function wire() {
  const vp = app.vp;
  app.keepImages();
  vp.on('select', () => {
    const was = app.decalOwner, now = vp.scene.selected;
    if (was && was !== now) for (const l of was.partLooks || [was]) l.decalPick = -1;
    if (app.panels.scene) { if (app.tab !== 'scene' && vp.scene.selected) showTab('scene'); else if (app.tab === 'scene') app.panels.scene.paint(); }
    app.showDecalHandles();
  });
  vp.on('change', () => { if (app.tab === 'scene') app.panels.scene.paint(); });
  vp.on('commit', () => app.commit());
  vp.on('moving', () => { if (app.tab === 'scene') app.panels.scene.paintLight(); });
  vp.on('placed', () => cancelPlacing());
  vp.on('notice', text => toast(text, true));
  vp.on('region', () => { if (app.tab === 'fluids') app.panels.fluids.paint(); });
  vp.on('region-done', () => app.markDirty());
  vp.on('activate', () => {
    $('flyout').hidden = true;
    if (!$('hint').classList.contains('gone')) { $('hint').classList.add('gone'); localStorage.setItem('fluidsim.hint', 'seen'); }
  });

  $('model-file').addEventListener('change', e => { if (e.target.files.length) importModel(e.target.files); e.target.value = ''; });
  $('scene-file').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  $('image-file').addEventListener('change', e => { if (e.target.files[0]) useImage(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tool]');
    if (!e.target.closest('#flyout') && !(t && FLYOUTS.has(t.dataset.tool))) $('flyout').hidden = true;
    if (!$('more').hidden && !e.target.closest('#more') && !app.moreBtn.contains(e.target)) toggleMore(false);
    if (!$('show').hidden && !e.target.closest('#show') && !app.showBtn.contains(e.target)) toggleShow(false);
  });
  document.addEventListener('pointerdown', e => { if (!$('ctx').hidden && !e.target.closest('#ctx')) $('ctx').hidden = true; }, true);
  vp.on('context', ({ item, x, y }) => contextMenu(item, x, y));

  let depth = 0;
  const imagesOnly = e => [...e.dataTransfer.items].filter(i => i.kind === 'file').every(i => i.type.startsWith('image/'));
  const endDrag = () => { depth = 0; $('drop').hidden = true; vp.dropHover = null; };
  window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { depth++; $('drop').hidden = imagesOnly(e); e.preventDefault(); } });
  window.addEventListener('dragover', e => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files') || !imagesOnly(e)) return;
    const t = vp.surfaceAt(e.clientX, e.clientY);
    vp.dropHover = t && t.kind === 'object' ? { item: t.item, part: t.part } : null;
  });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) endDrag(); });
  window.addEventListener('dragend', endDrag);
  window.addEventListener('drop', e => {
    e.preventDefault();
    endDrag();
    const files = [...e.dataTransfer.files];
    const scene = files.find(f => /\.(cloudtank|fluidsim|json)$/i.test(f.name));
    const model = files.find(f => /\.(glb|gltf|obj|stl|fbx|usdz|usda|usdc|usd)$/i.test(f.name));
    if (scene) openFile(scene);
    else if (model) importModel(files);
    else if (files.length && files.some(isImageFile)) {
      if (e.target.closest && e.target.closest('.glass')) toast('Drop it on a thing in the view, or on the floor.', true);
      else imageMenu(app, files, e.clientX, e.clientY);
    }
    else if (files.length) toast('This app takes models, scenes and images. ' + files[0].name + ' is none of those.', true);
  });

  document.addEventListener('keydown', e => {
    const typing = e.target.closest && e.target.closest('input, select, textarea');
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('scene-file').click(); return; }
    if (typing) return;
    if (app.clean) {
      if (e.key === 'Escape' || (e.key.toLowerCase() === 'g' && !ctrl && !e.altKey)) setClean(false);
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (vp.scene.selected) app.duplicateAll(vp.selectedItems()); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); vp.selectAll(vp.scene.items); return; }
    if (e.key === 'End') { e.preventDefault(); if (vp.scene.selected) app.groundAll(vp.selectedItems()); return; }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (vp.scene.selected) app.removeAll(vp.selectedItems()); return; }
    if (e.key === 'Escape') {
      if (vp.cancelDrag()) return;
      if (vp.placing) cancelPlacing(); else if (app.tool === 'stir') setTool('move'); else vp.select(null);
      $('flyout').hidden = true; $('info').hidden = true; $('ctx').hidden = true; toggleMore(false); toggleShow(false); return;
    }
    if (ctrl || e.altKey) return;
    if (e.key.toLowerCase() === 'f') { vp.frameSelected(); return; }
    if (e.key.toLowerCase() === 'g') { setClean(true); return; }
    if (e.key.toLowerCase() === 'h') { if (vp.scene.selected) app.toggleHidden(vp.selectedItems()); return; }
    const handles = { w: 'move', e: 'turn', r: 'size' }[e.key.toLowerCase()];
    if (handles) { setTool(handles); return; }
  });
}

boot();
