// Models load by name from /models/<file>.glb. When the file is missing, a
// code-built stand-in shows instead, styled to look decent on camera.
// Handover spec: 1 unit = 1 m, origin at the feet/base centre, front faces +Z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { toonMaterial, addOutline, gradientMap, withRim } from './toon.js';

/** Eye spots on public/models/bossdog_v2.glb (art/blender/bossdog.py, rest pose); they ride the Head bone. */
export const BOSS_EYES = { x: 0, y: 0.6, z: 0.56, spread: 0.058, bone: 'Head' };

/** Stand-in name -> GLB file name (design section 7). */
const FILE_FOR = { kid: 'kid_v2', bossdog: 'bossdog_v2', dog: 'dog', jar: 'water_jar', cart: 'food_cart', tuktuk: 'tuk_tuk', coin: 'coin' };
/** Models that get the character look: rim, light floor, outline (props and the street don't). */
const CHARACTERS = new Set(['kid', 'bossdog', 'dog']);
/** Outline on characters, CSS pixels on screen (see outlineMaterial). */
export const CHARACTER_OUTLINE = 2.5;

/**
 * @param {{ airborne: boolean, stumbleT: number, speedMps: number }} player
 * @returns {'idle'|'run'|'jump'|'stumble'} clip to play
 */
export function animationFor(player) {
  if (player.airborne) return 'jump';
  if (player.stumbleT > 0) return 'stumble';
  if (player.speedMps < 0.5) return 'idle';
  return 'run';
}

// ---------------------------------------------------------------- stand-ins

/** `outline`: 0 = none; any other value gets the standard screen-space line. */
function mesh(geo, mat, parent, x = 0, y = 0, z = 0, outline = 0.025) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (outline) addOutline(m);
  parent.add(m);
  return m;
}
/** Capsule lying along Y whose top is at the parent origin (a limb hanging from a joint). */
function limb(radius, length, mat, parent) {
  return mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat, parent, 0, -(length / 2 + radius), 0, 0.02);
}

function kid() {
  const g = new THREE.Group();
  const skin = toonMaterial(0xf0b88e), shirt = toonMaterial(0xffffff), shorts = toonMaterial(0x1f2f6a);
  const hair = toonMaterial(0x1a1418), shoe = toonMaterial(0x161616), sock = toonMaterial(0xf4f4f4);
  const bag = toonMaterial(0xe8413a), dark = toonMaterial(0x111111), cheek = toonMaterial(0xff9a9a);
  const body = new THREE.Group(); // squash/stretch pivot at the feet
  g.add(body);

  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.56, 0); body.add(hip);
    limb(0.075, 0.28, skin, hip);
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10), sock, hip, 0, -0.42, 0, 0.015);
    mesh(new THREE.BoxGeometry(0.15, 0.09, 0.24), shoe, hip, 0, -0.51, 0.04, 0.02);
    return hip;
  });
  mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.2, 14), shorts, body, 0, 0.6, 0);
  mesh(new THREE.CapsuleGeometry(0.19, 0.2, 4, 14), shirt, body, 0, 0.86, 0);
  mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), shorts, body, -0.09, 0.95, 0.19, 0); // school badge
  mesh(new THREE.BoxGeometry(0.3, 0.34, 0.14), bag, body, 0, 0.9, -0.24); // backpack faces the camera
  mesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), toonMaterial(0xffd23f), body, 0, 0.82, -0.32, 0.015);

  const head = new THREE.Group(); head.position.y = 1.13; body.add(head);
  mesh(new THREE.SphereGeometry(0.24, 18, 14), skin, head);
  mesh(new THREE.SphereGeometry(0.255, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, head, 0, 0.02, -0.01, 0);
  mesh(new THREE.SphereGeometry(0.245, 14, 10, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.3, Math.PI * 0.45), hair, head, 0, 0, -0.012, 0);
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.035, 10, 8), dark, head, s * 0.085, 0.0, 0.215, 0);
    mesh(new THREE.SphereGeometry(0.035, 8, 6), cheek, head, s * 0.15, -0.07, 0.18, 0).scale.set(1, 0.6, 0.5);
  }

  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.25, 0.98, 0); body.add(shoulder);
    mesh(new THREE.CapsuleGeometry(0.065, 0.08, 4, 10), shirt, shoulder, 0, -0.08, 0, 0.02);
    limb(0.05, 0.2, skin, shoulder).position.y = -0.2;
    return shoulder;
  });
  g.userData.rig = { body, legs, arms, head };
  return g;
}

