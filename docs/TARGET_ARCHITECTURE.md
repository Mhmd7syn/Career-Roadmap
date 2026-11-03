# Target Architecture: Career Knowledge Graph

## Physical Directory-as-Graph Structure
Every node in the graph is an isolated folder under `graph/`. Children are nested subfolders:

```
D:\Career Roadmap\
├── graph\
│   ├── node.json               <-- Root metadata (children: ["tech", "freelancing", "marketing"])
│   ├── summary.md              <-- Root overview notes & pictures
│   ├── tech\
│   │   ├── node.json           <-- Tech domain metadata (children: ["core-cs", "swe", "data", "ai", "fusion"])
│   │   ├── summary.md          <-- Tech domain overview notes
│   │   ├── core-cs\
│   │   │   ├── node.json       <-- Core CS metadata (children: ["algo-ds", "systems-os", ...])
│   │   │   ├── summary.md      <-- Core CS overview notes
│   │   │   ├── algo-ds\
│   │   │   │   ├── node.json   <-- Module metadata, child list, resources, recall prompts
│   │   │   │   ├── summary.md  <-- Rich Markdown notes: code, formulas, bold, images
│   │   │   │   └── arrays\     <-- Deeper child node (Depth 3)
│   │   │   │       ├── node.json
│   │   │   │       └── summary.md
│   │   │   └── ...
│   │   └── ...
```

---

## Visual Presentation: Node View Layout

When viewing any node (e.g. `Tech`, `Core CS`, or `Algorithms`):
```
┌────────────────────────────────────────────────────────────────────────┐
│ Breadcrumbs: Home / Tech / Core CS                                     │
│ Node Title: Track 0: Core CS Foundations                               │
│ Description: Algorithms, operating systems, networking, and systems.   │
├────────────────────────────────────────────────────────────────────────┤
│ Header Action Buttons:                                                 │
│ [ ℹ️ Node Info & Details ]       [ 📝 View / Edit Summary.md ]         │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Child Roads / Sub-Lanes Below:                                         │
│ ├── [01. Algorithms & Data Structures] ─────────────────────────────── │
│ ├── [02. Operating Systems & Systems]  ─────────────────────────────── │
│ ├── [03. Computer Networking]          ─────────────────────────────── │
│ └── [04. Software Craftsmanship]       ─────────────────────────────── │
└────────────────────────────────────────────────────────────────────────┘
```
- Clicking **`[ ℹ️ Node Info ]`** opens a clean drawer with metadata, status, resources, and recall checks.
- Clicking **`[ 📝 Node Summary ]`** opens the rendered `summary.md` with rich markdown (bold, code, images, math) and inline editing.
- Clicking any **Child Road Block** navigates down into that child's view, which displays its own header buttons and child roads.

---

## Learning Mechanics: BFS Traversal (Breadth-First Search)
- **Structural Depth ($d = 0, 1, 2, ...$):** No artificial static levels. Depth is determined directly by graph tree depth. Adding depth simply means creating child subfolders.
- **Progressive Information Depth (Macro Parent $\to$ Micro Child):** Every node contains high-level general information, mental models, and broad orientation for its topic. Granular implementation details, edge cases, and deep specifics are reserved strictly for its child subfolders.
- **Breadth Exhaustion Before Depth Progression:** Never advance or drill down to a new depth level ($d+1$) until it is verified that the current depth level ($d$) is completely populated and no other relevant sibling nodes can be added across the breadth—unless the user explicitly requests to dive deep into a specific node.
- **Leaf-Node Learning Frontier:** Learning occurs exclusively on active leaf nodes of the tree.
- **Parent-Child Status Cascading & Expansion Lifecycle:**
  1. Build level-by-level: parent nodes are studied and mastered as leaf nodes first, then marked `completed`.
  2. When returning to a completed node, its child nodes (Depth $d+1$) are created.
  3. **Adding new children automatically transitions the parent from `completed` to `in-progress`.**
  4. **When all children of a parent are marked `completed`, the parent automatically transitions to `completed`.**
  5. If any child is modified back to `todo` or `in-progress`, the parent immediately transitions back to `in-progress`.
- **Context-Aware Learning Progression:** At macro views (`Tech`/`Root`), the recommendation engine surfaces the global BFS queue. When drilled into a specific branch or node, it adapts to show the immediate local next station, enabling deep dives into a specific track while maintaining orientation.
- **BFS Traversal Engine:** The "Next Up" recommendation engine operates as a BFS queue:
  1. **Phase 1 (Depth 1 BFS):** Visits all Depth 1 nodes across parallel tracks (`Core CS` $\rightarrow$ `SWE` $\rightarrow$ `Data` $\rightarrow$ `AI`), guaranteeing a complete 360° macro survey without getting stuck in one track.
  2. **Phase 2 (Depth 2 BFS):** Once Depth 1 is completed, BFS dequeues Depth 2 children across tracks.
  3. **Phase 3 (Depth 3+ BFS):** Progresses deeper into granular specializations.
- **Python Local Server (`run.bat`):** Serves the folder tree, renders markdown via Marked.js, and saves browser edits directly to disk.
- **Minimalist UI & Direct Communication (Anti-Pollution Rule):** Zero unnecessary text, instructional paragraphs, or decorative fluff polluting the UI view. Keep all station cards, labels, action buttons, and agent responses brief, minimal, and direct.
