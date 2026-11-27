// Fixed-step playback scheduler. The browser owns timing; the engine only steps.
// advance(elapsedSeconds) runs as many 1/120 s steps as real time allows and keeps the
// remainder for the next frame. A frame never runs more than maxStepsPerFrame steps, so a
// background tab or a slow frame cannot trigger a catch-up spiral (time is dropped instead).

import { DT } from './contract.js';

export const MAX_STEPS_PER_FRAME = 30; // 0.25 s of simulated time

export function createPlayback(sim, { maxStepsPerFrame = MAX_STEPS_PER_FRAME } = {}) {
  let accumulator = 0;
  let latest = sim.snapshot();

  return {
    /** Returns { steps, snapshot }. Negative or non-finite elapsed values are treated as 0. */
    advance(elapsedSeconds) {
      const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
      accumulator += elapsed;
      let steps = 0;
      // The epsilon absorbs float error so 1/60 s reliably yields 2 steps.
      while (accumulator + 1e-9 >= DT && steps < maxStepsPerFrame) {
        latest = sim.step();
        accumulator -= DT;
        steps += 1;
      }
      if (steps === maxStepsPerFrame) accumulator = Math.min(accumulator, DT);
      if (accumulator < 0) accumulator = 0;
      return { steps, snapshot: latest };
    },
    /** Single manual step (for a "step" button). */
    stepOnce() {
      latest = sim.step();
      return latest;
    },
    reset() {
      accumulator = 0;
      latest = sim.reset();
      return latest;
    },
    get snapshot() {
      return latest;
    },
  };
}
