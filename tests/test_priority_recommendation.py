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

        cls.port = find_available_port(9260)
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

    def _post(self, path: str, payload: dict) -> tuple[int, dict]:
        url = f"{self.base_url}{path}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.getcode(), json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def _get(self, path: str) -> tuple[int, dict]:
        url = f"{self.base_url}{path}"
        try:
            with urllib.request.urlopen(url) as resp:
                return resp.getcode(), json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

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

        # Check candidate pool
        pool = data["pool"]
        self.assertEqual(len(pool), 6)
        self.assertEqual(data["poolCounts"]["high"], 3)
        self.assertEqual(data["poolCounts"]["normal"], 2)
        self.assertEqual(data["poolCounts"]["low"], 1)

        # Pool items verification: Interleaved 3H+2N+1L cadence: [H1, N1, L1, H2, N2, H3]
        pool_ids = [n["id"] for n in pool]
        self.assertEqual(pool_ids, ["high_1", "normal_1", "low_1", "high_2", "normal_2", "high_3"])

        # Test step cadence: High -> Normal -> Low -> High -> Normal -> High
        expected_cadence = [
            (0, "high", "high_1"),
            (1, "normal", "normal_1"),
            (2, "low", "low_1"),
            (3, "high", "high_2"),
            (4, "normal", "normal_2"),
            (5, "high", "high_3"),
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
        1. Recommendation queue is persisted to .recommendation_queue.json in root folder.
        2. Submitting requests repeatedly (simulating dashboard reload or server restart) preserves the active batch without refilling.
        3. Only when all stations in the active batch are completed does it refill a new batch.
        """
        persist_dir = self.test_graph_dir / "persistence_test"
        persist_dir.mkdir(parents=True, exist_ok=True)
        (persist_dir / "info.md").write_text("# Persistence Test\n\n**Status:** completed\n", encoding="utf-8")

        # Create 6 High nodes (H1..H6) and 4 Normal nodes (N1..N4)
        for i in range(1, 7):
            d = persist_dir / f"phigh_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# PHigh {i}\n\n**Status:** todo\n**Priority:** high\n", encoding="utf-8")

        for i in range(1, 5):
            d = persist_dir / f"pnorm_{i}"
            d.mkdir(parents=True, exist_ok=True)
            (d / "info.md").write_text(f"# PNorm {i}\n\n**Status:** todo\n**Priority:** normal\n", encoding="utf-8")

        # 1. First fetch creates batch
        p_path = urllib.parse.quote("persistence_test")
        _, data1 = self._get(f"/api/next-node?path={p_path}&step=0")
        self.assertTrue(data1["found"])
        first_batch_ids = [n["id"] for n in data1["pool"]]
        self.assertEqual(len(first_batch_ids), 5)  # 3 High + 2 Normal (0 Low)

        # 2. Check that .recommendation_queue.json was created on disk in root folder
        queue_file = self.test_graph_dir / ".recommendation_queue.json"
        self.assertTrue(queue_file.exists())

        # 3. Subsequent query (simulating page reload) preserves the EXACT same batch
        _, data2 = self._get(f"/api/next-node?path={p_path}&step=1")
        self.assertTrue(data2.get("isPersistedBatch"))
        second_batch_ids = [n["id"] for n in data2["pool"]]
        self.assertEqual(second_batch_ids, first_batch_ids)

        # 4. Complete phigh_1: batch should keep remaining 4 stations and NOT refill H4 or N3 yet!
        (persist_dir / "phigh_1" / "info.md").write_text("# PHigh 1\n\n**Status:** completed\n**Priority:** high\n", encoding="utf-8")
        _, data3 = self._get(f"/api/next-node?path={p_path}&step=1")
        remaining_ids = [n["id"] for n in data3["pool"]]
        self.assertNotIn("phigh_1", remaining_ids)
        self.assertNotIn("phigh_4", remaining_ids)  # Must NOT refill prematurely!
        self.assertEqual(len(remaining_ids), 4)

        # 5. Complete all remaining stations in the first batch
        for bid in remaining_ids:
            (persist_dir / bid / "info.md").write_text(f"# {bid}\n\n**Status:** completed\n", encoding="utf-8")

        # 6. Now that the first batch is fully completed, query MUST refill a fresh batch!
        _, data4 = self._get(f"/api/next-node?path={p_path}&step=0")
        self.assertTrue(data4["found"])
        refilled_ids = [n["id"] for n in data4["pool"]]
        # Refilled batch should now draw the next uncompleted nodes (phigh_4..6, pnorm_3..4)
        self.assertIn("phigh_4", refilled_ids)
        self.assertIn("pnorm_3", refilled_ids)

    def test_ui_markup_and_css_priority_support(self):
        html = (BASE_DIR / "web" / "index.html").read_text(encoding="utf-8")
        css = (BASE_DIR / "web" / "style.css").read_text(encoding="utf-8")
        js = (BASE_DIR / "web" / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="next-node-priority"', html)
        self.assertIn('id="md-modal-priority"', html)

        self.assertIn(".next-node-priority-badge", css)
        self.assertIn(".badge-priority", css)
        self.assertIn(".child-priority-badge", css)
        self.assertIn("priority-high", css)
        self.assertIn("priority-normal", css)
        self.assertIn("priority-low", css)

        self.assertIn("next-node-priority-badge", js)
        self.assertIn("child-priority-badge", js)
        self.assertIn("poolCounts", js)


if __name__ == "__main__":
    unittest.main()
