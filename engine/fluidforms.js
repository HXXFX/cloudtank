import { makeLayout, makeGroup, makeBuffer, UNIFORM, shaderModule, computePipeline } from './gpu.js';
import { FRAME_WGSL, BLOCKS_MOST } from './render.wgsl.js';
import { FLUID_ROWS, FLUID_FLOATS } from './sdf.wgsl.js';
import { FLUID_LOOK_WGSL, ART_SIZE, ART_LAYERS, GLYPH_BASE, GLYPH_SIZE, GLYPHS, ART_TEXELS } from './fluidlook.wgsl.js';
import { lookValue } from './fluids.js';

const BLOCK_HEAD =  `
struct BQ { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>, e: vec4<f32> };
@group(0) @binding(0) var<uniform> Q: BQ;
@group(0) @binding(1) var fieldIn: texture_3d<f32>;
@group(0) @binding(2) var<storage, read> who: array<u32>;
@group(0) @binding(3) var<storage, read_write> blocks: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>>;
const MOST = ${BLOCKS_MOST}u;
fn addBlock(lo: vec3<f32>, col: vec3<f32>) {
  let kind = u32(Q.e.x);
  let at = atomicAdd(&args[kind * 4u + 1u], 1u);
  if (at >= MOST) { return; }
  let side = Q.a.w;
  let base = (kind * MOST + at) * 2u;
  blocks[base] = vec4<f32>(lo + vec3<f32>(side * 0.5), side * 0.5);
  blocks[base + 1u] = vec4<f32>(col, Q.b.w);
}
`;
const BLOCK_LOOP =  `
  let b = vec3<f32>(g);
  if (any(b >= Q.b.xyz)) { return; }
  let lo = Q.a.xyz + b * Q.a.w;
  let q = (lo - Q.c.xyz) / Q.c.w;
  let n = vec3<i32>(Q.d.xyz);
  let c0 = clamp(vec3<i32>(floor(q + vec3<f32>(0.001))), vec3<i32>(0), n);
  let c1 = clamp(vec3<i32>(ceil(q + vec3<f32>(Q.a.w / Q.c.w - 0.001))), vec3<i32>(0), n);
  let row = u32(Q.b.w);
`;
const BLOCK_SMOKE = BLOCK_HEAD +  `
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
` + BLOCK_LOOP +  `
  var total = 0.0;
  var sum = vec4<f32>(0.0);
  for (var z = c0.z; z < c1.z; z = z + 1) {
    for (var y = c0.y; y < c1.y; y = y + 1) {
      for (var x = c0.x; x < c1.x; x = x + 1) {
        total = total + 1.0;
        if (who[u32(x + n.x * (y + n.y * z))] == row) { sum = sum + textureLoad(fieldIn, vec3<i32>(x, y, z), 0); }
      }
    }
  }
  if (total < 0.5) { return; }
  let amount = (sum.a + min(sum.r, min(sum.g, sum.b))) / total * Q.e.y;
  if (amount < 0.02 + Q.d.w * 0.3) { return; }
  addBlock(lo, sum.a / max(vec3<f32>(sum.a) + sum.rgb, vec3<f32>(1e-6)));
}`;
const BLOCK_WATER = BLOCK_HEAD +  `
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
` + BLOCK_LOOP +  `
  var total = 0.0;
  var won = 0.0;
  var dye = vec3<f32>(0.0);
  for (var z = c0.z; z < c1.z; z = z + 1) {
    for (var y = c0.y; y < c1.y; y = y + 1) {
      for (var x = c0.x; x < c1.x; x = x + 1) {
        total = total + 1.0;
        let v = who[u32(x + n.x * (y + n.y * z))];
        if (v != 0u && (v & 63u) == row) { won = won + 1.0; dye = dye + textureLoad(fieldIn, vec3<i32>(x, y, z), 0).rgb; }
      }
    }
  }
  if (total < 0.5 || won / total < Q.d.w) { return; }
  addBlock(lo, exp(-dye / max(won, 1.0)));
}`;
const BLOCK_END =  `
@group(0) @binding(0) var<storage, read_write> args: array<u32>;
@compute @workgroup_size(1)
fn main() {
  args[1] = min(args[1], ${BLOCKS_MOST}u);
  args[5] = min(args[5], ${BLOCKS_MOST}u);
}`;

