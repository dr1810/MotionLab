// Block lab page glue: Code Blocks tray + Blockly Code Area <-> compiler <-> engine <-> Simulation Output canvas,
// plus Files/Download and autosave. Layout regions: templates/lab.html. All logic worth testing lives in
// static/js/motionlab/*; this file only wires the DOM and Blockly to it.

import { START_BLOCK_TYPE, compileWorkspace, createSimulation, fitView, programToWorkspace } from './motionlab/index.js';
import { BODY_BLOCK_TYPES, MAX_INSTANCES, TRAY, TRAY_DRAG_TYPE, defineBlocks, uniqueBodyId } from './motionlab/blocks.js';
import { drawScene } from './motionlab/renderer.js';
import { outlineWorkspace } from './motionlab/outline.js';
import { createSessionController, formatMetrics, prepareCanvas } from './motionlab/session.js';
import {
  FileFormatError, PROGRAM_FILENAME, PROJECT_FILENAME, checkFileSize, parseMotionLabFile, serializeProgram, serializeProjectFile,
} from './motionlab/files.js';

const STORAGE_KEY = 'motionlab.workspace.v1';
const EXAMPLE_URL = '/fixtures/ball-and-box.workspace.json';
const EMPTY_WORKSPACE = { blocks: { languageVersion: 0, blocks: [{ type: 'motionlab_start', id: 'start', x: 20, y: 20 }] } };
const COMPILE_DELAY_MS = 120;

const $ = (id) => document.getElementById(id);
const els = {
  blockly: $('blocklyDiv'), codeArea: $('codeArea'), tray: $('tray'), canvas: $('stage'),
  run: $('run'), pause: $('pause'), step: $('step'), reset: $('reset'), clock: $('clock'),
  status: $('status'), errors: $('errors'), bodies: $('bodies'), example: $('example'), clear: $('clear'),
  stackList: $('stackList'), looseList: $('looseList'), looseWrap: $('looseWrap'), stackCount: $('stackCount'),
  open: $('open'), save: $('save'), exportBtn: $('export'), fileInput: $('fileInput'),
};
const ctx = els.canvas.getContext('2d');

const state = {
  workspace: null, // Blockly workspace
  lastJson: null, // last compiled serialization, to skip no-op recompiles
  compiled: null, // { ok, program, errors, warnings }
  session: null, // session controller (static/js/motionlab/session.js): the active simulation and its playback
  current: null, // latest snapshot drawn
  view: null,
  note: '', // what the user just did (e.g. "Added set gravity."), shown before the next compile's status
  pendingFocus: null, // { id, action } to refocus in the stack list after it is rebuilt
};

// ---------- status, errors, readout ----------

function setStatus(text, kind = 'info') {
  els.status.textContent = text;
  els.status.classList.toggle('error', kind === 'error');
}

/**
 * Buttons follow the session state: Run when there is a session and it is not running (reads "Resume" when paused
 * mid-run), Pause only while running, Step/Reset/Export whenever there is a session.
 */
function updatePlaybackButtons(status = state.session?.status) {
  const s = status ?? { hasSession: false, running: false, canResume: false };
  els.run.disabled = !s.hasSession || s.running;
  els.pause.disabled = !s.running;
  for (const b of [els.step, els.reset, els.exportBtn]) b.disabled = !s.hasSession;
  els.run.lastChild.textContent = s.canResume ? ' Resume' : ' Run';
}

function showErrors(errors, warnings = []) {
  els.errors.replaceChildren(...[...errors, ...warnings.map((w) => ({ ...w, warning: true }))].map((e) => {
    const li = document.createElement('li');
    if (e.warning) li.className = 'warning';
    const code = document.createElement('code');
    code.textContent = e.code;
    li.append(code, e.message);
    if (e.blockId) {
      li.dataset.blockId = e.blockId;
      li.tabIndex = 0;
      li.title = 'Show this block (Enter)';
    }
    return li;
  }));
}

function markBlocks(problems) {
  const ws = state.workspace;
  const byBlock = new Map();
  for (const e of problems) if (e.blockId) byBlock.set(e.blockId, [...(byBlock.get(e.blockId) || []), e.message]);
  for (const block of ws.getAllBlocks(false)) {
    block.setWarningText(byBlock.get(block.id)?.join('\n') ?? null);
  }
  // Disconnected stacks: dashed, faded top block (its children are drawn inside it and inherit the look).
  const loose = new Set(ws.getTopBlocks(false).filter((b) => b.type !== START_BLOCK_TYPE).map((b) => b.id));
  for (const block of ws.getAllBlocks(false)) {
    if (typeof block.addClass !== 'function') break;
    if (loose.has(block.id)) block.addClass('ml-disconnected');
    else block.removeClass('ml-disconnected');
  }
}

