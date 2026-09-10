# Losing His Way attack-condition power milestone

## Runtime

2026-09-09 implementation review in the authoritative application and Python harness. Required runtime: Node v22.13.0/npm 10.9.2; application 0.3.0/Next 16.3.4. Engine **0.4.0-attack-condition-power-1**, artifact **ce50aa41d888d15c6f0c4a665de2c7d46c6d068209d936bf46d58aebbd19c78b**.

The application began clean at HEAD `fb7d45319d2c6306fc0c4675d3b7457eb83f67f7` with 344 captured files. Harness HEAD `542c3d13c8fdfb542de4e83128859e616cd51c81` had 504 captured files and 296 pre-existing status entries. Both full working-tree/index snapshots and 28 replay families were frozen in `/tmp/tcg-losing-before` before editing. App writes used authorized sandbox escalation because that repository is outside the session writable root. No commit, push or staging.

## Losing His Way exact full shape

**goro-takemura-losing-his-way@1**, SUPPORTED/ATTACK_CONDITION_POWER_V1. Source UUID `08e6a687-56b7-4ac1-982f-8a8d6d0c0bc5`. Printed Unit, Green RAM 3, cost 4, power 4, unsellable, Arasaka/Corpo. Complete captured markup:

> {Attack} If all friendly Legends are face-up, this Unit has +5 power this turn.

No other executable clause, raw keyword, flavor or reminder. Name Goro Takemura; subtitle Losing His Way. This is a main-deck Unit, distinct from the printed Hands Unclean Legend. All three Uncommon/Ilya Kuvshinov printings were reviewed, including image metadata:

| Printing UUID | Set | Collector number |
|---|---|---|
| 42e03e7a-923d-4f2b-8d79-191e69873947 | embracingpowerretailstarterdeck | 017 |
| fb45ca8c-cb8a-4de9-8cf4-04a697c3fdfd | embracingpowerbetastarterdeck | β017 |
| 384b716d-fe9c-4a09-86b3-fe9b25928c51 | arasakademodeck | 013 |

Local raw SHA-256 `579743b07f78c80d9b7e664006767e686f462a390994a2345a7fb39d1fbb973c`; canonical record `9999ee1d698fc18e53de9f6bbc969321a27b209a738e9c71d8e725c3be2ab78c`; immutable revision `9e649112dc22a493ba733f643259eed40e798b5c7840d042d42959498ba3bc03`. [Complete source](../tests/fixtures/attack-condition-power-card-source.v1.json) and [normalization](../tests/attack-condition-power-fixture.ts). All 52 previous immutable revisions are retained unchanged; exactly one real revision adds to 53. No new synthetic revision.

## Rules/FAQ reviewed

[Pinned fixture](../tests/fixtures/attack-condition-power-rules.v1.json): 362 complete rule nodes and 3 complete FAQs. All four captured raw CMS/processed errata were reviewed: Johnny beta Sell, Kiroshi Equip and Nocturne/Judy artist corrections. None applies to this Goro.

| Evidence | Reviewed meaning |
|---|---|
| 1.7.2/.2.1 | Friendly means currently controlled pieces in play |
| 3.3/3.4/3.4.1 | Actual face state; the LEGEND type remains public while DOWN |
| 4.2.1/4.4/5.13.2 | Field Legend retains both types; other areas invalid; Removed outside game |
| 5.7.4.2 | Kiroshi knowledge marker does not reveal |
| 10.3/10.3.3/10.15.1 | Conditions can gate pending and must hold when the relevant instruction resolves |
| Card FAQ `0c5b038a-705c-44ba-bff6-95403c35f032` | Revealing every Legend after declaration does not trigger Losing His Way |
| 10.1.3/11.21.1–.2 | This Unit is the physical source; ATTACK becomes pending on attack spending |
| 3.17.2/10.16.3 | Sum modifiers; each trigger occurrence is independent |
| 8.16.2/9.29 | This-turn effects last past attack end and expire at turn cleanup |
| 5.3.2.2 | Hidden entry clears modifiers; public departure does not |
| 9.17/9.23 | Actual current-power Fight and Steal calculations |

