// Block lab page glue: Blockly workspace <-> compiler <-> engine <-> canvas, plus files and autosave.
// All logic worth testing lives in static/js/motionlab/*; this file only wires DOM and Blockly to it.

import { compileWorkspace, createSimulation, fitView, programToWorkspace } from './motionlab/index.js';
import { BODY_BLOCK_TYPES, MAX_INSTANCES, TOOLBOX, defineBlocks, uniqueBodyId } from './motionlab/blocks.js';
import { drawScene } from './motionlab/renderer.js';
import { createPlayback } from './motionlab/playback.js';
import {
  FileFormatError, PROGRAM_FILENAME, WORKSPACE_FILENAME, parseMotionLabFile, serializeProgram, serializeWorkspaceFile,
} from './motionlab/files.js';

const STORAGE_KEY = 'motionlab.workspace.v1';
const EXAMPLE_URL = '/fixtures/ball-and-box.workspace.json';
const EMPTY_WORKSPACE = { blocks: { languageVersion: 0, blocks: [{ type: 'motionlab_start', id: 'start', x: 20, y: 20 }] } };
const COMPILE_DELAY_MS = 120;

const $ = (id) => document.getElementById(id);
const els = {
  blockly: $('blocklyDiv'), canvas: $('stage'), run: $('run'), step: $('step'), reset: $('reset'), clock: $('clock'),
  status: $('status'), errors: $('errors'), bodies: $('bodies'), example: $('example'), clear: $('clear'),
  open: $('open'), save: $('save'), exportBtn: $('export'), fileInput: $('fileInput'),
};
const ctx = els.canvas.getContext('2d');

const state = {
  workspace: null, // Blockly workspace
  lastJson: null, // last compiled serialization, to skip no-op recompiles
  compiled: null, // { ok, program, errors }
  sim: null,
  initial: null, // snapshot at tick 0
  current: null, // latest snapshot drawn
  view: null,
  playback: null,
};

// ---------- status, errors, readout ----------

function setStatus(text, kind = 'info') {
  els.status.textContent = text;
  els.status.classList.toggle('error', kind === 'error');
}

function setPlaybackEnabled(enabled) {
  for (const b of [els.run, els.step, els.reset, els.exportBtn]) b.disabled = !enabled;
}

function updateRunButton() {
  els.run.textContent = state.playback?.running ? 'Ⅱ Pause' : '▶ Run';
}

function showErrors(errors) {
  els.errors.replaceChildren(...errors.map((e) => {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = e.code;
    li.append(code, e.message);
    if (e.blockId) {
      li.dataset.blockId = e.blockId;
      li.title = 'Show this block';
    }
    return li;
  }));
}

function markBlocks(errors) {
  const ws = state.workspace;
  const byBlock = new Map();
  for (const e of errors) if (e.blockId) byBlock.set(e.blockId, [...(byBlock.get(e.blockId) || []), e.message]);
  for (const block of ws.getAllBlocks(false)) {
    block.setWarningText(byBlock.get(block.id)?.join('\n') ?? null);
  }
}

const fmt = (n) => (Math.abs(n) < 0.0005 ? '0.000' : n.toFixed(3));

