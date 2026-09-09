# Inherited Gear capabilities milestone

Mandibular Upgrade now has a complete reviewed executable revision. It grants inherited Blocker to its legal host through a derived capability query; the existing host-based Blocker action performs spending, redirection and combat. The new legal replay finishes at MAIN. All 255 application tests, live persistence integration and sixteen Python replay families pass.

## Runtime

Node **22.13.0**, npm **10.9.2**, application package **0.3.0**, Next.js **16.3.4**. Engine artifact **`0.4.0-gear-capabilities-1`**, hash `0a58040418ecea8db1a654c2ee669b9f8cf946c672b284d9f88d1af678e45d95`. No dependency, lockfile, environment, Next.js or database migration changes were required.

## Mandibular exact captured semantics

The complete local `cyberpunk_llm/data/raw/cards/mandibular-upgrade.json` record was inspected, including every printing and the four captured errata. Mandibular is a **Yellow RAM 2, cost 1, printed power 0, sellable Gear/Cyberware**. Its complete captured text is:

> (Equip to a friendly Unit or face-up Legend.)
> {Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)

The executable revision represents default equip, `GRANT_PRINTED_POWER_TO_HOST` with the printed zero, and `GRANT_KEYWORD_TO_HOST: BLOCKER`. It has no additional trigger, activated effect, restriction or classification bonus. The keyword is inherited text, not a keyword printed on the Gear as its own Unit ability. Parenthetical reminders create no extra effects. No executable line was dropped.

