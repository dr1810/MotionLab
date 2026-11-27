import test from 'node:test';
import assert from 'node:assert/strict';
import { createView, fitView } from '../static/js/motionlab/view.js';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { FLOOR_Y } from '../static/js/motionlab/contract.js';
import { program } from './helpers.js';

test('floor row: world y = FLOOR_Y maps to view.floorPx', () => {
  const v = createView({ width: 600, height: 300, scale: 50, worldLeft: -2, floorOffset: 40 });
  assert.equal(v.floorPx, 260);
  assert.deepEqual(v.toCanvas(-2, FLOOR_Y), { x: 0, y: 260 });
});

test('+y up in the world is -y on the canvas; round trip', () => {
  const v = createView({ width: 600, height: 300, scale: 50, worldLeft: -2 });
  assert.deepEqual(v.toCanvas(0, 1), { x: 100, y: 210 });
  assert.deepEqual(v.toWorld(100, 210), { x: 0, y: 1 });
  assert.equal(v.length(0.25), 12.5);
});

test('fitView keeps every fixture body inside the canvas', () => {
  const snap = createSimulation(program()).snapshot();
  const v = fitView(snap, { width: 640, height: 320 });
  for (const b of snap.bodies) {
    const hw = b.dimensions.radius ?? b.dimensions.width / 2;
    const hh = b.dimensions.radius ?? b.dimensions.height / 2;
    const tl = v.toCanvas(b.position.x - hw, b.position.y + hh);
    const br = v.toCanvas(b.position.x + hw, b.position.y - hh);
    assert.ok(tl.x >= 0 && tl.y >= 0 && br.x <= 640 && br.y <= v.floorPx + 1e-9, b.id);
  }
});

test('fitView of an empty scene still has a sane scale', () => {
  const v = fitView({ tick: 0, time: 0, bodies: [] }, { width: 400, height: 300 });
  assert.ok(v.scale >= 5 && v.scale <= 160);
});
