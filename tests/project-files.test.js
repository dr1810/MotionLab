// Project envelope v1 (docs/ARCHITECTURE.md): round-trips and invalid input handling for the browser-side
// storage path. Every FILE_* error code has at least one case.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILE_FORMAT, FILE_FORMAT_VERSION, FILE_ERROR_CODES as F, MAX_FILE_BYTES, MAX_PROJECT_BLOCKS, FileFormatError,
  byteLength, checkFileSize, createProjectEnvelope, parseMotionLabFile, serializeProgram, serializeProjectFile, validateWorkspace,
} from '../static/js/motionlab/files.js';
import { compileWorkspace, programToWorkspace } from '../static/js/motionlab/compile.js';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { program, workspace, expected } from './helpers.js';

const envelope = (over = {}) => ({ ...createProjectEnvelope(workspace(), program()), ...over });
const text = (obj) => JSON.stringify(obj);
const ws = (...top) => ({ blocks: { languageVersion: 0, blocks: top } });
const chainOf = (n, type = 'motionlab_set_gravity') => {
  let next;
  for (let i = n - 1; i >= 0; i--) next = { block: { type, id: `g${i}`, fields: { X: 0, Y: -1 }, ...(next ? { next } : {}) } };
  return next.block;
};

/** parseMotionLabFile must throw FileFormatError with this code; returns the message. */
function failsWith(input, code, msg) {
  let err = null;
  try {
    parseMotionLabFile(input);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof FileFormatError, `${msg}: expected FileFormatError, got ${err}`);
  assert.equal(err.code, code, `${msg}: ${err.message}`);
  assert.ok(Object.values(F).includes(err.code));
  assert.ok(err.message.length > 20, `${msg}: message should explain the problem`);
  return err.message;
}

// ---------------------------------------------------------------- envelope and round-trips

test('saved envelope has exactly the documented fields, in order', () => {
  const data = JSON.parse(serializeProjectFile(workspace(), program()));
  assert.deepEqual(Object.keys(data), ['format', 'formatVersion', 'contractVersion', 'workspace', 'program']);
  assert.equal(data.format, 'motionlab-project');
  assert.equal(FILE_FORMAT, 'motionlab-project');
  assert.equal(data.formatVersion, 1);
  assert.equal(FILE_FORMAT_VERSION, 1);
  assert.equal(data.contractVersion, 1);
  assert.equal(JSON.parse(serializeProjectFile(workspace())).program, null, 'program is null when the blocks did not compile');
});

test('round-trip: save -> open -> compile -> run reproduces the fixture', () => {
  const saved = serializeProjectFile(workspace(), program());
  const opened = parseMotionLabFile(saved);
  assert.deepEqual(opened, { source: 'project', workspace: workspace() });
  const compiled = compileWorkspace(opened.workspace);
  assert.deepEqual(compiled.program, program());
  assert.deepEqual(createSimulation(compiled.program).snapshot(), expected().initial);
});

test('round-trip is lossless and stable: save -> open -> save gives identical text', () => {
  const first = serializeProjectFile(workspace(), program());
  const reopened = parseMotionLabFile(first).workspace;
  assert.equal(serializeProjectFile(reopened, compileWorkspace(reopened).program), first);
});

test('round-trip keeps editor details: positions, ids, field values, loose and disabled blocks', () => {
  const editor = ws(
    { type: 'motionlab_start', id: 'S', x: 40, y: 60, next: { block: { type: 'motionlab_create_circle', id: 'c', fields: { ID: 'ball', X: 1.25, Y: 2, RADIUS: 0.3, MASS: 2, RESTITUTION: 0.4, STATIC: false }, enabled: false } } },
    { type: 'motionlab_set_gravity', id: 'loose', x: 300, y: 12, fields: { X: 0, Y: -3.7 } },
  );
  const opened = parseMotionLabFile(serializeProjectFile(editor)).workspace;
  assert.deepEqual(opened, editor);
});

