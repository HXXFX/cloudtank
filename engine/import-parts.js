export const MAX_PARTS = 128;

export class PartBuilder {
  constructor() { this.parts = []; this.by = new Map(); }
  part(key, name, look) {
    let p = this.by.get(key);
    if (!p) {
      p = { name: name || `Part ${this.parts.length + 1}`, look: look || {}, pos: [], nor: [], uv: [], someUv: false, someNormal: false };
      this.by.set(key, p);
      this.parts.push(p);
    }
    return p;
  }
  static corner(p, x, y, z, nx, ny, nz, u, v) {
    p.pos.push(x, y, z);
    if (nx !== undefined && nx !== null) { p.nor.push(nx, ny, nz); p.someNormal = true; } else p.nor.push(0, 0, 0);
    if (u !== undefined && u !== null) { p.uv.push(u, v); p.someUv = true; } else p.uv.push(0, 0);
  }
  finish() {
    let parts = this.parts.filter(p => p.pos.length);
    if (parts.length > MAX_PARTS) {
      const merged = new Map();
      for (const p of parts) {
        const k = JSON.stringify(p.look);
        const m = merged.get(k);
        if (!m) { merged.set(k, p); continue; }
        for (const f of ['pos', 'nor', 'uv']) for (let i = 0; i < p[f].length; i += 65536) m[f].push(...p[f].slice(i, i + 65536));
        m.someUv ||= p.someUv; m.someNormal ||= p.someNormal;
      }
      parts = [...merged.values()].slice(0, MAX_PARTS);
    }
    let corners = 0;
    for (const p of parts) corners += p.pos.length / 3;
    const positions = new Float32Array(corners * 3), normals = new Float32Array(corners * 3), uvs = new Float32Array(corners * 2);
    let at = 0, anyUv = false;
    const out = [];
    for (const p of parts) {
      positions.set(p.pos, at * 3);
      for (let i = 0; i < p.pos.length; i += 9) {
        const has = p.nor[i] || p.nor[i + 1] || p.nor[i + 2] || p.nor[i + 3] || p.nor[i + 4] || p.nor[i + 5] || p.nor[i + 6] || p.nor[i + 7] || p.nor[i + 8];
        if (has) { for (let k = 0; k < 9; k++) normals[at * 3 + i + k] = p.nor[i + k]; continue; }
        const P = p.pos;
        const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        for (let k = 0; k < 3; k++) { normals[at * 3 + i + k * 3] = nx; normals[at * 3 + i + k * 3 + 1] = ny; normals[at * 3 + i + k * 3 + 2] = nz; }
      }
      if (p.someUv) { uvs.set(p.uv, at * 2); anyUv = true; }
      const count = p.pos.length / 3;
      out.push({ name: p.name, first: at, count, look: p.look });
      at += count;
    }
    return { positions, normals, uvs: anyUv ? uvs : null, parts: out };
  }
}

export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function translate(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
export function scaling(x, y, z) { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; }
export function rotX(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; }
export function rotY(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
export function rotZ(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export function quatMatrix(x, y, z, w) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
}
export function invert4(m) {
  const a = m, b = new Array(16);
  b[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  b[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  b[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  b[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  b[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  b[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  b[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  b[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  b[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  b[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  b[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  b[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  b[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  b[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  b[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  b[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * b[0] + a[1] * b[4] + a[2] * b[8] + a[3] * b[12];
  const k = det ? 1 / det : 0;
  return b.map(v => v * k);
}
export const applyPoint = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
export function applyNormal(inv, x, y, z) {
  const nx = inv[0] * x + inv[1] * y + inv[2] * z, ny = inv[4] * x + inv[5] * y + inv[6] * z, nz = inv[8] * x + inv[9] * y + inv[10] * z;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
export const baseName = p => String(p).replace(/\\/g, '/').split('/').pop();
export const findFile = (files, p) => { const n = baseName(p).toLowerCase(); return [...(files || [])].find(f => f.name.toLowerCase() === n) || null; };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff', tga: 'image/x-tga', exr: 'image/x-exr' };
export const mimeOf = name => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
export const readableImage = name => /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(name);

export class ImageList {
  constructor() { this.list = []; this.by = new Map(); this.missing = []; }
  add(key, blob, name) {
    if (this.by.has(key)) return this.by.get(key);
    const k = `file-image-${this.list.length}`;
    this.list.push({ key: k, blob, name });
    this.by.set(key, k);
    return k;
  }
}
