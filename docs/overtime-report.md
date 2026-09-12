# Standard overtime execution report

**Current verification (September 10, 2026):** [The first exact Arasaka-vs-Merc Demo match](exact-demo-match-report.md) is **VERIFIED — one deterministic legal game**, with every-action PostgreSQL reload, generic Python traversal and both-viewer privacy checks. Reference execution remains 29/29 cards and 60/60 copies; exact Demo legality/initialization and standard overtime remain supported. Exhaustive all-game interaction proof is **NOT CLAIMED**. Historical findings below retain their original scope.

## Runtime

September 10, 2026. Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine **0.4.0-overtime-1** / `d79422b2512215c41bddbf17945ee061c660a5b04a845ea000b7dce6fdcd877d`.

Constructed support ruleset `beta@attack-condition-power-1-overtime-1` / `4c01c7da5bb21d887a82c9291a129d0e7e9b3591be1680c160727831e3732e4c`; content `a52e49d1bbad76cf36a45cf80a8c27a14f1f98380d61a88d4bb248c0f837a0ca`. Demo ruleset `beta@demo-overtime-1` / `0cf3dcd40766cd4b699e16842a0b6a66d3b1ecdf9b678986bf7686139dc800ab`; content `108d71feb46f427987016bd4935ab2dd563581861eee13c11a155ee9409cb6f2`.

This milestone implements bounded standard overtime only. It does not certify or play a complete exact Demo match.

## Overtime exact sourced rules

[overtime-rules.v1.json](../tests/fixtures/overtime-rules.v1.json) pins 76 complete nodes and their individual canonical hashes. Rules 1.10–1.10.1 retain normal seven-Gig victory at own turn start, before Ready. Rules 1.11–1.11.2 establish overtime, two consecutive qualifying starts and immediate seven-Gig victory at entry or later. Rules 8.6/8.6.1 locate the turn-start boundary; 8.16.1, 8.16.2, 8.17 and 8.18 order end effects, expiration, overtime and the rival turn. Rules 1.5, 1.6, 1.13, 1.14 and 1.17 establish immediate game-end/draw-loss timing. Rules 6.7.2.2.1 and 9.23.3.2/9.23.5.1 require simultaneous movement of selected Gigs.

## Rules/FAQ reviewed

The already captured 713-node Comprehensive payload was reread locally: SHA-256 `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`, updated `2026-09-01T19:28:10.028Z`. Prior Demo evidence SHA-256 `a0c5f2cf725369b588c6fc019060d16be7370827c00caaeced43f072f6eafb33` remains pinned. No broad corpus refresh was performed.

The previous 270-record FAQ capture has SHA-256 `3a482c2be10191762d946259e9c958fc0eb1a340615a01fac18f6f7c36ab49d1`. The focused fixture preserves the three relevant semantic Q/A records: Delamain requires its source still in field at end of turn; Dying Night can register without decreasing a Gig, and its delayed effect survives the attacked host being defeated. The projection explicitly excludes signed image URLs. Searching this capture's questions/answers for “overtime” found zero matches; that is not proof that no future clarification exists. Attempted official web viewing supplied no additional usable evidence, so this report claims a pinned-source reread, not fresh live verification.

## Overtime architecture

One policy, `turnSlice.overtime: "STANDARD_OVERTIME_V1"`, drives the engine independently of format. `packages/engine/src/overtime.ts` owns qualification, entry, count-based victory and cross-field validation. Turn start and completed end-turn processing call it; simultaneous transfers and ordinary Gig-roll completion call its immediate-win check. Existing terminal cleanup is reused. No phase DSL, new card mechanic, transport decision or client-side rule was added.

## Qualification state

Reuse `timing.emptyFixerStarts`, already present in legacy states, rather than add duplicate historical counters. Supported playing states require integer 0, 1 or 2; setup canonically omits the counter because no turn has begun. First gameplay start initializes zero while original Fixers remain. Active overtime deletes the counter and stores only entry provenance. Counts beyond the threshold, missing playing-state counts and mixed active/progress shapes are rejected.

