# Delamain Cab and Dying Night: end-turn history review

Completed 2026-09-09. **Delamain Cab is fully admitted; Dying Night remains explicitly blocked.** The smallest complete boundary is recurring own-turn end effects, per-Unit actual-steal history and readying one spent Eddie. Dying Night's captured single ATTACK paragraph requires a separate delayed-effect review. No partial card admission, corpus refresh, model training, commit or push.

## Runtime

Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Behavior artifact **0.4.0-end-turn-history-1**, SHA-256 `77fcd223ef73f6edebe36f4f4119f3d846918c4b156befea921af9743fab096b`.

## Cards reviewed

Both complete local raw records, all five printings per card and all four captured errata were reviewed before implementation. No erratum applies to either. [The complete source fixture](../tests/fixtures/end-turn-history-card-sources.v1.json) preserves them; [executable-card-coverage.md](executable-card-coverage.md#end_turn_history_v1-delamain-cab) lists every printing UUID, set, collector number, source hash and the admitted normalized revision hash. Raw source bytes and parsed records were compared to the unchanged harness corpus.

## Dying Night exact full shape

`dying-night-v-s-pistol`; Gear / Merc / Weapon; Blue RAM2; Eddie cost2; printed power2; sellable; Rare; artist Ivan Shavrin. Merc demo013 printing `dd423c67-68f4-4da8-884c-cbeb91554c0d`. No additional keyword or reminder beyond this exact text:

> (Equip to a friendly Unit or face-up Legend.)
> {Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit is named "V", ready 2 Eddies.

The ATTACK and end-turn sentences are **one captured paragraph**. Rules 10.1.1/10.1.2 define that as one effect. Consequently, splitting the tail into a separately recurring end-turn ability is not a reviewed normalization. Full support needs ATTACK-created delayed-effect registration, multiplicity for repeated attacks, source/subject lifetime, the later named-Unit check and ready2 selection timing. **No executable revision is admitted.**

Raw SHA-256 `ff35eafac6b1c3c89c3eef1d997dad09a03244fbdd00ff577cc25dfd8ba320b0`; canonical record hash `33229b2912f87aadec96b43ab24bc7b39d2a569ab4bed37676c2797d05011069`.

## Delamain exact full shape

`delamain-cab`, immutable application revision1, `END_TURN_HISTORY_V1 / SUPPORTED`. Unit / Vehicle; Blue RAM2; Eddie cost4; printed power4; **unsellable**; Common. Retail/demo artist CD PROJEKT RED; beta artist Daniel Valaisis. Merc demo009 printing `e15c07b6-f563-4825-aad4-6b3068c1ab85`.

> At the end of your turn, if this Unit stole a Gig this turn, ready 1 Eddie.

This is **this physical Unit**, **your turn**, and **one Eddie**. It is not a player-wide steal condition, a per-Gig trigger or ready2. No other executable clause, reminder, keyword, modifier, equip selector, activation or restriction is present. Existing payment, ordinary Unit play/Lag, derived power, attacks, React, fights and stealing remain authoritative.

The normalized ability is `WHEN_OWN_TURN_ENDS`, condition `SUBJECT_STOLE_GIG_THIS_TURN`, cost NONE, effect `{kind:"READY_EDDIES",player:"CONTROLLER",count:1}`. Admission checks the complete typed shape, independent of card-name dispatch. Raw SHA-256 `201a4b6123f8c7ce153a86af4abf6d1e225f0dc7c618982bc081a0b0d453292c`; canonical record hash `e0b999c826a7b7456d86a4142b168e9b43825563c600ca2f39fd18b40f5df473`; revision hash `e696327e1483d61a95b00550b25412645f19f2a3feef6cf584b346a64f0ffddd`.

## End-turn rules reviewed

[The focused rules fixture](../tests/fixtures/end-turn-history-rules.v1.json) preserves **175 numbered rules**, decisions and raw/processed capture hashes. It covers ready/spent (3.5–3.8), name/subtitle (3.9–3.10), Eddies (5.8), Main passing/end checks/advance (8.9, 8.16–8.18), stealing (9.23), paragraph/condition/pending-order/lifetime/choice rules (10.1–10.15, 10.31), Gear inheritance, Lag and ATTACK.

Raw rules SHA-256 `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`; processed `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`. Raw errata `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75`; processed errata `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340`.

## Exact end-turn sequence

1. Legal END_TURN enters the TURN_END automatic step (8.9).
2. Discover qualifying face-up battlefield own-turn sources and enqueue independent pending effects (8.16.1, 10.3/10.4).
3. Choose same-controller order when needed; recheck the selected ability's condition; resolve readiness, pausing only for a real choice.
4. Complete the entire pending batch. Preserve the previous cleanup order: remove Lag, expire temporary power and unused Reboot (11.3.2, 8.16.2).
5. Emit TURN_ENDED, advance active player/global turn and invoke startTurn (8.18).
6. Reset current-turn history and CALL/SELL usage at that next-turn boundary, then run the existing TURN_STARTED, ready/draw/Gig-choice sequence.

No next-player draw, CHOOSE_GIG or TURN_STARTED occurs while Eddie/order choices remain. No intermediate MAIN or second END_TURN is required. The pre-existing unsupported-overtime preflight still rejects the whole ending action atomically; this milestone does not implement overtime.

## Pending end-turn scheduling

The existing scheduler receives additive `TriggerOrigin {kind:"END_TURN",playerId,turn}` and continuation phase READY. The ordinary pending/current/bindings/resolvedIds partition and controller ordering remain unchanged. Resumption calls the extracted end-turn cleanup directly. There is no LIFO stack, nested queue or card-specific handler.

Malformed origins, turns, actors, sources, options, duplicates, orphan windows and forged early MAIN are rejected atomically. A pending source moving to Trash retains its captured identity under 10.15; it does not need to remain in the battlefield to resolve. Absence before discovery yields no trigger. Control-changing effects are outside this admitted boundary.

## Named-host semantics

Rules 3.9.2 and 3.10.2 exclude subtitles from Name and explicitly distinguish V variants sharing Name V. Existing immutable `deckbuildingIdentity` pins that printed-name identity, while CardId is a distinct slug. A future bounded predicate can compare the exact stable identity; no display-name parsing, substring matching or new character-name DSL is needed.

Dying Night's Gear instance would be the source and its equipped host the subject. The printed condition also says **this Unit**. Default equip permission for a face-up Legend does not establish that a Legends-area Legend is a Unit. Real V — Corporate Exile and field Legend execution remain unsupported. No named-host runtime predicate or synthetic V card was added because the full Dying Night effect is blocked.

## Dying Night inherited ATTACK

Existing attachment inheritance, printed-power derivation and WHEN_ATTACKING discovery are suitable dependencies, but not enough to certify the full paragraph. Its delayed tail must remain attached to the reviewed ATTACK effect. No partial Gear/ATTACK revision, priority override or extra recurring trigger was introduced.

## Gig adjustment behavior

Delamain does not adjust Gigs. Dying Night's unqualified “a Gig” permits either player's rolled Gig in GIGS, excluding Fixer (6.1.2–6.1.4). “Up to 2” permits nonnegative whole-number choices within the existing face bounds: 0 through min(2, currentValue−1) (6.3.3, 6.4, 10.31.3). Zero requests no decrease and does not count as an actual adjustment. This settles the ordinary target/bounds subcomponent without admitting the delayed tail. Existing derived Gig queries, adjustment operations and sequential choice infrastructure remain available; their smaller admitted shapes were not falsely relabeled as full Dying Night support. No clamping or impossible reduction is added.

## Gig-steal history semantics

Only actual combat `GIG_STOLEN` facts update history, after the authoritative Gig movements (9.23.5/9.23.6). The key is the **attacking physical Unit**, regardless of whether it is Delamain. Each stolen Gig contributes one count. A two-Gig steal still produces one end-turn effect from each qualifying Delamain.

Attack declaration, React, selecting a future stolen Gig and generic `transferGigControl` do not record stealing. Current ownership/control is never used as a history substitute. Focused tests cover another Unit's steal, rival own-turn effects, earlier-turn stolen Gigs still controlled now and non-steal transfers.

## Turn-history model

The existing canonical history remains the single summary: turn, triggeredBatches, blueUnitOrGearPlays and optional `gigsStolenByUnit: Record<CardInstanceId, positive integer>`. The new map is absent until an actual steal. Validation requires the supported bundle, current turn, nonempty positive counts and existing physical Unit references. No general event ledger/query language, duplicate player total or stored predicate boolean was introduced.

## History reset timing

Combat cleanup, React actor changes, ordinary Main actions and end-turn choices preserve history. startTurn replaces the whole summary only after the old turn's pending effects and cleanup finish. CALL/SELL usage resets there as before. Public current-turn history and prior Kiroshi private memory therefore have separate lifetimes.

## Eddie readiness operation

A narrow `readyEddie` operation validates a current own spent face-down EDDIES slot, changes its actual CardInstance SPENT→READY, and emits existing CARD_READIED. It preserves identity, revision, location, underlying content and pile order. Ready Eddies, Legends and rival Eddies are not candidates (3.8, 5.7/5.8). There is no numeric currency mutation.

## Eddie selection

Delamain requires one, without “may” or “up to.” Zero eligible Eddies resolves as much as possible; one is automatic; two or more offer mandatory `EDDIE_READY_SELECTION` to the effect controller. A public `EDDIE_SLOT` option labels the choice “Ready Eddie N.” The headline has two eligible slots; focused tests include three.

Both players are forbidden to inspect underlying face-down Eddie identities (5.8.3.1). Public slot/readiness selects the physical object without disclosing CardId, revision or original sold-card name. Stale actionIds reject after public options/readiness change. Two-Eddie sequential-versus-batch timing is not certified; the typed primitive intentionally supports count1 only.

## Multiple end-turn effects

Two Delamains that each actually stole produce two independent pending effects. Both order permutations are tested under 10.12. One effect resolves completely before the next; the next rederives eligible Eddies and cannot ready an already-ready Eddie again. Conditions are checked at discovery and resolution (10.3/10.15.1); no admitted end-turn primitive changes steal history while paused.

Rule 10.13's turn-player-first logic remains in the shared scheduler. Delamain says “your turn,” so rival Delamains do not qualify at this boundary. Cross-player end-turn sources are not invented to exercise a timing case these admitted cards cannot create.

## Dying Night + Delamain interaction

Not executable together because Dying Night is unadmitted. Two qualifying Delamains prove the actual shared same-controller ordering and current-readiness behavior. This is not claimed as a Dying Night delayed-effect interaction test.

## Turn-duration/Reboot expiration ordering

8.16.1 card effects precede 8.16.2 expiration. Floor It's modifier, unused Reboot, Lag and current-turn usage/history remain present during the Eddie choice; expiration/cleanup follows EFFECT_RESOLVED. A focused test also preserves Kiroshi memory. Old cleanup event ordering is unchanged for all 18 original replay inputs.

## Events

No new event kind. Existing GIG_STOLEN, PHASE_CHANGED, EFFECT_PENDING, TRIGGER_ORDER_SELECTED, CONDITION_EVALUATED, CARD_READIED, EFFECT_RESOLVED, LAG_REMOVED, modifier/prevention expiration, TURN_ENDED and TURN_STARTED make the chain auditable. No card-specific logs or redundant history-update event were added. Full event/state records are authoritative private data, not a model payload.

## Observation

Observation adds the EDDIE_READY_SELECTION window and optional public `gigSteals:[{attackerId,count}]`, sorted by physical attacker identity. Counts derive from public actual steals. The acting controller sees eligible Eddie slots and normal entitled information; the rival cannot enumerate those actions. Swapping underlying sold-card identities/revisions leaves both observations and ready-choice action IDs equal. No hidden hand, Eddie content, RNG or private Kiroshi content leaks into model input.

## Training positions

The headline produces **33 strategic positions**, including the two-option Eddie choice. Focused tests cover strategic source order and larger eligible sets. Forced source selection, a single Eddie, zero-target completion, condition checks and turn advancement create no separate fake TrainingPosition. Model input stays `{observation, legalActions:[{actionId,descriptor}]}`. TrainingAttempt is unchanged.

## Hash behavior

ReplayStateHash and POSITION_V2 include the authoritative per-Unit history and unfinished scheduler state. Identical boards with/without this-turn steal history are strategically different and hash differently. This additive bundle uses observation-derived action identity even without requiring Kiroshi. Underlying hidden Eddie content changes full-state hashes, while public ready-choice IDs stay equal. Transport match/version/event counters do not determine those IDs. Old bundle behavior remains unchanged.

## Demo coverage

Recalculated from all 29 original roadmap rows and their unchanged physical quantities:

| Metric | Before | After |
|---|---:|---:|
| Distinct demo cards | 29 | 29 |
| Executable distinct | 17 | 18 |
| Without executable revisions / known blockers | 12 | 11 |
| Arasaka distinct / 14 | 5 | 5 |
| Arasaka copies / 30 | 14 | 14 |
| Merc distinct / 15 | 12 | 13 |
| Merc copies / 30 | 24 | 27 |
| Combined copies / 60 | 38 | 41 |

Only Delamain's three copies were added. Arasaka and all previous immutable revisions are unchanged.

## Remaining Merc blocker(s)

Dying Night — V's Pistol: **2 copies**, full delayed ATTACK/end-turn/named-Unit/ready2 behavior. V — Corporate Exile: **1 copy**, Go Solo/field Legend admission. No other Merc card was newly blocked or silently admitted.

## Demo match readiness

**Neither exact demo initializes or runs a complete deterministic match.** Both lists are 27 main +3 Legends, and still lack complete executable coverage. DEMO_STARTER legality is not established by printing metadata and requires a separate later source review.

## Constructed validation

Official **40–50 main, exactly3 Legends**, copy and RAM limits are unchanged. Tests validate the 42-main constructed support list and reject 27 main, four copies and two Legends. The replay is synthetic constructed support with actual complete reviewed card revisions, not a legal demo deck or human gold.

## Replays

All 18 previous replay families plus new Delamain are regenerated and pass. The Delamain seed is `end-turn-8`: legal setup, actual SELL/payment and two Delamain plays, Lag clearing, a Gig-area attack/PASS/actual steal by the first Unit, second payment spending the two sold Eddies, END_TURN, a real two-slot Eddie choice and next turn6/CHOOSE_GIG. **33 actions, 33 positions, 140 events**. No state or RNG patching in the headline.

Final replay hash `f9671abe1952983b7d58540c89fce3a52e8062abbe71b772840eb685f046b679`. Trusted movement/state construction is confined to focused semantic negative/interaction tests.

## Original payload compatibility

Before edits, the 18 original replay files and SHA-256 workspace inventory were preserved in `/tmp/tcg-end-turn-before`. `/tmp/tcg-end-turn-audit.cjs` reconstructs each original content bundle with only new engine/manifest pins, submits the **original action payloads**, compares sorted semantic legal-action sets including descriptors, exact observations, initialization/events, every event batch and final state (apart from the three expected pins).

**PASS: 18 families, 558 original decisions.** This separate audit does not rely on regenerated expected hashes or replace original actions with whatever the new enumerator happens to choose. Opaque actionIds can change with engine pins; semantic actions and descriptors must not. The refreshed artifacts are then independently checked by Node and Python.

## Persistence

**2/2 live tests passed, no skips**, against MongoDB `127.0.0.1:27018` and PostgreSQL `127.0.0.1:5433`. Tests create and clean only randomized test databases/schemas. Mongo publishes/round-trips the new complete immutable Delamain revision and verifies replay semantics. PostgreSQL saves and reloads every headline step, checks hashes, both viewer observations, actions and full event history, then submits each next action from the reloaded state. This covers pending origin, history, Eddie selection/readiness, continuation and next-turn reset. Existing ledger/conflict/rollback coverage also passes. No migration or persistent development catalog seed was needed.

## Python/wire

Wire **v1 remains additive**; request, response and TrainingPosition JSON schemas and wire goldens are regenerated. TrainingAttempt schema bytes are unchanged. Python submits only actionId to the generic Node worker; no new rule, card, history, timing or Eddie code is in Python. Its sole edit adds Delamain to the replay list.

**19 replay families / 591 authoritative actions**, seven golden round trips, model projection, stale/invalid envelope checks and seven deck differential cases pass. Two existing Python legacy deck-validation gaps remain reported: `repeated-entry-copy-bypass` and `legend-in-main`. Node remains authoritative. Python game tests **87/87**, harness-core **48/48**. No model download or training run.

## Tests

**351/351 Node tests**, including **32 new focused tests**. Live integration **2/2**. Typecheck, lint, card validation, production build and contract export pass. `validate:cards` still reports **4 base fixture records**; it does not count this experimental reviewed replay bundle or the harness corpus. There were no final runtime/compiler/lint/build warnings.

During development, type checking caught an incorrect assumption that timing stored a separate phase property; the implementation uses the existing step/window and continuation origin. The invalid property/assertion was removed before regeneration and the final green gates. An initial replay seed search used a stale synthetic-only sell filter; the legal replay now selects an enumerated SELL action. Neither issue was hidden by weakening validation.

## Commands

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Every Node/npm command used `PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH`.

| Command | Final result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | Exit0; both TypeScript projects and codegen |
| `npm run lint` | Exit0; no warnings |
| `npm run validate:cards` | Exit0; 4 base fixture records |
| `npm test` | Exit0; 351 passed, 0 skipped |
| `npm run build` | Exit0; Next16.3.4 compilation, types and static/dynamic routes |
| `npm run contracts:export` | Exit0; additive schemas regenerated |
| `node --import tsx --test tests/end-turn-history.test.ts` | Exit0; 32 focused tests |
| `node --import tsx /tmp/tcg-end-turn-audit.cjs` | Exit0; 18 original families / 558 decisions |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | Exit0; 2 live tests, no skips |
| `git diff --check` | Exit0 in both repositories |

The following generator commands all exited0 (run sequentially by a Python subprocess driver; no concurrent fixture writes):

```bash
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-end-turn-history-replay.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-wire-golden.ts
```

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`. All exited0:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

Logs from this run are `/tmp/tcg-end-turn-{typecheck,lint,build,tests,generators,integration,python-adapter,python-game,python-core,audit}.log`. Read-only source/hash and roadmap-row scripts additionally verified exact corpus bytes and coverage arithmetic.

## Files changed

Changes are measured against the saved **start-of-milestone working tree**, which already contained earlier uncommitted work. **52 application files and 1 harness file** changed in this pass. Earlier unrelated changes were preserved. No source corpus, dependency manifest/lockfile, database migration or TrainingAttempt schema changed.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Admit Delamain only; recalculate all 29 rows and correct Dying Night blocker. |
| [docs/end-turn-history-report.md](../docs/end-turn-history-report.md) | Full milestone review, boundaries, verification results and file inventory. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Complete source/printing/hash/semantics documentation for both reviewed cards. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add the explicit END_TURN_HISTORY_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add end-turn origin, ready-choice timing and optional per-Unit turn history. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add typed own-turn trigger, subject-steal condition, ready1 primitive and public Eddie slot choice. |
| [packages/engine/src/combat-resolution.ts](../packages/engine/src/combat-resolution.ts) | Record per-attacker history only after actual GIG_STOLEN facts. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Evaluate the current-turn physical-subject steal predicate. |
| [packages/engine/src/eddie-ready.ts](../packages/engine/src/eddie-ready.ts) | New narrow eligibility query and actual CardInstance readiness operation. |
| [packages/engine/src/end-turn-support.ts](../packages/engine/src/end-turn-support.ts) | New full-shape admission and strict metadata/history validation. |
| [packages/engine/src/end-turn.ts](../packages/engine/src/end-turn.ts) | New extracted end-turn entry/resume path with existing cleanup order. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Route END_TURN through scheduler and expose public-safe ready labels/action identity. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Require complete new-scope admission at initialization. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Expose ready-choice timing and public steal counts while keeping Eddie content hidden. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Admit the complete reviewed ordinary Unit shape. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Apply metadata checks and recognize stable Eddie-selection boundaries. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | Discover own-turn sources and derive current public-slot readiness options. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | Reuse the pending scheduler for condition/ready choices and exact end-turn resumption. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | Validate end-turn origin, pending sources, continuation and exact current choices. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | Include full admitted end-turn sources in effective trigger support. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose the reviewed Eddie eligibility query through RulesView. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive wire v1 schema from domain/engine contracts. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive wire v1 schema from domain/engine contracts. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive wire v1 schema from domain/engine contracts. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Increment the behavior artifact; package/application version stays unchanged. |
| [scripts/generate-end-turn-history-replay.ts](../scripts/generate-end-turn-history-replay.ts) | Generate the legal Delamain replay and metrics. |
| [tests/end-turn-history-fixture.ts](../tests/end-turn-history-fixture.ts) | Normalize complete Delamain revision1 and construct the bounded content/deck bundle. |
| [tests/end-turn-history-replay.ts](../tests/end-turn-history-replay.ts) | Deterministic legal action replay with actual sales/payment, steal and end-turn choice. |
| [tests/end-turn-history.test.ts](../tests/end-turn-history.test.ts) | 32 focused admission, history, readiness, scheduler, privacy, hash and format tests. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | New 33-action / 140-event golden, including strategic Eddie TrainingPosition. |
| [tests/fixtures/end-turn-history-card-sources.v1.json](../tests/fixtures/end-turn-history-card-sources.v1.json) | Pin both full raw card records, ten printings and all captured errata. |
| [tests/fixtures/end-turn-history-rules.v1.json](../tests/fixtures/end-turn-history-rules.v1.json) | Pin 175 local rules, hashes, source-review decisions and supplemental limitations. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate this existing replay under new pins; original payload separately audited. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate seven wire vectors under the new behavior artifact. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Round-trip Delamain in Mongo and reload/resume its full end-turn replay in PostgreSQL. |

Harness: `cyberpunk_llm/scripts/test_engine_adapter.py` adds only `delamain-replay` to the existing generic replay loop. All other harness file hashes match the saved baseline.

## Unsupported mechanics

Dying Night/delayed end-turn registration, named-host runtime predicates, ready2 batching, Go Solo, field Legends, V admission, generic event-history queries, ready-any-card effects, new demo format, complete demo matches and Arasaka expansion remain outside this implementation. Existing overtime and overlapping Reboot limitations remain. Executable replay bundles are not automatically imported into the production Mongo catalog.

## Ambiguities not guessed

The missing Dying Night point is delayed-effect lifetime/multiplicity and the relationship of its single ATTACK paragraph to later end-turn work. A narrow official page lookup repeats the same text; it does **not** establish an independently recurring trigger or settle those lifetime questions. The official demo image returned HTTP403, so visual paragraph separation was not verified. No supplemental ruling was invented, and the pinned corpus was not refreshed. [Official Dying Night page](https://cyberpunktcg.com/cards/dying-night-v-s-pistol).

Existing printed-name identity is sufficient for a future exact V comparison, but identity alone does not turn a Legends-area Legend into “this Unit.” Ready2 batching and Dying Night's interaction with other ATTACK sources are not claimed from Delamain's ready1 tests. The source review and blocker are recorded even though only Delamain is admitted.

## Recommended next milestone

Resolve **Dying Night's ATTACK-created delayed end-turn effect** first: obtain authoritative timing/lifetime evidence, define the minimal immutable delayed continuation and named-Unit condition, review ready2 selection timing, then admit its complete Gear/ATTACK/end-turn behavior with legal replay and interaction tests. Go Solo + battlefield Legends follows as a separate structural boundary. Keep DEMO_STARTER legality as a later independent source-review milestone.
