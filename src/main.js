import '@fontsource/kanit/400.css';
import '@fontsource/kanit/600.css';
import '@fontsource/kanit/800.css';
import config from './config.js';
import { createFixedLoop } from './loop.js';
import { createCadence } from './input/cadence.js';
import { createInputHub } from './input/hub.js';
import { createKeyboardSource } from './input/keyboard.js';
import { createMotionDetector } from './input/motion.js';
import { createPhoneSource } from './input/phoneSource.js';
import { createGameHaptics } from './input/haptics.js';
import { createBluetoothSource } from './input/bluetoothSource.js';
import { createBluetoothPanel } from './hud/bluetoothPanel.js';
import { createSettingsStore, applyMotionSettings } from './settings.js';
import { createSettingsPanel } from './hud/settingsPanel.js';
import { wsUrl } from './phone/protocol.js';
import { createWorld, startRun, stepWorld, triggerChase } from './sim/world.js';
import { createRenderer } from './render/renderer.js';
import { createEnvironment } from './render/environment.js';
import { createActors } from './render/actors.js';
import { createPeople } from './render/people.js';
import { createCameraRig } from './render/cameraRig.js';
import { createEffects } from './render/effects.js';
import { slowMoTarget, createHitStop } from './render/timeScale.js';
import { createHud } from './hud/hud.js';
import { meterFill } from './hud/format.js';
import { createAudio, soundsForEvent } from './audio/audio.js';
import { hotkeyAction } from './debug/hotkeys.js';
import { createDebugPanel } from './debug/panel.js';
import { gameFlow, audioLevels, watchSticks } from './gameFlow.js';
import { createLeaderboard, AVATARS } from './leaderboard.js';

const preferences = createSettingsStore();
applyMotionSettings(config, preferences.get());
document.title = config.title;

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const view = createRenderer(canvas);
view.setQuality(preferences.get().graphics);
const environment = createEnvironment(view.scene);
const actors = createActors(view.scene);
const people = createPeople(view.scene);
const rig = createCameraRig(view.camera);
const overlay = document.createElement('div');
document.body.append(overlay);
const effects = createEffects(view.scene, overlay);
const hudRoot = document.createElement('div');
document.body.append(hudRoot);
const hud = createHud(hudRoot, config, { onPick: (i) => signRun(i) });
// Booth top 5 (localStorage). After a catch that makes the board, the player
// picks an avatar: tap a tile, or big button = move, small button = OK.
const board = createLeaderboard();
const pick = { picking: false, sel: 0, rank: -1, caughtAt: 0 };
/** The caught screen fades in after the cutscene: no signing before the player can see the picker. */
const PICK_DELAY_MS = 1800;
function signRun(avatar) {
  if (!pick.picking || world.phase !== 'caught' || !world.lastRun) return;
  if (performance.now() - pick.caughtAt < PICK_DELAY_MS) return;
  const r = world.lastRun;
  pick.rank = board.add({ avatar, score: r.score, distance: Math.floor(r.distance), coins: r.coins, at: Date.now() });
  pick.picking = false;
  audio.play('escape');
}
const audio = createAudio();
audio.setVolumes(preferences.get());
const hitStop = createHitStop(config);
// iOS accepts completed taps/clicks. Keep retrying after interruptions rather
// than consuming the only unlock attempt on an early pointerdown.
for (const type of ['keydown', 'touchend', 'click']) window.addEventListener(type, () => { void audio.unlock(); }, { passive: true });

const hub = createInputHub();
const keyboard = createKeyboardSource({ cadence: createCadence() });
keyboard.attach(window);
hub.add(keyboard);
// phones through the relay (`npm run phone`); quietly retries while it isn't running
const motion = createMotionDetector();
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || /^192\.168\.|^10\./.test(location.hostname);
const bluetoothOnly = !localHost && !new URLSearchParams(location.search).has('wifi');
const phone = createPhoneSource({ url: bluetoothOnly ? undefined : wsUrl(location), detector: motion });
hub.add(phone);
let bluetoothPanel = null;
let gameSettings = null;
/** @type {'start'|null} small button press, used by the next sim step */
let pendingAction = null;
const bluetooth = createBluetoothSource({
  receive: (message, time) => { if (message.t === 'small') pendingAction = 'start'; else phone.handleMessage(message, time); },
  onChange: (state) => bluetoothPanel?.update(state),
});
const haptics = createGameHaptics((pattern) => {
  if (pattern !== 'stop' && !preferences.get().vibration) return false;
  const direct = bluetooth.sendHaptic(pattern);
  const wifi = phone.sendHaptic(pattern);
  return direct || wifi;
});
window.addEventListener('pagehide', () => {
  bluetooth.sendHaptic('stop');
  phone.sendHaptic('stop');
  bluetooth.disconnect('L');
  bluetooth.disconnect('R');
});

