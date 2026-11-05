import { makeLayout, makeGroup, makeBuffer, UNIFORM, STORAGE, shaderModule, computePipeline } from './gpu.js';
import { SCENE_WGSL, SOLVER_GROUP0 } from './sdf.wgsl.js';
import { lightOf } from './settings.js';

export const MIXING = 0.5;

const HEADER = SCENE_WGSL +  `
struct FP {
  dims: vec4<f32>,
  origin: vec4<f32>,
  a: vec4<f32>,
  b: vec4<f32>,
  push0: vec4<f32>,
  push1: vec4<f32>,
  pushVel: vec4<f32>,
  emit: vec4<f32>,
  c: vec4<f32>,
  wind: vec4<f32>,
};
` + SOLVER_GROUP0('FP') +  `
@group(1) @binding(0) var<storage, read_write> pos: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read_write> vel: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read_write> col: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read_write> acc: array<atomic<i32>>;
@group(1) @binding(4) var<storage, read_write> grid: array<f32>;
@group(1) @binding(5) var<storage, read_write> cell: array<u32>;
@group(1) @binding(6) var<storage, read_write> cols: array<vec4<f32>>;

const SCALE = 65536.0;
const X = vec3<i32>(1, 0, 0);
const Y = vec3<i32>(0, 1, 0);
const Z = vec3<i32>(0, 0, 1);

fn dimsI() -> vec3<i32> { return vec3<i32>(P.dims.xyz); }
fn G() -> u32 { return u32((P.dims.x + 1.0) * (P.dims.y + 1.0) * (P.dims.z + 1.0)); }
fn idx(c: vec3<i32>) -> u32 {
  return u32(c.x + (i32(P.dims.x) + 1) * (c.y + (i32(P.dims.y) + 1) * c.z));
}
fn coordOf(i: u32) -> vec3<i32> {
  let sx = u32(P.dims.x) + 1u;
  let sy = u32(P.dims.y) + 1u;
  return vec3<i32>(i32(i % sx), i32((i / sx) % sy), i32(i / (sx * sy)));
}
fn isCell(c: vec3<i32>) -> bool { return all(c >= vec3<i32>(0)) && all(c < dimsI()); }
fn cellType(c: vec3<i32>) -> u32 {
  if (!isCell(c)) { return 2u; }
  return cell[idx(c)];
}
fn axis(k: u32) -> vec3<i32> {
  if (k == 0u) { return X; }
  if (k == 1u) { return Y; }
  return Z;
}
fn faceOffset(k: u32) -> vec3<f32> {
  if (k == 0u) { return vec3<f32>(0.0, 0.5, 0.5); }
  if (k == 1u) { return vec3<f32>(0.5, 0.0, 0.5); }
  return vec3<f32>(0.5, 0.5, 0.0);
}
fn faceExists(c: vec3<i32>, k: u32) -> bool {
  let n = dimsI() + axis(k);
  return all(c >= vec3<i32>(0)) && all(c < n);
}
fn weight3(f: vec3<f32>, o: vec3<i32>) -> f32 {
  return select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1) * select(1.0 - f.z, f.z, o.z == 1);
}
fn dyeOf(c: vec3<f32>) -> vec3<f32> { return -log(max(c, vec3<f32>(0.02))); }
`;

const CLEAR =  `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let n = G();
  if (g.x >= n) { return; }
  for (var k = 0u; k < 10u; k = k + 1u) { atomicStore(&acc[k * n + g.x], 0); }
}`;

const EMIT =  `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let t = g.x;
  if (t >= u32(P.emit.x)) { return; }
  var e = E[0];
  var found = false;
  for (var i = 0u; i < u32(P.b.z); i = i + 1u) {
    let ei = E[i];
    if (ei.d.x == 2.0 && f32(t) >= ei.d.y && f32(t) < ei.d.y + ei.d.z) { e = ei; found = true; }
  }
  if (!found) { return; }
  let slot = (u32(P.emit.z) + t) % u32(P.emit.y);
  let r = hash3(t * 7919u + u32(P.emit.w) * 104729u + 17u);
  let speed = length(e.c.xyz);
  var dir = vec3<f32>(0.0, -1.0, 0.0);
  if (speed > 1e-4) { dir = e.c.xyz / speed; }
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(dir.y) > 0.9) { up = vec3<f32>(1.0, 0.0, 0.0); }
  let ax = normalize(cross(dir, up));
  let ay = cross(dir, ax);
  let ang = r.x * 6.2831853;
  let rad = sqrt(r.y) * e.a.w;
  let p = e.a.xyz + (ax * cos(ang) + ay * sin(ang)) * rad + dir * (r.z * speed * P.c.x);
  pos[slot] = vec4<f32>(p, 0.0);
  vel[slot] = vec4<f32>(e.c.xyz, 0.0);
  col[slot] = vec4<f32>(dyeOf(e.b.rgb), 0.0);
}`;

