import test from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkspace, createSimulation, ERROR_CODES as E } from '../static/js/motionlab/index.js';
import { loadJson } from './helpers.js';

const fixture = loadJson('fixtures/ball-and-box.program.json');

// Build a Blockly-style serialized stack: { type, id, fields, next: { block } }.
function chain(blocks) {
  let next;
  for (let i = blocks.length - 1; i >= 0; i--) {
    next = { ...blocks[i], ...(next ? { next: { block: next } } : {}) };
  }
  return next;
}
const start = (id, below = []) => chain([{ type: 'motionlab_start', id, x: 10, y: 10 }, ...below]);
const ws = (...top) => ({ blocks: { languageVersion: 0, blocks: top } });

const fixtureBlocks = [
  { type: 'motionlab_set_gravity', id: 'blk-gravity', fields: { X: 0, Y: -9.81 } },
  { type: 'motionlab_create_box', id: 'blk-box', fields: { ID: 'box', X: 2, Y: 0.5, WIDTH: 1, HEIGHT: 1, MASS: 2, RESTITUTION: 0.2, STATIC: false } },
  { type: 'motionlab_create_circle', id: 'blk-ball', fields: { ID: 'ball', X: 0, Y: 3, RADIUS: 0.25, MASS: 1, RESTITUTION: 0.6, STATIC: 'FALSE' } },
  { type: 'motionlab_set_velocity', id: 'blk-velocity', fields: { ID: 'ball', VX: 1.5, VY: 0 } },
  { type: 'motionlab_apply_force', id: 'blk-force', fields: { ID: 'ball', FX: 120, FY: 0 } },
];

test('connected start stack compiles to the canonical fixture', () => {
  const r = compileWorkspace(ws(start('s', fixtureBlocks)));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.program, fixture);
  createSimulation(r.program); // does not throw
});

test('accepts the inner {blocks: [...]} object too', () => {
  const r = compileWorkspace({ languageVersion: 0, blocks: [start('s', fixtureBlocks)] });
  assert.deepEqual(r.program, fixture);
});

test('stacks not attached to start are ignored; start alone is an empty program', () => {
  const loose = chain([{ type: 'motionlab_set_gravity', id: 'loose', fields: { X: 0, Y: 0 } }]);
  const r = compileWorkspace(ws(loose, start('s')));
  assert.deepEqual(r, { ok: true, program: { version: 1, commands: [] }, errors: [] });
});

test('disabled blocks are skipped', () => {
  const blocks = [
    { type: 'motionlab_set_gravity', id: 'g1', enabled: false, fields: { X: 0, Y: 0 } },
    { type: 'motionlab_set_gravity', id: 'g2', disabledReasons: ['MANUALLY_DISABLED'], fields: { X: 0, Y: 0 } },
    { type: 'motionlab_set_gravity', id: 'g3', fields: { X: 1, Y: 0 } },
  ];
  const r = compileWorkspace(ws(start('s', blocks)));
  assert.deepEqual(r.program.commands.map((c) => c.blockId), ['g3']);
});

test('no start block / multiple start blocks / empty workspace', () => {
  assert.deepEqual(compileWorkspace(ws()).errors.map((e) => [e.code, e.blockId]), [[E.NO_START_BLOCK, null]]);
  assert.deepEqual(compileWorkspace({}).errors.map((e) => [e.code, e.blockId]), [[E.NO_START_BLOCK, null]]);
  const r = compileWorkspace(ws(start('s1'), start('s2'), start('s3')));
  assert.equal(r.program, null);
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.MULTIPLE_START_BLOCKS, 's2'], [E.MULTIPLE_START_BLOCKS, 's3']]);
  assert.deepEqual(compileWorkspace(null).errors.map((e) => [e.code, e.blockId]), [[E.INVALID_DOCUMENT, null]]);
});

test('unknown block type in the stack is reported with its blockId', () => {
  const r = compileWorkspace(ws(start('s', [{ type: 'mystery', id: 'm' }])));
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.UNKNOWN_BLOCK_TYPE, 'm']]);
  assert.equal(r.program, null);
});

test('validation errors point at the offending block', () => {
  const r = compileWorkspace(ws(start('s', [
    { type: 'motionlab_set_velocity', id: 'v', fields: { ID: 'ghost', VX: 1, VY: 0 } },
    { type: 'motionlab_create_circle', id: 'c', fields: { ID: 'ball', X: 0, Y: 1, RADIUS: 0.5, MASS: 1, RESTITUTION: 0.5 } },
  ])));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.UNKNOWN_BODY, 'v'], [E.MISSING_FIELD, 'c']]);
});
