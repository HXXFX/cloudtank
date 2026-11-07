export const IMAGE_SIZE = 2048;
export const IMAGE_LEVELS = 12;
export const MAX_IMAGE_LAYERS = 24;

export const IMAGE_FILE = /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i;
export const isImageFile = f => IMAGE_FILE.test(f.name) || f.type.startsWith('image/');

async function drawnBitmap(blob, w, h) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('The browser could not read this image.')); img.src = url; });
    const W = w || img.naturalWidth || 1024, H = h || img.naturalHeight || 1024;
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d').drawImage(img, 0, 0, W, H);
    return createImageBitmap(c, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } finally { URL.revokeObjectURL(url); }
}

export async function imageSize(blob) {
  let b;
  try { b = await createImageBitmap(blob); } catch { b = await drawnBitmap(blob); }
  const size = { width: b.width, height: b.height };
  b.close();
  return size;
}

export async function bitmapForCard(blob) {
  try {
    return await createImageBitmap(blob, { resizeWidth: IMAGE_SIZE, resizeHeight: IMAGE_SIZE, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    return drawnBitmap(blob, IMAGE_SIZE, IMAGE_SIZE);
  }
}

export async function imageThumb(blob, size = 48) {
  let b;
  try { b = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' }); } catch { b = await drawnBitmap(blob, size, size); }
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.getContext('2d').drawImage(b, 0, 0);
  b.close();
  return c.toDataURL('image/png');
}

export const IMAGE_SHADER =  `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(3.0, 1.0), vec2<f32>(-1.0, 1.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn fromScreen(c: vec3<f32>) -> vec3<f32> {
  return select(pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}
@fragment fn fsFirstColor(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let s = textureLoad(src, vec2<i32>(fc.xy), 0);
  return vec4<f32>(fromScreen(s.rgb) * s.a, s.a);
}
@fragment fn fsFirstData(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  return textureLoad(src, vec2<i32>(fc.xy), 0);
}
@fragment fn fsCopy(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let size = vec2<f32>(textureDimensions(src));
  return textureSampleLevel(src, samp, fc.xy / (size * 0.5), 0.0);
}
`;

export function subdivide(mesh, uvs, { first = 0, count = -1, most = 200000 } = {}) {
  const corners = count >= 0 ? count : mesh.length / 6;
  const tris = corners / 3;
  const key = (x, y, z) => `${Math.round(x * 2048)},${Math.round(y * 2048)},${Math.round(z * 2048)}`;
  const sum = new Map();
  for (let c = first; c < first + corners; c++) {
    const i = c * 6, k = key(mesh[i], mesh[i + 1], mesh[i + 2]);
    const s = sum.get(k) || [0, 0, 0];
    s[0] += mesh[i + 3]; s[1] += mesh[i + 4]; s[2] += mesh[i + 5];
    sum.set(k, s);
  }
  let level = 0;
  while (tris * Math.pow(4, level + 1) <= most && level < 8) level++;
  const out = new Float32Array(tris * Math.pow(4, level) * 3 * 11);
  let w = 0;
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const put = v => { out.set(v, w); w += 11; };
  const mid = (a, b) => {
    const n = unit([a[3] + b[3], a[4] + b[4], a[5] + b[5]]), p = unit([a[6] + b[6], a[7] + b[7], a[8] + b[8]]);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, ...n, ...p, (a[9] + b[9]) / 2, (a[10] + b[10]) / 2];
  };
  const split = (a, b, c, n) => {
    if (n === 0) { put(a); put(b); put(c); return; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split(a, ab, ca, n - 1); split(ab, b, bc, n - 1); split(ca, bc, c, n - 1); split(ab, bc, ca, n - 1);
  };
  const corner = c => {
    const i = c * 6, p = unit(sum.get(key(mesh[i], mesh[i + 1], mesh[i + 2])));
    return [mesh[i], mesh[i + 1], mesh[i + 2], mesh[i + 3], mesh[i + 4], mesh[i + 5], ...p, uvs ? uvs[c * 2] : 0, uvs ? uvs[c * 2 + 1] : 0];
  };
  for (let t = 0; t < tris; t++) split(corner(first + t * 3), corner(first + t * 3 + 1), corner(first + t * 3 + 2), level);
  return out;
}
