// The soi: road, shophouses, neon signs, street lamps, tangled power lines.
// Built from 40 m segments; a ring of 8 slots leapfrogs forward as the player
// runs. Each slot shows one of several prebuilt variants, merged into a few
// meshes per slot so the whole street is ~90 draw calls.
//
// Coordinates: sim distance d runs forward; Three.js z = -d. Lane x = lane * laneWidth.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import strings from '../strings.js';
import { createRng } from '../sim/rng.js';
import { houseWidth } from './houses.js';
import { MOOD } from './renderer.js';
import { toonMaterial } from './toon.js';

const SEG_LEN = 40;
const RING = 8;
const VARIANTS = 8;
const ROAD_HALF = 4.25; // 3 lanes of 2.5 m plus a margin
const WALK = 1.7; // sidewalk width
const FRONT = ROAD_HALF + WALK; // shophouse front line
const CURB = 0.22;
const BEHIND = 100; // street kept behind the player: the caught camera looks back, fog hides ~125 m
const LAMP_EVERY = SEG_LEN / 3;
const REAL_LIGHTS = 4;
const LAMP_INTENSITY = 32;

const FACADES = [0xf2d6a2, 0xbfe0d0, 0xf0b8a8, 0xd8d0f0, 0xf4e7c8, 0xa8cfe0, 0xe8c0d8, 0xc8e0a8];
const NEON = [0xff3b6b, 0x2fd0ff, 0xffd23f, 0x5dff8a, 0xff8a2f, 0xc77dff];
const AWNINGS = [0xff3b3b, 0x2f8fff, 0x3fbf5f, 0xffb02f, 0x9a5fd0];
const WARM = 0xffc27a;

// ---------------------------------------------------------------- sign atlas
// 2048 x 2048: left half = 16 blade signs (512 x 256), right half = 16 facade boards (1024 x 128).
const ATLAS = 2048;
const BLADE = { w: 512, h: 256 };
const BOARD = { w: 1024, h: 128 };

function drawAtlas(canvas) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, ATLAS, ATLAS);
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const cell = (x, y, w, h, text, color, neon) => {
    g.save();
    g.fillStyle = neon ? '#120a1e' : hex(color);
    g.fillRect(x, y, w, h);
    const pad = Math.round(h * 0.09);
    g.lineWidth = Math.max(4, h * 0.05);
    g.strokeStyle = neon ? hex(color) : '#ffffff';
    if (neon) { g.shadowColor = hex(color); g.shadowBlur = h * 0.12; }
    g.strokeRect(x + pad, y + pad, w - 2 * pad, h - 2 * pad);
    let size = h * 0.62;
    g.font = `800 ${size}px Kanit, sans-serif`;
    const maxW = w - 4 * pad;
    const tw = g.measureText(text).width;
    if (tw > maxW) { size *= maxW / tw; g.font = `800 ${size}px Kanit, sans-serif`; }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = neon ? hex(color) : '#ffffff';
    g.fillText(text, x + w / 2, y + h / 2 + size * 0.04);
    if (neon) { g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillText(text, x + w / 2, y + h / 2 + size * 0.04); }
    g.restore();
  };
  const words = strings.signs;
  for (let i = 0; i < 16; i++) {
    const neonBlade = i % 4 !== 3;
    cell((i % 2) * BLADE.w, Math.floor(i / 2) * BLADE.h, BLADE.w, BLADE.h, words[i % words.length], neonBlade ? NEON[i % NEON.length] : AWNINGS[i % AWNINGS.length], neonBlade);
    const neonBoard = i % 3 !== 2;
    cell(1024, i * BOARD.h, BOARD.w, BOARD.h, words[(i + 5) % words.length], neonBoard ? NEON[(i + 2) % NEON.length] : AWNINGS[(i + 1) % AWNINGS.length], neonBoard);
  }
}
/** Which atlas cells are neon (glow) vs painted (no bloom). Mirrors drawAtlas. */
const bladeIsNeon = (i) => i % 4 !== 3;
const boardIsNeon = (i) => i % 3 !== 2;

function glowSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 2 x 1 px red | white, repeated along the curb. */
function curbTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 1;
  const g = c.getContext('2d');
  g.fillStyle = '#d8343a'; g.fillRect(0, 0, 1, 1);
  g.fillStyle = '#f0f0f0'; g.fillRect(1, 0, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; // crisp stripes up close
  t.minFilter = THREE.LinearMipmapLinearFilter; // far away: blends to pink, no shimmer
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- Blender street kit
// GLBs built by art/blender/*.py. Each named node becomes a kit part: plain
// geometry pieces plus their material name/colour, merged into the segment
// meshes like the code-built parts. A missing file keeps the code-built version.
const KIT_FILES = ['shophouse', 'street_lamp', 'street_kit', 'food_cart'];
/** Glow intensity per emissive material name (above ~1 blooms). */
const KIT_GLOW = { lamp: 3.5, shoplight: 0.95, fridge_glass: 1.1, candle: 1.6, glass_lit: 0.95, bulb: 1.6 };

/** @typedef {{ geo: THREE.BufferGeometry, name: string, color: number, emissive: number }} KitPiece */

/** @returns {Promise<Record<string, KitPiece[]> | null>} parts by node name */
const MODELS_DIR = `${import.meta.env?.BASE_URL ?? '/'}models/`;

async function loadKit() {
  const loader = new GLTFLoader();
  /** @type {Record<string, KitPiece[]>} */
  const kit = {};
  await Promise.all(KIT_FILES.map(async (file) => {
    try {
      const res = await fetch(`${MODELS_DIR}${file}.glb`);
      const buf = res.ok ? await res.arrayBuffer() : null;
      // Vite answers a missing file with index.html: check the glTF magic first
      if (!buf || buf.byteLength < 4 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return;
      const gltf = await loader.parseAsync(buf, MODELS_DIR);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        // a multi-material node loads as a group of meshes named after the node
        const node = o.parent && o.parent !== gltf.scene ? o.parent.name : o.name;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', o.geometry.getAttribute('position'));
        geo.setAttribute('normal', o.geometry.getAttribute('normal'));
        geo.setIndex(o.geometry.getIndex());
        geo.applyMatrix4(o.matrixWorld);
        const m = o.material;
        (kit[node] ??= []).push({ geo, name: m.name.replace(/^sp_/, ''), color: m.color.getHex(), emissive: m.emissive?.getHex() ?? 0 });
      });
    } catch (err) {
      console.warn(`street kit ${file}: using code-built street (${err.message})`);
    }
  }));
  return Object.keys(kit).length ? kit : null;
}

// ---------------------------------------------------------------- builder
const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat.setFromEuler(tmpEuler.set(rx, ry, rz)), ONE);
  return geo.applyMatrix4(tmpMatrix);
}

function paint(geo, hex, intensity = 1) {
  tmpColor.setHex(hex).multiplyScalar(intensity);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Fake ambient occlusion baked into the vertex colours: walls darken toward the
 * ground and undersides (awnings, balconies, ledges) stay shaded. Gives the depth
 * the old black outlines were faking. Top faces are left alone so the road stays even.
 */
const AO_FLOOR = 0.62, AO_HEIGHT = 1.4, AO_UNDER = 0.68;
function bakeAo(geo) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = geo.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i);
    let k = 1;
    if (ny < -0.5) k = AO_UNDER;
    else if (ny < 0.5) k = AO_FLOOR + (1 - AO_FLOOR) * THREE.MathUtils.smoothstep(pos.getY(i), 0, AO_HEIGHT);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

/** Collects one segment's parts, then merges them into a few geometries. */
class Builder {
  constructor() { this.toon = []; this.flat = []; this.glow = []; this.signs = []; this.curbs = []; this.lines = []; this.lamps = []; }

