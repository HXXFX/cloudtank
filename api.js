import { SETTINGS as THING_SETTINGS, CATS } from './ui/details.js';
import { MIXED } from './ui/dom.js';
import { SETTINGS as SCENE_SETTINGS } from './engine/settings.js';
import { SHAPES } from './engine/shapes.js';
import { ASSETS, ASSET_BY_ID } from './engine/assets.js';
import { LIGHT_KINDS, MAX_OBJECTS, MAX_EMITTERS, MAX_LIGHTS, MAX_MARKS, sourceLabel } from './engine/scene.js';
import { cardName } from './engine/gpu.js';
import { drawMarks } from './engine/marks.js';
import { sceneData } from './store.js';
import { VERSION } from './version.js';

const DEG = 180 / Math.PI;
const R = v => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map(R) : v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const low = s => String(s).trim().toLowerCase();

let app = null, inner = null, windowId = null;

const arg = (type, says, extra = {}) => ({ type, says, ...extra });
const TYPES = { ref: { type: ['string', 'integer'] }, refs: { type: 'array', items: { type: ['string', 'integer'] } },
  point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 }, xyz: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } };
const schemaOf = c => ({ type: 'object', properties: Object.fromEntries(Object.entries(c.args).map(([k, a]) => [k, { ...(TYPES[a.type] || { type: a.type }), description: a.says,
  ...(a.enum ? { enum: a.enum } : {}), ...(a.min !== undefined ? { minimum: a.min } : {}), ...(a.max !== undefined ? { maximum: a.max } : {}) }])),
  ...(c.required ? { required: c.required } : {}) });


const everything = vp => vp.scene.items;
const kindName = it => it.kind === 'object' ? 'object' : it.kind === 'emitter' ? sourceLabel(it).toLowerCase()
  : it.kind === 'light' ? LIGHT_KINDS[it.type].toLowerCase() : it.kind;
function addName(it) {
  if (it.kind === 'object') return it.asset ? 'asset:' + it.asset : it.shape === 'model' ? 'imported model' : it.shape;
  if (it.kind === 'emitter') return it.sink ? (it.type === 'smoke' ? 'extractor' : 'drain') : it.type;
  if (it.kind === 'light') return 'light:' + it.type;
  return 'mark:' + it.type;
}
function entry(vp, it) {
  const e = { id: it.id, name: it.name, kind: kindName(it), from: addName(it) };
  if (it.pos) e.position = R(it.pos);
  if (it.kind === 'object') { e.size = R(it.size.map(v => v * 2)); e.rotation = R(it.rot.map(v => v * DEG)); if (it.moves) e.hasWeight = true; }
  if (it.kind === 'emitter') { e.radius = R(it.radius); if (it.attach) e.partOf = it.attach.to; if (it.on === false) e.on = false; }
  if (it.hidden) e.hidden = true;
  if (vp.scene.picks.includes(it)) e.selected = true;
  return e;
}
function find(vp, ref) {
  if (ref === undefined || ref === null || ref === '') throw new Error('Say which thing: its id or its name (list gives both).');
  const all = everything(vp), n = typeof ref === 'number' ? ref : /^\s*\d+\s*$/.test(String(ref)) ? +ref : null;
  const byId = n !== null && all.find(x => x.id === n);
  if (byId) return byId;
  const named = all.filter(x => low(x.name || '') === low(ref));
  if (named.length > 1) throw new Error(`${named.length} things are called ${JSON.stringify(ref)}: ids ${named.map(x => x.id).join(', ')}. Use the id.`);
  const it = named[0];
  if (!it) throw new Error(`Nothing in the scene has the id or name ${JSON.stringify(ref)}. In the scene: ${all.slice(0, 40).map(x => `${x.id} ${x.name}`).join(', ')}${all.length > 40 ? ', …' : ''}.`);
  return it;
}
const findAll = (vp, args) => {
  const refs = args.things !== undefined ? [].concat(args.things) : args.thing !== undefined ? [args.thing] : [];
  if (!refs.length) throw new Error('Say which thing: "thing" (an id or a name) or "things" (a list of them).');
  return [...new Set(refs.map(r => find(vp, r)))];
};