// ---------- stack list (keyboard-accessible view of the Code Area) ----------

const colourOf = (type) => TRAY.find((g) => g.blocks.some((b) => b.type === type))?.colour;
const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;

function actionButton(action, text, label, id, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `act ${action}`;
  b.dataset.action = action;
  b.dataset.id = id;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.disabled = disabled;
  return b;
}

function outlineRow(item, { stackLength, loose, hasStart }) {
  const li = document.createElement('li');
  li.style.setProperty('--chip', colourOf(item.type) ?? '');
  const pos = document.createElement('span');
  pos.className = 'pos';
  pos.textContent = loose ? '·' : String(item.position);
  pos.setAttribute('aria-hidden', 'true');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  const sel = document.createElement('button');
  sel.type = 'button';
  sel.className = 'item';
  sel.dataset.action = 'select';
  sel.dataset.id = item.id;
  sel.textContent = item.summary;
  sel.title = `${item.summary}. Select in the Code Area`;
  li.append(pos, swatch, sel);
  const isStart = item.type === START_BLOCK_TYPE;
  const name = `${item.label} (${loose ? 'not connected' : `${ordinal(item.position)} in the stack`})`;
  if (!isStart) {
    // In the stack, position 2 is the first block under the start block, so it cannot move up.
    const firstMovable = loose ? 1 : 2;
    li.append(
      actionButton('up', '↑', `Move ${name} up`, item.id, item.position <= firstMovable),
      actionButton('down', '↓', `Move ${name} down`, item.id, item.position >= stackLength),
    );
    if (loose && item.position === 1) li.append(actionButton('attach', 'Attach', `Attach ${item.label} and the blocks under it to the end of the stack`, item.id, !hasStart));
  }
  li.append(actionButton('remove', '✕', `Remove ${name}`, item.id));
  return li;
}

function renderOutline(json) {
  const { stack, loose } = outlineWorkspace(json);
  const hasStart = stack.length > 0;
  els.stackList.replaceChildren(...stack.map((item) => outlineRow(item, { stackLength: stack.length, loose: false, hasStart })));
  els.looseList.replaceChildren(...loose.flatMap((group) => group.map((item) => outlineRow(item, { stackLength: group.length, loose: true, hasStart }))));
  els.looseWrap.hidden = loose.length === 0;
  const looseCount = loose.reduce((n, g) => n + g.length, 0);
  els.stackCount.textContent = `${Math.max(stack.length - 1, 0)} block${stack.length === 2 ? '' : 's'} in the stack${looseCount ? `, ${looseCount} not connected` : ''}`;
  if (state.pendingFocus) {
    const { id, action } = state.pendingFocus;
    state.pendingFocus = null;
    const target = document.querySelector(`.stack-outline [data-id="${CSS.escape(id)}"][data-action="${action}"]:not(:disabled)`)
      ?? document.querySelector(`.stack-outline [data-id="${CSS.escape(id)}"][data-action="select"]`);
    target?.focus();
  }
}

function selectBlock(block) {
  state.workspace.centerOnBlock(block.id);
  // Blockly 12 selects through the focus manager; block.select() alone only adds the highlight class.
  const focus = Blockly.getFocusManager?.();
  if (focus?.focusNode) focus.focusNode(block);
  else block.select();
}

const lastInStack = (block) => {
  let last = block;
  while (last.getNextBlock()) last = last.getNextBlock();
  return last;
};

/** Move a block one place up or down within its stack. Returns false if it cannot move that way. */
function moveBlock(block, dir) {
  const prev = block.getPreviousBlock();
  const next = block.getNextBlock();
  if (dir === 'up' && (!prev || prev.type === START_BLOCK_TYPE)) return false;
  if (dir === 'down' && !next) return false;
  const target = dir === 'up' ? prev.getPreviousBlock() : next;
  Blockly.Events.setGroup(true);
  try {
    if (target) {
      block.unplug(true); // close the gap it leaves
      target.nextConnection.connect(block.previousConnection); // insert after target; the rest re-attaches below it
    } else {
      // Moving up past the top block of a loose stack: this block becomes the new top, in the old top's place.
      const at = prev.getRelativeToSurfaceXY();
      block.unplug(true);
      block.moveTo(at);
      block.nextConnection.connect(prev.previousConnection);
    }
  } finally {
    Blockly.Events.setGroup(false);
  }
  return true;
}

