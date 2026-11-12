// Obstacle and coin spawning. Rows of obstacles sit at one z; every row leaves
// a lane free, rows are far enough apart to react (~1.2 s at full speed), and
// the first ~20 s only have single obstacles (config track.singleOnlyUntil).
import config from '../config.js';

/** @typedef {{ id: number, kind: 'dog'|'jar'|'cart'|'tuktuk', type: 'jump'|'block', lane: -1|0|1, z: number, hit: boolean }} Obstacle */
/** @typedef {{ id: number, lane: -1|0|1, z: number, rowZ: number, taken: boolean, brave?: true }} Coin */

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
    /** furthest coin z placed so far (brave rows put coins past their row) */
    lastCoinZ: -Infinity,
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
    track.lastCoinZ = -Infinity;
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
  // Coin rows. Safe: a lane this row leaves free, leading the eye to the way through.
  // Brave (after braveFrom s): the lane of an obstacle, so grabbing them means a late
  // dodge (block) or a jump over it onto more coins (jump) - the near-miss line.
  if (rng() < cfg.coinRowChance) {
    const brave = runTime >= cfg.braveFrom && rng() < cfg.braveChance;
    const pool = brave ? lanes.slice(0, count) : lanes.slice(count);
    const lane = pool[Math.floor(rng() * pool.length)];
    const obstacle = track.obstacles.find((o) => o.z === z && o.lane === lane);
    const minZ = Math.max((track.lastRowZ ?? -Infinity) + COIN_LEAD, track.lastCoinZ + cfg.coinSpacing);
    /** @type {number[]} */ const zs = [];
    if (brave && obstacle?.type === 'jump') {
      // two leading in, the rest past the obstacle where the jump lands
      for (let i = 1; i <= 2; i++) zs.push(z - COIN_LEAD - (i - 1) * cfg.coinSpacing);
      for (let i = 1; zs.length < cfg.coinRowLength; i++) zs.push(z + 1 + i * cfg.coinSpacing);
    } else {
      for (let i = 0; i < cfg.coinRowLength; i++) zs.push(z - COIN_LEAD - i * cfg.coinSpacing);
    }
    for (const cz of zs) {
      if (cz <= minZ) continue;
      track.coins.push({ id: track.nextId++, lane, z: cz, rowZ: z, taken: false, ...(brave ? { brave: true } : {}) });
      track.lastCoinZ = Math.max(track.lastCoinZ, cz);
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
