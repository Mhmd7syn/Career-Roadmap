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
WEB_DIR = BASE_DIR / "web"
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
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def translate_path(self, path: str) -> str:
        """Route /graph/* directly to GRAPH_DIR and all presentation assets to WEB_DIR."""
        parsed = urllib.parse.urlparse(path)
        clean_path = urllib.parse.unquote(parsed.path)

        if clean_path.startswith("/graph/"):
            rel_graph = clean_path[7:].lstrip("/\\")
            target = (GRAPH_DIR / rel_graph).resolve()
            if target.is_relative_to(GRAPH_DIR.resolve()):
                return str(target)
            return str(GRAPH_DIR / "__invalid__")
        elif clean_path in ("/graph", "/graph/"):
            return str(GRAPH_DIR.resolve())

        return super().translate_path(path)

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

    @staticmethod
    def _slugify(name: str) -> str:
        """Generate URL/folder safe slug from station title or name."""
        cleaned = "".join(c if c.isalnum() else "-" for c in (name or "").lower()).strip("-")
        safe = "".join(c for c in cleaned if c.isalnum() or c in ("-", "_")).strip("-")
        return re.sub(r"-+", "-", safe)

    def _sync_markdown_h1(self, file_path: Path, new_title: str):
        """Update or insert the leading H1 markdown header."""
        if not file_path.exists():
            return
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            if re.search(r"^#\s+.*", content, flags=re.MULTILINE):
                new_content = re.sub(r"^#\s+.*", f"# {new_title}", content, count=1, flags=re.MULTILINE)
            else:
                new_content = f"# {new_title}\n\n" + content

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(new_content)
        except Exception as e:
            print(f"[Error updating H1 in {file_path}]: {e}", file=sys.stderr)

    def _update_shortcuts_for_relocated_node(self, old_rel: str, new_rel: str) -> list[str]:
        """Cascade path updates across all shortcut.json files referencing old_rel or its descendants."""
        if not old_rel or old_rel == new_rel:
            return []

        updated = []
        old_prefix = old_rel + "/"

        for root, dirs, files in os.walk(GRAPH_DIR):
            if "shortcut.json" in files:
                shortcut_path = Path(root) / "shortcut.json"
                try:
                    with open(shortcut_path, "r", encoding="utf-8") as f:
                        data = json.load(f)

                    target = data.get("target", "").strip().replace("\\", "/")
                    new_target = None

                    if target == old_rel:
                        new_target = new_rel
                    elif target.startswith(old_prefix):
                        new_target = new_rel + target[len(old_rel):]

                    if new_target is not None:
                        data["target"] = new_target
                        with open(shortcut_path, "w", encoding="utf-8") as f:
                            json.dump(data, f, indent=2)
                        rel_shortcut = shortcut_path.parent.relative_to(GRAPH_DIR).as_posix()
                        updated.append(rel_shortcut)
                        print(f"[Shortcut Cascade]: Updated {rel_shortcut} target -> '{new_target}'")
                except Exception as e:
                    print(f"[Error updating shortcut {shortcut_path}]: {e}", file=sys.stderr)

        return updated

    def _find_referencing_shortcuts(self, target_rel: str) -> list[str]:
        """Find all shortcut paths pointing to target_rel or its descendants."""
        if not target_rel:
            return []
        referencing = []
        target_prefix = target_rel + "/"

        for root, dirs, files in os.walk(GRAPH_DIR):
            if "shortcut.json" in files:
                shortcut_path = Path(root) / "shortcut.json"
                try:
                    with open(shortcut_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    target = data.get("target", "").strip().replace("\\", "/")
                    if target == target_rel or target.startswith(target_prefix):
                        rel = shortcut_path.parent.relative_to(GRAPH_DIR).as_posix()
                        referencing.append(rel)
                except Exception:
                    pass
        return referencing

    def _parse_info_md(self, info_path: Path, default_title: str) -> tuple[str, str, str, str]:
        """Extract title, badge, status, and priority from info.md, applying spaced repetition auto-decay."""
        title = default_title
        badge = ""
        status = "todo"
        priority = "normal"

        if not info_path.exists():
            return title, badge, status, priority

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

                if "priority" in stripped.lower():
                    m_prio = re.search(r"priority[:\*]+\s*([a-zA-Z0-9_\-]+)", stripped, re.IGNORECASE)
                    if m_prio:
                        cand_prio = m_prio.group(1).lower()
                        if cand_prio in ("high", "normal", "low"):
                            priority = cand_prio

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

            return title, badge, status, priority
        except Exception as e:
            print(f"[Warning parsing {info_path}]: {e}", file=sys.stderr)
            return default_title, badge, status, priority

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

        title, badge, status, priority = self._parse_info_md(info_file, default_title)

        # 1. Immediate subdirectories from canonical folder
        children = []
        if canonical_folder.exists() and canonical_folder.is_dir():
            subdirs = [d for d in canonical_folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
            for d in sorted(subdirs, key=lambda x: x.name.lower()):
                c_canonical, c_is_shortcut, c_target_rel = self._resolve_shortcut(d)
                c_title, c_badge, c_status, c_priority = self._parse_info_md(c_canonical / "info.md", d.name.replace("-", " ").replace("_", " ").title())
                has_subchildren = any(sd.is_dir() and not sd.name.startswith((".", "__")) for sd in c_canonical.iterdir()) if c_canonical.exists() else False
                children.append({
                    "id": d.name,
                    "title": c_title,
                    "badge": c_badge,
                    "status": c_status,
                    "priority": c_priority,
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
                    rel_to_graph = f.relative_to(GRAPH_DIR).as_posix()
                    extra_files.append({
                        "label": f.name,
                        "url": f"graph/{rel_to_graph}",
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
            "priority": priority,
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
            title, _, _, _ = self._parse_info_md(info_file, part.replace("-", " ").replace("_", " ").title())
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
        title, badge, status, priority = self._parse_info_md(info_file, default_title)

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
            "priority": priority,
            "relPath": rel_path,
            "isShortcut": is_shortcut,
            "canonicalRelPath": canonical_rel if is_shortcut else rel_path,
            "depth": depth,
            "hasChildren": len(children) > 0,
            "childCount": len(children),
            "totalDescendants": total_descendants,
            "children": children
        }

    def _extract_notes_dfs(self, folder: Path, depth: int = 0, visited_ancestors: set = None) -> list[dict]:
        """
        Pre-order Depth-First Search traversal gathering notes.md from folder and all nested descendants.
        Sequence: Active station first, then recursively traverses each child branch in alphabetical order.
        """
        if visited_ancestors is None:
            visited_ancestors = set()

        rel_path = folder.relative_to(GRAPH_DIR).as_posix() if folder != GRAPH_DIR else ""
        canonical_folder, is_shortcut, canonical_rel = self._resolve_shortcut(folder)

        default_title = folder.name.replace("-", " ").replace("_", " ").title() if rel_path else "Root"
        info_file = canonical_folder / "info.md"
        notes_file = canonical_folder / "notes.md"

        title, badge, status, priority = self._parse_info_md(info_file, default_title)

        notes_content = ""
        has_notes = False
        if notes_file.exists() and notes_file.is_file():
            try:
                with open(notes_file, "r", encoding="utf-8") as f:
                    notes_content = f.read().strip()
                if notes_content:
                    has_notes = True
            except Exception as e:
                print(f"[Warning reading notes {notes_file}]: {e}", file=sys.stderr)

        anchor = re.sub(r"[^a-zA-Z0-9_\-]+", "-", f"{rel_path or 'root'}-{title.lower()}").strip("-")

        # 1. Pre-order DFS: Include active node first
        results = [{
            "id": folder.name if rel_path else "root",
            "title": title,
            "badge": badge,
            "status": status,
            "priority": priority,
            "relPath": rel_path,
            "canonicalRelPath": canonical_rel if is_shortcut else rel_path,
            "isShortcut": is_shortcut,
            "depth": depth,
            "notes": notes_content,
            "hasNotes": has_notes,
            "anchor": anchor
        }]

        # 2. Descendants: Traverse children in alphabetical order recursively
        canonical_resolved = canonical_folder.resolve()
        if canonical_resolved not in visited_ancestors:
            next_ancestors = visited_ancestors | {canonical_resolved}
            if canonical_folder.exists() and canonical_folder.is_dir():
                subdirs = [d for d in canonical_folder.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
                for d in sorted(subdirs, key=lambda x: x.name.lower()):
                    results.extend(self._extract_notes_dfs(d, depth + 1, next_ancestors))

        return results

    def _compile_extracted_markdown(self, items: list[dict]) -> tuple[str, list[dict]]:
        """
        Compile DFS extracted notes items into a single coherent Markdown document
        with normalized heading hierarchy and table of contents metadata.
        """
        doc_lines = []
        toc = []

        for item in items:
            title = item["title"]
            depth = item["depth"]
            notes = item["notes"]
            anchor = item["anchor"]
            has_notes = item["hasNotes"]

            # Heading level scaled by depth (depth 0 is level 1 '#', depth 1 is level 2 '##', capped at 6)
            heading_level = min(depth + 1, 6)
            h_prefix = "#" * heading_level

            toc.append({
                "title": title,
                "depth": heading_level,
                "anchor": anchor,
                "hasNotes": has_notes,
                "relPath": item["relPath"]
            })

            doc_lines.append(f'<a id="{anchor}"></a>\n')
            doc_lines.append(f"{h_prefix} {title}\n")

            if has_notes:
                lines = notes.splitlines()
                start_idx = 0
                while start_idx < len(lines) and not lines[start_idx].strip():
                    start_idx += 1

                # If first line is a redundant # Title, skip it
                if start_idx < len(lines):
                    first_line = lines[start_idx].strip()
                    if first_line.startswith("# ") and (first_line[2:].strip().lower() == title.lower() or heading_level > 1):
                        start_idx += 1

                adjusted_lines = []
                for line in lines[start_idx:]:
                    m_head = re.match(r"^(#{1,6})\s+(.*)$", line)
                    if m_head:
                        orig_level = len(m_head.group(1))
                        new_level = min(heading_level + orig_level, 6)
                        adjusted_lines.append(f"{'#' * new_level} {m_head.group(2)}")
                    else:
                        adjusted_lines.append(line)

                doc_lines.append("\n".join(adjusted_lines))
            else:
                doc_lines.append("*No personal study notes recorded for this station yet.*")

            doc_lines.append("\n\n---\n")

        return "\n".join(doc_lines), toc

    CYCLE_PATTERN = ["high", "normal", "low", "high", "normal", "high"]
    CYCLE_SLOTS = ["high 1", "normal 1", "low 1", "high 2", "normal 2", "high 3"]
    _global_recommendation_step = 0

    def _load_recommendation_queue(self, scope: str = "") -> dict | None:
        """Load persisted recommendation queue from root node folder (.recommendation_queue.json)."""
        queue_file = GRAPH_DIR / ".recommendation_queue.json"
        if not queue_file.exists():
            return None
        try:
            with open(queue_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "scopes" in data:
                return data["scopes"].get(scope)
            if isinstance(data, dict) and data.get("scope") == scope:
                return data
            return None
        except Exception as e:
            print(f"[Warning reading recommendation queue]: {e}", file=sys.stderr)
            return None

    def _save_recommendation_queue(self, scope: str, queue_data: dict):
        """Save active recommendation queue to root node folder (.recommendation_queue.json)."""
        queue_file = GRAPH_DIR / ".recommendation_queue.json"
        try:
            all_data = {"scopes": {}}
            if queue_file.exists():
                try:
                    with open(queue_file, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                        if isinstance(existing, dict) and "scopes" in existing:
                            all_data = existing
                        elif isinstance(existing, dict) and "scope" in existing:
                            all_data["scopes"][existing["scope"]] = existing
                except Exception:
                    pass
            all_data["scopes"][scope] = queue_data
            with open(queue_file, "w", encoding="utf-8") as f:
                json.dump(all_data, f, indent=2)
        except Exception as e:
            print(f"[Warning saving recommendation queue]: {e}", file=sys.stderr)

    def _collect_uncompleted_candidates(self, start_dir: Path) -> tuple[list[dict], list[dict], list[dict]]:
        """
        Traverse the graph under start_dir via BFS and collect all uncompleted nodes partitioned by priority.
        Returns: (high_candidates, normal_candidates, low_candidates)
        """
        def get_subdirs(d: Path) -> list[Path]:
            if not d.exists() or not d.is_dir():
                return []
            subdirs = [p for p in d.iterdir() if p.is_dir() and not p.name.startswith((".", "__"))]
            return sorted(subdirs, key=lambda x: x.name.lower())

        canonical_start, is_start_sc, start_target_rel = self._resolve_shortcut(start_dir)
        visited_canonical = set()

        high_candidates = []
        normal_candidates = []
        low_candidates = []

        def build_candidate_node(dir_path: Path, is_curr: bool) -> dict:
            c_canon, is_sc, target_rel = self._resolve_shortcut(dir_path)
            info_file = c_canon / "info.md"
            default_t = dir_path.name.replace("-", " ").replace("_", " ").title() if dir_path != GRAPH_DIR else "Root"
            t, b, s, p = self._parse_info_md(info_file, default_t)
            breadcrumbs = self._build_breadcrumbs(dir_path)
            category = breadcrumbs[-2]["title"] if len(breadcrumbs) > 1 else "Root"
            rel_p = dir_path.relative_to(GRAPH_DIR).as_posix() if dir_path != GRAPH_DIR else ""
            return {
                "id": dir_path.name if dir_path != GRAPH_DIR else "root",
                "title": t,
                "badge": b,
                "status": s,
                "priority": p,
                "isShortcut": is_sc,
                "canonicalRelPath": target_rel if is_sc else rel_p,
                "relPath": rel_p,
                "category": category,
                "breadcrumbs": breadcrumbs,
                "isCurrentNode": is_curr
            }

        def bucket_candidate(cand: dict):
            prio = cand.get("priority", "normal")
            if prio == "high":
                high_candidates.append(cand)
            elif prio == "low":
                low_candidates.append(cand)
            else:
                normal_candidates.append(cand)

        # Scoped context: Check the current node first (if not root)
        if start_dir != GRAPH_DIR:
            visited_canonical.add(canonical_start.resolve())
            curr_cand = build_candidate_node(start_dir, is_curr=True)
            if curr_cand["status"] != "completed":
                bucket_candidate(curr_cand)

        # BFS queue over descendants
        queue = deque(get_subdirs(canonical_start))

        while queue:
            curr = queue.popleft()
            canonical_curr, is_sc, target_rel = self._resolve_shortcut(curr)
            resolved_canon = canonical_curr.resolve()
            if resolved_canon in visited_canonical:
                continue
            visited_canonical.add(resolved_canon)

            desc_cand = build_candidate_node(curr, is_curr=False)
            if desc_cand["status"] != "completed":
                bucket_candidate(desc_cand)

            queue.extend(get_subdirs(canonical_curr))

        return high_candidates, normal_candidates, low_candidates

    def _interleave_cadence_slots(self, high_list: list[dict], normal_list: list[dict], low_list: list[dict]) -> list[dict | None]:
        """
        Interleave candidates into 6-slot 3H+2N+1L cadence:
        [high 1, normal 1, low 1, high 2, normal 2, high 3]
        """
        slots = [None] * 6
        h_tmp = list(high_list)
        n_tmp = list(normal_list)
        l_tmp = list(low_list)

        if h_tmp: slots[0] = h_tmp.pop(0)  # high 1
        if n_tmp: slots[1] = n_tmp.pop(0)  # normal 1
        if l_tmp: slots[2] = l_tmp.pop(0)  # low 1
        if h_tmp: slots[3] = h_tmp.pop(0)  # high 2
        if n_tmp: slots[4] = n_tmp.pop(0)  # normal 2
        if h_tmp: slots[5] = h_tmp.pop(0)  # high 3

        return slots

    def _build_recommendation_queue_for_scope(self, start_dir: Path, existing: dict | None = None) -> dict:
        """
        Build or refresh the persistent recommendation queue for a scope:
        - Scans all uncompleted nodes into high, normal, low lists
        - Interleaves active pool into the 3H+2N+1L 6-slot batch
        - Preserves existing cadence progress (step and last_completed)
        """
        scope = start_dir.relative_to(GRAPH_DIR).as_posix() if start_dir != GRAPH_DIR else ""
        high_cands, normal_cands, low_cands = self._collect_uncompleted_candidates(start_dir)

        step = 0
        last_completed = None
        if existing and isinstance(existing, dict):
            step = existing.get("step", 0) % 6
            last_completed = existing.get("last_completed")

        # Check if existing has active slots with uncompleted stations
        old_slots = existing.get("slots", []) if existing else []
        uncompleted_in_old = 0
        active_paths = set()

        if old_slots:
            synced_slots = []
            for sl in old_slots:
                if not sl:
                    synced_slots.append(None)
                    continue
                sl_path = sl.get("relPath", "")
                sl_dir = GRAPH_DIR / sl_path if sl_path else GRAPH_DIR
                if not sl_dir.exists():
                    synced_slots.append(None)
                    continue
                c_canon, is_sc, target_rel = self._resolve_shortcut(sl_dir)
                t, b, s, p = self._parse_info_md(c_canon / "info.md", sl_dir.name)
                breadcrumbs = self._build_breadcrumbs(sl_dir)
                category = breadcrumbs[-2]["title"] if len(breadcrumbs) > 1 else "Root"
                node_obj = {
                    "id": sl_dir.name if sl_dir != GRAPH_DIR else "root",
                    "title": t,
                    "badge": b,
                    "status": s,
                    "priority": p,
                    "isShortcut": is_sc,
                    "canonicalRelPath": target_rel if is_sc else sl_path,
                    "relPath": sl_path,
                    "category": category,
                    "breadcrumbs": breadcrumbs,
                    "isCurrentNode": (sl_dir == start_dir)
                }
                synced_slots.append(node_obj)
                if s != "completed":
                    uncompleted_in_old += 1
                    active_paths.add(sl_path)
            old_slots = synced_slots

        # If we have an active batch with uncompleted stations, preserve their slot assignments
        # while accommodating any priority changes or empty slots
        if uncompleted_in_old > 0:
            slots = list(old_slots)
            # Check for priority changes: if a station's priority changed, relocate it
            for idx, sl in enumerate(slots):
                if sl and sl.get("status") != "completed":
                    expected_prio = self.CYCLE_PATTERN[idx]
                    actual_prio = sl.get("priority", "normal")
                    if actual_prio != expected_prio:
                        target_indices = [i for i, p in enumerate(self.CYCLE_PATTERN) if p == actual_prio and (slots[i] is None or slots[i].get("status") == "completed")]
                        if target_indices:
                            target_idx = target_indices[0]
                            slots[idx] = None
                            slots[target_idx] = sl

            # Fill empty slots (slots that are None) from uncompleted candidates of that priority
            for idx in range(6):
                if slots[idx] is None:
                    target_prio = self.CYCLE_PATTERN[idx]
                    cand_pool = high_cands if target_prio == "high" else (low_cands if target_prio == "low" else normal_cands)
                    for cand in cand_pool:
                        if cand["relPath"] not in active_paths:
                            slots[idx] = cand
                            active_paths.add(cand["relPath"])
                            break
        else:
            slots = self._interleave_cadence_slots(high_cands, normal_cands, low_cands)

        next_slot = self.CYCLE_SLOTS[step]

        return {
            "scope": scope,
            "step": step,
            "last_completed": last_completed,
            "next_slot": next_slot,
            "queues": {
                "high": high_cands,
                "normal": normal_cands,
                "low": low_cands
            },
            "slots": slots,
            "createdAt": existing.get("createdAt") if (existing and "createdAt" in existing) else datetime.now().isoformat(),
            "updatedAt": datetime.now().isoformat()
        }

    def _refresh_all_recommendation_queues(self):
        """
        Refresh active recommendation queues across all scopes after any node modification
        (priority update, node added, renamed, moved, or deleted).
        """
        queue_file = GRAPH_DIR / ".recommendation_queue.json"
        scopes_to_refresh = {""}
        all_data = {"scopes": {}}

        if queue_file.exists():
            try:
                with open(queue_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and "scopes" in data:
                    all_data = data
                    for s in data["scopes"]:
                        scopes_to_refresh.add(s)
                elif isinstance(data, dict) and "scope" in data:
                    scopes_to_refresh.add(data["scope"])
            except Exception:
                pass

        for sc in list(scopes_to_refresh):
            sc_dir = GRAPH_DIR / sc if sc else GRAPH_DIR
            if sc_dir.exists() and sc_dir.is_dir():
                curr_state = all_data.get("scopes", {}).get(sc)
                refreshed = self._build_recommendation_queue_for_scope(sc_dir, curr_state)
                all_data.setdefault("scopes", {})[sc] = refreshed
            elif sc in all_data.get("scopes", {}):
                del all_data["scopes"][sc]

        try:
            with open(queue_file, "w", encoding="utf-8") as f:
                json.dump(all_data, f, indent=2)
        except Exception as e:
            print(f"[Warning saving refreshed recommendation queue]: {e}", file=sys.stderr)

    def _record_node_completion(self, node_dir: Path):
        """
        Advance cadence step and update last_completed slot when a station is marked completed.
        """
        rel_p = node_dir.relative_to(GRAPH_DIR).as_posix() if node_dir != GRAPH_DIR else ""
        c_canon, _, _ = self._resolve_shortcut(node_dir)
        _, _, _, prio = self._parse_info_md(c_canon / "info.md", node_dir.name)
        prio = prio.lower() if prio in ("high", "normal", "low") else "normal"

        queue_file = GRAPH_DIR / ".recommendation_queue.json"
        all_data = {"scopes": {}}
        if queue_file.exists():
            try:
                with open(queue_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and "scopes" in data:
                    all_data = data
            except Exception:
                pass

        if "" not in all_data.get("scopes", {}):
            all_data.setdefault("scopes", {})[""] = self._build_recommendation_queue_for_scope(GRAPH_DIR)

        for sc, sc_data in all_data.get("scopes", {}).items():
            if sc == "" or rel_p == sc or rel_p.startswith(sc + "/"):
                slots = sc_data.get("slots", [])
                curr_step = sc_data.get("step", 0) % 6
                matched_idx = None
                for idx, sl in enumerate(slots):
                    if sl and sl.get("relPath") == rel_p:
                        matched_idx = idx
                        break

                if matched_idx is not None:
                    completed_slot = self.CYCLE_SLOTS[matched_idx]
                    next_step = (matched_idx + 1) % 6
                else:
                    target_idx = curr_step
                    for offset in range(6):
                        chk = (curr_step + offset) % 6
                        if self.CYCLE_PATTERN[chk] == prio:
                            target_idx = chk
                            break
                    completed_slot = self.CYCLE_SLOTS[target_idx]
                    next_step = (target_idx + 1) % 6

                sc_data["last_completed"] = completed_slot
                sc_data["step"] = next_step
                sc_data["next_slot"] = self.CYCLE_SLOTS[next_step]
                GraphRequestHandler._global_recommendation_step = next_step

        try:
            with open(queue_file, "w", encoding="utf-8") as f:
                json.dump(all_data, f, indent=2)
        except Exception as e:
            print(f"[Warning saving completed recommendation state]: {e}", file=sys.stderr)

        self._refresh_all_recommendation_queues()

    def _find_next_node_bfs(self, start_dir: Path, step: int | None = None) -> dict:
        """
        Priority-weighted recommendation engine:
        - Manages persistent queue of all stations partitioned into high, normal, low.
        - Refreshes on priority edits, node additions, deletions, renames, and moves.
        - Tracks last_completed slot (e.g. 'high 1', 'normal 1', 'high 2') and advances cadence.
        - Interleaves active batch into 3H+2N+1L cadence: [high 1, normal 1, low 1, high 2, normal 2, high 3].
        - Selects candidate based on cadence step (with graceful circular fallbacks).
        """
        if not start_dir.exists() or not start_dir.is_dir():
            s_val = (step % 6) if step is not None else 0
            return {
                "found": False,
                "isCurrentNode": False,
                "allCompleted": False,
                "node": None,
                "pool": [],
                "cycleStep": s_val,
                "cycleTarget": self.CYCLE_PATTERN[s_val],
                "cycleSlot": self.CYCLE_SLOTS[s_val],
                "lastCompletedSlot": None,
                "nextSlot": self.CYCLE_SLOTS[(s_val + 1) % 6],
                "cyclePattern": self.CYCLE_PATTERN,
                "cycleSlots": self.CYCLE_SLOTS,
                "poolCounts": {"high": 0, "normal": 0, "low": 0},
                "totalCandidates": 0,
                "message": "Station directory does not exist."
            }

        scope = start_dir.relative_to(GRAPH_DIR).as_posix() if start_dir != GRAPH_DIR else ""
        existing = self._load_recommendation_queue(scope)

        if not existing or "slots" not in existing or "queues" not in existing:
            existing = self._build_recommendation_queue_for_scope(start_dir)
            self._save_recommendation_queue(scope, existing)

        # Validate saved slots against disk state
        saved_slots = existing.get("slots", [])
        validated_slots = []
        uncompleted_in_batch = 0

        for item in saved_slots:
            if not item:
                validated_slots.append(None)
                continue

            rel_p = item.get("relPath", "")
            node_dir = GRAPH_DIR / rel_p if rel_p else GRAPH_DIR
            if not node_dir.exists():
                validated_slots.append(None)
                continue

            c_canon, is_sc, target_rel = self._resolve_shortcut(node_dir)
            info_file = c_canon / "info.md"
            default_t = node_dir.name.replace("-", " ").replace("_", " ").title() if node_dir != GRAPH_DIR else "Root"
            t, b, s, p = self._parse_info_md(info_file, default_t)
            breadcrumbs = self._build_breadcrumbs(node_dir)
            category = breadcrumbs[-2]["title"] if len(breadcrumbs) > 1 else "Root"

            node_obj = {
                "id": node_dir.name if node_dir != GRAPH_DIR else "root",
                "title": t,
                "badge": b,
                "status": s,
                "priority": p,
                "isShortcut": is_sc,
                "canonicalRelPath": target_rel if is_sc else rel_p,
                "relPath": rel_p,
                "category": category,
                "breadcrumbs": breadcrumbs,
                "isCurrentNode": (node_dir == start_dir)
            }
            validated_slots.append(node_obj)
            if s != "completed":
                uncompleted_in_batch += 1

        # If active batch is completely depleted, refill next batch from remaining uncompleted candidates
        if uncompleted_in_batch == 0:
            existing = self._build_recommendation_queue_for_scope(start_dir, existing)
            self._save_recommendation_queue(scope, existing)
            validated_slots = existing.get("slots", [])
            uncompleted_in_batch = sum(1 for s in validated_slots if s and s.get("status") != "completed")

        active_pool = [s for s in validated_slots if s is not None and s.get("status") != "completed"]

        if not active_pool:
            s_val = (step % 6) if step is not None else (existing.get("step", 0) % 6)
            return {
                "found": False,
                "isCurrentNode": False,
                "allCompleted": True,
                "node": None,
                "pool": [],
                "cycleStep": s_val,
                "cycleTarget": self.CYCLE_PATTERN[s_val],
                "cycleSlot": self.CYCLE_SLOTS[s_val],
                "lastCompletedSlot": existing.get("last_completed"),
                "nextSlot": existing.get("next_slot", self.CYCLE_SLOTS[(s_val + 1) % 6]),
                "cyclePattern": self.CYCLE_PATTERN,
                "cycleSlots": self.CYCLE_SLOTS,
                "poolCounts": {"high": 0, "normal": 0, "low": 0},
                "totalCandidates": 0,
                "message": "All stations in this section completed!"
            }

        req_step = (step % 6) if step is not None else (existing.get("step", 0) % 6)

        # Select candidate for requested step with graceful wrap fallback
        recommended = None
        effective_step = req_step
        for offset in range(6):
            check_idx = (req_step + offset) % 6
            cand = validated_slots[check_idx] if check_idx < len(validated_slots) else None
            if cand and cand.get("status") != "completed":
                recommended = cand
                effective_step = check_idx
                break

        if recommended is None:
            recommended = active_pool[0]
            effective_step = req_step

        existing["slots"] = validated_slots
        self._save_recommendation_queue(scope, existing)

        high_count = sum(1 for s in active_pool if s.get("priority") == "high")
        normal_count = sum(1 for s in active_pool if s.get("priority") == "normal")
        low_count = sum(1 for s in active_pool if s.get("priority") == "low")

        q_dict = existing.get("queues", {})
        total_candidates = sum(len(q_dict.get(k, [])) for k in ("high", "normal", "low")) or len(active_pool)

        return {
            "found": True,
            "isCurrentNode": recommended.get("isCurrentNode", False) if recommended else False,
            "allCompleted": False,
            "node": recommended,
            "pool": active_pool,
            "cycleStep": effective_step,
            "cycleTarget": self.CYCLE_PATTERN[effective_step],
            "cycleSlot": self.CYCLE_SLOTS[effective_step],
            "lastCompletedSlot": existing.get("last_completed"),
            "nextSlot": existing.get("next_slot", self.CYCLE_SLOTS[(effective_step + 1) % 6]),
            "cyclePattern": self.CYCLE_PATTERN,
            "cycleSlots": self.CYCLE_SLOTS,
            "poolCounts": {
                "high": high_count,
                "normal": normal_count,
                "low": low_count
            },
            "queueCounts": {
                "high": len(q_dict.get("high", [])),
                "normal": len(q_dict.get("normal", [])),
                "low": len(q_dict.get("low", []))
            },
            "queues": q_dict,
            "totalCandidates": total_candidates,
            "isPersistedBatch": True
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

            title, badge, status, priority = self._parse_info_md(info_file, default_title)
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
                    "priority": priority,
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

    def _update_priority_in_info_md(self, info_path: Path, new_priority: str):
        valid = {"high", "normal", "low"}
        prio = str(new_priority).lower().strip() if new_priority else "normal"
        if prio not in valid:
            prio = "normal"

        if not info_path.exists():
            fallback_title = info_path.parent.name.replace("-", " ").replace("_", " ").title()
            with open(info_path, "w", encoding="utf-8") as f:
                f.write(f"# {fallback_title}\n\n**Status:** todo\n**Priority:** {prio}\n")
            return

        try:
            with open(info_path, "r", encoding="utf-8") as f:
                content = f.read()

            pattern = re.compile(r"(\*\*Priority:\*\*\s*)([a-zA-Z0-9_\-]+)", re.IGNORECASE)
            if pattern.search(content):
                updated = pattern.sub(rf"\g<1>{prio}", content)
            else:
                pattern2 = re.compile(r"(priority:\s*)([a-zA-Z0-9_\-]+)", re.IGNORECASE)
                if pattern2.search(content):
                    updated = pattern2.sub(rf"\g<1>{prio}", content)
                else:
                    stat_match = re.search(r"(\*\*Status:\*\*[^\n]*)", content, re.IGNORECASE)
                    if stat_match:
                        updated = content[:stat_match.end()] + f"\n**Priority:** {prio}" + content[stat_match.end():]
                    else:
                        lines = content.splitlines()
                        insert_idx = 1 if len(lines) > 1 else len(lines)
                        lines.insert(insert_idx, f"**Priority:** {prio}")
                        updated = "\n".join(lines)

            with open(info_path, "w", encoding="utf-8") as f:
                f.write(updated)
        except Exception as e:
            print(f"[Error updating priority in {info_path}]: {e}", file=sys.stderr)

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

        # 7. API: Pre-order DFS Consolidated Notes Extraction
        if path == "/api/extract-notes":
            self._handle_api_extract_notes(parsed.query)
            return

        # 8. API: Real-time Node & Graph Version for Automatic Refresh
        if path == "/api/version":
            self._handle_api_get_version(parsed.query)
            return

        # Fallback graph
        if path in ("/api/graph", "/api/graph/"):
            self._handle_api_get_root()
            return

        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
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

    def _handle_api_get_version(self, query_string: str):
        """Ultra-fast mtime signature generator for live automatic refresh."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]
        modal_path_param = params.get("modalPath", [""])[0]

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            mtimes = []

            if canonical_dir.exists() and canonical_dir.is_dir():
                mtimes.append(int(canonical_dir.stat().st_mtime))
                for fname in ("info.md", "notes.md", "shortcut.json"):
                    f = canonical_dir / fname
                    if f.exists():
                        mtimes.append(int(f.stat().st_mtime))

                subdirs = [d for d in canonical_dir.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
                mtimes.append(len(subdirs))
                for d in subdirs:
                    mtimes.append(int(d.stat().st_mtime))
                    c_can, _, _ = self._resolve_shortcut(d)
                    c_info = c_can / "info.md"
                    if c_info.exists():
                        mtimes.append(int(c_info.stat().st_mtime))

            modal_version = 0
            if modal_path_param and modal_path_param != node_path_param:
                modal_dir = self._resolve_graph_folder(modal_path_param)
                m_canonical, _, _ = self._resolve_shortcut(modal_dir)
                if m_canonical.exists():
                    m_info = m_canonical / "info.md"
                    m_notes = m_canonical / "notes.md"
                    modal_version = int((m_info.stat().st_mtime if m_info.exists() else 0) + (m_notes.stat().st_mtime if m_notes.exists() else 0))

            queue_file = GRAPH_DIR / ".recommendation_queue.json"
            q_mtime = int(queue_file.stat().st_mtime) if queue_file.exists() else 0

            version_token = f"{sum(mtimes)}:{len(mtimes)}:{modal_version}:{q_mtime}"
            self._send_json(200, {"version": version_token})
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
                    _, _, status, _ = self._parse_info_md(info_file, rpath.name)
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
            title, _, _, priority = self._parse_info_md(rpath / "info.md", rpath.name.replace("-", " ").replace("_", " ").title())
            stations.append({
                "title": title,
                "relPath": rel,
                "priority": priority
            })
        stations.sort(key=lambda s: s["title"].lower())
        self._send_json(200, {"stations": stations})

    def _handle_api_get_next_node(self, query_string: str):
        """Find the next uncompleted station using priority-weighted BFS from the requested node."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]
        raw_step = params.get("step", [None])[0]

        if raw_step is not None and str(raw_step).strip().isdigit():
            step = int(raw_step) % 6
        else:
            step = None

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            result = self._find_next_node_bfs(node_dir, step=step)
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

    def _handle_api_extract_notes(self, query_string: str):
        """API handler for pre-order DFS notes extraction into consolidated markdown."""
        params = urllib.parse.parse_qs(query_string)
        node_path_param = params.get("path", [""])[0]

        try:
            node_dir = self._resolve_graph_folder(node_path_param)
            items = self._extract_notes_dfs(node_dir)
            markdown_doc, toc = self._compile_extracted_markdown(items)

            root_title = items[0]["title"] if items else "Study Notes"
            notes_count = sum(1 for it in items if it["hasNotes"])

            self._send_json(200, {
                "success": True,
                "rootTitle": root_title,
                "relPath": node_path_param,
                "stationCount": len(items),
                "notesCount": notes_count,
                "markdown": markdown_doc,
                "toc": toc
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
        elif path == "/api/save-priority":
            self._handle_save_priority(payload)
        elif path == "/api/add-child":
            self._handle_add_child(payload)
        elif path == "/api/rename-node":
            self._handle_rename_node(payload)
        elif path == "/api/delete-node":
            self._handle_delete_node(payload)
        elif path == "/api/move-node":
            self._handle_move_node(payload)
        elif path == "/api/share-node":
            self._handle_share_node(payload)
        elif path in ("/api/upload-extra-file", "/api/upload-resource"):
            self._handle_upload_extra_file(payload)
        else:
            self._send_json(404, {"error": "API route not found"})

    def _handle_save_info(self, payload: dict):
        raw_path = payload.get("path", "")
        content = payload.get("content", "")
        priority = payload.get("priority")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            canonical_dir.mkdir(parents=True, exist_ok=True)
            info_file = canonical_dir / "info.md"

            if priority and str(priority).lower().strip() in ("high", "normal", "low"):
                prio = str(priority).lower().strip()
                patt = re.compile(r"(\*\*Priority:\*\*\s*)([a-zA-Z0-9_\-]+)", re.IGNORECASE)
                if patt.search(content):
                    content = patt.sub(rf"\g<1>{prio}", content)
                else:
                    patt2 = re.compile(r"(priority:\s*)([a-zA-Z0-9_\-]+)", re.IGNORECASE)
                    if patt2.search(content):
                        content = patt2.sub(rf"\g<1>{prio}", content)
                    else:
                        stat_match = re.search(r"(\*\*Status:\*\*[^\n]*)", content, re.IGNORECASE)
                        if stat_match:
                            content = content[:stat_match.end()] + f"\n**Priority:** {prio}" + content[stat_match.end():]
                        else:
                            lines = content.splitlines()
                            insert_idx = 1 if len(lines) > 1 else len(lines)
                            lines.insert(insert_idx, f"**Priority:** {prio}")
                            content = "\n".join(lines)

            with open(info_file, "w", encoding="utf-8") as f:
                f.write(content)

            self._refresh_all_recommendation_queues()
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
            if status == "completed":
                self._record_node_completion(node_dir)
            else:
                self._refresh_all_recommendation_queues()
            print(f"[Status Saved in info.md]: {info_file} -> {status}")

            self._send_json(200, {
                "success": True,
                "message": f"Status updated to '{status}'",
                "node": self._scan_single_node(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_save_priority(self, payload: dict):
        raw_path = payload.get("path", "")
        priority = payload.get("priority", "normal")

        try:
            node_dir = self._resolve_graph_folder(raw_path)
            canonical_dir, _, _ = self._resolve_shortcut(node_dir)
            info_file = canonical_dir / "info.md"

            self._update_priority_in_info_md(info_file, priority)
            self._refresh_all_recommendation_queues()
            print(f"[Priority Saved in info.md]: {info_file} -> {priority}")

            self._send_json(200, {
                "success": True,
                "message": f"Priority updated to '{priority}'",
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

                safe_child_id = self._slugify(name) or target_dir.name

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

                self._refresh_all_recommendation_queues()
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

            safe_child_id = self._slugify(name)

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

            self._refresh_all_recommendation_queues()
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

            rel_to_graph = target_file.relative_to(GRAPH_DIR).as_posix()
            print(f"[Extra File Uploaded]: {target_file} ({len(file_bytes)} bytes)")
            self._send_json(200, {
                "success": True,
                "message": f"File '{safe_filename}' saved to folder",
                "file": {
                    "label": safe_filename,
                    "url": f"graph/{rel_to_graph}",
                    "size": len(file_bytes),
                    "ext": target_file.suffix.lstrip(".").lower()
                },
                "node": self._scan_single_node(node_dir)
            })
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_rename_node(self, payload: dict):
        raw_path = payload.get("path", "").strip()
        new_title = payload.get("newTitle", "").strip()
        new_slug = payload.get("newSlug", "").strip()

        if not raw_path or raw_path in ("root", ".", ""):
            self._send_json(400, {"error": "Root station cannot be renamed"})
            return

        safe_slug = self._slugify(new_slug) if new_slug else self._slugify(new_title)
        if not safe_slug:
            self._send_json(400, {"error": "Valid new title or slug is required"})
            return

        try:
            source_dir = self._resolve_graph_folder(raw_path)
            if not source_dir.exists() or not source_dir.is_dir():
                self._send_json(404, {"error": f"Station folder not found at '{raw_path}'"})
                return

            if source_dir.resolve() == GRAPH_DIR.resolve():
                self._send_json(400, {"error": "Root station cannot be renamed"})
                return

            parent_dir = source_dir.parent
            dest_dir = parent_dir / safe_slug
            old_rel = source_dir.relative_to(GRAPH_DIR).as_posix()
            new_rel = dest_dir.relative_to(GRAPH_DIR).as_posix()

            is_shortcut = (source_dir / "shortcut.json").exists()

            # Collision check (handle case-only renames on Windows NTFS safely)
            if dest_dir.exists() and source_dir.resolve() != dest_dir.resolve():
                self._send_json(400, {"error": f"Station named '{safe_slug}' already exists in parent"})
                return

            # Rename directory on disk if slug changed
            if source_dir.resolve() == dest_dir.resolve() and source_dir.name != dest_dir.name:
                temp_dir = parent_dir / f"__temp_{os.getpid()}_{dest_dir.name}"
                source_dir.rename(temp_dir)
                temp_dir.rename(dest_dir)
            elif source_dir != dest_dir:
                source_dir.rename(dest_dir)

            affected_shortcuts = []
            if not is_shortcut:
                if new_title:
                    self._sync_markdown_h1(dest_dir / "info.md", new_title)
                    self._sync_markdown_h1(dest_dir / "notes.md", new_title)
                if old_rel != new_rel:
                    affected_shortcuts = self._update_shortcuts_for_relocated_node(old_rel, new_rel)

            print(f"[Node Renamed]: {old_rel} -> {new_rel} (is_shortcut={is_shortcut})")
            self._refresh_all_recommendation_queues()
            self._send_json(200, {
                "success": True,
                "message": f"Station renamed to '{safe_slug}'",
                "oldPath": old_rel,
                "newPath": new_rel,
                "isShortcut": is_shortcut,
                "affectedShortcuts": affected_shortcuts,
                "node": self._scan_single_node(dest_dir)
            })
        except PermissionError as pe:
            self._send_json(403, {"error": str(pe)})
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_delete_node(self, payload: dict):
        raw_path = payload.get("path", "").strip()
        force = bool(payload.get("force", False))

        if not raw_path or raw_path in ("root", ".", ""):
            self._send_json(400, {"error": "Root station cannot be deleted"})
            return

        try:
            target_dir = self._resolve_graph_folder(raw_path)
            if not target_dir.exists() or not target_dir.is_dir():
                self._send_json(404, {"error": f"Station folder not found at '{raw_path}'"})
                return

            if target_dir.resolve() == GRAPH_DIR.resolve():
                self._send_json(400, {"error": "Root station cannot be deleted"})
                return

            rel_path = target_dir.relative_to(GRAPH_DIR).as_posix()
            is_shortcut = (target_dir / "shortcut.json").exists()

            if is_shortcut:
                shutil.rmtree(target_dir)
                self._refresh_all_recommendation_queues()
                print(f"[Shortcut Deleted]: {rel_path}")
                self._send_json(200, {
                    "success": True,
                    "message": f"Shortcut pointer '{rel_path}' deleted",
                    "deletedPath": rel_path,
                    "isShortcut": True,
                    "childCount": 0,
                    "fileCount": 0,
                    "affectedShortcuts": []
                })
                return

            # Canonical station deletion checks
            subdirs = [d for d in target_dir.iterdir() if d.is_dir() and not d.name.startswith((".", "__"))]
            extra_files = [f for f in target_dir.iterdir() if f.is_file() and f.name not in CORE_NODE_FILES and f.name not in IGNORED_SYSTEM_FILES and not f.name.startswith(".")]
            referencing_shortcuts = self._find_referencing_shortcuts(rel_path)

            has_dependents = bool(subdirs or extra_files or referencing_shortcuts)
            if has_dependents and not force:
                self._send_json(409, {
                    "error": "Station contains sub-stations, extra files, or active shortcut links",
                    "requiresForce": True,
                    "childCount": len(subdirs),
                    "fileCount": len(extra_files),
                    "referencingShortcuts": referencing_shortcuts
                })
                return

            shutil.rmtree(target_dir)
            cleaned_shortcuts = []
            for sc_rel in referencing_shortcuts:
                sc_dir = GRAPH_DIR / sc_rel
                if sc_dir.exists() and (sc_dir / "shortcut.json").exists():
                    try:
                        shutil.rmtree(sc_dir)
                        cleaned_shortcuts.append(sc_rel)
                    except Exception as e:
                        print(f"[Warning: Failed to clean dangling shortcut {sc_rel}]: {e}", file=sys.stderr)

            self._refresh_all_recommendation_queues()
            print(f"[Node Deleted]: {rel_path} (force={force}, cleaned_shortcuts={len(cleaned_shortcuts)})")
            self._send_json(200, {
                "success": True,
                "message": f"Station '{rel_path}' deleted",
                "deletedPath": rel_path,
                "isShortcut": False,
                "childCount": len(subdirs),
                "fileCount": len(extra_files),
                "affectedShortcuts": referencing_shortcuts,
                "cleanedShortcuts": cleaned_shortcuts
            })
        except PermissionError as pe:
            self._send_json(403, {"error": str(pe)})
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_move_node(self, payload: dict):
        source_path = payload.get("sourcePath", "").strip()
        new_parent_path = payload.get("newParentPath", "").strip()

        if not source_path or source_path in ("root", ".", ""):
            self._send_json(400, {"error": "Root station cannot be moved"})
            return

        try:
            source_dir = self._resolve_graph_folder(source_path)
            if not source_dir.exists() or not source_dir.is_dir():
                self._send_json(404, {"error": f"Source station not found at '{source_path}'"})
                return

            if source_dir.resolve() == GRAPH_DIR.resolve():
                self._send_json(400, {"error": "Root station cannot be moved"})
                return

            new_parent_dir = self._resolve_graph_folder(new_parent_path)
            if not new_parent_dir.exists() or not new_parent_dir.is_dir():
                self._send_json(404, {"error": f"Target parent station not found at '{new_parent_path}'"})
                return

            canonical_parent, _, _ = self._resolve_shortcut(new_parent_dir)

            src_res = source_dir.resolve()
            parent_res = canonical_parent.resolve()

            if src_res == parent_res:
                self._send_json(400, {"error": "Cannot move a station into itself"})
                return

            if parent_res.is_relative_to(src_res):
                self._send_json(400, {"error": "Cannot move a station into one of its own sub-stations (cycle detected)"})
                return

            if source_dir.parent.resolve() == parent_res:
                self._send_json(400, {"error": "Station is already located in this parent hub"})
                return

            dest_dir = canonical_parent / source_dir.name
            if dest_dir.exists():
                self._send_json(400, {"error": f"Station named '{source_dir.name}' already exists in destination parent"})
                return

            old_rel = source_dir.relative_to(GRAPH_DIR).as_posix()
            is_shortcut = (source_dir / "shortcut.json").exists()

            shutil.move(str(source_dir), str(dest_dir))
            new_rel = dest_dir.relative_to(GRAPH_DIR).as_posix()

            affected_shortcuts = []
            if not is_shortcut:
                affected_shortcuts = self._update_shortcuts_for_relocated_node(old_rel, new_rel)

            print(f"[Node Moved]: {old_rel} -> {new_rel} (affected_shortcuts={len(affected_shortcuts)})")
            self._refresh_all_recommendation_queues()
            self._send_json(200, {
                "success": True,
                "message": f"Station moved to '{new_rel}'",
                "oldPath": old_rel,
                "newPath": new_rel,
                "isShortcut": is_shortcut,
                "affectedShortcuts": affected_shortcuts,
                "node": self._scan_single_node(dest_dir)
            })
        except PermissionError as pe:
            self._send_json(403, {"error": str(pe)})
        except Exception as e:
            self._send_json(400, {"error": str(e)})

    def _handle_share_node(self, payload: dict):
        target_path = payload.get("targetPath", "").strip()
        parent_path = payload.get("parentPath", "").strip()
        custom_name = payload.get("name", "").strip()

        if not target_path or target_path in ("root", ".", ""):
            self._send_json(400, {"error": "Cannot share the root station"})
            return

        try:
            target_dir = self._resolve_graph_folder(target_path)
            if not target_dir.exists() or not target_dir.is_dir():
                self._send_json(404, {"error": f"Target station not found at '{target_path}'"})
                return

            canonical_target, _, _ = self._resolve_shortcut(target_dir)
            if canonical_target.resolve() == GRAPH_DIR.resolve():
                self._send_json(400, {"error": "Cannot create shortcut pointing to root"})
                return

            parent_dir = self._resolve_graph_folder(parent_path)
            if not parent_dir.exists() or not parent_dir.is_dir():
                self._send_json(404, {"error": f"Destination parent not found at '{parent_path}'"})
                return

            canonical_parent, _, _ = self._resolve_shortcut(parent_dir)

            if canonical_target.resolve() == canonical_parent.resolve():
                self._send_json(400, {"error": "Cannot create shortcut pointing to the parent station itself"})
                return

            slug_base = custom_name if custom_name else target_dir.name
            safe_slug = self._slugify(slug_base)
            if not safe_slug:
                safe_slug = target_dir.name

            shortcut_dir = canonical_parent / safe_slug
            if shortcut_dir.exists():
                self._send_json(400, {"error": f"Station or shortcut named '{safe_slug}' already exists under destination parent"})
                return

            shortcut_dir.mkdir(parents=True, exist_ok=True)
            canonical_target_rel = canonical_target.relative_to(GRAPH_DIR).as_posix()
            shortcut_data = {
                "target": canonical_target_rel
            }
            with open(shortcut_dir / "shortcut.json", "w", encoding="utf-8") as f:
                json.dump(shortcut_data, f, indent=2)

            print(f"[Node Shared]: Created shortcut at {shortcut_dir} pointing to {canonical_target_rel}")
            self._refresh_all_recommendation_queues()
            self._send_json(200, {
                "success": True,
                "message": f"Shortcut created pointing to '{canonical_target_rel}'",
                "shortcutPath": shortcut_dir.relative_to(GRAPH_DIR).as_posix(),
                "canonicalPath": canonical_target_rel,
                "node": self._scan_single_node(shortcut_dir)
            })
        except PermissionError as pe:
            self._send_json(403, {"error": str(pe)})
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
    print(f" Serving web app from : {WEB_DIR}")
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
