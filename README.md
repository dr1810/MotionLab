# MotionLab

A small Flask website for physics experiments in the browser. The main page is a block lab: snap blocks together to build a scene, then run it on a canvas. A projectile mini demo lives alongside it.

## Run

```sh
cd /Users/dharunr/Desktop/MotionLab
.venv/bin/python app.py
```

- http://127.0.0.1:5050/ is the **block lab**. Snap blocks under *when experiment starts*, then Run, Step or Reset. Example, Open, Save and Export are in the header. It uses Blockly 12.3.1 from the jsDelivr CDN, so it needs network access.
- http://127.0.0.1:5050/mini is the **projectile mini** demo. Change angle and speed, launch, pause/resume, or reset, and aim for the target at 30 meters. Changing a setting restarts the experiment. It uses constant gravity and no air resistance.
- The old address `/lab` redirects to `/`.

For a fresh installation, create a virtual environment and install `requirements.txt` first. Restart the server after editing templates, since Flask caches them when debug is off.

## Project structure

- `app.py`: Flask application and routes (`/`, `/mini`, `/lab` redirect, `/fixtures/<name>.json`)
- `templates/base.html`: shared Jinja page layout
- `templates/lab.html`, `static/css/lab.css`, `static/js/lab.js`: block lab page
- `templates/mini.html`, `static/css/style.css`, `static/js/simulation.js`: projectile mini demo (`style.css` is also the base style for both pages)
- `static/js/motionlab/`: prototype modules (ES modules, no dependencies)

## Prototype modules (contract v1)

Run the tests with `npm test` (Node 20+).
Spec: `docs/CONTRACT.md`. Setup, commands, status and open items: `docs/HANDOFF.md`.
Canonical fixture: `fixtures/ball-and-box.program.json`, its Blockly workspace `fixtures/ball-and-box.workspace.json`, and expected state `fixtures/ball-and-box.expected.json`.
