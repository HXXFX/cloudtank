import { PartBuilder, IDENTITY, mul4, translate, scaling, rotX, rotY, rotZ, invert4, applyPoint, applyNormal, ImageList, findFile, mimeOf, baseName, readableImage } from './import-parts.js';

const MAGIC = 'Kaydara FBX Binary';

function readBinary(buf) {
  const dv = new DataView(buf), bytes = new Uint8Array(buf);
  const version = dv.getUint32(23, true), wide = version >= 7500;
  const text = new TextDecoder();
  let at = 27;
  const u = () => { if (wide) { const v = Number(dv.getBigUint64(at, true)); at += 8; return v; } const v = dv.getUint32(at, true); at += 4; return v; };
  const prop = () => {
    const t = String.fromCharCode(bytes[at++]);
    switch (t) {
      case 'Y': { const v = dv.getInt16(at, true); at += 2; return v; }
      case 'C': { const v = bytes[at]; at += 1; return !!v; }
      case 'I': { const v = dv.getInt32(at, true); at += 4; return v; }
      case 'F': { const v = dv.getFloat32(at, true); at += 4; return v; }
      case 'D': { const v = dv.getFloat64(at, true); at += 8; return v; }
      case 'L': { const v = dv.getBigInt64(at, true); at += 8; return Number(v); }
      case 'f': case 'd': case 'l': case 'i': case 'b': case 'c': {
        const n = dv.getUint32(at, true), enc = dv.getUint32(at + 4, true), size = dv.getUint32(at + 8, true);
        at += 12;
        const a = { arr: t, n, enc, start: at, size };
        at += size;
        return a;
      }
      case 'S': { const n = dv.getUint32(at, true); at += 4; const s = text.decode(bytes.subarray(at, at + n)); at += n; return s; }
      case 'R': { const n = dv.getUint32(at, true); at += 4; const r = { raw: bytes.subarray(at, at + n) }; at += n; return r; }
      default: throw new Error(`This FBX file holds a kind of value this app does not know (${t.charCodeAt(0)}).`);
    }
  };
  const node = () => {
    const end = u(), nProps = u();
    u();
    const nameLen = bytes[at++];
    if (end === 0 && nProps === 0 && nameLen === 0) return null;
    const name = text.decode(bytes.subarray(at, at + nameLen));
    at += nameLen;
    const props = [];
    for (let i = 0; i < nProps; i++) props.push(prop());
    const kids = [];
    while (at < end) { const k = node(); if (!k) break; kids.push(k); }
    at = end;
    return { name, props, kids };
  };
  const top = [];
  while (at < buf.byteLength - 13) { const k = node(); if (!k) break; top.push(k); }
  return { version, top, bytes };
}

function readText(src) {
  let i = 0;
  const n = src.length;
  const skip = () => {
    for (;;) {
      while (i < n && src.charCodeAt(i) <= 32) i++;
      if (src[i] === ';') { while (i < n && src[i] !== '\n') i++; continue; }
      return;
    }
  };
  const value = () => {
    skip();
    const c = src[i];
    if (c === '"') { const e = src.indexOf('"', i + 1); const s = src.slice(i + 1, e); i = e + 1; return s.replace('::', '\u0000\u0001'); }
    if (c === '*') { i++; while (i < n && /[0-9]/.test(src[i])) i++; return { listNext: true }; }
    let e = i;
    while (e < n && !',{}\r\n'.includes(src[e])) e++;
    const t = src.slice(i, e).trim();
    i = e;
    const v = Number(t);
    return t !== '' && Number.isFinite(v) ? v : t;
  };
  const body = () => {
    const kids = [];
    for (;;) {
      skip();
      if (i >= n) return kids;
      if (src[i] === '}') { i++; return kids; }
      const c = src.indexOf(':', i);
      if (c < 0) return kids;
      const name = src.slice(i, c).trim();
      i = c + 1;
      const props = [];
      let more = true, list = false;
      while (more) {
        skip();
        if (src[i] === '{') break;
        const before = src.lastIndexOf('\n', i);
        const v = value();
        if (v && v.listNext) { list = true; break; }
        props.push(v);
        let j = i;
        while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
        if (src[j] === ',') { i = j + 1; continue; }
        more = false;
        i = j;
        if (before < 0) break;
      }
      const node = { name, props, kids: [] };
      skip();
      if (src[i] === '{') { i++; node.kids = body(); }
      if (list) {
        const a = node.kids.find(k => k.name === 'a');
        node.props = a ? [{ nums: a.props.filter(x => typeof x === 'number') }] : [{ nums: [] }];
        node.kids = [];
      }
      kids.push(node);
    }
  };
  return { version: 0, top: body(), bytes: null };
}

