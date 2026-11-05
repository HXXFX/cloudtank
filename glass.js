
export const KINDS = {
  dark: { tint: [16, 18, 21], text: [0xc3, 0xc8, 0xce], behind: 0.56, base: 0.38, most: 0.92 },
  light: { tint: [248, 248, 246], text: [0x3b, 0x41, 0x48], behind: 1.08, base: 0.62, most: 0.95 },
};
export const BASE = KINDS.dark.base, MOST = KINDS.dark.most, AIM = 7;
export const MATERIAL_KINDS = {
  frosted: KINDS,
  liquid: {
    dark: { tint: [18, 20, 24], text: [0xc3, 0xc8, 0xce], behind: 1.04, base: 0.22, most: 0.85, aim: 7 },
    light: { tint: [255, 255, 255], text: [0x3b, 0x41, 0x48], behind: 1.04, base: 0.28, most: 0.9, aim: 7 },
  },
  clear: {
    dark: { tint: [12, 14, 18], text: [0xc3, 0xc8, 0xce], behind: 1.03, base: 0.06, most: 0.75, aim: 4.5 },
    light: { tint: [255, 255, 255], text: [0x3b, 0x41, 0x48], behind: 1.03, base: 0.06, most: 0.8, aim: 4.5 },
  },
};
export const TO_LIGHT = 0.5, TO_DARK = 0.3;

const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const lightness = p => { const y = lum(p); return (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100; };

export const under = (px, a, kind = 'dark', K = KINDS[kind]) => px.map((v, k) => Math.min(1, v * K.behind) * (1 - a) + K.tint[k] / 255 * a);

export function tintFor(pixels, kind = 'dark', K = KINDS[kind]) {
  const aim = K.aim ?? AIM;
  if (!pixels.length) return { a: K.base, ratio: null };
  const ranked = pixels.map(p => [lum(p), p]).sort((x, y) => x[0] - y[0]);
  const i = kind === 'dark' ? Math.min(ranked.length - 1, Math.floor(ranked.length * 0.9)) : Math.floor(ranked.length * 0.1);
  const worst = ranked[i][1], L_TEXT = lum(K.text.map(v => v / 255));
  for (let a = K.base; a <= K.most + 1e-9; a += 0.01) {
    const r = contrast(L_TEXT, lum(under(worst, a, kind, K)));
    if (r >= aim) return { a, ratio: r, worst };
  }
  return { a: K.most, ratio: contrast(L_TEXT, lum(under(worst, K.most, kind, K))), worst };
}

export class Glass {
  constructor(vp, panels, { kind = 'dark', onKind = null } = {}) {
    this.vp = vp;
    this.panels = panels;
    this.kind = kind;
    this.mode = kind;
    this.material = 'frosted';
    this.onKind = onKind;
    this.last = new Map();
    this.picture = null;
    this.busy = false;
    this.timer = setInterval(() => this.check(), 500);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'scene') this.setKind(mode);
  }

  setKind(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    for (const p of this.panels) p.style.removeProperty('--glass');
    this.last.clear();
    if (this.onKind) this.onKind(kind);
  }

  setMaterial(m) {
    this.material = MATERIAL_KINDS[m] ? m : 'frosted';
    for (const p of this.panels) p.style.removeProperty('--glass');
    this.last.clear();
  }

  async check() {
    if (this.busy || document.hidden) return;
    const shown = this.panels.filter(p => !p.hidden && p.getBoundingClientRect().width > 0);
    if (!shown.length) return;
    this.busy = true;
    try {
      const rects = shown.map(p => { const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      const res = await this.vp.sampleScreen(rects);
      if (this.mode === 'scene') {
        const all = res.flat().map(lightness).sort((x, y) => x - y);
        if (all.length) {
          this.picture = all[Math.floor(all.length / 2)];
          if (this.kind === 'dark' && this.picture > TO_LIGHT) this.setKind('light');
          else if (this.kind === 'light' && this.picture < TO_DARK) this.setKind('dark');
        }
      }
      const K = MATERIAL_KINDS[this.material][this.kind];
      shown.forEach((p, i) => {
        const t = tintFor(res[i] || [], this.kind, K);
        const was = this.last.get(p);
        if (!was || Math.abs(was.a - t.a) > 0.015) p.style.setProperty('--glass', `rgba(${K.tint.join(', ')}, ${t.a.toFixed(3)})`);
        this.last.set(p, { a: was && Math.abs(was.a - t.a) <= 0.015 ? was.a : t.a, ratio: t.ratio, id: p.id, kind: this.kind, material: this.material });
      });
    } finally { this.busy = false; }
  }
}
