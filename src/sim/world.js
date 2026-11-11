// The game itself, with no Three.js: one fixed step at a time, it moves the
// player and the chaser, spawns the track, checks hits, runs the chase event,
// and returns the names of what happened. Render, HUD and audio only read the
// world and react to those event names.
//
// Events: 'run-start' 'lane' 'jump' 'land' 'coin' 'hit' 'hit-<kind>' 'heel-start' 'heel-end' 'chaser-near'
//         'chase-warning' 'chase-start' 'chase-survived' 'caught'
//         'near-miss' 'combo-up' 'combo-break'
import config from '../config.js';
import { createRng } from './rng.js';
import { createTrack, updateTrack } from './track.js';

/** @typedef {import('../input/hub.js').InputFrame} InputFrame */

/**
 * @param {typeof config} cfg read live every step
 * @param {number} seed
 */
export function createWorld(cfg = config, seed = Date.now()) {
  const rng = createRng(seed);
  const world = {
    cfg,
    rng,
    /** @type {'title'|'running'|'caught'} */
    phase: 'title',
    runTime: 0,
    coins: 0,
    player: newPlayer(),
    chaser: { gap: cfg.chaser.startGap, speedMps: cfg.chaser.speed, angry: false, visible: false },
    /** @type {{ phase: 'idle'|'warning'|'active', t: number, nextAt: number, count: number }} t = seconds left in phase */
    chase: { phase: 'idle', t: 0, nextAt: cfg.chase.firstAt, count: 0 },
    track: createTrack(cfg.track, rng),
    /** rows passed in a row without a hit */
    combo: 0,
    /** z of the last row counted for the combo */
    lastPassZ: -Infinity,
    /** @type {{ distance: number, coins: number, score: number } | null} */
    lastRun: null,
    /** @type {{ kind: string, distance: number } | null} latest obstacle hit, for effects */
    lastHit: null,
    /** @type {{ id: number, t: number }[]} woken dogs at the kid's heels, oldest first; t = seconds left */
    heelDogs: [],
    nextHeelId: 1,
    /** @type {string[]} events raised outside stepWorld (hotkeys), emitted on the next step */
    pending: [],
  };
  updateTrack(world.track, 0, 0);
  return world;
}

function newPlayer() {
  return { lane: 0, x: 0, y: 0, vy: 0, distance: 0, speedMps: 0, stumbleT: 0, laneCooldownT: 0, airborne: false,
    /** lane left by the latest lane change, and when (runTime); latest takeoff time */
    laneFrom: 0, laneT: -Infinity, jumpT: -Infinity };
}

/** Coin multiplier for a combo: 1 until comboStep rows, then +1 per comboStep, capped. */
export function multiplierFor(combo, nm) {
  return Math.min(nm.maxMultiplier, 1 + Math.floor(combo / nm.comboStep));
}

/** Leaderboard score: whole metres plus coins. */
export function scoreOf(distance, coins) {
  return Math.max(0, Math.floor(distance)) + coins;
}

/** Reset everything for a new run. Allowed from any phase (R key). */
export function startRun(world) {
  const { cfg } = world;
  world.phase = 'running';
  world.runTime = 0;
  world.coins = 0;
  world.player = newPlayer();
  world.chaser = { gap: cfg.chaser.startGap, speedMps: cfg.chaser.speed, angry: false, visible: cfg.chaser.startGap < cfg.chaser.visibleGap };
  world.chase = { phase: 'idle', t: 0, nextAt: cfg.chase.firstAt, count: 0 };
  world.combo = 0;
  world.lastPassZ = -Infinity;
  world.track = createTrack(cfg.track, world.rng);
  updateTrack(world.track, 0, 0);
  world.pending = [];
  world.lastHit = null;
  world.heelDogs = [];
}

/** Start the chase event now (C key). Only while running and no event is on. */
export function triggerChase(world) {
  if (world.phase !== 'running' || world.chase.phase !== 'idle') return false;
  beginWarning(world, world.pending);
  return true;
}

