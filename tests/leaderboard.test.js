import { test, expect } from 'vitest';
import { AVATARS, SIZE, clean, qualifies, insert, rival, createLeaderboard } from '../src/leaderboard.js';

const e = (score, at = score, avatar = 0) => ({ avatar, score, at });
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('clean sorts best first, keeps 5, drops junk', () => {
  const list = clean([e(10), e(50), null, { score: 'x' }, e(30), e(20), e(40), e(60), { ...e(99), avatar: AVATARS.length }]);
  expect(list.map((x) => x.score)).toEqual([60, 50, 40, 30, 20]);
  expect(clean('nope')).toEqual([]);
});

test('qualifies: any score > 0 while the board has room, then must beat 5th', () => {
  expect(qualifies([], 1)).toBe(true); expect(qualifies([], 0)).toBe(false);
  const full = [e(50), e(40), e(30), e(20), e(10)];
  expect(qualifies(full, 10)).toBe(false); expect(qualifies(full, 11)).toBe(true);
});

test('insert returns the rank; earlier run keeps a tie', () => {
  const r = insert([e(50, 1), e(30, 2)], e(30, 3));
  expect(r.rank).toBe(2); expect(r.list.length).toBe(3);
  expect(insert([e(50), e(40), e(30), e(20), e(10)], e(5)).rank).toBe(-1);
});

test('board survives a reload through storage; clear empties it', () => {
  const s = memory();
  const a = createLeaderboard(s);
  for (let i = 1; i <= SIZE + 2; i++) a.add(e(i * 10));
  expect(createLeaderboard(s).list.map((x) => x.score)).toEqual([70, 60, 50, 40, 30]);
  a.clear(); expect(createLeaderboard(s).list).toEqual([]);
});

test('broken storage still gives a working board', () => {
  const bad = { getItem: () => '{oops', setItem: () => { throw new Error('quota'); } };
  const b = createLeaderboard(bad);
  expect(b.add(e(5))).toBe(0); expect(b.list.length).toBe(1);
});

test('rival: missed board = 5th place; lead 0 on a tie', () => {
  const full = [e(500), e(400), e(300), e(200, 1, 5), e(100, 2, 5)];
  expect(rival(full, 77, -1)).toEqual({ avatar: 5, lead: 23, close: false });
  expect(rival(full, 100, -1)).toEqual({ avatar: 5, lead: 0, close: true });
});

test('rival: on the board = the entry one rank up; #1, empty board, score 0 = none', () => {
  const list = [e(500, 1, 0), e(400, 2, 3), e(380, 3, 1)];
  expect(rival(list, 380, 2)).toEqual({ avatar: 3, lead: 20, close: true });
  expect(rival(list, 300, 2)).toEqual({ avatar: 3, lead: 100, close: false });
  expect(rival(list, 500, 0)).toBe(null);
  expect(rival([], 50, -1)).toBe(null);
  expect(rival(list, 0, -1)).toBe(null);
});

test('rival: close = lead within 10% of the rival score', () => {
  expect(rival([e(1000)], 900, -1).close).toBe(true);
  expect(rival([e(1000)], 899, -1).close).toBe(false);
});
