# Yorinobu — first qualifying attack history report

Complete reviewed Yorinobu admission, source-independent history and ordered draw/conditional discard.

## Runtime

Node **v22.13.0**, npm **10.9.2**, application package **0.3.0** (unchanged). Engine **0.4.0-first-attack-history-1**, artifact **8b16e458b0fe6faf3783d5b5452de58804d1a260954f4621162f50284ee012e0**. Reviewed 2026-09-09. Application and harness remain separate repositories; no commits, staging or pushes.

The pre-existing Goro milestone was preserved. Before editing, 287 application and 504 harness file hashes plus the original 22 replay payloads were retained in /tmp/tcg-yorinobu-before. The baseline engine was 0.4.0-field-legends-2 / 5b907fb04f8a1ca261491f8646e5c8659003d97409d1578ccffd9c2c5916f54e. Temporary audit files are session evidence, not new product dependencies.

## Yorinobu exact full shape

CardId **yorinobu-arasaka-embracing-destruction**, revision **1**, identity **Yorinobu Arasaka**, subtitle **Embracing Destruction**, SUPPORTED / FIRST_ATTACK_HISTORY_V1. Legend, Red RAM2, sellable for the existing base Eddie value1, Arasaka/Corpo, Null printed cost/power. Normalization represents Null cost as DASH and omits numeric power; it does not fabricate zero. No Go Solo, raw keywords, equip, modifiers, restrictions, activation costs, flavor text or additional clauses.

> The first time a friendly ARASAKA Unit attacks each turn, draw 1. Then, if you have less than 20 ☆ (Street Cred), discard 1.

Complete [raw capture](../tests/fixtures/yorinobu-card-source.v1.json) and [normalization](../tests/yorinobu-fixture.ts). Source card UUID **31fa5825-946a-4ca2-afa8-8f07b9898d6a**. All six printing records reviewed, including artist, rarity, set, collector number, finish and image metadata:

| Printing UUID | Set | Number | Artist / rarity |
|---|---|---|---|
| f70b75b5-aa2f-4c2d-b8c3-01fcb2a670ec | embracingpowerretailstarterdeck | 001 | ADIA / Epic |
| 362bef23-c935-4729-a13b-dc3bc646d9b3 | embracingpowerbetastarterdeck | β001 | ADIA / Epic |
| aaad5db8-fcd4-42f0-8ced-e7527dbccf79 | arasakademodeck | 001 | ADIA / Epic |
| dc7bb3cf-1005-4584-ad7a-447f0ccf07bf | boxtoppersretail | 001 | Vincenzo Riccardi / Nova Rare |
| 12337d92-713c-4c7c-8a16-595a7b4717f1 | boxtoppersbeta | β001 | Vincenzo Riccardi / Nova Rare |
| ba15a39b-fc76-474b-a2f0-76e5069a69e4 | edgerunneropens1 | 034 | Vincenzo Riccardi / Nova Rare |

Arasaka Demo001 is **aaad5db8-fcd4-42f0-8ced-e7527dbccf79**. Local raw-byte SHA256 **9a01723fde94d8feca1582272de879bba21feec88faa012856a448226061c51d**; canonical captured-record hash **5d94f9d0d3d9851efcb49f81878af2a3b47faf71aeea47c95336570ab4bcdbba**; immutable normalized revision hash **63333c2d8392b6368390474593bb897066a792276b7af8b54d6d08635f120f3d**. Current official card response SHA256 **ca20d5dc8fc86df5428418271af494f09aef35c8f72bc6cfa3be2d0bc59c700e**; all gameplay fields and printing UUIDs match. Signed image URLs and selected display printing are transport metadata. This is implementation-reviewed content, not human-certified gold.

## Rules/FAQ reviewed

The [rule fixture](../tests/fixtures/yorinobu-rules.v1.json) pins 252 exact local rule nodes, two narrowly relevant current FAQ records and these byte hashes:

