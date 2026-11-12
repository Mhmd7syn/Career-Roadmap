#!/usr/bin/env python3
"""
Unit and integration tests for Station Management API (Issue #11).
Tests pure Python standard library HTTP endpoints in server.py.
"""

import os
import sys
import json
import shutil
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import HTTPServer

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import server
from server import GraphRequestHandler, find_available_port


class TestStationManagement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create isolated temporary directory for test graph
        cls.test_dir = tempfile.mkdtemp(prefix="kg_test_graph_")
        cls.test_graph_dir = Path(cls.test_dir) / "graph"
        cls.test_graph_dir.mkdir(parents=True, exist_ok=True)

        # Redirect server.GRAPH_DIR to our test folder
        cls.orig_graph_dir = server.GRAPH_DIR
        server.GRAPH_DIR = cls.test_graph_dir

        # Start background HTTP server
        cls.port = find_available_port(9100)
        cls.httpd = HTTPServer(("127.0.0.1", cls.port), GraphRequestHandler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        # Shutdown HTTP server
        try:
            cls.httpd.shutdown()
            cls.httpd.server_close()
        except Exception:
            pass
        # Restore GRAPH_DIR and remove temp folder
        server.GRAPH_DIR = cls.orig_graph_dir
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        # Reset test graph contents before each test
        for p in self.test_graph_dir.iterdir():
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()

        # Seed initial graph hierarchy:
        # root
        #   ├── tech
        #   │     ├── info.md
        #   │     ├── notes.md
        #   │     └── swe
        #   │           ├── info.md
        #   │           └── notes.md
        #   └── business
        #         ├── info.md
        #         ├── notes.md
        #         └── swe-link (shortcut -> tech/swe)
        #               └── shortcut.json

        tech = self.test_graph_dir / "tech"
        tech.mkdir()
        (tech / "info.md").write_text("# Tech Hub\n\n**Status:** in-progress", encoding="utf-8")
        (tech / "notes.md").write_text("# Tech Hub Notes", encoding="utf-8")

        swe = tech / "swe"
        swe.mkdir()
        (swe / "info.md").write_text("# Software Engineering\n\n**Status:** todo", encoding="utf-8")
        (swe / "notes.md").write_text("# Software Engineering Notes", encoding="utf-8")

        biz = self.test_graph_dir / "business"
        biz.mkdir()
        (biz / "info.md").write_text("# Business Hub\n\n**Status:** todo", encoding="utf-8")
        (biz / "notes.md").write_text("# Business Hub Notes", encoding="utf-8")

        swe_link = biz / "swe-link"
        swe_link.mkdir()
        (swe_link / "shortcut.json").write_text(json.dumps({"target": "tech/swe"}, indent=2), encoding="utf-8")

    def _post_json(self, endpoint: str, payload: dict) -> tuple[int, dict]:
        url = f"{self.base_url}{endpoint}"
        req_data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=req_data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.getcode()
                body = json.loads(resp.read().decode("utf-8"))
                return status, body
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                body = json.loads(e.read().decode("utf-8"))
            except Exception:
                body = {"raw": str(e)}
            return status, body

    # -------------------------------------------------------------------------
    # 1. Station Renaming Tests
    # -------------------------------------------------------------------------
    def test_rename_canonical_station_syncs_headers_and_shortcuts(self):
        status, res = self._post_json("/api/rename-node", {
            "path": "tech/swe",
            "newTitle": "Applied Software Engineering",
            "newSlug": "applied-swe"
        })
        self.assertEqual(status, 200)
        self.assertTrue(res.get("success"))
        self.assertEqual(res.get("oldPath"), "tech/swe")
        self.assertEqual(res.get("newPath"), "tech/applied-swe")
        self.assertFalse(res.get("isShortcut"))
        self.assertIn("business/swe-link", res.get("affectedShortcuts", []))

        # Check directory renamed on disk
        self.assertFalse((self.test_graph_dir / "tech" / "swe").exists())
        new_swe = self.test_graph_dir / "tech" / "applied-swe"
        self.assertTrue(new_swe.exists())

        # Check H1 headers updated in info.md and notes.md
        info_text = (new_swe / "info.md").read_text(encoding="utf-8")
        notes_text = (new_swe / "notes.md").read_text(encoding="utf-8")
        self.assertTrue(info_text.startswith("# Applied Software Engineering"))
        self.assertTrue(notes_text.startswith("# Applied Software Engineering"))

        # Check shortcut cascaded
        sc_data = json.loads((self.test_graph_dir / "business" / "swe-link" / "shortcut.json").read_text(encoding="utf-8"))
        self.assertEqual(sc_data.get("target"), "tech/applied-swe")

    def test_rename_shortcut_pointer_only_renames_shortcut_dir(self):
        status, res = self._post_json("/api/rename-node", {
            "path": "business/swe-link",
            "newTitle": "Ignored Title for Pointer",
            "newSlug": "coding-shortcut"
        })
        self.assertEqual(status, 200)
        self.assertTrue(res.get("isShortcut"))
        self.assertEqual(res.get("newPath"), "business/coding-shortcut")

        # Shortcut directory renamed, target remains tech/swe
        self.assertFalse((self.test_graph_dir / "business" / "swe-link").exists())
        new_sc = self.test_graph_dir / "business" / "coding-shortcut"
        self.assertTrue(new_sc.exists())
        sc_data = json.loads((new_sc / "shortcut.json").read_text(encoding="utf-8"))
        self.assertEqual(sc_data.get("target"), "tech/swe")

        # Canonical station untouched
        self.assertTrue((self.test_graph_dir / "tech" / "swe").exists())

    def test_rename_root_rejected(self):
        status, res = self._post_json("/api/rename-node", {
            "path": "",
            "newTitle": "New Root"
        })
        self.assertEqual(status, 400)
        self.assertIn("Root station cannot be renamed", res.get("error", ""))

    def test_rename_collision_rejected(self):
        # Create dummy directory 'tech/dev'
        (self.test_graph_dir / "tech" / "dev").mkdir()
        status, res = self._post_json("/api/rename-node", {
            "path": "tech/swe",
            "newSlug": "dev"
        })
        self.assertEqual(status, 400)
        self.assertIn("already exists", res.get("error", ""))

    # -------------------------------------------------------------------------
    # 2. Station Moving Tests
    # -------------------------------------------------------------------------
    def test_move_station_cascades_shortcuts(self):
        status, res = self._post_json("/api/move-node", {
            "sourcePath": "tech/swe",
            "newParentPath": "business"
        })
        self.assertEqual(status, 200)
        self.assertTrue(res.get("success"))
        self.assertEqual(res.get("newPath"), "business/swe")
        self.assertFalse((self.test_graph_dir / "tech" / "swe").exists())
        self.assertTrue((self.test_graph_dir / "business" / "swe").exists())

        # Shortcut pointing to tech/swe should now point to business/swe
        sc_data = json.loads((self.test_graph_dir / "business" / "swe-link" / "shortcut.json").read_text(encoding="utf-8"))
        self.assertEqual(sc_data.get("target"), "business/swe")

    def test_move_cycle_and_descendant_protection(self):
        # Cannot move parent 'tech' into its child 'tech/swe'
        status, res = self._post_json("/api/move-node", {
            "sourcePath": "tech",
            "newParentPath": "tech/swe"
        })
        self.assertEqual(status, 400)
        self.assertIn("cycle detected", res.get("error", ""))

        # Cannot move node into itself
        status, res = self._post_json("/api/move-node", {
            "sourcePath": "tech",
            "newParentPath": "tech"
        })
        self.assertEqual(status, 400)
        self.assertIn("into itself", res.get("error", ""))

        # Cannot move node into its current parent
        status, res = self._post_json("/api/move-node", {
            "sourcePath": "tech/swe",
            "newParentPath": "tech"
        })
        self.assertEqual(status, 400)
        self.assertIn("already located in this parent hub", res.get("error", ""))

    # -------------------------------------------------------------------------
    # 3. Share Node (Shortcut Creation) Tests
    # -------------------------------------------------------------------------
    def test_share_node_creates_shortcut(self):
        status, res = self._post_json("/api/share-node", {
            "targetPath": "tech/swe",
            "parentPath": "business",
            "name": "Swe Cross Reference"
        })
        self.assertEqual(status, 200)
        self.assertTrue(res.get("success"))
        self.assertEqual(res.get("shortcutPath"), "business/swe-cross-reference")

        # Verify shortcut.json on disk
        sc_file = self.test_graph_dir / "business" / "swe-cross-reference" / "shortcut.json"
        self.assertTrue(sc_file.exists())
        sc_data = json.loads(sc_file.read_text(encoding="utf-8"))
        self.assertEqual(sc_data.get("target"), "tech/swe")

    def test_share_node_to_self_or_root_rejected(self):
        status, res = self._post_json("/api/share-node", {
            "targetPath": "tech",
            "parentPath": "tech"
        })
        self.assertEqual(status, 400)
        self.assertIn("Cannot create shortcut pointing to the parent station itself", res.get("error", ""))

    # -------------------------------------------------------------------------
    # 4. Station Deletion Tests
    # -------------------------------------------------------------------------
    def test_delete_shortcut_keeps_canonical_safe(self):
        status, res = self._post_json("/api/delete-node", {
            "path": "business/swe-link"
        })
        self.assertEqual(status, 200)
        self.assertTrue(res.get("isShortcut"))
        self.assertFalse((self.test_graph_dir / "business" / "swe-link").exists())
        # Canonical target is untouched
        self.assertTrue((self.test_graph_dir / "tech" / "swe").exists())
        self.assertTrue((self.test_graph_dir / "tech" / "swe" / "info.md").exists())

    def test_delete_canonical_requires_force_when_has_shortcuts_or_files(self):
        # 'tech/swe' has shortcut pointing to it ('business/swe-link')
        status, res = self._post_json("/api/delete-node", {
            "path": "tech/swe",
            "force": False
        })
        self.assertEqual(status, 409)
        self.assertTrue(res.get("requiresForce"))
        self.assertIn("business/swe-link", res.get("referencingShortcuts", []))
        self.assertTrue((self.test_graph_dir / "tech" / "swe").exists())

        # Deleting with force=True removes canonical and cleans up dangling shortcuts
        status, res = self._post_json("/api/delete-node", {
            "path": "tech/swe",
            "force": True
        })
        self.assertEqual(status, 200)
        self.assertFalse((self.test_graph_dir / "tech" / "swe").exists())
        self.assertFalse((self.test_graph_dir / "business" / "swe-link").exists())

    def test_delete_root_rejected(self):
        status, res = self._post_json("/api/delete-node", {
            "path": "",
            "force": True
        })
        self.assertEqual(status, 400)
        self.assertIn("Root station cannot be deleted", res.get("error", ""))


if __name__ == "__main__":
    unittest.main()
