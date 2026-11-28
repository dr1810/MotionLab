// Files and Download actions, isolated: an in-memory editor adapter, the real session controller with the
// fixture-backed simulation double and a manual frame clock, and real File objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectActions, EDITOR_REJECTED, FILE_READ_FAILED } from '../static/js/motionlab/project-io.js';
import { createSessionController } from '../static/js/motionlab/session.js';
import { compileWorkspace } from '../static/js/motionlab/compile.js';
import { FILE_ERROR_CODES as F, MAX_FILE_BYTES, serializeProjectFile } from '../static/js/motionlab/files.js';
import { createFixtureSimulationFactory, createManualFrames } from './doubles/fixture-simulation.js';
import { loadJson, workspace } from './helpers.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const editorFixture = () => loadJson('fixtures/ball-and-box.editor.workspace.json');
const editorProgram = () => loadJson('fixtures/ball-and-box.editor.program.json');

/** A page-like setup: editor + session + the same recompile rule the page uses. */
function setup(initialWorkspace = workspace()) {
  const frames = createManualFrames();
  const double = createFixtureSimulationFactory();
  const session = createSessionController({
    createSimulation: double.createSimulation,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: frames.now,
    onRender: () => {},
  });
  let ws = clone(initialWorkspace);
  let compiled = null;
  const editor = {
    loads: 0,
    save: () => clone(ws),
    load(json) {
      this.loads += 1;
      ws = {}; // like Blockly: the workspace is cleared first, so a failure part-way leaves it empty
      if (json.rejectMe) throw new Error('unknown field type');
      ws = clone(json);
    },
  };
  const recompile = () => {
    compiled = compileWorkspace(editor.save());
    if (compiled.ok) session.load(compiled.program);
    else session.clear();
  };
  recompile();
  const actions = createProjectActions({ editor, session, recompile, getCompiled: () => compiled });
  return { actions, editor, session, frames, double, getCompiled: () => compiled, ws: () => editor.save() };
}

/** Run the session for a few frames so there is something to lose. */
function playSome(t) {
  t.session.run();
  for (let i = 0; i < 5; i++) t.frames.advance(1000 / 60);
}

const file = (text, name = 'experiment.motionlab.json') => new File([text], name, { type: 'application/json' });

// ---------------------------------------------------------------- round trip

test('round trip: Save then Open restores block order, positions, stable ids, field values and loose blocks', async () => {
  const a = setup(editorFixture());
  const saved = a.actions.save();
  assert.equal(saved.filename, 'experiment.motionlab.json');

  const b = setup(workspace()); // a different editor with the canonical example open
  const result = await b.actions.open(file(saved.text));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(b.ws(), editorFixture(), 'identical editor state, including x/y of top-level blocks');
  assert.deepEqual(b.getCompiled().program, editorProgram(), 'commands regenerated from the blocks, with the same blockIds');
  assert.equal(b.getCompiled().warnings.length, 1, 'the loose block is still loose');
  // Saving again gives the same text: nothing is lost or reordered.
  assert.equal(b.actions.save().text, saved.text);
});

test('editor state is authoritative: a tampered "program" field is ignored on open', async () => {
  const t = setup();
  const envelope = JSON.parse(serializeProjectFile(editorFixture(), { version: 1, commands: [{ op: 'setGravity', blockId: 'evil', x: 0, y: 50 }] }));
  await t.actions.open(file(JSON.stringify(envelope)));
  assert.deepEqual(t.getCompiled().program, editorProgram());
});

test('Save includes the derived program, or null when the blocks do not compile; Export only when valid', () => {
  const ok = setup();
  assert.deepEqual(JSON.parse(ok.actions.save().text).program, ok.getCompiled().program);
  assert.equal(ok.actions.exportProgram().filename, 'experiment.program.json');
  assert.deepEqual(JSON.parse(ok.actions.exportProgram().text), ok.getCompiled().program);

  const broken = clone(workspace());
  broken.blocks.blocks[0].next.block.fields.Y = 500; // gravity out of range
  const bad = setup(broken);
  assert.equal(bad.getCompiled().ok, false);
  assert.equal(JSON.parse(bad.actions.save().text).program, null);
  assert.deepEqual(JSON.parse(bad.actions.save().text).workspace, broken, 'the blocks are still saved');
  assert.equal(bad.actions.exportProgram(), null);
});

// ---------------------------------------------------------------- successful import

