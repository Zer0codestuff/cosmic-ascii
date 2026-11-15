// Builds hooks/scene.ts: an animated ASCII solar system as one self-contained SVG.
//
// Each body is rendered in 3D (orthographic camera above the orbital plane)
// into a character grid with the ASCII pipeline of the author's site (Menlo glyph
// ramp, tone curve, Sobel contour glyphs). Globes are rendered fully lit; the
// Sun's light and the phases come from a gradient shade over each globe that
// turns with the orbit. All motion is SMIL. No script runs in the scene.
//
// Rules measured in the desktop app (any of these freezes the whole scene):
// no viewport media query, no CSS mask-image, no vector-effect. The build
// refuses them. The source must stay under 131,072 characters.
//
// Run: node tools/build-scene.mjs [preview-dir]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// ---------------------------------------------------------------- settings

const VIEW = { w: 1600, h: 900 };
const CENTRE = { x: 800, y: 450 };
/** Vertical squash of the orbital plane: sin(camera elevation). */
const K = 0.4;
const ELEVATION = Math.asin(K);
/** Cell size in SVG units. Height is twice the width, as in a terminal. */
const FONT = 4.8;
const CW = FONT * 0.6;
const CH = CW * 2;
/** Orbit transforms step on a shared tick so repaints coincide. */
const FPS = 20;
/** Seconds per Earth orbit; other periods follow sqrt(real period). */
const EARTH_PERIOD = 50;
/** Overall glyph brightness under the chat. */
const GAIN = 0.95;
/** Brightness steps per colour. */
const LEVELS = 4;
/** Keyframes per orbit for the light mask. */
const MASK_KEYS = 16;
/** Jupiter's band pattern repeats this many times around; equals its spin frames. */
const JUPITER_REPEAT = 12;
/** Planets are lit for beauty, not physics: bright and dense. */
const PLANET_EXPOSURE = 1.9;

const DEG = Math.PI / 180;
const LUMA = [0.2126, 0.7152, 0.0722];

// Real sidereal periods in Earth years.
const REAL = { mercury: 0.2408, venus: 0.6152, earth: 1, mars: 1.8808, jupiter: 11.862, saturn: 29.457, uranus: 84.01, neptune: 164.8, pluto: 247.94 };
const period = (name) => EARTH_PERIOD * Math.sqrt(REAL[name]);

// Planet colours from the site (linear).
const TINT = {
  sun: [1.0, 0.62, 0.16],
  mercury: [0.72, 0.68, 0.62],
  moon: [0.8, 0.78, 0.74],
  venus: [1.0, 0.74, 0.38],
  earth: [1, 1, 1],
  mars: [1.0, 0.34, 0.16],
  jupiter: [1.0, 0.72, 0.44],
  saturn: [1.0, 0.84, 0.52],
  uranus: [0.28, 0.86, 0.94],
  neptune: [0.2, 0.4, 1.0],
  pluto: [0.76, 0.53, 0.4],
};

// Sizes and orbits in SVG units, not to scale. Starting angles are the site's.
// Earth's orbit keeps its globe clear of the Sun's disc, so only Mercury and
// Venus need a second copy drawn over the Sun.
const BODIES = [
  { name: 'mercury', flat: true, kind: 'rock', R: 20, orbit: 145, angle: -165 },
  { name: 'venus', flat: true, kind: 'cloud', sat: 2, R: 31, orbit: 215, angle: 45 },
  { name: 'earth', kind: 'earth', R: 42, orbit: 330, angle: -120, tilt: 23.4, spin: { n: 12, period: 32 }, levels: 2, palette: [[0.25, 0.55, 1], [0.55, 0.8, 0.35], [1, 0.82, 0.55], [1, 1, 1]],
    moons: [{ name: 'moon', R: 7, r: 1.95, k: 0.32, period: 27, start: 40 }] },
  { name: 'mars', kind: 'rock', R: 28, orbit: 400, angle: 130, tilt: 25, caps: true, spin: { n: 10, period: 34 }, levels: 2, sat: 1.8, palette: [[1, 0.42, 0.22], [1, 0.62, 0.42], [1, 0.97, 0.94]] },
  { name: 'jupiter', kind: 'jupiter', R: 78, orbit: 545, angle: -175, tilt: 3, spin: { n: JUPITER_REPEAT, period: 44 }, levels: 3, sat: 3, palette: [[1, 0.86, 0.66], [1, 0.64, 0.36], [0.85, 0.47, 0.25], [1, 0.33, 0.18]],
    moons: [
      { dot: '#ffe08a', r: 1.4, k: 0.1, period: 9, start: 20 },
      { dot: '#e8e4dc', r: 1.75, k: 0.1, period: 18, start: 200 },
      { dot: '#c8b8a0', r: 2.2, k: 0.1, period: 36, start: 110 },
      { dot: '#9a8f86', r: 2.85, k: 0.1, period: 84, start: 300 },
    ] },
  { name: 'saturn', flat: true, kind: 'saturn', sat: 2, R: 52, orbit: 640, angle: -10, rings: true },
  { name: 'uranus', flat: true, kind: 'cloud', R: 36, orbit: 715, angle: -100, tilt: 98 },
  { name: 'neptune', flat: true, kind: 'neptune', R: 35, orbit: 765, angle: 65, tilt: 28 },
  { name: 'pluto', flat: true, kind: 'rock', R: 14, orbit: 797, angle: -45 },
];
const SUN_R = 90;
const SUN_EXPOSURE = 1.6;
const BELT = { inner: 438, outer: 466 };
const crossesSun = (b) => b.orbit * K - b.R < SUN_R;

// ---------------------------------------------------------------- math

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (len(a) || 1));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
const rotX = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const rotAxis = (v, k, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  const cross = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return add(add(scale(v, c), scale(cross, s)), scale(k, dot(k, v) * (1 - c)));
};

// Camera: X right, Y north, Z toward the viewer. Screen y grows downward.
const V = [0, Math.sin(ELEVATION), Math.cos(ELEVATION)];
const RIGHT = [1, 0, 0];
const UP = [0, Math.cos(ELEVATION), -Math.sin(ELEVATION)];

// Noise, as in the site's common.glsl.
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const hash2 = (x, y) => [
  -1 + 2 * fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123),
  -1 + 2 * fract(Math.sin(x * 269.5 + y * 183.3) * 43758.5453123),
];
function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), ux), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy);
}
function fbm(x, y) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 6; i++) { v += valueNoise(x, y) * a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return v;
}
function craters(x, y) {
  const cx = Math.floor(x), cy = Math.floor(y);
  const lx = x - cx, ly = y - cy;
  let pit = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const j = hash2(cx + ox, cy + oy);
    const ccx = ox + 0.5 + 0.35 * j[0], ccy = oy + 0.5 + 0.35 * j[1];
    const radius = 0.16 + 0.22 * hash(cx + ox + 7, cy + oy + 7);
    const d = Math.hypot(lx - ccx, ly - ccy) / radius;
    pit += smoothstep(1, 0.75, d) * 0.5 - smoothstep(1.25, 1, d) * smoothstep(0.75, 1, d) * 0.35;
  }
  return pit;
}