  /** Toon-shaded part with baked AO. */
  add(geo, hex) { geo.deleteAttribute('uv'); this.toon.push(bakeAo(paint(geo, hex))); return this; }
  box(w, h, d, hex, x, y, z, rx, ry, rz) { return this.add(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), hex); }
  cyl(rt, rb, h, seg, hex, x, y, z, rx, ry, rz) { return this.add(place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz), hex); }
  /** Toon-shaded, no AO (road paint, stripes). */
  flatBox(w, h, d, hex, x, y, z, rx, ry, rz) {
    const geo = place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); geo.deleteAttribute('uv');
    this.flat.push(paint(geo, hex)); return this;
  }
  /** Unlit; intensity above ~1 blooms. */
  glowBox(w, h, d, hex, intensity, x, y, z, rx, ry, rz) {
    const geo = place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); geo.deleteAttribute('uv');
    this.glow.push(paint(geo, hex, intensity)); return this;
  }
  /** Textured sign quad facing +z before rotation; uv = atlas rect in pixels. */
  sign(w, h, rect, intensity, x, y, z, ry = 0) {
    const geo = place(new THREE.PlaneGeometry(w, h), x, y, z, 0, ry, 0);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (rect.x + uv.getX(i) * rect.w) / ATLAS, 1 - (rect.y + (1 - uv.getY(i)) * rect.h) / ATLAS);
    }
    this.signs.push(paint(geo, 0xffffff, intensity)); return this;
  }
  /** Curb box; u runs along z, one red-white stripe pair per 2 m (curbTexture). */
  curb(w, h, d, x, y, z) {
    const geo = place(new THREE.BoxGeometry(w, h, d), x, y, z);
    const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, -pos.getZ(i) / 2, 0.5);
    this.curbs.push(geo); return this;
  }
  /** Polyline as line segments. */
  line(points) { for (let i = 1; i < points.length; i++) this.lines.push(points[i - 1], points[i]); return this; }
  /**
   * A Blender kit part (see loadKit), turned by ry and stretched sx along its local X.
   * @param {KitPiece[]} part
   * @param {{ facade?: number, awning?: number, windowLit?: boolean }} [look] per-house colours
   */
  kitPart(part, x, y, z, ry = 0, sx = 1, look = {}) {
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat.setFromEuler(tmpEuler.set(0, ry, 0)), tmpScale.set(sx, 1, 1));
    for (const p of part) {
      const geo = p.geo.clone().applyMatrix4(tmpMatrix);
      if (p.emissive) this.glow.push(paint(geo, p.name === 'lamp' ? MOOD.lamp : p.emissive, KIT_GLOW[p.name] ?? 1.2));
      else if (p.name === 'window' && look.windowLit) this.glow.push(paint(geo, 0xffd9a0, 1.05));
      else if (p.name.startsWith('flat_')) this.flat.push(paint(geo, p.color));
      else this.add(geo, (p.name === 'facade' && look.facade) || (p.name === 'awning' && look.awning) || p.color);
    }
    return this;
  }

  merge() {
    const m = (list) => (list.length ? mergeGeometries(list) : new THREE.BufferGeometry());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(this.lines);
    return { toon: m(this.toon), flat: m(this.flat), glow: m(this.glow), signs: m(this.signs), curb: m(this.curbs), lines: lineGeo };
  }
}

// ---------------------------------------------------------------- segment content
// Local segment space: x across the road, y up, z from 0 (segment start) to -SEG_LEN.

function road(b) {
  const c = -SEG_LEN / 2;
  b.flatBox(ROAD_HALF * 2, 0.1, SEG_LEN, 0x2e2c38, 0, -0.05, c);
  for (let z = 0; z < SEG_LEN; z += 5) for (const x of [-1.25, 1.25]) b.flatBox(0.14, 0.02, 2.2, 0xd8d8e4, x, 0.01, -z - 1.6);
  for (const side of [-1, 1]) {
    // sidewalk starts behind the curb: a shared road-facing face z-fights
    b.flatBox(WALK - CURB, 0.16, SEG_LEN, 0x8f8a99, side * (ROAD_HALF + CURB + (WALK - CURB) / 2), 0.08, c);
    // red-white painted curb, Thai style: one textured box, so far-off stripes blend (mipmaps) instead of shimmering
    b.curb(CURB, 0.2, SEG_LEN, side * (ROAD_HALF + CURB / 2), 0.1, c);
  }
}