Only this card is newly admitted, as **revision 1 / GEAR_CAPABILITIES_V1 / SUPPORTED**. [The source fixture](../tests/fixtures/gear-capabilities-card-source.v1.json) retains every raw field and all five printing objects. [Executable coverage](executable-card-coverage.md#gear_capabilities_v1-mandibular-upgrade) lists raw-byte, canonical source and normalized revision hashes, the five UUIDs and demo collector number 005. No local erratum matches Mandibular. No source data was refreshed.

## Inheritance rules reviewed

[gear-capabilities-rules.v1.json](../tests/fixtures/gear-capabilities-rules.v1.json) pins **101 exact local rule records** and the implementation decisions. The raw comprehensive-rule capture and processed records were inspected for inheritance, reminder text, duplicates, equip/departure, Blocker, Lag and Unit/Legend type requirements. The four raw/processed capture hashes are:

| Capture | SHA-256 |
|---|---|
| Raw rules | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed rules | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Raw errata | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

| Rule | Exact local excerpt |
|---|---|
| 3.17.2 | “3.17.2. A Unit or Legend’s power is equal to the power printed on the card plus the power of its equipped Gear and any current effect modifiers.” |
| 3.18.1.2.2.1 | “3.18.1.2.2.1. Reminder text is not effect text, and does not influence gameplay.” |
| 3.18.3 | “3.18.3. While a Gear is equipped to a Unit or Legend, that Unit or Legend inherits any text in the Gear’s bottom textbox. See CARD TYPES > Gears.” |
| 4.2.1 | “4.2.1. Legends on the field are both Units and Legends.” |
| 4.10.1 | “4.10.1. By default, a Gear can be equipped to a friendly Unit or friendly face-up Legend.” |
| 4.10.2 | “4.10.2. You can only equip Gear to a card in the field or Legends area.” |
| 4.10.3 | “4.10.3. There’s no upper limit on the number of Gears equipped to a single Unit.” |
| 4.11.3 | “4.11.3. The bottom textbox contains effects inherited by the Unit or Legend the Gear is equipped to. Read the bottom textbox as if it's printed on that Unit or Legend.” |
| 4.11.3.1 | “4.11.3.1. Effects described in a Gear card’s bottom textbox apply only to the Unit or Legend the Gear is equipped to, not the Gear itself.” |
| 4.12.1 | “4.12.1. When a Gear moves with a Unit or Legend to an area outside of the field or Legends area, the Gear isn’t equipped to the Unit or Legend in that area.” |
| 9.9 | “9.9. You may activate the [BLOCKER] effect on a ready Unit as a reaction.” |
| 9.9.1 | “9.9.1. When a Unit uses [BLOCKER], it becomes the defending Unit, fully replacing the previous attack target.” |
| 11.3.1.1 | “11.3.1.1. Lagging Units can’t attack.” |
| 11.3.1.2 | “11.3.1.2. Lagging Units can’t activate [Spend Icon] effects.” |
| 11.24.1 | “11.24.1. The [BLOCKER] keyword is shorthand for “When a rival Unit attacks, you may spend this Unit to redirect the attack to it instead.“” |
| 11.24.2 | “11.24.2. Activate [BLOCKER] as a reaction during the React Step of your Rival’s attack action.” |
| 11.24.3 | “11.24.3. When a Unit uses [BLOCKER], it becomes the target of the attacking Unit’s current attack.” |

No blanket duplicate-keyword rule was found. The implementation retains each source of inherited text and projects the equivalent host spend/redirect permission once. That conclusion follows the specific action semantics in 9.9/11.24; it is not an assumption that all duplicate keywords, activated effects or triggers are interchangeable. Satori's multiple draw triggers remain independent.

## Effective keyword/capability architecture

A strict `GRANT_KEYWORD_TO_HOST` modifier accepts only the reviewed literal `BLOCKER`. `gearCapabilities: GEAR_CAPABILITIES_V1` opts the ruleset into the new shape with reviewed equip and React policies. Admission checks the complete cost/power/equip/modifier shape, review provenance and absence of extra executable mechanics. Dropped zero-power inheritance, extra triggers, extra keywords, altered cost/power, unsupported grants and old execution scopes fail closed, including while the source is in hand/deck.

`RulesView.getEffectiveKeywords`, `getEffectiveCapabilities` and `getCapabilitySources` derive printed identities and supported attached sources. The existing `getKeywords` selector now delegates to the same derivation. Each capability has canonical physical source references; keyword identity is deduplicated while source identity is retained. No capability or keyword arrays are added to GameState or CardInstance.

The capability query uses the same `host.attachments` relation and `attachedGear` lookup as power and Satori's inherited trigger query. Power, triggers, keywords and attack restrictions remain separate typed domains on one RulesView. The power query recognizes the supported keyword modifier without treating it as arithmetic. No temporary keyword-grant effect is currently admitted; existing combat restrictions continue to combine with eligibility through their own reviewed query.

## Source vs host semantics

Mandibular's physical instance and immutable CardId/revision are the source. The equipped Unit/Legend is the subject; its controller is the actor. Current legal attachment requires matching area/controller and face-up Gear/host. Inheritance starts when normal equip completes and ends as soon as that relation ends. The Gear and host printed revisions are never mutated.

A continuous grant is not an independently pending effect. It is derived now from current attachments; Satori's already-pending trigger lifetime remains governed by its previous snapshot rules. No second attachment graph or Gear-specific boolean is introduced.

## Blocker eligibility changes

The existing `isBlockerEligible` now asks whether the admitted host has effective BLOCKER, instead of requiring a printed BLOCKER keyword on that host's revision. It preserves all other checks: defender React decision, defender controller/location, BATTLEFIELD, face up, READY, effective Unit type, supported host shape and a blockable attack.

`listBlockers` and `listLegalActions` reuse that query. The action remains **`DECLARE_BLOCKER(hostInstanceId)`**. Its existing reducer spends the host and makes it the current defending target. No Mandibular action, separate reducer or alternative combat pipeline was added.

## Printed vs inherited Blocker behavior

Focused tests compare Secondhand Bombus's printed Blocker with ordinary Psycho Squad plus Mandibular. They emit identical semantic Blocker event payloads for the same host identity, redirect to that host and leave it spent. Trusted test preparation may advance event provenance counters; the compared gameplay payloads remain identical. After spending, neither a printed nor another inherited source permits an immediate second declaration.

Every previous replay family retains its original semantic payload and event compatibility. Printed Corpo/Bombus behavior is also covered by the unchanged earlier suites.

## Lag interaction

Rules 11.3.1.1–11.3.1.2 forbid lagging attacks and Spend-icon effects. BLOCKER has its separate keyword-defined cost under 11.24. A focused test proves the same ordinary host is attack-source eligible without Lag, becomes attack-source ineligible with Lag, and can still spend through inherited Blocker in React. Readiness and all other Blocker requirements still apply.

## Cannot-attack composition

Corpo Security retains CANNOT_ATTACK. Equipping Mandibular gives it a second physical source of Blocker without overwriting its printed source or attack restriction. There is one host Blocker action. Removing Mandibular leaves Corpo's printed Blocker available and its attack prohibition unchanged.

## Cannot-be-blocked composition

Flathead's current Street Cred restriction governs the attack. Tests suppress both a printed Blocker defender and an inherited Blocker defender while Flathead's condition is true, retaining real CALL, Quick and PASS actions. Changing the current comparison to make the condition false restores Blocker. Capability source does not bypass the existing restriction.

## Multiple Mandibular behavior

Two legally attached copies remain distinct physical Gear and distinct source records. The effective keyword list contains BLOCKER once and the engine emits one equivalent host spend/redirect action. Each grant would require spending the same ready Unit to produce the same current target; there is no extra use or different outcome to enumerate. This is a bounded action-equivalence decision, not a universal duplicate-keyword rule.

Tests reverse source/object insertion order and verify canonical source enumeration. Removing one copy leaves the grant; removing the last removes it. No cleanup flags are touched.

## Gear removal behavior

Tests cover Gear departure to Hand, Trash and Removed through the existing trusted departure semantics, immediately removing the inherited keyword and Blocker action. The public trusted MAIN movement API is also exercised. A focused reattachment restores the derived grant only after equip; simply returning cards to Hand does not preserve inheritance.

Host departure moves its Gear and detaches it under the existing shared rules, with the same immediate loss of capability in all three destinations. For a Legend leaving to Trash, Gear stays there when the Legend is subsequently removed. No Blocker-specific cleanup was added.

## Legend host behavior

A friendly face-up Legend in the Legends area is a legal equip host. It may possess effective BLOCKER text but **cannot actually declare Blocker**: 9.9/11.24 require a ready Unit, and 4.2.1 assigns Unit type to field Legends, not Legends-area Legends. Hidden Legends and rival hosts are not legal equip targets. Go Solo and field-Legend execution remain unadmitted.

A Royce test shows the existing printed GO_SOLO keyword remains visible alongside inherited BLOCKER without enabling Go Solo execution. Royce's own-turn power is 6 + Mandibular's 0 + the existing 2-per-Gear modifier = **8**. A Null-power Legend remains Null.

## Events

No event kind was added. GEAR_ATTACHED/DETACHED, CARD_MOVED, BLOCKER_SPENT, BLOCKER_DECLARED and the existing fight/defeat/cleanup facts explain the complete flow. BLOCKER_DECLARED identifies the host; attachment events and current content provide source provenance. Deriving a capability emits no event.

Satori + Mandibular + Mantis on Psycho is tested together: power **6 + 0 + 2 + 2 = 10**, inherited Blocker, and a separate Satori fight-win draw. No mechanic overwrites another.

## Observation

The new opt-in policy adds public `effectiveKeywords` to face-up field/Legends-area card observations. Both players see the attached Gear and host relation. Private hands, unrevealed Legend identities and future RNG remain protected. Internal capability-source objects are not added to the model observation; RulesView can supply them for engine/debug queries.

Only the defender receives React legal actions. Descriptors still say “Block with [host]”; the model selects the ordinary engine-generated actionId. It need not implement inheritance or choose a physical Gear source to block.

## Training positions

The new replay contains **29 genuine decisions** among 31 actions. Its natural React state offers inherited Blocker, Quick, CALL and PASS. Positions are generated only when more than one legal action exists. Derived keyword computation, forced arithmetic and automatic resolution do not become samples.

The headline uses legal engine-owned setup, fixed seed, constructed support decks, ordinary turns/payment/equip and existing combat. Focused trusted test preparations are explicitly labeled and are not substituted for the headline. These are implementation-reviewed regression fixtures, not human-certified gold or full games.

## Demo coverage

The current 29-row roadmap was checked before edits and recalculated after admitting only Mandibular's two Merc copies.

| Metric | Before | After |
|---|---:|---:|
| Distinct executable cards / 29 | 14 | 15 |
| Without executable revisions | 15 | 14 |
| Arasaka executable distinct / 14 | 5 | 5 |
| Arasaka executable copies / 30 | 14 | 14 |
| Merc executable distinct / 15 | 9 | 10 |
| Merc executable copies / 30 | 16 | 18 |
| Combined executable copies / 60 | 30 | 32 |

[The roadmap](demo-deck-coverage-roadmap.md) preserves every physical quantity, including three Psycho Squad, three Satori and two Mandibular. Earlier revisions and scoped Reboot limitations remain unchanged.

## Demo match readiness

**Can exact Arasaka initialize? No. Can exact Merc initialize? No. Can they run a complete match? No.** Both physical lists remain **27 main + 3 Legends = 30** and lack an independently reviewed demo-format policy. Arasaka still lacks nine distinct executable cards (16 copies); Merc lacks five (12 copies). No DEMO_STARTER or full starter match was introduced.

## Constructed validation

Official constructed remains **40–50 main cards, three Legends, maximum three copies and the reviewed RAM rules**. The new replay uses 42 main cards and three legal support Legends with appropriate RAM. A 27-main input remains rejected. The demo lists were not padded and no validator was weakened.

## Replays

Family 16 is [mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json), seed **`capabilities-59`**, **31 actions / 29 positions / 142 events**, final MAIN. The defender legally plays Psycho, later equips Mandibular, then blocks Swordwise's Gig-area attack. The ordinary host spends, becomes the defending target, wins the fight and remains equipped after cleanup. No state/RNG patching occurs in generation.

All fifteen previous families were regenerated and remain green. Before editing, their exact working-tree fixtures were copied to `/tmp/tcg-capabilities-before`; this was necessary because the immediately preceding milestone initially existed as uncommitted work. The separate compatibility audit replayed every original action payload under updated engine/content manifest pins and compared every original initialization event batch, transition event batch and pre-action observation. All fifteen passed, including Satori, Dexter and Jackie. This does not rely on regenerated hashes alone.

Regeneration exposed one pre-existing fixture-authoring dependency: the DEFEATED headline chose a stolen Gig by artifact-dependent actionId ordering. Selecting D4 instead of its original D6 could remove the Street Cred difference needed for draw two. Its generator now explicitly selects the original D6, preserving the intended legal scenario and seed. No game rule changed to fix that fixture. Other older incidental hash-sorted fixture choices remain technical debt.

## Persistence

Live Mongo/Postgres integration passed **2 tests, 0 skips**. Mongo publishes, reads and replays Mandibular's immutable revision alongside the existing revision/history/search checks. PostgreSQL creates the replay with different transport UUIDs, persists and reloads every boundary, and verifies legal action IDs, exact history, replay/position hashes, attachment, redirection, fight and final MAIN.

Capability remains derived after reload; no stored keyword array or migration is needed. Existing transaction rollback, stale state, event-history, ledger and previous combat traces remain covered. The tests use isolated random databases/schemas and clean them up in finally blocks.

## Python/wire

Wire remains additive **v1**, POSITION_V2 unchanged. Request, response and TrainingPosition schemas were regenerated; TrainingAttempt was exported and stayed byte-identical. Only the response/observation adds public effective keyword information; typed content gains the bounded modifier/scope/policy. GameAction and event vocabularies remain unchanged.

Python adds one fixture name to the existing generic offline Node JSONL adapter loop plus interop documentation. All **16 replay families**, **7 wire round trips** and **7 differential cases** pass. No inherited-keyword rules, power arithmetic, history or canonical hashing was added to Python. The game suite passes **87 tests**; harness/core passes **48**. No model download, training, corpus refresh, human/evaluation data or harness/core implementation changes occurred.

## Tests

| Gate | Result |
|---|---|
| node / npm | 22.13.0 / 10.9.2 |
| typecheck | Pass |
| lint | Pass, no warnings |
| validate:cards | Pass: 4 original starter records |
| focused capability suite | 25 passed |
| complete application suite | 255 passed, 0 skipped |
| production build | Pass; existing `/api/graphql` route retained |
| contracts:export | Pass |
| original 15-family payload/observation/event audit | Pass |
| live Mongo/Postgres integration | 2 passed, 0 skipped |
| Python adapter | 16 families + 7 wire + 7 differential cases passed |
| Python game / harness core | 87 / 48 passed |
| git diff --check, both repositories | Pass |

The four records reported by `validate:cards` are the original starter fixture set, not the reviewed gameplay revision count or 151-card captured corpus. New full-shape admission, manifest/replay checks and live Mongo round trips validate Mandibular separately.

Early focused failures were test-authoring corrections: trusted movement changes event sequence provenance, and Royce retains its printed GO_SOLO keyword alongside inherited BLOCKER. Tests now compare semantic event payloads and assert both keywords without enabling Go Solo. A test-only TypeScript union of card/Gig target arrays was narrowed with an element predicate rather than a cast. All final checks pass; no tests or lint rules were disabled.

## Commands

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Every Node/npm command used this runtime prefix:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
npm run typecheck
npm run lint
npm run validate:cards
node --import tsx --test tests/gear-capabilities.test.ts
npm test
npm run build
npm run contracts:export
git diff --check
```

The version probe ran as `sh -c 'node -v && npm -v'`. Output was captured in `/tmp/tcg-capabilities-{runtime,typecheck,lint,cards,focused,test,build,contracts}.log`. Typecheck/lint and focused checks were rerun after relevant authoring fixes.

All generator commands ran with the pinned Node executable:

```bash
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
```

The batch initially stopped at the DEFEATED fixture issue described above. After fixing that fixture's selector, the remaining two generator commands passed. Receipts: `/tmp/tcg-capabilities-regenerate.log`, `/tmp/tcg-capabilities-regenerate-triggers.log`, `/tmp/tcg-capabilities-generate.log`.

Live persistence command, approved for the existing local services:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
npm run test:integration
```

Original-payload audit, output `/tmp/tcg-capabilities-legacy-payloads.log`:

```bash
node --import tsx - <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict');const {createContentBundle}=require('@tcg/domain');const {createGameWithEvents,applyAction,observe}=require('@tcg/engine');const {engineIdentity}=require('./scripts/engine-identity.ts');const unwrap=r=>{assert.ok(r.ok,JSON.stringify(r));return r.value};
for(const family of ['turn','setup','reviewed','noncombat','gear','combat-attack','react','fight','gig-steal','prevention','permissions','vanilla','satori','defeated','first-blue']) {
 const before=JSON.parse(fs.readFileSync(`/tmp/tcg-capabilities-before/${family}-replay.v1.json`));const context={content:createContentBundle(before.content.ruleset,before.content.cards,engineIdentity())};
 const initial=unwrap(createGameWithEvents(before.initialization,context));assert.deepEqual(initial.events,before.initialized.events);let state=initial.state;
 for(const [i,step] of before.steps.entries()){assert.deepEqual(unwrap(observe(state,step.actorId,context)),step.observation,`${family} original observation ${i}`);const next=unwrap(applyAction(state,step.action,context));assert.deepEqual(next.events,step.events,`${family} original events ${i}`);state=next.state;}
 console.log(`${family}: ${before.steps.length} original payloads; exact original observations and event batches; final ${state.timing.step}`);
}
JS
```

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

Python receipts are `/tmp/tcg-capabilities-python-{adapter,game,core}.log`. Read-only inspection/audits used `rg`, `rg --files`, `cat`, bounded file reads, `git status`, `git diff`, `git log`, `git ls-files`, `node --import tsx -` and `python3` for source hashes, legal seed authoring, coverage arithmetic and file/report inventory. No fetch/ingestion/training or git mutation command was run.

## Files changed

Measured against the before-turn byte-hash baseline: **44 application files and 2 harness files** changed. Existing corpus, raw/processed source files, human/evaluation data and prior standalone reviewed card fixtures are unchanged. Most diff volume is regenerated replay content.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Admit only Mandibular, recalculate exact distinct/copy counts, retain deck quantities and update future blockers. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Document complete card shape, exact text, hashes, five printing UUIDs, inheritance and limitations. |
| [docs/gear-capabilities-report.md](../docs/gear-capabilities-report.md) | New full rules/implementation review, commands, gate results, file inventory and scope decisions. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add explicit GEAR_CAPABILITIES_V1 execution scope. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add bounded GRANT_KEYWORD_TO_HOST modifier with literal BLOCKER. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add opt-in gearCapabilities policy pin. |
| [packages/engine/src/attachments.ts](../packages/engine/src/attachments.ts) | Route complete new Gear admission through existing equip/attachment invariants. |
| [packages/engine/src/capabilities.ts](../packages/engine/src/capabilities.ts) | New shared derived printed/inherited keywords with canonical physical source/host/controller references. |
| [packages/engine/src/capability-support.ts](../packages/engine/src/capability-support.ts) | New full-shape and hidden-zone admission validation; old policies fail closed. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Recognize supported keyword grants separately from power arithmetic. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Admit complete new Gear and return typed metadata failures before constructing RulesView. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Expose optional public effectiveKeywords only under the new policy on face-up active-area cards. |
| [packages/engine/src/react-queries.ts](../packages/engine/src/react-queries.ts) | Use supported host plus effective BLOCKER in the existing eligibility query. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Validate bounded capability metadata without adding persisted capability state. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose effective keywords/capabilities/source queries and reuse derivation in existing keyword selectors. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive v1 request contract for the reviewed content metadata and public effective-keyword observation. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive v1 response contract for the reviewed content metadata and public effective-keyword observation. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive v1 trainingPosition contract for the reviewed content metadata and public effective-keyword observation. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Increment behavior artifact to 0.4.0-gear-capabilities-1. |
| [scripts/generate-gear-capabilities-replay.ts](../scripts/generate-gear-capabilities-replay.ts) | Generate the new legal headline fixture and action/position/event/hash receipt. |
| [tests/combat-triggers-replay.ts](../tests/combat-triggers-replay.ts) | Make the existing DEFEATED headline explicitly select its original D6 steal, independent of artifact hash order. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate existing combat-attack replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate existing defeated replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate existing fight replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate existing first-blue replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/gear-capabilities-card-source.v1.json](../tests/fixtures/gear-capabilities-card-source.v1.json) | New complete Mandibular raw snapshot, five printing objects, source-byte and errata hashes. |
| [tests/fixtures/gear-capabilities-rules.v1.json](../tests/fixtures/gear-capabilities-rules.v1.json) | New 101-record exact local rule snapshot, source hashes and bounded interpretation decisions. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate existing gear replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate existing gig-steal replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | New legal setup/equip/Blocker/fight replay: 31 actions, 29 positions, 142 events, final MAIN. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate existing noncombat replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate existing permissions replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate existing prevention replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate existing react replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate existing reviewed replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate existing satori replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate existing setup replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate existing turn replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate existing vanilla replay/actions/positions/hashes with the new artifact; original payload, observations and events independently audited. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing wire requests/responses/action IDs and hashes for the new artifact. |
| [tests/gear-capabilities-fixture.ts](../tests/gear-capabilities-fixture.ts) | Handwritten immutable Mandibular normalization and legal constructed support context/decks. |
| [tests/gear-capabilities-replay.ts](../tests/gear-capabilities-replay.ts) | Author the legal pinned-seed headline without state/RNG patching. |
| [tests/gear-capabilities.test.ts](../tests/gear-capabilities.test.ts) | 25 focused source/admission, eligibility, composition, movement, visibility, validation and wire regression tests. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Round-trip Mandibular in Mongo and verify every replay boundary plus complete PostgreSQL history. |