// ---------------------------------------------------------------- glyph ramp

// Ink coverage measured in Menlo (canvas, the site's measureCoverage method).
const COVERAGE = {
  ' ': 0, '.': 0.0536, '-': 0.0724, ':': 0.0876, '!': 0.1007, '~': 0.105, ';': 0.1152, '+': 0.1293,
  '=': 0.1429, 'v': 0.1629, 'x': 0.177, '*': 0.1825, 'o': 0.2075, 'e': 0.2178, 'w': 0.2233, 'a': 0.2248,
  '$': 0.2492, 'd': 0.2525, '&': 0.2715, '#': 0.279, '8': 0.2916, 'B': 0.312, 'W': 0.3138, '@': 0.3378,
};
const RAMP = (() => {
  const scored = Object.entries(COVERAGE).sort((a, b) => a[1] - b[1]);
  const out = [];
  for (const entry of scored) {
    const prev = out[out.length - 1];
    if (prev && entry[1] - prev[1] < 0.008) { out[out.length - 1] = entry; continue; }
    out.push(entry);
  }
  return out.map((e) => e[0]);
})();
const DIRS = ['-', '/', '|', '\\'];

const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * Resolves a grid of linear colours into glyphs, as the site's cell pass:
 * exponential tone curve, ramp quantisation, faint Sobel contours.
 * `flatTint` keeps a one-colour world in one hue; brightness lives in glyph
 * density and LEVELS steps of the fill.
 */
function resolveGlyphs(colors, cols, rows, flatTint, levels = LEVELS, palette = null, sat = 1) {
  const lum = colors.map((c) => (c ? dot(c, LUMA) : 0));
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : lum[r * cols + c]);
  const out = new Array(cols * rows).fill(null);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const l = lum[i];
    const color = colors[i];
    if (!color || l <= 0) continue;
    const tl = at(c - 1, r - 1), tc = at(c, r - 1), tr = at(c + 1, r - 1);
    const ml = at(c - 1, r), mr = at(c + 1, r);
    const bl = at(c - 1, r + 1), bc = at(c, r + 1), br = at(c + 1, r + 1);
    const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
    const gy = (tl + 2 * tc + tr) - (bl + 2 * bc + br);
    const edge = Math.hypot(gx, gy);
    const shaped = Math.pow(1 - Math.exp(-l * 1.15 * 1.3), 0.62);
    let ch = RAMP[clamp(Math.round(shaped * (RAMP.length - 1)), 0, RAMP.length - 1)];
    const edgeMask = (edge > 0.8 ? 1 : 0) * smoothstep(0.06, 0.14, shaped) * (1 - smoothstep(0.22, 0.34, shaped));
    if (edgeMask > 0.5) {
      const angle = Math.atan2(gy, gx) + Math.PI / 2;
      const bucket = Math.floor((((angle + Math.PI / 8) % Math.PI) + Math.PI) % Math.PI / (Math.PI / 4)) % 4;
      ch = DIRS[bucket];
    }
    const brightness = 0.3 + 0.7 * smoothstep(0.06, 0.85, shaped);
    const present = smoothstep(0.1, 0.22, shaped);
    const peak = Math.max(color[0], color[1], color[2]);
    let tint = peak > 0.012 ? scale(color, 1 / peak) : [1, 1, 1];
    if (flatTint) tint = scale(flatTint, 1 / Math.max(...flatTint));
    // A few named hues keep colour runs long, which keeps spin frames small.
    if (palette) {
      let best = palette[0], bestD = Infinity;
      for (const entry of palette) {
        const e = scale(entry, 1 / Math.max(...entry));
        const d = (e[0] - tint[0]) ** 2 + (e[1] - tint[1]) ** 2 + (e[2] - tint[2]) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
      tint = best;
    }
    // Quantised tints drift toward pastel; a per-body exponent keeps them rich.
    if (sat !== 1) tint = tint.map((t) => Math.pow(t, sat));
    const level = Math.ceil(srgb(clamp(brightness * present * GAIN, 0, 1)) * levels) / levels;
    const q = tint.map((t) => Math.round(srgb(Math.round(t * 4) / 4) * level * 15));
    if (ch === ' ' || (q[0] === 0 && q[1] === 0 && q[2] === 0)) continue;
    out[i] = { ch, fill: '#' + q.map((x) => x.toString(16)).join('') };
  }
  return out;
}

// ---------------------------------------------------------------- surfaces

