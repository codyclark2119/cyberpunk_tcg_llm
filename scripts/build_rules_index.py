#!/usr/bin/env python3
"""Build the embedding index that lets search_rules run hybrid (lexical + embedding) retrieval.

Why: lexical search cannot connect "played this turn" to "Units enter the field
with Lag", or "maximum hand size" to "no limit to the number of cards in your
hand"; an embedding can. ``search_rules`` uses this index only when it exists
AND its fingerprint matches the current rule-level corpus
(``games/cyberpunk/assistant/retrieval.py``: every rule plus the errata, each
prefixed by its heading path). A stale or foreign index is ignored and the tool
says why, so rebuilding is always safe and never required.

Apple Silicon only: it embeds with ``harness.core.rag.index.build_index``
(mlx_embeddings). The output is a build artifact at
``data/processed/corpus_index.npz`` (``*.npz`` is git-ignored): never commit it.
``--check`` reports whether the existing index matches, on any machine.

Usage:
    python scripts/build_rules_index.py                # build (Mac)
    python scripts/build_rules_index.py --check        # is the current index usable?
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from games.cyberpunk.assistant import retrieval, tools  # noqa: E402
from harness.core.io import write_jsonl_atomic  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report the index status and exit (no model needed)")
    parser.add_argument("--model-id", default=None, help="embedding model (default: harness DEFAULT_MODEL_ID)")
    args = parser.parse_args(argv)

    if args.check:
        status = tools.index_status()
        print(json.dumps(status, indent=2, sort_keys=True))
        return 0 if status["usable"] else 1

    try:
        from harness.core.rag.index import DEFAULT_MODEL_ID, build_index
        import mlx_embeddings  # noqa: F401  -- fail here, before any work, on a machine without it
    except ImportError as exc:
        print(f"cannot build the rules index here: {exc}. It needs Apple Silicon with mlx-embeddings installed "
              "(pip install -r requirements.txt). search_rules keeps answering lexically until it exists.",
              file=sys.stderr)
        return 2

    docs = tools.rule_docs()
    chunks = retrieval.embedding_chunks(docs)
    out = tools.RULES_INDEX_PATH
    print(f"embedding {len(chunks)} rule-level documents -> {out}", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        chunks_path = Path(tmp) / "rule_docs.jsonl"
        write_jsonl_atomic(chunks_path, chunks)
        build_index(chunks_path, out, model_id=args.model_id or DEFAULT_MODEL_ID)
    tools._INDEX_CACHE.clear()
    status = tools.index_status()
    print(json.dumps(status, indent=2, sort_keys=True))
    if not status["usable"]:
        print("the index was written but does not match the corpus: this is a bug", file=sys.stderr)
        return 1
    print("search_rules will now run hybrid retrieval; measure it with: python scripts/eval_retrieval.py --quiet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
