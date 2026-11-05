
export const MATERIALS = {
  frosted: { label: "Today's glass", lens: 0 },
  liquid: { label: 'Liquid glass', lens: 30, band: 22 },
  clear: { label: 'Liquid glass, clear', lens: 34, band: 22 },
};

const NS = 'http://www.w3.org/2000/svg';

export function lensMap(w, h, r, band) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const qx = Math.max(r - x, 0, x - (w - 1 - r)), qy = Math.max(r - y, 0, y - (h - 1 - r));
    let dist, nx = 0, ny = 0;
    if (qx > 0 && qy > 0) {
      const q = Math.hypot(qx, qy);
      dist = r - q;
      nx = (x < w / 2 ? -1 : 1) * qx / q; ny = (y < h / 2 ? -1 : 1) * qy / q;
    } else {
      const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y);
      dist = Math.min(ex, ey);
      if (ex <= ey) nx = x < w / 2 ? -1 : 1; else ny = y < h / 2 ? -1 : 1;
    }
    const t = Math.max(0, 1 - Math.max(dist, 0) / band), k = 1 - Math.sqrt(1 - t * t);
    const i = (y * w + x) * 4;
    d[i] = 128 - nx * k * 127; d[i + 1] = 128 - ny * k * 127; d[i + 2] = 128; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c.toDataURL();
}

export class Liquid {
  constructor(panels) {
    this.panels = panels.filter(Boolean);
    this.material = 'frosted';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('width', '0'); this.svg.setAttribute('height', '0');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.position = 'absolute';
    document.body.append(this.svg);
    this.seen = new Map();
    this.ro = new ResizeObserver(() => this.refresh());
    for (const p of this.panels) this.ro.observe(p);
  }

  set(material) {
    this.material = MATERIALS[material] ? material : 'frosted';
    document.documentElement.dataset.glass = this.material;
    this.seen.clear();
    this.refresh();
  }

  refresh() {
    const M = MATERIALS[this.material];
    this.panels.forEach((p, n) => {
      if (!M.lens) { p.style.removeProperty('--lens'); return; }
      const w = Math.round(p.offsetWidth), h = Math.round(p.offsetHeight);
      if (w < 8 || h < 8) return;
      const key = `${this.material}:${w}x${h}`;
      if (this.seen.get(p) === key) return;
      this.seen.set(p, key);
      const id = 'lens-' + n;
      let f = this.svg.querySelector('#' + id);
      if (!f) {
        f = document.createElementNS(NS, 'filter');
        f.id = id;
        f.setAttribute('color-interpolation-filters', 'sRGB');
        f.innerHTML = `<feImage result="map" preserveAspectRatio="none"/><feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G"/>`;
        this.svg.append(f);
      }
      for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) f.setAttribute(k, v);
      f.setAttribute('filterUnits', 'userSpaceOnUse');
      const img = f.querySelector('feImage');
      for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) img.setAttribute(k, v);
      const r = parseFloat(getComputedStyle(p).borderTopLeftRadius) || 0;
      img.setAttribute('href', lensMap(w, h, Math.min(r, w / 2, h / 2), M.band));
      f.querySelector('feDisplacementMap').setAttribute('scale', String(M.lens));
      p.style.setProperty('--lens', `url(#${id})`);
    });
  }
}
