// Files and Download actions: open a project file into the editor, save the editor as a project file, export the
// program. DOM-free and Blockly-free: the page passes an editor adapter (save/load Blockly JSON), the session
// controller and a recompile callback. Contract: docs/ARCHITECTURE.md ("Project envelope v1", "Import behaviour").
//
// Rules
//   - The editor state (Blockly workspace JSON) is authoritative. Runtime commands are always regenerated from it:
//     on open (the file's "program" field is ignored) and before every Run (the page compiles pending edits first).
//   - Size is checked from File.size before the file is read; the whole file is validated before anything changes.
//   - A failed open changes nothing: the editor, the session and its playback stay exactly as they were.
//   - A successful open stops playback, drops the previous simulation and restores the workspace from the file.

import { FileFormatError, PROGRAM_FILENAME, PROJECT_FILENAME, checkFileSize, parseMotionLabFile, serializeProgram, serializeProjectFile } from './files.js';

export const EDITOR_REJECTED = 'EDITOR_REJECTED';
export const FILE_READ_FAILED = 'FILE_READ_FAILED';

/**
 * @param {object} deps
 * @param {{save: () => object, load: (json: object) => void}} deps.editor  load() may throw if it rejects the JSON
 * @param {{clear: () => void}} deps.session  the session controller (static/js/motionlab/session.js)
 * @param {() => void} deps.recompile  compile the editor's current workspace into a (fresh) session
 * @param {() => ({ok: boolean, program: object|null}|null)} deps.getCompiled  the latest compile result
 */
export function createProjectActions({ editor, session, recompile, getCompiled }) {
  /**
   * Replace the workspace and start a fresh session from it. If the editor rejects the JSON, the previous workspace
   * is put back and the error is rethrown.
   */
  function replaceWorkspace(json) {
    const previous = editor.save();
    session.clear(); // stop playback and drop the old simulation, even if the program turns out to be the same
    try {
      editor.load(json);
    } catch (err) {
      editor.load(previous);
      throw err;
    } finally {
      recompile();
    }
  }

  /**
   * Open a File (or any {name, size, text()}). Never throws.
   * @returns {Promise<{ok: true, source: 'project'|'program', message: string} | {ok: false, code: string, message: string}>}
   */
  async function open(file) {
    const name = file?.name || 'the file';
    let parsed;
    try {
      checkFileSize(file.size); // before reading a single byte
      parsed = parseMotionLabFile(await file.text());
    } catch (err) {
      if (err instanceof FileFormatError) return { ok: false, code: err.code, message: `Could not open ${name}: ${err.message} Your current blocks were kept.` };
      return { ok: false, code: FILE_READ_FAILED, message: `Could not read ${name}. Your current blocks were kept.` };
    }
    try {
      replaceWorkspace(parsed.workspace);
    } catch (err) {
      return { ok: false, code: EDITOR_REJECTED, message: `Could not open ${name}: the editor rejected it (${err.message}). Your previous blocks were kept.` };
    }
    return { ok: true, source: parsed.source, message: `Opened ${name}${parsed.source === 'program' ? ' (program converted to blocks)' : ''}.` };
  }

  /** The editor as a project file. `program` is included for readers and tools, or null if the blocks do not compile. */
  function save() {
    const compiled = getCompiled();
    return { filename: PROJECT_FILENAME, text: serializeProjectFile(editor.save(), compiled?.ok ? compiled.program : null) };
  }

  /** The compiled program on its own, or null when the blocks do not compile. */
  function exportProgram() {
    const compiled = getCompiled();
    return compiled?.ok ? { filename: PROGRAM_FILENAME, text: serializeProgram(compiled.program) } : null;
  }

  return { open, save, exportProgram, replaceWorkspace };
}
