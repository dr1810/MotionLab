// Session controller (Run / Pause / Reset / Step) under controlled frame timing, with a fixture-backed simulation
// double for isolated UI tests and one integration test against the real engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionController, formatMetrics, prepareCanvas } from '../static/js/motionlab/session.js';
import { createSimulation as realCreateSimulation } from '../static/js/motionlab/engine.js';
import { ProgramError } from '../static/js/motionlab/contract.js';
import { createFixtureSimulationFactory, createManualFrames, fixtureSnapshot } from './doubles/fixture-simulation.js';
import { program } from './helpers.js';

const FRAME = 1000 / 60; // one 60 Hz display frame = exactly two 1/120 s ticks

function setup({ createSimulation } = {}) {
  const frames = createManualFrames();
  const double = createFixtureSimulationFactory();
  const renders = [];
  const states = [];
  const ctl = createSessionController({
    createSimulation: createSimulation ?? double.createSimulation,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: frames.now,
    onRender: (snap, info) => renders.push({ tick: snap ? snap.tick : null, ...info, metrics: formatMetrics(snap) }),
    onState: (s) => states.push(s),
  });
  return { ctl, frames, double, renders, states, last: () => renders[renders.length - 1] };
}

test('load: a fresh session renders tick 0 and is not running', () => {
  const { ctl, double, last, frames } = setup();
  assert.deepEqual(ctl.load(program()), { fresh: true });
  assert.equal(double.log.created, 1);
  assert.deepEqual(last(), { tick: 0, refit: true, steps: 0, metrics: formatMetrics(fixtureSnapshot(0)) });
  assert.deepEqual(ctl.status, { hasSession: true, running: false, tick: 0, time: 0, canResume: false });
  assert.equal(frames.pendingCount, 0);
});

test('run: each 60 Hz frame advances exactly two ticks and updates the metrics', () => {
  const { ctl, frames, double, renders, last } = setup();
  ctl.load(program());
  assert.equal(ctl.run(), true);
  assert.equal(frames.pendingCount, 1);
  for (let i = 1; i <= 30; i++) {
    frames.advance(FRAME);
    assert.equal(last().tick, 2 * i, `frame ${i}`);
    assert.equal(last().steps, 2);
  }
  assert.equal(double.log.steps, 60);
  assert.equal(last().metrics.clock, 'tick 60 · 0.500 s');
  assert.equal(renders.filter((r) => r.steps > 0).length, 30, 'one render per frame, not per tick');
  assert.equal(frames.pendingCount, 1, 'still exactly one frame scheduled');
});

test('exactly one animation loop: repeated Run, and Pause then Run before the old frame fires', () => {
  const { ctl, frames, double } = setup();
  ctl.load(program());
  ctl.run();
  assert.equal(ctl.run(), false, 'Run while running is ignored');
  assert.equal(frames.pendingCount, 1);
  ctl.pause();
  assert.equal(frames.pendingCount, 0, 'Pause cancels the pending frame');
  ctl.run();
  ctl.pause();
  ctl.run();
  assert.equal(frames.pendingCount, 1, 'never more than one pending frame');
  frames.advance(FRAME);
  assert.equal(double.log.steps, 2, 'one loop worth of steps, not two or three');
});

test('long gap while running (hidden tab): catch-up is capped at 12 ticks', () => {
  const { ctl, frames, last } = setup();
  ctl.load(program());
  ctl.run();
  frames.advance(10_000);
  assert.equal(last().tick, 12);
  frames.advance(FRAME);
  assert.equal(last().tick, 14, 'normal pace resumes next frame');
});

test('Pause keeps the session; Resume continues it with no timing debt', () => {
  const { ctl, frames, double, last } = setup();
  ctl.load(program());
  ctl.run();
  frames.advance(FRAME * 3); // the first frame after run: 50 ms -> 6 ticks
  const pausedAt = last().tick;
  ctl.pause();
  assert.deepEqual([ctl.status.running, ctl.status.canResume, ctl.status.tick], [false, true, pausedAt]);
  frames.idle(5_000); // a long pause
  ctl.run();
  frames.advance(FRAME);
  assert.equal(last().tick, pausedAt + 2, 'only the frame time after Resume counts, not the 5 s pause');
  assert.equal(double.log.created, 1, 'same session');
  // Fractional debt: 6 ms carried into a pause must not count after Resume.
  frames.advance(6);
  const before = ctl.current.tick;
  ctl.pause();
  ctl.run();
  frames.advance(6); // with the carried 6 ms this would reach one 8.33 ms tick
  assert.equal(ctl.current.tick, before, 'debt was cleared by Resume');
});

test('Reset stops playback, restores tick 0, redraws with refit and clears fractional debt', () => {
  const { ctl, frames, double, last } = setup();
  ctl.load(program());
  ctl.run();
  frames.advance(FRAME);
  frames.advance(6); // 6 ms: no whole tick yet, 6 ms of debt carried
  ctl.reset();
  assert.deepEqual([last().tick, last().refit], [0, true]);
  assert.equal(ctl.status.running, false);
  assert.equal(frames.pendingCount, 0);
  assert.equal(double.log.resets, 1);
  ctl.run();
  frames.advance(6); // with the old 6 ms of debt this would be 12 ms -> 1 tick
  assert.equal(ctl.current.tick, 0, 'debt was cleared by Reset');
  frames.advance(3); // 9 ms total since Run -> 1 tick
  assert.equal(ctl.current.tick, 1);
});

