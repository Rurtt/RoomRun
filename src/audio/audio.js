// Sound: CC0 files from public/audio (see CREDITS.md), synth fallback for any
// file that fails to load. The AudioContext is made on the first tap/key press
// (browser autoplay rule); files are fetched right away so they're ready.
import config from '../config.js';
import { SYNTH, createGrowlLoop, createPackLoop } from './synth.js';

/** @typedef {'step'|'coin'|'jump'|'land'|'crash'|'bark'|'howl'|'jar'|'meatball'|'horn'|'yell'|'caught'|'escape'} SoundName */

/** @type {SoundName[]} */
export const SOUND_NAMES = ['step', 'coin', 'jump', 'land', 'crash', 'bark', 'howl', 'jar', 'meatball', 'horn', 'yell', 'caught', 'escape'];

/** Files per sound (variants picked at random), plus the growl and pack-chorus loops and music. */
export const FILES = {
  step: ['step', 'step2', 'step3', 'step4'],
  coin: ['coin'], jump: ['jump'], land: ['land'],
  crash: ['crash'], bark: ['bark', 'bark2', 'bark3'], howl: ['howl'],
  jar: ['jar'], meatball: ['meatball'], horn: ['horn'], yell: ['yell'],
  caught: ['caught'], escape: ['escape'],
  growl: ['growl'], pack: ['pack'],
  music: ['music'], music_chase: ['music_chase'],
};

/** @type {Record<string, (SoundName|'whoosh'|'chime')[]>} */
const EVENT_SOUNDS = {
  coin: ['coin'], jump: ['jump'], land: ['land'],
  hit: ['crash', 'bark'], // every hit: crash, and the boss barks as it peeks
  'hit-jar': ['jar'], 'hit-cart': ['meatball', 'yell'], 'hit-tuktuk': ['horn'],
  'heel-start': ['bark'], 'chaser-near': ['bark'], 'run-start': ['bark'],
  'chase-start': ['howl'], 'near-miss': ['whoosh', 'coin'], 'combo-up': ['chime'], // whoosh/chime: synth only, no file
  'chase-survived': ['escape'], caught: ['caught'],
};

/** @param {string} event @returns {SoundName[]} */
export function soundsForEvent(event) {
  return EVENT_SOUNDS[event] ?? [];
}

const VOLUME = { step: 0.5, coin: 0.45, jump: 0.5, land: 0.45, crash: 0.85, bark: 0.7, howl: 0.8, jar: 0.75, meatball: 0.6,
                 horn: 0.7, yell: 0.8, caught: 0.75, escape: 0.7 };
const GROWL_MAX = 0.6, PACK_MAX = 0.5;
const MUSIC_VOLUME = 0.32;
const CROSSFADE = 0.6; // seconds

