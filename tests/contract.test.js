import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProgram, LIMITS, ERROR_CODES as E, OPS, DT, FLOOR_Y, CONTRACT_VERSION, PROGRAM_VERSION } from '../static/js/motionlab/contract.js';
import { program, prog, circle, box, codes } from './helpers.js';

test('constants', () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(PROGRAM_VERSION, 1);
  assert.equal(DT, 1 / 120);
  assert.equal(FLOOR_Y, 0);
  assert.deepEqual(Object.keys(OPS), ['createCircle', 'createBox', 'setGravity', 'setVelocity', 'applyForce']);
});

test('canonical fixture is valid', () => {
  assert.deepEqual(validateProgram(program()), { ok: true, errors: [] });
});

test('empty program is valid', () => {
  assert.deepEqual(validateProgram(prog()), { ok: true, errors: [] });
});

test('document-level errors have null blockId', () => {
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    const r = validateProgram(bad);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.INVALID_DOCUMENT, null]]);
  }
  assert.deepEqual(codes(validateProgram({ version: 2, commands: [] })), [E.UNSUPPORTED_VERSION]);
  assert.deepEqual(codes(validateProgram({ commands: [] })), [E.UNSUPPORTED_VERSION]);
  assert.deepEqual(codes(validateProgram({ version: 1 })), [E.INVALID_COMMANDS]);
  assert.deepEqual(codes(validateProgram({ version: 1, commands: {} })), [E.INVALID_COMMANDS]);
  assert.deepEqual(codes(validateProgram({ version: 1, commands: [], extra: 1 })), [E.INVALID_DOCUMENT]);
  const many = Array.from({ length: LIMITS.maxCommands + 1 }, (_, i) => ({ op: 'setGravity', blockId: `g${i}`, x: 0, y: 0 }));
  const r = validateProgram(prog(...many));
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.TOO_MANY_COMMANDS, null]]);
  assert.equal(validateProgram(prog(...many.slice(1))).ok, true);
});

test('every error has exactly code, message, blockId', () => {
  const r = validateProgram(prog(circle({ radius: -1 }), { op: 'nope', blockId: 'n' }, 7));
  assert.ok(r.errors.length >= 3);
  for (const e of r.errors) {
    assert.deepEqual(Object.keys(e), ['code', 'message', 'blockId']);
    assert.equal(typeof e.message, 'string');
    assert.ok(e.message.length > 0);
  }
});

test('command shape and blockId errors', () => {
  assert.deepEqual(validateProgram(prog(7)).errors.map((e) => [e.code, e.blockId]), [[E.INVALID_COMMAND, null]]);
  assert.deepEqual(validateProgram(prog(circle({ blockId: '' }))).errors.map((e) => [e.code, e.blockId]), [[E.INVALID_BLOCK_ID, null]]);
  assert.deepEqual(codes(validateProgram(prog(circle({ blockId: 'x'.repeat(65) })))), [E.INVALID_BLOCK_ID]);
  const dup = validateProgram(prog(circle({ blockId: 'same' }), box({ blockId: 'same', x: 3 })));
  assert.deepEqual(dup.errors.map((e) => [e.code, e.blockId]), [[E.DUPLICATE_BLOCK_ID, 'same']]);
  assert.deepEqual(validateProgram(prog({ op: 'explode', blockId: 'k' })).errors.map((e) => [e.code, e.blockId]), [[E.UNKNOWN_OP, 'k']]);
  assert.deepEqual(codes(validateProgram(prog({ op: 'toString', blockId: 'k' }))), [E.UNKNOWN_OP]);
  assert.deepEqual(codes(validateProgram(prog(circle({ color: 'red' })))), [E.UNKNOWN_FIELD]);
});