## Both-Fixers-empty query

`areBothFixersEmpty` queries the authoritative Gig registry by original owner and current FIXER location. Both players must have no remaining original Fixer objects there. It does not use current Gig control, Street Cred, D20 history or turn number. Existing state validation checks registry/index agreement and one original D4/D6/D8/D10/D12/D20 per player.

## Qualifying turn timing

Measure at the actual turn-start boundary before start-of-turn victory, Ready, draw or rolling. The resulting snapshot accompanies TURN_STARTED without a separate counter event. In the legal headline, the last Fixer leaves during turn 12, which retains progress 0; starts 13 and 14 record 1 and 2. Overtime stays inactive throughout turn 14 until its end work completes. Trusted end-effect regressions enter after turn 5, and the Demo policy smoke after turn 3, ruling out a turn-14 shortcut.

## Consecutive-turn reset

A nonqualifying next start resets progress to zero. The focused regression begins from progress 1 and explicitly arranges an original D20 back in Fixer while keeping ownership and registry indexes valid. Ending that turn reaches a nonqualifying start and progress 0. This is trusted future-restoration coverage; no currently admitted action returns a Gig to Fixer, and none was implemented.

## Entry boundary

Once the second qualifying turn finishes, normal end-turn processing emits TURN_ENDED, then OVERTIME_STARTED, then starts the rival turn if nobody wins at entry. The exact event convention is the engine's representation of formal 8.16 → 8.17 → 8.18. Reaching progress 2 alone does not enter overtime. Active player, global turn and existing game history continue normally.

## End-turn effect ordering

Both Delamain and real V/Dying Night are exercised with pending ready-Eddie choices on a trusted second qualifying turn. END_TURN pauses with `READY_EDDIE` at EDDIE_READY_SELECTION and overtime absent. Every choice/effect completes before cleanup and entry. Live PostgreSQL additionally reloads and resumes the Delamain pending-choice path. Source presence and Dying Night delayed registration behavior retain their prior semantics.

## Temporary cleanup ordering

Existing order is preserved: end-turn effects/choices, Lag removal, this-turn power expiration, unused Reboot prevention expiration, TURN_ENDED, OVERTIME_STARTED. Focused tests reuse Losing His Way's real temporary +5 and the existing unused-Reboot trace, verifying expiration events precede entry. This does not broaden overlapping Reboot support.

## Overtime active state

`match.overtime = { startedAfterTurn }` explicitly represents active overtime, with an integer entry turn at least 2. Progress is absent once active and no longer drives behavior. Validation checks entry/current-turn coherence, policy, pending work at entry, terminal exclusivity and unresolved seven-Gig control. Later Fixer emptiness is not imposed as a permanent invariant: historical qualification cannot be reconstructed from an arbitrary future board.

## Overtime start event

Exactly one `OVERTIME_STARTED { turn }` is emitted. The headline's entry is after turn 14 and never repeats through terminal turn 27. PostgreSQL requires entry to match the previous progress-2 turn and an earlier TURN_ENDED in the same complete batch, and rejects duplicate, altered, missing or removed entry state/events. Creating a new persisted match already in overtime is rejected.

## Normal seven-Gig win

Before activation, gaining the seventh Gig mid-turn returns to ordinary MAIN. The direct contrast test then ends both turns and wins at that player's own next start with START_TURN_GIGS, before Ready/draw. Giving that player an empty deck in the trusted contrast does not change the result: the start victory occurs first. Legacy immutable ruleset pins retain their prior unsupported overtime boundary; their regression was renamed explicitly, not deleted.

## Overtime immediate seven-Gig win

