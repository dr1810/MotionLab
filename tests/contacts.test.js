// Contact detection (normals, depths, degenerate cases) and resolution (impulses, restitution, overlap
// correction, floor rest, static bodies, elastic momentum/energy, tunneling limits).
import test from 'node:test';
import assert from 'node:assert/strict';
import { contactBetween, floorContact, halfExtents, maxSafeRelativeSpeed } from '../static/js/motionlab/collision.js';
import { createSimulation, REST_SPEED, SOLVER_ITERATIONS, POSITION_ITERATIONS } from '../static/js/motionlab/engine.js';
import { DT } from '../static/js/motionlab/contract.js';
import { program, prog, circle, box } from './helpers.js';

const C = (x, y, radius) => ({ shape: 'circle', x, y, radius, width: 0, height: 0 });
const B = (x, y, width, height) => ({ shape: 'box', x, y, radius: 0, width, height });
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;

function assertContact(c, nx, ny, depth, msg) {
  assert.ok(c, `${msg}: expected a contact`);
  assert.ok(near(c.nx, nx) && near(c.ny, ny), `${msg}: normal (${c.nx}, ${c.ny}) vs (${nx}, ${ny})`);
  assert.ok(near(c.depth, depth), `${msg}: depth ${c.depth} vs ${depth}`);
  assert.ok(near(Math.hypot(c.nx, c.ny), 1), `${msg}: unit normal`);
}

/** Swapping the bodies must negate the normal and keep the depth. */
function assertSymmetric(a, b, msg) {
  const ab = contactBetween(a, b);
  const ba = contactBetween(b, a);
  if (!ab) return assert.equal(ba, null, msg);
  assertContact(ba, -ab.nx, -ab.ny, ab.depth, `${msg} (swapped)`);
}

const gravity0 = { op: 'setGravity', blockId: 'g', x: 0, y: 0 };
const vel = (id, vx, vy, blockId = `v-${id}`) => ({ op: 'setVelocity', blockId, id, vx, vy });
const body = (snap, id) => snap.bodies.find((b) => b.id === id);
const run = (sim, n) => { let s = sim.snapshot(); for (let i = 0; i < n; i++) s = sim.step(); return s; };

// ---------------------------------------------------------------- detection

test('circle-circle: axis, diagonal, apart, touching, coincident', () => {
  assertContact(contactBetween(C(0, 0, 1), C(1.5, 0, 1)), 1, 0, 0.5, 'along +x');
  assertContact(contactBetween(C(0, 0, 3), C(-3, -4, 3)), -0.6, -0.8, 1, '3-4-5 diagonal');
  assert.equal(contactBetween(C(0, 0, 1), C(3, 0, 1)), null, 'apart');
  assert.equal(contactBetween(C(0, 0, 1), C(2, 0, 1)), null, 'touching is not a contact');
  assertContact(contactBetween(C(2, 2, 0.5), C(2, 2, 0.25)), 0, 1, 0.75, 'coincident centers -> (0, 1), rA + rB');
  assertSymmetric(C(0, 0, 1), C(1.5, 0.3, 1), 'circle-circle');
});

test('box-box: least-overlap axis, sign, tie, touching, symmetry', () => {
  assertContact(contactBetween(B(0, 0, 2, 2), B(1.8, 0.5, 2, 2)), 1, 0, 0.2, 'x overlap smaller -> +x');
  assertContact(contactBetween(B(0, 0, 2, 2), B(-0.5, -1.7, 2, 2)), 0, -1, 0.3, 'y overlap smaller -> -y');
  assertContact(contactBetween(B(0, 0, 2, 2), B(0, 0, 2, 2)), 0, 1, 2, 'coincident equal boxes: tie picks +y');
  assertContact(contactBetween(B(0, 0, 4, 1), B(0, 0, 1, 1)), 0, 1, 1, 'coincident, y overlap smaller');
  assert.equal(contactBetween(B(0, 0, 2, 2), B(2, 0, 2, 2)), null, 'edge to edge is not a contact');
  assert.equal(contactBetween(B(0, 0, 2, 2), B(1.5, 3, 2, 2)), null, 'apart in y');
  assertSymmetric(B(0, 0, 2, 2), B(1.8, 0.5, 2, 2), 'box-box');
});

