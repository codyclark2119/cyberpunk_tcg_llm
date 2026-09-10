# Minotaur + Over the Edge — targeted defeat report

Implementation review: 2026-09-09. Exactly two complete revisions admitted.

## Runtime

Node22.13.0 (the pinned22.x runtime), npm10.9.2, application0.3.0 and Next.js16.3.4. Engine **0.4.0-targeted-defeat-1**, artifact **29e1a705b37a9543c914ffbacf900c93e034351179a79d1ce53bcb1425d76c0a**. Application baseline HEAD52914b0 was clean; harness HEAD542c3d1 had291 pre-existing staged entries. No commit, push or staging was performed. App code remains framework/database independent; Python receives only two replay names.

## Minotaur exact full shape

Immutable application CardId **minotaur**, revision **1**, execution **SUPPORTED / TARGETED_DEFEAT_V1**. Complete captured text:

> {Play} If you have more ☆ (Street Cred) than a Rival, defeat a rival Unit with power 5 or less.

Unit, Red RAM2, cost7, power9, unsellable, classifications Arasaka / Drone / Militech. No additional executable clauses, raw keywords, subname, flavor text or reminder text. PLAY markup on Minotaur normalizes to WHEN_PLAYED; the Program uses its existing WHEN_PLAYED effect metadata without becoming a Unit trigger. All captured printings were reviewed, including rarity, artist, set, number and image references. No applicable captured erratum.

| Printing UUID | Set | Number | Rarity | Artist |
|---|---|---|---|---|
| 19587d4f-6d47-44fe-b4da-99743e2742f7 | embracingpowerretailstarterdeck | 003 | Uncommon | CD Projekt Red |
| a8dd2d7b-88b8-4b15-b4dd-e3aa3757bb25 | embracingpowerbetastarterdeck | β003 | Uncommon | CD Projekt Red |
| 6e023192-0834-4d6f-935a-e5d6d4d6eff0 | arasakademodeck | 002 | Uncommon | CD Projekt Red |

