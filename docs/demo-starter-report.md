# DEMO_STARTER_V1 — fixed-pair format and deterministic setup

## Runtime

Implemented September 10, 2026 (America/Chicago). Application **0.3.0**, Node **v22.13.0**, npm **10.9.2**, Next.js **16.3.4**. Required Node PATH was used for every Node gate. Engine **0.4.0-demo-format-1**, artifact `ca419cb84b72328771c13abb0452a4049c79f071611b5e43277866f2fa291b72`. Ruleset `beta@demo-format-1`, ruleset hash `feb45d82e5c6f6d7b6be99bb6d08a3d6bbc8b878245d2b811f44149670de289e`.

App HEAD remains `39e2fe62be95a65ce732a6ab9a180862b83095a2`; harness HEAD remains `542c3d13c8fdfb542de4e83128859e616cd51c81`. The baseline includes prior uncommitted review/harness work and is frozen in `/tmp/tcg-demo-implementation-before`. No commit, push, staging, model download, training or gold promotion.

## Prior source ambiguity

The [format review](demo-format-report.md) and [setup follow-up](demo-setup-review-report.md) remain historical evidence. Publisher direct-play intent and both 27 MAIN + 3 LEGENDS products are confirmed. Demo reminders shuffle first; Comprehensive Rules 7.4–7.9 choose play order first. The source conflict has **not** been resolved by the publisher. The prior source/manifests/follow-up JSON fixtures are byte-unchanged; no new source ruling is claimed.

## User/application policy decision

The user explicitly chose Comprehensive Rules setup ordering for forward compatibility, while retaining physical opposed d20. The [application decision fixture](../tests/fixtures/demo-application-policy.v1.json) labels authority **APPLICATION_DECISION**, pins the request hash, and links existing evidence by hash. Exact-pair admission and either-seat assignment are narrow application policy, not claims that publisher mirror/seat legality was established.

## DEMO_STARTER_V1 exact definition

**SUPPORTED**, meaning only one ARASAKA_DEMO_V1 and one MERC_DEMO_V1, each exactly 27 MAIN + 3 LEGENDS; setupSequence ENGINE_SETUP_V1, firstPlayerMethod OPPOSED_D20, seatAssignment EITHER. The strict policy schema rejects alternate methods, aliases and extra fields. Standard reviewed remaining setup/win/deck-out rules are retained. Overtime is explicitly UNSUPPORTED.

## Fixed pair / manifest legality

Domain manifest matching normalizes zone, CardId, revision and aggregated quantity. Split entries and list order are equivalent. The existing deck input carries CardIds; revisions resolve through the unique content-bundle card pins. Printing UUIDs/collector numbers are provenance only. Runtime manifests are slim projections of the exact historical artifacts, preserving both composition hashes. Each deck is recognized independently; initialization additionally requires one of each.

## General 27-card construction status

**NOT ADMITTED.** Any composition change rejects with DEMO_MANIFEST_MISMATCH even if standard deckbuilding rules would permit it. There is no arbitrary small-deck constructor, inference from size/printings, unversioned DEMO_STARTER alias or DEMO_STARTER_V2.

## Constructed behavior

Unchanged: 40–50 MAIN, exactly 3 unique Legends, max 3 copies, existing RAM and Legend deckbuilding-identity rules, ENGINE_SETUP_V1. Both exact Demo lists fail default/explicit constructed with MAIN_DECK_SIZE. Missing format continues constructed semantics. The existing 42-main support decks remain valid constructed and reject as Demo.

## Comprehensive setup reuse

The existing beginSetup/continueSetup pipeline remains authoritative. Only automatic first-player selection varies by explicit format. No DEMO_SETUP_V1, shuffle-first reducer, extra initialization boundary, card mechanic or gameplay state patch was added. Capability admission reads pinned revisions directly before TurnMutation.result validates the completed initial state, including the newly generated rolls.

## First-player opposed-d20 architecture

The pure first-player helper consumes the existing SHA256_COUNTER_V1 engine RNG, records pairs and returns the winning seat plus updated RNG. beginSetup emits public round events and the existing FIRST_PLAYER_DETERMINED event, then offers the existing strategic FIRST/SECOND action. Rolls are automatic; no action is exposed for rolling or rerolling.

## d20 RNG ordering

