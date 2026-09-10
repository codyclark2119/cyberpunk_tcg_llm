# Corporate Surveillance targeted-spend milestone

## Runtime

Completed 2026-09-09 in the authoritative application and its Python harness. Node **v22.13.0**, npm **10.9.2**, project **0.3.0**, Next.js **16.3.4**. Engine **0.4.0-targeted-spend-1**, artifact SHA-256 **d2f7bcc5218a3d2cc12ff66faea09b93e50bf6325789e247d99dd3558a985f16**.

The initial worktrees already contained changes from earlier milestones: application HEAD `52914b016722c7c3cbfeb7ddfb5e009c89610b02`, 331 captured files; harness HEAD `542c3d13c8fdfb542de4e83128859e616cd51c81`, 504 captured files. Preservation is measured against those complete working-tree snapshots, not HEAD diffs. Existing Minotaur/Over the Edge work is retained. No commit, push or staging was performed. The app is outside this session's writable root; its authorized edits and writing checks ran through sandbox escalation.

## Corporate Surveillance exact full shape

**corporate-surveillance@1 — SUPPORTED / TARGETED_SPEND_V1**. Source UUID `71fb410b-b56e-42b2-a793-4c49e935b9f1`; Arasaka Demo014. Program, Green RAM1, cost2, Null power, sellable, Corpo. Exact complete text:

> Spend a rival Unit with cost 4 or less.

No other executable clause, raw keyword, subname, flavor or reminder. All five Uncommon/John Liew printings were read in full, including images and set/collector metadata:

| Printing UUID | Set | Collector number |
|---|---|---|
| d3dc7194-a545-4588-9702-b094c27ce359 | welcometonightcityretail | 097 |
| 539138ff-af5a-47e3-abf0-cc772eaa8b9e | welcometonightcitybeta | β097 |
| 8a13760d-050c-4a9c-bc44-f6b5796bb9f2 | embracingpowerretailstarterdeck | 020 |
| e9d18fa1-0069-4b22-b64e-a75d2e30158a | embracingpowerbetastarterdeck | β020 |
| af658f81-5214-4f56-ba8a-782a4419e366 | arasakademodeck | 014 |