| Harness file, relative to `cyberpunk_llm` | Change |
|---|---|
| `docs/engine-interop.md` | Document artifact, sixteen-family traversal and the derived capability/observation boundary. |
| `scripts/test_engine_adapter.py` | Add Mandibular to the existing generic actionId fixture traversal loop. |

## Unsupported mechanics

Kiroshi/private Legend look, Dying Night/named-host end-turn behavior, Go Solo, field-Legend execution, a general inherited keyword/effect framework, temporary keyword grants, full demo-format rules, complete starter matches and the remaining card pool remain unsupported. Earlier Reboot overlap and recursive trigger/replacement limits remain unchanged. Source metadata is a bounded opt-in, not automatic admission of other Gear.

## Ambiguities not guessed

No generic duplicate-keyword stacking rule was invented. Every Mandibular source is retained; one equivalent host action is exposed because the reviewed Blocker action spends the same host and produces the same redirection. This does not deduplicate Satori triggers or establish semantics for other future keywords.

The source review uses pinned local JSON/text and errata; it is an implementation review, not a new publisher-image or human-gold certification. No complete authoritative demo-format capture was inferred from deck/printing metadata. Legends-area equip permission does not imply field-Unit status or Go Solo support.

Kiroshi's captured text is inherited ATTACK → privately look at a friendly face-down Legend without revealing it, printed power 1. Its equip reminder erratum is already reflected in the local record. Dying Night has printed power 2, inherited ATTACK decrease a Gig by up to 2, and an end-turn named-V condition to ready two Eddies. The shared inheritance/source boundary lowers plumbing cost for both; their private knowledge and named-host/end-turn semantics remain separate work.

Remaining technical debt includes older fixture selectors that depend on hash order, the legacy public empty-area Street Cred observation approximation, and the Python legacy deck validator's known `repeated-entry-copy-bypass` and `legend-in-main` gaps. The Node engine remains authoritative. Final build and lint emit no warnings.

## Recommended next milestone

Review Kiroshi Optics as one complete bounded card: inherited ATTACK, friendly hidden-Legend inspection, private knowledge identity/lifetime, observation, replay and persistence. It removes three Merc copy blockers if fully admitted. Keep Dying Night's named-host/end-turn cluster and Go Solo/field Legends separate. Continue using the exact roadmap and unchanged constructed validation to assess readiness.

No staging, commits or pushes were performed by this agent. Existing work was preserved; this report inventories only changes relative to the byte baseline captured at the start of this pass.