function removeBlock(block) {
  Blockly.Events.setGroup(true);
  try {
    block.dispose(true, true); // heal the stack: the blocks below move up
  } finally {
    Blockly.Events.setGroup(false);
  }
}

function attachToStack(block) {
  const start = startBlocks()[0];
  if (!start) return false;
  Blockly.Events.setGroup(true);
  try {
    lastInStack(start).nextConnection.connect(block.previousConnection);
  } finally {
    Blockly.Events.setGroup(false);
  }
  return true;
}

function runStackAction(action, id) {
  const block = state.workspace.getBlockById(id);
  if (!block) return;
  const label = trayLabel(block.type);
  if (action === 'select') return selectBlock(block);
  if (action === 'remove') {
    state.note = `Removed "${label}".`;
    state.pendingFocus = null;
    removeBlock(block);
    return;
  }
  const ok = action === 'attach' ? attachToStack(block) : moveBlock(block, action);
  if (!ok) {
    setStatus(action === 'attach' ? 'Add a "When simulation starts" block first.' : `"${label}" cannot move ${action} any further.`, 'error');
    return;
  }
  state.note = action === 'attach' ? `Attached "${label}" to the end of the stack.` : `Moved "${label}" ${action}.`;
  state.pendingFocus = { id, action: action === 'attach' ? 'select' : action };
}

function updateReadout(snap) {
  const { clock, rows } = formatMetrics(snap);
  els.clock.textContent = clock;
  els.bodies.replaceChildren(...rows.map((row) => {
    const tr = document.createElement('tr');
    for (const v of row) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    return tr;
  }));
}

// ---------- canvas ----------

// High-DPI: the backing store is CSS size × devicePixelRatio; drawing stays in CSS pixels (prepareCanvas).
const canvasSize = () => prepareCanvas(els.canvas, ctx, window.devicePixelRatio || 1);

/** Fit the camera to the initial scene plus `snap`; refit only when a body leaves the view or the canvas resized. */
function ensureView(snap, size, force = false) {
  const v = state.view;
  const outside = v && snap.bodies.some((b) => {
    const r = b.dimensions.radius ?? Math.max(b.dimensions.width, b.dimensions.height) / 2;
    const p = v.toCanvas(b.position.x, b.position.y);
    const pr = v.length(r);
    return p.x - pr < 0 || p.x + pr > v.width || p.y - pr < 0;
  });
  if (force || !v || outside || v.width !== size.width || v.height !== size.height) {
    const initial = state.session?.initial;
    const bodies = initial ? [...initial.bodies, ...snap.bodies] : snap.bodies;
    state.view = fitView({ bodies }, size);
  }
}

/** The session controller's onRender: draw the snapshot (or an empty scene) and update the metrics. */
function render(snap = state.current, { refit = false } = {}) {
  const size = canvasSize();
  state.current = snap;
  if (!snap) {
    // No valid program: draw an empty scene so the floor is still visible.
    state.view = fitView({ bodies: [] }, size);
    drawScene(ctx, { bodies: [] }, state.view);
    updateReadout(null);
    return;
  }
  ensureView(snap, size, refit);
  drawScene(ctx, snap, state.view);
  updateReadout(snap);
}

/** Redraw (never step) when the canvas is resized or the screen's pixel density changes. */
function watchCanvasSize() {
  new ResizeObserver(() => state.session ? state.session.redraw() : render()).observe(els.canvas);
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => {
      state.session ? state.session.redraw() : render();
      watchDpr();
    }, { once: true });
  };
  watchDpr();
}

// ---------- compile ----------

let compileTimer = 0;
function scheduleCompile() {
  clearTimeout(compileTimer);
  compileTimer = setTimeout(compileNow, COMPILE_DELAY_MS);
}

