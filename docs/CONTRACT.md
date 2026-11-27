# MotionLab contract v1

Source of truth: `static/js/motionlab/contract.js` (`CONTRACT_VERSION = 1`, `PROGRAM_VERSION = 1`).
All modules are native ES modules, dependency-free, with no Blockly or DOM types. They run unchanged in
Node (tests) and in the browser (`<script type="module">`, served by Flask from `/static/js/motionlab/`).

## Module map and exact exports

Import everything from `static/js/motionlab/index.js`, which re-exports:

| Module | Exports |
|---|---|
| `contract.js` | `CONTRACT_VERSION`, `PROGRAM_VERSION`, `DT`, `FLOOR_Y`, `DEFAULT_GRAVITY`, `LIMITS`, `BODY_ID_PATTERN`, `ERROR_CODES`, `OPS`, `ProgramError`, `validateProgram(program)` |
| `engine.js` | `createSimulation(program)`, `REST_SPEED`, `SOLVER_ITERATIONS`, `FLOOR_RESTITUTION` |
| `compile.js` | `compileWorkspace(workspaceJson)`, `programToWorkspace(program)`, `START_BLOCK_TYPE`, `BLOCK_TYPES` |
| `view.js` | `createViewTransform({heightPx, pixelsPerMeter, originXPx?, floorMarginPx?})`, `fitView(snapshot, {widthPx, heightPx, ...})` |
| `blocks.js` | `BLOCK_DEFINITIONS`, `TOOLBOX`, `FIELD_DEFAULTS`, `BLOCK_COLOURS`, `registerBlocks(Blockly)` |
| `playback.js` | `createPlayback(sim, {maxStepsPerFrame?})`, `MAX_STEPS_PER_FRAME` |
| `renderer.js` | `drawScene(ctx, snapshot, view, {widthPx, heightPx}, theme?)`, `DEFAULT_THEME` |
| `files.js` | `serializeWorkspaceFile(ws)`, `parseWorkspaceFile(text)`, `FILE_FORMAT`, `FILE_VERSION`, `MAX_FILE_BYTES`, `FILE_ERROR_CODES` |

`blocks.js` receives Blockly as an argument; none of these modules import Blockly or touch the DOM.
The page glue that does is `static/js/lab.js`.

## World conventions

- SI units: meters, kilograms, seconds, newtons.
- `+x` right, `+y` up. Body positions are body centres.
- A static, infinite floor lies at `y = FLOOR_Y = 0`. It is **not** in `snapshot().bodies`.
- Default gravity `{x: 0, y: -9.81}` when no `setGravity` command is present.
- Bodies do not rotate (boxes stay axis-aligned). No friction or air drag in v1.

## Program v1

```js
{ version: 1, commands: [ { op, blockId, ...payload }, ... ] }
```

Commands are flat objects. Every command has `op` and a stable `blockId` (1–64 chars, unique in the
program; the Blockly block id). No other fields are allowed.

| op | payload (all required) |
|---|---|
| `createCircle` | `id, x, y, radius, mass, restitution, static` |
| `createBox` | `id, x, y, width, height, mass, restitution, static` |
| `setGravity` | `x, y` |
| `setVelocity` | `id, vx, vy` |
| `applyForce` | `id, fx, fy` |

Semantics, all applied at scene setup in stack order:

- `create*` adds a body with zero velocity. `static: true` bodies never move; their `mass` is validated but ignored.
- `setGravity` sets scene gravity. If several are present, the last one wins.
- `setVelocity` sets the initial velocity of a body created **above** it. Later ones overwrite earlier ones.
- `applyForce` adds a force to a body created above it. Forces on the same body add up. The total force acts
  for the **first physics tick only** (Δv = F/m · 1/120 s) and is re-armed by `reset()`.
- `setVelocity`/`applyForce` on a static body is an error.

### Limits

| Item | Limit |
|---|---|
| commands | ≤ 200 |
| bodies (static + dynamic) | ≤ 50 |
| body `id` | 1–32 chars, `^[A-Za-z][A-Za-z0-9_-]*$` |
| `x`, `y` (position) | −1000 … 1000 m |
| `radius` | 0.01 … 100 m |
| `width`, `height` | 0.01 … 200 m |
| `mass` | 0.001 … 10000 kg |
| `restitution` | 0 … 1 |
| gravity `x`, `y` | −100 … 100 m/s² |
| `vx`, `vy` | −500 … 500 m/s |
| `fx`, `fy` | −1e6 … 1e6 N |