Local raw-byte SHA-256 `2be0e1ec6474d85c2c3fa210fb2132a4558b8f8084e1ef65b4bf978e8d45da9a`; canonical captured-record hash `27108509430c3b14ac8430798287a6f490733b5178ede31d674aea68345ef448`; normalized immutable revision hash `cf4fcc88977b4239b5cbb72181690fe5195b813d3f69832f6deb33b84adde82c`. All51 old revisions remain byte-equivalent; exactly one real revision adds to52. [Source fixture](../tests/fixtures/targeted-spend-card-source.v1.json), [normalization](../tests/targeted-spend-fixture.ts), [complete coverage entry](executable-card-coverage.md#targeted_spend_v1--corporate-surveillance).

## Rules/FAQ reviewed

[Pinned review](../tests/fixtures/targeted-spend-rules.v1.json): **206 complete rule nodes, 8 complete FAQ records**, reviewed 2026-09-09. Full local raw and processed rules and all four raw CMS/processed errata were inspected. The errata concern Johnny's beta Sell text, Kiroshi's Equip text, and Nocturne/Judy artist metadata; none applies to Corporate Surveillance or Losing His Way.

| Evidence | Decision |
|---|---|
| 3.5–3.8 | READY/SPENT orientation and actual READY→SPENT transition |
| 3.11.1, 3.11.1.2 | Numeric cost characteristic; payment adjustments do not change it |
| 2.10.2, 3.11.2.1–.3, 4.5.3 | Generic Null is nonnumeric; explicit Legend cost-reference0 exception; still unpayable and not field-playable |
| 4.2.1 | A field Legend is both LEGEND and UNIT |
| 4.14, 4.14.2 | Resolving Program outside ordinary areas; immediate Trash after its own effect |
| 2.4, 10.2.1, 10.2.3–.4 | Resolve as much as possible; complete the effect without interleaving |
| 8.6.3, 11.3, 11.15.2, 11.21.2 | Normal readiness, Lag restrictions, external spend does not activate Spend-icon text, attack has its own spend purpose |
| Corporate FAQ4496adf7-0641-4c06-a1f7-6eb120c075bf | Play is allowed with no rival Unit |
| Corporate FAQ00513475-b873-4eec-b582-c8bb969fe1e5 | An already-SPENT Unit can be chosen |
| Lag FAQs24fbf142-d9a7-4646-a8a1-5b28e692b652 and0e18028c-4e39-4218-87b3-ee73599c3040 | Lag constrains actions/costs, not external effect spending |

Four complete Faceplate FAQs (`a4b85193-1647-4001-a076-846f54d54481`, `9f87591e-514c-44ee-bba4-515fc488fb77`, `9b281489-5883-47ca-80a9-fa6707655b12`, `62c60c04-72ec-4231-9ea7-f5b8048eb4d8`) were read solely for the future timing boundary: attack, simultaneous ATTACK ordering, Spend-icon completion and payment/card-play timing differ. No WHEN_SPENT dispatcher or Faceplate revision was admitted.

Narrow live official [card](https://api.netdeck.gg/api/cards/cyberpunk/corporate-surveillance), [FAQ](https://api.netdeck.gg/api/faqs/cyberpunk) and [rules](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) JSON checks succeeded through an approved Python fetch after the browser tool could not open the endpoints. Live gameplay/printing identities agree with local data; parsed live rules exactly equal the local snapshot. Signed image URLs can vary. The temporary fetch did not refresh the corpus.

| Source bytes | SHA-256 |
|---|---|
| Local raw rules | 054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd |
| Local processed rules | 1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19 |
| Local raw errata | 1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75 |
| Local processed errata | 16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340 |
| Live Corporate card | 4cdeabc9336cfbc20ae244251f5e646d2119b205e1d303123315baddf3d889d3 |
| Live FAQs | 0ea289563adfe6207bbbb19824f8d62ea93002ac3f3fb9614a2541dffb12d480 |
| Live rules | b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a |

## Targeted-spend architecture

A separate discriminated `SPEND_UNIT` primitive has target `{ kind: "UNITS", relation: "RIVAL", costAtMost: 4 }`, using the existing relationship schema. A narrow targetedSpend policy opts into full-shape validation and observation-derived action IDs. The read-only selector, semantic transition and ordinary Program continuation are separate. No general filter language, defeat mode flag or card-name-specific event was introduced.

`supportsTargetedSpendCard` requires the complete reviewed Program characteristics and exactly the supported effect. Initialization and external state validation inspect the metadata of every physical card, including misuse under older scopes. Pending choice validation checks the paid source Program, current primitive, original continuation identity, actor, exact eligible options and phase, and rejects unrelated defeat/Gig/trigger/entry fields.

## Spend semantics

`spendUnitForEffect` accepts a present public effective Unit and valid source/effect identity. READY changes to SPENT on the same object, then CARD_SPENT records the effect cause. SPENT returns `changed:false` without a new spend fact. All non-readiness target fields remain unchanged. The target-selector caller enforces this card's relationship and cost; the trusted semantic operation does not embed those card-specific filters.

Future supported WHEN_SPENT discovery can attach to the actual `changed:true` transition, with cause-specific scheduling reviewed separately. Selection of an already-SPENT object cannot trigger it again. Existing spending paths were not refactored.

## Spend vs defeat

The operation never calls defeatCards or movement helpers. No CARD_DEFEATED, DEFEAT_TARGET_SELECTED, DEFEAT_TRASH_ORDER_SELECTED, target Trash/Removed move, Gear detachment or WHEN_DEFEATED batch is created. No target-owner actor switch or defeat continuation is needed. Old Minotaur/Over the Edge semantics pass the preserved-payload audit.

## Spend vs payment

The source pays two Eddies through the existing payment continuation and PAYMENT_MADE protocol. Its target is then spent by an EFFECT-cause CARD_SPENT naming sourceId and effectId. Existing ATTACKER_SPENT, BLOCKER_SPENT and Spend-icon CARD_SPENT payloads remain unchanged; the optional cause field preserves older wire/event payloads. Legend payment contribution never supplies target card cost.

## Rival targeting

Only current rival controller qualifies, irrespective of owner. Trusted query tests vary ownership/current control without admitting a control-transfer action. Friendly Units, including friendly cost≤4 Units, never appear. The selector reuses the existing CONTROLLED/RIVAL/ANY type, while complete Corporate metadata permits RIVAL only.

## Effective Unit filtering

The selector uses effectiveCardTypes after requiring face-up battlefield presence and the current controller's battlefield. Programs, Gear, hand Units, face-down field objects and Legends-area Legends are excluded. A field Legend satisfies UNIT typing independently of its numeric cost. No face-down Unit mechanics or arbitrary Gear/Gig spending is admitted.

## Cost<=4 semantics

Rules3.11.1–3.11.1.2 identify the immutable printed numeric cost characteristic. Payment reductions, increases and alternative contributions do not change it. RulesView exposes getNumericCost and getReferencedCost; no new cost-modifier system is needed. Gear cost, power and traits do not affect the filter.

| Real reviewed target | Numeric cost | Eligible when rival field Unit |
|---|---:|---|
| Corpo Security | 2 | Yes, despite cannot-attack text |
| Field Operator, Dexter, Swordwise | 3 | Yes |
| Kerry, Delamain Cab, Psycho Squad | 4 | Yes |
| MT0D12 Flathead; field Goro/V | 5 | No |
| Minotaur | 7 | No |

No real numeric-zero Unit exists in the current52-revision bundle. The synthetic numeric-zero check is query-only and explicitly nonexecutable; no real zero-cost card was invented or counted.

## Null cost behavior

No generic Null→0 coercion occurs. getNumericCost returns null for DASH/NONE. The explicit exception in3.11.2.3 makes a printed Legend's DASH cost reference as0; it remains DASH in content, unpayable/unmodifiable, and cannot be used to play that Legend to the field under4.5.3. Non-Legend DASH and legacy NONE remain nonnumeric.

Trusted query-only unsupported revisions cover Unit DASH, Legend DASH, Legend NONE, numeric0 Unit and numeric4 Legend. They fail executable state validation and do not enter the content bundle. These prove reference filtering without claiming a legal Null-cost field-Legend path or altering Goro/V.

## Already-spent target behavior

The card-specific official FAQ explicitly says an already-SPENT Unit can be chosen. READY and SPENT therefore both remain eligible. A second actual Corporate play can choose the Dexter spent by the first; it records selection, completes and trashes the Program, but emits no second CARD_SPENT or DEFEATED effect.

A public readiness change invalidates the previous observation-derived action ID. The updated pending state can still be valid, and a freshly enumerated SPENT-target choice is legal. This resolves the request's conditional stale-target examples using the actual FAQ instead of imposing a READY-only selector.

## Lag interaction

External spending preserves Lag. It does not call canActivateSpendAbility and does not activate Spend-icon text. A Lagging Field Operator remains targetable. A spent Corpo Security cannot pay the Blocker spend cost; normal next-turn readiness restores its readiness. The headline Dexter is READY on its next turn and ordinary attack enumeration returns, with no new persistent restriction.

## Mandatory/no-target behavior

The no-rival-Unit FAQ permits play. Zero eligible targets—including empty board, friendly-only board or all rival costs5+—still pays and resolves, then trashes the Program without a fabricated choice. One eligible target is selected internally with `forced:true`; multiple use the existing mandatory TARGET_SELECTION with no PASS/decline. The source controller chooses. Automatic selection/mutation/Trash generate no separate TrainingPosition.

## Dexter comparison

The paired regression uses real equipped Dexter. Minotaur defeats it through the shared semantic path: Trash/Gear movement and DEFEATED draw2. Corporate leaves the same Dexter FIELD/SPENT with its Gear and unchanged hand/deck sizes, no CARD_DEFEATED and no WHEN_DEFEATED pending effect. Corporate's ordinary Program EFFECT_PENDING is expected; the test specifically excludes a defeated trigger, not all Program effect activity.

## Gear attachment preservation

The legal headline preserves Mandibular Upgrade on Dexter. Focused Field Operator +Satori +Floor It checks compare complete host/Gear objects, attachments, modifiers and effective triggered text before/after; only host readiness changes. Host cost stays3 and derived power is preserved. No detach/re-attach, movement or owner ordering occurs.

## Field Legend filtering

Real Goro — Hands Unclean and V — Corporate Exile are effective LEGEND+UNIT with Gear on the field, but each costs5 and is excluded solely by the threshold. Their immutable costs are unchanged. A trusted semantic-operation regression spends an equipped real field Legend and retains both types/identity/attachments, demonstrating the generic transition independently of Corporate's cost filter. Only unsupported query metadata proves a hypothetical cost4 positive target. Legends still in LEGENDS fail Unit targeting; Null-cost Legends gain no field-entry path.

## Program lifecycle

HAND → PLAY_CARD → existing cost2 payment → RESOLVING_PROGRAM → optional multi-target choice → SPEND_UNIT → EFFECT_RESOLVED → source Program TRASH → MAIN. The original source/controller/payment continuation is retained across the choice. No new zone, defeat-order phase or nested trigger stack is introduced. Tests reject stranded, forged and mismatched continuations.

## Events

The final chosen-target batch is exactly:

```text
CARD_TARGET_SELECTED (source, target, controller, effect, forced:false)
CARD_SPENT (target, cause:EFFECT with source/effect)
EFFECT_RESOLVED
CARD_MOVED (source Program: RESOLVING_PROGRAM → TRASH)
PHASE_CHANGED (MAIN)
```

Readiness mutation is reflected in the resulting canonical state. An already-SPENT choice omits CARD_SPENT. A sole target uses forced:true. No card-name-specific event or spending-trigger window exists; no target movement/defeat/Gear event occurs.

## Observation

Existing public instance identity/readiness shows the result to both viewers. No observation field or card-specific helper flag was added. Public descriptors read `Spend <name> (<instance>, cost N, ready/spent)`; public numeric cost is supplied through that legal-action descriptor, while observations retain their existing CardRef representation. Rival hidden identities/deck changes do not alter the actor's public action IDs.

## Training positions

The new legal replay has44 strategic positions, including the genuine choice between cost3 Dexter and cost3 Swordwise. A sole/no target, readiness mutation and Program Trash do not create separate decisions. JSON/wire/TrainingPosition round trips preserve legal action descriptors and observations. Python consumes enumerated machine-readable action IDs; it contains no new targeting or spending rules.

## Hash behavior

Canonical position state already contains readiness and pending continuation. No redundant spentByCorporateSurveillance history is stored. Public readiness changes position/observation/action identity; transport counters do not change semantic action IDs. Replay hashes still cover exact state/transport identity. Target cost/controller/zone eligibility is derived and revalidated; stale or malformed external choices reject without auto-retargeting.

Headline final replay state hash: `4255605ed571db05cc0812ef78758834d7f909017945a8f52c0e04da853f92b4`. New content manifest: `0172af9f8971387d46a1294d10d692c1a4ece5c87cc98103132db29e2c4c9c3e`. Engine/code pins change old fixture hashes as expected; the compatibility audit compares semantic payloads after normalizing those pins.

## Demo coverage

| Metric | Before | After |
|---|---:|---:|
| Executable distinct /29 | 27 | 28 |
| Blocked distinct | 2 | 1 |
| Arasaka distinct /14 | 12 | 13 |
| Arasaka physical copies /30 | 26 | 29 |
| Merc distinct /15 | 15 | 15 |
| Merc physical copies /30 | 30 | 30 |
| Combined physical copies /60 | 56 | 59 |

Calculated from the actual29 roadmap rows with all names/decks/quantities checked against the frozen baseline. Corporate adds three copies. Content-bundle support fixtures are not real/demo card counts. [Updated roadmap](demo-deck-coverage-roadmap.md).

## Remaining card blocker

Only **Goro Takemura — Losing His Way**, one distinct/one physical copy, remains. Its complete local record was reviewed read-only after this implementation: Green RAM3 Unit, cost4/power4, unsellable, Arasaka/Corpo; exact `{Attack} If all friendly Legends are face-up, this Unit has +5 power this turn.` No other keyword, flavor or executable clause. All three Uncommon/Ilya Kuvshinov printings and four captured errata were checked; none applies.

Source UUID `08e6a687-56b7-4ac1-982f-8a8d6d0c0bc5`, raw SHA-256 `579743b07f78c80d9b7e664006767e686f462a390994a2345a7fb39d1fbb973c`. Retail starter017 printing `42e03e7a-923d-4f2b-8d79-191e69873947`; beta starterβ017 `fb45ca8c-cb8a-4de9-8cf4-04a697c3fdfd`; Arasaka Demo013 `384b716d-fe9c-4a09-86b3-fe9b25928c51`.

Remaining work: exact all-friendly-Legends predicate (area, hidden state, absence), resolution-time ATTACK condition, self +5 for the current turn, stacking and expiry. It was not admitted in this milestone.

## Merc status

Merc card execution remains complete within documented scopes:15/15 distinct and30/30 copies. Psycho Squad stays three copies. Exact Merc demo initialization remains unavailable pending format review; Reboot's existing one-outstanding-next-fight-prevention limit is unchanged.

## Demo-format readiness

The physical lists remain27 main +3 Legends,30 total each. Neither exact list is legal under the unchanged constructed policy. No DEMO_STARTER, padded demo list or complete teaching match was introduced. After Losing His Way, separate format evidence must establish27-card legality, three Legends, copy/RAM rules, setup differences, win conditions and teaching exceptions before deterministic exact-deck play.

## Constructed validation

Official constructed remains40–50 main cards, exactly3 Legends, reviewed RAM and copy rules. Focused tests check these boundaries and that all51 previous immutable revisions are retained unchanged. The headline uses legal constructed-size support decks with pre-existing synthetic support; it is neither an exact teaching deck nor human-certified gold.

## Replays

All23 replay/golden generator scripts ran successfully. The new targeted-spend family has44 actions/44 positions/173 events including initialization, legally from setup seed `defeat-0` to turn7 MAIN. Player0 rolls D12/D10/D8/D6, player1 D4/D6/D8; legal sells fund real plays. Rival Dexter enters on turn2, Swordwise on turn4 and Mandibular equips Dexter on turn6. Corporate source `p0-c27` pays on turn7 and selects Dexter `p1-c7`; Gear `p1-c33` remains attached. Swordwise remains READY. No state/RNG patch.

The regenerated set has28 families and987 decisions. Its27 prior families retain their original payload meaning under new pins. Wire golden generation also succeeds.

## Original payload compatibility

The audit used `/tmp/tcg-spend-before/replays`, copied before this milestone's implementation/regeneration, rather than comparing freshly generated fixtures to themselves. **27 original families,943 original decisions: PASS**. Semantic legal actions/descriptors, observations, event batches and initial/final states remain unchanged under updated engine/content pins. Existing cause-free CARD_SPENT and all payment/attack/Blocker/defeat payloads remain compatible.

## Persistence

Live Mongo and PostgreSQL integration: **2 tests passed,0 skipped** against the existing healthy local services at Mongo27018/Postgres5433. Mongo publishes/reads the complete Corporate immutable revision through the existing revision/conflict/projection/search test. PostgreSQL saves/reloads every transition of the44-action trace, compares full state, both observations, replay/position/observation hashes, legal actions and event history, then continues from the reloaded state.

The trace includes pre-play board, payment choice, resolving Program/target choice and the atomic target spend→Program Trash→MAIN batch. It preserves target/Gear identity and actor throughout; ordinary transaction rollback/stale-state checks remain active. No migration, new infrastructure configuration or application database seeding was needed.

## Python/wire

Harness change: append only `"targeted-spend-replay"` to the existing family list in scripts/test_engine_adapter.py. No card, cost, target or spending logic was added. The other503 captured harness files, including raw/processed/gold data, remain unchanged.

Wire v1 expands additively for the new scope/policy, SPEND_UNIT selector and generic target/spend event data. Request, response and TrainingPosition schemas were exported; TrainingAttempt is byte-unchanged. Seven existing wire goldens remain covered. All three Python suites pass:28 replay families/987 Node-authoritative actions with exact events, observations, hashes and final states;7 golden round trips plus model input/submission/stale-envelope checks;87 gameplay tests;48 harness-core tests. No model download or training ran.

## Tests

**79 focused targeted-spend tests pass. Full application suite:944 passed,0 failed,0 skipped.** Live persistence:2 passed,0 skipped. Typecheck, lint, card validation, contracts export and production build all pass.

Coverage includes complete source/metadata and23 shape-rejection cases, real cost boundaries, already-SPENT/no/sole/multiple targets, current control, effective Unit/Legend filtering, Gear/modifiers/Lag, Blocker/readiness, Dexter defeat comparison, exact events,18 malformed continuations, stale action IDs, observations/privacy/hashes/wire and constructed policy.

An initial focused run found seven test-helper/assertion errors: synthetic query fixtures reused printing IDs, a blanket EFFECT_PENDING assertion incorrectly excluded the Program's own effect, and a descriptor assertion treated the descriptor object as a string. Typecheck also caught the test's Cost type name and unused import. These were corrected, then79/79 and the full944 passed. No engine rule was weakened to satisfy those assertions. No remaining lint/build warning was emitted. Existing Python deck-builder limitations around split duplicate entries and Legends in the main deck remain outside this engine admission.

## Commands

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Runtime prefix for the Node/npm commands:

```sh
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

Every generator below was executed individually; all exited0. Logs are retained locally at `/tmp/tcg-spend-gate-00.log` through `-31.log`, with command/exit records in `/tmp/tcg-spend-gates.json`.

| Exact command | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `node --import tsx scripts/generate-attack-ordered-effects-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-combat-attack-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-combat-resolution-replays.ts` | PASS; generated |
| `node --import tsx scripts/generate-combat-restrictions-replays.ts` | PASS; generated |
| `node --import tsx scripts/generate-combat-triggers-replays.ts` | PASS; generated |
| `node --import tsx scripts/generate-delayed-effects-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-end-turn-history-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-field-legends-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-gear-capabilities-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-gear-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-goro-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-noncombat-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-private-information-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-react-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-reviewed-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-saburo-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-setup-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-targeted-defeat-replays.ts` | PASS; generated |
| `node --import tsx scripts/generate-targeted-spend-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-turn-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-value-conditions-replay.ts` | PASS; generated |
| `node --import tsx scripts/generate-wire-golden.ts` | PASS; generated |
| `node --import tsx scripts/generate-yorinobu-replay.ts` | PASS; generated |
| `npm run contracts:export` | PASS; additive wire v1 export |
| `npm run typecheck` | PASS; GraphQL codegen + both TypeScript projects |
| `npm run lint` | PASS; no warnings |
| `npm run validate:cards` | PASS; 4 starter records (separate from the52-revision engine bundle) |
| `npm test` | 944 passed;0 skipped |
| `npm run build` | PASS; compilation, type checking and page generation |
| `git diff --check` | PASS |

Additional application checks, all exited0:

```sh
node --import tsx --test tests/targeted-spend.test.ts
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-spend-before/replays
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
```

Results:79 focused tests;27 original families/943 original decisions preserved;2 live integration tests with0 skipped. Final logs: `/tmp/tcg-spend-focused-2.log`, `/tmp/tcg-spend-compat.log`, `/tmp/tcg-spend-integration.log`.

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```sh
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

Python logs are `/tmp/tcg-spend-python-adapter.log`, `/tmp/tcg-spend-python-game.log` and `/tmp/tcg-spend-python-core.log`. All three commands exited0: adapter28 families/987 actions and7 golden round trips; gameplay87 tests; harness-core48 tests. The adapter also confirms7 differential cases and reports the two existing Python deck-validation gaps (`repeated-entry-copy-bypass`, `legend-in-main`). Both repositories' final `git diff --check` passes.

Read-only preservation checks use `git rev-parse HEAD`, `git ls-files --stage`, `git ls-files --cached --others --exclude-standard` and SHA-256 comparisons against `/tmp/tcg-spend-before/baseline.json`. Both index snapshots are compared byte-for-byte; no staging command is used. The29 roadmap row identities/decks/quantities and all37 required report headings are checked programmatically after documentation is written.

## Files changed

Compared with the milestone-start working-tree snapshot: **60 application files touched (47 changed,13 added), one harness file changed, no removals**. Earlier uncommitted work is preserved. Both Git HEADs and exact index-entry snapshots remain unchanged. The harness's other503 captured files are byte-unchanged; no raw/processed/gold/training corpus was modified. Application lockfiles, package manifest, .nvmrc, TrainingAttempt and earlier immutable card revisions remain unchanged.

Each application file is listed below. Re-pinned old replay files preserve their original semantic payloads; this is verified against the independently frozen27-family baseline.

| File relative to application root | Change in this milestone |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Recalculate28/29 and59/60; preserve all quantities; review the sole remaining card. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Append complete Corporate source, printings, hashes, semantics, tests and limits. |
| [docs/targeted-spend-report.md](../docs/targeted-spend-report.md) | Add this37-section implementation/evidence/validation report. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add the narrow TARGETED_SPEND_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add generic CARD_TARGET_SELECTED and optional EFFECT cause on CARD_SPENT. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add strict SpendUnitTarget and separate SPEND_UNIT effect. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add optional targetedSpend policy. |
| [packages/engine/src/cost-value.ts](../packages/engine/src/cost-value.ts) | Add immutable numeric cost and explicit Legend Null-reference queries. |
| [packages/engine/src/effects.ts](../packages/engine/src/effects.ts) | Dispatch SPEND_UNIT through the ordinary effect chain. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Expose public spend descriptors and policy-specific observation-derived action IDs. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Admit only full reviewed targeted-spend metadata during initialization. |
| [packages/engine/src/play-state.ts](../packages/engine/src/play-state.ts) | Reuse and strictly validate current card-target continuation and options. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Route new-scope Program support through complete-shape admission. |
| [packages/engine/src/play.ts](../packages/engine/src/play.ts) | Resolve chosen spend target, then complete the existing Program effect. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Validate targeted-spend metadata across every physical card. |
| [packages/engine/src/targeted-spend-queries.ts](../packages/engine/src/targeted-spend-queries.ts) | Filter current-controller/public effective Units by referenced cost; retain SPENT targets. |
| [packages/engine/src/targeted-spend-support.ts](../packages/engine/src/targeted-spend-support.ts) | Implement narrow policy and complete-card admission; reject wrong/older scopes. |
| [packages/engine/src/targeted-spend.ts](../packages/engine/src/targeted-spend.ts) | Handle no/sole/multiple targets and revalidate selected target before semantic spend. |
| [packages/engine/src/unit-spend.ts](../packages/engine/src/unit-spend.ts) | Add narrow effect-caused Unit transition/fact and documented future timing hook. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose read-only numeric/reference cost and spend-target queries. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive request contract for new policy/effect/event metadata. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive response contract. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive TrainingPosition contract; TrainingAttempt remains unchanged. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Pin engine0.4.0-targeted-spend-1; artifact follows engine/domain code. |
| [scripts/generate-targeted-spend-replay.ts](../scripts/generate-targeted-spend-replay.ts) | Generate the legal constructed setup-to-spend headline. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/minotaur-replay.v1.json](../tests/fixtures/minotaur-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/over-the-edge-replay.v1.json](../tests/fixtures/over-the-edge-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/targeted-spend-card-source.v1.json](../tests/fixtures/targeted-spend-card-source.v1.json) | Pin full Corporate capture, all five printings, all four errata and hashes. |
| [tests/fixtures/targeted-spend-replay.v1.json](../tests/fixtures/targeted-spend-replay.v1.json) | Add44-action legal headline, positions, states, exact events and current pins. |
| [tests/fixtures/targeted-spend-rules.v1.json](../tests/fixtures/targeted-spend-rules.v1.json) | Pin206 complete rule nodes,8 FAQs, source hashes and reviewed decisions. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing wire goldens under current pins. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by audit. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Publish/read Corporate in Mongo; persist/reload and compare the full PostgreSQL trace. |
| [tests/targeted-spend-fixture.ts](../tests/targeted-spend-fixture.ts) | Normalize corporate-surveillance@1 and extend51→52 revisions with legal support decks. |
| [tests/targeted-spend-replay.ts](../tests/targeted-spend-replay.ts) | Build legal deterministic44-action replay with rival Dexter/Swordwise and Mandibular. |
| [tests/targeted-spend.test.ts](../tests/targeted-spend.test.ts) | Add79 source, semantic, continuation, privacy/hash/wire and policy regressions. |

Harness file: [scripts/test_engine_adapter.py](../../tcg_ai_training/cyberpunk_llm/scripts/test_engine_adapter.py) appends only the targeted-spend replay-family name. No Python rules change.

The post-change audit is retained at `/tmp/tcg-spend-final-audit.json`; baseline content/index snapshots remain under `/tmp/tcg-spend-before`. Application captured-file count331→344; harness504→504. All29 roadmap row identities/decks/quantities match the frozen baseline exactly. No commit, push or staging was performed.

## Unsupported mechanics

Losing His Way, Faceplate, WHEN_SPENT scheduling, a general spending-trigger dispatcher, refactoring all existing READY→SPENT paths, arbitrary target/filter/condition DSLs, control-transfer actions, face-down field Unit mechanics, payable Null Legends, new cost modifiers, DEMO_STARTER and a complete teaching match remain unsupported. The trusted query/semantic-operation fixtures are explicitly distinguished from legal headline paths. Existing engine/replay limits remain documented in prior reports.

## Ambiguities not guessed

The exact FAQ settles already-SPENT legality and no-target play. Rules3.11.1.2 settle payment-versus-cost, and3.11.2.3 supplies a specific Legend Null-reference exception; generic Null remains nonnumeric. Real Goro/V cost5 prevents a Corporate-positive field-Legend replay, so their costs were preserved and query-only positives are labeled accordingly. No admitted real numeric-zero Unit was fabricated.

Faceplate FAQs show cause-dependent future scheduling; that implementation is deferred. Losing His Way's all-Legends condition, including field/hidden/absence interpretation, remains for its own focused review. Complete execution of the current card does not establish teaching-format legality.

## Recommended next milestone

Review and implement **Goro Takemura — Losing His Way** as a separate full-shape all-friendly-Legends-face-up +self +5 until end of current turn ATTACK milestone. Reuse current effective types, ordered ATTACK resolution and temporary modifiers after sourcing its exact condition and timing. It should close the final1/29 distinct and1/60 physical-copy execution gap.

Only then begin a separate DEMO_STARTER format review. No commit, push, staging, corpus refresh, model download or training was performed here.

