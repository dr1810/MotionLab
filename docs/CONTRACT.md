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
| `static/js/motionlab/compile.js` | `compileWorkspace(workspaceJson)`, `BLOCK_TYPES`, `START_BLOCK_TYPE` (`"motionlab_start"`) |
| `static/js/motionlab/view.js` | `createView({width, height, scale, worldLeft?, floorOffset?})`, `fitView(snapshot, {width, height, padding?, floorOffset?, minScale?, maxScale?})` |
| `static/js/motionlab/compile.js` (also) | `programToWorkspace(program)`: the inverse, for Example/Open |
| `static/js/motionlab/blocks.js` | `BLOCK_DEFINITIONS`, `TOOLBOX`, `DEFAULTS`, `MAX_INSTANCES`, `BODY_BLOCK_TYPES`, `defineBlocks(Blockly)`, `uniqueBodyId(taken, base)` |
| `static/js/motionlab/renderer.js` | `drawScene(ctx, snapshot, view, {velocities?, labels?, theme?})`, `gridStep(scale)`, `THEME` |
| `static/js/motionlab/playback.js` | `createPlayback({step, onFrame?, dt?, maxStepsPerFrame? = 12, maxFrameGap? = 0.1})` → `{running, start(now), stop(), frame(now)}` |
| `static/js/motionlab/files.js` | `serializeWorkspaceFile(workspace, program?)`, `serializeProgram(program)`, `parseMotionLabFile(text)`, `FileFormatError`, `FILE_FORMAT`, `FILE_FORMAT_VERSION`, `MAX_FILE_BYTES`, `WORKSPACE_FILENAME`, `PROGRAM_FILENAME` |
| `static/js/motionlab/index.js` | re-exports contract, engine, compile and view (the modules above it). Frontend modules are imported directly |

## Coordinates and units

- Physics: SI units (m, s, kg, N). +x right, +y up. Positions are body centers.
- A static, infinite floor at world `y = FLOOR_Y = 0`. The floor is **not** a body and never appears in `bodies`.
- Bodies are circles or axis-aligned boxes. No rotation and no friction (a body sliding on the floor or on a box keeps
  its horizontal speed).
- Canvas: CSS pixels, +y down. The canvas uses its own meter→pixel transform from `view.js`.

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
    { "id": "ball", "shape": "circle", "position": {"x": 0, "y": 3}, "velocity": {"x": 1.5, "y": 0},
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
   `e·|vn|` if it is closing faster than `REST_SPEED` (0.2 m/s), else 0. Pairs use `e = max(eA, eB)`; the floor
   uses the body's restitution.
3. Eight sequential-impulse passes over all contacts, with the accumulated impulse clamped at ≥ 0.
4. Four position-correction passes: body overlaps (80% per pass, 0.5 mm slop), then an exact floor clamp. So no
   dynamic body ever ends a step below the floor.

## Blocks → program (compiler)

`compileWorkspace(json)` takes the plain JSON from `Blockly.serialization.workspaces.save(workspace)` (no Blockly
import) and returns `{ ok, program, errors }`.

- There must be **exactly one** start block (`motionlab_start`). It emits no command. Only the stack connected below it
  is serialized. Loose stacks are ignored without an error.
- `program` is `null` only for `INVALID_WORKSPACE`, `NO_START_BLOCK` and `MULTIPLE_START_BLOCKS`. Otherwise it is
  returned even when invalid, so the UI can export it and point errors at blocks.
- An empty start stack compiles to the valid empty program.
- Disabled blocks (`enabled: false`, or a non-empty `disabledReasons`) are skipped.
- Checkbox `STATIC` accepts `true/false` or the legacy strings `"TRUE"/"FALSE"`.

| Blockly type | op | fields |
|---|---|---|
| `motionlab_create_circle` | `createCircle` | `ID X Y RADIUS MASS RESTITUTION STATIC` |
| `motionlab_create_box` | `createBox` | `ID X Y WIDTH HEIGHT MASS RESTITUTION STATIC` |
| `motionlab_set_gravity` | `setGravity` | `X Y` |
| `motionlab_set_velocity` | `setVelocity` | `ID VX VY` |
| `motionlab_apply_force` | `applyForce` | `ID FX FY` |

## Files

Saved workspace (`experiment.motionlab.json`):

```json
{ "format": "motionlab-workspace", "formatVersion": 1, "contractVersion": 1,
  "workspace": { "blocks": { "languageVersion": 0, "blocks": [ ... ] } },
  "program": { "version": 1, "commands": [ ... ] } }
```

`program` is informational (`null` if the workspace didn't compile); opening uses `workspace`. Open also accepts a
bare program v1, converted with `programToWorkspace`. Files over 1 MB, invalid JSON, another `formatVersion`, or a
program with an unknown op raise `FileFormatError` with a one-line reason. Exported programs
(`experiment.program.json`) are exactly program v1.

## Canonical fixture

| File | Content |
|---|---|
| `fixtures/ball-and-box.program.json` | program v1: gravity −9.81; box `box` 1×1 m, 2 kg, e 0.2 at (2, 0.5) resting on the floor; ball `ball` r 0.25 m, 1 kg, e 0.6 at (0, 3); ball velocity (1.5, 0); force (120, 0) N on the ball |
| `fixtures/ball-and-box.workspace.json` | Blockly workspace JSON that compiles to exactly that program (block ids = blockIds, start block `blk-start`) |
| `fixtures/ball-and-box.expected.json` | `initial`, `afterTick1`, `afterTick2` snapshots, tolerance 1e-9, with derivations |

Expected results:

- `initial` (tick 0, time 0): exactly the program's positions. Box velocity is (0, 0), ball velocity is (1.5, 0).
- `afterTick1` (time 1/120): ball v = (2.5, −0.08175), p = (0.0208333…, 2.99931875). The box is unchanged at
  (2, 0.5) with v = 0.
- `afterTick2`: ball vx stays 2.5 (the force acted on tick 1 only); v = (2.5, −0.1635), p = (0.0416666…, 2.99795625).
- Later behaviour, covered by tests rather than the fixture file: around tick 72 (0.6 s) the ball lands on the top
  edge of the box and bounces up at ≈ 0.6 × its closing speed. The box, supported by the floor, does not move. The
  ball then falls off the right side, bounces on the floor, settles at y = 0.25 and keeps rolling right at 2.5 m/s
  (there is no friction).