Active overtime uses controlled rolled Gig COUNT ≥7 at any admitted control-count transition. `checkOvertimeVictory` calls existing `TurnMutation.finish` with OVERTIME_GIGS in the same action batch. An already unresolved live seven-Gig overtime state is invalid. No CHECK_WIN or enter-overtime action exists. Ordinary required-empty-draw loss remains immediate when no earlier victory has ended the game.

## Entry-time seven-Gig win

A trusted second-qualifying-turn board with one player already controlling seven emits TURN_ENDED → OVERTIME_STARTED → FINISHED → GAME_ENDED and never emits the next TURN_STARTED. Formal 1.13.1 specifies a tie for simultaneous wins, but two seven-Gig controllers need at least fourteen dice. The admitted twelve-object registry makes that impossible; extra-die malformed states are rejected without adding arbitrary tie behavior.

## Gig steal immediate win

The primary replay uses ordinary Emergency Atlus play, payment, Lag cleanup, attack, rival PASS_REACT and legal Gig selection. The terminal batch records GIG_STEAL_SELECTED, GIG_CONTROL_CHANGED and GIG_STOLEN/history before FINISHED/GAME_ENDED. There is no ATTACK_ENDED continuation, MAIN, further steal choice or deferred end-turn work after victory. Generic trusted transfer uses the same count check; it is not restricted to the GIG_STOLEN event.

## Multi-Gig steal terminal behavior

The prompt made its proposed first-selection short-circuit conditional on the source. The pinned sources require choosing Gigs one at a time but transferring all selected Gigs simultaneously. Selecting the first of two does not increase control: six stays six with the second choice still pending. Selecting the second transfers both, six becomes eight, and the batch ends immediately before post-combat continuation.

A live five-versus-seven overtime board is already won by the rival and is rejected. Supplemental five-to-seven coverage therefore explicitly uses a trusted five-versus-six board with one original D20 in Fixer: first selection still leaves five, then both transfer and seven wins. These arrangements attach three existing Mantis instances to the existing Atlus for allowance two; no card payload or headline state is patched.

## Gig count vs Street Cred

The victory query counts currently controlled ROLLED dice in GIGS, irrespective of faces, current values or distinct values. Street Cred continues to sum current values through existing RulesView behavior. Value-only adjustments neither change the count nor require a new overtime victory path. Power, Saburo, steal allowance, Blocker and React calculations are unchanged.

## Empty-Fixer turn flow

Existing automatic flow remains TURN_START → victory check → READY → DRAW → MAIN when the active Fixer has no eligible die. It already applies before overtime when only one Fixer is empty. No fake pass action or empty CHOOSE_GIG is added. The ordinary ROLL_GIG path also checks terminal count after its actual movement for future restoration compatibility; no overtime-only roll or return mechanic exists.

## Demo policy inheritance

`demo-overtime-1` uses the same STANDARD_OVERTIME_V1 policy. Exact ARASAKA_DEMO_V1 + MERC_DEMO_V1 in either seat, 27 MAIN + 3 Legends, copy/RAM checks, Comprehensive setup and opposed d20 remain unchanged. A separate explicitly trusted later-turn Demo smoke proves routing through entry without playing an exact match. The real setup replay is not extended.

## Constructed policy inheritance

The new constructed support ruleset `attack-condition-power-1-overtime-1` enables the same policy and retains 40–50 MAIN / 3 Legends. The legal support replay uses 42 MAIN / 3 Legends per player, with existing Emergency Atlus and Mantis revisions replacing support slots in its own fixture only. Older immutable constructed policy versions remain unchanged. Standard overtime is format-independent; this pass does not implement a Sealed/Limited initializer or admit new formats.

## Events

New vocabulary is limited to OVERTIME_STARTED and the OVERTIME_GIGS reason on ordinary GAME_ENDED. No per-start qualification event, card-specific win event or extra player decision is added. TURN_STARTED snapshots hold progress; all terminal control and stolen facts are kept in exact sequence. The headline includes 312 events with initialization.

## Observation

