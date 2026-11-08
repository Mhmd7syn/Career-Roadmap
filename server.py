#!/usr/bin/env python3
"""
Career Knowledge Graph Local Server
Powered by Python 3.14
Optimized Lazy-Loading Directory-as-Graph Engine:
- Only loads data for the currently viewed node on demand to decrease computation.
- Each station folder has strictly TWO files:
    1. info.md   : Station description, mental models, recall, links
    2. notes.md  : Personal summary of what was learned
- Any other file in the folder is an "extra file" (PDF, images, code, cheatsheets).
- Any subfolder in the folder is a child station.
- Child creation is a simple '+' button that prompts only for the station name.
"""

import os
import re
import sys
import json
import socket
import base64
import shutil
import urllib.parse
from pathlib import Path
from collections import deque
from http.server import HTTPServer, SimpleHTTPRequestHandler
import webbrowser
import threading

BASE_DIR = Path(__file__).resolve().parent
GRAPH_DIR = Path(os.getenv("GRAPH_DIR", BASE_DIR / "graph")).resolve()
TEMPLATE_DIR = BASE_DIR / "graph.template"
CORE_NODE_FILES = {"info.md", "notes.md"}
IGNORED_SYSTEM_FILES = {".DS_Store", "desktop.ini", "Thumbs.db"}


