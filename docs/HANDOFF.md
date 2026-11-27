# MotionLab handoff (for Misora)

Last updated 2026-11-27 (block lab added). Contract spec: [CONTRACT.md](CONTRACT.md).

## What the repo was at baseline

- Flask 3.1.3 app on Python 3.9.6 (`.venv/`, created from Xcode's Python). Entry point: `app.py`, one route `/`,
  serves on `http://127.0.0.1:5050`.
- Page: `templates/base.html` + `templates/index.html`; classic (non-module) script `static/js/simulation.js`
  (analytic projectile demo); styles `static/css/style.css`.
- Package manager: pip (`requirements.txt`: `Flask>=3.0,<4`). There was no `package.json`, no JS tooling, no tests,
  no examples, no git repository.
- Matter.js: **none**. No imports, no CDN tag, no bundled copy (`grep -ri matter` outside `.venv` finds nothing).
- Blockly: none.

## Baseline checks run

| Check | Result |
|---|---|
| `.venv/bin/python -c "import flask"` | OK, Flask 3.1.3 |
| `node --check static/js/simulation.js` | OK |
| Start `app.py`, GET `/`, `/static/js/simulation.js`, `/static/css/style.css` | all 200; `.js` served as `text/javascript` |
| `.venv/bin/pip list` | **hangs** (no output after 2 min, killed). Use `python -c "import importlib.metadata ..."` instead |

## What was added

| Path | Purpose |
|---|---|
| `package.json` | `"type": "module"`, no dependencies; `test` and `check` scripts |
| `static/js/motionlab/contract.js` | versioned contract, limits, error codes, `validateProgram` |
| `static/js/motionlab/engine.js` | `createSimulation(program)` → `step/reset/snapshot` |
| `static/js/motionlab/compile.js` | Blockly-JSON start stack → program v1 |
| `static/js/motionlab/view.js` | meter↔pixel transform and floor row for the canvas |
| `static/js/motionlab/blocks.js` | Blockly block definitions + toolbox (JSON from the contract) |
| `static/js/motionlab/playback.js` | fixed-step scheduler for `requestAnimationFrame` |
| `static/js/motionlab/renderer.js` | `drawScene` canvas renderer |
| `static/js/motionlab/files.js` | save/open file format |
| `static/js/motionlab/index.js` | public re-exports |
| `static/js/lab.js` | page glue: Blockly ↔ compiler ↔ engine ↔ canvas, files, autosave |
| `templates/lab.html`, `static/css/lab.css` | the block lab page at `/lab` |
| `app.py` | added `/lab` and `/fixtures/<name>.json` routes; `BLOCKLY_VERSION` |
| `templates/base.html` | added `head` and `body_class` blocks |
| `templates/index.html` | one link to `/lab` |
| `.claude/launch.json` | Browser-pane preview attaches to an already-running server on 5050 |
| `fixtures/ball-and-box.program.json`, `fixtures/ball-and-box.expected.json` | canonical fixture + expected state |
| `tests/*.test.js` | 51 `node:test` tests (contract, compiler, engine, view, blocks, playback, renderer, files) |

The projectile demo at `/` is otherwise unchanged.

## The block lab (`/lab`)

- Blockly **12.3.1**, loaded from `https://cdn.jsdelivr.net/npm/blockly@12.3.1/blockly.min.js` (UMD build, global
  `Blockly`, includes English messages). Media (zoom/trash icons) from the same version's `/media/`. To upgrade,
  change `BLOCKLY_VERSION` in `app.py`. Needs network access; without it the page shows a clear error and disables buttons.
- Every non-UI workspace change recompiles (120 ms debounce). Errors appear in the list under the canvas, as warning
  icons on the offending blocks, and Run/Step/Reset/Export are disabled. Clicking an error selects that block.
- Run/Pause, Step (one 1/120 s tick), Reset. The clock shows tick and time.
- Example (loads the canonical fixture from `/fixtures/ball-and-box.program.json`), Clear (start block only),
  Open… (`.motionlab.json` workspace files or bare program JSON), Save (`experiment.motionlab.json`),
  Export program (`experiment.program.json`).
- The workspace autosaves to `localStorage` key `motionlab.workspace.v1` and is restored on reload.
  Clear site data, or press Example, to get back to the fixture.
- `window.motionlab.state` exposes the workspace, compiled program and playback for console debugging.

## Commands

Setup (fresh machine):

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

Node ≥ 20 is required for tests (verified on Node 24.16.0, npm 11.13.0). There is nothing to `npm install`.

Run the app, then open http://127.0.0.1:5050/lab (block lab) or http://127.0.0.1:5050/ (projectile demo):

```bash
.venv/bin/python app.py
```

Test:

```bash
npm test
```

Full check (syntax-check the legacy script + tests):

```bash
npm run check
```

Build: none. The modules are served as-is by Flask static files; no bundler. Blockly comes from the CDN.

## Assumptions and decisions

1. **Own engine, not Matter.js.** Matter.js is absent, adding it requires a download, and its y-down, per-step
   velocity units fit the SI, exact-1/120 s, deterministic contract poorly. The engine is ~200 lines and covered
   by tests. Trade-off: no rotation, no friction. Revisit if rotation is needed.
2. **ES modules** for the new code (the repo had no module convention). Browser pages must load them with
   `<script type="module">`.
3. **Validation is hand-written** in `contract.js` (no schema library; the repo has no JS dependencies).
4. Floor is a contract constant (`FLOOR_Y = 0`), not a body in the snapshot.
5. Contact restitution = `max(eA, eB)`; floor restitution 0; contacts slower than 0.1 m/s don't bounce.
6. Disabled Blockly blocks in the start stack are skipped. Loose stacks are ignored silently (not an error).
7. Blockly block type and field names (`motionlab_*`, upper-cased fields) are fixed by `compile.js`, and
   `blocks.js` generates the definitions from the contract's `OPS`/`LIMITS`, so number fields enforce the same
   ranges as validation. A test checks they stay in sync.
8. Blockly from a pinned CDN rather than vendored: no npm tooling in the repo. Vendoring `blockly.min.js` into
   `static/vendor/` would make the lab work offline.
9. The canvas camera is fixed per compile (fits the initial scene). Bodies that fly far away leave the view.
10. Toolbox blocks default to ids `ball`/`box`, so dragging in a second one gives a `DUPLICATE_BODY_ID` error until renamed.

## Known failures / open items

- `pip list` hangs in this venv (see above). Not investigated further.
- Not a git repo, so there is no history to diff against.
- The Browser-pane preview cannot launch `.venv/bin/python` itself (macOS blocks it from reading `~/Desktop`).
  Start the server in a terminal; `.claude/launch.json` only attaches to port 5050.
- Not covered by automated tests: `static/js/lab.js` (DOM/Blockly glue). It was checked by hand in the browser:
  example loads, Run animates in real time, errors highlight blocks and disable Run, a second start block is
  flagged, Example/Clear work, no console errors, no horizontal scroll at 375 px. Save/Open were not clicked
  (download/upload dialogs); their format code is unit-tested.

## Diagnosing defects

1. Run `npm test`. The fixture tests in `tests/engine.test.js` compare against `fixtures/ball-and-box.expected.json`.
2. Reproduce in Node:
   ```bash
   node -e "import('./static/js/motionlab/index.js').then(m=>{const p=JSON.parse(require('fs').readFileSync('fixtures/ball-and-box.program.json'));const s=m.createSimulation(p);console.log(JSON.stringify(s.snapshot()));console.log(JSON.stringify(s.step()))})"
   ```
3. If a block program misbehaves, log `compileWorkspace(json)`. A non-empty `errors` array has the `blockId`
   to highlight. `blockId: null` means a workspace/document-level problem.