Both player observations expose `{ overtime: { status: "NORMAL", qualifyingTurnStarts: 0 | 1 | 2 } }` or `{ overtime: { status: "ACTIVE" } }` after setup under the supported policy. Historical unsupported-policy observations and Demo setup observations remain unchanged. Entry provenance stays in authoritative state; models do not need it. No hidden card/deck data is added; private rival hand/deck permutations preserve public observation and legal action IDs. Existing Kiroshi/Eddie privacy tests pass.

## Training positions

The new replay contains 51 implementation-generated contract TrainingPositions before action decisions; four procedural cut decisions are omitted. Terminal state has no action decision or training position. Existing observations/legal actions carry the strategic overtime distinction. These fixtures are not training runs, human gold or promoted data.

## Hash behavior

POSITION_V2 includes the existing historical counter and new explicit active marker; otherwise identical progress 0/1/2/active boards have distinct position hashes. Both ObservationHashes differ when public progress/status changes. ReplayStateHash includes exact state, entry provenance and event sequence. No hash projection change was needed.

Final ReplayStateHash: `4b088e6023fa9f0258b9bd9c6ec5d5d477c91d971e7ae7581e337250b7a34808`. Engine and supported ruleset pins change; no card revision hash changes. Action IDs and generated replay hashes are regenerated under the new artifact, while original semantic compatibility is audited independently.

## Demo initialization regression

The original six-action setup payload is replayed twice by the compatibility auditor: once with its original immutable ruleset under the new engine, and once under demo-overtime-1. Both preserve semantic actions/descriptors, observations, events and final state except explicitly changed engine/ruleset/content pins. The golden still ends at turn 0 in the second player's mulligan. Seed demo-setup-14 still records 20–20 then 12–11, with p0 choosing SECOND. No exact Demo gameplay is appended.

## Demo manifests

The entire `demo-reference-manifests.v1.json` file is byte-identical to the frozen pre-milestone snapshot, preserving both composition hashes, 27+3 counts and physical printing provenance. All 29 physical roadmap rows are unchanged, including three Merc Psycho Squads. Historical reference-only source metadata remains historical; runtime admission remains its separate application policy.

## Card revision preservation

All 53 reviewed support-bundle revisions, complete card payloads and manifest revision hashes equal the preserved pre-milestone bundle. Card payloads and revision hashes also match for each of the original 30 replay families. All prior source/evidence fixtures remain byte-identical; only generated replay/wire goldens change. No new card revision, production seed, raw corpus refresh or immutable-card rewrite occurred.

## Replay

[overtime-replay.v1.json](../tests/fixtures/overtime-replay.v1.json) is a deterministic legal constructed support trace: 55 actions, 51 positions, 312 events. Every submitted action is selected from listLegalActions; initialization and all subsequent states come from the engine. Seed overtime-0 exhausts both Fixers during turn 12, records qualifying starts 13/14, enters after turn 14 and wins on turn 27. Emergency Atlus is naturally drawn/played on turn 25, loses Lag at cleanup and attacks on turn 27. There are no state, RNG, source-card or draw-order patches in the headline.

Focused trusted arrangements live separately in overtime-focused.ts and tests, and are explicitly described as edge coverage rather than legal history.

## Original payload compatibility

PASS: **30 original families / 1,048 original actions** from `/tmp/tcg-overtime-before/replays`, captured before edits. Checks cover initialization, semantic legal actions/descriptors, acting-player observations, exact events and final states under new engine pins. An additional six-action comparison proves current Demo policy preservation. Regenerated goldens are not used as the original-compatibility baseline. All 26 generators succeeded; the current Python traversal is 31 families / 1,103 actions.

## Persistence

All six live Mongo/Postgres tests pass. Existing healthy local services use Mongo 127.0.0.1:27018 and PostgreSQL 127.0.0.1:5433. The overtime Mongo test publishes only its updated ruleset in a randomized test-owned database, checks immutable replay/conflict/readback, and confirms zero cards/revisions published there. Existing integration suites retain their own isolated fixture publication coverage.

