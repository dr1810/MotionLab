import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, ProgramError, DT, FLOOR_Y, ERROR_CODES } from '../static/js/motionlab/index.js';
import { loadJson, assertClose } from './helpers.js';

const fixture = loadJson('fixtures/ball-and-box.program.json');
const expected = loadJson('fixtures/ball-and-box.expected.json');

test('fixture: initial snapshot matches expected', () => {
  const sim = createSimulation(fixture);
  assertClose(sim.snapshot(), expected.initial, expected.tolerance);
});

test('fixture: first step matches expected (force applied once, box at rest on floor)', () => {
  const sim = createSimulation(fixture);
  assertClose(sim.step(), expected.afterTick1, expected.tolerance);
});

test('step advances exactly one tick of 1/120 s and time = tick * DT', () => {
  const sim = createSimulation(fixture);
  for (let i = 1; i <= 240; i++) {
    const s = sim.step();
    assert.equal(s.tick, i);
    assert.equal(s.time, i * DT);
  }
  assert.equal(DT, 1 / 120);
});

test('force applies only on the first tick', () => {
  const sim = createSimulation({
    version: 1,
    commands: [
      { op: 'setGravity', blockId: 'g', x: 0, y: 0 },
      { op: 'createCircle', blockId: 'c', id: 'p', x: 0, y: 5, radius: 0.1, mass: 2, restitution: 0, static: false },
      { op: 'applyForce', blockId: 'f1', id: 'p', fx: 240, fy: 0 },
      { op: 'applyForce', blockId: 'f2', id: 'p', fx: 240, fy: 0 }, // forces accumulate: 480 N
    ],
  });
  const v1 = sim.step().bodies[0].velocity.x;
  assert.ok(Math.abs(v1 - 480 / 2 / 120) < 1e-12);
  const v2 = sim.step().bodies[0].velocity.x;
  assert.equal(v2, v1);
});

test('reset restores initial scene, time zero, and re-arms the force', () => {
  const sim = createSimulation(fixture);
  const first = sim.step();
  for (let i = 0; i < 300; i++) sim.step();
  const r = sim.reset();
  assert.deepEqual(r, sim.snapshot());
  assertClose(r, expected.initial, expected.tolerance);
  assert.deepEqual(sim.step(), first);
});

test('snapshot is detached and JSON-serializable', () => {
  const sim = createSimulation(fixture);
  const s = sim.snapshot();
  s.bodies[0].position.x = 999;
  s.bodies.pop();
  assert.equal(sim.snapshot().bodies.length, 2);
  assert.equal(sim.snapshot().bodies[0].position.x, 2);
  const later = sim.step();
  assert.deepEqual(JSON.parse(JSON.stringify(later)), later);
  assert.deepEqual(Object.keys(later).sort(), ['bodies', 'tick', 'time']);
});

test('deterministic: two simulations of the same program agree exactly', () => {
  const a = createSimulation(fixture);
  const b = createSimulation(fixture);
  for (let i = 0; i < 600; i++) assert.deepEqual(a.step(), b.step());
});

test('dynamic bodies never end a step below the floor; values stay finite', () => {
  const sim = createSimulation(fixture);
  for (let i = 0; i < 1200; i++) {
    for (const b of sim.step().bodies) {
      const half = b.shape === 'circle' ? b.dimensions.radius : b.dimensions.height / 2;
      assert.ok(b.position.y - half >= FLOOR_Y - 1e-9, `tick ${i} ${b.id} below floor`);
      for (const v of [b.position.x, b.position.y, b.velocity.x, b.velocity.y]) assert.ok(Number.isFinite(v));
    }
  }
});

test('dropped ball bounces with its restitution and comes to rest', () => {
  const sim = createSimulation({
    version: 1,
    commands: [{ op: 'createCircle', blockId: 'c', id: 'b', x: 0, y: 2, radius: 0.5, mass: 1, restitution: 0.5, static: false }],
  });
  let maxUpVelocity = 0;
  let s;
  for (let i = 0; i < 1200; i++) {
    s = sim.step();
    maxUpVelocity = Math.max(maxUpVelocity, s.bodies[0].velocity.y);
  }
  // impact speed ~ sqrt(2*9.81*1.5) = 5.42 m/s, rebound ~ 2.71 m/s
  assert.ok(maxUpVelocity > 2.4 && maxUpVelocity < 2.9, `rebound ${maxUpVelocity}`);
  assert.ok(Math.abs(s.bodies[0].position.y - 0.5) < 1e-6);
  assert.ok(Math.abs(s.bodies[0].velocity.y) < 1e-9);
});

test('static bodies never move; dynamic body lands on a static box', () => {
  const sim = createSimulation({
    version: 1,
    commands: [
      { op: 'createBox', blockId: 'shelf', id: 'shelf', x: 0, y: 2, width: 4, height: 0.2, mass: 1, restitution: 0, static: true },
      { op: 'createBox', blockId: 'crate', id: 'crate', x: 0, y: 4, width: 0.5, height: 0.5, mass: 1, restitution: 0, static: false },
    ],
  });
  let s;
  for (let i = 0; i < 600; i++) s = sim.step();
  const [shelf, crate] = s.bodies;
  assert.deepEqual(shelf.position, { x: 0, y: 2 });
  assert.deepEqual(shelf.velocity, { x: 0, y: 0 });
  assert.ok(Math.abs(crate.position.y - (2 + 0.1 + 0.25)) < 1e-3, `crate y ${crate.position.y}`);
});

test('moving ball collides with box and transfers momentum (zero gravity)', () => {
  const sim = createSimulation({
    version: 1,
    commands: [
      { op: 'setGravity', blockId: 'g', x: 0, y: 0 },
      { op: 'createCircle', blockId: 'a', id: 'ball', x: 0, y: 1, radius: 0.25, mass: 1, restitution: 1, static: false },
      { op: 'createBox', blockId: 'b', id: 'box', x: 2, y: 1, width: 0.5, height: 0.5, mass: 1, restitution: 1, static: false },
      { op: 'setVelocity', blockId: 'v', id: 'ball', vx: 3, vy: 0 },
    ],
  });
  let s;
  for (let i = 0; i < 240; i++) s = sim.step();
  const [ball, box] = s.bodies;
  assert.ok(Math.abs(ball.velocity.x) < 1e-9, `ball vx ${ball.velocity.x}`);
  assert.ok(Math.abs(box.velocity.x - 3) < 1e-9, `box vx ${box.velocity.x}`);
});

test('empty program is valid: no bodies, step and reset work', () => {
  const sim = createSimulation({ version: 1, commands: [] });
  assert.deepEqual(sim.snapshot(), { tick: 0, time: 0, bodies: [] });
  assert.deepEqual(sim.step(), { tick: 1, time: DT, bodies: [] });
  assert.deepEqual(sim.reset(), { tick: 0, time: 0, bodies: [] });
});

test('invalid program throws ProgramError carrying contract errors', () => {
  assert.throws(() => createSimulation({ version: 2, commands: [] }), (e) => {
    assert.ok(e instanceof ProgramError);
    assert.deepEqual(e.errors.map((x) => [x.code, x.blockId]), [[ERROR_CODES.UNSUPPORTED_VERSION, null]]);
    return true;
  });
  assert.throws(() => createSimulation(null), ProgramError);
});

test('createSimulation does not depend on later mutation of the input program', () => {
  const program = structuredClone(fixture);
  const sim = createSimulation(program);
  program.commands[1].x = 100;
  assertClose(sim.reset(), expected.initial, expected.tolerance);
});
