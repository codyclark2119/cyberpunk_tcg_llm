# Goro Takemura — Hands Unclean: field-Legend admission

Completed implementation review on 2026-09-09. Goro is fully supported within FIELD_LEGENDS_V1 through the existing V engine. All requested final checks pass.

## Runtime

Node **v22.13.0**, npm **10.9.2**, application package **0.3.0**. Engine **0.4.0-field-legends-2**, artifact **5b907fb04f8a1ca261491f8646e5c8659003d97409d1578ccffd9c2c5916f54e**. Application baseline: clean user commit 3bc5eb4. The harness had pre-existing staged/untracked work; its other 503 inventoried files remain byte-identical. No commit, staging, push, model download or training was performed.

## Goro exact captured shape

CardId **goro-takemura-hands-unclean**, application revision **1**, raw UUID 72358c7d-9f29-4ef6-a682-f5bfc72c7714. Printed **LEGEND, Green RAM 2, €5, power 7, sellable, Arasaka/Corpo**. No additional abilities, triggers, conditions, restrictions or modifiers occur. Empty API keywords explicitly normalize from the two printed markup clauses to **GO_SOLO, BLOCKER**.

> {Go Solo} (Pay this Legend's cost to play it as a ready Unit. It can attack this turn. If it leaves the field, remove it from the game.)
> {Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)

All six printing records, artists, rarities and collector numbers remain in the source fixture. Arasaka Demo **008** is printing **fd889659-8291-41fd-9197-9cdf7cbf6810**.

| Printing UUID | Set | Collector |
|---|---|---|
| 2ba68619-7050-44c5-b0ce-b32d48b8f40f | embracingpowerretailstarterdeck | 012 |
| 25b09451-8cc8-4581-898d-3b5ee6ff6b14 | embracingpowerbetastarterdeck | β012 |
| fd889659-8291-41fd-9197-9cdf7cbf6810 | arasakademodeck | 008 |
| 1b6e44dd-d6e7-46eb-a5e5-24c38eed888b | boxtoppersretail | 003 |
| 15430373-fafd-479c-84d4-5737c71d0850 | boxtoppersbeta | β003 |
| 8bdba66b-a20e-49f3-8e85-2e3d7e0c6a37 | edgerunneropens1 | 041 |

## Source/rules reviewed

Read the complete local Goro record, all printings, all four raw/processed errata, and the existing field-Legend rule selection before admission. No Goro erratum exists in that capture. Kiroshi's equip clarification remains applicable to the composition tests.

The narrow live [Goro API](https://api.netdeck.gg/api/cards/cyberpunk/goro-takemura-hands-unclean) matches every gameplay field and printing identity. The [official rules API](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) parses identically to the local capture. All 270 [official FAQ](https://api.netdeck.gg/api/faqs/cyberpunk) questions/answers/publication dates match the prior review; signed image URLs account for different response bytes.

[goro-card-source.v1.json](../tests/fixtures/goro-card-source.v1.json) pins the complete record/errata; [goro-rules.v1.json](../tests/fixtures/goro-rules.v1.json) retains216 exact rule nodes,16 prior FAQ findings and the Goro-specific Blocker-area FAQ. Relevant rules include4.4–4.5, 4.12, 5.6–5.7, 8.14.1, 10.10.1, 11.3, 11.19, 11.24–11.25. No broad corpus refresh.

| Evidence | SHA-256 |
|---|---|
| Local Goro bytes | a70354773e9362bc2f5b919d9be28ba1c8d4d33326573067413586fd3e0fb4f2 |
| Canonical Goro record | ea8be33a89100f6a55d104961b0f0a60878c1c9c2690118d7fe4bc1ad2bfd525 |
| Immutable normalized revision | ffe03cff4ba12a5f241d5d92d71e8da39e006bc5d866fd1a1ece2c2d284f8703 |
| sha256 | 054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd |
| processedSha256 | 1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19 |
| errataSha256 | 1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75 |
| processedErrataSha256 | 16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340 |

## GO SOLO reuse

The sole engine module change is the bounded complete-shape predicate in field-legend-support.ts. It now accepts the reviewed Green/Arasaka/Corpo/power 7/Go Solo+Blocker variant alongside V's unchanged Blue/Corpo/Merc/power 8/Go Solo variant. Missing power safely returns unsupported before canonical serialization. No Goro-specific runtime action, type or pipeline was created. The movement/payment/combat slug audit found no V-identity branch to remove.

## Cost/payment

Both entry modes pay exactly €5 using the existing physical payment-source solver and continuation. Focused tests cover ready/spent source orientations, self-payment, unpayable entry and partial payment. Selection does not spend or move anything until the exact set is complete. The entering Legend may pay its own cost; Go Solo subsequently readies it, ordinary play preserves the spent orientation.

## Lag/readiness

Go Solo enters READY with Lag and the existing same-turn attack exception. Ordinary PLAY_CARD preserves post-payment orientation and applies Lag without that exception. End-turn cleanup removes Lag; normal later readiness makes ordinary field Goro attackable on its next own MAIN. Spend-icon activation remains subject to the existing Lag prohibition; Goro has no printed Spend-icon ability to invent or add.

## Printed BLOCKER

Goro carries printed Blocker in either public area. The capability query does not grant action eligibility by itself. Its own official FAQ 9ad7e1cf-9965-4ba0-8503-ac17c897ffbd explicitly disallows declaration in LEGENDS. FIELD, current effective Unit type, controller, READY and a blockable rival attack enable the existing action.

## BLOCKER + Lag

A focused validated React state with LAG and no GO_SOLO status can Block; spent or opposing-controlled hosts cannot. This demonstrates that Blocker is a separate keyword cost from Spend-icon activation and does not depend on the Go Solo attack exception. The legal headline correctly clears Lag at end turn and uses normal readiness before the later rival attack; it does not invent a same-turn rival window.

## Effective Legend+Unit typing

LEGENDS → [LEGEND]; FIELD → [LEGEND,UNIT]; after removal → [LEGEND]. Printed revision/type never changes. Existing field validation and RulesView supply the effective type; no Unit clone is created.

## Pre-equipped Gear preservation

Legal Mantis play equips Goro in LEGENDS. Before/after Go Solo power is7+2=9. The same host and Gear IDs, revision, ownership, controller, face and attachment graph survive one atomic movement result. No detach/re-equip occurs. Focused Mantis+Satori+Mandibular composition gives 11 in both areas with three physical modifiers and no double counting. General Legends-area inheritance remains unchanged.

## Goro + Mandibular

The printed host and inherited Gear retain two physical Blocker sources. One semantic DECLARE_BLOCKER is offered on the host. Both capabilities remain visible to the internal query in LEGENDS, while the action is unavailable there. Goro, Bombus, Corpo and Mandibular on a plain Unit produce the same spend/redirection facts.

## Goro + Satori

Power9 before/after entry; inherited WHEN_FIGHT_WON draws one after Goro beats a reviewed Psycho Squad. The headline additionally exercises rival V+Satori's fight win after Goro blocks it.

## Goro + Kiroshi

Power8 in both areas. The same inherited ATTACK trigger privately looks at a friendly face-down Legend after field entry. Only the entitled viewer receives remembered identity; the rival receives the existing public known marker.

## Goro + Dying Night

Power9 and ordinary ATTACK registration, including last-valid [LEGEND,UNIT] metadata. End turn evaluates the exact named-V predicate false for real Goro, both while still on FIELD and after losing a fight and being removed. No ready-two benefit is granted. Existing real V-positive behavior remains covered.

## CALL/payment before field

Both headline players CALL public slot1 blindly; frozen seed goro-26 reveals Goro and V. Ready Goro in LEGENDS can pay an ordinary CALL without moving its equipped Gear or triggering their ATTACK text. Knowledge of a face-down Goro does not grant field-entry permission. A focused same-turn CALL/Go Solo branch is payable and valid.

## Field payment/CALL restrictions

FIELD Goro cannot be CALLed, re-enter via Go Solo, or supply Legends-area payment solely because its printed type remains Legend. Existing area checks are authoritative.

## Attack

Goro attacks on turn 5 immediately after Go Solo, with Lag retained. It completes the normal Gig-area attack/React/steal path. The shared restriction query also prevents Goro blocking an attack currently marked cannot-be-blocked.

## Blocker

Turn7 naturally readies Goro; it declines to attack and stays ready. During rival V's turn 8 attack on the Gig area, Goro spends and redirects the target to itself through DECLARE_BLOCKER.

## Fight

Rival V+Satori has10 power versus Goro+Mantis9. Normal fight resolution determines the winner, defeats Goro and resolves Satori's inherited draw. The separate Goro+Satori victory proves that Goro can be the inherited trigger's winning host too.

## Defeat/removal

The legal replay pauses for Goro's owner to choose the exact Trash order while both cards still occupy FIELD. Shared defeat processing emits CARD_DEFEATED, moves host/Gear to Trash and then removes the Legend. Both legal owner-order branches are tested; current effective Unit type and Go Solo/Lag state do not survive removal.

## Gear movement on defeat

Mantis follows to Trash, detaches, and stays there when Goro moves REMOVED. Attachments are empty and validateState succeeds. Neither Gear cloning nor orphan references occur.

## V regression

The 47 existing V tests remain unchanged and pass. Its legal real-Dying positive replay retains38 actions/37 positions/159 events, including ready-two resolution. Prior V defeat/last-valid Name behavior, pre-equipping, ordinary play and same-turn attack remain covered. All 41 previous immutable revisions are equal in the new43-card bundle; only Goro and one explicitly synthetic Red/Yellow RAM 2 test-support Legend are new.

## Observation

Both viewers see public type, power, physical Gear, readiness/Lag and Blocker before/after entry. Internal capability provenance is not added to public observation. Hidden card knowledge and model-input redaction retain the existing boundaries.

## Events

Reuse PAYMENT_MADE, CARD_MOVED, GO_SOLO_ACTIVATED, CARD_PLAYED, BLOCKER_DECLARED, fight/defeat/ordering and attachment facts. Green entry emits no Blue qualifying-play fact, and Gear movement emits no second play. No Goro-specific event or schema addition.

## Training positions

The headline records56 genuine multi-option positions over58 actions. Go Solo versus other MAIN actions, payment selection, attack, Blocker and owner Trash order all use the existing position generator. Forced transitions do not become fabricated decisions. These are implementation-generated fixtures, not human-certified gold.

## Hash behavior

Semantic LEGENDS→FIELD entry changes PositionHash and both viewers' ObservationHash. Payment continuation/options and attachment identities are deterministic. Match version/event-sequence changes normalize out of PositionHash and legal action identity while ReplayStateHash changes. PostgreSQL additionally replays under fresh match/player UUIDs and matches original position hashes.

## Demo coverage

Counts were recalculated from all 29 unchanged physical roadmap rows.

| Metric | Before | After |
|---|---:|---:|
| Executable distinct /29 |20|21|
| Blocked distinct |9|8|
| Arasaka distinct /14 |5|6|
| Arasaka copies /30 |14|15|
| Merc distinct /15 |15|15|
| Merc copies /30 |30|30|
| Combined copies /60 |44|45|

Only Goro's one Legend copy is newly executable. The new synthetic RAM support is not counted as a real card.

## Arasaka remaining blockers

Yorinobu and Saburo were reviewed read-only from their entire local captures and all six printings each. Both are sellable Arasaka/Corpo Legends with null cost/power, no Go Solo and no applicable captured erratum.

**Yorinobu — Embracing Destruction**, Red RAM 2; Demo 001, printing aaad5db8-fcd4-42f0-8ced-e7527dbccf79. Complete text:

> The first time a friendly ARASAKA Unit attacks each turn, draw 1. Then, if you have less than 20 ☆ (Street Cred), discard 1.

Raw SHA-256: 9a01723fde94d8feca1582272de879bba21feec88faa012856a448226061c51d. FAQ 61ad63b3-47d9-48ee-a3f6-4c2842b11c66 confirms earlier qualifying attacks count even when Yorinobu was face-down. It needs source-independent qualifying attack history, friendly effective-Unit/classification filtering, a first-occurrence guard, and reviewed ordered draw/discard threshold timing. Existing immutable tags, attack timing, DRAW and discard operations are available; no admission occurred.

**Saburo — Stubborn Patriarch**, Green RAM 2; Demo 009, printing 13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca. Complete text:

> Friendly ARASAKA Units have +1 power while attacking.
> (Units steal an extra Gig for every 10 power.)

Raw SHA-256: 72d450459d340c1088b3713701d80bec7c289a98258aa491e0b946824af649b2. FAQ 18318e94-6979-4623-9cf5-fee73924d728 confirms the aura applies during fight and steal. It needs a continuous trait-filtered query covering the entire attack lifetime, with separate review of source availability and contribution. These two FAQ findings are from the narrow [official FAQ capture](https://api.netdeck.gg/api/faqs/cyberpunk); neither mechanic is implemented.

The other six blockers are Minotaur, Industrial Assembly, Over the Edge, Field Operator, Corporate Surveillance and Goro — Losing His Way. Their precise gaps remain in the [roadmap](demo-deck-coverage-roadmap.md). Losing His Way is a Green RAM 3 Unit, cost 4/power 4, unsellable; its complete ATTACK clause checks all friendly Legends face-up before granting +5 for the turn. Raw SHA-256: 579743b07f78c80d9b7e664006767e686f462a390994a2345a7fb39d1fbb973c. It requires a different condition, not Go Solo.

## Merc card-execution status

Still **15/15 distinct and 30/30 physical copies**, within the previously stated bounded scopes. V and the other Merc immutable revisions remain unchanged.

## Demo-format readiness

Exact teaching lists remain 27 main+3 Legends. Neither is format-legal under constructed; no DEMO_STARTER policy, padded physical list or complete starter match was introduced. Card execution coverage and format readiness remain separate.

## Constructed validation

Unchanged 40–50 main, exactly 3 Legends, maximum 3 copies and reviewed per-color RAM/Legend identity rules. Both replay decks contain 42 main+3 Legends. A clearly marked synthetic Red/Yellow RAM 2 Legend permits the four-color Gear tests without altering real revisions. Tests reject 27-main, two-Legend, fourth-copy and removal of Goro's required Green RAM support.

## Replays

New family: goro-replay.v1.json, frozen seed **goro-26**, **58 actions,56 positions,229 events**, turn 8 MAIN. Setup → blind CALL Goro/V → Mantis/Satori pre-equipping → Goro Go Solo and attack → V Go Solo → natural Goro readiness → V attack → Goro Blocker → owner-order defeat/removal. No state or RNG patch exists in this trace. Explicit trusted arrangements are isolated to focused rule tests. All 18 replay/wire generator scripts ran successfully.

## Original payload compatibility

All 21 original payloads were copied before mutation to /tmp/tcg-goro-before/replays. The existing reusable audit re-executed **665 original decisions** with only engine/artifact/manifest repinning and compared semantic legal actions/descriptors, exact observations/events, initialized/final states. PASS for every family. This checks preserved old payloads independently of regenerated goldens. The broad generated JSON diff is engine/content/action/hash pin churn, not evidence of altered old semantics.

## Persistence

Live MongoDB 127.0.0.1:27018 and PostgreSQL 127.0.0.1:5433 passed 2/2 integration tests with zero skips. Mongo publishes and reads Goro's immutable revision, verifies equality and repeat-publish replay. PostgreSQL persists/reloads every new legal transition, including CALL, pre-equipped Gear, payment continuation, atomic Go Solo movement, attack, Blocker, owner-order defeat/removal and Satori draw. State, legal actions, both observations, all event history and replay/position hashes match after each reload. Tests use fresh isolated databases/schemas and clean them in finally. No migration or application catalog seed change was needed.

## Python/wire

Only scripts/test_engine_adapter.py changes in the AI repository: add goro-replay to the generic family list. No card, Legend, Go Solo, Blocker or Gear rules are implemented in Python. The adapter traverses 22 families/**723 Node-authoritative actions**, plus 7 wire golden round trips, model input, action submission and stale/invalid rejection. Game tests 87/87 and harness-core tests 48/48 pass. Wire remains v1; regenerated request/response/TrainingPosition schemas and TrainingAttempt are byte-identical because no contract shape changed. Wire golden pins update.

## Tests

**498/498 application tests**, including 45 new focused Goro tests and the 47 retained V tests; zero skips. Typecheck, ESLint, four original fixture-card validation, production build and contract export pass. The four catalog records are separate from the 43-card experimental content bundle. Live integration passes 2/2 and all three Python commands pass.

During implementation an initial focused run passed 40/43: test preparations retained a Go Solo status after swapping to a plain Unit, and two no-choice assertions expected undefined instead of the schema's null. Initial typecheck found an event-union narrowing error. Those test issues were corrected. Final review also reproduced and fixed missing-power admission throwing during canonical serialization, and added that negative case. Every final gate was rerun under the final artifact. No outstanding lint/build warnings were observed.

## Commands

Application commands ran in /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online with PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH. Every final command below exited 0.

| Exact command | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; no warnings |
| `npm run validate:cards` | PASS; 4 original catalog fixtures |
| `npm test` | PASS; 498/498, 0 skips |
| `npm run build` | PASS; Next production build |
| `npm run contracts:export` | PASS; schemas regenerated unchanged |
| `git diff --check` | PASS; no whitespace errors |
| `node --import tsx --test tests/goro.test.ts` |45/45 focused tests before the final extra rejection case; final full suite includes that case |
| `node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-goro-before/replays` |21 families,665 original decisions preserved |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` |2/2 live tests,0 skips |

All generator/export invocations (each exited 0):

- `node --import tsx scripts/export-wire-schemas.ts`
- `node --import tsx scripts/generate-attack-ordered-effects-replay.ts`
- `node --import tsx scripts/generate-combat-attack-replay.ts`
- `node --import tsx scripts/generate-combat-resolution-replays.ts`
- `node --import tsx scripts/generate-combat-restrictions-replays.ts`
- `node --import tsx scripts/generate-combat-triggers-replays.ts`
- `node --import tsx scripts/generate-delayed-effects-replay.ts`
- `node --import tsx scripts/generate-end-turn-history-replay.ts`
- `node --import tsx scripts/generate-field-legends-replay.ts`
- `node --import tsx scripts/generate-gear-capabilities-replay.ts`
- `node --import tsx scripts/generate-gear-replay.ts`
- `node --import tsx scripts/generate-goro-replay.ts`
- `node --import tsx scripts/generate-noncombat-replay.ts`
- `node --import tsx scripts/generate-private-information-replay.ts`
- `node --import tsx scripts/generate-react-replay.ts`
- `node --import tsx scripts/generate-reviewed-replay.ts`
- `node --import tsx scripts/generate-setup-replay.ts`
- `node --import tsx scripts/generate-turn-replay.ts`
- `node --import tsx scripts/generate-wire-golden.ts`


Harness commands ran in /Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm:

| Exact command | Result |
|---|---|
| `mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node` | PASS;22 families,723 actions,7 goldens |
| `mlx_env/bin/python -B scripts/test_cyberpunk.py` | PASS;87/87 |
| `mlx_env/bin/python -B scripts/test_harness_core.py` | PASS; 48/48 |

Initial failed development checks and their corrections are documented under Tests. Logs and pre-change fingerprints remain under /tmp/tcg-goro-*; repository source captures were not refreshed.

## Files changed

**35 application files** changed relative to clean3bc5eb4, plus **one harness file**. No existing immutable card revisions, dependencies, environment files, database migrations, AI corpus/gold/evaluation files or other projects changed.

| Application-relative file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Recalculates20→21 admissions and refines remaining Arasaka blockers. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Records complete Goro source, normalization, rules, behaviors and limits. |
| [docs/goro-field-legends-report.md](../docs/goro-field-legends-report.md) | Full requested milestone report, evidence, commands and per-file inventory. |
| [packages/engine/src/field-legend-support.ts](../packages/engine/src/field-legend-support.ts) | Adds the second complete reviewed shape and safe missing-power rejection; runtime systems unchanged. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Bumps engine artifact version to field-legends-2. |
| [scripts/generate-goro-replay.ts](../scripts/generate-goro-replay.ts) | Generates the new legal replay and reports counts/hash. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/goro-card-source.v1.json](../tests/fixtures/goro-card-source.v1.json) | Complete local Goro record, six printings, errata and narrow live-source verification. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | New immutable content, setup,58 transitions,56 positions and final state golden. |
| [tests/fixtures/goro-rules.v1.json](../tests/fixtures/goro-rules.v1.json) | Exact reviewed rules and FAQ/source pins, including Goro Blocker-area finding. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerates existing replay content/artifact/action/hash pins; original semantic payload compatibility passes. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerates seven existing wire cases under final engine/content pins. |
| [tests/goro-fixture.ts](../tests/goro-fixture.ts) | Pins immutable Goro and explicit synthetic RAM support in constructed test context. |
| [tests/goro-replay.ts](../tests/goro-replay.ts) | Builds the legal58-action Go Solo/attack/Blocker/defeat trace without state patches. |
| [tests/goro.test.ts](../tests/goro.test.ts) | 45 focused source, lifecycle, composition, rejection, hash, training and wire tests. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Mongo immutable Goro and PostgreSQL complete legal trace round trips. |

Harness: **cyberpunk_llm/scripts/test_engine_adapter.py** adds one replay-family name only. The other503 baseline harness files and its pre-existing staged work were preserved. Contract schemas were regenerated but are unchanged, so they are absent from this diff inventory.

## Unsupported mechanics

No Yorinobu/Saburo/Losing His Way admission, Faceplate, WHEN_SPENT dispatcher, generic trait/event language, DEMO_STARTER or full demo match. Existing cross-owner/control-change and return-to-LEGENDS gaps remain. Reboot still permits only one outstanding next-fight prevention. Python retains its explicitly reported pre-existing differential gaps: repeated-entry-copy-bypass and legend-in-main; the engine remains authoritative. Experimental revisions remain explicitly bundled rather than silently replacing the four-card application catalog. These are bounded implementation-reviewed fixtures, not full-game or human-gold certification.

## Ambiguities not guessed

The complete Goro source reveals no extra unsupported effect. Generic Go Solo, ordinary Legend entry, removal and Blocker rules plus the specific FAQ resolve this admission. Lag and turn ownership are tested separately without fabricating an unavailable window. Future Yorinobu history/source timing, Saburo aura lifetime details, Faceplate spending triggers and teaching-format exceptions require their own scoped review; none is inferred from Goro's admission.

## Recommended next milestone

Review and implement **Yorinobu — Embracing Destruction** as a bounded first-friendly-ARASAKA-attack milestone. Its source-independent first-occurrence history and current classification query can reuse established trigger timing and ordered draw/discard infrastructure. Keep Saburo's continuous attacking aura and Losing His Way's all-Legends-face-up condition as separate subsequent reviews unless source evidence justifies shared narrow primitives. Preserve teaching-format legality as an independent decision.
