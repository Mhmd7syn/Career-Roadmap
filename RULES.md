# Roadmap & Content Rules

These rules strictly govern all future node additions, content updates, source curation, and study progression.

## 1. Starter Node Scoping (No Premature Mastery)
- **Launchpad Only:** Every station's `info.md` (description and learning outcomes) functions strictly as a **starter launching pad** covering foundational orientation, core taxonomy, mental models, and initial setup necessary to begin learning that station.
- **No Premature Mastery:** A node's `info.md` must **never** summarize the exhaustive, deep end-state mastery attained after completing all of its child stations.
- **Granular Depth in Children:** Detailed technical depth, advanced specializations, and production mastery belong strictly in immediate and subsequent child subfolders.
- **Single-Concept Child Spawning:** When a topic within a node requires deep implementation, specialized tooling, or detailed drills, it must be spun off into its own dedicated child station.

## 2. Short, Interactive & High-Yield Sourcing (3–4 Links Cap)
- **Concise Over Encyclopedic:** Resource links must be short, fast to consume, and laser-focused on core fundamentals. Multi-hundred-page textbooks and monolithic reading lists are strictly forbidden for starter stations.
- **Practice & Active Recall First:** Prioritize interactive platforms, quickstarts, cheatsheets, and materials featuring embedded quizzes, flash questions, or hands-on practice problems.
- **Hard Cap (3–4 Links):** Strictly 3 to 4 links per station (e.g., 1 interactive sandbox/practice, 1 quickstart/cheatsheet, 1 focused tutorial/module) to eliminate link hoarding and decision fatigue.

## 3. Active Checkpoints (Self-Test Readiness)
- Every station's `info.md` must include a `## Checkpoint` section containing 2–3 rapid self-test questions or a micro-drill.
- A station should not be marked `completed` until the learner can answer all checkpoint questions from memory without referencing external notes.

## 4. Anti-Pollution & Minimal Formatting
- Zero unnecessary filler text, verbose instructional paragraphs, or decorative emojis.
- Keep `info.md` strictly under 35 lines. Long study notes, code implementations, and derivations belong in `notes.md`.

## 5. Learning & Progression Engine
- **Breadth Before Depth:** Survey and complete the breadth of the current depth level ($d$) across parallel tracks before drilling down into deep child branches ($d+1$), unless explicitly targeting a specific specialization.
- **Leaf-Node Study Frontier:** Active note-taking in `notes.md` and practice checks occur strictly on active **leaf stations** of the tree. Branch hubs aggregate status; they are not study destinations.
- **The 3-Pass Learning Engine:**
  1. *Pass 1 (Concept Intake):* Rapid intake prioritizing fundamental mechanics via short interactive guides or cheatsheets.
  2. *Pass 2 (Active Recall & Drills):* Interactive quizzes, flash recall, and targeted practice problems.
  3. *Pass 3 (Production Synthesis):* One focused working project, reproducible lab, or code artifact per leaf station before advancing.
