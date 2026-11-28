// Tests for the DOM-free frontend modules: blocks, renderer, playback, programToWorkspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_DEFINITIONS, TRAY, TRAY_DRAG_TYPE, DEFAULTS, MAX_INSTANCES, BODY_BLOCK_TYPES, defineBlocks, hueToHex, uniqueBodyId } from '../static/js/motionlab/blocks.js';
import { drawScene, gridStep } from '../static/js/motionlab/renderer.js';
import { createPlayback } from '../static/js/motionlab/playback.js';
import { BLOCK_TYPES, START_BLOCK_TYPE, compileWorkspace, programToWorkspace } from '../static/js/motionlab/compile.js';
import { LIMITS, OPS, DT, ERROR_CODES as E } from '../static/js/motionlab/contract.js';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { createView } from '../static/js/motionlab/view.js';
import { program, workspace, expected } from './helpers.js';

// ---------- blocks ----------

const argsOf = (def) => Object.keys(def).filter((k) => k.startsWith('args')).flatMap((k) => def[k]);

test('every block type has a definition, start block is a hat with no previous connection', () => {
  const types = BLOCK_DEFINITIONS.map((d) => d.type);
  assert.deepEqual(types.sort(), [START_BLOCK_TYPE, ...Object.keys(BLOCK_TYPES)].sort());
  const start = BLOCK_DEFINITIONS.find((d) => d.type === START_BLOCK_TYPE);
  assert.ok(!('previousStatement' in start));
  assert.ok('nextStatement' in start);
  assert.deepEqual(MAX_INSTANCES, { [START_BLOCK_TYPE]: 1 });
});

test('block fields match the compiler mapping and the contract limits', () => {
  for (const def of BLOCK_DEFINITIONS.filter((d) => d.type !== START_BLOCK_TYPE)) {
    const { op, fields } = BLOCK_TYPES[def.type];
    const args = argsOf(def);
    assert.deepEqual(args.map((a) => a.name).sort(), Object.keys(fields).sort(), def.type);
    for (const a of args) {
      const kind = OPS[op][fields[a.name]];
      if (kind === 'boolean') assert.equal(a.type, 'field_checkbox');
      else if (kind === 'bodyId' || kind === 'bodyRef') assert.equal(a.type, 'field_input');
      else {
        assert.equal(a.type, 'field_number', `${def.type}.${a.name}`);
        assert.deepEqual([a.min, a.max], [...LIMITS[kind]], `${def.type}.${a.name}`);
      }
    }
    // Every %n placeholder has an arg.
    for (const key of Object.keys(def).filter((k) => k.startsWith('message'))) {
      const n = (def[key].match(/%\d/g) || []).length;
      assert.equal(n, def[`args${key.slice(7)}`].length, `${def.type} ${key}`);
    }
  }
});

test('blocks show the brief\'s names, units, ids and restitution/static inputs', () => {
  const text = (type) => { const d = BLOCK_DEFINITIONS.find((x) => x.type === type); return Object.keys(d).filter((k) => k.startsWith('message')).map((k) => d[k]).join(' | '); };
  assert.equal(text('motionlab_start'), 'When simulation starts');
  assert.match(text('motionlab_create_circle'), /^Create Ball  id %1 \| position  x %1 m   y %2 m \| radius %1 m   mass %2 kg \| restitution %1   static %2$/);
  assert.match(text('motionlab_create_box'), /^Create Box  id %1 .* width %1 m   height %2 m .* mass %1 kg   restitution %2   static %3$/);
  assert.match(text('motionlab_set_gravity'), /^Set Gravity  x %1 m\/s²   y %2 m\/s²$/);
  assert.match(text('motionlab_set_velocity'), /^Set Initial Velocity  of %1 \| vx %1 m\/s   vy %2 m\/s$/);
  assert.match(text('motionlab_apply_force'), /^Apply Force  to %1 \| fx %1 N   fy %2 N/);
});