const P2G =  `
fn splat(k: u32, q: vec3<f32>, value: f32, n: u32) {
  let fq = floor(q);
  let b = vec3<i32>(fq);
  let f = q - fq;
  for (var dz = 0; dz < 2; dz = dz + 1) {
    for (var dy = 0; dy < 2; dy = dy + 1) {
      for (var dx = 0; dx < 2; dx = dx + 1) {
        let o = vec3<i32>(dx, dy, dz);
        let c = b + o;
        if (!faceExists(c, k)) { continue; }
        let w = weight3(f, o);
        let id = idx(c);
        atomicAdd(&acc[k * n + id], i32(round(w * value * SCALE)));
        atomicAdd(&acc[(k + 3u) * n + id], i32(round(w * SCALE)));
      }
    }
  }
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= u32(P.b.x)) { return; }
  if (pos[i].w > 0.5) { return; }
  let p = pos[i].xyz;
  var v = vel[i].xyz;
  if (P.wind.w > 0.0) {
    let cc = clamp(vec3<i32>(floor((p - P.origin.xyz) / P.dims.w)), vec3<i32>(0), dimsI() - vec3<i32>(1));
    var airSides = 0;
    if (cellType(cc + X) == 0u) { airSides = airSides + 1; }
    if (cellType(cc - X) == 0u) { airSides = airSides + 1; }
    if (cellType(cc + Y) == 0u) { airSides = airSides + 1; }
    if (cellType(cc - Y) == 0u) { airSides = airSides + 1; }
    if (cellType(cc + Z) == 0u) { airSides = airSides + 1; }
    if (cellType(cc - Z) == 0u) { airSides = airSides + 1; }
    if (airSides > 0) {
      let grip = select(0.25, 1.0, airSides >= 5);
      let k = 1.0 - exp(-P.wind.w * grip * P.origin.w);
      let w = vec3<f32>(P.wind.x, 0.0, P.wind.z);
      v = vec3<f32>(v.x + (w.x - v.x) * k, v.y, v.z + (w.z - v.z) * k);
      vel[i] = vec4<f32>(v, 0.0);
    }
  }
  if (P.push1.w > 0.0) {
    let f = stirWeight(p, P.push0.xyz, P.push1.xyz, P.push0.w);
    if (f > 0.0) {
      v = mix(v, P.pushVel.xyz, f * 0.5);
      vel[i] = vec4<f32>(v, 0.0);
    }
  }
  let q = (p - P.origin.xyz) / P.dims.w;
  let n = G();
  splat(0u, q - faceOffset(0u), v.x, n);
  splat(1u, q - faceOffset(1u), v.y, n);
  splat(2u, q - faceOffset(2u), v.z, n);
  let c = clamp(vec3<i32>(floor(q)), vec3<i32>(0), dimsI() - vec3<i32>(1));
  let id = idx(c);
  atomicAdd(&acc[6u * n + id], 1);
  let a = col[i].xyz;
  atomicAdd(&acc[7u * n + id], i32(round(a.r * SCALE)));
  atomicAdd(&acc[8u * n + id], i32(round(a.g * SCALE)));
  atomicAdd(&acc[9u * n + id], i32(round(a.b * SCALE)));
}`;

const NORMALIZE =  `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let n = G();
  let i = g.x;
  if (i >= n) { return; }
  for (var k = 0u; k < 3u; k = k + 1u) {
    let w = atomicLoad(&acc[(k + 3u) * n + i]);
    var v = 0.0;
    if (w > 0) { v = f32(atomicLoad(&acc[k * n + i])) / f32(w); }
    grid[k * n + i] = v;
    grid[(k + 3u) * n + i] = v;
  }
  let c = coordOf(i);
  if (isCell(c)) {
    var t = 0u;
    let p = P.origin.xyz + (vec3<f32>(c) + 0.5) * P.dims.w;
    if (sceneSdf(p, u32(P.b.y)).x < 0.0) { t = 2u; }
    else if (atomicLoad(&acc[6u * n + i]) > 0) { t = 1u; }
    cell[i] = t;
    let count = f32(atomicLoad(&acc[6u * n + i]));
    for (var k = 0u; k < 3u; k = k + 1u) {
      var m = 0.0;
      if (count > 0.0) { m = f32(atomicLoad(&acc[(7u + k) * n + i])) / (SCALE * count); }
      grid[(6u + k) * n + i] = m;
    }
  }
}`;