export function createAudio(cfg = config) {
  /** @type {Record<string, Promise<ArrayBuffer|null>>} raw bytes, fetched before unlock */
  const raw = {};
  let formats = ['ogg', 'mp3'];
  try {
    if (globalThis.Audio && !new globalThis.Audio().canPlayType('audio/ogg; codecs="vorbis"')) formats = ['mp3', 'ogg'];
  } catch { /* decoding below still tries both formats */ }
  function load(file, format) {
    const key = `${file}.${format}`;
    return raw[key] ??= fetch(`${import.meta.env?.BASE_URL ?? '/'}audio/${key}`)
      .then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('html') ? r.arrayBuffer() : null))
      .catch(() => null);
  }
  for (const list of Object.values(FILES)) {
    for (const file of list) {
      void load(file, formats[0]);
    }
  }

  /** @type {AudioContext|null} */
  let ctx = null;
  /** @type {GainNode} */ let sfx;
  /** @type {Record<string, AudioBuffer[]>} */
  const buffers = {};
  /** @type {{ setLevel(level: number): void } | null} */
  let growlLoop = null;
  /** @type {{ setLevel(level: number): void } | null} */
  let packLoop = null;
  let musicGain = null, chaseGain = null;
  let chaseOn = false;
  let initializing = null;
  let musicVolume = MUSIC_VOLUME, effectsVolume = 1;

  async function decode(file) {
    for (const format of formats) {
      const bytes = await load(file, format);
      if (!bytes) continue;
      try { return await ctx.decodeAudioData(bytes.slice(0)); } catch { /* next format, then synth */ }
    }
    return null;
  }

  /** A looping file at a volume that follows setLevel, or null if the file is missing. */
  async function fileLoop(name, max) {
    const buf = await decode(FILES[name][0]);
    if (!buf) return null;
    const g = ctx.createGain();
    g.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g).connect(sfx);
    src.start();
    return { setLevel(level) { g.gain.setTargetAtTime(max * Math.max(0, Math.min(1, level)) ** 2, ctx.currentTime, 0.15); } };
  }

  async function startMusic() {
    const [a, b] = await Promise.all([decode('music'), decode('music_chase')]);
    if (!a) return; // no music file: play on without music
    musicGain = ctx.createGain();
    chaseGain = ctx.createGain();
    musicGain.gain.value = chaseOn && b ? 0 : musicVolume;
    chaseGain.gain.value = chaseOn && b ? musicVolume : 0;
    // both layers run in lockstep (same length), so the crossfade lands on the beat
    const at = ctx.currentTime + 0.05;
    for (const [buf, g] of [[a, musicGain], [b, chaseGain]]) {
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g).connect(ctx.destination);
      src.start(at);
    }
    if (!b) chaseGain = null;
  }

  return {
    setVolumes({ music, effects }) {
      if (Number.isFinite(music)) musicVolume = MUSIC_VOLUME * Math.min(100, Math.max(0, music)) / 100;
      if (Number.isFinite(effects)) effectsVolume = Math.min(100, Math.max(0, effects)) / 100;
      if (!ctx) return;
      if (sfx) sfx.gain.setTargetAtTime(effectsVolume, ctx.currentTime, 0.02);
      for (const [gain, value] of [[musicGain, chaseOn && chaseGain ? 0 : musicVolume], [chaseGain, chaseOn ? musicVolume : 0]]) {
        if (!gain) continue;
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setTargetAtTime(value, ctx.currentTime, 0.02);
      }
    },
    /** Create the AudioContext and start music + growl and pack loops. Safe to call often. */
    unlock() {
      let resumed;
      try {
        if (!ctx) {
          const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!Audio) return Promise.resolve(false);
          ctx = new Audio();
          // Set up the output synchronously so early game events have a destination.
          sfx = ctx.createGain();
          sfx.gain.value = effectsVolume;
          sfx.connect(ctx.destination);
        }
        // Call resume inside each real tap/click, including after iOS interrupts
        // playback. Do not cache this promise: a rejected/pending first attempt
        // must not prevent the next user gesture from trying again.
        resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
      } catch { return Promise.resolve(false); }
      if (!initializing) initializing = (async () => {
        growlLoop = (await fileLoop('growl', GROWL_MAX)) ?? createGrowlLoop(ctx, sfx);
        packLoop = (await fileLoop('pack', PACK_MAX)) ?? createPackLoop(ctx, sfx);
        packLoop.setLevel(chaseOn ? 1 : 0);
        await Promise.all(SOUND_NAMES.filter((n) => FILES[n]).map(async (n) => {
          buffers[n] = (await Promise.all(FILES[n].map(decode))).filter(Boolean);
        }));
        await startMusic();
      })().catch(() => { initializing = null; });
      return Promise.resolve(resumed).then(() => ctx.state === 'running').catch(() => false);
    },

    /** @param {SoundName} name @param {number} [vol] 0..1 on top of the sound's own volume @param {number} [at] seconds from now */
    play(name, vol = 1, at = 0) {
      if (!ctx || ctx.state !== 'running') return;
      const list = buffers[name];
      if (!list?.length) {
        SYNTH[name]?.(ctx, sfx, { vol, at });
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = list[Math.floor(Math.random() * list.length)];
      if (name === 'step') src.playbackRate.value = 0.92 + Math.random() * 0.16;
      const g = ctx.createGain();
      g.gain.value = (VOLUME[name] ?? 0.5) * vol;
      src.connect(g).connect(sfx);
      src.start(ctx.currentTime + at);
    },

    /** Chase warning: the pack barking in the distance, getting closer. @param {number} seconds */
    warn(seconds) {
      [0.3, 0.6, 1].forEach((v, i) => this.play('bark', v, (i * seconds) / 3));
    },

    /** For the debug panel: context state, which sounds have files, music running. */
    status() {
      return {
        state: ctx?.state ?? 'locked',
        files: SOUND_NAMES.filter((n) => buffers[n]?.length),
        music: !!musicGain,
        chaseMusic: !!chaseGain,
      };
    },

    /** @param {number} level danger meter fill 0..1 */
    setDanger(level) {
      growlLoop?.setLevel(level);
    },

    /** @param {boolean} active chase event running */
    setChase(active) {
      if (active === chaseOn) return;
      chaseOn = active;
      packLoop?.setLevel(active ? 1 : 0);
      if (!ctx || !musicGain || !chaseGain) return;
      const t = ctx.currentTime;
      for (const [g, v] of [[musicGain, active ? 0 : musicVolume], [chaseGain, active ? musicVolume : 0]]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(v, t + CROSSFADE);
      }
    },
  };
}