function compileNow() {
  const json = Blockly.serialization.workspaces.save(state.workspace);
  const text = JSON.stringify(json);
  if (text === state.lastJson) return;
  state.lastJson = text;
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* storage unavailable: autosave is a convenience only */
  }

  const compiled = compileWorkspace(json);
  state.compiled = compiled;
  markBlocks([...compiled.errors, ...compiled.warnings]);
  showErrors(compiled.errors, compiled.warnings);
  updateTrayState();
  renderOutline(json);

  const note = state.note ? `${state.note} ` : '';
  state.note = '';
  if (!compiled.ok) {
    state.session.clear();
    const n = compiled.errors.length;
    setStatus(`${note}${n} problem${n === 1 ? '' : 's'} to fix before running.`, 'error');
    return;
  }
  const loose = compiled.warnings.length;
  const looseNote = loose ? ` ${loose} loose stack${loose === 1 ? ' is' : 's are'} not connected and won't run.` : '';
  // A changed program gets a fresh session at tick 0; an unchanged one (e.g. the stack was only dragged around, or a
  // loose block changed) keeps the current session, so a paused run can still resume.
  const { fresh } = state.session.load(compiled.program);
  if (fresh) {
    const count = state.session.initial.bodies.length;
    setStatus(note + (count ? `Ready: ${count} bod${count === 1 ? 'y' : 'ies'}. Press Run.` : 'Ready: the start stack is empty, so the scene has no bodies.') + looseNote);
  } else if (note || looseNote) {
    setStatus(`${note}The program did not change, so the current session continues.${looseNote}`);
  }
}

/** Compile any edit that is still waiting for its debounce, so Run always uses what is on screen. */
function flushCompile() {
  clearTimeout(compileTimer);
  compileNow();
}

// ---------- workspace loading ----------

/**
 * Replace the editor with `json` and compile a fresh session from it. If Blockly rejects the workspace, the previous
 * workspace is put back and the error is rethrown, so a failed load never leaves the editor empty.
 */
function loadWorkspace(json, message) {
  const previous = Blockly.serialization.workspaces.save(state.workspace);
  state.session.clear(); // loading always starts a fresh session, even if the program happens to be the same
  state.lastJson = null;
  Blockly.Events.disable();
  try {
    state.workspace.clear();
    Blockly.serialization.workspaces.load(json, state.workspace);
  } catch (err) {
    state.workspace.clear();
    Blockly.serialization.workspaces.load(previous, state.workspace);
    throw err;
  } finally {
    Blockly.Events.enable();
    compileNow();
  }
  if (message && state.compiled?.ok) setStatus(message);
}

async function loadExample() {
  try {
    const res = await fetch(EXAMPLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadWorkspace(await res.json(), 'Loaded the ball-and-box example. Press Run.');
  } catch (err) {
    setStatus(`Could not load the example (${err.message}).`, 'error');
  }
}

/** Give a body block the next free name (ball2, ...) if its name is already used by another body block. */
function ensureUniqueBodyName(block) {
  if (!BODY_BLOCK_TYPES.includes(block.type)) return;
  const taken = state.workspace.getAllBlocks(false)
    .filter((b) => b !== block && BODY_BLOCK_TYPES.includes(b.type))
    .map((b) => b.getFieldValue('ID'));
  const name = block.getFieldValue('ID');
  const free = uniqueBodyId(taken, name);
  if (free !== name) block.setFieldValue(free, 'ID');
}

/** Pasted or duplicated body blocks (not yet connected) get a free name too. */
function renameClashingBodies(ids) {
  for (const id of ids) {
    const block = state.workspace.getBlockById(id);
    if (block && !block.getParent()) ensureUniqueBodyName(block);
  }
}

// ---------- Code Blocks tray ----------

const trayLabel = (type) => TRAY.flatMap((g) => g.blocks).find((b) => b.type === type)?.label ?? type;
const startBlocks = () => state.workspace.getBlocksByType(START_BLOCK_TYPE, false);

function buildTray() {
  els.tray.replaceChildren(...TRAY.map((group) => {
    const wrap = document.createElement('div');
    wrap.className = 'tray-group';
    wrap.setAttribute('role', 'group');
    wrap.style.setProperty('--chip', group.colour);
    const label = document.createElement('span');
    label.className = 'tray-group-label';
    label.id = `tray-${group.name.toLowerCase()}`;
    label.textContent = group.name;
    wrap.setAttribute('aria-labelledby', label.id);
    const chips = document.createElement('div');
    chips.className = 'tray-chips';
    for (const b of group.blocks) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.draggable = true;
      chip.dataset.type = b.type;
      chip.setAttribute('aria-describedby', 'tray-help');
      chip.innerHTML = '<span class="chip-label"></span><span class="chip-hint"></span>';
      chip.firstChild.textContent = b.label;
      chip.lastChild.textContent = b.hint;
      chips.append(chip);
    }
    wrap.append(label, chips);
    return wrap;
  }));
}