const earthRows = readFileSync(join(here, 'earth-256x128.txt'), 'utf8').trim().split('\n');
const EW = earthRows[0].length, EH = earthRows.length;
function earthSample(u, v) {
  const x = fract(u) * EW - 0.5, y = clamp((1 - v) * EH - 0.5, 0, EH - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (xx, yy) => (earthRows[clamp(yy, 0, EH - 1)].charCodeAt(((xx % EW) + EW) % EW) - 48) * 4 / 255;
  return mix(mix(g(x0, y0), g(x0 + 1, y0), fx), mix(g(x0, y0 + 1), g(x0 + 1, y0 + 1), fx), fy);
}

function toLocal(n, body, spinAngle) {
  let p = rotZ(n, -(body.tilt ?? 0) * DEG);
  p = rotY(p, -spinAngle);
  return p;
}

function surfaceUv(p) {
  const lat = Math.asin(clamp(p[1], -1, 1));
  const lon = Math.atan2(p[0], p[2]);
  return [lon / (2 * Math.PI) + 0.5, lat / Math.PI + 0.5];
}

/**
 * Linear colour of a body's surface point as seen fully lit (light from the
 * viewer), ported from the site's body.frag/earth.frag. The Sun's direction
 * is applied later by the CSS mask, so only albedo and limb darkening live here.
 */
function shadePlanet(body, n, spinAngle) {
  const facing = Math.max(0, dot(n, V));
  const p = toLocal(n, body, spinAngle);
  const [u, v] = surfaceUv(p);
  const limb = 0.35 + 0.65 * Math.pow(facing, 0.55);

  if (body.kind === 'earth') {
    const w = earthSample(u, v);
    const wShade = (earthSample(u + 1 / EW, v - 1 / EH) - earthSample(u - 1 / EW, v + 1 / EH)) * 3;
    const land = smoothstep(0.05, 0.11, w);
    const height = clamp((w - 0.125) / 0.875, 0, 1);
    const ground = clamp(0.3 + height * 0.6 + wShade * 1.3 * land, 0.1, 1.1);
    const swell = fbm(u * 260, v * 130);
    const water = 0.16 + 0.16 * smoothstep(0.45, 0.75, swell);
    const greens = mix3([0.32, 0.5, 0.2], [0.75, 0.62, 0.4], smoothstep(0.3, 0.7, height + fbm(u * 40, v * 20) * 0.3));
    let surface = mix3(scale([0.07, 0.32, 1.0], water), scale(greens, ground * 1.25), land);
    const ice = smoothstep(0.82, 0.9, Math.abs(p[1]) + fbm(u * 30, v * 15) * 0.05);
    surface = mix3(surface, [0.95, 0.97, 1], ice);
    const cp = scale(p, 3.2);
    const clouds = fbm(cp[0] * 1.7 + cp[2], cp[1] * 1.7 + cp[2]) * fbm(cp[2] * 2.3 - cp[0] + 4, cp[1] * 2.3 - cp[0] + 4);
    const cover = smoothstep(0.24, 0.4, clouds) * 0.7;
    surface = mix3(surface, [0.92, 0.92, 0.92], cover);
    let color = scale(surface, limb * 1.1);
    color = add(color, scale([0.25, 0.5, 1.0], Math.pow(1 - facing, 2.6) * 0.5));
    return color;
  }

  const tint = TINT[body.name];
  let pigment = tint;
  let albedo;
  const grain = fbm(u * 36, v * 18);
  if (body.kind === 'rock') {
    const plains = smoothstep(0.38, 0.62, fbm(u * 7 + 11, v * 3.5 + 11));
    const pits = craters(u * 26, v * 13);
    albedo = 0.3 + plains * 0.3 + grain * 0.2 - pits * 0.22;
    if (body.caps) {
      const cap = smoothstep(0.84, 0.9, Math.abs(p[1]) + fbm(u * 20, v * 10) * 0.06);
      pigment = mix3(pigment, [1, 0.97, 0.94], cap);
      albedo = mix(albedo, 0.92, cap);
    }
  } else if (body.kind === 'cloud') {
    const decks = fbm(u * 7, v * 20 + grain * 0.9);
    albedo = 0.3 + 0.5 * decks + 0.12 * Math.sin(v * 44 + decks * 5);
  } else if (body.kind === 'jupiter') {
    // Belts follow latitude. Their turbulence repeats exactly JUPITER_REPEAT
    // times around the planet, one repeat per spin frame, so every frame is
    // the same picture except the Great Red Spot, which travels across: the
    // spin costs only the spot's cells.
    const ja = 2 * Math.PI * u * JUPITER_REPEAT;
    const jx = Math.cos(ja) * 1.7, jy = Math.sin(ja) * 1.7;
    const turbulence = fbm(jx + 3.1, v * 9 + jy);
    const jgrain = fbm(jx * 2.3 + 7.7, v * 22 + jy * 2.3);
    const belts = Math.sin(v * 58 + turbulence * 2.4 + Math.sin(ja) * 0.22);
    albedo = 0.42 + belts * 0.32 + jgrain * 0.1;
    pigment = mix3(tint.map((t, i) => t * [0.78, 0.55, 0.38][i]), [1.0, 0.92, 0.78], smoothstep(-0.5, 0.65, belts));
    const sx = (u - 0.62) * 11.5, sy = (v - 0.4) * 21;
    // A compact spot with a sharp edge: only its own cells change per frame.
    let eye = smoothstep(0.3, 0.75, Math.exp(-(sx * sx + sy * sy)));
    if (NO_SPOT) eye = 0;
    pigment = mix3(pigment, [0.95, 0.32, 0.15], eye * 0.85);
    albedo = mix(albedo, 0.86 - 0.3 * Math.sin(Math.hypot(sx, sy) * 9), eye * 0.85);
  } else if (body.kind === 'saturn') {
    const bands = Math.sin(v * 74 + grain * 3);
    albedo = 0.46 + bands * 0.2 + grain * 0.18;
    pigment = mix3(tint, [1.0, 0.94, 0.78], smoothstep(-0.3, 0.8, bands) * 0.65);
  } else {
    const winds = fbm(u * 8, v * 36);
    const sx = (u - 0.64) * 12, sy = (v - 0.42) * 22;
    albedo = 0.3 + winds * 0.42 + grain * 0.1;
    albedo *= 1 - Math.exp(-(sx * sx + sy * sy)) * 0.48;
    albedo += smoothstep(0.62, 0.7, fbm(u * 30, v * 8)) * 0.22;
  }
  albedo = clamp(albedo, 0, 1);
  albedo = albedo * albedo * 1.4;
  const value = Math.max(albedo, 0.05) * (0.25 + 0.95 * limb);
  const pl = dot(pigment, LUMA);
  return scale(pigment, value / Math.max(0.4, pl));
}

let NO_SPOT = false;

// Saturn's rings, in globe radii.
const RING = { inner: 0.94 / 0.72, outer: 1.5 / 0.72 };
const RING_NORMAL = norm(rotAxis(rotX([0, 1, 0], 5 * DEG), V, -14 * DEG));

function shadeRing(X) {
  const rn = len(X) / RING.outer;
  const division = 1 - smoothstep(0.78, 0.795, rn) * (1 - smoothstep(0.82, 0.835, rn));
  const bands = 0.62 + 0.2 * Math.sin(rn * 170) + 0.14 * Math.sin(rn * 61);
  return { color: scale([0.86, 0.76, 0.57], bands), alpha: division * 0.85 };
}

// ---------------------------------------------------------------- rasterising

const SS = 4; // supersamples per cell axis

function gridFor(extentX, extentY) {
  return { cols: 2 * Math.ceil(extentX / CW) + 2, rows: 2 * Math.ceil(extentY / CH) + 2 };
}

/** Renders one body, fully lit, at one spin angle: globe cells and ring cells apart. */
function renderBody(body, spinAngle) {
  const extent = body.rings ? body.R * RING.outer : body.R;
  const extentY = body.rings ? body.R * RING.outer * Math.max(Math.abs(dot(RING_NORMAL, V)), 0.5) : body.R;
  const { cols, rows } = gridFor(extent + CW, extentY + CH * 0.5);
  const colors = new Array(cols * rows).fill(null);
  const isRing = new Array(cols * rows).fill(false);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let acc = [0, 0, 0], hits = 0, ringHits = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const px = (c - cols / 2 + (i + 0.5) / SS) * CW;
      const py = (r - rows / 2 + (j + 0.5) / SS) * CH;
      const sx = px / body.R, sy = py / body.R;
      const Q = add(scale(RIGHT, sx), scale(UP, -sy));
      const s2 = sx * sx + sy * sy;
      let sample = null;
      let sphereT = -Infinity;
      if (s2 < 1) {
        const nz = Math.sqrt(1 - s2);
        sphereT = nz;
        sample = shadePlanet(body, add(Q, scale(V, nz)), spinAngle);
      }
      if (body.rings) {
        const t = -dot(Q, RING_NORMAL) / dot(V, RING_NORMAL);
        const X = add(Q, scale(V, t));
        const rr = len(X);
        if (rr > RING.inner && rr < RING.outer && t > sphereT) {
          const ring = shadeRing(X);
          sample = add(scale(ring.color, ring.alpha), scale(sample ?? [0, 0, 0], 1 - ring.alpha));
          ringHits++;
        }
      }
      if (sample) { acc = add(acc, sample); hits++; }
    }
    if (hits) colors[r * cols + c] = scale(acc, 1 / (SS * SS));
    if (ringHits > 0 && ringHits * 2 >= hits) isRing[r * cols + c] = true;
  }
  for (let i = 0; i < colors.length; i++) if (colors[i]) colors[i] = scale(colors[i], PLANET_EXPOSURE);
  const cells = resolveGlyphs(colors, cols, rows, body.flat ? TINT[body.name] : null, body.levels ?? LEVELS, body.palette ?? null, body.sat ?? 1);
  const pick = (keep) => ({ cols, rows, cells: cells.map((cell, i) => (cell && keep(i) ? cell : null)) });
  return { globe: pick((i) => !isRing[i]), ring: pick((i) => isRing[i]) };
}