const BOUNDARY =  `
fn solidVel(c: vec3<i32>) -> vec3<f32> {
  if (!isCell(c)) { return vec3<f32>(0.0); }
  let p = P.origin.xyz + (vec3<f32>(c) + 0.5) * P.dims.w;
  let hit = sceneSdf(p, u32(P.b.y));
  return solidVelAt(p, O[u32(hit.y)]);
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let n = G();
  let i = g.x;
  if (i >= n) { return; }
  let c = coordOf(i);
  let dt = P.origin.w;
  for (var k = 0u; k < 3u; k = k + 1u) {
    if (!faceExists(c, k)) { continue; }
    let a = c - axis(k);
    let ta = cellType(a);
    let tb = cellType(c);
    var v = grid[k * n + i];
    if (k == 1u) { v = v - P.a.x * dt; }
    if (ta == 2u || tb == 2u) {
      var sv = vec3<f32>(0.0);
      if (ta == 2u && isCell(a)) { sv = solidVel(a); }
      else if (tb == 2u && isCell(c)) { sv = solidVel(c); }
      v = sv[k];
    }
    grid[k * n + i] = v;
  }
}`;

const SINK_DIV =  `
  let pc = P.origin.xyz + (vec3<f32>(c) + 0.5) * P.dims.w;
  for (var k = 0u; k < u32(P.b.z); k = k + 1u) {
    let e = E[k];
    if (e.d.x != 4.0) { continue; }
    div = div + e.b.w * sinkWeight(pc, e) * P.dims.w;
  }`;
const PRESSURE = sinks =>  `
@group(2) @binding(0) var<uniform> parity: vec4<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let nx = u32(P.dims.x);
  let ny = u32(P.dims.y);
  let nz = u32(P.dims.z);
  let i = g.x;
  if (i >= nx * ny * nz) { return; }
  let c = vec3<i32>(i32(i % nx), i32((i / nx) % ny), i32(i / (nx * ny)));
  if (u32(c.x + c.y + c.z) % 2u != parity.x) { return; }
  let id = idx(c);
  if (cell[id] != 1u) { return; }
  let n = G();
  let sx0 = f32(cellType(c - X) != 2u);
  let sx1 = f32(cellType(c + X) != 2u);
  let sy0 = f32(cellType(c - Y) != 2u);
  let sy1 = f32(cellType(c + Y) != 2u);
  let sz0 = f32(cellType(c - Z) != 2u);
  let sz1 = f32(cellType(c + Z) != 2u);
  let s = sx0 + sx1 + sy0 + sy1 + sz0 + sz1;
  if (s == 0.0) { return; }
  let ix1 = idx(c + X);
  let iy1 = idx(c + Y);
  let iz1 = idx(c + Z);
  var div = grid[ix1] - grid[id] + grid[n + iy1] - grid[n + id] + grid[2u * n + iz1] - grid[2u * n + id];
  let rest = P.a.z;
  if (rest > 0.0) {
    var squeeze = f32(atomicLoad(&acc[6u * n + id])) / rest - 1.0;
    let interior = cellType(c - X) != 0u && cellType(c + X) != 0u && cellType(c - Y) != 0u
                && cellType(c + Y) != 0u && cellType(c - Z) != 0u && cellType(c + Z) != 0u;
    if (!interior) { squeeze = max(squeeze, 0.0); }
    div = div - P.a.w * clamp(squeeze, -0.5, 1.0) * P.dims.w / P.origin.w;
  }
${sinks ? SINK_DIV : ''}
  let p = -div / s * 1.9;
  grid[id] = grid[id] - sx0 * p;
  grid[ix1] = grid[ix1] + sx1 * p;
  grid[n + id] = grid[n + id] - sy0 * p;
  grid[n + iy1] = grid[n + iy1] + sy1 * p;
  grid[2u * n + id] = grid[2u * n + id] - sz0 * p;
  grid[2u * n + iz1] = grid[2u * n + iz1] + sz1 * p;
}`;

