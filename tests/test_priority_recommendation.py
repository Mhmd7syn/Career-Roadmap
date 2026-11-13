#!/usr/bin/env python3
"""
Unit and integration tests for Priority-Weighted Node Recommendation Engine (Issue #12).
"""

import os
import re
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

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import server
from server import GraphRequestHandler, find_available_port


class TestPriorityRecommendation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = tempfile.mkdtemp(prefix="kg_test_priority_")
        cls.test_graph_dir = Path(cls.test_dir) / "graph"
        cls.test_graph_dir.mkdir(parents=True, exist_ok=True)

        cls.orig_graph_dir = server.GRAPH_DIR
        server.GRAPH_DIR = cls.test_graph_dir

        cls.httpd = None
        cls.use_http = False
        try:
            cls.port = find_available_port(9260)
            cls.httpd = HTTPServer(("127.0.0.1", cls.port), GraphRequestHandler)
            cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
            cls.server_thread.start()
            cls.base_url = f"http://127.0.0.1:{cls.port}"
            cls.use_http = True
        except (PermissionError, OSError):
            cls.httpd = None
            cls.use_http = False

    @classmethod
    def tearDownClass(cls):
        if cls.httpd:
            try:
                cls.httpd.shutdown()
                cls.httpd.server_close()
            except Exception:
                pass
        server.GRAPH_DIR = cls.orig_graph_dir
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _invoke_handler(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
        import io
        handler = GraphRequestHandler.__new__(GraphRequestHandler)
        handler.command = method
        handler.path = path
        handler.headers = {"Content-Type": "application/json"}
        body_bytes = json.dumps(payload).encode("utf-8") if payload else b""
        handler.rfile = io.BytesIO(body_bytes)
        handler.wfile = io.BytesIO()
        handler.headers["Content-Length"] = str(len(body_bytes))

        status_code = [200]
        def mock_send_response(code, message=None):
            status_code[0] = code
        handler.send_response = mock_send_response
        handler.send_header = lambda k, v: None
        handler.end_headers = lambda: None

        if method == "GET":
            handler.do_GET()
        elif method == "POST":
            handler.do_POST()

        raw_output = handler.wfile.getvalue().decode("utf-8")
        try:
            body = json.loads(raw_output) if raw_output.strip() else {}
        except Exception:
            body = {"raw": raw_output}
        return status_code[0], body

    def _post(self, path: str, payload: dict) -> tuple[int, dict]:
        if getattr(self, "use_http", False):
            url = f"{self.base_url}{path}"
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(req) as resp:
                    return resp.getcode(), json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read().decode("utf-8"))
            except urllib.error.URLError:
                self.use_http = False
        return self._invoke_handler("POST", path, payload)

    def _get(self, path: str) -> tuple[int, dict]:
        if getattr(self, "use_http", False):
            url = f"{self.base_url}{path}"
            try:
                with urllib.request.urlopen(url) as resp:
                    raw = resp.read().decode("utf-8")
                    return resp.getcode(), (json.loads(raw) if raw.strip() else {})
            except urllib.error.HTTPError as e:
                raw = e.read().decode("utf-8")
                return e.code, (json.loads(raw) if raw.strip() else {})
            except urllib.error.URLError:
                self.use_http = False
        return self._invoke_handler("GET", path)

    def test_parse_info_md_priority_extraction(self):
        handler = GraphRequestHandler.__new__(GraphRequestHandler)

        # 1. Missing priority defaults to normal
        p1 = self.test_graph_dir / "station_default"
        p1.mkdir(parents=True, exist_ok=True)
        (p1 / "info.md").write_text("# Station Default\n\n**Status:** todo\n", encoding="utf-8")
        title, badge, status, priority = handler._parse_info_md(p1 / "info.md", "Station Default")
        self.assertEqual(priority, "normal")

        # 2. Explicit high priority
        p2 = self.test_graph_dir / "station_high"
        p2.mkdir(parents=True, exist_ok=True)
        (p2 / "info.md").write_text("# Station High\n\n**Status:** todo\n**Priority:** high\n", encoding="utf-8")
        _, _, _, priority = handler._parse_info_md(p2 / "info.md", "Station High")
        self.assertEqual(priority, "high")

        # 3. Explicit low priority with lowercase header
        p3 = self.test_graph_dir / "station_low"
        p3.mkdir(parents=True, exist_ok=True)
        (p3 / "info.md").write_text("# Station Low\n\nstatus: todo\npriority: low\n", encoding="utf-8")
        _, _, _, priority = handler._parse_info_md(p3 / "info.md", "Station Low")
        self.assertEqual(priority, "low")

        # 4. Invalid priority defaults to normal
        p4 = self.test_graph_dir / "station_invalid"
        p4.mkdir(parents=True, exist_ok=True)
        (p4 / "info.md").write_text("# Station Invalid\n\n**Priority:** super-urgent\n", encoding="utf-8")
        _, _, _, priority = handler._parse_info_md(p4 / "info.md", "Station Invalid")
        self.assertEqual(priority, "normal")

    def test_save_priority_endpoint_and_persistence(self):
        st = self.test_graph_dir / "track" / "node_a"
        st.mkdir(parents=True, exist_ok=True)
        (st / "info.md").write_text("# Node A\n\n**Status:** todo\n", encoding="utf-8")

        status, body = self._post("/api/save-priority", {"path": "track/node_a", "priority": "high"})
        self.assertEqual(status, 200)
        self.assertTrue(body.get("success"))
        self.assertEqual(body["node"]["priority"], "high")

        # Verify on disk
        content = (st / "info.md").read_text(encoding="utf-8")
        self.assertIn("**Priority:** high", content)

    def test_save_info_with_priority_payload(self):
        st = self.test_graph_dir / "track" / "node_b"
        st.mkdir(parents=True, exist_ok=True)

        status, body = self._post("/api/save-info", {
            "path": "track/node_b",
            "content": "# Node B\n\n**Status:** todo\n",
            "priority": "low"
        })
        self.assertEqual(status, 200)
        self.assertEqual(body["node"]["priority"], "low")

        content = (st / "info.md").read_text(encoding="utf-8")
        self.assertIn("**Priority:** low", content)

    def test_priority_weighted_recommendation_distribution(self):
        """
        Verify the 3 High, 2 Normal, 1 Low quota distribution:
        Create:
        - 4 High stations (H1, H2, H3, H4)
        - 3 Normal stations (N1, N2, N3)
        - 2 Low stations (L1, L2)
        Expected active recommendation pool:
        [H1, H2, H3, N1, N2, L1] (6 total candidates)
        Primary recommendation: H1
        """
        sandbox = self.test_graph_dir / "quota_test"
        sandbox.mkdir(parents=True, exist_ok=True)
        (sandbox / "info.md").write_text("# Quota Test\n\n**Status:** completed\n", encoding="utf-8")

        # Create High nodes
        for i in range(1, 5):
            d = sandbox / f"high_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# High {i}\n\n**Status:** todo\n**Priority:** high\n", encoding="utf-8")

        # Create Normal nodes
        for i in range(1, 4):
            d = sandbox / f"normal_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# Normal {i}\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        # Create Low nodes
        for i in range(1, 3):
            d = sandbox / f"low_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# Low {i}\n\n**Status:** todo\n**Priority:** low\n", encoding="utf-8")

        status, data = self._get(f"/api/next-node?path={urllib.parse.quote('quota_test')}")
        self.assertEqual(status, 200)
        self.assertTrue(data.get("found"))

        # Check recommended node is High
        rec = data["node"]
        self.assertEqual(rec["priority"], "high")
        self.assertEqual(rec["id"], "high_1")

        # Candidate counts
        self.assertEqual(data["poolCounts"]["high"], 4)
        self.assertEqual(data["poolCounts"]["normal"], 3)
        self.assertEqual(data["poolCounts"]["low"], 2)
        self.assertEqual(data["totalCandidates"], 9)

        # Test step cadence: High -> Normal -> Low -> High -> Normal -> High
        expected_cadence = [
            (0, "high", "high_1"),
            (1, "normal", "normal_1"),
            (2, "low", "low_1"),
            (3, "high", "high_1"),
            (4, "normal", "normal_1"),
            (5, "high", "high_1"),
            (6, "high", "high_1")  # wraps back to step 0
        ]
        for step, exp_prio, exp_id in expected_cadence:
            with self.subTest(step=step):
                _, sdata = self._get(f"/api/next-node?path={urllib.parse.quote('quota_test')}&step={step}")
                self.assertEqual(sdata["node"]["priority"], exp_prio)
                self.assertEqual(sdata["node"]["id"], exp_id)

    def test_recommendation_graceful_fallbacks(self):
        """When high-priority nodes are completed/absent, engine falls back to normal then low."""
        fb_dir = self.test_graph_dir / "fallback_test"
        fb_dir.mkdir(parents=True, exist_ok=True)
        (fb_dir / "info.md").write_text("# Fallback Test\n\n**Status:** completed\n", encoding="utf-8")

        # Only Normal and Low nodes exist
        d_norm = fb_dir / "norm_only"
        d_norm.mkdir(parents=True, exist_ok=True)
        (d_norm / "info.md").write_text("# Norm Only\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        d_low = fb_dir / "low_only"
        d_low.mkdir(parents=True, exist_ok=True)
        (d_low / "info.md").write_text("# Low Only\n\n**Status:** todo\n**Priority:** low\n", encoding="utf-8")

        status, data = self._get(f"/api/next-node?path={urllib.parse.quote('fallback_test')}")
        self.assertEqual(status, 200)
        self.assertTrue(data.get("found"))
        self.assertEqual(data["node"]["priority"], "normal")
        self.assertEqual(data["node"]["id"], "norm_only")

        # Complete the normal node -> should fallback to low
        (d_norm / "info.md").write_text("# Norm Only\n\n**Status:** completed\n**Priority:** normal\n", encoding="utf-8")
        status, data2 = self._get(f"/api/next-node?path={urllib.parse.quote('fallback_test')}")
        self.assertEqual(status, 200)
        self.assertTrue(data2.get("found"))
        self.assertEqual(data2["node"]["priority"], "low")
        self.assertEqual(data2["node"]["id"], "low_only")

        # Complete the low node -> all completed
        (d_low / "info.md").write_text("# Low Only\n\n**Status:** completed\n**Priority:** low\n", encoding="utf-8")
        status, data3 = self._get(f"/api/next-node?path={urllib.parse.quote('fallback_test')}")
        self.assertEqual(status, 200)
        self.assertFalse(data3.get("found"))
        self.assertTrue(data3.get("allCompleted"))

    def test_queue_persistence_across_restarts_and_batch_depletion(self):
        """
        Verify:
        1. Minimal queue (pattern and current_index) is persisted to .recommendation_queue.json outside graph folder.
        2. Advancing index on matching priority completion.
        3. Discarding index change on non-matching priority completion.
        """
        persist_dir = self.test_graph_dir / "persistence_test"
        persist_dir.mkdir(parents=True, exist_ok=True)
        (persist_dir / "info.md").write_text("# Persistence Test\n\n**Status:** completed\n", encoding="utf-8")

        for i in range(1, 4):
            d = persist_dir / f"phigh_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# PHigh {i}\n\n**Status:** todo\n**Priority:** high\n", encoding="utf-8")

        for i in range(1, 3):
            d = persist_dir / f"pnorm_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# PNorm {i}\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        # 1. First fetch finds high_1 at step 0
        p_path = urllib.parse.quote("persistence_test")
        _, data1 = self._get(f"/api/next-node?path={p_path}")
        self.assertTrue(data1["found"])
        self.assertEqual(data1["node"]["id"], "phigh_1")
        self.assertEqual(data1["cycleStep"], 0)

        # 2. Check that .recommendation_queue.json is saved OUTSIDE graph folder
        queue_file = self.test_graph_dir.parent / ".recommendation_queue.json"
        self.assertTrue(queue_file.exists())
        with open(queue_file, "r", encoding="utf-8") as f:
            q_state = json.load(f)
        self.assertIn("pattern", q_state)
        self.assertIn("current_index", q_state)
        self.assertNotIn("queues", q_state)
        self.assertNotIn("slots", q_state)

        # 3. Complete phigh_1 (matching priority 'high' for index 0) -> advances index to 1 (normal)
        self._post("/api/save-status", {"path": "persistence_test/phigh_1", "status": "completed"})
        with open(queue_file, "r", encoding="utf-8") as f:
            q_state2 = json.load(f)
        self.assertEqual(q_state2["current_index"], 1)

        # Next query now seeks normal node at index 1 -> recommends pnorm_1
        _, data2 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(data2["node"]["id"], "pnorm_1")
        self.assertEqual(data2["cycleStep"], 1)

        # 4. Out-of-order completion: complete phigh_2 while current needed index is 1 (normal)
        # Priority does NOT match needed priority 'normal' -> change must be discarded!
        self._post("/api/save-status", {"path": "persistence_test/phigh_2", "status": "completed"})
        with open(queue_file, "r", encoding="utf-8") as f:
            q_state3 = json.load(f)
        self.assertEqual(q_state3["current_index"], 1)  # Index kept at 1, not corrupted!

    def test_opening_new_node_retries_process_without_mutating_global_index(self):
        """
        Verify:
        When opening a new node, recommendation retries the selection process fresh from current_index:
        1. Evaluates candidates under the opened node.
        2. Falls back to next priority if needed priority is absent under this node.
        3. Never mutates or advances the global current_index on read queries.
        4. Navigating back or to another node retries fresh from the unmodified global current_index.
        """
        base = self.test_graph_dir / "retry_scope_test"
        base.mkdir(parents=True, exist_ok=True)
        (base / "info.md").write_text("# Retry Test\n\n**Status:** completed\n", encoding="utf-8")

        # Root has High node
        h_dir = base / "high_station"
        h_dir.mkdir(parents=True, exist_ok=True)
        (h_dir / "info.md").write_text("# High Station\n\n**Status:** todo\n**Priority:** high\n", encoding="utf-8")

        # Sub-folder only has Normal nodes (no High nodes)
        sub_dir = base / "normal_only_folder"
        sub_dir.mkdir(parents=True, exist_ok=True)
        (sub_dir / "info.md").write_text("# Normal Only Folder\n\n**Status:** completed\n", encoding="utf-8")

        n_dir = sub_dir / "norm_child"
        n_dir.mkdir(parents=True, exist_ok=True)
        (n_dir / "info.md").write_text("# Norm Child\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        # Reset queue to current_index = 0
        handler = GraphRequestHandler.__new__(GraphRequestHandler)
        handler._save_recommendation_queue({"pattern": ["high", "normal", "low", "high", "normal", "high"], "current_index": 0})

        # 1. At root: current_index is 0 (high), high_station is available -> recommends high_station
        p_root = urllib.parse.quote("retry_scope_test")
        _, r_data = self._get(f"/api/next-node?path={p_root}")
        self.assertEqual(r_data["node"]["id"], "high_station")
        self.assertEqual(r_data["node"]["priority"], "high")

        # 2. Open normal_only_folder: retries process under normal_only_folder.
        # High is absent under normal_only_folder -> retries next priority in-memory and finds norm_child.
        p_sub = urllib.parse.quote("retry_scope_test/normal_only_folder")
        _, sub_data = self._get(f"/api/next-node?path={p_sub}")
        self.assertEqual(sub_data["node"]["id"], "norm_child")
        self.assertEqual(sub_data["node"]["priority"], "normal")

        # 3. Global queue file was NOT mutated: current_index is STILL 0!
        q_state = handler._load_recommendation_queue()
        self.assertEqual(q_state["current_index"], 0)

        # 4. Opening root again retries fresh from current_index = 0 -> recommends high_station again!
        _, r_data2 = self._get(f"/api/next-node?path={p_root}")
        self.assertEqual(r_data2["node"]["id"], "high_station")
        self.assertEqual(r_data2["node"]["priority"], "high")

    def test_queue_refreshed_after_priority_edit(self):
        """
        Verify:
        When a node's priority is edited via /api/save-priority,
        next recommendation dynamically finds the newly prioritized node without stale cache.
        """
        sandbox = self.test_graph_dir / "refresh_prio_test"
        sandbox.mkdir(parents=True, exist_ok=True)
        (sandbox / "info.md").write_text("# Refresh Prio Test\n\n**Status:** completed\n", encoding="utf-8")

        n1 = sandbox / "node_alpha"
        n1.mkdir(parents=True, exist_ok=True)
        (n1 / "info.md").write_text("# Node Alpha\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        n2 = sandbox / "node_beta"
        n2.mkdir(parents=True, exist_ok=True)
        (n2 / "info.md").write_text("# Node Beta\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        p_path = urllib.parse.quote("refresh_prio_test")
        _, init_data = self._get(f"/api/next-node?path={p_path}&step=1")
        self.assertEqual(init_data["node"]["id"], "node_alpha")

        # Promote node_beta to high priority
        status, save_res = self._post("/api/save-priority", {
            "path": "refresh_prio_test/node_beta",
            "priority": "high"
        })
        self.assertEqual(status, 200)

        # Next recommendation at high step must immediately recommend node_beta
        _, next_data = self._get(f"/api/next-node?path={p_path}&step=0")
        self.assertEqual(next_data["node"]["id"], "node_beta")
        self.assertEqual(next_data["node"]["priority"], "high")
        self.assertEqual(next_data["cycleSlot"], "high")

    def test_queue_refreshed_after_adding_new_node(self):
        """
        Verify:
        Adding a new child station via /api/add-child is immediately discovered dynamically.
        """
        sandbox = self.test_graph_dir / "refresh_add_test"
        sandbox.mkdir(parents=True, exist_ok=True)
        (sandbox / "info.md").write_text("# Refresh Add Test\n\n**Status:** completed\n", encoding="utf-8")

        p_path = urllib.parse.quote("refresh_add_test")
        _, init_data = self._get(f"/api/next-node?path={p_path}")
        self.assertTrue(init_data.get("allCompleted"))

        # Add child node
        status, add_res = self._post("/api/add-child", {
            "parentPath": "refresh_add_test",
            "name": "New Station"
        })
        self.assertEqual(status, 200)

        # Recommendation immediately finds new station
        _, next_data = self._get(f"/api/next-node?path={p_path}")
        self.assertTrue(next_data.get("found"))
        self.assertEqual(next_data["node"]["id"], "new-station")

    def test_cadence_last_completed_and_next_slot_tracking(self):
        """
        Verify the progression of last_completed and next_slot:
        high -> normal -> low -> high -> normal -> high.
        """
        sandbox = self.test_graph_dir / "cadence_test"
        sandbox.mkdir(parents=True, exist_ok=True)
        (sandbox / "info.md").write_text("# Cadence Test\n\n**Status:** completed\n", encoding="utf-8")

        # 3 High, 2 Normal, 1 Low
        for i in (1, 2, 3):
            d = sandbox / f"h_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# H {i}\n\n**Status:** todo\n**Priority:** high\n", encoding="utf-8")

        for i in (1, 2):
            d = sandbox / f"n_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# N {i}\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        d_low = sandbox / "l_1"
        d_low.mkdir(parents=True, exist_ok=True)
        (d_low / "info.md").write_text("# L 1\n\n**Status:** todo\n**Priority:** low\n", encoding="utf-8")

        p_path = urllib.parse.quote("cadence_test")

        # 1. Initially at step 0 (target: high)
        _, d0 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(d0["cycleSlot"], "high")
        self.assertEqual(d0["node"]["id"], "h_1")

        # 2. Complete h_1 -> last_completed is 'high', next is 'normal'
        self._post("/api/save-status", {"path": "cadence_test/h_1", "status": "completed"})
        _, d1 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(d1["lastCompletedSlot"], "high")
        self.assertEqual(d1["cycleSlot"], "normal")
        self.assertEqual(d1["node"]["id"], "n_1")

        # 3. Complete n_1 -> last_completed is 'normal', next is 'low'
        self._post("/api/save-status", {"path": "cadence_test/n_1", "status": "completed"})
        _, d2 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(d2["lastCompletedSlot"], "normal")
        self.assertEqual(d2["cycleSlot"], "low")
        self.assertEqual(d2["node"]["id"], "l_1")

        # 4. Complete l_1 -> last_completed is 'low', next is 'high'
        self._post("/api/save-status", {"path": "cadence_test/l_1", "status": "completed"})
        _, d3 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(d3["lastCompletedSlot"], "low")
        self.assertEqual(d3["cycleSlot"], "high")
        self.assertEqual(d3["node"]["id"], "h_2")

        # 5. Complete h_2 -> last_completed is 'high', next is 'normal'
        self._post("/api/save-status", {"path": "cadence_test/h_2", "status": "completed"})
        _, d4 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(d4["lastCompletedSlot"], "high")
        self.assertEqual(d4["cycleSlot"], "normal")
        self.assertEqual(d4["node"]["id"], "n_2")

        # 6. Complete n_2 -> last_completed is 'normal', next is 'high'
        self._post("/api/save-status", {"path": "cadence_test/n_2", "status": "completed"})
        _, d5 = self._get(f"/api/next-node?path={p_path}")
        self.assertEqual(d5["lastCompletedSlot"], "normal")
        self.assertEqual(d5["cycleSlot"], "high")
        self.assertEqual(d5["node"]["id"], "h_3")

        # 7. Complete h_3 -> all completed
        self._post("/api/save-status", {"path": "cadence_test/h_3", "status": "completed"})
        _, d6 = self._get(f"/api/next-node?path={p_path}")
        self.assertTrue(d6.get("allCompleted"))
        self.assertEqual(d6["lastCompletedSlot"], "high")
        self.assertEqual(d6["nextSlot"], "normal")

    def test_ui_markup_and_css_priority_support(self):
        html = (BASE_DIR / "web" / "index.html").read_text(encoding="utf-8")
        css = (BASE_DIR / "web" / "style.css").read_text(encoding="utf-8")
        js = (BASE_DIR / "web" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="next-node-pill"', html)
        self.assertIn('id="next-node-title"', html)
        self.assertIn('id="md-modal-priority"', html)

        self.assertIn(".next-node-priority-badge", css)
        self.assertIn(".badge-priority", css)
        self.assertIn(".child-priority-badge", css)
        self.assertIn(".btn-priority-cycle", css)
        self.assertIn("priority-high", css)
        self.assertIn("priority-normal", css)
        self.assertIn("priority-low", css)

        self.assertIn("next-node-pill", js)
        self.assertIn("child-priority-badge", js)
        self.assertIn("btn-priority-toggle", js)
        self.assertIn("setNodePriority", js)

    def test_favicon_endpoint(self):
        code, _ = self._get("/favicon.ico")
        self.assertEqual(code, 204)


if __name__ == "__main__":
    unittest.main()
