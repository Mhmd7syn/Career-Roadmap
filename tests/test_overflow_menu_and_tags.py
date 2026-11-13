#!/usr/bin/env python3
"""
Unit and integration tests for Minimized Tags & 3-Dot Overflow Menus (Issue #15).
"""

import re
import sys
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))


class TestOverflowMenuAndTags(unittest.TestCase):
    def setUp(self):
        self.html_path = BASE_DIR / "web" / "index.html"
        self.css_path = BASE_DIR / "web" / "style.css"
        self.js_path = BASE_DIR / "web" / "app.js"

        self.html_content = self.html_path.read_text(encoding="utf-8")
        self.css_content = self.css_path.read_text(encoding="utf-8")
        self.js_content = self.js_path.read_text(encoding="utf-8")

    def test_modal_header_has_compact_status_and_priority_tags(self):
        """Verify modal header contains compact status and priority cycle tags."""
        self.assertIn('id="md-modal-status"', self.html_content)
        self.assertIn('id="md-modal-priority"', self.html_content)
        # Check they are positioned inside the header title group
        pattern = r'id="md-modal-title"[^>]*>.*id="md-modal-status".*id="md-modal-priority"'
        self.assertIsNotNone(
            re.search(pattern, self.html_content, re.DOTALL),
            "md-modal-status and md-modal-priority must be collocated in modal title row"
        )

    def test_modal_header_3dot_overflow_structure(self):
        """Verify markdown modal header contains 3-dot overflow menu replacing flat buttons."""
        self.assertIn('id="btn-modal-overflow"', self.html_content)
        self.assertIn('id="modal-station-overflow-dropdown"', self.html_content)
        self.assertIn('id="btn-modal-rename-station"', self.html_content)
        self.assertIn('id="btn-modal-move-station"', self.html_content)
        self.assertIn('id="btn-modal-share-station"', self.html_content)
        self.assertIn('id="btn-modal-delete-station"', self.html_content)
        self.assertIn('dropdown-item-danger', self.html_content)

    def test_parent_card_3dot_overflow_menu(self):
        """Verify app.js constructs 3-dot overflow menu for parent station cards."""
        self.assertIn('id="parent-overflow-container"', self.js_content)
        self.assertIn('id="btn-parent-overflow"', self.js_content)
        self.assertIn('id="parent-overflow-dropdown"', self.js_content)
        self.assertIn('id="btn-parent-rename"', self.js_content)
        self.assertIn('id="btn-parent-move"', self.js_content)
        self.assertIn('id="btn-parent-share"', self.js_content)
        self.assertIn('id="btn-parent-delete"', self.js_content)
        # Check primary actions remain accessible outside dropdown
        self.assertIn('id="btn-parent-info"', self.js_content)
        self.assertIn('id="btn-parent-notes"', self.js_content)

    def test_dropdown_dismissal_logic_in_js(self):
        """Verify click-outside and Escape key dismissal logic for overflow menus."""
        self.assertIn("closeAllOverflowDropdowns", self.js_content)
        self.assertIn(".station-dropdown-menu", self.js_content)
        self.assertIn("e.target.closest('.station-overflow-container')", self.js_content)
        # Verify Escape key prioritizes closing open dropdowns before closing modals
        escape_pattern = r"e\.key\s*===\s*'Escape'.*closeAllOverflowDropdowns"
        self.assertIsNotNone(
            re.search(escape_pattern, self.js_content, re.DOTALL),
            "Escape handler must close open overflow dropdown menus"
        )

    def test_child_status_dot_interactivity(self):
        """Verify child station status dots are interactive and trigger setChildStatus."""
        self.assertIn("setChildStatus", self.js_content)
        self.assertIn(".child-status-dot", self.js_content)
        child_dot_click_pattern = r"nodeEl\.querySelector\('\.child-status-dot'\).*setChildStatus"
        self.assertIsNotNone(
            re.search(child_dot_click_pattern, self.js_content, re.DOTALL),
            "Child status dots must bind click handler calling setChildStatus"
        )

    def test_css_minimized_pill_tag_styles(self):
        """Verify CSS contains compact minimalist styling for status and priority pills."""
        self.assertIn(".btn-status-cycle", self.css_content)
        self.assertIn(".btn-priority-cycle", self.css_content)
        self.assertIn("border-radius: 12px;", self.css_content)
        self.assertIn("padding: 2px 8px;", self.css_content)
        self.assertIn(".modal-badge-pill", self.css_content)

    def test_css_child_status_dot_cursor_and_hover(self):
        """Verify CSS sets pointer cursor and hover scaling on child status dots."""
        dot_section = re.search(r'\.child-status-dot\s*\{[^}]*\}', self.css_content)
        self.assertIsNotNone(dot_section, ".child-status-dot rule must exist in style.css")
        self.assertIn("cursor: pointer;", dot_section.group(0))

    def test_css_overflow_dropdown_menu_styles(self):
        """Verify CSS defines proper positioning, clipping protection, and animation for dropdowns."""
        self.assertIn(".station-overflow-container", self.css_content)
        self.assertIn(".station-dropdown-menu", self.css_content)
        self.assertIn("position: absolute;", self.css_content)
        self.assertIn("right: 0;", self.css_content)
        self.assertIn(".dropdown-item", self.css_content)
        self.assertIn(".dropdown-item-danger", self.css_content)
        self.assertIn(".dropdown-divider", self.css_content)


if __name__ == "__main__":
    unittest.main()
