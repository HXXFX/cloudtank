
export const SETTINGS = [
  { key: 'speed', label: 'Speed', group: 'all', min: 0.1, max: 2, step: 0.05, value: 1,
    help: 'How fast time runs in the simulation.', also: 'Houdini: Time scale' },

  { key: 'smokeAmount', label: 'Density', group: 'smoke', min: 0, max: 3, step: 0.05, value: 1,
    help: 'How much smoke each source puts out.', also: 'Houdini: Density (source) · Blender: Flow density' },
  { key: 'smokeOpacity', label: 'Thickness', group: 'smoke', min: 1, max: 40, step: 0.5, value: 10,
    help: 'How much light the smoke blocks: thin haze or dense smoke.', also: 'Houdini: Density scale (shader)' },
  { key: 'rise', label: 'Rise', group: 'smoke', min: 0, max: 8, step: 0.1, value: 2.5,
    help: 'How strongly hot smoke rises.', also: 'Houdini: Buoyancy lift · Blender: Heat' },
  { key: 'swirl', label: 'Swirl', group: 'smoke', min: 0, max: 3, step: 0.05, value: 1,
    help: 'How many small curls the smoke keeps.', also: 'Houdini: Confinement · Blender: Vorticity' },
  { key: 'fade', label: 'Fade', group: 'smoke', min: 0, max: 1.5, step: 0.01, value: 0.12,
    help: 'How quickly smoke thins away.', also: 'Houdini: Dissipation · Blender: Dissolve' },
  { key: 'smokeColor', label: 'Smoke colour', type: 'color', group: 'smoke', value: '#dcd6cc' },

  { key: 'flow', label: 'Flow', group: 'liquid', min: 0, max: 3, step: 0.05, value: 1,
    help: 'How much liquid each source sprays.', also: 'Houdini: Emission rate' },
  { key: 'splash', label: 'Splash', group: 'liquid', min: 0, max: 0.99, step: 0.01, value: 0.95,
    help: 'Lively and splashy (high), or calm and thick (low).', also: 'Houdini and Blender: FLIP ratio' },
  { key: 'clarity', label: 'Clarity', group: 'liquid', min: 0, max: 1, step: 0.01, value: 0.85,
    help: 'Clear like water (high), or solid like paint (low).' },
  { key: 'liquidColor', label: 'Liquid colour', type: 'color', group: 'liquid', value: '#3d9fd4' },
  { key: 'look', label: 'Liquid look', type: 'choice', group: 'liquid', value: 'smooth',
    options: [['smooth', 'Smooth'], ['surface', 'Surface'], ['dots', 'Particles']] },

  { key: 'objectColor', label: 'Object colour', type: 'color', group: 'scene', value: '#c9c4bb' },
];

export function defaults() {
  return Object.fromEntries(SETTINGS.map(s => [s.key, s.value]));
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function lightOf(rgb) {
  return rgb.map(c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
}

export function rgbToHex([r, g, b]) {
  const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