function catalog() {
  const shapes = inner.addShapes.map(k => ({ add: k, label: SHAPES[k].label }));
  const objects = ASSETS.map(a => ({ add: 'asset:' + a.id, label: a.label, group: a.group, ...(a.sources ? { kit: `comes with ${a.sources.length} source${a.sources.length > 1 ? 's' : ''}` } : {}) }));
  const sources = [['smoke', 'Smoke source', 'puts out smoke'], ['liquid', 'Liquid source', 'pours liquid'], ['extractor', 'Extractor', 'takes smoke out, like a kitchen hood'], ['drain', 'Drain', 'takes water out, like a plug hole']]
    .map(([add, label, does]) => ({ add, label, does }));
  const lights = Object.entries(LIGHT_KINDS).map(([k, label]) => ({ add: 'light:' + k, label }));
  return { shapes, objects, sources, lights };
}
function kindFor(what) {
  if (!what) throw new Error('Say what to add: "what", a name from catalog (for example "ball", "smoke", "asset:desk-fan", "light:spot").');
  const w = low(what), C = catalog(), all = [...C.shapes, ...C.objects, ...C.sources, ...C.lights];
  const hit = all.find(x => low(x.add) === w) || all.find(x => low(x.label) === w) || (ASSET_BY_ID[w] && { add: 'asset:' + w })
    || all.find(x => low(x.add) === w.replace(/ source$/, '')) || all.find(x => x.add === 'light:' + w.replace(/ light$/, ''))
    || (ASSETS.find(a => low(a.name || '') === w) && { add: 'asset:' + ASSETS.find(a => low(a.name || '') === w).id });
  if (!hit) throw new Error(`Cloudtank cannot add ${JSON.stringify(what)}. It adds: ${all.map(x => x.add).join(', ')}.`);
  return hit.add;
}


const ROW_KINDS = new Set(['slider', 'toggle', 'color', 'choice', 'text', 'pick', 'numbers', 'dial', 'action']);
const KIND_WORDS = { slider: 'number', toggle: 'on or off (true or false)', color: 'colour (#rrggbb)', choice: 'one of the options', pick: 'one of the options',
  text: 'text', numbers: 'numbers (a list)', dial: 'angle in degrees', action: 'action (true runs it)' };
const sameV = (a, b) => (Array.isArray(a) && Array.isArray(b)) ? a.length === b.length && a.every((v, i) => sameV(v, b[i]))
  : typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;
const readAll = (ts, get) => { const v = get(ts[0]); return ts.every(t => sameV(get(t), v)) ? v : MIXED; };
const shown = v => (v === MIXED ? 'mixed' : R(v));

