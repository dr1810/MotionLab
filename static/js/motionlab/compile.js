// Workspace -> program v1 compiler.
// Input is the plain JSON produced by Blockly.serialization.workspaces.save(workspace)
// (or just its `blocks` member). No Blockly runtime types are used or required.
// Only the stack connected below the single start block is serialized; every other
// top-level stack is ignored. The start block itself emits no command.

import { ERROR_CODES, OPS, PROGRAM_VERSION, validateProgram } from './contract.js';

export const START_BLOCK_TYPE = 'motionlab_start';

/** Blockly block type -> program op. Field names are the payload names upper-cased. */
export const BLOCK_TYPES = Object.freeze({
  motionlab_create_circle: 'createCircle',
  motionlab_create_box: 'createBox',
  motionlab_set_gravity: 'setGravity',
  motionlab_set_velocity: 'setVelocity',
  motionlab_apply_force: 'applyForce',
});

const err = (code, message, blockId = null) => ({ code, message, blockId });

/**
 * Returns { ok, program, errors }.
 * - Structural errors (no/multiple start blocks, unknown block types): program is null.
 * - Otherwise program is the compiled v1 document and errors come from validateProgram().
 */
export function compileWorkspace(workspaceJson) {
  const root = workspaceJson && typeof workspaceJson === 'object' && 'blocks' in workspaceJson
    && !Array.isArray(workspaceJson.blocks) ? workspaceJson.blocks : workspaceJson;
  const topBlocks = root && typeof root === 'object' ? (root.blocks ?? []) : null;
  if (!Array.isArray(topBlocks)) {
    return { ok: false, program: null, errors: [err(ERROR_CODES.INVALID_DOCUMENT, 'Workspace JSON has no blocks array.')] };
  }

  const starts = topBlocks.filter((b) => b && b.type === START_BLOCK_TYPE);
  if (starts.length === 0) {
    return { ok: false, program: null, errors: [err(ERROR_CODES.NO_START_BLOCK, 'Add a start block and attach blocks below it.')] };
  }
  if (starts.length > 1) {
    return {
      ok: false,
      program: null,
      errors: starts.slice(1).map((b) => err(ERROR_CODES.MULTIPLE_START_BLOCKS,
        'Only one start block is allowed; remove this one.', b.id ?? null)),
    };
  }

  const commands = [];
  const errors = [];
  let block = starts[0].next?.block;
  // Cap the walk so a pathological chain cannot run unbounded; validateProgram reports the limit.
  while (block && commands.length + errors.length <= 10000) {
    if (!isDisabled(block)) {
      const op = Object.prototype.hasOwnProperty.call(BLOCK_TYPES, block.type) ? BLOCK_TYPES[block.type] : null;
      if (!op) {
        errors.push(err(ERROR_CODES.UNKNOWN_BLOCK_TYPE, `Unknown block type ${JSON.stringify(block.type)}.`, block.id ?? null));
      } else {
        const fields = block.fields ?? {};
        const cmd = { op, blockId: block.id };
        for (const [name, kind] of OPS[op]) {
          const key = name.toUpperCase();
          if (!(key in fields)) continue; // validateProgram reports MISSING_FIELD
          cmd[name] = kind === 'boolean' ? toBoolean(fields[key]) : fields[key];
        }
        commands.push(cmd);
      }
    }
    block = block.next?.block;
  }
  if (errors.length) return { ok: false, program: null, errors };

  const program = { version: PROGRAM_VERSION, commands };
  const result = validateProgram(program);
  return { ok: result.ok, program, errors: result.errors };
}

/**
 * Inverse of compileWorkspace for a valid program: returns Blockly serialization JSON with a
 * start block at (20, 20) and one block per command, in order, keeping each blockId.
 * Used to load plain program files and to build the default workspace.
 */
export function programToWorkspace(program) {
  const typeForOp = Object.fromEntries(Object.entries(BLOCK_TYPES).map(([type, op]) => [op, type]));
  let next;
  for (let i = program.commands.length - 1; i >= 0; i--) {
    const cmd = program.commands[i];
    const fields = {};
    for (const [name] of OPS[cmd.op]) fields[name.toUpperCase()] = cmd[name];
    next = { type: typeForOp[cmd.op], id: cmd.blockId, fields, ...(next ? { next: { block: next } } : {}) };
  }
  const used = new Set(program.commands.map((c) => c.blockId));
  let startId = 'start';
  for (let n = 1; used.has(startId); n++) startId = `start-${n}`;
  const start = { type: START_BLOCK_TYPE, id: startId, x: 20, y: 20, ...(next ? { next: { block: next } } : {}) };
  return { blocks: { languageVersion: 0, blocks: [start] } };
}

function isDisabled(block) {
  return block.enabled === false || (Array.isArray(block.disabledReasons) && block.disabledReasons.length > 0);
}

// Blockly checkbox fields serialize as booleans (current) or "TRUE"/"FALSE" (legacy).
function toBoolean(v) {
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  return v;
}
