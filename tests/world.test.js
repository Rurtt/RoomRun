import { test, expect } from 'vitest';
import config from '../src/config.js';
import { createWorld, startRun, stepWorld, triggerChase } from '../src/sim/world.js';

const DT = 1 / 120;
const frame = (f = {}) => ({ speed: 0, laneDelta: 0, jump: false, steps: 0, ...f });
const idle = frame();
const sprint = frame({ speed: 1 });
const count = (events, name) => events.filter((e) => e === name).length;
/** Config whose track spawns nothing, so tests place their own obstacles. */
const emptyCfg = () => { const c = structuredClone(config); c.track.startClear = 1e9; return c; };
/** Step until pred(events of this step) or maxSeconds. Returns all events with their times. */
function runUntil(w, f, pred, maxSeconds) {
  const events = []; const log = []; let t = 0;
  while (t < maxSeconds) {
    const ev = stepWorld(w, typeof f === 'function' ? f(t) : f, DT); t += DT;
    ev.forEach((e) => { events.push(e); log.push({ e, t }); });
    if (pred(ev)) break;
  }
  return { events, log, t };
}
const run = (w, f, seconds) => runUntil(w, f, () => false, seconds);
const dog = (z, lane = 0) => ({ id: 1, kind: 'dog', type: 'jump', lane, z, hit: false });

test('stop running from start gap -> caught in 3-4 s', () => {
  const w = createWorld(config, 1); startRun(w);
  const { events, t } = runUntil(w, idle, (e) => e.includes('caught'), 10);
  expect(t).toBeGreaterThan(3); expect(t).toBeLessThan(4);
  expect(w.phase).toBe('caught'); expect(count(events, 'caught')).toBe(1);
  expect(w.lastRun).toEqual({ distance: 0, coins: 0, score: 0, bestCombo: 0, nearMisses: 0 });
});

test('caught world does nothing more', () => {
  const w = createWorld(config, 1); startRun(w); run(w, idle, 5);
  expect(stepWorld(w, sprint, DT)).toEqual([]); expect(w.player.distance).toBe(0);
});

test('full sprint clamps gap at maxGap', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); run(w, sprint, 20);
  expect(w.chaser.gap).toBe(50); expect(w.player.distance).toBeCloseTo(240, 0);
});

test('title starts when running starts', () => {
  const w = createWorld(config, 1); expect(w.phase).toBe('title');
  expect(stepWorld(w, frame({ speed: 0.1 }), DT)).toEqual([]); expect(w.phase).toBe('title');
  expect(stepWorld(w, frame({ speed: 0.5 }), DT)).toContain('run-start'); expect(w.phase).toBe('running');
});

test('title has obstacles ahead to look at', () => {
  const w = createWorld(config, 1); expect(w.track.obstacles.length).toBeGreaterThan(0);
});

test('chaser-near fires when the gap drops under visibleGap (5 m: the dog only shows when it is really close)', () => {
  const w = createWorld(config, 1); startRun(w); expect(w.chaser.visible).toBe(false);
  const { events, t } = runUntil(w, idle, (e) => e.includes('chaser-near'), 5);
  expect(count(events, 'chaser-near')).toBe(1); expect(w.chaser.visible).toBe(true);
  expect(t).toBeCloseTo((20 - 5) / 6, 1);
});

test('default: no lane cooldown, a quick double tap crosses two lanes', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  expect(stepWorld(w, frame({ speed: 1, laneDelta: -1 }), DT)).toContain('lane');
  run(w, sprint, 0.05);
  expect(stepWorld(w, frame({ speed: 1, laneDelta: 1 }), DT)).toContain('lane');
  expect(stepWorld(w, frame({ speed: 1, laneDelta: 1 }), DT)).toContain('lane'); expect(w.player.lane).toBe(1);
});