const kid = (node, name) => (node ? node.kids.find(k => k.name === name) : null);
const kidsOf = (node, name) => (node ? node.kids.filter(k => k.name === name) : []);

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function numbersOf(tree, node) {
  if (!node) return null;
  const a = node.props[0];
  if (!a) return null;
  if (a.nums) return a.nums;
  if (!a.arr) return node.props.filter(x => typeof x === 'number');
  let raw = tree.bytes.subarray(a.start, a.start + a.size);
  if (a.enc === 1) raw = await inflate(raw);
  const copy = raw.slice().buffer;
  switch (a.arr) {
    case 'f': return new Float32Array(copy);
    case 'd': return new Float64Array(copy);
    case 'i': return new Int32Array(copy);
    case 'l': { const b = new BigInt64Array(copy); const o = new Array(b.length); for (let i = 0; i < b.length; i++) o[i] = Number(b[i]); return o; }
    default: return new Uint8Array(copy);
  }
}
function propsOf(node) {
  const out = {};
  for (const p of kidsOf(kid(node, 'Properties70'), 'P')) out[p.props[0]] = p.props.slice(4);
  return out;
}
const nameOf = v => String(v).split('\u0000')[0].split('::').pop();

const vec = (P, k, d = [0, 0, 0]) => (P[k] && P[k].length >= 3 ? P[k].slice(0, 3).map(Number) : d);
function rotOf(v, order = 0) {
  const x = rotX(v[0]), y = rotY(v[1]), z = rotZ(v[2]);
  const seq = [[z, y, x], [y, z, x], [x, z, y], [z, x, y], [y, x, z], [x, y, z]][order] || [z, y, x];
  return mul4(mul4(seq[0], seq[1]), seq[2]);
}
function localOf(P) {
  const order = P.RotationOrder ? Number(P.RotationOrder[0]) : 0;
  const T = translate(...vec(P, 'Lcl Translation')), R = rotOf(vec(P, 'Lcl Rotation'), order), S = scaling(...vec(P, 'Lcl Scaling', [1, 1, 1]));
  const Rp = translate(...vec(P, 'RotationPivot')), Sp = translate(...vec(P, 'ScalingPivot'));
  const Roff = translate(...vec(P, 'RotationOffset')), Soff = translate(...vec(P, 'ScalingOffset'));
  const active = !P.RotationActive || Number(P.RotationActive[0]) !== 0;
  const pre = active ? rotOf(vec(P, 'PreRotation')) : IDENTITY, post = active ? rotOf(vec(P, 'PostRotation')) : IDENTITY;
  let m = T;
  for (const x of [Roff, Rp, pre, R, invert4(post), invert4(Rp), Soff, Sp, S, invert4(Sp)]) m = mul4(m, x);
  return m;
}