Source UUID: **066641c5-acc2-45f4-ba67-16a8d20cce73**. Local raw-byte SHA-256: **84df69b3fffeb73e7a26d6db8ec1975fbab70ff46de48c5d6186ee4069ddd18c**. Canonical captured-record hash: **b04720d22b6dc916ddf6175cae97a284635b9a8ab63eaadb910c7cc1edc98c83**. Immutable normalized revision hash: **eaa4cd993d6614f334b87970195d77f837ef8cf5602c932328c521427ef77b62**. [Narrow official source check](https://api.netdeck.gg/api/cards/cyberpunk/minotaur) SHA-256: **0848801c56b8b78e22162ca90219c95f0bac6a0bf3d2a9421a3fad67e0673468**. All gameplay fields and printing identities agree with the local capture. The retail starter Over the Edge collector number is exactly `10`; it has not been padded to `010`.

Complete records and all four captured errata: [targeted-defeat-card-sources.v1.json](../tests/fixtures/targeted-defeat-card-sources.v1.json). Explicit normalization: [targeted-defeat-fixture.ts](../tests/targeted-defeat-fixture.ts). This is implementation review, not human-certified gold. No corpus refresh.


## Over the Edge exact full shape

Immutable application CardId **over-the-edge**, revision **1**, execution **SUPPORTED / TARGETED_DEFEAT_V1**. Complete captured text:

> Defeat a Unit with power equal to or less than the value of a friendly d20.

Program, Red RAM2, cost3, powerNull, sellable, classifications Merc. No additional executable clauses, raw keywords, subname, flavor text or reminder text. PLAY markup on Minotaur normalizes to WHEN_PLAYED; the Program uses its existing WHEN_PLAYED effect metadata without becoming a Unit trigger. All captured printings were reviewed, including rarity, artist, set, number and image references. No applicable captured erratum.

| Printing UUID | Set | Number | Rarity | Artist |
|---|---|---|---|---|
| f1cf4133-45ef-4de5-abfc-757de1613731 | welcometonightcityretail | 034 | Common | Roberto Ricci |
| 6213bf57-92d7-4a64-8d80-948ba53b8d80 | welcometonightcitybeta | β034 | Common | Roberto Ricci |
| 9e5a152e-6105-44a4-8db0-9cbf6cda2252 | embracingpowerretailstarterdeck | 10 | Common | Roberto Ricci |
| de9b7361-6d1c-4a27-bcfb-50ec7a78e518 | embracingpowerbetastarterdeck | β010 | Common | Roberto Ricci |
| cf48d5e6-21d2-4d17-a731-5dc9091c6cd1 | arasakademodeck | 007 | Common | Roberto Ricci |

Source UUID: **144c3559-3518-4c01-b9e6-af42b7166661**. Local raw-byte SHA-256: **86803baacbdccd9ab6395321b3b5a814fccd510c7421a612bf655a68cb62205c**. Canonical captured-record hash: **6106fd2f01f12f873ad05d05d468885cb9b1d3cb752b8b67753fef2bee4d48cc**. Immutable normalized revision hash: **c76eff1582840113ee3a87c61fd2742137e33664c4e28c92f24caf1180e4bd26**. [Narrow official source check](https://api.netdeck.gg/api/cards/cyberpunk/over-the-edge) SHA-256: **aadc165a75fce928dc0538ee0090ad82cca6d6eaa2b5a087780bd74815118cf6**. All gameplay fields and printing identities agree with the local capture. The retail starter Over the Edge collector number is exactly `10`; it has not been padded to `010`.

Complete records and all four captured errata: [targeted-defeat-card-sources.v1.json](../tests/fixtures/targeted-defeat-card-sources.v1.json). Explicit normalization: [targeted-defeat-fixture.ts](../tests/targeted-defeat-fixture.ts). This is implementation review, not human-certified gold. No corpus refresh.


## Rules/FAQ reviewed

[Pinned rule fixture](../tests/fixtures/targeted-defeat-rules.v1.json) contains287 exact rule nodes and8 complete FAQ records. Reviewed topics include2.10 numbers/Null,3.17 effective power,4.4/4.12 field Legends,4.14 immediate Program Trash,5.3.2.2 public modifier lifetime,5.9.4.1 owner Trash ordering,5.10/5.11 Fixer/Street Cred,6.1 friendly/current control,6.3 current Gig faces,9.19 defeat,10.2/10.13/10.14 resolution/pending priority and11.19.2 post-movement DEFEATED pending creation. Sources: [official rules](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) and [official FAQs](https://api.netdeck.gg/api/faqs/cyberpunk).

Minotaur FAQs a6bfa127… and1528eec2… explicitly allow play without Street Cred advantage and require defeat when possible. Over the Edge FAQs3aec4fa6…,6b61f796… and00b41165… explicitly prohibit a power0 target without D20, allow own targets and allow play without D20. Related FAQd05760ef… concerns prevented defeat,91373c98… confirms Gear remains in Trash when its host moves afterward, and881c635b… confirms Dying Night's retained end-turn work after defeat. Related examples do not admit The Relic or broaden prevention.

All four captured errata were read in raw CMS and processed forms: Johnny's sell tag, Kiroshi's equip reminder, Nocturne's artist and Judy's artist. None affects these two cards. Narrow live checks found identical gameplay/printing identities and exactly equal parsed rules; downloaded responses stayed in temporary storage.

| Source bytes | SHA-256 |
|---|---|
| sha256 | 054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd |
| processedSha256 | 1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19 |
| errataSha256 | 1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75 |
| processedErrataSha256 | 16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340 |
| liveRulesSha256 | b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a |
| faqSha256 | 53a27c831fe04a8a144b0090185b7878b40d0d53e8dfae0442490f7708050ecb |


## Targeted defeat architecture

DEFEAT_UNIT is an effect primitive, never a direct player action. Existing TargetRelationshipSchema is shared by old and new selectors: CONTROLLED, RIVAL, ANY. The bounded selector has either AT_MOST5 or CONTROLLED_GIG_VALUE(D20), with no expression DSL. Minotaur's existing STREET_CRED_GREATER_THAN_RIVAL condition is separate from targeting. Runtime dispatch has no card-name branches. Full-shape predicates in targeted-defeat-support.ts admit exactly the reviewed Unit/Program metadata, reject extra/missing clauses and reject new metadata hidden under old scopes. Initialization and state validation inspect all physical revisions, including private areas.

RulesView exposes listDefeatableUnits and getControlledD20Values; the underlying query uses the exact shared effectivePower implementation without recursively validating a pending choice. Target/order state stores only a phase marker plus the existing choice and defeat instructions/order prefix. No copied threshold or second cached candidate array is stored.

## Semantic defeat reuse

Target validation delegates to existing defeatSupport. After target selection the existing defeatOrderChoice/unfinishedDefeatOrder machinery constructs the owner's full order. The handler calls **the same defeatCards operation as combat**, which checks all instructions, captures active-source bindings, emits defeat facts, calls shared processDeparture and returns captured DEFEATED bindings after movement. defeat.ts and card-movement.ts need no card-specific branch or rewrite.

## Minotaur Street Cred condition

Ordinary Unit play/payment enters BATTLEFIELD READY+Lag, then its pending PLAY ability evaluates current controlled rolled-Gig Street Cred. Six numeric/Null/equality cases run through real PLAY. Focused tests change the condition in both directions during payment and transfer a Gig before play; no condition result is stored at declaration. False condition emits CONDITION_EVALUATED(false), skips target/defeat and completes Unit play.

## Minotaur Null behavior

Existing comparison semantics make numeric >Null true, Null >numeric false and Null >Null false. Equal numeric totals are false. No JavaScript coercion is used. The tests construct legal empty-Gig areas to represent Null; they do not create impossible zero-valued Gig faces.

## Minotaur rival-only targeting

Current controller defines RIVAL. Friendly low-power Units are excluded even alongside eligible rival Units. A true condition with zero eligible targets resolves without a choice or rollback. One target is forced internally. Multiple targets create mandatory target choices for the source controller; the rival has no source-target action and PASS/decline is absent.

## Minotaur power≤5 filtering

Real admitted Units prove current powers4/5 qualify and6 fails. Floor It makes printed6 reference5 and eligible; Mantis makes printed5 current7 and ineligible. Target choices and selected targets awaiting owner order are regenerated/validated against current characteristics; targets that leave, change control or exceed the threshold reject before mutation.

## Over the Edge ANY-unit targeting

ANY includes both players' eligible effective Units. A focused same-choice case contains friendly Corpo Security and rival Emergency Atlus; both are selectable. The legal headline also includes friendly Field Operator alongside rival Dexter and Swordwise. The Program uses the same current-power query as Minotaur with a different relationship and threshold source.

## Friendly self-target support

Choosing a friendly ordinary Unit actually defeats it through shared semantic movement. Self-defeated Dexter performs his existing DEFEATED draw. Friendly field Goro and V can be chosen, take Gear through owner Trash ordering and then enter Removed; Gear stays Trash. The source/effect controller does not change the target's owner destination.

## D20 control/die-type semantics

A qualifying object is a currently controlled, rolled Gig in GIGS whose dieType is D20. D12 with value12 is not D20. Unrolled Fixer D20 and a rival-controlled D20 do not qualify. Existing transferGigs provides the trusted stolen-D20 focused arrangement; ownership remains rival while control and threshold contribution change.

## Current D20 value

The query uses currentValue. An initial roll20 with current3 does not allow a power4 target; current4 does. The headline's D20 is legally rolled6, never injected. Public current-face changes invalidate old observation-bound action IDs. No value is snapshotted at Program declaration.

## D20 absence/multiple D20 behavior

No controlled rolled D20 yields an empty value set, not0 or20. The Program still plays/pays/trashes, but even power0 is ineligible, as the card FAQ states. With two current controlled D20s valued2 and9, a power7 target qualifies through the9. The existential comparison follows “a friendly d20”; the effect does not instruct a separate Gig selection. Multiple-D20 coverage is a labeled trusted arrangement, not claimed as the headline's natural history.

## Current effective-power filtering

Power is derived through the shared characteristics pipeline: printed power, attached Gear, current attacking aura, temporary power and prior reviewed sources all participate. 2.10.1 references a negative result as0 without altering that result. Null is explicitly excluded from numeric comparison. Every admitted effective field Unit has numeric power; no unsupported Null-power Unit is fabricated.

## Floor It / Gear / Saburo interactions

Besides Minotaur's6→5 and5→7 crossings, Over the Edge at D20=7 rejects current8, accepts6/7, then accepts8−Floor It1. Additive Satori2+Kiroshi1 on printed5 yields8 and is excluded. A later legal Minotaur attack triggers existing first-Arasaka history/Yorinobu and Saburo9→10. A labeled trusted query checks that aura contribution across D20=9; Program timing remains ordinary MAIN and gains no Quick.

The new field-Goro test exposed an existing validation gap. Floor It's public until-turn-end modifier was rejected after its Legend target lost effective Unit type in Removed. The narrow fix recognizes a public Removed, fully reviewed field Legend as a surviving modifier subject; it does not make Removed a new Unit target. The regression verifies two modifiers survive defeat and both expire at turn end. Hidden-area expiration remains unchanged.

## Field Legend targets

Field Goro/V have effective LEGEND+UNIT and are legal when relationship/power permits. Rival Goro7 reduced twice to5 is a Minotaur target. Friendly Goro/V under a sufficient D20 are Over the Edge targets. Assertions verify CARD_DEFEATED precedes host Trash and subsequent Removed, attachments clear and Gear remains in Trash.

## Gear-follow behavior

Normal equipped Units and field Legends share defeatCards→processDeparture. No targeted-defeat movement implementation exists. Both legal headlines equip actual Dexter with actual Mandibular Upgrade (zero printed Gear power, preserving Dexter4). Focused Mantis cases exercise nonzero Gear, host/Gear order, detach and final areas.

## DEFEATED trigger behavior

Actual Dexter, not a synthetic trigger surrogate, is defeated in both legal headlines. Existing bindings are captured while active; EFFECT_PENDING is emitted after victim movement under11.19.2. The current source effect resolves before Dexter's current Street Cred-difference condition and draw2. Tests assert auditable defeatedBy source, event ordering and exact draw count. EMPTY_DRAW terminates through existing game-end cleanup; no forced MAIN or stranded Program remains.

## Cross-controller Trash-order choices

Both headlines pause with p0's source current and p1 acting on DEFEAT_ORDER_SELECTION. The selected target is still on FIELD until its complete order is supplied. The source controller cannot submit this owner's action and no play/attack action interleaves. The bounded dedicated validator allows this actor change only while retaining exact source/effect, target, owner prefix and current eligibility. Duplicate/foreign cards, wrong owner/source/target and combat/prevention metadata reject.

## Program/PLAY continuation after defeat

Minotaur appends captured DEFEATED work to its existing pending batch, finishes the current PLAY ability, then uses normal controller priority. Over the Edge prepares the new DEFEATED batch after movement, announces pending work, finishes its own current effect and immediately enters Trash under4.14, then activates the prepared batch. Split preparation/activation reuses the existing scheduler; it does not create a nested LIFO stack. Old batches retain their exact event order.

Dexter's supported DEFEATED ability is automatic conditional draw, so no further strategic DEFEATED choice is fabricated or claimed. The architecture retains the existing controller-ordered queue, but arbitrary nested effect chains/mixed new triggers remain outside the two admitted full shapes.

## Events

One additive generic event, DEFEAT_TARGET_SELECTED, carries effect/source/target/controller and forced status because existing Gig target events cannot describe a card target. Existing CARD_PLAYED, PAYMENT_MADE, EFFECT_PENDING, CONDITION_EVALUATED, DEFEAT_TRASH_ORDER_SELECTED, CARD_DEFEATED(defeatedBy), CARD_MOVED, GEAR_DETACHED and EFFECT_RESOLVED remain authoritative. Targeted defeat emits neither FIGHT_RESULT nor ATTACK_ENDED.

## Observation

Existing observation projection exposes public card identities/current power, Gigs and the entitled current choice. Descriptors say which public Unit would be defeated and its current power; owner-order descriptors identify the next public Trash card. Power/D20 changes affect both viewers. Rival deck-order permutations do not alter the other player's legal IDs; private revision data, RNG and deck order are not added to model input.

## Training positions

Only legal decisions with more than one action become TrainingPositions. Minotaur's43 actions produce43 positions; Over the Edge's62 actions produce59 positions. Target choice and owner Trash order are real strategic choices. Condition checks, single forced targets, singleton order completion, semantic movement and Dexter's automatic draw produce no fake decisions. Trusted focused fixtures are explicitly labeled and excluded from headline generators. Human gold/evaluation data is untouched.

## Hash behavior

The additive continuation fields are included by existing POSITION_V2 canonical state projection. No hash protocol version changes. Replay state hash retains transport identity; position/observation-bound action IDs exclude match/version/event counters. Pending target power changes3/4 and public Street Cred/D20 changes reject old action IDs even when the Unit remains eligible. JSON/wire/training round trips and malformed/current-invalid target/order states are tested. The new policy independently opts into existing observation-based action identity.

## Demo coverage

Actual roadmap baseline was25/29 distinct and53/60 physical copies. Exactly Minotaur1 and Over the Edge2 are added: **27/29 distinct,56/60 copies**. Arasaka becomes12/14 distinct and26/30 copies. All49 prior content revisions are byte-equivalent; the test bundle adds exactly two complete real revisions, totaling51, with no new synthetic card.

## Remaining Arasaka blockers

Read-only complete source review after implementation confirms Corporate Surveillance3 copies and Goro Takemura — Losing His Way1 remain. Neither receives an executable revision here. Both have empty raw keywords, no flavor/reminder/other executable clauses and no applicable captured erratum. Full printings and raw hashes are recorded below.

Corporate Surveillance: Green RAM1, sellable cost2 Program, Null power, Corpo. Exact text: “Spend a rival Unit with cost 4 or less.” It needs current cost-filtered rival effective Unit targeting, Null-cost and already-spent handling review, and semantic spending rather than defeat.

Losing His Way: Green RAM3, unsellable cost4 power4 Unit, Arasaka/Corpo. Exact text: “{Attack} If all friendly Legends are face-up, this Unit has +5 power this turn.” It needs the all-friendly-Legends condition, exact field/hidden/absence semantics and self-positive temporary power. Existing Floor It admission cannot be widened silently to implement it.

`corporate-surveillance` complete source UUID `71fb410b-b56e-42b2-a793-4c49e935b9f1`, raw SHA-256 `2be0e1ec6474d85c2c3fa210fb2132a4558b8f8084e1ef65b4bf978e8d45da9a`. All printings:

| Printing UUID | Set | Number | Artist / rarity |
|---|---|---|---|
| d3dc7194-a545-4588-9702-b094c27ce359 | welcometonightcityretail | 097 | John Liew / Uncommon |
| 539138ff-af5a-47e3-abf0-cc772eaa8b9e | welcometonightcitybeta | β097 | John Liew / Uncommon |
| 8a13760d-050c-4a9c-bc44-f6b5796bb9f2 | embracingpowerretailstarterdeck | 020 | John Liew / Uncommon |
| e9d18fa1-0069-4b22-b64e-a75d2e30158a | embracingpowerbetastarterdeck | β020 | John Liew / Uncommon |
| af658f81-5214-4f56-ba8a-782a4419e366 | arasakademodeck | 014 | John Liew / Uncommon |


`goro-takemura-losing-his-way` complete source UUID `08e6a687-56b7-4ac1-982f-8a8d6d0c0bc5`, raw SHA-256 `579743b07f78c80d9b7e664006767e686f462a390994a2345a7fb39d1fbb973c`. All printings:

| Printing UUID | Set | Number | Artist / rarity |
|---|---|---|---|
| 42e03e7a-923d-4f2b-8d79-191e69873947 | embracingpowerretailstarterdeck | 017 | Ilya Kuvshinov / Uncommon |
| fb45ca8c-cb8a-4de9-8cf4-04a697c3fdfd | embracingpowerbetastarterdeck | β017 | Ilya Kuvshinov / Uncommon |
| 384b716d-fe9c-4a09-86b3-fe9b25928c51 | arasakademodeck | 013 | Ilya Kuvshinov / Uncommon |


## Merc status

Merc remains15/15 executable distinct cards and30/30 physical copies within documented scopes. Psycho Squad remains3 copies. Current scope limits, including Reboot's single outstanding next-fight prevention, still apply.

## Demo-format readiness

Exact teaching lists remain27 main+3 Legends=30. They remain ineligible under constructed and no full deterministic teaching match is claimed. No DEMO_STARTER, padding or format exception was introduced. Completing reference-card execution will still leave an explicit teaching-format policy review.

## Constructed validation

40–50 main, exactly3 Legends, reviewed RAM and copy limits are unchanged. Both headline decks are constructed-valid. Tests reject27-main, over-copy, missing-Legend and RAM-invalid arrangements. Deckbuilding code and physical reference quantities are untouched.

## Replays

**minotaur**: seed `defeat-0`, 43 legal actions, 43 strategic positions, 183 events including setup. Final replay hash `0ac28ad76238e8ef3ba296413df4b1349496afca95213f69f7a295ea4147d67e`. [Golden](../tests/fixtures/minotaur-replay.v1.json).

**over-the-edge**: seed `defeat-145`, 62 legal actions, 59 strategic positions, 252 events including setup. Final replay hash `012ba6fa49475d9633eee4b582b6f1813c01a0ec0368b9052711ef3292a25424`. [Golden](../tests/fixtures/over-the-edge-replay.v1.json).

Minotaur: p0 rolls D12/D10/D8/D6 across its first four turns, sells to fund cost7 and reaches Street Cred19 versus9 on turn7. p1 legally played Dexter, Swordwise and Mandibular Upgrade. Both rival Units qualify; p0 selects equipped Dexter, p1 orders host/Gear, then Dexter draws2 and p0 resumes MAIN with Minotaur READY+Lag.

Over the Edge: p0 legally rolls D12/D10/D8/D6/D4 before D20 on turn11. D20 rolls6; current Street Cred30 versus19 supports Dexter's draw. p0 first plays Field Operator, then cost3 Over the Edge. Target choices include own Field Operator2, rival Swordwise3 and equipped Dexter4. Selecting Dexter switches order to p1, then Program Trash precedes draw2 and p0 resumes MAIN. Neither headline imports trusted-arrangement helpers or patches state/RNG.

## Original payload compatibility

All25 original JSON replay families were frozen before edits in `/tmp/tcg-defeat-before/replays`. The compatibility audit reruns their preserved commands under current pins and compares semantic legal actions/descriptors, observations, event batches, initialization and final states. It is independent of regenerated expected files. **25 families /838 original decisions pass**. Two new families add105 decisions, yielding27 families /943 decisions for Python. Expected identity/hash re-pinning is distinguished from semantic payload changes.

## Persistence

Live MongoDB127.0.0.1:27018 and PostgreSQL127.0.0.1:5433 are the existing healthy Docker Compose services. Tests use randomized Mongo databases and PostgreSQL schemas and clean them up. Mongo publishes/reads both complete immutable revisions, verifies exact normalized content and repeat-publication behavior. PostgreSQL executes all43+62 legal actions from persisted reloads, including Minotaur target/condition, Over the Edge ANY/D20 target, victim-owner order, semantic defeat, newly pending Dexter draw and source completion. At every step it compares exact state, replay/position hashes, both observations/hashes, legal actions and full event history. No migration or application-service dependency was added. Final live gate outcome is recorded under Commands.

## Python/wire

The only harness edit appends `minotaur-replay` and `over-the-edge-replay` to the existing adapter test loop. All mechanics, filters, comparisons and adjudication remain in Node. Wire v1 stays additive; generated request, response and TrainingPosition schemas carry typed defeat metadata/continuations/events. TrainingAttempt schema and model action format remain unchanged. No Next.js/Apollo/database dependency enters the worker. The adapter suite additionally retains seven golden vectors, stale submission rejection and invalid-envelope tests. Existing legacy Python deckbuilding disagreements remain `repeated-entry-copy-bypass` and `legend-in-main`; they are not silently corrected here.

## Tests

The final application suite passes865 tests (747 baseline +118 new), with0 failures and0 skips. The targeted-defeat suite has118 passing tests; live Mongo/Postgres passes both suites, and Python passes27 replay families/943 decisions,87 game tests and48 core tests. It covers full records/printings/errata, rule/FAQ pins, six Street Cred cases, payment-time changes, current controllers, 4/5/6 and6/7/8 boundaries, actual modifier crossings, negative references, no-D20/initial-current/multiple-D20 cases, mandatory/forced/zero targets, friendly targets, equipped Dexter, source/pending/Program timing, Goro/V removal, duration expiration, EMPTY_DRAW, later Minotaur/Yorinobu/Saburo, 38 admission mutations, 22 invalid owner-order continuations, eight invalid target states, stale IDs/privacy/hash/wire/training/format and both legal headline goldens.

During implementation, early focused runs exposed the field-Legend temporary-power validation gap and several test-helper issues (unsupported helper movement destination, immutable test snapshots, Gig registry bookkeeping, and transport/training API call shapes). These were corrected; linting/type validation was not disabled. Final full-suite and integration/Python outcomes follow.

## Commands

All final gates passed with exit0. In the application root, commands used this runtime:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

| Exact command | Final result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `node --import tsx scripts/generate-attack-ordered-effects-replay.ts` | PASS |
| `node --import tsx scripts/generate-combat-attack-replay.ts` | PASS |
| `node --import tsx scripts/generate-combat-resolution-replays.ts` | PASS |
| `node --import tsx scripts/generate-combat-restrictions-replays.ts` | PASS |
| `node --import tsx scripts/generate-combat-triggers-replays.ts` | PASS |
| `node --import tsx scripts/generate-delayed-effects-replay.ts` | PASS |
| `node --import tsx scripts/generate-end-turn-history-replay.ts` | PASS |
| `node --import tsx scripts/generate-field-legends-replay.ts` | PASS |
| `node --import tsx scripts/generate-gear-capabilities-replay.ts` | PASS |
| `node --import tsx scripts/generate-gear-replay.ts` | PASS |
| `node --import tsx scripts/generate-goro-replay.ts` | PASS |
| `node --import tsx scripts/generate-noncombat-replay.ts` | PASS |
| `node --import tsx scripts/generate-private-information-replay.ts` | PASS |
| `node --import tsx scripts/generate-react-replay.ts` | PASS |
| `node --import tsx scripts/generate-reviewed-replay.ts` | PASS |
| `node --import tsx scripts/generate-saburo-replay.ts` | PASS |
| `node --import tsx scripts/generate-setup-replay.ts` | PASS |
| `node --import tsx scripts/generate-targeted-defeat-replays.ts` | PASS |
| `node --import tsx scripts/generate-turn-replay.ts` | PASS |
| `node --import tsx scripts/generate-value-conditions-replay.ts` | PASS |
| `node --import tsx scripts/generate-wire-golden.ts` | PASS |
| `node --import tsx scripts/generate-yorinobu-replay.ts` | PASS |
| `npm run contracts:export` | v1 contracts regenerated; TrainingAttempt unchanged |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; no warnings |
| `npm run validate:cards` | Validated4 original starter fixture records |
| `npm test` | 865 passed; 0 failures/skips (747 baseline +118 new) |
| `npm run build` | Compiled, typed and generated all6 static pages; /api/graphql retained |
| `git diff --check` | PASS |

These are all22 existing/new replay and golden generators, run sequentially before the full suite. Final application gate logs are `/tmp/tcg-defeat-gate-00.log` through `-30.log`; the command/exit inventory is `/tmp/tcg-defeat-gates.json`.

Additional exact commands from the application root:

```bash
node --import tsx --test tests/targeted-defeat.test.ts
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-defeat-before/replays
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Results:118 focused checks;25 original families/838 decisions preserved;2 live integration suites passed with0 skips; the existing Compose Mongo/Postgres containers healthy on27018/5433. The integration test removed only its own randomized test database/schema. Relevant logs are `/tmp/tcg-defeat-focused-3.log`, `/tmp/tcg-defeat-compat-final.log` and `/tmp/tcg-defeat-integration.log`. Early focused/typecheck runs failed during development as described under Tests; these final runs supersede them.

From `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

Results:27 families/943 authoritative actions and7 wire goldens passed;87 game tests passed;48 core tests passed. Existing seven-case deck differential still explicitly reports its two known Python gaps. No model download or training ran. Logs: `/tmp/tcg-defeat-python-adapter.log`, `/tmp/tcg-defeat-python-game.log`, `/tmp/tcg-defeat-python-core.log`.

`git diff --check` was also repeated in the app after documentation completion. No final build/typecheck/lint warning remains. The still-four starter records, separate teaching-format policy, two blocked cards and existing Python deckbuilding gaps are limitations, not failed gates.


## Files changed

Relative to the frozen317-file application baseline: **51 existing files changed,14 added,0 removed** (65 touched). The harness has **one changed file,0 added/removed**, relative to504 frozen files. All other503 harness files are byte-identical, including raw/processed captures, prompts, game validation, adapters, core, training/evaluation/gold data. The291 pre-existing staged entries and existing untracked paths retain their original status; no staging or HEAD changes were made. The application baseline was clean. Full file checksum comparison is saved in `/tmp/tcg-defeat-file-audit.json`.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Measured27/29 and56/60; preserve quantities and refine two remaining blockers. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Two complete source/printing/hash/admission entries and execution evidence. |
| [docs/targeted-defeat-report.md](../docs/targeted-defeat-report.md) | All41 required report sections, commands, results and file inventory. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add bounded TARGETED_DEFEAT_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add target/order phase, effect-defeat provenance and generic target event. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Share relationship enum; add typed defeat target/filter/effect. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add optional targeted-defeat policy gate. |
| [packages/engine/src/action-return.ts](../packages/engine/src/action-return.ts) | Permit exact victim-owner ordering while retaining source return context. |
| [packages/engine/src/combat-state.ts](../packages/engine/src/combat-state.ts) | Delegate new noncombat defeat continuation to its dedicated validator. |
| [packages/engine/src/effects.ts](../packages/engine/src/effects.ts) | Register reusable DEFEAT_UNIT handler. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Dispatch target/order choices; public descriptors and observation-bound action IDs. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Deck-wide new metadata and execution admission checks. |
| [packages/engine/src/play-state.ts](../packages/engine/src/play-state.ts) | Validate paid Program continuation through target and owner-order pauses. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Admit only complete reviewed targeted-defeat cards. |
| [packages/engine/src/play.ts](../packages/engine/src/play.ts) | Complete current source effect/Program lifecycle before newly pending work. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Integrate strict metadata/continuation checks and validated cross-controller timing. |
| [packages/engine/src/targeted-defeat-queries.ts](../packages/engine/src/targeted-defeat-queries.ts) | Current relationship/effective power/controlled D20 target compilation. |
| [packages/engine/src/targeted-defeat-state.ts](../packages/engine/src/targeted-defeat-state.ts) | Strict live target/order continuation and post-movement fact validation. |
| [packages/engine/src/targeted-defeat-support.ts](../packages/engine/src/targeted-defeat-support.ts) | Full-shape two-card admission and old-scope rejection. |
| [packages/engine/src/targeted-defeat.ts](../packages/engine/src/targeted-defeat.ts) | Execute condition, mandatory target, shared owner order/defeat and source resumption. |
| [packages/engine/src/temporary-power.ts](../packages/engine/src/temporary-power.ts) | Retain public-duration modifiers on Removed reviewed field Legends until expiry. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | Separate pending preparation/activation and append DEFEATED work after the current ability. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | Validate original PLAY context and exact post-movement effect-caused bindings. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | Admit complete reviewed Unit PLAY defeat shape. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose reusable current-power target and controlled-D20 queries. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerated additive v1 typed contract; no wire-version change. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerated additive v1 typed contract; no wire-version change. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerated additive v1 typed contract; no wire-version change. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Pin0.4.0-targeted-defeat-1 and derive current source artifact hash. |
| [scripts/generate-targeted-defeat-replays.ts](../scripts/generate-targeted-defeat-replays.ts) | Generate both legal deterministic headline goldens. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/minotaur-replay.v1.json](../tests/fixtures/minotaur-replay.v1.json) | New legal43-action/43-position Minotaur headline. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/over-the-edge-replay.v1.json](../tests/fixtures/over-the-edge-replay.v1.json) | New legal62-action/59-position Over the Edge headline. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/targeted-defeat-card-sources.v1.json](../tests/fixtures/targeted-defeat-card-sources.v1.json) | Complete two raw records/eight printings/four errata and source hashes. |
| [tests/fixtures/targeted-defeat-rules.v1.json](../tests/fixtures/targeted-defeat-rules.v1.json) | 287 exact rule nodes/eight complete FAQs and reviewed decisions. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerated seven transport goldens under new engine pins. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerated identity/hash pins; original semantic payload preserved by independent audit. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Mongo publish/read both revisions and PostgreSQL reload both full traces. |
| [tests/targeted-defeat-fixture.ts](../tests/targeted-defeat-fixture.ts) | Two immutable normalizations and legal constructed content/decks. |
| [tests/targeted-defeat-focused.ts](../tests/targeted-defeat-focused.ts) | Explicit trusted edge-case arrangements, excluded from headline generator. |
| [tests/targeted-defeat-replay.ts](../tests/targeted-defeat-replay.ts) | Both legal from-setup action sequences, hashes, observations and positions. |
| [tests/targeted-defeat.test.ts](../tests/targeted-defeat.test.ts) | 118 focused functional, invalid-state, lifecycle, hash and contract regressions. |