function ctxFor(notes) {
  const vp = app.vp;
  return { vp, commit: () => {}, repaint: () => {}, repaintSoon: () => {}, paintList: () => {}, rebuild: () => {}, showTab: () => {},
    menu: () => {}, editDecal: () => {}, say: t => notes.push(t) };
}
function rowsFor(things, ctx) {
  const vp = ctx.vp, out = [];
  for (const p of THING_SETTINGS) {
    if (!ROW_KINDS.has(p.kind)) continue;
    const ts = [...new Set(things.flatMap(it => p.on(it, vp)))].filter(t => !p.when || p.when(t, ctx));
    if (ts.length) out.push({ p, ts, name: `${CATS[p.cat]} / ${p.label}` });
  }
  return out;
}
const optionsOf = (r, ctx) => (typeof r.p.options === 'function' ? r.p.options(r.ts, ctx) : r.p.options || []);
function readRow(r, ctx) {
  const { p, ts } = r;
  if (p.kind === 'action') return undefined;
  if (p.kind === 'numbers') return p.keys.map((k, i) => shown(readAll(ts, t => p.get(t, i, ctx))));
  return shown(readAll(ts, t => p.get(t, ctx)));
}
function describeRow(r, ctx) {
  const { p } = r, d = { name: r.name, kind: KIND_WORDS[p.kind] };
  if (p.kind !== 'action') d.value = readRow(r, ctx);
  if (p.kind === 'slider') { d.min = p.min; d.max = p.max; if (p.unit) d.unit = p.unit.trim(); }
  if (p.kind === 'numbers') d.parts = p.keys;
  if (p.kind === 'choice' || p.kind === 'pick') d.options = optionsOf(r, ctx).map(([value, label]) => (String(value) === label ? { value } : { value, label }));
  if (r.ts.length > 1) d.for = r.ts.length;
  const help = p.help || p.title;
  if (help) d.help = help;
  return d;
}
function matchRow(rows, key) {
  const k = low(key), bare = s => low(s).replace(/\s*\(.*?\)\s*$/, '');
  const full = rows.find(r => low(r.name) === k || bare(r.name) === k);
  if (full) return full;
  const own = rows.filter(r => low(r.p.label) === k || bare(r.p.label) === k);
  if (own.length === 1) return own[0];
  if (own.length > 1) throw new Error(`More than one setting is called ${JSON.stringify(key)}: ${own.map(r => r.name).join(', ')}. Use the full name.`);
  throw new Error(`No setting called ${JSON.stringify(key)} applies to it now. Its settings: ${rows.map(r => r.name).join(', ')}.`);
}
function writeRow(r, value, ctx) {
  const { p, ts } = r, num = v => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${r.name} takes a number, not ${JSON.stringify(v)}.`); return n; };
  switch (p.kind) {
    case 'slider': { const v = clamp(num(value), p.min, p.max); for (const t of ts) p.set(t, v, ctx); return; }
    case 'dial': { const v = num(value); for (const t of ts) p.set(t, v, ctx); return; }
    case 'toggle': {
      const v = value === true || value === 1 || ['on', 'true', 'yes', '1'].includes(low(value));
      if (!v && !(value === false || value === 0 || ['off', 'false', 'no', '0'].includes(low(value)))) throw new Error(`${r.name} is on or off: true or false.`);
      for (const t of ts) p.set(t, v, ctx); return;
    }
    case 'color': {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
      if (!m) throw new Error(`${r.name} takes a colour as #rrggbb, not ${JSON.stringify(value)}.`);
      for (const t of ts) p.set(t, '#' + m[1].toLowerCase(), ctx); return;
    }
    case 'choice': case 'pick': {
      const opts = optionsOf(r, ctx), o = opts.find(([v]) => low(v) === low(value)) || opts.find(([, l]) => low(l) === low(value));
      if (!o) throw new Error(`${r.name} takes one of: ${opts.map(([v, l]) => (String(v) === l ? v : `${v} (${l})`)).join(', ')}.`);
      for (const t of ts) p.set(t, o[0], ctx); return;
    }
    case 'text': for (const t of ts) p.set(t, String(value), ctx); return;
    case 'numbers': {
      const list = Array.isArray(value) ? value : [value];
      if (list.length > p.keys.length) throw new Error(`${r.name} has ${p.keys.length} number${p.keys.length > 1 ? 's' : ''} (${p.keys.join(', ')}).`);
      list.forEach((v, i) => { if (v === null || v === undefined) return; const n = num(v); for (const t of ts) p.set(t, i, n, ctx); });
      return;
    }
    case 'action': if (value === true || low(value) === 'true' || low(value) === 'run') for (const t of ts) p.run(t, ctx); return;
  }
}
function applySet(things, set, ctx) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw new Error('"set" is an object of setting names and values, for example {"Smoke source / Colour": "#ff3366"}.');
  const now = {};
  for (const [key, value] of Object.entries(set)) {
    const r = matchRow(rowsFor(things, ctx), key);
    writeRow(r, value, ctx);
    const again = rowsFor(things, ctx).find(x => x.name === r.name);
    now[r.name] = again ? (readRow(again, ctx) ?? 'done') : 'done';
  }
  return now;
}


