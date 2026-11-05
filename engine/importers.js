
export const ACCEPT = '.glb,.gltf,.obj,.stl,.bin';
export const MAX_TRIANGLES = 1_000_000;

export async function readModelFiles(fileList) {
  const files = [...fileList];
  const main = files.find(f => /\.(glb|gltf|obj|stl)$/i.test(f.name));
  if (!main) throw new Error('No model file found. Use .glb, .gltf, .obj or .stl.');
  const ext = main.name.split('.').pop().toLowerCase();
  const name = main.name.replace(/\.[^.]+$/, '');
  let out;
  if (ext === 'glb') out = parseGlb(await main.arrayBuffer());
  else if (ext === 'gltf') out = await parseGltf(JSON.parse(await main.text()), null, files);
  else if (ext === 'obj') out = parseObj(await main.text());
  else out = parseStl(await main.arrayBuffer());
  if (!out.positions.length) throw new Error('The file has no triangles.');
  const triangles = out.positions.length / 9;
  if (triangles > MAX_TRIANGLES) throw new Error(`The model has ${triangles.toLocaleString('en-US')} triangles; the most this app takes is ${MAX_TRIANGLES.toLocaleString('en-US')}.`);
  return { name, triangles, zUp: ext === 'stl', ...out };
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


export function parseObj(text) {
  const v = [], vn = [], pos = [], nor = [];
  let haveNormals = true;
  const idx = (s, n) => { const i = parseInt(s, 10); return i < 0 ? n + i : i - 1; };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push([+p[1], +p[2], +p[3]]); }
    else if (line.startsWith('vn ')) { const p = line.split(/\s+/); vn.push([+p[1], +p[2], +p[3]]); }
    else if (line.startsWith('f ')) {
      const corners = line.split(/\s+/).slice(1).map(c => {
        const parts = c.split('/');
        return { v: idx(parts[0], v.length), n: parts[2] ? idx(parts[2], vn.length) : -1 };
      });
      for (let k = 1; k + 1 < corners.length; k++) {
        for (const c of [corners[0], corners[k], corners[k + 1]]) {
          const p = v[c.v];
          if (!p) throw new Error('The OBJ file refers to a point it does not have.');
          pos.push(p[0], p[1], p[2]);
          if (c.n >= 0 && vn[c.n]) nor.push(...vn[c.n]); else haveNormals = false;
        }
      }
    }
  }
  const positions = new Float32Array(pos);
  return { positions, normals: haveNormals && nor.length === pos.length ? new Float32Array(nor) : flatNormals(positions), color: null };
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


export function parseGlb(buf) {
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
  return parseGltfSync(json, [bin]);
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
  return parseGltfSync(json, buffers);
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

function parseGltfSync(json, buffers) {
  const used = json.extensionsRequired || [];
  if (used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression')) {
    throw new Error('This glTF is compressed (Draco or meshopt). Export it again without compression.');
  }
  const pos = [], nor = [];
  let color = null;
  const visit = (ni, parent) => {
    const node = json.nodes[ni];
    const m = mul4(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        if (prim.attributes.POSITION === undefined) continue;
        const P = readAccessor(json, buffers, prim.attributes.POSITION);
        const N = prim.attributes.NORMAL !== undefined ? readAccessor(json, buffers, prim.attributes.NORMAL) : null;
        const I = prim.indices !== undefined ? readAccessor(json, buffers, prim.indices) : null;
        if (!color && prim.material !== undefined) {
          const pbr = (json.materials[prim.material] || {}).pbrMetallicRoughness;
          if (pbr && pbr.baseColorFactor) color = pbr.baseColorFactor.slice(0, 3);
        }
        const count = I ? I.length : P.length / 3;
        for (let k = 0; k < count; k++) {
          const v = I ? I[k] : k;
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          if (N) {
            const a = N[v * 3], b = N[v * 3 + 1], c = N[v * 3 + 2];
            const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c;
            const l = Math.hypot(nx, ny, nz) || 1;
            nor.push(nx / l, ny / l, nz / l);
          }
        }
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: (json.nodes || []).map((_, i) => i) };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const n of scene.nodes || []) visit(n, identity);
  const positions = new Float32Array(pos);
  return { positions, normals: nor.length === pos.length ? new Float32Array(nor) : flatNormals(positions), color };
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