function updateReadout(snap) {
  els.clock.textContent = snap ? `tick ${snap.tick} · ${snap.time.toFixed(3)} s` : 'tick – · – s';
  els.bodies.replaceChildren(...(snap?.bodies ?? []).map((b) => {
    const tr = document.createElement('tr');
    for (const v of [b.id + (b.static ? ' (static)' : ''), fmt(b.position.x), fmt(b.position.y), fmt(b.velocity.x), fmt(b.velocity.y)]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    return tr;
  }));
}

// ---------- canvas ----------

function canvasSize() {
  const width = Math.max(1, els.canvas.clientWidth);
  const height = Math.max(1, els.canvas.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  if (els.canvas.width !== Math.round(width * dpr) || els.canvas.height !== Math.round(height * dpr)) {
    els.canvas.width = Math.round(width * dpr);
    els.canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

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
    const bodies = state.initial ? [...state.initial.bodies, ...snap.bodies] : snap.bodies;
    state.view = fitView({ bodies }, size);
  }
}

function render(snap = state.current, { refit = false } = {}) {
  const size = canvasSize();
  if (!snap) {
    // No valid program: draw an empty scene so the floor is still visible.
    state.view = fitView({ bodies: [] }, size);
    drawScene(ctx, { bodies: [] }, state.view);
    updateReadout(null);
    return;
  }
  state.current = snap;
  ensureView(snap, size, refit);
  drawScene(ctx, snap, state.view);
  updateReadout(snap);
}

// ---------- playback ----------

function loop(now) {
  if (!state.playback.running) return;
  state.playback.frame(now);
  requestAnimationFrame(loop);
}

function stopPlayback() {
  state.playback?.stop();
  updateRunButton();
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

  stopPlayback();
  const compiled = compileWorkspace(json);
  state.compiled = compiled;
  markBlocks(compiled.errors);
  showErrors(compiled.errors);

  if (!compiled.ok) {
    state.sim = null;
    state.initial = null;
    state.current = null;
    setPlaybackEnabled(false);
    const n = compiled.errors.length;
    setStatus(`${n} problem${n === 1 ? '' : 's'} to fix before running.`, 'error');
    render(null);
    return;
  }
  state.sim = createSimulation(compiled.program);
  state.initial = state.sim.snapshot();
  setPlaybackEnabled(true);
  const count = state.initial.bodies.length;
  setStatus(count ? `Ready: ${count} bod${count === 1 ? 'y' : 'ies'}. Press Run.` : 'Ready: the start stack is empty, so the scene has no bodies.');
  render(state.initial, { refit: true });
}

// ---------- workspace loading ----------

function loadWorkspace(json, message) {
  stopPlayback();
  state.lastJson = null;
  Blockly.Events.disable();
  try {
    state.workspace.clear();
    Blockly.serialization.workspaces.load(json, state.workspace);
  } finally {
    Blockly.Events.enable();
  }
  compileNow();
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

/** A body block dragged in or pasted with a name that is already used gets the next free name (ball2, ...). */
function renameClashingBodies(ids) {
  const ws = state.workspace;
  for (const id of ids) {
    const block = ws.getBlockById(id);
    if (!block || !BODY_BLOCK_TYPES.includes(block.type) || block.getParent()) continue;
    const taken = ws.getAllBlocks(false)
      .filter((b) => b !== block && BODY_BLOCK_TYPES.includes(b.type))
      .map((b) => b.getFieldValue('ID'));
    const name = block.getFieldValue('ID');
    const free = uniqueBodyId(taken, name);
    if (free !== name) block.setFieldValue(free, 'ID');
  }
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

async function openFile(file) {
  try {
    const { source, workspace } = parseMotionLabFile(await file.text());
    loadWorkspace(workspace, `Opened ${file.name}${source === 'program' ? ' (program converted to blocks)' : ''}.`);
  } catch (err) {
    setStatus(err instanceof FileFormatError ? `Could not open ${file.name}: ${err.message}` : `Could not open ${file.name}.`, 'error');
  }
}

// ---------- boot ----------

function wireControls() {
  els.run.addEventListener('click', () => {
    if (!state.sim) return;
    if (state.playback.running) {
      stopPlayback();
      setStatus('Paused.');
    } else {
      state.playback.start(performance.now());
      updateRunButton();
      setStatus('Running.');
      requestAnimationFrame(loop);
    }
  });
  els.step.addEventListener('click', () => {
    if (!state.sim) return;
    stopPlayback();
    render(state.sim.step());
    setStatus('Stepped one tick (1/120 s).');
  });
  els.reset.addEventListener('click', () => {
    if (!state.sim) return;
    stopPlayback();
    render(state.sim.reset(), { refit: true });
    setStatus('Reset to the start.');
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
    download(WORKSPACE_FILENAME, serializeWorkspaceFile(json, state.compiled?.ok ? state.compiled.program : null));
    setStatus(`Saved ${WORKSPACE_FILENAME}.`);
  });
  els.exportBtn.addEventListener('click', () => {
    if (!state.compiled?.ok) return;
    download(PROGRAM_FILENAME, serializeProgram(state.compiled.program));
    setStatus(`Exported ${PROGRAM_FILENAME}.`);
  });
  els.errors.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-block-id]');
    const block = li && state.workspace.getBlockById(li.dataset.blockId);
    if (!block) return;
    state.workspace.centerOnBlock(block.id);
    // Blockly 12 selects through the focus manager; block.select() alone only adds the highlight class.
    const focus = Blockly.getFocusManager?.();
    if (focus?.focusNode) focus.focusNode(block);
    else block.select();
  });
  window.addEventListener('resize', () => render());
  new ResizeObserver(() => Blockly.svgResize(state.workspace)).observe(els.blockly);
}

function boot() {
  setPlaybackEnabled(false);
  if (!window.Blockly) {
    for (const b of [els.example, els.clear, els.open, els.save]) b.disabled = true;
    setStatus('Could not load Blockly from cdn.jsdelivr.net. Check the network connection and reload.', 'error');
    render(null);
    return;
  }
  defineBlocks(Blockly);
  const version = els.blockly.dataset.blocklyVersion;
  state.workspace = Blockly.inject(els.blockly, {
    toolbox: TOOLBOX,
    maxInstances: MAX_INSTANCES,
    trashcan: true,
    zoom: { controls: true, wheel: true, startScale: 0.85 },
    move: { scrollbars: true, drag: true, wheel: false },
    media: `https://cdn.jsdelivr.net/npm/blockly@${version}/media/`,
  });
  state.playback = createPlayback({ step: () => state.sim.step(), onFrame: (snap) => render(snap) });

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
