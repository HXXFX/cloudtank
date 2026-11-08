import { itemData, restoreItems } from './history.js';
import { copy } from './engine/environment.js';
import { assetModel } from './engine/assets.js';
import { wakeOldKits, clearOldTiles } from './start-scene.js';
import { imagesOf } from './engine/material.js';

const FORMAT = 'fluidsim-scene';
export const FILE_EXT = 'cloudtank';
const VERSION = 1;

export function sceneData(vp, { forFile }) {
  const s = vp.scene;
  const used = new Set(s.objects.filter(o => o.model && !o.made).map(o => o.model));
  const models = [...s.models.values()].filter(m => used.has(m.id)).map(m => m.asset ? { id: m.id, name: m.name, asset: m.asset, design: m.design || 1 } : ({
    id: m.id, name: m.name, prop: m.prop, zUp: m.zUp, color: m.color, fileHalf: m.fileHalf,
    positions: forFile ? toB64(m.positions) : m.positions,
    normals: forFile ? toB64(m.normals) : m.normals,
    ...(m.uvs ? { uvs: forFile ? toB64(m.uvs) : m.uvs } : {}), ...(m.parts ? { parts: m.parts } : {}),
  }));
  const look = copy({ ...vp.look, background: { ...vp.look.background, image: null } });
  const usedImages = new Set();
  imagesOf(vp.look.ground, usedImages);
  for (const o of s.objects) { imagesOf(o, usedImages); for (const p of o.partLooks || []) imagesOf(p, usedImages); }
  for (const e of s.emitters) if (e.look && e.look.picture) usedImages.add(e.look.picture);
  const images = [...usedImages].map(id => s.images.get(id)).filter(Boolean).map(m => ({ id: m.id, name: m.name, data: forFile ? m.dataUrl : m.blob }));
  return {
    format: FORMAT, version: VERSION, kits: 2, frosted: 1, savedAt: new Date().toISOString(),
    camera: { target: vp.camera.target, distance: vp.camera.distance, yaw: vp.camera.yaw, pitch: vp.camera.pitch, fov: vp.camera.fov },
    settings: { ...vp.settings }, look, region: copy(vp.region), fineness: { ...vp.fineness },
    objects: s.objects.map(itemData), emitters: s.emitters.map(itemData), lights: s.lights.map(itemData), marks: s.marks.map(itemData), models, images,
    image: vp.bgImage ? (forFile ? vp.bgImage.dataUrl : vp.bgImage.blob) : null,
    imageName: vp.bgImage ? vp.bgImage.name : null,
  };
}

export async function openScene(vp, data) {
  if (!data || data.format !== FORMAT) throw new Error('This is not a Cloudtank scene file.');
  vp.settings = { ...vp.settings, ...data.settings };
  vp.look = { ...vp.look, post: null, media: null, ...copy(data.look) };
  const want = data.region ? { region: data.region, fineness: data.fineness }
    : { area: data.area || 4, detail: data.detail || 'normal' };
  await vp.setSimulation(want);
  vp.clearModels();
  for (const m of data.models || []) {
    if (m.asset) {
      const made = assetModel(m.asset, m.design || 1);
      if (!made) throw new Error(`The scene uses a library object this version does not have (${m.asset}).`);
      vp.addModel(made, { id: m.id });
      continue;
    }
    vp.addModel({ name: m.name, prop: m.prop, zUp: m.zUp, color: m.color, fileHalf: m.fileHalf,
      positions: fromData(m.positions), normals: fromData(m.normals), uvs: m.uvs ? fromData(m.uvs) : null, parts: m.parts || null }, { id: m.id });
  }
  for (const m of data.images || []) {
    const blob = typeof m.data === 'string' ? await (await fetch(m.data)).blob() : m.data;
    await vp.addImage(blob, m.name, { id: m.id });
  }
  restoreItems(vp.scene, data);
  vp.ensureMade();
  if (!data.kits) wakeOldKits(vp.scene);
  if (!data.frosted) for (const o of vp.scene.objects) if (o.asset === 'frosted-ball' && o.finish === 'glass') o.finish = 'frosted';
  clearOldTiles(vp);
  vp.select(null);
  if (data.camera) Object.assign(vp.camera, { fov: 42 * Math.PI / 180 }, data.camera);
  await setImage(vp, data.image, data.imageName);
  await vp.whenModelsReady();
  vp.resetFluids();
  vp.emit('change');
}

export async function setImage(vp, src, name) {
  if (!src) { vp.bgImage = null; vp.setBackgroundImage(null); return; }
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  const bitmap = await createImageBitmap(blob);
  vp.bgImage = { blob, name: name || 'picture', dataUrl: await blobToDataUrl(blob), width: bitmap.width, height: bitmap.height };
  vp.setBackgroundImage(bitmap);
  return bitmap;
}

export function averageColours(bitmap) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0, 16, 16);
  const px = g.getImageData(0, 0, 16, 16).data;
  const avg = (y0, y1) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; n++; }
    return '#' + s.map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  };
  return { top: avg(0, 8), bottom: avg(8, 16) };
}

export function downloadScene(vp, name = 'scene') {
  const data = sceneData(vp, { forFile: true });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${FILE_EXT}`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return blob.size;
}


function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('fluidsim', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function autosaveWrite(vp) {
  const d = await db();
  const data = sceneData(vp, { forFile: false });
  await new Promise((resolve, reject) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(data, 'last');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  d.close();
}

export async function autosaveRead() {
  try {
    const d = await db();
    const v = await new Promise((resolve, reject) => {
      const r = d.transaction('kv').objectStore('kv').get('last');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    d.close();
    return v || null;
  } catch { return null; }
}

export async function autosaveClear() {
  const d = await db();
  await new Promise(resolve => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').delete('last'); tx.oncomplete = resolve; });
  d.close();
}


function toB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { b64: btoa(s) };
}

function fromData(v) {
  if (v instanceof Float32Array) return v;
  if (v && v.b64) {
    const s = atob(v.b64), bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }
  return new Float32Array(v);
}

function blobToDataUrl(blob) {
  return new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}
