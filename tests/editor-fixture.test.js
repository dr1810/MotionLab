// Canonical editor fixture: a stack authored in the real block lab (tray clicks, Blockly-generated block ids, one
// disconnected block dropped beside the stack) serializes to the expected program v1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compileWorkspace } from '../static/js/motionlab/compile.js';
import { ERROR_CODES as E } from '../static/js/motionlab/contract.js';
import { createSimulation } from '../static/js/motionlab/engine.js';
import { outlineWorkspace } from '../static/js/motionlab/outline.js';
import { parseMotionLabFile, serializeProjectFile } from '../static/js/motionlab/files.js';
import { loadJson, program, expected } from './helpers.js';

const editor = () => loadJson('fixtures/ball-and-box.editor.workspace.json');
const editorProgram = () => loadJson('fixtures/ball-and-box.editor.program.json');
const stackIds = (ws) => {
  const ids = [];
  for (let b = ws.blocks.blocks[0].next?.block; b; b = b.next?.block) ids.push(b.id);
  return ids;
};

test('editor-authored stack serializes exactly to the expected program', () => {
  const r = compileWorkspace(editor());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.program, editorProgram());
});

test('it is the canonical ball-and-box program, with the editor\'s own block ids', () => {
  const strip = (p) => p.commands.map(({ blockId, ...rest }) => rest);
  assert.deepEqual(strip(editorProgram()), strip(program()));
  assert.deepEqual(editorProgram().commands.map((c) => c.blockId), stackIds(editor()));
  assert.deepEqual(createSimulation(editorProgram()).snapshot(), expected().initial);
});

test('block ids are Blockly-generated, unique and stable across compiles and save/open', () => {
  const ids = stackIds(editor());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.length === 20 && !id.startsWith('blk-'), `generated id: ${id}`);
  assert.deepEqual(compileWorkspace(editor()).program, compileWorkspace(editor()).program);
  const reopened = parseMotionLabFile(serializeProjectFile(editor())).workspace;
  assert.deepEqual(compileWorkspace(reopened).program, editorProgram());
});

test('the disconnected block is flagged and does not run', () => {
  const ws = editor();
  const loose = ws.blocks.blocks[1];
  assert.equal(loose.type, 'motionlab_set_gravity');
  assert.equal(loose.fields.Y, -1.62, 'moon gravity, if it ran');
  const r = compileWorkspace(ws);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.blockId]), [[E.DISCONNECTED_BLOCK, loose.id]]);
  assert.ok(!r.program.commands.some((c) => c.blockId === loose.id));
  assert.equal(r.program.commands.find((c) => c.op === 'setGravity').y, -9.81);
  assert.deepEqual(outlineWorkspace(ws).loose.map((s) => s.map((i) => i.id)), [[loose.id]]);
});

test('no JavaScript is generated or evaluated from blocks', () => {
  const dir = new URL('../static/js/', import.meta.url);
  const files = ['lab.js', ...readdirSync(new URL('motionlab/', dir)).map((f) => `motionlab/${f}`)];
  for (const f of files) {
    const code = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of ['eval(', 'new Function', 'Function(', 'javascriptGenerator', 'Blockly.JavaScript', 'Generator', 'setTimeout("', "setTimeout('"]) {
      assert.ok(!code.includes(banned), `${f} must not contain ${banned}`);
    }
  }
});
