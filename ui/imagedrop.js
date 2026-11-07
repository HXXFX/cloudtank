import { el } from './dom.js';
import { isImageFile, imageThumb } from '../engine/images.js';
import { MAP_SLOTS, guessSlot, setPbr, newDecal, fitTile, anyMap, pbrValue } from '../engine/material.js';

function firstLay(look, owner, vp, aspect) {
  const half = owner ? owner.size : null;
  const tex = look.tex;
  const m = owner && owner.model ? vp.scene.models.get(owner.model) : null;
  if (m && m.uvs) { Object.assign(tex, { map: 'uv', w: 1, h: 1 }); return; }
  if (owner && owner.shape === 'ball') {
    const c = 2 * Math.PI * Math.max(half[0], half[2]);
    Object.assign(tex, { map: 'ball', w: +c.toFixed(3), h: +(c / Math.max(aspect, 0.01)).toFixed(3) });
    return;
  }
  if (owner && (owner.shape === 'column' || owner.shape === 'cone')) {
    const c = 2 * Math.PI * Math.max(half[0], half[2]);
    Object.assign(tex, { map: 'cylinder', w: +c.toFixed(3), h: +(c / Math.max(aspect, 0.01)).toFixed(3) });
    return;
  }
  Object.assign(tex, fitTile(half, aspect));
}

export function setMap(vp, look, owner, slot, id) {
  const first = !anyMap(look);
  look.tex ||= {};
  look.tex.maps ||= {};
  look.tex.maps[slot] = id;
  if (first) firstLay(look, owner, vp, vp.imageAspect(id));
  if (slot === 'rough') setPbr(look, 'rough', 1);
  if (slot === 'metal') setPbr(look, 'metal', 1);
  if (slot === 'disp' && look.tex.disp === undefined) look.tex.disp = owner ? +(Math.max(...owner.size) * 0.1).toFixed(3) : 0.03;
}
export function removeMap(look, slot) {
  if (!look.tex || !look.tex.maps) return;
  delete look.tex.maps[slot];
  if (slot === 'rough' && pbrValue(look, 'rough') === 1 && look.pbr) { delete look.pbr.rough; }
  if (slot === 'metal' && pbrValue(look, 'metal') === 1 && look.pbr) { delete look.pbr.metal; }
  if (look.pbr && !Object.keys(look.pbr).length) delete look.pbr;
  if (!Object.keys(look.tex.maps).length) delete look.tex;
}
export function addDecal(vp, look, owner, id, at, dir) {
  const d = newDecal(id, at, dir, owner ? owner.size : null, vp.imageAspect(id));
  (look.decals ||= []).push(d);
  look.decalPick = look.decals.length - 1;
  return d;
}

function lookAt(vp, target) {
  if (target.kind === 'ground') return { look: vp.look.ground, owner: null, name: 'the ground' };
  const o = target.item;
  if (o.partLooks && target.part >= 0 && o.partLooks[target.part]) {
    const m = vp.scene.models.get(o.model);
    return { look: o.partLooks[target.part], owner: o, name: `${m.parts[target.part].name} on ${o.name}` };
  }
  return { look: o, owner: o, name: o.name };
}

const thumbOf = async (m) => (m.thumb ||= await imageThumb(m.blob));