test('lane change respects cooldown (when set) and edges', () => {
  const c = emptyCfg(); c.player.laneCooldown = 0.35;
  const w = createWorld(c, 1); startRun(w);
  expect(stepWorld(w, frame({ speed: 1, laneDelta: -1 }), DT)).toContain('lane'); expect(w.player.lane).toBe(-1);
  run(w, sprint, 0.2);
  expect(stepWorld(w, frame({ speed: 1, laneDelta: 1 }), DT)).not.toContain('lane'); expect(w.player.lane).toBe(-1);
  run(w, sprint, 0.2);
  // at the edge: nothing happens, and no cooldown starts
  expect(stepWorld(w, frame({ speed: 1, laneDelta: -1 }), DT)).not.toContain('lane'); expect(w.player.lane).toBe(-1);
  expect(stepWorld(w, frame({ speed: 1, laneDelta: 1 }), DT)).toContain('lane'); expect(w.player.lane).toBe(0);
});

test('x eases to the lane over laneChangeTime', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  stepWorld(w, frame({ speed: 1, laneDelta: 1 }), DT);
  run(w, sprint, 0.07); expect(w.player.x).toBeGreaterThan(0.5); expect(w.player.x).toBeLessThan(2.5);
  run(w, sprint, 0.1); expect(w.player.x).toBeCloseTo(2.5, 5);
});

test('jump lasts ~0.7 s and cannot double jump', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  expect(stepWorld(w, frame({ speed: 1, jump: true }), DT)).toContain('jump'); expect(w.player.airborne).toBe(true);
  run(w, sprint, 0.3);
  expect(w.player.y).toBeGreaterThan(1);
  expect(stepWorld(w, frame({ speed: 1, jump: true }), DT)).not.toContain('jump');
  const { t, events } = runUntil(w, sprint, (e) => e.includes('land'), 2);
  const airtime = 0.3 + DT + t;
  expect(airtime).toBeGreaterThan(0.6); expect(airtime).toBeLessThan(0.8);
  expect(count(events, 'land')).toBe(1); expect(w.player.y).toBe(0); expect(w.player.airborne).toBe(false);
});

test('hitting a jump obstacle stumbles once', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(dog(40));
  const { events, t } = runUntil(w, sprint, (e) => e.includes('hit'), 5);
  expect(count(events, 'hit')).toBe(1); expect(t).toBeCloseTo((40 - 0.8) / 12, 1);
  const after = run(w, sprint, 0.9); expect(count(after.events, 'hit')).toBe(0);
  expect(w.player.speedMps).toBeLessThanOrEqual(0.2 * 12 + 1e-9);
  run(w, sprint, 0.7); expect(w.player.speedMps).toBeCloseTo(12);
  expect(w.track.obstacles[0].hit).toBe(true); expect(w.phase).toBe('running');
});

test('jumping over a dog avoids the hit', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(dog(40));
  runUntil(w, sprint, () => w.player.distance >= 40 - 12 * 0.35, 5);
  stepWorld(w, frame({ speed: 1, jump: true }), DT);
  const { events } = run(w, sprint, 1.5);
  expect(count(events, 'hit')).toBe(0); expect(w.player.distance).toBeGreaterThan(45);
});

test('jumping does not clear a lane-blocker', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  w.track.obstacles.push({ id: 1, kind: 'cart', type: 'block', lane: 0, z: 40, hit: false });
  runUntil(w, sprint, () => w.player.distance >= 40 - 12 * 0.35, 5);
  stepWorld(w, frame({ speed: 1, jump: true }), DT);
  expect(count(run(w, sprint, 1.5).events, 'hit')).toBe(1);
});

test('a different lane avoids the obstacle', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(dog(40, 1));
  expect(count(run(w, sprint, 5).events, 'hit')).toBe(0);
});

test('coin pickup', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.coins.push({ id: 2, lane: 0, z: 20, taken: false });
  const { events } = run(w, sprint, 3);
  expect(count(events, 'coin')).toBe(1); expect(w.coins).toBe(1); expect(w.track.coins[0].taken).toBe(true);
});

test('coin in another lane is not picked', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.coins.push({ id: 2, lane: -1, z: 20, taken: false });
  expect(count(run(w, sprint, 3).events, 'coin')).toBe(0);
});

