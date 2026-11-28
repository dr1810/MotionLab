import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBlock, outlineWorkspace } from '../static/js/motionlab/outline.js';
import { workspace } from './helpers.js';

test('fixture outline: stack in run order with unit-labelled summaries', () => {
  const o = outlineWorkspace(workspace());
  assert.deepEqual(o.loose, []);
  assert.deepEqual(o.stack.map((i) => [i.position, i.id, i.summary]), [
    [1, 'blk-start', 'When simulation starts'],
    [2, 'blk-gravity', 'Set Gravity (0, -9.81) m/s²'],
    [3, 'blk-box', 'Create Box "box" at (2, 0.5) m, 1 × 1 m, 2 kg, restitution 0.2'],
    [4, 'blk-ball', 'Create Ball "ball" at (0, 2) m, radius 0.25 m, 1 kg, restitution 0.6'],
    [5, 'blk-velocity', 'Set Initial Velocity of "ball": (1.5, 0) m/s'],
    [6, 'blk-force', 'Apply Force to "ball": (120, 0) N'],
  ]);
});

test('loose stacks are listed separately, each in order', () => {
  const ws = workspace();
  ws.blocks.blocks.push(
    { type: 'motionlab_set_gravity', id: 'L1', fields: { X: 0, Y: -1 }, next: { block: { type: 'motionlab_create_circle', id: 'L2', fields: { ID: 'pebble', X: 1, Y: 2, RADIUS: 0.1, MASS: 0.2, RESTITUTION: 1, STATIC: true } } } },
    { type: 'motionlab_apply_force', id: 'L3', fields: { ID: 'ball', FX: 5, FY: 0 } },
  );
  const o = outlineWorkspace(ws);
  assert.equal(o.stack.length, 6);
  assert.deepEqual(o.loose.map((s) => s.map((i) => `${i.position}:${i.id}`)), [['1:L1', '2:L2'], ['1:L3']]);
  assert.match(o.loose[0][1].summary, /, static$/);
});

test('no start block or several start blocks: everything counts as loose', () => {
  assert.deepEqual(outlineWorkspace({}), { stack: [], loose: [] });
  const two = { blocks: { blocks: [{ type: 'motionlab_start', id: 'a' }, { type: 'motionlab_start', id: 'b' }] } };
  assert.deepEqual(outlineWorkspace(two).stack, []);
  assert.equal(outlineWorkspace(two).loose.length, 2);
  assert.deepEqual(outlineWorkspace(null), { stack: [], loose: [] });
});

test('describeBlock tolerates missing or bad fields', () => {
  assert.equal(describeBlock({ type: 'motionlab_set_velocity', id: 'v' }), 'Set Initial Velocity of (no id): (?, ?) m/s');
  assert.equal(describeBlock({ type: 'mystery', id: 'm' }), 'mystery');
  assert.equal(describeBlock({ type: 'motionlab_create_box', fields: { ID: 'b', X: 0, Y: 1, WIDTH: 1, HEIGHT: 2, MASS: 3, RESTITUTION: 0, STATIC: 'TRUE' } }), 'Create Box "b" at (0, 1) m, 1 × 2 m, 3 kg, restitution 0, static');
});
