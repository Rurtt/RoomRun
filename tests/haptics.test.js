import { test, expect } from 'vitest';
import config from '../src/config.js';
import { createWorld, startRun, stepWorld, triggerChase } from '../src/sim/world.js';
import { createGameHaptics, feedbackForEvents } from '../src/input/haptics.js';

test('only actual collision, capture and pack start events request feedback', () => {
  expect(feedbackForEvents(['hit', 'hit-cart'])).toBe('hit');
  expect(feedbackForEvents(['caught'])).toBe('caught');
  expect(feedbackForEvents(['chase-start'])).toBe('pack');
  expect(feedbackForEvents(['coin', 'jump', 'land', 'chase-warning'])).toBe(null);
  expect(feedbackForEvents(['hit', 'chase-start', 'caught'])).toBe('caught');
  expect(feedbackForEvents(['near-miss'])).toBe('near');
});

test('near-miss sends the short hit pulse (no own motor code yet)', () => {
  const sent = [];
  const feedback = createGameHaptics(p => { sent.push(p); return true; }, () => 0);
  expect(feedback.onEvents(['near-miss'])).toBe(true);
  expect(sent).toEqual(['hit']);
});

test('duplicate hits cannot extend a pulse, and capture preempts a hit', () => {
  let now = 0;
  const sent = [];
  const feedback = createGameHaptics(p => { sent.push(p); return true; }, () => now);
  expect(feedback.onEvents(['hit'])).toBe(true);
  now = 50;
  expect(feedback.onEvents(['hit'])).toBe(false);
  expect(feedback.onEvents(['caught'])).toBe(true);
  now = 300;
  expect(feedback.onEvents(['hit'])).toBe(false);
  now = 650;
  expect(feedback.onEvents(['hit'])).toBe(true);
  expect(sent).toEqual(['hit', 'caught', 'hit']);
});

test('offline feedback is dropped and does not block new feedback after reconnect', () => {
  let live = false;
  const sent = [];
  const feedback = createGameHaptics(p => { if (!live) return false; sent.push(p); return true; }, () => 0);
  expect(feedback.onEvents(['caught'])).toBe(false);
  live = true;
  expect(feedback.onEvents(['hit'])).toBe(true);
  expect(sent).toEqual(['hit']);
});

test('restart cancels feedback and releases the previous priority', () => {
  const sent = [];
  const feedback = createGameHaptics(p => { sent.push(p); return true; }, () => 0);
  feedback.onEvents(['caught']);
  feedback.onEvents(['run-start']);
  expect(feedback.onEvents(['hit'])).toBe(true);
  expect(sent).toEqual(['caught', 'stop', 'hit']);
});

test('real simulation emits the events used by all three feedback patterns', () => {
  const cfg = structuredClone(config);
  cfg.track.startClear = 1e9;
  const w = createWorld(cfg, 1);
  startRun(w);
  w.track.obstacles.push({ id: 1, kind: 'cart', type: 'lane', lane: 0, z: 0, hit: false });
  const idle = { speed: 0, laneDelta: 0, jump: false, steps: 0 };
  expect(feedbackForEvents(stepWorld(w, idle, 1 / 120))).toBe('hit');
  w.chaser.gap = 0;
  expect(feedbackForEvents(stepWorld(w, idle, 1 / 120))).toBe('caught');
  startRun(w);
  expect(triggerChase(w)).toBe(true);
  stepWorld(w, { ...idle, speed: 1 }, 1 / 120);
  w.chase.t = 0;
  expect(feedbackForEvents(stepWorld(w, { ...idle, speed: 1 }, 1 / 120))).toBe('pack');
});

