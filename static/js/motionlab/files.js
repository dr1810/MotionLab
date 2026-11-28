// Project files: the browser-side storage contract. No DOM; lab.js does the download/upload.
// Contract and rationale: docs/ARCHITECTURE.md ("Project envelope v1").
//
//   { "format": "motionlab-project", "formatVersion": 1, "contractVersion": 1,
//     "workspace": <Blockly JSON, authoritative>, "program": <program v1 or null, derived, ignored on open> }
//
// Open also accepts a bare program v1 ({version: 1, commands: [...]}), converted to blocks.

import { CONTRACT_VERSION } from './contract.js';
import { BLOCK_TYPES, START_BLOCK_TYPE, programToWorkspace } from './compile.js';

export const FILE_FORMAT = 'motionlab-project';
/** Tag written by earlier builds; still accepted on open, never written. */
export const LEGACY_FILE_FORMATS = Object.freeze(['motionlab-workspace']);
export const FILE_FORMAT_VERSION = 1;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_PROJECT_BLOCKS = 600;
export const PROJECT_FILENAME = 'experiment.motionlab.json';
export const PROGRAM_FILENAME = 'experiment.program.json';

export const FILE_ERROR_CODES = Object.freeze({
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_NOT_JSON: 'FILE_NOT_JSON',
  FILE_NOT_OBJECT: 'FILE_NOT_OBJECT',
  FILE_UNKNOWN_FORMAT: 'FILE_UNKNOWN_FORMAT',
  FILE_UNSUPPORTED_VERSION: 'FILE_UNSUPPORTED_VERSION',
  FILE_INVALID_WORKSPACE: 'FILE_INVALID_WORKSPACE',
  FILE_UNKNOWN_BLOCK: 'FILE_UNKNOWN_BLOCK',
  FILE_TOO_MANY_BLOCKS: 'FILE_TOO_MANY_BLOCKS',
  FILE_INVALID_PROGRAM: 'FILE_INVALID_PROGRAM',
});

export class FileFormatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FileFormatError';
    this.code = code;
  }
}

const F = FILE_ERROR_CODES;
const fail = (code, message) => {
  throw new FileFormatError(code, message);
};
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const KNOWN_BLOCK_TYPES = new Set([START_BLOCK_TYPE, ...Object.keys(BLOCK_TYPES)]);
const MB = MAX_FILE_BYTES / 1_000_000;

/** UTF-8 byte length (works in Node and browsers). */
export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/** Reject an oversized file from its size alone, before reading it (File.size in the browser). */
export function checkFileSize(bytes) {
  if (bytes > MAX_FILE_BYTES) {
    fail(F.FILE_TOO_LARGE, `File is ${(bytes / 1_000_000).toFixed(1)} MB; the limit is ${MB} MB. Open a smaller project file.`);
  }
}

/** Build the envelope object. `program` is the derived program v1, or null if the blocks do not compile. */
export function createProjectEnvelope(workspace, program = null) {
  return { format: FILE_FORMAT, formatVersion: FILE_FORMAT_VERSION, contractVersion: CONTRACT_VERSION, workspace, program };
}

/** @returns {string} pretty JSON text for a project file */
export function serializeProjectFile(workspace, program = null) {
  return `${JSON.stringify(createProjectEnvelope(workspace, program), null, 2)}\n`;
}

/** @returns {string} pretty JSON text for an exported program */
export function serializeProgram(program) {
  return `${JSON.stringify(program, null, 2)}\n`;
}

function checkVersion(name, value, supported) {
  if (value === supported) return;
  if (Number.isInteger(value) && value > supported) {
    fail(F.FILE_UNSUPPORTED_VERSION, `This file was made by a newer MotionLab (${name} ${value}; this version reads ${supported}). Update MotionLab to open it.`);
  }
  fail(F.FILE_UNSUPPORTED_VERSION, `Unsupported ${name} ${JSON.stringify(value)}; expected ${supported}. The file may be damaged.`);
}

/**
 * Check a Blockly workspace JSON against the envelope rules (shape, known block types, unique ids, block count).
 * Field values are left to the compiler. Throws FileFormatError.
 */
