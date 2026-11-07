import { PartBuilder, IDENTITY, mul4, translate, scaling, rotX, rotY, rotZ, quatMatrix, invert4, applyPoint, applyNormal, ImageList, mimeOf, baseName, readableImage, findFile } from './import-parts.js';

async function readZip(buf) {
  const dv = new DataView(buf), bytes = new Uint8Array(buf);
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This .usdz is not a zip file, so it cannot be opened.');
  const n = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const out = [], text = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(at, true) !== 0x02014b50) break;
    const method = dv.getUint16(at + 10, true), size = dv.getUint32(at + 20, true), nl = dv.getUint16(at + 28, true), xl = dv.getUint16(at + 30, true), cl = dv.getUint16(at + 32, true), off = dv.getUint32(at + 42, true);
    const name = text.decode(bytes.subarray(at + 46, at + 46 + nl));
    const local = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    out.push({ name, method, size, start: local });
    at += 46 + nl + xl + cl;
  }
  const open = async f => {
    const raw = bytes.subarray(f.start, f.start + f.size);
    if (f.method === 0) return raw;
    const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  };
  return { files: out, open };
}

function lz4(src, srcAt, srcEnd, out, outAt) {
  let i = srcAt, o = outAt;
  while (i < srcEnd) {
    const t = src[i++];
    let lit = t >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    for (let k = 0; k < lit; k++) out[o++] = src[i++];
    if (i >= srcEnd) break;
    const dist = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = t & 15;
    if (len === 15) { let b; do { b = src[i++]; len += b; } while (b === 255); }
    len += 4;
    for (let k = 0; k < len; k++) { out[o] = out[o - dist]; o++; }
  }
  return o;
}
function fastDecompress(bytes, at, size, outSize) {
  const out = new Uint8Array(outSize), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = bytes[at];
  if (chunks === 0) { lz4(bytes, at + 1, at + size, out, 0); return out; }
  let p = at + 1, o = 0;
  for (let c = 0; c < chunks; c++) {
    const n = dv.getInt32(p, true);
    p += 4;
    o = lz4(bytes, p, p + n, out, o);
    p += n;
  }
  return out;
}
function decodeInts(buf, count) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const common = dv.getInt32(0, true);
  const codes = 4, values = codes + Math.ceil(count * 2 / 8);
  let v = values, prev = 0;
  const out = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const code = (buf[codes + (i >> 2)] >> ((i & 3) * 2)) & 3;
    let d;
    if (code === 0) d = common;
    else if (code === 1) { d = dv.getInt8(v); v += 1; }
    else if (code === 2) { d = dv.getInt16(v, true); v += 2; }
    else { d = dv.getInt32(v, true); v += 4; }
    prev = (prev + d) | 0;
    out[i] = prev;
  }
  return out;
}
const halfToFloat = h => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); };