/** The Sun's disc and corona as one grid, plus each cell's layer. */
function renderSun() {
  const extent = SUN_R * 1.05;
  const { cols, rows } = gridFor(extent, extent);
  const colors = new Array(cols * rows).fill(null);
  const inDisc = new Array(cols * rows).fill(false);
  const tint = TINT.sun;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let acc = [0, 0, 0], disc = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const px = (c - cols / 2 + (i + 0.5) / SS) * CW;
      const py = (r - rows / 2 + (j + 0.5) / SS) * CH;
      const sx = px / SUN_R, sy = py / SUN_R;
      const s2 = sx * sx + sy * sy;
      const d = Math.sqrt(s2);
      const angle = Math.atan2(sy, sx);
      const streamers = 0.5 + 0.5 * valueNoise(angle * 6 + 20, d * 3);
      let color = [0, 0, 0];
      if (s2 < 1) {
        disc++;
        const nz = Math.sqrt(1 - s2);
        const n = add(add(scale(RIGHT, sx), scale(UP, -sy)), scale(V, nz));
        const [u, v] = surfaceUv(n);
        const convection = fbm(u * 15, v * 7.5);
        const cells = fbm(u * 64, v * 32);
        const spots = smoothstep(0.62, 0.76, fbm(u * 9 + 3, v * 5 + 3));
        let value = 0.2 + smoothstep(0.3, 0.7, convection) * 0.58 + cells * 0.24;
        value *= 0.4 + 0.6 * Math.pow(nz, 0.6);
        value *= 1 - spots * 0.7;
        color = scale(mix3(tint, [1.0, 0.96, 0.86], smoothstep(0.62, 0.98, value)), value * SUN_EXPOSURE);
      }
      acc = add(acc, color);
    }
    colors[r * cols + c] = scale(acc, 1 / (SS * SS));
    inDisc[r * cols + c] = disc * 2 >= SS * SS;
  }
  return { cols, rows, cells: resolveGlyphs(colors, cols, rows, null, 5), inDisc };
}

// ---------------------------------------------------------------- SVG output

// Fill classes are lowercase letters; every structural class has an uppercase
// letter, so the two families can never collide.
const classes = new Map();
const classOf = (fill) => {
  if (!classes.has(fill)) {
    const i = classes.size;
    const alpha = 'abcdefghijklmnopqrstuvwxyz';
    classes.set(fill, i < 26 ? alpha[i] : alpha[Math.floor(i / 26) - 1] + alpha[i % 26]);
  }
  return classes.get(fill);
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (x) => String(Math.round(x * 10) / 10);
const pct = (x) => `${Math.round(x * 10) / 10}%`;
const sec = (s) => `${Math.round(s * 1000) / 1000}s`;
const tick = 1 / FPS;
const q = (s) => Math.round(s / tick) * tick;

/**
 * One <text> for a grid. The commonest colour is the text's own; each row
 * starts with a positioned tspan and other colours are unpositioned tspans.
 * Spaces join runs (white-space: pre).
 */
function gridText(grid, extraClass = '') {
  const { cols, rows, cells } = grid;
  const counts = new Map();
  for (const cell of cells) if (cell) counts.set(classOf(cell.fill), (counts.get(classOf(cell.fill)) ?? 0) + 1);
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  let out = '';
  for (let r = 0; r < rows; r++) {
    let c0 = -1, c1 = -1;
    for (let c = 0; c < cols; c++) if (cells[r * cols + c]) { if (c0 < 0) c0 = c; c1 = c; }
    if (c0 < 0) continue;
    const y = (r - rows / 2 + 0.5) * CH;
    const runs = [];
    let current = null;
    for (let c = c0; c <= c1; c++) {
      const cell = cells[r * cols + c];
      if (!cell) { if (current) current.text += ' '; continue; }
      const cls = classOf(cell.fill);
      if (!current || current.cls !== cls) { current = { cls, text: '' }; runs.push(current); }
      current.text += cell.ch;
    }
    runs.forEach((run, i) => {
      const own = run.cls === dominant ? '' : ` class="${run.cls}"`;
      if (i === 0) out += `<tspan x="${num((c0 - cols / 2) * CW)}" y="${num(y)}"${own}>${esc(run.text)}</tspan>`;
      else out += own ? `<tspan${own}>${esc(run.text)}</tspan>` : esc(run.text);
    });
  }
  const cls = [dominant, extraClass].filter(Boolean).join(' ');
  return out ? `<text class="${cls}">${out}</text>` : '';
}

/** Splits frames into the cells that never change and the ones that do. */
function splitStatic(frames) {
  const { cols, rows } = frames[0];
  const same = (a, b) => (!a && !b) || (a && b && a.ch === b.ch && a.fill === b.fill);
  const fixed = new Array(cols * rows).fill(null);
  const varying = frames.map(() => new Array(cols * rows).fill(null));
  for (let i = 0; i < cols * rows; i++) {
    const first = frames[0].cells[i];
    if (frames.every((f) => same(f.cells[i], first))) fixed[i] = first;
    else frames.forEach((f, k) => { varying[k][i] = f.cells[i]; });
  }
  return { fixed: { cols, rows, cells: fixed }, varying: varying.map((cells) => ({ cols, rows, cells })) };
}

/** Half-size of the square that holds every drawn cell of these grids. */
function boxHalf(grids, R) {
  let h = R;
  for (const { cols, rows, cells } of grids) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!cells[r * cols + c]) continue;
      h = Math.max(h, Math.abs((c - cols / 2) * CW), Math.abs((c + 1 - cols / 2) * CW), Math.abs((r - rows / 2) * CH), Math.abs((r + 1 - rows / 2) * CH));
    }
  }
  return Math.ceil(h + 1);
}

const css = [];
const shades = [];
const report = [];

// Motion is SMIL (<animate>, <animateTransform>). Every element's resting
// state (no animation) is still a composed picture. The desktop app freezes
// the whole scene when it holds a viewport media query, a CSS mask-image or
// vector-effect (measured in the app); the build refuses all three.
const rotate = (from, to, T) =>
  `<animateTransform attributeName="transform" type="rotate" from="${num(from)}" to="${num(to)}" dur="${sec(T)}" repeatCount="indefinite"/>`;
