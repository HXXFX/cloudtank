import { ARCH, STEPS, SHAPES } from './shapes.js';
import { ATLAS_RES, ATLAS_PAD } from './sdf.wgsl.js';

function sdBox(x, y, z, sx, sy, sz) {
  const dx = Math.abs(x) - sx, dy = Math.abs(y) - sy, dz = Math.abs(z) - sz;
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0);
}

function sdCone(x, y, z, h, r1) {
  const qx = Math.sqrt(x * x + z * z), qy = y;
  const k1x = 0, k1y = h, k2x = -r1, k2y = 2 * h;
  const cax = qx - Math.min(qx, qy < 0 ? r1 : 0), cay = Math.abs(qy) - h;
  const t = Math.min(Math.max(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0), 1);
  const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

export function shapeSdf(x, y, z, o, model) {
  const [sx, sy, sz] = o.size;
  const code = SHAPES[o.shape].code;
  const m = Math.min(sx, sy, sz);
  if (code === 1) return sdBox(x, y, z, sx, sy, sz);
  if (code === 2) {
    const ax = x / sx, ay = y / sy, az = z / sz, bx = ax / sx, by = ay / sy, bz = az / sz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k0 * (k0 - 1) / Math.max(k1, 1e-6);
  }
  if (code === 3) {
    const dx = Math.sqrt(x * x + z * z) - sx, dy = Math.abs(y) - sy, ox = Math.max(dx, 0), oy = Math.max(dy, 0);
    return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy);
  }
  if (code === 4) return sdCone(x, y, z, sy, sx);
  if (code === 5) {
    const ux = x / sx, uy = y / sy, uz = z / sz;
    const rr = Math.sqrt(ux * ux + uz * uz) - 0.7;
    return (Math.sqrt(rr * rr + uy * uy) - 0.3) * m;
  }
  if (code === 6) {
    const l = Math.hypot(sy, sx);
    return Math.max(sdBox(x, y, z, sx, sy, sz), (x * sy + y * sx) / l);
  }
  if (code === 7) {
    const ux = x / sx, uy = y / sy, r = ARCH.r, sp = ARCH.spring;
    const slx = Math.abs(ux) - r, sly = uy - sp;
    const dSlot = Math.hypot(Math.max(slx, 0), Math.max(sly, 0)) + Math.min(Math.max(slx, sly), 0);
    const dRound = Math.hypot(ux, uy - sp) - r;
    return Math.max(sdBox(x, y, z, sx, sy, sz), -Math.min(dSlot, dRound) * Math.min(sx, sy));
  }
  if (code === 8) {
    let d = 1e9;
    const w = 2 / STEPS;
    for (let i = 0; i < STEPS; i++) {
      const x1 = 1 - i * w, y1 = -1 + (i + 1) * w;
      const lx = (x1 - w) * sx, hx = x1 * sx, ly = -sy, hy = y1 * sy;
      d = Math.min(d, sdBox(x - (lx + hx) / 2, y - (ly + hy) / 2, z, (hx - lx) / 2, (hy - ly) / 2, sz));
    }
    return d;
  }
  return modelSdf(x, y, z, o, model);
}

function modelSdf(x, y, z, o, model) {
  const [sx, sy, sz] = o.size;
  if (!model || !model.field) return sdBox(x, y, z, sx, sy, sz);
  const P = ATLAS_PAD, N = ATLAS_RES;
  const u = [x / sx, y / sy, z / sz];
  const c = u.map(v => Math.min(Math.max(v, -P), P));
  const g = c.map(v => Math.min(Math.max((v / P * 0.5 + 0.5) * N - 0.5, 0), N - 1.0001));
  const i0 = g.map(Math.floor), f = g.map((v, k) => v - i0[k]);
  const F = model.field;
  const at = (i, j, k) => F[i + N * (j + N * k)];
  let d = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
    d += w * at(i0[0] + dx, i0[1] + dy, i0[2] + dz);
  }
  const p = model.prop;
  const k = Math.min(sx / p[0], sy / p[1], sz / p[2]);
  const ex = (u[0] - c[0]) * sx, ey = (u[1] - c[1]) * sy, ez = (u[2] - c[2]) * sz;
  return d * k + Math.hypot(ex, ey, ez);
}

export function shapeNormal(x, y, z, o, model, e = 0.002) {
  const nx = shapeSdf(x + e, y, z, o, model) - shapeSdf(x - e, y, z, o, model);
  const ny = shapeSdf(x, y + e, z, o, model) - shapeSdf(x, y - e, z, o, model);
  const nz = shapeSdf(x, y, z + e, o, model) - shapeSdf(x, y, z - e, o, model);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