function readCrate(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = p => Number(dv.getBigUint64(p, true));
  const ident = new TextDecoder().decode(bytes.subarray(0, 8));
  if (ident !== 'PXR-USDC') throw new Error('This USD file does not start as a USDC file should.');
  const vMajor = bytes[8], vMinor = bytes[9];
  const toc = u64(16), nSections = u64(toc);
  const sections = {};
  for (let i = 0; i < nSections; i++) {
    const at = toc + 8 + i * 32;
    let name = '';
    for (let k = 0; k < 16 && bytes[at + k]; k++) name += String.fromCharCode(bytes[at + k]);
    sections[name] = { start: u64(at + 16), size: u64(at + 24) };
  }
  const need = n => { if (!sections[n]) throw new Error(`This USDC file lacks its ${n} section.`); return sections[n].start; };
  let p = need('TOKENS');
  const nTokens = u64(p), rawSize = u64(p + 8), compSize = u64(p + 16);
  const tokenBytes = fastDecompress(bytes, p + 24, compSize, rawSize);
  const tokens = [], dec = new TextDecoder();
  for (let i = 0, s = 0; i < tokenBytes.length && tokens.length < nTokens; i++) if (tokenBytes[i] === 0) { tokens.push(dec.decode(tokenBytes.subarray(s, i))); s = i + 1; }
  p = need('STRINGS');
  const strings = [];
  { const n = u64(p); for (let i = 0; i < n; i++) strings.push(dv.getUint32(p + 8 + i * 4, true)); }
  const readInts = (at, count) => {
    const size = u64(at);
    const raw = fastDecompress(bytes, at + 8, size, 4 + Math.ceil(count * 2 / 8) + count * 4);
    return { ints: decodeInts(raw, count), next: at + 8 + size };
  };
  p = need('FIELDS');
  const nFields = u64(p);
  const fieldTokens = readInts(p + 8, nFields);
  p = fieldTokens.next;
  const repSize = u64(p);
  const repBytes = fastDecompress(bytes, p + 8, repSize, nFields * 8);
  const repDv = new DataView(repBytes.buffer, repBytes.byteOffset, repBytes.byteLength);
  const fields = [];
  for (let i = 0; i < nFields; i++) fields.push({ token: tokens[fieldTokens.ints[i]], rep: repDv.getBigUint64(i * 8, true) });
  p = need('FIELDSETS');
  const nSets = u64(p), setInts = readInts(p + 8, nSets).ints;
  p = need('PATHS');
  const nPaths = u64(p), n2 = u64(p + 8);
  const pi = readInts(p + 16, n2), ei = readInts(pi.next, n2), ji = readInts(ei.next, n2);
  const paths = new Array(nPaths);
  const build = (cur, parent) => {
    let hasChild, hasSibling, parentPath = parent;
    do {
      const me = cur++;
      if (parentPath === null) { parentPath = ''; paths[pi.ints[me]] = ''; }
      else {
        let t = ei.ints[me];
        const prop = t < 0;
        if (prop) t = -t;
        paths[pi.ints[me]] = prop ? `${parentPath}.${tokens[t]}` : `${parentPath}/${tokens[t]}`;
      }
      const j = ji.ints[me];
      hasChild = j > 0 || j === -1;
      hasSibling = j >= 0;
      if (hasChild) {
        if (hasSibling) build(me + j, parentPath);
        parentPath = paths[pi.ints[me]];
      }
    } while (hasChild || hasSibling);
  };
  build(0, null);
  p = need('SPECS');
  const nSpecs = u64(p);
  const sp = readInts(p + 8, nSpecs), sf = readInts(sp.next, nSpecs), st = readInts(sf.next, nSpecs);

  const countAt = at => (vMajor > 0 || vMinor >= 7 ? [u64(at), at + 8] : [dv.getUint32(at, true), at + 4]);
  const payload = rep => Number(rep & 0xFFFFFFFFFFFFn);
  const smallVec = (rep, n) => { const out = []; const v = payload(rep); for (let i = 0; i < n; i++) { const b = (v / 2 ** (8 * i)) & 255; out.push(b > 127 ? b - 256 : b); } return out; };
  const floats = (at, n, kind) => {
    const out = new Array(n);
    const size = kind === 'f' ? 4 : kind === 'd' ? 8 : 2;
    for (let i = 0; i < n; i++) { const q = at + i * size; out[i] = kind === 'f' ? dv.getFloat32(q, true) : kind === 'd' ? dv.getFloat64(q, true) : halfToFloat(dv.getUint16(q, true)); }
    return out;
  };
  const listOp = (at, read) => {
    const bits = bytes[at];
    let q = at + 1;
    const out = [];
    const take = () => { const n = u64(q); q += 8; const list = []; for (let i = 0; i < n; i++) { list.push(read(dv.getUint32(q, true))); q += 4; } return list; };
    for (const b of [2, 4, 8, 16, 32, 64]) if (bits & b) { const l = take(); if (b !== 8) out.push(...l); }
    return out;
  };
  const value = rep => {
    const type = Number((rep >> 48n) & 0xFFn), isArray = (rep >> 63n) & 1n, inline = (rep >> 62n) & 1n, packed = (rep >> 61n) & 1n;
    const at = payload(rep);
    const vecOf = (n, kind) => {
      if (inline) return smallVec(rep, n);
      return floats(at, n, kind);
    };
    const shape = { 19: [2, 'd'], 20: [2, 'f'], 21: [2, 'h'], 23: [3, 'd'], 24: [3, 'f'], 25: [3, 'h'], 27: [4, 'd'], 28: [4, 'f'], 29: [4, 'h'], 16: [4, 'd'], 17: [4, 'f'], 18: [4, 'h'] }[type];
    if (isArray) {
      if (at === 0) return [];
      const [n, q] = countAt(at);
      if (shape) return floats(q, n * shape[0], shape[1]);
      switch (type) {
        case 3: case 4: return packed ? Array.from(readInts(q, n).ints) : Array.from({ length: n }, (_, i) => dv.getInt32(q + i * 4, true));
        case 8: case 9: {
          const size = type === 8 ? 4 : 8, kind = type === 8 ? 'f' : 'd';
          if (!packed) return floats(q, n, kind);
          const code = String.fromCharCode(bytes[q]);
          if (code === 'i') return Array.from(readInts(q + 1, n).ints);
          const lut = dv.getUint32(q + 1, true), table = floats(q + 5, lut, kind), idx = readInts(q + 5 + lut * size, n).ints;
          return Array.from(idx, i => table[i]);
        }
        case 7: return floats(q, n, 'h');
        case 11: return Array.from({ length: n }, (_, i) => tokens[dv.getUint32(q + i * 4, true)]);
        case 1: return Array.from({ length: n }, (_, i) => !!bytes[q + i]);
        case 15: return floats(q, n * 16, 'd');
        default: return null;
      }
    }
    switch (type) {
      case 1: return !!Number(rep & 1n);
      case 2: return at & 255;
      case 3: case 4: return (at | 0);
      case 8: { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, at >>> 0, true); return b.getFloat32(0, true); }
      case 9: { if (inline) { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, at >>> 0, true); return b.getFloat32(0, true); } return dv.getFloat64(at, true); }
      case 10: return tokens[strings[at]];
      case 11: case 12: return tokens[at];
      case 15: {
        if (inline) { const d = smallVec(rep, 4); return [d[0], 0, 0, 0, 0, d[1], 0, 0, 0, 0, d[2], 0, 0, 0, 0, d[3]]; }
        return floats(at, 16, 'd');
      }
      case 16: case 17: case 18: { const q = vecOf(shape[0], shape[1]); return [q[3], q[0], q[1], q[2]]; }
      case 41: { const n = u64(at); return Array.from({ length: n }, (_, i) => tokens[dv.getUint32(at + 8 + i * 4, true)]); }
      case 32: return listOp(at, i => tokens[i]);
      case 34: return listOp(at, i => paths[i]);
      case 40: { const n = u64(at); return Array.from({ length: n }, (_, i) => paths[dv.getUint32(at + 8 + i * 4, true)]); }
      case 46: {
        const off = Number(dv.getBigInt64(at, true)), next = at + off;
        const rep1 = dv.getBigUint64(next + 8, true);
        return value(rep1);
      }
      default:
        if (shape) return vecOf(shape[0], shape[1]);
        return null;
    }
  };

  const prims = new Map();
  const primOf = path => {
    let pr = prims.get(path);
    if (!pr) { pr = { path, type: '', props: {}, meta: {}, kids: [] }; prims.set(path, pr); }
    return pr;
  };
  const SPEC_ATTR = 1, SPEC_PRIM = 6, SPEC_ROOT = 7, SPEC_REL = 8;
  for (let i = 0; i < nSpecs; i++) {
    const path = paths[sp.ints[i]], type = st.ints[i];
    const fs = {};
    for (let k = sf.ints[i]; k < setInts.length && setInts[k] !== -1; k++) {
      const f = fields[setInts[k]];
      fs[f.token] = f.rep;
    }
    if (type === SPEC_PRIM || type === SPEC_ROOT) {
      const pr = primOf(path || '/');
      if (fs.typeName !== undefined) pr.type = value(fs.typeName);
      if (fs.upAxis !== undefined) pr.meta.upAxis = value(fs.upAxis);
      if (fs.metersPerUnit !== undefined) pr.meta.metersPerUnit = value(fs.metersPerUnit);
      if (fs.references !== undefined || fs.payload !== undefined) pr.meta.refs = true;
    } else if (type === SPEC_ATTR || type === SPEC_REL) {
      const dot = path.lastIndexOf('.');
      const pr = primOf(path.slice(0, dot));
      const name = path.slice(dot + 1);
      const a = {};
      if (fs.default !== undefined) a.value = value(fs.default);
      else if (fs.timeSamples !== undefined) a.value = value(fs.timeSamples);
      if (fs.interpolation !== undefined) a.interpolation = value(fs.interpolation);
      if (fs.connectionPaths !== undefined) a.connect = value(fs.connectionPaths);
      if (fs.targetPaths !== undefined) a.targets = value(fs.targetPaths);
      if (fs.elementSize !== undefined) a.elementSize = value(fs.elementSize);
      pr.props[name] = a;
    }
  }
  return prims;
}