function sceneRow(key) {
  const k = low(key), d = SCENE_SETTINGS.find(s => low(s.key) === k) || SCENE_SETTINGS.find(s => low(s.label) === k || low(s.label).replace(/\s*\(.*?\)\s*$/, '') === k);
  if (!d) throw new Error(`No scene setting is called ${JSON.stringify(key)}. They are: ${SCENE_SETTINGS.map(s => s.key).join(', ')}.`);
  return d;
}
const sceneValue = d => R(app.vp.settings[d.key] ?? d.value);


function afterFrame(fn) {
  const vp = app.vp;
  return new Promise((resolve, reject) => {
    let done = false;
    const was = vp.clean;
    vp.clean = true;
    const go = () => { if (done) return; done = true; try { resolve(fn()); } catch (e) { reject(e); } finally { vp.clean = was; } };
    requestAnimationFrame(() => go());
    setTimeout(() => { if (done) return; vp.frame((vp.lastNow || performance.now()) + 1000 / 60); go(); }, 400);
  });
}
async function picture({ width, marks = true } = {}) {
  const vp = app.vp, view = vp.canvas;
  if (view.clientWidth < 64 || view.clientHeight < 64) throw new Error(`The window shows the view at ${view.clientWidth} x ${view.clientHeight} pixels (minimised, or hidden): bring it to the front and give it room.`);
  const c = await afterFrame(() => {
    const W = view.width, H = view.height, k = width ? clamp(Number(width) / W, 0.05, 1) : 1;
    const out = document.createElement('canvas');
    out.width = Math.round(W * k); out.height = Math.round(H * k);
    const g = out.getContext('2d');
    g.drawImage(view, 0, 0, out.width, out.height);
    if (marks && vp.display.marks && vp.scene.marks.length && view.clientWidth) {
      g.setTransform(out.width / view.clientWidth, 0, 0, out.height / view.clientHeight, 0, 0);
      drawMarks(g, vp, view.clientWidth, view.clientHeight, new Map());
    }
    return out;
  });
  const url = c.toDataURL('image/png');
  return { png: url.slice(url.indexOf(',') + 1), width: c.width, height: c.height };
}


const told = text => app.toast(`From another program: ${text}`);
const history = () => ({ canUndo: app.history.canUndo, canRedo: app.history.canRedo });
const cam = vp => ({ target: R(vp.camera.target), distance: R(vp.camera.distance), yaw: R(vp.camera.yaw * DEG), pitch: R(vp.camera.pitch * DEG), fov: R(vp.camera.fov * DEG) });
const changed = () => { app.vp.emit('change'); app.commit(); app.repaint(); app.scenePanelList(); };

