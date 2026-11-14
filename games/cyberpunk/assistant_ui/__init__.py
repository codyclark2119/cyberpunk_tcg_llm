"""The local assistant page, kept as three files and served as one self-contained document.

Why: the page grew to well over a thousand lines inside a Python string, where no
editor checks its CSS or JavaScript. ``assistant.html`` holds the markup,
``assistant.css`` the theme and ``assistant.js`` the behaviour; ``assemble_page``
inlines them into one ``<style>`` and one ``<script>`` block so the served page
still loads nothing from anywhere (no CDN, no second request, works offline), and
the tests that read the assembled string keep seeing exactly what a browser gets.

The example chips are rendered here from the questions the caller passes in, each
escaped; this module never names or reads them itself.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

__all__ = ["assemble_page", "UI_DIR"]

UI_DIR = Path(__file__).resolve().parent
_PLACEHOLDER = re.compile(r"__(STYLE|SCRIPT|EXAMPLES)__")


def _read(name: str) -> str:
    return (UI_DIR / name).read_text(encoding="utf-8")


def _chips(examples) -> str:
    return "".join(f'<button type="button" data-example="{html.escape(question)}" title="{html.escape(question)}">'
                   f'{html.escape(label)}</button>' for label, question in examples)


def assemble_page(examples) -> str:
    """The full page: the template with the stylesheet, the script and one chip per ``(label, question)``.

    Fails closed if a placeholder is missing or repeated, or if the stylesheet or script could end
    its own element early. One pass fills every placeholder, so text inside the CSS or JS that
    looks like a placeholder is never substituted."""
    template, style, script = _read("assistant.html"), _read("assistant.css"), _read("assistant.js")
    found = _PLACEHOLDER.findall(template)
    if sorted(found) != ["EXAMPLES", "SCRIPT", "STYLE"]:
        raise ValueError(f"assistant.html must hold each placeholder exactly once, found {found}")
    if "</style" in style.lower() or "</script" in script.lower():
        raise ValueError("assistant.css or assistant.js closes its own element")
    parts = {"STYLE": style, "SCRIPT": script, "EXAMPLES": _chips(examples)}
    return _PLACEHOLDER.sub(lambda m: parts[m.group(1)], template)
