"""Flask routes match docs/ARCHITECTURE.md: read-only GETs, no write endpoints, no project storage API.

Run: .venv/bin/python -m unittest discover -s tests -p "test_*.py"
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import app  # noqa: E402


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_pages(self):
        lab = self.client.get("/")
        self.assertEqual(lab.status_code, 200)
        self.assertIn(b'id="blocklyDiv"', lab.data)
        mini = self.client.get("/mini")
        self.assertEqual(mini.status_code, 200)
        self.assertIn(b"Launch settings", mini.data)

    def test_legacy_lab_redirects(self):
        r = self.client.get("/lab")
        self.assertEqual(r.status_code, 301)
        self.assertEqual(r.headers["Location"], "/")

    def test_fixtures_are_read_only_json(self):
        with self.client.get("/fixtures/ball-and-box.workspace.json") as r:
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.mimetype, "application/json")
        for bad in ["/fixtures/missing.json", "/fixtures/app.py", "/fixtures/../package.json", "/fixtures/..%2Fpackage.json"]:
            self.assertEqual(self.client.get(bad).status_code, 404, bad)

    def test_no_writes_accepted(self):
        for path in ["/", "/mini", "/lab", "/fixtures/ball-and-box.program.json"]:
            for method in ("post", "put", "patch", "delete"):
                r = getattr(self.client, method)(path, json={"format": "motionlab-project"})
                self.assertEqual(r.status_code, 405, f"{method.upper()} {path}")

    def test_every_route_is_get_only(self):
        for rule in app.url_map.iter_rules():
            self.assertLessEqual(set(rule.methods), {"GET", "HEAD", "OPTIONS"}, rule.rule)

    def test_route_table_is_documented(self):
        rules = sorted(r.rule for r in app.url_map.iter_rules())
        self.assertEqual(rules, ["/", "/fixtures/<path:name>", "/lab", "/mini", "/static/<path:filename>"])


if __name__ == "__main__":
    unittest.main()
