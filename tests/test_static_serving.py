#!/usr/bin/env python3
"""
Unit and integration tests for static web assets and graph path translation (Issue #10).
"""

import sys
import shutil
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import HTTPServer

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import server
from server import GraphRequestHandler, find_available_port


class TestStaticServing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = tempfile.mkdtemp(prefix="kg_test_static_")
        cls.test_graph_dir = Path(cls.test_dir) / "graph"
        cls.test_graph_dir.mkdir(parents=True, exist_ok=True)

        # Seed sample file in graph
        sample_station = cls.test_graph_dir / "sample"
        sample_station.mkdir(parents=True, exist_ok=True)
        (sample_station / "info.md").write_text("# Sample Station", encoding="utf-8")
        (sample_station / "cheatsheet.txt").write_text("Cheat sheet content", encoding="utf-8")

        cls.orig_graph_dir = server.GRAPH_DIR
        server.GRAPH_DIR = cls.test_graph_dir

        cls.port = find_available_port(9250)
        cls.httpd = HTTPServer(("127.0.0.1", cls.port), GraphRequestHandler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        try:
            cls.httpd.shutdown()
            cls.httpd.server_close()
        except Exception:
            pass
        server.GRAPH_DIR = cls.orig_graph_dir
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _get(self, path: str) -> tuple[int, bytes, str]:
        url = f"{self.base_url}{path}"
        try:
            with urllib.request.urlopen(url) as resp:
                content_type = resp.headers.get("Content-Type", "")
                return resp.getcode(), resp.read(), content_type
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers.get("Content-Type", "")

    def test_serves_index_html_at_root(self):
        status, body, ctype = self._get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<!DOCTYPE html>", body)
        self.assertIn(b"Knowledge Graph", body)

    def test_serves_style_css(self):
        status, body, ctype = self._get("/style.css")
        self.assertEqual(status, 200)
        self.assertIn(b":root", body)

    def test_serves_app_js(self):
        status, body, ctype = self._get("/app.js")
        self.assertEqual(status, 200)
        self.assertIn(b"renderCurrentView", body)

    def test_serves_vendored_libs(self):
        status, body, ctype = self._get("/libs/marked.min.js")
        self.assertEqual(status, 200)
        self.assertGreater(len(body), 1000)

    def test_serves_graph_directory_files(self):
        status, body, ctype = self._get("/graph/sample/cheatsheet.txt")
        self.assertEqual(status, 200)
        self.assertEqual(body.decode("utf-8").strip(), "Cheat sheet content")

    def test_nonexistent_file_returns_404(self):
        status, body, ctype = self._get("/nonexistent.xyz")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
