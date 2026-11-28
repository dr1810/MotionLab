// Session controller: owns the active simulation session and its playback (Run / Pause / Reset / Step).
// DOM-free and clock-free: the page passes in createSimulation, a frame scheduler (requestAnimationFrame) and a
// clock (performance.now), so tests can drive it with a fixture-backed simulation double and manual frames.
//
// Guarantees (tests/session.test.js):
//   - exactly one animation loop: at most one frame is ever pending, and Pause cancels it;
//   - fixed 1/120 s engine steps from a bounded accumulator, with catch-up capped after long gaps (playback.js);
//   - timing debt is cleared on Run/Resume and on Reset;
//   - load() with a new program starts a fresh session at tick 0; load() with an unchanged program keeps the session
//     (so Run after Pause resumes it);
//   - redraw() never steps the simulation (resize and high-DPI changes leave world state alone).

import { createPlayback } from './playback.js';

/**
 * @param {object} deps
 * @param {(program: object) => {step, reset, snapshot}} deps.createSimulation  the real engine, or a test double
 * @param {(cb: (t: number) => void) => number} deps.requestFrame  e.g. window.requestAnimationFrame
 * @param {(id: number) => void} deps.cancelFrame  e.g. window.cancelAnimationFrame
 * @param {() => number} deps.now  ms clock, e.g. performance.now
 * @param {(snapshot: object|null, info: {refit: boolean, steps: number}) => void} deps.onRender  draw + metrics
 * @param {(status: object) => void} [deps.onState]  called whenever running / session state changes
 */
export function createSessionController({ createSimulation, requestFrame, cancelFrame, now, onRender, onState = () => {}, maxStepsPerFrame, maxFrameGap }) {
  let sim = null;
  let programKey = null;
  let current = null;
  let initial = null;
  let frameId = null;

  const playback = createPlayback({
    step: () => sim.step(),
    onFrame: (snap, steps) => {
      current = snap;
      onRender(snap, { refit: false, steps });
    },
    ...(maxStepsPerFrame ? { maxStepsPerFrame } : {}),
    ...(maxFrameGap ? { maxFrameGap } : {}),
  });

  const status = () => ({
    hasSession: sim !== null,
    running: playback.running,
    tick: current ? current.tick : null,
    time: current ? current.time : null,
    canResume: Boolean(sim && !playback.running && current && current.tick > 0),
  });
  const changed = () => onState(status());

  function cancelPending() {
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
  }

  function frame(t) {
    frameId = null;
    if (!playback.running) return;
    playback.frame(t);
    if (playback.running) frameId = requestFrame(frame);
  }

  function stop() {
    const was = playback.running;
    playback.stop(); // also drops any fractional-step debt
    cancelPending();
    return was;
  }

  function show(snap, refit) {
    current = snap;
    onRender(snap, { refit, steps: 0 });
  }

  return {
    /**
     * Use this program. A program that differs from the active one (by JSON) replaces the session with a fresh one at
     * tick 0 and stops playback. An unchanged program keeps the session, its tick and its playback state.
     * Throws whatever createSimulation throws (ProgramError); the previous session is then cleared.
     * @returns {{fresh: boolean}}
     */
    load(program) {
      const key = JSON.stringify(program);
      if (sim && key === programKey) return { fresh: false };
      stop();
      sim = null;
      programKey = null;
      try {
        sim = createSimulation(program);
      } catch (err) {
        current = null;
        initial = null;
        onRender(null, { refit: true, steps: 0 });
        changed();
        throw err;
      }
      programKey = key;
      initial = sim.snapshot();
      show(initial, true);
      changed();
      return { fresh: true };
    },

    /** No runnable program (e.g. validation errors): stop and drop the session. */
    clear() {
      stop();
      sim = null;
      programKey = null;
      current = null;
      initial = null;
      onRender(null, { refit: true, steps: 0 });
      changed();
    },

    /** Start, or resume after Pause. No-op if already running or no session. Timing debt starts at zero. */
    run() {
      if (!sim || playback.running) return false;
      playback.start(now());
      cancelPending();
      frameId = requestFrame(frame);
      changed();
      return true;
    },

    pause() {
      if (!stop()) return false;
      changed();
      return true;
    },

    /** Stop playback, restore the session to tick 0 and redraw. */
    reset() {
      if (!sim) return false;
      stop();
      show(sim.reset(), true);
      changed();
      return true;
    },

    /** Pause and advance exactly one tick. */
    step() {
      if (!sim) return false;
      stop();
      show(sim.step(), false);
      changed();
      return true;
    },

    /** Redraw the current snapshot (after a resize or DPI change) without touching the simulation. */
    redraw() {
      onRender(current, { refit: false, steps: 0 });
    },

    get status() {
      return status();
    },
    get current() {
      return current;
    },
    get initial() {
      return initial;
    },
    /** For tests and console debugging: is an animation frame pending? */
    get framePending() {
      return frameId !== null;
    },
  };
}

const fmt = (n) => (Math.abs(n) < 0.0005 ? '0.000' : n.toFixed(3));

/** Text for the Output panel's clock and body readout. */
export function formatMetrics(snapshot) {
  if (!snapshot) return { clock: 'tick – · – s', rows: [] };
  return {
    clock: `tick ${snapshot.tick} · ${snapshot.time.toFixed(3)} s`,
    rows: snapshot.bodies.map((b) => [b.id + (b.static ? ' (static)' : ''), fmt(b.position.x), fmt(b.position.y), fmt(b.velocity.x), fmt(b.velocity.y)]),
  };
}

/**
 * Size a canvas's backing store for high-DPI screens and set the context transform so drawing uses CSS pixels.
 * Only resizes the backing store when it actually changes (resizing clears the canvas).
 * @returns {{width: number, height: number}} the CSS size to draw in
 */
export function prepareCanvas(canvas, ctx, dpr = 1) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const bw = Math.round(width * dpr);
  const bh = Math.round(height * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

