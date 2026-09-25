# Engine Candidate Admission V1

This review tooling consumes the non-authoritative `CYBERPUNK_ENGINE_CANDIDATES_V1` export that the Python AI harness in this repository writes with `scripts/export_engine_candidates.py`.

It does **not** admit cards into gameplay, assign immutable revisions, synthesize mechanics, or alter engine content manifests.

## Input

The AI harness exports:

```text
data/engine-candidates/card-catalog.v1.jsonl
data/engine-candidates/manifest.v1.json
```

The manifest must declare `authority: SOURCE_CANDIDATES_ONLY`, contain the exact forbidden-authority field set, and pin by SHA-256:

- the serialized candidate catalog,
- `data/processed/card_database.jsonl`,
- `data/raw/cards/_index.json`,
- `data/processed/errata.jsonl`.

The review CLI verifies all four hashes. It reads `data/engine-candidates` in this repository unless `--candidate-dir` points elsewhere.

## Review classifications

Each candidate is compared to the latest currently reviewed immutable revision with the same candidate CardId.

- `NOT_ADMITTED` — no reviewed immutable revision exists for that CardId.
- `SOURCE_MATCH` — the candidate agrees with the current reviewed revision on identity, card type/colors, classifications, sellability, rendered rules text and source markup.
- `SOURCE_DRIFT` — a reviewed CardId exists but one or more source-facing fields differ.
- `UNSUPPORTED_HINT` — the source bridge emitted a keyword/timing hint outside the reviewed V1 source vocabulary.

These classifications are review evidence only. Even `SOURCE_MATCH` does not grant admission to a new revision.

## Authority boundary

The candidate schema cannot provide or derive:

- `revision`
- `mechanics`
- `execution`
- `reviewed`
- `status`

Parser hints such as `Go Solo`, `Blocker`, `Call`, or `Defeated` are diagnostic source facts. They are never converted into executable engine mechanics automatically.

## Running

From the repository root:

```bash
npm run review:engine-candidates
```

For a stricter check of already-reviewed CardIds:

```bash
npm run review:engine-candidates -- --strict-reviewed
```

`--strict-reviewed` exits non-zero when an already-reviewed CardId reports source drift or an unsupported source hint. `NOT_ADMITTED` is expected for cards that have not yet received an explicit engine review.

## Next admission step

A future admission PR should select a small candidate batch, review source text/errata/printings, explicitly author the `CardRevisionSnapshot` mechanics and execution scope, assign a revision number, and then run all normal content/engine replay gates. This tool deliberately stops before that decision.