const discrete = (attr, values, keyTimes, T, begin = 0) =>
  `<animate attributeName="${attr}" values="${values.join(';')}" keyTimes="${keyTimes.map((k) => Math.round(k * 1e5) / 1e5).join(';')}" calcMode="discrete" dur="${sec(T)}"${begin ? ` begin="${sec(begin)}"` : ''} repeatCount="indefinite"/>`;
const breathe = (low, T, begin) =>
  `<animate attributeName="opacity" values="${low};1;${low}" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="${sec(T)}" begin="${sec(begin)}" repeatCount="indefinite"/>`;

/** A value that is `inside` on [from, to) of each cycle (fractions): its resting value and its <animate>. */
function windowAnimate(attr, from, to, inside, outside, T) {
  const at = (s) => { const f = ((s % 1) + 1) % 1; return from <= to ? (f >= from && f < to) : (f >= from || f < to); };
  const marks = [...new Set([0, from, to].map((x) => ((x % 1) + 1) % 1))].sort((a, b) => a - b);
  const values = marks.map((m) => (at(m + 1e-9) ? inside : outside));
  return { rest: at(1e-9) ? inside : outside, el: discrete(attr, values, marks, T) };
}

/**
 * Light-mask steps over one orbit, one class per step. At orbital angle phi
 * the Sun lies along -P; projected on screen it gives the gradient's
 * direction, and the terminator crosses the disc's centre line at t0 = -L.V
 * (in radii). The gradient line of a square box of half-size H spans
 * 2H(|sin a| + |cos a|).
 */
function lightKeys(R, H, phi0) {
  const keys = [];
  for (let i = 0; i <= MASK_KEYS; i++) {
    const phi = phi0 + (i / MASK_KEYS) * 360;
    const P = [Math.cos(phi * DEG), 0, -Math.sin(phi * DEG)];
    const L = scale(P, -1);
    const lx = dot(L, RIGHT), ly = -dot(L, UP), lz = dot(L, V);
    // CSS-style angle of the night-to-day direction (0 = up, 90 = right).
    const a = Math.atan2(lx, -ly) / DEG;
    // Phases are softened: a world between us and the Sun keeps a readable crescent.
    const t0 = -0.45 * lz;
    keys.push({ a, x: t0 * R });
  }
  // Unwrap the angle so the shade turns the short way between keys.
  for (let i = 1; i < keys.length; i++) {
    while (keys[i].a - keys[i - 1].a > 180) keys[i].a -= 360;
    while (keys[i].a - keys[i - 1].a < -180) keys[i].a += 360;
  }
  return keys;
}

function timing(name, angle) {
  const steps = Math.round(period(name) * FPS);
  const T = steps * tick;
  const phi0 = ((angle % 360) + 360) % 360;
  return { T, phi0, steps };
}

function planetMarkup(body, idx) {
  const spin = body.spin ?? { n: 1, period: 1 };
  const renders = Array.from({ length: spin.n }, (_, i) => renderBody(body, (i / spin.n) * 2 * Math.PI));
  const { T, phi0 } = timing(body.name, body.angle);
  const globes = renders.map((r) => r.globe);
  const H = boxHalf(globes, body.R);
  // The light: a black shade over the globe, darkest on the night side. Its
  // turn and its terminator follow the orbit (SMIL, smooth). No CSS mask and
  // no viewport media query: either one freezes the scene in the desktop app.
  const keys = lightKeys(body.R, H, phi0);
  const times = keys.map((_, i) => Math.round((i / MASK_KEYS) * 1e5) / 1e5).join(';');
  const band = 0.2 * H * 1.2;
  const gid = `sh${idx}`;
  shades.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${num(keys[0].x - 0.5 * band)}" x2="${num(keys[0].x + 0.8 * band)}" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".47"/><stop offset=".54" stop-color="#000" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity="0"/>`
    + `<animate attributeName="x1" values="${keys.map((k) => num(k.x - 0.5 * band)).join(';')}" keyTimes="${times}" dur="${sec(T)}" repeatCount="indefinite"/>`
    + `<animate attributeName="x2" values="${keys.map((k) => num(k.x + 0.8 * band)).join(';')}" keyTimes="${times}" dur="${sec(T)}" repeatCount="indefinite"/></linearGradient>`);
  const turn = `<animateTransform attributeName="transform" type="rotate" values="${keys.map((k) => num(k.a - 90)).join(';')}" keyTimes="${times}" dur="${sec(T)}" repeatCount="indefinite"/>`;
  const shade = `<g transform="rotate(${num(keys[0].a - 90)})">${turn}<circle r="${num(body.R + 1)}" fill="url(#${gid})"/></g>`;

  let globe = `<rect x="-${H}" y="-${H}" width="${2 * H}" height="${2 * H}" fill="none"/>`;
  if (spin.n === 1) {
    globe += gridText(globes[0]);
  } else if (body.kind === 'jupiter') {
    // The bands are the same in every frame (they repeat once per frame), so
    // draw them once without the spot, and per frame only the spot's cells,
    // each run on a black backing that hides the band glyphs under it.
    NO_SPOT = true;
    const plain = renderBody(body, 0).globe;
    NO_SPOT = false;
    globe += gridText(plain);
    const { cols, rows } = plain;
    const same = (a, b) => (!a && !b) || (a && b && a.ch === b.ch && a.fill === b.fill);
    globes.forEach((grid, i) => {
      const diff = new Array(cols * rows).fill(null);
      let rects = '';
      for (let r = 0; r < rows; r++) {
        let run = -1;
        for (let c = 0; c <= cols; c++) {
          const k = r * cols + c;
          const differs = c < cols && !same(grid.cells[k], plain.cells[k]);
          if (differs) { diff[k] = grid.cells[k]; if (run < 0) run = c; }
          if (!differs && run >= 0) {
            rects += `<rect x="${num((run - cols / 2) * CW)}" y="${num((r - rows / 2) * CH)}" width="${num((c - run) * CW)}" height="${num(CH)}" fill="#000"/>`;
            run = -1;
          }
        }
      }
      const shift = -(((spin.n - i) % spin.n) * spin.period) / spin.n;
      const flip = discrete('visibility', ['visible', 'hidden'], [0, 1 / spin.n], spin.period, shift);
      globe += `<g visibility="${i ? 'hidden' : 'visible'}">${flip}${rects}${gridText({ cols, rows, cells: diff })}</g>`;
    });
  } else {
    const { fixed, varying } = splitStatic(globes);
    globe += gridText(fixed);
    varying.forEach((grid, i) => {
      const text = gridText(grid);
      if (!text) return;
      // Frame i shows on [i/n, (i+1)/n) of each turn; frame 0 rests visible.
      const shift = -(((spin.n - i) % spin.n) * spin.period) / spin.n;
      const flip = discrete('visibility', ['visible', 'hidden'], [0, 1 / spin.n], spin.period, shift);
      globe += `<g visibility="${i ? 'hidden' : 'visible'}">${flip}${text}</g>`;
    });
  }
  // Rings carry their own light and stay outside the mask.
  const ring = gridText(renders[0].ring);
  const backing = `<circle r="${body.R + 0.5}" fill="#000"/>`;
  const moons = (body.moons ?? []).map((m) => moonMarkup(body, m));
  const inner = `${moons.map((m) => m.back).join('')}${backing}${globe}${shade}${ring}${moons.map((m) => m.front).join('')}`;
  // The start angle is a fixed rotation around the animated one, so the
  // planet rests at its own place when nothing animates.
  const planet = `<g transform="translate(${body.orbit} 0)"><g>${rotate(0, 360, T)}<g transform="rotate(${num(phi0)}) scale(1 ${num((1 / K) * 1000) / 1000})">${inner}</g></g></g>`;
  report.push(`${body.name}: T=${T.toFixed(1)}s, ${globes[0].cols}x${globes[0].rows} cells, ${spin.n} spin frames, ${planet.length} chars${crossesSun(body) ? ' x2' : ''}`);
  return { body, T, phi0, markup: `<g transform="rotate(${num(-phi0)})"><g>${rotate(0, -360, T)}${planet}</g></g>` };
}