export const COMMANDS = {
  status: { reads: true, says: 'What the app is doing: its version, playing or paused, simulated time, frames a second, what the scene holds and its limits, the simulation box, the camera, the graphics card.',
    run: () => {
      const vp = app.vp, S = vp.scene, s = vp.stats;
      return { app: 'Cloudtank', version: VERSION, window: windowId, playing: !!vp.playing, simulatedSeconds: R(vp.simTime), speed: vp.settings.speed,
        framesPerSecond: R(s.fps), card: cardName(vp.gpu.info), cardMsPerFrame: s.simMs ? { simulating: R(s.simMs), drawing: R(s.drawMs) } : 'not measured by this browser',
        holds: { objects: S.objects.length, sources: S.emitters.length, lights: S.lights.length, marks: S.marks.length },
        limits: { objects: MAX_OBJECTS, sources: MAX_EMITTERS, lights: MAX_LIGHTS, marks: MAX_MARKS },
        box: { size: R(vp.region.size), centre: R(vp.region.center) }, camera: cam(vp), selected: S.picks.map(it => it.id), ...history() };
    } },
  list: { reads: true, says: 'Everything in the scene: each thing\'s id, name, kind, what add calls it (from), position and size in metres (y is up, the ground is y = 0), rotation in degrees.',
    run: () => ({ things: everything(app.vp).map(it => entry(app.vp, it)) }) },
  catalog: { reads: true, says: 'What can be added, by the name add takes: shapes, library objects (kits bring their own sources), sources, drains, extractors and lights.',
    run: () => catalog() },
  add: { says: 'Adds a thing, standing on the first surface below the point (a table top, or the ground), and selects it, as dropping its icon in does. One undo step.',
    required: ['what'],
    args: { what: arg('string', 'What to add: a name from catalog ("ball", "smoke", "drain", "asset:desk-fan", "light:spot"), or its label'),
      at: arg('point', '[x, z] in metres, or [x, y, z] to land on the first surface below that height (default [0, 0])'),
      name: arg('string', 'Optional: its name in the scene list'),
      set: arg('object', 'Optional: settings to give it at once, named as the settings command names them, for example {"Smoke source / Colour": "#ff3366", "Amount": 2}'),
      select: arg('boolean', 'Optional: false leaves the selection as it was') },
    run: args => {
      const vp = app.vp, kind = kindFor(args.what), at = Array.isArray(args.at) ? args.at.map(Number) : [0, 0];
      if (!(at.length === 2 || at.length === 3) || at.some(v => !Number.isFinite(v))) throw new Error('"at" is [x, z] or [x, y, z], in metres.');
      const x = clamp(at[0], -12, 12), z = clamp(at.length === 3 ? at[2] : at[1], -12, 12), from = at.length === 3 ? Math.max(at[1], 0.01) : 30;
      const below = vp.scene.pick({ origin: [x, from, z], dir: [0, -1, 0] }, { emitters: false });
      const made = inner.placerFor(kind)([x, below ? Math.max(0, below.point[1]) : 0, z]);
      if (!made) throw new Error(`The scene is full for that kind (at most ${MAX_OBJECTS} objects, ${MAX_EMITTERS} sources with drains and extractors, ${MAX_LIGHTS} lights).`);
      if (args.name) made.name = String(args.name);
      const notes = [], now = args.set ? applySet([made], args.set, ctxFor(notes)) : undefined;
      if (args.select !== false) vp.select(made);
      changed();
      told(`added ${made.name}.`);
      return { added: entry(vp, made), ...(now ? { set: now } : {}), ...(notes.length ? { notes } : {}) };
    } },
  settings: { reads: true, says: 'A thing\'s settings, as its Details panel shows them: each one\'s full name (category / name), the kind of value, the value now, its range or options and what it does. Only those that apply to it now.',
    required: ['thing'], args: { thing: arg('ref', 'Its id or its name (list gives both)') },
    run: args => { const vp = app.vp, it = find(vp, args.thing), ctx = ctxFor([]); return { thing: entry(vp, it), settings: rowsFor([it], ctx).map(r => describeRow(r, ctx)) }; } },
  change: { says: 'Changes settings of one thing or several, by the names settings gives (the full name, or its own name when only one setting has it). Numbers outside a setting\'s range are brought to its end. One undo step.',
    required: ['set'],
    args: { thing: arg('ref', 'Its id or its name'), things: arg('refs', 'Or a list of ids or names, to change them all'),
      set: arg('object', 'The settings and their new values, applied in order, for example {"Position (m)": [0.5, 0, -1], "Material / Colour": "#3355ff", "Size (m)": [0.4, 0.4, 0.4]}. A number list may hold null to keep a part.') },
    run: args => {
      const vp = app.vp, things = findAll(vp, args), notes = [], now = applySet(things, args.set, ctxFor(notes));
      changed();
      told(`changed ${things.length > 1 ? things.length + ' things' : things[0].name}.`);
      return { set: now, things: things.map(it => entry(vp, it)), ...(notes.length ? { notes } : {}) };
    } },
  remove: { says: 'Deletes one thing or several (a kit\'s part deletes its kit, as in the app). One undo step.', args: { thing: arg('ref', 'Its id or its name'), things: arg('refs', 'Or a list of ids or names') },
    run: args => {
      const vp = app.vp, things = [...new Set(findAll(vp, args).map(it => vp.kitOf(it) || it))];
      const names = things.map(it => it.name);
      app.removeAll(things);
      app.repaint(); app.scenePanelList();
      told(`deleted ${names.length > 1 ? names.length + ' things' : names[0]}.`);
      return { removed: names };
    } },
  select: { says: 'Selects one thing or several in the app (their handles and settings show), or nothing.',
    args: { thing: arg('ref', 'Its id or its name'), things: arg('refs', 'Or a list of ids or names'), none: arg('boolean', 'True: select nothing') },
    run: args => {
      const vp = app.vp;
      if (args.none) vp.select(null); else vp.selectAll(findAll(vp, args));
      app.repaint(); app.scenePanelList();
      return { selected: vp.scene.picks.map(it => entry(vp, it)) };
    } },
  scene_settings: { reads: true, says: 'The whole scene\'s fluid settings (the Fluids tab): each one\'s name, label, value, range and what it does.',
    run: () => ({ settings: SCENE_SETTINGS.map(d => ({ name: d.key, label: d.label, group: d.group, value: sceneValue(d),
      ...(d.type === 'color' ? { kind: 'colour (#rrggbb)' } : d.type === 'choice' ? { kind: 'one of the options', options: d.options.map(([value, label]) => ({ value, label })) } : { kind: 'number', min: d.min, max: d.max }),
      ...(d.help ? { help: d.help } : {}) })) }) },
  change_scene: { says: 'Changes the whole scene\'s fluid settings, by the names scene_settings gives (or their labels). Numbers outside a range are brought to its end. As in the app, these are not undo steps.', required: ['set'],
    args: { set: arg('object', 'Names (or labels) and values, for example {"gravity": 3.7, "swirl": 1.5, "liquidColor": "#2266ff", "look": "dots"}') },
    run: args => {
      if (!args.set || typeof args.set !== 'object') throw new Error('"set" is an object of scene setting names and values.');
      const vp = app.vp, now = {};
      for (const [key, value] of Object.entries(args.set)) {
        const d = sceneRow(key);
        let v = value;
        if (d.type === 'color') { const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim()); if (!m) throw new Error(`${d.key} takes a colour as #rrggbb.`); v = '#' + m[1].toLowerCase(); }
        else if (d.type === 'choice') { const o = d.options.find(([k, l]) => low(k) === low(value) || low(l) === low(value)); if (!o) throw new Error(`${d.key} takes one of: ${d.options.map(o => o[0]).join(', ')}.`); v = o[0]; }
        else { v = Number(value); if (!Number.isFinite(v)) throw new Error(`${d.key} takes a number.`); v = clamp(v, d.min, d.max); }
        vp.set(d.key, v);
        if (d.key === 'speed' && app.speedSelect) app.speedSelect.value = String(v);
        now[d.key] = sceneValue(d);
      }
      app.markDirty(); app.repaint();
      told('changed the scene\'s fluid settings.');
      return { set: now };
    } },
  play: { says: 'Starts the simulation running.', run: () => { app.vp.playing = true; inner.paintTop(); return { playing: true, simulatedSeconds: R(app.vp.simTime) }; } },
  pause: { says: 'Pauses the simulation.', run: () => { app.vp.playing = false; inner.paintTop(); return { playing: false, simulatedSeconds: R(app.vp.simTime) }; } },
  restart: { says: 'Starts again, as the app\'s circular arrow does: the fluids empty, moving objects go back where they were put, timers and motions from the start.',
    run: () => { app.vp.resetFluids(); app.vp.putBack(); return { simulatedSeconds: R(app.vp.simTime) }; } },
  run: { limit: 600, says: 'Plays until this many more simulated seconds have passed, then answers (it stays playing). A window that gets no frames is stepped here.',
    args: { seconds: arg('number', 'Simulated seconds to run, 0 to 120 (default 1)', { min: 0, max: 120 }) },
    run: async args => {
      const vp = app.vp, seconds = clamp(Number(args.seconds ?? 1) || 0, 0, 120), t0 = performance.now(), end = vp.simTime + seconds;
      if (!vp.playing) { vp.playing = true; inner.paintTop(); }
      let stepped = 0;
      while (vp.simTime < end - 1e-9) {
        const before = vp.simTime;
        await sleep(250);
        if (vp.simTime === before && vp.playing) {
          let t = vp.lastNow || performance.now();
          for (let i = 0; i < 30 && vp.simTime < end - 1e-9; i++) { vp.frame(t += 1000 / 60); stepped++; }
          await vp.gpu.device.queue.onSubmittedWorkDone();
        }
        if (!vp.playing) throw new Error('Paused in the app before the time was up.');
      }
      return { simulatedSeconds: R(vp.simTime), tookSeconds: R((performance.now() - t0) / 1000), ...(stepped ? { framesSteppedHere: stepped } : {}) };
    } },
  camera: { says: 'Reads the camera, or moves it: what it looks at, how far away, round and above (degrees), the lens (field of view in degrees), or a view by name.',
    args: { target: arg('xyz', 'Optional: [x, y, z] it looks at, in metres'), distance: arg('number', 'Optional: metres from the target', { min: 0.2, max: 100 }),
      yaw: arg('number', 'Optional: degrees round the target'), pitch: arg('number', 'Optional: degrees above the ground', { min: 2, max: 83 }),
      fov: arg('number', 'Optional: the lens, degrees across', { min: 10, max: 120 }), view: arg('string', 'Optional: a view by name', { enum: ['perspective', 'front', 'side', 'back', 'top'] }) },
    run: args => {
      const vp = app.vp, c = vp.camera, n = (v, a, b) => clamp(Number(v), a, b);
      if (args.view) vp.view(low(args.view));
      if (Array.isArray(args.target) && args.target.length === 3 && args.target.every(v => Number.isFinite(+v))) c.target = args.target.map(Number);
      if (args.distance !== undefined) c.distance = n(args.distance, 0.2, 100);
      if (args.yaw !== undefined) c.yaw = Number(args.yaw) / DEG;
      if (args.pitch !== undefined) c.pitch = n(args.pitch, 2, 83) / DEG;
      if (args.fov !== undefined) c.fov = n(args.fov, 10, 120) / DEG;
      if (Object.keys(args).length) app.markDirty();
      return cam(vp);
    } },
  picture: { reads: true, limit: 60, says: 'A picture of the view as it is drawn, with its filters and its marks (no handles or badges). The server saves it as a PNG file and answers with its path and address.',
    args: { width: arg('integer', 'Optional: pixels across (smaller than the window only)', { min: 32 }), marks: arg('boolean', 'Optional: false leaves the marks out'),
      data: arg('boolean', 'Optional, for the API: true also returns the picture itself, as base64 PNG') },
    run: args => picture(args) },
  undo: { says: 'Takes back the last change to the things in the scene (the app\'s Ctrl+Z). As in the app, the scene\'s settings, light, background and filters are not undone.', run: () => { inner.undo(); return history(); } },
  redo: { says: 'Puts back the change undo took back.', run: () => { inner.redo(); return history(); } },
  get_scene: { reads: true, limit: 60, says: 'The whole scene as a Cloudtank scene file (what Save writes), to keep or to open again with open_scene.', args: { pictures: arg('boolean', 'Optional: false leaves out the pictures on things (much smaller)') },
    run: args => { const d = sceneData(app.vp, { forFile: true }); if (args.pictures === false) { d.images = []; d.image = null; } return { scene: d }; } },
  open_scene: { limit: 120, says: 'Opens a scene from its data (a .cloudtank file\'s contents, or what get_scene gave), in place of the one open, paused as every scene opens (play or run starts it). The undo steps start again.', required: ['scene'], args: { scene: arg('object', 'The scene data') },
    run: async args => { await inner.openData(args.scene); told('opened a scene.'); return { opened: true, things: everything(app.vp).length }; } },
  new_scene: { limit: 120, says: 'Starts a new scene, as New does (the start scene), paused as every scene opens (play or run starts it).', run: async () => { await inner.newScene(); told('started a new scene.'); return { things: everything(app.vp).length }; } },
};
for (const c of Object.values(COMMANDS)) { c.args ||= {}; c.limit ||= 30; }

