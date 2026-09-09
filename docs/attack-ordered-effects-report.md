# Evelyn Parker — Scheming Siren: ordered ATTACK review

Completed 2026-09-09. One new complete application card revision; all previous executable scopes preserved. No commit, push, model download, training run or harness corpus refresh.

## Runtime

Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine behavior artifact **0.4.0-attack-ordered-effects-1**.

Artifact SHA-256: `11fcb3bb0a55f94f1b33dfe1b0cafbb4b5f1d2d0bdcf0169549f276ddf918b94`.

## Evelyn exact card text and full shape

`evelyn-parker-scheming-siren`, application revision 1, `ATTACK_ORDERED_EFFECTS_V1 / SUPPORTED`. Unit / Doll; Blue RAM3; cost2; printed power0; unsellable; no additional keywords, activation, restriction or modifier. Uncommon, artist Olgierd Ciszak. Reviewed all five printings and all four captured errata; none applies to Evelyn. Merc Demo Deck 010 is printing `3757f0f3-32d0-41c2-89dc-515271d2b758`.

> {Attack} Draw 1. Then, if you have more ☆ (Street Cred) than a Rival, discard 1.
> (Units with power 0 don't steal Gigs.)

The power0 reminder uses existing current-power stealing rules. Gear can increase her power and allow stealing. It is not a permanent cannot-steal restriction. Full printing UUIDs, source hashes and normalized mechanics are in [executable-card-coverage.md](executable-card-coverage.md#evelyn-parker--scheming-siren-complete-ordered-attack) and the complete [card source fixture](../tests/fixtures/attack-ordered-effects-card-source.v1.json).

Raw card SHA-256 `a902a898742d6af0a16f37070dcb0d0f5f6a4fac97212522f839857873fd3c7c`; canonical record hash `df97cd7c2e340aae07ffbf56bd52425a25ca364f18f0272ccfde67710880f540`; normalized revision hash `015f486f2a90cd29964dd9086992148bdbdaaa9eef7115629427ccc9a7523b29`.

## ATTACK trigger semantics

11.21.1–11.21.2.2: declaring the attack locks the target, spends Evelyn, discovers her printed ATTACK and any inherited ATTACK effects, and resolves all pending work before Rival React. The existing scheduler owns ordering, source/controller identity and return context. No name/slug-specific queue was added.

## Ordered effect chain

One ability contains `[DRAW {count:1}, DISCARD_CARDS {player:CONTROLLER,count:1,selection:CHOSEN_BY_AFFECTED_PLAYER,when:{timing:RESOLUTION,condition:STREET_CRED_GREATER_THAN_RIVAL}}]`. The first primitive uses the existing DRAW handler. The ability remains current until its second primitive completes; it emits one whole-ability EFFECT_RESOLVED fact. Another pending trigger cannot interleave.

The optional current `primitiveIndex:1` identifies the second clause; absence means the original first primitive. The existing binding retains source instance/revision, subject, controller, turn, batch ordinal and original ATTACK stage. The paused continuation records `conditionMet:true`. No transport UUID determines continuation identity.

## Draw timing

The top physical card moves DECK→HAND before CONDITION_EVALUATED. Its owner sees its identity; the rival sees appropriate hand-count changes. The new draw is a legal discard candidate. Empty-deck loss stops resolution immediately before the condition, discard or React.

## Condition timing

Rules 10.2/10.2.3 require written order and no intervening pending effect; 10.3.3 checks an internal conditional clause when that clause resolves. Current Street Cred comes from current friendly Gigs, not a stored counter or ATTACK-declaration snapshot. Drawing cannot change this condition, so tests prove event/state sequencing rather than inventing a draw-sensitive predicate. The new greater-than comparison reuses the existing Null-aware less-than relation in this two-player slice: numeric > Null, equal numeric false, Null/Null false.

## Discard semantics

Discard is a typed semantic HAND→face-up TRASH operation. CARD_MOVED records the area transition; CARD_DISCARDED records why, the affected player, physical card, source/effect and whether forced. Single-card insertion uses the existing ordered Trash pile, with the newest entry on top.

The captured comprehensive rules omit a standalone DISCARD definition. This review combines controller/choice rules 10.1.4 and 10.31, the explicit own-hand discard usage in captured Shattered Memories, and the official guide's confirmation that discarded cards enter face-up Trash. The supplemental guide review is limited to destination/face; it does not replace captured comprehensive timing or setup rules. [Official Gameplay Guide](https://cyberpunktcg.com/gameplay-guide).

## Discard chooser

**Evelyn's controller draws and chooses their own discard.** The rival appears only in the Street Cred comparison. There is no printed may, random discard, opponent-selected card or rival-hand reveal permission. The prompt's conditional rival-discard examples therefore do not arise from this card.

## Hidden-hand protection

Before selection, the chooser sees their own hand and meaningful Discard descriptors. The rival cannot enumerate those actions and receives only a hand count. A direct negative model-input test excludes rival hidden CardIds, names and physical hand IDs. Discarded identity becomes public only after movement into face-up Trash. Authoritative event histories are private data, not viewer payloads; no raw event stream was added to model input or GraphQL gameplay.

## PendingChoice behavior

Zero eligible cards: continue without a fake choice. One mandatory card: resolve automatically. Multiple cards: genuine DISCARD_SELECTION with exact currently eligible options, selected by actionId. The headline contains **seven** legal discard options. A successful Evelyn draw guarantees at least one hand card, so the zero-card branch is tested at the trusted primitive boundary; empty-deck loss is tested separately. An initially empty own hand forces discarding the newly drawn card. An empty rival hand has no effect.

Validation rejects wrong actor, source/revision, primitive index, missing true-condition record, missing/duplicate options, broken combat continuation and early React. Hand changes invalidate stale options; rebuilding valid options still rejects the old observation-bound actionId. Invalid submissions leave input state unchanged.

## Choice actor vs active player

Active player, ability controller, acting player and discard chooser are the same player for Evelyn. At React, acting player becomes the rival through the existing transition. No new generic rival-choice actor protocol was necessary; no rival-discard TrainingPosition was fabricated.

## Evelyn + Kiroshi ordering

Both complete abilities enter the existing independent ATTACK batch. Tests choose each order. If Evelyn goes first, draw and discard finish before Kiroshi's Legend choice. If Kiroshi goes first, private knowledge is available before Evelyn resolves. React waits for both. Previously acquired Kiroshi knowledge survives unrelated draw/discard unchanged.

## Evelyn + Satori timing

Satori's inherited fight-win trigger does not enter the ATTACK batch. A focused Evelyn+Satori attack completes discard, reaches React, wins a fight, then draws from Satori after FIGHT_RESULT. Printed power0 plus Gear uses the same derived power rules as existing hosts.

## Evelyn + Floor It

Floor It becomes playable during React after the discard finishes. Its power change does not retroactively reevaluate Street Cred or recreate Evelyn's effect. Reboot is tested separately in the same timing boundary; it affects later fight defeat and does not interfere with Evelyn's ATTACK work.

## Events

One new generic event kind: CARD_DISCARDED. Existing EFFECT_PENDING, TRIGGER_ORDER_SELECTED, CARD_MOVED, CONDITION_EVALUATED, EFFECT_RESOLVED and PHASE_CHANGED express the chain. The condition event contains a boolean, not hidden hand details. No Evelyn-specific event kind or duplicated draw mutation.

## Observation

DISCARD_SELECTION is additive to the domain/observation window vocabulary. Observation remains the viewer projection of authoritative state. The new CARD choice label identifies only a chooser-visible own-hand card. Model input remains `{observation, legalActions:[{actionId,descriptor}]}`; full state, seed and authoritative event history remain outside it.

## Hash behavior

ReplayStateHash and PositionHash distinguish actual hidden hand differences. A chooser's hand changes their ObservationHash and action IDs; the rival's ObservationHash remains equal until something becomes public. Conversely, rival hidden-hand changes cannot alter Evelyn's current visible choices or action IDs. This is tested both with and without Kiroshi in the content bundle. Existing legacy bundle action identity rules remain unchanged.

## Training positions

The legal headline exports 16 strategic positions, including the seven-option own-hand discard position. Forced single-card discard pauses nowhere and creates no artificial strategic sample. PositionHash distinguishes chooser hand alternatives. TrainingAttempt is unchanged; generated schema bytes confirm it needed no edit.

## Demo coverage

Recomputed from the actual 29 roadmap rows before/after editing; no quantities were changed.

| Metric | Before | After |
|---|---:|---:|
| Distinct demo cards | 29 | 29 |
| Executable distinct | 16 | 17 |
| Without executable revisions | 13 | 12 |
| Arasaka distinct | 5/14 | 5/14 |
| Arasaka physical copies | 14/30 | 14/30 |
| Merc distinct | 11/15 | 12/15 |
| Merc physical copies | 21/30 | 24/30 |
| Combined physical copies | 35/60 | 38/60 |

## Remaining Merc cards

V — Corporate Exile (1 copy), Dying Night — V's Pistol (2), Delamain Cab (3). Arasaka's nine unsupported distinct rows are unchanged. See [roadmap](demo-deck-coverage-roadmap.md).

## Demo match readiness

Exact Arasaka initialize: **No**. Exact Merc initialize: **No**. Complete starter match: **No**. Both contain 27 main +3 Legends, below constructed minimum; unsupported card mechanics also remain. No starter padding, demo format or match claim was introduced.

## Constructed validation

40–50 main, exactly 3 Legends, existing copy/RAM rules remain. Focused tests reject 27 and 51 main cards, two Legends, a fourth Evelyn and insufficient Blue RAM. The legal headline uses 42 main with synthetic Red/Blue/Yellow Legend support; it is not an official starter or human-certified gold deck.

## Replays

All 18 families regenerated and passed Node/Python traversal. Earlier intentionally bounded families still stop at their original supported timing boundary; this milestone does not expand their policy pins.

| Family | Actions | Stored positions | Events |
|---|---:|---:|---:|
| combat-attack-replay | 41 | 40 | 185 |
| defeated-replay | 40 | 40 | 167 |
| fight-replay | 53 | 51 | 236 |
| first-blue-replay | 25 | 24 | 94 |
| gear-replay | 25 | 25 | 99 |
| gig-steal-replay | 46 | 45 | 203 |
| kiroshi-replay | 31 | 29 | 136 |
| mandibular-replay | 31 | 29 | 142 |
| noncombat-replay | 24 | 23 | 125 |
| permissions-replay | 29 | 28 | 133 |
| prevention-replay | 34 | 34 | 143 |
| react-replay | 53 | 51 | 229 |
| reviewed-replay | 11 | 11 | 65 |
| satori-replay | 46 | 42 | 195 |
| setup-replay | 10 | 7 | 67 |
| turn-replay | 7 | 3 | 53 |
| vanilla-replay | 35 | 35 | 144 |
| evelyn-replay | 17 | 16 | 90 |

The original 17 files were copied before editing to `/tmp/tcg-ordered-before/`. A separate audit repinned only engine/manifest identity, replayed **541 original actions**, and compared original semantic legal actions/descriptors, observations, initialization/transition event batches and final states. All passed. The new replay adds 17 actions; Python traverses 558 actions across 18 regenerated families.

Legacy generator defaults choose by action hash, so repinning can change which otherwise legal default action an author script selects. Sixteen regenerated sequences differ from their preserved originals; Kiroshi's sequence is unchanged. This is separated from the original-input compatibility audit: no old reducer behavior was changed to force regenerated choices to match. Receipt: `/tmp/tcg-ordered-audit.log`.

## Persistence

Real MongoDB on 27018: immutable Evelyn revision publish/read preserves the entire ordered ability and provenance, alongside existing revision/index/search tests. Real PostgreSQL on 5433: all 17 legal Evelyn transitions save with events, reload, compare both viewer observations/hashes and exact legal action IDs, then continue from the reloaded state. The single DISCARD_SELECTION reload retains chooser, primitive index, source trigger and TRIGGER_RESOLUTION combat context. It resolves through React to MAIN. The existing ledger/rollback/conflict tests also passed. Temporary database/schema cleanup remains in existing finally blocks.

## Python/wire

Wire v1 additions are the discard primitive/choice/window, pending primitive index/condition record, scope and generic event. Regenerated request, response, TrainingPosition schemas and wire goldens. No protocol version bump or TrainingAttempt change. Python's only edit adds `evelyn-replay` to its generic adapter test family list. It chooses by actionId; no rules, card-name logic or discard implementation moved into Python.

## Tests

**All final gates passed.** 319 Node tests (285 previous +34 new), zero failures/skips. Two actual database integration tests, zero skips. Python: 18 replay families, 7 wire goldens, 7 deck differentials, 87 game tests and 48 core tests. Typecheck, ESLint, four-catalog-card validation, production Next build, schema export and diff whitespace check all passed.

Development checks caught the missing new observation window, a test request using `operation` instead of the existing `op` field, and an isolated content-removal fixture missing updated revision pins/revision swaps. These were corrected before the final passes. Earlier failed receipts remain in `/tmp/tcg-ordered-gates.log` and `/tmp/tcg-ordered-final-gates.log`; final receipt is `/tmp/tcg-ordered-completed-gates.log`.

## Commands

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Every Node command used `PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH`.

| Exact command | Final result |
|---|---|
| `node -v` | v22.13.0, exit0 |
| `npm -v` | 10.9.2, exit0 |
| `npm run typecheck` | Codegen + both TypeScript projects pass, exit0 |
| `npm run lint` | Pass, no warnings, exit0 |
| `npm run validate:cards` | 4 original catalog fixtures valid, exit0 |
| `node --import tsx --test tests/attack-ordered-effects.test.ts` | 34 pass, exit0 |
| `npm test` | 319 pass, exit0 |
| `npm run build` | Next 16.3.4 compiled/typechecked; 6 static pages generated, exit0 |
| `npm run contracts:export` | Pass, exit0 |
| `git diff --check` | Pass, exit0 |
| `node --import tsx /tmp/tcg-ordered-audit.cjs` | Original 17 families /541 preserved decisions pass, exit0 |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | 2 pass, no skips, exit0 |

All generator commands below exited0; receipt `/tmp/tcg-ordered-regenerate.log`:

```sh
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
```

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`. All commands exited0; receipt `/tmp/tcg-ordered-python.log`:

```sh
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check -- scripts/test_engine_adapter.py
```

Read-only inspection used `git status --short`, `git diff`, `rg`, local JSON/rules reads and before/after SHA-256 comparison of all tracked/untracked files. The supplemental official guide was read on the web. A read-only CMS query for `rules-faq`/`gameplay-guide` returned zero pages; it supplied no additional rule definition and changed no corpus files.

## Files changed

Paths below are application-relative unless labeled Harness. The application began clean. A baseline SHA-256 comparison distinguished this milestone's changes from the harness's substantial pre-existing staged/unstaged work.

| File | Change |
|---|---|
| `docs/attack-ordered-effects-report.md` | This source review, measurements, commands and complete file inventory. |
| `docs/demo-deck-coverage-roadmap.md` | Admit Evelyn, recalculate coverage and remaining blockers. |
| `docs/executable-card-coverage.md` | Exact card shape, source/printing hashes, semantics and limitations. |
| `packages/domain/src/card.ts` | Add bounded ATTACK_ORDERED_EFFECTS_V1 execution scope. |
| `packages/domain/src/game.ts` | Add discard window/event and optional ordered continuation fields. |
| `packages/domain/src/mechanics.ts` | Add typed one-card controller discard, current greater-than condition and choice kind. |
| `packages/engine/src/combat.ts` | Route admitted ordered ATTACK through existing trigger scheduler. |
| `packages/engine/src/conditions.ts` | Reuse inverse Null-aware comparison for current Street Cred greater-than. |
| `packages/engine/src/discard.ts` | Read-only own-hand selector and semantic discard movement/fact. |
| `packages/engine/src/index.ts` | Chooser-visible discard labels and observation-bound action IDs for the new scope. |
| `packages/engine/src/initialization.ts` | Full-shape ordered admission and hidden metadata preflight. |
| `packages/engine/src/observation.ts` | Add DISCARD_SELECTION to supported observation windows. |
| `packages/engine/src/ordered-effects-support.ts` | Explicit complete-shape gating and old-scope metadata rejection. |
| `packages/engine/src/play-support.ts` | Admit the complete new Unit through ordinary play. |
| `packages/engine/src/state.ts` | Validate ordered metadata and stable discard timing boundary. |
| `packages/engine/src/trigger-queries.ts` | Indexed immutable primitive reconstruction and exact own-hand choices. |
| `packages/engine/src/trigger-resolution.ts` | Sequence DRAW→condition→discard in one pending ability, then resume. |
| `packages/engine/src/trigger-state.ts` | Validate current index/gate/choice and reject forged or orphaned continuations. |
| `packages/engine/src/trigger-support.ts` | Admit reviewed ordered sources alongside previous trigger shapes. |
| `packages/engine/src/view.ts` | Expose read-only getDiscardableCards query. |
| `packages/wire/schemas/request.v1.json` | Regenerate additive v1 contract from the updated typed schemas. |
| `packages/wire/schemas/response.v1.json` | Regenerate additive v1 contract from the updated typed schemas. |
| `packages/wire/schemas/trainingPosition.v1.json` | Regenerate additive v1 contract from the updated typed schemas. |
| `scripts/engine-identity.ts` | Bump engine behavior artifact version. |
| `scripts/generate-attack-ordered-effects-replay.ts` | Write the deterministic new replay and metrics. |
| `tests/attack-ordered-effects-fixture.ts` | Normalize real Evelyn revision and legal constructed support bundle. |
| `tests/attack-ordered-effects-replay.ts` | Author legal setup/play/Lag/attack/discard/React/MAIN without patches. |
| `tests/attack-ordered-effects.test.ts` | 34 focused source, semantic, composition, privacy and negative tests. |
| `tests/fixtures/attack-ordered-effects-card-source.v1.json` | Exact raw card, five printings, source hash and all four errata. |
| `tests/fixtures/attack-ordered-effects-rules.v1.json` | 61 captured rules, snapshot hashes, bounded interpretation and supplemental source. |
| `tests/fixtures/combat-attack-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/defeated-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/evelyn-replay.v1.json` | New 17-action /16-position /90-event authoritative replay. |
| `tests/fixtures/fight-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/first-blue-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/gear-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/gig-steal-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/kiroshi-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/mandibular-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/noncombat-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/permissions-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/prevention-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/react-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/reviewed-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/satori-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/setup-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/turn-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/vanilla-replay.v1.json` | Regenerate original replay family under current pins; original payloads independently audited. |
| `tests/fixtures/wire-golden.v1.json` | Regenerate existing goldens under the updated engine pins. |
| `tests/integration/persistence.test.ts` | Mongo full revision round-trip and PostgreSQL pending-discard reload/resume. |
| Harness: `scripts/test_engine_adapter.py` | Add only the new replay family to generic Node-authoritative traversal. |

Total: **50 application files and one harness file**. GraphQL generated sources, package manifests/lockfiles, TrainingAttempt schema, existing normalized card revisions, infrastructure configuration and raw/processed harness corpus have no content change. No commit or push.

## Unsupported mechanics

Dying Night, Delamain, named hosts, general end-turn/steal history, Go Solo, field Legends, DEMO_STARTER and a complete starter match remain outside scope. Only one controller-chosen card is admitted for discard; random/opponent-choice/multi-card/cross-owner variants require a separate rules review. No new framework/database dependency was introduced into the engine or Python model interface.

## Ambiguities not guessed

Evelyn's printed instruction is self-discard, so rival-discard examples and mid-ability rival actor changes were not manufactured. Drawing does not change Street Cred. Zero power is not a permanent prohibition. The local discard-glossary omission is explicitly recorded with the limited supplemental source synthesis; this is not a claim that the comprehensive snapshot contains a missing rule or that the guide overrides its timing. No general hidden-hand reveal permission, random selection or arbitrary effect chain was inferred.

Remaining technical debt: generic legacy Python deck validation still has the pre-existing repeated-entry-copy-bypass and legend-in-main discrepancies (all seven differential cases match their expected results); Node remains authoritative. `validate:cards` still validates four original catalog records; reviewed engine bundles do not silently seed those cards into the application catalog. Source review remains implementation-reviewed, not human-certified training gold. Final lint/typecheck/build emitted no new warnings.

## Recommended next milestone

Review the full Dying Night + Delamain named-host/end-turn/history cluster against captured sources, choosing the smallest complete card boundary its dependencies allow. Keep Go Solo/field Legends and any physical demo-format policy as separate source-reviewed milestones.
