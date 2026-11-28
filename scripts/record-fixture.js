// Headless run of the canonical fixture: setup -> ball hits the side of the box (impact) -> floor -> rest.
// Records real engine snapshots at named events plus a coarse trajectory, for the frontend and the handoff.
//
//   node scripts/record-fixture.js          # rewrite fixtures/ball-and-box.snapshots.json
//   node scripts/record-fixture.js --check  # exit 1 if the engine no longer reproduces the file
//
// tests/simulation.test.js compares the engine against the recorded file exactly. If you change the engine on
// purpose, re-record, review the diff of the JSON, and note it in docs/HANDOFF.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTRACT_VERSION, DT, createSimulation, REST_SPEED, SOLVER_ITERATIONS, POSITION_ITERATIONS } from '../static/js/motionlab/index.js';

const ROOT = new URL('../', import.meta.url);
export const PROGRAM_PATH = 'fixtures/ball-and-box.program.json';
export const SNAPSHOTS_PATH = 'fixtures/ball-and-box.snapshots.json';
export const RUN_TICKS = 2400; // 20 s
export const TRAJECTORY_EVERY = 12; // 0.1 s
export const TRAJECTORY_TICKS = 480; // first 4 s


/** Run the program headlessly and pick out the events. Pure: no file access. */
export function recordFixture(program) {
  const sim = createSimulation(program);
  const all = [sim.snapshot()];
  for (let i = 0; i < RUN_TICKS; i++) all.push(sim.step());
  const ball = (s) => s.bodies.find((b) => b.id === 'ball');
  const box = (s) => s.bodies.find((b) => b.id === 'box');
  const radius = ball(all[0]).dimensions.radius;

  // Impact: the first tick the box moves (the ball hits its left face). After it, both slide right on the
  // frictionless floor at constant horizontal speeds, so the post-collision velocities are measured at afterImpact.
  const impact = all.findIndex((s) => box(s).velocity.x > 0);
  const afterImpact = impact + 6; // 0.05 s later, before the ball reaches the floor
  const floorImpact = all.findIndex((s, t) => t > impact && ball(s).position.y === radius);
  let rest = RUN_TICKS;
  while (rest > 0 && ball(all[rest - 1]).position.y === radius && ball(all[rest - 1]).velocity.y === 0) rest -= 1;
  if ([impact, floorImpact].some((t) => t <= 0)) throw new Error('fixture events not found; did the scene change?');

  const events = [
    ['setup', 0, 'createSimulation(program).snapshot(): the compiled initial scene, also what reset() returns'],
    ['firstTick', 1, 'one-tick force (120 N on the 1 kg ball) applied and then cleared; box held by the floor'],
    ['preImpact', impact - 1, 'last tick before the ball touches the left face of the box'],
    ['impact', impact, 'ball hits the left face of the box (restitution max(0.6, 0.2) = 0.6); the box starts sliding right'],
    ['afterImpact', afterImpact, '0.05 s later: post-collision horizontal velocities (ball about -0.167 m/s, box about 1.333 m/s)'],
    ['floorImpact', floorImpact, 'the ball reaches the floor after the collision'],
    ['rest', rest, 'from here the ball sits at y = 0.25 with vy = 0; both bodies keep sliding (no friction)'],
    ['end', RUN_TICKS, '20 s'],
  ].map(([name, tick, note]) => ({ name, tick, note, snapshot: all[tick] }));

  const trajectory = [];
  for (let t = 0; t <= TRAJECTORY_TICKS; t += TRAJECTORY_EVERY) {
    const b = ball(all[t]);
    trajectory.push([t, b.position.x, b.position.y, b.velocity.x, b.velocity.y]);
  }

  return {
    contractVersion: CONTRACT_VERSION,
    program: PROGRAM_PATH,
    generatedBy: 'node scripts/record-fixture.js',
    engine: { dt: DT, restSpeed: REST_SPEED, solverIterations: SOLVER_ITERATIONS, positionIterations: POSITION_ITERATIONS },
    comparison: 'exact (deep equality); the engine is deterministic IEEE-754 arithmetic with a fixed iteration order',
    events,
    trajectoryColumns: ['tick', 'ball.x', 'ball.y', 'ball.vx', 'ball.vy'],
    trajectory,
  };
}

export function loadProgram() {
  return JSON.parse(readFileSync(new URL(PROGRAM_PATH, ROOT), 'utf8'));
}

/** One event or trajectory row per line keeps diffs readable. */
export function formatRecording(rec) {
  const { events, trajectory, ...head } = rec;
  const headJson = JSON.stringify(head, null, 2).slice(0, -2);
  const ev = events.map((e) => `    ${JSON.stringify(e)}`).join(',\n');
  const tr = trajectory.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  return `${headJson},\n  "events": [\n${ev}\n  ],\n  "trajectory": [\n${tr}\n  ]\n}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = formatRecording(recordFixture(loadProgram()));
  const target = fileURLToPath(new URL(SNAPSHOTS_PATH, ROOT));
  if (process.argv.includes('--check')) {
    const same = readFileSync(target, 'utf8') === text;
    console.log(same ? `${SNAPSHOTS_PATH} is up to date` : `${SNAPSHOTS_PATH} differs from the engine; re-record it`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(target, text);
  console.log(`wrote ${SNAPSHOTS_PATH}`);
}
