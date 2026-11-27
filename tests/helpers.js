import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);

export const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, root), 'utf8'));
export const program = () => loadJson('fixtures/ball-and-box.program.json');
export const expected = () => loadJson('fixtures/ball-and-box.expected.json');
export const workspace = () => loadJson('fixtures/ball-and-box.workspace.json');

/** Deep-compare snapshots, allowing `tol` on numbers. */
export function assertClose(actual, wanted, tol = 1e-9, path = '$') {
  if (typeof wanted === 'number') {
    assert.equal(typeof actual, 'number', `${path} should be a number`);
    assert.ok(Math.abs(actual - wanted) <= tol, `${path}: ${actual} vs ${wanted}`);
  } else if (wanted && typeof wanted === 'object') {
    assert.ok(actual && typeof actual === 'object', `${path} should be an object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(wanted).sort(), `${path} keys`);
    for (const k of Object.keys(wanted)) assertClose(actual[k], wanted[k], tol, `${path}.${k}`);
  } else {
    assert.equal(actual, wanted, path);
  }
}

/** Minimal valid program with a single command list. */
export const prog = (...commands) => ({ version: 1, commands });
export const circle = (o = {}) => ({ op: 'createCircle', blockId: 'c', id: 'ball', x: 0, y: 1, radius: 0.5, mass: 1, restitution: 0.5, static: false, ...o });
export const box = (o = {}) => ({ op: 'createBox', blockId: 'b', id: 'box', x: 0, y: 0.5, width: 1, height: 1, mass: 1, restitution: 0, static: false, ...o });

export const codes = (result) => result.errors.map((e) => e.code);