/**
 * Two glowing eye spheres on a dog's head (`at` in model space, metres).
 * Kept in userData.eyes, non-enumerable so Object3D.clone's JSON copy of userData skips them.
 * @param {THREE.Object3D} obj
 * @param {{ x?: number, y: number, z: number, spread: number, bone?: string }} at x = centre between the eyes (TRELLIS heads can be turned);
 *   bone = rigged models: the eyes ride this bone (spots are given in the model's rest pose)
 */
export function addEyes(obj, at) {
  const bone = at.bone ? obj.getObjectByName(at.bone) : null;
  if (bone) obj.updateMatrixWorld(true);
  const eyes = [-1, 1].map((s) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    m.name = 'eye';
    m.position.set((at.x ?? 0) + s * at.spread, at.y, at.z);
    if (bone) {
      bone.worldToLocal(obj.localToWorld(m.position));
      bone.add(m);
    } else obj.add(m);
    return m;
  });
  Object.defineProperty(obj.userData, 'eyes', { value: eyes, enumerable: false, configurable: true });
  return eyes;
}

/** Big black-and-tan soi dog mid-gallop: torn left ear, nose scar. Static legs; actors.js bobs it. */
function bossdog() {
  const g = new THREE.Group();
  const black = toonMaterial(0x1c1a1c), tan = toonMaterial(0xc8843c), nose = toonMaterial(0x0c0c0c);
  const scar = toonMaterial(0xd88a8a), tooth = toonMaterial(0xf4f0e0);
  mesh(new THREE.CapsuleGeometry(0.22, 0.46, 4, 14), black, g, 0, 0.52, -0.04).rotation.x = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.27, 16, 12), black, g, 0, 0.55, 0.2).scale.set(1.1, 1, 1);
  mesh(new THREE.SphereGeometry(0.2, 12, 10), tan, g, 0, 0.42, 0.3, 0).scale.set(1, 0.8, 0.6); // tan chest
  // running legs: front reach forward, back push back
  for (const [x, z, r] of [[0.13, 0.26, -0.45], [-0.13, 0.2, -0.25], [0.13, -0.32, 0.45], [-0.13, -0.26, 0.3]]) {
    const leg = mesh(new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), tan, g, x, 0.25, z, 0.02);
    leg.rotation.x = r;
  }
  const tail = mesh(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), black, g, 0, 0.66, -0.34, 0.015);
  tail.rotation.x = -0.9;
  // head, low and forward: growling
  mesh(new THREE.SphereGeometry(0.18, 14, 12), black, g, 0, 0.7, 0.4);
  mesh(new THREE.BoxGeometry(0.15, 0.11, 0.15), tan, g, 0, 0.64, 0.55, 0.02);
  mesh(new THREE.SphereGeometry(0.035, 8, 6), nose, g, 0, 0.68, 0.62, 0);
  mesh(new THREE.BoxGeometry(0.012, 0.012, 0.06), scar, g, 0.03, 0.7, 0.58, 0).rotation.y = 0.6;
  for (const s of [-1, 1]) {
    mesh(new THREE.ConeGeometry(0.02, 0.04, 4), tooth, g, s * 0.035, 0.585, 0.6, 0).rotation.x = Math.PI;
    mesh(new THREE.SphereGeometry(0.025, 6, 4), tan, g, s * 0.07, 0.8, 0.53, 0); // tan brow dots
    const torn = s < 0;
    const ear = mesh(new THREE.ConeGeometry(0.06, torn ? 0.08 : 0.16, 5), black, g, s * 0.11, torn ? 0.86 : 0.9, 0.36, 0.015);
    ear.rotation.z = -s * 0.35;
  }
  addEyes(g, { y: 0.75, z: 0.54, spread: 0.07 });
  return g;
}

