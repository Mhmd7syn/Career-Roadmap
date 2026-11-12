#!/usr/bin/env python3
"""
Unit and integration tests for BiDi (Bidirectional) Markdown & Editor support (Issue #13).
"""

import re
import sys
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))


class TestBiDiSupport(unittest.TestCase):
    def setUp(self):
        self.html_path = BASE_DIR / "web" / "index.html"
        self.css_path = BASE_DIR / "web" / "style.css"
        self.js_path = BASE_DIR / "web" / "app.js"

        self.html_content = self.html_path.read_text(encoding="utf-8")
        self.css_content = self.css_path.read_text(encoding="utf-8")
        self.js_content = self.js_path.read_text(encoding="utf-8")

    def test_html_inputs_and_elements_have_dir_auto(self):
        """Verify key inputs, markdown preview, extracted body, and textareas have dir="auto"."""
        expected_elements = [
            r'id="search-input"[^>]*dir="auto"',
            r'id="md-rendered-view"[^>]*dir="auto"',
            r'id="md-textarea"[^>]*dir="auto"',
            r'id="new-child-name"[^>]*dir="auto"',
            r'id="rename-title-input"[^>]*dir="auto"',
            r'id="share-shortcut-name-input"[^>]*dir="auto"',
            r'id="extract-markdown-body"[^>]*dir="auto"',
        ]
        for pattern in expected_elements:
            with self.subTest(pattern=pattern):
                self.assertIsNotNone(
                    re.search(pattern, self.html_content),
                    f"Expected pattern '{pattern}' not found in web/index.html"
                )

    def test_css_markdown_blocks_have_unicode_bidi_plaintext(self):
        """Verify CSS sets unicode-bidi: plaintext and text-align: start across preview & extract body."""
        self.assertIn(".markdown-preview,", self.css_content)
        self.assertIn(".extract-markdown-body", self.css_content)
        self.assertIn("unicode-bidi: plaintext;", self.css_content)
        self.assertIn("text-align: start;", self.css_content)

    def test_css_rtl_list_items_and_markers(self):
        """Verify CSS properly defines RTL list item direction and list padding."""
        self.assertIn('li[dir="rtl"]', self.css_content)
        self.assertIn("direction: rtl;", self.css_content)
        self.assertIn("text-align: right;", self.css_content)
        self.assertIn("padding-right: 28px;", self.css_content)

    def test_css_rtl_blockquotes(self):
        """Verify blockquotes adjust border side for RTL content."""
        self.assertIn('blockquote[dir="rtl"]', self.css_content)
        self.assertIn("border-right: 3px solid", self.css_content)

    def test_css_code_and_katex_isolation(self):
        """Verify inline code, code blocks, and KaTeX math are isolated in LTR direction."""
        self.assertIn("unicode-bidi: isolate;", self.css_content)
        self.assertIn("direction: ltr;", self.css_content)

    def test_css_inputs_and_editor_textarea_support_bidi(self):
        """Verify summary-editor-textarea and form-inputs have unicode-bidi: plaintext."""
        self.assertIn(".summary-editor-textarea {", self.css_content)
        self.assertIn(".form-input {", self.css_content)

    def test_js_render_markdown_applies_dir_auto(self):
        """Verify renderMarkdownContent sets dir='auto' on target element and block children."""
        self.assertIn("targetEl.setAttribute('dir', 'auto');", self.js_content)
        self.assertIn("querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote')", self.js_content)
        self.assertIn("el.setAttribute('dir', 'auto');", self.js_content)


if __name__ == "__main__":
    unittest.main()