test('chase: warning 3 s, active 30 s faster, survive gives reward', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.chase.count = 1; // not the short first pack
  const steady = frame({ speed: 0.7 }); // 8.4 m/s: gap holds still during the active chase
  run(w, steady, 1);
  expect(triggerChase(w)).toBe(true); expect(w.chase.phase).toBe('warning');
  const warn = runUntil(w, steady, (e) => e.includes('chase-start'), 5);
  expect(warn.events[0]).toBe('chase-warning'); expect(warn.t).toBeCloseTo(3, 1);
  expect(w.chase.phase).toBe('active'); expect(w.chaser.speedMps).toBeCloseTo(8.4); expect(w.chaser.angry).toBe(true);
  let gapBefore = 0;
  const act = runUntil(w, () => { gapBefore = w.chaser.gap; return steady; }, (e) => e.includes('chase-survived'), 40);
  expect(act.t).toBeCloseTo(30, 1);
  expect(w.coins).toBe(50); expect(w.chaser.gap).toBeCloseTo(Math.min(gapBefore + 15, 50), 5);
  expect(w.chase.phase).toBe('idle'); expect(w.chaser.angry).toBe(false); expect(w.chaser.speedMps).toBe(6);
});

test('caught during the chase event ends the run', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); triggerChase(w);
  const { events } = runUntil(w, idle, (e) => e.includes('caught'), 10);
  expect(w.phase).toBe('caught'); expect(events).not.toContain('chase-survived');
});

test('auto chase at 20 s, then every 60 s; the first pack lasts 15 s, later ones 30 s', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  const { log } = run(w, sprint, 145);
  const at = (name) => log.filter((x) => x.e === name).map((x) => x.t);
  const warns = at('chase-warning');
  expect(warns.length).toBe(3);
  expect(warns[0]).toBeCloseTo(20, 1); expect(warns[1]).toBeCloseTo(80, 1); expect(warns[2]).toBeCloseTo(140, 1);
  const starts = at('chase-start'); const ends = at('chase-survived');
  expect(ends[0] - starts[0]).toBeCloseTo(15, 1); expect(ends[1] - starts[1]).toBeCloseTo(30, 1);
});

test('hotkey chase resets the auto timer', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); run(w, sprint, 10); triggerChase(w);
  expect(w.chase.nextAt).toBeCloseTo(70, 1);
});

test('chase event halves obstacle density', () => {
  const w = createWorld(config, 1); startRun(w); run(w, sprint, 5);
  triggerChase(w); run(w, sprint, 20);
  const zs = [...new Set(w.track.obstacles.filter((o) => o.z > w.player.distance + 20).map((o) => o.z))].sort((a, b) => a - b);
  expect(zs.length).toBeGreaterThan(1);
  for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThanOrEqual(2 * config.track.minRowSpacing);
});

test('triggerChase is a no-op outside running/idle', () => {
  const w = createWorld(config, 1);
  expect(triggerChase(w)).toBe(false); startRun(w); expect(triggerChase(w)).toBe(true); expect(triggerChase(w)).toBe(false);
  run(w, idle, 10); expect(w.phase).toBe('caught'); expect(triggerChase(w)).toBe(false);
});

test('startRun works from caught', () => {
  const w = createWorld(config, 1); startRun(w); run(w, idle, 5); expect(w.phase).toBe('caught');
  startRun(w);
  expect(w.phase).toBe('running'); expect(w.chaser.gap).toBe(20); expect(w.coins).toBe(0);
  expect(w.player.distance).toBe(0); expect(w.runTime).toBe(0); expect(w.chase.phase).toBe('idle');
  expect(w.track.obstacles.every((o) => !o.hit)).toBe(true);
});

test('config is read live', () => {
  const cfg = emptyCfg(); const w = createWorld(cfg, 1); startRun(w);
  cfg.chaser.speed = 10;
  const { t } = runUntil(w, idle, (e) => e.includes('caught'), 10);
  expect(t).toBeCloseTo(2, 1);
});

