// Fixture-backed test double for createSimulation(program), for isolated UI/session tests.
// It never runs physics: snapshots come from the recorded run in fixtures/ball-and-box.snapshots.json.
// - tick 0 is the recorded "setup" snapshot;
// - at a recorded event tick it returns that event's snapshot exactly;
// - between events it returns the most recent recorded bodies with tick/time advanced;
// Every call is counted, so tests can assert how many engine steps the UI asked for.
import { readFileSync } from 'node:fs';

const DT = 1 / 120;
const recording = JSON.parse(readFileSync(new URL('../../fixtures/ball-and-box.snapshots.json', import.meta.url), 'utf8'));
const byTick = new Map(recording.events.map((e) => [e.tick, e.snapshot]));
const clone = (v) => JSON.parse(JSON.stringify(v));

export function fixtureSnapshot(tick) {
  if (byTick.has(tick)) return clone(byTick.get(tick));
  let last = 0;
  for (const t of byTick.keys()) if (t <= tick && t > last) last = t;
  return { ...clone(byTick.get(last)), tick, time: tick * DT };
}

/** Returns a createSimulation-compatible factory plus a log of what the UI did with it. */
export function createFixtureSimulationFactory() {
  const log = { created: 0, programs: [], steps: 0, resets: 0, snapshots: 0, instances: [] };
  function createSimulation(program) {
    if (program && program.invalid) {
      const err = new Error('Invalid program: fixture double rejects { invalid: true }');
      err.name = 'ProgramError';
      err.code = 'INVALID_PROGRAM';
      err.errors = [{ code: 'OUT_OF_RANGE', message: 'test', blockId: 'x' }];
      throw err;
    }
    log.created += 1;
    log.programs.push(program);
    let tick = 0;
    const sim = {
      step() {
        log.steps += 1;
        tick += 1;
        return fixtureSnapshot(tick);
      },
      reset() {
        log.resets += 1;
        tick = 0;
        return fixtureSnapshot(0);
      },
      snapshot() {
        log.snapshots += 1;
        return fixtureSnapshot(tick);
      },
    };
    log.instances.push(sim);
    return sim;
  }
  return { createSimulation, log };
}

/** Manual requestAnimationFrame + clock: frames only run when the test calls advance(). */
export function createManualFrames() {
  let nextId = 1;
  let time = 1000;
  const pending = new Map();
  const stats = { requested: 0, cancelled: 0 };
  return {
    stats,
    now: () => time,
    requestFrame(cb) {
      stats.requested += 1;
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      if (pending.delete(id)) stats.cancelled += 1;
    },
    get pendingCount() {
      return pending.size;
    },
    /** Move the clock forward by ms; if a frame is pending, run it (like the browser painting one frame). */
    advance(ms) {
      time += ms;
      const due = [...pending.entries()];
      pending.clear();
      for (const [, cb] of due) cb(time);
      return due.length;
    },
    /** Move the clock without running frames (tab hidden, or paused with nothing scheduled). */
    idle(ms) {
      time += ms;
    },
  };
}
