// createSimulation + scene compiler at the session level: whole-program validation before a session exists,
// actionable diagnostics, malformed and out-of-order programs, static targets, multiple forces,
// reset-and-replay, and the headless fixture recording (setup -> impact -> rest) used by the frontend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { ProgramError, ERROR_CODES as E, LIMITS, DT } from '../static/js/motionlab/contract.js';
import { fitView } from '../static/js/motionlab/view.js';
import { drawScene } from '../static/js/motionlab/renderer.js';
import { recordFixture, formatRecording } from '../scripts/record-fixture.js';
import { program, expected, loadJson, prog, circle, box } from './helpers.js';

const body = (snap, id) => snap.bodies.find((b) => b.id === id);
const vel = (id, vx, vy, blockId = `v-${id}`) => ({ op: 'setVelocity', blockId, id, vx, vy });
const force = (id, fx, fy, blockId = `f-${id}`) => ({ op: 'applyForce', blockId, id, fx, fy });

/** createSimulation must throw ProgramError; returns its [code, blockId] pairs. */
function rejected(p) {
  let caught = null;
  try {
    createSimulation(p);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ProgramError, `expected ProgramError, got ${caught}`);
  assert.equal(caught.code, E.INVALID_PROGRAM);
  return caught.errors.map((e) => [e.code, e.blockId]);
}
const messages = (p) => {
  try {
    createSimulation(p);
  } catch (err) {
    return err.errors.map((e) => e.message);
  }
  return [];
};

// ---------------------------------------------------------------- validation before a session exists

test('the whole program is validated before a session is published', () => {
  // Valid commands first, one bad command last: still no session, and every problem is reported.
  // (BELOW_FLOOR is only checked once a create block's own fields are valid, so mass 0 is the one error here.)
  assert.deepEqual(rejected(prog(circle(), force('ball', 10, 0), box({ blockId: 'bad', y: 3, mass: 0 }))), [[E.OUT_OF_RANGE, 'bad']]);
  // Several bad commands anywhere in the stack: all reported, in stack order, none of the program runs.
  assert.deepEqual(
    rejected(prog(circle({ blockId: 'first', radius: 0 }), circle({ blockId: 'ok', id: 'b2', x: 5 }), box({ blockId: 'last', y: -3 }))),
    [[E.OUT_OF_RANGE, 'first'], [E.BELOW_FLOOR, 'last']],
  );
});

test('malformed programs and commands are rejected with codes and blockIds', () => {
  const cases = [
    [null, [[E.INVALID_DOCUMENT, null]]],
    [[], [[E.INVALID_DOCUMENT, null]]],
    ['{"version":1,"commands":[]}', [[E.INVALID_DOCUMENT, null]]], // a JSON string is not a parsed program
    [{ commands: [] }, [[E.UNSUPPORTED_VERSION, null]]],
    [{ version: '1', commands: [] }, [[E.UNSUPPORTED_VERSION, null]]],
    [{ version: 1, commands: null }, [[E.INVALID_COMMANDS, null]]],
    [prog({ blockId: 'x' }), [[E.UNKNOWN_OP, 'x']]],
    [prog({ op: 'createcircle', blockId: 'x' }), [[E.UNKNOWN_OP, 'x']]],
    [prog({ op: 'constructor', blockId: 'x' }), [[E.UNKNOWN_OP, 'x']]],
    [prog({ op: '__proto__', blockId: 'x' }), [[E.UNKNOWN_OP, 'x']]],
    [prog(circle({ radius: -0.5 })), [[E.OUT_OF_RANGE, 'c']]],
    [prog(box({ width: 0 })), [[E.OUT_OF_RANGE, 'b']]],
    [prog(circle({ mass: 0 })), [[E.OUT_OF_RANGE, 'c']]],
    [prog(circle({ restitution: 1.5 })), [[E.OUT_OF_RANGE, 'c']]],
    [prog(circle({ restitution: -0.1 })), [[E.OUT_OF_RANGE, 'c']]],
    [prog(circle({ x: NaN })), [[E.INVALID_NUMBER, 'c']]],
    [prog(circle({ y: Infinity })), [[E.INVALID_NUMBER, 'c']]],
    [prog(circle({ mass: '1' })), [[E.INVALID_NUMBER, 'c']]],
    [prog(circle({ static: 'false' })), [[E.INVALID_TYPE, 'c']]],
    [prog(circle({ spin: 3 })), [[E.UNKNOWN_FIELD, 'c']]],
    [prog(JSON.parse('{"op":"setGravity","blockId":"g","x":0,"y":-1,"__proto__":{"polluted":true}}')), [[E.UNKNOWN_FIELD, 'g']]],
    [prog(circle(), circle({ blockId: 'c2', x: 3 })), [[E.DUPLICATE_BODY_ID, 'c2']]],
  ];
  for (const [p, want] of cases) assert.deepEqual(rejected(p), want, JSON.stringify(p)?.slice(0, 80));
  assert.equal({}.polluted, undefined, 'no prototype pollution');
});