function beginWarning(world, events) {
  world.chase.phase = 'warning';
  world.chase.t = world.cfg.chase.warningTime;
  world.chase.nextAt = world.runTime + world.cfg.chase.every;
  events.push('chase-warning');
}

/** A hit sleeping dog joins the chase at the kid's heels; at the cap the oldest one's timer restarts. */
function wakeHeelDog(world, events) {
  const fx = world.cfg.effects;
  if (world.heelDogs.length >= fx.maxHeelDogs) {
    const oldest = world.heelDogs.shift();
    oldest.t = fx.heelTime;
    world.heelDogs.push(oldest);
  } else {
    world.heelDogs.push({ id: world.nextHeelId++, t: fx.heelTime });
  }
  events.push('heel-start');
}

/**
 * @param {InputFrame} input
 * @param {number} dt seconds
 * @returns {string[]} events
 */
export function stepWorld(world, input, dt) {
  const { cfg } = world;
  /** @type {string[]} */
  const events = world.pending;
  world.pending = [];

  if (world.phase === 'title') {
    if (input.speed < cfg.player.startSpeedThreshold) return events;
    startRun(world);
    events.push('run-start');
  }
  if (world.phase !== 'running') return events;

  world.runTime += dt;
  const p = world.player;
  const pc = cfg.player;

  // Speed and distance
  p.stumbleT = Math.max(0, p.stumbleT - dt);
  p.laneCooldownT = Math.max(0, p.laneCooldownT - dt);
  p.speedMps = input.speed * pc.maxSpeed * (p.stumbleT > 0 ? pc.stumbleFactor : 1);
  p.distance += p.speedMps * dt;

  // Lane: one step per gesture; at the edge nothing happens (no bump, no cooldown)
  if (input.laneDelta !== 0 && p.laneCooldownT <= 0) {
    const lane = Math.max(-1, Math.min(1, p.lane + input.laneDelta));
    if (lane !== p.lane) {
      p.laneFrom = p.lane;
      p.laneT = world.runTime;
      p.lane = lane;
      p.laneCooldownT = pc.laneCooldown;
      events.push('lane');
    }
  }
  const targetX = p.lane * pc.laneWidth;
  const maxMove = (pc.laneWidth / pc.laneChangeTime) * dt;
  p.x += Math.max(-maxMove, Math.min(maxMove, targetX - p.x));

  // Jump (grounded only), then gravity
  if (input.jump && !p.airborne) {
    p.vy = pc.jumpVelocity;
    p.airborne = true;
    p.jumpT = world.runTime;
    events.push('jump');
  }
  if (p.airborne) {
    p.vy -= pc.gravity * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.airborne = false;
      events.push('land');
    }
  }

  // Track and collisions
  const density = world.chase.phase === 'idle' ? 1 : cfg.chase.obstacleDensity;
  updateTrack(world.track, p.distance, world.runTime, density);
  const tc = cfg.track;
  const fx = cfg.effects;
  for (const o of world.track.obstacles) {
    if (o.hit) continue;
    if (Math.abs(o.z - p.distance) >= tc.hitHalfDepth) continue;
    if (Math.abs(p.x - o.lane * pc.laneWidth) >= tc.laneHitHalfWidth) continue;
    if (o.type === 'jump' && p.y >= tc.jumpClearHeight) continue;
    o.hit = true;
    p.stumbleT = Math.max(p.stumbleT, o.kind === 'tuktuk' ? fx.tuktukStun : pc.stumbleTime);
    if (o.kind === 'cart') world.coins = Math.max(0, world.coins - fx.cartCoinLoss);
    world.lastHit = { kind: o.kind, distance: p.distance };
    events.push('hit', `hit-${o.kind}`);
    if (o.kind === 'dog') wakeHeelDog(world, events);
    if (world.combo >= cfg.nearMiss.comboStep) events.push('combo-break');
    world.combo = 0;
  }
  passRows(world, events);
  const mult = multiplierFor(world.combo, cfg.nearMiss);
  for (const c of world.track.coins) {
    if (c.taken) continue;
    if (Math.abs(c.z - p.distance) >= tc.coinPickupDepth) continue;
    if (Math.abs(p.x - c.lane * pc.laneWidth) >= tc.laneHitHalfWidth) continue;
    c.taken = true;
    world.coins += mult;
    events.push('coin');
  }

  // Heel dogs leave when their time runs out
  for (const h of world.heelDogs) h.t -= dt;
  const leaving = world.heelDogs.filter((h) => h.t <= 0);
  if (leaving.length) {
    world.heelDogs = world.heelDogs.filter((h) => h.t > 0);
    for (let i = 0; i < leaving.length; i++) events.push('heel-end');
  }

  // Chaser: constant speed, gap = how far behind it is
  const ch = world.chaser;
  ch.gap = Math.min(cfg.chaser.maxGap, ch.gap + (p.speedMps - ch.speedMps) * dt);
  if (ch.gap <= 0) {
    ch.gap = 0;
    ch.visible = true;
    world.phase = 'caught';
    world.lastRun = { distance: p.distance, coins: world.coins, score: scoreOf(p.distance, world.coins) };
    events.push('caught');
    return events;
  }
  const wasVisible = ch.visible;
  ch.visible = ch.gap < cfg.chaser.visibleGap;
  if (ch.visible && !wasVisible) events.push('chaser-near');

  // Chase event: warning -> active (chaser faster) -> survived (reward) -> idle
  const chase = world.chase;
  const cc = cfg.chase;
  if (chase.phase === 'idle' && world.runTime >= chase.nextAt) {
    beginWarning(world, events);
  } else if (chase.phase === 'warning') {
    chase.t -= dt;
    if (chase.t <= 0) {
      chase.phase = 'active';
      chase.t = chase.count === 0 && cc.firstActiveTime ? cc.firstActiveTime : cc.activeTime;
      chase.count++;
      events.push('chase-start');
    }
  } else if (chase.phase === 'active') {
    chase.t -= dt;
    if (chase.t <= 0) {
      chase.phase = 'idle';
      chase.t = 0;
      world.coins += cc.rewardCoins;
      ch.gap = Math.min(cfg.chaser.maxGap, ch.gap + cc.rewardGap);
      events.push('chase-survived');
    }
  }
  ch.angry = chase.phase === 'active';
  ch.speedMps = cfg.chaser.speed * (ch.angry ? cc.speedMultiplier : 1) + world.heelDogs.length * cfg.effects.heelSpeedBonus;

  return events;
}