PostgreSQL reloads before all 55 headline actions and after terminal victory, comparing exact state, both observations, all three hashes, legal actions, actionId resolution, events and complete history. Coverage includes progress 0/1/2, entry boundary, active overtime, pending steal and terminal state. A separately labeled trusted Delamain checkpoint is persisted with no claim to prior generated history, then its real end-turn decisions and entry are reloaded exactly. Forged entry marker/event, missing marker, duplicate entry and removal of active overtime are rejected atomically.

No migration is needed for JSONB. Adding the new integration file exposed simultaneous CREATE EXTENSION races in isolated-schema migration setup; test:integration now serializes files with --test-concurrency=1. The complete rerun passed. All test-owned databases/schemas were cleaned up; the existing containers remain running.

## Wire

Wire schemaVersion remains 1 and authoritative state remains schemaVersion 2. Optional overtime state/observation plus new event/reason vocabulary flow through existing shared schemas. request.v1, response.v1 and trainingPosition.v1 exports changed; trainingAttempt.v1 is unchanged after export. Existing requests require no new client field; new supported-policy state snapshots must have valid progress. Legacy immutable policies remain supported under their previous shape and execution limits.

## Python

Only scripts/test_engine_adapter.py changes in the AI project: append the overtime-replay family name. Node remains authoritative for all rules and action validation; Python submits actionId and consumes observation/legal actions/terminal responses. Adapter traversal passed all 31 families/1,103 actions, seven golden round trips and seven differential cases. test_cyberpunk passed 89 tests; test_harness_core passed 48. Known legacy Python deck-validation gaps remain repeated-entry-copy-bypass and legend-in-main; no overtime implementation was added to Python.

## Tests

PASS: **1,144 application tests**, including 20 focused overtime tests; **6 live integration tests**, zero skips/failures; all three Python suites. Coverage includes qualifying starts/reset, pending Delamain/Dying work, temporary power/Reboot cleanup, entry win, normal-vs-overtime seven-Gig timing, simultaneous multi-steal, terminal cleanup, generic transfer/restored-roll edges, empty draw, public hashes/privacy, both format policies and strict malformed state/persistence batches.

Development iterations corrected fixture assumptions (Atlus drawn after the initial bounded turn limit, automatically selected sole attack target), incorrect new-test field names and TypeScript branded/narrowed types. The initial focused run had six assertion/fixture-name failures, all fixed; the initial live run had one PostgreSQL extension race, fixed by serialized test files. No required test was deleted or disabled. Final build, typecheck and lint report no warnings.

## Commands

Application commands used Node on the specified PATH, from `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
npm run typecheck
npm run lint
npm run validate:cards
npm test
npm run build
npm run contracts:export
git diff --check
```

Results respectively: v22.13.0; 10.9.2; pass; pass; 4 records validated; 1,144 passed; optimized Next build passed; additive exports generated; whitespace check passed. Codegen runs through typecheck/build and its tracked outputs remain unchanged.

Every generator was executed with these exact commands (all exit 0):

```bash
node --import tsx scripts/generate-attack-condition-power-replay.ts
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-delayed-effects-replay.ts
node --import tsx scripts/generate-demo-setup-replay.ts
node --import tsx scripts/generate-end-turn-history-replay.ts
node --import tsx scripts/generate-field-legends-replay.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-goro-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-overtime-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-saburo-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-targeted-defeat-replays.ts
node --import tsx scripts/generate-targeted-spend-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-value-conditions-replay.ts
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-yorinobu-replay.ts
```

Additional application checks:

```bash
node --import tsx --test tests/overtime.test.ts
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-overtime-before/replays
docker compose ps
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
```

Results: 20 focused tests passed; 30/1,048 original compatibility plus current Demo setup passed; both existing containers healthy; 6 live tests passed. The first live invocation failed the extension race described above; the final invocation uses the updated serialized script. Final full-suite and adapter runs also validate regenerated overtime goldens.