test('tray lists every block type once, coloured like its block', () => {
  const chips = TRAY.flatMap((g) => g.blocks.map((b) => ({ ...b, group: g })));
  assert.deepEqual(chips.map((c) => c.type).sort(), BLOCK_DEFINITIONS.map((d) => d.type).sort());
  for (const c of chips) {
    const def = BLOCK_DEFINITIONS.find((d) => d.type === c.type);
    assert.equal(c.group.colour, hueToHex(def.colour), `${c.type} chip colour matches its block`);
    assert.ok(c.label.length > 0 && c.hint.length > 0, `${c.type} has a label and a hint`);
  }
  assert.equal(TRAY_DRAG_TYPE, 'application/x-motionlab-block');
});

test('hueToHex matches Blockly default block colours', () => {
  // Reference values from Blockly.utils.colour.hueToHex in Blockly 12.3.1.
  assert.equal(hueToHex(0), '#a55b5b');
  assert.equal(hueToHex(120), '#5ba55b');
  assert.equal(hueToHex(210), '#5b80a5');
  assert.equal(hueToHex(360), hueToHex(0));
});

test('a stack of default blocks compiles to a valid program', () => {
  const order = ['motionlab_set_gravity', 'motionlab_create_circle', 'motionlab_create_box', 'motionlab_set_velocity', 'motionlab_apply_force'];
  let next;
  for (const type of [...order].reverse()) next = { block: { type, id: type, fields: { ...DEFAULTS[type] }, ...(next ? { next } : {}) } };
  const r = compileWorkspace({ blocks: { languageVersion: 0, blocks: [{ type: START_BLOCK_TYPE, id: 's', next }] } });
  assert.deepEqual(r.errors, []);
  assert.doesNotThrow(() => createSimulation(r.program));
});

test('defineBlocks registers the JSON definitions', () => {
  let got = null;
  defineBlocks({ defineBlocksWithJsonArray: (defs) => { got = defs; } });
  assert.equal(got, BLOCK_DEFINITIONS);
  assert.deepEqual(BODY_BLOCK_TYPES, ['motionlab_create_circle', 'motionlab_create_box']);
});

test('uniqueBodyId', () => {
  assert.equal(uniqueBodyId([], 'ball'), 'ball');
  assert.equal(uniqueBodyId(['ball'], 'ball'), 'ball2');
  assert.equal(uniqueBodyId(['ball', 'ball2'], 'ball'), 'ball3');
  assert.equal(uniqueBodyId(['ball2', 'ball'], 'ball2'), 'ball3');
  assert.match(uniqueBodyId(['x'.repeat(32)], 'x'.repeat(32)), LIMITS.bodyIdPattern);
});

// ---------- renderer ----------

function fakeContext() {
  const calls = [];
  return new Proxy({ calls }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => calls.push([prop, ...args]);
    },
    set(target, prop, value) {
      calls.push([`set:${String(prop)}`, value]);
      return true;
    },
  });
}

test('drawScene draws the floor at view.floorPx and each body once', () => {
  const ctx = fakeContext();
  const view = createView({ width: 600, height: 300, scale: 50, worldLeft: -2, floorOffset: 40 });
  const snap = createSimulation(program()).snapshot();
  drawScene(ctx, snap, view);
  const floorFill = ctx.calls.find((c) => c[0] === 'fillRect' && c[2] === view.floorPx);
  assert.deepEqual(floorFill, ['fillRect', 0, 260, 600, 40]);
  const arcs = ctx.calls.filter((c) => c[0] === 'arc');
  assert.equal(arcs.length, 1);
  assert.deepEqual(arcs[0].slice(1, 4), [100, 260 - 150, 12.5], 'ball at (0, 3) m, r 0.25 m');
  const boxes = ctx.calls.filter((c) => c[0] === 'strokeRect');
  assert.deepEqual(boxes, [['strokeRect', 175, 210, 50, 50]], 'box at (2, 0.5) m, 1x1 m');
  const labels = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(labels.includes('ball') && labels.includes('box'));
});

