#!/usr/bin/env python3
"""
Career Knowledge Graph Local Server
Powered by Python 3.14
Directory-as-Graph Engine:
- Any subfolder added inside a node folder is automatically a child node.
- Any non-metadata file added inside a node folder is automatically a resource.
- Live disk saves of node info, status cascading, child creation, and file uploads.
"""

import os
import sys
import json
import socket
import base64
import urllib.parse
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import webbrowser
import threading

BASE_DIR = Path(__file__).resolve().parent
GRAPH_DIR = BASE_DIR / "graph"
IGNORED_RESOURCE_FILES = {"node.json", "summary.md", ".DS_Store", "desktop.ini", "Thumbs.db"}


class GraphRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
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
        cleaned = (raw_path or "").strip("/\\").replace("\\", "/")
        if cleaned.startswith("graph/"):
            cleaned = cleaned[6:]
        elif cleaned == "graph":
            cleaned = ""

        if cleaned in ("root", ".", ""):
            return GRAPH_DIR

        target = (GRAPH_DIR / cleaned).resolve()
        if target.is_relative_to(GRAPH_DIR.resolve()) and target.is_dir():
            return target

        # Robust lookup: search by folder name or node.json id
        for p in GRAPH_DIR.rglob("*"):
            if p.is_dir():
                if p.name == cleaned:
                    return p
                nj = p / "node.json"
                if nj.exists():
                    try:
                        with open(nj, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        if data.get("id") == cleaned:
                            return p
                    except Exception:
                        pass

        if target.is_relative_to(GRAPH_DIR.resolve()):
            return target

        raise PermissionError("Path traversal attempt detected")

    def _scan_node_folder(self, folder: Path) -> dict:
        """
        Directory-as-Graph core logic:
        - Any folder added inside folder is a child.
        - Any non-metadata file added inside folder is a resource.
        """
        rel_path = folder.relative_to(GRAPH_DIR).as_posix()
        if rel_path == ".":
            rel_path = ""

        node_file = folder / "node.json"
        metadata = {}
        if node_file.exists():
            try:
                with open(node_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            except Exception as e:
                print(f"[Warning: Failed to read {node_file}]: {e}", file=sys.stderr)

        if rel_path == "":
            node_id = metadata.get("id", "root")
            default_title = "Career & Life Master Graph"
        else:
            node_id = metadata.get("id", folder.name)
            default_title = folder.name.replace("-", " ").replace("_", " ").title()

        title = metadata.get("title", default_title)
        badge = metadata.get("badge", "Station" if rel_path else "Master Graph")
        depth = metadata.get("depth", len(rel_path.split("/")) if rel_path else 0)
        description = metadata.get("description", "")
        status = metadata.get("status", "todo")
        concept = metadata.get("concept", "")
        active_recall = metadata.get("activeRecall", "")

        # 1. Any folder added is a child!
        subdirs = [d for d in folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
        subdirs_by_name = {d.name: d for d in subdirs}

        children = []
        explicit_children = metadata.get("children", [])
        for cname in explicit_children:
            if cname in subdirs_by_name and cname not in children:
                children.append(cname)
        for d in sorted(subdirs, key=lambda x: x.name.lower()):
            if d.name not in children:
                children.append(d.name)

        # 2. Any file in the node folder is a resource!
        file_resources = []
        for f in sorted(folder.iterdir(), key=lambda x: x.name.lower()):
            if f.is_file() and f.name not in IGNORED_RESOURCE_FILES and not f.name.startswith("."):
                rel_to_base = f.relative_to(BASE_DIR).as_posix()
                file_resources.append({
                    "label": f.name,
                    "url": rel_to_base,
                    "type": "file",
                    "size": f.stat().st_size,
                    "ext": f.suffix.lstrip(".").lower()
                })

        # Combine with external link resources from node.json
        json_resources = metadata.get("resources", [])
        existing_urls = {fr["url"] for fr in file_resources}
        combined_resources = list(file_resources)
        for jr in json_resources:
            if isinstance(jr, dict) and jr.get("url") not in existing_urls:
                combined_resources.append({
                    "label": jr.get("label", jr.get("url", "Link")),
                    "url": jr.get("url", "#"),
                    "type": "link"
                })

        summary_file = folder / "summary.md"
        summary_exists = summary_file.exists()
        summary_bytes = summary_file.stat().st_size if summary_exists else 0

        return {
            "id": node_id,
            "folderName": folder.name if rel_path else "root",
            "relPath": rel_path,
            "metadata": {
                "id": node_id,
                "title": title,
                "badge": badge,
                "depth": depth,
                "description": description,
                "status": status,
                "children": children,
                "resources": combined_resources,
                "concept": concept,
                "activeRecall": active_recall
            },
            "summaryExists": summary_exists,
            "summaryBytes": summary_bytes
        }

    def _cascade_status(self, node_dir: Path):
        """Cascades completion status upwards across directory hierarchy."""
        curr = node_dir
        while curr != GRAPH_DIR and curr.parent.is_relative_to(GRAPH_DIR):
            parent_dir = curr.parent
            parent_json_path = parent_dir / "node.json"

            parent_data = {}
            if parent_json_path.exists():
                try:
                    with open(parent_json_path, "r", encoding="utf-8") as f:
                        parent_data = json.load(f)
                except Exception:
                    pass

            subdirs = [d for d in parent_dir.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
            if not subdirs:
                break

            all_completed = True
            any_active = False

            for cd in subdirs:
                cjson = cd / "node.json"
                cstatus = "todo"
                if cjson.exists():
                    try:
                        with open(cjson, "r", encoding="utf-8") as cf:
                            cstatus = json.load(cf).get("status", "todo")
                    except Exception:
                        pass
                if cstatus != "completed":
                    all_completed = False
                if cstatus in ("in-progress", "completed"):
                    any_active = True

            old_status = parent_data.get("status", "todo")
            new_status = old_status

            if all_completed:
                new_status = "completed"
            elif any_active or old_status == "completed":
                new_status = "in-progress"

            if new_status != old_status:
                parent_data["status"] = new_status
                with open(parent_json_path, "w", encoding="utf-8") as f:
                    json.dump(parent_data, f, indent=2, ensure_ascii=False)
                print(f"[Cascade]: {parent_json_path} -> {new_status}")

            curr = parent_dir

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. API: Full Graph Manifest
        if path in ("/api/graph", "/api/graph/"):
            self._handle_api_get_graph()
            return

        # 2. API: Single Node Data
        if path == "/api/node":
            self._handle_api_get_node(parsed.query)
            return

        super().do_GET()

    def _handle_api_get_graph(self):
        """Recursively scan GRAPH_DIR and return all nodes with automatic children and file resources."""
        manifest = {}

        if not GRAPH_DIR.exists():
            self._send_json(404, {"error": "graph directory does not exist"})
            return

        for root, dirs, files in os.walk(GRAPH_DIR):
            root_path = Path(root)
            # Skip hidden/system directories
            if root_path.name.startswith((".", "__")):
                continue

            node_data = self._scan_node_folder(root_path)
            node_id = node_data["id"]
            manifest[node_id] = node_data

            # Also index by relPath if different
            rel_path = node_data["relPath"]
            if rel_path and rel_path != node_id:
                manifest[rel_path] = node_data

        self._send_json(200, {
            "status": "ok",
            "root": "root",
            "count": len(manifest),
            "nodes": manifest
        })

    def _handle_api_get_node(self, query_string: str):
        """Fetch node info, children, resources, and summary.md for a given path or id."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            node_info = self._scan_node_folder(node_dir)

            summary_content = ""
            summary_path = node_dir / "summary.md"
            if summary_path.exists():
                with open(summary_path, "r", encoding="utf-8") as f:
                    summary_content = f.read()

            node_info["summary"] = summary_content
            self._send_json(200, node_info)
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
        elif path == "/api/upload-resource":
            self._handle_upload_resource(payload)
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

            data = {}
            if node_json_path.exists():
                with open(node_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

            data["status"] = status
            with open(node_json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            self._cascade_status(node_dir)
            print(f"[Status Saved]: {node_json_path} -> {status}")

            self._send_json(200, {
                "success": True,
                "message": f"Status updated to '{status}'",
                "node": self._scan_node_folder(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_save_node(self, payload: dict):
        """Update node metadata (title, badge, description, concept, activeRecall, resources, status)."""
        raw_path = payload.get("path", "")
        updates = payload.get("metadata", {})

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_json_path = node_dir / "node.json"

            data = {}
            if node_json_path.exists():
                try:
                    with open(node_json_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except Exception:
                    pass

            old_status = data.get("status", "todo")
            data.update(updates)

            with open(node_json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            if "status" in updates and updates["status"] != old_status:
                self._cascade_status(node_dir)

            print(f"[Node Saved]: {node_json_path}")
            self._send_json(200, {
                "success": True,
                "message": "Station info updated successfully",
                "node": self._scan_node_folder(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_add_child(self, payload: dict):
        """Create child folder under parent folder with starter node.json and summary.md."""
        parent_path = payload.get("parentPath", "")
        child_id = payload.get("childId", "").strip()
        title = payload.get("title", child_id).strip()
        badge = payload.get("badge", "Module").strip()
        description = payload.get("description", "").strip()
        concept = payload.get("concept", "").strip()
        active_recall = payload.get("activeRecall", "").strip()
        resources = payload.get("resources", [])
        summary_content = payload.get("summary", f"# {title}\n\n> Add your notes, code snippets, and key formulas here.\n")

        if not child_id:
            child_id = "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-")

        safe_child_id = "".join(c for c in child_id if c.isalnum() or c in ("-", "_")).strip("-")
        if not safe_child_id:
            self._send_json(400, {"error": "childId must contain alphanumeric characters"})
            return

        try:
            parent_dir = self._resolve_graph_folder(parent_path)
            if not parent_dir.exists():
                self._send_json(404, {"error": f"Parent node folder not found at {parent_path}"})
                return

            child_dir = parent_dir / safe_child_id
            child_dir.mkdir(parents=True, exist_ok=True)

            parent_json_path = parent_dir / "node.json"
            parent_depth = 0
            if parent_json_path.exists():
                try:
                    with open(parent_json_path, "r", encoding="utf-8") as f:
                        pdata = json.load(f)
                    parent_depth = pdata.get("depth", 0)
                    children = pdata.setdefault("children", [])
                    if safe_child_id not in children:
                        children.append(safe_child_id)
                    if pdata.get("status") == "completed":
                        pdata["status"] = "in-progress"
                    with open(parent_json_path, "w", encoding="utf-8") as f:
                        json.dump(pdata, f, indent=2, ensure_ascii=False)
                except Exception as e:
                    print(f"[Warning updating parent node.json]: {e}", file=sys.stderr)

            child_json_data = {
                "id": safe_child_id,
                "title": title or safe_child_id,
                "badge": badge or "Module",
                "depth": parent_depth + 1,
                "description": description,
                "status": "todo",
                "children": [],
                "resources": resources,
                "concept": concept,
                "activeRecall": active_recall
            }

            with open(child_dir / "node.json", "w", encoding="utf-8") as f:
                json.dump(child_json_data, f, indent=2, ensure_ascii=False)

            summary_file = child_dir / "summary.md"
            if not summary_file.exists():
                with open(summary_file, "w", encoding="utf-8") as f:
                    f.write(summary_content)

            self._cascade_status(parent_dir)

            print(f"[Child Created]: {child_dir} under {parent_path}")
            self._send_json(200, {
                "success": True,
                "message": f"Child folder '{safe_child_id}' created",
                "child": self._scan_node_folder(child_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_upload_resource(self, payload: dict):
        """Save an uploaded file directly into the node's folder on disk."""
        raw_path = payload.get("path", "")
        filename = payload.get("filename", "").strip()
        b64_content = payload.get("content", "")

        if not filename:
            self._send_json(400, {"error": "filename is required"})
            return

        safe_filename = Path(filename).name
        if not safe_filename or safe_filename in IGNORED_RESOURCE_FILES:
            self._send_json(400, {"error": "Invalid or protected filename"})
            return

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            target_file = node_dir / safe_filename

            if "," in b64_content:
                b64_content = b64_content.split(",", 1)[1]

            file_bytes = base64.b64decode(b64_content)
            with open(target_file, "wb") as f:
                f.write(file_bytes)

            rel_to_base = target_file.relative_to(BASE_DIR).as_posix()
            print(f"[Resource Uploaded]: {target_file} ({len(file_bytes)} bytes)")
            self._send_json(200, {
                "success": True,
                "message": f"File '{safe_filename}' saved as resource",
                "resource": {
                    "label": safe_filename,
                    "url": rel_to_base,
                    "type": "file",
                    "size": len(file_bytes),
                    "ext": target_file.suffix.lstrip(".").lower()
                }
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
    print(" [+] CAREER KNOWLEDGE GRAPH SERVER (Python 3.14)")
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
