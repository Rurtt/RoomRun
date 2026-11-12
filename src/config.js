// Every tunable number in the game. Modules read these on each use, so the
// debug panel (Backquote) can change them live.
export default {
  title: 'ระวังหมาดุ',
  loop: { stepDt: 1 / 120, maxFrameDt: 0.1 },
  cadence: { windowMs: 1500, stopAfterMs: 700, minRate: 1.0, fullRate: 4.0, smoothTau: 0.2 },
  player: { maxSpeed: 12, laneWidth: 2.5, laneChangeTime: 0.15, laneCooldown: 0, // keyboard: none; phones have motion.gestureCooldownMs
            jumpVelocity: 7, gravity: 20, stumbleTime: 1.5, stumbleFactor: 0.2,
            startSpeedThreshold: 0.2 },
  chaser: { speed: 6, startGap: 20, maxGap: 50, visibleGap: 5, meterRange: 30 }, // visibleGap 5: drawn 0.9..2.2 m behind, close to true
  // first pack ~20 s in and short (judges play ~1 min), later ones full length
  chase: { warningTime: 3, activeTime: 30, firstActiveTime: 15, speedMultiplier: 1.4, firstAt: 20, every: 60,
           rewardCoins: 50, rewardGap: 15, obstacleDensity: 0.5 },
  track: { spawnAhead: 120, despawnBehind: 20, startClear: 30, minRowSpacing: 14, maxRowSpacing: 26,
           singleOnlyUntil: 20, coinRowLength: 5, coinSpacing: 2, coinRowChance: 0.6,
           // brave line: from braveFrom s on, this share of coin rows runs up to (or over) an obstacle
           braveFrom: 20, braveChance: 0.5,
           hitHalfDepth: 0.8, laneHitHalfWidth: 1.0, jumpClearHeight: 0.6, coinPickupDepth: 1.0 },
  // Dog rework: hit-stop, boss peek after a hit, woken heel dogs, per-obstacle extras, chase pack
  effects: { hitStop: 0.08, peekTime: 1.5, heelTime: 10, heelSpeedBonus: 1, maxHeelDogs: 2,
             cartCoinLoss: 10, tuktukStun: 2, packIntroTime: 2, packSize: 3 },
  // Near-miss: leave an obstacle's lane (or take off over it) no more than slackMetres
  // before the latest moment that still clears it at the kid's current speed = เฉียด! + bonus coins.
  // Relative to the clearing point, so it means the same at a jog and a sprint. Rare on purpose.
  // Combo: rows passed without a hit; every comboStep rows the coin multiplier goes up by 1.
  nearMiss: { slackMetres: 1.5, bonusCoins: 5, comboStep: 5, maxMultiplier: 5 },
  // last ~0.6 s before a catch the game runs at slowMoScale (the grab reads on video)
  juice: { slowMoScale: 0.7, slowMoWindow: 0.6, slowMoMaxGap: 4 },
  // Phone/stick arm-swing detection, m/s^2 with gravity removed. Tuned from logs (scripts/replay.mjs).
  motion: {
    runMode: 'exercise',                  // all-direction effort + rhythm; allAxes remains a light-play/test option
    exerciseThreshold: 4.4, exerciseMinGapMs: 240, exerciseMaxGapMs: 1100, exerciseRhythmRatio: 2,
    exerciseCadence: { windowMs:2200, stopAfterMs:1100, minRate:0, fullRate:3.2, smoothTau:0.25, followPace:true },
    swingThreshold: 2.2, swingRefractoryMs: 160,
    axes: { vertical: 1, lateral: 0 },     // indexes into a = [x, y, z]
    lateralSign: { L: 1, R: -1 },          // phones held screens facing each other (mirrored grip)
    stepSign: 1,                           // 1/-1: only peaks where vertical has this sign; 0: any |a| peak (tried 2026-10-28, fewer steps)
    stepEvery: 2,                          // with stepSign 0: count every 2nd peak per hand (two peaks per arm cycle)
    bounceSteps: true,                     // steps from the body bounce (tilt-free, natural arm swing OK); false: old arm-swing steps
    bounceStepThreshold: 8, bounceStepRefractoryMs: 220, // 18:25 log: walking bounces 6-11, running 15-29 (6 let walking run at full speed); Oct 30 log: running bounces 6-14, 10 dropped half the footsteps
    // footsteps, not arm-swing peaks: 2026-10-28 logs ran in place at ~2.5-2.9 footsteps/s
    cadence: { windowMs: 1500, stopAfterMs: 700, minRate: 0.6, fullRate: 2.5, smoothTau: 0.2 },
    stepThreshold: 6, stepRefractoryMs: 180,
    jumpThreshold: 16, jumpWindowMs: 120,  // jump: both hands push up (along gravity) past this within this window
                                           // (2026-10-28 log: real jumps 19-48, accidental ones 12-15; 14-18 all give the same jumps)
    jumpOverBounce: 1.6, bounceDecay: 0.995, // per sample (~60 Hz): keeps ~90% across one step
    bounceCap: 20,                          // running bounce is 15-18; one bigger push (a jump) counts as 20 at most // running bounces both hands ~15-18 per step: a jump must beat 1.6x the recent bounce
    jumpCooldownMs: 700,                   // landing thump comes ~300-500 ms after takeoff: ignore it
    freefallThreshold: 4, freefallMs: 120, // backup jump: both hands read |ag| under this (airborne) for this long
    motionLanes: false,                    // lanes come from phone taps; arm-flick lanes wait for sensor fusion
    swipeThreshold: 12, swipeWindowMs: 150, gestureCooldownMs: 350,
    gestureHoldMs: 600, suppressStepsAfterGestureMs: 300,
  },
  phone: { disconnectAfterMs: 1000 },
};