| Source | SHA256 |
|---|---|
| Local raw rules | 054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd |
| Processed rules | 1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19 |
| Local raw errata | 1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75 |
| Processed errata | 16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340 |
| Current official rules response | b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a |
| Current focused FAQ response | 94cc47bd8bd5f787cad4aaa8f1c2408e9abf161d248966494880d2fe8a9f7846 |

Rules3.4.1 and4.3 govern face-down/face-up Legends;3.13.1 defines classifications;4.2.1 makes field Legends Units;4.5 excludes Null-cost ordinary field entry. Attack9.3–9.6 establishes target/spend/declaration/pending timing, and9.13,9.26–9.29 govern later termination. Pending10.12–10.17 governs first occurrences/controller order;10.2.3 and10.3.3 govern atomic clauses and current-condition timing. Street Cred5.11.4/5.11.4.2 establishes Null ordering;10.31 and11.5 govern discard/draw;8.16–8.18 distinguishes end effects from the next turn.

Yorinobu FAQ **61ad63b3-47d9-48ee-a3f6-4c2842b11c66**, published2026-09-04: a qualifying attack before reveal counts, so another attack after reveal cannot trigger that turn. Saburo FAQ **18318e94-6979-4623-9cf5-fee73924d728** confirms its attacking aura applies through Fight/Steal; roadmap review only. FAQ response updated2026-09-08. Primary sources: [card API](https://api.netdeck.gg/api/cards/cyberpunk/yorinobu-arasaka-embracing-destruction), [rules API](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules), [FAQ API](https://api.netdeck.gg/api/faqs/cyberpunk). Current rules parse identically to the preserved local capture.

All four captured errata were reviewed: Johnny's sellability, Kiroshi equip reminder, Nocturne artist and Judy artist. None applies to Yorinobu or Saburo. No corpus refresh or mutation.

## First-friendly-ARASAKA-attack semantics

The first authoritative declaration by a face-up friendly effective Unit with immutable tag Arasaka, per controller and global turn. Friendly uses controller rather than owner. Target can be a spent rival Unit or rival GIG_AREA. The first occurrence is consumed whether or not a source triggers. Counts distinguish later attacks; the first attacker reference remains unchanged. No per-Unit allowance or activated-use counter is introduced.

## Source-independent history

recordQualifyingAttack runs after every admitted declaration under the explicit first-attack policy. It does not search for Yorinobu. Focused regressions cover no physical Yorinobu, a face-down source, same-Unit repeat and another printed synthetic Arasaka Unit. CALL usage, Blue Unit/Gear play history and qualifying attack history remain separate fields and semantics.

## Face-down Yorinobu behavior

Face-down Legends expose no card abilities or identity. The central FAQ regression legally attacks with Goro while Yorinobu is down, resolves combat, legally CALLs Yorinobu, then performs a second qualifying attack from an explicitly trusted readiness setup. Count advances1→2 with no Yorinobu pending effect or retroactive draw. A separate legal CALL-before-first-attack test does trigger. The readiness arrangement is not part of the headline replay.

## History data model

Optional turnHistory.firstArasakaAttacks is required when FIRST_ATTACK_HISTORY_V1 is enabled after setup. It has exact player coverage and the enclosing current global turn:

```ts
Record<PlayerId, {
  count: number; // nonnegative integer
  first: {
    attackerId: CardInstanceId;
    attacker: CardReference; // immutable CardId/revision
  } | null;
}>
```

Zero requires null; positive count requires one retained first occurrence. Validation checks current turn, exact players, distinct qualifying references, current declared-attack coherence and controller coverage. Physical objects remain represented in TRASH/REMOVED, so history never requires a live FIELD attacker or current effective Unit type after departure. No admitted rule deletes the object or changes control. A future control-change/removal-from-object-map mechanic must extend this historical reference contract explicitly.

Historical counts are authoritative state facts, like existing Blue-play history. Validation rejects malformed/inconsistent records; it is not a replacement for replaying the authoritative event log to establish the provenance of a wholly forged but self-consistent history.

## History recording timing

Target selection alone leaves the attacker ready and history untouched. The authoritative transition locks the target, spends the attacker, emits ATTACK_DECLARED, records the qualification, then discovers pending effects. Enumeration is read-only. External rejected commands do not commit their tentative mutation. A later Blocker redirect, invalidation, fight result or removal cannot undo the declaration.

## History reset

Existing TurnMutation.startTurn resets both players' records at the next global-turn boundary. Combat cleanup, return to MAIN and React completion preserve them. The strategic END_TURN regression resolves controller ordering and Delamain's ready choice with count1 still present, then proves the count becomes0 only on next startTurn. The legal replay reaches a later natural Goro attack that triggers again.

## ARASAKA classification query

RulesView.hasClassification delegates to a read-only immutable revision-tag check with exact stored value Arasaka. There is no runtime case-folding, display-name/slug parsing, deck-membership filter or trait-expression language. Swordwise Huscle has Merc, Corpo Security has Corpo, Emergency Atlus has Trauma Team/Vehicle/Zetatech, and Psycho Squad has NCPD. Their deck appearance never adds Arasaka.

## Effective Unit handling

Qualification uses effectiveCardTypes. Goro in FIELD has LEGEND + UNIT; its printed revision remains LEGEND. A face-up Legends-area Legend is not an effective Unit. No admitted printed demo Unit has the required Arasaka classification, so a clearly named, separately hashed synthetic printed Unit covers that case. Existing Psycho Squad and other real revisions are unchanged.

## Goro integration

The headline legally reveals Yorinobu, reveals Goro, pre-equips Dying Night, pays Go Solo, enters FIELD and attacks immediately through the existing Go Solo Lag exception. Goro qualifies on effective type and Arasaka metadata. Focused Mantis/Satori/Mandibular attachments leave classification unchanged. Goro's Blocker, owner-ordered defeat and REMOVED lifecycle preserve the history.

## Attack-trigger scheduling

A WHEN_UNIT_ATTACKS binding from the eligible face-up LEGENDS source joins the existing ATTACK batch. The origin retains the attacker; the binding retains Yorinobu as source/subject and its controller. Complete-batch validation rejects omitted/duplicated eligible sources as well as mismatched origins, hidden/field sources and wrong controller/history. Current admitted ATTACK primitives cannot remove or reveal those sources mid-batch.

Both controller orders are tested with Dying Night and Kiroshi. Once Yorinobu starts, its draw→condition→discard runs atomically before another pending effect. Satori is later fight-win timing; Floor It and Reboot remain later React. An isolated first-attack-only content bundle also preserves the older Swordwise conditional ATTACK draw without requiring Kiroshi to be present.

## Ordered draw/discard

The existing Evelyn ordered continuation now accepts either complete reviewed shape. DRAW1 changes state, then the second primitive tests current Street Cred and performs controller-chosen discard1. No Yorinobu-specific resolver, action or nested reaction window exists. The same effect ID remains current across both primitives. A focused Dying-first test decreases Street Cred20→19 before Yorinobu resolves and proves the condition was not snapshotted at declaration.

## Street Cred threshold / Null behavior

The typed condition STREET_CRED_LESS_THAN_VALUE(20) derives current rolled-Gig values. It is an absolute threshold, not a rival comparison or stored total. Focused19/20/21 cases cover both branches. No rolled Gigs means Null; rule5.11.4.2 orders Null below0, hence below20. A threshold0 query regression distinguishes that rule from incorrectly coercing Null to numeric0. Drawing from an empty deck produces the existing EMPTY_DRAW loss and skips the subsequent condition/discard.

## Discard choices

The controller discards their own card using DISCARD_CARDS / CONTROLLER / count1 / CHOSEN_BY_AFFECTED_PLAYER. A newly drawn card is eligible. Empty pre-draw hand yields a forced single-card discard without a training decision. Multiple cards pause at DISCARD_SELECTION with exact current own-hand options. Street Cred≥20 skips the discard without a fake choice. Stale/reordered options, rival submissions and forged continuation state are rejected.

## Observation

The additive public turnAttacks array exposes seat and arasakaUnitAttacks count, including when Yorinobu is down. It contains no first-attacker internals or hidden Legend identity. Both players see the same public history. Rival hand changes leave the chooser's observation/action IDs unchanged; Kiroshi knowledge remains viewer-specific. Model input remains observation plus enumerated legal actions.

## Events

Existing ATTACKER_SPENT, ATTACK_DECLARED, EFFECT_PENDING, TRIGGER_ORDER_SELECTED, CARD_MOVED, CONDITION_EVALUATED, CARD_DISCARDED and EFFECT_RESOLVED provide the audit trail. No Yorinobu-specific event or separate history-recorded event was added. Tests assert declaration before pending discovery, draw before condition, discard before effect completion, and all ATTACK effects before React.

## Training positions

The new family captures49 authoritative actions and48 genuine multiple-option TrainingPositions. Decisions include blind CALL/payment, Gear target/payment, Go Solo/payment, attack, trigger order, chosen discard, React and combat choices. History recording, single-option discard and automatic clauses do not create artificial decisions. Authoritative snapshots/seeds remain outside modelInput. These are deterministic engine-generated fixtures, not human gold.

## Hash behavior

POSITION_V2 includes the complete semantic history. Identical boards with consumed versus unconsumed history have different position hashes; both public observation hashes differ. Action IDs can therefore change with public history. Match version/event sequence and pending causedBySequence remain transport-only for position/observation/action identity. Replay-state hashing retains transport state for exact audit. FIRST_ATTACK_HISTORY_V1 independently selects observation-derived action IDs even without field-Legend/private-look/ordered/end-turn/delayed card scopes.

## Demo coverage

Measured directly from unchanged row quantities:

| Metric | Before | After |
|---|---:|---:|
| Distinct reference cards |29|29|
| Executable distinct |21|22|
| Blocked distinct |8|7|
| Arasaka distinct |6/14|7/14|
| Arasaka copies |15/30|16/30|
| Merc distinct |15/15|15/15|
| Merc copies |30/30|30/30|
| Combined copies |45/60|46/60|

Only Yorinobu's one real Legend copy changes admission. The executable test bundle has46 revisions:43 preserved prior revisions, Yorinobu and two explicit synthetic support revisions. This is separate from npm run validate:cards, which intentionally validates the original four bootstrap fixture records; that command does not count demo execution coverage or Mongo collection contents.

## Remaining Arasaka blockers

Seven exact remaining cards,14 physical copies:

| Card | Copies | Required review/primitive |
|---|---:|---|
| Saburo Arasaka — Stubborn Patriarch |1| Continuous +1 power aura for friendly Arasaka effective Units throughout attacking, including Fight/Steal |
| Minotaur |1| Street Cred comparison and targeted defeat |
| Industrial Assembly |3| Up-to4 Gig increase and conditional draw |
| Over the Edge |2| D20 value target filter and defeat |
| Field Operator |3| Even Street Cred condition on play |
| Goro Takemura — Losing His Way |1| All friendly Legends face-up condition and +5 until end of turn on ATTACK |
| Corporate Surveillance |3| Cost-filtered rival Unit spending |

Read-only Saburo review covered its complete six-printing capture, no applicable errata and current card FAQ. Local SHA25672d450459d340c1088b3713701d80bec7c289a98258aa491e0b946824af649b2. Legend, Green RAM2, sellable, Arasaka/Corpo, Null cost/power, no Go Solo. Full text: “Friendly ARASAKA Units have +1 power while attacking.” followed by the reminder “(Units steal an extra Gig for every 10 power.)” Demo009 printing13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca. It remains unadmitted.

## Merc coverage

Individual card execution remains complete within existing scopes:15/15 distinct and30/30 copies. Psycho Squad remains three physical copies. Existing limitations such as one outstanding Reboot prevention remain. Yorinobu does not change Merc cards or admit an exact demo match.

## Demo-format readiness

Both physical reference decks remain27 main +3 Legends =30 total. Neither initializes under official constructed. No DEMO_STARTER, padding, new teaching format or full deterministic demo match was added. Engine-generated headline decks are explicitly constructed-size synthetic support decks.

## Constructed validation

Official constructed remains40–50 main, exactly3 Legends, existing RAM and copy limits. Legend uniqueness uses deckbuilding identity, preventing duplicate Yorinobu for the same owner. Both construction and malformed physical duplication tests reject it; rival players may each have their own copy. Tests preserve wrong-size, wrong-Legend-count, missing-RAM and extra-copy rejection. All43 earlier immutable content revisions remain byte-equivalent as normalized data.

## Replays

New family: [yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json), deterministic seed yorinobu-24.49 actions,48 positions,209 events, final turn7 MAIN. Setup and legal actions only; CALL selects fixed public slots1/2, with no hidden identity search, state patches or RNG patches. The replay naturally reaches first attacks on two own turns with intervening global resets. Same-turn repeat attack is explicitly trusted focused coverage because no repeat-ready card is admitted.

All19 generator scripts were run. Existing22 families and wire goldens were repinned to the new artifact; this added one family, not multiple variant families.

## Original payload compatibility

The reusable audit consumed all22 original payload files preserved before edits, including the previous Goro family. It replayed all723 original decisions under new pins and compared semantic legal actions/descriptors, observations, event batches and initial/final states. Result: PASS. This compares preserved payloads, not merely newly generated fixtures. Transport/artifact-derived action/hash pins are the expected changes; old ruleset scopes receive no new history/observation field.

## Persistence

Mongo integration publishes the complete immutable Yorinobu revision, reads it identically and verifies repeat publish returns REPLAY alongside existing conflict/history/index tests.

PostgreSQL reloads every boundary of the legal49-action trace: before declaration, first history, pending DRAW/order, post-draw discard choice, effect completion, React/combat, global reset and later qualifying attack. Each command is submitted against the reloaded state; comparisons include exact state, replay/position hashes, both observations and observation hashes, legal actions, transition events and accumulated event history.

A separate labeled trusted bootstrap persists count1 plus a ready repeat attacker, then executes and reloads the second same-turn attack (count2, no Yorinobu trigger), combat and next-turn reset. Bootstrap transport counters restart at0, following the existing isolated persistence-fixture convention; the legal headline is never patched. Local tests use randomized Mongo database/Postgres schema and clean only those isolated resources. No application persistence implementation, migration or shared development card collection was modified.

## Python/wire

One harness edit: append yorinobu-replay to the generic adapter test's family tuple. Python contains no Arasaka, first-attack, Yorinobu effect, Street Cred or discard logic. It delegates to the headless Node engine over the existing JSONL/action-ID boundary, with no Next.js/Apollo/database dependency.

Wire staysv1. Request/response/TrainingPosition schemas were regenerated additively for the new scope, trigger, condition, optional state history and public observation. TrainingAttempt schema is byte-unchanged. The final adapter run passes23 families/772 actions and7 golden round trips; the preserved human gold/evaluation/training corpus is unchanged. No model download or training.

## Tests

86 focused Yorinobu tests pass, including the standalone-policy regression. All584 application tests, build/typecheck/lint/card-validation/schema/compatibility/database gates and all three Python commands pass; exact outcomes are recorded in Commands. Existing Goro/V and all prior mechanics remain in the full suite. Diagnostic iterations corrected trusted fixture Gig placement, printed-Unit ownership setup, trigger-order API typing and END_TURN ordering expectations; final engine review additionally removed the accidental dependency on other scopes for legacy ATTACK execution/private action IDs.

## Commands

Commands below were run with the pinned runtime. All final gate processes exited0. Logs were captured under /tmp/tcg-yorinobu-*.log; this report retains the exact invocations and outcomes.

```bash
cd /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
```

| Command | Final result |
|---|---|
| node -v | v22.13.0 |
| npm -v | 10.9.2 |
| npm run typecheck | PASS; GraphQL generation, core and web TypeScript |
| npm run lint | PASS; no warnings |
| npm run validate:cards | PASS;4 original bootstrap records |
| npm test | PASS;584/584, including86 new focused Yorinobu tests |
| npm run build | PASS; Next.js compilation, types and prerendering; /api/graphql retained |
| npm run contracts:export | PASS; three additive schemas changed; TrainingAttempt unchanged |
| git diff --check | PASS; no whitespace errors |

All replay/golden generators were run sequentially via python3 /tmp/tcg-yorinobu-generate.py. That temporary driver executes these exact commands and checks each exit code:

```bash
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-delayed-effects-replay.ts
node --import tsx scripts/generate-end-turn-history-replay.ts
node --import tsx scripts/generate-field-legends-replay.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-goro-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-yorinobu-replay.ts
```

Result:19/19 generator invocations passed;23 replay families plus the existing wire golden are current under the final artifact. The new replay is49 actions/48 positions/209 events.

```bash
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-yorinobu-before/replays
```

PASS:22 original families,723 original decisions; exact original semantic actions/descriptors, observations, event batches and initial/final states retained under new pins.

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
```

PASS:2/2 live tests,0 skipped. Mongo immutable publication/replay and PostgreSQL ledger/history/reload/rollback tests include Yorinobu; randomized test database/schema cleanup completed. The existing local infrastructure was used.

```bash
cd /Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

PASS: adapter23 replay families/772 Node-authoritative actions,7 golden round trips, model-input/action submission/stale rejection/invalid-envelope checks; game87/87; harness core48/48. Adapter reports the two existing Python-only differential gaps repeated-entry-copy-bypass and legend-in-main. No training or model download. Harness diff check passed.

Focused development command: node --import tsx --test tests/yorinobu.test.ts. Final focused run passed86/86. Early diagnostic failures were corrected and superseded by the full final584-test pass. Final artifact verification was repeated after the independent-policy fix; no required gate was left on the earlier artifact.


## Files changed

Compared with the preserved pre-Yorinobu working tree: **60 application files and1 harness file**. This excludes unrelated pre-existing Goro work that remained byte-unchanged. The four bootstrap cards, all43 prior normalized revisions, earlier source/rule fixtures, Goro tests/report, TrainingAttempt schema and503 other harness files are preserved. No file deletions, commits, staging actions or pushes. The harness already had291 index-status entries before this milestone; they match the preserved baseline exactly and were not altered.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Admit Yorinobu row, recompute unchanged-list coverage, and recommend separate Saburo aura review. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Document complete Yorinobu shape, hashes/printings, reviewed rules, history and limitations. |
| [docs/yorinobu-first-attack-report.md](../docs/yorinobu-first-attack-report.md) | Required35-section source, implementation, verification and file inventory report. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add narrow FIRST_ATTACK_HISTORY_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add strict first-attacker summaries and WHEN_UNIT_ATTACKS trigger binding vocabulary. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add first-friendly-Arasaka guard, trigger vocabulary and nonnegative absolute Street Cred threshold. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add explicit optional first-attack history policy. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Read exact immutable classifications without display/name/deck inference. |
| [packages/engine/src/combat.ts](../packages/engine/src/combat.ts) | Record qualifying history after committed declaration and enter the shared trigger scheduler. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Derive current Street Cred less-than-value including below-zero Null ordering. |
| [packages/engine/src/effect-support.ts](../packages/engine/src/effect-support.ts) | Admit complete Yorinobu shape for CALL without creating field entry. |
| [packages/engine/src/first-attack-history.ts](../packages/engine/src/first-attack-history.ts) | Initialize, record, query and validate per-controller/global-turn first-attack history. |
| [packages/engine/src/first-attack-support.ts](../packages/engine/src/first-attack-support.ts) | Validate full reviewed Legend metadata, scope and unique legal Legends-area source. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Make the first-attack policy independently use private observation-derived action IDs. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Initialize enabled history and reject unsupported/malformed metadata before setup. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Add minimal public per-seat qualifying-attack count projection. |
| [packages/engine/src/ordered-effects-support.ts](../packages/engine/src/ordered-effects-support.ts) | Share the reviewed two-primitive ordered chain with Yorinobu. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Integrate strict first-attack metadata/history validation. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | Discover eligible Legends-area first-attack sources alongside attacker/inherited effects. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | Reuse the ordered DRAW→conditional DISCARD continuation for either admitted source shape. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | Validate first-attack origins/source/history, primitive continuation and complete captured batch. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | Admit the new reviewed trigger source and preserve legacy ATTACK behavior independently of Kiroshi. |
| [packages/engine/src/turn.ts](../packages/engine/src/turn.ts) | Reset both first-attack counters only at existing global startTurn. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose the read-only classification query through RulesView. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive content/state/request vocabulary. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive state/observation response vocabulary. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive authoritative history and model observation vocabulary. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Advance engine version to0.4.0-first-attack-history-1; source-derived artifact hashing retained. |
| [scripts/generate-yorinobu-replay.ts](../scripts/generate-yorinobu-replay.ts) | Generate the one new deterministic replay family. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate artifact/action/hash pins; preserved original semantic payloads pass compatibility audit. |
| [tests/fixtures/yorinobu-card-source.v1.json](../tests/fixtures/yorinobu-card-source.v1.json) | Pin complete card capture, six printings, four errata and focused current-source comparison. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | New legal49-action/48-position/209-event replay under final artifact. |
| [tests/fixtures/yorinobu-rules.v1.json](../tests/fixtures/yorinobu-rules.v1.json) | Pin252 reviewed local rule nodes and focused Yorinobu/Saburo FAQ evidence/hashes. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Add immutable Mongo publish/read plus complete legal and trusted-repeat PostgreSQL reload coverage. |
| [tests/yorinobu-fixture.ts](../tests/yorinobu-fixture.ts) | Normalize real Yorinobu and explicit synthetic support; preserve43 prior revisions and constructed decks. |
| [tests/yorinobu-focused.ts](../tests/yorinobu-focused.ts) | Label and centralize trusted test preparations, declaration and combat helpers. |
| [tests/yorinobu-replay.ts](../tests/yorinobu-replay.ts) | Build the legal setup/CALL/pre-equip/GoSolo/attack/ordered-discard/reset trace without patches. |
| [tests/yorinobu.test.ts](../tests/yorinobu.test.ts) | 86 focused source/history/interaction/validation/privacy/wire/format regressions. |

| Harness file | Change |
|---|---|
| [scripts/test_engine_adapter.py](../../tcg_ai_training/cyberpunk_llm/scripts/test_engine_adapter.py) | Append exactly one replay family name; no Python gameplay logic. |


## Unsupported mechanics

Saburo admission, Losing His Way, the other five remaining Arasaka cards, Faceplate/WHEN_SPENT, arbitrary trait/first-event DSLs, control changes, new off-turn attack actions, return-to-LEGENDS mechanics, overtime, DEMO_STARTER and full demo matches remain outside this pass. The per-controller history is global-turn scoped and does not assume the first occurrence belongs to the active player; currently admitted attack actions still require the active player's MAIN.

Existing Python-only differential gaps repeated-entry-copy-bypass and legend-in-main remain reported by the adapter. They do not change the Node-authoritative action boundary. The project package version and original four bootstrap validation fixtures are unchanged.

## Ambiguities not guessed

Arasaka deck membership was not treated as a classification; Swordwise was checked and found nonqualifying. No printed Arasaka demo Unit was invented or admitted. Null is compared using the reviewed below-zero ordering. Duplicate sources are constrained by existing constructed identity rules. Yorinobu's Null cost/power does not imply field play or zero power. Future off-turn attacks and control-change history require separate review; no rules for them were fabricated. Validation retains removed physical objects because the current engine's removal moves them to REMOVED rather than deleting their identity.

Saburo's complete source and Fight/Steal FAQ were reviewed without adding its aura. No uncertainty was resolved by changing real revisions, source captures, deck quantities or human gold data.

## Recommended next milestone

**Saburo Arasaka — Stubborn Patriarch**, as a separate complete-shape admission: continuous +1 power while a friendly Arasaka effective Unit is attacking, through Fight/Steal and ending with the attack. Reuse the read-only classification and effective-type queries; review aura/source eligibility and whole-attack lifetime separately. Keep Losing His Way's all-Legends condition/+5-turn modifier for another pass.
