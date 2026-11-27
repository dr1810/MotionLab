// Save/open format for the block lab. No DOM: lab.js does the download/upload.
//
// Saved file (experiment.motionlab.json):
//   { "format": "motionlab-workspace", "formatVersion": 1, "contractVersion": 1,
//     "workspace": <Blockly JSON serialization>, "program": <program v1, or null if it did not compile> }
// Open also accepts a bare program v1 ({version: 1, commands: [...]}), converted to blocks.

import { CONTRACT_VERSION } from './contract.js';
import { programToWorkspace } from './compile.js';

export const FILE_FORMAT = 'motionlab-workspace';
export const FILE_FORMAT_VERSION = 1;
export const MAX_FILE_BYTES = 1_000_000;
export const WORKSPACE_FILENAME = 'experiment.motionlab.json';
export const PROGRAM_FILENAME = 'experiment.program.json';

export class FileFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileFormatError';
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @returns {string} pretty JSON text for a workspace file */
export function serializeWorkspaceFile(workspace, program = null) {
  return `${JSON.stringify({ format: FILE_FORMAT, formatVersion: FILE_FORMAT_VERSION, contractVersion: CONTRACT_VERSION, workspace, program }, null, 2)}\n`;
}

/** @returns {string} pretty JSON text for an exported program */
export function serializeProgram(program) {
  return `${JSON.stringify(program, null, 2)}\n`;
}

/**
 * Parse an opened file.
 * @returns {{source: 'workspace' | 'program', workspace: object}}
 * @throws {FileFormatError} with a message suitable for the status line
 */
export function parseMotionLabFile(text) {
  if (typeof text !== 'string') throw new FileFormatError('File could not be read as text.');
  if (text.length > MAX_FILE_BYTES) throw new FileFormatError(`File is too large (limit ${MAX_FILE_BYTES / 1_000_000} MB).`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FileFormatError('File is not valid JSON.');
  }
  if (!isPlainObject(data)) throw new FileFormatError('File must contain a JSON object.');

  if (data.format === FILE_FORMAT) {
    if (data.formatVersion !== FILE_FORMAT_VERSION) {
      throw new FileFormatError(`Unsupported MotionLab file version ${JSON.stringify(data.formatVersion)} (expected ${FILE_FORMAT_VERSION}).`);
    }
    if (!isPlainObject(data.workspace)) throw new FileFormatError('MotionLab file has no "workspace" object.');
    return { source: 'workspace', workspace: data.workspace };
  }
  if ('version' in data && 'commands' in data) {
    try {
      return { source: 'program', workspace: programToWorkspace(data) };
    } catch (err) {
      throw new FileFormatError(`Program cannot be turned into blocks: ${err.message}`);
    }
  }
  throw new FileFormatError('Not a MotionLab file: expected a saved workspace or a program v1 ({version, commands}).');
}