def ensure_graph_initialized():
    """Ensure GRAPH_DIR exists and populate from TEMPLATE_DIR if empty."""
    GRAPH_DIR.mkdir(parents=True, exist_ok=True)
    has_content = any(p for p in GRAPH_DIR.iterdir() if not p.name.startswith((".", "__")))
    if not has_content and TEMPLATE_DIR.exists() and TEMPLATE_DIR.is_dir():
        print(f"[Init] Initializing graph data from template: {TEMPLATE_DIR}")
        for item in TEMPLATE_DIR.iterdir():
            dest = GRAPH_DIR / item.name
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest)


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

        # Lookup by directory name
        for p in GRAPH_DIR.rglob("*"):
            if p.is_dir() and p.name == cleaned:
                return p

        if target.is_relative_to(GRAPH_DIR.resolve()):
            return target

        raise PermissionError("Path traversal attempt detected")

    def _parse_info_md(self, info_path: Path, default_title: str) -> tuple[str, str, str]:
        """Extract title, badge, and status from info.md."""
        title = default_title
        badge = ""
        status = "todo"

        if not info_path.exists():
            return title, badge, status

        try:
            with open(info_path, "r", encoding="utf-8") as f:
                content = f.read()

            lines = content.splitlines()

            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue

                if stripped.startswith("# ") and title == default_title:
                    title = stripped[2:].strip()
                    continue

                if "status" in stripped.lower():
                    m_stat = re.search(r"status[:\*]+\s*([a-zA-Z0-9_\-]+)", stripped, re.IGNORECASE)
                    if m_stat:
                        status = m_stat.group(1).lower()

                if "badge" in stripped.lower():
                    m_badge = re.search(r"badge[:\*]+\s*([^|\n*]+)", stripped, re.IGNORECASE)
                    if m_badge:
                        badge = m_badge.group(1).strip()

            return title, badge, status
        except Exception as e:
            print(f"[Warning parsing {info_path}]: {e}", file=sys.stderr)
            return default_title, badge, status

    def _scan_single_node(self, folder: Path) -> dict:
        """
        Lightweight, non-recursive node scanner:
        Only scans the requested directory and its immediate child folder headers.
        Decreases computation to O(1) folder reads per navigation.
        """
        rel_path = folder.relative_to(GRAPH_DIR).as_posix()
        if rel_path == ".":
            rel_path = ""

        default_title = folder.name.replace("-", " ").replace("_", " ").title() if rel_path else "Root"
        info_file = folder / "info.md"
        notes_file = folder / "notes.md"

        title, badge, status = self._parse_info_md(info_file, default_title)

        # 1. Immediate subdirectories (non-recursive)
        children = []
        if folder.exists() and folder.is_dir():
            subdirs = [d for d in folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
            for d in sorted(subdirs, key=lambda x: x.name.lower()):
                c_title, c_badge, c_status = self._parse_info_md(d / "info.md", d.name.replace("-", " ").replace("_", " ").title())
                has_subchildren = any(sd.is_dir() and not sd.name.startswith((".", "__")) for sd in d.iterdir()) if d.exists() else False
                children.append({
                    "id": d.name,
                    "title": c_title,
                    "badge": c_badge,
                    "status": c_status,
                    "hasChildren": has_subchildren,
                    "relPath": d.relative_to(GRAPH_DIR).as_posix()
                })

        # 2. Extra files in this folder only
        extra_files = []
        if folder.exists() and folder.is_dir():
            for f in sorted(folder.iterdir(), key=lambda x: x.name.lower()):
                if f.is_file() and f.name not in CORE_NODE_FILES and f.name not in IGNORED_SYSTEM_FILES and not f.name.startswith("."):
                    rel_to_base = f.relative_to(BASE_DIR).as_posix()
                    extra_files.append({
                        "label": f.name,
                        "url": rel_to_base,
                        "size": f.stat().st_size,
                        "ext": f.suffix.lstrip(".").lower()
                    })

        # Read info and notes content for this current node
        info_content = ""
        if info_file.exists():
            try:
                with open(info_file, "r", encoding="utf-8") as f:
                    info_content = f.read()
            except Exception:
                pass

        notes_content = ""
        if notes_file.exists():
            try:
                with open(notes_file, "r", encoding="utf-8") as f:
                    notes_content = f.read()
            except Exception:
                pass

        return {
            "id": folder.name if rel_path else "root",
            "folderName": folder.name if rel_path else "root",
            "relPath": rel_path,
            "title": title,
            "badge": badge,
            "status": status,
            "children": children,
            "extraFiles": extra_files,
            "breadcrumbs": self._build_breadcrumbs(folder),
            "infoExists": info_file.exists(),
            "notesExists": notes_file.exists(),
            "info": info_content,
            "notes": notes_content
        }

    def _build_breadcrumbs(self, folder: Path) -> list[dict]:
        """Build breadcrumbs trail from Root to folder."""
        if folder == GRAPH_DIR or not folder.is_relative_to(GRAPH_DIR):
            return [{"id": "root", "title": "Root", "relPath": ""}]

        rel = folder.relative_to(GRAPH_DIR)
        breadcrumbs = [{"id": "root", "title": "Root", "relPath": ""}]
        curr = GRAPH_DIR
        for part in rel.parts:
            curr = curr / part
            info_file = curr / "info.md"
            title, _, _ = self._parse_info_md(info_file, part.replace("-", " ").replace("_", " ").title())
            c_rel = curr.relative_to(GRAPH_DIR).as_posix()
            breadcrumbs.append({"id": part, "title": title, "relPath": c_rel})
        return breadcrumbs

    def _scan_full_tree(self, folder: Path, depth: int = 0) -> dict:
        """Recursively scan complete station hierarchy starting from folder."""
        rel_path = folder.relative_to(GRAPH_DIR).as_posix() if folder != GRAPH_DIR else ""
        default_title = folder.name.replace("-", " ").replace("_", " ").title() if rel_path else "Knowledge Graph"
        info_file = folder / "info.md"
        title, badge, status = self._parse_info_md(info_file, default_title)

        children = []
        if folder.exists() and folder.is_dir():
            subdirs = [d for d in folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
            for d in sorted(subdirs, key=lambda x: x.name.lower()):
                children.append(self._scan_full_tree(d, depth + 1))

        total_descendants = len(children) + sum(c.get("totalDescendants", 0) for c in children)

        return {
            "id": folder.name if rel_path else "root",
            "title": title,
            "badge": badge,
            "status": status,
            "relPath": rel_path,
            "depth": depth,
            "hasChildren": len(children) > 0,
            "childCount": len(children),
            "totalDescendants": total_descendants,
            "children": children
        }

    def _find_next_node_bfs(self, start_dir: Path) -> dict:
        """
        BFS from start_dir returning the first uncompleted station:
        - If start_dir is an uncompleted leaf (not root), return it as current focus.
        - Otherwise, traverse descendants in BFS order (level by level, alphabetical)
          and return the first station with status != 'completed'.
        - If all descendants are completed, indicate all completed.
        """
        def get_subdirs(d: Path) -> list[Path]:
            if not d.exists() or not d.is_dir():
                return []
            subdirs = [p for p in d.iterdir() if p.is_dir() and not p.name.startswith((".", "__"))]
            return sorted(subdirs, key=lambda x: x.name.lower())

        immediate_subdirs = get_subdirs(start_dir)

        # 1. Scoped context: If start_dir is a leaf station (not Root)
        if start_dir != GRAPH_DIR and not immediate_subdirs:
            info_file = start_dir / "info.md"
            title, badge, status = self._parse_info_md(info_file, start_dir.name.replace("-", " ").replace("_", " ").title())
            if status != "completed":
                breadcrumbs = self._build_breadcrumbs(start_dir)
                category = breadcrumbs[-2]["title"] if len(breadcrumbs) > 1 else "Root"
                rel_p = start_dir.relative_to(GRAPH_DIR).as_posix() if start_dir.is_relative_to(GRAPH_DIR) else start_dir.name
                return {
                    "found": True,
                    "isCurrentNode": True,
                    "allCompleted": False,
                    "node": {
                        "id": start_dir.name,
                        "title": title,
                        "badge": badge,
                        "status": status,
                        "relPath": rel_p,
                        "category": category,
                        "breadcrumbs": breadcrumbs
                    }
                }
            else:
                return {
                    "found": False,
                    "isCurrentNode": True,
                    "allCompleted": True,
                    "node": None,
                    "message": "Current station is completed."
                }

        # 2. BFS queue over descendants
        queue = deque(immediate_subdirs)

        while queue:
            curr = queue.popleft()
            info_file = curr / "info.md"
            title, badge, status = self._parse_info_md(info_file, curr.name.replace("-", " ").replace("_", " ").title())

            if status != "completed":
                breadcrumbs = self._build_breadcrumbs(curr)
                category = breadcrumbs[-2]["title"] if len(breadcrumbs) > 1 else "Root"
                curr_rel = curr.relative_to(GRAPH_DIR).as_posix() if curr.is_relative_to(GRAPH_DIR) else curr.name
                return {
                    "found": True,
                    "isCurrentNode": False,
                    "allCompleted": False,
                    "node": {
                        "id": curr.name,
                        "title": title,
                        "badge": badge,
                        "status": status,
                        "relPath": curr_rel,
                        "category": category,
                        "breadcrumbs": breadcrumbs
                    }
                }

            # Enqueue children for next BFS level
            queue.extend(get_subdirs(curr))

        return {
            "found": False,
            "isCurrentNode": False,
            "allCompleted": True,
            "node": None,
            "message": "All stations in this section completed!"
        }

    def _search_graph(self, query: str, limit: int = 30) -> tuple[list[dict], int]:
        """
        Deep search across:
        1. Node titles and folder names
        2. info.md content (mental models, outcomes, checkpoints)
        3. notes.md content (personal synthesis, code)
        4. Extra attached file names
        Returns (sliced_results, total_matches).
        """
        query = query.strip()
        if not query:
            return [], 0

        q_lower = query.lower()
        results = []

        def make_snippet(text: str, target_pos: int, length: int) -> str:
            start = max(0, target_pos - 40)
            end = min(len(text), target_pos + length + 60)
            snippet = text[start:end].replace("\r", " ").replace("\n", " ").strip()
            snippet = re.sub(r"\s+", " ", snippet)
            if start > 0:
                snippet = "..." + snippet
            if end < len(text):
                snippet = snippet + "..."
            return snippet

        for root, dirs, files in os.walk(GRAPH_DIR):
            folder = Path(root)
            if folder.name.startswith((".", "__")):
                continue

            rel_path = folder.relative_to(GRAPH_DIR).as_posix()
            if rel_path == ".":
                rel_path = ""

            default_title = folder.name.replace("-", " ").replace("_", " ").title() if rel_path else "Root"
            info_file = folder / "info.md"
            notes_file = folder / "notes.md"

            title, badge, status = self._parse_info_md(info_file, default_title)
            breadcrumbs = self._build_breadcrumbs(folder)
            category = " › ".join([b["title"] for b in breadcrumbs[:-1]]) if len(breadcrumbs) > 1 else "Root"

            matched = False
            best_match = None

            # 1. Title or folder name match (Highest Priority)
            title_lower = title.lower()
            folder_lower = folder.name.lower()
            if q_lower in title_lower:
                best_match = {
                    "matchType": "title",
                    "score": 100,
                    "matchedTerm": title,
                    "snippet": f"Station: {title}"
                }
                matched = True
            elif rel_path and q_lower in folder_lower:
                best_match = {
                    "matchType": "title",
                    "score": 100,
                    "matchedTerm": folder.name,
                    "snippet": f"Folder: {folder.name}"
                }
                matched = True

            # 2. info.md content match
            if not matched and info_file.exists():
                try:
                    with open(info_file, "r", encoding="utf-8") as f_in:
                        info_text = f_in.read()
                    pos = info_text.lower().find(q_lower)
                    if pos != -1:
                        snippet = make_snippet(info_text, pos, len(query))
                        best_match = {
                            "matchType": "info",
                            "score": 80,
                            "matchedTerm": "info.md",
                            "snippet": snippet
                        }
                        matched = True
                except Exception:
                    pass

            # 3. notes.md content match
            if not matched and notes_file.exists():
                try:
                    with open(notes_file, "r", encoding="utf-8") as f_notes:
                        notes_text = f_notes.read()
                    pos = notes_text.lower().find(q_lower)
                    if pos != -1:
                        snippet = make_snippet(notes_text, pos, len(query))
                        best_match = {
                            "matchType": "notes",
                            "score": 70,
                            "matchedTerm": "notes.md",
                            "snippet": snippet
                        }
                        matched = True
                except Exception:
                    pass

            # 4. Extra files match (Smallest Score)
            if not matched:
                for f in files:
                    if f not in CORE_NODE_FILES and f not in IGNORED_SYSTEM_FILES and not f.startswith("."):
                        if q_lower in f.lower():
                            best_match = {
                                "matchType": "file",
                                "score": 60,
                                "matchedTerm": f,
                                "snippet": f"File: {f}"
                            }
                            matched = True
                            break

            if matched and best_match:
                depth = len(breadcrumbs) - 1 if breadcrumbs else 0
                results.append({
                    "id": folder.name if rel_path else "root",
                    "title": title,
                    "relPath": rel_path,
                    "status": status,
                    "badge": badge,
                    "category": category,
                    "breadcrumbs": breadcrumbs,
                    "depth": depth,
                    "matchType": best_match["matchType"],
                    "score": best_match["score"],
                    "matchedTerm": best_match["matchedTerm"],
                    "snippet": best_match["snippet"]
                })

        # Sort: Highest score first; on tie, higher level node (smaller depth) has priority
        results.sort(key=lambda r: (-r["score"], r["depth"], len(r["title"]), r["title"].lower()))
        total_count = len(results)
        sliced = results[:limit] if limit > 0 else results
        return sliced, total_count

    def _update_status_in_info_md(self, info_path: Path, new_status: str):
        if not info_path.exists():
            fallback_title = info_path.parent.name.replace("-", " ").replace("_", " ").title()
            with open(info_path, "w", encoding="utf-8") as f:
                f.write(f"# {fallback_title}\n\n**Status:** {new_status}\n\n")
            return

        try:
            with open(info_path, "r", encoding="utf-8") as f:
                content = f.read()

            pattern = re.compile(r"(\*\*Status:\*\*\s*)([a-zA-Z0-9_\-]+)", re.IGNORECASE)
            if pattern.search(content):
                updated = pattern.sub(rf"\g<1>{new_status}", content)
            else:
                pattern2 = re.compile(r"(status:\s*)([a-zA-Z0-9_\-]+)", re.IGNORECASE)
                if pattern2.search(content):
                    updated = pattern2.sub(rf"\g<1>{new_status}", content)
                else:
                    lines = content.splitlines()
                    insert_idx = 1 if len(lines) > 1 else len(lines)
                    lines.insert(insert_idx, f"**Status:** {new_status}")
                    updated = "\n".join(lines)

            with open(info_path, "w", encoding="utf-8") as f:
                f.write(updated)
        except Exception as e:
            print(f"[Error updating status in {info_path}]: {e}", file=sys.stderr)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1. API: Single Node On-Demand (Only loads the currently viewed node)
        if path == "/api/node":
            self._handle_api_get_node(parsed.query)
            return

        # 2. API: Fast Overall Progress Stats
        if path == "/api/stats":
            self._handle_api_get_stats()
            return

        # 3. API: Next Learning Node via BFS
        if path == "/api/next-node":
            self._handle_api_get_next_node(parsed.query)
            return

        # 4. API: Deep Search Across Titles, Content, and Files
        if path == "/api/search":
            self._handle_api_search(parsed.query)
            return

        # 5. API: Full Graph Tree Hierarchy
        if path == "/api/full-graph":
            self._handle_api_get_full_graph()
            return

        # Fallback graph
        if path in ("/api/graph", "/api/graph/"):
            self._handle_api_get_root()
            return

        super().do_GET()

    def _handle_api_get_node(self, query_string: str):
        """Fetch strictly the requested single node and its immediate children on demand."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            node_data = self._scan_single_node(node_dir)
            self._send_json(200, node_data)
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_api_get_root(self):
        """Fast root-level response."""
        try:
            root_data = self._scan_single_node(GRAPH_DIR)
            self._send_json(200, {
                "status": "ok",
                "root": root_data
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_api_get_stats(self):
        """Lightweight overall progress computation."""
        total = 0
        completed = 0
        for root, dirs, files in os.walk(GRAPH_DIR):
            rpath = Path(root)
            if rpath == GRAPH_DIR or rpath.name.startswith((".", "__")):
                continue
            total += 1
            info_file = rpath / "info.md"
            if info_file.exists():
                try:
                    with open(info_file, "r", encoding="utf-8") as f:
                        for line in f:
                            lower = line.lower()
                            if "status: completed" in lower or "status:** completed" in lower:
                                completed += 1
                                break
                except Exception:
                    pass

        percent = round((completed / total) * 100) if total > 0 else 0
        self._send_json(200, {
            "total": total,
            "completed": completed,
            "percent": percent
        })

    def _handle_api_get_next_node(self, query_string: str):
        """Find the next uncompleted station using BFS from the requested node."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            result = self._find_next_node_bfs(node_dir)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_api_search(self, query_string: str):
        """API handler for deep search across titles, info.md, notes.md, and extra files."""
        params = urllib.parse.parse_qs(query_string)
        q = params.get("q", [""])[0]
        raw_limit = params.get("limit", ["30"])[0]
        limit = int(raw_limit) if raw_limit.isdigit() else 30

        try:
            results, total = self._search_graph(q, limit=limit)
            self._send_json(200, {
                "query": q,
                "total": total,
                "count": len(results),
                "results": results
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_api_get_full_graph(self):
        """Fetch complete knowledge graph hierarchy for overview mode."""
        try:
            tree = self._scan_full_tree(GRAPH_DIR)
            self._send_json(200, {
                "status": "ok",
                "tree": tree
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

        if path in ("/api/save-info", "/api/save-file") and payload.get("file") == "info.md":
            self._handle_save_info(payload)
        elif path in ("/api/save-notes", "/api/save-summary", "/api/save-file"):
            self._handle_save_notes(payload)
        elif path == "/api/save-status":
            self._handle_save_status(payload)
        elif path == "/api/add-child":
            self._handle_add_child(payload)
        elif path in ("/api/upload-extra-file", "/api/upload-resource"):
            self._handle_upload_extra_file(payload)
        else:
            self._send_json(404, {"error": "API route not found"})

    def _handle_save_info(self, payload: dict):
        raw_path = payload.get("path", "")
        content = payload.get("content", "")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_dir.mkdir(parents=True, exist_ok=True)
            info_file = node_dir / "info.md"

            with open(info_file, "w", encoding="utf-8") as f:
                f.write(content)

            print(f"[info.md Saved]: {info_file} ({len(content)} chars)")
            self._send_json(200, {
                "success": True,
                "message": "info.md saved to disk",
                "node": self._scan_single_node(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_save_notes(self, payload: dict):
        raw_path = payload.get("path", "")
        content = payload.get("content", "")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            node_dir.mkdir(parents=True, exist_ok=True)
            notes_file = node_dir / "notes.md"

            with open(notes_file, "w", encoding="utf-8") as f:
                f.write(content)

            print(f"[notes.md Saved]: {notes_file} ({len(content)} chars)")
            self._send_json(200, {
                "success": True,
                "message": "notes.md saved to disk",
                "node": self._scan_single_node(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_save_status(self, payload: dict):
        raw_path = payload.get("path", "")
        status = payload.get("status", "todo")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            info_file = node_dir / "info.md"

            self._update_status_in_info_md(info_file, status)
            print(f"[Status Saved in info.md]: {info_file} -> {status}")

            self._send_json(200, {
                "success": True,
                "message": f"Status updated to '{status}'",
                "node": self._scan_single_node(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_add_child(self, payload: dict):
        """Create child folder with strictly info.md and notes.md using only name."""
        parent_path = payload.get("parentPath", "")
        name = payload.get("name", payload.get("title", "")).strip()

        if not name:
            self._send_json(400, {"error": "Station name is required"})
            return

        child_id = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
        safe_child_id = "".join(c for c in child_id if c.isalnum() or c in ("-", "_")).strip("-")

        if not safe_child_id:
            self._send_json(400, {"error": "Name must contain alphanumeric characters"})
            return

        try:
            parent_dir = self._resolve_graph_folder(parent_path)
            if not parent_dir.exists():
                self._send_json(404, {"error": f"Parent node folder not found at {parent_path}"})
                return

            child_dir = parent_dir / safe_child_id
            child_dir.mkdir(parents=True, exist_ok=True)

            # 1. info.md
            info_content = (
                f"# {name}\n\n"
                f"**Status:** todo\n\n"
                f"Starter orientation and core mental models for {name}.\n\n"
                f"## Learning Outcomes\n"
                f"- \n\n"
                f"## Checkpoint\n"
                f"- [ ] \n\n"
                f"## Links & Resources\n"
                f"- \n"
            )
            with open(child_dir / "info.md", "w", encoding="utf-8") as f:
                f.write(info_content)

            # 2. notes.md (empty with only the title)
            notes_content = f"# {name}\n\n"
            with open(child_dir / "notes.md", "w", encoding="utf-8") as f:
                f.write(notes_content)

            print(f"[Child Created]: {child_dir} under {parent_path}")
            self._send_json(200, {
                "success": True,
                "message": f"Child station '{safe_child_id}' created",
                "child": self._scan_single_node(child_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_upload_extra_file(self, payload: dict):
        raw_path = payload.get("path", "")
        filename = payload.get("filename", "").strip()
        b64_content = payload.get("content", "")

        if not filename:
            self._send_json(400, {"error": "filename is required"})
            return

        safe_filename = Path(filename).name
        if not safe_filename or safe_filename in CORE_NODE_FILES or safe_filename in IGNORED_SYSTEM_FILES:
            self._send_json(400, {"error": "Invalid filename or cannot overwrite core node files"})
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
            print(f"[Extra File Uploaded]: {target_file} ({len(file_bytes)} bytes)")
            self._send_json(200, {
                "success": True,
                "message": f"File '{safe_filename}' saved to folder",
                "file": {
                    "label": safe_filename,
                    "url": rel_to_base,
                    "size": len(file_bytes),
                    "ext": target_file.suffix.lstrip(".").lower()
                },
                "node": self._scan_single_node(node_dir)
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
    ensure_graph_initialized()
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