function readUsda(src) {
  let i = 0;
  const n = src.length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      return;
    }
  };
  const peek = s => { skip(); return src.startsWith(s, i); };
  const word = () => { skip(); const s = i; while (i < n && /[A-Za-z0-9_:.\-\[\]]/.test(src[i])) i++; return src.slice(s, i); };
  const string = () => {
    skip();
    const triple = src.startsWith('"""', i), q = triple ? '"""' : src[i];
    i += q.length;
    const e = src.indexOf(q, i);
    const s = src.slice(i, e);
    i = e + q.length;
    return s;
  };
  const value = () => {
    skip();
    const c = src[i];
    if (c === '"' || c === "'") return string();
    if (c === '@') { const e = src.indexOf('@', i + 1); const s = src.slice(i + 1, e); i = e + 1; return s; }
    if (c === '<') { const e = src.indexOf('>', i + 1); const s = src.slice(i + 1, e); i = e + 1; return { path: s }; }
    if (c === '[' || c === '(') {
      const close = c === '[' ? ']' : ')';
      i++;
      const out = [];
      for (;;) {
        skip();
        if (src[i] === close) { i++; break; }
        if (src[i] === ',') { i++; continue; }
        out.push(value());
      }
      return out;
    }
    const s = i;
    while (i < n && !/[\s,()\[\]{}<>]/.test(src[i])) i++;
    const t = src.slice(s, i), v = Number(t);
    return t !== '' && Number.isFinite(v) ? v : t;
  };
  const metadata = () => {
    const meta = {};
    if (!peek('(')) return meta;
    i++;
    for (;;) {
      skip();
      if (src[i] === ')') { i++; break; }
      if (src[i] === '"') { string(); continue; }
      let w = word();
      if (w === 'prepend' || w === 'append' || w === 'add' || w === 'delete' || w === 'reorder') w = word();
      if (!w) { i++; continue; }
      if (peek('=')) { i++; meta[w] = value(); }
    }
    return meta;
  };
  const flat = v => (Array.isArray(v) ? v.flat(Infinity) : v);
  const prims = new Map();
  const blockInto = (prim) => {
    for (;;) {
      skip();
      if (i >= n) return;
      if (src[i] === '}') { i++; return; }
      const s = i;
      const w = word();
      if (!w) { i++; continue; }
      if (w === 'def' || w === 'over' || w === 'class') {
        skip();
        let type = '';
        if (src[i] !== '"') type = word();
        const name = string();
        const meta = metadata();
        const path = `${prim.path === '/' ? '' : prim.path}/${name}`;
        const kid = { path, type, props: {}, meta: {}, kids: [] };
        if (meta.references || meta.payload) kid.meta.refs = true;
        prims.set(path, kid);
        skip();
        if (src[i] === '{') { i++; blockInto(kid); }
        continue;
      }
      if (w === 'variantSet') {
        while (i < n && src[i] !== '{') i++;
        let depth = 0;
        do { if (src[i] === '{') depth++; if (src[i] === '}') depth--; i++; } while (depth > 0 && i < n);
        continue;
      }
      let name = w, words = [w];
      for (;;) {
        skip();
        if (src[i] === '=' || src[i] === '(' || src[i] === '\n' || src[i] === '}' || i >= n) break;
        const c0 = src[i];
        if (c0 === '<' || c0 === '@' || c0 === '"') break;
        const x = word();
        if (!x) break;
        words.push(x);
        name = x;
      }
      const a = {};
      if (peek('=')) {
        i++;
        const v = value();
        const raw = v && v.path !== undefined ? v : Array.isArray(v) && v.length && v[0] && v[0].path !== undefined ? v : flat(v);
        if (name.endsWith('.connect')) { name = name.slice(0, -8); (prim.props[name] ||= {}).connect = [].concat(raw).map(x => x.path); }
        else if (words[0] === 'rel') { a.targets = [].concat(raw).map(x => x.path); prim.props[name] = a; }
        else if (name.endsWith('.timeSamples')) { name = name.slice(0, -12); }
        else { prim.props[name] = { ...(prim.props[name] || {}), value: raw }; }
      } else if (name.endsWith('.timeSamples')) {
        name = name.slice(0, -12);
      }
      if (peek('(')) { const m = metadata(); if (prim.props[name]) { if (m.interpolation) prim.props[name].interpolation = m.interpolation; if (m.elementSize) prim.props[name].elementSize = m.elementSize; } }
      if (name.includes('.timeSamples') || (peek('{') && !prim.props[name])) {
        if (peek('{')) { const e = src.indexOf(':', i); i = e + 1; const v = value(); prim.props[name] = { value: flat(v) }; let depth = 1; while (i < n && depth > 0) { if (src[i] === '{') depth++; if (src[i] === '}') depth--; i++; } }
      }
      if (i === s) i++;
    }
  };
  skip();
  if (src.startsWith('#usda', i)) { while (i < n && src[i] !== '\n') i++; }
  const root = { path: '/', type: '', props: {}, meta: {}, kids: [] };
  prims.set('/', root);
  const m = metadata();
  if (m.upAxis) root.meta.upAxis = m.upAxis;
  if (m.metersPerUnit) root.meta.metersPerUnit = m.metersPerUnit;
  blockInto(root);
  return prims;
}

