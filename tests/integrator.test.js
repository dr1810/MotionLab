// Integrator-level engine tests: semi-implicit Euler, one-tick forces, static bodies, time, reset, purity.
// Scenes are placed high above the floor (or use zero gravity) so no contacts are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { DT } from '../static/js/motionlab/contract.js';
import { program, prog, circle, box } from './helpers.js';

const TOL = 1e-9;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= TOL, `${msg}: ${a} vs ${b}`);
const body = (snap, id) => snap.bodies.find((b) => b.id === id);
const gravity = (x, y, blockId = 'g') => ({ op: 'setGravity', blockId, x, y });

test('constant velocity: no gravity, no force -> v unchanged, p = p0 + v*t', () => {
  const sim = createSimulation(prog(
    gravity(0, 0),
    circle({ y: 50 }),
    { op: 'setVelocity', blockId: 'v', id: 'ball', vx: 3, vy: -2 },
  ));
  for (let n = 1; n <= 600; n++) {
    const b = body(sim.step(), 'ball');
    assert.deepEqual(b.velocity, { x: 3, y: -2 }, `tick ${n}`);
    close(b.position.x, 3 * n * DT, `x at tick ${n}`);
    close(b.position.y, 50 - 2 * n * DT, `y at tick ${n}`);
  }
});

test('gravity: semi-implicit Euler closed form v_n = n*g*dt, y_n = y0 + g*dt^2*n(n+1)/2', () => {
  const g = -9.81;
  const sim = createSimulation(prog(circle({ y: 500 })));
  for (let n = 1; n <= 240; n++) {
    const b = body(sim.step(), 'ball');
    close(b.velocity.y, n * g * DT, `vy at tick ${n}`);
    close(b.position.y, 500 + (g * DT * DT * n * (n + 1)) / 2, `y at tick ${n}`);
    assert.equal(b.velocity.x, 0);
    assert.equal(b.position.x, 0);
  }
});

test('gravity is mass-independent; sideways gravity works too', () => {
  const sim = createSimulation(prog(
    gravity(2, -5),
    circle({ blockId: 'l', id: 'light', mass: 0.01, y: 100 }),
    circle({ blockId: 'h', id: 'heavy', mass: 5000, x: 10, y: 100 }),
  ));
  const s = (() => { let x; for (let i = 0; i < 120; i++) x = sim.step(); return x; })();
  assert.deepEqual(body(s, 'light').velocity, body(s, 'heavy').velocity);
  close(body(s, 'light').velocity.x, 2 * 120 * DT, 'vx');
  close(body(s, 'light').velocity.y, -5 * 120 * DT, 'vy');
});

test('same force on different masses: a = F/m for the first tick', () => {
  const F = 120;
  const masses = [0.5, 1, 4, 30];
  const sim = createSimulation(prog(
    gravity(0, 0),
    ...masses.flatMap((m, i) => [
      circle({ blockId: `c${i}`, id: `m${i}`, mass: m, x: i * 5, y: 10 }),
      { op: 'applyForce', blockId: `f${i}`, id: `m${i}`, fx: F, fy: -F / 2 },
    ]),
  ));
  const s = sim.step();
  masses.forEach((m, i) => {
    const b = body(s, `m${i}`);
    close(b.velocity.x, (F / m) * DT, `vx of ${m} kg`);
    close(b.velocity.y, (-F / 2 / m) * DT, `vy of ${m} kg`);
    close(b.position.x, i * 5 + (F / m) * DT * DT, `x of ${m} kg`);
  });
  // Momentum handed out is the same for every mass: m * v = F * dt.
  for (const [i, m] of masses.entries()) close(m * body(s, `m${i}`).velocity.x, F * DT, `impulse of ${m} kg`);
});

test('first-tick force lifetime: acts on step 1 only, then cleared; gravity keeps acting', () => {
  const sim = createSimulation(prog(
    circle({ y: 500, mass: 2 }),
    { op: 'applyForce', blockId: 'f', id: 'ball', fx: 240, fy: 240 },
  ));
  const impulse = (240 / 2) * DT; // 1 m/s
  for (let n = 1; n <= 120; n++) {
    const b = body(sim.step(), 'ball');
    close(b.velocity.x, impulse, `vx at tick ${n} (force only once)`);
    close(b.velocity.y, impulse + n * -9.81 * DT, `vy at tick ${n}`);
  }
});