test('circle-box: face, corner, apart, inside, centered, symmetry', () => {
  const box2 = B(0, 0, 2, 2);
  assertContact(contactBetween(box2, C(1.3, 0.2, 0.5)), 1, 0, 0.2, 'right face');
  assertContact(contactBetween(box2, C(0.1, -1.4, 0.5)), 0, -1, 0.1, 'bottom face');
  assertContact(contactBetween(box2, C(1.3, 1.4, 0.6)), 0.6, 0.8, 0.1, 'corner: normal from the corner to the center');
  assert.equal(contactBetween(box2, C(1.5, 1.5, 0.5)), null, 'diagonal from the corner but out of reach');
  assert.equal(contactBetween(box2, C(1.5, 0, 0.5)), null, 'touching the face');
  assertContact(contactBetween(box2, C(0.7, 0.1, 0.2)), 1, 0, 0.5, 'center inside, nearest face +x: depth r + 0.3');
  assertContact(contactBetween(box2, C(-0.2, -0.9, 0.2)), 0, -1, 0.3, 'center inside, nearest face -y');
  assertContact(contactBetween(box2, C(0, 0, 0.25)), 0, 1, 1.25, 'center at box center: tie picks +y, depth r + hh');
  assertContact(contactBetween(B(0, 0, 4, 1), C(0, 0, 0.1)), 0, 1, 0.6, 'flat box: nearest face is y');
  // circle-first order is the exact negation
  assertContact(contactBetween(C(1.3, 0.2, 0.5), box2), -1, 0, 0.2, 'circle first');
  for (const c of [C(1.3, 0.2, 0.5), C(1.3, 1.4, 0.6), C(0.7, 0.1, 0.2), C(0, 0, 0.25)]) assertSymmetric(box2, c, 'circle-box');
});

test('floor: penetration below y = 0, none when touching or above', () => {
  assertContact(floorContact(C(0, 0.2, 0.25)), 0, 1, 0.05, 'circle');
  assertContact(floorContact(B(0, 0.4, 3, 1)), 0, 1, 0.1, 'box uses half height');
  assert.equal(floorContact(C(0, 0.25, 0.25)), null, 'resting exactly on the floor');
  assert.equal(floorContact(B(0, 2, 1, 1)), null, 'above');
  assert.deepEqual(halfExtents(B(0, 0, 3, 1)), { hx: 1.5, hy: 0.5 });
});

test('solver iteration counts are small and bounded', () => {
  assert.ok(Number.isInteger(SOLVER_ITERATIONS) && SOLVER_ITERATIONS >= 1 && SOLVER_ITERATIONS <= 16);
  assert.ok(Number.isInteger(POSITION_ITERATIONS) && POSITION_ITERATIONS >= 1 && POSITION_ITERATIONS <= 8);
});

// ---------------------------------------------------------------- resolution

test('floor bounce: rebound speed = restitution x closing speed; peak height falls by about e^2', () => {
  const e = 0.8;
  const sim = createSimulation(prog(circle({ y: 5, radius: 0.25, restitution: e })));
  let prev = body(sim.snapshot(), 'ball');
  let bounce = null;
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    const b = body(sim.step(), 'ball');
    if (!bounce && prev.velocity.y < 0 && b.velocity.y > 0) bounce = { before: prev.velocity.y, after: b.velocity.y };
    if (bounce && b.velocity.y <= 0 && prev.velocity.y > 0) { peak = b.position.y; break; }
    prev = b;
  }
  // Closing speed at contact = last pre-contact speed + one tick of gravity (integration happens first).
  const closing = -(bounce.before - 9.81 * DT);
  assert.ok(near(bounce.after, e * closing, 1e-9), `after ${bounce.after} vs e*closing ${e * closing}`);
  const ratio = (peak - 0.25) / (5 - 0.25);
  assert.ok(Math.abs(ratio - e * e) < 0.02, `peak ratio ${ratio} vs e^2 ${e * e} (tolerance 0.02)`);
});

