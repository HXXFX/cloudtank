import { makeLayout, makeGroup, makeBuffer, UNIFORM, shaderModule } from './gpu.js';
import { POST_SHADER, POST_FLOATS, packPost } from './post.wgsl.js';
import { SCENE_SHADER, SHADOW_SHADER, FLUID_SHADER, BODY_SHADER, FIELD_SHADER, BLUR_SHADER, COMPOSITE_SHADER, FRAME_FLOATS,
  MAX_LIGHTS, LIGHT_LAYERS, LIGHT_SHADOW_SIZE, LIGHT_NEAR, LIGHT_FLOATS } from './render.wgsl.js';
import { unitMesh, BUILT_IN } from './shapes.js';
import { lookAt, ortho, multiply, fromAngles, scale, add, perspective } from './math.js';
import { BACKGROUNDS, FINISHES } from './environment.js';
import { OBJ_FLOATS } from './sdf.wgsl.js';

const SHADOW_SIZE = 2048;
export const MAX_DRAW = 80;

export function linear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

function displayed(hex, exposure) {
  return linear(hex).map(y => {
    const t = Math.min(y, 0.98);
    const a = 2.43 * t - 2.51, b = 0.59 * t - 0.03, c = 0.14 * t;
    const x = Math.abs(a) < 1e-6 ? -c / b : (-b - Math.sqrt(Math.max(b * b - 4 * a * c, 0))) / (2 * a);
    return Math.max(x, 0) / Math.max(exposure, 1e-3);
  });
}