// Orbits: dotted ellipses, faint like the site's line loops.
const orbitMarkup = BODIES.map((b) => `<ellipse rx="${b.orbit}" ry="${num(b.orbit * K)}"/>`).join('');

// Asteroid belt: two rings of dots on the flattened plane, each at its own speed.
function beltMarkup() {
  let seed = 0x534f4c41;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const ring = (count, inner, outer, name, real) => {
    let d = '';
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const rr = inner + rand() * (outer - inner);
      d += `M${num(Math.cos(a) * rr)} ${num(Math.sin(a) * rr)}h0`;
    }
    const steps = Math.round(EARTH_PERIOD * Math.sqrt(real) * FPS);
    return `<g>${rotate(0, -360, steps * tick)}<path d="${d}"/></g>`;
  };
  const mid = (BELT.inner + BELT.outer) / 2;
  return `<g transform="scale(1 ${K})" class="BELT">${ring(170, BELT.inner, mid, 'B1', Math.pow(2.5, 1.5))}${ring(170, mid, BELT.outer, 'B2', Math.pow(3.0, 1.5))}</g>`;
}

/** Stars laid out explicitly, one <text> per colour with coordinate lists. */
function starField() {
  let seed = 0x5ea7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const area = { x0: -260, y0: -900, x1: VIEW.w + 260, y1: VIEW.h + 900 };
  const count = Math.round((area.x1 - area.x0) * (area.y1 - area.y0) * 0.75e-4);
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const x = area.x0 + rand() * (area.x1 - area.x0);
    const y = area.y0 + rand() * (area.y1 - area.y0);
    const roll = rand();
    const ch = roll < 0.82 ? '.' : roll < 0.94 ? '+' : '*';
    const level = [0.22, 0.32, 0.45, 0.62][Math.min(3, Math.floor(Math.pow(rand(), 2.4) * 4))];
    const warmth = rand();
    const tint = warmth < 0.18 ? [1, 0.84, 0.66] : warmth < 0.42 ? [0.74, 0.84, 1] : [1, 1, 1];
    const fill = '#' + tint.map((t) => Math.round(srgb(t * level * level) * 15).toString(16)).join('');
    if (!groups.has(fill)) groups.set(fill, { xs: [], ys: [], text: '' });
    const g = groups.get(fill);
    g.xs.push(Math.round(x)); g.ys.push(Math.round(y)); g.text += ch;
  }
  return [...groups].map(([fill, g]) => `<text class="${classOf(fill)}" x="${g.xs.join(' ')}" y="${g.ys.join(' ')}">${g.text}</text>`).join('');
}

function twinkles() {
  let seed = 0x7a11;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let out = '';
  for (let i = 0; i < 26; i++) {
    const x = rand() * VIEW.w, y = rand() * VIEW.h;
    const dx = (x - CENTRE.x) / 820, dy = (y - CENTRE.y) / (820 * K);
    if (Math.hypot(dx, dy) < 0.6) { i--; continue; }
    const T = 7 + rand() * 5;
    out += `<text class="TW" x="${num(x)}" y="${num(y)}">${breathe(0.3, T, -rand() * T)}${rand() < 0.5 ? '+' : '*'}</text>`;
  }
  return out;
}

// ---------------------------------------------------------------- the Sun

/**
 * The disc is always fully drawn, so no cell ever goes dark. The boiling comes
 * from three layers of granules drawn again in a brighter colour over it
 * (same glyphs), each fading in and out on its own slow cycle.
 */
function brighter(cell) {
  // Same glyph, brighter colour: drawn over the base it reads as one cell glowing.
  const ch = cell.ch;
  const rgb = cell.fill.slice(1).split('').map((h) => parseInt(h, 16));
  const lift = rgb.map((v) => Math.min(15, Math.round(v * 1.2 + 2)));
  return { ch, fill: '#' + lift.map((v) => v.toString(16)).join('') };
}

function sunMarkup() {
  const { cols, rows, cells, inDisc } = renderSun();
  const base = new Array(cells.length).fill(null);
  const glow = [0, 1, 2].map(() => new Array(cells.length).fill(null));
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || !inDisc[i]) continue;
    base[i] = cells[i];
    const r = Math.floor(i / cols), c = i % cols;
    for (let k = 0; k < 3; k++) {
      const n = valueNoise(c * 0.27 + k * 31.7, r * 0.54 + k * 17.3);
      if (n > 0.65) glow[k][i] = brighter(cells[i]);
    }
  }
  const text = (cellsOf) => gridText({ cols, rows, cells: cellsOf });
  const fade = (k, T, begin) => {
    const t = text(glow[k]);
    return t ? `<g opacity="0"><animate attributeName="opacity" values="0;.95;0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="${sec(T)}" begin="${sec(begin)}" repeatCount="indefinite"/>${t}</g>` : '';
  };
  const disc = `<circle r="${SUN_R + 1}" fill="#000"/>${text(base)}${fade(0, 13, -1.5)}${fade(1, 16.4, -6.2)}${fade(2, 20, -11.3)}`;
  return { corona: '', disc };
}

// ---------------------------------------------------------------- moons

/** A moon on a tilted circle around its planet, in the planet's upright frame:
 *  a back copy (hidden behind the globe by its black backing) and a front copy. */