/** Only one start block may exist: its chip is marked unavailable while one is in the Code Area. */
function updateTrayState() {
  const hasStart = startBlocks().length > 0;
  for (const chip of els.tray.querySelectorAll('.chip')) {
    const unavailable = chip.dataset.type === START_BLOCK_TYPE && hasStart;
    chip.setAttribute('aria-disabled', String(unavailable));
    chip.title = unavailable ? 'This experiment already has a start block' : '';
  }
}

/**
 * Add a block from the tray. With a drop point (client coordinates) it is placed there; otherwise it is snapped to
 * the end of the start stack (keyboard and click), or placed loose at the top left if there is no start block.
 */
function addBlockFromTray(type, dropPoint = null) {
  const ws = state.workspace;
  if (type === START_BLOCK_TYPE && startBlocks().length) {
    setStatus('This experiment already has a "When simulation starts" block. Add other blocks under it.', 'error');
    return null;
  }
  Blockly.Events.setGroup(true);
  try {
    const block = ws.newBlock(type);
    block.initSvg();
    block.render();
    ensureUniqueBodyName(block);
    const start = startBlocks()[0];
    if (dropPoint) {
      const at = Blockly.utils.svgMath.screenToWsCoordinates(ws, new Blockly.utils.Coordinate(dropPoint.x, dropPoint.y));
      block.moveTo(at);
      state.note = `Added "${trayLabel(type)}". Snap it under the start block to use it.`;
    } else if (start && type !== START_BLOCK_TYPE) {
      let last = start;
      while (last.getNextBlock()) last = last.getNextBlock();
      last.nextConnection.connect(block.previousConnection);
      state.note = `Added "${trayLabel(type)}" at the end of the stack.`;
    } else {
      block.moveTo(new Blockly.utils.Coordinate(20, 20 + 30 * ws.getTopBlocks(false).length));
      state.note = type === START_BLOCK_TYPE ? 'Added the start block. Add blocks under it.' : `Added "${trayLabel(type)}". Add a "When simulation starts" block and snap this under it.`;
    }
    block.select();
    if (typeof ws.scrollBoundsIntoView === 'function') ws.scrollBoundsIntoView(block.getBoundingRectangle());
    return block;
  } finally {
    Blockly.Events.setGroup(false);
  }
}

function wireTray() {
  els.tray.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.getAttribute('aria-disabled') === 'true') {
      setStatus('This experiment already has a "When simulation starts" block. Add other blocks under it.', 'error');
      return;
    }
    addBlockFromTray(chip.dataset.type);
  });
  els.tray.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip || chip.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(TRAY_DRAG_TYPE, chip.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging-block');
  });
  els.tray.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-block');
    els.codeArea.classList.remove('drop-over');
  });
  const accepts = (e) => e.dataTransfer && [...e.dataTransfer.types].includes(TRAY_DRAG_TYPE);
  els.codeArea.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    els.codeArea.classList.add('drop-over');
  });
  els.codeArea.addEventListener('dragleave', (e) => {
    if (!els.codeArea.contains(e.relatedTarget)) els.codeArea.classList.remove('drop-over');
  });
  els.codeArea.addEventListener('drop', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    document.body.classList.remove('dragging-block');
    els.codeArea.classList.remove('drop-over');
    addBlockFromTray(e.dataTransfer.getData(TRAY_DRAG_TYPE), { x: e.clientX, y: e.clientY });
  });
}

// ---------- files ----------

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Import a project file. Size and contents are validated before anything changes; on any failure the current editor,
 * session and playback are left as they were and the status line says why (docs/ARCHITECTURE.md, "Import behaviour").
 */
async function openFile(file) {
  let parsed;
  try {
    checkFileSize(file.size);
    parsed = parseMotionLabFile(await file.text());
  } catch (err) {
    setStatus(err instanceof FileFormatError ? `Could not open ${file.name}: ${err.message}` : `Could not open ${file.name}.`, 'error');
    return;
  }
  try {
    loadWorkspace(parsed.workspace, `Opened ${file.name}${parsed.source === 'program' ? ' (program converted to blocks)' : ''}.`);
  } catch (err) {
    setStatus(`Could not open ${file.name}: the editor rejected it (${err.message}). Your previous blocks were kept.`, 'error');
  }
}

// ---------- boot ----------