test('floor rest: bodies settle exactly on the floor and then never jitter', () => {
  const sim = createSimulation(prog(
    circle({ y: 2, radius: 0.25, restitution: 0.5 }),
    box({ x: 3, y: 1.5, width: 1, height: 0.5, restitution: 0.3 }),
  ));
  run(sim, 600);
  const settled = sim.snapshot();
  assert.equal(body(settled, 'ball').position.y, 0.25);
  assert.equal(body(settled, 'box').position.y, 0.25);
  for (let i = 0; i < 600; i++) {
    const s = sim.step();
    for (const id of ['ball', 'box']) {
      assert.deepEqual(body(s, id).position, body(settled, id).position, `${id} tick ${i}`);
      assert.deepEqual(body(s, id).velocity, { x: 0, y: 0 }, `${id} tick ${i}`);
    }
  }
});

test('below REST_SPEED nothing bounces (the documented rest rule)', () => {
  const slow = REST_SPEED / 2;
  const sim = createSimulation(prog(gravity0, circle({ y: 0.25 + slow * DT / 2, radius: 0.25, restitution: 1 }), vel('ball', 0, -slow)));
  const b = body(sim.step(), 'ball');
  assert.equal(b.velocity.y, 0);
  assert.equal(b.position.y, 0.25);
});

test('static vs dynamic: elastic wall reflects exactly, inelastic wall stops, wall never moves', () => {
  for (const [e, expectVx] of [[1, -3], [0, 0]]) {
    const sim = createSimulation(prog(
      gravity0,
      box({ blockId: 'w', id: 'wall', x: 3, y: 5, width: 0.5, height: 4, static: true, restitution: 0 }),
      circle({ id: 'ball', x: 0, y: 5, radius: 0.25, restitution: e }),
      vel('ball', 3, 0),
    ));
    const s = run(sim, 240);
    const ball = body(s, 'ball');
    assert.ok(near(ball.velocity.x, expectVx, 1e-9), `e=${e}: vx ${ball.velocity.x}`);
    assert.equal(ball.velocity.y, 0);
    assert.deepEqual(body(s, 'wall').position, { x: 3, y: 5 });
    assert.deepEqual(body(s, 'wall').velocity, { x: 0, y: 0 });
    if (e === 0) {
      // Stopped against the face: overlap no deeper than the solver slop.
      assert.ok(ball.position.x + 0.25 - 2.75 <= 0.0005 + 1e-9, `penetration ${ball.position.x + 0.25 - 2.75}`);
    }
  }
});

test('dynamic box lands on a static circle and rests on top of it', () => {
  const sim = createSimulation(prog(
    circle({ blockId: 'p', id: 'post', x: 0, y: 1, radius: 0.5, static: true }),
    box({ id: 'crate', x: 0, y: 3, width: 0.4, height: 0.4 }),
  ));
  const s = run(sim, 600);
  assert.deepEqual(body(s, 'post').position, { x: 0, y: 1 });
  assert.ok(Math.abs(body(s, 'crate').position.y - 1.7) < 0.002, `crate y ${body(s, 'crate').position.y}`);
  assert.ok(Math.abs(body(s, 'crate').velocity.y) < 1e-9);
});