const world = createWorld(config);
/** Player state before the latest step, for smooth rendering between steps. */
const prev = { distance: 0, x: 0, y: 0 };
const interp = { z: 0, x: 0, y: 0 };
const extra = { phoneLost: false, tunnelUrl: /** @type {string|null} */ (null), pace: null,
  /** Bluetooth sticks connected now */ sticksIn: 0,
  /** hands whose stick dropped mid-run (game paused), or null */ reconnecting: /** @type {string[]|null} */ (null),
  /** @type {import('./hud/hud.js').BoardView|undefined} */ board: undefined };
/** Sticks the current run depends on; see watchSticks. */
let stickWatch = { expected: new Set(), lost: /** @type {string[]} */ ([]) };
let lastRetry = 0;
function restart() { startRun(world); prev.distance = 0; emit(['run-start']); }
/** A dropped stick usually comes back by itself: retry the known device, no picker needed. */
function retryLost(now) {
  if (now - lastRetry < 2000) return;
  lastRetry = now;
  const snap = bluetooth.snapshot();
  for (const hand of stickWatch.lost) if (!snap[hand].connecting) void bluetooth.reconnect(hand);
}
bluetoothPanel = createBluetoothPanel(bluetooth, { onSettings() { gameSettings.open(); }, onViewChange(mode) { hud.setDeviceView(mode); }, onSoundTest() {
  return audio.unlock().then(ready => { if (ready) audio.play('coin'); return ready; });
}, onRestart() {
  void audio.unlock();
  restart();
} });
if (location.protocol === 'https:') bluetoothPanel.setMobileUrl(new URL('./', location.href).href);
bluetoothPanel.setRunMode(preferences.get().runMode);
gameSettings = createSettingsPanel({ store: preferences, motion,
  onOpen() { bluetooth.sendHaptic('stop'); phone.sendHaptic('stop'); audio.setDanger(0); },
  onClose() { phone.reset(); keyboard.reset(); pendingAction = null; },
});
preferences.subscribe((next, previous) => {
  applyMotionSettings(config, next);
  bluetoothPanel.setRunMode(next.runMode);
  audio.setVolumes(next);
  if (next.graphics !== previous.graphics) view.setQuality(next.graphics);
  if (next.sensitivity !== previous.sensitivity || next.exerciseSensitivity !== previous.exerciseSensitivity || next.runMode !== previous.runMode) motion.reset();
  if (!next.vibration && previous.vibration) { bluetooth.sendHaptic('stop'); phone.sendHaptic('stop'); }
});

function emit(events) {
  haptics.onEvents(events);
  for (const e of events) {
    if (e === 'caught') Object.assign(pick, { picking: !!world.lastRun && board.qualifies(world.lastRun.score), sel: 0, rank: -1, caughtAt: performance.now() });
    else if (e === 'run-start') Object.assign(pick, { picking: false, rank: -1 });
    if (e === 'hit') hitStop.trigger();
    else if (e === 'caught' || e === 'run-start') hitStop.reset();
    actors.onEvent(e);
    people.onEvent(e);
    rig.onEvent(e);
    effects.onEvent(e);
    hud.onEvent(e);
    for (const sound of soundsForEvent(e)) audio.play(sound);
    if (e === 'chase-warning') audio.warn(config.chase.warningTime);
  }
}

function step(dt) {
  const p = world.player;
  prev.distance = p.distance; prev.x = p.x; prev.y = p.y;
  const now = performance.now();
  stickWatch = watchSticks(stickWatch.expected, bluetooth.snapshot(), world.phase);
  // while the avatar picker is open the small button signs the run instead of restarting
  if (pendingAction === 'start' && pick.picking && world.phase === 'caught') { pendingAction = null; signRun(pick.sel); }
  const flow = gameFlow({ phase: world.phase, action: pendingAction, sticksLost: stickWatch.lost.length > 0 });
  pendingAction = null;
  if (flow.start) restart();
  if (flow.paused) {
    if (!extra.reconnecting) { bluetooth.sendHaptic('stop'); phone.sendHaptic('stop'); }
    extra.reconnecting = stickWatch.lost;
    retryLost(now);
    hub.read(now); // drain: a jump/lane queued while the stick dropped must not fire on resume
    return;
  }
  extra.reconnecting = null;
  const input = hub.read(now);
  if (pick.picking && world.phase === 'caught' && input.laneDelta) pick.sel = (pick.sel + input.laneDelta + AVATARS.length) % AVATARS.length;
  actors.onSteps(input.steps);
  rig.onSteps(input.steps);
  for (let i = 0; i < Math.min(input.steps, 2); i++) audio.play('step');
  emit(stepWorld(world, input, dt));
}

