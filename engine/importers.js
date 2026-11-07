import { PartBuilder, ImageList, findFile, mimeOf, baseName, readableImage, IDENTITY, mul4 as mul, invert4, applyPoint, applyNormal } from './import-parts.js';
import { parseFbx } from './import-fbx.js';
import { parseUsd, parseUsdz } from './import-usd.js';

export const ACCEPT = '.glb,.gltf,.obj,.mtl,.stl,.fbx,.usdz,.usdc,.usda,.usd,.bin';
export const MAX_TRIANGLES = 1_000_000;

export async function readModelFiles(fileList) {
  const files = [...fileList];
  const main = files.find(f => /\.(glb|gltf|obj|stl|fbx|usdz|usdc|usda|usd)$/i.test(f.name));
  if (!main) throw new Error('No model file found. Use .glb, .gltf, .fbx, .usdz, .obj or .stl.');
  const ext = main.name.split('.').pop().toLowerCase();
  const name = main.name.replace(/\.[^.]+$/, '');
  let out;
  if (ext === 'glb') out = await parseGlb(await main.arrayBuffer());
  else if (ext === 'gltf') out = await parseGltf(JSON.parse(await main.text()), null, files);
  else if (ext === 'fbx') out = await parseFbx(await main.arrayBuffer(), files, name);
  else if (ext === 'usdz') out = await parseUsdz(await main.arrayBuffer(), name);
  else if (ext === 'usdc' || ext === 'usda' || ext === 'usd') out = await parseUsd(new Uint8Array(await main.arrayBuffer()), name, files);
  else if (ext === 'obj') out = await parseObj(await main.text(), files);
  else out = parseStl(await main.arrayBuffer());
  if (!out.positions.length) throw new Error('The file has no triangles.');
  const triangles = out.positions.length / 9;
  if (triangles > MAX_TRIANGLES) throw new Error(`The model has ${triangles.toLocaleString('en-US')} triangles; the most this app takes is ${MAX_TRIANGLES.toLocaleString('en-US')}.`);
  return { name, triangles, zUp: ext === 'stl', ...out };
}

export async function looksFromFile(parsed, addImage) {
  const ids = new Map();
  for (const im of parsed.images || []) ids.set(im.key, await addImage(im.blob, im.name));
  return (parsed.parts || []).map(p => {
    const l = JSON.parse(JSON.stringify(p.look || {}));
    l.color ||= parsed.color || [0.8, 0.8, 0.8];
    l.finish ||= null;
    if (l.tex && l.tex.maps) {
      for (const k of Object.keys(l.tex.maps)) { const id = ids.get(l.tex.maps[k]); if (id) l.tex.maps[k] = id; else delete l.tex.maps[k]; }
      if (!Object.keys(l.tex.maps).length) delete l.tex;
    }
    return l;
  });
}

function flatNormals(p) {
  const n = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { n[i + k * 3] = nx; n[i + k * 3 + 1] = ny; n[i + k * 3 + 2] = nz; }
  }
  return n;
}


async function readMtl(text, files, images) {
  const out = new Map();
  let m = null;
  const pictureOf = (line) => {
    const n = line.trim().split(/\s+/).pop();
    const f = findFile(files, n);
    if (f && readableImage(f.name)) return images.add(f.name, f, f.name);
    if (!images.missing.includes(baseName(n))) images.missing.push(baseName(n));
    return null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim(), [word, ...rest] = line.split(/\s+/), arg = rest.join(' ');
    const w = (word || '').toLowerCase();
    if (w === 'newmtl') { m = { color: [0.8, 0.8, 0.8], pbr: {}, maps: {} }; out.set(arg, m); continue; }
    if (!m) continue;
    if (w === 'kd') m.color = rest.slice(0, 3).map(Number);
    else if (w === 'ns') m.pbr.rough = Math.min(1, Math.max(0.02, Math.sqrt(2 / (+rest[0] + 2))));
    else if (w === 'pr') m.pbr.rough = +rest[0];
    else if (w === 'pm') m.pbr.metal = +rest[0];
    else if (w === 'ke' && rest.slice(0, 3).some(v => +v > 0)) m.pbr.glow = Math.min(Math.max(...rest.slice(0, 3).map(Number)), 10);
    else if (w === 'd' && +rest[0] < 0.7) m.finish = 'glass';
    else if (w === 'tr' && +rest[0] > 0.3) m.finish = 'glass';
    else if (w === 'map_kd') m.maps.color = pictureOf(arg);
    else if (w === 'map_bump' || w === 'bump') m.maps.bump = pictureOf(arg);
    else if (w === 'norm' || w === 'map_kn') m.maps.normal = pictureOf(arg);
    else if (w === 'map_pr' || w === 'map_ns') { m.maps.rough = pictureOf(arg); m.pbr.rough = 1; }
    else if (w === 'map_pm') { m.maps.metal = pictureOf(arg); m.pbr.metal = 1; }
    else if (w === 'map_d') m.maps.alpha = pictureOf(arg);
  }
  const looks = new Map();
  for (const [k, x] of out) {
    const maps = Object.fromEntries(Object.entries(x.maps).filter(([, v]) => v));
    const look = { color: x.color, ...(x.finish ? { finish: x.finish } : {}), ...(Object.keys(x.pbr).length ? { pbr: x.pbr } : {}) };
    if (Object.keys(maps).length) look.tex = { maps, map: 'uv', w: 1, h: 1, bump: 0.005 };
    looks.set(k, look);
  }
  return looks;
}