export const describe = () => Object.entries(COMMANDS).map(([name, c]) => ({ name, says: c.says, args: Object.fromEntries(Object.entries(c.args).map(([k, a]) => [k, a.says])),
  schema: schemaOf(c), reads: !!c.reads, limit: c.limit }));

let started;
const ready = new Promise(r => { started = r; });
const handle = { version: VERSION, ready,
  help: async () => ({ app: 'Cloudtank', version: VERSION,
    how: 'Each command is a function of one object of arguments that returns a promise of its answer, for example await cloudtank.add({ what: "smoke", at: [0, 1], set: { Colour: "#ff2200" } }). Lengths in metres, angles in degrees; y is up and the ground is y = 0. Start with status() and list(); a thing\'s settings, by the names change() takes, come from settings({ thing }). An error says what would work.',
    commands: describe().map(({ name, says, args }) => ({ name, says, args })) }) };
for (const [name, c] of Object.entries(COMMANDS)) handle[name] = async (args = {}) => { await ready; return c.run(args || {}); };
if (typeof window !== 'undefined') window.cloudtank = handle;

async function carryOut(job) {
  const c = COMMANDS[job.command];
  if (!c) return { ok: false, error: `Cloudtank has no command ${JSON.stringify(job.command)}. It has: ${Object.keys(COMMANDS).join(', ')}.` };
  try { return { ok: true, result: await c.run(job.args || {}) }; }
  catch (e) { return { ok: false, error: e.message }; }
}