test('drawScene: velocity arrows only for moving dynamic bodies; empty scene is fine', () => {
  const view = createView({ width: 400, height: 200, scale: 40 });
  const moving = { bodies: [{ id: 'a', shape: 'circle', position: { x: 2, y: 2 }, velocity: { x: 3, y: 0 }, dimensions: { radius: 0.2 }, static: false }] };
  const still = { bodies: [{ ...moving.bodies[0], velocity: { x: 0, y: 0 } }] };
  const count = (snap, opts) => { const c = fakeContext(); drawScene(c, snap, view, opts); return c.calls.filter((x) => x[0] === 'closePath').length; };
  assert.equal(count(moving), 1);
  assert.equal(count(still), 0);
  assert.equal(count(moving, { velocities: false }), 0);
  assert.doesNotThrow(() => drawScene(fakeContext(), { bodies: [] }, view));
});

test('gridStep keeps lines readable', () => {
  assert.equal(gridStep(100), 0.5);
  assert.equal(gridStep(30), 1);
  assert.equal(gridStep(5), 10);
});

// ---------- playback ----------

test('playback runs whole fixed steps for elapsed real time', () => {
  let steps = 0;
  const frames = [];
  const pb = createPlayback({ step: () => ({ tick: ++steps }), onFrame: (s, n) => frames.push([s.tick, n]) });
  assert.equal(pb.frame(16), 0, 'nothing runs before start');
  pb.start(1000);
  assert.equal(pb.running, true);
  assert.equal(pb.frame(1000 + 1000 / 60), 2, '1/60 s = 2 ticks');
  assert.equal(pb.frame(1000 + 2000 / 60), 2);
  assert.equal(pb.frame(1000 + 2000 / 60 + 4), 0, 'less than one tick of time');
  assert.equal(pb.frame(1000 + 2000 / 60 + 8.5), 1, 'leftover time carries over');
  assert.deepEqual(frames, [[2, 2], [4, 2], [5, 1]]);
  pb.stop();
  assert.equal(pb.frame(5000), 0);
});

test('playback caps catch-up after a long pause', () => {
  let steps = 0;
  const pb = createPlayback({ step: () => ({ tick: ++steps }) });
  pb.start(0);
  assert.equal(pb.frame(10_000), 12, 'a 10 s gap credits at most 0.1 s = 12 ticks');
  assert.equal(pb.frame(10_000 + 1000 / 120), 1);
  // With a larger time credit, the step cap still bounds the burst and drops the rest of the backlog.
  const pb2 = createPlayback({ step: () => ({}), maxStepsPerFrame: 12, maxFrameGap: 1 });
  pb2.start(0);
  assert.equal(pb2.frame(1000), 12);
  assert.equal(pb2.frame(1000 + 1000 / 120), 2, 'at most one tick of backlog survives the cap');
});

test('one second of 60 Hz frames is exactly 120 steps', () => {
  let steps = 0;
  const pb = createPlayback({ step: () => ({ tick: ++steps }) });
  pb.start(0);
  for (let i = 1; i <= 60; i++) pb.frame((i * 1000) / 60);
  assert.equal(steps, 120);
  assert.equal(steps * DT, 1);
});

// Project file tests live in tests/project-files.test.js.

// ---------- programToWorkspace ----------

test('programToWorkspace: empty program, id clashes, invalid values kept for the compiler', () => {
  assert.deepEqual(compileWorkspace(programToWorkspace({ version: 1, commands: [] })).program, { version: 1, commands: [] });
  const clash = programToWorkspace({ version: 1, commands: [
    { op: 'setGravity', blockId: 'start', x: 0, y: -1 },
    { op: 'setGravity', blockId: 'start', x: 0, y: -2 },
    { op: 'setGravity', x: 0, y: -3 },
  ] });
  const ids = [];
  for (let b = clash.blocks.blocks[0]; b; b = b.next?.block) ids.push(b.id);
  assert.equal(new Set(ids).size, 4, `unique ids: ${ids}`);
  const r = compileWorkspace(programToWorkspace({ version: 1, commands: [{ op: 'createCircle', blockId: 'c', id: 'ball', x: 0, y: 1, radius: -5, mass: 1, restitution: 0, static: false }] }));
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[E.OUT_OF_RANGE, 'c']]);
});
