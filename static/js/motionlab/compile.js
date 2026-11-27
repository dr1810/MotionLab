// Compiles a Blockly workspace serialization (plain JSON from Blockly.serialization.workspaces.save)
// into program v1. Knows Blockly's JSON shape but imports nothing from Blockly or the DOM.
// Only the stack connected under the single start block is compiled; the start block itself emits no command.

import { ERROR_CODES, PROGRAM_VERSION, makeError, validateProgram } from './contract.js';

export const START_BLOCK_TYPE = 'motionlab_start';

/** Blockly block type -> { op, fields: { BLOCKLY_FIELD_NAME: commandKey } }. blocks.js builds blocks from this. */
export const BLOCK_TYPES = Object.freeze({
  motionlab_create_circle: { op: 'createCircle', fields: { ID: 'id', X: 'x', Y: 'y', RADIUS: 'radius', MASS: 'mass', RESTITUTION: 'restitution', STATIC: 'static' } },
  motionlab_create_box: { op: 'createBox', fields: { ID: 'id', X: 'x', Y: 'y', WIDTH: 'width', HEIGHT: 'height', MASS: 'mass', RESTITUTION: 'restitution', STATIC: 'static' } },
  motionlab_set_gravity: { op: 'setGravity', fields: { X: 'x', Y: 'y' } },
  motionlab_set_velocity: { op: 'setVelocity', fields: { ID: 'id', VX: 'vx', VY: 'vy' } },
  motionlab_apply_force: { op: 'applyForce', fields: { ID: 'id', FX: 'fx', FY: 'fy' } },
});

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Blockly <= 10 writes enabled:false; Blockly >= 11 writes a non-empty disabledReasons array. */
function isDisabled(block) {
  return block.enabled === false || (Array.isArray(block.disabledReasons) && block.disabledReasons.length > 0);
}

/** Checkbox fields serialize as booleans (or "TRUE"/"FALSE" in older saves). Anything else passes through for validation. */
function fieldValue(key, raw) {
  if (key === 'static' && (raw === 'TRUE' || raw === 'FALSE')) return raw === 'TRUE';
  return raw;
}

/**
 * @param {object} workspace  Blockly JSON serialization ({} for an empty workspace)
 * @returns {{ok: boolean, program: object|null, errors: Array<{code, message, blockId}>}}
 *   program is null only when there is no single start block or the input is not a workspace.
 *   Otherwise program is returned even when invalid, so its errors can be shown next to blocks.
 */
export function compileWorkspace(workspace) {
  const E = ERROR_CODES;
  if (!isPlainObject(workspace)) {
    return { ok: false, program: null, errors: [makeError(E.INVALID_WORKSPACE, 'Workspace must be a JSON object.')] };
  }
  const top = workspace.blocks === undefined ? [] : workspace.blocks?.blocks;
  if (!Array.isArray(top)) {
    return { ok: false, program: null, errors: [makeError(E.INVALID_WORKSPACE, 'Workspace "blocks.blocks" must be an array.')] };
  }

  const starts = top.filter((b) => isPlainObject(b) && b.type === START_BLOCK_TYPE);
  if (starts.length === 0) {
    return { ok: false, program: null, errors: [makeError(E.NO_START_BLOCK, 'Add a "when experiment starts" block.')] };
  }
  if (starts.length > 1) {
    const errors = starts.map((b) => makeError(E.MULTIPLE_START_BLOCKS, 'Only one "when experiment starts" block is allowed.', b.id));
    return { ok: false, program: null, errors };
  }

  const errors = [];
  const commands = [];
  let block = starts[0].next?.block;
  while (isPlainObject(block)) {
    if (!isDisabled(block)) {
      const spec = Object.prototype.hasOwnProperty.call(BLOCK_TYPES, block.type) ? BLOCK_TYPES[block.type] : null;
      if (!spec) {
        errors.push(makeError(E.UNKNOWN_BLOCK_TYPE, `Block type "${block.type}" cannot run in an experiment.`, block.id));
      } else {
        const command = { op: spec.op, blockId: block.id };
        const fields = isPlainObject(block.fields) ? block.fields : {};
        for (const [name, key] of Object.entries(spec.fields)) {
          if (Object.prototype.hasOwnProperty.call(fields, name)) command[key] = fieldValue(key, fields[name]);
        }
        commands.push(command);
      }
    }
    block = block.next?.block;
  }

  const program = { version: PROGRAM_VERSION, commands };
  errors.push(...validateProgram(program).errors);
  return { ok: errors.length === 0, program, errors };
}

const OP_TO_TYPE = Object.freeze(Object.fromEntries(Object.entries(BLOCK_TYPES).map(([type, t]) => [t.op, type])));

/**
 * Inverse of compileWorkspace: program v1 -> Blockly workspace JSON (one start block with the commands
 * stacked under it). Block ids reuse each command's blockId when it is a unique non-empty string.
 * Field values are copied as-is; Blockly's number fields may clamp out-of-range values on load.
 * @throws {Error} if the program has no commands array or contains an op that has no block
 */
export function programToWorkspace(program) {
  if (!isPlainObject(program) || !Array.isArray(program.commands)) throw new Error('program has no "commands" array');
  const used = new Set();
  const freshId = (wanted, fallback) => {
    let id = typeof wanted === 'string' && wanted.length > 0 && wanted.length <= 64 && !used.has(wanted) ? wanted : null;
    for (let n = 1; id === null; n++) if (!used.has(`${fallback}-${n}`)) id = `${fallback}-${n}`;
    used.add(id);
    return id;
  };
  const blockIds = new Set(program.commands.map((c) => (isPlainObject(c) ? c.blockId : undefined)));
  const startId = blockIds.has('start') ? freshId(null, 'start') : freshId('start', 'start');

  const blocks = program.commands.map((cmd, i) => {
    const type = isPlainObject(cmd) ? OP_TO_TYPE[cmd.op] : undefined;
    if (!type || !Object.prototype.hasOwnProperty.call(OP_TO_TYPE, cmd.op)) {
      throw new Error(`command ${i + 1} has unknown op ${JSON.stringify(isPlainObject(cmd) ? cmd.op : cmd)}`);
    }
    const fields = {};
    for (const [name, key] of Object.entries(BLOCK_TYPES[type].fields)) {
      if (cmd[key] !== undefined) fields[name] = cmd[key];
    }
    return { type, id: freshId(cmd.blockId, 'blk'), fields };
  });
  for (let i = blocks.length - 1; i > 0; i--) blocks[i - 1].next = { block: blocks[i] };
  const start = { type: START_BLOCK_TYPE, id: startId, x: 20, y: 20 };
  if (blocks.length) start.next = { block: blocks[0] };
  return { blocks: { languageVersion: 0, blocks: [start] } };
}