export class Renderer {
  constructor(gpu, canvas) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.canvas = canvas;
    this.frameData = new Float32Array(FRAME_FLOATS);
    this.groupCache = new Map();
    this.width = 0;
    this.height = 0;
    this.meshes = new Map();
  }

  async init() {
    const d = this.device;
    this.context = this.canvas.getContext('webgpu');
    this.context.configure({ device: d, format: this.gpu.format, alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    for (const name of BUILT_IN) this.addMesh(name, unitMesh(name));
    this.frameBuf = makeBuffer(d, FRAME_FLOATS * 4, UNIFORM(), 'frame');
    this.drawBuf = makeBuffer(d, MAX_DRAW * OBJ_FLOATS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'draw list');
    this.postBuf = makeBuffer(d, POST_FLOATS * 4, UNIFORM(), 'picture look');
    this.postData = new Float32Array(POST_FLOATS);
    this.post = null;
    this.dirX = makeBuffer(d, 16, UNIFORM(), 'blur x');
    this.dirY = makeBuffer(d, 16, UNIFORM(), 'blur y');
    d.queue.writeBuffer(this.dirX, 0, new Float32Array([1, 0, 0, 0]));
    d.queue.writeBuffer(this.dirY, 0, new Float32Array([0, 1, 0, 0]));

    const tex3 = (format, data) => {
      const t = d.createTexture({ size: [1, 1, 1], dimension: '3d', format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      d.queue.writeTexture({ texture: t }, data, { bytesPerRow: data.byteLength }, [1, 1, 1]);
      return t.createView();
    };
    this.noDye = tex3('rgba16float', new Uint16Array(4));
    this.noLight = tex3('rgba16float', new Uint16Array(4).fill(0x3c00));
    this.noSky = tex3('rgba8unorm', new Uint8Array([255, 255, 255, 255]));
    this.noParticles = makeBuffer(d, 64, GPUBufferUsage.STORAGE, 'no particles');
    const noPic = d.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: noPic }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.bgView = noPic.createView();
    this.bgPanorama = false;

    this.shadowTex = d.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.shadowView = this.shadowTex.createView();
    this.lightShadow = null;
    this.lightLayerBufs = [];
    this.ensureLightShadow(0);
    this.linear = d.createSampler({ magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    this.wrapping = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    this.compare = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

    const L = {
      scene: makeLayout(d, ['uniform', 'read', 'read', 'read', 'depth', 'sampler-cmp', 'tex3d', 'tex3d', 'sampler', 'tex2d', 'sampler', 'depth-array'], 'render'),
      shadow: makeLayout(d, ['uniform', 'read', 'read'], 'render'),
      fluid: makeLayout(d, ['uniform', 'read', 'read', 'depth', 'tex2d-u'], 'render'),
      body: makeLayout(d, ['uniform', 'tex2d-u', 'tex3d', 'sampler'], 'render'),
      blur: makeLayout(d, ['uniform', 'uniform', 'tex2d-u'], 'render'),
      comp: makeLayout(d, ['uniform', 'tex2d', 'depth', 'tex2d-u', 'tex2d', 'tex3d', 'tex3d', 'sampler', 'depth', 'sampler-cmp', 'tex2d', 'sampler', 'tex3d', 'tex3d', 'tex2d-u', 'tex2d-u', 'depth-array', 'tex3d'], 'render'),
      post: makeLayout(d, ['uniform', 'tex2d', 'sampler'], 'render'),
    };
    this.L = L;
    const pl = l => d.createPipelineLayout({ bindGroupLayouts: [l] });
    const sceneMod = await shaderModule(d, SCENE_SHADER, 'scene');
    const shadowMod = await shaderModule(d, SHADOW_SHADER, 'shadow');
    const fluidMod = await shaderModule(d, FLUID_SHADER, 'liquid surface');
    const bodyMod = await shaderModule(d, BODY_SHADER, 'first body of water');
    const fieldMod = await shaderModule(d, FIELD_SHADER, 'water surface from the field');
    const blurMod = await shaderModule(d, BLUR_SHADER, 'smoothing');
    const compMod = await shaderModule(d, COMPOSITE_SHADER, 'final picture');
    const postMod = await shaderModule(d, POST_SHADER, 'picture look');

    const HDR = 'rgba16float';
    const depthOn = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    const meshBuffers = [{ arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
    const rp = (layout, module, vs, fs, targets, extra = {}) => d.createRenderPipeline({
      layout: pl(layout),
      vertex: { module, entryPoint: vs, buffers: extra.buffers || [] },
      fragment: fs ? { module, entryPoint: fs, targets } : undefined,
      primitive: { topology: extra.topology || 'triangle-list', cullMode: 'none' },
      depthStencil: extra.depth,
    });
    const blendAlpha = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const blendAdd = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    this.pipes = {
      sky: rp(L.scene, sceneMod, 'vsSky', 'fsSky', [{ format: HDR }], { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' } }),
      ground: rp(L.scene, sceneMod, 'vsGround', 'fsGround', [{ format: HDR }], { depth: depthOn }),
      obj: rp(L.scene, sceneMod, 'vsObj', 'fsObj', [{ format: HDR }], { depth: depthOn, buffers: meshBuffers }),
      glass: rp(L.scene, sceneMod, 'vsObj', 'fsGlass', [{ format: HDR, blend: blendAlpha }],
        { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' }, buffers: meshBuffers }),
      dots: rp(L.scene, sceneMod, 'vsDots', 'fsDots', [{ format: HDR }], { depth: depthOn }),
      lines: rp(L.scene, sceneMod, 'vsLines', 'fsLines', [{ format: HDR, blend: blendAlpha }],
        { topology: 'line-list', depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' } }),
      shadowObj: d.createRenderPipeline({ layout: pl(L.shadow), vertex: { module: shadowMod, entryPoint: 'vsShadowObj', buffers: meshBuffers },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthOn, depthBias: 2, depthBiasSlopeScale: 2 } }),
      shadowDots: rp(L.shadow, shadowMod, 'vsShadowDots', 'fsShadowDots', [], { depth: depthOn }),
      fluidDepth: rp(L.fluid, fluidMod, 'vsFluid', 'fsFluidDepth', [{ format: 'r32float' }], { depth: depthOn }),
      body: rp(L.body, bodyMod, 'vsFull', 'fsBody', [{ format: 'r32float' }]),
      field: rp(L.body, fieldMod, 'vsFull', 'fsField', [{ format: 'r32float' }, { format: 'r32float' }]),
      fluidThick: rp(L.fluid, fluidMod, 'vsFluid', 'fsFluidThick', [{ format: HDR, blend: blendAdd }]),
      blur: rp(L.blur, blurMod, 'vsFull', 'fsBlur', [{ format: 'r32float' }]),
      comp: rp(L.comp, compMod, 'vsFull', 'fsComposite', [{ format: this.gpu.format }]),
      post: rp(L.post, postMod, 'vsFull', 'fsPost', [{ format: this.gpu.format }]),
    };
  }

  addMesh(name, verts) {
    const vb = this.device.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vb, 0, verts);
    const old = this.meshes.get(name);
    if (old) old.vb.destroy();
    this.meshes.set(name, { vb, count: verts.length / 6 });
  }

  removeMesh(name) {
    const m = this.meshes.get(name);
    if (m) { m.vb.destroy(); this.meshes.delete(name); }
  }

  setBackgroundImage(bitmap) {
    const d = this.device;
    if (this.bgTexture) this.bgTexture.destroy();
    this.bgTexture = null;
    if (!bitmap) {
      const t = d.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      d.queue.writeTexture({ texture: t }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1]);
      this.bgView = t.createView();
      this.bgTexture = t;
    } else {
      const t = d.createTexture({ size: [bitmap.width, bitmap.height], format: 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      d.queue.copyExternalImageToTexture({ source: bitmap }, { texture: t }, [bitmap.width, bitmap.height]);
      this.bgView = t.createView();
      this.bgTexture = t;
      this.bgPanorama = Math.abs(bitmap.width / bitmap.height - 2) < 0.15;
    }
    if (this.groupCache) this.groupCache.clear();
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    for (const t of Object.values(this.targets || {})) t.destroy();
    const tex = (format, extra = 0) => d.createTexture({ size: [w, h], format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra });
    this.targets = {
      color: tex('rgba16float'),
      depth: tex('depth32float'),
      fluidRaw: tex('r32float'),
      fluidA: tex('r32float'),
      fluidB: tex('r32float'),
      fluidZ: tex('depth32float'),
      bodyFar: tex('r32float'),
      fieldThick: tex('r32float'),
      thick: tex('rgba16float'),
      post: tex(this.gpu.format),
    };
    this.views = Object.fromEntries(Object.entries(this.targets).map(([k, t]) => [k, t.createView()]));
    const V = this.views;
    this.blurGroups = [
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirX, V.fluidRaw]),
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirY, V.fluidA]),
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirX, V.fluidB]),
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirY, V.fluidA]),
    ];
    this.postGroup = makeGroup(d, this.L.post, [this.postBuf, V.post, this.linear]);
    this.groupCache = new Map();
  }

  setPost(p) { this.post = p ? { ...p } : null; }

  groups(smoke, particles) {
    const dye = smoke ? smoke.dyeView : this.noDye;
    const light = smoke ? smoke.lightView : this.noLight;
    const sky = smoke ? smoke.skyView : this.noSky;
    const pos = particles ? particles.pos : this.noParticles;
    const col = particles ? particles.col : this.noParticles;
    const water = particles ? particles.look : this.noDye;
    const field = particles && particles.field ? particles.field : null;
    const key = dye;
    if (this.groupStamp !== this.lightShadowStamp) { this.groupCache.clear(); this.groupStamp = this.lightShadowStamp; }
    let entry = this.groupCache.get(key);
    if (entry && entry.pos === pos && entry.water === water && entry.field === field) return entry;
    const d = this.device, V = this.views;
    entry = {
      pos, water, field,
      fieldGroup: field ? makeGroup(d, this.L.body, [this.frameBuf, V.fluidRaw, field, this.linear]) : null,
      scene: makeGroup(d, this.L.scene, [this.frameBuf, this.drawBuf, pos, col, this.shadowView, this.compare, dye, light, this.linear, this.bgView, this.wrapping, this.lightShadowView]),
      shadow: makeGroup(d, this.L.shadow, [this.frameBuf, this.drawBuf, pos]),
      fluid: makeGroup(d, this.L.fluid, [this.frameBuf, pos, col, V.depth, V.bodyFar]),
      body: makeGroup(d, this.L.body, [this.frameBuf, V.fluidRaw, water, this.linear]),
      comp: makeGroup(d, this.L.comp, [this.frameBuf, V.color, V.depth, V.fluidB, V.thick, dye, light, this.linear, this.shadowView, this.compare, this.bgView, this.wrapping, sky, water, V.bodyFar, V.fieldThick,
        this.lightShadowView, smoke && smoke.localView ? smoke.localView : this.noLight]),
    };
    this.groupCache.set(key, entry);
    return entry;
  }

  packFrame(o) {
    const f = this.frameData, cam = o.camera, L = o.look.light, B = o.look.background, G = o.look.ground;
    f.fill(0);
    f.set(cam.viewProj, 0); f.set(cam.view, 16); f.set(cam.proj, 32); f.set(cam.invViewProj, 48);
    const key = fromAngles(L.key.az, L.key.el);
    const center = o.shadowCenter || [0, 1, 0];
    const lv = lookAt(add(center, scale(key, 30)), center, Math.abs(key[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0]);
    const reach = o.shadowReach || 7;
    f.set(multiply(ortho(-reach, reach, -reach, reach, 1, 70), lv), 64);
    f.set([...cam.eye, o.time], 80);
    f.set([this.width, this.height, 1 / this.width, 1 / this.height], 84);
    f.set([...key, L.key.soft], 88);
    f.set([...scale(linear(L.key.color), L.key.power), 1], 92);
    f.set([...fromAngles(L.fill.az, L.fill.el), 0], 96);
    f.set([...scale(linear(L.fill.color), L.fill.power), 0], 100);
    f.set([...fromAngles(L.rim.az, L.rim.el), 0], 104);
    f.set([...scale(linear(L.rim.color), L.rim.power), 0], 108);
    f.set([...linear(L.ambSky), L.ambPower], 112);
    f.set([...linear(L.ambGround), 0], 116);
    const fin = FINISHES[G.finish] || FINISHES.matte;
    f.set([...linear(G.color), fin.code], 120);
    f.set([G.grid ? 1 : 0, fin.rough, 80, fin.spec], 124);
    const kind = (BACKGROUNDS[B.preset] || BACKGROUNDS.sky).kind;
    const top = displayed(B.top, L.exposure), bottom = displayed(B.bottom, L.exposure);
    const horizon = kind === 5 ? top : kind === 0 ? bottom : kind === 4 ? bottom.map((v, k) => (v + top[k]) / 2) : bottom;
    f.set([...horizon, B.haze * 0.06], 128);
    f.set([kind, L.exposure, o.look.weather.rain, this.bgPanorama ? 1 : 0], 132);
    const s = o.smoke;
    if (s) { f.set([...s.min, 1], 136); f.set([...s.max, o.smokeAbsorb], 140); f.set([...s.dims, s.cell], 144); }
    const lq = o.liquidView;
    f.set([lq.look, lq.radius, lq.clarity, lq.soften || 0], 148);
    f.set([...lq.color, 1], 152);
    const lum = horizon[0] * 0.3 + horizon[1] * 0.6 + horizon[2] * 0.1;
    f.set([...(o.box ? o.box.min : [0, 0, 0]), o.box ? 1 : 0], 156);
    f.set([...(o.box ? o.box.max : [0, 0, 0]), lum > 0.25 ? 0.1 : 0.75], 160);
    this.showBox = !!o.box;
    f.set([lv[0], lv[4], lv[8], 0], 164);
    f.set([lv[1], lv[5], lv[9], 0], 168);
    const gc = G.gridColor ? parseInt(G.gridColor.slice(1), 16) : 0;
    f.set([...top, gc], 172);
    f.set([...bottom, G.gridSpacing || 0], 176);
    f.set([...(o.wind || [0, 0, 0]), G.gridStrength || 0], 180);
    f.set([...(lq.min || [0, 0, 0]), lq.cell || 1], 184);
    f.set([...(lq.max || [1, 1, 1]), lq.fine || 0], 188);
    this.liquidLook = lq.look;
    this.packLights(f, o.lights || []);
    if (G.grid === 'bricks') f[124] = 2;
    this.device.queue.writeBuffer(this.frameBuf, 0, f);
  }

  packLights(f, lights) {
    const list = lights.slice(0, MAX_LIGHTS);
    const KIND = { area: 1, point: 2, spot: 3 };
    let used = 0;
    const layers = [];
    f.fill(0, 192);
    f[192] = list.length;
    list.forEach((l, i) => {
      const b = 196 + i * LIGHT_FLOATS;
      const n = l.shadows ? (l.type === 'point' ? 6 : 1) : 0;
      const first = n && used + n <= LIGHT_LAYERS ? used : -1;
      f.set([...l.pos, KIND[l.type]], b);
      f.set([...l.dir, l.cosOuter], b + 4);
      f.set([...l.right, l.halfW], b + 8);
      f.set([...l.up, l.halfH], b + 12);
      f.set([...l.col, l.cosInner], b + 16);
      const fov = l.type === 'point' ? 94 * Math.PI / 180 : l.type === 'spot' ? Math.min(2 * Math.acos(l.cosOuter) + 0.15, 2.9) : 150 * Math.PI / 180;
      f.set([first, first < 0 ? 0 : n, l.blur, 2 * Math.tan(fov / 2) / LIGHT_SHADOW_SIZE], b + 20);
      if (first < 0) return;
      used += n;
      const views = l.type === 'point'
        ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(a => [a, Math.abs(a[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0]])
        : [[l.dir, Math.abs(l.dir[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0]]];
      const proj = perspective(fov, 1, LIGHT_NEAR, 60);
      for (const [a, up] of views) {
        const lv = lookAt(l.pos, add(l.pos, a), up);
        const vp = multiply(proj, lv);
        f.set(vp, 196 + MAX_LIGHTS * LIGHT_FLOATS + layers.length * 16);
        layers.push({ vp, right: [lv[0], lv[4], lv[8]], up: [lv[1], lv[5], lv[9]] });
      }
    });
    this.lightLayers = layers;
    this.ensureLightShadow(layers.length);
  }

  ensureLightShadow(n) {
    const d = this.device, have = this.lightShadow ? this.lightShadow.layers : -1;
    if (have >= n && this.lightShadow) return;
    const layers = n === 0 ? 1 : Math.min(LIGHT_LAYERS, Math.ceil(n / 6) * 6);
    if (this.lightShadow) this.lightShadow.tex.destroy();
    const size = n === 0 ? 1 : LIGHT_SHADOW_SIZE;
    const tex = d.createTexture({ size: [size, size, layers], format: 'depth32float', dimension: '2d',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'placed lights\' shadows' });
    this.lightShadow = { tex, layers: n === 0 ? 0 : layers,
      views: Array.from({ length: layers }, (_, k) => tex.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1 })) };
    this.lightShadowView = tex.createView({ dimension: '2d-array' });
    this.lightShadowStamp = (this.lightShadowStamp || 0) + 1;
  }

  render(encoder, o) {
    const d = this.device, V = this.views;
    d.queue.writeBuffer(this.drawBuf, 0, o.drawData, 0, Math.max(o.meshes.length, 1) * OBJ_FLOATS);
    const G = this.groups(o.smoke, o.particles);
    const ts = (begin, end) => o.timestamps ? { timestampWrites: { querySet: o.timestamps,
      ...(begin !== undefined ? { beginningOfPassWriteIndex: begin } : {}),
      ...(end !== undefined ? { endOfPassWriteIndex: end } : {}) } } : {};
    const nP = o.particles ? o.particles.count : 0;
    const drawMeshes = (pass, pipe, upTo) => {
      pass.setPipeline(pipe);
      for (let i = 0; i < upTo; i++) {
        const m = this.meshes.get(o.meshes[i]);
        if (!m) continue;
        pass.setVertexBuffer(0, m.vb);
        pass.draw(m.count, 1, 0, i);
      }
    };

    let pass = encoder.beginRenderPass({ colorAttachments: [],
      depthStencilAttachment: { view: this.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, ...ts(2) });
    pass.setBindGroup(0, G.shadow);
    drawMeshes(pass, this.pipes.shadowObj, o.objectCount);
    if (nP) { pass.setPipeline(this.pipes.shadowDots); pass.draw(6, nP); }
    pass.end();

    const layers = this.lightLayers || [];
    for (let k = 0; k < layers.length; k++) {
      if (!this.lightLayerBufs[k]) this.lightLayerBufs[k] = makeBuffer(d, FRAME_FLOATS * 4, UNIFORM(), 'light shadow view ' + k);
      const f2 = this.frameData.slice();
      f2.set(layers[k].vp, 64);
      f2.set([...layers[k].right, 0], 164);
      f2.set([...layers[k].up, 0], 168);
      d.queue.writeBuffer(this.lightLayerBufs[k], 0, f2);
      const pos = o.particles ? o.particles.pos : this.noParticles;
      const gk = this.lightLayerGroups || (this.lightLayerGroups = []);
      if (!gk[k] || gk[k].pos !== pos) gk[k] = { pos, group: makeGroup(d, this.L.shadow, [this.lightLayerBufs[k], this.drawBuf, pos]) };
      pass = encoder.beginRenderPass({ colorAttachments: [],
        depthStencilAttachment: { view: this.lightShadow.views[k], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setBindGroup(0, gk[k].group);
      drawMeshes(pass, this.pipes.shadowObj, o.objectCount);
      if (nP) { pass.setPipeline(this.pipes.shadowDots); pass.draw(6, nP); }
      pass.end();
    }

    pass = encoder.beginRenderPass({
      colorAttachments: [{ view: V.color, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: V.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setBindGroup(0, G.scene);
    pass.setPipeline(this.pipes.ground); pass.draw(6);
    drawMeshes(pass, this.pipes.obj, o.meshes.length);
    if (nP && o.look === 1) { pass.setPipeline(this.pipes.dots); pass.draw(6, nP); }
    if (this.showBox) { pass.setPipeline(this.pipes.lines); pass.draw(24); }
    pass.setPipeline(this.pipes.sky); pass.draw(3);
    if (o.glass) drawMeshes(pass, this.pipes.glass, o.meshes.length);
    pass.end();

    if (nP && o.look >= 2) {
      pass = encoder.beginRenderPass({
        colorAttachments: [{ view: V.fluidRaw, clearValue: [1e9, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: V.fluidZ, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setBindGroup(0, G.fluid);
      pass.setPipeline(this.pipes.fluidDepth); pass.draw(6, nP);
      pass.end();
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.bodyFar, clearValue: [1e9, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      pass.setBindGroup(0, G.body);
      pass.setPipeline(this.pipes.body); pass.draw(3);
      pass.end();
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.thick, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      pass.setBindGroup(0, G.fluid);
      pass.setPipeline(this.pipes.fluidThick); pass.draw(6, nP);
      pass.end();
      if (this.liquidLook === 3 && G.fieldGroup) {
        pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.fluidB, loadOp: 'clear', clearValue: [1e9, 0, 0, 0], storeOp: 'store' },
          { view: V.fieldThick, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
        pass.setBindGroup(0, G.fieldGroup);
        pass.setPipeline(this.pipes.field); pass.draw(3);
        pass.end();
        for (const [i, out] of [[2, V.fluidA], [3, V.fluidB]]) {
          pass = encoder.beginRenderPass({ colorAttachments: [{ view: out, loadOp: 'clear', clearValue: [1e9, 0, 0, 0], storeOp: 'store' }] });
          pass.setBindGroup(0, this.blurGroups[i]);
          pass.setPipeline(this.pipes.blur); pass.draw(3);
          pass.end();
        }
      } else {
        const outs = [V.fluidA, V.fluidB, V.fluidA, V.fluidB];
        for (let i = 0; i < 4; i++) {
          pass = encoder.beginRenderPass({ colorAttachments: [{ view: outs[i], loadOp: 'clear', clearValue: [1e9, 0, 0, 0], storeOp: 'store' }] });
          pass.setBindGroup(0, this.blurGroups[i]);
          pass.setPipeline(this.pipes.blur); pass.draw(3);
          pass.end();
        }
      }
    }

    this.screenTexture = this.context.getCurrentTexture();
    const screen = this.screenTexture.createView();
    pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.post ? V.post : screen,
      clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }], ...(this.post ? {} : ts(undefined, 3)) });
    pass.setBindGroup(0, G.comp);
    pass.setPipeline(this.pipes.comp); pass.draw(3);
    pass.end();

    if (this.post) {
      d.queue.writeBuffer(this.postBuf, 0, packPost(this.post, this.width, this.height, this.frameData[83], this.postData));
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: screen, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
        ...ts(undefined, 3) });
      pass.setBindGroup(0, this.postGroup);
      pass.setPipeline(this.pipes.post); pass.draw(3);
      pass.end();
    }
  }
}
