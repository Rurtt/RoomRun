// WebAudio synth sounds. Every SoundName has one, so a missing or broken file
// still makes a noise; the growl and pack-chorus loops have synth versions too.

/** One enveloped oscillator: frequency slides from f0 to f1 over `dur`. */
function blip(ctx, out, { type = 'square', f0, f1 = f0, dur, vol = 0.2, at = 0 }) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Short filtered noise burst (footsteps, thuds). */
function noise(ctx, out, { dur, freq, vol = 0.3, at = 0 }) {
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = buf;
  f.type = 'lowpass';
  f.frequency.value = freq;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

/** A cartoon bark: two quick saw yaps falling in pitch. */
function bark(ctx, out, vol = 1, at = 0) {
  blip(ctx, out, { type: 'sawtooth', f0: 620, f1: 260, dur: 0.09, vol: 0.22 * vol, at });
  blip(ctx, out, { type: 'sawtooth', f0: 560, f1: 240, dur: 0.11, vol: 0.2 * vol, at: at + 0.14 });
  noise(ctx, out, { dur: 0.06, freq: 1800, vol: 0.15 * vol, at });
}

/** @type {Record<string, (ctx: AudioContext, out: AudioNode, opts?: { vol?: number, at?: number }) => void>} */
export const SYNTH = {
  step: (ctx, out) => noise(ctx, out, { dur: 0.08, freq: 900, vol: 0.35 }),
  coin: (ctx, out) => { blip(ctx, out, { f0: 988, dur: 0.07, vol: 0.12 }); blip(ctx, out, { f0: 1319, dur: 0.18, vol: 0.12, at: 0.07 }); },
  jump: (ctx, out) => blip(ctx, out, { type: 'triangle', f0: 300, f1: 700, dur: 0.18, vol: 0.25 }),
  land: (ctx, out) => noise(ctx, out, { dur: 0.12, freq: 400, vol: 0.4 }),
  crash: (ctx, out) => {
    noise(ctx, out, { dur: 0.45, freq: 900, vol: 0.8 });
    blip(ctx, out, { type: 'sawtooth', f0: 160, f1: 40, dur: 0.4, vol: 0.3 });
  },
  bark: (ctx, out, { vol = 1, at = 0 } = {}) => bark(ctx, out, vol, at),
  howl: (ctx, out) => {
    blip(ctx, out, { type: 'sawtooth', f0: 330, f1: 660, dur: 0.7, vol: 0.14 });
    blip(ctx, out, { type: 'sawtooth', f0: 660, f1: 420, dur: 1.1, vol: 0.14, at: 0.65 });
  },
  jar: (ctx, out) => {
    [2400, 1900, 2800].forEach((f, i) => blip(ctx, out, { type: 'triangle', f0: f, f1: f * 0.8, dur: 0.12, vol: 0.12, at: i * 0.03 }));
    noise(ctx, out, { dur: 0.5, freq: 1400, vol: 0.5, at: 0.02 }); // splash
  },
  meatball: (ctx, out) => {
    for (let i = 0; i < 6; i++) blip(ctx, out, { type: 'sine', f0: 500 + Math.random() * 400, f1: 200, dur: 0.05, vol: 0.2, at: i * 0.06 + Math.random() * 0.03 });
  },
  horn: (ctx, out) => {
    for (const at of [0, 0.22]) { blip(ctx, out, { type: 'square', f0: 420, dur: 0.16, vol: 0.12, at }); blip(ctx, out, { type: 'square', f0: 530, dur: 0.16, vol: 0.08, at }); }
  },
  yell: (ctx, out) => blip(ctx, out, { type: 'sawtooth', f0: 320, f1: 210, dur: 0.35, vol: 0.18, at: 0.1 }),
  caught: (ctx, out) => {
    bark(ctx, out, 1.2);
    [523, 440, 349, 262].forEach((f, i) => blip(ctx, out, { f0: f, dur: 0.22, vol: 0.16, at: 0.3 + i * 0.16 }));
  },
  // synth-only (no file): near-miss swish, combo multiplier going up
  whoosh: (ctx, out) => { noise(ctx, out, { dur: 0.22, freq: 2600, vol: 0.45 }); blip(ctx, out, { type: 'triangle', f0: 900, f1: 1800, dur: 0.16, vol: 0.12 }); },
  chime: (ctx, out) => [784, 988, 1175, 1568].forEach((f, i) => blip(ctx, out, { type: 'triangle', f0: f, dur: 0.14, vol: 0.14, at: i * 0.05 })),
  escape: (ctx, out) => [523, 659, 784, 1047].forEach((f, i) => blip(ctx, out, { f0: f, dur: 0.2, vol: 0.16, at: i * 0.1 })),
};

/**
 * Low growl: a rough saw at ~70 Hz through a lowpass, with a slow irregular
 * swell. Silent until setLevel raises it (danger meter fill).
 * @param {AudioContext} ctx @param {AudioNode} out
 */
export function createGrowlLoop(ctx, out) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(out);
  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.value = 70;
  const rumble = ctx.createOscillator(); // throat flutter
  rumble.frequency.value = 23;
  const rumbleAmt = ctx.createGain();
  rumbleAmt.gain.value = 0.35;
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0.6;
  rumble.connect(rumbleAmt).connect(voiceGain.gain);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  voice.connect(lp).connect(voiceGain).connect(master);
  for (const n of [voice, rumble]) n.start();
  return {
    /** @param {number} level 0..1 */
    setLevel(level) {
      const k = Math.max(0, Math.min(1, level));
      master.gain.setTargetAtTime(0.25 * k ** 2, ctx.currentTime, 0.15);
      voice.frequency.setTargetAtTime(65 + 25 * k, ctx.currentTime, 0.3);
    },
  };
}

/**
 * Barking chorus for the chase event: random synth barks from a few "dogs"
 * while the level is up.
 * @param {AudioContext} ctx @param {AudioNode} out
 */
export function createPackLoop(ctx, out) {
  let level = 0;
  setInterval(() => {
    if (level <= 0) return;
    for (let i = 0; i < 2; i++) if (Math.random() < 0.6) bark(ctx, out, 0.5 * level * (0.6 + Math.random() * 0.4), Math.random() * 0.35);
  }, 400);
  return { setLevel(l) { level = l; } };
}
