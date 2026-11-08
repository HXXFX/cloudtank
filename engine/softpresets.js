
export const SOFT_KINDS = { cloth: 'Cloth', solid: 'Soft solid', balloon: 'Balloon' };

export const SOFT_DEFAULTS = {
  kind: 'cloth', preset: 'cotton',
  sheet: 0.2,
  stretch: 8000,
  compress: 800,
  shear: 1000,
  bend: 1e-5,
  density: 1050,
  young: 30000,
  poisson: 0.45,
  air: 1,
  gas: 'air',
  pressure: 0,
  grow: 1,
  over: 2,
  damp: 2,
  drag: 1,
  lift: 0.2,
  thick: 0.4,
  grip: 0.5,
  bounce: 0,
  self: true,
  selfGap: 0,
  cell: 0,
  steps: 8,
  pin: 'none',
  pinAt: null,
  tether: true,
};

const sheetRows = ['sheet', 'stretch', 'compress', 'shear', 'bend'];

export const SOFT_PRESETS = {
  silk:      { label: 'Silk',       kind: 'cloth', says: 'Light, slips and flows', sheet: 0.06, stretch: 3000, compress: 100, shear: 200, bend: 5e-7, drag: 1.2, lift: 0.3, grip: 0.25, damp: 1 },
  cotton:    { label: 'Cotton',     kind: 'cloth', says: 'A bed sheet', sheet: 0.2, stretch: 8000, compress: 800, shear: 1000, bend: 1e-5, drag: 1, lift: 0.2, grip: 0.5, damp: 2 },
  blanket:   { label: 'Wool blanket', kind: 'cloth', says: 'Heavy, soft folds, holds to what it lies on', sheet: 0.6, stretch: 3000, compress: 300, shear: 400, bend: 6e-5, drag: 1, lift: 0.1, grip: 0.8, damp: 4 },
  denim:     { label: 'Denim',      kind: 'cloth', says: 'Heavy, wide stiff folds', sheet: 0.45, stretch: 20000, compress: 2000, shear: 3000, bend: 1.2e-4, drag: 1, lift: 0.1, grip: 0.6, damp: 3 },
  leather:   { label: 'Leather',    kind: 'cloth', says: 'Stiff and slow', sheet: 0.9, stretch: 15000, compress: 6000, shear: 6000, bend: 1e-3, drag: 1, lift: 0.1, grip: 0.7, damp: 6 },
  rubbersheet: { label: 'Rubber sheet', kind: 'cloth', says: 'Stretches a long way and springs back', sheet: 1, stretch: 1500, compress: 1500, shear: 750, bend: 2e-5, drag: 1, lift: 0.1, grip: 0.9, damp: 1 },
  film:      { label: 'Plastic film', kind: 'cloth', says: 'Very light, crinkles', sheet: 0.03, stretch: 3000, compress: 20, shear: 1500, bend: 2e-7, drag: 1.2, lift: 0.3, grip: 0.3, damp: 1 },
  shrinkfilm: { label: 'Shrink film', kind: 'cloth', says: 'Shrinks onto what is under it, as heated film does', sheet: 0.03, stretch: 2500, compress: 25, shear: 1200, bend: 1e-6, grow: 0.45, over: 3, drag: 0.4, lift: 0, grip: 0.9, damp: 4, self: false },
  vacuum:    { label: 'Vacuum bag', kind: 'cloth', says: 'The air between is sucked out and the bag is pressed onto what is in it', sheet: 0.1, stretch: 4000, compress: 40, shear: 2000, bend: 2e-6, pressure: -60, over: 3, drag: 0.2, lift: 0, grip: 0.9, damp: 6, self: false },
  jelly:     { label: 'Jelly',      kind: 'solid', says: 'Wobbles a long time', density: 1050, young: 30000, poisson: 0.47, damp: 0.5, grip: 0.4, drag: 0.5 },
  flesh:     { label: 'Flesh',      kind: 'solid', says: 'Soft, wobbles and settles', density: 1000, young: 60000, poisson: 0.45, damp: 4, grip: 0.6, drag: 0.5 },
  foam:      { label: 'Foam',       kind: 'solid', says: 'Light; squeezes without bulging', density: 60, young: 30000, poisson: 0.05, damp: 8, grip: 0.8, drag: 1 },
  silicone:  { label: 'Silicone',   kind: 'solid', says: 'Firm, springy', density: 1100, young: 300000, poisson: 0.47, damp: 2, grip: 0.9, drag: 0.5 },
  rubber:    { label: 'Hard rubber', kind: 'solid', says: 'Bounces', density: 1100, young: 2000000, poisson: 0.47, damp: 1, grip: 0.95, drag: 0.5 },
  party:     { label: 'Party balloon', kind: 'balloon', says: 'Thin stretchy skin', sheet: 0.15, stretch: 250, compress: 250, shear: 120, bend: 2e-7, air: 2.5, over: 2, drag: 0.5, lift: 0, grip: 0.5, damp: 2, self: false },
  helium:    { label: 'Helium balloon', kind: 'balloon', says: 'Rises, and goes where the air takes it', sheet: 0.08, stretch: 300, compress: 300, shear: 150, bend: 2e-7, air: 2.5, gas: 'helium', over: 2, drag: 0.5, lift: 0, grip: 0.5, damp: 2, self: false },
  beach:     { label: 'Beach ball', kind: 'balloon', says: 'Stiff skin, barely over-filled', sheet: 0.35, stretch: 6000, compress: 3000, shear: 3000, bend: 1e-5, air: 1.05, over: 1, drag: 0.5, lift: 0, grip: 0.6, damp: 2, self: false },
  foil:      { label: 'Foil balloon', kind: 'balloon', says: 'A skin that cannot stretch: it creases instead', sheet: 0.05, stretch: 40000, compress: 100, shear: 20000, bend: 1e-6, air: 1.05, over: 2, drag: 0.5, lift: 0, grip: 0.4, damp: 4, self: false },
  deflated:  { label: 'Letting down', kind: 'balloon', says: 'Air going out: it sags and folds', sheet: 0.2, stretch: 3000, compress: 60, shear: 1500, bend: 1e-6, air: 0.15, over: 5, drag: 0.5, lift: 0, grip: 0.6, damp: 4, self: true },
};

export const softValue = (s, key) => (s && s[key] !== undefined && s[key] !== null ? s[key] : SOFT_DEFAULTS[key]);

export function softFromPreset(name, old = {}) {
  const P = SOFT_PRESETS[name];
  if (!P) return null;
  const { label, says, ...values } = P;
  return { kind: P.kind, preset: name, base: name, pin: old.pin, pinAt: old.pinAt, cell: P.kind === old.kind ? old.cell : undefined, steps: old.steps, ...values };
}

export function softFor(o) {
  return softFromPreset(o.shape === 'plane' ? 'blanket' : 'jelly');
}

export function setSoft(o, on) {
  if (on) {
    if (o.soft) o.soft.on = true; else o.soft = softFor(o);
    o.home = { pos: [...o.pos], rot: [...o.rot] };
    o.vel = [0, 0, 0]; o.spin = [0, 0, 0];
  } else if (o.soft) {
    o.soft.on = false;
    if (o.home) { o.pos = [...o.home.pos]; o.rot = [...o.home.rot]; }
    o.last = [...o.pos];
  }
}

export const isSheet = s => softValue(s, 'kind') !== 'solid';
export const isSolid = s => softValue(s, 'kind') === 'solid';
export const isCloth = s => softValue(s, 'kind') === 'cloth';
export const isBalloon = s => softValue(s, 'kind') === 'balloon';
export { sheetRows };