/**
 * Obstacles that just went behind the kid without a hit. A row counts once for
 * the combo (only if nothing in it was hit). A near-miss: the kid left that
 * obstacle's lane, or jumped it, within the last moment.
 */
function passRows(world, events) {
  const { cfg, player: p } = world;
  const nm = cfg.nearMiss;
  const behind = p.distance - cfg.track.hitHalfDepth;
  let near = false;
  for (const o of world.track.obstacles) {
    if (o.hit || o.passed || o.z >= behind) continue;
    o.passed = true;
    const rowHit = world.track.obstacles.some((x) => x.z === o.z && x.hit);
    if (!rowHit && o.z !== world.lastPassZ) {
      world.lastPassZ = o.z;
      const before = multiplierFor(world.combo, nm);
      world.combo++;
      if (multiplierFor(world.combo, nm) > before) events.push('combo-up');
    }
    const dodged = o.lane === p.laneFrom && o.lane !== p.lane && world.runTime - p.laneT <= nm.laneWindow;
    const jumped = o.type === 'jump' && o.lane === p.lane && world.runTime - p.jumpT <= nm.jumpWindow;
    if (!rowHit && (dodged || jumped)) near = true;
  }
  if (near) {
    world.coins += nm.bonusCoins * multiplierFor(world.combo, nm);
    events.push('near-miss');
  }
}
