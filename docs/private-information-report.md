# Kiroshi Optics: private information milestone

Completed against the existing application and harness working trees on 2026-09-08. Only Kiroshi Optics receives a new full-card execution decision. Previous milestones, constructed policy, original catalog fixtures and the captured harness corpus remain intact. No commit, push, model download, training or ingestion was performed.

## Runtime

Node **22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine behavior artifact: **0.4.0-private-information-1**. The executable fixture uses ruleset version `private-information-1` and additive card scope `GEAR_PRIVATE_LOOK_V1`, with existing reviewed Gear and combat-trigger policies. No new global gameplay feature flag or persistence migration.

Engine artifact hash: `ba70849f8a8fd2da693c6a939a687964e29c07153d3cdabcc858c0af9afa0c3f`.

## Kiroshi exact captured card

Reviewed the complete local `cyberpunk_llm/data/raw/cards/kiroshi-optics.json`, all five printing objects and all four captured errata. The applicable erratum corrects the equip reminder; the raw card already contains that correction. The other errata concern Johnny Silverhand's Beta Iconic sell tag and Nocturne/Judy artist credits. No corpus refresh was needed.

| Field | Reviewed value |
|---|---|
| Application CardId / revision | `kiroshi-optics` / 1 |
| Display name | Kiroshi Optics |
| Type / classification | Gear / Cyberware |
| Color / RAM | Yellow / 1 |
| Printed Eddie cost / power | 1 / 1 |
| Sellable | Yes; ordinary base Eddie value 1 |
| Printings | Retail 061; Beta β061; Heist Retail 007; Heist Beta β007; Merc Demo 004 |
| Default equip | Friendly Unit or friendly face-up Legend, in field/Legends area |
| Inheritance | Printed Gear power and bottom-text ATTACK effect |
| Extra executable components | None; no omitted keyword, restriction, activation cost or condition |

Complete captured text:

> (Equip to a friendly Unit or face-up Legend.)
> {Attack} Look at a friendly face-down Legend. (Don't reveal it.)

The raw API `keywords: []` does not erase brace-markup ATTACK. It is normalized explicitly as `WHEN_ATTACKING`; it is not a static keyword. The complete fixture, printings and errata are in [private-information-card-source.v1.json](../tests/fixtures/private-information-card-source.v1.json). The typed immutable revision is in [private-information-fixture.ts](../tests/private-information-fixture.ts). [Executable coverage](executable-card-coverage.md#gear_private_look_v1-kiroshi-optics) lists printing UUIDs and source hashes.

Canonical raw-record hash: `437f9f77917cb88b25b0f2386f7afba8bada54b869d2810f4c0da3b698666502`. Normalized immutable revision hash: `85e33a64bce450f9864f402be2f6d380936c9de91e92031708d70b289096d4d9`.

## Printed power

`GRANT_PRINTED_POWER_TO_HOST` uses the existing attachment/characteristic query. A real Psycho Squad host has printed power 6; Kiroshi makes its effective power 7. No cached bonus or host revision mutation exists. A Null-power Legend remains Null. Detaching Kiroshi removes its contribution immediately; existing remembered information is independent of the Gear's continued presence.

## Inherited ATTACK semantics

Rules 4.11.3–4.11.3.1 make Gear bottom text the host's inherited text; 11.21.2 triggers ATTACK when the host is spent to declare an attack. The binding distinguishes physical Kiroshi source, attacking host subject and host controller. The Gear does not attack.

The shared effective-trigger query discovers the inherited ability, creates an ordinary PendingEffect and uses the existing scheduler. The attack returns to `finishAttackEffects`, performs existing validity checks and opens React only after all ATTACK effects resolve (11.21.2.2). No new scheduler or card-slug check exists in combat.

## Look vs Reveal rules

The review pins **210 local rule records** and the unchanged raw/processed source hashes in [private-information-rules.v1.json](../tests/fixtures/private-information-rules.v1.json).

| Rule | Consequence |
|---|---|
| 5.7.4.1 | Face-down Legends are hidden; inspection requires permission. |
| 5.7.4.2 | Known Legends must be visually distinguished to the rival without revealing identity; physically separating them is permitted. |
| 5.7.4.3 | The effect does not grant permission to look again after resolution. |
| 11.14.1–11.14.3 | REVEAL shows the card to the rival; Kiroshi explicitly says not to reveal. |
| 10.2.1, 10.7, 10.31 | Resolve what is possible; no target means no choice, and required available targets are selected. |
| 5.3.2.5 | A choice not requiring hidden qualifying information cannot intentionally fail to find a legal target. |

LOOK keeps face DOWN, the same Legends-area location and the same physical card. It emits no CARD_REVEALED or LEGEND_CALLED event. A slot's public known marker is required even though its identity is private.

## Private knowledge architecture

Authoritative GameState gains an optional nonempty canonical array:

```ts
privateKnowledge?: readonly {
  kind: "LOOKED_AT_LEGEND";
  viewerId: PlayerId;
  cardInstanceId: CardInstanceId;
  content: { cardId: CardId; revision: CardRevision };
}[];
```

The entry represents remembered immutable identity, not a continuing inspection entitlement. No raw card records, UI-only memory, Set/Map serialization or conversational memory is required. `grantLegendKnowledge` is an internal deterministic effect operation. Repeated legitimate looks produce separate semantic events but do not duplicate memory. Arrays sort by viewer seat and physical instance ID; an empty result removes the optional field.

Admission checks the complete equip/power/inherited-trigger/effect shape. Extra or dropped mechanics, wrong scope, unsupported status or unreviewed provenance fail. Older Gear scopes cannot hide private-look metadata in deck/hand cards. State validation rejects invalid viewers/objects, nonfriendly or non-Legend targets, stale CardRefs, revealed/departed targets, duplicates, noncanonical ordering and knowledge during setup. It never repairs malformed incoming state.

## Knowledge identity

The record follows the **marked physical CardInstance**, not an interchangeable slot. This follows the specific permission in 5.7.4.2 to physically separate known Legends. Public action choices use current slot indices; observation maps the marked object to its current slot. A trusted tracked-reordering test moves the known card to another position and verifies that memory follows that physical card rather than leaking the identity of the replacement slot.

## Knowledge lifetime

Memory persists through ordinary turns and trackable physical separation while the same marked Legend remains face-down in its Legends area. The snapshot does not permit a second inspection action. A second Kiroshi trigger can independently grant a new look.

This is a bounded remembered-identity model for unchanged immutable cards. It is not a statement that all hidden cards are remembered forever or that future identity-obscuring randomization can preserve perfect tracking.

## Knowledge invalidation

CALL makes identity public and removes the now-redundant private record. The shared card-movement lifecycle removes the record on departure, including trusted Legend removal. Arbitrary state edits leaving stale knowledge are rejected. Initial setup randomization has no knowledge, and setup states containing it are invalid.

The capture supplies no later Legend randomization effect establishing how marked Legends would participate. No such action, effect or general shuffle API was introduced; unsupported operations fail closed. No arrangement epoch was needed for the admitted transitions. Before adding a future identity-obscuring effect, review its exact handling of marked cards and add explicit invalidation if required. The tested physical separation is trackable, not a simulation of an unreviewed concealed shuffle.

## PlayerObservation

A known face-down Legend retains `publicId: "seat:0:LEGENDS:0"`, `face: "DOWN"` and no public `content`. Both players see `knownToSeats: [0]`, satisfying the required marker. Only player 0 receives `rememberedContent: { cardId, revision }`.

Pending choices disclose eligible public slots through legal descriptors. The entitled viewer can also see previously remembered identities in their observation. The opponent sees public pending-effect source/host and the fact that a known slot exists, without the hidden Legend CardRef/name/physical ID.

## Events / visibility

`LEGEND_LOOKED_AT` contains only viewer ID, Legend seat and public slot. Learned identity is stored in authoritative private state and projected only to the entitled observation. There is no identity-bearing public look event.

The existing complete event stream is **authoritative private replay data**: setup shuffle order, draws, search order and technical physical IDs already appear there. PostgreSQL history and local wire `transition` responses retain that data. The wire is a trusted local engine boundary accepting full state, not a public client API. A source comment now states that boundary explicitly. GraphQL's current resolvers expose card queries and deck validation; there is no gameplay/history resolver forwarding these batches. No public event feed needed a new visibility discriminator in this bounded change.

TypeScript `modelInput` and Python `EngineAdapter.model_input` project observation plus actionId/descriptor only. Full wire transitions, stored history and TrainingPosition artifacts must not be forwarded directly to models or clients. Negative tests check the public look batch and opponent prompt for the actual hidden CardId, display name and physical Legend ID.

## Hash behavior

| Hash / identity | Behavior |
|---|---|
| ReplayStateHash | Includes authoritative knowledge plus existing full state/transport details. |
| ObservationHash | Includes only that viewer's memory and public markers. |
| POSITION_V2 | Includes strategically meaningful knowledge; UUIDs normalize to seats and version/event counters remain excluded. |
| New-bundle actionId | Hashes entitled observation plus semantic action; CALL uses a public slot. It no longer hashes hidden full PositionHash. |

Swapping unlearned hidden identities leaves pre-look observations, slot choices and action IDs identical. Memory changes the knowledgeable player's observation and position hashes. Changing remembered hidden identity with the public marker fixed leaves the opponent's observation hash identical. UUID/version/event counter changes preserve semantic position and observation/action IDs.

**Necessary qualification to the requested unchanged-opponent-hash example:** initially adding memory also adds the marker required by 5.7.4.2, so the opponent's hash must change for that public fact. A test proves the marker is the only opponent difference; another holds markers fixed and proves private identity changes do not affect the opponent hash. Hiding the marker to force equal hashes would contradict the captured rule.

Older pinned bundles retain their historical action-ID protocol to preserve compatibility. Their v1 full-position-derived IDs should not be promoted as the new private-information client protocol. New scope bundles use observation-derived IDs; engine/content validation and the existing application version/command contracts remain authoritative.

## Multiple Kiroshi behavior

Rules 4.10.3, 4.11.3 and 10.16.2 support each equipped physical Gear's independent inherited text. Two copies create two bindings and two PendingEffects. Each resolves its own look; selecting the same slot is legal and idempotent for memory, while choosing different slots records both identities.

## Trigger ordering

Same-controller effects use existing `TRIGGER_ORDER_SELECTION` (10.12). Each selected look can pause at TARGET_SELECTION, retaining source, host, batch and ATTACK return. After that look, the next pending effect resolves before React.

Focused tests cover both orders for two Kiroshi, Kiroshi plus older printed Swordwise ATTACK, and Kiroshi plus Dexter's ATTACK Gig choices. The older printed ATTACK source joins the existing shared scheduler when inherited ATTACK must coexist. Legacy pinned replay behavior remains intact.

## Kiroshi + Satori

The same attachment graph discovers Kiroshi at ATTACK and Satori only after a winning FIGHT_RESULT. A focused legal attack/fight sequence verifies private look, React, fight comparison, Satori draw and then defeat/cleanup. The triggers are neither merged nor moved to the wrong timing window.

## Kiroshi + other Gear power composition

Tests combine host base power, Kiroshi +1, captured Mantis power, Satori +2 and a legally played rival Floor It −1 temporary modifier through ordinary characteristic queries. A face-up Legends-area host can equip Kiroshi and inherit text without gaining permission to attack or execute Go Solo. Detachment removes future inherited power/trigger behavior while retaining already learned information.

## CALL-after-look behavior

The headline replay later CALLs the exact physical Legend looked at. Its revealed CardRef matches remembered identity, both observations now contain public `content`, the remembered field/public known marker become redundant and disappear, and the attack/CALL return path reaches MAIN normally.

## Training positions

The new replay has **29 genuine strategic positions**. Multiple hidden slots produce a real information-acquisition choice; zero targets skip and one target resolves automatically without a fake target-choice position. A later MAIN decision includes the remembered Legend for its owner. The opponent's React position contains only the public marker.

Full TrainingPosition includes authoritative state for private replay and validation. Only its `modelInput` projection is suitable for prompting. Equivalent public boards with different private knowledge have different POSITION_V2 hashes, preventing their accidental deduplication. Imported positions remain validated against authoritative observation/action derivation. TrainingAttempt is unchanged.

## Demo coverage

Recalculated from the actual roadmap rows, preserving every physical quantity:

| Metric | Before | After |
|---|---:|---:|
| Distinct demo cards | 29 | 29 |
| Reviewed executable distinct | 15 | 16 |
| Without executable revisions | 14 | 13 |
| Arasaka distinct | 5/14 | 5/14 |
| Arasaka physical copies | 14/30 | 14/30 |
| Merc distinct | 10/15 | 11/15 |
| Merc physical copies | 18/30 | 21/30 |
| Combined physical copies | 32/60 | 35/60 |

Only the three Kiroshi copies change coverage. [The roadmap](demo-deck-coverage-roadmap.md) lists every remaining blocker.

## Demo match readiness

Exact Arasaka initialization: **No**. Exact Merc initialization: **No**. Complete starter match: **No**. Both physical lists remain 27 main + 3 Legends, below constructed minimum; Arasaka also lacks nine distinct executable cards (16 copies), Merc four (9 copies). No DEMO_STARTER policy or invented deck padding.

## Constructed validation

Official reviewed policy remains **40–50 main cards, three Legends and existing copy/RAM rules**. The new replay uses explicit legal 42-main synthetic support decks; they are not modified physical starter lists. The full regression suite retains deck validation coverage. `npm run validate:cards` still validates four original application catalog fixtures, not the total number of experimental executable revisions.

## Replays

All **17** families regenerated. Kiroshi: seed `private-look-16`, 31 legal actions, 29 positions, 136 total events, final MAIN. Final ReplayStateHash: `6637d462c27109e0247831857ab21b35d8ae23d3ad2fa616d3de5bb546b987e5`.

Its trace uses actual setup choices, turn rolls, SELL, host PLAY/payment, Kiroshi PLAY/payment/equip, a later DECLARE_ATTACK, hidden-slot choice, private look, rival PASS, ordinary Gig combat/cleanup, MAIN and CALL. No state/RNG patch is used in headline generation. Trusted host/card placement, tracked separation and departure are separately labeled focused-test operations.

Before editing, all 16 original working-tree replay files were copied to `/tmp/tcg-private-before/`. The independent `/tmp/tcg-private-audit.cjs` replays their **510 original serialized actions** against the new engine with updated content pins. It compares every original semantic legal-action set/descriptor, observation, exact event batch, initialization events and final state (apart from updated artifact/manifest pins). **All 16 passed.** Receipt: `/tmp/tcg-private-audit.log`.

This is separate from regenerating hashes. Existing replay authors sometimes choose the first hash-sorted action; changing artifact pins can therefore select different default fixture trajectories during regeneration. The audit explicitly uses the preserved original inputs, so it verifies unchanged behavior under the same choices even when regenerated fixture defaults select another legal choice. No prior gameplay reducer was changed to accommodate a new golden.

## Persistence

Real MongoDB at `127.0.0.1:27018` and PostgreSQL at `127.0.0.1:5433` passed both integration tests, with no skips. Mongo publishes, reads back and idempotently republishes the new immutable Kiroshi revision. PostgreSQL runs all existing traces plus the full Kiroshi trace through the existing JSON state/event transaction.

At every new trace boundary the test reloads and compares exact state, both observations and hashes, legal actions and complete history. It observes persisted face-down private memory before the later matching CALL removes it. Existing transaction rollback, stale writes, incomplete-history detection and command-ledger tests remain green. Tests use randomized temporary database/schema names and clean them in finally blocks; no persistent development content migration or seeding was required.

## Python/wire

Wire v1 request/response/TrainingPosition JSON Schemas are additive and regenerated; wire goldens were regenerated. TrainingAttempt bytes remain unchanged. Python adds only the generic seventeenth fixture name plus interop documentation. No Python rule or private-memory implementation, harness/core change, model download or training.

All 17 Node-authoritative families, seven wire goldens and seven existing differential cases pass. The existing Python deck-validation gaps `repeated-entry-copy-bypass` and `legend-in-main` remain documented; Node remains authoritative.

## Tests

| Gate | Final result |
|---|---|
| Typecheck | Pass |
| ESLint | Pass, zero warnings |
| Catalog validation | Pass, four fixtures |
| Application tests | 285 passed, zero failed/skipped; 30 new focused tests |
| Production build | Pass; Next compilation, type checking and six static pages |
| Contracts export | Pass |
| Original-payload compatibility | 16 families / 510 original decisions passed |
| Mongo/Postgres | 2 passed, zero skipped |
| Python adapter | 17 families, 7 wire goldens, 7 differential cases passed |
| Python game / core | 87 / 48 passed |
| git diff --check | Pass in both actual repositories |

Early checks caught test-only event-name/wire-envelope expectations and readonly type annotations, which were corrected. One full-suite run preceded schema regeneration and failed the exported-schema comparison; exporting the additive contracts resolved it, and the complete suite was rerun. The initial exploratory ESM stdin import failed against CJS emission; the corrected CJS probe found a legal seed. These were development failures, not remaining warnings.

## Commands

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. Each Node/npm command used `PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH`.

```bash
node -v                         # v22.13.0
npm -v                          # 10.9.2
npm run typecheck               # pass
npm run lint                    # pass, zero warnings
npm run validate:cards          # 4 records
npm test                        # 285 pass
npm run build                   # pass
npm run contracts:export        # pass
node --import tsx --test tests/private-information.test.ts
node --import tsx /tmp/tcg-private-audit.cjs  # 16 / 510 pass

git diff --check                # pass
```

The focused command passed 28 tests before the final two focused cases were added; the complete 285-test gate includes all 30. Exact regeneration commands, run sequentially by the Python subprocess driver:

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
node --import tsx scripts/generate-private-information-replay.ts

TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
npm run test:integration          # both real database tests pass
```

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`.

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

Receipts: `/tmp/tcg-private-{typecheck,lint,validate-cards,test,build,contracts,regenerate,audit,integration,python-adapter,python-game,python-core}.log`. Read-only inspection used `rg`, `rg --files`, bounded `cat`/`sed` reads, `git status`/`diff`/`ls-files`, Node probes and Python for raw hashes, legal seed search, original-input comparison and coverage/file arithmetic. Byte-hash baseline: `/tmp/tcg-private-before/baseline.json`.

## Files changed

Measured against the before-turn working-tree byte hashes: **51 application files and 2 harness files**. Prior uncommitted work is preserved. Earlier immutable reviewed card fixtures, the four original catalog cards, TrainingAttempt schema, environment files, package manifests/lockfiles, raw/processed corpus and human/evaluation data are byte-unchanged. Most output volume is regenerated replay JSON.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Admit only Kiroshi; recalculate coverage/readiness and next blockers. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Document full card, erratum, printings, source hashes and private-look scope. |
| [docs/private-information-report.md](../docs/private-information-report.md) | This complete source/implementation/validation report and file inventory. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add bounded GEAR_PRIVATE_LOOK_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Typed authoritative remembered-Legend records and public slot-only look event. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Typed private-look primitive and public Legend-slot choice. |
| [packages/engine/src/attachments.ts](../packages/engine/src/attachments.ts) | Admit full private-look Gear through existing attachment boundary. |
| [packages/engine/src/card-movement.ts](../packages/engine/src/card-movement.ts) | Invalidate hidden-Legend memory on shared movement. |
| [packages/engine/src/combat.ts](../packages/engine/src/combat.ts) | Discover inherited ATTACK sources and use the existing scheduler. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Public slot descriptors and observation-derived IDs for new-scope bundles. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Deck-wide private-look metadata admission before gameplay/setup. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Public known markers and entitled remembered identity on anonymous slots. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Route the new complete inherited Gear scope before legacy rejection. |
| [packages/engine/src/private-knowledge.ts](../packages/engine/src/private-knowledge.ts) | Deterministic targeting, grant/forget lifecycle and canonical state validation. |
| [packages/engine/src/private-look-support.ts](../packages/engine/src/private-look-support.ts) | Complete-shape admission, scope opt-in and old-scope fail-closed validation. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Integrate knowledge and private-look metadata invariants. |
| [packages/engine/src/trigger-queries.ts](../packages/engine/src/trigger-queries.ts) | Discover new inherited and compatible printed ATTACK sources; slot choices. |
| [packages/engine/src/trigger-resolution.ts](../packages/engine/src/trigger-resolution.ts) | Resolve zero/forced/strategic looks through existing pending continuation. |
| [packages/engine/src/trigger-state.ts](../packages/engine/src/trigger-state.ts) | Validate look choice phases and supported inherited/printed bindings. |
| [packages/engine/src/trigger-support.ts](../packages/engine/src/trigger-support.ts) | Shared scheduler admission for complete supported trigger sources. |
| [packages/engine/src/turn.ts](../packages/engine/src/turn.ts) | Remove redundant hidden-object memory on CALL reveal. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive wire/TrainingPosition JSON Schema. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive wire/TrainingPosition JSON Schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate additive wire/TrainingPosition JSON Schema. |
| [packages/wire/src/index.ts](../packages/wire/src/index.ts) | Document authoritative private transition/history transport boundary. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Advance behavior artifact to private-information-1. |
| [scripts/generate-private-information-replay.ts](../scripts/generate-private-information-replay.ts) | Generate legal Kiroshi replay and positions. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | New private authoritative replay with 31 actions, 29 positions, 136 events. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/private-information-card-source.v1.json](../tests/fixtures/private-information-card-source.v1.json) | Complete raw card, five printings, all four captured errata and byte hash. |
| [tests/fixtures/private-information-rules.v1.json](../tests/fixtures/private-information-rules.v1.json) | 210 exact local rule records and unchanged corpus hashes. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing replay/golden for current artifact pins; original-input behavior audited separately. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Publish/read new revision; persist full look/memory/CALL trace and both views. |
| [tests/private-information-fixture.ts](../tests/private-information-fixture.ts) | Reviewed immutable revision and legal constructed support bundle. |
| [tests/private-information-replay.ts](../tests/private-information-replay.ts) | Deterministic setup/play/equip/attack/look/React/CALL authoring. |
| [tests/private-information.test.ts](../tests/private-information.test.ts) | 30 focused admission, privacy, lifecycle, ordering, power, hash and wire tests. |

| Harness file | Change |
|---|---|
| `docs/engine-interop.md` | Document viewer memory/public markers, private transport, hashes, lifecycle and new replay. |
| `scripts/test_engine_adapter.py` | Add Kiroshi to the generic replay list; no new Python game logic. |

## Unsupported mechanics

Dying Night, named-V host effects, end-turn Eddie readying, Go Solo/field-Legend execution, general hidden-zone search, identity-obscuring Legend randomization, a general information DSL, DEMO_STARTER and complete starter matches remain unsupported. Existing one-outstanding-Reboot-prevention limits remain. No unsupported full card was admitted merely because an individual primitive exists.

## Ambiguities not guessed

The public-marker requirement is explicit and takes precedence over an illustrative request for an entirely unchanged opponent observation after the first look. Remembered identity is kept separate from permission to inspect again. Physical separation is expressly allowed; a later concealed randomization effect is not supplied or implemented, so its treatment of marked cards was not invented.

The replay/training boundary remains private and trusted; this pass does not create a public gameplay service, viewer authentication layer or public event-feed policy. Future services must project entitled observations and descriptors rather than forward authoritative transport. Existing hash-based defaults in fixture authors can vary when pins change; original-input behavior is audited independently.

## Recommended next milestone

Review **Evelyn Parker — Scheming Siren** as a bounded complete-card ATTACK draw/conditional-discard cluster, using the existing trigger ordering and exact captured text. Dying Night and Delamain require additional named-host/history/end-turn review; Go Solo/field Legends remain a separate larger boundary. Keep exact starter legality separate until a complete demo-format source review supports it.