test('hit: stumble 1.5 s at 20% speed', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  w.track.obstacles.push(dog(5));
  runUntil(w, sprint, (e) => e.includes('hit'), 2);
  run(w, sprint, 1.4);
  expect(w.player.speedMps).toBeCloseTo(2.4, 5);
  run(w, sprint, 0.2);
  expect(w.player.speedMps).toBeCloseTo(12, 5);
});

const KIND_TYPE = { dog: 'jump', jar: 'jump', cart: 'block', tuktuk: 'block' };
let obsId = 100;
const obs = (kind, z, lane = 0) => ({ id: obsId++, kind, type: KIND_TYPE[kind], lane, z, hit: false });

test('hit raises hit then hit-<kind>', () => {
  for (const kind of ['dog', 'jar', 'cart', 'tuktuk']) {
    const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs(kind, 5));
    const { events } = runUntil(w, sprint, (e) => e.includes('hit'), 2);
    const i = events.indexOf('hit');
    expect(events[i + 1]).toBe('hit-' + kind);
    expect(w.lastHit.kind).toBe(kind);
  }
});

test('cart hit costs 10 coins', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.coins = 25; w.track.obstacles.push(obs('cart', 5));
  runUntil(w, sprint, (e) => e.includes('hit'), 2);
  expect(w.coins).toBe(15);
});

test('cart hit never goes below 0', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.coins = 4; w.track.obstacles.push(obs('cart', 5));
  runUntil(w, sprint, (e) => e.includes('hit'), 2);
  expect(w.coins).toBe(0);
});

test('tuk-tuk stuns 2 s', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs('tuktuk', 5));
  runUntil(w, sprint, (e) => e.includes('hit'), 2);
  expect(w.player.stumbleT).toBeCloseTo(2, 5);
  run(w, sprint, 1.9); expect(w.player.speedMps).toBeCloseTo(2.4, 5);
  run(w, sprint, 0.2); expect(w.player.speedMps).toBeCloseTo(12, 5);
});

test('second hit while stumbling keeps the longer stun', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  w.track.obstacles.push(obs('tuktuk', 5), obs('dog', 8));
  let maxT = 0, hits = 0;
  for (let t = 0; t < 4; t += DT) {
    hits += count(stepWorld(w, sprint, DT), 'hit');
    maxT = Math.max(maxT, w.player.stumbleT);
  }
  expect(hits).toBe(2); expect(maxT).toBeLessThanOrEqual(2 + 1e-9);
});

test('restart clears lastHit', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs('jar', 5));
  runUntil(w, sprint, (e) => e.includes('hit'), 2); startRun(w);
  expect(w.lastHit).toBeNull();
});

test('dog hit adds a heel dog for 10 s', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs('dog', 3));
  const first = runUntil(w, sprint, (e) => e.includes('hit'), 2);
  expect(count(first.events, 'heel-start')).toBe(1); expect(w.heelDogs.length).toBe(1);
  const mid = run(w, sprint, 9.9); expect(count(mid.events, 'heel-end')).toBe(0);
  const end = run(w, sprint, 0.2); expect(count(end.events, 'heel-end')).toBe(1);
  expect(w.heelDogs.length).toBe(0);
});

test('heel dog makes the boss 1 m/s faster', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs('dog', 3));
  runUntil(w, sprint, (e) => e.includes('hit'), 2);
  expect(w.chaser.speedMps).toBe(7);
  run(w, sprint, 10.1); expect(w.chaser.speedMps).toBe(6);
});

test('two heel dogs in a chase event: 10.4 m/s', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); run(w, sprint, 1);
  triggerChase(w); run(w, sprint, 3.1); expect(w.chase.phase).toBe('active');
  const d = w.player.distance;
  w.track.obstacles.push(obs('dog', d + 3), obs('dog', d + 8));
  run(w, sprint, 4);
  expect(w.heelDogs.length).toBe(2); expect(w.chaser.speedMps).toBeCloseTo(10.4, 5);
});

