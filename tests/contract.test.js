import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProgram, ERROR_CODES as E, LIMITS, FLOOR_Y, createViewTransform } from '../static/js/motionlab/index.js';
import { loadJson } from './helpers.js';

const fixture = loadJson('fixtures/ball-and-box.program.json');
const codes = (r) => r.errors.map((e) => [e.code, e.blockId]);
const circle = (blockId, id, extra = {}) => ({
  op: 'createCircle', blockId, id, x: 0, y: 1, radius: 0.5, mass: 1, restitution: 0.5, static: false, ...extra,
});
const prog = (...commands) => ({ version: 1, commands });

test('canonical fixture is valid', () => {
  assert.deepEqual(validateProgram(fixture), { ok: true, errors: [] });
});

test('empty command list is valid', () => {
  assert.deepEqual(validateProgram(prog()), { ok: true, errors: [] });
});

test('document-level errors have null blockId and stop validation', () => {
  for (const bad of [null, undefined, 42, 'x', [], { version: 1 }, { version: 1, commands: {} }]) {
    const r = validateProgram(bad);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].blockId, null);
  }
  assert.deepEqual(codes(validateProgram({ version: 1, commands: [], extra: 1 })), [[E.INVALID_DOCUMENT, null]]);
  assert.deepEqual(codes(validateProgram({ version: '1', commands: [] })), [[E.UNSUPPORTED_VERSION, null]]);
  assert.deepEqual(codes(validateProgram({ commands: [] })), [[E.UNSUPPORTED_VERSION, null]]);
  const many = Array.from({ length: LIMITS.maxCommands + 1 }, (_, i) => ({ op: 'setGravity', blockId: `g${i}`, x: 0, y: 0 }));
  assert.deepEqual(codes(validateProgram(prog(...many))), [[E.TOO_MANY_COMMANDS, null]]);
  assert.equal(validateProgram(prog(...many.slice(1))).ok, true);
});

test('every error has exactly code, message and blockId', () => {
  const r = validateProgram(prog(circle('a', 'b', { radius: -1 })));
  for (const e of r.errors) {
    assert.deepEqual(Object.keys(e).sort(), ['blockId', 'code', 'message']);
    assert.equal(typeof e.message, 'string');
  }
});

test('command shape errors', () => {
  assert.deepEqual(codes(validateProgram(prog(null))), [[E.INVALID_COMMAND, null]]);
  assert.deepEqual(codes(validateProgram(prog({ op: 'setGravity', x: 0, y: 0 }))), [[E.INVALID_COMMAND, null]]);
  assert.deepEqual(codes(validateProgram(prog({ op: 'explode', blockId: 'z' }))), [[E.UNKNOWN_OP, 'z']]);
  assert.deepEqual(codes(validateProgram(prog({ op: 'toString', blockId: 'z' }))), [[E.UNKNOWN_OP, 'z']]);
  assert.deepEqual(codes(validateProgram(prog({ op: 'setGravity', blockId: 'g', x: 0 }))), [[E.MISSING_FIELD, 'g']]);
  assert.deepEqual(codes(validateProgram(prog({ op: 'setGravity', blockId: 'g', x: 0, y: 0, z: 1 }))), [[E.UNKNOWN_FIELD, 'g']]);
  assert.deepEqual(codes(validateProgram(prog(circle('a', 'b'), circle('a', 'c')))), [[E.DUPLICATE_BLOCK_ID, 'a']]);
});

test('numeric type and range errors', () => {
  for (const v of ['1', NaN, Infinity, null, true]) {
    assert.deepEqual(codes(validateProgram(prog(circle('a', 'b', { x: v })))), [[E.INVALID_TYPE, 'a']], String(v));
  }
  assert.deepEqual(codes(validateProgram(prog(circle('a', 'b', { static: 'yes' })))), [[E.INVALID_TYPE, 'a']]);
  const cases = [
    { x: LIMITS.position + 1 }, { radius: 0 }, { radius: LIMITS.radius.max + 1 },
    { mass: 0 }, { restitution: 1.01 }, { restitution: -0.1 },
  ];
  for (const c of cases) {
    assert.deepEqual(codes(validateProgram(prog(circle('a', 'b', c)))), [[E.OUT_OF_RANGE, 'a']], JSON.stringify(c));
  }
  assert.deepEqual(codes(validateProgram(prog({ op: 'setGravity', blockId: 'g', x: 0, y: -101 }))), [[E.OUT_OF_RANGE, 'g']]);
  // Boundary values are allowed.
  assert.equal(validateProgram(prog(circle('a', 'b', { x: -LIMITS.position, restitution: 1 }))).ok, true);
});