/** Dev only: Playwright checks freeze the live loop while they drive soip.simulate(). */
let devPaused = false;
/** Render seconds since the last frame, already time-scaled (slow-mo). */
let renderDt = 0;
function render(alpha) {
  const p = world.player;
  // a restart jumps distance back to 0: don't smear across it
  const fresh = Math.abs(p.distance - prev.distance) > 5;
  const lerp = (a, b) => (fresh ? b : a + (b - a) * alpha);
  interp.z = lerp(prev.distance, p.distance);
  interp.x = lerp(prev.x, p.x);
  interp.y = lerp(prev.y, p.y);
  environment.update(interp.z);
  people.sync(environment.peopleSpots(), { x: interp.x, z: -interp.z }, world.phase, renderDt);
  actors.sync(world, alpha, interp, renderDt);
  rig.update(world, renderDt, interp);
  effects.update(world, renderDt, interp);
  extra.phoneLost = phone.everConnected && !phone.connected(performance.now());
  extra.pace = phone.everConnected && config.motion.runMode === 'exercise' ? motion.exerciseStatus(performance.now()) : null;
  const snap = bluetooth.snapshot();
  extra.sticksIn = (snap.L.connected ? 1 : 0) + (snap.R.connected ? 1 : 0);
  extra.board = { list: board.list, rank: pick.rank, picking: pick.picking, sel: pick.sel };
  hud.update(world, extra);
  const running = world.phase === 'running';
  const levels = audioLevels({ running, paused: !!extra.reconnecting, fill: meterFill(world.chaser.gap, config.chaser), chaseActive: world.chase.phase === 'active' });
  audio.setDanger(levels.danger);
  audio.setChase(levels.chase);
  view.render();
}

let timeScale = 1;

/** Live numbers for the debug panel. */
const stats = { fps: 0, rttMs: phone.rtt, upPeaks: motion.upPeaks };
const panel = createDebugPanel(config, stats);

window.addEventListener('keydown', (e) => {
  if (gameSettings.isOpen) return;
  if (e.repeat || /** @type {any} */ (e.target)?.tagName === 'INPUT') return; // typing in the panel
  if (pick.picking && e.code === 'Enter') { signRun(pick.sel); return; }
  if (e.code === 'KeyL' && e.shiftKey) { board.clear(); pick.rank = -1; return; } // operator: wipe the booth board
  const action = hotkeyAction(e.code);
  // keyboard = operator: play on even with a dead stick
  if (action === 'restart') { stickWatch = { expected: new Set(), lost: [] }; restart(); }
  else if (action === 'chase') triggerChase(world); // no-op unless a run is going
  else if (action === 'panel') panel.toggle();
  else if (action === 'hud') hudRoot.hidden = !hudRoot.hidden; // clean shots for video
});

// Tunnel URL for the title-screen QR. Only exists while `npm run phone` runs;
// poll until it shows up (cloudflared takes a few seconds).
async function pollTunnelUrl() {
  try {
    const res = await fetch('/tunnel-url', { cache: 'no-store' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      extra.tunnelUrl = (await res.json()).url ?? null;
      if (extra.tunnelUrl) bluetoothPanel.setMobileUrl(extra.tunnelUrl + '/');
    }
  } catch { /* relay not running: keyboard only */ }
  if (!extra.tunnelUrl) setTimeout(pollTunnelUrl, 2000);
}
if (!bluetoothOnly) pollTunnelUrl();

const loop = createFixedLoop({ step, render, stepDt: config.loop.stepDt, maxFrameDt: config.loop.maxFrameDt });

let last = performance.now();
function tick(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (dt > 0) stats.fps += (1 / dt - stats.fps) * 0.05;
  panel.update();
  timeScale += (slowMoTarget(world) - timeScale) * Math.min(1, Math.max(0, dt) * 12);
  const scaled = Math.min(dt, config.loop.maxFrameDt) * timeScale * hitStop.factor(Math.max(0, dt));
  renderDt = scaled;
  if (!devPaused && !gameSettings.isOpen) loop.frame(scaled);
  else if (gameSettings.isOpen) view.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Dev-only handle for browser checks (Playwright) and console poking.
if (import.meta.env.DEV) {
  window.soip = {
    world, view, environment, actors, hud, audio, panel, stats, hub, phone, keyboard, config, startRun, triggerChase, board, pick,
    pause(on = true) { devPaused = on; },
    /** Step the sim `seconds` with a fixed input (lane/jump fire once), then draw one frame. */
    simulate(seconds, f = {}) {
      const frame = { speed: 0, laneDelta: 0, jump: false, steps: 0, ...f };
      for (let t = 0; t < seconds; t += config.loop.stepDt) {
        const p = world.player;
        prev.distance = p.distance; prev.x = p.x; prev.y = p.y;
        emit(stepWorld(world, frame, config.loop.stepDt));
        frame.laneDelta = 0; frame.jump = false;
      }
      renderDt = 1 / 60;
      render(1);
    },
  };
}
