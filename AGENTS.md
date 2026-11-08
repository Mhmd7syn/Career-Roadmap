# AI Agent Instructions: Roadmap & Node Creation Rules

You are an AI coding and content agent assisting with the **Career Roadmap / Knowledge Graph** repository. When creating, modifying, or reviewing stations and codebase architecture, adhere strictly to the following rules.

---

## 1. Starter Node Scoping
- **Launchpad Only:** Station `info.md` files provide only foundational orientation, core mental models, and initial setup—never encyclopedic or advanced mastery of child topics.
- **Delegate Depth:** Advanced specializations, deep tooling, and detailed sub-disciplines belong strictly in child subfolders.

## 2. High-Yield Sourcing (3–4 Links Cap)
- **Hard Cap:** Strictly 3 to 4 links per station (e.g., 1 practice/sandbox, 1 quickstart/cheatsheet, 1 focused guide). Avoid link dumping.
- **Practice First:** Prioritize interactive platforms, active drills, cheatsheets, and official documentation over long-winded tutorials.

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
- **Vendored Assets:** Zero npm dependencies. Offline assets reside in `libs/` ([KaTeX](libs/katex.min.js), [Marked.js](libs/marked.min.js)).
