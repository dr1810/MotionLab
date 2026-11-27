import test from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkspace, BLOCK_TYPES, START_BLOCK_TYPE } from '../static/js/motionlab/compile.js';
import { OPS, ERROR_CODES as E } from '../static/js/motionlab/contract.js';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { program, workspace, expected } from './helpers.js';

const ws = (...top) => ({ blocks: { languageVersion: 0, blocks: top } });
const chain = (...blocks) => {
  for (let i = blocks.length - 1; i > 0; i--) blocks[i - 1].next = { block: blocks[i] };
  return blocks[0];
};
const start = (id = 'start') => ({ type: START_BLOCK_TYPE, id });
const gravity = (id, fields = { X: 0, Y: -1 }) => ({ type: 'motionlab_set_gravity', id, fields });
const pairs = (r) => r.errors.map((e) => [e.code, e.blockId]);

test('block types cover every op and every field', () => {
  const ops = Object.values(BLOCK_TYPES).map((t) => t.op).sort();
  assert.deepEqual(ops, Object.keys(OPS).sort());
  for (const t of Object.values(BLOCK_TYPES)) {
    assert.deepEqual(Object.values(t.fields).sort(), Object.keys(OPS[t.op]).sort(), t.op);
  }
});

test('canonical workspace compiles to the canonical program and simulates', () => {
  const r = compileWorkspace(workspace());
  assert.deepEqual(r, { ok: true, program: program(), errors: [] });
  assert.deepEqual(createSimulation(r.program).snapshot(), expected().initial);
});

test('empty start stack compiles to the valid empty program', () => {
  assert.deepEqual(compileWorkspace(ws(start())), { ok: true, program: { version: 1, commands: [] }, errors: [] });
});

test('missing start block (including an empty workspace) is a document-level error', () => {
  for (const w of [{}, ws(), ws(gravity('g'))]) {
    const r = compileWorkspace(w);
    assert.equal(r.program, null);
    assert.deepEqual(pairs(r), [[E.NO_START_BLOCK, null]]);
  }
});

test('more than one start block flags each start block', () => {
  const r = compileWorkspace(ws(start('s1'), start('s2')));
  assert.equal(r.program, null);
  assert.deepEqual(pairs(r), [[E.MULTIPLE_START_BLOCKS, 's1'], [E.MULTIPLE_START_BLOCKS, 's2']]);
});

test('non-workspace input', () => {
  for (const w of [null, 3, [], { blocks: 5 }, { blocks: { blocks: {} } }]) {
    const r = compileWorkspace(w);
    assert.equal(r.program, null);
    assert.deepEqual(pairs(r), [[E.INVALID_WORKSPACE, null]]);
  }
});

test('only the connected start stack is compiled; loose stacks are ignored', () => {
  const r = compileWorkspace(ws(chain(start(), gravity('g1')), chain(gravity('loose1'), gravity('loose2'))));
  assert.deepEqual(r.program.commands.map((c) => c.blockId), ['g1']);
  assert.equal(r.ok, true);
});

test('disabled blocks are skipped (old and new Blockly formats)', () => {
  const r = compileWorkspace(ws(chain(start(), { ...gravity('a'), enabled: false }, gravity('b'), { ...gravity('c'), disabledReasons: ['MANUALLY_DISABLED'] }, gravity('d'))));
  assert.deepEqual(r.program.commands.map((c) => c.blockId), ['b', 'd']);
});

test('unknown block type in the stack is reported with its block id', () => {
  const r = compileWorkspace(ws(chain(start(), { type: 'math_number', id: 'm' }, gravity('g'))));
  assert.deepEqual(pairs(r), [[E.UNKNOWN_BLOCK_TYPE, 'm']]);
  assert.equal(r.ok, false);
});

test('validation errors point at the Blockly block', () => {
  const r = compileWorkspace(ws(chain(start(),
    { type: 'motionlab_create_circle', id: 'blk-c', fields: { ID: 'ball', X: 0, Y: 1, RADIUS: 0, MASS: 1, RESTITUTION: 0.5, STATIC: false } },
    { type: 'motionlab_set_velocity', id: 'blk-v', fields: { ID: 'ghost', VX: 1, VY: 0 } },
    { type: 'motionlab_set_gravity', id: 'blk-g', fields: { X: 0 } },
  )));
  assert.deepEqual(pairs(r), [[E.OUT_OF_RANGE, 'blk-c'], [E.UNKNOWN_BODY, 'blk-v'], [E.MISSING_FIELD, 'blk-g']]);
  assert.equal(r.program.commands.length, 3, 'invalid program is still returned for display/export');
});

test('checkbox values: booleans and legacy TRUE/FALSE strings', () => {
  const mk = (s) => compileWorkspace(ws(chain(start(), { type: 'motionlab_create_box', id: 'b', fields: { ID: 'box', X: 0, Y: 1, WIDTH: 1, HEIGHT: 1, MASS: 1, RESTITUTION: 0, STATIC: s } })));
  assert.equal(mk(true).program.commands[0].static, true);
  assert.equal(mk('TRUE').program.commands[0].static, true);
  assert.equal(mk('FALSE').program.commands[0].static, false);
  assert.deepEqual(pairs(mk('yes')), [[E.INVALID_TYPE, 'b']]);
});
