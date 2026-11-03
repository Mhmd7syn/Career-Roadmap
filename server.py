#!/usr/bin/env python3
"""
Career Knowledge Graph Local Server
Powered by Python 3.14
Serves static assets, graph nodes, and enables live disk saves of node notes and statuses.
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
        # Strip leading/trailing slashes and any graph/ prefix
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

        # Walk all directories inside graph
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
