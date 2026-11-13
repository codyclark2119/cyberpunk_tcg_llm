#!/usr/bin/env python3
"""Fetch the official Cyberpunk TCG Tournament Rules as structured JSON.

Why: the comprehensive rules say how the game is played; they say nothing about
how an event is run. Quiz questions about penalties, deck registration, dice,
sleeves, match structure or judge procedure were therefore answered "not in
the snapshot" (or guessed). The official answer to those is a second document,
the Tournament Rules at https://cyberpunktcg.com/tournament-rules. Like the
comprehensive rules page it is a client-rendered SPA shell; its content comes
from:

    https://api.netdeck.gg/api/cyberpunk/tournament-rules

which has the same shape `scripts/fetch_rules.py` documents for the
comprehensive rules: `{game, updated_at, items: [...]}`, a flat list of typed
nodes (`id`, `parent_id`, `node_type` "section" | "rule", `title`,
`body_markdown`, `display_number`, `stable_anchor`, `sort_order`, `depth`).

Two differences that matter downstream, both handled by `scripts/ingest.py`:

  - Display numbers collide with the comprehensive rules ("1.3", "2.2" exist
    in both) and include appendix letters ("A.1.2", "C.2.2"), so every
    ingested id is prefixed "TR " (`TR 3.4.2`, `TR A.1.2`).
  - Many `section` nodes carry a body (the ban list is a section), unlike the
    comprehensive rules, whose sections are bare headings.

The document has its own `updated_at`, tracked separately from the
comprehensive rules as `TOURNAMENT_RULES_VERSION` in
`games/cyberpunk/prompts.py`. Refreshing this file is its own change and moves
that constant in the same commit; it never moves `RULES_VERSION`.

Usage:
    python scripts/fetch_tournament_rules.py                     # write data/raw/tournament_rules.json
    python scripts/fetch_tournament_rules.py --print-updated-at  # check for a new version

The write refuses to replace the file with one holding fewer nodes unless
`--force` is passed; see `fetch_common.write_json_snapshot`. A response of an
unexpected shape is refused before anything is written.
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from fetch_common import fetch_json, write_json_snapshot  # noqa: E402

API_BASE = "https://api.netdeck.gg/api"
TOURNAMENT_RULES_URL = f"{API_BASE}/cyberpunk/tournament-rules"

DEFAULT_OUT = REPO_ROOT / "data" / "raw" / "tournament_rules.json"

REQUIRED_NODE_FIELDS = {
    "id", "parent_id", "node_type", "title", "body_markdown",
    "display_number", "stable_anchor", "sort_order", "depth",
}
NODE_TYPES = {"section", "rule"}


def validate(doc) -> None:
    """Refuse a response whose shape `ingest.py` cannot rely on (raises SystemExit).

    Stricter than `fetch_rules.validate` on purpose: this document is new to
    the repo, so field types and node types are checked too, and a numbered
    node without a display number (which would get a colliding fallback id)
    is refused. The parent-link check matters most: an orphaned node would
    silently vanish from the ingested outline with its whole subtree.
    """
    if not isinstance(doc, dict):
        raise SystemExit(f"response is a {type(doc).__name__}, not an object -- API shape changed?")
    for key in ("game", "updated_at", "items"):
        if key not in doc:
            raise SystemExit(f"response is missing top-level {key!r} -- API shape changed?")
    if not isinstance(doc["updated_at"], str) or not re.match(r"\d{4}-\d{2}-\d{2}", doc["updated_at"]):
        raise SystemExit(f"updated_at {doc['updated_at']!r} is not an ISO date")
    items = doc["items"]
    if not isinstance(items, list) or not items:
        raise SystemExit("response contains zero tournament-rule nodes")

    for n in items:
        if not isinstance(n, dict):
            raise SystemExit(f"a node is a {type(n).__name__}, not an object")
        missing = REQUIRED_NODE_FIELDS - set(n)
        if missing:
            raise SystemExit(f"node {n.get('id')} is missing fields {sorted(missing)}")
        if n["node_type"] not in NODE_TYPES:
            raise SystemExit(f"node {n['id']} has node_type {n['node_type']!r}, expected one of {sorted(NODE_TYPES)}")
        for field in ("title", "display_number", "stable_anchor"):
            if not isinstance(n[field], str):
                raise SystemExit(f"node {n['id']} field {field!r} is {type(n[field]).__name__}, not a string")
        if not isinstance(n["body_markdown"], (str, type(None))):
            raise SystemExit(f"node {n['id']} body_markdown is not a string")
        if not isinstance(n["depth"], int) or not isinstance(n["sort_order"], (int, float)):
            raise SystemExit(f"node {n['id']} has a non-numeric depth or sort_order")
        if n["node_type"] == "rule" and not n["display_number"]:
            raise SystemExit(f"rule node {n['id']} has no display_number, so it would have no citable id")

    ids = {n["id"] for n in items}
    if len(ids) != len(items):
        raise SystemExit("response contains duplicate node ids")
    numbers = [n["display_number"] for n in items if n["display_number"]]
    if len(set(numbers)) != len(numbers):
        raise SystemExit("response contains duplicate display numbers -- ids would collide")
    for n in items:
        if n["parent_id"] is not None and n["parent_id"] not in ids:
            raise SystemExit(
                f"node {n['id']} ({n.get('display_number')!r}) points at parent "
                f"{n['parent_id']}, which is not in the response -- the tree is "
                f"incomplete and its whole subtree would be dropped silently."
            )
    if not any(n["parent_id"] is None for n in items):
        raise SystemExit("no root node -- every node claims a parent")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--url", type=str, default=TOURNAMENT_RULES_URL)
    ap.add_argument("--print-updated-at", action="store_true",
                    help="fetch and print the document's updated_at, write nothing")
    ap.add_argument("--force", action="store_true",
                    help="write even if the new document has fewer nodes")
    args = ap.parse_args(argv)

    doc = fetch_json(args.url)
    validate(doc)

    if args.print_updated_at:
        print(doc["updated_at"])
        return

    args.out.parent.mkdir(parents=True, exist_ok=True)
    write_json_snapshot(args.out, doc, lambda d: len(d["items"]), force=args.force,
                        what="tournament-rule nodes")

    sections = sum(1 for n in doc["items"] if n["node_type"] == "section")
    rules = sum(1 for n in doc["items"] if n["node_type"] == "rule")
    print(f"wrote {len(doc['items'])} nodes ({sections} sections, {rules} rules) -> {args.out}")
    print(f"updated_at: {doc['updated_at']}")


if __name__ == "__main__":
    main()
