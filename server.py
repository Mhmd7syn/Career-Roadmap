#!/usr/bin/env python3
"""
Knowledge Graph Local Server
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
from datetime import datetime, date

BASE_DIR = Path(__file__).resolve().parent
GRAPH_DIR = Path(os.getenv("GRAPH_DIR", BASE_DIR / "graph")).resolve()
TEMPLATE_DIR = BASE_DIR / "graph.template"
CORE_NODE_FILES = {"info.md", "notes.md", "shortcut.json"}
IGNORED_SYSTEM_FILES = {".DS_Store", "desktop.ini", "Thumbs.db", "AGENTS.md", "agents.md", "agent.md"}
REVIEW_DECAY_DAYS = 30  # 1 month spaced repetition decay threshold


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

    def _resolve_shortcut(self, folder: Path, max_depth: int = 5) -> tuple[Path, bool, str]:
        """
        Check if folder contains shortcut.json. If so, follow target safely within GRAPH_DIR.
        Returns: (canonical_folder, is_shortcut, canonical_rel_path)
        """
        curr = folder
        is_shortcut = False
        visited = {curr.resolve()}
        canonical_rel = ""

        for _ in range(max_depth):
            shortcut_file = curr / "shortcut.json"
            if not shortcut_file.exists():
                break

            try:
                with open(shortcut_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                target_rel = data.get("target", "").strip()
                if not target_rel:
                    break

                target_folder = self._resolve_graph_folder(target_rel)
                if not target_folder.exists() or not target_folder.is_dir():
                    break

                resolved_target = target_folder.resolve()
                if resolved_target in visited:
                    print(f"[Warning]: Circular shortcut detected in {shortcut_file}", file=sys.stderr)
                    break

                visited.add(resolved_target)
                curr = target_folder
                is_shortcut = True
                canonical_rel = curr.relative_to(GRAPH_DIR).as_posix() if curr != GRAPH_DIR else ""
            except Exception as e:
                print(f"[Error reading shortcut {shortcut_file}]: {e}", file=sys.stderr)
                break

        return curr, is_shortcut, canonical_rel

    def _parse_info_md(self, info_path: Path, default_title: str) -> tuple[str, str, str]:
        """Extract title, badge, and status from info.md, applying spaced repetition auto-decay."""
        title = default_title
        badge = ""
        status = "todo"

        if not info_path.exists():
            return title, badge, status

        try:
            with open(info_path, "r", encoding="utf-8") as f:
                content = f.read()

            lines = content.splitlines()
            completed_date = None

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

                if "completed" in stripped.lower():
                    m_comp = re.search(r"completed(?:\s*date|_at)?[:\*]+\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", stripped, re.IGNORECASE)
                    if m_comp:
                        try:
                            completed_date = datetime.strptime(m_comp.group(1), "%Y-%m-%d").date()
                        except ValueError:
                            pass

            # Auto-decay logic: stations marked 'completed' decay to 'needs-review' after REVIEW_DECAY_DAYS (30 days / 1 month)
            if status == "completed":
                if not completed_date:
                    try:
                        completed_date = datetime.fromtimestamp(info_path.stat().st_mtime).date()
                    except Exception:
                        completed_date = datetime.now().date()

                days_elapsed = (datetime.now().date() - completed_date).days
                if days_elapsed >= REVIEW_DECAY_DAYS:
                    status = "needs-review"
                    self._update_status_in_info_md(info_path, "needs-review", completed_date_str=completed_date.isoformat())

            return title, badge, status
        except Exception as e:
            print(f"[Warning parsing {info_path}]: {e}", file=sys.stderr)
            return default_title, badge, status

    def _scan_single_node(self, folder: Path) -> dict:
        """
        Lightweight, non-recursive node scanner:
        Only scans the requested directory and its immediate child folder headers.
        Resolves shortcuts safely to canonical folder while preserving folder's own relPath.
        """
        rel_path = folder.relative_to(GRAPH_DIR).as_posix() if folder != GRAPH_DIR else ""
        canonical_folder, is_shortcut, canonical_rel = self._resolve_shortcut(folder)

        default_title = folder.name.replace("-", " ").replace("_", " ").title() if rel_path else "Root"
        info_file = canonical_folder / "info.md"
        notes_file = canonical_folder / "notes.md"

        title, badge, status = self._parse_info_md(info_file, default_title)

        # 1. Immediate subdirectories from canonical folder
        children = []
        if canonical_folder.exists() and canonical_folder.is_dir():
            subdirs = [d for d in canonical_folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
            for d in sorted(subdirs, key=lambda x: x.name.lower()):
                c_canonical, c_is_shortcut, c_target_rel = self._resolve_shortcut(d)
                c_title, c_badge, c_status = self._parse_info_md(c_canonical / "info.md", d.name.replace("-", " ").replace("_", " ").title())
                has_subchildren = any(sd.is_dir() and not sd.name.startswith((".", "__")) for sd in c_canonical.iterdir()) if c_canonical.exists() else False
                children.append({
                    "id": d.name,
                    "title": c_title,
                    "badge": c_badge,
                    "status": c_status,
                    "hasChildren": has_subchildren,
                    "isShortcut": c_is_shortcut,
                    "canonicalRelPath": c_target_rel if c_is_shortcut else "",
                    "relPath": d.relative_to(GRAPH_DIR).as_posix()
                })

        # 2. Extra files in canonical folder
        extra_files = []
        if canonical_folder.exists() and canonical_folder.is_dir():
            for f in sorted(canonical_folder.iterdir(), key=lambda x: x.name.lower()):
                if f.is_file() and f.name not in CORE_NODE_FILES and f.name not in IGNORED_SYSTEM_FILES and not f.name.startswith("."):
                    rel_to_base = f.relative_to(BASE_DIR).as_posix()
                    extra_files.append({
                        "label": f.name,
                        "url": rel_to_base,
                        "size": f.stat().st_size,
                        "ext": f.suffix.lstrip(".").lower()
                    })

        # Read info and notes content from canonical folder
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
            "isShortcut": is_shortcut,
            "canonicalRelPath": canonical_rel if is_shortcut else rel_path,
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
            return [{"id": "root", "title": "Root", "relPath": "", "isShortcut": False}]

        rel = folder.relative_to(GRAPH_DIR)
        breadcrumbs = [{"id": "root", "title": "Root", "relPath": "", "isShortcut": False}]
        curr = GRAPH_DIR
        for part in rel.parts:
            curr = curr / part
            c_canonical, c_is_shortcut, _ = self._resolve_shortcut(curr)
            info_file = c_canonical / "info.md"
            title, _, _ = self._parse_info_md(info_file, part.replace("-", " ").replace("_", " ").title())
            c_rel = curr.relative_to(GRAPH_DIR).as_posix()
            breadcrumbs.append({
                "id": part,
                "title": title,
                "relPath": c_rel,
                "isShortcut": c_is_shortcut
            })
        return breadcrumbs

    def _scan_full_tree(self, folder: Path, depth: int = 0, visited_ancestors: set = None) -> dict:
        """Recursively scan complete station hierarchy starting from folder, handling shortcuts and preventing cycles."""
        if visited_ancestors is None:
            visited_ancestors = set()

        rel_path = folder.relative_to(GRAPH_DIR).as_posix() if folder != GRAPH_DIR else ""
        canonical_folder, is_shortcut, canonical_rel = self._resolve_shortcut(folder)

        default_title = folder.name.replace("-", " ").replace("_", " ").title() if rel_path else "Knowledge Graph"
        info_file = canonical_folder / "info.md"
        title, badge, status = self._parse_info_md(info_file, default_title)

        children = []
        canonical_resolved = canonical_folder.resolve()

        # Prevent circular cycles
        if canonical_resolved not in visited_ancestors:
            next_ancestors = visited_ancestors | {canonical_resolved}
            if canonical_folder.exists() and canonical_folder.is_dir():
                subdirs = [d for d in canonical_folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
                for d in sorted(subdirs, key=lambda x: x.name.lower()):
                    children.append(self._scan_full_tree(d, depth + 1, next_ancestors))

        total_descendants = len(children) + sum(c.get("totalDescendants", 0) for c in children)

        return {
            "id": folder.name if rel_path else "root",
            "title": title,
            "badge": badge,
            "status": status,
            "relPath": rel_path,
            "isShortcut": is_shortcut,
            "canonicalRelPath": canonical_rel if is_shortcut else rel_path,
            "depth": depth,
            "hasChildren": len(children) > 0,
            "childCount": len(children),
            "totalDescendants": total_descendants,
            "children": children
        }

    def _find_next_node_bfs(self, start_dir: Path) -> dict:
        """
        BFS from start_dir returning the next uncompleted station:
        - First check start_dir itself (the current station): if uncompleted, return it as current focus.
        - Otherwise, traverse descendants in BFS order (level by level, alphabetical)
          and return the first station with status != 'completed'.
        - If all descendants are completed, indicate all completed.
        - Resolves shortcuts and tracks visited canonical paths to avoid cycles.
        """
        if not start_dir.exists() or not start_dir.is_dir():
            return {
                "found": False,
                "isCurrentNode": False,
                "allCompleted": False,
                "node": None,
                "message": "Station directory does not exist."
            }

        def get_subdirs(d: Path) -> list[Path]:
            if not d.exists() or not d.is_dir():
                return []
            subdirs = [p for p in d.iterdir() if p.is_dir() and not p.name.startswith((".", "__"))]
            return sorted(subdirs, key=lambda x: x.name.lower())

        canonical_start, is_start_sc, start_target_rel = self._resolve_shortcut(start_dir)
        immediate_subdirs = get_subdirs(canonical_start)

        # 1. Scoped context: Check the current node first (Root or any station)
        info_file = canonical_start / "info.md"
        default_title = start_dir.name.replace("-", " ").replace("_", " ").title() if start_dir != GRAPH_DIR else "Root"
        title, badge, status = self._parse_info_md(info_file, default_title)

        if status != "completed":
            breadcrumbs = self._build_breadcrumbs(start_dir)
            category = breadcrumbs[-2]["title"] if len(breadcrumbs) > 1 else "Root"
            rel_p = start_dir.relative_to(GRAPH_DIR).as_posix() if start_dir != GRAPH_DIR else ""
            return {
                "found": True,
                "isCurrentNode": True,
                "allCompleted": False,
                "node": {
                    "id": start_dir.name if start_dir != GRAPH_DIR else "root",
                    "title": title,
                    "badge": badge,
                    "status": status,
                    "isShortcut": is_start_sc,
                    "canonicalRelPath": start_target_rel if is_start_sc else rel_p,
                    "relPath": rel_p,
                    "category": category,
                    "breadcrumbs": breadcrumbs
                }
            }

        # 2. BFS queue over descendants (if current node is completed)
        visited_canonical = {canonical_start.resolve()}
        queue = deque(immediate_subdirs)

        while queue:
            curr = queue.popleft()
            canonical_curr, is_sc, target_rel = self._resolve_shortcut(curr)
            resolved_canon = canonical_curr.resolve()
            if resolved_canon in visited_canonical:
                continue
            visited_canonical.add(resolved_canon)

            info_file = canonical_curr / "info.md"
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
                        "isShortcut": is_sc,
                        "canonicalRelPath": target_rel if is_sc else curr_rel,
                        "relPath": curr_rel,
                        "category": category,
                        "breadcrumbs": breadcrumbs
                    }
                }

            # Enqueue children for next BFS level
            queue.extend(get_subdirs(canonical_curr))

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
            canonical_folder, is_shortcut, canonical_rel = self._resolve_shortcut(folder)
            info_file = canonical_folder / "info.md"
            notes_file = canonical_folder / "notes.md"

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
                    "isShortcut": is_shortcut,
                    "canonicalRelPath": canonical_rel if is_shortcut else rel_path,
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

    def _update_status_in_info_md(self, info_path: Path, new_status: str, completed_date_str: str = None):
        today_str = datetime.now().date().isoformat()
        if not info_path.exists():
            fallback_title = info_path.parent.name.replace("-", " ").replace("_", " ").title()
            comp_line = f"**Completed:** {today_str}\n" if new_status == "completed" else ""
            with open(info_path, "w", encoding="utf-8") as f:
                f.write(f"# {fallback_title}\n\n**Status:** {new_status}\n{comp_line}\n")
            return

        try:
            with open(info_path, "r", encoding="utf-8") as f:
                content = f.read()

            # 1. Update or insert status
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

            # 2. Update, preserve, or remove completion date
            comp_pattern = re.compile(r"(\*\*Completed:\*\*\s*)([0-9]{4}-[0-9]{2}-[0-9]{2})", re.IGNORECASE)
            comp_pattern2 = re.compile(r"(completed(?:\s*date|_at)?:\s*)([0-9]{4}-[0-9]{2}-[0-9]{2})", re.IGNORECASE)

            if new_status == "completed":
                date_to_write = completed_date_str or today_str
                if comp_pattern.search(updated):
                    updated = comp_pattern.sub(rf"\g<1>{date_to_write}", updated)
                elif comp_pattern2.search(updated):
                    updated = comp_pattern2.sub(rf"\g<1>{date_to_write}", updated)
                else:
                    stat_match = re.search(r"(\*\*Status:\*\*[^\n]*)", updated, re.IGNORECASE)
                    if stat_match:
                        updated = updated[:stat_match.end()] + f"\n**Completed:** {date_to_write}" + updated[stat_match.end():]
                    else:
                        stat_match2 = re.search(r"(status:[^\n]*)", updated, re.IGNORECASE)
                        if stat_match2:
                            updated = updated[:stat_match2.end()] + f"\n**Completed:** {date_to_write}" + updated[stat_match2.end():]
            elif new_status == "needs-review":
                # Ensure the original completion date is preserved in metadata
                if completed_date_str and not (comp_pattern.search(updated) or comp_pattern2.search(updated)):
                    stat_match = re.search(r"(\*\*Status:\*\*[^\n]*)", updated, re.IGNORECASE)
                    if stat_match:
                        updated = updated[:stat_match.end()] + f"\n**Completed:** {completed_date_str}" + updated[stat_match.end():]
            else:
                # If reverting to todo or in-progress, strip completion metadata
                updated = re.sub(r"\n?\*\*Completed:\*\*\s*[0-9]{4}-[0-9]{2}-[0-9]{2}", "", updated, flags=re.IGNORECASE)
                updated = re.sub(r"\n?completed(?:\s*date|_at)?:\s*[0-9]{4}-[0-9]{2}-[0-9]{2}", "", updated, flags=re.IGNORECASE)

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

        # 6. API: Flat Canonical Stations List for Shortcut Selection
        if path == "/api/stations":
            self._handle_api_get_stations()
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
        """Lightweight overall progress computation across unique canonical stations."""
        visited_canonical = set()
        completed = 0
        needs_review = 0
        for root, dirs, files in os.walk(GRAPH_DIR):
            rpath = Path(root)
            if rpath == GRAPH_DIR or rpath.name.startswith((".", "__")):
                continue
            canonical_path, _, _ = self._resolve_shortcut(rpath)
            res = canonical_path.resolve()
            if res in visited_canonical:
                continue
            visited_canonical.add(res)

            info_file = canonical_path / "info.md"
            if info_file.exists():
                try:
                    _, _, status = self._parse_info_md(info_file, rpath.name)
                    if status == "completed":
                        completed += 1
                    elif status == "needs-review":
                        needs_review += 1
                except Exception:
                    pass

        total = len(visited_canonical)
        percent = round((completed / total) * 100) if total > 0 else 0
        self._send_json(200, {
            "total": total,
            "completed": completed,
            "needsReview": needs_review,
            "percent": percent
        })

    def _handle_api_get_stations(self):
        """Return flat list of all canonical stations for shortcut selection."""
        stations = []
        for root, dirs, files in os.walk(GRAPH_DIR):
            rpath = Path(root)
            if rpath == GRAPH_DIR or rpath.name.startswith((".", "__")):
                continue
            if (rpath / "shortcut.json").exists():
                continue
            rel = rpath.relative_to(GRAPH_DIR).as_posix()
            title, _, _ = self._parse_info_md(rpath / "info.md", rpath.name.replace("-", " ").replace("_", " ").title())
            stations.append({
                "title": title,
                "relPath": rel
            })
        stations.sort(key=lambda s: s["title"].lower())
        self._send_json(200, {"stations": stations})

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

        if path == "/api/save-info" or (path == "/api/save-file" and payload.get("file") == "info.md"):
            self._handle_save_info(payload)
        elif path in ("/api/save-notes", "/api/save-summary") or (path == "/api/save-file" and payload.get("file") != "info.md"):
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
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            canonical_dir.mkdir(parents=True, exist_ok=True)
            info_file = canonical_dir / "info.md"

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
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            canonical_dir.mkdir(parents=True, exist_ok=True)
            notes_file = canonical_dir / "notes.md"

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
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            info_file = canonical_dir / "info.md"

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
        """Create child folder with either fresh station or shortcut pointer."""
        parent_path = payload.get("parentPath", "")
        is_shortcut = bool(payload.get("isShortcut", False))
        target_path = payload.get("targetPath", "").strip()
        name = payload.get("name", payload.get("title", "")).strip()

        try:
            parent_dir = self._resolve_graph_folder(parent_path)
            if not parent_dir.exists():
                self._send_json(404, {"error": f"Parent node folder not found at {parent_path}"})
                return

            canonical_parent, _, _ = self._resolve_shortcut(parent_dir)

            if is_shortcut:
                if not target_path:
                    self._send_json(400, {"error": "Target station path is required for shortcut"})
                    return

                target_dir = self._resolve_graph_folder(target_path)
                if not target_dir.exists() or not target_dir.is_dir():
                    self._send_json(404, {"error": f"Target station not found at '{target_path}'"})
                    return

                canonical_target, _, _ = self._resolve_shortcut(target_dir)
                if canonical_target.resolve() == canonical_parent.resolve():
                    self._send_json(400, {"error": "Cannot create shortcut pointing to the parent station itself"})
                    return

                if not name:
                    name = target_dir.name

                child_id = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
                safe_child_id = "".join(c for c in child_id if c.isalnum() or c in ("-", "_")).strip("-")
                if not safe_child_id:
                    safe_child_id = target_dir.name

                child_dir = canonical_parent / safe_child_id
                if child_dir.exists():
                    self._send_json(400, {"error": f"Station or shortcut named '{safe_child_id}' already exists here"})
                    return

                child_dir.mkdir(parents=True, exist_ok=True)
                canonical_target_rel = canonical_target.relative_to(GRAPH_DIR).as_posix() if canonical_target != GRAPH_DIR else ""
                shortcut_data = {
                    "target": canonical_target_rel
                }
                with open(child_dir / "shortcut.json", "w", encoding="utf-8") as f:
                    json.dump(shortcut_data, f, indent=2)

                print(f"[Shortcut Created]: {child_dir} -> {canonical_target_rel}")
                self._send_json(200, {
                    "success": True,
                    "message": f"Shortcut created pointing to {canonical_target_rel}",
                    "node": self._scan_single_node(child_dir)
                })
                return

            # Normal station creation
            if not name:
                self._send_json(400, {"error": "Station name is required"})
                return

            child_id = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
            safe_child_id = "".join(c for c in child_id if c.isalnum() or c in ("-", "_")).strip("-")

            if not safe_child_id:
                self._send_json(400, {"error": "Name must contain alphanumeric characters"})
                return

            child_dir = canonical_parent / safe_child_id
            if child_dir.exists():
                self._send_json(400, {"error": f"Station named '{safe_child_id}' already exists here"})
                return

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

            # 2. notes.md
            notes_content = f"# {name}\n\n"
            with open(child_dir / "notes.md", "w", encoding="utf-8") as f:
                f.write(notes_content)

            print(f"[Child Created]: {child_dir} under {parent_path}")
            self._send_json(200, {
                "success": True,
                "message": f"Child station '{safe_child_id}' created",
                "node": self._scan_single_node(child_dir)
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
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            target_file = canonical_dir / safe_filename

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
    print(" [+] KNOWLEDGE GRAPH SERVER (Python 3.14)")
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
