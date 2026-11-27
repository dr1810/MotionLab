import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
export const loadJson = (rel) => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));

/** Deep-compare plain JSON values, numbers within tol. */
export function assertClose(actual, expected, tol, path = '$') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${path} should be a number`);
    assert.ok(Math.abs(actual - expected) <= tol, `${path}: ${actual} != ${expected} (tol ${tol})`);
    return;
  }
  if (expected === null || typeof expected !== 'object') {
    assert.equal(actual, expected, path);
    return;
  }
  assert.equal(Array.isArray(actual), Array.isArray(expected), `${path} array-ness`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`);
  for (const k of Object.keys(expected)) assertClose(actual[k], expected[k], tol, `${path}.${k}`);
}