test('body and command limits are enforced at session creation', () => {
  const bodies = Array.from({ length: LIMITS.maxBodies + 1 }, (_, i) => circle({ blockId: `c${i}`, id: `b${i}`, x: i * 2 }));
  assert.deepEqual(rejected(prog(...bodies)), [[E.TOO_MANY_BODIES, `c${LIMITS.maxBodies}`]]);
  const cmds = Array.from({ length: LIMITS.maxCommands + 1 }, (_, i) => ({ op: 'setGravity', blockId: `g${i}`, x: 0, y: -1 }));
  assert.deepEqual(rejected(prog(...cmds)), [[E.TOO_MANY_COMMANDS, null]]);
});

// ---------------------------------------------------------------- ordering

test('out-of-order references are rejected, with a fix that names the block to move', () => {
  const later = prog(vel('ball', 1, 0, 'early-v'), force('ball', 5, 0, 'early-f'), circle());
  assert.deepEqual(rejected(later), [[E.UNKNOWN_BODY, 'early-v'], [E.UNKNOWN_BODY, 'early-f']]);
  for (const m of messages(later)) assert.match(m, /created further down\. Move this block below the block that creates "ball"/);

  const typo = prog(circle(), box({ x: 3 }), vel('bal', 1, 0));
  assert.deepEqual(rejected(typo), [[E.UNKNOWN_BODY, 'v-bal']]);
  assert.match(messages(typo)[0], /there is no body "bal"\. Bodies created above: ball, box\./);
  assert.match(messages(prog(vel('ball', 1, 0)))[0], /Create a body above this block first/);
});

test('order-independent settings: gravity may come after bodies; velocity and force order does not matter', () => {
  const late = createSimulation(prog(circle({ y: 50 }), { op: 'setGravity', blockId: 'g', x: 0, y: -2 }));
  assert.equal(body(late.step(), 'ball').velocity.y, -2 * DT);
  const a = createSimulation(prog(circle({ y: 50 }), vel('ball', 1, 0), force('ball', 60, 0)));
  const b = createSimulation(prog(circle({ y: 50 }), force('ball', 60, 0), vel('ball', 1, 0)));
  assert.deepEqual(a.step(), b.step(), 'setVelocity does not cancel a force applied above it');
  assert.equal(body(a.snapshot(), 'ball').velocity.x, 1 + 60 * DT);
});

// ---------------------------------------------------------------- static targets (defined behaviour)

test('velocity and force blocks targeting a static body are rejected (STATIC_BODY), never silently ignored', () => {
  const p = prog(box({ static: true }), circle({ x: 3 }), vel('box', 1, 0, 'sv'), force('box', 9, 0, 'sf'));
  assert.deepEqual(rejected(p), [[E.STATIC_BODY, 'sv'], [E.STATIC_BODY, 'sf']]);
  for (const m of messages(p)) assert.match(m, /static, so it cannot be given a velocity or force\. Untick "static" on "box" or remove this block\./);
  // The same blocks on the dynamic body are fine.
  assert.doesNotThrow(() => createSimulation(prog(box({ static: true }), circle({ x: 3 }), vel('ball', 1, 0), force('ball', 9, 0))));
});

// ---------------------------------------------------------------- forces

test('multiple force blocks: same body sums, different bodies stay independent, all for tick 1 only', () => {
  const sim = createSimulation(prog(
    { op: 'setGravity', blockId: 'g', x: 0, y: 0 },
    circle({ blockId: 'a', id: 'a', y: 5, mass: 2 }),
    circle({ blockId: 'b', id: 'b', x: 5, y: 5, mass: 1 }),
    force('a', 120, 0, 'fa1'),
    force('b', 0, 60, 'fb'),
    force('a', -60, 240, 'fa2'),
  ));
  const s1 = sim.step();
  assert.deepEqual(body(s1, 'a').velocity, { x: (60 / 2) * DT, y: (240 / 2) * DT });
  assert.deepEqual(body(s1, 'b').velocity, { x: 0, y: 60 * DT });
  const s2 = sim.step();
  assert.deepEqual(body(s2, 'a').velocity, body(s1, 'a').velocity);
  assert.deepEqual(body(s2, 'b').velocity, body(s1, 'b').velocity);
});

// ---------------------------------------------------------------- reset and replay

test('reset-and-replay: every snapshot of a 10 s run repeats exactly after reset', () => {
  const sim = createSimulation(program());
  const first = [sim.snapshot()];
  for (let i = 0; i < 1200; i++) first.push(sim.step());
  assert.deepEqual(sim.reset(), first[0]);
  assert.deepEqual(sim.reset(), first[0], 'reset is idempotent');
  for (let i = 1; i <= 1200; i++) assert.deepEqual(sim.step(), first[i], `tick ${i}`);
});

test('reset restores initial conditions, not the state at any later point', () => {
  const sim = createSimulation(program());
  for (let i = 0; i < 500; i++) sim.step();
  assert.deepEqual(sim.reset(), expected().initial);
});

// ---------------------------------------------------------------- headless fixture: setup -> impact -> rest

