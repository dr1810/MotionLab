"""MotionLab Flask app: the projectile demo at / and the block lab at /lab."""
from pathlib import Path

from flask import Flask, abort, render_template, send_from_directory

app = Flask(__name__)
FIXTURES = Path(__file__).resolve().parent / "fixtures"

# Pinned Blockly build loaded from the jsDelivr CDN by templates/lab.html.
BLOCKLY_VERSION = "12.3.1"


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/lab")
def lab():
    return render_template("lab.html", blockly_version=BLOCKLY_VERSION)


@app.get("/fixtures/<path:name>")
def fixture(name):
    if not name.endswith(".json"):
        abort(404)
    return send_from_directory(FIXTURES, name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
