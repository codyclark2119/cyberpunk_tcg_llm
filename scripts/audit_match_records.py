#!/usr/bin/env python3
"""Audit local match records by replaying them on the running engine worker.

Why: match records under local/matches/ (and strength-eval runs) feed every
number this project reports about local play: win rates, fallbacks, baseline
agreement, model choices. A record is only evidence if the engine agrees with
it. This replays each record from its seed on the real engine worker and
compares the record to what the engine says, without deciding anything itself
(games/cyberpunk/match_audit.py):

  * the header's engine version and artifact hash are the running worker's
    (otherwise the record is STALE and is not replayed), and its content,
    format, players, decks and matchId are the audit setup's;
  * every recorded actionId is one the engine offers at that point, every
    engine-derived row field matches the offer, and every recorded stateHash
    and the final state hash match the replay;
  * selection reasons fit the seat (a fallback carries an error code and plays
    the baseline's pick; a model seat's "policy" row is backed by its raw
    output) and the result row matches the replayed final state.

It prints one line per record, its problems, and per policy the model
choices, each fallback reason and error code and baseline agreement over the
replayed decisions. Exit status is 0 only when every record is clean; any
mismatch, stale or unreadable record exits 1.

Usage:
  python scripts/audit_match_records.py                      # every record in local/matches/
  python scripts/audit_match_records.py local/matches/demo-0.jsonl local/strength/run/matches
  python scripts/audit_match_records.py --setup my-setup.json  # records played with --setup
  python scripts/audit_match_records.py --json               # the full report as JSON

Records played with ``run_local_matches.py --setup FILE`` need the same
``--setup FILE`` here. Nothing is written, fetched or served. Needs node and
installed npm dependencies.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.local_match import DEFAULT_OUTPUT_DIR, load_default_setup, load_setup_file
from games.cyberpunk.match_audit import audit_paths, format_report, record_paths, running_engine


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="*", help="record files or directories of *.jsonl records "
                                                 f"(default: {DEFAULT_OUTPUT_DIR.relative_to(REPO_ROOT)})")
    parser.add_argument("--setup", help="JSON setup file (content and initialization) the records were "
                                        "played with; default the fixed Demo setup")
    parser.add_argument("--json", action="store_true", help="print the full report as JSON")
    parser.add_argument("--node", default="node", help="node binary (default: node)")
    args = parser.parse_args(argv)

    paths = record_paths(args.paths or [DEFAULT_OUTPUT_DIR])
    if not paths:
        print(f"no match records found in {', '.join(args.paths) or str(DEFAULT_OUTPUT_DIR)}", file=sys.stderr)
        return 1
    setup = load_setup_file(args.setup) if args.setup else load_default_setup(REPO_ROOT, node=args.node)
    report = audit_paths(paths, setup, running_engine(REPO_ROOT, args.node), node=args.node)
    if args.json:
        print(json.dumps(report, indent=1))
    else:
        print("\n".join(format_report(report)))
    return 0 if report["totals"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
