# Field Legends / Go Solo milestone report

Implementation review dated 2026-09-09. Only V — Corporate Exile is newly admitted. No commits or pushes.

## Runtime

Node **22.13.0**, npm **10.9.2**; application package remains 0.3.0. Engine **0.4.0-field-legends-1**, artifact **3977001506e185fcf3bbd5bba53d53b814f60c2e7cda2beb665f898592666e2a**. Next.js 16.3.4 production build passed. Engine/domain/wire remain independent of Next.js, Apollo, MongoDB and PostgreSQL.

## V exact captured full shape

v-corporate-exile / immutable application revision1; V: Corporate Exile, printed LEGEND, Blue RAM2, €5, power8, sellable, Corpo/Merc. Primary printing The Heist Retail Starter012, Epic, Envar; Merc Demo008 is Envar Studio. All six printings are preserved:

| Printing UUID | Set | Number |
|---|---|---|
| 4a5591f9-743e-4186-8deb-560971bb3f82 | theheistretailstarterdeck | 012 |
| a6511c82-3a16-41b3-a39a-5194897c8648 | theheistbetastarterdeck | β012 |
| 20bd1c78-1773-486e-bf45-4075fd4f2a3f | mercdemodeck | 008 |
| f509ebd8-c8b7-4a22-8922-2d71c6df0b6f | boxtoppersretail | 006 |
| e44580df-d78d-4b09-bb53-edb1ee32ac96 | boxtoppersbeta | β006 |
| 848e3de6-3a3e-462e-8186-0a214ff03b79 | edgerunneropens1 | 053 |

Complete text:

> {Go Solo} (Pay this Legend's cost to play it as a ready Unit. It can attack this turn. When it leaves the field, remove it from the game.)

No extra abilities, conditions, costs, triggers or modifiers. Empty raw keywords normalize from opening Go Solo markup. All four captured errata reviewed; none targets V.

| Hash | SHA-256 |
|---|---|
| Raw source file | deac316764ac93da51d4cae2602d52ca7b63551d2ccbc048f2e849d9ef5b8f67 |
| Canonical source record | d1b56071f0eabd301c6e5ca5d1b63cae6bb68267a2a6c368f54d32f3d424ab9b |
| Normalized immutable revision | 7d9d2b9a32b578db8fb254142b506d8224b7345dd0ca8a78189bd08d76e35aeb |
| Raw rules snapshot | 054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd |
| Processed rules snapshot | 1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19 |
| Raw errata snapshot | 1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75 |

## GO SOLO rules reviewed

[Focused fixture](../tests/fixtures/field-legends-rules.v1.json) pins 216 existing local rule nodes and 16 relevant official FAQ findings, with IDs/dates/hashes. [Official rules](https://cyberpunktcg.com/comprehensive-rules) and [V's official card page](https://cyberpunktcg.com/cards/v-corporate-exile) are authoritative entry points.

Current rules endpoint parses identically to the local snapshot. V's executable fields and all printing identities match; image URLs differ. The dated harness corpus was not refreshed.

Key rules: 3.4.1 face-down information;4.2.1 field Unit+Legend;4.4–4.5 valid areas/removal/ordinary play;4.10–4.12 equip/inheritance/movement;5.7 CALL/payment;8.14 and11.25 activation;11.3 Lag;9 combat;11.19 defeat;10.10.1 last-valid information;11.20 and the Jackie FAQ play classification.

## GO SOLO action/timing/cost

Optional engine-generated GO_SOLO action, labeled “Go Solo with V: Corporate Exile.” PLAY_CARD is the separate ordinary entry choice. Both require own active/acting open MAIN, face-up reviewed source in LEGENDS, no setup/combat/pending resolution, and exact printed payment. No READY requirement. Remembering a face-down V does not activate hidden text. CALL can reveal V in the same turn.

Existing payment primitives select distinct Eddie/Legend instances totaling 5; no new currency counter. V may fund its own cost while still in LEGENDS. Partial selections leave objects unmoved/unspent. Completion spends the batch before movement. Forced exact payment does not create a training decision.

## Legend readiness/Lag behavior

| Entry | Orientation | Lag | Same-turn attack |
|---|---|---|---|
| Ordinary PLAY_CARD | Post-payment orientation preserved | Applied | Wait for Lag removal |
| GO_SOLO | READY, including previously spent/self-paying source | Applied | Permitted, subject to other restrictions |

Official FAQ forbids entry-turn Spend-icon effects. Go Solo overrides only the attack restriction, without erasing Lag. BLOCKER uses a separate keyword cost. End-turn cleanup clears Lag. Existing GO_SOLO status records field entry mode; no wentSoloThisTurn history was added.

## Effective Unit + Legend types

Printed revision remains LEGEND. Existing query returns LEGEND in LEGENDS and LEGEND+UNIT on BATTLEFIELD. Attack, Blocker, targets, fight, defeat and play-history queries use effective Unit semantics. Field admission requires the explicit reviewed policy and complete supported shape. Fabricated field Royce under CALL-only support is rejected. Legacy ordered contract fixtures retain their historical, non-executable representation.

## LEGENDS → FIELD movement

The same physical CardInstanceId/CardId/revision/owner/controller/face survives. Dedicated moveLegendToFieldWithAttachments moves host then attached Gear sorted by physical ID within one returned transition. Readiness changes only for payment/entry mode. No Unit copy, new area, control transfer or speculative return to LEGENDS.

## Attachment preservation

Host attachment IDs and Gear instances survive without detach/re-equip events. All Gear locations follow to BATTLEFIELD atomically. Validation rejects split areas, duplicate presence, unsupported hosts and invalid topology. Actual departures remain in the existing departure/detachment pipeline.

## Pre-equipped Gear power

V+Dying is power 10 in LEGENDS and remains 10 on FIELD. Mantis+Satori+Mandibular compose through the same modifiers before/after entry, once each. Pre-equip and post-equip equivalent configurations have identical current power/capability sources. No revision values are rewritten.

## Pre-equipped capability activation

Inheritance remains available on legal hosts; usability depends on each effect's own type/area/timing/readiness conditions. No blanket field-Unit-only inherited-text filter. Normal Legend payment preserves Gear and inherited text. Future Faceplate spending triggers remain unimplemented, with the hosting invariant preserved.

## Mandibular interaction

Inherited BLOCKER exists in LEGENDS but cannot be declared there. After entry, eligible ready V uses the existing React action to spend and redirect. Tests retain and compare the same capability sources across movement.

## Satori interaction

Pre-equipped Satori grants +2 in both areas. A field V victory uses ordinary power/fight arithmetic, then inherited fight-win scheduling draws one. No re-equip after entry.

## Kiroshi interaction

Pre-equipped Kiroshi grants +1 and inherited ATTACK text in LEGENDS. After entry/attack, its existing private-look choice resolves before React. Only the entitled viewer receives remembered identity; the rival gets the public marker. Private knowledge does not enable face-down Go Solo. Existing CALL/public-reveal cleanup remains intact.

## Dying Night interaction

**First real V-positive delayed branch implemented.** The legal headline CALLs V from setup, equips Dying in LEGENDS, pays Go Solo, preserves both physical IDs, attacks that turn, decreases a rival Gig by 2, registers independent delayed work, completes React/stealing, and readies 2 Eddies at own-turn end. Three spent Eddies create two strategic selection stages; neither readies until the full unordered set is chosen. The next turn then begins.

Real defeat regression also passes: V loses with Dying attached, reaches REMOVED while Dying stays in Trash, and the delayed benefit still succeeds. New field-Legend records retain only last-valid effective types at registration, immutable subject reference and creation controller. Exact Name identity is evaluated at resolution rather than cached as a boolean. Original ordinary-Unit delayed records/IDs/payloads are unchanged.

## Legend CALL/payment behavior before field entry

CALL targets face-down Legends, pays existing €1, reveals them and preserves orientation. Face-up V is not a CALL target. Ready Legends in LEGENDS can pay €1; face-up sources require the sell tag. Payment does not move host/Gear. Go Solo is separate and spends V only when V is an actual selected payment source.

## Field Legend payment/CALL behavior

Field V is outside LEGENDS: neither CALL target nor Legends-area €1 payment source. Printed Legend identity does not bypass those area requirements. No repeat Go Solo from FIELD, HAND, TRASH or REMOVED.

## Fight

Shared effective power, targeting, defender React, Blocker, fight resolution and Gig stealing apply. No V slug/identity branch in combat. Go Solo attack permission still passes through existing attack restrictions.

## Defeat/removal

Field Legend is a Unit when declared defeated. Existing defeat discovery captures relevant bindings before movement, then finishes movement before pending effects. Host and Gear enter Trash in owner-selected order; V then moves to REMOVED under 4.4.1/4.4.2. Current Unit type ceases outside FIELD. Last-valid type metadata is used only for the reviewed delayed lifetime. No normal Go Solo/combat return to LEGENDS is invented.

## Gear movement on defeated Legend

Gear follows into Trash, detaches, and remains there when V is removed (4.12.2). Attachments and field-only statuses clear; no orphan field references. Cross-owner and hidden-zone delayed lifetimes remain explicitly unsupported.

## Observation

Both viewers see public V identity, effective LEGEND+UNIT, FIELD location, READY/Lag/Go Solo status, power and attachments. New fields are additive and policy-gated. Face-down identities, Eddie identities and future RNG remain private.

## Events

Reuses PAYMENT_MADE, CARD_MOVED, CARD_PLAYED and trigger/combat/delayed facts. One new generic event: GO_SOLO_ACTIVATED. Entry emits deterministic host/Gear movement without GEAR_DETACHED or GEAR_ATTACHED. Both modes count as Unit PLAY for Jackie once; moving attached Blue Gear does not count again.

## Training positions

37 strategic positions from 38 headline actions. Go Solo, payment, field attack and ready2 use existing TrainingPosition/actionId contracts. Forced payment/effect work produces no model sample. Python contains no Go Solo, effective-type, Gear or Dying logic.

## Hash behavior

Entry changes replay, position and observation hashes; physical IDs stay stable. Transport version/event counters change ReplayStateHash without changing PositionHash/model action identity. Entry mode is observable. Delayed last-valid metadata participates in canonical state identity. Exact engine/rules/content pins remain required.

## Demo coverage

Recalculated from actual rows: 20/29 executable distinct, 9 blocked. Arasaka 5/14 distinct and 14/30 copies unchanged. Merc 15/15 and 30/30. Combined 44/60. V's one copy is the only increase.

## Merc card-execution status

**COMPLETE: 15/15 distinct, 30/30 copies.** This measures individual reviewed card shapes within their stated scopes, not every possible interaction.

## Demo-format readiness

**Merc exact demo initialization: still NO until DEMO_STARTER policy is reviewed.** No demo policy, padded physical list or complete demo match.

## Constructed validation

Unchanged 40–50 main + exactly 3 Legends, with existing RAM/copy restrictions. Exact 27+3 lists still fail. New replay uses 42 main and 3 Legends, with existing synthetic filler replacing Blue RAM3 cards to respect V's Blue RAM2 budget.

## Replays

All 17 generator scripts ran.21 replay families now include the field-Legend family. New headline: 38 actions, 37 positions, 159 events, seed field-legends-12. Starts at setup; blind CALL slot1; no state/RNG patches. Original 20 families remain separate regressions.

## Original payload compatibility

Original 20 payloads were preserved before editing in /tmp/tcg-field-legends-before. The reusable audit replays their original actions under new pins and compares semantic legal-action/descriptor sets, every observation/event batch, initial and final states. **20 families, 627 original decisions passed.**

Only engineVersion, engineArtifactHash and contentManifestHash are repinned. Expected payloads are original, not regenerated. ActionId ordering may vary with pins; semantic action/descriptor sets are compared canonically.

## Persistence

Live Mongo and PostgreSQL tests passed, neither skipped. Mongo publishes/rereads/replay-publishes V's immutable revision in an isolated database. Postgres saves/reloads each legal trace step through CALL, pre-equip, payment, entry, combat and delayed ready2, including both ready choices and entry payment. Hashes, actions, both observations and full event history survive reload; subsequent actions consume reloaded state. Existing synthetic positive persistence remains a regression. No migration.

## Python/wire

Wire v1 stays additive. Request, response, TrainingPosition schemas and wire goldens regenerated. TrainingAttempt unchanged. Generic Python adapter now traverses 21 families/**665** authoritative actions, including 38 new actions;7 golden round trips, stale and invalid-envelope checks pass. Python game 87/87, harness core 48/48. No model download/training.

Pre-existing Python differential gaps remain repeated-entry-copy-bypass and legend-in-main; TypeScript remains authoritative.

## Tests

**453/453 application tests**, including 47 new field-Legend tests. Two older hypothetical assertions were updated for effective Unit type and strict unsupported-field validation. Typecheck, lint, four fixture-card validation, build, contracts export and diff checks passed.

First focused run exposed five test setup/assertion errors; corrected before the passing suite. First broad run exposed the two obsolete assumptions plus schemas that had not yet been exported. One unused-import lint warning was removed. No suppressed rules or disabled tests.

## Commands

Application cwd: /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online

    export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
    node -v                                      # v22.13.0
    npm -v                                       # 10.9.2
    npm run typecheck                            # pass
    npm run lint                                 # pass; no remaining warnings
    npm run validate:cards                       # pass; 4 original catalog fixtures
    npm test                                     # pass; 453/453
    npm run build                                # pass; Next.js 16.3.4
    npm run contracts:export                     # pass
    for script in scripts/generate-*.ts; do node --import tsx "$script" || exit; done
    # pass; all 17 generators, 21 replay families and wire golden
    node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-field-legends-before
    # pass; 20 original families / 627 decisions
    TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
    TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
    npm run test:integration                      # pass; 2/2, no skips
    git diff --check                             # pass

Harness cwd: /Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm

    mlx_env/bin/python -B scripts/test_engine_adapter.py \
      --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
      --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
    # pass; 21 families, 665 actions, 7 golden round trips
    mlx_env/bin/python -B scripts/test_cyberpunk.py       # pass; 87
    mlx_env/bin/python -B scripts/test_harness_core.py    # pass; 48
    git diff --check                                   # pass

Additional diagnostics: node node_modules/typescript/bin/tsc --noEmit --incremental false; node --import tsx --test tests/field-legends.test.ts; generator seed search field-legends-0 through 12. Read-only official captures went to /tmp/tcg-field-legends-source, with hashes pinned in fixtures. Logs are under /tmp/tcg-field-legends-gates and /tmp/tcg-field-legends-*.log.

## Unsupported mechanics

Faceplate WHEN_SPENT/general spend-trigger dispatch; other Legend full shapes including Royce's field behavior; Arasaka admission; generic ownership/control changes; field-to-LEGENDS return; bottom-deck groups; hidden-zone delayed lifetimes; multiple outstanding Reboot preventions; overtime; exact demo initialization/full demo matches. None is silently ignored.

## Ambiguities not guessed

Lag remains because field-entry rules apply it and FAQ retains the Spend-icon restriction; Go Solo provides only an attack exception. Ordinary play is implemented because 4.5 and V/general FAQs expressly permit it. Go Solo qualifies as PLAY/Blue Unit play because official Adam Smasher/Jackie FAQs confirm it. Public defeat preserves Dying's benefit under 10.10.1 and the Dying FAQ. No inferred return or field-Legend payment permission.

## Recommended next milestone

Review/admit **Goro Takemura — Hands Unclean**, Green RAM2, cost 5, power 7, Go Solo + printed Blocker, six printings including Arasaka Demo008. Structural primitives exist; its full shape still needs distinct admission/replay.

Yorinobu — Embracing Destruction has no numeric cost/Go Solo and needs first ARASAKA attack history plus conditional discard. Saburo — Stubborn Patriarch has no numeric cost/Go Solo and needs an attacking ARASAKA aura. Goro — Losing His Way is a Unit with a face-up-Legend condition/+5 turn modifier. None was admitted. Review DEMO_STARTER separately later.

## Files changed

Inventory below covers this milestone's preserved baseline. No harness corpus, model, prompt, training, eval or gold data changed.


| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Recalculates 20/29 and 44/60 coverage, separates demo readiness, identifies next review. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Documents full V admission, exact text/printings/hashes/interactions/limits. |
| [docs/field-legends-report.md](../docs/field-legends-report.md) | This milestone report, commands, validation and complete file inventory. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Adds the complete FIELD_LEGENDS_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Adds typed Legend-entry payment continuation, last-valid delayed types and generic Go Solo event. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Adds explicit optional reviewed field-Legend policy. |
| [packages/engine/src/action-return.ts](../packages/engine/src/action-return.ts) | Recognizes the new entry continuation as an unfinished MAIN action. |
| [packages/engine/src/attachments.ts](../packages/engine/src/attachments.ts) | Admits reviewed field Legends as Gear hosts while preserving Legends-area hosts. |
| [packages/engine/src/capabilities.ts](../packages/engine/src/capabilities.ts) | Preserves inherited capabilities across reviewed field entry. |
| [packages/engine/src/card-movement.ts](../packages/engine/src/card-movement.ts) | Adds atomic host/Gear field movement and clears field statuses on departure. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Documents existing effective-type derivation for both entry modes. |
| [packages/engine/src/combat-queries.ts](../packages/engine/src/combat-queries.ts) | Applies Go Solo attack permission without dropping other restrictions. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Evaluates named-Unit condition using effective/validated last-valid types. |
| [packages/engine/src/defeat.ts](../packages/engine/src/defeat.ts) | Admits reviewed effective field Units through shared defeat processing. |
| [packages/engine/src/delayed-effects.ts](../packages/engine/src/delayed-effects.ts) | Captures, hashes and validates field-Legend delayed lifetime and last-valid types. |
| [packages/engine/src/effect-support.ts](../packages/engine/src/effect-support.ts) | Routes new complete Legend scope through CALL admission. |
| [packages/engine/src/end-turn-support.ts](../packages/engine/src/end-turn-support.ts) | Accepts reviewed Legend subjects in actual Unit-steal history. |
| [packages/engine/src/field-legend-support.ts](../packages/engine/src/field-legend-support.ts) | New full-shape/dependency admission and field metadata validation. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Enumerates, labels and dispatches entry actions and payment continuations. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Validates full field-Legend metadata before gameplay setup. |
| [packages/engine/src/legend-entry.ts](../packages/engine/src/legend-entry.ts) | New ordinary/Go Solo entry eligibility, exact payment choices, continuation validation and reducer. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Adds policy-gated public effective types and Go Solo entry status. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Recognizes the complete field-Legend execution shape. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Integrates field metadata, effective Lag and entry continuation validation. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | Discovers Jackie PLAY using effective Unit type. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | Records Legend Unit plays and resolves delayed last-valid predicates. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | Validates effective Unit PLAY, delayed conditions and exclusive entry/trigger states. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerated additive runtime request schema. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerated additive runtime response/observation/event schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerated additive training-position schema. |
| [scripts/audit-replay-compatibility.ts](../scripts/audit-replay-compatibility.ts) | New reusable original-payload audit; refuses an absent/empty baseline. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Bumps source artifact version to 0.4.0-field-legends-1. |
| [scripts/generate-field-legends-replay.ts](../scripts/generate-field-legends-replay.ts) | Generates canonical real V/Dying positive replay. |
| [tests/combat.test.ts](../tests/combat.test.ts) | Retains effective-type query assertion and now rejects unsupported fabricated field Royce. |
| [tests/delayed-effects.test.ts](../tests/delayed-effects.test.ts) | Corrects the isolated Legend-negative predicate fixture to use LEGENDS. |
| [tests/field-legends-fixture.ts](../tests/field-legends-fixture.ts) | Constructs immutable V revision and legal explicit-policy test bundle/decks. |
| [tests/field-legends-replay.ts](../tests/field-legends-replay.ts) | Legal setup-to-next-turn V/Dying positive trace without state/RNG patches. |
| [tests/field-legends.test.ts](../tests/field-legends.test.ts) | 47 new acceptance/regression tests. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/field-legends-card-source.v1.json](../tests/fixtures/field-legends-card-source.v1.json) | Complete dated V record, six printings, errata and comparison hashes. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | New real V/Dying positive replay, snapshots and training positions. |
| [tests/fixtures/field-legends-rules.v1.json](../tests/fixtures/field-legends-rules.v1.json) | 216 local rule nodes, 16 FAQ findings and authoritative source hashes. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerated existing family under new artifact pins; original semantic payload compatibility separately audited. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerated existing wire golden under the new artifact pins. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Adds immutable V Mongo round trip and every real V trace boundary in Postgres. |

| AI harness file | Change |
|---|---|
| scripts/test_engine_adapter.py | Adds field-legends-replay to the existing generic actionId replay loop; no Python rules logic. |

Total: 63 application files and 1 harness file. Original source corpus and previously admitted real revision hashes were verified unchanged. No commit or push.
