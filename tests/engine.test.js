import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { DT, ProgramError, ERROR_CODES as E } from '../static/js/motionlab/contract.js';
import * as api from '../static/js/motionlab/index.js';
import { program, expected, assertClose, prog, circle, box } from './helpers.js';

const runFor = (sim, ticks) => {
  let s;
  for (let i = 0; i < ticks; i++) s = sim.step();
  return s;
};
const body = (snap, id) => snap.bodies.find((b) => b.id === id);

test('index re-exports the public API', () => {
  for (const name of ['createSimulation', 'validateProgram', 'compileWorkspace', 'createView', 'fitView', 'DT', 'FLOOR_Y', 'LIMITS', 'ERROR_CODES', 'ProgramError']) {
    assert.ok(name in api, name);
  }
});

test('fixture: initial snapshot', () => {
  const exp = expected();
  const sim = createSimulation(program());
  assert.deepEqual(sim.snapshot(), exp.initial);
});

test('fixture: first two ticks match hand-derived values', () => {
  const exp = expected();
  const sim = createSimulation(program());
  assertClose(sim.step(), exp.afterTick1, exp.tolerance);
  assertClose(sim.step(), exp.afterTick2, exp.tolerance);
});

test('fixture: reset restores the initial scene and time zero', () => {
  const exp = expected();
  const sim = createSimulation(program());
  runFor(sim, 500);
  assert.deepEqual(sim.reset(), exp.initial);
  assert.deepEqual(sim.snapshot(), exp.initial);
  assertClose(sim.step(), exp.afterTick1, exp.tolerance, 'force re-applies after reset');
});

test('step advances exactly one 1/120 s tick', () => {
  const sim = createSimulation(program());
  for (let i = 1; i <= 240; i++) {
    const s = sim.step();
    assert.equal(s.tick, i);
    assert.equal(s.time, i * DT);
  }
  assert.equal(sim.snapshot().time, 2);
});

test('applyForce acts on the first tick only and accumulates', () => {
  const sim = createSimulation(prog(
    { op: 'setGravity', blockId: 'g', x: 0, y: 0 },
    circle({ y: 5 }),
    { op: 'applyForce', blockId: 'f1', id: 'ball', fx: 60, fy: 0 },
    { op: 'applyForce', blockId: 'f2', id: 'ball', fx: 60, fy: 120 },
  ));
  const s1 = body(sim.step(), 'ball');
  assert.equal(s1.velocity.x, 1);
  assert.equal(s1.velocity.y, 1);
  const s2 = body(runFor(sim, 10), 'ball');
  assert.equal(s2.velocity.x, 1);
  assert.equal(s2.velocity.y, 1);
});

test('setGravity and setVelocity: last command wins', () => {
  const sim = createSimulation(prog(
    { op: 'setGravity', blockId: 'g1', x: 0, y: -1 },
    circle({ y: 50 }),
    { op: 'setVelocity', blockId: 'v1', id: 'ball', vx: 9, vy: 9 },
    { op: 'setVelocity', blockId: 'v2', id: 'ball', vx: 2, vy: 0 },
    { op: 'setGravity', blockId: 'g2', x: 3, y: 0 },
  ));
  assert.deepEqual(body(sim.snapshot(), 'ball').velocity, { x: 2, y: 0 });
  const v = body(sim.step(), 'ball').velocity;
  assert.equal(v.x, 2 + 3 * DT);
  assert.equal(v.y, 0);
});

test('default gravity is -9.81 when no setGravity runs', () => {
  const v = body(createSimulation(prog(circle({ y: 5 }))).step(), 'ball').velocity;
  assert.equal(v.y, -9.81 * DT);
});

test('empty program steps with no bodies', () => {
  const sim = createSimulation(prog());
  assert.deepEqual(sim.snapshot(), { tick: 0, time: 0, bodies: [] });
  assert.deepEqual(sim.step(), { tick: 1, time: DT, bodies: [] });
  assert.deepEqual(sim.reset(), { tick: 0, time: 0, bodies: [] });
});

test('invalid program throws ProgramError with contract errors', () => {
  for (const bad of [null, { version: 2, commands: [] }, prog(circle({ radius: -1 }))]) {
    assert.throws(() => createSimulation(bad), (err) => {
      assert.ok(err instanceof ProgramError);
      assert.equal(err.code, E.INVALID_PROGRAM);
      assert.ok(err.errors.length > 0);
      for (const e of err.errors) assert.deepEqual(Object.keys(e), ['code', 'message', 'blockId']);
      return true;
    });
  }
});

