# MotionLab architecture: storage and editor decisions

Decided 2026-11-27. Owner: Dharun. Applies to the prototype and Misora's refinement work.

## Decision

**Browser-side JSON project files. There is no backend storage, no database and no project API.** Flask stays in its
existing role: a static host for the pages, scripts and read-only fixture files. All simulation runs in the browser.

## Why

| Question | Finding | Source |
|---|---|---|
| Do the judging requirements need a backend? | No judging criteria are available in the repo or alongside it. The team's prompt document says to use the "actual judging criteria if available" and not to infer a Flask service or a storage database from an earlier plan | `~/Desktop/MotionLab-Claude-Code-Prompts-LaTeX.pdf` (pp. 1, 6), checked 2026-11-27 |
| Does the proposal need one? | "Flask and a database were optional in the proposal. The default here is browser-side execution and JSON project files." | same document, p. 1 |
| Does an existing feature need a server? | No. Every Flask route is a read-only `GET` (below). The only request the browser makes is fetching the Example fixture. Save, Open and autosave already ran entirely in the browser before this decision | `app.py`, `static/js/lab.js` (`fetch(EXAMPLE_URL)` is the only `fetch`) |
| Does an existing workflow use Flask? | Yes, as the web server for `/` and `/mini` and the fixtures. That workflow is kept unchanged | `app.py`, `README.md` (Run) |

If a future requirement does call for server storage, add it behind the same project envelope (below) so files and
the server stay interchangeable, and document its routes here before building them.

## Where things run

```
Browser                                                     Flask (app.py), read-only
───────────────────────────────────────────────────────     ─────────────────────────
Blockly workspace (editor state, authoritative)              GET /                 lab.html
   │ Blockly.serialization.workspaces.save                   GET /mini             mini.html
   ▼                                                         GET /lab              301 → /
compileWorkspace → program v1 → createSimulation             GET /fixtures/*.json  fixture files
   → step() snapshots → drawScene (canvas)                   GET /static/...       JS, CSS
   │
   ├─ Save / Download   → project envelope (.motionlab.json) → user's disk
   ├─ Open / Import     ← project envelope or bare program v1 ← user's disk
   └─ Autosave          → localStorage "motionlab.workspace.v1" (this browser only)
```

## Server routes (unchanged; documented, not extended)

| Method and route | Response | Errors |
|---|---|---|
| `GET /` | 200 HTML, block lab | none |
| `GET /mini` | 200 HTML, projectile mini demo | none |
| `GET /lab` | 301 to `/` | none |
| `GET /fixtures/<name>.json` | 200 `application/json` from `fixtures/` | 404 for names not ending in `.json`, for missing files, and for paths outside `fixtures/` (Flask `send_from_directory`) |
| `GET /static/<path>` | Flask static files | 404 if missing |
| any other method (`POST`, `PUT`, `DELETE`, …) on the routes above | **405** | the server accepts no writes |

`tests/test_routes.py` checks this table, including that writes are refused.

## Project envelope v1 (the storage contract)

A project file is UTF-8 JSON, conventionally named `*.motionlab.json`, at most **1,000,000 bytes**.

```json
{
  "format": "motionlab-project",
  "formatVersion": 1,
  "contractVersion": 1,
  "workspace": { "blocks": { "languageVersion": 0, "blocks": [ { "type": "motionlab_start", "id": "start", "x": 20, "y": 20, "next": { "block": { "...": "..." } } } ] } },
  "program": { "version": 1, "commands": [ "..." ] }
}
```

| Field | Rule |
|---|---|
| `format` | `"motionlab-project"`. The earlier tag `"motionlab-workspace"` (files saved before this decision) is still accepted on open; new files are always written with `"motionlab-project"` |
| `formatVersion` | exactly `1`. A higher integer means "made by a newer MotionLab" |
| `contractVersion` | exactly `1` (the program contract the blocks compile to) |
| `workspace` | **authoritative editor state.** Blockly JSON serialization: block order (`next` chains), positions (`x`, `y` on top-level blocks), stable block `id`s and field values. `{}` (empty workspace) is allowed |
| `program` | derived program v1, or `null` if the blocks did not compile. Written for people and tools to read. **Ignored on open:** the program is always regenerated from `workspace` |
| other fields | ignored (room for additions within version 1) |

The workspace is checked before it replaces anything. Every block reachable from `workspace.blocks.blocks` (top-level
blocks and their `next` chains) must be an object with:

- a MotionLab block `type`: `motionlab_start`, `motionlab_create_circle`, `motionlab_create_box`,
  `motionlab_set_gravity`, `motionlab_set_velocity` or `motionlab_apply_force`;
