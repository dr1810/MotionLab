# MotionLab handoff (for Misora)

Last updated 2026-11-27. Owner of setup, contract, interpreter, engine, frontend, blocks, rendering, file handling
and prototype tests: Claude. Spec: [CONTRACT.md](CONTRACT.md).

## Repo baseline (inspected 2026-11-27)

- Git: branch `main`, commits `3e2c69e` (Flask demo) and `a43a3f3` (an earlier prototype). At the start of this
  session, **every prototype file from `a43a3f3` was deleted in the working tree** (uncommitted). The prototype is
  being rebuilt from scratch to the current spec. The old version is still in `a43a3f3` (`git show a43a3f3:<path>`)
  and was not restored.
- Entry point: `app.py` (Flask 3.1.3, Python 3.9.6 in `.venv/`), serving on `http://127.0.0.1:5050`.
  Routes at baseline (since changed, see "Routes" below):
  Routes: `/` (projectile demo: `templates/index.html` + classic script `static/js/simulation.js`), `/lab`
  (block lab, renders `templates/lab.html`, pins `BLOCKLY_VERSION = "12.3.1"`), and `/fixtures/<name>.json`.
- Package managers: pip for Python (`requirements.txt`: `Flask>=3.0,<4`). npm only as a script runner
  (`package.json`, no dependencies, nothing to install).
- Tests: none survived the deletion. Rebuilt: `tests/*.test.js` with Node's built-in `node:test`.
- Examples: none besides the canonical fixture.
- Matter.js: **none**. No imports, no CDN tag, no bundled copy (`grep -rli matter` outside `.venv`/`.git` finds
  nothing). Decision: our own engine (see Assumptions).

## Baseline checks (before any changes)

| Check | Result |
|---|---|
| `.venv/bin/python --version` / Flask import | Python 3.9.6, Flask 3.1.3 OK |
| `node --version` / `npm --version` | v24.16.0 / 11.13.0 |
| `node --check static/js/simulation.js` | OK |
| Flask test client `GET /` | 200 |
| `GET /static/js/simulation.js`, `/static/css/style.css` | 200 (`text/javascript`, `text/css`) |
| `GET /lab` | **500, `TemplateNotFound: lab.html`** (template deleted). Fixed: page rebuilt |
| `GET /fixtures/ball-and-box.program.json` | **404** (fixture deleted). Now 200 again |
| `npm test` | not runnable (`package.json` deleted). Now 76/76 pass |

## Current state

The whole prototype is in place: contract, validation, interpreter + engine (`createSimulation`), Blockly-JSON
compiler, view transform, canonical fixture, and the block lab frontend (blocks, renderer, playback, files,
autosave).

### Routes

| Route | Page |
|---|---|
| `/` | block lab (`templates/lab.html`): the main page |
| `/mini` | projectile mini demo (`templates/mini.html`, formerly `templates/index.html` at `/`) |
| `/lab` | 301 redirect to `/` (old address of the block lab) |
| `/fixtures/<name>.json` | fixture files (Example loads `ball-and-box.workspace.json`) |

The block lab links to `/mini` ("Projectile mini"), and the mini demo links back to `/` ("Try the block lab").
Templates use `url_for('lab')` and `url_for('mini')`.

| Path | Purpose |
|---|---|
| `static/js/motionlab/contract.js` | version, `DT`, `FLOOR_Y`, limits, ops, error codes, `validateProgram`, `ProgramError` |
| `static/js/motionlab/engine.js` | `createSimulation(program)` → `{step, reset, snapshot}` |
| `static/js/motionlab/compile.js` | Blockly workspace JSON (single start stack) → program v1 |
| `static/js/motionlab/view.js` | meter↔pixel transform; `view.floorPx` is the floor row |
| `static/js/motionlab/blocks.js` | Blockly block JSON + toolbox generated from `BLOCK_TYPES`/`OPS`/`LIMITS`; `uniqueBodyId` |
| `static/js/motionlab/renderer.js` | `drawScene(ctx, snapshot, view)`: grid, floor at `view.floorPx`, bodies, velocity arrows, labels |
| `static/js/motionlab/playback.js` | `createPlayback({step, onFrame})`: fixed 1/120 s steps driven by `requestAnimationFrame` time |
| `static/js/motionlab/files.js` | save/open format, `parseMotionLabFile`, `FileFormatError` |
| `static/js/motionlab/index.js` | public re-exports (also `programToWorkspace`) |
| `static/js/lab.js` | page glue: Blockly ↔ compiler ↔ engine ↔ canvas, files, autosave. No logic worth unit-testing lives here |
| `templates/lab.html`, `static/css/lab.css` | the block lab page |
| `fixtures/ball-and-box.{program,workspace,expected}.json` | canonical fixture (the workspace is what Example loads) |
| `tests/{contract,engine,integrator,compile,view,frontend}.test.js`, `tests/helpers.js` | 76 tests |
| `package.json` | `"type": "module"`, `test` / `check` scripts |

