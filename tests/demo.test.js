// Live-demo pair: the canonical ball-and-box project and a second run that changes one input only (box mass).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, lightBoxWorkspace, expected, LIGHT_BOX_MASS } from '../scripts/compare-box-mass.js';
import { parseMotionLabFile } from '../static/js/motionlab/files.js';
import { compileWorkspace } from '../static/js/motionlab/compile.js';
import { validateProgram, LIMITS } from '../static/js/motionlab/contract.js';
import { loadJson, workspace, program } from './helpers.js';
import { readFileSync } from 'node:fs';

/** Every leaf that differs between two JSON values, as "path: a -> b". */
function diff(a, b, path = '') {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b ? [] : [`${path}: ${a} -> ${b}`];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diff(a[k], b[k], `${path}.${k}`));
}

test('the second run changes exactly one input: the box mass, 2 kg -> 0.5 kg', () => {
  const variantFile = readFileSync(new URL('../fixtures/ball-and-box.light-box.motionlab.json', import.meta.url), 'utf8');
  const opened = parseMotionLabFile(variantFile);
  assert.equal(opened.source, 'project');
  assert.deepEqual(opened.workspace, lightBoxWorkspace(workspace()));
  assert.deepEqual(diff(workspace(), opened.workspace), ['.blocks.blocks.0.next.block.next.block.fields.MASS: 2 -> 0.5']);
  const p = compileWorkspace(opened.workspace).program;
  assert.deepEqual(diff(program(), p), ['.commands.1.mass: 2 -> 0.5']);
  assert.equal(validateProgram(p).ok, true);
  assert.ok(LIGHT_BOX_MASS >= LIMITS.mass[0] && LIGHT_BOX_MASS <= LIMITS.mass[1], 'a validated value');
  for (const c of p.commands.filter((x) => x.op.startsWith('create'))) assert.equal(c.static, false, `${c.id} is dynamic`);
  assert.ok(p.commands.find((c) => c.op === 'setVelocity').vx > 0, 'horizontal initial velocity');
});

test('recorded evidence matches a fresh run exactly', () => {
  assert.deepEqual(loadJson('docs/evidence/box-mass-comparison.json'), JSON.parse(JSON.stringify(compare())));
});

test('measured post-collision velocities: the effect of box mass is visible and matches the 1D formula', () => {
  const { runs } = compare();
  const { canonical: heavy, lightBox: light } = runs;
  for (const r of [heavy, light]) {
    assert.equal(r.before.ball, 2.5);
    assert.equal(r.before.box, 0);
    const want = expected(r.masses.ball, r.masses.box, 2.5);
    assert.ok(Math.abs(r.after.ball - want.ball) < 1e-9 && Math.abs(r.after.box - want.box) < 1e-9, JSON.stringify(r.after));
    assert.ok(Math.abs(r.momentumAfter - r.momentumBefore) < 1e-9);
  }
  assert.equal(heavy.impactTick, light.impactTick, 'same impact moment: only the outcome differs');
  assert.ok(heavy.after.ball < 0 && light.after.ball > 0, 'heavy box: the ball bounces back; light box: it keeps going');
  assert.ok(Math.abs(light.after.box / heavy.after.box - 2) < 1e-9, 'the light box leaves twice as fast');
  assert.ok(light.at5s.boxX - heavy.at5s.boxX > 5, 'clearly visible on screen: the light box is metres further after 5 s');
});
