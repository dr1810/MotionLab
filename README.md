# MotionLab mini

A small Flask website with an integrated projectile animation pane. No Turtle or separate animation window is needed: the browser canvas draws the experiment.

## Run

```sh
cd /Users/dharunr/Desktop/MotionLab
.venv/bin/python app.py
```

Open http://127.0.0.1:5050. Change angle and speed, launch, pause/resume, or reset. Aim for the target at 30 meters. Changing a setting restarts the experiment.

For a fresh installation, create a virtual environment and install requirements.txt first. The model uses constant gravity and no air resistance.

## Project structure

- `app.py`: Flask application and route
- `templates/base.html`: shared Jinja page layout
- `templates/index.html`: experiment interface
- `static/css/style.css`: page styles
- `static/js/simulation.js`: animation and controls

## Prototype modules (contract v1)

The block-programming prototype lives in `static/js/motionlab/` (ES modules, no dependencies). Run the tests with `npm test` (Node 20+).
Spec: `docs/CONTRACT.md`. Setup, commands, status and open items: `docs/HANDOFF.md`.
Canonical fixture: `fixtures/ball-and-box.program.json`, its Blockly workspace `fixtures/ball-and-box.workspace.json`, and expected state `fixtures/ball-and-box.expected.json`.
Open the block lab at http://127.0.0.1:5050/lab (Blockly 12.3.1 from the jsDelivr CDN, so it needs network access).