test('separating contacts: overlapping bodies already moving apart keep their velocities', () => {
  const sim = createSimulation(prog(
    gravity0,
    circle({ blockId: 'a', id: 'a', x: 0, y: 5, radius: 0.5 }),
    circle({ blockId: 'b', id: 'b', x: 0.8, y: 5, radius: 0.5 }),
    vel('a', -1, 0),
    vel('b', 2, 0),
  ));
  const s = sim.step();
  assert.deepEqual(body(s, 'a').velocity, { x: -1, y: 0 });
  assert.deepEqual(body(s, 'b').velocity, { x: 2, y: 0 });
});

test('overlap correction is inverse-mass weighted and keeps the center of mass', () => {
  const sim = createSimulation(prog(
    gravity0,
    circle({ blockId: 'a', id: 'light', x: 0, y: 5, radius: 0.5, mass: 1 }),
    circle({ blockId: 'b', id: 'heavy', x: 0.6, y: 5, radius: 0.5, mass: 3 }),
  ));
  const s = sim.step();
  const dLight = body(s, 'light').position.x - 0;
  const dHeavy = body(s, 'heavy').position.x - 0.6;
  assert.ok(dLight < 0 && dHeavy > 0, 'pushed apart along the normal');
  assert.ok(near(-dLight / dHeavy, 3, 1e-9), `light moves 3x as far: ${-dLight / dHeavy}`);
  assert.ok(near(1 * body(s, 'light').position.x + 3 * body(s, 'heavy').position.x, 3 * 0.6, 1e-12), 'center of mass fixed');
  assert.deepEqual(body(s, 'light').velocity, { x: 0, y: 0 }, 'position correction adds no velocity');
});

test('degenerate starts resolve: coincident circles split vertically; a circle inside a box exits the nearest face', () => {
  const twins = createSimulation(prog(
    gravity0,
    circle({ blockId: 'a', id: 'a', x: 0, y: 5, radius: 0.5 }),
    circle({ blockId: 'b', id: 'b', x: 0, y: 5, radius: 0.5 }),
  ));
  const t = run(twins, 60);
  assert.equal(body(t, 'a').position.x, 0);
  assert.equal(body(t, 'b').position.x, 0);
  assert.ok(near(body(t, 'b').position.y - body(t, 'a').position.y, 1, 0.001), 'separated by about rA + rB');
  assert.ok(near(body(t, 'a').position.y + body(t, 'b').position.y, 10, 1e-9), 'equal masses move symmetrically');

  const trapped = createSimulation(prog(
    gravity0,
    box({ blockId: 'w', id: 'block', x: 0, y: 5, width: 2, height: 2, static: true }),
    circle({ id: 'ball', x: 0.8, y: 5.1, radius: 0.1 }),
  ));
  const s = run(trapped, 60);
  assert.ok(body(s, 'ball').position.x >= 1.1 - 0.0005 - 1e-9, `exited +x face: x=${body(s, 'ball').position.x}`);
  assert.equal(body(s, 'ball').position.y, 5.1);
  assert.deepEqual(body(s, 'block').position, { x: 0, y: 5 });
});

test('isolated elastic head-on collision conserves momentum and kinetic energy (relative tolerance 1e-12)', () => {
  const m1 = 1;
  const m2 = 3;
  const u1 = 4;
  const u2 = -1;
  const sim = createSimulation(prog(
    gravity0,
    circle({ blockId: 'a', id: 'a', x: 0, y: 50, radius: 0.5, mass: m1, restitution: 1 }),
    circle({ blockId: 'b', id: 'b', x: 3, y: 50, radius: 0.5, mass: m2, restitution: 1 }),
    vel('a', u1, 0),
    vel('b', u2, 0),
  ));
  const s = run(sim, 240);
  const v1 = body(s, 'a').velocity;
  const v2 = body(s, 'b').velocity;
  const p0 = m1 * u1 + m2 * u2;
  const k0 = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  const p1 = m1 * v1.x + m2 * v2.x;
  const k1 = 0.5 * m1 * v1.x * v1.x + 0.5 * m2 * v2.x * v2.x;
  assert.ok(Math.abs(p1 - p0) <= 1e-12 * Math.abs(k0), `momentum ${p0} -> ${p1}`);
  assert.ok(Math.abs(k1 - k0) <= 1e-12 * k0, `kinetic energy ${k0} -> ${k1}`);
  // Textbook 1D elastic result.
  assert.ok(near(v1.x, ((m1 - m2) * u1 + 2 * m2 * u2) / (m1 + m2), 1e-12), `v1 ${v1.x}`);
  assert.ok(near(v2.x, ((m2 - m1) * u2 + 2 * m1 * u1) / (m1 + m2), 1e-12), `v2 ${v2.x}`);
  assert.equal(v1.y, 0);
  assert.equal(v2.y, 0);
});

