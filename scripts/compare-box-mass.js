// Repeatable second run for the live demo: the canonical ball-and-box project, then the same project with ONE input
// changed (box mass 2 kg -> 0.5 kg). Both run through the app's own path: Blockly workspace JSON -> compileWorkspace
// -> createSimulation (the real engine). Measures the horizontal velocities just before and after the impact.
//
//   node scripts/compare-box-mass.js           # print the comparison
//   node scripts/compare-box-mass.js --write   # also (re)write the variant project and the evidence file
//
// Files:
//   fixtures/ball-and-box.light-box.motionlab.json  openable project (Open… in the top bar) for the second run
//   docs/evidence/box-mass-comparison.json          measured results, checked by tests/demo.test.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileWorkspace, createSimulation, DT, CONTRACT_VERSION } from '../static/js/motionlab/index.js';
import { serializeProjectFile } from '../static/js/motionlab/files.js';

const ROOT = new URL('../', import.meta.url);
export const BASE_WORKSPACE = 'fixtures/ball-and-box.workspace.json';
export const VARIANT_PROJECT = 'fixtures/ball-and-box.light-box.motionlab.json';
export const EVIDENCE = 'docs/evidence/box-mass-comparison.json';
export const LIGHT_BOX_MASS = 0.5; // kg; validated range is 0.001 to 10000
export const SAMPLE_AFTER_TICKS = 6; // 0.05 s after impact, before the ball reaches the floor

const read = (rel) => JSON.parse(readFileSync(new URL(rel, ROOT), 'utf8'));

/** The canonical workspace with only the Create Box block's MASS field changed. */
export function lightBoxWorkspace(base, mass = LIGHT_BOX_MASS) {
  const ws = structuredClone(base);
  for (let b = ws.blocks.blocks[0]; b; b = b.next?.block) {
    if (b.type === 'motionlab_create_box') {
      b.fields.MASS = mass;
      return ws;
    }
  }
  throw new Error('no Create Box block in the base workspace');
}

/** Run a workspace through compile + engine and measure the collision. */
export function measure(workspace) {
  const compiled = compileWorkspace(workspace);
  if (!compiled.ok) throw new Error(`does not compile: ${compiled.errors.map((e) => e.message).join('; ')}`);
  const sim = createSimulation(compiled.program);
  const snaps = [sim.snapshot()];
  for (let i = 0; i < 600; i++) snaps.push(sim.step());
  const get = (s, id) => s.bodies.find((b) => b.id === id);
  const impact = snaps.findIndex((s) => get(s, 'box').velocity.x > 0);
  if (impact <= 0) throw new Error('the ball never hit the box');
  const before = snaps[impact - 1];
  const after = snaps[impact + SAMPLE_AFTER_TICKS];
  const end = snaps[600];
  const masses = Object.fromEntries(compiled.program.commands.filter((c) => c.op.startsWith('create')).map((c) => [c.id, c.mass]));
  const vx = (s) => ({ ball: get(s, 'ball').velocity.x, box: get(s, 'box').velocity.x });
  return {
    masses,
    impactTick: impact,
    impactTime: impact * DT,
    before: vx(before),
    after: vx(after),
    momentumBefore: masses.ball * vx(before).ball + masses.box * vx(before).box,
    momentumAfter: masses.ball * vx(after).ball + masses.box * vx(after).box,
    at5s: { ballX: get(end, 'ball').position.x, boxX: get(end, 'box').position.x },
  };
}

/** Textbook 1D collision with restitution e (box initially at rest), for comparison. */
export function expected(m1, m2, u, e = 0.6) {
  return { ball: ((m1 - e * m2) * u) / (m1 + m2), box: ((1 + e) * m1 * u) / (m1 + m2) };
}

export function compare() {
  const base = read(BASE_WORKSPACE);
  const runs = { canonical: measure(base), lightBox: measure(lightBoxWorkspace(base)) };
  for (const r of Object.values(runs)) r.expectedAfter = expected(r.masses.ball, r.masses.box, r.before.ball);
  return {
    contractVersion: CONTRACT_VERSION,
    generatedBy: 'node scripts/compare-box-mass.js --write',
    changedInput: { block: 'Create Box (blk-box)', field: 'MASS', from: runs.canonical.masses.box, to: runs.lightBox.masses.box, unit: 'kg' },
    note: 'Horizontal velocities in m/s, measured 0.05 s after the first tick the box moves; restitution max(0.6, 0.2) = 0.6; the floor is frictionless, so these speeds then stay constant.',
    runs,
  };
}

const f = (n) => (Math.abs(n) < 5e-4 ? '0.000' : n.toFixed(3));

export function table(result) {
  const rows = Object.entries(result.runs).map(([name, r]) => `| ${name} | ${r.masses.box} kg | ${r.impactTick} (${r.impactTime.toFixed(3)} s) | ${f(r.before.ball)} | ${f(r.after.ball)} | ${f(r.after.box)} | ${f(r.expectedAfter.ball)} / ${f(r.expectedAfter.box)} | ${f(r.momentumBefore)} → ${f(r.momentumAfter)} |`);
  return ['| run | box mass | impact tick | ball vx before | ball vx after | box vx after | expected after (ball / box) | momentum kg·m/s |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = compare();
  console.log(table(result));
  if (process.argv.includes('--write')) {
    const variant = lightBoxWorkspace(read(BASE_WORKSPACE));
    writeFileSync(fileURLToPath(new URL(VARIANT_PROJECT, ROOT)), serializeProjectFile(variant, compileWorkspace(variant).program));
    mkdirSync(fileURLToPath(new URL('docs/evidence/', ROOT)), { recursive: true });
    writeFileSync(fileURLToPath(new URL(EVIDENCE, ROOT)), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${VARIANT_PROJECT} and ${EVIDENCE}`);
  }
}