export async function parseFbx(buf, files, name = 'model') {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(18, buf.byteLength)));
  const tree = head === MAGIC ? readBinary(buf) : readText(new TextDecoder().decode(buf));
  const root = n => tree.top.find(t => t.name === n);
  const objects = root('Objects');
  if (!objects) throw new Error('This does not look like an FBX file: it has no objects in it.');
  const notes = [];
  if (tree.version && tree.version < 7000) notes.push(`It is an old FBX (version ${tree.version}); newer ones are safer.`);

  const parentsOf = new Map(), childrenOf = new Map(), named = new Map();
  for (const c of kidsOf(root('Connections'), 'C')) {
    const [kind, child, parent, what] = c.props;
    (childrenOf.get(parent) || childrenOf.set(parent, []).get(parent)).push({ id: child, what: kind === 'OP' ? what : null });
    (parentsOf.get(child) || parentsOf.set(child, []).get(child)).push({ id: parent, what: kind === 'OP' ? what : null });
  }
  for (const k of objects.kids) named.set(k.props[0], k);
  const childNodes = (id, type) => (childrenOf.get(id) || []).map(x => ({ node: named.get(x.id), what: x.what, id: x.id })).filter(x => x.node && x.node.name === type);

  const G = propsOf(root('GlobalSettings'));
  const zUp = G.UpAxis ? Number(G.UpAxis[0]) === 2 : false;
  const toMetres = (G.UnitScaleFactor ? Number(G.UnitScaleFactor[0]) : 1) / 100;

  const world = new Map();
  const worldOf = id => {
    if (world.has(id)) return world.get(id);
    const node = named.get(id);
    if (!node || node.name !== 'Model') return IDENTITY;
    const up = (parentsOf.get(id) || []).find(p => named.get(p.id) && named.get(p.id).name === 'Model');
    const m = mul4(up ? worldOf(up.id) : IDENTITY, localOf(propsOf(node)));
    world.set(id, m);
    return m;
  };

  const images = new ImageList();
  const pictureOf = (tex) => {
    const fileName = kid(tex.node, 'RelativeFilename') ? kid(tex.node, 'RelativeFilename').props[0] : kid(tex.node, 'FileName') ? kid(tex.node, 'FileName').props[0] : '';
    const video = childNodes(tex.id, 'Video')[0];
    const content = video && kid(video.node, 'Content');
    const raw = content && content.props[0] && content.props[0].raw;
    const n = baseName(fileName) || (video ? nameOf(video.node.props[1]) : 'image');
    if (raw && raw.length && readableImage(n)) return images.add(`e${tex.id}`, new Blob([raw], { type: mimeOf(n) }), n);
    const f = findFile(files, n);
    if (f && readableImage(n)) return images.add(`f${n}`, f, n);
    if (n && !images.missing.includes(n)) images.missing.push(n);
    return null;
  };
  const looks = new Map();
  const lookOf = id => {
    if (looks.has(id)) return looks.get(id);
    const node = named.get(id), P = node ? propsOf(node) : {};
    const col = P.DiffuseColor || P.Diffuse;
    const k = P.DiffuseFactor ? Number(P.DiffuseFactor[0]) : 1;
    const look = { color: col ? col.slice(0, 3).map(v => Math.max(0, Number(v) * Math.min(k, 1))) : [0.8, 0.8, 0.8] };
    const shine = P.ShininessExponent || P.Shininess;
    look.pbr = { rough: shine ? Math.min(1, Math.max(0.02, Math.sqrt(2 / (Number(shine[0]) + 2)))) : 0.5 };
    const see = P.TransparencyFactor ? Number(P.TransparencyFactor[0]) : P.Opacity ? 1 - Number(P.Opacity[0]) : 0;
    if (see > 0.3) look.finish = 'glass';
    const em = P.EmissiveFactor ? Number(P.EmissiveFactor[0]) : 0;
    const emc = P.EmissiveColor || P.Emissive;
    if (em > 0 && emc && emc.slice(0, 3).some(v => Number(v) > 0)) look.pbr.glow = Math.min(em, 10);
    const maps = {};
    for (const t of childNodes(id, 'Texture')) {
      const pic = pictureOf(t);
      if (!pic) continue;
      const w = String(t.what || '');
      if (/^DiffuseColor$|^Diffuse$|base_color/i.test(w)) maps.color = pic;
      else if (/NormalMap/i.test(w)) maps.normal = pic;
      else if (/^Bump$/i.test(w)) maps.bump = pic;
      else if (/Shininess|rough/i.test(w)) { maps.rough = pic; look.pbr.rough = 1; }
      else if (/Reflection|metal/i.test(w)) { maps.metal = pic; look.pbr.metal = 1; }
      else if (/Transparent|Opacity/i.test(w)) maps.alpha = pic;
    }
    if (Object.keys(maps).length) look.tex = { maps, map: 'uv', w: 1, h: 1 };
    looks.set(id, look);
    return look;
  };

  const B = new PartBuilder();
  let polygons = 0, skinned = 0;
  for (const modelNode of kidsOf(objects, 'Model')) {
    const id = modelNode.props[0];
    const geos = childNodes(id, 'Geometry').filter(g => g.node.props[2] === 'Mesh' || g.node.props.length < 3);
    if (!geos.length) continue;
    const P = propsOf(modelNode);
    const geom = mul4(mul4(translate(...vec(P, 'GeometricTranslation')), rotOf(vec(P, 'GeometricRotation'))), scaling(...vec(P, 'GeometricScaling', [1, 1, 1])));
    const M = mul4(mul4(scaling(toMetres, toMetres, toMetres), worldOf(id)), geom), inv = invert4(M);
    const flip = (M[0] * (M[5] * M[10] - M[6] * M[9]) - M[4] * (M[1] * M[10] - M[2] * M[9]) + M[8] * (M[1] * M[6] - M[2] * M[5])) < 0;
    const mats = childNodes(id, 'Material').map(m => m.id);
    for (const g of geos) {
      if (childNodes(g.id, 'Deformer').length) skinned++;
      const V = await numbersOf(tree, kid(g.node, 'Vertices')), PI = await numbersOf(tree, kid(g.node, 'PolygonVertexIndex'));
      if (!V || !PI) continue;
      const layer = (el, data, index) => {
        const L = kid(g.node, el);
        if (!L) return null;
        const mode = kid(L, 'MappingInformationType'), ref = kid(L, 'ReferenceInformationType');
        return { L, mode: mode ? String(mode.props[0]) : 'ByPolygonVertex', direct: !ref || String(ref.props[0]) === 'Direct', dataNode: kid(L, data), indexNode: kid(L, index) };
      };
      const nl = layer('LayerElementNormal', 'Normals', 'NormalsIndex'), ul = layer('LayerElementUV', 'UV', 'UVIndex'), ml = layer('LayerElementMaterial', 'Materials', null);
      const Nd = nl ? await numbersOf(tree, nl.dataNode) : null, Ni = nl && !nl.direct ? await numbersOf(tree, nl.indexNode) : null;
      const Ud = ul ? await numbersOf(tree, ul.dataNode) : null, Ui = ul && !ul.direct ? await numbersOf(tree, ul.indexNode) : null;
      const Md = ml ? await numbersOf(tree, ml.dataNode) : null;
      const base = nameOf(modelNode.props[1]);
      const pick = (lay, index, vertex, corner, polygon) => {
        const m = lay.mode;
        const k = m === 'ByPolygonVertex' ? corner : m === 'ByPolygon' ? polygon : m === 'AllSame' ? 0 : vertex;
        return index ? index[k] : k;
      };
      let corner = 0, poly = 0, ring = [];
      for (let i = 0; i < PI.length; i++) {
        let v = PI[i], end = false;
        if (v < 0) { v = -v - 1; end = true; }
        ring.push({ v, corner });
        corner++;
        if (!end) continue;
        polygons++;
        const matIndex = Md ? (ml.mode === 'AllSame' ? Md[0] : Md[poly]) : 0;
        const matId = mats[matIndex] ?? mats[0];
        const mat = matId !== undefined ? named.get(matId) : null;
        const look = matId !== undefined ? lookOf(matId) : { color: [0.8, 0.8, 0.8] };
        const part = B.part(`${id}:${matIndex}`, mats.length > 1 && mat ? `${base} ${nameOf(mat.props[1])}` : base, look);
        for (let k = 1; k + 1 < ring.length; k++) {
          const tri = flip ? [ring[0], ring[k + 1], ring[k]] : [ring[0], ring[k], ring[k + 1]];
          for (const c of tri) {
            const p = applyPoint(M, V[c.v * 3], V[c.v * 3 + 1], V[c.v * 3 + 2]);
            let n = [null, null, null];
            if (Nd) { const q = pick(nl, Ni, c.v, c.corner, poly); n = applyNormal(inv, Nd[q * 3], Nd[q * 3 + 1], Nd[q * 3 + 2]); }
            let a = null, b = null;
            if (Ud) { const q = pick(ul, Ui, c.v, c.corner, poly); a = Ud[q * 2]; b = 1 - Ud[q * 2 + 1]; }
            PartBuilder.corner(part, p[0], p[1], p[2], n[0], n[1], n[2], a, b);
          }
        }
        ring = [];
        poly++;
      }
    }
  }
  if (!polygons) throw new Error('This FBX file has no meshes in it.');
  if (skinned) notes.push(`${skinned} of its meshes are skinned: they come in at rest, not posed.`);
  if (kidsOf(objects, 'AnimationCurve').length) notes.push('Its animation is not read.');
  if (images.missing.length) notes.push(`Pictures it names that were not found or cannot be read here: ${images.missing.join(', ')}. Pick them together with the model.`);
  const out = B.finish();
  return { ...out, images: images.list, zUp, notes, color: out.parts[0].look.color };
}