const G2P =  `
fn gather(k: u32, q: vec3<f32>, n: u32) -> vec3<f32> {
  let fq = floor(q);
  let b = vec3<i32>(fq);
  let f = q - fq;
  var r = vec3<f32>(0.0);
  for (var dz = 0; dz < 2; dz = dz + 1) {
    for (var dy = 0; dy < 2; dy = dy + 1) {
      for (var dx = 0; dx < 2; dx = dx + 1) {
        let o = vec3<i32>(dx, dy, dz);
        let c = b + o;
        if (!faceExists(c, k)) { continue; }
        if (cellType(c - axis(k)) != 1u && cellType(c) != 1u) { continue; }
        let w = weight3(f, o);
        let id = idx(c);
        r = r + vec3<f32>(w * grid[k * n + id], w * grid[(k + 3u) * n + id], w);
      }
    }
  }
  return r;
}
fn dyeAround(q: vec3<f32>, n: u32) -> vec4<f32> {
  let qc = q - vec3<f32>(0.5);
  let fq = floor(qc);
  let b = vec3<i32>(fq);
  let f = qc - fq;
  var r = vec4<f32>(0.0);
  for (var dz = 0; dz < 2; dz = dz + 1) {
    for (var dy = 0; dy < 2; dy = dy + 1) {
      for (var dx = 0; dx < 2; dx = dx + 1) {
        let o = vec3<i32>(dx, dy, dz);
        let c = b + o;
        if (!isCell(c)) { continue; }
        let id = idx(c);
        if (atomicLoad(&acc[6u * n + id]) == 0) { continue; }
        let w = weight3(f, o);
        r = r + vec4<f32>(w * vec3<f32>(grid[6u * n + id], grid[7u * n + id], grid[8u * n + id]), w);
      }
    }
  }
  return r;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= u32(P.b.x)) { return; }
  if (pos[i].w > 0.5) { return; }
  var p = pos[i].xyz;
  let v = vel[i].xyz;
  let q = (p - P.origin.xyz) / P.dims.w;
  let n = G();
  let flip = P.a.y;
  var nv = v;
  var jostle = vec3<f32>(0.0);
  for (var k = 0u; k < 3u; k = k + 1u) {
    let s = gather(k, q - faceOffset(k), n);
    if (s.z > 1e-6) {
      let pic = s.x / s.z;
      let flipV = v[k] + (s.x - s.y) / s.z;
      nv[k] = mix(pic, flipV, flip);
      jostle[k] = v[k] - s.y / s.z;
    }
  }
  nv = clamp(nv, vec3<f32>(-30.0), vec3<f32>(30.0));
  let around = dyeAround(q, n);
  if (around.w > 1e-6) {
    let rate = P.c.y * length(jostle) / P.dims.w;
    let a = col[i].xyz;
    col[i] = vec4<f32>(mix(a, around.xyz / around.w, 1.0 - exp(-rate * P.origin.w)), 0.0);
  }
  p = p + nv * P.origin.w;
  let count = u32(P.b.y);
  let r = P.b.w;
  if (count > 0u) {
    let hit = sceneSdf(p, count);
    if (hit.x < r) {
      let nrm = sceneNormal(p, count);
      p = p + nrm * (r - hit.x);
      let ov = solidVelAt(p, O[u32(hit.y)]);
      let vn = dot(nv - ov, nrm);
      if (vn < 0.0) { nv = nv - nrm * vn; }
    }
  }
  let lo = P.origin.xyz + vec3<f32>(r);
  let hi = P.origin.xyz + P.dims.xyz * P.dims.w - vec3<f32>(r);
  for (var k = 0u; k < 3u; k = k + 1u) {
    if (p[k] < lo[k]) { p[k] = lo[k]; nv[k] = max(nv[k], 0.0); }
    if (p[k] > hi[k]) { p[k] = hi[k]; nv[k] = min(nv[k], 0.0); }
  }
  pos[i] = vec4<f32>(p, 0.0);
  vel[i] = vec4<f32>(nv, 0.0);
}`;

const DRAIN =  `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= u32(P.b.x)) { return; }
  let q = pos[i];
  if (q.w > 0.5) { return; }
  for (var k = 0u; k < u32(P.b.z); k = k + 1u) {
    let e = E[k];
    if (e.d.x != 4.0) { continue; }
    let w = sinkWeight(q.xyz, e);
    if (w > 0.0) {
      let r = hash3(i * 9781u + u32(P.emit.w) * 6271u + k * 131u + bitcast<u32>(q.x)).x;
      if (r < 1.0 - exp(-e.b.w * w * P.origin.w)) { pos[i] = vec4<f32>(q.xyz, 1.0); return; }
    }
  }
}`;

const COLUMNS =  `
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let nx = u32(P.dims.x);
  let ny = i32(P.dims.y);
  let nz = u32(P.dims.z);
  let i = g.x;
  if (i >= nx * nz) { return; }
  let x = i32(i % nx);
  let z = i32(i / nx);
  let n = G();
  var out = vec4<f32>(-1.0, 0.0, 0.0, 0.0);
  var state = 0u;
  var drops = 0;
  for (var j = 0; j < ny; j = j + 1) { drops = drops + atomicLoad(&acc[6u * n + idx(vec3<i32>(x, j, z))]); }
  for (var j = 0; j < ny; j = j + 1) {
    let c = vec3<i32>(x, j, z);
    let t = cell[idx(c)];
    if (t == 2u) { out = vec4<f32>(-2.0, 0.0, 0.0, 0.0); break; }
    if (t == 1u && state < 2u) {
      state = 1u;
      out = vec4<f32>(P.origin.y + f32(j + 1) * P.dims.w,
        0.5 * (grid[idx(c)] + grid[idx(c + X)]),
        0.5 * (grid[2u * n + idx(c)] + grid[2u * n + idx(c + Z)]), 0.0);
    } else if (t == 0u && state == 1u) { state = 2u; }
  }
  out.w = f32(drops);
  cols[i] = out;
}`;