For each round, seat 0 rolls first, then seat 1 consumes the next deterministic draw. Each draw is uniformly bounded to 1..20 by the existing rejection-sampling helper. Random shuffles begin only after FIRST/SECOND is chosen. Fixed seed `demo-setup-12` reaches endpoint 1 (1–6); the real smoke reaches endpoint 20 (20–20).

## Tie rerolls

Both dice reroll on every tie, with every tied pair retained. The loop has no arbitrary gameplay-visible reroll limit and uses the shared RNG counter-exhaustion guard. Fixed vectors cover p0 first-round win (11–3), p1 first-round win (11–19), tie then p0 (20–20, 12–11), tie then p1 (2–2, 3–6), and two ties (6–6, 10–10, 11–19). Repeated seeds reproduce exact rounds, counters, winners and events. No Monte Carlo or gameplay seed search was used; setup vector selection was bounded to seed suffixes 0..81.

## Higher roller / FIRST-SECOND distinction

The final higher roller becomes the chooser, never automatically FIRST. Normal actionId selection chooses FIRST or SECOND. The real smoke has p0 win 12–11 after a tie, choose SECOND, and assign p1 FIRST. State validation verifies the seeded winner at the initial choice; observations retain the derived selected seat separately from current acting/first-player setup context.

## Constructed random-selection regression

Constructed still consumes its original single bounded draw with faces=2 and emits only FIRST_PLAYER_DETERMINED before its choice. It has no literal roll-history field or added Demo observation fields. Default and explicit CONSTRUCTED initialization are identical. The untouched 29-family audit independently verifies original constructed initialization events, RNG-driven continuations and final states.

## Main shuffle/cuts

After FIRST/SECOND, both main decks shuffle in seat order using the continued RNG. Each rival chooses the existing cyclic cut, including decline (0). The smoke uses cuts 5 and 0. Its first shuffle begins at RNG counter 4, after the two opposed rounds; no shuffling precedes selection.

## Legend randomization/cuts

Only after both main cuts, the existing pipeline shuffles both three-Legend zones and offers both rival cuts. The smoke chooses 1 and 0. No alternate ordering, omitted cuts or Demo-specific reducer is introduced.

## First-player Legend spending

After Legend cuts, the assigned FIRST player’s two leftmost Legends become SPENT. In the exact smoke p1 receives SPENT/SPENT/READY while p0 remains READY/READY/READY. The selected higher roller was p0, proving that chooser and first-player consequences remain distinct.

## Initial hand / mulligan

Both players receive six cards. First player p1 resolves the optional whole-hand mulligan first, returning all six, reshuffling and drawing six without an extra rival cut. Both end with six-card hands and 21-card main decks. The fixture stops at p0’s pending mulligan with turn=0. Completing that final choice would automatically invoke normal turn 1 in the existing reducer, so it is deliberately not submitted.

## Fixers

The unchanged registry contains exactly six owned unrolled Fixer dice per seat: D4, D6, D8, D10, D12, D20. All twelve remain in FIXER. Opposed setup rolls add no GigInstance, controlled Gig, Street Cred, card object or D20 usable by Over the Edge.

## Win policy

Retains the reviewed seven-controlled-Gigs check at own turn start and required-empty-draw loss. This milestone does not reach a normal turn or a win check in the exact Demo fixture. These policies are inherited unchanged, not a new threshold or shortcut.

## Overtime status

**UNSUPPORTED**, retained literally in turnSlice and its schema. No rule is disabled or silently skipped to admit initialization. Existing unsupported execution boundaries remain; no overtime code or tests that play the exact Demo forward were added.

## Event model

Generic FIRST_PLAYER_ROLLED { round, rolls: [seat0, seat1], tied } events precede FIRST_PLAYER_DETERMINED. The existing pipeline has no SETUP_STARTED event; initialization begins with automatic round facts. Subsequent order is FIRST_PLAYER_CHOSEN → main SETUP_SHUFFLED / SETUP_CUT → Legend SETUP_SHUFFLED / SETUP_CUT → SETUP_LEGEND_SPENT → FIXER_PREPARED → opening CARD_MOVED-to-HAND → MULLIGAN_DECLARED / reshuffle / CARD_MOVED / MULLIGAN_RESOLVED. No GAME_SETUP_COMPLETED or TURN_STARTED occurs in this fixture.

## Observation

