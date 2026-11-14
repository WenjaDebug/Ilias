import * as THREE from 'three';

/**
 * Procedural textures, painted on canvases at startup.
 * Each material gets an albedo map, a normal map (derived from a height field) and
 * a roughness map, so lights from torches graze the surfaces convincingly.
 * Everything here is original, generated from noise – no external image files.
 */

type RGB = [number, number, number];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise with octaves. */
class Noise {
  private grid: Float32Array;
  constructor(private size: number, seed: number) {
    const r = mulberry32(seed);
    this.grid = new Float32Array(size * size);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = r();
  }
  private at(x: number, y: number) {
    const s = this.size;
    return this.grid[(((y % s) + s) % s) * s + (((x % s) + s) % s)];
  }
  sample(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.at(xi, yi), b = this.at(xi + 1, yi), c = this.at(xi, yi + 1), d = this.at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** fbm over [0,1)^2, tileable because each octave's period divides the grid size */
  fbm(x: number, y: number, baseFreq: number, octaves: number) {
    let amp = 0.5, f = baseFreq, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.sample(x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

function makeSet(size: number, painter: (x: number, y: number) => { c: RGB; h: number; r: number }, normalStrength = 2): TexSet {
  const height = new Float32Array(size * size);
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = size;
  const rough = document.createElement('canvas');
  rough.width = rough.height = size;
  const actx = albedo.getContext('2d')!;
  const rctx = rough.getContext('2d')!;
  const aimg = actx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = painter(x / size, y / size);
      const i = y * size + x;
      height[i] = p.h;
      aimg.data[i * 4] = p.c[0];
      aimg.data[i * 4 + 1] = p.c[1];
      aimg.data[i * 4 + 2] = p.c[2];
      aimg.data[i * 4 + 3] = 255;
      const rv = Math.max(0, Math.min(255, p.r * 255));
      rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rv;
      rimg.data[i * 4 + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  const norm = document.createElement('canvas');
  norm.width = norm.height = size;
  const nctx = norm.getContext('2d')!;
  const nimg = nctx.createImageData(size, size);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * normalStrength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nimg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const wrap = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: wrap(albedo, true), normalMap: wrap(norm, false), roughnessMap: wrap(rough, false) };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Sun-dried mud plaster: warm ochre with stains, cracks and subtle trowel marks. Texture covers 4 m. */
export function plaster(seed = 3): TexSet {
  const n = new Noise(256, seed);
  const n2 = new Noise(256, seed + 11);
  return makeSet(512, (x, y) => {
    const big = n.fbm(x, y, 4, 4);
    const fine = n2.fbm(x, y, 32, 3);
    const stain = clamp01((n.fbm(x + 0.3, y * 0.6, 8, 3) - 0.45) * 3);
    // vertical rain streaks
    const streak = clamp01((n2.fbm(x * 1.0, y * 0.08, 16, 2) - 0.55) * 4) * 0.5;
    const crack = Math.pow(1 - Math.abs(n.fbm(x, y, 16, 2) * 2 - 1), 30);
    let c = mix([168, 112, 74], [196, 146, 98], big);
    c = mix(c, [110, 70, 46], stain * 0.6 + streak * 0.4);
    c = mix(c, [60, 38, 28], crack * 0.8);
    const shade = 0.88 + fine * 0.24;
    c = [c[0] * shade, c[1] * shade, c[2] * shade];
    return { c, h: big * 0.6 + fine * 0.5 - crack * 0.8, r: 0.88 + fine * 0.1 };
  }, 3);
}

/** Irregular stone paving slabs. Texture covers 4 m. */
export function paving(seed = 7): TexSet {
  const n = new Noise(256, seed);
  const rows = 6;
  const r = mulberry32(seed);
  const offsets = Array.from({ length: rows }, () => r());
  const widths = Array.from({ length: rows }, () => 3 + Math.floor(r() * 3));
  return makeSet(512, (x, y) => {
    const row = Math.floor(y * rows);
    const fy = y * rows - row;
    const cols = widths[row];
    const fxRaw = x * cols + offsets[row] * cols;
    const col = Math.floor(fxRaw);
    const fx = fxRaw - col;
    const edge = Math.min(fx, 1 - fx, (fy) * cols / rows * 1.3, (1 - fy) * cols / rows * 1.3);
    const wob = n.fbm(x, y, 16, 2) * 0.05;
    const grout = clamp01((edge - 0.02 - wob) * 25);
    const tone = mulberry32(row * 97 + ((col % cols) + cols) % cols * 13 + seed)();
    const grain = n.fbm(x, y, 32, 4);
    let c = mix([92, 78, 66], [128, 108, 88], tone * 0.7 + grain * 0.3);
    c = mix([38, 30, 26], c, grout);
    const dirt = clamp01((n.fbm(x, y, 4, 3) - 0.5) * 2.5);
    c = mix(c, [54, 40, 30], dirt * 0.5);
    return { c, h: grout * (0.7 + grain * 0.3), r: 0.75 + (1 - grout) * 0.2 - grain * 0.1 };
  }, 4);
}

/** Large dressed limestone blocks for the city wall and temple. Texture covers 4 m. */
export function stoneBlocks(seed = 21): TexSet {
  const n = new Noise(256, seed);
  return makeSet(512, (x, y) => {
    const rows = 5;
    const row = Math.floor(y * rows);
    const fy = y * rows - row;
    const fxr = x * 3 + (row % 2) * 0.5;
    const fx = fxr - Math.floor(fxr);
    const edge = Math.min(fx * 3 / rows * 1.6, (1 - fx) * 3 / rows * 1.6, fy, 1 - fy);
    const grout = clamp01((edge - 0.025) * 30);
    const grain = n.fbm(x, y, 32, 4);
    const big = n.fbm(x, y, 4, 3);
    const tone = mulberry32(row * 31 + Math.floor(fxr) * 7 + seed)();
    let c = mix([150, 122, 92], [184, 156, 120], tone * 0.5 + big * 0.5);
    c = mix(c, [96, 76, 60], clamp01((grain - 0.5) * 2) * 0.5);
    c = mix([50, 40, 32], c, grout);
    return { c, h: grout * 0.8 + grain * 0.3, r: 0.85 + grain * 0.1 };
  }, 3);
}

/** Rough-hewn wooden planks (horse, doors, crates). Texture covers 2 m, planks run along U. */
export function planks(seed = 5): TexSet {
  const n = new Noise(256, seed);
  return makeSet(512, (x, y) => {
    const count = 8;
    const p = Math.floor(y * count);
    const fy = y * count - p;
    const pr = mulberry32(p * 53 + seed);
    const tone = pr();
    const grainLines = n.fbm(x * 0.5 + tone, fy * 0.15 + p * 0.37, 32, 3);
    const rings = Math.sin((grainLines * 30 + x * 6) * 1.0) * 0.5 + 0.5;
    const seam = clamp01(Math.min(fy, 1 - fy) * 30);
    const knot = Math.pow(clamp01(1 - Math.hypot((x - pr()) * 6, (fy - 0.5) * 2) * 2.2), 2) * (pr() > 0.5 ? 1 : 0);
    let c = mix([74, 46, 28], [122, 82, 50], tone * 0.6 + rings * 0.4);
    c = mix(c, [40, 24, 14], knot * 0.8);
    c = mix([20, 12, 8], c, seam);
    return { c, h: seam * 0.6 + rings * 0.15 - knot * 0.3, r: 0.7 + rings * 0.2 };
  }, 3);
}

/** Packed earth / dirt for side alleys. */
export function dirt(seed = 13): TexSet {
  const n = new Noise(256, seed);
  return makeSet(256, (x, y) => {
    const g = n.fbm(x, y, 8, 5);
    const pebble = clamp01((n.fbm(x, y, 64, 2) - 0.62) * 8);
    let c = mix([64, 46, 34], [104, 78, 56], g);
    c = mix(c, [130, 110, 90], pebble * 0.6);
    return { c, h: g * 0.5 + pebble * 0.5, r: 0.95 };
  }, 3);
}

export function makeMaterial(set: TexSet, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(1, 1),
    ...opts,
  });
}

/** Rewrite UVs of a box geometry so textures are mapped in world units (tile = metres per texture). */
export function worldUVBox(geo: THREE.BufferGeometry, w: number, h: number, d: number, tile: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const px = pos.getX(i) + w / 2, py = pos.getY(i) + h / 2, pz = pos.getZ(i) + d / 2;
    let u: number, v: number;
    if (ny > 0.5) { u = px; v = pz; }
    else if (nx > 0.5) { u = pz; v = py; }
    else { u = px; v = py; }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

/** Soft radial glow sprite (used for flames, embers, smoke). */
export function radialSprite(inner: string, outer: string, size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flame strip texture: a vertical tongue of fire, animated by UV scrolling in the shader. */
export function flameTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size * 2;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size * 2);
  const n = new Noise(64, 99);
  for (let y = 0; y < size * 2; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / (size * 2);
      const nn = n.fbm(u, v, 4, 4);
      const i = (y * size + x) * 4;
      const val = clamp01(nn * 1.6 - 0.3);
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = val * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * CC0 PBR texture sets from Poly Haven (https://polyhaven.com), stored in public/textures.
 * Each set: _diff (albedo), _nor (OpenGL normal), _arm (AO / roughness / metalness).
 */
export const loadingManager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(loadingManager);
const cache = new Map<string, TexSet & { aoMap: THREE.Texture }>();

export function pbrSet(name: string) {
  let s = cache.get(name);
  if (!s) {
    const base = `${import.meta.env.BASE_URL}textures/${name}`;
    const load = (suffix: string, srgb: boolean) => {
      const t = texLoader.load(`${base}_${suffix}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const arm = load('arm', false);
    s = { map: load('diff', true), normalMap: load('nor', false), roughnessMap: arm, aoMap: arm };
    cache.set(name, s);
  }
  return s;
}

export function pbrMaterial(name: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  const s = pbrSet(name);
  return new THREE.MeshStandardMaterial({
    map: s.map,
    normalMap: s.normalMap,
    roughnessMap: s.roughnessMap,
    aoMap: s.aoMap,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: 0,
    ...opts,
  });
}
