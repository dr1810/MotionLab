// Block lab page glue: Blockly workspace <-> compiler <-> engine <-> canvas.
// Blockly is the global loaded from the pinned CDN script in templates/lab.html.
import {
  registerBlocks, TOOLBOX, compileWorkspace, programToWorkspace, createSimulation, createPlayback,
  fitView, drawScene, serializeWorkspaceFile, parseWorkspaceFile, START_BLOCK_TYPE,
} from './motionlab/index.js';

const STORAGE_KEY = 'motionlab.workspace.v1';
const FIXTURE_URL = '/fixtures/ball-and-box.program.json';
const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');

const state = {
  workspace: null,
  program: null, // last valid compiled program
  playback: null,
  view: null,
  running: false,
  lastFrame: 0,
  loading: false,
};

function setStatus(text, bad = false) {
  $('status').textContent = text;
  $('status').classList.toggle('bad', bad);
}

if (!window.Blockly) {
  setStatus('Could not load Blockly from the CDN. Check your network connection and reload.', true);
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  throw new Error('Blockly global missing');
}
const { Blockly } = window;

// ---------- canvas ----------
function canvasSize() {
  const widthPx = canvas.clientWidth;
  const heightPx = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(widthPx * dpr) || canvas.height !== Math.round(heightPx * dpr)) {
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = Math.round(heightPx * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { widthPx, heightPx };
}

const EMPTY = { tick: 0, time: 0, bodies: [] };

function draw() {
  const size = canvasSize();
  const snap = state.playback ? state.playback.snapshot : EMPTY;
  if (!state.view || state.view.sizeKey !== `${size.widthPx}x${size.heightPx}`) refit(size);
  drawScene(ctx, snap, state.view, size);
  $('clock').textContent = `tick ${snap.tick} · ${snap.time.toFixed(3)} s`;
}

function refit(size = canvasSize()) {
  const initial = state.program ? createSimulation(state.program).snapshot() : EMPTY;
  state.view = fitView(initial, size);
  state.view.sizeKey = `${size.widthPx}x${size.heightPx}`;
}

// ---------- compile ----------
function clearWarnings() {
  for (const block of state.workspace.getAllBlocks(false)) block.setWarningText(null);
}

function showErrors(errors) {
  const list = $('errors');
  list.replaceChildren();
  for (const e of errors) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = e.code;
    li.append(code, e.message);
    if (e.blockId) {
      li.dataset.block = e.blockId;
      li.title = 'Show this block';
      state.workspace.getBlockById(e.blockId)?.setWarningText(e.message);
    }
    list.append(li);
  }
}

function setRunnable(ok) {
  for (const id of ['run', 'step', 'reset', 'export']) $(id).disabled = !ok;
}

function recompile() {
  const json = Blockly.serialization.workspaces.save(state.workspace);
  saveLocal(json);
  const result = compileWorkspace(json);
  clearWarnings();
  showErrors(result.errors);
  pause();
  if (!result.ok) {
    state.program = null;
    state.playback = null;
    state.view = null;
    setRunnable(false);
    setStatus(`Fix ${result.errors.length === 1 ? 'the problem' : `${result.errors.length} problems`} to run.`, true);
    draw();
    return;
  }
  state.program = result.program;
  state.playback = createPlayback(createSimulation(result.program));
  state.view = null;
  setRunnable(true);
  const n = state.playback.snapshot.bodies.length;
  setStatus(n ? `Ready: ${n} ${n === 1 ? 'body' : 'bodies'}.` : 'Ready. Add bodies below the start block.');
  draw();
}

let recompileTimer = 0;
function scheduleRecompile() {
  clearTimeout(recompileTimer);
  recompileTimer = setTimeout(recompile, 120);
}

// ---------- playback ----------
function pause() {
  state.running = false;
  $('run').textContent = '▶ Run';
}

function frame(now) {
  if (state.running && state.playback) {
    state.playback.advance((now - state.lastFrame) / 1000);
    draw();
  }
  state.lastFrame = now;
  requestAnimationFrame(frame);
}

$('run').onclick = () => {
  if (!state.playback) return;
  state.running = !state.running;
  state.lastFrame = performance.now();
  $('run').textContent = state.running ? 'Ⅱ Pause' : '▶ Run';
  setStatus(state.running ? 'Running' : 'Paused');
};
$('step').onclick = () => {
  if (!state.playback) return;
  pause();
  state.playback.stepOnce();
  setStatus('Paused');
  draw();
};
$('reset').onclick = () => {
  if (!state.playback) return;
  pause();
  state.playback.reset();
  setStatus('Reset to the start.');
  draw();
};
$('errors').onclick = (e) => {
  const li = e.target.closest('li[data-block]');
  const block = li && state.workspace.getBlockById(li.dataset.block);
  if (block) {
    block.select();
    state.workspace.centerOnBlock(block.id);
  }
};

// ---------- files ----------
function saveLocal(json) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(json)); } catch { /* storage unavailable */ }
}
function readLocal() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

function loadWorkspace(json) {
  try {
    Blockly.serialization.workspaces.load(json, state.workspace);
    Blockly.svgResize(state.workspace);
    state.workspace.scrollCenter();
    return true;
  } catch (e) {
    console.error(e);
    setStatus('That file has blocks this lab cannot load.', true);
    return false;
  }
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadExample() {
  try {
    const res = await fetch(FIXTURE_URL);
    if (!res.ok) throw new Error(res.statusText);
    loadWorkspace(programToWorkspace(await res.json()));
  } catch (e) {
    console.error(e);
    setStatus('Could not load the example.', true);
  }
}

$('example').onclick = loadExample;
$('clear').onclick = () => loadWorkspace({
  blocks: { languageVersion: 0, blocks: [{ type: START_BLOCK_TYPE, id: 'start', x: 20, y: 20 }] },
});
$('save').onclick = () => download('experiment.motionlab.json',
  serializeWorkspaceFile(Blockly.serialization.workspaces.save(state.workspace)));
$('export').onclick = () => {
  if (state.program) download('experiment.program.json', `${JSON.stringify(state.program, null, 2)}\n`);
};
$('open').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const parsed = parseWorkspaceFile(await file.text());
  if (!parsed.ok) {
    showErrors(parsed.errors);
    setStatus(`Could not open ${file.name}.`, true);
    return;
  }
  loadWorkspace(parsed.workspace);
};

// ---------- boot ----------
registerBlocks(Blockly);
state.workspace = Blockly.inject('blocklyDiv', {
  toolbox: TOOLBOX,
  media: `https://cdn.jsdelivr.net/npm/blockly@${$('blocklyDiv').dataset.blocklyVersion}/media/`,
  trashcan: true,
  grid: { spacing: 24, length: 3, colour: '#eee8f5', snap: true },
  zoom: { controls: true, wheel: true, startScale: 0.85 },
  move: { scrollbars: true, drag: true, wheel: false },
});
state.workspace.addChangeListener((e) => {
  if (!e.isUiEvent) scheduleRecompile();
});

const saved = readLocal();
if (!(saved && loadWorkspace(saved))) await loadExample();
recompile();
window.addEventListener('resize', () => { state.view = null; draw(); });
requestAnimationFrame(frame);

// Exposed for manual debugging in the console (not part of the contract).
window.motionlab = { state, recompile };