Both seats see format DEMO_STARTER_V1, the literal firstPlayerRolls and derived selectedSeat, with the existing actingSeat and choice actor. These public facts persist through setup. No RNG seed, counter/internal state or hidden card identities are added to the public projection. Existing modelInput still exposes only observation and legal action IDs/descriptors.

## Hash behavior

ReplayStateHash hashes the complete authoritative state, including exact literal rounds; event history records every roll event. PositionHash removes only irrelevant past firstPlayerRolls, retaining explicit format, current chooser/setup state and the existing future RNG seed/counter semantics. Therefore different future streams remain different positions. ObservationHash includes public format/roll facts. Projection-only negative tests alter historical pairs to prove the distinction; such forged states are rejected and never replayed. No duplicate cached winner/hash input was added.

## Exact Arasaka legality

**VALID under DEMO_STARTER_V1.** 14 distinct revisions, 27 MAIN + 3 LEGENDS, 30 copies. Composition hash `7ef234191430bce642888161bcad4127c138faddb41c826a0f7b8b68fd90a386`. Copy/RAM/Legend checks pass; the same list remains invalid constructed.

## Exact Merc legality

**VALID under DEMO_STARTER_V1.** 15 distinct revisions, 27 MAIN + 3 LEGENDS, 30 copies, including three Psycho Squads. Composition hash `c0551a2293a54080e44cbf45afbd7daf96d9b8b33ef9b113037647004991c38e`. Copy/RAM/Legend checks pass; the same list remains invalid constructed. Viktor’s already documented application/official printing UUID difference is provenance only; no revision rewrite.

## Reversed seat assignment

Both Arasaka/p0 + Merc/p1 and Merc/p0 + Arasaka/p1 initialize successfully. RNG uses stable numeric seats regardless of manifest. Either-seat admission is explicit application policy; no source assertion of a required seat was invented.

## Mirror/mutation negatives

Arasaka/Arasaka and Merc/Merc reject with DEMO_PAIR_INVALID. Individual MAIN replacement, quantity change, zone swap, Legend replacement, added/removed card and changed revision reject with DEMO_MANIFEST_MISMATCH. Unsupported revision status and constructed support decks reject. An extra synthetic content revision rejects with DEMO_CONTENT_INVALID. Split four-copy entries still trigger both fixed-list and COPY_LIMIT errors. Missing format, unsupported policy/version, forged rolls/counters/winner, and missing history fail closed.

## Real-card-only content bundle

The Demo bundle contains exactly **29 real reviewed revision-1 cards** and initializes **60 physical instances**. Content manifest hash `a3c21f0b40197d8ea8eea9196c1a9af491ccf1a0db636c7923620fa3e48216ee`. All 53 previous immutable revision payloads and all 29 physical reference rows remain unchanged. No synthetic padding, fake RAM, demo-specific revision or card republishing. CardId/revision/quantity admission is independent of printing provenance.

## Initialization smoke test

[demo-setup-replay.v1.json](../tests/fixtures/demo-setup-replay.v1.json): exact pair, explicit DEMO_STARTER_V1, seed `demo-setup-14`, rounds 20–20 then 12–11. Six actionId-driven setup choices, one FIRST/SECOND strategic contract TrainingPosition, 43 events. Final step **MULLIGAN_DECISION**, stage MULLIGAN/completed=1/decidingSeat=0, turn **0**. Final ReplayStateHash `c734230648e9217a4243815e9e9ec07d60e2c86dc66a6fa11e552dd277275cd5`. No gameplay action, synthetic card, state patch or RNG patch. This is an engine contract fixture only.

## Replay compatibility

**PASS: 29 original families / 1,042 original decisions.** Before regeneration, audit-replay-compatibility.ts re-executed the independently preserved pre-milestone payloads from `/tmp/tcg-demo-implementation-before/replays`. Initial/final states (allowing only new engine/artifact/content pins), initial/step events, semantic legal actions/descriptors and observations match. All 25 generators then ran: 24 existing plus the new Demo setup generator. Existing goldens change derived hashes/action IDs because engine identity changes; they were not used as the sole compatibility evidence.

## Persistence

