#!/usr/bin/env python3
"""
Career Knowledge Graph Local Server
Powered by Python 3.14
Serves static assets, graph nodes, and enables live disk saves of node notes and statuses.
Supports parent-child status cascading and just-in-time child expansion.
"""

import os
import sys
import json
import socket
import urllib.parse
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import webbrowser
import threading

BASE_DIR = Path(__file__).resolve().parent
GRAPH_DIR = BASE_DIR / "graph"
CATALOG_PATH = BASE_DIR / "data" / "blueprints" / "depth2_catalog.json"


class GraphRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        # Enable CORS for local client-server development
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_json(self, status_code: int, data: dict):
        response_bytes = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def _resolve_graph_folder(self, raw_path: str) -> Path:
        """Resolve a node directory safely inside GRAPH_DIR."""
        cleaned = raw_path.strip("/\\")
        if cleaned.startswith("graph/") or cleaned.startswith("graph\\"):
            cleaned = cleaned[6:]
        elif cleaned == "graph":
            cleaned = ""

        target = (GRAPH_DIR / cleaned).resolve()
        if not target.is_relative_to(GRAPH_DIR.resolve()):
            raise PermissionError("Path traversal attempt detected")
        return target

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. API: Graph Manifest
        if path == "/api/graph" or path == "/api/graph/":
            self._handle_api_get_graph()
            return

        # 2. API: Single Node Data
        if path == "/api/node":
            self._handle_api_get_node(parsed.query)
            return

        # Default static file serving
        super().do_GET()

    def _handle_api_get_graph(self):
        """Recursively scan GRAPH_DIR and return all nodes with metadata and summary flags."""
        manifest = {}

        if not GRAPH_DIR.exists():
            self._send_json(404, {"error": "graph directory does not exist"})
            return

        for root, dirs, files in os.walk(GRAPH_DIR):
            root_path = Path(root)
            node_file = root_path / "node.json"
            if node_file.exists():
                try:
                    with open(node_file, "r", encoding="utf-8") as f:
                        node_data = json.load(f)

                    summary_file = root_path / "summary.md"
                    rel_to_graph = root_path.relative_to(GRAPH_DIR).as_posix()
                    if rel_to_graph == ".":
                        node_id = node_data.get("id", "root")
                    else:
                        node_id = node_data.get("id", rel_to_graph.replace("/", "-"))

                    manifest[node_id] = {
                        "id": node_id,
                        "relPath": rel_to_graph if rel_to_graph != "." else "",
                        "metadata": node_data,
                        "summaryExists": summary_file.exists(),
                        "summaryBytes": summary_file.stat().st_size if summary_file.exists() else 0
                    }
                except Exception as e:
                    print(f"[Error reading node at {root_path}]: {e}", file=sys.stderr)

        self._send_json(200, {
            "status": "ok",
            "root": "root",
            "count": len(manifest),
            "nodes": manifest
        })

    def _handle_api_get_node(self, query_string: str):
        """Fetch node.json and summary.md for a given path or id."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            node_json_path = node_dir / "node.json"
            summary_path = node_dir / "summary.md"

            if not node_json_path.exists():
                self._send_json(404, {"error": f"Node not found at: {node_path_param}"})
                return

            with open(node_json_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)

            summary_content = ""
            if summary_path.exists():
                with open(summary_path, "r", encoding="utf-8") as f:
                    summary_content = f.read()

            rel_path = node_dir.relative_to(GRAPH_DIR).as_posix()
            if rel_path == ".":
                rel_path = ""

            self._send_json(200, {
                "id": metadata.get("id", node_dir.name),
                "relPath": rel_path,
                "metadata": metadata,
                "summary": summary_content
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        try:
            payload = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        if path == "/api/save-summary":
            self._handle_save_summary(payload)
        elif path == "/api/save-status":
            self._handle_save_status(payload)
        elif path == "/api/save-node":
            self._handle_save_node(payload)
        elif path == "/api/add-child":
            self._handle_add_child(payload)
        elif path == "/api/expand-node":
            self._handle_expand_node(payload)
        else:
            self._send_json(404, {"error": "API route not found"})

    def _handle_save_summary(self, payload: dict):
        raw_path = payload.get("path", "")
        content = payload.get("content", "")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_dir.mkdir(parents=True, exist_ok=True)
            summary_path = node_dir / "summary.md"

            with open(summary_path, "w", encoding="utf-8") as f:
                f.write(content)

            print(f"[Summary Saved]: {summary_path} ({len(content)} chars)")
            self._send_json(200, {
                "success": True,
                "message": "summary.md saved to disk",
                "relPath": node_dir.relative_to(GRAPH_DIR).as_posix()
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _cascade_status(self, node_dir: Path):
        """
        Status Cascading Rule:
        - If all children of a parent are 'completed', parent is 'completed'.
        - If not all children are 'completed' and parent was 'completed', parent becomes 'in-progress'.
        Cascades up to ancestors.
        """
        curr = node_dir
        while curr != GRAPH_DIR and curr.parent.is_relative_to(GRAPH_DIR):
            parent_dir = curr.parent
            parent_json_path = parent_dir / "node.json"
            if not parent_json_path.exists():
                break

            try:
                with open(parent_json_path, "r", encoding="utf-8") as f:
                    parent_data = json.load(f)

                children = parent_data.get("children", [])
                if not children:
                    break

                all_completed = True
                any_started = False

                for cid in children:
                    child_json_path = parent_dir / cid / "node.json"
                    if child_json_path.exists():
                        with open(child_json_path, "r", encoding="utf-8") as cf:
                            cdata = json.load(cf)
                        cstatus = cdata.get("status", "todo")
                        if cstatus != "completed":
                            all_completed = False
                        if cstatus in ("in-progress", "completed"):
                            any_started = True
                    else:
                        all_completed = False

                old_status = parent_data.get("status", "todo")
                new_status = old_status

                if all_completed:
                    new_status = "completed"
                elif any_started or old_status == "completed":
                    new_status = "in-progress"

                if new_status != old_status:
                    parent_data["status"] = new_status
                    with open(parent_json_path, "w", encoding="utf-8") as f:
                        json.dump(parent_data, f, indent=2, ensure_ascii=False)
                    print(f"[Cascade]: {parent_json_path} -> {new_status}")

                curr = parent_dir
            except Exception as e:
                print(f"[Cascade Error]: {e}", file=sys.stderr)
                break

    def _handle_save_status(self, payload: dict):
        raw_path = payload.get("path", "")
        status = payload.get("status", "todo")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_json_path = node_dir / "node.json"

            if not node_json_path.exists():
                self._send_json(404, {"error": f"node.json does not exist at {raw_path}"})
                return

            with open(node_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            data["status"] = status

            with open(node_json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f"[Status Saved]: {node_json_path} -> {status}")

            # Trigger cascade up to parent/ancestors
            self._cascade_status(node_dir)

            self._send_json(200, {
                "success": True,
                "message": f"Status updated to '{status}'",
                "nodeId": data.get("id"),
                "status": status
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_save_node(self, payload: dict):
        raw_path = payload.get("path", "")
        updates = payload.get("metadata", {})

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_json_path = node_dir / "node.json"

            if not node_json_path.exists():
                self._send_json(404, {"error": f"node.json does not exist at {raw_path}"})
                return

            with open(node_json_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            data.update(updates)

            with open(node_json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            self._send_json(200, {
                "success": True,
                "message": "node.json updated successfully",
                "data": data
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_add_child(self, payload: dict):
        parent_path = payload.get("parentPath", "")
        child_id = payload.get("childId", "").strip()
        title = payload.get("title", child_id)
        description = payload.get("description", "")
        badge = payload.get("badge", "Module")
        concept = payload.get("concept", "")
        active_recall = payload.get("activeRecall", "")
        summary_content = payload.get("summary", f"# {title}\n\n> Add your notes here.\n")

        if not child_id:
            self._send_json(400, {"error": "childId is required"})
            return

        try:
            parent_dir = self._resolve_graph_folder(parent_path)
            parent_json_path = parent_dir / "node.json"

            if not parent_json_path.exists():
                self._send_json(404, {"error": f"Parent node not found at {parent_path}"})
                return

            with open(parent_json_path, "r", encoding="utf-8") as f:
                parent_data = json.load(f)

            # Rule: Adding child converts parent from completed to in-progress
            if parent_data.get("status") == "completed":
                parent_data["status"] = "in-progress"

            children = parent_data.setdefault("children", [])
            if child_id not in children:
                children.append(child_id)

            with open(parent_json_path, "w", encoding="utf-8") as f:
                json.dump(parent_data, f, indent=2, ensure_ascii=False)

            # Create child directory and files
            child_dir = parent_dir / child_id
            child_dir.mkdir(parents=True, exist_ok=True)

            parent_depth = parent_data.get("depth", 0)
            child_json_data = {
                "id": child_id,
                "title": title,
                "badge": badge,
                "depth": parent_depth + 1,
                "description": description,
                "status": "todo",
                "children": [],
                "resources": [],
                "concept": concept,
                "activeRecall": active_recall
            }

            with open(child_dir / "node.json", "w", encoding="utf-8") as f:
                json.dump(child_json_data, f, indent=2, ensure_ascii=False)

            with open(child_dir / "summary.md", "w", encoding="utf-8") as f:
                f.write(summary_content)

            print(f"[Child Created]: {child_dir} under {parent_path}")
            self._send_json(200, {
                "success": True,
                "message": f"Child node '{child_id}' created under {parent_path}",
                "child": child_json_data,
                "parentStatus": parent_data.get("status")
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_expand_node(self, payload: dict):
        """Expand node children from depth2_catalog.json upon returning to it."""
        raw_path = payload.get("path", "")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_json_path = node_dir / "node.json"

            if not node_json_path.exists():
                self._send_json(404, {"error": f"Node not found at {raw_path}"})
                return

            with open(node_json_path, "r", encoding="utf-8") as f:
                node_data = json.load(f)

            node_id = node_data.get("id", node_dir.name)

            if not CATALOG_PATH.exists():
                self._send_json(404, {"error": "Catalog file not found"})
                return

            with open(CATALOG_PATH, "r", encoding="utf-8") as f:
                catalog = json.load(f)

            track_modules = catalog.get(node_id, [])
            if not track_modules:
                self._send_json(404, {"error": f"No pre-configured modules for track '{node_id}'"})
                return

            # Rule: Adding new children converts parent from completed to in-progress
            node_data["status"] = "in-progress"
            children = node_data.setdefault("children", [])

            created_modules = []
            for item in track_modules:
                mid = item["id"]
                if mid not in children:
                    children.append(mid)

                mod_dir = node_dir / mid
                mod_dir.mkdir(parents=True, exist_ok=True)

                with open(mod_dir / "node.json", "w", encoding="utf-8") as f:
                    json.dump(item["metadata"], f, indent=2, ensure_ascii=False)

                with open(mod_dir / "summary.md", "w", encoding="utf-8") as f:
                    f.write(item["summary"])

                created_modules.append(mid)

            with open(node_json_path, "w", encoding="utf-8") as f:
                json.dump(node_data, f, indent=2, ensure_ascii=False)

            print(f"[Node Expanded]: {node_id} expanded with {len(created_modules)} children")
            self._send_json(200, {
                "success": True,
                "message": f"Expanded {len(created_modules)} child stations under {node_id}",
                "children": created_modules,
                "nodeStatus": "in-progress"
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})


def find_available_port(starting_port=8000, max_attempts=50):
    for port in range(starting_port, starting_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return starting_port


def run_server(port=8000, open_browser=True):
    port = find_available_port(port)
    server_address = ("127.0.0.1", port)
    httpd = HTTPServer(server_address, GraphRequestHandler)

    url = f"http://localhost:{port}"
    print("\n" + "=" * 64)
    print(" ⚡ CAREER KNOWLEDGE GRAPH SERVER (Python 3.14)")
    print("=" * 64)
    print(f" Serving workspace at : {BASE_DIR}")
    print(f" Graph directory      : {GRAPH_DIR}")
    print(f" Local URL            : {url}")
    print("=" * 64)
    print(" Press Ctrl+C in terminal to stop server.\n")

    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server shutting down gracefully...]")
        httpd.server_close()


if __name__ == "__main__":
    should_open = "--no-browser" not in sys.argv
    run_server(port=8000, open_browser=should_open)
