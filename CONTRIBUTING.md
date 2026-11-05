# Contributing to Knowledge Graph

Thank you for considering contributing to Knowledge Graph! We welcome bug reports, documentation updates, and pull requests that align with our core design philosophy: **simplicity, offline independence, and directory-as-graph architecture**.

---

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Design Principles to Keep in Mind

1. **Zero External Dependencies:**
   - The backend MUST remain runnable using standard library Python 3 with zero external pip packages.
   - Frontend libraries must be self-contained and vendorable offline without npm build pipelines.
2. **Directory-as-Graph Philosophy:**
   - The file system remains the single source of truth. Avoid introducing separate external database systems or lock-in schemas.
3. **Surgical, Clean Code:**
   - Keep functions focused and well-typed where applicable. Avoid speculative abstractions.

---

## Development Workflow

1. **Fork and Clone the Repository:**
   ```bash
   git clone https://github.com/<your-username>/Career-Roadmap.git
   cd Career-Roadmap
   ```

2. **Branching Strategy:**
   - Create a feature branch with a descriptive name:
     ```bash
     git checkout -b feature/search-bar
     # or
     git checkout -b fix/modal-esc-key
     ```

3. **Running Locally:**
   ```bash
   python server.py
   ```
   Open `http://localhost:8000` in your web browser.

4. **Testing Your Changes:**
   - Verify that node navigation, breadcrumbs, modal viewing, and editing all function cleanly.
   - Ensure the server correctly handles file creation, status toggles, and Markdown persistence without errors.

5. **Commit Conventions:**
   - Write concise, imperative commit messages:
     ```bash
     git commit -m "feat: add keyboard shortcut for node search"
     ```

6. **Submit a Pull Request:**
   - Push your branch to GitHub and open a pull request against the `master` branch.
   - Reference any relevant issues in the PR description (e.g., `Closes #2`).

---

## Reporting Issues & Requesting Features

- Search existing issues to ensure the topic hasn't already been addressed.
- Use the provided [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) or [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) issue templates.
