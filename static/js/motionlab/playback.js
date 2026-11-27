// Fixed-step playback scheduler. The browser owns timing: call frame(now) from requestAnimationFrame.
// Each frame runs as many whole 1/120 s steps as real time allows, capped so a slow or backgrounded
// tab does not trigger a burst of catch-up steps.

import { DT } from './contract.js';

/**
 * @param {{step: () => object, onFrame?: (snapshot: object, steps: number) => void,
 *          dt?: number, maxStepsPerFrame?: number, maxFrameGap?: number}} opts
 *   maxFrameGap: seconds of real time credited per frame at most (default 0.1).
 */
export function createPlayback({ step, onFrame, dt = DT, maxStepsPerFrame = 12, maxFrameGap = 0.1 }) {
  let running = false;
  let last = 0;
  let acc = 0;

  return {
    get running() {
      return running;
    },
    /** @param {number} now  ms timestamp (performance.now() or the rAF argument) */
    start(now) {
      running = true;
      last = now;
      acc = 0;
    },
    stop() {
      running = false;
      acc = 0;
    },
    /** Advance by the real time since the previous frame. Returns the number of steps run. */
    frame(now) {
      if (!running) return 0;
      const gap = Math.min(Math.max((now - last) / 1000, 0), maxFrameGap);
      last = now;
      acc += gap;
      let steps = 0;
      let snapshot = null;
      while (acc + 1e-9 >= dt && steps < maxStepsPerFrame) {
        snapshot = step();
        acc -= dt;
        steps += 1;
      }
      if (steps === maxStepsPerFrame) acc = Math.min(acc, dt);
      if (snapshot && onFrame) onFrame(snapshot, steps);
      return steps;
    },
  };
}
