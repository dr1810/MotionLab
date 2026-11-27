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