const CELL_SHADER = FRAME_WGSL +  `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<uniform> FT: array<Fluid, ${FLUID_ROWS}>;
@group(0) @binding(2) var<uniform> Q: vec4<f32>;
@group(0) @binding(3) var fluidDepth: texture_2d<f32>;
@group(0) @binding(4) var fieldThick: texture_2d<f32>;
@group(0) @binding(5) var thick: texture_2d<f32>;
@group(0) @binding(6) var smokeDye: texture_3d<f32>;
@group(0) @binding(7) var smokeLight: texture_3d<f32>;
@group(0) @binding(8) var linSamp: sampler;
@group(0) @binding(9) var<storage, read> whoSmoke: array<u32>;
@group(0) @binding(10) var<storage, read> whoWater: array<u32>;
@group(0) @binding(11) var<storage, read> art: array<u32>;
@group(0) @binding(12) var<storage, read_write> cells: array<vec4<f32>>;
` + FLUID_LOOK_WGSL +  `
fn octUp(e: vec2<f32>) -> vec3<f32> {
  let y = 1.0 - abs(e.x) - abs(e.y);
  if (y >= 0.0) { return normalize(vec3<f32>(e.x, y, e.y)); }
  let s = (vec2<f32>(1.0) - abs(e.yx)) * vec2<f32>(select(-1.0, 1.0, e.x >= 0.0), select(-1.0, 1.0, e.y >= 0.0));
  return normalize(vec3<f32>(s.x, y, s.y));
}
fn waterWhoAt(p: vec3<f32>, rd: vec3<f32>) -> u32 {
  let h = F.liqMin.w;
  let n = vec3<i32>(round((F.liqMax.xyz - F.liqMin.xyz) / h));
  let c = vec3<i32>(floor((p + rd * h * 0.5 - F.liqMin.xyz) / h));
  for (var k = 0; k < 9; k = k + 1) {
    var d = vec3<i32>(0);
    if (k >= 1 && k <= 6) { d[(k - 1) / 2] = 1 - 2 * ((k - 1) % 2); }
    if (k >= 7) { d = vec3<i32>(round(rd * f32(k - 6))); }
    let q = c + d;
    if (any(q < vec3<i32>(0)) || any(q >= n)) { continue; }
    let v = whoWater[u32(q.x + n.x * (q.y + n.y * q.z))];
    if (v != 0u) { return v & 63u; }
  }
  return 0u;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let size = Q.y;
  let cols = u32(ceil(F.screen.x / size));
  let rows = u32(ceil(F.screen.y / size));
  if (g.x >= cols || g.y >= rows) { return; }
  let at = u32(Q.z) + 2u * (g.x + g.y * cols);
  var A = vec4<f32>(0.0);
  var B = vec4<f32>(1e9, 0.0, 0.0, 0.0);
  let w = u32(Q.x);
  let fc = (vec2<f32>(g.xy) + 0.5) * size;
  let shd = u32(FT[w].d.x + 0.5);
  if (Q.w < 0.5) {
    if (F.liquid.x > 1.5) {
      let px = min(vec2<i32>(fc), vec2<i32>(F.screen.xy) - vec2<i32>(1));
      let ld = textureLoad(fluidDepth, px, 0).x;
      if (ld < 1e8) {
        let vp = viewPos(fc, ld);
        let dist = length(vp);
        let rd = normalize(transpose(viewTurn()) * vp);
        let wp = F.eye.xyz + rd * dist;
        if (waterWhoAt(wp, rd) == w) {
          let th = textureLoad(thick, px, 0);
          var n = -rd;
          var depth = th.a * 0.3;
          var dye = th.rgb / max(th.a, 1e-4);
          if (F.liquid.x > 2.5) {
            let ft = textureLoad(fieldThick, px, 0);
            n = octUp(ft.yz);
            depth = ft.x * 1.4;
            dye = th.rgb;
          }
          var own = exp(-dye);
          if (FT[w].g.x >= 0.0) { let pic = artOnSurface(w, wp, n); own = mix(own, pic.rgb, FT[w].g.z * pic.a); }
          var v = clamp(0.45 + 0.55 * max(dot(n, F.keyDir.xyz), 0.0), 0.0, 1.0);
          if (shd == 2u || shd == 3u) { v = 1.0 - exp(-depth * 3.0 * FT[w].f.w); }
          A = vec4<f32>(pickedCol(fluidColour(w, own, v)), 1.0);
          B = vec4<f32>(dist, v, 0.0, 0.0);
        }
      }
    }
  } else if (F.smokeMin.w > 0.5) {
    let ndc = ndcOf(fc);
    let far = F.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
    let rd = normalize(far.xyz / far.w - F.eye.xyz);
    let bmin = F.smokeMin.xyz;
    let bmax = F.smokeMax.xyz;
    let hit = boxHit(F.eye.xyz, rd, bmin, bmax);
    var t = max(hit.x, 0.0);
    let stepLen = F.smokeDims.w * 0.75;
    var tau = 0.0;
    var sumC = vec3<f32>(0.0);
    var sumL = 0.0;
    var weight = 0.0;
    var first = -1.0;
    let dims = vec3<i32>(F.smokeDims.xyz);
    for (var i = 0; i < 320 && t < hit.y && tau < 6.0; i = i + 1) {
      let p = F.eye.xyz + rd * t;
      let c = clamp(vec3<i32>(floor((p - bmin) / F.smokeDims.w)), vec3<i32>(0), dims - vec3<i32>(1));
      if (whoSmoke[u32(c.x + dims.x * (c.y + dims.y * c.z))] == u32(Q.x)) {
        let uvw = (p - bmin) / (bmax - bmin);
        let d = textureSampleLevel(smokeDye, linSamp, uvw, 0.0);
        let amount = d.a + min(d.r, min(d.g, d.b));
        if (amount > 0.002) {
          let ts = amount * F.smokeMax.w * stepLen * FT[w].c.z;
          let k = exp(-tau) * (1.0 - exp(-ts));
          let lt = textureSampleLevel(smokeLight, linSamp, uvw, 0.0).rgb;
          sumC = sumC + d.a / max(vec3<f32>(d.a) + d.rgb, vec3<f32>(1e-6)) * k;
          sumL = sumL + (lt.r + lt.g + lt.b) / 3.0 * k;
          weight = weight + k;
          tau = tau + ts;
          if (first < 0.0) { first = t; }
        }
      }
      t = t + stepLen;
    }
    if (weight > 1e-4) {
      let cover = 1.0 - exp(-tau);
      var own = sumC / weight;
      if (FT[w].g.x >= 0.0) { let pic = artOnSurface(w, F.eye.xyz + rd * first, -rd); own = mix(own, pic.rgb, FT[w].g.z * pic.a); }
      let v = sqrt(cover) * (0.5 + 0.5 * sumL / weight);
      A = vec4<f32>(pickedCol(fluidColour(w, own, v)), smoothstep(0.01, 0.12, cover));
      B = vec4<f32>(first, v, 0.0, 0.0);
    }
  }
  cells[at] = A;
  cells[at + 1u] = B;
}`;

