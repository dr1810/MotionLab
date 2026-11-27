// Tests for the Blockly-free frontend modules: block definitions, playback, renderer, files, view fitting.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_DEFINITIONS, TOOLBOX, FIELD_DEFAULTS, OPS, BLOCK_TYPES, START_BLOCK_TYPE, registerBlocks,
  createSimulation, createPlayback, MAX_STEPS_PER_FRAME, DT, drawScene, createViewTransform, fitView,
  serializeWorkspaceFile, parseWorkspaceFile, FILE_ERROR_CODES, MAX_FILE_BYTES, programToWorkspace,
  compileWorkspace, validateProgram, ERROR_CODES,
} from '../static/js/motionlab/index.js';
import { loadJson } from './helpers.js';

const fixture = loadJson('fixtures/ball-and-box.program.json');

// ---------- block definitions ----------
test('every op has a block whose fields match the contract payload', () => {
  for (const [type, op] of Object.entries(BLOCK_TYPES)) {
    const def = BLOCK_DEFINITIONS.find((d) => d.type === type);
    assert.ok(def, `missing block ${type}`);
    const fields = Object.keys(def).filter((k) => k.startsWith('args')).flatMap((k) => def[k]);
    assert.deepEqual(fields.map((f) => f.name).sort(), OPS[op].map(([n]) => n.toUpperCase()).sort(), type);
    for (const k of Object.keys(def).filter((x) => x.startsWith('message'))) {
      const n = (def[k].match(/%\d+/g) || []).length;
      assert.equal(n, def[k.replace('message', 'args')].length, `${type} ${k} placeholder count`);
    }
    for (const f of fields) {
      const spec = OPS[op].find(([n]) => n.toUpperCase() === f.name);
      if (spec[1] === 'number') {
        assert.equal(f.type, 'field_number');
        assert.equal(f.min, spec[2].min);
        assert.equal(f.max, spec[2].max);
      }
    }
    assert.ok('previousStatement' in def && 'nextStatement' in def);
  }
  const start = BLOCK_DEFINITIONS.find((d) => d.type === START_BLOCK_TYPE);
  assert.ok(!('previousStatement' in start), 'start block is a hat');
});