export async function parseObj(text, files = []) {
  const v = [], vn = [], vt = [];
  const B = new PartBuilder(), images = new ImageList();
  const idx = (s, n) => { const i = parseInt(s, 10); return i < 0 ? n + i : i - 1; };
  const named = (text.match(/^mtllib\s+(.+)$/m) || [])[1];
  const mtl = (named && findFile(files, named.trim())) || files.find(f => /\.mtl$/i.test(f.name));
  const looks = mtl ? await readMtl(await mtl.text(), files, images) : new Map();
  const notes = [];
  if (named && !mtl) notes.push(`It names its materials in ${baseName(named.trim())}: pick that file with the model to keep its colours.`);
  let group = 'Part', mat = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
    else if (line.startsWith('vn ')) { const p = line.split(/\s+/); vn.push([+p[1], +p[2], +p[3]]); }
    else if (line.startsWith('vt ')) { const p = line.split(/\s+/); vt.push([+p[1], +p[2]]); }
    else if (line.startsWith('o ') || line.startsWith('g ')) group = line.slice(2).trim() || group;
    else if (line.startsWith('usemtl ')) mat = line.slice(7).trim();
    else if (line.startsWith('f ')) {
      const corners = line.split(/\s+/).slice(1).map(c => {
        const parts = c.split('/');
        return { v: idx(parts[0], v.length), t: parts[1] ? idx(parts[1], vt.length) : -1, n: parts[2] ? idx(parts[2], vn.length) : -1 };
      });
      const part = B.part(`${group}|${mat}`, mat && mat !== group ? `${group} ${mat}` : group, looks.get(mat) || { color: [0.8, 0.8, 0.8] });
      for (let k = 1; k + 1 < corners.length; k++) {
        for (const c of [corners[0], corners[k], corners[k + 1]]) {
          const p = v[c.v];
          if (!p) throw new Error('The OBJ file refers to a point it does not have.');
          const n = c.n >= 0 ? vn[c.n] : null, t = c.t >= 0 ? vt[c.t] : null;
          PartBuilder.corner(part, p[0], p[1], p[2], n ? n[0] : null, n ? n[1] : null, n ? n[2] : null, t ? t[0] : null, t ? 1 - t[1] : null);
        }
      }
    }
  }
  if (images.missing.length) notes.push(`Pictures it names that were not found or cannot be read here: ${images.missing.join(', ')}. Pick them together with the model.`);
  const out = B.finish();
  return { ...out, images: images.list, notes, color: mtl && out.parts[0] ? out.parts[0].look.color : null };
}


export function parseStl(buf) {
  const dv = new DataView(buf);
  const count = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (count > 0 && 84 + count * 50 === buf.byteLength) {
    const positions = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) positions[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    return { positions, normals: flatNormals(positions), color: null };
  }
  const text = new TextDecoder().decode(buf);
  const pos = [];
  for (const m of text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)) pos.push(+m[1], +m[2], +m[3]);
  const positions = new Float32Array(pos);
  return { positions, normals: flatNormals(positions), color: null };
}


export async function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('This .glb file does not start like one.');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return partsOfGltf(json, [bin], []);
}