test('recorded fixture snapshots are reproduced exactly by the engine', () => {
  const recorded = loadJson('fixtures/ball-and-box.snapshots.json');
  const fresh = recordFixture(program());
  assert.deepEqual(fresh, recorded, 're-record with: node scripts/record-fixture.js');
  assert.equal(formatRecording(fresh).length > 0, true);
});

test('recording agrees with the hand-derived expected states', () => {
  const rec = loadJson('fixtures/ball-and-box.snapshots.json');
  const ev = Object.fromEntries(rec.events.map((e) => [e.name, e]));
  assert.deepEqual(ev.setup.snapshot, expected().initial);
  assert.deepEqual(ev.firstTick.snapshot.tick, expected().afterTick1.tick);
  for (const [i, b] of ev.firstTick.snapshot.bodies.entries()) {
    for (const k of ['x', 'y']) {
      assert.ok(Math.abs(b.position[k] - expected().afterTick1.bodies[i].position[k]) <= 1e-9);
      assert.ok(Math.abs(b.velocity[k] - expected().afterTick1.bodies[i].velocity[k]) <= 1e-9);
    }
  }
});

test('headless run, setup through impact: the story the recording tells', () => {
  const rec = loadJson('fixtures/ball-and-box.snapshots.json');
  const ev = Object.fromEntries(rec.events.map((e) => [e.name, e]));
  const ticks = rec.events.map((e) => e.tick);
  assert.deepEqual([...ticks].sort((a, b) => a - b), ticks, 'events are in time order');
  for (const e of rec.events) assert.equal(e.snapshot.time, e.tick * DT, `${e.name} time`);

  const pre = body(ev.preImpact.snapshot, 'ball');
  const hit = body(ev.impact.snapshot, 'ball');
  assert.equal(ev.impact.tick, ev.preImpact.tick + 1);
  assert.equal(body(ev.preImpact.snapshot, 'box').velocity.x, 0, 'box at rest before the impact');
  assert.ok(pre.position.y > 0.25 && pre.position.y < 1, 'the ball meets the box on its left face (centre below the box top)');
  assert.ok(pre.velocity.x > 0 && hit.velocity.x < 0, 'the light ball bounces back off the heavier box');
  const after = ev.afterImpact.snapshot;
  assert.ok(Math.abs(body(after, 'ball').velocity.x + 1 / 6) < 1e-9 && Math.abs(body(after, 'box').velocity.x - 4 / 3) < 1e-9, 'measured post-collision velocities');
  assert.equal(body(ev.floorImpact.snapshot, 'ball').position.y, 0.25);
  assert.deepEqual(body(ev.rest.snapshot, 'ball').velocity, { x: body(ev.rest.snapshot, 'ball').velocity.x, y: 0 });
  for (const e of rec.events) assert.equal(body(e.snapshot, 'box').position.y, 0.5, `${e.name}: box stays on the floor`);
  assert.ok(body(ev.end.snapshot, 'box').position.x > 20, 'the box keeps sliding (no friction)');
});

// ---------------------------------------------------------------- frontend integration with recorded snapshots

test('frontend can fit and draw every recorded snapshot; impact frame shows the ball touching the box', () => {
  const rec = loadJson('fixtures/ball-and-box.snapshots.json');
  const size = { width: 640, height: 320 };
  const calls = [];
  const ctx = new Proxy({}, { get: (_, p) => (...a) => calls.push([p, ...a]), set: () => true });
  for (const e of rec.events) {
    const view = fitView(e.snapshot, size);
    assert.doesNotThrow(() => drawScene(ctx, e.snapshot, view), e.name);
  }
  const impact = rec.events.find((e) => e.name === 'impact').snapshot;
  const view = fitView(impact, size);
  const ball = body(impact, 'ball');
  const box = body(impact, 'box');
  const boxLeftPx = view.toCanvas(box.position.x - box.dimensions.width / 2, 0).x;
  const ballRightPx = view.toCanvas(ball.position.x + ball.dimensions.radius, 0).x;
  assert.ok(Math.abs(ballRightPx - boxLeftPx) <= 1, `ball right edge ${ballRightPx}px vs box left face ${boxLeftPx}px`);
  assert.ok(view.toCanvas(0, 0).y === view.floorPx, 'floor row from the view');
});

// ---------------------------------------------------------------- diagnostics are actionable

test('every command diagnostic says how to fix it', () => {
  const bad = prog(
    circle({ y: 0.1 }),
    circle({ blockId: 'c2', id: 'ball', x: 3 }),
    { op: 'jump', blockId: 'j' },
    box({ blockId: 'b2', id: 'crate', restitution: 2 }),
    { op: 'setGravity', blockId: 'g' },
  );
  const msgs = messages(bad);
  const hints = [/Set y to at least 0\.5/, /Give this body a different name/, /Use one of: createCircle, createBox, setGravity, setVelocity, applyForce/, /Use a value in that range/, /Add a value for "x"/];
  for (const re of hints) assert.ok(msgs.some((m) => re.test(m)), `missing hint ${re}\n${msgs.join('\n')}`);
});
