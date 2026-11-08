import { makeLayout, makeGroup, makeBuffer, UNIFORM, shaderModule } from './gpu.js';
import { POST_SHADER, POST_FLOATS, packPost, BLOOM_SHADER, bloomNumbers, wantsBloom, buildOn } from './post.wgsl.js';
import { MEDIA_SHADER, MEDIA_FLOATS, packMedia } from './media.wgsl.js';
const SHRINK_SHADER =  `
@group(0) @binding(0) var<uniform> S: vec4<f32>;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
@fragment fn fsShrink(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  var sum = vec3<f32>(0.0);
  for (var j = 0; j < 4; j = j + 1) { for (var i = 0; i < 4; i = i + 1) {
    sum = sum + textureSampleLevel(src, samp, (floor(fc.xy) + (vec2<f32>(f32(i), f32(j)) + 0.5) / 4.0) / S.xy, 0.0).rgb;
  } }
  return vec4<f32>(sum / 16.0, 1.0);
}
@fragment fn fsCopy(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> { return textureLoad(src, vec2<i32>(fc.xy), 0); }
`;
import { CAUSTIC_SIZE, CAUSTIC_LINES, CAUSTIC_SURFACE_SHADER, CAUSTIC_MESH_SHADER, CAUSTIC_SOFT_SHADER, SCENE_SHADER, SHADOW_SHADER, FLUID_SHADER, BODY_SHADER, FIELD_SHADER, BLUR_SHADER, COMPOSITE_SHADER, OUTLINE_SHADER, GLASS_SHADER, FRAME_FLOATS,
  MAX_LIGHTS, LIGHT_LAYERS, LIGHT_SHADOW_SIZE, LIGHT_NEAR, LIGHT_FLOATS, ENV_SHADER, ENV_BLUR_SHADER, ENV_SIZE, ENV_LEVELS, MAX_DRAW } from './render.wgsl.js';
import { MAT_FLOATS, DECAL_FLOATS, MAX_DECALS } from './material.js';
import { FLUID_ROWS, FLUID_FLOATS } from './sdf.wgsl.js';
import { IMAGE_SIZE, IMAGE_LEVELS, MAX_IMAGE_LAYERS, IMAGE_SHADER } from './images.js';
import { unitMesh, BUILT_IN } from './shapes.js';
import { lookAt, ortho, multiply, fromAngles, scale, add, perspective, invert, transform } from './math.js';
import { BACKGROUNDS, FINISHES } from './environment.js';
import { OBJ_FLOATS } from './sdf.wgsl.js';

const OUTLINE_COLOR = [1.0, 0.82, 0.25];