- an `id` string of 1–64 characters, unique in the file;
- `fields`, if present, as an object;
- no non-empty `inputs` (MotionLab blocks have none).

There are at most **600 blocks** in a file. Field *values* are not checked at this stage: once loaded, the compiler
reports bad values on their blocks, exactly as if they had been typed in.

Open also accepts a **bare program v1** (`{ "version": 1, "commands": [...] }`). It is converted to blocks with
`programToWorkspace`.

### Import errors

`parseMotionLabFile(text)` returns `{ source: "project" | "program", workspace }`, or throws `FileFormatError` with
`code` and an actionable `message`:

| code | when |
|---|---|
| `FILE_TOO_LARGE` | over 1,000,000 bytes (checked from the file size before reading, and again on the text) |
| `FILE_NOT_JSON` | not valid JSON |
| `FILE_NOT_OBJECT` | JSON, but not an object |
| `FILE_UNKNOWN_FORMAT` | neither a project envelope nor a bare program |
| `FILE_UNSUPPORTED_VERSION` | `formatVersion` or `contractVersion` is not 1 (a newer version gets a "made by a newer MotionLab" message) |
| `FILE_INVALID_WORKSPACE` | `workspace` missing or malformed: bad block shape, missing or duplicate `id`, non-object `fields`, or `inputs` |
| `FILE_UNKNOWN_BLOCK` | a block `type` that MotionLab does not have |
| `FILE_TOO_MANY_BLOCKS` | more than 600 blocks |
| `FILE_INVALID_PROGRAM` | a bare program that cannot become blocks (no `commands` array, or an unknown op) |

### Import behaviour in the page (`static/js/lab.js`)

1. The size is checked from `File.size` before the file is read.
2. The file is parsed and validated. **On any error, the current editor, its session and playback are left exactly
   as they were**, and the status line explains the problem.
3. On success, playback stops, the previous simulation is dropped, and the workspace is replaced and recompiled from
   the blocks. If Blockly itself rejects the workspace at this point (it shouldn't, after validation), the previous
   workspace is restored and the error is shown.

### Download

- **Save** writes the envelope as `experiment.motionlab.json`.
- **Export program** writes the bare program v1 as `experiment.program.json` (valid programs only).
- Autosave (`localStorage`) stores the bare workspace JSON. It is a per-browser convenience, not a project file.

## Editor decision: Blockly, with an HTML tray and a stack list

Decided 2026-11-27. The options were Blockly (already in the stack, at 12.3.1) or custom draggable stacked blocks.
**Blockly** was chosen:

| Need (brief) | How it is met | Where |
|---|---|---|
| Drag blocks from the bottom tray into the Code Area | HTML **Code Blocks** tray. Blockly's own toolbox is drawn inside the editor, so it can't span the page under both panels as the sketch shows. A chip is dropped where you release it | `TRAY` in `blocks.js`, `addBlockFromTray` in `lab.js` |
| Snap or insert into a visible ordered stack; reorder | Blockly snapping: blocks attach under the start block, can be inserted between blocks, and can be dragged to a new place | Blockly |
| Edit fields | Blockly fields: number fields with the contract's min/max, text ids, static checkbox | `BLOCK_DEFINITIONS` (generated from `OPS`/`LIMITS`) |
| Remove | drag to the trash can, Delete/Backspace on the selected block, or ✕ in the stack list (the stack closes the gap). Undo with Ctrl/Cmd+Z | Blockly, `removeBlock` |
| Keyboard: add, reorder, remove | tray chips are buttons (Enter appends to the stack). The **stack list** under the editor has ↑ ↓ ✕ and Attach buttons per block, and focus stays on the button after each move. Alt+↑ / Alt+↓ move the selected block | `outline.js`, `renderOutline`, `runStackAction` |
| Serialize the connected stack with stable blockIds | `Blockly.serialization.workspaces.save` → `compileWorkspace`. Block ids are Blockly's and survive save/open | `compile.js` |
| Flag disconnected blocks visibly | a dashed red, faded outline and a warning icon on the canvas, an amber `DISCONNECTED_BLOCK` entry under Problems, a "Not connected" section in the stack list, and a note in the status line | `markBlocks`, `disconnectedWarnings` |
| No JavaScript from blocks | no Blockly generators, no `eval`. Blocks are data | test in `tests/editor-fixture.test.js` |

Custom blocks would have meant writing our own drag, snapping, field editors, undo and serialization, which is
large, risky work with no visible gain. The one thing Blockly couldn't do (a page-wide tray) is a small HTML
component.