function dog() {
  const g = new THREE.Group();
  const fur = toonMaterial(0xc88a4a), dark = toonMaterial(0x6a4020), nose = toonMaterial(0x1a1a1a), belly = toonMaterial(0xf0d0a0);
  const body = mesh(new THREE.CapsuleGeometry(0.24, 0.8, 4, 12), fur, g, 0, 0.26, 0);
  body.rotation.z = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.2, 12, 8), belly, g, 0.1, 0.16, 0.1, 0).scale.set(2.2, 0.6, 1);
  mesh(new THREE.SphereGeometry(0.25, 14, 10), fur, g, 0.68, 0.3, 0.12);
  mesh(new THREE.BoxGeometry(0.2, 0.14, 0.18), fur, g, 0.88, 0.24, 0.14);
  mesh(new THREE.SphereGeometry(0.045, 8, 6), nose, g, 0.99, 0.28, 0.14, 0);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.08, 0.18, 6), dark, g, 0.64, 0.52, 0.12 + s * 0.13, 0.015);
    ear.rotation.x = s * 0.4;
    mesh(new THREE.BoxGeometry(0.05, 0.015, 0.04), nose, g, 0.84, 0.36, 0.14 + s * 0.08, 0); // sleepy closed eyes
  }
  for (const [x, z] of [[0.45, 0.22], [0.3, 0.26], [-0.4, 0.2], [-0.5, 0.24]]) mesh(new THREE.CapsuleGeometry(0.06, 0.18, 4, 8), fur, g, x, 0.07, z, 0.015).rotation.x = Math.PI / 2;
  const tail = mesh(new THREE.CapsuleGeometry(0.05, 0.35, 4, 8), dark, g, -0.72, 0.2, 0.1, 0.015);
  tail.rotation.z = 1.2;
  return g;
}

function jar() {
  const g = new THREE.Group();
  const pts = [[0, 0], [0.34, 0.02], [0.5, 0.3], [0.52, 0.55], [0.4, 0.82], [0.33, 0.86], [0.36, 0.92], [0.3, 0.92], [0.28, 0.85], [0, 0.85]]
    .map(([a, b]) => new THREE.Vector2(a, b));
  mesh(new THREE.LatheGeometry(pts, 18), toonMaterial(0x5a2e1a), g, 0, 0, 0, 0.03);
  mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 24), toonMaterial(0xd8a040), g, 0, 0.5, 0, 0).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.02, 18), toonMaterial(0x2a3a5a), g, 0, 0.84, 0, 0); // water
  return g;
}

function cart() {
  const g = new THREE.Group();
  const red = toonMaterial(0xe83a3a), steel = toonMaterial(0xc8d2dc), tire = toonMaterial(0x1e1e1e), pole = toonMaterial(0x888888);
  mesh(new THREE.BoxGeometry(1.7, 0.95, 0.95), steel, g, 0, 0.88, 0);
  mesh(new THREE.BoxGeometry(1.72, 0.18, 0.97), red, g, 0, 1.2, 0, 0.02);
  mesh(new THREE.BoxGeometry(1.4, 0.45, 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c0).multiplyScalar(0.95) }), g, 0, 1.55, 0, 0.02);
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), pole, g, s * 0.78, 1.85, -0.35, 0.015);
  mesh(new THREE.BoxGeometry(2.0, 0.1, 1.3), red, g, 0, 2.42, -0.05);
  for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(0.2, 0.1, 1.31), toonMaterial(0xffffff), g, -0.8 + i * 0.4, 2.42, -0.05, 0);
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 14), tire, g, s * 0.62, 0.3, 0.5).rotation.x = Math.PI / 2;
  return g;
}

