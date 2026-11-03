# Master System Rules

## 1. Directory-as-Graph Architecture
- Every station is an isolated folder under `graph/`. Children are nested subfolders.
- Every station contains strictly two core markdown documents:
  - `info.md`: Station title, category badge, completion status, mental models, active recall questions, and external links.
  - `notes.md`: Personal study notes, code implementations, formulas, and architectural insights.
- Any additional non-core file in a station folder (PDF, image, script) is treated as an extra resource file.
- Creating a child station is done via a single `+` action requiring only the station name.

## 2. Progressive Information Depth
- **Macro Parent → Micro Child:** A parent node contains general orientation, mental models, and broad architectural framing.
- Detailed implementation specifics, drills, and granular topics belong strictly in its child subfolders.

## 3. Breadth Exhaustion Before Depth Progression
- Survey and complete the breadth of the current depth level ($d$) across parallel tracks before drilling down into deep child branches ($d+1$), unless explicitly targeting a specific specialization.

## 4. Leaf-Node Learning Frontier
- Active study, note-taking in `notes.md`, and recall checks occur strictly on active **leaf stations** of the tree.
- Learning does not occur on branch hubs; branch hubs aggregate progress.

## 5. Parent-Child Status Cascading
- Adding a child station automatically ensures the parent reflects `in-progress` until all children are marked `completed`.
- When all child stations of a parent are `completed`, the parent cascades to `completed`.
- Reverting any child to `todo` or `in-progress` cascades the parent back to `in-progress`.

## 6. Focused Local Graph Canvas
- The stage displays strictly the active parent station connected via curved splines to its immediate child stations.
- Smooth transitions move a clicked child into the parent anchor while sub-stations expand dynamically.

## 7. Direct Disk Persistence
- All status updates, document edits, child creations, and extra file uploads write directly to the local file system with no intermediaries.

## 8. Anti-Pollution & Minimal View
- Zero unnecessary text, verbose instructional paragraphs, or decorative emojis polluting the canvas.

## 9. The 3-Pass Learning Engine
1. **Pass 1: Concept Intake**
   - Focused explanations prioritizing clarity over length.
   - Sources: Official docs, technical books, deep-dive articles, and high-quality video walkthroughs.
2. **Pass 2: Active Recall**
   - Self-test questions in `info.md`, coding labs, LeetCode/NeetCode checkpoints, and spaced drills.
3. **Pass 3: Production Synthesis**
   - 1 production-style GitHub repo or containerized working milestone per major topic cluster.
