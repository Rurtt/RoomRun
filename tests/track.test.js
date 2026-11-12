import { test, expect } from 'vitest';
import config from '../src/config.js';
import { createRng } from '../src/sim/rng.js';
import { createTrack, updateTrack } from '../src/sim/track.js';

const rows = (obstacles) => Object.values(Object.groupBy(obstacles, (o) => o.z));
/** Run the player forward to `toZ`, collecting everything ever spawned (by id). */
function collect(seed, runTime, toZ = 2000, density = 1) {
  const t = createTrack(config.track, createRng(seed));
  const obstacles = new Map(); const coins = new Map();
  for (let z = 0; z <= toZ; z += 10) {
    updateTrack(t, z, runTime, density);
    t.obstacles.forEach((o) => obstacles.set(o.id, o)); t.coins.forEach((c) => coins.set(c.id, c));
  }
  return { obstacles: [...obstacles.values()], coins: [...coins.values()] };
}

test('rng is deterministic and in [0,1)', () => {
  const a = createRng(7); const b = createRng(7);
  for (let i = 0; i < 1000; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  expect(createRng(8)()).not.toBe(createRng(7)());
});

test('every row leaves a free lane', () => {
  const { obstacles } = collect(1, 120);
  const all = rows(obstacles);
  expect(all.length).toBeGreaterThan(50);
  expect(all.some((r) => r.length === 2)).toBe(true); // doubles do appear after 60 s
  all.forEach((r) => expect(new Set(r.map((o) => o.lane)).size).toBe(r.length));
  all.forEach((r) => expect(r.length).toBeLessThan(3));
});

test('rows at least minRowSpacing apart', () => {
  const zs = [...new Set(collect(6, 120).obstacles.map((o) => o.z))].sort((a, b) => a - b);
  for (let i = 1; i < zs.length; i++) {
    expect(zs[i] - zs[i - 1]).toBeGreaterThanOrEqual(config.track.minRowSpacing);
    expect(zs[i] - zs[i - 1]).toBeLessThanOrEqual(config.track.maxRowSpacing);
  }
});

test('density 0.5 doubles row spacing', () => {
  const zs = [...new Set(collect(6, 120, 2000, 0.5).obstacles.map((o) => o.z))].sort((a, b) => a - b);
  for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThanOrEqual(2 * config.track.minRowSpacing);
});

test('single obstacle per row before 60 s', () => {
  const { obstacles } = collect(2, 10);
  rows(obstacles).forEach((r) => expect(r.length).toBe(1));
});

test('nothing before startClear', () => {
  const t = createTrack(config.track, createRng(3)); updateTrack(t, 0, 0);
  expect(t.obstacles.length).toBeGreaterThan(0);
  t.obstacles.forEach((o) => expect(o.z).toBeGreaterThanOrEqual(30));
});

test('despawns behind and spawns ahead', () => {
  const t = createTrack(config.track, createRng(4)); updateTrack(t, 500, 100);
  expect(t.obstacles.length).toBeGreaterThan(0);
  t.obstacles.forEach((o) => { expect(o.z).toBeGreaterThan(480); expect(o.z).toBeLessThanOrEqual(620 + 26); });
  t.coins.forEach((c) => expect(c.z).toBeGreaterThan(480));
});

test('same seed, same track', () => {
  const a = createTrack(config.track, createRng(5)); const b = createTrack(config.track, createRng(5));
  updateTrack(a, 0, 100); updateTrack(b, 0, 100);
  expect(a.obstacles).toEqual(b.obstacles); expect(a.coins).toEqual(b.coins);
});

test('obstacle kinds map to answer type', () => {
  const { obstacles } = collect(9, 120);
  const kinds = new Set(obstacles.map((o) => o.kind));
  expect(kinds).toEqual(new Set(['dog', 'jar', 'cart', 'tuktuk']));
  obstacles.forEach((o) => expect(o.type).toBe(o.kind === 'dog' || o.kind === 'jar' ? 'jump' : 'block'));
  obstacles.forEach((o) => { expect(o.hit).toBe(false); expect([-1, 0, 1]).toContain(o.lane); });
});

test('ids are unique incrementing integers', () => {
  const { obstacles, coins } = collect(10, 120);
  const ids = [...obstacles, ...coins].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  ids.forEach((id) => expect(Number.isInteger(id)).toBe(true));
});

test('coins never share a lane+z band with an obstacle', () => {
  const { obstacles, coins } = collect(11, 120);
  expect(coins.length).toBeGreaterThan(20);
  coins.forEach((c) => {
    expect(c.taken).toBe(false);
    obstacles.filter((o) => o.lane === c.lane)
      .forEach((o) => expect(Math.abs(o.z - c.z)).toBeGreaterThanOrEqual(config.track.hitHalfDepth));
  });
});

// --- brave line coins ---
const rowAt = (obstacles, z) => obstacles.filter((o) => o.z === z);
test('before braveFrom every coin row is in a free lane', () => {
  const { obstacles, coins } = collect(11, config.track.braveFrom - 1);
  expect(coins.length).toBeGreaterThan(20);
  coins.forEach((c) => {
    expect(c.brave).toBeUndefined();
    expect(rowAt(obstacles, c.rowZ).some((o) => o.lane === c.lane)).toBe(false);
  });
});

test('after braveFrom about braveChance of coin rows run in an obstacle lane', () => {
  const { obstacles, coins } = collect(12, 120, 4000);
  const brave = coins.filter((c) => c.brave);
  const share = brave.length / coins.length;
  expect(share).toBeGreaterThan(config.track.braveChance - 0.15);
  expect(share).toBeLessThan(config.track.braveChance + 0.15);
  brave.forEach((c) => expect(rowAt(obstacles, c.rowZ).some((o) => o.lane === c.lane)).toBe(true));
});

test('brave coins never sit on an obstacle, and jump rows carry on past it', () => {
  const { obstacles, coins } = collect(13, 120, 4000);
  coins.forEach((c) => obstacles.forEach((o) => {
    if (o.lane === c.lane) expect(Math.abs(o.z - c.z)).toBeGreaterThan(config.track.hitHalfDepth + config.track.coinPickupDepth);
  }));
  const past = coins.filter((c) => c.brave && obstacles.some((o) => o.lane === c.lane && o.type === 'jump' && c.z > o.z && c.z - o.z < 8));
  expect(past.length).toBeGreaterThan(10);
});

test('coins never stack: no two coins in one lane closer than coinSpacing', () => {
  const { coins } = collect(14, 120, 4000);
  const byLane = Object.values(Object.groupBy(coins, (c) => c.lane));
  byLane.forEach((l) => {
    const zs = l.map((c) => c.z).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThanOrEqual(config.track.coinSpacing - 1e-9);
  });
});