test('editor state is authoritative: the stored program is ignored and regenerated', () => {
  const other = { version: 1, commands: [{ op: 'setGravity', blockId: 'zzz', x: 0, y: 5 }] };
  const opened = parseMotionLabFile(text(envelope({ program: other })));
  assert.deepEqual(compileWorkspace(opened.workspace).program, program(), 'compiled from blocks, not from "program"');
  // Even a damaged "program" field does not block opening.
  assert.doesNotThrow(() => parseMotionLabFile(text(envelope({ program: 'not a program' }))));
});

test('empty workspace, legacy format tag and extra fields are accepted', () => {
  assert.deepEqual(parseMotionLabFile(text(envelope({ workspace: {}, program: null }))), { source: 'project', workspace: {} });
  assert.equal(parseMotionLabFile(text(envelope({ format: 'motionlab-workspace' }))).source, 'project');
  assert.equal(parseMotionLabFile(text(envelope({ title: 'Lab 3', savedBy: 'someone' }))).source, 'project');
});

test('bare program import: converted to blocks that compile back to the same program', () => {
  const opened = parseMotionLabFile(serializeProgram(program()));
  assert.equal(opened.source, 'program');
  assert.deepEqual(compileWorkspace(opened.workspace).program, program());
  assert.deepEqual(parseMotionLabFile(text({ version: 1, commands: [] })).source, 'program');
});

test('exactly MAX_PROJECT_BLOCKS blocks is allowed', () => {
  assert.equal(MAX_PROJECT_BLOCKS, 600);
  assert.doesNotThrow(() => validateWorkspace(ws(chainOf(MAX_PROJECT_BLOCKS))));
});

test('parsing is pure: same input, same result, input text untouched', () => {
  const t = serializeProjectFile(workspace(), program());
  assert.deepEqual(parseMotionLabFile(t), parseMotionLabFile(t));
});

// ---------------------------------------------------------------- invalid input, one block per error code

test('FILE_TOO_LARGE: by size before reading, and by UTF-8 bytes of the text', () => {
  assert.equal(MAX_FILE_BYTES, 1_000_000);
  assert.doesNotThrow(() => checkFileSize(MAX_FILE_BYTES));
  assert.throws(() => checkFileSize(MAX_FILE_BYTES + 1), (e) => e.code === F.FILE_TOO_LARGE && /limit is 1 MB/.test(e.message));
  const wide = 'é'.repeat(500_001); // 500,001 characters but 1,000,002 bytes
  assert.equal(byteLength(wide), 1_000_002);
  failsWith(wide, F.FILE_TOO_LARGE, 'multibyte text over the byte limit');
});

test('FILE_NOT_JSON', () => {
  for (const t of ['{nope', '', '{"format": "motionlab-project",}']) failsWith(t, F.FILE_NOT_JSON, JSON.stringify(t));
  failsWith(42, F.FILE_NOT_JSON, 'not text');
});

test('FILE_NOT_OBJECT', () => {
  for (const t of ['[1, 2]', '42', 'null', '"motionlab"', 'true']) failsWith(t, F.FILE_NOT_OBJECT, t);
});

test('FILE_UNKNOWN_FORMAT', () => {
  for (const o of [{ hello: 1 }, { format: 'motionlab-other', formatVersion: 1 }, { version: 1 }]) {
    assert.match(failsWith(text(o), F.FILE_UNKNOWN_FORMAT, text(o)), /Not a MotionLab file/);
  }
});

test('FILE_UNSUPPORTED_VERSION: newer, wrong type and missing versions', () => {
  assert.match(failsWith(text(envelope({ formatVersion: 2 })), F.FILE_UNSUPPORTED_VERSION, 'newer format'), /newer MotionLab/);
  assert.match(failsWith(text(envelope({ contractVersion: 3 })), F.FILE_UNSUPPORTED_VERSION, 'newer contract'), /newer MotionLab/);
  failsWith(text(envelope({ formatVersion: '1' })), F.FILE_UNSUPPORTED_VERSION, 'string version');
  failsWith(text(envelope({ formatVersion: 0 })), F.FILE_UNSUPPORTED_VERSION, 'older version');
  const { contractVersion, ...noContract } = envelope();
  failsWith(text(noContract), F.FILE_UNSUPPORTED_VERSION, 'missing contractVersion');
});

