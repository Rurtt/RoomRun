import { test, expect } from 'vitest';
import { soundsForEvent, SOUND_NAMES, FILES } from '../src/audio/audio.js';
import { SYNTH } from '../src/audio/synth.js';

test('soundsForEvent maps world events to dog-theme sounds', () => {
  const table = {
    coin: ['coin'], jump: ['jump'], land: ['land'], hit: ['crash', 'bark'], 'hit-jar': ['jar'],
    'hit-cart': ['meatball', 'yell'], 'hit-tuktuk': ['horn'], 'heel-start': ['bark'], 'chaser-near': ['bark'],
    'chase-start': ['howl'], 'near-miss': ['whoosh', 'coin'], 'combo-up': ['chime'], 'chase-survived': ['escape'], caught: ['caught'], 'run-start': ['bark'],
  };
  for (const [event, sounds] of Object.entries(table)) expect(soundsForEvent(event)).toEqual(sounds);
  expect(soundsForEvent('hit-dog')).toEqual([]); expect(soundsForEvent('lane')).toEqual([]);
  expect(soundsForEvent('nonsense')).toEqual([]);
});

test('every sound has a synth fallback, so the game never goes silent', () => {
  for (const name of [...SOUND_NAMES, 'whoosh', 'chime']) expect(typeof SYNTH[name]).toBe('function');
});

test('every sound, both loops and both music tracks have files; ghost-era sounds are gone', () => {
  for (const name of [...SOUND_NAMES, 'growl', 'pack', 'music', 'music_chase']) expect(FILES[name]?.length).toBeGreaterThan(0);
  expect(FILES.bark.length).toBe(3);
  expect(FILES.step.length).toBe(4); // footstep variants so a run doesn't machine-gun one sample
  for (const gone of ['ghost', 'hit', 'alarm']) { expect(FILES[gone]).toBeUndefined(); expect(SOUND_NAMES).not.toContain(gone); }
});