Numbers must be finite JS numbers (strings, `NaN`, `Infinity`, `null` are `INVALID_TYPE`). Bounds are inclusive.
A dynamic body must start with its bottom at or above the floor. Static bodies may be placed anywhere.
Overlapping bodies at setup are allowed and are pushed apart on the first step.

### Empty and invalid programs

- `{version: 1, commands: []}` is **valid**: no bodies, default gravity; `step()` still advances time.
- `validateProgram(p)` never throws or mutates. It returns `{ok: true, errors: []}` or `{ok: false, errors}`.
- `createSimulation(p)` on an invalid program throws `ProgramError` (`err.name === 'ProgramError'`,
  `err.errors` is the same array `validateProgram` returns).

### Errors

Every error is exactly `{code, message, blockId}`. `message` is human-readable text for the UI.
`blockId` is the offending command's block id, or `null` for document-level errors.
Document-level errors stop validation and are returned alone. Command errors are all collected, in stack order;
a command with shape/type/range errors gets no semantic checks. A create command with a bad value but a valid `id`
still declares that body, so blocks below it are not also reported as `UNKNOWN_BODY`.

| code | blockId | when |
|---|---|---|
| `INVALID_DOCUMENT` | null | not an object, unknown top-level key, `commands` not an array, workspace JSON with no blocks array |
| `UNSUPPORTED_VERSION` | null | `version !== 1` |
| `TOO_MANY_COMMANDS` | null | more than 200 commands |
| `INVALID_COMMAND` | null | command not an object, or missing/invalid `blockId` |
| `DUPLICATE_BLOCK_ID` | block | `blockId` reused |
| `UNKNOWN_OP` | block | `op` not in the table |
| `MISSING_FIELD` | block | payload field absent |
| `UNKNOWN_FIELD` | block | extra field |
| `INVALID_TYPE` | block | wrong type, non-finite number, non-boolean `static` |
| `OUT_OF_RANGE` | block | number outside limits |
| `INVALID_ID` | block | bad body id |
| `DUPLICATE_BODY_ID` | block | body id already created |
| `TOO_MANY_BODIES` | block | the 51st create command |
| `UNKNOWN_BODY` | block | target body not created above this block |
| `STATIC_BODY_TARGET` | block | `setVelocity`/`applyForce` on a static body |
| `BODY_BELOW_FLOOR` | block | dynamic body starts below `y = 0` |
| `NO_START_BLOCK` | null | compiler: no start block |
| `MULTIPLE_START_BLOCKS` | each extra start block | compiler: more than one start block |
| `UNKNOWN_BLOCK_TYPE` | block | compiler: unrecognised block in the start stack |

## Start block and compilation

`compileWorkspace(json)` takes the plain JSON from `Blockly.serialization.workspaces.save(workspace)`
(or its inner `{blocks: [...]}`) and returns `{ok, program, errors}`.

- Exactly one top-level block of type `motionlab_start` must exist. It emits no command.
- Only the stack connected below it (`next.block` chain) is serialized. Loose stacks are ignored. Disabled blocks
  (`enabled: false` or non-empty `disabledReasons`) are skipped.
- Block types: `motionlab_create_circle`, `motionlab_create_box`, `motionlab_set_gravity`,
  `motionlab_set_velocity`, `motionlab_apply_force`. Field names are payload names upper-cased
  (`ID, X, Y, RADIUS, WIDTH, HEIGHT, MASS, RESTITUTION, STATIC, VX, VY, FX, FY`). Checkbox values may be
  booleans or legacy `"TRUE"`/`"FALSE"`.
- Structural errors (`NO_START_BLOCK`, `MULTIPLE_START_BLOCKS`, `UNKNOWN_BLOCK_TYPE`) return `program: null`.
  Otherwise `program` is the compiled document and `errors` comes from `validateProgram`.

`programToWorkspace(program)` is the inverse for a valid program: a start block (id `start`, or `start-N` if a command
already uses that id) with one block per command, keeping each `blockId`.

## Files

Save format (`files.js`), written by the lab's **Save** button:

```js
{ format: 'motionlab', fileVersion: 1, contractVersion: 1, workspace: <Blockly serialization JSON> }
```

