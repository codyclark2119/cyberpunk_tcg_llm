> Historical setup milestone report. The subsequent [noncombat play report](noncombat-play-report.md) adds Afterparty/Kerry and supersedes the Program/Gig-boundary blockers below.

# Engine-owned setup and reviewed noncombat mechanics

Implemented engine-owned setup, complete match event batches, Viktor's CALL search/selection, and Royce's persistent Legend-area power query. Rebecca's PRM01 promo is an excluded negative fixture. **The broader requested real-card milestone is only partially met:** the reviewed set has two implemented behaviors, and no real Gig-conditioned CALL or Gig-changing card handler. See [coverage and source decisions](executable-card-coverage.md). Combat and Program/activated-effect play were not added to compensate for unavailable CALL examples.

## Runtime

The shell initially selected Node 22.5.1 / npm 10.8.2. Every quality gate used the installed `/Users/codyclark/.nvm/versions/node/v22.13.0/bin` explicitly: **Node 22.13.0, npm 10.9.2**. `.nvmrc`, package runtime pins and dependencies were not changed.

## Exact setup protocol

Opt in through pinned `turnSlice.setup: "ENGINE_SETUP_V1"` and omit the old `initialization.setup` object. Supplying an externally chosen first player in this mode is rejected. The old agreed/declined setup policy remains an explicit legacy regression mode.

The agreed protocol uses a uniform deterministic seat draw, which rule 7.5.1 allows as an agreed random method; the suggested contested d20 rolls are a tip, not mandatory. The chosen player receives FIRST/SECOND options. Fisher–Yates uses the existing rejection-sampled deterministic counter RNG.

```text
createGameWithEvents: turn 0, random player determination
CHOOSE_FIRST_PLAYER: winner chooses FIRST / SECOND
  → shuffle both main decks (7.6.1)
CUT_DECISION: rival of seat 0 cuts/declines seat 0's main deck
CUT_DECISION: rival of seat 1 cuts/declines seat 1's main deck (7.6.2)
  → randomize both Legend stacks (7.7.1)
CUT_DECISION: rival of seat 0 cuts/declines seat 0's Legends
CUT_DECISION: rival of seat 1 cuts/declines seat 1's Legends (7.7.2)
  → spend first player's two leftmost Legends (7.7.4)
  → prepare Fixers (7.8), deal six cards to each player (7.9.1)
MULLIGAN_DECISION: first player keeps or returns ALL six, shuffles, draws six
MULLIGAN_DECISION: second player keeps or returns ALL six, shuffles, draws six
  → GAME_SETUP_COMPLETED
TURN_START → READY (first-turn exception) → DRAW → CHOOSE_GIG → MAIN
```

Seat order serializes independent rival cut offers; it does not change turn order. A cut chooses a position 1…N−1 and rotates that prefix to the bottom. Position 0 is explicitly labelled decline. This is the pinned digital single-cut protocol; the capture permits a cut but does not prescribe a digital representation. Each player receives exactly one whole-hand mulligan opportunity, with first-player completion before the second player's decision. Rule 7.9.3.2 repeats the **shuffle method**, not the earlier cut offer; there is no extra mulligan cut. This interpretation is explicit and requires a new pinned protocol if a subsequent rules review changes it.

Dice identities are allocated with the initial registry to retain schema-2 identity/location invariants. They are inactive during setup and omitted from observations until 7.8's `FIXER_PREPARED` events, before opening hands. Automatic operations never return a training decision. Seven setup choice boundaries are covered by the headline fixture.

## Mechanics, choices and hidden information

The typed `HandlerRegistry` replaces the unused CUSTOM-handler scaffold for this slice with DRAW and SEARCH_GEAR primitives. Metadata specifies the effect; handwritten code validates/selects/resolves it. Unknown effects and multiple triggers are rejected. CALL reveals the Legend, discovers its single supported trigger, stores a PendingEffect, and either resolves immediately or pauses at TARGET_SELECTION. Search options are regenerated from the current looked-at top cards, printed Gear type/cost and selected set; continuation validation rejects forged or stale selections and source changes. “Take no more Gears” explicitly represents optional completion. There is no separate synthetic yes/no ability.

Viktor's actor may inspect five cards and choose up to two eligible Gears. Zero eligible targets resolves internally, including on an empty deck; search is not draw. Selection emits CARD_REVEALED/CARD_MOVED, then randomizes the remainder to the bottom and emits EFFECT_RESOLVED before state-based processing returns to MAIN. The source revision and instance identity are retained.

Royce's condition is part of its narrow typed persistent modifier: face-up, LEGENDS zone, controller's active turn. Power derives from base + applicable Gear-count bonus; neither base data nor cached power is mutated. No new general ConditionSchema entries were necessary. The current CALL pipeline still rejects conditional CALL metadata: no safe matching card was selected. No universal continuous-effects engine, target DSL or simultaneous scheduler was introduced.

