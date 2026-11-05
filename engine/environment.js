
export const LIGHT_PRESETS = {
  sunny: {
    label: 'Sunny day',
    key: { az: 105, el: 52, color: '#fff0d6', power: 2.6, soft: 1.2 },
    fill: { az: 285, el: 40, color: '#8db3ff', power: 0.22 },
    rim: { az: 0, el: 10, color: '#ffffff', power: 0 },
    ambSky: '#7aa3f2', ambGround: '#d9bd8c', ambPower: 0.5, exposure: 0.62,
  },
  overcast: {
    label: 'Overcast day',
    key: { az: 140, el: 68, color: '#d1dbeb', power: 0.85, soft: 10 },
    fill: { az: 320, el: 35, color: '#9eabbd', power: 0.3 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#8c99a8', ambGround: '#26292e', ambPower: 0.95, exposure: 1.15,
  },
  threePoint: {
    label: 'Three-point',
    key: { az: 85, el: 36, color: '#ffe8cc', power: 2.6, soft: 2.5 },
    fill: { az: -15, el: 18, color: '#a8c7ff', power: 0.6 },
    rim: { az: 220, el: 40, color: '#ffffff', power: 2.4 },
    ambSky: '#1a1c21', ambGround: '#0d0d0f', ambPower: 0.5, exposure: 0.85,
  },
  side: {
    label: 'Side light',
    key: { az: 130, el: 13, color: '#fffaf2', power: 5.0, soft: 0.6 },
    fill: { az: 0, el: 0, color: '#ffffff', power: 0 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#050506', ambGround: '#000000', ambPower: 1.0, exposure: 1.0,
  },
  softStudio: {
    label: 'Soft studio',
    key: { az: 120, el: 60, color: '#ffffff', power: 1.6, soft: 4 },
    fill: { az: 300, el: 35, color: '#f2f6ff', power: 0.5 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#f4f7fb', ambGround: '#e6e8e4', ambPower: 0.55, exposure: 0.62,
  },
  overhead: {
    label: 'Hard, from above',
    key: { az: 300, el: 58, color: '#ffffff', power: 2.4, soft: 0.8 },
    fill: { az: 120, el: 40, color: '#ffffff', power: 0.45 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#f0f2f5', ambGround: '#e4e2df', ambPower: 0.5, exposure: 0.6,
  },
  window: {
    label: 'Warm window',
    key: { az: 230, el: 40, color: '#fff4e6', power: 1.3, soft: 5 },
    fill: { az: 60, el: 20, color: '#eef2ff', power: 0.4 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#e6e8ea', ambGround: '#cdb79a', ambPower: 0.6, exposure: 0.62,
  },
  stage: {
    label: 'Dark stage',
    key: { az: 160, el: 20, color: '#ffffff', power: 3.5, soft: 1 },
    fill: { az: 0, el: 0, color: '#ffffff', power: 0 },
    rim: { az: 0, el: 30, color: '#ffffff', power: 1.5 },
    ambSky: '#1a1a1a', ambGround: '#000000', ambPower: 0.3, exposure: 1.0,
  },
  none: {
    label: 'None: your lights only',
    key: { az: 120, el: 50, color: '#ffffff', power: 0, soft: 2 },
    fill: { az: 0, el: 0, color: '#ffffff', power: 0 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#000000', ambGround: '#000000', ambPower: 0, exposure: 1.0,
  },
  dusk: {
    label: 'Lilac dusk',
    key: { az: 200, el: 65, color: '#ffe6f4', power: 1.4, soft: 3 },
    fill: { az: 20, el: 30, color: '#c9c2ff', power: 0.4 },
    rim: { az: 0, el: 0, color: '#ffffff', power: 0 },
    ambSky: '#9a8cff', ambGround: '#4b4870', ambPower: 0.8, exposure: 1.05,
  },
};

export const BACKGROUNDS = {
  studio:   { label: 'Studio',     kind: 0, top: '#0f1012', bottom: '#08090a', haze: 0.55 },
  sky:      { label: 'Clear sky',  kind: 1, top: '#1f52c2', bottom: '#adcdee', haze: 0.25 },
  overcast: { label: 'Overcast',   kind: 2, top: '#545c68', bottom: '#7a838f', haze: 0.5 },
  city:     { label: 'City',       kind: 3, top: '#545c68', bottom: '#7a838f', haze: 0.55 },
  gradient: { label: 'Gradient',   kind: 4, top: '#3b4552', bottom: '#14171b', haze: 0.4 },
  solid:    { label: 'One colour', kind: 5, top: '#24282d', bottom: '#24282d', haze: 0.4 },
  black:    { label: 'Black',      kind: 5, top: '#000000', bottom: '#000000', haze: 0 },
  paper:    { label: 'White studio', kind: 4, top: '#f3f3f0', bottom: '#e4e3df', haze: 0.3 },
  image:    { label: 'Your image', kind: 6, top: '#808080', bottom: '#404040', haze: 0.2 },
};

export const GROUND_PATTERNS = [['none', 'None'], ['lines', 'Lines'], ['bricks', 'Bricks']];
export const patternOf = G => G.grid === 'bricks' ? 'bricks' : G.grid ? 'lines' : 'none';

export const FINISHES = {
  matte:  { label: 'Matte',  code: 0, rough: 0.9, spec: 0.04 },
  satin:  { label: 'Satin',  code: 1, rough: 0.45, spec: 0.35 },
  gloss:  { label: 'Gloss',  code: 2, rough: 0.08, spec: 1.0 },
  wet:    { label: 'Wet',    code: 3, rough: 0.3, spec: 1.0 },
};

export function copy(x) { return JSON.parse(JSON.stringify(x)); }

export function defaultLook() {
  return {
    light: { preset: 'sunny', ...copy(LIGHT_PRESETS.sunny) },
    background: { preset: 'sky', ...copy(BACKGROUNDS.sky), image: null },
    ground: { color: '#6e6a64', finish: 'matte', grid: true },
    weather: { rain: 0 },
    wind: { on: false, dir: 60, speed: 3, gusts: 0.4, turbulence: 0.5 },
  };
}

export const LEGACY = {
  beach:  { light: 'sunny', background: 'sky', ground: { color: '#857559', finish: 'matte', grid: false }, rain: 0 },
  rain:   { light: 'overcast', background: 'city', ground: { color: '#1f2022', finish: 'wet', grid: false }, rain: 1 },
  studio: { light: 'threePoint', background: 'studio', ground: { color: '#131315', finish: 'satin', grid: false }, rain: 0 },
  side:   { light: 'side', background: 'solid', ground: { color: '#1a1a1a', finish: 'matte', grid: false }, rain: 0, bg: '#010101' },
};