`parseWorkspaceFile(text)` returns `{ok, workspace, errors}` and never throws. It also accepts a bare program v1
document (what **Export program** writes) and converts it to blocks. Its errors are `{code, message, blockId: null}`
with codes `FILE_TOO_LARGE` (> 1,000,000 chars), `INVALID_JSON`, `UNSUPPORTED_FILE`. A program file that fails
validation returns the contract errors (with block ids).

## Simulation API

```js
const sim = createSimulation(program); // throws ProgramError if invalid
sim.snapshot(); // {tick: 0, time: 0, bodies}
sim.step();     // advances exactly DT = 1/120 s, returns the new snapshot
sim.reset();    // restores the compiled initial scene, tick 0, re-arms forces; returns the snapshot
```

The browser owns playback scheduling. The engine has no timers. `createPlayback(sim)` is the scheduler the lab
uses from `requestAnimationFrame`: `advance(elapsedSeconds)` runs one `step()` per 1/120 s of real time, keeps the
remainder, and runs at most 30 steps per frame (excess time is dropped, so a background tab doesn't fast-forward).

`time` is always `tick * DT` (not accumulated). The simulation copies the program at creation;
later edits to the input object do not affect it.

### Snapshot

Detached (a fresh object on every call) and JSON-serializable. Keys are exactly `tick`, `time`, `bodies`.
Bodies are in creation order:

```js
{
  id: 'ball',
  shape: 'circle' | 'box',
  position: { x, y },          // m, body centre
  velocity: { x, y },          // m/s
  dimensions: { radius } | { width, height },  // m
  static: false
}
```

### Engine behaviour (for diagnosing)

Per step: semi-implicit Euler for each dynamic body (`v += (g + F/m on tick 1) · dt; p += v · dt`), then
`SOLVER_ITERATIONS = 4` passes of: every body pair in creation order, then the floor. Contacts are fully
position-corrected (split by inverse mass) and use restitution `max(eA, eB)`. Floor restitution is 0, so a floor
contact uses the body's restitution. Approach speeds under `REST_SPEED = 0.1 m/s` use restitution 0, so resting
bodies settle instead of jittering. Each step ends with a floor pass, so no dynamic body is below the floor in a
snapshot. The engine is deterministic: the same program gives bit-identical snapshots.

## Rendering: floor and canvas transform

The canvas has its own meter-to-pixel transform. The renderer gets the floor from the contract constant
`FLOOR_Y` (always 0 in v1), not from the snapshot:

```js
const view = createViewTransform({ heightPx: canvas.clientHeight, pixelsPerMeter: 50, originXPx: 20, floorMarginPx: 40 });
view.floorPx;            // canvas row of the floor line = toCanvas(0, FLOOR_Y).y = heightPx - floorMarginPx
view.toCanvas(x, y);     // world m -> CSS px (+y flips to down)
view.lengthToPx(radius); // sizes
```

A box is drawn centred: top-left at `toCanvas(x - w/2, y + h/2)`, size `w·s × h·s`.

The lab uses `fitView(initialSnapshot, {widthPx, heightPx})`: a fixed camera that fits the initial scene with a 1 m
margin, at least 8 m wide and 4 m tall. It is recomputed on compile and resize, not per frame, so a body can leave
the view.

## Canonical fixture

- Program: `fixtures/ball-and-box.program.json`
- Expected results: `fixtures/ball-and-box.expected.json` (tolerance 1e-9)

Scene: gravity −9.81; dynamic box `box` (1×1 m, 2 kg, e=0.2) resting on the floor at (2, 0.5);
dynamic ball `ball` (r=0.25, 1 kg, e=0.6) at (0, 3) with initial velocity (1.5, 0) and a 120 N +x force.

| | tick | time | box pos / vel | ball pos | ball vel |
|---|---|---|---|---|---|
| initial (`snapshot()`, `reset()`) | 0 | 0 | (2, 0.5) / (0, 0) | (0, 3) | (1.5, 0) |
| after first `step()` | 1 | 1/120 | (2, 0.5) / (0, 0) | (0.0208333…, 2.99931875) | (2.5, −0.08175) |

Ball tick-1 derivation: `vx = 1.5 + 120/1 · 1/120 = 2.5`; `vy = −9.81/120 = −0.08175`;
`x = 2.5/120`; `y = 3 + vy/120`. The box's gravity sink (0.08175 m/s) is below `REST_SPEED`, so it stays at rest.
On the second step the ball's `vx` stays 2.5 (force applied once only).
