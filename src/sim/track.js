// Obstacle and coin spawning. Rows of obstacles sit at one z; every row leaves
// a lane free, rows are far enough apart to react (~1.2 s at full speed), and
// the first ~20 s only have single obstacles (config track.singleOnlyUntil).
import config from '../config.js';

/** @typedef {{ id: number, kind: 'dog'|'jar'|'cart'|'tuktuk', type: 'jump'|'block', lane: -1|0|1, z: number, hit: boolean }} Obstacle */
/** @typedef {{ id: number, lane: -1|0|1, z: number, taken: boolean }} Coin */

const KINDS = /** @type {const} */ (['dog', 'jar', 'cart', 'tuktuk']);
const TYPE = { dog: 'jump', jar: 'jump', cart: 'block', tuktuk: 'block' };
const LANES = /** @type {const} */ ([-1, 0, 1]);
/** Coin rows end this far before the row they lead into. */
const COIN_LEAD = 3;

/**
 * @param {typeof config.track} cfg read live
 * @param {() => number} rng
 */
export function createTrack(cfg = config.track, rng) {
  return {
    /** @type {Obstacle[]} */ obstacles: [],
    /** @type {Coin[]} */ coins: [],
    nextRowZ: cfg.startClear,
    /** @type {number|null} */ lastRowZ: null,
    nextId: 1,
    cfg,
    rng,
  };
}

/**
 * Spawn rows up to spawnAhead in front of the player, drop what is behind.
 * @param {ReturnType<typeof createTrack>} track
 * @param {number} density 1 = normal; 0.5 = half as many rows (chase event)
 */
export function updateTrack(track, playerZ, runTime, density = 1) {
  const { cfg, rng } = track;
  const behind = playerZ - cfg.despawnBehind;
  // Far behind (a jump in playerZ): restart spawning ahead, as at a run start.
  if (track.nextRowZ < playerZ) {
    track.nextRowZ = playerZ + cfg.startClear;
    track.lastRowZ = null;
  }
  while (track.nextRowZ <= playerZ + cfg.spawnAhead) {
    spawnRow(track, track.nextRowZ, runTime);
    track.lastRowZ = track.nextRowZ;
    const spacing = cfg.minRowSpacing + rng() * (cfg.maxRowSpacing - cfg.minRowSpacing);
    track.nextRowZ += spacing / Math.max(0.1, density);
  }
  track.obstacles = track.obstacles.filter((o) => o.z > behind);
  track.coins = track.coins.filter((c) => c.z > behind);
}

function spawnRow(track, z, runTime) {
  const { cfg, rng } = track;
  const count = runTime < cfg.singleOnlyUntil ? 1 : rng() < 0.5 ? 1 : 2;
  const lanes = shuffle([...LANES], rng);
  for (const lane of lanes.slice(0, count)) {
    const kind = KINDS[Math.floor(rng() * KINDS.length)];
    track.obstacles.push({ id: track.nextId++, kind, type: TYPE[kind], lane, z, hit: false });
  }
  // A coin row in a lane this row leaves free leads the eye to the way through.
  if (rng() < cfg.coinRowChance) {
    const free = lanes.slice(count);
    const lane = free[Math.floor(rng() * free.length)];
    const minZ = (track.lastRowZ ?? -Infinity) + COIN_LEAD;
    for (let i = 0; i < cfg.coinRowLength; i++) {
      const cz = z - COIN_LEAD - i * cfg.coinSpacing;
      if (cz <= minZ) break;
      track.coins.push({ id: track.nextId++, lane, z: cz, taken: false });
    }
  }
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
