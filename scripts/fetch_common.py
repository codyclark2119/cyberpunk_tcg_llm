"""HTTP and snapshot-write helpers shared by the scripts/fetch_*.py CLIs.

Not a CLI itself. It exists so the four fetch scripts send one User-Agent
through one `fetch_json`, and so every file they write into `data/raw/` goes
through the same shrink guard as the jsonl corpora (`harness.core.io.
guard_shrink`): a fetch that comes back short (an API that pages differently,
a card whose `printings` arrive empty, a CMS page missing an erratum) refuses
to overwrite a fuller snapshot unless the caller passes `--force`.

Kept under scripts/ rather than harness/core because the User-Agent and the
record counts are this game's; `harness/` stays game-agnostic.
"""

import json
import sys
import urllib.request
from pathlib import Path
from typing import Callable

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from harness.core.io import guard_shrink  # noqa: E402

USER_AGENT = "Mozilla/5.0 (compatible; cyberpunk-llm-corpus-builder/1.0)"


def fetch_json(url: str, timeout: int = 30, payload: dict | None = None):
    """GET `url` (or POST `payload` as JSON) and decode the JSON response."""
    headers = {"User-Agent": USER_AGENT}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def write_json_snapshot(path: Path, doc, count: Callable[[object], int], *,
                        force: bool = False, min_ratio: float = 0.9,
                        what: str = "records") -> None:
    """Write `doc` as sorted, indented JSON, refusing to shrink `path`.

    `count` maps a document to its number of records (cards in an index, rule
    nodes, printings of one card). The existing file is counted the same way
    and the write follows `guard_shrink`'s rule: the new document must reach
    `min_ratio` of the old one unless `force`. An existing file that does not
    parse is treated as nothing to protect only under `force`.
    """
    if path.exists() and not force:
        try:
            existing = count(json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, KeyError, TypeError) as exc:
            raise SystemExit(f"cannot count the existing {path} ({exc}); "
                             f"pass --force to overwrite it")
        guard_shrink(path, count(doc), force=force, min_ratio=min_ratio,
                     what=what, existing=existing,
                     hint="A short fetch must not replace a fuller snapshot.")
    path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