test('field errors carry the command blockId', () => {
  const { radius, ...noRadius } = circle();
  const cases = [
    [noRadius, E.MISSING_FIELD],
    [circle({ radius: undefined }), E.MISSING_FIELD],
    [circle({ x: '1' }), E.INVALID_NUMBER],
    [circle({ x: NaN }), E.INVALID_NUMBER],
    [circle({ x: Infinity }), E.INVALID_NUMBER],
    [circle({ x: null }), E.INVALID_NUMBER],
    [circle({ x: 1001 }), E.OUT_OF_RANGE],
    [circle({ radius: 0 }), E.OUT_OF_RANGE],
    [circle({ mass: 0 }), E.OUT_OF_RANGE],
    [circle({ restitution: 1.1 }), E.OUT_OF_RANGE],
    [circle({ static: 'true' }), E.INVALID_TYPE],
    [circle({ id: 5 }), E.INVALID_TYPE],
    [circle({ id: '9lives' }), E.INVALID_BODY_ID],
    [circle({ id: 'a b' }), E.INVALID_BODY_ID],
    [circle({ id: 'x'.repeat(33) }), E.INVALID_BODY_ID],
  ];
  for (const [cmd, code] of cases) {
    const r = validateProgram(prog(cmd));
    assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[code, 'c']], JSON.stringify(cmd));
  }
});

test('numeric limits are inclusive', () => {
  const edge = prog(
    circle({ x: -1000, y: 1000, radius: 0.01, mass: 0.001, restitution: 0 }),
    box({ id: 'b2', x: 1000, y: 50, width: 100, height: 100, mass: 10000, restitution: 1 }),
    { op: 'setGravity', blockId: 'g', x: -100, y: 100 },
    { op: 'setVelocity', blockId: 'v', id: 'ball', vx: -1000, vy: 1000 },
    { op: 'applyForce', blockId: 'f', id: 'ball', fx: -100000, fy: 100000 },
  );
  assert.deepEqual(validateProgram(edge).errors, []);
  assert.deepEqual(codes(validateProgram(prog({ op: 'setGravity', blockId: 'g', x: 0, y: -100.5 }))), [E.OUT_OF_RANGE]);
  assert.deepEqual(codes(validateProgram(prog(circle(), { op: 'applyForce', blockId: 'f', id: 'ball', fx: 1e6, fy: 0 }))), [E.OUT_OF_RANGE]);
});

test('cross-command rules follow stack order', () => {
  const ref = (op, id, blockId = 'r') => (op === 'setVelocity' ? { op, blockId, id, vx: 1, vy: 0 } : { op, blockId, id, fx: 1, fy: 0 });
  for (const op of ['setVelocity', 'applyForce']) {
    assert.deepEqual(validateProgram(prog(ref(op, 'ball'))).errors.map((e) => [e.code, e.blockId]), [[E.UNKNOWN_BODY, 'r']]);
    assert.deepEqual(codes(validateProgram(prog(ref(op, 'ball'), circle()))), [E.UNKNOWN_BODY], 'reference before create');
    assert.deepEqual(codes(validateProgram(prog(circle({ static: true }), ref(op, 'ball')))), [E.STATIC_BODY]);
    assert.equal(validateProgram(prog(circle(), ref(op, 'ball'))).ok, true);
  }
  assert.deepEqual(validateProgram(prog(circle(), box({ id: 'ball', x: 3 }))).errors.map((e) => [e.code, e.blockId]), [[E.DUPLICATE_BODY_ID, 'b']]);
});

test('body count limit', () => {
  const bodies = Array.from({ length: LIMITS.maxBodies }, (_, i) => circle({ blockId: `c${i}`, id: `b${i}`, x: i * 2 }));
  assert.equal(validateProgram(prog(...bodies)).ok, true);
  const r = validateProgram(prog(...bodies, circle({ blockId: 'extra', id: 'extra', x: 99 })));
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.TOO_MANY_BODIES, 'extra']]);
});

test('bodies may not start below the floor', () => {
  assert.deepEqual(codes(validateProgram(prog(circle({ y: 0.49 })))), [E.BELOW_FLOOR]);
  assert.deepEqual(codes(validateProgram(prog(box({ y: 0.4, static: true })))), [E.BELOW_FLOOR]);
  assert.equal(validateProgram(prog(circle({ y: 0.5 }), box({ x: 5, y: 0.5 }))).ok, true, 'touching the floor is fine');
});

test('errors are collected, not first-only, in stable order', () => {
  const r = validateProgram(prog(circle({ radius: 0, mass: -1 }), { op: 'nope', blockId: 'n' }));
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.OUT_OF_RANGE, 'c'], [E.OUT_OF_RANGE, 'c'], [E.UNKNOWN_OP, 'n']]);
});

test('validation does not mutate the program', () => {
  const p = program();
  const before = JSON.stringify(p);
  validateProgram(p);
  assert.equal(JSON.stringify(p), before);
});