function wireControls() {
  els.run.addEventListener('click', () => {
    flushCompile(); // an edit made just now compiles first: Run plays the fresh session
    const resuming = state.session.status.canResume;
    if (state.session.run()) setStatus(resuming ? 'Running (resumed).' : 'Running.');
  });
  els.pause.addEventListener('click', () => {
    if (state.session.pause()) setStatus('Paused. Run resumes from here; Reset goes back to the start.');
  });
  els.step.addEventListener('click', () => {
    flushCompile();
    if (state.session.step()) setStatus('Stepped one tick (1/120 s).');
  });
  els.reset.addEventListener('click', () => {
    if (state.session.reset()) setStatus('Reset to the start.');
  });
  els.example.addEventListener('click', loadExample);
  els.clear.addEventListener('click', () => loadWorkspace(EMPTY_WORKSPACE, 'Cleared. Drag blocks under the start block.'));
  els.open.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    els.fileInput.value = '';
    if (file) openFile(file);
  });
  els.save.addEventListener('click', () => {
    const json = Blockly.serialization.workspaces.save(state.workspace);
    download(PROJECT_FILENAME, serializeProjectFile(json, state.compiled?.ok ? state.compiled.program : null));
    setStatus(`Saved ${PROJECT_FILENAME}.`);
  });
  els.exportBtn.addEventListener('click', () => {
    if (!state.compiled?.ok) return;
    download(PROGRAM_FILENAME, serializeProgram(state.compiled.program));
    setStatus(`Exported ${PROGRAM_FILENAME}.`);
  });
  const showBlock = (e) => {
    const li = e.target.closest('li[data-block-id]');
    const block = li && state.workspace.getBlockById(li.dataset.blockId);
    if (block) selectBlock(block);
  };
  els.errors.addEventListener('click', showBlock);
  els.errors.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showBlock(e);
    }
  });
  new ResizeObserver(() => Blockly.svgResize(state.workspace)).observe(els.blockly);
  // Redraw (and refit) when the Output panel changes size; world state is untouched.
  watchCanvasSize();
  wireTray();
  // Stack list buttons.
  document.getElementById('stackOutline').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (btn && !btn.disabled) runStackAction(btn.dataset.action, btn.dataset.id);
  });
  // Keyboard shortcuts on the selected block: Alt+Up / Alt+Down reorder (Delete/Backspace is Blockly's own).
  els.codeArea.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
    const block = Blockly.getSelected?.();
    if (!block || !state.workspace.getBlockById(block.id)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 'up' : 'down';
    if (moveBlock(block, dir)) state.note = `Moved "${trayLabel(block.type)}" ${dir}.`;
    else setStatus(`"${trayLabel(block.type)}" cannot move ${dir} any further.`, 'error');
  }, true);
}

function boot() {
  updatePlaybackButtons();
  buildTray();
  if (!window.Blockly) {
    for (const b of [els.example, els.clear, els.open, els.save, ...els.tray.querySelectorAll('.chip')]) b.disabled = true;
    setStatus('Could not load Blockly from cdn.jsdelivr.net. Check the network connection and reload.', 'error');
    render(null);
    return;
  }
  defineBlocks(Blockly);
  const version = els.blockly.dataset.blocklyVersion;
  state.workspace = Blockly.inject(els.blockly, {
    // No Blockly toolbox: blocks come from the full-width Code Blocks tray (see the tray section above).
    maxInstances: MAX_INSTANCES,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 0.85 },
    move: { scrollbars: true, drag: true, wheel: false },
    media: `https://cdn.jsdelivr.net/npm/blockly@${version}/media/`,
  });
  state.session = createSessionController({
    createSimulation, // the real engine (static/js/motionlab/engine.js)
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    now: () => performance.now(),
    onRender: render,
    onState: updatePlaybackButtons,
  });

  state.workspace.addChangeListener((e) => {
    if (e.isUiEvent) return;
    if (e.type === Blockly.Events.BLOCK_CREATE) renameClashingBodies(e.ids ?? [e.blockId]);
    scheduleCompile();
  });
  wireControls();

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (saved) {
    try {
      loadWorkspace(saved, 'Restored your last workspace. Press Example for the ball-and-box scene.');
      return;
    } catch {
      setStatus('Saved workspace could not be restored; loading the example.', 'error');
    }
  }
  loadExample().catch(() => loadWorkspace(EMPTY_WORKSPACE));
}

window.motionlab = { state, programToWorkspace };
boot();
