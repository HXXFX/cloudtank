
let opening = null;

export function openGPU() {
  if (!opening) opening = open();
  return opening;
}

async function open() {
  if (!navigator.gpu) throw new Error('This browser has no WebGPU, so the graphics card cannot be used. Chrome or Edge on a computer have it.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU found no usable graphics card.');
  const features = [];
  if (adapter.features.has('timestamp-query')) features.push('timestamp-query');
  const want = ['maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage',
    'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxBufferSize',
    'maxStorageBufferBindingSize', 'maxSampledTexturesPerShaderStage', 'maxBindGroups'];
  const requiredLimits = {};
  for (const k of want) requiredLimits[k] = adapter.limits[k];
  const device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits });
  device.lost.then(i => console.error('Graphics device lost:', i.message));
  device.addEventListener('uncapturederror', e => console.error('WebGPU:', e.error.message));
  return {
    device,
    info: adapter.info || {},
    format: navigator.gpu.getPreferredCanvasFormat(),
    timestamps: features.includes('timestamp-query'),
  };
}

export function cardName(info) {
  const d = (info.description || '').trim();
  if (d) return d;
  const makers = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', apple: 'Apple', qualcomm: 'Qualcomm' };
  const v = makers[(info.vendor || '').toLowerCase()] || info.vendor || 'unknown maker';
  const fam = info.architecture ? info.architecture[0].toUpperCase() + info.architecture.slice(1) : '';
  return fam ? `${v}, ${fam} family` : v;
}

export async function shaderModule(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(m => m.type === 'error');
  if (errors.length) {
    const lines = code.split('\n');
    const text = errors.map(m => `${label} line ${m.lineNum}: ${m.message}\n  > ${lines[m.lineNum - 1] || ''}`).join('\n');
    throw new Error('Shader did not compile:\n' + text);
  }
  return module;
}

const C = () => GPUShaderStage.COMPUTE;
const VF = () => GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;

export function makeLayout(device, spec, stage = 'compute') {
  const visibility = stage === 'compute' ? C() : VF();
  const entries = spec.map((s, binding) => {
    const e = { binding, visibility };
    if (s === 'uniform') e.buffer = { type: 'uniform' };
    else if (s === 'uniform-dyn') e.buffer = { type: 'uniform', hasDynamicOffset: true };
    else if (s === 'storage') e.buffer = { type: 'storage' };
    else if (s === 'read') e.buffer = { type: 'read-only-storage' };
    else if (s === 'tex3d') e.texture = { sampleType: 'float', viewDimension: '3d' };
    else if (s === 'tex3d-u') e.texture = { sampleType: 'unfilterable-float', viewDimension: '3d' };
    else if (s === 'tex2d') e.texture = { sampleType: 'float', viewDimension: '2d' };
    else if (s === 'tex2d-u') e.texture = { sampleType: 'unfilterable-float', viewDimension: '2d' };
    else if (s === 'tex2d-array') e.texture = { sampleType: 'float', viewDimension: '2d-array' };
    else if (s === 'depth') e.texture = { sampleType: 'depth', viewDimension: '2d' };
    else if (s === 'depth-array') e.texture = { sampleType: 'depth', viewDimension: '2d-array' };
    else if (s === 'sampler') e.sampler = { type: 'filtering' };
    else if (s === 'sampler-cmp') e.sampler = { type: 'comparison' };
    else if (s.startsWith('store3d:')) e.storageTexture = { access: 'write-only', format: s.slice(8), viewDimension: '3d' };
    else throw new Error('Unknown binding kind ' + s);
    return e;
  });
  return device.createBindGroupLayout({ entries });
}

export function makeGroup(device, layout, resources, label) {
  return device.createBindGroup({
    layout, label,
    entries: resources.map((r, binding) => {
      if (r instanceof GPUBuffer) return { binding, resource: { buffer: r } };
      if (r && r.buffer instanceof GPUBuffer) return { binding, resource: r };
      return { binding, resource: r };
    }),
  });
}

export function makeBuffer(device, size, usage, label) {
  return device.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage, label });
}

export const STORAGE = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
export const UNIFORM = () => GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

export function computePipeline(device, module, layouts, entryPoint = 'main', label) {
  return device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
    compute: { module, entryPoint },
  });
}