test('successful open stops playback, drops the previous simulation and starts fresh at tick 0', async () => {
  const t = setup();
  playSome(t);
  assert.equal(t.session.status.running, true);
  const oldSim = t.double.log.instances.at(-1);
  const result = await t.actions.open(file(serializeProjectFile(editorFixture())));
  assert.equal(result.ok, true);
  assert.deepEqual([t.session.status.running, t.session.status.tick, t.frames.pendingCount], [false, 0, 0]);
  assert.notEqual(t.double.log.instances.at(-1), oldSim, 'a new simulation instance');
});

test('opening a file with the same program still starts a fresh session', async () => {
  const t = setup(editorFixture());
  playSome(t);
  const created = t.double.log.created;
  await t.actions.open(file(t.actions.save().text));
  assert.equal(t.double.log.created, created + 1);
  assert.deepEqual([t.session.status.running, t.session.status.tick], [false, 0]);
});

// ---------------------------------------------------------------- failed import: nothing changes

async function assertUntouched(t, f, code) {
  playSome(t);
  const before = { ws: t.ws(), tick: t.session.status.tick, created: t.double.log.created, loads: t.editor.loads, compiled: t.getCompiled() };
  const result = await t.actions.open(f);
  assert.equal(result.ok, false);
  assert.equal(result.code, code, result.message);
  assert.match(result.message, /Could not (open|read) .+kept\./);
  assert.deepEqual(t.ws(), before.ws, 'editor unchanged');
  assert.equal(t.editor.loads, before.loads, 'editor never asked to load');
  assert.equal(t.getCompiled(), before.compiled, 'no recompile');
  assert.equal(t.double.log.created, before.created, 'same simulation');
  assert.equal(t.session.status.running, true, 'still running');
  assert.equal(t.frames.pendingCount, 1, 'its animation frame is still scheduled');
  assert.equal(t.session.status.tick, before.tick);
  t.frames.advance(1000 / 60);
  assert.equal(t.session.status.tick, before.tick + 2, 'and it keeps playing');
  return result.message;
}

test('malformed file: explained, editor and running session untouched', async () => {
  const msg = await assertUntouched(setup(), file('{"format": "motionlab-project", "formatVersion": 1,', 'broken.json'), F.FILE_NOT_JSON);
  assert.match(msg, /^Could not open broken\.json: The file is not valid JSON\./);
});

test('unsupported (newer) version: explained, editor and running session untouched', async () => {
  const envelope = JSON.parse(serializeProjectFile(editorFixture()));
  envelope.formatVersion = 2;
  const msg = await assertUntouched(setup(), file(JSON.stringify(envelope), 'from-the-future.motionlab.json'), F.FILE_UNSUPPORTED_VERSION);
  assert.match(msg, /made by a newer MotionLab \(formatVersion 2; this version reads 1\)\. Update MotionLab to open it\./);
});

test('oversized file: rejected from its size before it is read', async () => {
  const t = setup();
  let read = false;
  const huge = { name: 'huge.motionlab.json', size: MAX_FILE_BYTES + 1, text: async () => { read = true; return '{}'; } };
  const msg = await assertUntouched(t, huge, F.FILE_TOO_LARGE);
  assert.equal(read, false, 'file.text() was never called');
  assert.match(msg, /limit is 1 MB/);
});

test('unknown block type, and a file that cannot be read: nothing changes', async () => {
  const foreign = JSON.parse(serializeProjectFile(workspace()));
  foreign.workspace.blocks.blocks.push({ type: 'controls_repeat', id: 'r' });
  await assertUntouched(setup(), file(JSON.stringify(foreign)), F.FILE_UNKNOWN_BLOCK);
  await assertUntouched(setup(), { name: 'gone.json', size: 10, text: async () => { throw new Error('NotReadableError'); } }, FILE_READ_FAILED);
});

test('editor rejects a validated file: the previous blocks come back', async () => {
  const t = setup();
  const before = t.ws();
  const env = JSON.parse(serializeProjectFile(editorFixture()));
  env.workspace.rejectMe = true;
  const result = await t.actions.open(file(JSON.stringify(env)));
  assert.deepEqual([result.ok, result.code], [false, EDITOR_REJECTED]);
  assert.match(result.message, /Your previous blocks were kept\./);
  assert.deepEqual(t.ws(), before);
  assert.equal(t.session.status.hasSession, true, 'recompiled from the restored blocks');
});
