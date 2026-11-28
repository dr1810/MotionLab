# Demo evidence: box mass changes the collision

Recorded 2026-11-27 on the working tree based on commit `d74aaf9`, plus this change; compare against the commit that
adds this folder. Fixed step 1/120 s, SI units.

## The two runs (one input changed)

| | Run 1: canonical Example | Run 2: second run |
|---|---|---|
| Project | `fixtures/ball-and-box.workspace.json` (Example button) | `fixtures/ball-and-box.light-box.motionlab.json` (Open…), or edit the box's mass on screen |
| Gravity | (0, −9.81) m/s² | same |
| Ball | 1 kg, r 0.25 m, restitution 0.6, starts at (0, 2) m, initial velocity (1.5, 0) m/s, plus 120 N for the first tick → 2.5 m/s | same |
| Box | **2 kg**, 1 × 1 m, restitution 0.2, at (2, 0.5) m on the floor, dynamic | **0.5 kg**, otherwise the same |

## Measured (engine, through the app's compile path)

`node scripts/compare-box-mass.js`; the raw numbers are in [box-mass-comparison.json](box-mass-comparison.json).
Velocities are horizontal, in m/s, measured 0.05 s after impact. Impact is at tick 61 (0.508 s) in both runs, on the
box's left face.

| run | box mass | ball vx before | ball vx after | box vx after | 1D formula, e = 0.6 (ball / box) | momentum before → after |
|---|---|---|---|---|---|---|
| 1 | 2 kg | 2.500 | **−0.167** (bounces back) | **1.333** | −0.167 / 1.333 | 2.500 → 2.500 kg·m/s |
| 2 | 0.5 kg | 2.500 | **+1.167** (keeps going) | **2.667** | 1.167 / 2.667 | 2.500 → 2.500 kg·m/s |

**What changed:** with the lighter box, the ball no longer bounces back but follows the box. The box leaves twice as
fast, and after 5 s it is about 6 m further right. Absolute errors against the formula are below 1e-9 m/s
(`tests/demo.test.js`).

## On screen (browser, block lab at 1440 × 900)

Both screenshots are paused at tick 64 (0.533 s), just after the hit. The readout under the canvas shows the
measured velocities.

| File | What it shows |
|---|---|
| [run1-box-2kg-tick64.jpg](run1-box-2kg-tick64.jpg) | ball against the box's left face; box vx 1.333, ball vx −0.167 |
| [run2-box-0.5kg-tick64.jpg](run2-box-0.5kg-tick64.jpg) | Create Box mass 0.5 kg (typed into the field); box vx 2.667, ball vx 1.167; longer arrow on the box |

Also checked in the browser: Save project, then Open, of both the edited project and the Example gives the same
programs and the same post-collision velocities. The checked-in light-box file opens and matches.

## Demo steps (about 60 s)

1. Press **Example**. The Code Area shows the stack: When simulation starts, Set Gravity, Create Box (2 kg), Create
   Ball (1 kg), Set Initial Velocity (1.5, 0), Apply Force (120, 0).
2. Press **Run**. The ball arcs right and hits the side of the box; it bounces back slightly and the box slides
   away (readout: ball vx −0.167, box vx 1.333).
3. Press **Reset**. Click the box's **mass** field, type `0.5`, press Enter.
4. Press **Run** again. This time the ball keeps moving right behind a faster box (ball vx 1.167, box vx 2.667).
5. Fallback: **Open…** `fixtures/ball-and-box.light-box.motionlab.json` for step 3.