Other pinned FAQs: `903ccbd0-d2d9-46e0-9ffc-cd5ebddef04a` (Legend departure/Gear) and `61ad63b3-47d9-48ee-a3f6-4c2842b11c66` (Yorinobu first-attack timing).

Narrow official [card](https://api.netdeck.gg/api/cards/cyberpunk/goro-takemura-losing-his-way), [FAQ](https://api.netdeck.gg/api/faqs/cyberpunk) and [rules](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) checks succeeded through temporary Python fetches after the browser tool could not open those endpoints. Live gameplay fields and all printing identities agree with local data; parsed live rules equal local raw rules. No re-ingestion or broad corpus refresh.

| Capture | SHA-256 |
|---|---|
| Live card | 6eabb33b2f3819ce2e2840b51676cd7436bfd2207c017af2e1a3cc250f563dea |
| Live FAQs | cccbb0fdc9fb6c43df896722abe33951f1e2d1ca95784665cfeeb71350e430f8 |
| Live rules | b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a |
| Local raw rules | 054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd |
| Local processed rules | 1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19 |
| Local raw errata | 1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75 |
| Local processed errata | 16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340 |

## All-friendly-Legends condition

The narrow ALL_FRIENDLY_LEGENDS_FACE_UP condition is derived live through RulesView/legend-face-condition. It checks that no qualifying friendly Legend is DOWN. No stored boolean, turnHistory field, exactly-three comparison or general quantifier DSL is added.

The empty set returns true by an explicit universal-text interpretation: there is no counterexample and no stated minimum. There is **no separate zero-Legend FAQ**. The test labels this as query-only and confirms that the trusted arrangement removing Yorinobu from LEGENDS fails current executable-state validation; a zero-Legend constructed deck also fails. This does not admit a new legal game state or future format.

## Legend enumeration semantics

The authoritative registry supplies physical cards with current controller/zone controller equal to the actor, printed LEGEND type and area LEGENDS or BATTLEFIELD. Owner does not define friendly. The printed LEGEND type is retained and public under rule 3.4.1 even while face-down; its hidden name and card text remain private. No hidden card text is read to decide the predicate. Trusted query-only control changes prove the distinction without implementing control transfer.

## Field Legends

Real field Hands Unclean participates and is face-up in the legal headline. It remains LEGEND+UNIT. A focused SPENT field-Legend case also qualifies; readiness does not affect face state. Impossible face-down field-Legend external state remains rejected. The shared printed-Legend query equally covers the existing V field representation, without admitting another field-entry mechanic.

## Removed/other-area Legends

Removed cards are no longer in the game under 5.13.2 and therefore do not belong to the controlled friendly Legend set. Actual Hands Unclean departure to Trash follows existing processing into Removed and leaves the two remaining Legends as the set. Trash/hand/deck/Eddies Legend probes are excluded; such areas are invalid for a Legend under 4.4. Metadata retained for transport/history does not make those cards controlled pieces in play.

## Face-down behavior

One qualifying DOWN Legend prevents Losing His Way from becoming pending at declaration. Two UP/one DOWN is false; a subsequent legal CALL can make a later attack qualify. Rival DOWN Legends are irrelevant. The ordinary attack still proceeds when the condition is false, with no +5 and no artificial target choice.

## Spent face-up behavior

READY/SPENT and UP/DOWN are independent. Focused tests spend all friendly Legends, including the field Legend, and the condition still succeeds. The headline's real face-up Legends establish the condition through CALL; their faces remain authoritative independently of payment/readiness.

## Kiroshi-known face-down interaction

A real inherited Kiroshi ATTACK look marks a friendly Legend as known while it remains DOWN. Losing's declaration condition is false, so no Losing pending effect is captured. The look does not retroactively add it. A separate direct knowledge probe and privacy checks confirm that knowledge never substitutes for reveal.

## ATTACK trigger timing

The card-specific FAQ changes the prompt's proposed resolution-only sequence: the condition must already hold at attack declaration. Existing WHEN_ATTACKING discovery filters this narrow condition; the physical Unit then joins the same captured batch as other eligible sources. No new phase, queue or retroactive discovery. A false declaration condition produces no Losing EFFECT_PENDING.

## Resolution-time condition

An eligible captured effect checks the live predicate again when selected, following 10.3.3/10.15.1. A trusted future-resolution probe changes a Legend face and proves no +5 applies. That tampered state is explicitly not accepted as a current legal continuation: none of the admitted ATTACK primitives changes face state, so strict validation requires the complete captured batch to match discovery. Future face-changing ATTACK mechanics will need a separate captured-context review. No condition cache is added.

## Temporary +5 architecture

Reuse POWER_UNTIL_END_OF_TURN with SOURCE_SUBJECT and amount 5. Complete admission requires exactly the reviewed Unit, conditions and effect. The same physical source is the subject and attacker; no player target choice. The existing POWER modifier store, current-power query, application/expiration events and departure/cleanup functions are shared with Floor It. Its own complete-card RIVAL_UNIT−1 admission remains exact.

Positive modifiers carry origin.effectId/abilityId/ordinal derived from the existing trigger ID (physical source/subject, revision, controller seat, turn and batch occurrence). Canonical order compares physical source then occurrence. Duplicate/replayed occurrences, forged source/subject, future ordinal/turn and unresolved-origin modifiers are rejected. Legacy negative modifier payloads remain unchanged.

## This-turn lifetime

The +5 remains after ATTACK_ENDED and during subsequent MAIN/end-turn pending effects. Existing end-turn cleanup expires it after card effects, before TURN_ENDED. No printed power is rewritten or effective power cached. Once applied, flipping a Legend DOWN does not remove the existing buff; it only affects a later attack's eligibility.

## Multiple-attack stacking

Rule 10.16.3 creates a separate trigger occurrence for each attack; 3.17.2 sums current modifiers, and this card has no once-per-turn/replacement clause. Two successful same-turn attacks therefore add+10. A trusted repeat-readiness test proves distinct deterministic origins, 12→17 during the second equipped/Saburo attack, then 16 after attack. Both expire at cleanup. Separate physical Losing Units receive their own buffs; the player does not gain a shared modifier.

## Gear composition

Mantis adds 2 to printed 4; Losing adds 5. Host identity, attachments and Gear object remain unchanged. Without Saburo, equipped power is 11. The existing attachment/power path prevents double counting. Gear on a Legends-area host does not affect that Legend's face predicate.

## Saburo composition

During the legal attack: 4+Mantis 2+Losing 5+Saburo 1=12. Saburo is already active after declaration and never enters the pending batch. After attack its continuous+1 ends and Losing's temporary+5 remains, leaving 11 in MAIN. End-turn cleanup leaves 6. A bare/no-Saburo focused case separately proves 4→9→9→4.

## Floor It composition

Actual rival Floor It play during React shares the modifier store: 12→11; after attack Saburo drops and power is 10; both+5 and−1 expire at end turn, leaving Mantis/base 6. The source Program and Unit retain separate modifier provenance. Tests reject attempts to admit a changed Floor It amount or self target.

## Yorinobu interaction

Losing is an exact Arasaka Unit, so its first attack records the existing source-independent history once. Yorinobu and Losing enter the same pending batch when eligible; draw/conditional discard use the existing ordered continuation. The headline resolves Losing before Yorinobu. Additional Gear ordering tests retain a single first-attack history occurrence.

## Kiroshi/Dying trigger ordering

Focused composition attaches actual Kiroshi and Dying to Losing: Losing, Yorinobu and both inherited Gear sources create four independent bindings. Different legal order selections complete through the shared scheduler. Kiroshi has no look target when all Legends are UP; Dying retains its separate delayed registration. No nested stack or merged source identity. Saburo remains continuous.

## Fight behavior

A real Satori-equipped Losing fights spent real Minotaur. With the condition true, current power wins and Satori's inherited fight-win draw becomes pending. With one Legend DOWN, no+5 applies, Losing loses and reaches Trash. Another actual fight defeats a boosted bare Losing against Minotaur+Mantis, proving public modifier lifetime after defeat. Fight uses the shared current-power query at resolution.

## Gig-steal behavior

The legal headline materially crosses the threshold: base 4+Mantis 2+Saburo 1 would steal 1; Losing+5 gives 12 and actual allowance 2. Two Gigs are selected and transferred by the authoritative Steal flow. A paired false-condition focused attack has allowance 1 and transfers only one Gig. This is verified from state/events, not display power alone.

## Post-attack MAIN power

The headline returns to MAIN at 11 power with the+5 modifier intact. No history flag stands in for the modifier. Focused tests confirm a later failed condition leaves the already-resolved buff active, and a second successful attack can add another occurrence.

## End-turn expiration

A trusted Delamain end-turn interaction pauses for a genuine Eddie choice while Losing remains at 11. EFFECT_RESOLVED precedes POWER_MODIFIER_EXPIRED, which precedes TURN_ENDED. The legal headline reaches turn 10 with only base 4+Mantis 2=6. A new-own-turn regression confirms a fresh later attack can produce a new+5 after the previous one expired.

## Source departure/modifier lifetime

Losing is an ordinary Unit. Actual defeat sends it to public Trash; its+5 remains recorded and queryable until turn expiry, while detached Gear stops contributing. A trusted hidden-entry test uses the existing movement boundary and clears the modifier immediately under 5.3.2.2. No new return-to-hand player action or general hidden-zone modifier behavior was added. Existing Removed-field-Legend/Floor It semantics remain unchanged.

## Events

Use existing ATTACK_DECLARED, EFFECT_PENDING, TRIGGER_ORDER_SELECTED, CONDITION_EVALUATED, POWER_MODIFIER_APPLIED, EFFECT_RESOLVED, ATTACK_ENDED, POWER_MODIFIER_EXPIRED and TURN_ENDED. No Goro-specific event.

A positive application contains the canonical POWER modifier and its origin. Positive expiration includes the originating effectId to distinguish stacked occurrences. Older negative application/expiration payloads stay byte-compatible. No pending Losing effect is emitted when the declaration gate fails; automatic condition/application never creates its own choice.

## Observation

Existing public card face states, current power/modifier projections and legal descriptors suffice; no new observation field or card-specific hint was added. The existing temporaryModifiers projection carries the additive positive variant. Both players observe the power change. Rival hidden Legend identities do not alter the actor's observation/action IDs. Known-DOWN identity remains private under existing Kiroshi rules.

## Training positions

The legal headline produces 53 strategic positions across 55 actions: setup/play/payment, ATTACK ordering, Yorinobu discard and Gig selections as appropriate. Automatic condition evaluation/self+5 does not produce a TrainingPosition or target action. Model input remains observation plus enumerated semantic action IDs/descriptors; the harness has no new card rules.

## Hash behavior

The canonical modifier already participates in position/replay/observation hashes. New occurrence provenance distinguishes stacked effects. Public face/modifier changes invalidate stale action IDs; transport counters do not. No new hash protocol or cached condition history.

Headline final replay-state hash `967a67839236b332aa0e2e5fa351b6bbabb7e12c69615097cc3d26ebed0152d0`; content manifest `fb6716cecf6ad7a52bf4ef0d56667246db32f899cd10ef4759b0903ce9b1e008`. Updated engine/content pins intentionally change old fixture hashes; the independent audit verifies their original semantics.

## Demo/reference coverage

**REFERENCE CARD EXECUTION COVERAGE: COMPLETE.**

| Metric | Before | After |
|---|---:|---:|
| Distinct reference cards executable /29 | 28 | 29 |
| Physical reference copies executable /60 | 59 | 60 |
| Blocked reference cards | 1 | 0 |
| Arasaka distinct /14 | 13 | 14 |
| Arasaka copies /30 | 29 | 30 |
| Merc distinct /15 | 15 | 15 |
| Merc copies /30 | 30 | 30 |

Recalculated from the actual 29 roadmap rows. Every card/deck/quantity is preserved. Existing synthetic support does not count toward real reference coverage. [Roadmap](demo-deck-coverage-roadmap.md).

## Arasaka completion status

14/14 distinct, 30/30 physical copies executable within their reviewed scopes. Losing His Way closes the final one-copy gap. Stop adding reference-card mechanics; the next blocker is format policy.

## Merc completion status

15/15 distinct, 30/30 physical copies remains complete within reviewed scopes. Psycho Squad stays three copies. Existing documented interaction limits, including Reboot's one outstanding prevention, remain.

## Demo-format readiness

**The next blocker is FORMAT POLICY, not card execution.** The exact 27-main+3-Legend lists do not yet have a reviewed supported format. No claim that the demo decks are fully playable, no DEMO_STARTER policy and no complete teaching match.

## Constructed validation

40–50 main cards, exactly 3 Legends and the existing RAM/copy/Legend-name constraints are unchanged. Tests reject 27/39/51-main and zero-Legend inputs and compare the complete prior format policy. The headline uses constructed 42-main support decks with three real Legends. Physical teaching lists are not padded.

## Replays

New family: [attack-condition-power-replay.v1.json](../tests/fixtures/attack-condition-power-replay.v1.json), 55 actions/53 strategic positions/224 events including initialization. Seed `saburo-1`. Blind CALL slots 1/2/3 on turns 1/3/5; Losing played turn 5; legal Mantis equipment and turn 9 Hands Unclean Go Solo. Losing source `p0-c11`, Mantis `p0-c5`, field Legend `p0-c1`. Turn 9 ATTACK/order/discard/React/actual two-Gig Steal→MAIN, then expiry into turn 10 CHOOSE_GIG. No state/RNG patches.

All 24 replay/golden generator scripts are required. The resulting set has 29 replay families/1042 actions. Trusted focus arrangements for repeat readiness, control/invalid areas, extra reviewed Gear and departure are explicitly separate from the legal headline.

## Original payload compatibility

Audit input is the 28 original families frozen before implementation in `/tmp/tcg-losing-before/replays`, totaling 987 original decisions. It compares semantic legal actions/descriptors, both observations, event batches and initial/final states under new pins. Regeneration alone is not compatibility evidence. Final audited results appear in Commands.

## Persistence

Mongo appends Losing His Way to the existing immutable publish/read/replay coverage. PostgreSQL stores/reloads every transition of the 55-action legal trace, compares full state, both observations, replay/position/observation hashes, legal actions and event history, and continues from each reloaded state.

Checks cover pre-attack faces, ATTACK pending, automatic condition/+5, React/Steal, post-attack MAIN at 11 and end-turn expiry/next turn at 6. Atomic condition/application is validated through the stored event batch. Existing transaction/conflict/rollback tests remain. Existing Mongo 27018/Postgres 5433 are used with isolated random test data; no schema migration or app-data seeding.

## Python/wire

The only harness change appends `attack-condition-power-replay` to the existing adapter suite family list. No Goro, Legend-face, condition, power or combat logic is added in Python. Request/response/TrainingPosition wire v1 schemas expand additively; TrainingAttempt remains byte-unchanged. Original negative modifier/event payloads remain supported. All three Python suites run without model download or training; final results appear below.

## Tests

**84 focused tests pass. Full application suite: 1028 passed, 0 failed, 0 skipped.** Live Mongo/Postgres: 2 passed, 0 skipped. Typecheck, lint, card validation, build and contracts export pass; all 24 generators succeed. Original-payload audit: 28 families/987 decisions preserved. Python: 29 replay families/1042 actions, 7 wire golden round trips, 87 gameplay tests and 48 harness-core tests pass.

No remaining lint or production-build warnings. The Python differential check retains two known legacy deck-builder gaps (`repeated-entry-copy-bypass`, `legend-in-main`); this engine milestone does not change Python deck rules. The final integration observation variables use explicit existing types to avoid a TypeScript inference limit in the long test. No `any` or unchecked cast was introduced into the engine.

Focused coverage includes full source/metadata, declaration and current-resolution checks, friendly/area/face/known/readiness queries, field Legend, zero-set scope limits, legal CALL, automatic self modifier, stacking/independent copies, actual Fight/Satori and Steal outcomes, Floor It/Saburo/Gear composition, four-source ordering, end-turn pending work, public/hidden departure, strict modifiers/continuations, stale IDs, privacy, wire and unchanged constructed policies.

The initial focused run passed 78/80; two helper errors were corrected (an unsupported all-Legends-removed arrangement was incorrectly treated as executable, and a wire request lacked actorId). Typecheck identified readonly/branded-counter assignments in tests; lint identified unused test imports; all were corrected. The first headline deck placed Losing in an undrawn slot; the final legal constructed fixture replaces the existing Swordwise slot and uses the same unmodified seed/RNG. Early commands run from the outer workspace failed to locate package.json and were rerun from the application directory. These failures are not counted as successful gates.

## Commands

Application cwd: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. The Node/npm commands use:

```sh
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

All commands below exited 0. Each generator ran individually. Full command/exit records are in `/tmp/tcg-losing-gates.json`, with logs `/tmp/tcg-losing-gate-00.log` through `-32.log`.

| Exact command | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `node --import tsx scripts/generate-attack-condition-power-replay.ts` | PASS; generated |
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
| `npm run contracts:export` | PASS; additive wire v1 schemas |
| `npm run typecheck` | PASS; codegen and both TypeScript projects |
| `npm run lint` | PASS; no warnings |
| `npm run validate:cards` | PASS; 4 starter records, separate from the 53-revision engine bundle |
| `npm test` | 1028 passed; 0 skipped |
| `npm run build` | PASS; compile, typecheck and page generation |
| `git diff --check` | PASS |

Additional application commands:

```sh
node --import tsx --test tests/attack-condition-power.test.ts
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-losing-before/replays
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
```

Results: 84 focused tests; 28 original families/987 original decisions preserved; 2 live tests with 0 skipped. Logs: `/tmp/tcg-losing-focused-2.log`, `/tmp/tcg-losing-compat.log`, `/tmp/tcg-losing-integration.log`.

Harness cwd: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```sh
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

All exited 0: adapter 29 families/1042 actions with exact states/events/observations/hashes and 7 golden round trips; gameplay 87; core 48. Adapter model input/submission/stale/envelope checks and 7 differential cases pass; its two known Python differences remain explicit. Logs: `/tmp/tcg-losing-python-adapter.log`, `/tmp/tcg-losing-python-game.log`, `/tmp/tcg-losing-python-core.log`.

Final read-only checks: `git rev-parse HEAD`, `git ls-files --stage`, `git ls-files --cached --others --exclude-standard`, SHA-256 comparisons against `/tmp/tcg-losing-before/baseline.json`, and `git diff --check` in both repos. Programmatic checks confirm 44 required report headings, resolving local links, unchanged 29 row names/decks/quantities, unchanged 52 prior content revisions, protected manifests/lockfile/.nvmrc/TrainingAttempt and exact index entries. No staging command ran.

## Files changed

Against the frozen milestone-start worktrees: **61 application files touched (51 changed, 10 added), one harness file changed, no removals**. Both HEADs and exact index entries remain unchanged. Application captured files 344→354; harness 504→504. All 503 other harness files are byte-unchanged, including raw/processed/gold data. No package manifests, lockfiles, .nvmrc, TrainingAttempt or prior immutable card revisions changed.

| Application-relative file | Change in this milestone |
|---|---|
| [docs/attack-condition-power-report.md](../docs/attack-condition-power-report.md) | Add the 44-section source, implementation, validation and boundary report. |
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Calculate 29/29 and 60/60 without quantity changes; identify format policy as next blocker. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Append complete source, printings, hashes, rulings, interactions and limits. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add narrow ATTACK_CONDITION_POWER_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add positive temporary-modifier occurrence provenance and additive expiration identity; preserve negative payloads. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add narrow all-face-up condition and self-subject positive use of existing power primitive. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add optional attackConditionPower policy. |
| [packages/engine/src/attack-condition-power-support.ts](../packages/engine/src/attack-condition-power-support.ts) | Require complete reviewed Unit shape and reject unsupported metadata, including older scopes. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Evaluate the narrow Legend-face condition against supplied current state. |
| [packages/engine/src/effects.ts](../packages/engine/src/effects.ts) | Resolve the self power condition automatically through the shared power handler. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Opt the narrow policy into existing observation-derived action IDs. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Validate new metadata across physical sources and admit its complete Unit scope. |
| [packages/engine/src/legend-face-condition.ts](../packages/engine/src/legend-face-condition.ts) | Derive controlled in-play printed Legends and their actual face-state predicate. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Route new mechanics to strict full-card admission. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Reject unsupported new condition/power metadata in external states. |
| [packages/engine/src/temporary-power.ts](../packages/engine/src/temporary-power.ts) | Reuse store/application/expiry with positive occurrences, stacking, canonical ordering and strict lifetime validation. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | Apply the card-FAQ declaration gate within existing ATTACK discovery. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | Require the complete captured ATTACK batch under the new policy. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | Admit the complete new Unit as an effective trigger source. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose read-only all-friendly-Legends-face-up query. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive v1 request schema for new condition/policy/modifier metadata. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive v1 response schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive TrainingPosition schema; TrainingAttempt remains unchanged. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Pin engine 0.4.0-attack-condition-power-1; source-derived artifact hash updates. |
| [scripts/generate-attack-condition-power-replay.ts](../scripts/generate-attack-condition-power-replay.ts) | Generate the legal setup-to-expiry headline. |
| [tests/attack-condition-power-fixture.ts](../tests/attack-condition-power-fixture.ts) | Normalize Losing@1 and extend 52→53 revisions using constructed support decks. |
| [tests/attack-condition-power-replay.ts](../tests/attack-condition-power-replay.ts) | Build 55 legal actions, 53 strategic positions and explicit power/lifetime landmarks. |
| [tests/attack-condition-power.test.ts](../tests/attack-condition-power.test.ts) | Add 84 source, semantic, interaction, validation, privacy/hash/wire and format regressions. |
| [tests/fixtures/attack-condition-power-card-source.v1.json](../tests/fixtures/attack-condition-power-card-source.v1.json) | Pin complete three-printing source, four errata and local/live evidence hashes. |
| [tests/fixtures/attack-condition-power-replay.v1.json](../tests/fixtures/attack-condition-power-replay.v1.json) | Add the 55-action/224-event legal headline and current pins. |
| [tests/fixtures/attack-condition-power-rules.v1.json](../tests/fixtures/attack-condition-power-rules.v1.json) | Pin 362 complete rule nodes, 3 complete FAQs and reviewed scope/inference decisions. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/minotaur-replay.v1.json](../tests/fixtures/minotaur-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/over-the-edge-replay.v1.json](../tests/fixtures/over-the-edge-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/targeted-spend-replay.v1.json](../tests/fixtures/targeted-spend-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/value-conditions-replay.v1.json](../tests/fixtures/value-conditions-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing wire goldens under the new engine pins. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerate engine/content pins and derived hashes; original family semantics preserved by independent audit. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Add immutable Mongo publication/read and full PostgreSQL attack/expiry trace comparisons. |

Harness: [scripts/test_engine_adapter.py](../../tcg_ai_training/cyberpunk_llm/scripts/test_engine_adapter.py) appends only the new replay-family name. No Python rules changed. The final preservation audit is retained at `/tmp/tcg-losing-final-audit.json`; original snapshots remain under `/tmp/tcg-losing-before`. No commit, push or staging was performed.

## Unsupported mechanics

Faceplate, WHEN_SPENT/general spend dispatch, refactoring all spending paths, control-transfer actions, face-changing ATTACK primitives, new hidden-return actions, general quantifier/condition/modifier languages, DEMO_STARTER, teaching exceptions and a full exact-deck match remain outside scope. Yorinobu still cannot leave LEGENDS in executable states. Repeated readiness/control/zero-set/future-resolution probes are trusted tests, not admitted player mechanics. Existing scope limitations remain documented.

## Ambiguities not guessed

The official FAQ overrides the proposed resolution-only timing: declaration eligibility is required, then current-resolution conditions are checked. Field/Removed membership follows explicit control/area rules. Stacking follows separate trigger occurrences plus summed current modifiers; there is no once-per-turn/replacement clause.

No explicit zero-Legend FAQ was found. Empty-set truth is identified as a logical reading of the universal text, tested only outside the supported executable state boundary; it does not certify a legal zero-Legend game. Future ATTACK face-changing effects require review of captured batch validation. Exact demo legality is still unknown; printing metadata and individual-card coverage are insufficient evidence.

## Recommended next milestone

**CYBERPUNK TCG — DEMO_STARTER FORMAT REVIEW.** Source 27-card main-deck legality, exactly 3 Legends, copy/RAM rules, teaching exceptions, setup/mulligan/first-player procedures, win conditions/overtime, and whether the two printed lists are intended for direct play. Define an explicit policy only after that evidence is reviewed.

Only then build the first exact Arasaka-vs-Merc 30-card deterministic demo match. No further reference-card mechanic is needed for the current lists. No commit, push, staging, corpus refresh, model download or training was performed.