export async function imageMenu(app, files, x, y) {
  const vp = app.vp, menu = document.getElementById('imgmenu');
  const images = files.filter(isImageFile);
  if (!images.length) return;
  const target = vp.surfaceAt(x, y);
  if (!target) return;
  const close = () => { menu.hidden = true; document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onOut, true); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter') { e.preventDefault(); useAs(chosen()); } };
  const onOut = e => { if (!e.target.closest('#imgmenu')) close(); };
  const url = URL.createObjectURL(images[0]);
  const one = images.length === 1;
  const name = one ? images[0].name : `${images.length} images`;

  if (target.kind === 'sky') {
    menu.replaceChildren(el('div', { class: 'imgh' }, el('img', { src: url, alt: '' }), el('div', {}, el('b', {}, name), el('span', {}, 'on the background'))),
      el('div', { class: 'imgb' }, el('button', { type: 'button', class: 'btn main', onclick: () => { close(); app.useBackground(images[0]); } }, 'Use as the background')));
    place(menu, x, y);
    document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onOut, true);
    return;
  }

  const { look, owner, name: onName } = lookAt(vp, target);
  let slot = guessSlot(images[0].name);
  const chips = el('div', { class: 'imgc', role: 'radiogroup', 'aria-label': 'What the picture holds' });
  const paintChips = () => { for (const b of chips.children) b.classList.toggle('on', b.dataset.slot === slot); };
  for (const [k, s] of Object.entries(MAP_SLOTS)) {
    if (k === 'disp' && !owner) continue;
    if (glassy(look) && !['color', 'bump', 'normal'].includes(k)) continue;
    const b = el('button', { type: 'button', role: 'radio', onclick: () => { slot = k; paintChips(); } }, s.label);
    b.dataset.slot = k;
    chips.append(b);
  }
  paintChips();
  const chosen = () => 'texture';
  const useAs = async how => {
    close();
    try {
      if (how === 'decal') {
        const id = await vp.addImage(images[0], images[0].name);
        addDecal(vp, look, owner, id, target.at, target.dir);
        finish(app, owner, look, 'decals');
        app.toast(`${images[0].name} is a decal on ${onName}. Drag it in the view to move it.`);
      } else if (one) {
        const id = await vp.addImage(images[0], images[0].name);
        setMap(vp, look, owner, slot, id);
        finish(app, owner, look);
        app.toast(`${images[0].name} is the ${MAP_SLOTS[slot].label.toLowerCase()} of ${onName}.`);
      } else {
        for (const f of images) setMap(vp, look, owner, guessSlot(f.name), await vp.addImage(f, f.name));
        finish(app, owner, look);
        app.toast(`${images.length} images are the maps of ${onName}, each by its name.`);
      }
    } catch (e) { console.error(e); app.toast('Could not read the image: ' + e.message, true); }
  };
  menu.replaceChildren(
    el('div', { class: 'imgh' }, el('img', { src: url, alt: '' }), el('div', {}, el('b', {}, name), el('span', {}, 'on ' + onName))),
    el('div', { class: 'imgb' },
      el('button', { type: 'button', class: 'btn main', title: 'Over its whole surface, repeating. Enter.', onclick: () => useAs('texture') }, 'Texture'),
      el('button', { type: 'button', class: 'btn', title: 'On this one place, where you dropped it', onclick: () => useAs('decal') }, 'Decal')),
    one ? el('div', { class: 'imgl' }, 'As a texture, the picture is the') : el('div', { class: 'imgl' }, images.map(f => `${f.name}: ${MAP_SLOTS[guessSlot(f.name)].label}`).join(' · ')),
    one ? chips : null);
  place(menu, x, y);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOut, true);
}
const glassy = t => t.finish === 'glass' || t.finish === 'frosted';

function place(menu, x, y) {
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x + 6, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y + 6, innerHeight - r.height - 8))}px`;
}

function finish(app, owner, look, cat = 'texture') {
  const vp = app.vp;
  if (owner) {
    if (owner.partLooks) owner.partPick = owner.partLooks.indexOf(look);
    vp.select(owner);
    app.showTab('scene');
  } else {
    vp.select(null);
    app.showTab('world');
  }
  app.commit();
  app.repaintAllPanels();
  app.showDecalHandles();
  const body = document.getElementById('body');
  const sec = body && body.querySelector(owner ? `section[data-cat="${cat}"]` : `section[data-cat="ground-${cat}"]`);
  if (sec && !sec.hidden) body.scrollTop = Math.max(0, sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8);
}

export function pickImageFile(done) {
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,.svg' });
  input.addEventListener('change', () => { if (input.files[0]) done(input.files[0]); });
  input.click();
}