export function validateWorkspace(workspace) {
  if (!isPlainObject(workspace)) fail(F.FILE_INVALID_WORKSPACE, 'The project has no "workspace" object, so there are no blocks to open.');
  if (workspace.blocks === undefined) return; // empty workspace
  if (!isPlainObject(workspace.blocks) || !Array.isArray(workspace.blocks.blocks)) {
    fail(F.FILE_INVALID_WORKSPACE, '"workspace.blocks.blocks" must be a list of blocks. The file may be damaged.');
  }
  const ids = new Set();
  let count = 0;
  const visit = (block, where) => {
    if (!isPlainObject(block)) fail(F.FILE_INVALID_WORKSPACE, `${where} is not a block object.`);
    count += 1;
    if (count > MAX_PROJECT_BLOCKS) fail(F.FILE_TOO_MANY_BLOCKS, `The project has more than ${MAX_PROJECT_BLOCKS} blocks. Split it into smaller experiments.`);
    if (typeof block.type !== 'string' || !KNOWN_BLOCK_TYPES.has(block.type)) {
      fail(F.FILE_UNKNOWN_BLOCK, `${where} has block type ${JSON.stringify(block.type)}, which MotionLab does not have. Remove that block from the file or re-save it from MotionLab.`);
    }
    if (typeof block.id !== 'string' || block.id.length === 0 || block.id.length > 64) {
      fail(F.FILE_INVALID_WORKSPACE, `${where} (${block.type}) needs an "id" string of 1-64 characters.`);
    }
    if (ids.has(block.id)) fail(F.FILE_INVALID_WORKSPACE, `Two blocks share the id "${block.id}". Every block needs its own id.`);
    ids.add(block.id);
    if (block.fields !== undefined && !isPlainObject(block.fields)) fail(F.FILE_INVALID_WORKSPACE, `Block "${block.id}" has "fields" that are not an object.`);
    if (block.inputs !== undefined && !(isPlainObject(block.inputs) && Object.keys(block.inputs).length === 0)) {
      fail(F.FILE_INVALID_WORKSPACE, `Block "${block.id}" has inputs, but MotionLab blocks have none. The file was not made by MotionLab.`);
    }
    return block.next === undefined ? null : block.next;
  };
  workspace.blocks.blocks.forEach((top, i) => {
    let block = top;
    let where = `Top-level block ${i + 1}`;
    for (;;) {
      const next = visit(block, where);
      if (next === null) break;
      if (!isPlainObject(next) || !('block' in next)) fail(F.FILE_INVALID_WORKSPACE, `Block "${block.id}" has a malformed "next" connection.`);
      where = `The block after "${block.id}"`;
      block = next.block;
    }
  });
}

/**
 * Parse and validate an opened file. Never touches editor state.
 * @returns {{source: 'project' | 'program', workspace: object}}
 * @throws {FileFormatError} with .code (FILE_ERROR_CODES) and an actionable message
 */
export function parseMotionLabFile(text) {
  if (typeof text !== 'string') fail(F.FILE_NOT_JSON, 'The file could not be read as text.');
  checkFileSize(byteLength(text));
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(F.FILE_NOT_JSON, 'The file is not valid JSON. Choose a .motionlab.json file saved from MotionLab.');
  }
  if (!isPlainObject(data)) fail(F.FILE_NOT_OBJECT, 'The file is JSON but not a MotionLab project (expected an object).');

  if (data.format === FILE_FORMAT || LEGACY_FILE_FORMATS.includes(data.format)) {
    checkVersion('formatVersion', data.formatVersion, FILE_FORMAT_VERSION);
    checkVersion('contractVersion', data.contractVersion, CONTRACT_VERSION);
    validateWorkspace(data.workspace);
    return { source: 'project', workspace: data.workspace };
  }
  if ('version' in data && 'commands' in data) {
    let workspace;
    try {
      workspace = programToWorkspace(data);
    } catch (err) {
      fail(F.FILE_INVALID_PROGRAM, `The program cannot be turned into blocks: ${err.message}.`);
    }
    validateWorkspace(workspace);
    return { source: 'program', workspace };
  }
  fail(F.FILE_UNKNOWN_FORMAT, 'Not a MotionLab file. Expected a project saved with Save (format "motionlab-project") or an exported program ({"version": 1, "commands": [...]}).');
}