function moonMarkup(body, m) {
  const r = m.r * body.R, k = m.k, T = m.period, th0 = m.start;
  const content = m.name
    ? gridText(renderBody({ name: m.name, flat: true, kind: 'rock', R: m.R }, 0).globe)
    : `<text class="${classOf(m.dot)} MD">&#8226;</text>`;
  const orbiting = `<g transform="scale(1 ${k})"><g transform="rotate(${th0})"><g>${rotate(0, 360, T)}<g transform="translate(${num(r)} 0)"><g transform="rotate(${-th0})"><g>${rotate(0, -360, T)}<g transform="scale(1 ${num(1 / k * 1000) / 1000})">${content}</g></g></g></g></g></g></g>`;
  // In front of the globe while the angle is in (0, 180): lower on screen.
  const from = (((0 - th0) / 360) % 1 + 1) % 1, to = (((180 - th0) / 360) % 1 + 1) % 1;
  const f = windowAnimate('opacity', from, to, 1, 0, T);
  const b = windowAnimate('opacity', from, to, 0, 1, T);
  return { back: `<g opacity="${b.rest}">${b.el}${orbiting}</g>`, front: `<g opacity="${f.rest}">${f.el}${orbiting}</g>` };
}

// ---------------------------------------------------------------- comet

/** A comet on a Kepler ellipse, inclined to the planets' plane: slow far out,
 *  fast at perihelion. Its tail always points away from the Sun and grows as
 *  it comes in. */
function cometMarkup() {
  const T = 170, a = 560, e = 0.8, w = 205 * DEG, inc = 18 * DEG, N = 90;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const M = (2 * Math.PI * i) / N;
    let E = M;
    for (let it = 0; it < 40; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xo = a * (Math.cos(E) - e), zo = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const P = rotX([xo * Math.cos(w) - zo * Math.sin(w), 0, xo * Math.sin(w) + zo * Math.cos(w)], inc);
    pts.push({ x: dot(P, RIGHT), y: -dot(P, UP), r: len(P) });
  }
  const ang = pts.map((p) => Math.atan2(p.y, p.x) / DEG);
  for (let i = 1; i < ang.length; i++) {
    while (ang[i] - ang[i - 1] > 180) ang[i] -= 360;
    while (ang[i] - ang[i - 1] < -180) ang[i] += 360;
  }
  const L = pts.map((p) => clamp(230 / p.r, 0.35, 2.4));
  const times = pts.map((_, i) => Math.round((i / N) * 1e5) / 1e5).join(';');
  const anim = (type, values) => `<animateTransform attributeName="transform" type="${type}" values="${values.join(';')}" keyTimes="${times}" dur="${sec(T)}" begin="${sec(-T * 0.9)}" repeatCount="indefinite"/>`;
  const c = (fill) => classOf(fill);
  const tail =
    `<text class="CT"><tspan x="4" y="0" class="${c('#eff')}">#</tspan><tspan class="${c('#bdf')}">&amp;*+</tspan><tspan class="${c('#8ad')}">=~-</tspan><tspan class="${c('#58a')}">-:.</tspan><tspan class="${c('#357')}"> . .  .</tspan>` +
    `<tspan x="7" y="-3.4" class="${c('#7ac')}">*+=~</tspan><tspan class="${c('#468')}">-:. .</tspan>` +
    `<tspan x="7" y="3.4" class="${c('#7ac')}">+=~-</tspan><tspan class="${c('#468')}">:.  .</tspan></text>`;
  const head = `<text class="CH ${c('#fff')}">@</text>`;
  return `<g transform="translate(${num(pts[0].x)} ${num(pts[0].y)})">${anim('translate', pts.map((p) => `${num(p.x)} ${num(p.y)}`))}` +
    `<g transform="rotate(${num(ang[0])})">${anim('rotate', ang.map(num))}` +
    `<g transform="scale(${num(L[0])} 1)">${anim('scale', L.map((l) => `${num(l)} 1`))}${tail}</g>${head}</g></g>`;
}

// ---------------------------------------------------------------- the astronaut

/**
 * Claude Code's mascot in a space helmet, drawn here as pixel art. Every
 * three minutes it floats across twice (left to right high, then right to
 * left low, turned to face its way), bobbing, swaying and paddling its legs.
 * It rests hidden, so a scene with motion turned off shows no mascot.
 */
const ASTRONAUT = [
  '......WWWWWWW......',
  '....WW.......WW....',
  '...W.........HHW...',
  '..W...........H.W..',
  '..W.OOOOOOOOOOO.W..',
  '.W..OOOOOOOOOOO..W.',
  '.W..OOKOOOOOKOO..W.',
  'OOOOOOKOOOOOKOOOOOO',
  'OOWWWWWWWWWWWWWWWOO',
  '....OOOOOOOOOOO....',
  '....OOOOOOOOOOO....',
];
const ASTRONAUT_LEGS = [
  ['....O.O.....O.O....', '....O.O.....O.O....'],
  ['....O.O.....O.O....', '.....O.O.....O.O...'],
];
const ASTRONAUT_INK = { O: '#d97757', K: '#000', W: '#e9e5dd', H: '#fff' };

function pixelPaths(rows, top = 0) {
  const runs = {};
  rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      if (ch === '.') { c++; continue; }
      let e = c;
      while (e < row.length && row[e] === ch) e++;
      runs[ch] = (runs[ch] ?? '') + `M${c} ${r + top}h${e - c}v1h${c - e}z`;
      c = e;
    }
  });
  return Object.entries(runs).map(([ch, d]) => `<path fill="${ASTRONAUT_INK[ch]}" d="${d}"/>`).join('');
}