const LOOK =  `
@group(2) @binding(0) var lookOut: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (!isCell(c)) { return; }
  let n = G();
  let id = idx(c);
  var out = vec4<f32>(0.0);
  if (cell[id] == 1u) {
    let count = f32(atomicLoad(&acc[6u * n + id]));
    let fill = min(count / P.a.z, 1.0);
    let sums = vec3<f32>(f32(atomicLoad(&acc[7u * n + id])), f32(atomicLoad(&acc[8u * n + id])), f32(atomicLoad(&acc[9u * n + id])));
    out = vec4<f32>(sums / (SCALE * count) * fill, fill);
  }
  textureStore(lookOut, c, out);
}`;

export const FIELD = { R: 2.0, r: 0.45, fine: 2, soften: 1.0 };
const FIELD_MOST = 4.2e6;
const FIELD_HEAD =  `
struct FieldP { dims: vec4<f32>, k: vec4<f32>, origin: vec4<f32> };
@group(2) @binding(0) var<uniform> FQ: FieldP;
@group(2) @binding(1) var<storage, read_write> field: array<atomic<i32>>;
@group(2) @binding(2) var fieldOut: texture_storage_3d<rgba16float, write>;
const WSCALE = 4096.0;
const DSCALE = 1024.0;
fn fidx(c: vec3<i32>) -> u32 { return u32(c.x + i32(FQ.dims.x) * (c.y + i32(FQ.dims.y) * c.z)); }
`;
const FIELD_CLEAR = FIELD_HEAD +  `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= u32(FQ.dims.x * FQ.dims.y * FQ.dims.z) * 4u) { return; }
  atomicStore(&field[g.x], 0);
}`;
const FIELD_SPLAT = FIELD_HEAD +  `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= u32(FQ.k.z)) { return; }
  let p4 = pos[i];
  if (p4.w > 0.5) { return; }
  let q = (p4.xyz - FQ.origin.xyz) / FQ.dims.w - vec3<f32>(0.5);
  let R = FQ.k.x;
  let b = vec3<i32>(ceil(q - vec3<f32>(R)));
  let n = vec3<i32>(FQ.dims.xyz);
  let span = i32(floor(2.0 * R)) + 1;
  for (var dz = 0; dz < span; dz = dz + 1) {
    for (var dy = 0; dy < span; dy = dy + 1) {
      for (var dx = 0; dx < span; dx = dx + 1) {
        let c = b + vec3<i32>(dx, dy, dz);
        if (any(c < vec3<i32>(0)) || any(c >= n)) { continue; }
        let d = q - vec3<f32>(c);
        let r2 = dot(d, d) / (R * R);
        if (r2 >= 1.0) { continue; }
        let u = 1.0 - r2;
        let w = u * u * u;
        let k = fidx(c) * 4u;
        atomicAdd(&field[k], i32(w * WSCALE));
        atomicAdd(&field[k + 1u], i32(round(w * d.x * DSCALE)));
        atomicAdd(&field[k + 2u], i32(round(w * d.y * DSCALE)));
        atomicAdd(&field[k + 3u], i32(round(w * d.z * DSCALE)));
      }
    }
  }
}`;
const FIELD_TEX = FIELD_HEAD +  `
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec3<i32>(g);
  if (any(c >= vec3<i32>(FQ.dims.xyz))) { return; }
  let k = fidx(c) * 4u;
  let W = f32(atomicLoad(&field[k])) / WSCALE;
  var phi = FQ.k.w;
  if (W > 1e-3) {
    let off = vec3<f32>(f32(atomicLoad(&field[k + 1u])), f32(atomicLoad(&field[k + 2u])), f32(atomicLoad(&field[k + 3u]))) / (DSCALE * W);
    phi = min(length(off) * FQ.dims.w - FQ.k.y * smoothstep(1.0, 3.0, W), FQ.k.w);
  }
  textureStore(fieldOut, c, vec4<f32>(phi, W, 0.0, 1.0));
}`;

const PASSES = { clear: CLEAR, emit: EMIT, p2g: P2G, normalize: NORMALIZE, boundary: BOUNDARY, pressure: PRESSURE(false), pressureSink: PRESSURE(true),
  g2p: G2P, drain: DRAIN, columns: COLUMNS, look: LOOK, fieldClear: FIELD_CLEAR, fieldSplat: FIELD_SPLAT, fieldTex: FIELD_TEX };

