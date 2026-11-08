export const ART_SIZE = 512, ART_LAYERS = 8;
export const GLYPH_SIZE = 32, GLYPHS = 128;
export const GLYPH_BASE = ART_SIZE * ART_SIZE * ART_LAYERS;
export const ART_TEXELS = GLYPH_BASE + GLYPH_SIZE * GLYPH_SIZE * GLYPHS;

export const FLUID_LOOK_WGSL =  `
const ART_SIZE = ${ART_SIZE};
const GLYPH_SIZE = ${GLYPH_SIZE};
const GLYPH_BASE = ${GLYPH_BASE}u;
fn pickedOne(y: f32) -> f32 {
  let t = min(y, 0.98);
  let a = 2.43 * t - 2.51;
  let b = 0.59 * t - 0.03;
  let c = 0.14 * t;
  let x = (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
  return max(x, 0.0) / max(F.env.y, 1e-3);
}
fn pickedCol(c: vec3<f32>) -> vec3<f32> { return vec3<f32>(pickedOne(c.r), pickedOne(c.g), pickedOne(c.b)); }
fn artTexel(layer: u32, x: i32, y: i32) -> vec4<f32> {
  let qx = ((x % ART_SIZE) + ART_SIZE) % ART_SIZE;
  let qy = ((y % ART_SIZE) + ART_SIZE) % ART_SIZE;
  return unpack4x8unorm(art[layer * u32(ART_SIZE * ART_SIZE) + u32(qy * ART_SIZE + qx)]);
}
fn artAt(layer: f32, uv: vec2<f32>) -> vec4<f32> {
  let q = uv * f32(ART_SIZE) - 0.5;
  let i = vec2<i32>(floor(q));
  let f = q - floor(q);
  let l = u32(layer);
  let c = mix(mix(artTexel(l, i.x, i.y), artTexel(l, i.x + 1, i.y), f.x), mix(artTexel(l, i.x, i.y + 1), artTexel(l, i.x + 1, i.y + 1), f.x), f.y);
  return vec4<f32>(pow(c.rgb, vec3<f32>(2.2)), c.a);
}
fn artOnSurface(w: u32, p: vec3<f32>, n: vec3<f32>) -> vec4<f32> {
  let t = 1.0 / max(FT[w].g.y, 1e-3);
  let q = p * t + vec3<f32>(0.0, -F.eye.w * FT[w].g.w * t, 0.0);
  let k = abs(n) * abs(n) * abs(n);
  let s = k / max(k.x + k.y + k.z, 1e-4);
  var c = vec4<f32>(0.0);
  if (s.y > 0.02) { c = c + artAt(FT[w].g.x, vec2<f32>(q.x, q.z)) * s.y; }
  if (s.x > 0.02) { c = c + artAt(FT[w].g.x, vec2<f32>(q.z, -q.y)) * s.x; }
  if (s.z > 0.02) { c = c + artAt(FT[w].g.x, vec2<f32>(q.x, -q.y)) * s.z; }
  return c;
}
fn glyphAt(index: u32, uv: vec2<f32>) -> f32 {
  let q = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.999)) * f32(GLYPH_SIZE) - 0.5;
  let i = vec2<i32>(floor(q));
  let f = q - floor(q);
  let base = GLYPH_BASE + index * u32(GLYPH_SIZE * GLYPH_SIZE);
  let T = u32(GLYPH_SIZE);
  let x0 = u32(clamp(i.x, 0, GLYPH_SIZE - 1));
  let x1 = u32(clamp(i.x + 1, 0, GLYPH_SIZE - 1));
  let y0 = u32(clamp(i.y, 0, GLYPH_SIZE - 1));
  let y1 = u32(clamp(i.y + 1, 0, GLYPH_SIZE - 1));
  let a = f32(art[base + y0 * T + x0] & 255u);
  let b = f32(art[base + y0 * T + x1] & 255u);
  let c = f32(art[base + y1 * T + x0] & 255u);
  let d = f32(art[base + y1 * T + x1] & 255u);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) / 255.0;
}
fn fluidColour(w: u32, own: vec3<f32>, k: f32) -> vec3<f32> {
  let m = FT[w].e.w;
  if (m < 0.5) { return own; }
  if (m < 1.5) { return FT[w].e.rgb; }
  return mix(FT[w].e.rgb, FT[w].f.rgb, clamp(k, 0.0, 1.0));
}
`;
