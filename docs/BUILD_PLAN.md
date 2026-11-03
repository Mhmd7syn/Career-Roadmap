# Roadmap Build Plan

## Core Rules
1. **Extreme Brevity:** Only actionable data needed to build or navigate. Bullet points and checklists only; no prose or fluff.
2. **Directory-as-Graph Architecture:** Every node in the graph is a folder inside `graph/`. Children are nested subfolders.
   - `node.json`: Metadata, child list, status, resources, recall prompts.
   - `summary.md`: Rich Markdown notes per node (bold, code, images, math).
3. **Structural Graph Depth (No Static L1/L2/L3):** Depth is derived organically from the graph tree structure ($d = 0, 1, 2, ...$). Going deeper simply means expanding and traversing deeper child nodes.
4. **BFS (Breadth-First Search) Learning Traversal:** The journey engine follows a pure BFS queue:
   - Completes all nodes at Depth 1 (the 360° macro survey across all parallel tracks) before advancing.
   - Once Depth 1 is completed, BFS dequeues Depth 2 children, then Depth 3, ensuring balanced parallel growth without getting stuck in a single branch.
5. **Progressive Information Depth (Macro Parent $\to$ Micro Child):** Each node provides high-level general information, mental models, and broad orientation for its topic. Granular implementation details, edge cases, and deep specifics are reserved strictly for its child nodes.
6. **Breadth Exhaustion Before Depth Progression:** Never advance or expand to a deeper level ($d+1$) until ensuring the current level ($d$) is completely populated with no remaining nodes to add across the breadth, unless the user explicitly requests to go deep into a specific node.
7. **Node Page Header Actions:** At the top of each node view (above the child roads), direct action buttons provide immediate access:
   - `[ ℹ️ Node Info & Details ]`
   - `[ 📝 Node Summary & Notes ]` (opens/edits `summary.md` with rich markdown).
   - Below these buttons, the child road lines/lanes are displayed.
8. **Dual-View Presentation:**
   - **Macro View (Parallel Swimlanes):** At the Tech domain level, all 4 parallel tracks (`Core CS`, `SWE`, `Data`, `AI`) sit side-by-side.
   - **Recursive Road View:** Clicking any node navigates into its view, displaying its header buttons and child roads.
9. **Python Local Server (`run.bat`):** Lightweight local runner (`server.py`) using Python 3.14 to eliminate CORS, serve markdown, and save edits directly to disk.
10. **Just-in-Time Child Expansion:** Create subfolders and child stations only when actively reached in the BFS traversal.
11. **Domain Encapsulation ("Tech" Super-Node):** Engineering tracks sit under `Tech`, leaving room for future peer domains (`Freelancing`, `Marketing`).
12. **Folder Hygiene & Paced Collaboration:** Clean directory always; never generate new platform files without proposing, discussing, and agreeing first.

---

## Action Checklist

### Stage 1: Directory-as-Graph & BFS Engine (Next Chat Priority)
- [x] Lock profile architecture (Tri-T / M-Shaped within Tech domain).
- [x] Lock platform: Local Canvas (`D:\Career Roadmap`).
- [x] Adopt Structural Graph Depth + BFS Traversal engine.
- [x] Adopt Node Header Actions (`[ ℹ️ Info ]`, `[ 📝 Summary ]` above child roads).
- [x] Create `graph/` folder tree (`node.json` + `summary.md` per node).
- [x] Build `server.py` and `run.bat` (Python 3.14) for live markdown read/write.
- [x] Integrate Marked.js for rich markdown rendering (bold, images, code, math).
- [x] Implement BFS Next-Up Traversal Queue in `app.js`.

### Stage 2: BFS Depth 1 Survey Tour
- [ ] Traverse all Depth 1 nodes across `Tech` parallel tracks via BFS queue.
- [ ] Save personal revision notes into `summary.md` on each completed station.

### Stage 3: BFS Depth 2 & Beyond
- [ ] Dequeue Depth 2 child nodes across parallel tracks.
- [ ] Build Milestone Fusion Projects at key checkpoints.