const SHADOW_SIZE = 2048;
const GLASS_LIGHT_SIZE = 1024;
const NO_GLASS = 60000;
export { MAX_DRAW };

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
    this.matBuf = makeBuffer(d, (MAX_DRAW + 1) * MAT_FLOATS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'materials');
    this.decalBuf = makeBuffer(d, Math.max(MAX_DECALS, 1) * DECAL_FLOATS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'decals');
    this.postBuf = makeBuffer(d, POST_FLOATS * 4, UNIFORM(), 'picture look');
    this.postData = new Float32Array(POST_FLOATS);
    this.post = null;
    this.mediaBuf = makeBuffer(d, MEDIA_FLOATS * 4, UNIFORM(), 'media filter');
    this.mediaData = new Float32Array(MEDIA_FLOATS);
    this.media = null;
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
    this.noBuffer = makeBuffer(d, 64, GPUBufferUsage.STORAGE, 'nothing yet');
    this.fluidBuf = null;
    this.blockBuf = this.noBuffer;
    this.artBuf = this.noBuffer;
    this.cellBuf = this.noBuffer;
    const noPic = d.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: noPic }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.bgView = noPic.createView();
    this.bgPanorama = false;
    const noGlass = (dim, usage = 0) => {
      const t = d.createTexture({ size: [1, 1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | usage });
      return t.createView({ dimension: dim });
    };
    this.noGlass = noGlass('2d');
    this.noClearLight = noGlass('2d-array');

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
    this.texSamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });
    this.envSamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    this.images = { tex: null, layers: 0, used: new Map(), free: [] };
    this.ensureImageLayers(0);
    this.env = d.createTexture({ size: ENV_SIZE, mipLevelCount: ENV_LEVELS, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'what is round the scene' });
    this.envView = this.env.createView();
    this.envLevels = Array.from({ length: ENV_LEVELS }, (_, k) => this.env.createView({ baseMipLevel: k, mipLevelCount: 1 }));
    this.envDirty = true;

    const L = {
      scene: makeLayout(d, ['uniform', 'read', 'read', 'read', 'depth', 'sampler-cmp', 'tex3d', 'tex3d', 'sampler', 'tex2d', 'sampler', 'depth-array', 'tex2d-array',
        'read', 'read', 'tex2d-array', 'tex2d-array', 'sampler', 'tex2d', 'sampler', 'tex3d', 'tex2d', 'uniform', 'read', 'read'], 'render'),
      causticSurface: makeLayout(d, ['uniform', 'uniform', 'tex3d', 'sampler'], 'render'),
      causticKey: makeLayout(d, ['uniform', 'uniform', 'tex2d-u', 'tex2d-u', 'depth'], 'render'),
      causticPlaced: makeLayout(d, ['uniform', 'uniform', 'tex2d-u', 'tex2d-u', 'depth-array'], 'render'),
      causticSoft: makeLayout(d, ['tex2d-u'], 'render'),
      dispShadow: makeLayout(d, ['read', 'tex2d-array', 'sampler'], 'render'),
      env: makeLayout(d, ['uniform', 'tex2d', 'sampler'], 'render'),
      envBlur: makeLayout(d, ['tex2d', 'sampler'], 'render'),
      image: makeLayout(d, ['tex2d', 'sampler'], 'render'),
      opaqueDepth: makeLayout(d, ['depth', 'tex2d-u'], 'render'),
      glass: makeLayout(d, ['uniform', 'tex2d', 'depth', 'tex2d-u', 'tex2d-u', 'tex2d-u', 'tex2d-u', 'sampler'], 'render'),
      shadow: makeLayout(d, ['uniform', 'read', 'read', 'read', 'uniform', 'read'], 'render'),
      fluid: makeLayout(d, ['uniform', 'read', 'read', 'depth', 'tex2d-u', 'uniform'], 'render'),
      body: makeLayout(d, ['uniform', 'tex2d-u', 'tex3d', 'sampler'], 'render'),
      field: makeLayout(d, ['uniform', 'tex2d-u', 'tex3d', 'sampler', 'tex3d', 'tex3d'], 'render'),
      blur: makeLayout(d, ['uniform', 'uniform', 'tex2d-u'], 'render'),
      comp: makeLayout(d, ['uniform', 'tex2d', 'depth', 'tex2d-u', 'tex2d', 'tex3d', 'tex3d', 'sampler', 'depth', 'sampler-cmp', 'tex2d', 'sampler', 'tex3d', 'tex3d', 'tex3d', 'tex2d-u', 'depth-array', 'tex3d', 'tex2d-u', 'tex2d-u', 'uniform', 'read', 'read', 'read', 'read'], 'render'),
      post: makeLayout(d, ['uniform', 'tex2d', 'sampler', 'tex2d', 'tex2d', 'depth', 'tex2d-u'], 'render'),
      media: makeLayout(d, ['uniform', 'tex2d', 'sampler', 'tex2d'], 'render'),
      build: makeLayout(d, ['uniform', 'tex2d', 'sampler'], 'render'),
      bloom: makeLayout(d, ['uniform', 'tex2d', 'sampler'], 'render'),
      outline: makeLayout(d, ['uniform', 'tex2d'], 'render'),
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
    const mediaMod = await shaderModule(d, MEDIA_SHADER, 'media filter');
    const bloomMod = await shaderModule(d, BLOOM_SHADER, 'light spread');
    const outlineMod = await shaderModule(d, OUTLINE_SHADER, 'selection outline');
    const glassMod = await shaderModule(d, GLASS_SHADER, 'glass over the scene');
    const envMod = await shaderModule(d, ENV_SHADER, 'what is round the scene');
    const envBlurMod = await shaderModule(d, ENV_BLUR_SHADER, 'what is round the scene, blurred');
    const imageMod = await shaderModule(d, IMAGE_SHADER, 'images onto the card');
    const causticSurfaceMod = await shaderModule(d, CAUSTIC_SURFACE_SHADER, 'caustics: the water as the light meets it');
    const causticKeyMod = await shaderModule(d, CAUSTIC_MESH_SHADER(true), 'caustics: the sheet, key light');
    const causticPlacedMod = await shaderModule(d, CAUSTIC_MESH_SHADER(false), 'caustics: the sheet, placed light');
    const causticSoftMod = await shaderModule(d, CAUSTIC_SOFT_SHADER, 'caustics: smoothed');

    const HDR = 'rgba16float';
    const depthOn = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    const meshBuffers = [{ arrayStride: 24, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
    const uvBuffers = [...meshBuffers, { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }];
    const softBuffers = [...meshBuffers, { arrayStride: 32, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }, { shaderLocation: 3, offset: 12, format: 'float32x3' }, { shaderLocation: 4, offset: 24, format: 'float32x2' }] }];
    const dispBuffers = [{ arrayStride: 44, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'float32x2' }] }];
    const rp = (layout, module, vs, fs, targets, extra = {}) => d.createRenderPipeline({
      layout: pl(layout),
      vertex: { module, entryPoint: vs, buffers: extra.buffers || [] },
      fragment: fs ? { module, entryPoint: fs, targets } : undefined,
      primitive: { topology: extra.topology || 'triangle-list', cullMode: 'none' },
      depthStencil: extra.depth,
    });
    const blendAlpha = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
    const blendAdd = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
    const blendFirst = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' } };
    const clearLight = (vs, fs, buffers) => d.createRenderPipeline({ layout: pl(L.shadow),
      vertex: { module: shadowMod, entryPoint: vs, buffers },
      fragment: { module: shadowMod, entryPoint: fs, targets: [{ format: HDR, blend: blendFirst }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' } });
    this.pipes = {
      sky: rp(L.scene, sceneMod, 'vsSky', 'fsSky', [{ format: HDR }], { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' } }),
      ground: rp(L.scene, sceneMod, 'vsGround', 'fsGround', [{ format: HDR }], { depth: depthOn }),
      obj: rp(L.scene, sceneMod, 'vsObj', 'fsObj', [{ format: HDR }], { depth: depthOn, buffers: meshBuffers }),
      objTex: rp(L.scene, sceneMod, 'vsObjTex', 'fsObjTex', [{ format: HDR }], { depth: depthOn, buffers: meshBuffers }),
      objUv: rp(L.scene, sceneMod, 'vsObjUv', 'fsObjTex', [{ format: HDR }], { depth: depthOn, buffers: uvBuffers }),
      objDisp: rp(L.scene, sceneMod, 'vsObjDisp', 'fsObjTex', [{ format: HDR }], { depth: depthOn, buffers: dispBuffers }),
      objSoft: rp(L.scene, sceneMod, 'vsObjSoft', 'fsObjTex', [{ format: HDR }], { depth: depthOn, buffers: softBuffers }),
      groundTex: rp(L.scene, sceneMod, 'vsGround', 'fsGroundTex', [{ format: HDR }], { depth: depthOn }),
      shadowDisp: d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [L.shadow, L.dispShadow] }), vertex: { module: shadowMod, entryPoint: 'vsShadowDisp', buffers: dispBuffers },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthOn, depthBias: 2, depthBiasSlopeScale: 2 } }),
      env: rp(L.env, envMod, 'vsFull', 'fsEnv', [{ format: HDR }]),
      envBlur: rp(L.envBlur, envBlurMod, 'vsFull', 'fsBlurDown', [{ format: HDR }]),
      imageColor: rp(L.image, imageMod, 'vsFull', 'fsFirstColor', [{ format: 'rgba8unorm-srgb' }]),
      imageData: rp(L.image, imageMod, 'vsFull', 'fsFirstData', [{ format: 'rgba8unorm' }]),
      imageDataDown: rp(L.image, imageMod, 'vsFull', 'fsCopy', [{ format: 'rgba8unorm' }]),
      imageColorDown: rp(L.image, imageMod, 'vsFull', 'fsCopy', [{ format: 'rgba8unorm-srgb' }]),
      glass: d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [L.scene, L.opaqueDepth] }),
        vertex: { module: sceneMod, entryPoint: 'vsObj', buffers: meshBuffers },
        fragment: { module: sceneMod, entryPoint: 'fsGlass', targets: [{ format: HDR, blend: blendFirst },
          { format: HDR, blend: blendAdd }, { format: HDR, blend: blendAdd }, { format: HDR, blend: blendAdd }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' } }),
      glassTex: d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [L.scene, L.opaqueDepth] }),
        vertex: { module: sceneMod, entryPoint: 'vsObjTex', buffers: meshBuffers },
        fragment: { module: sceneMod, entryPoint: 'fsGlassTex', targets: [{ format: HDR, blend: blendFirst },
          { format: HDR, blend: blendAdd }, { format: HDR, blend: blendAdd }, { format: HDR, blend: blendAdd }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' } }),
      glassUv: d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [L.scene, L.opaqueDepth] }),
        vertex: { module: sceneMod, entryPoint: 'vsObjUv', buffers: uvBuffers },
        fragment: { module: sceneMod, entryPoint: 'fsGlassTex', targets: [{ format: HDR, blend: blendFirst },
          { format: HDR, blend: blendAdd }, { format: HDR, blend: blendAdd }, { format: HDR, blend: blendAdd }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' } }),
      glassFirst: d.createRenderPipeline({ layout: pl(L.scene),
        vertex: { module: sceneMod, entryPoint: 'vsObj', buffers: meshBuffers },
        fragment: { module: sceneMod, entryPoint: 'fsGlassFirst', targets: [{ format: 'r16float',
          blend: { color: { operation: 'min', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' } } }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' } }),
      glassKey: clearLight('vsGlassLight', 'fsGlassKey', meshBuffers),
      glassPlaced: clearLight('vsGlassLight', 'fsGlassPlaced', meshBuffers),
      waterKey: clearLight('vsWaterLight', 'fsWaterKey', []),
      waterPlaced: clearLight('vsWaterLight', 'fsWaterPlaced', []),
      glassResolve: rp(L.glass, glassMod, 'vsFull', 'fsGlassResolve', [{ format: HDR }]),
      dots: rp(L.scene, sceneMod, 'vsDots', 'fsDots', [{ format: HDR }], { depth: depthOn }),
      block: rp(L.scene, sceneMod, 'vsBlock', 'fsBlock', [{ format: HDR }], { depth: depthOn }),
      blockClear: rp(L.scene, sceneMod, 'vsBlockClear', 'fsBlockClear', [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }],
        { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less' } }),
      shadowBlock: d.createRenderPipeline({ layout: pl(L.shadow), vertex: { module: shadowMod, entryPoint: 'vsShadowBlock' },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthOn, depthBias: 2, depthBiasSlopeScale: 2 } }),
      lines: rp(L.scene, sceneMod, 'vsLines', 'fsLines', [{ format: HDR, blend: blendAlpha }],
        { topology: 'line-list', depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' } }),
      shadowObj: d.createRenderPipeline({ layout: pl(L.shadow), vertex: { module: shadowMod, entryPoint: 'vsShadowObj', buffers: meshBuffers },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depthOn, depthBias: 2, depthBiasSlopeScale: 2 } }),
      fluidDepth: rp(L.fluid, fluidMod, 'vsFluid', 'fsFluidDepth', [{ format: 'r32float' }], { depth: depthOn }),
      body: rp(L.body, bodyMod, 'vsFull', 'fsBody', [{ format: HDR }]),
      field: rp(L.field, fieldMod, 'vsFull', 'fsField', [{ format: 'r32float' }, { format: HDR }, { format: HDR }]),
      fluidThick: rp(L.fluid, fluidMod, 'vsFluid', 'fsFluidThick', [{ format: HDR, blend: blendAdd }]),
      blur: rp(L.blur, blurMod, 'vsFull', 'fsBlur', [{ format: 'r32float' }]),
      comp: rp(L.comp, compMod, 'vsFull', 'fsComposite', [{ format: this.gpu.format }]),
      post: rp(L.post, postMod, 'vsFull', 'fsPost', [{ format: this.gpu.format }]),
      media: rp(L.media, mediaMod, 'vsFull', 'fsMedia', [{ format: this.gpu.format }]),
      build: rp(L.build, postMod, 'vsFull', 'fsBuild', [{ format: this.gpu.format }]),
      compLight: rp(L.comp, compMod, 'vsFull', 'fsCompositeLight', [{ format: this.gpu.format }, { format: HDR }]),
      bloomFirst: rp(L.bloom, bloomMod, 'vsFull', 'fsFirst', [{ format: HDR }]),
      bloomDown: rp(L.bloom, bloomMod, 'vsFull', 'fsDown', [{ format: HDR }]),
      bloomUp: rp(L.bloom, bloomMod, 'vsFull', 'fsUp', [{ format: HDR, blend: blendAdd, writeMask: GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE }]),
      pickWhole: rp(L.scene, sceneMod, 'vsObj', 'fsPickMask', [{ format: 'rg8unorm', writeMask: GPUColorWrite.GREEN }],
        { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' }, buffers: meshBuffers }),
      pickSeen: rp(L.scene, sceneMod, 'vsObj', 'fsPickMask', [{ format: 'rg8unorm', writeMask: GPUColorWrite.RED }],
        { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal', depthBias: -4, depthBiasSlopeScale: -2 }, buffers: meshBuffers }),
      pickWholeD: rp(L.scene, sceneMod, 'vsObjDisp', 'fsPickMaskDisp', [{ format: 'rg8unorm', writeMask: GPUColorWrite.GREEN }],
        { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' }, buffers: dispBuffers }),
      pickSeenD: rp(L.scene, sceneMod, 'vsObjDisp', 'fsPickMaskDisp', [{ format: 'rg8unorm', writeMask: GPUColorWrite.RED }],
        { depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal', depthBias: -4, depthBiasSlopeScale: -2 }, buffers: dispBuffers }),
      outline: rp(L.outline, outlineMod, 'vsFull', 'fsOutline', [{ format: this.gpu.format, blend: blendAlpha }]),
    };
    const sheet = (layout, module, vs, fs, writeMask) => rp(layout, module, vs, fs, [{ format: HDR, blend: blendAdd, writeMask }]);
    this.pipes.causticSurface = rp(L.causticSurface, causticSurfaceMod, 'vsFull', 'fsCausticSurface', [{ format: 'rgba32float' }, { format: HDR }]);
    this.pipes.causticFoldKey = sheet(L.causticKey, causticKeyMod, 'vsCausticFold', 'fsCausticFold', GPUColorWrite.RED);
    this.pipes.causticBaseKey = sheet(L.causticKey, causticKeyMod, 'vsCausticBase', 'fsCausticBase', GPUColorWrite.GREEN);
    this.pipes.causticFoldPlaced = sheet(L.causticPlaced, causticPlacedMod, 'vsCausticFold', 'fsCausticFold', GPUColorWrite.RED);
    this.pipes.causticBasePlaced = sheet(L.causticPlaced, causticPlacedMod, 'vsCausticBase', 'fsCausticBase', GPUColorWrite.GREEN);
    this.pipes.causticSoft = rp(L.causticSoft, causticSoftMod, 'vsFull', 'fsCausticSoft', [{ format: HDR }]);
    this.imageSamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const noCaustic = d.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.noCaustic = noCaustic.createView();
    this.outlineBuf = makeBuffer(d, 16, UNIFORM(), 'selection outline');
    this.bloomBuf = makeBuffer(d, 16, UNIFORM(), 'light spread');
  }

  addMesh(name, verts, { uvs = null, stride = 6 } = {}) {
    const vb = this.device.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vb, 0, verts);
    let uvb = null;
    if (uvs) {
      uvb = this.device.createBuffer({ size: uvs.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(uvb, 0, uvs);
    }
    this.removeMesh(name);
    this.meshes.set(name, { vb, uvb, count: verts.length / stride });
  }

  removeMesh(name) {
    const m = this.meshes.get(name);
    if (m) { m.vb.destroy(); if (m.uvb) m.uvb.destroy(); if (m.rest) m.rest.destroy(); this.meshes.delete(name); }
  }

  addSoftMesh(name, corners, rest) {
    this.removeMesh(name);
    const vb = this.device.createBuffer({ size: corners * 24, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: name });
    const buf = this.device.createBuffer({ size: rest.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: name + ' at rest' });
    this.device.queue.writeBuffer(buf, 0, rest);
    this.meshes.set(name, { vb, uvb: null, rest: buf, count: corners });
  }
  writeSoftMesh(name, data) { const m = this.meshes.get(name); if (m) this.device.queue.writeBuffer(m.vb, 0, data); }

  ensureImageLayers(n) {
    const I = this.images, d = this.device;
    if (I.tex && I.layers >= n) return;
    const layers = n === 0 ? 1 : Math.min(MAX_IMAGE_LAYERS, Math.ceil(n / 4) * 4);
    const big = n > 0;
    const tex = d.createTexture({ size: big ? [IMAGE_SIZE, IMAGE_SIZE, layers] : [1, 1, 1], mipLevelCount: big ? IMAGE_LEVELS : 1, format: 'rgba8unorm', viewFormats: ['rgba8unorm-srgb'],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST, label: 'the scene\'s images' });
    if (I.tex && I.layers > 0) {
      const enc = d.createCommandEncoder();
      for (let m = 0; m < IMAGE_LEVELS; m++) {
        const s = Math.max(1, IMAGE_SIZE >> m);
        enc.copyTextureToTexture({ texture: I.tex, mipLevel: m }, { texture: tex, mipLevel: m }, [s, s, I.layers]);
      }
      d.queue.submit([enc.finish()]);
    }
    if (I.tex) { const old = I.tex; d.queue.onSubmittedWorkDone().then(() => old.destroy()); }
    I.tex = tex;
    I.layers = big ? layers : 0;
    I.dataView = tex.createView({ dimension: '2d-array', format: 'rgba8unorm' });
    I.colorView = tex.createView({ dimension: '2d-array', format: 'rgba8unorm-srgb' });
    this.lightShadowStamp = (this.lightShadowStamp || 0) + 1;
  }

  uploadImage(bitmap, kind) {
    const d = this.device, I = this.images;
    let layer = I.free.pop();
    if (layer === undefined) {
      layer = I.used.size;
      if (layer >= MAX_IMAGE_LAYERS) return -1;
      this.ensureImageLayers(layer + 1);
    }
    const src = d.createTexture({ size: [IMAGE_SIZE, IMAGE_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    d.queue.copyExternalImageToTexture({ source: bitmap }, { texture: src }, [IMAGE_SIZE, IMAGE_SIZE]);
    const color = kind === 'color', format = color ? 'rgba8unorm-srgb' : 'rgba8unorm';
    const enc = d.createCommandEncoder();
    const view = m => I.tex.createView({ dimension: '2d', format, baseMipLevel: m, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
    const run = (pipe, from, to) => {
      const p = enc.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
      p.setPipeline(pipe);
      p.setBindGroup(0, makeGroup(d, this.L.image, [from, this.imageSamp]));
      p.draw(3);
      p.end();
    };
    run(color ? this.pipes.imageColor : this.pipes.imageData, src.createView(), view(0));
    for (let m = 1; m < IMAGE_LEVELS; m++) run(color ? this.pipes.imageColorDown : this.pipes.imageDataDown, view(m - 1), view(m));
    d.queue.submit([enc.finish()]);
    d.queue.onSubmittedWorkDone().then(() => src.destroy());
    I.used.set(layer, kind);
    return layer;
  }
  freeImage(layer) { if (this.images.used.delete(layer)) this.images.free.push(layer); }

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
    this.envDirty = true;
    this.envGroup = null;
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    for (const t of Object.values(this.targets || {})) t.destroy();
    this.dropGlassPictures();
    this.dropBloom();
    this.dropMedia();
    this.dropBuild();
    const tex = (format, extra = 0) => d.createTexture({ size: [w, h], format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra });
    this.targets = {
      color: tex('rgba16float', GPUTextureUsage.COPY_SRC),
      depth: tex('depth32float'),
      fluidRaw: tex('r32float'),
      fluidA: tex('r32float'),
      fluidB: tex('r32float'),
      fluidZ: tex('depth32float'),
      fieldThick: tex('rgba16float', GPUTextureUsage.COPY_SRC),
      thick: tex('rgba16float', GPUTextureUsage.COPY_SRC),
      post: tex(this.gpu.format),
      pickMask: tex('rg8unorm', GPUTextureUsage.COPY_SRC),
    };
    this.views = Object.fromEntries(Object.entries(this.targets).map(([k, t]) => [k, t.createView()]));
    const V = this.views;
    this.blurGroups = [
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirX, V.fluidRaw]),
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirY, V.fluidA]),
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirX, V.fluidB]),
      makeGroup(d, this.L.blur, [this.frameBuf, this.dirY, V.fluidA]),
    ];
    this.postGroup = makeGroup(d, this.L.post, [this.postBuf, V.post, this.linear, this.noGlass, this.noGlass, V.depth, V.fluidB]);
    this.outlineGroup = makeGroup(d, this.L.outline, [this.outlineBuf, V.pickMask]);
    this.groupCache = new Map();
  }

  setPost(p) { this.post = p ? { ...p } : null; }

  setMedia(m) { this.media = m ? { ...m } : null; }
  ensureMedia() {
    if (this.mediaTex) return;
    const d = this.device, size = [this.width, this.height];
    this.mediaTex = d.createTexture({ size, format: this.gpu.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'the picture, before its medium' });
    this.mediaLast = d.createTexture({ size, format: this.gpu.format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING, label: 'the last frame shown' });
    this.mediaView = this.mediaTex.createView();
    this.mediaGroup = makeGroup(d, this.L.media, [this.mediaBuf, this.mediaView, this.linear, this.mediaLast.createView()]);
  }
  dropMedia() {
    if (!this.mediaTex) return;
    this.mediaTex.destroy();
    this.mediaLast.destroy();
    this.mediaTex = null;
  }
  ensureBuild() {
    if (this.buildTex) return;
    const d = this.device;
    this.buildTex = d.createTexture({ size: [this.width, this.height], format: this.gpu.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'the picture, before its cells' });
    this.buildView = this.buildTex.createView();
    this.buildGroup = makeGroup(d, this.L.build, [this.postBuf, this.buildView, this.linear]);
  }
  dropBuild() {
    if (!this.buildTex) return;
    this.buildTex.destroy();
    this.buildTex = null;
  }

  ensureBloom() {
    if (this.bloom) return;
    const d = this.device, levels = Math.floor(Math.log2(Math.max(this.width >> 1, this.height >> 1, 1))) + 1;
    const light = d.createTexture({ size: [this.width, this.height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'the light' });
    const spread = d.createTexture({ size: [Math.max(this.width >> 1, 1), Math.max(this.height >> 1, 1)], mipLevelCount: levels, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'the light, spread' });
    const lightView = light.createView(), all = spread.createView();
    const level = Array.from({ length: levels }, (_, k) => spread.createView({ baseMipLevel: k, mipLevelCount: 1 }));
    const group = v => makeGroup(d, this.L.bloom, [this.bloomBuf, v, this.linear]);
    this.bloom = { light, spread, lightView, level, first: group(lightView), down: level.map(group),
      post: makeGroup(d, this.L.post, [this.postBuf, this.views.post, this.linear, lightView, all, this.views.depth, this.views.fluidB]) };
  }
  filterPictures(jobs, w, h) {
    const d = this.device, V = this.views, F = this.lastFrame;
    if (!F) return jobs.map(() => null);
    const T = this.ensureFilterPictures(w, h);
    const spreadAny = jobs.some(j => j.post && wantsBloom(j.post));
    if (spreadAny) this.ensureBloom();
    if (jobs.some(j => j.media)) this.ensureMedia();
    if (!F.kept || (spreadAny && !F.light)) {
      const enc = d.createCommandEncoder({ label: 'the scene, for the filter pictures' });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: V.post, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
        ...(spreadAny ? [{ view: this.bloom.lightView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] : [])] });
      pass.setBindGroup(0, F.comp);
      pass.setPipeline(spreadAny ? this.pipes.compLight : this.pipes.comp); pass.draw(3);
      pass.end();
      d.queue.submit([enc.finish()]);
    }
    F.kept = false;
    return jobs.map(j => this.filterPicture(j.post, j.media, T));
  }
  filterPicture(post, media, T) {
    const d = this.device, F = this.lastFrame, { w, h } = T;
    const spread = post && wantsBloom(post);
    const enc = d.createCommandEncoder({ label: 'a filter picture' });
    const run = (view, group, pipe) => { const p = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] }); p.setBindGroup(0, group); p.setPipeline(pipe); p.draw(3); p.end(); };
    if (spread) {
      d.queue.writeBuffer(this.bloomBuf, 0, new Float32Array(bloomNumbers(post)));
      this.renderBloom(enc);
    }
    let last = 'scene';
    if (post) {
      const build = buildOn(post);
      if (build) this.ensureBuild();
      d.queue.writeBuffer(this.postBuf, 0, packPost(post, this.width, this.height, this.frameData[83], this.postData, [this.frameData[42], this.frameData[46], F.waterKnown]));
      run(build ? this.buildView : media ? this.mediaView : T.fullView, spread ? this.bloom.post : this.postGroup, this.pipes.post);
      if (build) run(media ? this.mediaView : T.fullView, this.buildGroup, this.pipes.build);
      last = media ? 'media' : 'full';
    }
    if (media) {
      d.queue.writeBuffer(this.mediaBuf, 0, packMedia({ ...media, ghost: 0 }, this.width, this.height, this.frameData[83], this.mediaData));
      if (!T.mediaFromScene || T.mediaFor !== this.mediaTex) { T.mediaFromScene = makeGroup(d, this.L.media, [this.mediaBuf, this.views.post, this.linear, this.mediaLast.createView()]); T.mediaFor = this.mediaTex; }
      run(T.fullView, last === 'media' ? this.mediaGroup : T.mediaFromScene, this.pipes.media);
      last = 'full';
    }
    d.queue.writeBuffer(T.sizeBuf, 0, new Float32Array([w, h, 0, 0]));
    run(T.smallView, last === 'full' ? T.group : T.fromScene, T.pipe);
    const row = Math.ceil(w * 4 / 256) * 256, buf = d.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'a filter picture, read back' });
    enc.copyTextureToBuffer({ texture: T.small }, { buffer: buf, bytesPerRow: row }, [w, h]);
    d.queue.submit([enc.finish()]);
    const bgra = this.gpu.format.startsWith('bgra');
    return buf.mapAsync(GPUMapMode.READ).then(() => {
      const src = new Uint8Array(buf.getMappedRange()), px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = y * row + x * 4, b = (y * w + x) * 4;
        px[b] = src[a + (bgra ? 2 : 0)]; px[b + 1] = src[a + 1]; px[b + 2] = src[a + (bgra ? 0 : 2)]; px[b + 3] = 255;
      }
      buf.unmap(); buf.destroy();
      return new ImageData(px, w, h);
    });
  }
  ensureShrink() {
    if (this.shrink) return;
    const d = this.device, layout = makeLayout(d, ['uniform', 'tex2d', 'sampler'], 'render'), module = d.createShaderModule({ code: SHRINK_SHADER, label: 'shrink' });
    this.shrink = { layout, module, sizeBuf: makeBuffer(d, 16, UNIFORM(), 'a filter picture: its size'),
      pipe: d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }), primitive: { topology: 'triangle-list' },
        vertex: { module, entryPoint: 'vsFull' }, fragment: { module, entryPoint: 'fsShrink', targets: [{ format: this.gpu.format }] } }) };
  }
  ensureSceneCopy() {
    const d = this.device;
    this.ensureShrink();
    if (!this.sceneCopy || this.sceneCopy.from !== this.views.post) {
      const pipe = (this.sceneCopy && this.sceneCopy.pipe) || d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.shrink.layout] }), primitive: { topology: 'triangle-list' },
        vertex: { module: this.shrink.module, entryPoint: 'vsFull' }, fragment: { module: this.shrink.module, entryPoint: 'fsCopy', targets: [{ format: this.gpu.format }] } });
      this.sceneCopy = { from: this.views.post, pipe, group: makeGroup(d, this.shrink.layout, [this.shrink.sizeBuf, this.views.post, this.linear]) };
    }
    return this.sceneCopy;
  }
  ensureFilterPictures(w, h) {
    const d = this.device;
    this.ensureShrink();
    const T = this.filterPics;
    if (T && T.W === this.width && T.H === this.height && T.w === w && T.h === h && T.scene === this.views.post) return T;
    if (T) { T.full.destroy(); T.small.destroy(); }
    const full = d.createTexture({ size: [this.width, this.height], format: this.gpu.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'a filter picture' });
    const small = d.createTexture({ size: [w, h], format: this.gpu.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, label: 'a filter picture, small' });
    const fullView = full.createView();
    this.filterPics = { W: this.width, H: this.height, w, h, scene: this.views.post, full, small, fullView, smallView: small.createView(), pipe: this.shrink.pipe, sizeBuf: this.shrink.sizeBuf,
      group: makeGroup(d, this.shrink.layout, [this.shrink.sizeBuf, fullView, this.linear]),
      fromScene: makeGroup(d, this.shrink.layout, [this.shrink.sizeBuf, this.views.post, this.linear]) };
    return this.filterPics;
  }
  dropBloom() {
    if (!this.bloom) return;
    this.bloom.light.destroy();
    this.bloom.spread.destroy();
    this.bloom = null;
  }
  renderBloom(encoder) {
    const B = this.bloom, n = B.level.length;
    const run = (pipe, group, target, keep = false) => {
      const p = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: keep ? 'load' : 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
      p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end();
    };
    run(this.pipes.bloomFirst, B.first, B.level[0]);
    for (let k = 1; k < n; k++) run(this.pipes.bloomDown, B.down[k - 1], B.level[k]);
    for (let k = Math.min(n, 6) - 2; k >= 0; k--) run(this.pipes.bloomUp, B.down[k + 1], B.level[k], true);
  }

  ensureGlassPictures() {
    if (this.glassPictures) return;
    const d = this.device, size = [this.width, this.height], V = this.views;
    const tex = (extra = 0) => d.createTexture({ size, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra });
    const t = { nearLight: tex(), nearTaken: tex(), farLight: tex(), farTaken: tex(),
      first: d.createTexture({ size, format: 'r16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
      behind: d.createTexture({ size, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }) };
    const v = Object.fromEntries(Object.entries(t).map(([k, x]) => [k, x.createView()]));
    this.glassPictures = { t, v,
      depthGroup: makeGroup(d, this.L.opaqueDepth, [V.depth, v.first]),
      resolveGroup: makeGroup(d, this.L.glass, [this.frameBuf, v.behind, V.depth, v.nearLight, v.nearTaken, v.farLight, v.farTaken, this.linear]) };
    this.lightShadowStamp = (this.lightShadowStamp || 0) + 1;
  }
  dropGlassPictures() {
    if (!this.glassPictures) return;
    for (const t of Object.values(this.glassPictures.t)) t.destroy();
    this.glassPictures = null;
  }

  ensureClearLight(n) {
    if (this.clearLightMaps && this.clearLightMaps.layers >= n) return;
    const d = this.device;
    if (this.clearLightMaps) this.clearLightMaps.tex.destroy();
    const layers = Math.min(LIGHT_LAYERS + 1, Math.ceil(n / 4) * 4);
    const tex = d.createTexture({ size: [GLASS_LIGHT_SIZE, GLASS_LIGHT_SIZE, layers], format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'light through glass and water' });
    this.clearLightMaps = { tex, layers, view: tex.createView({ dimension: '2d-array' }),
      views: Array.from({ length: layers }, (_, k) => tex.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1 })) };
    this.lightShadowStamp = (this.lightShadowStamp || 0) + 1;
  }

  ensureCaustics() {
    if (this.caustic) return this.caustic;
    const d = this.device, n = CAUSTIC_LINES;
    const tex = (size, format) => d.createTexture({ size: [size, size], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    const hit = tex(n, 'rgba32float'), nrm = tex(n, 'rgba16float'), raw = tex(CAUSTIC_SIZE, 'rgba16float'), map = tex(CAUSTIC_SIZE, 'rgba16float');
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const a = x + y * n, b = a + 1, c = a + n, e = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = e; idx[k++] = c;
    }
    const indices = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: 'caustics, the sheet' });
    d.queue.writeBuffer(indices, 0, idx);
    const rawView = raw.createView();
    this.caustic = { hit, nrm, raw, map, hitView: hit.createView(), nrmView: nrm.createView(), rawView, mapView: map.createView(), softGroup: makeGroup(d, this.L.causticSoft, [rawView]), indices, count: idx.length,
      buf: makeBuffer(d, 176, UNIFORM(), 'caustics settings'), surfaceGroups: new Map(), meshGroups: new Map() };
    this.lightShadowStamp = (this.lightShadowStamp || 0) + 1;
    return this.caustic;
  }

  planCaustics(f, lq) {
    this.causticPlan = null;
    f[210] = -1;
    if (!lq.causticOf || lq.look !== 3 || !(lq.caustics > 0)) return;
    const shines = f[92] + f[93] + f[94] > 0;
    let vp, from, layer = -2, key = shines;
    if (shines) { vp = f.subarray(64, 80).slice(); from = [f[88], f[89], f[90], 0]; }
    else {
      const L = (this.lightPlan || []).find(l => l.first >= 0);
      if (!L) return;
      layer = L.first + (L.type === 'point' ? 3 : 0);
      vp = this.lightLayers[layer].vp;
      from = [...L.pos, 1];
    }
    const [x0, x1, z0, z1] = lq.causticOf.extent, y0 = 0, y1 = lq.causticOf.top;
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
      const c = [vp[0] * x + vp[4] * y + vp[8] * z + vp[12], vp[1] * x + vp[5] * y + vp[9] * z + vp[13], vp[3] * x + vp[7] * y + vp[11] * z + vp[15]];
      if (c[2] <= 1e-4) continue;
      const u = c[0] / c[2] * 0.5 + 0.5, v = 0.5 - c[1] / c[2] * 0.5;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    if (u1 <= u0 || v1 <= v0) return;
    const side = Math.min(1.5, Math.max(u1 - u0, v1 - v0) * 1.08), cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const box = [cu - side / 2, cv - side / 2, side, side];
    f[210] = layer;
    f.set(box, 212);
    this.causticPlan = { key, vp, inv: invert(vp), from, box, layer: Math.max(layer, 0) };
  }

  groups(smoke, particles) {
    const dye = smoke ? smoke.dyeView : this.noDye;
    const light = smoke ? smoke.lightView : this.noLight;
    const sky = smoke ? smoke.skyView : this.noSky;
    const pos = particles ? particles.pos : this.noParticles;
    const col = particles ? particles.col : this.noParticles;
    const water = particles ? particles.look : this.noDye;
    const field = particles && particles.field ? particles.field : null;
    if (this.groupStamp !== this.lightShadowStamp) { this.groupCache.clear(); this.groupStamp = this.lightShadowStamp; }
    const keyed = this.groupCache.get(dye) || new Map();
    this.groupCache.set(dye, keyed);
    let entry = keyed.get(field);
    const whoS = smoke ? smoke.whoNow : this.noBuffer, whoW = particles && particles.who ? particles.who : this.noBuffer;
    if (entry && entry.pos === pos && entry.water === water && entry.whoS === whoS && entry.whoW === whoW && entry.blockBuf === this.blockBuf && entry.artBuf === this.artBuf && entry.cellBuf === this.cellBuf) return entry;
    const d = this.device, V = this.views;
    entry = {
      pos, water, whoS, whoW, blockBuf: this.blockBuf, artBuf: this.artBuf, cellBuf: this.cellBuf,
      fieldGroup: field ? makeGroup(d, this.L.field, [this.frameBuf, V.fluidRaw, field, this.linear, water, particles.foam]) : null,
      scene: makeGroup(d, this.L.scene, [this.frameBuf, this.drawBuf, pos, col, this.shadowView, this.compare, dye, light, this.linear, this.bgView, this.wrapping, this.lightShadowView,
        this.clearLightMaps ? this.clearLightMaps.view : this.noClearLight,
        this.matBuf, this.decalBuf, this.images.dataView, this.images.colorView, this.texSamp, this.envView, this.envSamp, smoke && smoke.localView ? smoke.localView : this.noLight,
        this.caustic ? this.caustic.mapView : this.noCaustic, this.fluidBuf, this.blockBuf, this.artBuf]),
      dispShadow: makeGroup(d, this.L.dispShadow, [this.matBuf, this.images.dataView, this.texSamp]),
      shadow: makeGroup(d, this.L.shadow, [this.frameBuf, this.drawBuf, pos, col, this.fluidBuf, this.blockBuf]),
      fluid: makeGroup(d, this.L.fluid, [this.frameBuf, pos, col, V.depth, V.fieldThick, this.fluidBuf]),
      body: makeGroup(d, this.L.body, [this.frameBuf, V.fluidRaw, water, this.linear]),
      comp: makeGroup(d, this.L.comp, [this.frameBuf, V.color, V.depth, V.fluidB, V.thick, dye, light, this.linear, this.shadowView, this.compare, this.bgView, this.wrapping, sky, water, field || this.noDye, V.fieldThick,
        this.lightShadowView, smoke && smoke.localView ? smoke.localView : this.noLight,
        this.glassPictures ? this.glassPictures.v.nearLight : this.noGlass, this.glassPictures ? this.glassPictures.v.nearTaken : this.noGlass,
        this.fluidBuf, whoS, whoW, this.artBuf, this.cellBuf]),
    };
    keyed.set(field, entry);
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
    f[196] = reach * 2;
    f[198] = o.smokeLook ? 1 : 0;
    f[199] = o.waterOwn ? 1 : 0;
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
    if (s) { f.set([...s.min, 1], 136); f.set([...s.max, o.smokeAbsorb], 140); f.set([...s.dims, s.cell], 144); f[197] = s.cell / s.fineBy; }
    const lq = o.liquidView;
    f.set([lq.look, lq.radius, lq.clarity, lq.soften || 0], 148);
    f.set([...lq.color, 1], 152);
    f[155] = o.snap || 0;
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
    if (lq.fieldMin) {
      f.set(lq.fieldMin, 200);
      f.set(lq.fieldMin.map((v, i) => v + lq.fieldSize[i]), 204);
    }
    f[208] = lq.foam ?? 1;
    f[209] = lq.caustics ?? 1;
    this.liquidLook = lq.look;
    this.packLights(f, o.lights || []);
    this.planCaustics(f, lq);
    f[193] = o.glass ? 1 : 0;
    f[194] = o.glass || lq.look > 0 ? 1 : 0;
    if (G.grid === 'bricks') f[124] = 2;
    this.device.queue.writeBuffer(this.frameBuf, 0, f);
  }

  packLights(f, lights) {
    const list = lights.slice(0, MAX_LIGHTS);
    const KIND = { area: 1, point: 2, spot: 3 };
    let used = 0;
    const layers = [], plan = [];
    f[192] = list.length;
    f.fill(0, 193, 196);
    f.fill(0, 216);
    list.forEach((l, i) => {
      const b = 216 + i * LIGHT_FLOATS;
      const n = l.shadows ? (l.type === 'point' ? 6 : 1) : 0;
      const first = n && used + n <= LIGHT_LAYERS ? used : -1;
      f.set([...l.pos, KIND[l.type]], b);
      f.set([...l.dir, l.cosOuter], b + 4);
      f.set([...l.right, l.halfW], b + 8);
      f.set([...l.up, l.halfH], b + 12);
      f.set([...l.col, l.cosInner], b + 16);
      const fov = l.type === 'point' ? 94 * Math.PI / 180 : l.type === 'spot' ? Math.min(2 * Math.acos(l.cosOuter) + 0.15, 2.9) : 150 * Math.PI / 180;
      f.set([first, first < 0 ? 0 : n, l.blur, 2 * Math.tan(fov / 2) / LIGHT_SHADOW_SIZE], b + 20);
      plan.push({ first, type: l.type, pos: l.pos });
      if (first < 0) return;
      used += n;
      const views = l.type === 'point'
        ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(a => [a, Math.abs(a[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0]])
        : [[l.dir, Math.abs(l.dir[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0]]];
      const proj = perspective(fov, 1, LIGHT_NEAR, 60);
      for (const [a, up] of views) {
        const lv = lookAt(l.pos, add(l.pos, a), up);
        const vp = multiply(proj, lv);
        f.set(vp, 216 + MAX_LIGHTS * LIGHT_FLOATS + layers.length * 16);
        layers.push({ vp, right: [lv[0], lv[4], lv[8]], up: [lv[1], lv[5], lv[9]], pos: l.pos });
      }
    });
    this.lightLayers = layers;
    this.lightPlan = plan;
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

  renderEnv(encoder) {
    const d = this.device;
    if (!this.envGroup) this.envGroup = makeGroup(d, this.L.env, [this.frameBuf, this.bgView, this.wrapping]);
    let p = encoder.beginRenderPass({ colorAttachments: [{ view: this.envLevels[0], loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
    p.setPipeline(this.pipes.env);
    p.setBindGroup(0, this.envGroup);
    p.draw(3);
    p.end();
    this.envBlurGroups ||= this.envLevels.map(v => makeGroup(d, this.L.envBlur, [v, this.envSamp]));
    for (let k = 1; k < ENV_LEVELS; k++) {
      p = encoder.beginRenderPass({ colorAttachments: [{ view: this.envLevels[k], loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
      p.setPipeline(this.pipes.envBlur);
      p.setBindGroup(0, this.envBlurGroups[k - 1]);
      p.draw(3);
      p.end();
    }
    this.envDirty = false;
  }

  render(encoder, o) {
    const d = this.device, V = this.views;
    d.queue.writeBuffer(this.drawBuf, 0, o.drawData, 0, Math.max(o.meshes.length, 1) * OBJ_FLOATS);
    d.queue.writeBuffer(this.matBuf, 0, o.matData, 0, o.meshes.length * MAT_FLOATS);
    d.queue.writeBuffer(this.matBuf, MAX_DRAW * MAT_FLOATS * 4, o.matData, MAX_DRAW * MAT_FLOATS, MAT_FLOATS);
    if (o.decals) d.queue.writeBuffer(this.decalBuf, 0, o.decalData, 0, o.decals * DECAL_FLOATS);
    if (this.envDirty) this.renderEnv(encoder);
    const glass = o.glass || [];
    const nP = o.particles ? o.particles.count : 0;
    const clear = glass.length > 0 || nP > 0;
    if (glass.length) this.ensureGlassPictures();
    if (clear) this.ensureClearLight(1 + (this.lightLayers || []).length);
    d.queue.writeBuffer(this.fluidBuf, 0, o.fluidData);
    const G = this.groups(o.smoke, o.particles);
    const blocks = o.blocks || null;
    const ts = (begin, end) => o.timestamps ? { timestampWrites: { querySet: o.timestamps,
      ...(begin !== undefined ? { beginningOfPassWriteIndex: begin } : {}),
      ...(end !== undefined ? { endOfPassWriteIndex: end } : {}) } } : {};
    const drawOne = (pass, i, dr, m) => {
      pass.setVertexBuffer(0, m.vb);
      pass.draw(dr.count >= 0 ? dr.count : m.count, 1, dr.first || 0, i);
    };
    const drawShadows = (pass, upTo, group) => {
      let cur = -1;
      for (let i = 0; i < upTo; i++) {
        const dr = o.meshes[i], m = this.meshes.get(dr.mesh);
        if (!m) continue;
        const disp = dr.kind === 3 ? 1 : 0;
        if (disp !== cur) {
          pass.setPipeline(disp ? this.pipes.shadowDisp : this.pipes.shadowObj);
          if (disp) pass.setBindGroup(1, group);
          cur = disp;
        }
        drawOne(pass, i, dr, m);
      }
    };
    const scenePipes = [this.pipes.obj, this.pipes.objTex, this.pipes.objUv, this.pipes.objDisp, this.pipes.objSoft];
    const drawScene = pass => {
      let cur = -1;
      for (let i = 0; i < o.meshes.length; i++) {
        const dr = o.meshes[i], m = this.meshes.get(dr.mesh);
        if (!m || dr.skip) continue;
        const kind = dr.kind === 2 && !m.uvb ? 1 : dr.kind || 0;
        if (kind !== cur) { pass.setPipeline(scenePipes[kind]); cur = kind; }
        if (kind === 2) pass.setVertexBuffer(1, m.uvb);
        if (kind === 4) pass.setVertexBuffer(1, m.rest);
        drawOne(pass, i, dr, m);
      }
    };
    const drawGlass = (pass, pipe) => {
      pass.setPipeline(pipe);
      for (const i of glass) {
        const dr = o.meshes[i], m = this.meshes.get(dr.mesh);
        if (!m) continue;
        drawOne(pass, i, dr, m);
      }
    };
    const clearLightPass = (k, group, key) => {
      const p = encoder.beginRenderPass({ colorAttachments: [{ view: this.clearLightMaps.views[k], clearValue: [0, 0, 0, NO_GLASS], loadOp: 'clear', storeOp: 'store' }] });
      p.setBindGroup(0, group);
      drawGlass(p, key ? this.pipes.glassKey : this.pipes.glassPlaced);
      if (nP) { p.setPipeline(key ? this.pipes.waterKey : this.pipes.waterPlaced); p.draw(6, nP); }
      p.end();
    };

    let pass = encoder.beginRenderPass({ colorAttachments: [],
      depthStencilAttachment: { view: this.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, ...ts(2) });
    pass.setBindGroup(0, G.shadow);
    drawShadows(pass, o.objectCount, G.dispShadow);
    if (blocks) { pass.setPipeline(this.pipes.shadowBlock); pass.drawIndirect(blocks.args, 0); }
    pass.end();
    if (clear && this.frameData[92] + this.frameData[93] + this.frameData[94] > 0) clearLightPass(0, G.shadow, true);

    const layers = this.lightLayers || [];
    for (let k = 0; k < layers.length; k++) {
      if (!this.lightLayerBufs[k]) this.lightLayerBufs[k] = makeBuffer(d, FRAME_FLOATS * 4, UNIFORM(), 'light shadow view ' + k);
      const f2 = this.frameData.slice();
      f2.set(layers[k].vp, 64);
      f2.set([...layers[k].right, 0], 164);
      f2.set([...layers[k].up, 0], 168);
      f2.set(layers[k].pos, 193);
      d.queue.writeBuffer(this.lightLayerBufs[k], 0, f2);
      const pos = o.particles ? o.particles.pos : this.noParticles, col = o.particles ? o.particles.col : this.noParticles;
      const gk = this.lightLayerGroups || (this.lightLayerGroups = []);
      if (!gk[k] || gk[k].pos !== pos || gk[k].blockBuf !== this.blockBuf) gk[k] = { pos, blockBuf: this.blockBuf, group: makeGroup(d, this.L.shadow, [this.lightLayerBufs[k], this.drawBuf, pos, col, this.fluidBuf, this.blockBuf]) };
      pass = encoder.beginRenderPass({ colorAttachments: [],
        depthStencilAttachment: { view: this.lightShadow.views[k], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setBindGroup(0, gk[k].group);
      drawShadows(pass, o.objectCount, G.dispShadow);
      if (blocks) { pass.setPipeline(this.pipes.shadowBlock); pass.drawIndirect(blocks.args, 0); }
      pass.end();
      if (clear) clearLightPass(k + 1, gk[k].group, false);
    }

    const P = this.causticPlan, field = o.particles && o.particles.field;
    if (P && field && nP) {
      const C = this.ensureCaustics();
      if (this.groupStamp !== this.lightShadowStamp) { this.groups(o.smoke, o.particles); }
      const u = new Float32Array(44);
      u.set(P.vp, 0); u.set(P.inv, 16); u.set(P.box, 32); u.set(P.from, 36); u.set([P.layer, CAUSTIC_SIZE, CAUSTIC_LINES, 0], 40);
      d.queue.writeBuffer(C.buf, 0, u);
      let sg = C.surfaceGroups.get(field);
      if (!sg) { sg = makeGroup(d, this.L.causticSurface, [this.frameBuf, C.buf, field, this.linear]); C.surfaceGroups.set(field, sg); }
      pass = encoder.beginRenderPass({ colorAttachments: [
        { view: C.hitView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' },
        { view: C.nrmView, clearValue: [0, 1, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pipes.causticSurface); pass.setBindGroup(0, sg); pass.draw(3);
      pass.end();
      const depth = P.key ? this.shadowView : this.lightShadowView;
      let mg = C.meshGroups.get(depth);
      if (!mg) { mg = makeGroup(d, P.key ? this.L.causticKey : this.L.causticPlaced, [this.frameBuf, C.buf, C.hitView, C.nrmView, depth]); C.meshGroups.set(depth, mg); }
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: C.rawView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      pass.setBindGroup(0, mg);
      pass.setIndexBuffer(C.indices, 'uint32');
      pass.setPipeline(P.key ? this.pipes.causticFoldKey : this.pipes.causticFoldPlaced); pass.drawIndexed(C.count);
      pass.setPipeline(P.key ? this.pipes.causticBaseKey : this.pipes.causticBasePlaced); pass.drawIndexed(C.count);
      pass.end();
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: C.mapView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pipes.causticSoft); pass.setBindGroup(0, C.softGroup); pass.draw(3);
      pass.end();
    }

    pass = encoder.beginRenderPass({
      colorAttachments: [{ view: V.color, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: V.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setBindGroup(0, G.scene);
    pass.setPipeline(o.groundTex ? this.pipes.groundTex : this.pipes.ground); pass.draw(6);
    drawScene(pass);
    if (nP && o.look === 1) { pass.setPipeline(this.pipes.dots); pass.draw(6, nP); }
    if (blocks) { pass.setPipeline(this.pipes.block); pass.drawIndirect(blocks.args, 0); }
    if (this.showBox) { pass.setPipeline(this.pipes.lines); pass.draw(24); }
    pass.setPipeline(this.pipes.sky); pass.draw(3);
    if (blocks) { pass.setPipeline(this.pipes.blockClear); pass.drawIndirect(blocks.args, 16); }
    pass.end();

    if (glass.length) {
      const P = this.glassPictures, none = [0, 0, 0, 0];
      const at = (view, clearValue = none) => ({ view, clearValue, loadOp: 'clear', storeOp: 'store' });
      pass = encoder.beginRenderPass({ colorAttachments: [at(P.v.first, [NO_GLASS, 0, 0, 0])], depthStencilAttachment: { view: V.depth, depthReadOnly: true } });
      pass.setBindGroup(0, G.scene);
      drawGlass(pass, this.pipes.glassFirst);
      pass.end();
      pass = encoder.beginRenderPass({
        colorAttachments: [at(P.v.nearLight, [0, 0, 0, NO_GLASS]), at(P.v.nearTaken), at(P.v.farLight), at(P.v.farTaken)],
        depthStencilAttachment: { view: V.depth, depthReadOnly: true } });
      pass.setBindGroup(0, G.scene);
      pass.setBindGroup(1, P.depthGroup);
      {
        const pipes = [this.pipes.glass, this.pipes.glassTex, this.pipes.glassUv];
        let cur = -1;
        for (const i of glass) {
          const dr = o.meshes[i], m = this.meshes.get(dr.mesh);
          if (!m) continue;
          const k = dr.glassKind === 2 && !m.uvb ? 1 : dr.glassKind || 0;
          if (k !== cur) { pass.setPipeline(pipes[k]); cur = k; }
          if (k === 2) pass.setVertexBuffer(1, m.uvb);
          drawOne(pass, i, dr, m);
        }
      }
      pass.end();
      encoder.copyTextureToTexture({ texture: this.targets.color }, { texture: P.t.behind }, [this.width, this.height]);
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.color, loadOp: 'load', storeOp: 'store' }] });
      pass.setBindGroup(0, P.resolveGroup);
      pass.setPipeline(this.pipes.glassResolve); pass.draw(3);
      pass.end();
    }

    if (nP && o.look >= 2) {
      pass = encoder.beginRenderPass({
        colorAttachments: [{ view: V.fluidRaw, clearValue: [1e9, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: V.fluidZ, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setBindGroup(0, G.fluid);
      pass.setPipeline(this.pipes.fluidDepth); pass.draw(6, nP);
      pass.end();
      if (this.liquidLook === 3 && G.fieldGroup) {
        pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.fluidB, loadOp: 'clear', clearValue: [1e9, 0, 0, 0], storeOp: 'store' },
          { view: V.fieldThick, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' },
          { view: V.thick, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
        pass.setBindGroup(0, G.fieldGroup);
        pass.setPipeline(this.pipes.field); pass.draw(3);
        pass.end();
      } else {
        pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.fieldThick, clearValue: [6e4, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
        pass.setBindGroup(0, G.body);
        pass.setPipeline(this.pipes.body); pass.draw(3);
        pass.end();
        pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.thick, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
        pass.setBindGroup(0, G.fluid);
        pass.setPipeline(this.pipes.fluidThick); pass.draw(6, nP);
        pass.end();
        const outs = [V.fluidA, V.fluidB, V.fluidA, V.fluidB];
        for (let i = 0; i < 4; i++) {
          pass = encoder.beginRenderPass({ colorAttachments: [{ view: outs[i], loadOp: 'clear', clearValue: [1e9, 0, 0, 0], storeOp: 'store' }] });
          pass.setBindGroup(0, this.blurGroups[i]);
          pass.setPipeline(this.pipes.blur); pass.draw(3);
          pass.end();
        }
      }
    }

    if (o.cellsPass) o.cellsPass(encoder, V);

    this.lastFrame = { comp: G.comp, waterKnown: nP > 0 && o.look >= 2 };

    this.screenTexture = this.context.getCurrentTexture();
    const screen = this.screenTexture.createView();
    const picked = o.picked || [], lastPass = picked.length ? {} : ts(undefined, 3);
    const spread = this.post && wantsBloom(this.post);
    const keep = !!o.keepScene, lightToo = spread || (keep && !!o.keepLight);
    if (lightToo) this.ensureBloom();
    const media = this.media;
    if (media) this.ensureMedia();
    const afterPost = media ? this.mediaView : screen;
    pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.post || keep ? V.post : afterPost, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
      ...(lightToo ? [{ view: this.bloom.lightView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] : [])], ...(this.post || media || keep ? {} : lastPass) });
    pass.setBindGroup(0, G.comp);
    pass.setPipeline(lightToo ? this.pipes.compLight : this.pipes.comp); pass.draw(3);
    pass.end();
    if (keep && !this.post) {
      const K = this.ensureSceneCopy();
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: afterPost, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }], ...(media ? {} : lastPass) });
      pass.setBindGroup(0, K.group);
      pass.setPipeline(K.pipe); pass.draw(3);
      pass.end();
    }
    this.lastFrame.kept = keep;
    this.lastFrame.light = lightToo;
    if (spread) {
      d.queue.writeBuffer(this.bloomBuf, 0, new Float32Array(bloomNumbers(this.post)));
      this.renderBloom(encoder);
    }

    if (this.post) {
      const build = buildOn(this.post);
      if (build) this.ensureBuild();
      d.queue.writeBuffer(this.postBuf, 0, packPost(this.post, this.width, this.height, this.frameData[83], this.postData,
        [this.frameData[42], this.frameData[46], nP > 0 && o.look >= 2]));
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: build ? this.buildView : afterPost, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
        ...(media || build ? {} : lastPass) });
      pass.setBindGroup(0, spread ? this.bloom.post : this.postGroup);
      pass.setPipeline(this.pipes.post); pass.draw(3);
      pass.end();
      if (build) {
        pass = encoder.beginRenderPass({ colorAttachments: [{ view: afterPost, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }], ...(media ? {} : lastPass) });
        pass.setBindGroup(0, this.buildGroup);
        pass.setPipeline(this.pipes.build); pass.draw(3);
        pass.end();
      }
    }

    if (media) {
      d.queue.writeBuffer(this.mediaBuf, 0, packMedia(media, this.width, this.height, this.frameData[83], this.mediaData));
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: screen, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }], ...lastPass });
      pass.setBindGroup(0, this.mediaGroup);
      pass.setPipeline(this.pipes.media); pass.draw(3);
      pass.end();
      if (media.ghost > 0) encoder.copyTextureToTexture({ texture: this.screenTexture }, { texture: this.mediaLast }, [this.width, this.height]);
    }

    if (picked.length) {
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: V.pickMask, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: V.depth, depthLoadOp: 'load', depthStoreOp: 'store' } });
      pass.setBindGroup(0, G.scene);
      for (const [pipe, pipeD] of [[this.pipes.pickWhole, this.pipes.pickWholeD], [this.pipes.pickSeen, this.pipes.pickSeenD]]) {
        let cur = -1;
        for (const i of picked) {
          const dr = o.meshes[i], m = this.meshes.get(dr.mesh);
          if (!m) continue;
          const disp = dr.kind === 3 ? 1 : 0;
          if (disp !== cur) { pass.setPipeline(disp ? pipeD : pipe); cur = disp; }
          drawOne(pass, i, dr, m);
        }
      }
      pass.end();
      const scale = this.width / (this.canvas.clientWidth || this.width);
      d.queue.writeBuffer(this.outlineBuf, 0, new Float32Array([...OUTLINE_COLOR, 1.1 * Math.max(1, scale)]));
      pass = encoder.beginRenderPass({ colorAttachments: [{ view: screen, loadOp: 'load', storeOp: 'store' }], ...ts(undefined, 3) });
      pass.setBindGroup(0, this.outlineGroup);
      pass.setPipeline(this.pipes.outline); pass.draw(3);
      pass.end();
    }
  }
}