test('first-tick force: several applyForce blocks add up; reset re-arms them', () => {
  const sim = createSimulation(prog(
    gravity(0, 0),
    circle({ y: 10 }),
    { op: 'applyForce', blockId: 'f1', id: 'ball', fx: 50, fy: 0 },
    { op: 'applyForce', blockId: 'f2', id: 'ball', fx: 70, fy: 0 },
  ));
  close(body(sim.step(), 'ball').velocity.x, 1, 'summed force 120 N on 1 kg');
  close(body(sim.step(), 'ball').velocity.x, 1, 'no force on tick 2');
  sim.reset();
  close(body(sim.step(), 'ball').velocity.x, 1, 'force acts again after reset');
});

test('static bodies: zero inverse mass, never integrate under gravity', () => {
  const sim = createSimulation(prog(
    gravity(7, -50),
    box({ id: 'ledge', y: 20, static: true }),
    circle({ blockId: 'c2', id: 'pillar', x: 10, y: 30, static: true }),
    circle({ blockId: 'c3', id: 'free', x: 20, y: 40 }),
  ));
  const before = sim.snapshot();
  let s;
  for (let i = 0; i < 600; i++) s = sim.step();
  for (const id of ['ledge', 'pillar']) {
    assert.deepEqual(body(s, id).position, body(before, id).position, id);
    assert.deepEqual(body(s, id).velocity, { x: 0, y: 0 }, id);
    assert.equal(body(s, id).static, true);
  }
  assert.ok(body(s, 'free').position.x > 20, 'the dynamic body did integrate');
});

test('time is derived from the tick count and does not drift', () => {
  const sim = createSimulation(prog());
  let s;
  for (let i = 0; i < 12000; i++) s = sim.step();
  assert.equal(s.tick, 12000);
  assert.equal(s.time, 12000 * DT);
  assert.equal(s.time, 100);
  let acc = 0;
  for (let i = 0; i < 12000; i++) acc += DT;
  assert.notEqual(acc, 100, 'sanity: summing DT would have drifted');
});

test('stable iteration order: bodies come back in creation order, not id order', () => {
  const sim = createSimulation(prog(
    circle({ blockId: '1', id: 'zeta', x: 0, y: 5 }),
    box({ blockId: '2', id: 'alpha', x: 5, y: 5 }),
    circle({ blockId: '3', id: 'mu', x: 10, y: 5 }),
  ));
  assert.deepEqual(sim.snapshot().bodies.map((b) => b.id), ['zeta', 'alpha', 'mu']);
  assert.deepEqual(sim.step().bodies.map((b) => b.id), ['zeta', 'alpha', 'mu']);
});

test('reset reproducibility: every step after reset matches the first run exactly', () => {
  const sim = createSimulation(program());
  const first = [sim.snapshot()];
  for (let i = 0; i < 900; i++) first.push(sim.step());
  assert.deepEqual(sim.reset(), first[0]);
  for (let i = 1; i <= 900; i++) assert.deepEqual(sim.step(), first[i], `tick ${i}`);
  // Reset in the middle of a run, twice, still replays identically; so does a fresh simulation.
  for (let i = 0; i < 37; i++) sim.step();
  sim.reset();
  sim.reset();
  const fresh = createSimulation(program());
  for (let i = 1; i <= 300; i++) {
    const s = sim.step();
    assert.deepEqual(s, first[i]);
    assert.deepEqual(fresh.step(), first[i]);
  }
});

test('snapshots are detached from engine state and from each other', () => {
  const sim = createSimulation(program());
  const a = sim.step();
  const copy = JSON.parse(JSON.stringify(a));
  a.bodies[1].velocity.x = 1e6;
  a.bodies[1].position = null;
  a.time = -1;
  assert.deepEqual(sim.snapshot(), copy, 'mutating a returned snapshot changes nothing');
  const b = sim.snapshot();
  assert.notEqual(b.bodies, sim.snapshot().bodies);
  assert.notEqual(b.bodies[0].position, sim.snapshot().bodies[0].position);
  sim.step();
  assert.deepEqual(b, copy, 'an old snapshot does not change when the engine steps');
});

test('engine is pure JS: no physics library, no browser timing or DOM', () => {
  const allowed = { 'engine.js': ['./contract.js', './collision.js'], 'collision.js': ['./contract.js'] };
  for (const [file, wantImports] of Object.entries(allowed)) {
    const src = readFileSync(new URL(`../static/js/motionlab/${file}`, import.meta.url), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const imports = [...code.matchAll(/import[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(imports, wantImports, file);
    for (const banned of ['matter', 'Matter', 'window', 'document', 'requestAnimationFrame', 'performance', 'setTimeout', 'setInterval', 'Date.now', 'canvas']) {
      assert.ok(!code.includes(banned), `${file} must not use ${banned}`);
    }
  }
});
