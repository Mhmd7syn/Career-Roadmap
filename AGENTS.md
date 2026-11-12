# AI Agent Instructions: Roadmap & Node Creation Rules

You are an AI coding and content agent assisting with the **Knowledge Graph** repository. When creating, modifying, or reviewing stations and codebase architecture, adhere strictly to the following rules.

---

## 1. Starter Node Scoping
- **Launchpad Only:** Station `info.md` files provide only foundational orientation, core mental models, and initial setup—never encyclopedic or advanced mastery of child topics.
- **Delegate Depth:** Advanced specializations, deep tooling, and detailed sub-disciplines belong strictly in child subfolders.

## 2. High-Yield Sourcing (3–4 Links Cap)
- **Hard Cap:** Strictly 3 to 4 links per station (e.g., 1 practice/sandbox, 1 quickstart/cheatsheet, 1 focused guide). Avoid link dumping.
- **Practice & Brevity First:** Prioritize short, highly targeted resources, interactive platforms, active drills, and cheatsheets directly mapped to the node's learning outcomes over long-winded tutorials.
- **Module Scoping for Long Courses:** If a comprehensive or multi-week course is the best resource, explicitly annotate the link label with the exact modules, weeks, or lessons to take (e.g., `[Course Name (Module X: Topic)]`) rather than prescribing the full course.

## 3. Formatting & Content Separation
- **Minimal & Direct:** Zero filler text, conversational prose, or decorative emojis. Keep `info.md` crisp, scannable, and strictly structured.
- **Document Separation:**
  - `info.md`: System metadata (`Status`), foundational overview, `Learning Outcomes`, `Checkpoint` drills, and curated `Links & Resources`.
  - `notes.md`: Personal study notes, code implementations, architectural insights, and LaTeX formulas.

## 4. Node Anatomy Standard
Every station `info.md` must enforce the 3 stages of progressive mastery natively through its document schema:
1. **Overview & Learning Outcomes (Mental Model):** Concise introductory summary and 3–5 bulleted, action-oriented learning outcomes.
2. **Checkpoint Questions (Active Recall):** 3–4 self-testing questions/prompts formatted as Markdown checkboxes (`- [ ]`) to test retention from memory without looking at notes.
3. **Lab / Project Target (Practical Synthesis):** Practical application target (interactive exercise, reproducible lab, or code artifact) whose derivation and working notes are documented in `notes.md`.

---

## 5. Architectural & System Invariants
- **Directory-as-Graph:** The folder hierarchy directly represents the graph hierarchy. Every station is a folder containing `info.md` and optional `notes.md`.
- **Pure Python Backend:** Zero external pip dependencies. `server.py` must only use Python 3's built-in standard library (`http.server`, `urllib`, `pathlib`, etc.).
- **Vendored Assets:** Zero npm dependencies. Offline assets reside in `web/libs/` ([KaTeX](web/libs/katex.min.js), [Marked.js](web/libs/marked.min.js)).
- **Private Data Isolation:** The root repository is public, while `graph/` is a private submodule. All personal/private data, account subscriptions, private notes, and user-specific rules must reside exclusively inside the `graph/` directory.
