"""MotionLab Flask app: the block lab at / and the projectile mini demo at /mini."""
from pathlib import Path

from flask import Flask, abort, redirect, render_template, send_from_directory, url_for

app = Flask(__name__)
FIXTURES = Path(__file__).resolve().parent / "fixtures"

# Pinned Blockly build loaded from the jsDelivr CDN by templates/lab.html.
BLOCKLY_VERSION = "12.3.1"


@app.get("/")
def lab():
    return render_template("lab.html", blockly_version=BLOCKLY_VERSION)


@app.get("/mini")
def mini():
    return render_template("mini.html")


@app.get("/lab")
def lab_legacy():
    # The block lab used to live here; keep old links and bookmarks working.
    return redirect(url_for("lab"), code=301)


@app.get("/fixtures/<path:name>")
def fixture(name):
    if not name.endswith(".json"):
        abort(404)
    return send_from_directory(FIXTURES, name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