export function startApi(theApp, internals) {
  app = theApp; inner = internals;
  started();
  const P = internals.params;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) || !location.pathname.startsWith('/app/')) return null;
  if (P.get('scene') && P.get('api') !== '1') return null;
  windowId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8);
  let used = Date.now(), stopped = false;
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const hello = () => post('/api/_hello', { window: windowId, version: VERSION, address: location.pathname + (P.toString() ? '?' + P.toString() : ''), visible: document.visibilityState === 'visible',
    used, framed: window !== window.top, commands: describe() }).then(r => r.status, () => 0);
  let soon = 0;
  const touch = () => { used = Date.now(); clearTimeout(soon); soon = setTimeout(hello, 300); };
  for (const ev of ['pointerdown', 'keydown', 'focus']) addEventListener(ev, touch, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touch(); else hello(); });
  addEventListener('pagehide', () => { stopped = true; navigator.sendBeacon && navigator.sendBeacon('/api/_bye', new Blob([JSON.stringify({ window: windowId })], { type: 'application/json' })); });
  (async () => {
    for (;;) {
      if (stopped) return;
      const said = await hello();
      if (said === 404) return;
      if (said !== 200) { await sleep(3000); continue; }
      app.apiWindow = windowId;
      for (;;) {
        let r;
        try { r = await fetch('/api/_wait?window=' + windowId, { cache: 'no-store' }); } catch { break; }
        if (r.status === 204) continue;
        if (r.status !== 200) break;
        const job = await r.json();
        const answer = await carryOut(job);
        try { await post('/api/_answer', { window: windowId, id: job.id, ...answer }); } catch { break; }
      }
      await sleep(1000);
    }
  })();
  return windowId;
}