test('head-on collision slower than REST_SPEED is perfectly inelastic but still conserves momentum', () => {
  const sim = createSimulation(prog(
    gravity0,
    circle({ blockId: 'a', id: 'a', x: 0, y: 50, radius: 0.5, mass: 1, restitution: 1 }),
    circle({ blockId: 'b', id: 'b', x: 1.05, y: 50, radius: 0.5, mass: 1, restitution: 1 }),
    vel('a', 0.1, 0),
  ));
  const s = run(sim, 240);
  assert.ok(near(body(s, 'a').velocity.x, 0.05, 1e-12));
  assert.ok(near(body(s, 'b').velocity.x, 0.05, 1e-12));
});

// ---------------------------------------------------------------- supported range and tunneling

test('maxSafeRelativeSpeed = smallest half extent / DT', () => {
  assert.equal(maxSafeRelativeSpeed(C(0, 0, 0.25), B(0, 0, 1, 1)), 0.25 * 120);
  assert.equal(maxSafeRelativeSpeed(B(0, 0, 4, 0.1), C(0, 0, 1)), 0.05 * 120);
});

test('fixture stays inside the supported speed range for 20 s', () => {
  const sim = createSimulation(program());
  const rec = (b) => ({ shape: b.shape, radius: b.dimensions.radius ?? 0, width: b.dimensions.width ?? 0, height: b.dimensions.height ?? 0 });
  let worst = 0;
  for (let i = 0; i < 2400; i++) {
    const [boxB, ball] = sim.step().bodies;
    const rel = Math.hypot(ball.velocity.x - boxB.velocity.x, ball.velocity.y - boxB.velocity.y);
    const limit = maxSafeRelativeSpeed(rec(boxB), rec(ball));
    worst = Math.max(worst, rel / limit);
  }
  assert.ok(worst < 0.5, `fixture uses ${(worst * 100).toFixed(1)}% of the safe relative speed (limit 30 m/s)`);
});

test('documented limit: far above the safe speed, a small fast ball tunnels through a thin wall', () => {
  // Safe limit here is 0.01 m / DT = 1.2 m/s; at 40 m/s the ball moves 0.33 m per tick, more than wall + ball.
  const sim = createSimulation(prog(
    gravity0,
    box({ blockId: 'w', id: 'wall', x: 1, y: 5, width: 0.02, height: 2, static: true }),
    circle({ id: 'ball', x: 0, y: 5, radius: 0.05 }),
    vel('ball', 40, 0),
  ));
  const s = run(sim, 12);
  assert.ok(body(s, 'ball').position.x > 1.5, 'passed through (known discrete-step limitation)');
  // At a safe speed the same wall stops it.
  const ok = createSimulation(prog(
    gravity0,
    box({ blockId: 'w', id: 'wall', x: 1, y: 5, width: 0.02, height: 2, static: true }),
    circle({ id: 'ball', x: 0, y: 5, radius: 0.05, restitution: 0 }),
    vel('ball', 1, 0),
  ));
  assert.ok(body(run(ok, 240), 'ball').position.x < 1, 'stopped by the wall at 1 m/s');
});