const CARRY =  `
struct CP {
  a: vec4<f32>,
  lo: vec4<f32>,
  hi: vec4<f32>,
};
@group(0) @binding(0) var<uniform> C: CP;
@group(0) @binding(1) var<storage, read> oldPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> oldVel: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> oldCol: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> pos: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> vel: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> col: array<vec4<f32>>;
fn hash(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return f32((x >> 22u) ^ x) / 4294967295.0;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let j = g.x;
  if (j >= u32(C.a.y)) { return; }
  let i = min(u32(f32(j) / C.a.z), u32(C.a.x) - 1u);
  var p = oldPos[i].xyz;
  if (C.a.z > 1.0001) {
    p = p + (vec3<f32>(hash(j * 3u), hash(j * 3u + 1u), hash(j * 3u + 2u)) - 0.5) * C.lo.w;
  }
  var v = oldVel[i].xyz;
  let q = clamp(p, C.lo.xyz, C.hi.xyz);
  for (var k = 0u; k < 3u; k = k + 1u) { if (q[k] != p[k]) { v[k] = 0.0; } }
  pos[j] = vec4<f32>(q, oldPos[i].w);
  vel[j] = vec4<f32>(v, 0.0);
  col[j] = oldCol[i];
}`;
const carryPipes = new WeakMap();
async function carryPipe(d) {
  if (!carryPipes.has(d)) {
    const layout = makeLayout(d, ['uniform', 'read', 'read', 'read', 'storage', 'storage', 'storage']);
    const module = await shaderModule(d, CARRY, 'liquid carry');
    carryPipes.set(d, { layout, pipe: computePipeline(d, module, [layout], 'main', 'liquid carry') });
  }
  return carryPipes.get(d);
}

export function carriedCount(old, cell) { return Math.round(old.live * Math.pow(old.cell / cell, 3)); }

export class Flip {
  constructor(gpu, shared, { dims = [64, 32, 64], min = [-2, 0, -2], cell = 0.0625, maxParticles = 1 << 18, iterations = 40 } = {}) {
    this.gpu = gpu;
    this.device = gpu.device;
    this.shared = shared;
    this.dims = dims;
    this.min = min;
    this.cell = cell;
    this.max = [min[0] + dims[0] * cell, min[1] + dims[1] * cell, min[2] + dims[2] * cell];
    this.maxParticles = maxParticles;
    this.iterations = iterations;
    this.G = (dims[0] + 1) * (dims[1] + 1) * (dims[2] + 1);
    this.cells = dims[0] * dims[1] * dims[2];
    this.spawned = 0;
    this.restPerCell = 8;
    this.radius = cell * 0.25;
    this.params = new Float32Array(40);
    this.frame = 0;
    this.mixing = MIXING;
  }

  get live() { return Math.min(this.spawned, this.maxParticles); }
  get remaining() { return this.alive ?? this.live; }
  get full() { return this.spawned >= this.maxParticles; }
  get particleVolume() { return Math.pow(this.cell, 3) / this.restPerCell; }

