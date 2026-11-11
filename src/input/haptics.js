// Game events -> short, named feedback. No queued feedback after a disconnect.
// `send` names the stick's motor code; near-miss has no own code in the stick
// firmware yet, so it borrows the short hit pulse.
const FEEDBACK = {
  near: { duration: 120, priority: 0.5, send: 'hit' },
  hit: { duration: 120, priority: 1 },
  pack: { duration: 650, priority: 2 },
  caught: { duration: 600, priority: 3 },
};

export function feedbackForEvents(events) {
  if (events.includes('caught')) return 'caught';
  if (events.includes('chase-start')) return 'pack';
  if (events.includes('hit')) return 'hit';
  if (events.includes('near-miss')) return 'near';
  return null;
}

/** send(pattern) returns true only when the live socket accepted the command. */
export function createGameHaptics(send, clock = () => performance.now()) {
  let busyUntil = -Infinity;
  let priority = 0;
  return {
    onEvents(events) {
      if (events.includes('run-start')) {
        busyUntil = -Infinity;
        priority = 0;
        send('stop');
      }
      const pattern = feedbackForEvents(events);
      if (!pattern) return false;
      const next = FEEDBACK[pattern];
      const now = clock();
      // Do not restart a pulse every frame; stronger feedback can interrupt it.
      if (now < busyUntil && next.priority <= priority) return false;
      if (!send(next.send ?? pattern)) return false;
      busyUntil = now + next.duration;
      priority = next.priority;
      return true;
    },
  };
}