function shophouse(b, side, z0, width, r) {
  const zc = z0 - width / 2;
  const floors = 2 + (r() < 0.55 ? 1 : 0);
  const H = floors * 3.2 + 0.4;
  const facade = FACADES[Math.floor(r() * FACADES.length)];
  const fx = side * FRONT; // front face
  const out = -side; // toward the road
  b.box(5, H, width - 0.12, facade, side * (FRONT + 2.5), H / 2, zc);
  b.box(5.2, 0.3, width + 0.05, 0xe8e2ec, side * (FRONT + 2.5), H + 0.15, zc); // parapet lip

  // ground floor: lit open shop or roller shutter
  const inner = width - 0.9;
  if (r() < 0.5) {
    b.glowBox(0.08, 2.4, inner, WARM, 0.95, fx + out * 0.02, 1.2, zc);
    b.box(0.6, 0.9, inner - 0.6, 0x6a4a3a, fx + out * 0.4, 0.45, zc);
  } else {
    b.box(0.1, 2.5, inner, 0x9aa0aa, fx + out * 0.04, 1.25, zc);
    for (let y = 0.2; y < 2.45; y += 0.18) b.flatBox(0.04, 0.04, inner, 0x6d727c, fx + out * 0.1, y, zc);
  }

  // striped awning
  const awn = AWNINGS[Math.floor(r() * AWNINGS.length)];
  const stripes = Math.max(2, Math.floor((width - 0.5) / 0.5));
  const sw = (width - 0.5) / stripes;
  for (let i = 0; i < stripes; i++) {
    b.box(1.1, 0.06, sw, i % 2 ? 0xf4f4f4 : awn, fx + out * 0.5, 2.85, z0 - 0.25 - sw * (i + 0.5), 0, 0, side * 0.32);
  }

  boardSign(b, side, zc, width, r);

  // upper-floor windows, AC units
  for (let f = 1; f < floors; f++) {
    const y = f * 3.2 + 1.5;
    for (const k of [-1, 1]) {
      const wz = zc + k * width * 0.22;
      b.box(0.08, 1.35, 1.25, 0xe8e8ee, fx + out * 0.02, y, wz);
      if (r() < 0.45) b.glowBox(0.06, 1.1, 1.0, 0xffd9a0, 1.05, fx + out * 0.07, y, wz);
      else b.box(0.06, 1.1, 1.0, 0x2a3346, fx + out * 0.07, y, wz);
    }
    if (r() < 0.5) b.box(0.45, 0.5, 0.8, 0xe8e8e8, fx + out * 0.3, f * 3.2 + 0.4, zc + (r() - 0.5) * (width - 1.5));
    if (r() < 0.35) b.box(0.6, 0.08, width - 0.6, 0xb8b0c0, fx + out * 0.3, f * 3.2 + 0.1, zc); // small balcony ledge
  }

  if (r() < 0.7) bladeSign(b, side, zc + 0.02, 4.2 + r() * (H - 5.6), r);
  if (r() < 0.45) waterTank(b, side, zc, width, H + 0.9, r);
}