test('load: unchanged program keeps the session (Run resumes); a changed program starts fresh', () => {
  const { ctl, frames, double, last } = setup();
  const p = program();
  ctl.load(p);
  ctl.run();
  frames.advance(FRAME);
  ctl.pause();
  const tick = last().tick;
  assert.deepEqual(ctl.load(JSON.parse(JSON.stringify(p))), { fresh: false }, 'equal JSON counts as unchanged');
  assert.equal(double.log.created, 1);
  assert.equal(ctl.status.tick, tick);
  ctl.run();
  frames.advance(FRAME);
  assert.equal(last().tick, tick + 2, 'resumed the same session');

  const edited = program();
  edited.commands[2].mass = 3;
  assert.deepEqual(ctl.load(edited), { fresh: true });
  assert.equal(double.log.created, 2);
  assert.deepEqual([ctl.status.running, ctl.status.tick, last().refit], [false, 0, true], 'an edit stops playback and starts at tick 0');
  assert.equal(frames.pendingCount, 0);
  ctl.run();
  frames.advance(FRAME);
  assert.equal(last().tick, 2, 'Run after an edit plays the fresh session');
});

test('load of a program unchanged while running leaves playback running', () => {
  const { ctl, frames } = setup();
  ctl.load(program());
  ctl.run();
  ctl.load(program());
  assert.equal(ctl.status.running, true);
  assert.equal(frames.pendingCount, 1);
});

test('an invalid program clears the session; clear() stops and blanks the canvas', () => {
  const { ctl, frames, last } = setup();
  ctl.load(program());
  ctl.run();
  assert.throws(() => ctl.load({ invalid: true }), (e) => e.code === 'INVALID_PROGRAM');
  assert.deepEqual([ctl.status.hasSession, ctl.status.running, frames.pendingCount, last().tick], [false, false, 0, null]);
  assert.equal(ctl.run(), false);
  ctl.load(program());
  ctl.run();
  ctl.clear();
  assert.deepEqual([ctl.status.hasSession, frames.pendingCount, last().metrics.clock], [false, 0, 'tick – · – s']);
});

test('Step pauses and advances exactly one tick', () => {
  const { ctl, frames, double } = setup();
  ctl.load(program());
  ctl.run();
  ctl.step();
  assert.deepEqual([ctl.status.running, ctl.current.tick, frames.pendingCount, double.log.steps], [false, 1, 0, 1]);
});

test('redraw (resize / DPI change) never steps or resets the simulation', () => {
  const { ctl, double, last } = setup();
  ctl.load(program());
  ctl.step();
  const before = { steps: double.log.steps, resets: double.log.resets, current: JSON.stringify(ctl.current) };
  for (let i = 0; i < 5; i++) ctl.redraw();
  assert.deepEqual({ steps: double.log.steps, resets: double.log.resets, current: JSON.stringify(ctl.current) }, before);
  assert.deepEqual([last().tick, last().steps, last().refit], [1, 0, false]);
});

test('state notifications follow the transitions', () => {
  const { ctl, frames, states } = setup();
  ctl.load(program());
  ctl.run();
  frames.advance(FRAME);
  ctl.pause();
  ctl.reset();
  assert.deepEqual(states.map((s) => [s.running, s.canResume, s.tick]), [[false, false, 0], [true, false, 0], [false, true, 2], [false, false, 0]]);
});

test('wired to the real engine: 60 frames at 60 Hz equals 120 direct engine steps, bit for bit', () => {
  const { ctl, frames } = setup({ createSimulation: realCreateSimulation });
  ctl.load(program());
  ctl.run();
  for (let i = 0; i < 60; i++) frames.advance(FRAME);
  const direct = realCreateSimulation(program());
  let snap;
  for (let i = 0; i < 120; i++) snap = direct.step();
  assert.deepEqual(ctl.current, snap);
  assert.throws(() => ctl.load({ version: 1, commands: [{ op: 'nope', blockId: 'x' }] }), ProgramError);
});

test('formatMetrics: clock and per-body rows with 3 decimals', () => {
  const m = formatMetrics(fixtureSnapshot(1));
  assert.equal(m.clock, 'tick 1 · 0.008 s');
  assert.deepEqual(m.rows, [['box', '2.000', '0.500', '0.000', '0.000'], ['ball', '0.021', '2.999', '2.500', '-0.082']]);
  assert.deepEqual(formatMetrics(null), { clock: 'tick – · – s', rows: [] });
});

test('prepareCanvas: high-DPI backing store, CSS-pixel transform, no needless resize', () => {
  const calls = [];
  const canvas = { clientWidth: 300, clientHeight: 150, width: 300, height: 150 };
  let assigned = 0;
  const watched = new Proxy(canvas, { set(t, k, v) { if (k === 'width' || k === 'height') assigned += 1; t[k] = v; return true; } });
  const ctx = { setTransform: (...a) => calls.push(a) };
  assert.deepEqual(prepareCanvas(watched, ctx, 2), { width: 300, height: 150 });
  assert.deepEqual([canvas.width, canvas.height], [600, 300]);
  assert.deepEqual(calls.pop(), [2, 0, 0, 2, 0, 0]);
  const before = assigned;
  prepareCanvas(watched, ctx, 2);
  assert.equal(assigned, before, 'same size and DPR: backing store untouched (no clear)');
  canvas.clientWidth = 400; // resize
  prepareCanvas(watched, ctx, 1.5);
  assert.deepEqual([canvas.width, canvas.height], [600, 225]);
  assert.deepEqual(calls.pop(), [1.5, 0, 0, 1.5, 0, 0]);
});