## The block lab (`/`)

- Blockly **12.3.1** from `https://cdn.jsdelivr.net/npm/blockly@12.3.1/blockly.min.js` (global `Blockly`, English
  messages included; media from the same version's `/media/`). Version pinned by `BLOCKLY_VERSION` in `app.py`.
  Needs network; without it the page says so and disables its buttons.
- Toolbox: Start, Bodies (circle, box), World (gravity), Motion (velocity, force). Only one start block can exist
  (`maxInstances`); the compiler also reports `MULTIPLE_START_BLOCKS` for loaded files.
- Every non-UI change recompiles after 120 ms. Errors show as warning icons on blocks and in the list under the
  canvas; clicking an error centers and selects its block. Run/Step/Reset/Export are disabled while there are errors.
- A body block dragged in or pasted with a used name is renamed (`ball` → `ball2`) so it doesn't start as an error.
- Run/Pause plays in real time (120 ticks per second; at most 12 ticks per frame, so a background tab doesn't burst).
  Step runs one tick. Reset goes back to tick 0. Clock and per-body readout (x, y, vx, vy) under the canvas.
- Camera: fitted to the initial scene; it zooms out when a body leaves the view (e.g. the ball rolling away).
- Example loads `fixtures/ball-and-box.workspace.json`. Clear leaves only the start block. Open… accepts a saved
  `.motionlab.json` or a bare program JSON (converted to blocks). Save writes `experiment.motionlab.json`; Export
  writes `experiment.program.json` (valid programs only).
- Autosave: `localStorage` key `motionlab.workspace.v1` (per origin) after every compile, restored on reload.
- Console debugging: `window.motionlab.state` (workspace, compiled program, sim, current snapshot, view).

## Commands

Setup (fresh machine):

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

Node ≥ 20 is required for tests. There is nothing to `npm install`.

Run, then open http://127.0.0.1:5050/ (block lab) or http://127.0.0.1:5050/mini (projectile mini). Restart it
after changing templates: with debug off, Flask caches templates.

```bash
.venv/bin/python app.py
```

Test:

```bash
npm test
```

Engine integrator tests only (constant velocity, gravity, force on different masses, static bodies, first-tick force
lifetime, time from tick count, iteration order, reset reproducibility, detached snapshots, engine purity):

```bash
node --test tests/integrator.test.js
```

Full check (syntax-check the legacy demo script, then run the tests):

```bash
npm run check
```

Build: none. Flask serves the ES modules as static files; there is no bundler. Blockly comes from the pinned
jsDelivr CDN.

## Assumptions and decisions

1. **Own engine, not Matter.js.** Matter.js isn't in the repo, adding it means a download, and its y-down,
   per-step-velocity model fits an SI, exact-1/120 s, deterministic contract poorly. Trade-offs: no rotation and no
   friction.
2. **ES modules** for all new code. The repo had no JS module convention (one classic script). That's what lets the
   same files run under `node --test` and in the browser.
3. **Hand-written validation** (no schema library). The repo has no JS dependencies, and the error-to-`blockId`
   mapping is easier to control by hand.
4. The floor is a contract constant (`FLOOR_Y = 0`), not a body. The renderer gets it from `view.floorPx`.
5. Restitution: `max(eA, eB)` for pairs, the body's own value against the floor. Contacts closing slower than 0.2 m/s
   don't bounce, which keeps resting bodies still.
6. `applyForce` is a one-tick force (impulse `F·DT`), summed per body. That's the spec; it is not a continuous
   force.
7. Static bodies still need a valid `mass`, and `setVelocity`/`applyForce` on them is an error (`STATIC_BODY`) rather
   than being silently ignored.
8. Bodies may not start below the floor (`BELOW_FLOOR`). This is stricter than the spec asks for; I added it so
   scenes never start by being shoved up.
9. Loose (unconnected) block stacks are ignored without an error, and disabled blocks in the start stack are skipped.
10. Errors are collected, not first-only, so the UI can mark every bad block at once.
11. Blockly from a pinned CDN, not vendored (no npm tooling in the repo). Vendoring `blockly.min.js` into
    `static/vendor/` would make the lab work offline.
12. Opening a bare program copies field values into blocks as-is; Blockly's number fields clamp out-of-range values
    on load, so such a file can load slightly different from its JSON. Saved workspace files are exact.

## Known failures / open items

- Engine tests: no failing cases (76/76 on Node 24.16.0, 2026-11-27). The integrator tests were mutation-checked:
  not clearing one-tick forces, letting static bodies integrate, and swapping to explicit Euler each make the
  matching tests in `tests/integrator.test.js` fail.

- **Stale server:** the `app.py` process that was already on port 5050 (started 18:12, before the deletion) still
  serves the cached *old* `lab.html`, which has no readout table, so the block lab there logs "Cannot read properties of
  null (reading 'replaceChildren')". It also still has the old routes (block lab at `/lab`, projectile demo at
  `/`, no `/mini`). Restart that server. Verified on a fresh server (`flask --app app run --port 5051`).
- Browser checks done (Blockly 12.3.1, Chrome-based pane): example loads with no console errors; Step matches the
  fixture's tick 1; Run gives 120 ticks per 1.007 s of wall time and shows the ball bouncing off the box; Reset;
  error marking, disabled buttons, click-to-select; fix clears the error; body rename (`ball2`); single start block;
  Open (bare program and a bad file); Save/Export file contents (download click intercepted); autosave restore;
  camera follow; 375 px width with no horizontal scroll. Not clicked by hand: the real download/upload dialogs.
- Blockly 12 fires workspace events on animation frames. In a hidden or background tab nothing recompiles until the
  tab is visible again. That is expected, but it makes headless browser tests of editing flaky.
- Console shows Blockly's own deprecation warnings (`getAllVariables`, from inside Blockly 12.3.1). Not from our code.
- Engine change found while writing the tests: a ball landing on a box that rests on the floor lost its bounce with a
  naive solve-one-contact-at-a-time solver. The engine now uses a sequential-impulse solver with restitution targets
  fixed before solving. Test: `fixture: ball bounces off the top of the floor-supported box`.
- Float residue: in the fixture the ball hits exactly on the box's top-left corner, which gives the box
  vx ≈ 2.5e-14 m/s. With no friction it keeps that speed, a drift of about 1e-12 m per minute. Harmless, but don't
  compare long runs with exact equality.
- `.venv/bin/pip list` was reported to hang in this venv in an earlier session. I didn't re-run it. Use
  `.venv/bin/python -c "import importlib.metadata as m; print(m.version('flask'))"`.
- The Browser-pane preview only attaches to an already-running server (`.claude/launch.json`, port 5050). Start
  `app.py` in a terminal first.

## Diagnosing defects

1. Run `npm test`. The fixture tests in `tests/engine.test.js` compare against `fixtures/ball-and-box.expected.json`
   with tolerance 1e-9. If `afterTick1` fails, the integrator or force handling changed. If only the bounce test fails,
   look at the solver (`collectContacts` / `solveVelocities` in `engine.js`).
2. Reproduce in Node, from the repo root:
   ```bash
   node -e "import('./static/js/motionlab/index.js').then(m=>{const p=JSON.parse(require('fs').readFileSync('fixtures/ball-and-box.program.json'));const s=m.createSimulation(p);console.log(JSON.stringify(s.snapshot()));console.log(JSON.stringify(s.step()))})"
   ```
3. Validate a suspicious program: `validateProgram(p).errors`. Each error's `blockId` is the Blockly block id to
   highlight; `null` means a document-level problem (bad JSON shape or version, too many commands, no start block).
4. In the page, `motionlab.state.compiled` is the last compile result and `motionlab.state.current` the snapshot on
   screen. For a block program you can also log `compileWorkspace(Blockly.serialization.workspaces.save(ws))`. `program === null` means
   there is not exactly one start block.