async function parseGltf(json, _unused, files) {
  const buffers = [];
  for (const b of json.buffers || []) {
    if (!b.uri) { buffers.push(null); continue; }
    if (b.uri.startsWith('data:')) { buffers.push(await (await fetch(b.uri)).arrayBuffer()); continue; }
    const f = files.find(x => x.name === decodeURIComponent(b.uri.split('/').pop()));
    if (!f) throw new Error(`This .gltf needs its data file "${b.uri}". Pick both files together, or export a .glb.`);
    buffers.push(await f.arrayBuffer());
  }
  return partsOfGltf(json, buffers, files);
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, buffers, index) {
  const acc = json.accessors[index];
  const n = COMPONENTS[acc.type], count = acc.count;
  const out = new Float32Array(count * n);
  if (acc.bufferView === undefined) return out;
  const view = json.bufferViews[acc.bufferView];
  const buf = buffers[view.buffer];
  const dv = new DataView(buf, (view.byteOffset || 0) + (acc.byteOffset || 0));
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
  const stride = view.byteStride || size * n;
  const read = {
    5120: o => dv.getInt8(o), 5121: o => dv.getUint8(o), 5122: o => dv.getInt16(o, true),
    5123: o => dv.getUint16(o, true), 5125: o => dv.getUint32(o, true), 5126: o => dv.getFloat32(o, true),
  }[acc.componentType];
  const norm = acc.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.componentType] : 0;
  for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) {
    let x = read(i * stride + k * size);
    if (norm) x = Math.max(x / norm, -1);
    out[i * n + k] = x;
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

async function partsOfGltf(json, buffers, files) {
  const used = json.extensionsRequired || [];
  if (used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression')) {
    throw new Error('This glTF is compressed (Draco or meshopt). Export it again without compression.');
  }
  const images = new ImageList(), notes = [];
  const pictureOf = async texIndex => {
    const t = json.textures && json.textures[texIndex];
    const source = t && (t.source !== undefined ? t.source : t.extensions && t.extensions.EXT_texture_webp && t.extensions.EXT_texture_webp.source);
    const im = source !== undefined && json.images ? json.images[source] : null;
    if (!im) return null;
    if (im.bufferView !== undefined) {
      const view = json.bufferViews[im.bufferView], o = view.byteOffset || 0;
      return images.add(`i${source}`, new Blob([new Uint8Array(buffers[view.buffer], o, view.byteLength).slice()], { type: im.mimeType || 'image/png' }), im.name || `image ${source}`);
    }
    if (im.uri && im.uri.startsWith('data:')) return images.add(`i${source}`, await (await fetch(im.uri)).blob(), im.name || `image ${source}`);
    const f = im.uri ? findFile(files, decodeURIComponent(im.uri)) : null;
    if (f) return images.add(`i${source}`, f, f.name);
    if (im.uri && !images.missing.includes(baseName(im.uri))) images.missing.push(baseName(im.uri));
    return null;
  };
  const looks = new Map();
  const lookOf = async index => {
    if (index === undefined) return { color: [0.8, 0.8, 0.8] };
    if (looks.has(index)) return looks.get(index);
    const mat = json.materials[index] || {}, pbr = mat.pbrMetallicRoughness || {}, ext = mat.extensions || {};
    const f = pbr.baseColorFactor || [1, 1, 1, 1];
    const look = { color: f.slice(0, 3), pbr: { rough: pbr.roughnessFactor ?? 1, metal: pbr.metallicFactor ?? 1 } };
    const maps = {};
    if (pbr.baseColorTexture) { const k = await pictureOf(pbr.baseColorTexture.index); if (k) { maps.color = k; look.color = [1, 1, 1]; } }
    const tex = {};
    if (pbr.metallicRoughnessTexture) {
      const k = await pictureOf(pbr.metallicRoughnessTexture.index);
      if (k) { maps.rough = k; maps.metal = k; tex.roughCh = 1; tex.metalCh = 2; }
    }
    if (mat.normalTexture) { const k = await pictureOf(mat.normalTexture.index); if (k) { maps.normal = k; tex.normalK = mat.normalTexture.scale ?? 1; } }
    const e = mat.emissiveFactor;
    if (e && e.some(v => v > 0)) look.pbr.glow = Math.min(Math.max(...e) * ((ext.KHR_materials_emissive_strength && ext.KHR_materials_emissive_strength.emissiveStrength) || 1), 10);
    if (ext.KHR_materials_clearcoat && ext.KHR_materials_clearcoat.clearcoatFactor) look.pbr.coat = ext.KHR_materials_clearcoat.clearcoatFactor;
    if (ext.KHR_materials_ior && ext.KHR_materials_ior.ior) look.pbr.ior = ext.KHR_materials_ior.ior;
    if (mat.alphaMode === 'MASK' && maps.color) { maps.alpha = maps.color; tex.alphaCh = 3; }
    const trans = (ext.KHR_materials_transmission && ext.KHR_materials_transmission.transmissionFactor) || 0;
    if (trans > 0.3 || (mat.alphaMode === 'BLEND' && f[3] < 0.7)) { look.finish = 'glass'; look.color = f.slice(0, 3); look.pbr = { rough: look.pbr.rough < 0.1 ? 0 : look.pbr.rough, ...(look.pbr.ior ? { ior: look.pbr.ior } : {}) }; }
    if (Object.keys(maps).length) look.tex = { maps, map: 'uv', w: 1, h: 1, ...tex };
    looks.set(index, look);
    return look;
  };
  const B = new PartBuilder();
  let skinned = 0;
  const visit = async (ni, parent) => {
    const node = json.nodes[ni];
    const m = mul4(parent, nodeMatrix(node));
    if (node.skin !== undefined) skinned++;
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh], inv = invert4(m);
      for (const [pi, prim] of mesh.primitives.entries()) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        if (prim.attributes.POSITION === undefined) continue;
        const P = readAccessor(json, buffers, prim.attributes.POSITION);
        const N = prim.attributes.NORMAL !== undefined ? readAccessor(json, buffers, prim.attributes.NORMAL) : null;
        const T = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, buffers, prim.attributes.TEXCOORD_0) : null;
        const I = prim.indices !== undefined ? readAccessor(json, buffers, prim.indices) : null;
        const look = await lookOf(prim.material);
        const base = node.name || mesh.name || `Mesh ${node.mesh}`;
        const matName = prim.material !== undefined && json.materials[prim.material].name;
        const part = B.part(`${ni}:${pi}`, mesh.primitives.length > 1 && matName ? `${base} ${matName}` : base, look);
        const count = I ? I.length : P.length / 3;
        for (let k = 0; k < count; k++) {
          const v = I ? I[k] : k;
          const p = applyPoint(m, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          const n = N ? applyNormal(inv, N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) : [null, null, null];
          PartBuilder.corner(part, p[0], p[1], p[2], n[0], n[1], n[2], T ? T[v * 2] : null, T ? T[v * 2 + 1] : null);
        }
      }
    }
    for (const c of node.children || []) await visit(c, m);
  };
  const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: (json.nodes || []).map((_, i) => i) };
  for (const n of scene.nodes || []) await visit(n, IDENTITY);
  if (skinned) notes.push(`${skinned} of its meshes are skinned: they come in at rest, not posed.`);
  if (json.animations && json.animations.length) notes.push('Its animation is not read.');
  if (images.missing.length) notes.push(`Pictures it names that were not found: ${images.missing.join(', ')}. Pick them together with the model.`);
  const out = B.finish();
  return { ...out, images: images.list, notes, color: out.parts[0] ? out.parts[0].look.color : null };
}

export function toUnitSpace(model) {
  const p = model.positions;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]);
  }
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  const half = lo.map((v, k) => Math.max((hi[k] - v) / 2, 1e-6));
  const big = Math.max(...half);
  const h = half.map(v => Math.max(v, big * 0.01));
  const positions = new Float32Array(p.length), normals = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) positions[i + k] = (p[i + k] - c[k]) / h[k];
    nx = model.normals[i] * h[0]; ny = model.normals[i + 1] * h[1]; nz = model.normals[i + 2] * h[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i] = nx / l; normals[i + 1] = ny / l; normals[i + 2] = nz / l;
  }
  return { positions, normals, prop: h.map(v => v / big), fileHalf: half };
}

export function interleave(positions, normals) {
  const out = new Float32Array(positions.length * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 6) {
    out[j] = positions[i]; out[j + 1] = positions[i + 1]; out[j + 2] = positions[i + 2];
    out[j + 3] = normals[i]; out[j + 4] = normals[i + 1]; out[j + 5] = normals[i + 2];
  }
  return out;
}