/** Facade board above the awning, text facing the road. */
function boardSign(b, side, zc, width, r) {
  const fx = side * FRONT, out = -side;
  const boardLen = Math.min(width - 0.8, 3.6);
  const boardCell = Math.floor(r() * 16);
  // y 3.7 keeps the board's bottom above the ground-floor beam (top 3.2 m, same front plane)
  b.box(0.12, 0.95, boardLen + 0.12, 0x161022, fx + out * 0.09, 3.7, zc);
  b.sign(boardLen, 0.8, { x: 1024, y: boardCell * BOARD.h, w: BOARD.w, h: BOARD.h }, boardIsNeon(boardCell) ? 1.45 : 0.9,
    fx + out * 0.18, 3.7, zc, out > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** Blade sign sticking out over the sidewalk, facing the camera (+z). */
function bladeSign(b, side, z, y, r) {
  const fx = side * FRONT, out = -side;
  const cell = Math.floor(r() * 16);
  const bx = fx + out * 1.05;
  b.box(1.85, 0.98, 0.1, 0x161022, bx, y, z);
  b.box(0.08, 0.08, 1.1, 0x555555, fx + out * 0.55, y + 0.5, z, 0, Math.PI / 2, 0);
  b.sign(1.7, 0.85, { x: (cell % 2) * BLADE.w, y: Math.floor(cell / 2) * BLADE.h, w: BLADE.w, h: BLADE.h },
    bladeIsNeon(cell) ? 1.55 : 0.9, bx, y, z + 0.08);
}

/** Roof water tank (blue plastic or steel), centre height y. */
function waterTank(b, side, zc, width, y, r) {
  b.cyl(0.55, 0.55, 1.2, 12, r() < 0.6 ? 0x3f7fd8 : 0xcfd2d8, side * (FRONT + 3), y, zc + (r() - 0.5) * (width - 1.4));
}

/**
 * Shophouse stacked from Blender modules (art/blender/shophouse.py): ground floor,
 * 1-2 upper floors, roof. Modules are 4.8 m wide, stretched to the house width.
 */
function kitShophouse(b, kit, side, z0, width, r) {
  const zc = z0 - width / 2;
  const floors = 2 + (r() < 0.55 ? 1 : 0);
  const look = { facade: FACADES[Math.floor(r() * FACADES.length)], awning: AWNINGS[Math.floor(r() * AWNINGS.length)], windowLit: false };
  const fx = side * FRONT;
  const ry = -side * Math.PI / 2; // module front (+z) turns to face the road
  const sx = (width - 0.06) / 4.8;
  b.kitPart(kit[r() < 0.5 ? 'ground_shop' : 'ground_shutter'], fx, 0, zc, ry, sx, look);
  let balconyAbove = false;
  for (let f = 1; f < floors; f++) {
    look.windowLit = r() < 0.45;
    const balcony = r() < 0.4;
    if (f === 1) balconyAbove = balcony;
    b.kitPart(kit[balcony ? 'upper_b' : 'upper_a'], fx, f * 3.2, zc, ry, sx, look);
  }
  const shed = r() < 0.4;
  b.kitPart(kit[shed ? 'roof_b' : 'roof_a'], fx, floors * 3.2, zc, ry, sx, look);
  // upper_a keeps its bottom 0.95 m clear for the board; a balcony takes that spot instead
  if (!balconyAbove) boardSign(b, side, zc, width, r);
  // blade sign at the near party wall, clear of balconies and window canopies
  if (r() < 0.7) bladeSign(b, side, z0 - 0.08, 4.4 + r() * ((floors - 1) * 3.2 - 1.6), r);
  if (!shed && r() < 0.45) waterTank(b, side, zc, width, floors * 3.2 + 1.2, r);
}

function foodCart(b, x, z, ry, r) {
  const top = AWNINGS[Math.floor(r() * AWNINGS.length)];
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const at = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  let [px, pz] = at(0, 0);
  b.box(1.5, 0.9, 0.8, 0xd8e8f0, px, 0.85, pz, 0, ry, 0);
  b.box(1.7, 0.08, 1.0, top, px, 2.15, pz, 0, ry, 0);
  [px, pz] = at(0, 0.41); // lit glass case on the road side
  b.glowBox(1.3, 0.35, 0.05, 0xfff0c0, 0.9, px, 1.05, pz, 0, ry, 0);
  for (const k of [-0.65, 0.65]) { [px, pz] = at(k, -0.3); b.box(0.06, 1.2, 0.06, 0x888888, px, 1.6, pz, 0, ry, 0); }
  for (const k of [-0.55, 0.55]) { [px, pz] = at(k, 0.42); b.cyl(0.26, 0.26, 0.08, 12, 0x222222, px, 0.26, pz, Math.PI / 2, ry, 0); }
}

function scooter(b, x, z, r) {
  const col = [0xd83a3a, 0x3a7ad8, 0xf0f0f0, 0x222222][Math.floor(r() * 4)];
  b.box(0.35, 0.45, 1.3, col, x, 0.6, z);
  b.box(0.3, 0.12, 0.55, 0x1a1a1a, x, 0.9, z + 0.2);
  b.box(0.08, 0.7, 0.08, 0x777777, x, 1.05, z - 0.55);
  b.box(0.6, 0.06, 0.06, 0x333333, x, 1.4, z - 0.55);
  for (const k of [-0.5, 0.5]) b.cyl(0.26, 0.26, 0.12, 12, 0x1a1a1a, x, 0.26, z + k, 0, 0, Math.PI / 2);
}

function plant(b, x, z, r) {
  b.cyl(0.28, 0.22, 0.45, 10, 0xb8643a, x, 0.39, z);
  b.add(place(new THREE.SphereGeometry(0.38 + r() * 0.15, 7, 5), x, 0.85, z, r(), r(), 0), 0x3f9f4a);
}

/** Concrete power pole with a street lamp; returns the lamp head position. */
function pole(b, side, z, r, kit) {
  const x = side * (ROAD_HALF + 0.35);
  const out = -side;
  if (kit?.lamp) {
    // kit lamp arm points along +x: turn it toward the road
    b.kitPart(kit[r() < 0.35 && kit.lamp_tx ? 'lamp_tx' : 'lamp'], x, 0, z, out > 0 ? 0 : Math.PI);
    return new THREE.Vector3(x + out * 1.45, 6.2, z);
  }
  b.box(0.3, 8.6, 0.3, 0xa09aa8, x, 4.3, z);
  b.box(0.1, 0.1, 1.5, 0x8a8494, x, 7.9, z, 0, Math.PI / 2, 0);
  b.box(1.5, 0.1, 0.1, 0x6a6a72, x + out * 0.75, 6.45, z);
  b.glowBox(0.55, 0.14, 0.28, MOOD.lamp, 3.5, x + out * 1.45, 6.36, z);
  if (r() < 0.35) b.box(0.6, 0.8, 0.6, 0x7a7a84, x - out * 0.35, 5.2, z);
  return new THREE.Vector3(x + out * 1.45, 6.2, z);
}

function wires(b, side, zFrom, zTo, count, r) {
  const x = side * (ROAD_HALF + 0.35);
  for (let w = 0; w < count; w++) {
    const y0 = 6.9 + r() * 1.1, sag = 0.4 + r() * 1.3, dx = (r() - 0.5) * 0.8;
    const pts = [];
    for (let s = 0; s <= 12; s++) {
      const t = s / 12;
      pts.push(new THREE.Vector3(x + dx * Math.sin(t * Math.PI), y0 - sag * Math.sin(t * Math.PI), zFrom + (zTo - zFrom) * t));
    }
    b.line(pts);
  }
  // a messy coil hanging off the pole
  if (r() < 0.5) {
    const pts = [];
    for (let s = 0; s <= 16; s++) { const a = (s / 16) * Math.PI * 2; pts.push(new THREE.Vector3(x + Math.cos(a) * 0.35, 6.6 + Math.sin(a) * 0.35, zFrom - 0.3)); }
    b.line(pts);
  }
}

/**
 * @param {number} seed
 * @param {Record<string, KitPiece[]> | null} kit Blender parts; null = all code-built
 */
function buildVariant(seed, kit) {
  const r = createRng(seed);
  const b = new Builder();
  road(b);
  for (const side of [-1, 1]) {
    let z = 0;
    while (z < SEG_LEN - 0.01) {
      const width = houseWidth(SEG_LEN - z, r);
      if (kit?.ground_shop && width > 3) kitShophouse(b, kit, side, -z, width, r);
      else shophouse(b, side, -z, width, r);
      z += width;
    }
  }
  // lamps: left poles at 2 + k * LAMP_EVERY, right poles offset by half
  for (let k = 0; k < 3; k++) {
    const zl = -(2 + k * LAMP_EVERY);
    const zr = -(2 + LAMP_EVERY / 2 + k * LAMP_EVERY);
    b.lamps.push(pole(b, -1, zl, r, kit), pole(b, 1, zr, r, kit));
    wires(b, -1, zl, zl - LAMP_EVERY, 6, r);
    wires(b, 1, zr, zr - LAMP_EVERY, 3, r);
  }
  // one wire across the road
  const zc = -(4 + r() * (SEG_LEN - 8));
  const cross = [];
  for (let s = 0; s <= 16; s++) { const t = s / 16; cross.push(new THREE.Vector3(-(ROAD_HALF + 0.35) + t * 2 * (ROAD_HALF + 0.35), 7.4 - 1.0 * Math.sin(t * Math.PI), zc)); }
  b.line(cross);
  // sidewalk clutter, kept off the lamp poles. People are spots for people.js (they move, so they
  // don't merge) and roll their own rng so the street layout stays put.
  const pr = createRng(seed + 7919);
  const people = [];
  for (const side of [-1, 1]) {
    const x = side * (ROAD_HALF + WALK * 0.55);
    let z = 4 + r() * 4;
    while (z < SEG_LEN - 3) {
      const pick = r();
      const toRoad = side > 0 ? -Math.PI / 2 : Math.PI / 2; // turns a part's +z front to face the road
      if (pick < 0.25) {
        if (kit?.food_cart) {
          b.kitPart(kit.food_cart, x, 0, -z, toRoad);
          // no room behind the cart: the vendor stands at the open end, turned to the cart and the road
          people.push({ kind: 'vendor', x: x + side * 0.15, z: -z + 1.35, ry: Math.atan2(-side * 0.7, -1) });
          if (kit.stools && r() < 0.6) {
            const ry = r() * Math.PI;
            b.kitPart(kit.stools, x + side * 0.1, 0, -z - 1.9, ry);
            // sitters are modelled in stools space
            if (pr() < 0.7) people.push({ kind: pr() < 0.5 ? 'sit_uncle' : 'sit_auntie', x: x + side * 0.1, z: -z - 1.9, ry });
          } else if (pr() < 0.5) people.push({ kind: 'rider', x, z: -z - 1.4, ry: Math.atan2(-side * 0.7, 1) });
        } else foodCart(b, x, -z, toRoad, r);
      } else if (pick < 0.55) {
        if (kit?.scooter) b.kitPart(kit.scooter, x, 0, -z, r() < 0.5 ? 0 : Math.PI);
        else scooter(b, x, -z, r);
      } else if (pick < 0.8) {
        if (kit?.pots) b.kitPart(kit.pots, side * (FRONT - 0.4), 0, -z, toRoad);
        else plant(b, side * (FRONT - 0.35), -z, r);
      } else if (pick < 0.9 && kit?.spirit_house) b.kitPart(kit.spirit_house, side * (FRONT - 0.5), 0, -z, toRoad);
      z += 5 + r() * 7;
    }
  }
  return { ...b.merge(), lamps: b.lamps, people };
}

// ---------------------------------------------------------------- environment
/**
 * @param {THREE.Scene} scene
 * @returns {{ update(playerZ: number): void, peopleSpots(): Array<{ id: string, kind: string, x: number, z: number, ry: number }> }}
 */
export function createEnvironment(scene) {
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = ATLAS;
  drawAtlas(atlasCanvas);
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  // redraw once Kanit has loaded so the signs use the game font
  document.fonts?.load('800 64px Kanit').then(() => { drawAtlas(atlasCanvas); atlas.needsUpdate = true; }).catch(() => {});

  const seeds = Array.from({ length: VARIANTS }, (_, i) => 1000 + i * 7919);
  let variants = seeds.map((s) => buildVariant(s, null));

  const mats = {
    toon: toonMaterial(0xffffff, { vertexColors: true }),
    flat: toonMaterial(0xffffff, { vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    // pulled toward the camera so far-away signs don't flicker against their backing box
    signs: new THREE.MeshBasicMaterial({ vertexColors: true, map: atlas, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    curb: toonMaterial(0xffffff, { map: curbTexture() }),
    lines: new THREE.LineBasicMaterial({ color: 0x0c0810 }),
    sprite: new THREE.SpriteMaterial({ map: glowSpriteTexture(), color: MOOD.lamp, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }),
  };

  const rng = createRng(4242);
  const slots = [];
  for (let k = 0; k < RING; k++) {
    const v = variants[k % VARIANTS];
    const group = new THREE.Group();
    const meshes = {
      toon: new THREE.Mesh(v.toon, mats.toon),
      flat: new THREE.Mesh(v.flat, mats.flat),
      glow: new THREE.Mesh(v.glow, mats.glow),
      signs: new THREE.Mesh(v.signs, mats.signs),
      curb: new THREE.Mesh(v.curb, mats.curb),
      lines: new THREE.LineSegments(v.lines, mats.lines),
    };
    Object.values(meshes).forEach((m) => { m.matrixAutoUpdate = false; group.add(m); });
    // lamp positions are the same in every variant, so sprites never move inside a slot
    for (const p of v.lamps) {
      const s = new THREE.Sprite(mats.sprite);
      s.position.copy(p);
      s.scale.setScalar(3.2);
      group.add(s);
    }
    scene.add(group);
    slots.push({ group, meshes, start: 0, variant: v });
  }

  const lights = Array.from({ length: REAL_LIGHTS }, () => {
    const l = new THREE.PointLight(MOOD.lamp, LAMP_INTENSITY, 22, 1.6);
    scene.add(l);
    return l;
  });

  function setVariant(slot, v) {
    slot.variant = v;
    slot.meshes.toon.geometry = v.toon;
    slot.meshes.flat.geometry = v.flat;
    slot.meshes.glow.geometry = v.glow;
    slot.meshes.signs.geometry = v.signs;
    slot.meshes.curb.geometry = v.curb;
    slot.meshes.lines.geometry = v.lines;
  }
  function placeSlot(slot, start) {
    slot.start = start;
    slot.group.position.z = -start;
  }
  let run = 0; // bumped by layout: a new run can put a different variant on the same slot and start
  function layout(playerZ) {
    run++;
    const first = Math.floor(playerZ / SEG_LEN) * SEG_LEN - Math.ceil(BEHIND / SEG_LEN) * SEG_LEN;
    slots.forEach((slot, k) => { placeSlot(slot, first + k * SEG_LEN); setVariant(slot, variants[k % VARIANTS]); });
  }
  layout(0);

  // rebuild the variants from the Blender kit once it loads; slots keep their spot
  loadKit().then((kit) => {
    if (!kit) return;
    const old = variants;
    variants = seeds.map((s) => buildVariant(s, kit));
    for (const slot of slots) setVariant(slot, variants[old.indexOf(slot.variant)]);
    for (const v of old) for (const key of ['toon', 'flat', 'glow', 'signs', 'curb', 'lines']) v[key].dispose();
  });

  let lastZ = 0;
  const candidates = [];
  const spots = [];
  return {
    /** People spots of the live slots in world coordinates; an id changes when its slot is recycled. */
    peopleSpots() {
      spots.length = 0;
      slots.forEach((slot, k) => slot.variant.people.forEach((p, i) => {
        spots.push({ id: `${run}:${k}:${slot.start}:${i}`, kind: p.kind, x: p.x, z: -slot.start + p.z, ry: p.ry });
      }));
      return spots;
    },
    update(playerZ) {
      if (playerZ < lastZ - SEG_LEN) layout(playerZ); // new run
      lastZ = playerZ;
      for (const slot of slots) {
        while (slot.start + SEG_LEN < playerZ - BEHIND) {
          placeSlot(slot, slot.start + RING * SEG_LEN);
          setVariant(slot, variants[Math.floor(rng() * VARIANTS)]);
        }
      }
      // the few real lights sit in the lamps just ahead of the player
      candidates.length = 0;
      for (const slot of slots) {
        for (const p of slot.variant.lamps) {
          const d = slot.start - p.z;
          if (d > playerZ - 6 && d < playerZ + 70) candidates.push({ x: p.x, y: p.y, d, score: Math.abs(d - (playerZ + 12)) });
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      // intensity, not visibility: changing the light count recompiles every shader
      lights.forEach((l, i) => {
        const c = candidates[i];
        l.intensity = c ? LAMP_INTENSITY : 0;
        if (c) l.position.set(c.x, c.y, -c.d);
      });
    },
  };
}
