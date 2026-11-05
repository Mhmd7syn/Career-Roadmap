# Master System Rules

## 1. Directory-as-Graph Architecture
- Every station is an isolated folder under `graph/`. Children are nested subfolders.
- Every station contains strictly two core markdown documents:
  - `info.md`: Station title, category badge, completion status, mental models, active recall questions, and external links.
  - `notes.md`: Personal study notes, code implementations, formulas, and architectural insights.
- Any additional non-core file in a station folder (PDF, image, script) is treated as an extra resource file.
- Creating a child station is done via a single `+` action requiring only the station name.

## 2. Progressive Information Depth & Starter Scoping
- **Starter Node Scope:** Every station's `info.md` (description and learning outcomes) functions strictly as a **starter launching pad** covering the foundational orientation, core taxonomy, mental models, and initial setup necessary to begin learning that station.
- **No Premature Mastery:** A node's `info.md` must **never** summarize the exhaustive, deep end-state mastery attained after completing all of its child stations.
- **Granular Depth in Children:** Detailed technical depth, advanced specializations, and production mastery belong strictly in immediate and subsequent child subfolders.
- **Single-Concept Child Spawning:** When a topic within a node requires deep implementation, specialized tooling, or detailed drills, it must be spun off into a dedicated child station.

## 3. Short, Interactive & High-Yield Sourcing
- **Concise Over Encyclopedic:** Resource links must be short, fast to consume, and laser-focused on core fundamentals. Avoid multi-hundred-page textbooks or exhaustive treatises for starter stations.
- **Practice & Active Recall First:** Prioritize interactive resources, quickstarts, cheatsheets, and materials featuring embedded quizzes, flash questions, or hands-on practice problems.

## 4. Breadth Exhaustion Before Depth Progression
- Survey and complete the breadth of the current depth level ($d$) across parallel tracks before drilling down into deep child branches ($d+1$), unless explicitly targeting a specific specialization.

## 5. Leaf-Node Learning Frontier
- Active study, note-taking in `notes.md`, and recall checks occur strictly on active **leaf stations** of the tree.
- Learning does not occur on branch hubs; branch hubs aggregate progress.

## 6. Parent-Child Status Cascading
- Adding a child station automatically ensures the parent reflects `in-progress` until all children are marked `completed`.
- When all child stations of a parent are `completed`, the parent cascades to `completed`.
- Reverting any child to `todo` or `in-progress` cascades the parent back to `in-progress`.

## 7. Focused Local Graph Canvas
- The stage displays strictly the active parent station connected via curved splines to its immediate child stations.
- Smooth transitions move a clicked child into the parent anchor while sub-stations expand dynamically.

## 8. Direct Disk Persistence
- All status updates, document edits, child creations, and extra file uploads write directly to the local file system with no intermediaries.

## 9. Anti-Pollution & Minimal View
- Zero unnecessary text, verbose instructional paragraphs, or decorative emojis polluting the canvas.
- Keep `info.md` concise, structured, and instantly actionable.

## 10. The 3-Pass Learning Engine
1. **Pass 1: Concept Intake**
   - Focused, high-yield explanations prioritizing clarity and fundamental mechanics.
   - Sources: Interactive tutorials, official quickstarts, focused cheatsheets, and concise video walkthroughs.
2. **Pass 2: Active Recall & Drills**
   - Interactive quizzes, self-test questions in `info.md`, coding checkpoints, and spaced drills.
3. **Pass 3: Production Synthesis**
   - 1 focused, working project milestone or lab per leaf station before advancing.