test('body id rules', () => {
  for (const id of ['', '1ball', 'has space', 'x'.repeat(LIMITS.maxBodyIdLength + 1), 5]) {
    assert.deepEqual(codes(validateProgram(prog(circle('a', id)))), [[E.INVALID_ID, 'a']], String(id));
  }
  assert.deepEqual(codes(validateProgram(prog(circle('a', 'b'), circle('c', 'b')))), [[E.DUPLICATE_BODY_ID, 'c']]);
});

test('references resolve in stack order; static targets rejected', () => {
  const vel = { op: 'setVelocity', blockId: 'v', id: 'b', vx: 1, vy: 0 };
  assert.deepEqual(codes(validateProgram(prog(vel, circle('a', 'b')))), [[E.UNKNOWN_BODY, 'v']]);
  assert.equal(validateProgram(prog(circle('a', 'b'), vel)).ok, true);
  const force = { op: 'applyForce', blockId: 'f', id: 'b', fx: 1, fy: 0 };
  assert.deepEqual(codes(validateProgram(prog(circle('a', 'b', { static: true }), force))), [[E.STATIC_BODY_TARGET, 'f']]);
});

test('body count limit', () => {
  const bodies = Array.from({ length: LIMITS.maxBodies + 1 }, (_, i) => circle(`c${i}`, `b${i}`, { x: i }));
  assert.deepEqual(codes(validateProgram(prog(...bodies))), [[E.TOO_MANY_BODIES, `c${LIMITS.maxBodies}`]]);
  assert.equal(validateProgram(prog(...bodies.slice(1))).ok, true);
});

test('dynamic bodies may not start below the floor; static bodies may', () => {
  assert.deepEqual(codes(validateProgram(prog(circle('a', 'b', { y: 0.4 })))), [[E.BODY_BELOW_FLOOR, 'a']]);
  assert.equal(validateProgram(prog(circle('a', 'b', { y: 0.5 }))).ok, true); // touching is fine
  assert.equal(validateProgram(prog(circle('a', 'b', { y: -3, static: true }))).ok, true);
});

test('errors are collected across commands in stack order', () => {
  const r = validateProgram(prog(circle('a', 'b', { mass: -1 }), { op: 'nope', blockId: 'n' }, circle('c', 'd', { y: 0 })));
  assert.deepEqual(codes(r), [[E.OUT_OF_RANGE, 'a'], [E.UNKNOWN_OP, 'n'], [E.BODY_BELOW_FLOOR, 'c']]);
});

test('a create block with a bad value does not cascade UNKNOWN_BODY to blocks below', () => {
  const r = validateProgram(prog(
    circle('a', 'b', { radius: -1 }),
    { op: 'setVelocity', blockId: 'v', id: 'b', vx: 1, vy: 0 },
  ));
  assert.deepEqual(codes(r), [[E.OUT_OF_RANGE, 'a']]);
});

test('validateProgram does not mutate input', () => {
  const copy = structuredClone(fixture);
  validateProgram(copy);
  assert.deepEqual(copy, fixture);
});

test('view transform maps the floor and round-trips', () => {
  const view = createViewTransform({ heightPx: 400, pixelsPerMeter: 50, originXPx: 20, floorMarginPx: 40 });
  assert.equal(view.floorPx, 360);
  assert.deepEqual(view.toCanvas(0, FLOOR_Y), { x: 20, y: 360 });
  assert.deepEqual(view.toCanvas(2, 1), { x: 120, y: 310 }); // +y up in world = smaller canvas y
  assert.deepEqual(view.toWorld(120, 310), { x: 2, y: 1 });
  assert.equal(view.lengthToPx(0.25), 12.5);
});