Opponent hands, face-down Legends, deck order, shuffle events and future RNG are absent from model observations. Search inspection belongs only to the deciding player. Labels for hidden setup objects use slots, not CardIds. Reveal events record what was shown; after the card goes face-down in hand, rule 11.14.4 makes it hidden again. Full engine states, bundle inputs, event ledgers and replay fixtures remain private authoritative data, not public client/model payloads.

## Replay and interop

Engine artifact version: `0.4.0-setup-reviewed-1`. Schema-2 GameState and version-1 JSONL request/response envelopes remain; additions are schema validated and all affected exported schemas/goldens were regenerated. Consumers pin the engine artifact, so old artifact results are not silently treated as current results.

The semantic hash projection is explicitly `POSITION_V2`: match transport counters and effect `causedBySequence` provenance are excluded, while full ReplayStateHash retains them. Pending CALL identities use turn/source rather than the event sequence. A focused test proves equivalent CALL/search choices keep action IDs despite different transport counters.

| Fixture | Actions after creation | Generated positions | Final ReplayStateHash |
|---|---:|---:|---|
| Original turn regression | 7 | 3 | `9f349d929269d7d01c7c80ac80e47cabfaab61cbefdd9281db0c208c3169d15d` |
| Engine setup + synthetic turn | 10 | 7 | `84fd6ed90a5486373c9d9512d0ac56bc1e657f623d73f1fccfb9d56abeba116b` |
| Engine setup + real Viktor CALL | 11 | 11 | `bca6b5336fcf54effaadd233a8d5c5ec97303a8680abe02311bed5497d65a54a` |

Replays compare initial states, all legal actions/action IDs, PendingChoices, semantic submissions, events, observations and their hashes, position hashes and final states. Python uses its unchanged generic adapter: create_game → legal_actions/model_input → submit(actionId). Its test driver now reproduces all three fixtures. No Next.js, Apollo or database dependency enters the engine or Python adapter; no model was downloaded or trained.

## Persistence

No migration was necessary. `match_events` already has unique `(match_id, sequence)` and JSON payloads.

- `create(state, events)` requires sequence 1 through `state.match.eventSequence`; omitted events work only if that sequence is zero.
- `save(state, expectedVersion, events)` locks the match, verifies existing complete history and the exact new contiguous batch, enforces immutable pins and compare-and-swap, then writes state and events in one transaction.
- `history(id)` reads under a consistent snapshot and rejects an incomplete legacy history explicitly. Old rows without setup events are not silently backfilled.
- Integration tests cover setup and later turns, missing batches, racing saves, and an injected event insertion failure after state UPDATE; both state and ledger roll back.

This makes semantic event history complete for callers using the repository APIs. It is not a new command/action-id archive, authenticated public event stream, or integration of MatchRepository into a web match UI. The existing command ledger remains separately transactional; callers must not assume a separately opened repository transaction shares that ledger transaction. Prior partial histories need explicit recovery, not invented events. History validation currently reads the full event ledger on save; this is deliberate correctness-first behavior for the starter.

## Validation and commands

Final gates passed: 57 TypeScript tests (36 retained + 21 new), 2 real local database integration groups, 87 Python game tests, 48 Python core tests, and all three Python/Node replay loops. Lint/typecheck/build completed without warnings. `validate:cards` still checks the four original catalog fixtures; reviewed executable fixtures are validated by the engine tests. Earlier implementation checks caught a strict-action test fixture passing LegalAction metadata instead of the semantic action, plus TypeScript test annotation/library mismatches; those were corrected without relaxing production schemas.


All application commands below ran in `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online` with the exact prefix `PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH` (the default shell continued to select the older Node):

| Command after that prefix | Result |
|---|---|
| `node -v` | `v22.13.0` |
| `npm -v` | `10.9.2` |
| `npm run typecheck` | Pass, including GraphQL generation and both TypeScript projects |
| `npm run lint` | Pass |
| `npm run validate:cards` | Pass: 4 catalog records |
| `npm test` | Pass: 57 tests, zero failures/skips; final output redirected to `/tmp/tcg-final-tests.log` |
| `npm run build` | Pass: compilation, type checking, six generated static pages; `/api/graphql` remains dynamic |
| `npm run contracts:export` | Pass: current exported contracts; trainingAttempt output unchanged |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass: seven original wire vectors regenerated |
| `node --import tsx scripts/generate-turn-replay.ts` | Pass: seven-action original regression |
| `node --import tsx scripts/generate-setup-replay.ts` | Pass: ten-action setup regression |
| `node --import tsx scripts/generate-reviewed-replay.ts` | Pass: eleven-action real Viktor replay |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | Pass: both groups, real MongoDB/PostgreSQL; only randomized test database/schema created and removed |

`docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Status}}'` confirmed existing healthy Compose services on 27018/5433. Infrastructure was already running; no new Compose setup or migration was necessary. `git diff --check` passed in both repositories.