function astronautMarkup() {
  const T = 180, P = 4.6;
  const W = ASTRONAUT[0].length, H = ASTRONAUT.length + 2;
  const legs = ASTRONAUT_LEGS.map((frame, i) =>
    `<g visibility="${i ? 'hidden' : 'visible'}">${discrete('visibility', i ? ['hidden', 'visible'] : ['visible', 'hidden'], [0, 0.5], 0.9)}${pixelPaths(frame, ASTRONAUT.length)}</g>`).join('');
  const sprite = `<g transform="translate(${num(-W * P / 2)} ${num(-H * P / 2)}) scale(${P})" shape-rendering="crispEdges">${pixelPaths(ASTRONAUT)}${legs}</g>`;
  // Two passes per cycle, as fractions of T: [start, end] and their paths.
  const A = [0.05, 0.22], B = [0.55, 0.72];
  const pathA = [[-120, 640], [480, 430], [1020, 320], [1720, 170]];
  const pathB = [[1720, 300], [1150, 520], [560, 620], [-120, 770]];
  const keys = [], vals = [];
  const along = (span, pts) => pts.forEach((p, i) => { keys.push(span[0] + ((span[1] - span[0]) * i) / (pts.length - 1)); vals.push(`${p[0]} ${p[1]}`); });
  keys.push(0); vals.push(`${pathA[0][0]} ${pathA[0][1]}`);
  along(A, pathA); along(B, pathB);
  keys.push(1); vals.push(`${pathB[3][0]} ${pathB[3][1]}`);
  const k = (x) => Math.round(x * 1e4) / 1e4;
  const fade = 1.5 / T;
  const show = `0;${k(A[0])};${k(A[0] + fade)};${k(A[1] - fade)};${k(A[1])};${k(B[0])};${k(B[0] + fade)};${k(B[1] - fade)};${k(B[1])};1`;
  return `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0;0;1;1;0;0" keyTimes="${show}" dur="${sec(T)}" repeatCount="indefinite"/>` +
    `<g transform="translate(${pathA[0][0]} ${pathA[0][1]})"><animateTransform attributeName="transform" type="translate" values="${vals.join(';')}" keyTimes="${keys.map(k).join(';')}" calcMode="spline" keySplines="${keys.slice(1).map(() => '.4 0 .6 1').join(';')}" dur="${sec(T)}" repeatCount="indefinite"/>` +
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -9;0 0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="4.6s" repeatCount="indefinite"/>` +
    `<g><animateTransform attributeName="transform" type="rotate" values="-9;7;-9" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="7.4s" repeatCount="indefinite"/>` +
    `<g><animateTransform attributeName="transform" type="scale" values="1 1;-1 1;1 1" keyTimes="0;${k((A[1] + B[0]) / 2)};${k((B[1] + 1) / 2)}" calcMode="discrete" dur="${sec(T)}" repeatCount="indefinite"/>` +
    `${sprite}</g></g></g></g></g>`;
}

// ---------------------------------------------------------------- shooting stars

function meteorsMarkup() {
  const list = [
    { x: 230, y: 80, dx: 230, dy: 75, T: 23, at: 0.3 },
    { x: 1200, y: 110, dx: -210, dy: 85, T: 31, at: 0.62 },
    { x: 1380, y: 690, dx: -170, dy: 55, T: 43, at: 0.12 },
    { x: 140, y: 760, dx: 190, dy: -50, T: 53, at: 0.45 },
  ];
  return list.map((m, i) => {
    const id = `mt${i}`;
    shades.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${num(-m.dx * 0.5)}" y2="${num(-m.dy * 0.5)}"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#9cf" stop-opacity="0"/></linearGradient>`);
    const k = (x) => Math.round(x * 1e4) / 1e4;
    const kt = `0;${k(m.at)};${k(m.at + 0.004)};${k(m.at + 0.022)};${k(m.at + 0.03)};1`;
    return `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="${kt}" dur="${sec(m.T)}" repeatCount="indefinite"/>` +
      `<g transform="translate(${m.x} ${m.y})"><animateTransform attributeName="transform" type="translate" values="${m.x} ${m.y};${m.x} ${m.y};${m.x + m.dx} ${m.y + m.dy};${m.x + m.dx} ${m.y + m.dy}" keyTimes="0;${k(m.at)};${k(m.at + 0.03)};1" dur="${sec(m.T)}" repeatCount="indefinite"/>` +
      `<line x2="${num(-m.dx * 0.5)}" y2="${num(-m.dy * 0.5)}" stroke="url(#${id})" stroke-width="1.3" stroke-linecap="round"/></g></g>`;
  }).join('');
}

// ---------------------------------------------------------------- build

css.push(``);
// The light: each step class (.Mn_k) holds the whole gradient mask, from the
// night side to the sunward limb, precomputed: no custom properties, no calc.

const sun = sunMarkup();
report.push(`sun: ${sun.corona.length + sun.disc.length} chars`);
const planets = BODIES.map((body, idx) => planetMarkup(body, idx));
const back = [], front = [];
// Outer bodies first, so nearer orbits draw over farther ones where they meet.
for (const p of [...planets].reverse()) {
  if (crossesSun(p.body)) {
    // A second copy draws over the Sun on the near half (no <use>: the app drops it).
    // The far half of the orbit is phi in (0, 180); phi = phi0 + 360 s.
    const i = planets.indexOf(p);
    const from = ((360 - p.phi0) % 360) / 360, to = ((540 - p.phi0) % 360) / 360;
    const b = windowAnimate('opacity', from, to, 1, 0, p.T);
    const f = windowAnimate('opacity', from, to, 0, 1, p.T);
    back.push(`<g opacity="${b.rest}">${b.el}${p.markup}</g>`);
    front.push(`<g opacity="${f.rest}">${f.el}${p.markup}</g>`);
  } else {
    back.push(p.markup);
  }
}

const meteors = meteorsMarkup();
const comet = cometMarkup();
const astronaut = astronautMarkup();
report.push(`comet: ${comet.length}  meteors: ${meteors.length}  astronaut: ${astronaut.length}`);
const fillCss = [...classes].map(([fill, cls]) => `.${cls}{fill:${fill}}`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>svg{background:#000}text{font-family:Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;font-size:${FONT}px;white-space:pre;dominant-baseline:central}${fillCss}.ORB{fill:none;stroke:#fff;stroke-opacity:.17;stroke-width:1.3;stroke-linecap:round;stroke-dasharray:0 7}.BELT path{stroke:#bfb6a6;stroke-opacity:.45;stroke-width:2.4;stroke-linecap:round}.TW{font-size:10px;fill:#ccd6ff}.MD{font-size:9px;text-anchor:middle;dominant-baseline:central}.CT{font-size:6.5px}.CH{font-size:10px;text-anchor:middle;dominant-baseline:central}${css.join('')}</style><defs>${shades.join('')}</defs><rect x="-1200" y="-1600" width="4000" height="4000" fill="#000"/>${starField()}${twinkles()}${meteors}<g><g transform="translate(${CENTRE.x} ${CENTRE.y})"><rect x="-1000" y="-700" width="2000" height="1400" fill="none"/><g class="ORB">${orbitMarkup}</g>${beltMarkup()}${sun.corona}<g transform="scale(1 ${K})">${back.join('')}</g>${sun.disc}<g transform="scale(1 ${K})">${front.join('')}</g>${comet}</g></g>${astronaut}</svg>`;

for (const bad of [/href=/, /<use\b/, /<a[\s>]/, /\sstyle=/, /@media\s*\((?!prefers-)/, /mask-image/, /vector-effect/]) {
  if (bad.test(svg)) throw new Error(`scene holds markup the app drops: ${bad}`);
}
const styleText = /<style>([\s\S]*?)<\/style>/.exec(svg)[1];
void styleText;
report.push(`stars: ${starField().length}  css: ${css.join('').length + fillCss.length}`);
if (svg.length > 131072 && !process.env.FORCE) throw new Error(`scene is ${svg.length} characters, over the 131,072 limit`);

writeFileSync(join(root, 'hooks', 'scene.ts'), `// Generated by tools/build-scene.mjs. Do not edit by hand.\nexport const SCENE = ${JSON.stringify(svg)}\n`);
const previewDir = process.argv[2];
if (previewDir) { mkdirSync(previewDir, { recursive: true }); writeFileSync(join(previewDir, 'scene.svg'), svg); }
console.log(report.join('\n'));
console.log(`classes: ${classes.size}  size: ${svg.length} chars (limit 131072)`);
