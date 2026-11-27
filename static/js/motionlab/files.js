// Save/load format for MotionLab files. Pure functions; the page does the actual download/upload.
//
// A saved file is JSON:
//   { format: "motionlab", fileVersion: 1, contractVersion: 1, workspace: <Blockly serialization JSON> }
// Loading also accepts a bare program v1 document ({version: 1, commands}), converted to blocks.

import { CONTRACT_VERSION, PROGRAM_VERSION, validateProgram } from './contract.js';
import { programToWorkspace } from './compile.js';

export const FILE_FORMAT = 'motionlab';
export const FILE_VERSION = 1;
export const MAX_FILE_BYTES = 1_000_000;

export const FILE_ERROR_CODES = Object.freeze({
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_JSON: 'INVALID_JSON',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
});

const fileErr = (code, message) => ({ ok: false, workspace: null, errors: [{ code, message, blockId: null }] });

export function serializeWorkspaceFile(workspaceJson) {
  return `${JSON.stringify({
    format: FILE_FORMAT, fileVersion: FILE_VERSION, contractVersion: CONTRACT_VERSION, workspace: workspaceJson,
  }, null, 2)}\n`;
}

/** Returns { ok, workspace, errors }. Never throws. */
export function parseWorkspaceFile(text) {
  if (typeof text !== 'string') return fileErr(FILE_ERROR_CODES.UNSUPPORTED_FILE, 'File contents must be text.');
  if (text.length > MAX_FILE_BYTES) {
    return fileErr(FILE_ERROR_CODES.FILE_TOO_LARGE, `File is larger than ${MAX_FILE_BYTES} bytes.`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fileErr(FILE_ERROR_CODES.INVALID_JSON, 'File is not valid JSON.');
  }
  if (data && typeof data === 'object' && data.format === FILE_FORMAT) {
    if (data.fileVersion !== FILE_VERSION) {
      return fileErr(FILE_ERROR_CODES.UNSUPPORTED_FILE, `Unsupported MotionLab file version ${JSON.stringify(data.fileVersion)}.`);
    }
    if (!data.workspace || typeof data.workspace !== 'object' || Array.isArray(data.workspace)) {
      return fileErr(FILE_ERROR_CODES.UNSUPPORTED_FILE, 'MotionLab file has no workspace.');
    }
    return { ok: true, workspace: data.workspace, errors: [] };
  }
  if (data && typeof data === 'object' && 'commands' in data && data.version === PROGRAM_VERSION) {
    const result = validateProgram(data);
    if (!result.ok) return { ok: false, workspace: null, errors: result.errors };
    return { ok: true, workspace: programToWorkspace(data), errors: [] };
  }
  return fileErr(FILE_ERROR_CODES.UNSUPPORTED_FILE, 'Not a MotionLab file or program v1 document.');
}