test('snapshots are detached and JSON-serializable', () => {
  const sim = createSimulation(program());
  const a = sim.snapshot();
  a.bodies[0].position.x = 999;
  a.bodies.pop();
  a.tick = 77;
  assert.deepEqual(sim.snapshot(), expected().initial);
  const s = runFor(sim, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.notEqual(sim.snapshot(), sim.snapshot());
});

test('simulation does not depend on the program object after creation', () => {
  const p = program();
  const sim = createSimulation(p);
  const before = JSON.stringify(p);
  p.commands[2].x = 50;
  p.commands.length = 0;
  assert.deepEqual(sim.reset(), expected().initial);
  runFor(sim, 10);
  createSimulation(program());
  assert.notEqual(JSON.stringify(p), before);
});

test('deterministic: two runs give identical snapshots', () => {
  const a = createSimulation(program());
  const b = createSimulation(program());
  for (let i = 0; i < 1200; i++) assert.deepEqual(a.step(), b.step());
  a.reset();
  const replay = createSimulation(program());
  for (let i = 0; i < 300; i++) assert.deepEqual(a.step(), replay.step());
});

test('no dynamic body ends a step below the floor (fixture, 20 s)', () => {
  const sim = createSimulation(program());
  for (let i = 0; i < 2400; i++) {
    for (const b of sim.step().bodies) {
      const half = b.shape === 'circle' ? b.dimensions.radius : b.dimensions.height / 2;
      assert.ok(b.position.y - half >= -1e-12, `tick ${i + 1} ${b.id} y=${b.position.y}`);
    }
  }
});

test('fixture: ball bounces off the top of the floor-supported box, which stays put', () => {
  const sim = createSimulation(program());
  let prev = body(sim.snapshot(), 'ball');
  let bounce = null;
  for (let i = 1; i <= 240 && !bounce; i++) {
    const s = sim.step();
    const ball = body(s, 'ball');
    if (prev.velocity.y < 0 && ball.velocity.y > 0) bounce = { tick: i, before: prev.velocity.y, after: ball.velocity.y, ball, box: body(s, 'box') };
    prev = ball;
  }
  assert.ok(bounce, 'ball bounced');
  assert.ok(bounce.ball.position.y > 1, 'bounce happened on the box top (y > box top), not the floor');
  // Restitution acts on the closing speed at contact time (ball vs. a box that has just gained g*dt downward).
  assert.ok(Math.abs(bounce.after + 0.6 * bounce.before) < 0.01, `restitution 0.6: ${bounce.before} -> ${bounce.after}`);
  assertClose(bounce.box.position, { x: 2, y: 0.5 }, 1e-9);
  assertClose(bounce.box.velocity, { x: 0, y: 0 }, 1e-9);
});

test('static bodies never move', () => {
  const sim = createSimulation(prog(box({ y: 3, static: true }), circle({ x: 0, y: 5, radius: 0.25 })));
  const s = runFor(sim, 600);
  assert.deepEqual(body(s, 'box').position, { x: 0, y: 3 });
  assert.deepEqual(body(s, 'box').velocity, { x: 0, y: 0 });
  assert.ok(Math.abs(body(s, 'ball').position.y - 3.75) < 0.01, `ball rests on the static box (y=${body(s, 'ball').position.y})`);
});

test('dropped ball bounces lower each time and comes to rest on the floor', () => {
  const sim = createSimulation(prog(circle({ y: 2, radius: 0.5, restitution: 0.5 })));
  let bounced = false;
  let prevVy = 0;
  for (let i = 0; i < 1200; i++) {
    const v = body(sim.step(), 'ball').velocity.y;
    if (prevVy < 0 && v > 0) bounced = true;
    prevVy = v;
  }
  const b = body(sim.snapshot(), 'ball');
  assert.ok(bounced, 'ball bounced at least once');
  assert.equal(b.position.y, 0.5);
  assert.equal(b.velocity.y, 0);
});

test('restitution 0 does not bounce off the floor', () => {
  const sim = createSimulation(prog(circle({ y: 3, restitution: 0 })));
  for (let i = 0; i < 240; i++) assert.ok(body(sim.step(), 'ball').velocity.y <= 0);
});

test('box stacks on box', () => {
  const sim = createSimulation(prog(box(), box({ blockId: 'b2', id: 'top', y: 3 })));
  const s = runFor(sim, 600);
  assert.ok(Math.abs(body(s, 'box').position.y - 0.5) < 0.01);
  assert.ok(Math.abs(body(s, 'top').position.y - 1.5) < 0.01, `top y=${body(s, 'top').position.y}`);
});

test('head-on elastic circles exchange velocity', () => {
  const sim = createSimulation(prog(
    { op: 'setGravity', blockId: 'g', x: 0, y: 0 },
    circle({ blockId: 'a', id: 'a', x: 0, y: 5, restitution: 1 }),
    circle({ blockId: 'b', id: 'b', x: 3, y: 5, restitution: 1 }),
    { op: 'setVelocity', blockId: 'v', id: 'a', vx: 2, vy: 0 },
  ));
  const s = runFor(sim, 240);
  assert.ok(Math.abs(body(s, 'a').velocity.x) < 1e-9);
  assert.ok(Math.abs(body(s, 'b').velocity.x - 2) < 1e-9);
});