test('toolbox defaults compile to a valid program', () => {
  const blocks = Object.entries(BLOCK_TYPES).map(([type, op], i) => ({ type, id: `t${i}`, fields: FIELD_DEFAULTS[op] }));
  // box first so the "ball" references resolve after the ball is created
  const order = ['motionlab_set_gravity', 'motionlab_create_box', 'motionlab_create_circle', 'motionlab_set_velocity', 'motionlab_apply_force'];
  blocks.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  let next;
  for (let i = blocks.length - 1; i >= 0; i--) next = { ...blocks[i], ...(next ? { next: { block: next } } : {}) };
  const r = compileWorkspace({ blocks: { blocks: [{ type: START_BLOCK_TYPE, id: 's', next: { block: next } }] } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('toolbox lists every block type once', () => {
  const types = TOOLBOX.contents.flatMap((c) => c.contents.map((b) => b.type));
  assert.deepEqual(types.sort(), BLOCK_DEFINITIONS.map((d) => d.type).sort());
});

test('registerBlocks passes the definitions to Blockly once', () => {
  const calls = [];
  const fake = { common: { defineBlocksWithJsonArray: (defs) => calls.push(defs) } };
  registerBlocks(fake);
  registerBlocks(fake);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], BLOCK_DEFINITIONS);
});

// ---------- program <-> workspace ----------
test('programToWorkspace round-trips through compileWorkspace', () => {
  const r = compileWorkspace(programToWorkspace(fixture));
  assert.equal(r.ok, true);
  assert.deepEqual(r.program, fixture);
  const empty = compileWorkspace(programToWorkspace({ version: 1, commands: [] }));
  assert.deepEqual(empty.program, { version: 1, commands: [] });
});

test('programToWorkspace avoids a start-block id clash', () => {
  const p = { version: 1, commands: [{ op: 'setGravity', blockId: 'start', x: 0, y: 0 }] };
  const ws = programToWorkspace(p);
  assert.equal(ws.blocks.blocks[0].id, 'start-1');
  assert.deepEqual(compileWorkspace(ws).program, p);
});

// ---------- playback ----------
test('playback runs one step per 1/120 s of real time and carries the remainder', () => {
  const pb = createPlayback(createSimulation(fixture));
  assert.equal(pb.advance(1 / 60).steps, 2);
  assert.equal(pb.advance(DT / 2).steps, 0);
  assert.equal(pb.advance(DT / 2).steps, 1);
  assert.equal(pb.snapshot.tick, 3);
  let total = 3;
  for (let i = 0; i < 60; i++) total += pb.advance(1 / 60).steps;
  assert.equal(total, 123);
  assert.equal(pb.snapshot.tick, 123);
});

test('playback caps steps per frame and ignores bad elapsed values', () => {
  const pb = createPlayback(createSimulation(fixture));
  assert.equal(pb.advance(10).steps, MAX_STEPS_PER_FRAME);
  assert.ok(pb.advance(0).steps <= 1, 'backlog dropped');
  for (const bad of [-1, NaN, Infinity, undefined]) assert.equal(pb.advance(bad).steps, 0);
});

test('playback stepOnce and reset', () => {
  const pb = createPlayback(createSimulation(fixture));
  assert.equal(pb.stepOnce().tick, 1);
  pb.advance(DT * 0.9);
  assert.equal(pb.reset().tick, 0);
  assert.equal(pb.advance(DT * 0.2).steps, 0, 'accumulator cleared by reset');
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

test('renderer draws the floor at view.floorPx and bodies at transformed positions', () => {
  const view = createViewTransform({ heightPx: 300, pixelsPerMeter: 50, originXPx: 100, floorMarginPx: 40 });
  const ctx = fakeContext();
  drawScene(ctx, createSimulation(fixture).snapshot(), view, { widthPx: 600, heightPx: 300 });
  const { calls } = ctx;
  assert.ok(calls.some((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === 260), 'floor line start');
  assert.ok(calls.some((c) => c[0] === 'lineTo' && c[1] === 600 && c[2] === 260), 'floor line end');
  // box (2, 0.5) 1x1 -> top-left world (1.5, 1) -> px (175, 210), 50x50
  assert.ok(calls.some((c) => c[0] === 'rect' && c[1] === 175 && c[2] === 210 && c[3] === 50 && c[4] === 50));
  // ball (0, 3) r 0.25 -> (100, 110) r 12.5
  assert.ok(calls.some((c) => c[0] === 'arc' && c[1] === 100 && c[2] === 110 && c[3] === 12.5));
  assert.ok(calls.some((c) => c[0] === 'fillText' && c[1] === 'ball'));
});

test('renderer handles an empty scene', () => {
  const view = createViewTransform({ heightPx: 200, pixelsPerMeter: 20 });
  const ctx = fakeContext();
  drawScene(ctx, { tick: 0, time: 0, bodies: [] }, view, { widthPx: 300, heightPx: 200 });
  assert.ok(!ctx.calls.some((c) => c[0] === 'arc' || c[0] === 'rect'));
});

// ---------- fitView ----------
test('fitView keeps every body on screen and the floor at the margin', () => {
  const snap = createSimulation(fixture).snapshot();
  const view = fitView(snap, { widthPx: 600, heightPx: 400, floorMarginPx: 40 });
  assert.equal(view.floorPx, 360);
  for (const b of snap.bodies) {
    const p = view.toCanvas(b.position.x, b.position.y);
    assert.ok(p.x > 0 && p.x < 600 && p.y > 0 && p.y < 360, `${b.id} visible`);
  }
  const empty = fitView({ bodies: [] }, { widthPx: 800, heightPx: 400 });
  assert.equal(empty.pixelsPerMeter, 90); // min(800/8, 360/4)
});

// ---------- files ----------
test('workspace files round-trip', () => {
  const ws = programToWorkspace(fixture);
  const text = serializeWorkspaceFile(ws);
  const data = JSON.parse(text);
  assert.equal(data.format, 'motionlab');
  assert.equal(data.fileVersion, 1);
  assert.equal(data.contractVersion, 1);
  assert.deepEqual(parseWorkspaceFile(text), { ok: true, workspace: ws, errors: [] });
});

test('a bare program v1 file loads as blocks', () => {
  const r = parseWorkspaceFile(JSON.stringify(fixture));
  assert.equal(r.ok, true);
  assert.deepEqual(compileWorkspace(r.workspace).program, fixture);
});

test('an invalid program file reports contract errors', () => {
  const bad = structuredClone(fixture);
  bad.commands[2].radius = -1;
  const r = parseWorkspaceFile(JSON.stringify(bad));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => [e.code, e.blockId]), [[ERROR_CODES.OUT_OF_RANGE, 'blk-ball']]);
  assert.equal(validateProgram(bad).ok, false);
});

test('bad files are rejected with document-level errors', () => {
  const code = (t) => parseWorkspaceFile(t).errors.map((e) => [e.code, e.blockId]);
  assert.deepEqual(code('{nope'), [[FILE_ERROR_CODES.INVALID_JSON, null]]);
  assert.deepEqual(code('"x"'), [[FILE_ERROR_CODES.UNSUPPORTED_FILE, null]]);
  assert.deepEqual(code(JSON.stringify({ format: 'motionlab', fileVersion: 2, workspace: {} })), [[FILE_ERROR_CODES.UNSUPPORTED_FILE, null]]);
  assert.deepEqual(code(JSON.stringify({ format: 'motionlab', fileVersion: 1 })), [[FILE_ERROR_CODES.UNSUPPORTED_FILE, null]]);
  assert.deepEqual(code(' '.repeat(MAX_FILE_BYTES + 1)), [[FILE_ERROR_CODES.FILE_TOO_LARGE, null]]);
  assert.deepEqual(code(null), [[FILE_ERROR_CODES.UNSUPPORTED_FILE, null]]);
});
