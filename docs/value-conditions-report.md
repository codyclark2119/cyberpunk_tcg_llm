# Industrial Assembly + Field Operator: current value conditions

## Runtime

Implemented and fully admitted Industrial Assembly and Field Operator under the bounded VALUE_CONDITIONS_V1 scope. Review date:2026-09-09. Actual starting application HEAD was **5e84e25** (the completed Saburo milestone); harness HEAD was **542c3d1**. The untouched working-tree snapshot, rather than an older conversation's HEAD, supplied the comparison baseline.

Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine **0.4.0-value-conditions-1**; artifact SHA-256 **177d578f6050976edd5c63035f38c62b33803577ab11e705798426e4b6ea41b6**. All work remains uncommitted and unstaged by this milestone; neither repository was pushed.

## Industrial Assembly full shape

CardId **industrial-assembly**, immutable revision **1**, source UUID **a708461f-1f91-4789-bb0d-96e3de5fcf44**, Arasaka Demo006 printing **7f0ad31f-3b16-4c7a-88bb-90dd07e55a9b**. Program, Red RAM1, cost1, Null power, sellable, Arasaka/Braindance; no flavor, reminder, raw keywords or other executable text.

> Increase a Gig by up to 4. If you control a Gig with 8+ value, draw 1.

All6 printings and all4 captured errata were read. Neither card has an applicable erratum. Complete printing metadata and raw/live/canonical/revision hashes are in [executable coverage](executable-card-coverage.md#value_conditions_v1--industrial-assembly) and [source fixture](../tests/fixtures/value-conditions-card-sources.v1.json). Canonical record hash:98727e3e220b956ad60bc6f4a733338aec35130f9c3475e6a75e97ee0b66e7ed; revision hash:cbc4120d7240adda62924f6d40e026ba344b1ba51260ca6233c770b54756a043.

The admission predicate checks the complete printed metadata, exactly one costless WHEN_PLAYED ability and its two effects in order. Missing direction, wrong maximum/count/order/condition, extra mechanics and an old execution scope all fail closed.

## Field Operator full shape

CardId **field-operator**, immutable revision **1**, source UUID **4a8dfe3f-980d-4370-ac10-6bd989042cdf**, Arasaka Demo012 printing **45ae40b9-f0f3-4fd9-901a-cd1bed292133**. Unit, Green RAM2, cost3, power2, unsellable, Arasaka/Corpo/Techie; no flavor, reminder, raw keywords or additional rules text.

> {Play} If your ☆ (Street Cred) is an even number, draw 1.

All5 Common/Michal Ivan printings are retained in the same [source fixture](../tests/fixtures/value-conditions-card-sources.v1.json), with full hashes in [coverage](executable-card-coverage.md#value_conditions_v1--field-operator). Canonical record hash:688d1d85f655f59c58d9b31af5014cbbe19f03e2d62e90c2f76d1a60135227cc; revision hash:deac3246957f78b89ce4c0740af50d9b4f52d1be78c03a24f1bd2b66d4f1ddbc. The complete Unit metadata and single WHEN_PLAYED/CONDITIONAL_DRAW shape are required. PLAY is a timing trigger, not a separate activated action.

## Rules/FAQ reviewed

[value-conditions-rules.v1.json](../tests/fixtures/value-conditions-rules.v1.json) pins **183 exact local rule nodes**, raw/processed rules and errata hashes, and **3 focused official FAQ records**. Rules reviewed include2.3/2.4 (order/as much as possible),2.8 (zero),2.10.2 (Null),4.6–4.7 (Unit entry/Lag),4.13–4.14 (Program resolution),5.10.3/5.11.4 (Fixer dice/Gig area/Null),6.1/6.3/6.4 (current values, face bounds and adjustment),10.1–10.3 (single ability, sequencing, conditional timing),10.6/10.31 (impossible effects/choices),11.2 (Street Cred),11.5 (draw/empty loss) and11.20 (PLAY).

Industrial FAQ ad3b75f8-1401-485f-891d-7e54fdbfe30f permits zero without an adjustment occurrence;2f4ce47f-25ba-4321-a673-809fc8f75bd7 permits rival Gigs. Field Operator FAQ e83fc5f6-3649-4162-9415-f1ff3fde56ed says zero does not count as even. All three are published2026-09-04T22:57:19.946Z in the [official FAQ response](https://api.netdeck.gg/api/faqs/cyberpunk).

Fresh narrow official card responses agree with local gameplay fields and all printing identities. Parsed [live comprehensive rules](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) exactly equal the local raw snapshot. No broad corpus refresh. All4 raw/processed errata were inspected: Johnny Sell, Kiroshi Equip, Nocturne artist and Judy artist; neither new card is affected. These are implementation-reviewed fixtures, not human-certified gold.

## Industrial target semantics

The first effect targets **ANY eligible rolled Gig** in the canonical GIGS registry, including a rival-controlled Gig. Unrolled/Fixer dice are excluded. Multiple candidates produce real TARGET_SELECTION. One candidate resolves internally; no candidate skips adjustment and continues to the later condition. Target relationship does not alter the second clause's controller relationship.

## Industrial up-to4 semantics

The normalized effect reuses ADJUST_GIG_UP_TO with maximum4 and explicit INCREASE direction. Existing bidirectional maximum1 metadata retains its original protocol. Legal amounts are **0..min(4, dieMaximum−currentValue)**. Zero emits GIG_ADJUSTMENT_DECLINED and no GIG_VALUE_CHANGED; it neither changes Street Cred nor cancels the later clause. Multiple magnitudes produce AMOUNT_SELECTION. A forced zero resolves internally once, without a strategic training position.

## Gig bounds

All changes reuse the authoritative changeGigValue operation also used by earlier adjustments; no Industrial-specific arithmetic or event. Current face must remain1..die maximum: D4=4, D6=6, D8=8, D10=10, D12=12, D20=20. Requested illegal deltas fail rather than clamp.

| Die/current | Exact offered amounts |
|---|---|
| D4/4 | 0 (forced) |
| D4/3 | 0,1 |
| D6/4 | 0,1,2 |
| D8/5 | 0,1,2,3 |
| D10/3; D12/8 | 0,1,2,3,4 |
| D20/19 | 0,1 |
| D20/14 | 0,1,2,3,4 |

D20 focused fixtures respect the existing rule that the other five dice have rolled first; no roll-order rule was weakened.

## Industrial ordered effect

The existing Program lifecycle handles reveal, payment, resolving area, ordered effects and owner Trash. Its existing internal continuation runs adjustment followed by conditional draw. It is not routed through ATTACK or React. A small forced-choice continuation guard prevents synchronous target/amount resolution from advancing the outer chain twice. No new continuation schema, generic DSL or card-specific command is introduced. Externally supplied target, amount, current value, source, primitive order, condition or phase tampering is rejected atomically.

## Post-adjustment condition timing

Focused acceptance proves **6→8**, then true condition, then draw: GIG_VALUE_CHANGED precedes CONDITION_EVALUATED, which precedes the draw CARD_MOVED. The focused setup retains initialValue1 while currentValue changes6→8. No condition snapshot is captured at PLAY, target selection or payment. No other action/effect interleaves between the two clauses. Zero and missing-target branches still resolve the later clause; an empty draw ends the game and clears continuation state.

## Controlled-Gig threshold

Reuses GIG_VALUE_AT_LEAST through RulesView.hasControlledGigWithCurrentValueAtLeast. It queries any current controlled rolled Gig, including one different from the adjusted target and a stolen Gig whose owner remains the rival. Thresholds7=false,8=true,9+=true are covered. A rival Gig at8+ alone does not qualify. Owner, original roll and die maximum do not replace current controller/currentValue.

## Street Cred derivation

Current Street Cred comes from canonical controlled rolled-Gig values, so adjustment and control transfer change it immediately. No Street Cred/parity field is separately mutated or cached. RulesView.isStreetCredEven delegates to the shared typed condition.

Compatibility note: the older RulesView.getStreetCred numeric aggregate and public observation still display0 for an empty area. That legacy representation is preserved for original replay compatibility. The new parity condition explicitly inspects the nonempty set of rolled Gigs, so it never treats that display aggregate as numeric-even Street Cred.

## Field Operator PLAY timing

PLAY_CARD reveals and uses ordinary exact payment. The same physical Unit enters BATTLEFIELD READY with Lag before its WHEN_PLAYED effect is scheduled. Existing source admission allows this complete Unit shape into the PLAY scheduler; Industrial remains in the Program chain. Parity is evaluated during conditional effect resolution after payment/entry. Focused coverage changes trusted current values across the payment boundary to prove there is no initial-PLAY snapshot. After Lag clears the Unit uses ordinary attack eligibility.

## Even Street Cred condition

One bounded typed condition, STREET_CRED_IS_EVEN, evaluates a positive sum of currently controlled rolled-Gig values. It calls the existing draw primitive when true and does nothing when false. It adds no arbitrary modulo/comparison/boolean expression language, parity choice or draw action.

## Null parity behavior

An empty controlled rolled-Gig set has Null Street Cred and returns false. Null is not converted through JavaScript arithmetic. The focused null case also goes through actual Field Operator play/payment/resolution, proving that it causes no draw and no fake choice.

## Numeric parity

Legal totals2,4,8,10 are even;1,3,5,9 are odd. Current face bounds are positive, so numeric Street Cred0 cannot arise from a nonempty legal controlled-Gig set. A fabricated zero face is rejected; no illegal numeric-zero game state is used as evidence. The specific Field Operator FAQ's negative answer about zero is preserved without extrapolating rules for hypothetical future zero-generating mechanics.

## Industrial → Field Operator interaction

A focused actual8→9 Industrial increase changes even Street Cred to odd; Industrial still draws from its threshold, while the later Field Operator does not draw. The legal headline starts with current controlled D8=7 and D4=4, Street Cred11. Industrial chooses+1: D8=8, Street Cred12, then its own conditional draw succeeds. Later Field Operator observes12 and draws. A complete legal alternative chooses0, leaving total11; Industrial's threshold and Field Operator's parity both fail. Focused zero tests separately prove that an already qualifying controlled8+ Gig still allows Industrial's later draw.

## Stolen-Gig interaction

Focused states distinguish owner and current controller for both threshold and parity. An actual engine steal changes control before a later ordinary Field Operator PLAY; the new controller's total supplies parity. Another actual Industrial resolution draws from a currently controlled stolen8+ Gig while adjusting a different die. No owner-based lookup or cached total is used. Trusted focused setups are labeled separately from the unpatched headline.

## Afterparty/Jackie regression

Existing Afterparty−1/+1 options and Jackie's decrease change the same currentValue registry. Focused sequences execute their adjustment then a later Field Operator PLAY to check live parity. Jackie's Blue-play trigger path remains intact. Shared option/delta helpers preserve older signed choices, and all original Afterparty/Jackie/Dexter/Dying payloads are covered by the preserved-replay audit. No prior scope is upgraded to accept new up-to4/parity metadata.

## Observation

No observation fields are added. Both viewers already see public current Gig values and the derived numeric aggregate; neither needs a card-specific condition hint. Public value changes affect both observations. Hidden rival hand/Legend identities remain private, including when VALUE_CONDITIONS_V1 is enabled independently of later private-look/aura/history policies.

## Events

Reuses CARD_PLAYED, PAYMENT_MADE, CARD_MOVED, EFFECT_PENDING, GIG_TARGET_SELECTED, GIG_VALUE_CHANGED, GIG_ADJUSTMENT_DECLINED, CONDITION_EVALUATED, EFFECT_RESOLVED, trigger-order and phase events. A draw is the existing DECK→HAND movement. Field Operator false parity still evaluates the condition and resolves the effect; it emits no draw. Zero is not an adjustment occurrence. No card-specific event type is added.

## Training positions

Uses existing observation-derived legal action descriptors and semantic action IDs. Industrial's variable target and amount are meaningful decisions; amounts explicitly label increase and zero/no adjustment. Forced single choices and automatic conditional draws never become strategic positions. Field Operator contributes ordinary play/payment choices only. The headline contains22 strategic positions. No model download, training run, dataset promotion, gold edit or AI rule duplication occurred.

## Hash behavior

POSITION_V2 already includes current Gig values and full pending effect/continuation state. Public changes alter both observation hashes; transported match/player IDs and counters do not alter normalized positions/action IDs. New-scope action IDs independently use the entitled observation, protecting rival secrets. Tampered/stale choices fail.

Current engine artifact:177d578f6050976edd5c63035f38c62b33803577ab11e705798426e4b6ea41b6. Headline final replay-state hash:cbf3dac56eea008725624143e17fa4dcbd15f6ae4cbc3325339ec3f050e7c21b. Existing content/replay hashes and pins were regenerated; preserved semantic payloads were independently audited. No redundant parity hash input was added.

## Demo coverage

The actual29-row roadmap baseline was23 executable distinct cards and47 executable physical copies. Both complete admissions add2 distinct cards and6 copies, preserving every row/quantity.

| Metric | Before | After |
|---|---:|---:|
| All distinct | 23/29 | **25/29** |
| Arasaka distinct | 8/14 | **10/14** |
| Arasaka physical copies | 17/30 | **23/30** |
| Merc distinct | 15/15 | **15/15** |
| Merc physical copies | 30/30 | **30/30** |
| Combined physical copies | 47/60 | **53/60** |
| Blocked distinct/copies | 6/13 | **4/7** |

The content bundle preserves all47 old immutable revisions and adds exactly2 real revision1 records, for49 total. This bundle total includes existing synthetic support revisions and is distinct from demo-card coverage.

## Remaining Arasaka blockers

Complete local raw records and all printings were inspected read-only after implementation. No new executable revision was added for these cards.

| Card | Copies | Complete-shape blocker |
|---|---:|---|
| Minotaur | 1 | Red RAM2 Unit, cost7/power9, unsellable, Arasaka/Drone/Militech; PLAY own Street Cred>rival then defeat rival Unit with current power≤5. Needs conditional targeted defeat, current/Null filters and departure ordering. |
| Over the Edge | 2 | Red RAM2 Program, cost3/Null power, sellable, Merc; defeat **ANY Unit** with current power≤friendly d20 value. Needs current controlled-d20/Null semantics and targeted defeat. |
| Goro Takemura — Losing His Way | 1 | Green RAM3 printed Unit, cost4/power4, unsellable, Arasaka/Corpo; ATTACK all friendly Legends face-up then own+5 this turn. Needs all-Legends condition and bounded temporary-power lifetime. |
| Corporate Surveillance | 3 | Green RAM1 Program, cost2/Null power, sellable, Corpo; spend rival Unit with cost≤4. Needs effective-Unit/cost/Null filtering and spending eligibility. |

Their3/5/3/5 printings respectively do not supply a shortcut around a future focused FAQ/rules/full-shape review.

## Merc status

Merc remains15/15 distinct and30/30 physical copies within already reviewed scopes. Psycho Squad stays3 copies. Reboot's existing one-outstanding-prevention limitation remains. Individual execution coverage does not certify arbitrary combinations or exact teaching-list initialization.

## Demo-format readiness

Both physical lists remain exactly27 main+3 Legends. They still fail constructed initialization. No DEMO_STARTER policy, deck padding, teaching-format exception or complete demo match was introduced. Remaining Arasaka mechanics and a separate teaching-format rules review are still required.

## Constructed validation

Unchanged40–50 main cards, exactly3 Legends, reviewed RAM ceilings, copy limits and Legend identity rules. The legal replay uses42-main/3-Legend support decks with the existing actual Saburo/Goro/Yorinobu Legends. Three copies each of the new real cards replace existing synthetic filler slots;6 existing synthetic Gear filler revisions remain and no synthetic revision is added. An early attempt to include Afterparty was rejected by these Legends' Yellow RAM budget; it was removed from the headline, not made legal by weakening RAM rules.

## Replays

Added one family, **value-conditions-replay.v1.json**, generated from legal setup using seed **value-46**:22 actions,22 positions,97 events, final turn3 MAIN, empty continuation, Field Operator READY+Lag. The trace contains actual rolls, sells, payment, target selection, amount selection and both draws. No state/RNG/hand patches. A complete legal ODD alternative is exercised by application and PostgreSQL tests without adding a redundant stored family.

All21 generator scripts, including wire-golden generation, ran successfully. Total stored replay families are now25 with838 actions/decisions. Focused helpers may establish trusted edge states for rare bounds, steals, empty draws or payment timing; those are explicitly separate from headline reachability evidence.

## Original payload compatibility

Before any edit, all24 old replay JSONs were copied to /tmp/tcg-values-before/replays. The existing audit replayed those untouched originals under only updated engine/content pins. **24/24 families and816/816 original decisions passed**: initial/final states, initialization/per-action events, observations and semantic legal actions/descriptors match. Regenerated goldens alone were not used as compatibility evidence. Earlier immutable card revisions remain exactly equal.

## Persistence

Live MongoDB at127.0.0.1:27018 and PostgreSQL at127.0.0.1:5433 were used. Final **2/2 integration tests passed, zero skipped**, including the existing ledger/concurrency/rollback/history suite. Mongo publishes both complete immutable revisions, reads them exactly and verifies duplicate publication is replay.

PostgreSQL persists both legal EVEN and ODD traces from setup. Every transition resumes from reload and compares exact state, replay/position hash, both observations/observation hashes, legal actions and accumulated events. It round-trips target/amount pauses,7→8 versus zero/no-change, Industrial condition/draw, Field Operator payment/PLAY/parity and draw/no-draw, plus final Lag/MAIN. Tests use randomized databases/schemas and remove only their own data. No migration or production content seeding was performed.

The first live run found a test assertion wrongly requiring GIG_VALUE_CHANGED in the legal zero branch. The assertion now requires exactly1 change for EVEN,0 for ODD, and exactly1 decline for ODD. The final full live suite passed in79.4 seconds.

## Python/wire

Harness changes are exactly one appended replay-family name in scripts/test_engine_adapter.py. No Python mechanics, models, data formats, training logic or corpus files changed. All other503 baseline harness files and pre-existing index state are preserved.

Adapter verification passed25 families/838 Node-authoritative actions and7 golden round trips, plus model input, action submission, stale rejection and invalid envelopes. Cyberpunk suite:87 passed. Harness core:48 passed. Existing Python differential gaps remain repeated-entry-copy-bypass and legend-in-main; Node stays authoritative.

Wire protocol stays v1. Generated request, response and TrainingPosition schemas expand additively for the new bounded scope/policy/effect/condition wherever content or pending effects are represented. TrainingAttempt schema is byte-unchanged. Engine boundary remains domain/engine/wire JSON, with no Next.js/Apollo/database dependency introduced into the harness.

## Tests

**747 application tests passed, zero failed/skipped:644 preserved baseline tests plus103 new focused checks.** Typecheck and lint are clean; validate:cards passes4 legacy fixture records; production build and contract export pass. That4-record command does not count reviewed engine revisions or Mongo contents.

Focused coverage includes6→8 sequencing, any qualifying controlled Gig, rival target, zero/forced/no-target, exact D4–D20 sets, Null/even/odd, payment-time parity, actual control transfer, Afterparty/Jackie, ordinary Unit Lag/attack, both EMPTY_DRAW paths, malformed complete shapes/old scopes, external continuation corruption, atomic rejection, private information, observation/position/action hashes, wire/training and constructed invariants.

Initial development checks caught missing new-scope initialization admission, temporary type/import issues and two D20 test setups violating existing roll order. Those were corrected; the97-test focused rerun passed before5 further cases brought the suite to102; the final acceptance review added the inverse parity case, and all103 passed in the final full suite. Final live persistence correction is described above. No lint/build warnings remain.

## Commands

From the application root, runtime was selected with:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

| Exact command | Final result |
|---|---|
| `node -v` | v22.13.0; exit0 |
| `npm -v` | 10.9.2; exit0 |
| `npm run typecheck` | PASS; exit0 |
| `npm run lint` | PASS; exit0 |
| `npm run validate:cards` | PASS4 fixture records; exit0 |
| `npm test` | PASS747/747; exit0 |
| `npm run build` | PASS; exit0 |
| `npm run contracts:export` | PASS; exit0 |
| `node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-values-before/replays` | PASS24 families/816 decisions; exit0 |
| `git diff --check` | PASS; exit0 |

Every generator command below exited0:

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
node --import tsx scripts/generate-saburo-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-value-conditions-replay.ts
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-yorinobu-replay.ts
```

Focused development rerun: `node --import tsx --test tests/value-conditions.test.ts` passed97/97 before6 further cases were added; the final full suite passed all103 new cases. Live integration command, run twice (final2/2 passed, no skips):

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
```

From the harness root, each exited0:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

Typecheck, lint and npm test were repeated successfully after the final focused-test addition; git diff --check was repeated after documentation. Results:25 families/838 actions+7 goldens;87 game tests;48 core tests. Fresh source inspection used Python urllib for the two official card endpoints, FAQ response and comprehensive rules, with captures/hashes under /tmp/tcg-values-source. Runtime/generator/gate logs are under /tmp/tcg-values-*. No package installation, model download, training, staging, commit or push command was run.

## Files changed

Compared with the frozen307-file application working tree and504-file harness working tree: **47 modified + 10 new application files**, no removals; **1 modified harness file**, no additions/removals. Unrelated pre-existing changes and all291 staged harness entries are preserved; the application index remains unstaged. Regenerated artifacts are listed individually so they are not mistaken for new gameplay changes.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Update measured counts and read-only four-card blocker review without changing quantities. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Record both full shapes,11 printings, hashes, rules, semantics and limits. |
| [docs/value-conditions-report.md](../docs/value-conditions-report.md) | New: This required37-section milestone report and complete file/command inventory. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add the bounded execution-scope literal. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add typed parity condition and explicit bounded increase metadata. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add optional value-conditions policy. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Evaluate current controlled-Gig parity with explicit Null handling. |
| [packages/engine/src/gig-value.ts](../packages/engine/src/gig-value.ts) | Share exact option/delta enumeration; retain authoritative mutation/bounds. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Describe increase amounts and use private-safe semantic IDs for the isolated new policy. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Admit the complete new scope; reject unsupported deck-wide metadata. |
| [packages/engine/src/play-state.ts](../packages/engine/src/play-state.ts) | Validate exact current target/amount continuation; reject fabricated forced pauses. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Delegate new metadata to complete-shape validation. |
| [packages/engine/src/play.ts](../packages/engine/src/play.ts) | Resolve forced new choices internally and preserve atomic ordered advancement. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Reject new metadata with unsupported scope/policy, including hidden sources. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | Reuse exact shared adjustment options. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | Reuse shared signed/increase delta selection. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | Admit the reviewed Unit into the existing PLAY scheduler. |
| [packages/engine/src/value-conditions-support.ts](../packages/engine/src/value-conditions-support.ts) | New: New complete-shape predicates and fail-closed metadata validator. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose read-only current threshold/parity queries. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive v1 JSON Schema for bounded value metadata/conditions. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive v1 JSON Schema for bounded value metadata/conditions. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive v1 JSON Schema for bounded value metadata/conditions. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Set milestone engine version; source-derived artifact hash updates. |
| [scripts/generate-value-conditions-replay.ts](../scripts/generate-value-conditions-replay.ts) | New: Generate the new legal combined headline family. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/value-conditions-card-sources.v1.json](../tests/fixtures/value-conditions-card-sources.v1.json) | New: Pin both complete captures/all11 printings/all4 errata and narrow live checks. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | New: New legal22-action/22-position/97-event combined replay. |
| [tests/fixtures/value-conditions-rules.v1.json](../tests/fixtures/value-conditions-rules.v1.json) | New: Pin183 rule nodes,3 FAQs, source hashes and reviewed decisions. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate golden envelopes under the current engine/content pins. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerate existing family under current pins; original semantic payload independently preserved. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Publish/read both revisions and round-trip both complete legal traces. |
| [tests/value-conditions-fixture.ts](../tests/value-conditions-fixture.ts) | New: Normalize two immutable revisions; preserve all old content and legal support-deck limits. |
| [tests/value-conditions-focused.ts](../tests/value-conditions-focused.ts) | New: Clearly separated trusted focused-state helpers. |
| [tests/value-conditions-replay.ts](../tests/value-conditions-replay.ts) | New: Legal setup-to-MAIN EVEN/ODD trace builder without patches. |
| [tests/value-conditions.test.ts](../tests/value-conditions.test.ts) | New: 103 focused acceptance/regression/contract tests. |

Harness `cyberpunk_llm/scripts/test_engine_adapter.py`: append `value-conditions-replay` to the existing generic family list only. All other503 baseline harness files, including corpus/gold/eval/model assets, are byte-unchanged. TrainingAttempt schema and all prior immutable card/source/rules fixture files remain unchanged. Final SHA/file/index preservation checks compare with /tmp/tcg-values-before/baseline.json and the two saved porcelain status files, not with assumptions about clean Git trees.

## Unsupported mechanics

No admission for Minotaur, Over the Edge, Corporate Surveillance, Losing His Way, Zetatech Faceplate or WHEN_SPENT. No generic arithmetic/condition DSL, general control-transfer API, new teaching format or full demo match. Only the two complete reviewed shapes may use VALUE_CONDITIONS_V1. Earlier scope limitations remain, including overlapping Reboot prevention.

Technical debt retained deliberately: legacy numeric Street Cred display0 for an empty area; older adjustment protocols may retain single-option choices for original-payload compatibility; the Python differential validator has the two known gaps listed above. None supplies authority for new legal actions.

## Ambiguities not guessed

Exact Industrial wording allows any controlled Gig to satisfy its second clause, and the official FAQ confirms rival targeting and zero. Null is nonnumeric; numeric-zero Street Cred is not a legal positive-face state. No hypothetical future zero mechanic is inferred. Industrial's Dudar/Duder artist spellings are preserved across printings without silently correcting the source.

The two full card shapes have no unresolved gameplay ambiguity under the pinned review. The remaining four cards require their own focused FAQ/rules review before implementation. Teaching-list format legality and general control-transfer behavior were not inferred from execution coverage. No model data was promoted to gold.

## Recommended next milestone

Review and implement **Minotaur + Over the Edge** as two complete cards sharing the smallest targeted-defeat operation. Preserve different RIVAL/ANY selectors, PLAY/Program timing, current effective-power filtering, current controlled d20 values, Null-aware Street Cred comparisons, invalid/no-target/forced-target semantics and complete defeat/Gear/field-Legend departure ordering.

Corporate Surveillance should follow with cost-filtered spending. Losing His Way should remain its own all-friendly-Legends/temporary-power milestone. Keep each admission full-shape reviewed and preserve the current replay corpus and constructed rules.