const val = (p, k) => (p && p.props[k] ? p.props[k].value : undefined);
function localMatrix(prim) {
  const order = val(prim, 'xformOpOrder');
  if (!order) return IDENTITY;
  let m = IDENTITY;
  for (let op of order) {
    const inv = op.startsWith('!invert!');
    if (inv) op = op.slice(8);
    const v = val(prim, op);
    if (v === undefined) continue;
    const base = op.split(':')[1];
    let x = IDENTITY;
    if (base === 'transform') x = v.slice(0, 16);
    else if (base === 'translate') x = translate(v[0], v[1], v[2]);
    else if (base === 'scale') x = scaling(v[0], v[1], v[2]);
    else if (base === 'orient') x = quatMatrix(v[1], v[2], v[3], v[0]);
    else if (base === 'rotateX') x = rotX(+v);
    else if (base === 'rotateY') x = rotY(+v);
    else if (base === 'rotateZ') x = rotZ(+v);
    else if (/^rotate[XYZ]{3}$/.test(base)) {
      const R = { X: a => rotX(a), Y: a => rotY(a), Z: a => rotZ(a) }, order3 = base.slice(6);
      const rots = [...order3].map((c, k) => R[c](v[k]));
      x = mul4(mul4(rots[2], rots[1]), rots[0]);
    }
    m = mul4(m, inv ? invert4(x) : x);
  }
  return m;
}

