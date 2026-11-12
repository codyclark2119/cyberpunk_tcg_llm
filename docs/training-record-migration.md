# Moving the gold position store onto TrainingPosition

2026-11-12. Plan only; nothing in `data/gold/` or `eval/runs/` was changed by the work
that produced it.

## Where things stand

- **The format.** The TypeScript contract in `packages/training-harness` is the training
  record format: `TrainingPositionSchema` (schemaVersion 2) and `TrainingAttemptSchema`
  (schemaVersion 1). Both are exported by `npm run contracts:export` to
  `packages/wire/schemas/trainingPosition.v1.json` and `trainingAttempt.v1.json` (the
  file suffix is the export version, not the record version).
- **Python access.** `harness/core/training_records.py` reads, writes and validates both
  record types against those exported schemas, fails closed on unknown fields, unknown
  `schemaVersion` and unknown schema keywords, and provides the local-match logging hook
  (`build_position`, `build_attempt`, `TrainingLog`). `scripts/test_training_records.py`
  round-trips records between Python and TS on engine-generated fixture positions.
- **The gold store.** `harness/core/gameplay/store.py` and `review.py` hold a looser,
  game-agnostic position: `id`, `category`, `difficulty`, `key_points`,
  `common_errors`, `players.{you,opp}`, optional `active_player` / `priority`, plus
  whatever the game adds. That is a draft-review-promote rubric format for judged
  answers, not an engine state. **There is no `data/gold/positions.jsonl` yet**
  (`data/gold/` holds only `SCHEMA.md`), so there is no published gameplay measurement
  to carry across. The migration is about the code path and the future store, not about
  converting existing rows.

## The shape after migration

A gold gameplay item becomes two linked records:

1. a **TrainingPosition** (engine-owned, never hand-edited), and
2. a **review record** that refers to it by `positionId` and pins its `positionHash`,
   carrying everything a person wrote.

The rubric does not go into TrainingPosition: the TS schema is a `strictObject`, it is
engine-derived end to end, and adding reviewer prose to it would require a schema
change (out of scope; see the last section).

Suggested review record (a new Python-side format, `GoldPositionReview` v1):

| Field | Source |
| --- | --- |
| `schemaVersion` | `1` |
| `positionId`, `positionHash`, `engineVersion`, `engineArtifactHash` | copied from the TrainingPosition; a mismatch on load is a hard error |
| `category`, `difficulty` | carried from the current gold position |
| `key_points`, `common_errors` | carried; written by a person |
| `bestActionIds` (optional) | the actionIds a reviewer marks correct; each must be in the position's `legalActions` |
| `source`, `verified_by`, `rules_version`, `notes` | carried |
| `reviewed` | the existing signature from `review.py`; stays required |

## Field mapping

| Current gold field | Destination | How it gets there |
| --- | --- | --- |
| `id` | review `positionId` and TrainingPosition `positionId` | carried (ids stay stable; `next_position_id` keeps allocating them) |
| `category`, `difficulty` | review record | carried unchanged |
| `key_points`, `common_errors` | review record | carried, then **re-reviewed** (below) |
| `players.you`, `players.opp` (hand-described boards) | TrainingPosition `state` + `observation` | **engine regenerates**: the board must be reached through `createGame` + `applyAction` (or a replay fixture), never transcribed |
| `active_player`, `priority` | TrainingPosition `actingSeat`, `state.timing.actingPlayer` | **engine regenerates** |
| any game-specific candidate move list | TrainingPosition `legalActions` | **engine regenerates** (`listLegalActions`); hand-written moves are dropped |
| a reviewer's "correct move" in prose | review `bestActionIds` | person maps the prose onto engine actionIds; actionIds are hashes and change with the state, so they are always picked from the regenerated position |
| — | `stateHash`, `positionHash`, `observationHash`, `contentManifestHash`, `manifest`, `engineVersion`, `engineArtifactHash` | **engine regenerates**; Python never computes them |
| — | `provenance` | set by the generator: `{generator, revision, seed}`, seed equal to `state.rng.seed` |
| `source`, `verified_by`, `rules_version`, `notes` | review record | carried |

## What needs the engine

Everything in TrainingPosition. The supported paths are TS `generatePosition` (e.g. a
fixture script like `scripts/training-demo.ts`) or, from Python, `build_position` fed by
the engine worker's `observe`, `listLegalActions` and `hash` answers for the runner's
current state. Before any position becomes gold, run it through TS
`validateTrainingPosition` with the matching content bundle (as
`scripts/check-training-records.ts <positions> <attempts> <outDir> <content.json>` does),
which re-derives the observation and legal actions and rejects forged labels or hashes.
The Python reader checks structure and field equalities only.

An engine identity bump (`scripts/engine-identity.ts`) makes every stored position
stale, as it does for replays. Gold positions then need regeneration from their
recorded inputs (seed, decks, action sequence), and the review record's pinned
`positionHash` shows which ones actually changed.

## What a person must re-review

- **Every rubric**, once, against the regenerated position: a hand-described board and
  the engine's state can disagree, and some Cyberpunk TCG terms invert other games'
  conventions (only ready Units attack, only spent Units can be attacked). A rubric
  written against a misremembered board is wrong even when it reads well.
- **`bestActionIds`**: chosen by a person from the engine's offered actions.
- **Any position whose `positionHash` changed** after an engine regeneration. Positions
  whose hash, legal-action set and observation are unchanged keep their review; only
  pin and legal-action-order changes are free, as with replay regeneration.
- Promotion keeps `review.py`'s two signals (`reviewed: true` and no `DRAFT:` text).
  Nothing generated is gold until a person signs it.

## Steps

1. Add the `GoldPositionReview` reader/validator next to `harness/core/gameplay/store.py`,
   loading the referenced TrainingPosition through `training_records.read_positions`
   and refusing a pin mismatch.
2. Have the draft step in `review.py` take a TrainingPosition (from a local match record
   or fixture) instead of a hand-described board, and render the board from its
   `observation`.
3. Store positions at `data/gold/training_positions.jsonl` and reviews at
   `data/gold/position_reviews.jsonl`; `guard_shrink` with `min_ratio=1.0` on both.
4. Point the gameplay eval at the review records; score a model attempt by matching its
   `parsedChoice.actionId` against `bestActionIds` and the rubric as today.
5. Retire `common_problems` for gameplay once nothing writes the old shape.

Check `git diff --quiet -- data/gold eval/runs` before and after each step that touches
the store, and say so in the change if either moves.

## Not decided here

- Whether review metadata should become a TS contract (a `GoldReviewSchema` in
  `packages/training-harness`). That is a TS schema addition and needs its own approval.
- Where long-term attempt logs live (they are not gold and should stay out of
  `data/gold/`; `local/` is gitignored and is the natural home for run output).
