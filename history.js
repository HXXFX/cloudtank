
export function itemData(it) {
  if (it.kind === 'object') {
    return { id: it.id, kind: 'object', shape: it.shape, name: it.name, pos: [...it.pos], size: [...it.size],
      rot: [...it.rot], color: [...it.color], model: it.model || null,
      moves: !!it.moves, collides: it.collides !== false, material: it.material || 'wood',
      home: it.home ? { pos: [...it.home.pos], rot: [...it.home.rot] } : null,
      finish: it.finish || null, motion: it.motion ? { ...it.motion } : null, asset: it.asset || null };
  }
  if (it.kind === 'mark') { const { held, ...rest } = it; return JSON.parse(JSON.stringify(rest)); }
  if (it.kind === 'light') {
    return { id: it.id, kind: 'light', type: it.type, name: it.name, pos: [...it.pos], dir: [...it.dir], color: [...it.color], power: it.power,
      radius: it.radius, aspect: it.aspect, angle: it.angle, soft: it.soft, shadows: it.shadows !== false, show: it.show !== false, on: it.on !== false };
  }
  return { id: it.id, kind: 'emitter', type: it.type, name: it.name, pos: [...it.pos], radius: it.radius,
    color: [...it.color], dir: [...it.dir], speed: it.speed, rate: it.rate, heat: it.heat ?? 1, on: it.on !== false,
    pulse: it.pulse ? { ...it.pulse } : null, ...(it.sink ? { sink: true } : {}), ...(it.attach ? { attach: { to: it.attach.to } } : {}) };
}

export function restoreItems(scene, data) {
  scene.objects = [];
  scene.emitters = [];
  scene.marks = [];
  scene.lights = [];
  for (const d of data.objects || []) scene.addObject(d);
  for (const d of data.lights || []) scene.addLight(d);
  for (const d of data.emitters || []) scene.addEmitter({ ...d, heat: d.heat ?? 1 });
  for (const d of data.marks || []) scene.addMark(d);
}

export class History {
  constructor(vp, onChange) {
    this.vp = vp;
    this.onChange = onChange;
    this.stack = [];
    this.at = -1;
  }

  snapshot() {
    const s = this.vp.scene;
    return JSON.stringify({ objects: s.objects.map(itemData), emitters: s.emitters.map(itemData), lights: s.lights.map(itemData), marks: s.marks.map(itemData) });
  }

  reset() { this.stack = [this.snapshot()]; this.at = 0; this.onChange(); }

  commit() {
    const s = this.snapshot();
    if (s === this.stack[this.at]) return;
    this.stack.length = this.at + 1;
    this.stack.push(s);
    if (this.stack.length > 200) this.stack.shift();
    this.at = this.stack.length - 1;
    this.onChange();
  }

  get canUndo() { return this.at > 0; }
  get canRedo() { return this.at < this.stack.length - 1; }

  undo() { if (this.canUndo) { this.at--; this.apply(); } }
  redo() { if (this.canRedo) { this.at++; this.apply(); } }

  apply() {
    const sel = this.vp.scene.selected ? this.vp.scene.selected.id : null;
    restoreItems(this.vp.scene, JSON.parse(this.stack[this.at]));
    this.vp.select(this.vp.scene.items.find(i => i.id === sel) || null);
    this.vp.emit('change');
    this.onChange();
  }

  modelsInUse() {
    const used = new Set();
    for (const s of this.stack) for (const o of JSON.parse(s).objects) if (o.model) used.add(o.model);
    return used;
  }
}