Live existing Docker Mongo 7 (`127.0.0.1:27018`) and PostgreSQL 16 (`127.0.0.1:5433`) were healthy. All four integration tests passed with zero skips. New Mongo coverage publishes only the new Demo ruleset into a randomized test database, checks exact hash/version, replay and conflict, and publishes no card revision. New Postgres coverage persists full initialization events, reloads before every one of six normal actionId submissions, and compares exact real state, format, rounds, chooser/first-player context, hashes, both observations, legal actions and event history. Missing event batches, format removal and roll rewrites reject. Final reload remains pre-turn. Test-owned namespaces are cleaned in finally blocks. Existing JSONB storage needs no migration; save now protects format/history with null-safe comparisons compatible with legacy missing fields.

## Wire

Wire schemaVersion **1** remains additive. Existing request/response schemas inherit the new strict domain/engine vocabulary and exported JSON Schemas. Missing format retains constructed; DEMO_STARTER and DEMO_STARTER_V2 reject INVALID_REQUEST, and a known Demo format without pinned policy rejects UNSUPPORTED_FORMAT. Normal actionId resolution is reused. No Next.js/Apollo/database dependency enters engine or harness interop.

## Python

Only the existing adapter test family tuple gains demo-setup-replay. Python implements no deck legality, RNG, ties or setup ordering. The adapter traverses all **30 families / 1,048 Node-authoritative actions**, comparing initialization, literal events, observations, action IDs and all hashes. The existing cyberpunk (87 tests) and harness-core (48 tests) suites also pass. Seven golden transport cases and seven deck-validation differential cases pass, retaining the two documented non-authoritative Python gaps. No Python data/corpus/model/training/gold file changes were made by this milestone; preexisting harness edits and index entries are preserved.

## Tests

Focused Demo: **52/52 passed**. Full Node suite: **1124/1124 passed**, 0 skipped. Live integration: **4/4 passed**, zero skipped. Typecheck, lint, four-card catalog validation, build, contract export and whitespace checks passed. The four catalog fixtures are distinct from the 29-card real Demo bundle and 53-card historical mechanic bundle.

During implementation, focused checks exposed readonly test annotations, existing CARD_MOVED draw-event naming, and normalization retaining provenance fields. These were corrected; the final focused/full gates pass. One earlier focused test process was terminated to diagnose its failure output and rerun directly. The first complete gate run stopped on a readonly observation annotation (exit 2); it was fixed. The next full test run had one stale-export failure (1123/1124 passed); exporting the additive contracts before rerunning tests resolved it. Remaining gates resumed while preserving the successful original-payload audit and generators. No known new lint warnings remain. Build completes without warnings. The existing Python differential suite still documents non-authoritative repeated-entry-copy-bypass and legend-in-main gaps; Node remains authoritative and Demo legality is not implemented in Python. Catalog and unsupported mechanics limits remain below.

## Commands

