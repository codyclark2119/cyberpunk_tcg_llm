#!/usr/bin/env python3
"""Diff two Comprehensive Rules snapshots: added, removed, renumbered, text-changed.

Why: the rules are a moving beta document, and a refresh renumbers as readily
as it rewrites. Comparing two snapshots by rule NUMBER would misread every
renumbering as one rule removed and an unrelated one added, and would silently
pair a reused number ("3.9.2" now naming a different rule) with its old text.
Every node carries the site's own ``stable_anchor`` ("rule-<uuid>"), which
survives renumbering, so rows are paired by anchor first. Only rows whose
anchor appears on one side alone fall back to pairing by display number, and
those are reported separately ("re-anchored") rather than trusted as the same
rule.

Categories (a row can be both renumbered and text-changed):
  added        anchor and number new in the newer snapshot
  removed      anchor and number gone from the newer snapshot
  renumbered   same anchor, different display number
  changed      same anchor (or, for re-anchored rows, same number), different
               rule text. Text is compared without its leading "<number>. ",
               so a renumbering alone is not a text change. A change that
               disappears once the old text's cross-reference numbers are
               mapped through the renumbering is marked "cross-references only".
  reused       a number present in both snapshots that now names a different
               rule (different anchor) -- the case a number-keyed consumer,
               such as an expected-rules list, gets silently wrong.

Inputs may be raw API snapshots (``data/raw/comprehensive_rules.json``,
rendered through ``scripts/ingest.py``'s own ``build_records`` so the text is
exactly what ``rules.jsonl`` would hold) or ingested ``rules.jsonl`` files.
``--old-rev`` reads the older file from git instead of from disk.

Output is deterministic Markdown (document order of the newer snapshot, then
of the older one for removals; no timestamps), or JSON with ``--json``.

Usage:
    python scripts/diff_rules_snapshot.py --old-rev origin/master
    python scripts/diff_rules_snapshot.py --old old_rules.jsonl --new data/processed/rules.jsonl --json
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

DEFAULT_NEW = REPO_ROOT / "data" / "raw" / "comprehensive_rules.json"
CONTEXT = 90       # characters of unchanged text kept either side of a change
FULL_LIMIT = 320   # texts this short are shown whole
SUCCESSOR_MIN = 0.6  # similarity at which a removed rule's likeliest added row is named
REWRITE_MAX = 0.5    # a same-anchor change below this similarity is flagged "largely rewritten"
RULE_NUMBER_RE = re.compile(r"(?<![\d.])\d+(?:\.\d+)+(?![\d]|\.\d)")


def rows_from_text(text: str, name: str) -> list[dict]:
    """Normalised rows ``{anchor, number, kind, text}`` from either input format."""
    try:
        whole = json.loads(text)
    except json.JSONDecodeError:
        whole = None  # several JSON lines: an ingested rules.jsonl
    if isinstance(whole, dict) and "items" in whole:
        from ingest import build_records  # the exact rendering rules.jsonl gets
        records, _ = build_records(whole)
    else:
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    return normalise(records, name)


def normalise(records: list[dict], name: str = "rules") -> list[dict]:
    """``rules.jsonl`` records as ``{anchor, number, kind, text}``, refusing duplicates."""
    rows = []
    for r in records:
        if "anchor" not in r or "id" not in r or "text" not in r:
            raise SystemExit(f"{name}: a row lacks id/anchor/text -- not a rules snapshot")
        numbered = r.get("is_numbered", r["id"] != r["anchor"])
        rows.append({"anchor": r["anchor"], "number": r["id"] if numbered else "",
                     "kind": r.get("kind", "rule"), "text": r["text"]})
    anchors = [r["anchor"] for r in rows]
    if len(set(anchors)) != len(anchors):
        raise SystemExit(f"{name}: duplicate anchors")
    numbers = [r["number"] for r in rows if r["number"]]
    if len(set(numbers)) != len(numbers):
        raise SystemExit(f"{name}: duplicate rule numbers")
    return rows


def body(row: dict) -> str:
    """Rule text without its citable "<number>. " prefix."""
    prefix = f"{row['number']}. "
    return row["text"][len(prefix):] if row["number"] and row["text"].startswith(prefix) else row["text"]


def label(row: dict) -> str:
    return row["number"] or row["anchor"]


def diff(old: list[dict], new: list[dict]) -> dict:
    old_by_anchor = {r["anchor"]: r for r in old}
    new_by_anchor = {r["anchor"]: r for r in new}
    pairs = [(old_by_anchor[r["anchor"]], r, "anchor") for r in new if r["anchor"] in old_by_anchor]

    # Second key: display number, only among rows whose anchor matched nothing.
    old_rest = {r["number"]: r for r in old if r["anchor"] not in new_by_anchor and r["number"]}
    new_rest = [r for r in new if r["anchor"] not in old_by_anchor]
    added, re_anchored = [], []
    for r in new_rest:
        o = old_rest.get(r["number"]) if r["number"] else None
        if o is None:
            added.append(r)
        else:
            re_anchored.append((o, r))
            pairs.append((o, r, "number"))
    matched_old = {o["anchor"] for o, _, _ in pairs}
    removed = [r for r in old if r["anchor"] not in matched_old]

    renumber_map = {o["number"]: n["number"] for o, n, how in pairs
                    if how == "anchor" and o["number"] and n["number"] and o["number"] != n["number"]}
    renumbered = [(o, n) for o, n, how in pairs if how == "anchor" and o["number"] != n["number"]]

    def remap(text: str) -> str:
        return RULE_NUMBER_RE.sub(lambda m: renumber_map.get(m.group(0), m.group(0)), text)

    changed = []
    for o, n, how in pairs:
        if body(o) != body(n):
            changed.append({"old": o, "new": n, "matched_by": how,
                            "cross_refs_only": remap(body(o)) == body(n),
                            "similarity": similarity(body(o), body(n))})

    # A hint, not a pairing: the added row most like each removed one, so a
    # rule that moved to a new anchor (rewritten or not) can be found. The
    # categories above never depend on it.
    successors = {}
    for r in removed:
        # Ties go to the earliest added row; either direction is stable, so no test pins it.
        scored = [(similarity(body(r), body(a)), -i) for i, a in enumerate(added)]
        if scored:
            score, neg_i = max(scored)
            if score >= SUCCESSOR_MIN:
                successors[r["anchor"]] = (added[-neg_i], score)

    old_number_anchor = {r["number"]: r["anchor"] for r in old if r["number"]}
    reused = [(old_by_anchor[old_number_anchor[r["number"]]], r) for r in new
              if r["number"] in old_number_anchor and old_number_anchor[r["number"]] != r["anchor"]
              and (old_by_anchor[old_number_anchor[r["number"]]], r) not in re_anchored]
    return {"old_count": len(old), "new_count": len(new), "added": added, "removed": removed,
            "renumbered": renumbered, "changed": changed, "re_anchored": re_anchored, "reused": reused,
            "renumber_map": renumber_map, "successors": successors}


def similarity(a: str, b: str) -> float:
    """Word-level similarity in [0, 1], rounded so the output is stable."""
    return round(difflib.SequenceMatcher(None, a.split(), b.split(), autojunk=False).ratio(), 2)


def trim_pair(old: str, new: str) -> tuple[str, str]:
    """Both texts, cut to the region that differs plus some context, when long."""
    if len(old) <= FULL_LIMIT and len(new) <= FULL_LIMIT:
        return old, new
    p = 0
    while p < min(len(old), len(new)) and old[p] == new[p]:
        p += 1
    s = 0
    while s < min(len(old), len(new)) - p and old[-1 - s] == new[-1 - s]:
        s += 1
    start = max(0, p - CONTEXT)

    def cut(text: str) -> str:
        end = min(len(text), len(text) - s + CONTEXT)
        return ("…" if start > 0 else "") + text[start:end] + ("…" if end < len(text) else "")
    return cut(old), cut(new)


def _short(text: str, limit: int = 200) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _quote(text: str) -> str:
    return "> " + text.replace("\n", "\n> ")


def to_markdown(d: dict, old_name: str, new_name: str) -> str:
    out = [f"Old: `{old_name}` ({d['old_count']} rows). New: `{new_name}` ({d['new_count']} rows).", "",
           "| Category | Count |", "| --- | ---: |"]
    xref = sum(1 for c in d["changed"] if c["cross_refs_only"])
    rewritten = sum(1 for c in d["changed"] if c["similarity"] < REWRITE_MAX)
    for name, count in (("added", len(d["added"])), ("removed", len(d["removed"])),
                        ("renumbered (same anchor)", len(d["renumbered"])),
                        ("text changed", len(d["changed"])),
                        ("text changed, cross-references only", xref),
                        (f"text changed, largely rewritten (similarity < {REWRITE_MAX})", rewritten),
                        ("re-anchored (paired by number)", len(d["re_anchored"])),
                        ("number reused for a different rule", len(d["reused"]))):
        out.append(f"| {name} | {count} |")

    def rows_section(title: str, rows: list[dict], hints: dict | None = None) -> None:
        out.extend(["", f"### {title} ({len(rows)})", ""])
        if not rows:
            out.append("None.")
        if hints:
            out.extend([f"\"Likely successor\" names the added rule with the most similar text (word similarity "
                        f">= {SUCCESSOR_MIN}); it is a hint for a reviewer, not a pairing.", ""])
        for r in rows:
            hint = (hints or {}).get(r["anchor"])
            tail = f" *Likely successor: {label(hint[0])} (similarity {hint[1]:.2f}).*" if hint else ""
            out.append(f"- **{label(r)}** ({r['kind']}): {_short(body(r))}{tail}")

    rows_section("Added", d["added"])
    rows_section("Removed", d["removed"], d["successors"])

    out.extend(["", f"### Renumbered ({len(d['renumbered'])})", ""])
    if d["renumbered"]:
        out.extend(["| Old | New | Text also changed |", "| --- | --- | --- |"])
        changed_anchors = {c["new"]["anchor"] for c in d["changed"]}
        for o, n in d["renumbered"]:
            out.append(f"| {label(o)} | {label(n)} | {'yes' if n['anchor'] in changed_anchors else ''} |")
    else:
        out.append("None.")

    out.extend(["", f"### Number reused for a different rule ({len(d['reused'])})", ""])
    if d["reused"]:
        out.append("Each number below exists in both snapshots but names a different rule now.")
        out.append("")
        for o, n in d["reused"]:
            out.append(f"- **{n['number']}** was: {_short(body(o), 120)} / now: {_short(body(n), 120)}")
    else:
        out.append("None.")

    out.extend(["", f"### Re-anchored, paired by number ({len(d['re_anchored'])})", ""])
    out.append("None." if not d["re_anchored"] else "")
    for o, n in d["re_anchored"]:
        out.append(f"- **{n['number']}**: {o['anchor']} -> {n['anchor']}")

    out.extend(["", f"### Text changed ({len(d['changed'])})", ""])
    if not d["changed"]:
        out.append("None.")
    for c in d["changed"]:
        o, n = c["old"], c["new"]
        head = label(n) if label(o) == label(n) else f"{label(o)} -> {label(n)}"
        notes = [n["kind"]]
        if c["cross_refs_only"]:
            notes.append("cross-references only")
        if c["similarity"] < REWRITE_MAX:
            notes.append(f"largely rewritten, similarity {c['similarity']:.2f}")
        if c["matched_by"] == "number":
            notes.append("paired by number")
        old_t, new_t = trim_pair(body(o), body(n))
        out.extend([f"#### {head} ({', '.join(notes)})", "", "Old:", "", _quote(old_t), "", "New:", "",
                    _quote(new_t), ""])
    return "\n".join(out).rstrip() + "\n"


def to_json(d: dict) -> dict:
    return {"old_count": d["old_count"], "new_count": d["new_count"],
            "added": [label(r) for r in d["added"]], "removed": [label(r) for r in d["removed"]],
            "renumbered": [[label(o), label(n)] for o, n in d["renumbered"]],
            "changed": [{"old": label(c["old"]), "new": label(c["new"]), "matched_by": c["matched_by"],
                         "cross_refs_only": c["cross_refs_only"], "similarity": c["similarity"],
                         "old_text": body(c["old"]),
                         "new_text": body(c["new"])} for c in d["changed"]],
            "re_anchored": [[label(o), label(n)] for o, n in d["re_anchored"]],
            "reused": [n["number"] for _, n in d["reused"]],
            "successors": {label(r): [label(d["successors"][r["anchor"]][0]), d["successors"][r["anchor"]][1]]
                           for r in d["removed"] if r["anchor"] in d["successors"]}}


def read_input(path: str | None, rev: str | None, default_rel: Path) -> tuple[str, str]:
    if rev:
        rel = str(Path(path).resolve().relative_to(REPO_ROOT)) if path else str(default_rel)
        text = subprocess.run(["git", "show", f"{rev}:{rel}"], cwd=REPO_ROOT, check=True,
                              capture_output=True, text=True).stdout
        return text, f"{rev}:{rel}"
    return Path(path).read_text(encoding="utf-8"), str(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", help="older snapshot file (with --old-rev: its repo path; default the raw rules)")
    ap.add_argument("--old-rev", help="read --old from this git revision instead of the working tree")
    ap.add_argument("--new", default=str(DEFAULT_NEW), help="newer snapshot file (default: the raw rules)")
    ap.add_argument("--json", action="store_true", help="print JSON instead of Markdown")
    ap.add_argument("--out", type=Path, help="write to this file instead of stdout")
    args = ap.parse_args(argv)
    if not args.old and not args.old_rev:
        ap.error("give --old, --old-rev, or both")
    default_rel = DEFAULT_NEW.relative_to(REPO_ROOT)
    old_text, old_name = read_input(args.old, args.old_rev, default_rel)
    new_text, new_name = read_input(args.new, None, default_rel)
    try:
        new_name = str(Path(new_name).resolve().relative_to(REPO_ROOT))
    except ValueError:
        pass
    d = diff(rows_from_text(old_text, old_name), rows_from_text(new_text, new_name))
    rendered = (json.dumps(to_json(d), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
                if args.json else to_markdown(d, old_name, new_name))
    if args.out:
        args.out.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