function tuktuk() {
  const g = new THREE.Group();
  const body = toonMaterial(0xe83a3a), trim = toonMaterial(0xffd23f), roof = toonMaterial(0x1f6f4f), tire = toonMaterial(0x1e1e1e);
  const seat = toonMaterial(0x2a1a3a), glass = toonMaterial(0x9fd8ff), chrome = toonMaterial(0xdddddd);
  mesh(new THREE.BoxGeometry(1.4, 0.55, 1.4), body, g, 0, 0.6, -0.55); // rear passenger tub
  mesh(new THREE.BoxGeometry(1.2, 0.5, 0.2), seat, g, 0, 1.0, -1.1);
  mesh(new THREE.BoxGeometry(0.75, 0.75, 1.1), body, g, 0, 0.75, 0.65); // driver cab
  mesh(new THREE.BoxGeometry(0.7, 0.4, 0.04), glass, g, 0, 1.3, 1.08, 0.015);
  mesh(new THREE.BoxGeometry(1.45, 0.08, 2.8), trim, g, 0, 0.38, 0);
  for (const [x, z] of [[-0.66, -1.1], [0.66, -1.1], [-0.66, 0.0], [0.66, 0.0], [-0.3, 1.1], [0.3, 1.1]]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), chrome, g, x, 1.5, z, 0.012);
  mesh(new THREE.BoxGeometry(1.6, 0.14, 2.9), roof, g, 0, 2.12, -0.05);
  mesh(new THREE.BoxGeometry(1.62, 0.1, 2.92), trim, g, 0, 2.02, -0.05, 0.015);
  for (const [x, z] of [[-0.62, -0.75], [0.62, -0.75], [0, 1.05]]) mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 14), tire, g, x, 0.27, z).rotation.z = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6c0).multiplyScalar(1.6) }), g, 0, 0.95, 1.22, 0.015);
  return g;
}

function coin() {
  const g = new THREE.Group();
  const gold = toonMaterial(0xffd23f, { emissive: 0xff9a00, emissiveIntensity: 0.45 });
  const disc = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.07, 20), gold, g, 0, 0, 0, 0.02);
  disc.rotation.x = Math.PI / 2;
  const ring = mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 20), toonMaterial(0xd89a10), g, 0, 0, 0.04, 0);
  ring.rotation.z = Math.PI / 2;
  return g;
}

const BUILDERS = { kid, bossdog, dog, jar, cart, tuktuk, coin };

/**
 * @param {'kid'|'bossdog'|'dog'|'jar'|'cart'|'tuktuk'|'coin'} name
 * @returns {THREE.Object3D}
 */
export function makeStandIn(name) {
  const build = BUILDERS[name];
  if (!build) throw new Error(`no stand-in for model "${name}"`);
  const obj = build();
  obj.name = name;
  obj.userData.standIn = true;
  return obj;
}

// ---------------------------------------------------------------- GLB loading

const loader = new GLTFLoader();
/** @type {Map<string, Promise<{ scene: THREE.Object3D, animations: THREE.AnimationClip[] } | null>>} */
const gltfCache = new Map();

/**
 * Re-skin a loaded model with the shared toon look and outlines.
 * @param {THREE.Object3D} root
 * @param {boolean} rim characters: add the neon rim (own material copy, the toon cache stays plain)
 * @param {boolean} [outline] black outline, default with the rim
 */
function toonify(root, rim, outline = rim) {
  root.traverse((o) => {
    if (!o.isMesh || o.name.endsWith('-outline')) return;
    const old = o.material;
    const color = old.color ? old.color.getHex() : 0xffffff;
    // emissive Blender parts (lamps, lit glass, neon) stay unlit and bright, like the stand-ins' glow parts
    if (old.emissive && old.emissive.getHex() !== 0) o.material = new THREE.MeshBasicMaterial({ color: old.emissive.clone().multiplyScalar(1.3) });
    else if (rim) {
      o.material = withRim(toonMaterial(color, { map: old.map || undefined }).clone());
      o.material.name = old.name; // dogVariant recolours sp_coat / sp_tan by name
    } else o.material = toonMaterial(color, { map: old.map || undefined });
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); // Mesh2Motion exports have none
    if (o.isSkinnedMesh) o.frustumCulled = false;
    // characters only; face details stay clean. The sleeping dog (a TRELLIS scan) traces a noisy line, so it goes without.
    if (rim && outline && !old.name.includes('flat_')) addOutline(o, CHARACTER_OUTLINE);
  });
}

// relative to the page base: '/' on localhost, './' build also works under /RoomRun/ on GitHub Pages
const MODELS_DIR = `${import.meta.env?.BASE_URL ?? '/'}models/`;

