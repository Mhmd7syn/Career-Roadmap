# Knowledge Graph

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Dependencies: None](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Stdlib)-green.svg)](requirements.txt)
[![Offline First](https://img.shields.io/badge/Offline-100%25%20Self--Contained-success.svg)](libs/)

*Knowledge grows farther and deeper through time.*

A lightweight, offline-first, **Directory-as-Graph** visual knowledge platform and progressive learning roadmap engine. Built with vanilla JavaScript, HTML5 Canvas, and a pure Python standard-library backend.

---

## Highlights

- **Directory-as-Graph Architecture:** The file system *is* the database. Every station is a folder on disk; nested child stations are subfolders.
- **Markdown-First Content:** Every node is strictly governed by two core markdown documents:
  - `info.md`: Node title, completion status (`todo`, `in-progress`, `completed`), learning outcomes, and curated links.
  - `notes.md`: Personal study notes, code implementations, architectural insights, and LaTeX formulas.
- **Focused Local Graph Canvas:** Smooth spline-connected local stage presenting strictly the active parent node and its immediate children, keeping cognitive load minimal.
- **Single-Click Node Creation:** Add new child stations instantly via the interactive `+` action with direct disk persistence.
- **Zero External Dependencies:** No `npm install`, no `pip install`. Runs directly on Python's built-in standard library with vendored offline libraries ([KaTeX](libs/katex.min.js) and [Marked.js](libs/marked.min.js)).
- **Privacy-Decoupled Architecture:** Keep the engine open-source while storing your personal notes in a private repository or submodule.
- **Local Disk Persistence:** Instant file updates, node additions, status changes, and file uploads write directly to disk with no intermediaries.

---

## Quickstart

### Prerequisites
- Python 3.10 or higher.
- A modern web browser.

### 1. Clone & Run

```bash
# Clone the repository
git clone https://github.com/Mhmd7syn/knowledge-graph.git
cd knowledge-graph

# Run the local server
python server.py
```

*On Windows, you can simply double-click `run.bat`.*

The server will automatically bind to an available port (default: `http://localhost:8000`) and launch your default browser.

> [!NOTE]
> On initial run, if the `graph/` folder is empty or not yet created, `server.py` automatically initializes it using the clean roadmap template provided in `graph.template/`.

---

## Decoupled Private Notes

The engine is completely agnostic to where graph notes are stored. You can isolate your personal roadmap and study notes using either of the following approaches:

### Option 1: Custom Data Directory (`GRAPH_DIR`)
Set the `GRAPH_DIR` environment variable to point to any directory on your local machine:

```bash
# Windows (PowerShell)
$env:GRAPH_DIR = "C:\Users\username\Documents\my-personal-notes"
python server.py

# Linux / macOS
export GRAPH_DIR="/home/username/documents/my-personal-notes"
python server.py
```

### Option 2: Private Git Submodule
Link your own private GitHub repository into the `graph/` path:

```bash
git submodule add https://github.com/<your-username>/<your-private-repo>.git graph
```

---

## Node Design & Content Guidelines

The roadmap content, progressive mastery structure, and station specifications follow strict design standards (automated agents should consult [`AGENTS.md`](AGENTS.md)):

1. **Starter Node Scoping (Launchpad Only):** Every station's `info.md` provides only foundational orientation, core mental models, and initial setup. Advanced specializations, deep tooling, and detailed sub-disciplines belong strictly in child subfolders.
2. **High-Yield Sourcing (3–4 Links Cap):** Strictly 3 to 4 links per station (e.g., 1 practice/sandbox, 1 quickstart/cheatsheet, 1 focused guide). Avoid encyclopedic link dumps; prioritize interactive platforms and active recall drills.
3. **Clean Separation of Concerns:**
   - `info.md`: Lightweight station metadata (`Status`), concise overview, actionable learning outcomes, self-check drills, and curated high-yield links.
   - `notes.md`: Personal study notes, code implementations, architectural insights, and LaTeX formulas.
4. **Node Anatomy Standard:** Every station natively enforces progressive mastery across three structured tiers:
   - **Overview & Learning Outcomes:** Core mental models and 3–5 action-oriented learning targets.
   - **Checkpoint Questions:** Active recall prompts formatted as Markdown checkboxes (`- [ ]`) to test retention from memory without looking at notes.
   - **Lab / Project Target:** Practical application and problem-solving targets whose working derivation and solutions reside in `notes.md`.

---

## Project Structure

```
knowledge-graph/
├── .github/                 # Issue & PR templates, CI workflows
├── app.js                   # Visual canvas engine, layout & UI transitions
├── index.html               # Canvas and modal presentation markup
├── style.css                # Dark-mode styling, typography, and controls
├── server.py                # Pure Python HTTP server & file-system API
├── run.bat                  # One-click Windows launch script
├── AGENTS.md                # AI agent instructions & node creation spec
├── graph.template/          # Starter sample roadmap stations and templates
├── libs/                    # Vendored offline assets (KaTeX, Marked.js)
├── requirements.txt         # Dependency documentation (zero external pip packages)
└── LICENSE                  # MIT License
```

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a pull request.

---

## License

This project is licensed under the [MIT License](LICENSE).
