# MotionLab contract v1

Source of truth: [`static/js/motionlab/contract.js`](../static/js/motionlab/contract.js). This document describes it;
if they disagree, the code and its tests (`tests/contract.test.js`) win, and that is a bug in this document.

All modules are ES modules with no dependencies. They run unchanged in Node ≥ 20 and in the browser
(`<script type="module">`). The contract has no Blockly or DOM types.

## Modules and exact exports

| Module | Exports |
|---|---|
| `static/js/motionlab/contract.js` | `CONTRACT_VERSION` (1), `PROGRAM_VERSION` (1), `DT` (1/120), `FLOOR_Y` (0), `DEFAULT_GRAVITY` ({x: 0, y: -9.81}), `LIMITS`, `OPS`, `ERROR_CODES`, `makeError(code, message, blockId?)`, `ProgramError`, `validateProgram(program)` |
| `static/js/motionlab/engine.js` | `createSimulation(program)`, `REST_SPEED` (0.2 m/s), `SOLVER_ITERATIONS` (8), `POSITION_ITERATIONS` (4) |
| `static/js/motionlab/collision.js` | `contactBetween(a, b)`, `floorContact(b)`, `halfExtents(b)`, `maxSafeRelativeSpeed(a, b)` (pure, on the engine's internal body records) |
| `static/js/motionlab/compile.js` | `compileWorkspace(workspaceJson)`, `BLOCK_TYPES`, `BLOCK_LABELS`, `START_BLOCK_TYPE` (`"motionlab_start"`) |
| `static/js/motionlab/view.js` | `createView({width, height, scale, worldLeft?, floorOffset?})`, `fitView(snapshot, {width, height, padding?, floorOffset?, minScale?, maxScale?})` |
| `static/js/motionlab/compile.js` (also) | `programToWorkspace(program)`: the inverse, for Example/Open |
| `static/js/motionlab/outline.js` | `outlineWorkspace(workspaceJson)` → `{ stack, loose }`, `describeBlock(blockJson)`: the text model behind the stack list |
| `static/js/motionlab/blocks.js` | `BLOCK_DEFINITIONS`, `TRAY`, `TRAY_DRAG_TYPE`, `hueToHex(hue)`, `DEFAULTS`, `MAX_INSTANCES`, `BODY_BLOCK_TYPES`, `defineBlocks(Blockly)`, `uniqueBodyId(taken, base)` |
| `static/js/motionlab/renderer.js` | `drawScene(ctx, snapshot, view, {velocities?, labels?, theme?})`, `gridStep(scale)`, `THEME` |
| `static/js/motionlab/playback.js` | `createPlayback({step, onFrame?, dt?, maxStepsPerFrame? = 12, maxFrameGap? = 0.1})` → `{running, start(now), stop(), frame(now)}` |
| `static/js/motionlab/session.js` | `createSessionController({createSimulation, requestFrame, cancelFrame, now, onRender, onState?})` → `{load(program) → {fresh}, clear(), run(), pause(), reset(), step(), redraw(), status, current, initial, framePending}`; `formatMetrics(snapshot)` → `{clock, rows}`; `prepareCanvas(canvas, ctx, dpr)` → CSS size |
| `static/js/motionlab/files.js` | `createProjectEnvelope(workspace, program?)`, `serializeProjectFile(workspace, program?)`, `serializeProgram(program)`, `parseMotionLabFile(text)`, `validateWorkspace(workspace)`, `checkFileSize(bytes)`, `byteLength(text)`, `FileFormatError` (`.code`), `FILE_ERROR_CODES`, `FILE_FORMAT`, `LEGACY_FILE_FORMATS`, `FILE_FORMAT_VERSION`, `MAX_FILE_BYTES`, `MAX_PROJECT_BLOCKS`, `PROJECT_FILENAME`, `PROGRAM_FILENAME` |
| `static/js/motionlab/index.js` | re-exports contract, engine, compile and view (the modules above it). Frontend modules are imported directly |

## Coordinates and units

- Physics: SI units (m, s, kg, N). +x right, +y up. Positions are body centers.
- A static, infinite floor at world `y = FLOOR_Y = 0`. The floor is **not** a body and never appears in `bodies`.
- Bodies are circles or axis-aligned boxes. No rotation and no friction (a body sliding on the floor or on a box keeps
  its horizontal speed).
- Canvas: CSS pixels, +y down. The canvas uses its own meter→pixel transform from `view.js`.

### Playback (session controller)

The browser owns timing; `session.js` owns the rules. Engine steps are always exactly `DT`, run from a bounded
accumulator: each animation frame credits at most 0.1 s of real time and runs at most 12 steps, so the simulation
falls behind real time after a long gap instead of bursting. There is exactly one animation loop: at most one frame
is ever pending, Run while running is ignored, and Pause cancels the pending frame.

| Action | Effect |
|---|---|
| `load(program)` with a **changed** program (JSON differs) | stop, new session at tick 0, redraw with refit (`{fresh: true}`) |
| `load(program)` with the **same** program | keep the session, its tick and its playback state (`{fresh: false}`) |
| `run()` | start, or resume after Pause; timing debt starts at zero |
| `pause()` | stop and cancel the pending frame; the session keeps its tick (Run then reads "Resume") |
| `reset()` | stop, `sim.reset()` to tick 0, redraw with refit; timing debt cleared |
| `step()` | stop and advance exactly one tick |
| `redraw()` | draw the current snapshot again (resize, pixel-density change); never steps |
| `clear()` | no runnable program: stop, drop the session, draw the empty scene |

In the page, Run and Step first compile any edit still waiting for its 120 ms debounce, so they always use what is on
screen. Opening a file or Example always starts a fresh session.

### How the renderer finds the floor

The renderer imports nothing about the floor from the snapshot. It takes the view (`createView` or `fitView`) and
draws the floor line at canvas row **`view.floorPx`**, which equals `view.toCanvas(x, FLOOR_Y).y` for any `x`
(`floorPx = height - floorOffset`, default `floorOffset` 40 px). A body is drawn at
`view.toCanvas(position.x, position.y)` with sizes `view.length(meters)`.

## Program v1

```json
{ "version": 1, "commands": [ { "op": "...", "blockId": "...", "...payload": "..." } ] }
```

No other top-level fields are allowed. Commands run **once, in array (stack) order, at scene setup**. They are not
re-run per tick.

| op | payload (all required) | effect |
|---|---|---|
| `createCircle` | `id, x, y, radius, mass, restitution, static` | adds a circle |
| `createBox` | `id, x, y, width, height, mass, restitution, static` | adds a box |
| `setGravity` | `x, y` | sets gravity (m/s²); the last one wins; default `{0, -9.81}` |
| `setVelocity` | `id, vx, vy` | sets the initial velocity of a dynamic body created above it; the last one wins |
| `applyForce` | `id, fx, fy` | adds a force (N) to a dynamic body created above it. Forces for the same body **add up** and act **during the first physics tick only** (an impulse of `F·DT`). `reset()` restores them, so they act again on the first tick after reset |

- `blockId`: non-empty string, ≤ 64 chars, unique within the program. For a program compiled from blocks it is the
  Blockly block id.
- `id` (body id): matches `^[A-Za-z_][A-Za-z0-9_-]{0,31}$`, unique among bodies.
- `static`: boolean. Static bodies never move and ignore gravity. `mass` is still required and validated.
- Unknown fields on a command are an error.

### Limits (inclusive)

| Limit | Value |
|---|---|
| commands per program | 256 |
| bodies per program | 32 |
| `x`, `y` (body position) | −1000 … 1000 m |
| `radius`, `width`, `height` | 0.01 … 100 m |
| `mass` | 0.001 … 10000 kg |
| `restitution` | 0 … 1 |
| gravity `x`, `y` | −100 … 100 m/s² |
| `vx`, `vy` | −1000 … 1000 m/s |
| `fx`, `fy` | −100000 … 100000 N |

Numbers must be JSON numbers and finite (`"1"`, `null`, `NaN`, `Infinity` are rejected). A body may not start below
the floor (`y - radius` or `y - height/2` < 0). Touching it is fine. Overlapping bodies at start are allowed; the
solver pushes them apart.

### Empty and invalid programs

- `{ "version": 1, "commands": [] }` is **valid**: no bodies, default gravity. `step()` still advances tick and time.
- `validateProgram(p)` never throws. It returns `{ ok, errors }` and collects **all** errors (not first-only) in a
  stable order: document errors, then commands in stack order, fields in payload order.
- `createSimulation(p)` on an invalid program **throws `ProgramError`** with `name: "ProgramError"`,
  `code: "INVALID_PROGRAM"` and `errors` (the same list as `validateProgram`). It never returns a half-built simulation.
- If `commands` is missing/not an array or longer than 256, command-level checks are skipped.

## Errors

Every error is exactly `{ code, message, blockId }`. `message` is human-readable English and may change, but `code`
is stable. **`blockId` is `null` for document-level errors**, and also for command errors when the command has no
usable `blockId`.

Messages are actionable: each names the block (`op (command N)`), what is wrong and how to fix it. For example:
`setVelocity (command 1): body "ball" is created further down. Move this block below the block that creates "ball".`
or `… there is no body "bal". Bodies created above: ball, box.` The UI shows `message` as is.

**Static targets (defined behaviour):** `setVelocity` or `applyForce` aimed at a static body is a `STATIC_BODY` error
on that block ("Untick static … or remove this block"). It is rejected, never silently ignored.

**Order:** commands run top to bottom. A body must be created above any block that names it. `setGravity` may come
anywhere (the last one wins). For one body, `setVelocity` and `applyForce` may come in either order: the velocity
sets the starting value and the force adds its one-tick impulse on top.

| code | level | when |
|---|---|---|
| `INVALID_DOCUMENT` | document | program is not a JSON object, or has an unknown top-level field |
| `UNSUPPORTED_VERSION` | document | `version !== 1` (including missing) |
| `INVALID_COMMANDS` | document | `commands` missing or not an array |
| `TOO_MANY_COMMANDS` | document | more than 256 commands |
| `INVALID_COMMAND` | command (null) | command is not an object |
| `INVALID_BLOCK_ID` | command (null) | `blockId` missing, not a string, empty or > 64 chars |
| `DUPLICATE_BLOCK_ID` | command | `blockId` already used |
| `UNKNOWN_OP` | command | `op` not one of the five ops |
| `UNKNOWN_FIELD` | command | extra field on a command |
| `MISSING_FIELD` | command | a payload field is missing |
| `INVALID_TYPE` | command | `static` not boolean, or `id` not a string |
| `INVALID_NUMBER` | command | numeric field is not a finite number |
| `OUT_OF_RANGE` | command | number outside its limit |
| `INVALID_BODY_ID` | command | body id doesn't match the pattern |
| `DUPLICATE_BODY_ID` | command | body id already created |
| `UNKNOWN_BODY` | command | `setVelocity`/`applyForce` names a body not created **above** it |
| `STATIC_BODY` | command | `setVelocity`/`applyForce` targets a static body |
| `TOO_MANY_BODIES` | command | 33rd body (the error is on that create block) |
| `BELOW_FLOOR` | command | body starts below `y = 0` |
| `INVALID_WORKSPACE` | document | compiler input is not a Blockly workspace object |
| `NO_START_BLOCK` | document | no start block (an empty workspace `{}` included) |
| `MULTIPLE_START_BLOCKS` | each start block | more than one start block (one error per start block, with its id) |
| `UNKNOWN_BLOCK_TYPE` | block | a block in the start stack that is not a MotionLab command block |
| `DISCONNECTED_BLOCK` | **warning**, on the top block of a loose stack | a stack that is not snapped under the start block. Returned in `warnings`, never in `errors`; it does not change `ok` or the program |
| `INVALID_PROGRAM` | thrown | `ProgramError.code` from `createSimulation` |

## Simulation API

```js
import { createSimulation } from './static/js/motionlab/index.js';
const sim = createSimulation(program); // throws ProgramError if invalid
sim.snapshot(); // tick 0
sim.step();     // advances exactly DT = 1/120 s, returns the new snapshot
sim.reset();    // back to the compiled initial scene, tick 0, forces re-armed; returns the snapshot
```

- `step()` takes no arguments and always advances one tick. The browser owns scheduling (how many `step()` calls per
  animation frame); the engine has no clock.
- `snapshot()` returns a fresh, detached, JSON-serializable object. Mutating it does not affect the simulation:

```json
{
  "tick": 0,
  "time": 0,
  "bodies": [
    { "id": "ball", "shape": "circle", "position": {"x": 0, "y": 2}, "velocity": {"x": 1.5, "y": 0},
      "dimensions": {"radius": 0.25}, "static": false },
    { "id": "box", "shape": "box", "position": {"x": 2, "y": 0.5}, "velocity": {"x": 0, "y": 0},
      "dimensions": {"width": 1, "height": 1}, "static": false }
  ]
}
```

- `time` is `tick * DT`, computed rather than accumulated, so it never drifts. `bodies` are in creation order. `-0` is
  normalized to `0`.
- The simulation copies what it needs; later changes to the `program` object have no effect.
- It is deterministic: the same program gives bit-identical snapshots across runs.

### Step algorithm (what to expect when diagnosing)

1. Dynamic bodies, in creation order: `a = g + F·invMass`, `v += a·DT`, then `x += v·DT` (semi-implicit Euler).
   Static bodies have `invMass = 0` and are skipped. The one-tick force `F` is cleared after this step, and
   `reset()` restores it.
2. Collect contacts: body pairs in creation order, then floor contacts. Each contact's target separation speed is
   set by the restitution rule below.
3. Eight sequential-impulse passes over all contacts. Each impulse is split by inverse mass, and the accumulated
   impulse per contact is clamped at ≥ 0, so contacts only push. Contacts that are already separating get no impulse.
4. Four position-correction passes: body overlaps are pushed apart by 80% per pass beyond a 0.5 mm slop, split by
   inverse mass (static bodies never move; the center of mass of two dynamic bodies is unchanged). Then an exact
   floor clamp, so no dynamic body ever ends a step below the floor.

Cost per step is bounded: at most (8 + 4) passes over ≤ 32·31/2 pairs plus 32 floor checks.

### Contacts (`collision.js`)

Bodies never rotate. A contact is `{ nx, ny, depth }`: `(nx, ny)` is a unit normal pointing **from the first body to
the second** (from the floor upward for floor contacts), and `depth > 0` is the penetration along it. Touching
(depth exactly 0) is not a contact. Swapping the two bodies negates the normal and keeps the depth.

| Pair | Normal and depth |
|---|---|
| circle–circle | along the line between centers; depth `rA + rB − distance`. **Coincident centers:** `(0, 1)`, depth `rA + rB` |
| box–box | the axis of least overlap, signed toward the second box; depth = overlap on that axis. **Tie:** y axis. Zero offset on the chosen axis points `+x`/`+y` |
| box–circle, center outside the box | from the closest point on the box to the circle center; depth `r − distance` (a corner gives a diagonal normal) |
| box–circle, **center inside the box** | out through the nearest face; depth `r + distance to that face`. **Tie:** y face. Zero offset points `+x`/`+y` |
| floor–body | `(0, 1)`, depth `0 − (y − half height)` (radius for circles) |

### Restitution rule

A contact closing at speed `s` (the relative normal velocity at contact time, measured after this step's
integration, so it includes one tick of gravity) separates at `e·s`:

- body–body: `e = max(eA, eB)`
- body–floor: `e` is the body's own restitution
- if `s < REST_SPEED` (0.2 m/s), `e` is treated as 0. That is what lets resting bodies sit still, but it also means a
  very slow collision is perfectly inelastic, even at `e = 1` (momentum is still conserved).

With `e = 1` and `s ≥ REST_SPEED`, an isolated two-body collision conserves momentum and kinetic energy to within
floating-point rounding. The test checks relative error ≤ 1e-12.

### Supported range and tunneling

Contacts are detected only at the end of each 1/120 s step (no swept or continuous detection). Two bodies are
handled correctly while their relative speed stays below `maxSafeRelativeSpeed(a, b)` = (smallest half extent of
either body) / DT, i.e. 120 × that half extent per second. Examples: a 0.25 m-radius ball against anything at least
that big is safe up to 30 m/s; two 0.01 m-thick bodies only up to 1.2 m/s. Above the limit a body can pass
straight through a thin one, or be pushed out of the wrong side. The floor is an infinite half-plane, so nothing
tunnels through it.

The canonical fixture peaks at 5.995 m/s relative speed (tick 71, the ball falling just after the side impact), 20% of its
30 m/s limit (`tests/contacts.test.js`
checks this for 20 s). The program limits (velocity up to 1000 m/s, size down to 0.01 m) allow unsafe scenes on
purpose. Those scenes are valid; they are just outside the solver's accuracy range.

## Blocks → program (compiler)

`compileWorkspace(json)` takes the plain JSON from `Blockly.serialization.workspaces.save(workspace)` (no Blockly
import) and returns `{ ok, program, errors, warnings }`.

- There must be **exactly one** start block (`motionlab_start`, shown as **When simulation starts**). It emits no
  command. Only the stack connected below it is serialized.
- Every other top-level stack is **disconnected**: it is not compiled, and it gets one `DISCONNECTED_BLOCK` warning
  on its top block, which names it and the number of blocks under it. Warnings are reported even with errors, and
  even with no start block.
- `program` is `null` only for `INVALID_WORKSPACE`, `NO_START_BLOCK` and `MULTIPLE_START_BLOCKS`. Otherwise it is
  returned even when invalid, so the UI can export it and point errors at blocks.
- An empty start stack compiles to the valid empty program.
- Disabled blocks (`enabled: false`, or a non-empty `disabledReasons`) are skipped.
- Checkbox `STATIC` accepts `true/false` or the legacy strings `"TRUE"/"FALSE"`.

| Blockly type | Shown as (`BLOCK_LABELS`) | op | fields (units on the block) |
|---|---|---|---|
| `motionlab_start` | When simulation starts | none | none |
| `motionlab_create_circle` | Create Ball | `createCircle` | `ID` (id), `X Y` (m), `RADIUS` (m), `MASS` (kg), `RESTITUTION` (0–1), `STATIC` (checkbox) |
| `motionlab_create_box` | Create Box | `createBox` | `ID`, `X Y` (m), `WIDTH HEIGHT` (m), `MASS` (kg), `RESTITUTION`, `STATIC` |
| `motionlab_set_gravity` | Set Gravity | `setGravity` | `X Y` (m/s²) |
| `motionlab_set_velocity` | Set Initial Velocity | `setVelocity` | `ID`, `VX VY` (m/s) |
| `motionlab_apply_force` | Apply Force | `applyForce` | `ID`, `FX FY` (N, first tick) |

Blocks are only ever serialized to this JSON. No JavaScript is generated from blocks or evaluated
(`tests/editor-fixture.test.js` checks the source for `eval`, `Function` and Blockly generators).

## Files

Project files are the storage contract. The **project envelope v1**, its validation rules, error codes and import
behaviour are specified in [ARCHITECTURE.md](ARCHITECTURE.md#project-envelope-v1-the-storage-contract), together
with the decision to keep storage in the browser. In short:
`{ "format": "motionlab-project", "formatVersion": 1, "contractVersion": 1, "workspace": …, "program": … }`, where
`workspace` is authoritative and `program` is regenerated on open. Exported programs (`experiment.program.json`) are
exactly program v1.

## Canonical fixture

| File | Content |
|---|---|
| `fixtures/ball-and-box.program.json` | program v1: gravity −9.81; box `box` 1×1 m, 2 kg, e 0.2 at (2, 0.5) resting on the floor; ball `ball` r 0.25 m, 1 kg, e 0.6 at (0, 2); ball velocity (1.5, 0); force (120, 0) N on the ball. The ball hits the box's **left face** at tick 61 |
| `fixtures/ball-and-box.workspace.json` | hand-written Blockly workspace JSON that compiles to exactly that program (block ids = blockIds, start block `blk-start`). Example loads this |
| `fixtures/ball-and-box.editor.workspace.json` | **editor-authored**: built in the real block lab on 2026-11-27 (New, five tray-chip clicks, fields set, plus one disconnected Set Gravity with y = −1.62 dropped beside the stack) and saved with `Blockly.serialization.workspaces.save`. Block ids are Blockly-generated. The ball's `Y` was later edited from 3 to 2, the only change, when the canonical scene moved (see below) |
| `fixtures/ball-and-box.editor.program.json` | the expected program for it: the canonical program with each `blockId` replaced by the editor block id in stack order. `compileWorkspace(editor workspace).program` must equal it exactly, with one `DISCONNECTED_BLOCK` warning for the moon-gravity block |
| `fixtures/ball-and-box.expected.json` | `initial`, `afterTick1`, `afterTick2` snapshots, tolerance 1e-9, with derivations |
| `fixtures/ball-and-box.light-box.motionlab.json` | **second run** for the demo: a project file identical to the canonical workspace except the Create Box `MASS` (2 → 0.5 kg). Made by `node scripts/compare-box-mass.js --write`; measured results in `docs/evidence/box-mass-comparison.json` |
| `fixtures/ball-and-box.snapshots.json` | **recorded** real engine snapshots at named events from a headless 20 s run, plus a 0.1 s ball trajectory for the first 4 s. Regenerate with `npm run fixture:record`; compared exactly by `tests/simulation.test.js` and `npm run fixture:check` |

Expected results:

- `initial` (tick 0, time 0): exactly the program's positions. Box velocity is (0, 0), ball velocity is (1.5, 0).
- `afterTick1` (time 1/120): ball v = (2.5, −0.08175), p = (0.0208333…, 1.99931875). The box is unchanged at
  (2, 0.5) with v = 0.
- `afterTick2`: ball vx stays 2.5 (the force acted on tick 1 only); v = (2.5, −0.1635), p = (0.0416666…, 1.99795625).
- Recorded events (`fixtures/ball-and-box.snapshots.json`, rounded here). The box stays on the floor (y = 0.5):

| event | tick | time (s) | ball (x, y) m | ball (vx, vy) m/s | box (x m, vx m/s) |
|---|---|---|---|---|---|
| setup | 0 | 0 | (0, 2) | (1.5, 0) | (2, 0) |
| firstTick | 1 | 0.0083 | (0.0208, 1.9993) | (2.5, −0.0818) | (2, 0) |
| preImpact | 60 | 0.5 | (1.25, 0.7533) | (2.5, −4.905) | (2, 0) |
| impact | 61 | 0.5083 | (1.2573, 0.7118) | (−0.1667, −4.9868) | (2.0068, 1.3333) |
| afterImpact | 67 | 0.5583 | (1.249, 0.4481) | (−0.1667, −5.4773) | (2.0734, 1.3333) |
| floorImpact | 72 | 0.6 | (1.242, 0.25) | (−0.1667, 3.5316) | (2.129, 1.3333) |
| rest | 269 | 2.2417 | (0.9684, 0.25) | (−0.1667, 0) | (4.3179, 1.3333) |
| end | 2400 | 20 | (−1.9913, 0.25) | (−0.1667, 0) | (27.9957, 1.3333) |

- Post-collision horizontal velocities (from tick 61 on): ball −1/6 m/s, box 4/3 m/s. That is the 1D result with
  restitution 0.6 (ball 1 kg at 2.5 m/s, box 2 kg at rest). Horizontal momentum is 2.5 kg·m/s before and after.

**Change log (2026-11-27): the ball now starts at y = 2 m (was 3 m).** From 3 m the ball landed on *top* of the
box. On a frictionless floor a vertical hit gives the box no horizontal push, so the box never moved and its mass
had no visible effect, which defeated the box-mass demo. From 2 m the ball meets the box's left face at 0.51 s with
its centre at y ≈ 0.75 m (inside the box's 0–1 m height). The program, both workspace fixtures, the expected file
(hand-derived ticks 1 and 2 shift by −1 m in y), the recorded snapshots and the tests were updated together. The
contract itself did not change.