function fetchGltf(name) {
  if (!gltfCache.has(name)) {
    const url = `${MODELS_DIR}${FILE_FOR[name] ?? name}.glb`;
    gltfCache.set(name, fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        // Vite answers a missing file with index.html: check the glTF magic first
        if (!buf || buf.byteLength < 4 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return null;
        return loader.parseAsync(buf, MODELS_DIR);
      })
      .then((gltf) => {
        if (!gltf) return null;
        toonify(gltf.scene, CHARACTERS.has(name), CHARACTERS.has(name) && name !== 'dog');
        return { scene: gltf.scene, animations: gltf.animations };
      })
      .catch((err) => { console.warn(`model ${name}: using stand-in (${err.message})`); return null; }));
  }
  return gltfCache.get(name);
}

/**
 * @param {string} name
 * @returns {Promise<THREE.Object3D>} a new instance; GLB clips (if any) in userData.animations
 */
export async function loadModel(name) {
  const gltf = await fetchGltf(name);
  if (!gltf) return makeStandIn(/** @type {any} */ (name));
  const obj = cloneSkinned(gltf.scene);
  obj.name = name;
  obj.userData.animations = gltf.animations;
  return obj;
}

/** Small dogs' light parts (the boss's tan): cream, so the tan coat still has markings. */
const SMALL_DOG_LIGHT = [242, 214, 160];
const swappedMaps = new Map();

/**
 * The boss's flat-colour texture (art/flatten_textures.py) with its black coat turned `tint`
 * and its tan turned cream; pink (nose, scar) stays. One copy per map + tint.
 * @param {THREE.Texture} map
 * @param {number} tint
 * @returns {THREE.Texture|null} null when there is no image to read (tests, stand-ins)
 */
function tanCoat(map, tint) {
  const key = `${map.uuid}|${tint}`;
  if (swappedMaps.has(key)) return swappedMaps.get(key);
  const img = map.image;
  if (typeof document === 'undefined' || !img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  const tan = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255]; // sRGB, like the texture
  for (let i = 0; i < d.length; i += 4) {
    const [r, gr, b] = [d[i], d[i + 1], d[i + 2]];
    if (r - gr > 70 && r - b > 70 && gr < 140) continue; // pink
    const to = r + gr + b < 240 ? tan : SMALL_DOG_LIGHT;
    d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2];
  }
  g.putImageData(px, 0, 0);
  const tex = map.clone(); // keeps flipY, colour space and sampler of the GLB texture
  tex.source = new THREE.TextureSource(c); // clones share their Source: setting .image would repaint the boss too
  tex.needsUpdate = true;
  swappedMaps.set(key, tex);
  return tex;
}

/**
 * A smaller, tan copy of a dog for heel and pack dogs. Materials are cloned so the
 * source keeps its look; the coat turns `tint` and the tan markings cream: by material
 * name on the Blender dog (sp_coat / sp_tan), by repainting a textured coat, or plain tan.
 * @param {THREE.Object3D} src
 * @param {{ scale: number, tint: number }} opts
 */
export function dogVariant(src, { scale, tint }) {
  const obj = cloneSkinned(src);
  const tan = new THREE.Color(tint);
  const eyes = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.name.endsWith('-outline')) return;
    o.material = o.material.clone();
    if (o.name === 'eye') { eyes.push(o); return; }
    if (o.material.userData.rim) withRim(o.material);
    if (o.material.name === 'sp_coat') o.material.color.copy(tan);
    else if (o.material.name === 'sp_tan') o.material.color.setRGB(...SMALL_DOG_LIGHT.map((c) => c / 255), THREE.SRGBColorSpace);
    else if (o.material.map) {
      const coat = tanCoat(o.material.map, tint);
      o.material.map = coat;
      if (coat) o.material.color.set(0xffffff); else o.material.color.copy(tan);
      o.material.needsUpdate = true;
    } else if (!o.material.name.startsWith('sp_')) o.material.color.lerp(tan, 0.7); // stand-in
  });
  Object.defineProperty(obj.userData, 'eyes', { value: eyes, enumerable: false, configurable: true });
  obj.scale.setScalar(scale);
  return obj;
}