test('FILE_INVALID_WORKSPACE: missing or malformed workspace and blocks', () => {
  const start = { type: 'motionlab_start', id: 's' };
  const cases = [
    [envelope({ workspace: undefined }), 'missing workspace'],
    [envelope({ workspace: [] }), 'workspace is an array'],
    [envelope({ workspace: { blocks: { blocks: {} } } }), 'blocks.blocks not a list'],
    [envelope({ workspace: { blocks: [] } }), 'blocks not an object'],
    [envelope({ workspace: ws(7) }), 'block is not an object'],
    [envelope({ workspace: ws({ type: 'motionlab_start' }) }), 'missing id'],
    [envelope({ workspace: ws({ type: 'motionlab_start', id: '' }) }), 'empty id'],
    [envelope({ workspace: ws(start, { type: 'motionlab_set_gravity', id: 's' }) }), 'duplicate ids'],
    [envelope({ workspace: ws({ ...start, fields: [1] }) }), 'fields not an object'],
    [envelope({ workspace: ws({ ...start, inputs: { A: { block: start } } }) }), 'inputs present'],
    [envelope({ workspace: ws({ ...start, next: { blok: {} } }) }), 'malformed next'],
    [envelope({ workspace: ws({ ...start, next: { block: 5 } }) }), 'next block not an object'],
  ];
  for (const [o, msg] of cases) failsWith(text(o), F.FILE_INVALID_WORKSPACE, msg);
  assert.match(failsWith(text(envelope({ workspace: ws(start, { ...start, type: 'motionlab_set_gravity' }) })), F.FILE_INVALID_WORKSPACE, 'dup'), /Two blocks share the id "s"/);
});

test('FILE_UNKNOWN_BLOCK: top level, inside a stack, or missing type', () => {
  failsWith(text(envelope({ workspace: ws({ type: 'math_number', id: 'm' }) })), F.FILE_UNKNOWN_BLOCK, 'top level');
  const nested = ws({ type: 'motionlab_start', id: 's', next: { block: { type: 'controls_repeat', id: 'r' } } });
  assert.match(failsWith(text(envelope({ workspace: nested })), F.FILE_UNKNOWN_BLOCK, 'nested'), /"controls_repeat", which MotionLab does not have/);
  failsWith(text(envelope({ workspace: ws({ id: 'x' }) })), F.FILE_UNKNOWN_BLOCK, 'missing type');
});

test('FILE_TOO_MANY_BLOCKS', () => {
  failsWith(text(envelope({ workspace: ws(chainOf(MAX_PROJECT_BLOCKS + 1)) })), F.FILE_TOO_MANY_BLOCKS, '601 blocks in one stack');
  const many = Array.from({ length: MAX_PROJECT_BLOCKS + 1 }, (_, i) => ({ type: 'motionlab_set_gravity', id: `t${i}` }));
  failsWith(text(envelope({ workspace: ws(...many) })), F.FILE_TOO_MANY_BLOCKS, '601 top-level blocks');
});

test('FILE_INVALID_PROGRAM: bare programs that cannot become blocks', () => {
  assert.match(failsWith(text({ version: 1, commands: [{ op: 'explode', blockId: 'x' }] }), F.FILE_INVALID_PROGRAM, 'unknown op'), /unknown op "explode"/);
  failsWith(text({ version: 1, commands: 3 }), F.FILE_INVALID_PROGRAM, 'commands not a list');
});

test('a bare program with invalid values still opens; the compiler flags the block', () => {
  const opened = parseMotionLabFile(text({ version: 1, commands: [{ op: 'createCircle', blockId: 'c', id: 'ball', x: 0, y: 1, radius: -1, mass: 1, restitution: 0, static: false }] }));
  assert.deepEqual(compileWorkspace(opened.workspace).errors.map((e) => [e.code, e.blockId]), [['OUT_OF_RANGE', 'c']]);
  assert.ok(programToWorkspace);
});
