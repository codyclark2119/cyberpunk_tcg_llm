# CLAUDE.md

Working guidance for this repository. [README.md](README.md) covers setup,
commands and architecture; [docs/README.md](docs/README.md) indexes the milestone
and admission records.

## What this is

One repository, two halves, and one authority boundary between them:

- **TypeScript engine and platform** (`packages/`, `apps/web/`, `tests/`, most of
  `scripts/`). The deterministic engine is the only authority for rules, legality,
  hidden state, RNG, legal-action enumeration and state transitions.
- **Python AI harness** (`games/`, `harness/`, `data/`, `eval/`, `scripts/*.py`).
  It may read public observations and engine-enumerated legal actions, and return an
  engine-offered `actionId`. It never implements game rules, and nothing under
  `harness/` may import from `games/`.

**The game launched in 2026 and is in open beta.** No base model knows it; anything a
model appears to recall about Cyberpunk TCG is confabulated, and some terms invert
other games' conventions (only **ready** Units attack, only **spent** Units can be
attacked). The rules and cards move, so `data/` is a dated snapshot and every
measurement is against that snapshot.

## Commands

Use the Node version in `.nvmrc` (`nvm use`); CI uses the same one.

```bash
npm run typecheck && npm run lint && npm run validate:cards
npm test                     # ~1,360 unit tests, about a minute
npm run build
npm run test:integration     # needs TEST_DATABASE_URL and TEST_MONGODB_URI
python scripts/test_cyberpunk.py && python scripts/test_harness_core.py
python scripts/test_engine_candidates.py && python scripts/test_engine_adapter.py
python scripts/check_deck_rules.py --negative-control
```

Tests use `node:test` through tsx, and the Python suites are plain scripts with asserts
(no pytest). Run a single TypeScript file with
`node --import tsx --test tests/<name>.test.ts`.

## Engine rules

- **Engine identity pins everything generated.** `scripts/engine-identity.ts` hashes
  `packages/domain/src`, `packages/engine/src`, `packages/wire/src`,
  `scripts/engine-worker.ts`, itself and `package-lock.json`. Editing any of these,
  including `npm install` changing the lockfile, makes every committed replay and
  schema stale. Bump the version string in that file for a deliberate runtime change.
- **Never hand-edit hashes or generated fixtures.** Regenerate with
  `npm run baseline:regenerate -- --preserved <last pre-change commit>` (about 40
  minutes; matrix traces go to `/tmp/tcg-reboot-model-a-traces`). Then classify the
  diff: pin and legal-action-order changes are expected; changes to chosen actions,
  events or final states must be intended by the engine change. Commit the
  regeneration separately from the runtime change.
- **Cards enter only through reviewed admission.** Source text, API data and parser
  hints are evidence, never executable mechanics. Each admission explicitly authors an
  immutable `CardRevisionSnapshot` with its mechanics and execution scope, keeps
  admission gates exact and fail-closed, and adds no runtime dispatch on card names.
  Existing revisions, fixed Demo decks and pinned source evidence are never edited in
  place. Record each new batch in `docs/api-admission-batch-v<N>.md` and add it to
  `docs/README.md`.
- **Determinism is a feature.** No wall-clock time, unseeded randomness or
  hash-order-dependent selection in engine code; replays must survive reversed
  legal-action lists.

## CI

PR Validation runs the unit, integration and AI jobs on every PR, and the `master`
ruleset requires all three. There are deliberately no path filters, skips or
conditional jobs, and `.github/scripts/assert-test-summary.test.mjs` pins that
structure, so do not work around it. The AI job asserts exact pass lines such as
`all 89 tests passed`; update the expected line in `pr-validation.yml` when you add or
remove a Python test. A stale baseline is a real failure, fixed by regeneration.

## AI harness rules

The data pipeline, all idempotent from `data/raw/` and needing no network except the
fetches:

```bash
python scripts/fetch_rules.py && python scripts/fetch_cards.py && python scripts/fetch_errata.py
python scripts/ingest.py && python scripts/build_cards.py && python scripts/build_errata.py
python scripts/chunk_corpus.py
```

- **Never re-fetch or re-ingest as a side effect of another task.** A snapshot refresh
  is its own change and moves `RULES_VERSION` in `games/cyberpunk/prompts.py` in the
  same commit.
- **Errata override printed card text.** They come from the CMS API, not the rendered
  page. An erratum that joins no card, or joins the wrong one, is a hard error. Keep
  it that way.
- **272/272 deck agreement proves little**: every public deck is legal. Run
  `check_deck_rules.py --negative-control` after any change to `deckbuilding.py`.
- **An unknown keyword must break the build.** Add it to the vocabulary in
  `games/cyberpunk/markup.py`; do not let it classify silently.
- **A card's identity is its slug**, never its name; several cards share names.
- Scripts are CLIs (`argparse` with `description=__doc__`, a docstring explaining why).
  Read and write data with `harness.core.io.read_jsonl` / `write_jsonl_atomic`, refuse to
  shrink a corpus without `--force` via `guard_shrink`, and anchor paths on `REPO_ROOT`.
- **Never train on the eval set. Never silently change a measurement**: check
  `git diff --quiet` on `data/gold/` and `eval/runs/` before touching them, and say so
  if they change. Gold data means a person reviewed it.

[docs/ai-source/CLAUDE.legacy.md](docs/ai-source/CLAUDE.legacy.md) records the traps
this harness already fell into (weak fixtures, mutations that were not the bug, corpus
tests that cannot catch code bugs). Read it before changing the corpus or its tests.

## Documentation

Reports in `docs/` are dated records; do not rewrite history in them. Update
`README.md`, this file, `docs/ci-validation.md` or `docs/README.md` when the thing they
describe changes, and give new milestones their own document.

## Commits

Commit on a feature branch, never on `master`, which only accepts PRs. Pushing,
opening or merging PRs, and any other outward-facing action need the user's approval
first.