Exact Python commands, run from `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

All passed. The adapter reproduced 7 + 10 + 11 semantic actions, as well as the seven wire vectors. Existing Python corpus/core suites passed 87 and 48 tests respectively. Test ingestion uses temporary directories, not the captured corpus. The explicit Node path is the supported runtime equivalent of `--node "$(command -v node)"` after selecting the repository runtime.

## Changed files in this pass

| File(s) | Change |
|---|---|
| `packages/domain/src/card.ts` | Explicit noncombat execution coverage metadata |
| `packages/domain/src/game.ts` | Setup/search continuations, stable steps, typed setup/search events |
| `packages/domain/src/mechanics.ts` | Bounded Gear-search effect and Royce-specific persistent modifier |
| `packages/domain/src/repositories.ts` | Match event batch arguments and complete-history read contract |
| `packages/domain/src/ruleset.ts` | Opt-in engine setup and reviewed CALL policies |
| `packages/engine/src/setup-state.ts` | Pure setup choice derivation, invariant validation and public labels |
| `packages/engine/src/setup.ts` | Random first-player flow, shuffles/cuts, mulligans and setup completion |
| `packages/engine/src/search-state.ts` | Current Gear selector, choice regeneration and continuation checks |
| `packages/engine/src/effect-support.ts` | Explicit supported CALL/continuous metadata admission |
| `packages/engine/src/effects.ts` | Typed handwritten handler registry and search resolution |
| `packages/engine/src/index.ts` | Setup/search legal actions, labels and semantic dispatch; registry export |
| `packages/engine/src/initialization.ts` | Engine-owned setup branch and deck-wide execution admission |
| `packages/engine/src/observation.ts` | Private actor inspection, setup dice presentation and target step |
| `packages/engine/src/state.ts` | New continuation checks, face-up Legend attachments and POSITION_V2 |
| `packages/engine/src/turn.ts` | Registered CALL effects, pending search and stable completion |
| `packages/engine/src/view.ts` | Supported CALL checks and derived Royce power |
| `packages/persistence/src/postgres.ts` | Atomic state/event writes and complete-history checks |
| `packages/wire/schemas/request.v1.json`, `response.v1.json`, `trainingPosition.v1.json` | Regenerated additive schemas |
| `scripts/engine-identity.ts` | Explicit new engine artifact version |
| `scripts/generate-setup-replay.ts`, `scripts/generate-reviewed-replay.ts` | Repeatable private replay artifact generation |
| `tests/setup-fixture.ts`, `tests/setup-replay.ts`, `tests/setup.test.ts` | Setup policy/input, deterministic trace and ten setup tests |
| `tests/reviewed-card-fixture.ts`, `tests/reviewed-replay.ts`, `tests/reviewed-cards.test.ts` | Explicit source normalization, real-card trace and eleven card tests |
| `tests/fixtures/setup-replay.v1.json`, `reviewed-replay.v1.json` | New pinned private replay fixtures |
| `tests/fixtures/reviewed-card-sources.v1.json`, `setup-mechanics-rules.v1.json` | Selected local source snapshots and provenance hashes |
| `tests/fixtures/turn-replay.v1.json`, `wire-golden.v1.json` | Existing regressions refreshed for current artifact and hashes |
| `tests/integration/persistence.test.ts` | Complete setup/turn history, CAS, missing batches and rollback tests |
| `docs/executable-card-coverage.md` | Source-to-handler registry, promo exclusion and explicit unsupported candidates |
| `docs/setup-mechanics-report.md` | This implementation/validation/limitations report |
| `docs/turn-slice-report.md` | Link to this extension while retaining the historical report |
| Harness `scripts/test_engine_adapter.py` | Generic driver replays all three fixtures |
| Harness `docs/engine-interop.md` | Current setup/search interoperability and scope |

Pre-existing harness changes remain untouched. No commit, push, staging, dependency change, environment-file edit, application refactor, model download or training run was performed.

## Remaining scope and next milestone

The requested general conditional CALL pipeline and real Gig/Street-Cred card interaction are **not complete**. The existing ConditionSchema/RulesView current-Gig derivations remain, but there is no newly certified card exercising them through CALL. The proof currently has two real behaviors rather than the requested approximate three-to-five. Royce's persistent query is tested using explicitly equipped fixtures; the headline Viktor replay does not equip Gear or exercise combat.

The next bounded milestone should review and authorize a noncombat activated/Program path using a real candidate such as Afterparty at Lizzie's, then add current-value conditions and Gig adjustment with resolved bound semantics. Alternatively, provide a different captured/reviewed Legend with the desired conditional CALL text. Do not rewrite Program/attack triggers as CALL or certify a partially implemented card by deleting its remaining text. Keep combat, defeat, Rival React, full PLAY_CARD and simultaneous trigger scheduling out until their own reviewed milestone.