test('third dog refreshes the oldest', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  w.track.obstacles.push(obs('dog', 3), obs('dog', 8), obs('dog', 13));
  const { events } = run(w, sprint, 7);
  expect(count(events, 'heel-start')).toBe(3);
  expect(w.heelDogs.length).toBe(2);
  const [a, b] = w.heelDogs;
  expect(b.id).toBeLessThan(a.id); // the first dog moved to the end
  expect(b.t).toBeGreaterThan(a.t);
});

test('sprinter who hits a dog at the start is not caught', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs('dog', 2));
  let minGap = Infinity, caught = 0;
  for (let t = 0; t < 20; t += DT) {
    caught += count(stepWorld(w, sprint, DT), 'caught');
    minGap = Math.min(minGap, w.chaser.gap);
  }
  expect(caught).toBe(0); expect(minGap).toBeGreaterThan(12);
});

test('restart clears heel dogs', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obs('dog', 3));
  runUntil(w, sprint, (e) => e.includes('hit'), 2); startRun(w);
  expect(w.heelDogs).toEqual([]); expect(w.chaser.speedMps).toBe(6);
});

// --- near-miss + combo ---
const obsAt = (kind, z, lane = 0) => ({ id: z * 10 + lane + 5, kind, type: kind === 'dog' || kind === 'jar' ? 'jump' : 'block', lane, z, hit: false });

test('late lane dodge past an obstacle = near-miss with bonus coins', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obsAt('cart', 10));
  // full speed: the cart is ~0.8 s away; dodge right ~0.3 s before it
  const { events } = run(w, (t) => (t > 0.5 && t < 0.51 ? frame({ speed: 1, laneDelta: 1 }) : sprint), 1.5);
  expect(events).toContain('near-miss'); expect(events).not.toContain('hit');
  expect(w.coins).toBe(config.nearMiss.bonusCoins); expect(w.nearMisses).toBe(1); expect(w.combo).toBe(1);
});

test('early lane change is a clean pass, not a near-miss', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obsAt('cart', 30));
  const { events } = run(w, (t) => (t < 0.01 ? frame({ speed: 1, laneDelta: 1 }) : sprint), 3.5);
  expect(events).not.toContain('near-miss'); expect(w.combo).toBe(1); expect(w.coins).toBe(0);
});

test('late jump over a dog = near-miss', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); w.track.obstacles.push(obsAt('dog', 10));
  // jump when the dog is ~2.4 m away (0.2 s at 12 m/s)
  const { events } = run(w, (t) => (t > 0.63 && t < 0.64 ? frame({ speed: 1, jump: true }) : sprint), 1.5);
  expect(events).not.toContain('hit'); expect(events).toContain('near-miss');
});

test('combo counts rows, multiplies coins, breaks on a hit', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  for (let i = 0; i < 5; i++) w.track.obstacles.push(obsAt('cart', 10 + i * 10, 1)); // other lane: plain passes
  const { events } = run(w, sprint, 5);
  expect(w.combo).toBe(5); expect(count(events, 'combo-up')).toBe(1);
  w.track.coins.push({ id: 900, lane: 0, z: w.player.distance + 3, taken: false });
  run(w, sprint, 0.5);
  expect(w.coins).toBe(2); // x2
  w.track.obstacles.push(obsAt('cart', w.player.distance + 3, 0));
  const hit = run(w, sprint, 0.5);
  expect(hit.events).toContain('combo-break'); expect(w.combo).toBe(0); expect(w.bestCombo).toBe(5);
});

test('a row with one obstacle hit does not count for the combo', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w);
  w.track.obstacles.push(obsAt('cart', 10, 0), obsAt('cart', 10, 1));
  run(w, sprint, 2);
  expect(w.combo).toBe(0);
});

test('score = whole metres + coins, saved on caught', () => {
  const w = createWorld(emptyCfg(), 1); startRun(w); run(w, sprint, 1); w.coins = 7;
  runUntil(w, idle, (e) => e.includes('caught'), 20);
  expect(w.lastRun.score).toBe(Math.floor(w.lastRun.distance) + 7);
});
