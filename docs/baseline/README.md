# Baseline layout (for Misora's design pass)

> Block names were changed after these captures ("When simulation starts", "Create Ball", "Set Initial Velocity",
> "restitution" instead of "bounce"), and a stack list was added under the Code Area. The layout and regions are the same.

Captured 2026-11-27 from the block lab shell (`/`). The captures show the fresh ball-and-box example at tick 0, on a
local server (`flask --app app run --port 5051`), in the Claude desktop app's Chromium-based browser pane with
Blockly 12.3.1. The working tree was based on commit `8c7bfef`, plus the uncommitted shell change; the commit that
adds this folder is the one to compare against. The screenshots are scaled down by the capture tool (desktop:
800×500 for a 1440×900 viewport).

| File | Viewport | Layout |
|---|---|---|
| [desktop-1440x900.jpg](desktop-1440x900.jpg) | 1440×900 | sketch layout: top bar, Code Area left, Output right, tray across the bottom; fits the screen, no page scroll |
| [tablet-768x1024.jpg](tablet-768x1024.jpg) | 768×1024 | one column (below 960 px): top bar, Output, Code Area, tray; page scrolls |
| [mobile-375x812.jpg](mobile-375x812.jpg) | 375×812 | one column, toolbar groups and tray chips full width; page scrolls |

No viewport scrolls horizontally (`scrollWidth` ≤ viewport width; no element outside the Blockly editor overflows).

## Regions (from the sketch) and where they live

The sketch image `IMG_4784.jpeg` was not in the repo or alongside it when this was built. The regions follow its
description in the team prompt document: Files and Download along the top, a narrow Code Area on the left, a larger
Simulation Output on the right, and a full-width Code Blocks tray at the bottom.

| Region | Markup (`templates/lab.html`) | Measured at 1440×900 (x,y w×h, CSS px) |
|---|---|---|
| Top bar: **Files** (Example, New, Open…) and **Download** (Save project, Export program) | `header.topbar`, `#example #clear #open #save #export` | 12,12 1416×65 |
| **A. Code Area** (Blockly editor, no built-in toolbox) | `section.code-area#codeArea` > `#blocklyDiv` | 12,89 562×625 (columns 2fr : 3fr, min 300 px) |
| **B. Simulation Output**: canvas, then **Run, Pause, Reset** (and Step), status, problems, body readout | `section.output`, `#stage`, `#run #pause #reset #step`, `#status #errors #bodies` | 586,89 842×625, canvas 840×425 |
| **C. Code Blocks** tray (full width) | `section.tray` > `#tray` (chips built from `TRAY` in `static/js/motionlab/blocks.js`) | 12,726 1416×162 |

Below 960 px the Output moves above the Code Area, so the result shows first and the tray stays directly under the
editor. Below 560 px the toolbar groups and chips go full width.

## Visual treatment

"Lab notebook": warm paper background with a faint 24 px graph grid, ink-navy top bar, cream panels with lettered
region tags (A/B/C), teal for Run and for bodies on the canvas, amber for Pause and velocity arrows. Chips use the
same colours as their Blockly blocks (`hueToHex`, verified against `Blockly.utils.colour.hueToHex`) and have a small
tab, like a block's notch. Tokens are CSS custom properties at the top of `static/css/lab.css`; canvas colours are
`THEME` in `static/js/motionlab/renderer.js`.

Focus: every control, link, tray chip and clickable problem shows a 3 px blue `:focus-visible` outline (lighter blue
on the dark top bar). There is a "Skip to the Code Area" link as the first tab stop.

## Behaviour checked in the browser

- **Click or Enter on a chip** appends the block to the end of the start stack. Focus stays on the chip, so you can
  add several in a row. A body with a name already in use is renamed (`ball2`, `box2`).
- **Dragging a chip** into the Code Area shows a dashed drop zone and places the block's top-left corner exactly at
  the drop point (checked at the pane's native size: drop at (413, 1020), block at (413, 1020)).
- **Start chip** is marked unavailable while a start block exists; clicking it explains why.
- **Run, Pause, Reset:** Run is disabled while running and Pause is disabled while stopped. After Pause, Run reads
  "Resume" and continues the same session (tick 59 → 95 in the check); Reset goes back to tick 0 and the label
  returns to "Run".
- **Problems** can be focused with Tab, and Enter selects the block they point to.
- The console shows only Blockly 12's own `getAllVariables` deprecation warnings.

## Starting points for the design pass (observed, not fixed)

- The "Projectile mini" text link is the smallest tap target (19 px tall at 375 px wide).
- At tablet width, the one-column layout makes the page about 1.4 screens tall. A two-column layout from around
  760 px could work if the Code Area can stay usable at that width.
- The Blockly blocks themselves keep Blockly's default look (Geras renderer, 0.85 zoom). Only the page around them
  is themed.
- Dragging from the tray uses HTML drag and drop, which touch screens don't support. On phones, tapping a chip
  (which appends it) is the way to add blocks.