const CELL_FLUIDS = 4;
const SMALLEST_CELL = 4;

export class FluidForms {
  constructor(gpu, renderer) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.renderer = renderer;
    this.ready = false;
    this.building = null;
    this.layers = new Map();
    this.loading = new Map();
    this.glyphKey = '';
    this.glyphAt = new Map();
    this.cellBytes = 0;
    this.cellList = [];
  }

  ensure() {
    if (this.ready || this.building) return;
    this.building = this.build().catch(e => console.error(e)).finally(() => { this.building = null; });
  }
  async build() {
    const d = this.device;
    const lB = makeLayout(d, ['uniform-dyn', 'tex3d-u', 'read', 'storage', 'storage']);
    const lE = makeLayout(d, ['storage']);
    const lC = makeLayout(d, ['uniform', 'uniform', 'uniform-dyn', 'tex2d-u', 'tex2d-u', 'tex2d-u', 'tex3d', 'tex3d', 'sampler', 'read', 'read', 'read', 'storage']);
    this.lB = lB; this.lC = lC;
    const smoke = await shaderModule(d, BLOCK_SMOKE, 'blocks of smoke');
    const water = await shaderModule(d, BLOCK_WATER, 'blocks of water');
    const end = await shaderModule(d, BLOCK_END, 'blocks, their count');
    const cells = await shaderModule(d, CELL_SHADER, 'screen cells');
    this.pipes = {
      smoke: computePipeline(d, smoke, [lB], 'main', 'blocks of smoke'),
      water: computePipeline(d, water, [lB], 'main', 'blocks of water'),
      end: computePipeline(d, end, [lE], 'main', 'blocks, their count'),
      cells: computePipeline(d, cells, [lC], 'main', 'screen cells'),
    };
    this.blocks = makeBuffer(d, BLOCKS_MOST * 2 * 2 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'blocks of fluid');
    this.args = makeBuffer(d, 32, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, 'blocks to draw');
    this.blockQ = makeBuffer(d, 256 * 40, UNIFORM(), 'block lattices');
    this.cellQ = makeBuffer(d, 256 * CELL_FLUIDS, UNIFORM(), 'screen cells');
    this.endGroup = makeGroup(d, lE, [this.args]);
    this.renderer.blockBuf = this.blocks;
    this.ready = true;
  }

  ensureArt() {
    if (this.art) return;
    this.art = makeBuffer(this.device, ART_TEXELS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'pictures and letters on fluids');
    this.renderer.artBuf = this.art;
  }

  pictureLayer(id, vp, inUse) {
    if (this.layers.has(id)) return this.layers.get(id);
    const m = vp.scene.images.get(id);
    if (!m || this.loading.has(id)) return -1;
    let layer = -1;
    const taken = new Set([...this.layers.values(), ...this.loading.values()]);
    for (let k = 0; k < ART_LAYERS; k++) if (!taken.has(k)) { layer = k; break; }
    if (layer < 0) {
      for (const [other, k] of this.layers) if (!inUse.has(other)) { this.layers.delete(other); layer = k; break; }
      if (layer < 0) return -1;
    }
    this.ensureArt();
    this.loading.set(id, layer);
    createImageBitmap(m.blob, { resizeWidth: ART_SIZE, resizeHeight: ART_SIZE, resizeQuality: 'high' }).then(bmp => {
      const c = new OffscreenCanvas(ART_SIZE, ART_SIZE), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, ART_SIZE, ART_SIZE).data;
      this.device.queue.writeBuffer(this.art, layer * ART_SIZE * ART_SIZE * 4, px);
      this.layers.set(id, layer);
      this.loading.delete(id);
    }).catch(e => { this.loading.delete(id); console.error('A picture on a fluid:', e); });
    return -1;
  }

  setGlyphs(texts) {
    const key = JSON.stringify(texts.map(t => [t.row, t.chars, t.repeat]));
    if (key === this.glyphKey) return;
    this.glyphKey = key;
    this.ensureArt();
    this.glyphAt.clear();
    const c = new OffscreenCanvas(GLYPH_SIZE, GLYPH_SIZE), g = c.getContext('2d', { willReadFrequently: true });
    g.font = `600 ${Math.round(GLYPH_SIZE * 0.86)}px ui-monospace, Consolas, "Cascadia Mono", "Courier New", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const draw = ch => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, GLYPH_SIZE, GLYPH_SIZE);
      g.fillStyle = '#fff';
      g.fillText(ch, GLYPH_SIZE / 2, GLYPH_SIZE * 0.54);
      const px = g.getImageData(0, 0, GLYPH_SIZE, GLYPH_SIZE).data, out = new Uint32Array(GLYPH_SIZE * GLYPH_SIZE);
      let ink = 0;
      for (let i = 0; i < out.length; i++) { out[i] = px[i * 4]; ink += px[i * 4]; }
      return { ch, out, ink };
    };
    let next = 0;
    for (const t of texts) {
      const list = Array.from(t.chars || ' ').slice(0, 32).map(draw);
      if (!t.repeat) list.sort((a, b) => a.ink - b.ink);
      const count = Math.min(list.length, GLYPHS - next);
      for (let k = 0; k < count; k++) this.device.queue.writeBuffer(this.art, (GLYPH_BASE + (next + k) * GLYPH_SIZE * GLYPH_SIZE) * 4, list[k].out);
      this.glyphAt.set(t.row, { first: next, count });
      next += count;
    }
  }

  prepare(plan, vp) {
    const T = vp.fluids.data, F = FLUID_FLOATS, last = (FLUID_ROWS - 1) * F;
    const rows = vp.fluids.rows;
    if (plan.solids.length || plan.cells.length) this.ensure();
    const inUse = new Set();
    for (const e of vp.scene.emitters) if (e.look && e.look.picture) inUse.add(e.look.picture);
    for (let r = 1; r < rows.length; r++) {
      const e = rows[r], id = e && e.look && e.look.picture;
      if (id) T[r * F + 24] = this.pictureLayer(id, vp, inUse);
    }
    const texts = plan.cells.filter(c => lookValue(c.e.look, 'form') === 'text').map(c => ({ row: c.row, chars: lookValue(c.e.look, 'chars'), repeat: !!lookValue(c.e.look, 'repeat') }));
    if (texts.length) this.setGlyphs(texts);
    for (const t of texts) {
      const at = this.glyphAt.get(t.row);
      if (at) { T[t.row * F + 30] = at.first; T[t.row * F + 31] = at.count; }
    }
    this.cellList = [];
    if (this.ready && plan.cells.length) {
      const W = vp.renderer.width, H = vp.renderer.height;
      let at = 0;
      for (const c of plan.cells.slice(0, CELL_FLUIDS)) {
        const cols = Math.ceil(W / c.size), lines = Math.ceil(H / c.size);
        this.cellList.push({ ...c, at, cols, lines });
        at += cols * lines * 2;
      }
      const bytes = Math.max(at * 16, 16);
      if (bytes > this.cellBytes) {
        const most = Math.ceil(W / SMALLEST_CELL) * Math.ceil(H / SMALLEST_CELL) * 2 * 16 * CELL_FLUIDS;
        if (this.cellBuf) { const old = this.cellBuf; this.device.queue.onSubmittedWorkDone().then(() => old.destroy()); }
        this.cellBytes = Math.max(bytes, Math.min(most, bytes * 2));
        this.cellBuf = makeBuffer(this.device, this.cellBytes, GPUBufferUsage.STORAGE, 'fluids in screen cells');
        this.renderer.cellBuf = this.cellBuf;
      }
      this.cellList.forEach((c, k) => {
        T[last + k] = c.row;
        T[last + 4 + k] = c.size;
        T[last + 8 + k] = c.at;
      });
      T[last + 16] = this.cellList.length;
    }
  }

  runBlocks(pass, plan, vp) {
    this.hasBlocks = false;
    if (!this.ready || !plan.solids.length) return;
    const d = this.device, q = d.queue;
    q.writeBuffer(this.args, 0, new Uint32Array([36, 0, 0, 0, 36, 0, 0, 0]));
    let k = 0;
    const R = vp.region;
    for (const f of plan.solids) {
      if (k >= 40) break;
      const solver = f.smoke ? vp.smoke : vp.flip;
      if (!solver) continue;
      if (f.smoke ? !vp.display.smoke : !vp.display.liquid) continue;
      let side = Math.max(f.size, solver.cell);
      const extent = solver.max.map((v, i) => v - solver.min[i]);
      while (extent[0] * extent[1] * extent[2] / (side * side * side) > 3e6) side *= 1.1;
      const lo = solver.min.map(v => Math.floor(v / side) * side);
      const n = solver.max.map((v, i) => Math.ceil((v - lo[i]) / side));
      const L = f.e.look;
      const clear = lookValue(L, 'opacity') < 0.999 || ['xray', 'glow'].includes(lookValue(L, 'shade'));
      q.writeBuffer(this.blockQ, k * 256, new Float32Array([...lo, side, ...n, f.row, ...solver.min, solver.cell, ...solver.dims, lookValue(L, 'fill'), clear ? 1 : 0, vp.fluids.data[f.row * FLUID_FLOATS + 10], 0, 0]));
      const field = f.smoke ? solver.tex.dye[solver.k].createView() : solver.lookView;
      const who = f.smoke ? solver.whoNow : solver.buf.who;
      const group = makeGroup(d, this.lB, [{ buffer: this.blockQ, size: 80 }, field, who, this.blocks, this.args]);
      pass.setPipeline(f.smoke ? this.pipes.smoke : this.pipes.water);
      pass.setBindGroup(0, group, [k * 256]);
      pass.dispatchWorkgroups(...n.map(v => Math.ceil(v / 4)));
      k++;
    }
    pass.setPipeline(this.pipes.end);
    pass.setBindGroup(0, this.endGroup);
    pass.dispatchWorkgroups(1);
    this.hasBlocks = k > 0;
  }
  blocksToDraw() { return this.hasBlocks ? { args: this.args } : null; }

  cellsPassFor(plan, vp) {
    if (!this.ready || !this.cellList.length) return null;
    return (encoder, V) => {
      const R = this.renderer, d = this.device, smoke = vp.smoke, flip = vp.flip;
      this.ensureArt();
      this.cellList.forEach((c, k) => d.queue.writeBuffer(this.cellQ, k * 256, new Float32Array([c.row, c.size, c.at, c.smoke ? 1 : 0])));
      const group = makeGroup(d, this.lC, [R.frameBuf, R.fluidBuf, { buffer: this.cellQ, size: 16 }, V.fluidB, V.fieldThick, V.thick,
        smoke ? smoke.dyeView : R.noDye, smoke ? smoke.lightView : R.noLight, R.linear,
        smoke ? smoke.whoNow : R.noBuffer, flip ? flip.buf.who : R.noBuffer, this.art, this.cellBuf]);
      const pass = encoder.beginComputePass({ label: 'screen cells' });
      pass.setPipeline(this.pipes.cells);
      this.cellList.forEach((c, k) => {
        pass.setBindGroup(0, group, [k * 256]);
        pass.dispatchWorkgroups(Math.ceil(c.cols / 8), Math.ceil(c.lines / 8));
      });
      pass.end();
    };
  }
}