export async function parseUsd(bytes, name, sidecar = [], filesInZip = null) {
  const textStart = new TextDecoder().decode(bytes.subarray(0, 8));
  const prims = textStart === 'PXR-USDC' ? readCrate(bytes) : readUsda(new TextDecoder().decode(bytes));
  const notes = [];
  for (const [path, p] of prims) { if (path === '/') continue; const i = path.lastIndexOf('/'); const up = prims.get(path.slice(0, i) || '/'); if (up) up.kids.push(p); }
  const root = prims.get('/') || { meta: {}, kids: [] };
  const images = new ImageList();
  const looks = new Map();

  const pathOf = c => String(c).split('.')[0];
  const shaderOf = c => prims.get(pathOf(c));
  const pictureFrom = async file => {
    const fileName = String(file).replace(/^[.][/]/, '');
    const clean = fileName.replace(/\[|\]/g, '');
    const inner = filesInZip && filesInZip.files.find(f => f.name === clean || baseName(f.name) === baseName(clean));
    if (inner && readableImage(inner.name)) {
      const b = await filesInZip.open(inner);
      return images.add(inner.name, new Blob([b.slice()], { type: mimeOf(inner.name) }), baseName(inner.name));
    }
    const f = findFile(sidecar, clean);
    if (f && readableImage(f.name)) return images.add(f.name, f, f.name);
    if (!images.missing.includes(baseName(clean))) images.missing.push(baseName(clean));
    return null;
  };
  const lookOf = async matPath => {
    if (looks.has(matPath)) return looks.get(matPath);
    const look = { color: [0.8, 0.8, 0.8], pbr: {} };
    looks.set(matPath, look);
    const mat = prims.get(matPath);
    const out = mat && mat.props['outputs:surface'] && mat.props['outputs:surface'].connect ? mat.props['outputs:surface'].connect[0] : null;
    const S = out ? shaderOf(out) : null;
    if (!S) return look;
    const input = k => S.props[`inputs:${k}`];
    const maps = {};
    const texOf = async (a, slot) => {
      if (!a || !a.connect) return false;
      const T = shaderOf(a.connect[0]);
      if (!T) return false;
      const file = val(T, 'inputs:file');
      if (!file) return false;
      const pic = await pictureFrom(file);
      if (pic) maps[slot] = pic;
      return !!pic;
    };
    const dc = input('diffuseColor');
    if (dc && dc.value) look.color = dc.value.slice(0, 3).map(Number);
    await texOf(dc, 'color');
    const r = input('roughness'), m = input('metallic');
    if (r && r.value !== undefined) look.pbr.rough = +r.value;
    if (m && m.value !== undefined) look.pbr.metal = +m.value;
    if (await texOf(r, 'rough')) look.pbr.rough = 1;
    if (await texOf(m, 'metal')) look.pbr.metal = 1;
    await texOf(input('normal'), 'normal');
    const op = input('opacity');
    if (op && op.value !== undefined && +op.value < 0.7) look.finish = 'glass';
    await texOf(op, 'alpha');
    const em = input('emissiveColor');
    if (em && em.value && em.value.some(v => +v > 0)) look.pbr.glow = Math.min(Math.max(...em.value.slice(0, 3).map(Number)), 10);
    if (Object.keys(maps).length) look.tex = { maps, map: 'uv', w: 1, h: 1 };
    if (!Object.keys(look.pbr).length) delete look.pbr;
    return look;
  };
  const bound = p => { const b = p.props['material:binding']; return b && b.targets && b.targets[0] ? b.targets[0] : null; };

  const B = new PartBuilder();
  let meshes = 0, refs = 0, skel = 0, rawSub = 0;
  const walk = async (p, parent, inherited) => {
    if (p.meta.refs) refs++;
    if (p.type === 'Skeleton' || p.type === 'SkelRoot') skel++;
    const M = mul4(parent, localMatrix(p));
    const matHere = bound(p) || inherited;
    if (p.type === 'Mesh') {
      const pts = val(p, 'points'), counts = val(p, 'faceVertexCounts'), idx = val(p, 'faceVertexIndices');
      if (pts && counts && idx) {
        meshes++;
        const inv = invert4(M);
        const nA = p.props.normals || p.props['primvars:normals'];
        const nD = nA && nA.value, nMode = nA ? (nA.interpolation || 'vertex') : null;
        const nIdx = val(p, 'primvars:normals:indices');
        const stName = ['primvars:st', 'primvars:UVMap', 'primvars:uv', 'primvars:map1', 'primvars:st0'].find(k => p.props[k] && p.props[k].value) || Object.keys(p.props).find(k => /^primvars:[^:]+$/.test(k) && /st|uv/i.test(k) && p.props[k].value);
        const stA = stName ? p.props[stName] : null, st = stA && stA.value, stMode = stA ? (stA.interpolation || 'vertex') : null;
        const stIdx = stName ? val(p, `${stName}:indices`) : null;
        const left = val(p, 'orientation') === 'leftHanded';
        const scheme = val(p, 'subdivisionScheme');
        if (scheme && scheme !== 'none') rawSub++;
        const subsets = p.kids.filter(k => k.type === 'GeomSubset' && val(k, 'indices'));
        const faceMat = new Map();
        for (const s of subsets) { const b = bound(s); if (b) for (const f of val(s, 'indices')) faceMat.set(f, s); }
        const base = p.path.split('/').pop();
        let at = 0;
        for (let f = 0; f < counts.length; f++) {
          const c = counts[f];
          const s = faceMat.get(f);
          const matPath = s ? bound(s) : matHere;
          const look = matPath ? await lookOf(matPath) : { color: [0.8, 0.8, 0.8] };
          const part = B.part(`${p.path}:${matPath}`, s ? `${base} ${s.path.split('/').pop()}` : base, look);
          for (let k = 1; k + 1 < c; k++) {
            const tri = left ? [at, at + k + 1, at + k] : [at, at + k, at + k + 1];
            for (const q of tri) {
              const v = idx[q];
              const pw = applyPoint(M, pts[v * 3], pts[v * 3 + 1], pts[v * 3 + 2]);
              let n = [null, null, null];
              if (nD) {
                let w = nMode === 'faceVarying' ? q : nMode === 'uniform' ? f : nMode === 'constant' ? 0 : v;
                if (nIdx) w = nIdx[w];
                n = applyNormal(inv, nD[w * 3], nD[w * 3 + 1], nD[w * 3 + 2]);
              }
              let a = null, b = null;
              if (st) {
                let w = stMode === 'faceVarying' ? q : stMode === 'uniform' ? f : stMode === 'constant' ? 0 : v;
                if (stIdx) w = stIdx[w];
                a = st[w * 2]; b = 1 - st[w * 2 + 1];
              }
              PartBuilder.corner(part, pw[0], pw[1], pw[2], n[0], n[1], n[2], a, b);
            }
          }
          at += c;
        }
      }
    }
    for (const k of p.kids) if (k.type !== 'GeomSubset') await walk(k, M, matHere);
  };
  await walk(root, IDENTITY, null);
  if (!meshes) throw new Error(refs ? 'This USD file holds its meshes in other files it refers to; export it as one file.' : 'This USD file has no meshes in it.');
  if (refs) notes.push(`${refs} references to other files or prims were not followed.`);
  if (skel) notes.push('Its skeletons are not read: meshes come in at rest.');
  if (rawSub) notes.push(`${rawSub} of its meshes ask to be smoothed by subdivision: they come in as their plain cage.`);
  if (images.missing.length) notes.push(`Pictures it names that were not found or cannot be read here: ${images.missing.join(', ')}.`);
  const out = B.finish();
  return { ...out, images: images.list, zUp: root.meta.upAxis === 'Z', notes, color: out.parts[0].look.color };
}

export async function parseUsdz(buf, name) {
  const zip = await readZip(buf);
  const first = zip.files.find(f => /\.(usdc|usda|usd)$/i.test(f.name));
  if (!first) throw new Error('This .usdz holds no USD file.');
  return parseUsd(await zip.open(first), name, [], zip);
}