Exact acceptance commands and results (including the corrected gate retry):

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
docker compose ps  # existing Mongo/Postgres healthy (Docker socket required sandbox escalation)
node -v  # exit 0; v22.13.0
npm -v  # exit 0; 10.9.2
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-demo-implementation-before/replays  # exit 0
node --import tsx scripts/generate-attack-condition-power-replay.ts  # exit 0
node --import tsx scripts/generate-attack-ordered-effects-replay.ts  # exit 0
node --import tsx scripts/generate-combat-attack-replay.ts  # exit 0
node --import tsx scripts/generate-combat-resolution-replays.ts  # exit 0
node --import tsx scripts/generate-combat-restrictions-replays.ts  # exit 0
node --import tsx scripts/generate-combat-triggers-replays.ts  # exit 0
node --import tsx scripts/generate-delayed-effects-replay.ts  # exit 0
node --import tsx scripts/generate-demo-setup-replay.ts  # exit 0
node --import tsx scripts/generate-end-turn-history-replay.ts  # exit 0
node --import tsx scripts/generate-field-legends-replay.ts  # exit 0
node --import tsx scripts/generate-gear-capabilities-replay.ts  # exit 0
node --import tsx scripts/generate-gear-replay.ts  # exit 0
node --import tsx scripts/generate-goro-replay.ts  # exit 0
node --import tsx scripts/generate-noncombat-replay.ts  # exit 0
node --import tsx scripts/generate-private-information-replay.ts  # exit 0
node --import tsx scripts/generate-react-replay.ts  # exit 0
node --import tsx scripts/generate-reviewed-replay.ts  # exit 0
node --import tsx scripts/generate-saburo-replay.ts  # exit 0
node --import tsx scripts/generate-setup-replay.ts  # exit 0
node --import tsx scripts/generate-targeted-defeat-replays.ts  # exit 0
node --import tsx scripts/generate-targeted-spend-replay.ts  # exit 0
node --import tsx scripts/generate-turn-replay.ts  # exit 0
node --import tsx scripts/generate-value-conditions-replay.ts  # exit 0
node --import tsx scripts/generate-wire-golden.ts  # exit 0
node --import tsx scripts/generate-yorinobu-replay.ts  # exit 0
npm run typecheck  # exit 2
npm run typecheck  # exit 0
npm run lint  # exit 0
npm run validate:cards  # exit 0
npm test  # exit 1
npm run contracts:export  # exit 0
npm test  # exit 0
npm run build  # exit 0
git diff --check  # exit 0
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration  # exit 0
# From ../tcg_ai_training/cyberpunk_llm:
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node  # exit 0
mlx_env/bin/python -B scripts/test_cyberpunk.py  # exit 0
mlx_env/bin/python -B scripts/test_harness_core.py  # exit 0
```

Focused development checks also ran `node --import tsx --test tests/demo-starter.test.ts`, a direct diagnostic `node --import tsx tests/demo-starter.test.ts`, and intermediate `npm run typecheck` / `npm run lint` before the full gates. Initial failures are described under Tests; the last focused run passed 52 tests. Logs and command result ledgers are `/tmp/tcg-demo-implementation-gates.json`, `/tmp/tcg-demo-implementation-python.json`, and their recorded per-command log paths. A final milestone audit checks frozen card/source payloads, roadmap quantities, every changed file, unchanged HEAD/index and local documentation links.

## Files changed

Relative to the frozen start of this implementation (not all preexisting Git dirt): **61 application files**, **1 harness file**. Generated replay files below are existing regression artifacts under new pins; their original semantics were audited before regeneration.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Current fixed-pair/setup readiness and overtime next milestone; preserve all 29 physical rows and quantities. |
| [docs/demo-format-report.md](../docs/demo-format-report.md) | Current-policy link above unchanged historical source conclusions. |
| [docs/demo-setup-review-report.md](../docs/demo-setup-review-report.md) | Current-policy link preserving the historically unresolved publisher conflict. |
| [docs/demo-starter-report.md](../docs/demo-starter-report.md) | Successor implementation report with all 40 requested sections, commands and changed-file inventory. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Current 29/29, 60/60 execution and separate format/setup/full-match statuses. |
| [packages/domain/src/deck.ts](../packages/domain/src/deck.ts) | Explicit Demo manifest errors followed by the existing copy, RAM, Legend identity and availability checks. |
| [packages/domain/src/demo-manifests.v1.json](../packages/domain/src/demo-manifests.v1.json) | Runtime projection of the two unchanged reference compositions and composition hashes; no new card revision. |
| [packages/domain/src/demo.ts](../packages/domain/src/demo.ts) | Fixed versioned policy and immutable compositions; normalization strips provenance and aggregates duplicates; exact manifest/revision matcher. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Optional explicit Demo match identity, public literal roll pairs, generic FIRST_PLAYER_ROLLED event. |
| [packages/domain/src/index.ts](../packages/domain/src/index.ts) | Export Demo contracts. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Additive versioned format and strict policy validation; preserve constructed rules and required setup/win boundaries. |
| [packages/engine/src/demo-state.ts](../packages/engine/src/demo-state.ts) | Validate fixed pair, exact real content, seeded roll history and winning chooser; reject missing format/forged facts. |
| [packages/engine/src/first-player.ts](../packages/engine/src/first-player.ts) | Seeded opposed-d20 helper in canonical seat order; repeat both dice on ties. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Require explicit policy, exact individual manifests and pair; inspect capability metadata before validating completed setup state. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Add public format, literal rounds and derived selected seat; retain seed privacy. |
| [packages/engine/src/setup.ts](../packages/engine/src/setup.ts) | Narrow automatic Demo selection branch; reuse all existing later setup stages. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Carry format, validate Demo invariants, exclude historical roll pairs from PositionHash while preserving future RNG. |
| [packages/persistence/src/postgres.ts](../packages/persistence/src/postgres.ts) | Preserve format and literal setup history on saves using null-safe comparisons; legacy absent fields remain compatible. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Export additive wire-v1 JSON Schema for Demo format, policy and public setup facts. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Export additive wire-v1 JSON Schema for Demo format, policy and public setup facts. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Export additive wire-v1 JSON Schema for Demo format, policy and public setup facts. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Bump engine implementation identity to 0.4.0-demo-format-1. |
| [scripts/generate-demo-setup-replay.ts](../scripts/generate-demo-setup-replay.ts) | Generate the six-action setup-only contract fixture with an explicit stop guard. |
| [tests/demo-format.test.ts](../tests/demo-format.test.ts) | Keep source-review assertions and constructed negatives; unknown future version now V2, with bundle identity checked under current engine pins. |
| [tests/demo-setup-replay.ts](../tests/demo-setup-replay.ts) | Deterministic tie smoke, SECOND choice, cuts, spending, opening hands and first mulligan; stop before gameplay. |
| [tests/demo-starter-fixture.ts](../tests/demo-starter-fixture.ts) | Build the exact 29-card real-only bundle with a new pinned Demo ruleset. |
| [tests/demo-starter.test.ts](../tests/demo-starter.test.ts) | 52 focused format/RNG/setup/hash/observation/wire and mutation regressions. |
| [tests/fixtures/attack-condition-power-replay.v1.json](../tests/fixtures/attack-condition-power-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/demo-application-policy.v1.json](../tests/fixtures/demo-application-policy.v1.json) | Pin application authority, original request SHA-256 and unchanged historical source-artifact hashes. |
| [tests/fixtures/demo-first-player-vectors.v1.json](../tests/fixtures/demo-first-player-vectors.v1.json) | Five deterministic winner/tie vectors, seat ordering and application-authority label. |
| [tests/fixtures/demo-setup-replay.v1.json](../tests/fixtures/demo-setup-replay.v1.json) | Exact 29-real-card, 60-copy setup fixture; one strategic contract position and six actions, never gameplay gold. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/minotaur-replay.v1.json](../tests/fixtures/minotaur-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/over-the-edge-replay.v1.json](../tests/fixtures/over-the-edge-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/targeted-spend-replay.v1.json](../tests/fixtures/targeted-spend-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate wire-v1 golden engine pins and derived hashes. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerate existing regression under new engine/content/action/hash pins; original semantic payload audited independently. |
| [tests/integration/demo-setup.test.ts](../tests/integration/demo-setup.test.ts) | Minimal isolated Mongo ruleset publication and Postgres reload/resume across all six setup actions, including rejected format/history rewrites. |

Harness: `cyberpunk_llm/scripts/test_engine_adapter.py` adds only the setup fixture to the existing adapter traversal. No new project dependencies, package version, lockfile, DB migration or .env change. Historical source fixtures and immutable card revisions are unchanged.

## Unsupported mechanics

Overtime execution is UNSUPPORTED. Existing documented limits, including overlapping Reboot Optics prevention, generic WHEN_SPENT scheduling, broader control-transfer mechanics and unreviewed interactions, remain. Card execution completeness means all 29 printed reference functions have their reviewed scopes; it does not certify every cross-card interaction or a complete exact match.

## Ambiguities not guessed

Publisher precedence remains historically unresolved; application authority is explicit and separate. No general 27-card construction, mirror-match permission, new source ruling, overtime implementation, alternate mulligan rule or full-match readiness was inferred. Original source manifests retain REFERENCE_ONLY historical metadata; the new runtime admission policy is a separate versioned projection.

## Match-readiness status

| Layer | Status |
|---|---|
| Card execution | COMPLETE — 29/29 distinct, 60/60 copies, within reviewed scopes |
| Publisher direct-play intent | CONFIRMED |
| Demo fixed-list legality | SUPPORTED — DEMO_STARTER_V1, exact one-of-each pair |
| Exact demo initialization | SUPPORTED — deterministic setup only |
| Overtime | UNSUPPORTED |
| Full exact match | NOT YET VERIFIED |

The exact Demo trace stops before normal gameplay. No exact match was played forward.

## Recommended next milestone

**CYBERPUNK TCG — OVERTIME EXECUTION.** Review and implement the already sourced entry boundary after two qualifying empty-Fixer turns and overtime’s immediate seven-Gig victory, with timing, events, persistence, observations, hashes and deterministic regression coverage. Only after that boundary is executable should FIRST EXACT ARASAKA VS MERC DEMO MATCH begin. Neither milestone was started here.