From `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

Results: adapter pass (31/1,103, seven goldens/differential cases); 89 passed; 48 passed. Unit-test corpus outputs use temporary test directories, not a corpus refresh. No model download, training or gold promotion.

Read-only snapshot audit: `python3 /tmp/tcg-overtime-audit.py` compares the 374-file application and 504-file harness pre-edit snapshots, original card payloads/hashes, manifests and roadmap rows. Logs and the captured original replays remain under `/tmp/tcg-overtime-*`; those audit files are local evidence, not repository runtime dependencies.

## Files changed

**66 application files** (56 existing, 10 new), plus **one harness file**. Generated snapshots account for most diff lines.

| File | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Update current overtime readiness/successor link; retain historical scope and physical rows. |
| [docs/demo-format-report.md](../docs/demo-format-report.md) | Update current overtime readiness/successor link; retain historical scope and physical rows. |
| [docs/demo-setup-review-report.md](../docs/demo-setup-review-report.md) | Update current overtime readiness/successor link; retain historical scope and physical rows. |
| [docs/demo-starter-report.md](../docs/demo-starter-report.md) | Update current overtime readiness/successor link; retain historical scope and physical rows. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Update current overtime readiness/successor link; retain historical scope and physical rows. |
| [docs/overtime-report.md](../docs/overtime-report.md) | This complete successor report and command/file audit. |
| [package.json](../package.json) | Serialize integration test files to avoid concurrent PostgreSQL extension setup. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Strict overtime state/observation schemas and additive event/outcome vocabulary. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Versioned standard overtime admission with supported seven-Gig policy constraints. |
| [packages/engine/src/combat-resolution.ts](../packages/engine/src/combat-resolution.ts) | Preserve stolen history before win and stop post-combat continuation. |
| [packages/engine/src/end-turn.ts](../packages/engine/src/end-turn.ts) | Enter after effects/expiration; preserve historical unsupported preflight. |
| [packages/engine/src/gig-transfer.ts](../packages/engine/src/gig-transfer.ts) | Check terminal count after complete simultaneous transfers and semantic facts. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Check overtime victory after ordinary roll control/location transition. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Expose public normal progress or active overtime without hidden data. |
| [packages/engine/src/overtime.ts](../packages/engine/src/overtime.ts) | Authoritative qualification, registry queries, entry, immediate win and validation. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Invoke overtime cross-field validation. |
| [packages/engine/src/turn.ts](../packages/engine/src/turn.ts) | Record qualifying starts, check active overtime and reuse terminal cleanup. |
| [packages/engine/src/win.ts](../packages/engine/src/win.ts) | Expose active overtime through the existing generic win evaluator. |
| [packages/persistence/src/postgres.ts](../packages/persistence/src/postgres.ts) | Enforce consistent, one-time persisted overtime entry batches. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive overtime state/observation/event/reason JSON Schema. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive overtime state/observation/event/reason JSON Schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive overtime state/observation/event/reason JSON Schema. |
| [scripts/audit-replay-compatibility.ts](../scripts/audit-replay-compatibility.ts) | Also compare original Demo setup under current supported policy. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Advance engine identity to 0.4.0-overtime-1. |
| [scripts/generate-overtime-replay.ts](../scripts/generate-overtime-replay.ts) | Generate the new legal overtime golden. |
| [tests/demo-starter-fixture.ts](../tests/demo-starter-fixture.ts) | Upgrade current exact Demo ruleset to shared standard overtime. |
| [tests/demo-starter.test.ts](../tests/demo-starter.test.ts) | Assert supported overtime while preserving all other Demo checks. |
| [tests/fixtures/attack-condition-power-replay.v1.json](../tests/fixtures/attack-condition-power-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/demo-setup-replay.v1.json](../tests/fixtures/demo-setup-replay.v1.json) | Regenerate current Demo policy/engine pins; preserve six setup actions and turn-0 endpoint. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/minotaur-replay.v1.json](../tests/fixtures/minotaur-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/over-the-edge-replay.v1.json](../tests/fixtures/over-the-edge-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/overtime-replay.v1.json](../tests/fixtures/overtime-replay.v1.json) | New 55-action / 51-position legal overtime replay ending in victory. |
| [tests/fixtures/overtime-rules.v1.json](../tests/fixtures/overtime-rules.v1.json) | Pin 76 exact rules, source hashes, three FAQs and timing decisions. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/targeted-spend-replay.v1.json](../tests/fixtures/targeted-spend-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerate engine pins, action IDs and exact hashes; original semantics independently audited. |
| [tests/integration/overtime.test.ts](../tests/integration/overtime.test.ts) | Isolated Mongo ruleset and exact Postgres reload/forgery coverage. |
| [tests/overtime-fixture.ts](../tests/overtime-fixture.ts) | Versioned constructed support policy and unchanged existing-card deck fixture. |
| [tests/overtime-focused.ts](../tests/overtime-focused.ts) | Explicit trusted edge arrangements and reusable legal action helpers. |
| [tests/overtime-replay.ts](../tests/overtime-replay.ts) | Legal deterministic headline with boundary snapshots and contract positions. |
| [tests/overtime.test.ts](../tests/overtime.test.ts) | 20 source, timing, terminal, multi-steal, hash/privacy and format regressions. |
| [tests/turn-slice.test.ts](../tests/turn-slice.test.ts) | Label retained old-version unsupported-overtime regression explicitly. |

Harness `scripts/test_engine_adapter.py`: add only the overtime replay name. Byte comparison of all 504 snapshotted harness files finds no other changed or new file. The application HEAD and Git index are unchanged from the pre-edit snapshot. Harness HEAD/index changed externally during this task (HEAD `542c3d13c8fdfb542de4e83128859e616cd51c81` → `8a16dec8c00b48811c1ae766fe3bef10c26d9a7a`); those changes were preserved, not reset. This task performed no staging, commit or push in either project.

## Unsupported mechanics

The full exact Arasaka-vs-Merc Demo match is not yet verified. Existing boundaries remain: overlapping Reboot generalization, Zetatech Faceplate/WHEN_SPENT dispatcher, unsupported card/effect shapes outside admitted policies, original-Gig return/creation actions, Sealed/Limited initialization, generic tournament/tie systems, matchmaking and UI. Old ruleset pins deliberately retain UNSUPPORTED overtime; new supported pins opt into the versioned feature. The four starter catalog records are separate from reviewed execution fixtures; no production Mongo population was performed.

## Ambiguities not guessed

Sequential selections were not treated as sequential steals: exact simultaneous-transfer rules override the prompt's conditional example. Five-versus-seven live overtime is impossible with an unresolved seven-Gig winner; five-to-seven is tested only in a labeled trusted future-restoration arrangement. Both-at-seven is impossible with twelve original objects, so no arbitrary tie implementation was invented. Consecutive-start qualification is not replaced by the Demo reminder's usual seventh-turn shortcut. Historical setup-source precedence remains unresolved at publisher level; the existing application policy is unchanged.

## Match-readiness status

```text
Reference cards:
COMPLETE — 29/29, 60/60

Demo fixed-list legality:
SUPPORTED

Exact Demo initialization:
SUPPORTED

Overtime:
SUPPORTED

Full exact Arasaka-vs-Merc Demo match:
NOT YET VERIFIED
```

## Recommended next milestone

**CYBERPUNK TCG — FIRST EXACT ARASAKA VS MERC DEMO MATCH.** Use the unchanged exact manifests under DEMO_STARTER_V1, legal action enumeration and deterministic initialization, with no filler, deck padding, state/RNG patches or substitutions. Verify privacy, complete events, PostgreSQL resume before every action, Python actionId traversal and a real supported terminal condition. This next milestone has not been started.
