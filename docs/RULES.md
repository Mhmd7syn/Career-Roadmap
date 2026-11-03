# Master System Rules

## 1. Directory-as-Graph Architecture
- Every node is a folder under `graph/`. Children are nested subfolders.
- Every node contains `node.json` (metadata, depth, status, child list, resources, recall prompts) and `summary.md` (rich notes with bold, code, math, diagrams).
- Depth is organic tree depth ($d=0, 1, 2, ...$), not static L1/L2/L3 badges.

## 2. Progressive Information Depth
- **Macro Parent $\to$ Micro Child:** A node contains general information, high-level orientation, and mental models about its topic.
- Deep specifics, implementation mechanics, and granular details belong strictly in its child subfolders.

## 3. Breadth Exhaustion Before Depth Progression
- Never advance or drill down to a new depth level ($d+1$) until the current level ($d$) is completely populated with no remaining nodes to add across the breadth—unless explicitly requested for a specific node.

## 4. Leaf-Node Learning Frontier
- Active study, note taking in `summary.md`, and recall checks occur strictly on active **leaf nodes** of the tree.
- Learning never occurs on branch hubs; branch hubs represent aggregated structures.

## 5. Parent-Child Status Cascading & Expansion Lifecycle
- **Level-by-Level Building:** Build level-by-level. A node is studied and completed as a leaf node first.
- **Child Expansion:** When returning to a completed node, its child nodes are created.
- **Adding Children:** Automatically converts the parent from `completed` to `in-progress`.
- **All Children Done:** When all children of a parent are `completed`, the parent automatically becomes `completed`.
- **Child Regression:** If any child is reverted to `todo` or `in-progress`, the parent immediately reverts to `in-progress`.

## 6. BFS Traversal Engine
- Recommendation queue follows Breadth-First Search:
  - Phase 1: Completes all Depth 1 parallel tracks (`Core CS` $\to$ `SWE` $\to$ `Data` $\to$ `AI` $\to$ `Fusion`).
  - Phase 2: Once Depth 1 is completed, expands and dequeues Depth 2 children round-robin across tracks.
  - Phase 3: Progresses to Depth 3+ granular specializations.

## 7. Context-Aware Learning Progression (Local Branch vs Global BFS)
- **Macro View (`root`/`tech`):** The recommendation engine points to the **Global BFS frontier** (balanced round-robin across tracks).
- **Branch/Node View:** The recommendation engine adapts dynamically to the **Local Context**:
  - Highlights and suggests the next sequential station within the active branch.
  - Enables seamless deep diving into a chosen node without losing orientation.
  - Leaf stations provide direct `[ ➔ Next in Branch ]` navigation to the next sibling upon completion.
  - Displays the global BFS queue checkpoint so the user can easily toggle or return to global breadth.

## 8. Node View Header Actions
- Header action buttons sit above child road lines:
  - `[ ℹ️ Node Info & Details ]`: Drawer with metadata, concepts, recall prompt, and status.
  - `[ 📝 Node Summary & Notes ]`: Rendered markdown viewer and in-browser disk editor.
- Clicking child road cards navigates down recursively.

## 9. Anti-Pollution & Direct Communication
- **Minimal View:** Zero unnecessary text, verbose instructional paragraphs, or decorative emojis polluting the UI.
- **Direct Agent Output:** Answer immediately with concise, actionable points; no pleasantries, filler, or obvious walkthroughs.
- **Ask Before Commits:** Always stage changes and confirm commit message before creating Git commits.