  async init() {
    const d = this.device;
    const N = this.maxParticles, G = this.G;
    this.buf = {
      pos: makeBuffer(d, N * 16, STORAGE(), 'liquid positions'),
      vel: makeBuffer(d, N * 16, STORAGE(), 'liquid velocities'),
      col: makeBuffer(d, N * 16, STORAGE(), 'liquid dye'),
      acc: makeBuffer(d, G * 10 * 4, STORAGE(), 'liquid grid sums'),
      grid: makeBuffer(d, G * 9 * 4, STORAGE(), 'liquid grid'),
      cell: makeBuffer(d, G * 4, STORAGE(), 'liquid cell kinds'),
      cols: makeBuffer(d, this.dims[0] * this.dims[2] * 16, STORAGE(), 'water level by column'),
    };
    this.paramBuf = makeBuffer(d, this.params.byteLength, UNIFORM(), 'liquid settings');
    const [nx, ny, nz] = this.dims;
    this.lookTex = d.createTexture({ size: { width: nx, height: ny, depthOrArrayLayers: nz }, format: 'rgba16float', dimension: '3d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, label: 'liquid as drawn' });
    this.lookView = this.lookTex.createView();
    this.parityBuf = makeBuffer(d, 512, UNIFORM(), 'sweep colour');
    d.queue.writeBuffer(this.parityBuf, 0, new Uint32Array([0, 0, 0, 0]));
    d.queue.writeBuffer(this.parityBuf, 256, new Uint32Array([1, 0, 0, 0]));

    const l0 = makeLayout(d, ['uniform', 'uniform', 'uniform', 'tex3d', 'sampler']);
    const l1 = makeLayout(d, ['storage', 'storage', 'storage', 'storage', 'storage', 'storage', 'storage']);
    const l2 = makeLayout(d, ['uniform-dyn']);
    const l3 = makeLayout(d, ['store3d:rgba16float']);
    const lF = makeLayout(d, ['uniform', 'storage', 'store3d:rgba16float']);
    this.lF = lF;
    this.group0 = makeGroup(d, l0, [this.paramBuf, this.shared.emitters, this.shared.objects, this.shared.atlasView, this.shared.atlasSampler]);
    const b = this.buf;
    this.group1 = makeGroup(d, l1, [b.pos, b.vel, b.col, b.acc, b.grid, b.cell, b.cols]);
    this.colsRead = d.createBuffer({ size: this.dims[0] * this.dims[2] * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, label: 'water level, read back' });
    this.colsBusy = false;
    this.group2 = makeGroup(d, l2, [{ buffer: this.parityBuf, size: 16 }]);
    this.group3 = makeGroup(d, l3, [this.lookView]);
    this.pipes = {};
    for (const [name, code] of Object.entries(PASSES)) {
      const module = await shaderModule(d, HEADER + code, 'liquid ' + name);
      const layouts = name.startsWith('pressure') ? [l0, l1, l2] : name === 'look' ? [l0, l1, l3] : name.startsWith('field') ? [l0, l1, lF] : [l0, l1];
      this.pipes[name] = computePipeline(d, module, layouts, 'main', 'liquid ' + name);
    }
    this.carry = await carryPipe(d);
  }

  reset() { this.spawned = 0; this.alive = 0; }

  ensureField() {
    if (this.field && this.field.ask === FIELD.fine) return this.field;
    if (this.field) { this.field.params.destroy(); this.field.buf.destroy(); this.field.tex.destroy(); }
    const d = this.device, [nx, ny, nz] = this.dims;
    const k = nx * ny * nz * FIELD.fine ** 3 <= FIELD_MOST ? FIELD.fine : 1;
    const dims = [nx * k, ny * k, nz * k], fine = this.cell / k, n = dims[0] * dims[1] * dims[2];
    const params = makeBuffer(d, 48, UNIFORM(), 'water field settings');
    const buf = makeBuffer(d, n * 16, STORAGE(), 'water field sums');
    const tex = d.createTexture({ size: { width: dims[0], height: dims[1], depthOrArrayLayers: dims[2] }, format: 'rgba16float', dimension: '3d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, label: 'water field' });
    this.field = { ask: FIELD.fine, dims, fine, k, n, params, buf, tex, view: tex.createView(), group: makeGroup(d, this.lF, [params, buf, tex.createView()]) };
    return this.field;
  }

  buildField(pass) {
    const f = this.ensureField();
    const reach = FIELD.R * f.k, r = FIELD.r * this.cell;
    this.device.queue.writeBuffer(f.params, 0, new Float32Array([...f.dims, f.fine, reach, r, this.live, reach * f.fine - r, ...this.min, 0]));
    pass.setBindGroup(0, this.group0);
    pass.setBindGroup(1, this.group1);
    pass.setBindGroup(2, f.group);
    pass.setPipeline(this.pipes.fieldClear); pass.dispatchWorkgroups(Math.ceil(f.n * 4 / 256));
    if (this.live > 0) { pass.setPipeline(this.pipes.fieldSplat); pass.dispatchWorkgroups(Math.ceil(this.live / 256)); }
    pass.setPipeline(this.pipes.fieldTex);
    pass.dispatchWorkgroups(Math.ceil(f.dims[0] / 4), Math.ceil(f.dims[1] / 4), Math.ceil(f.dims[2] / 4));
  }

  carryFrom(old) {
    const d = this.device, n0 = old.live;
    if (!n0) return 0;
    const ratio = Math.pow(old.cell / this.cell, 3);
    const n = Math.min(this.maxParticles, carriedCount(old, this.cell));
    if (!n) return 0;
    const r = this.radius;
    const u = makeBuffer(d, 48, UNIFORM(), 'liquid carry settings');
    d.queue.writeBuffer(u, 0, new Float32Array([n0, n, ratio, 0,
      this.min[0] + r, this.min[1] + r, this.min[2] + r, this.cell * 0.5,
      this.max[0] - r, this.max[1] - r, this.max[2] - r, 0]));
    const group = makeGroup(d, this.carry.layout, [u, old.buf.pos, old.buf.vel, old.buf.col, this.buf.pos, this.buf.vel, this.buf.col], 'liquid carry');
    const enc = d.createCommandEncoder({ label: 'liquid carry' });
    const pass = enc.beginComputePass();
    pass.setPipeline(this.carry.pipe);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    d.queue.submit([enc.finish()]);
    d.queue.onSubmittedWorkDone().then(() => u.destroy());
    this.spawned = n;
    return n;
  }

  destroy() {
    for (const b of Object.values(this.buf)) b.destroy();
    this.lookTex.destroy();
    this.paramBuf.destroy();
    this.parityBuf.destroy();
    this.colsRead.destroy();
    if (this.field) { this.field.params.destroy(); this.field.buf.destroy(); this.field.tex.destroy(); this.field = null; }
  }

  endFrame(encoder) {
    if (this.colsBusy || this.live === 0) return;
    encoder.copyBufferToBuffer(this.buf.cols, 0, this.colsRead, 0, this.dims[0] * this.dims[2] * 16);
    this.colsPending = true;
  }

  readWater() {
    if (!this.colsPending || this.colsBusy) return null;
    this.colsPending = false;
    this.colsBusy = true;
    return this.colsRead.mapAsync(GPUMapMode.READ).then(() => {
      const cols = new Float32Array(this.colsRead.getMappedRange().slice(0));
      this.colsRead.unmap();
      this.colsBusy = false;
      let n = 0;
      for (let i = 3; i < cols.length; i += 4) n += cols[i];
      this.alive = n;
      return { min: [this.min[0], this.min[2]], cell: this.cell, nx: this.dims[0], nz: this.dims[2], cols };
    }).catch(() => { this.colsBusy = false; return null; });
  }

  fill(lo, hi, color) {
    const h = this.cell / 2, pts = [];
    for (let z = lo[2] + h / 2; z < hi[2]; z += h)
      for (let y = lo[1] + h / 2; y < hi[1]; y += h)
        for (let x = lo[0] + h / 2; x < hi[0]; x += h)
          pts.push([x + (Math.random() - 0.5) * h * 0.5, y + (Math.random() - 0.5) * h * 0.5, z + (Math.random() - 0.5) * h * 0.5]);
    const count = Math.min(pts.length, this.maxParticles - this.live);
    if (count <= 0) return 0;
    const first = this.spawned % this.maxParticles;
    const p = new Float32Array(count * 4), v = new Float32Array(count * 4), c = new Float32Array(count * 4);
    const dye = dyeOf(color);
    for (let i = 0; i < count; i++) { p.set([...pts[i], 0], i * 4); c.set(dye, i * 4); }
    const q = this.device.queue;
    q.writeBuffer(this.buf.pos, first * 16, p);
    q.writeBuffer(this.buf.vel, first * 16, v);
    q.writeBuffer(this.buf.col, first * 16, c);
    this.spawned += count;
    return count;
  }

  planEmission(emitters, frameDt, flow) {
    let total = 0;
    this.drains = emitters.filter(e => e.type === 'liquid' && e.sink).length;
    for (const e of emitters) {
      if (e.type !== 'liquid' || e.sink) continue;
      const perSecond = flow * e.rate * Math.PI * e.radius * e.radius * e.speed / this.particleVolume;
      e.carry = (e.carry || 0) + perSecond * frameDt;
      const n = Math.floor(e.carry);
      e.carry -= n;
      e.newFirst = total;
      e.newCount = n;
      total += n;
    }
    this.newCount = Math.min(total, this.maxParticles);
    this.firstSlot = this.spawned % this.maxParticles;
    this.spawned += this.newCount;
    return this.newCount;
  }

  writeParams(s) {
    const p = this.params;
    p.set([...this.dims, this.cell], 0);
    p.set([...this.min, s.dt], 4);
    p.set([s.gravity, s.splash, this.restPerCell, s.drift], 8);
    p.set([this.live, s.objectCount, s.emitterCount, this.radius], 12);
    const st = s.stir;
    p.set(st ? [...st.origin, st.radius, ...st.dir, 1, ...st.vel, 0] : new Array(12).fill(0), 16);
    p.set([this.newCount || 0, this.maxParticles, this.firstSlot || 0, this.frame++], 28);
    p.set([s.frameDt, this.mixing, this.drains || 0, 0], 32);
    p.set(s.wind ? [...s.wind.vel, s.wind.grip] : [0, 0, 0, 0], 36);
    this.device.queue.writeBuffer(this.paramBuf, 0, p);
  }

  step(pass, substeps) {
    const wgG = Math.ceil(this.G / 256), wgC = Math.ceil(this.cells / 256);
    const live = Math.ceil(this.live / 256);
    pass.setBindGroup(0, this.group0);
    pass.setBindGroup(1, this.group1);
    if (this.newCount > 0) {
      pass.setPipeline(this.pipes.emit);
      pass.dispatchWorkgroups(Math.ceil(this.newCount / 256));
    }
    if (this.live === 0) return;
    for (let s = 0; s < substeps; s++) {
      pass.setPipeline(this.pipes.clear); pass.dispatchWorkgroups(wgG);
      pass.setPipeline(this.pipes.p2g); pass.dispatchWorkgroups(live);
      pass.setPipeline(this.pipes.normalize); pass.dispatchWorkgroups(wgG);
      pass.setPipeline(this.pipes.boundary); pass.dispatchWorkgroups(wgG);
      pass.setPipeline(this.drains ? this.pipes.pressureSink : this.pipes.pressure);
      for (let it = 0; it < this.iterations; it++) {
        pass.setBindGroup(2, this.group2, [0]); pass.dispatchWorkgroups(wgC);
        pass.setBindGroup(2, this.group2, [256]); pass.dispatchWorkgroups(wgC);
      }
      pass.setPipeline(this.pipes.g2p); pass.dispatchWorkgroups(live);
      if (this.drains) { pass.setPipeline(this.pipes.drain); pass.dispatchWorkgroups(live); }
    }
    pass.setPipeline(this.pipes.columns);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] * this.dims[2] / 64));
    pass.setPipeline(this.pipes.look);
    pass.setBindGroup(2, this.group3);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 4), Math.ceil(this.dims[1] / 4), Math.ceil(this.dims[2] / 4));
  }
}

export function dyeOf(color) {
  return [...lightOf(color).map(v => -Math.log(Math.max(v, 0.02))), 0];
}