Harness file: `cyberpunk_llm/scripts/test_engine_adapter.py` appends exactly two replay names. No other harness file bytes changed. No environment file, dependency lockfile, default fixture card data, DB migration or UI file changed.


## Unsupported mechanics

Corporate Surveillance, Losing His Way, Zetatech Faceplate, WHEN_SPENT, arbitrary defeat/filter DSLs, general nested stacks, multiplayer generalization, general card-control transfer/multi-owner Gear movement, overlapping Reboot prevention and full exact-demo play remain unsupported. The bounded selector deliberately delegates existing defeatSupport restrictions. Null-power effective Units are not admitted. The cards are implementation-reviewed fixtures/revisions under explicit gameplay policy; the default four-card starter validator is not a count of engine executable coverage.

## Ambiguities not guessed

Current controlled D20 values are an existential test of the exact wording; no undocumented D20-choice action or fixed20/zero fallback was invented. Program timing follows4.14 and10.14, with pending creation distinct from pending resolution. Negative references follow2.10.1 and Null follows2.10.2. Trusted aura/field-Legend/multi-D20 arrangements do not claim natural timing histories, and neither new card gains Quick. No additional DEFEATED strategic choice is claimed because the real admitted Dexter trigger is automatic. Remaining sources are reviewed only to refine blockers, not certified from their roadmap summaries.

## Recommended next milestone

Review and admit the complete **Corporate Surveillance** shape through a bounded cost-filtered rival-Unit spending primitive. It can reuse current relationship/effective-Unit queries, mandatory target selection and Program lifecycle. First pin cost/Null, already-spent and semantic-spending rules; retain the distinction between spending and defeat. Losing His Way should then receive a separate full condition/positive-duration review. Only after both should exact teaching-format initialization be considered.
