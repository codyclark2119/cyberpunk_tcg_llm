# Reviewed Gear play, equip and attachment lifecycle

This is the historical Gear milestone report. The later [attack-initiation report](combat-attack-report.md) records the current artifact pins, preserved replay hashes and newly supported offensive combat boundary.

Implemented one real Gear, **Mantis Blades**, through ordinary PLAY_CARD, exact payment and an authoritative equip-host choice. A deterministic engine-owned setup/turn replay has Viktor search two copies and later plays those **same CardInstances** onto Royce. Captured rules explicitly allow face-up Legends in the Legends area to receive Gear. Royce's derived power becomes **6 → 10 → 14** on its controller's turn, composing both Gear printed power and its existing per-Gear modifier.

This extends the completed noncombat milestone. No earlier pass was redone, and combat remains out of scope. These are implementation-reviewed execution fixtures with synthetic support decks, not human-certified gold data or full card-pool certification. The four production catalog fixtures remain separate.

## Runtime and artifact

All Node commands used **Node v22.13.0 / npm 10.9.2**, explicitly selected from the installed nvm directory. Root project version remains 0.3.0. Engine artifact version is now **0.4.0-gear-equip-1**; its source/lockfile hash is `a81ce804ad9934809ab088e8951d7f8d71331f89ebd4b0467d7f1d66ed41fe3b`. Previous artifact outputs are not treated as current engine outputs. All five replay fixtures, wire goldens and affected JSON Schemas were regenerated.

## Reviewed Gear and source evidence

The local corpus contained 17 Gear candidates. Mantis Blades isolates printed power inheritance without activated, Quick, combat or triggered abilities. No publisher content was fetched/refreshed; the source record, printing metadata, captured comprehensive rules and errata were inspected before implementation.

| Property | Reviewed value |
|---|---|
| CardId / application revision | `mantis-blades` / **1**; application numbering, not an official revision number |
| Raw record UUID | `28198e04-60e2-4f81-9786-903a9a947d7a` |
| Type / classification | Gear / Cyberware |
| RAM / cost / power | Red 1 / 1 Eddie / 2 |
| Sellable | Yes; ordinary hand SELL is retained |
| Primary printing | `7ffa8ba4-f187-4ba0-a719-fa8ebf45a03b`, Welcome to Night City — Retail **025** |
| Other retained printings | Welcome to Night City Beta β025; Embracing Power Retail 007 and Beta β007; Arasaka Demo 004; Pre-Release Beta 011 |
| Execution | `NONCOMBAT_PLAY_V1`, `SUPPORTED`, with additional pinned `turnSlice.gear: REVIEWED_GEAR_V1` |
| Additional abilities | None in the selected capture; no printed functionality was omitted to admit this Gear |

Exact captured text, including the newline:

```text
(Equip to a friendly Unit or face-up Legend.)
"One cut, one kill."
```

The parenthetical restates the default equip rule; the quoted sentence is flavor with no game instruction. Reminder/flavor text is not turned into an ability. There was no locally available card image; image layout was not independently verified or fetched. The complete raw record and six printing UUIDs remain in [gear-card-source.v1.json](../tests/fixtures/gear-card-source.v1.json). No captured erratum matches Mantis Blades.

| Provenance | SHA-256 / canonical hash |
|---|---|
| Original raw card bytes | `a711d560ac0c863b1df894cc1c6443212b28bd4b8ad60de581094797c97302e2` |
| Canonical raw record sourceHash | `2b801a356c0239342909fc9fe3b5edab19bc31d79719ade6deac161e1352d62e` |
| Normalized revision content hash | `be7d2903937458366526cf65cd7818a09394e807e4fc6cc714b16937c58bb319` |
| Raw rules capture | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed rules snapshot | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Raw errata capture | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata snapshot | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

[gear-rules.v1.json](../tests/fixtures/gear-rules.v1.json) contains exact selected records, their original IDs, snapshot hashes and implementation decisions. [gear-fixture.ts](../tests/gear-fixture.ts) is a handwritten normalization into one equip selector and one `GRANT_PRINTED_POWER_TO_HOST` modifier. Runtime code consumes this metadata; it never parses English.

## Gear lifecycle and equip legality

| Question | Captured authority and implementation |
|---|---|
| Order | 4.10: reveal → pay → equip. 11.20.2: the card is played only after its card-type requirements are fulfilled. |
| Source/resolving representation | Same HAND object, face-up while PAYMENT and the explicit paid EQUIP continuation are pending. Target selection follows payment. No independent field Gear or invented Program-like resolving area exists. There is no unrelated action/reaction window during this continuation. |
| Placement | 11.6.1: place beneath the host. Selecting a host moves the Gear directly to that host's BATTLEFIELD or LEGENDS area and establishes the relation atomically. |
| Valid host | 4.10.1–4.10.2: friendly Unit or friendly face-up Legend, only in field/Legends. The current supported host forms are face-up printed Unit in BATTLEFIELD and face-up printed Legend in LEGENDS. |
| Royce / Go Solo | Royce in LEGENDS is explicitly a legal host without Go Solo. 4.2/4.5 describe Legends becoming Units on the field; that separate play/Go Solo lifecycle remains unsupported. The rules retain Gear between valid areas (4.12/11.6.1.2), but this milestone does not execute those transitions. |
| Timing and payment | Open noncombat MAIN; a valid host and exact payable cost must exist before PLAY_CARD appears. Shared payment retains eligible Eddie/Legend instance IDs. Multiple exact sets use PAYMENT_SELECTION; unique sets retain existing automatic payment behavior. |
| Separate equip cost | Equip is a required part of playing this Gear under 4.10. No extra printed/equip Eddie or Spend cost exists. No repeat-equip action is inferred from reminder text (4.11.2). |
| Orientation | 5.6.2 default play enters READY. Host orientation is preserved; SPENT/READY/LAG do not prohibit receiving Gear. Gear readiness is its own physical state and has no Mantis activated ability. |
| Limits | 4.10.3 explicitly gives Units no upper Gear limit. Repeated legal equip to a face-up Legend and 5.7.7's unrestricted Legends-area card count permit the two-Gear fixture. No generic name, duplicate, Cyberware or other subtype restriction was found or invented. |
| Control/ownership | 1.7 defines friendly by current controller/area and ownership as immutable. Gear and host share an area/controller; owners may differ. Equipping changes neither owner nor controller. General control changes are not implemented. |

The Gear stays a Gear. Payment enumeration now explicitly checks printed LEGEND type in the Legends area, preventing co-located Gear from becoming a Legend payment source. Paid continuation validation uses the same type constraint. Hand Gear remains sellable; equipped Gear is absent from SELL, CALL and repeat PLAY actions.

Deck/game admission and legal play verify the full normalized executable shape: supported scope/status, Gear type, numeric printed power, bounded Eddie cost, the exact default selector, empty ability/keyword arrays and the sole printed-power modifier. Extra mechanics, missing equip data, unsupported status and dash costs fail. A source/catalog legality flag cannot admit the rest of the Gear pool. Viktor/Royce retain NONCOMBAT_SLICE_V1; Afterparty/Kerry retain NONCOMBAT_PLAY_V1. Rebecca remains excluded.

## Attachment model and continuation invariants

`host.attachments: CardInstanceId[]` remains the single canonical relation. `RulesView.getAttachedGear(hostId)`, `getEquippedGearCount(hostId)` and `getAttachmentHost(gearId)` derive the forward collection/count and reverse lookup. Gear is never deleted/recreated; CardInstanceId, CardId, immutable revision, owner and controller survive. Location/face/readiness follow the play or departure operation. No `attachedTo`, cached count or effective-power field was added to GameState.

Under the opt-in Gear policy, validateState rejects missing Gear, self-attachment, duplicate IDs, shared Gear across hosts, cycles, nested/non-Gear/unsupported attachments, invalid host type/location/face, hidden Gear, mismatched controller/area, and unattached Gear in active areas. Attachments cannot persist in HAND/TRASH/REMOVED. Invalid-area Legends must already have undergone their required removal processing; external invalid states are rejected, never repaired silently. Legacy pinned policies retain their historical fixture representation, but Royce uses the same generalized Gear query in both policies.

EQUIP continuation validation requires the same revealed paid source in HAND, READY, exact zero remaining cost, eligible spent payment objects, no unrelated pending work, the correct actor/timing, and the exact current canonical host options. Selection revalidates through legal action/choice resolution and the shared attachment primitive. Forged source/payment/host/choice mutations, stale targets and stale actionIds fail without changing the input state.

## Derived characteristics

Rules 3.17.2–3.17.3/11.6.5 give the host its printed power plus equipped Gear power plus effect modifiers. Mantis's modifier refers to its real revision's printed **2**; the amount is not copied onto the host. Gear itself remains power 2. Royce's existing own-turn modifier adds 2 per actual equipped Gear through the same query:

| Position | Printed host | Gear power | Royce effect | Effective power |
|---|---:|---:|---:|---:|
| Royce called, no Gear, own turn | 6 | 0 | 0 | 6 |
| One Mantis, own turn | 6 | 2 | 2 | 10 |
| Two Mantis, own turn | 6 | 4 | 4 | 14 |
| Two Mantis, rival turn | 6 | 4 | 0 | 10 |
| Kerry with one Mantis | 5 | 2 | 0 | 7 |

Royce's face-down query remains inactive/null. Detaching one/two Mantis removes both corresponding sources immediately, returning own-turn power 14 → 10 → 6. Attachment enumeration is canonical, and additive evaluation does not depend on input collection order. Tests verify unchanged base revisions and absence of power caches. Viktor is a legal face-up host, but its missing/null printed power remains null; no numeric interpretation of Null-plus-Gear was invented. This milestone does not implement continuous-effect layers or certify all effective-type transitions.

## Detach and state-based processing

The central trusted `moveCardForEffect` engine/test helper enters STATE_BASED_CHECKS, applies reviewed movement/cleanup, and returns a validated stable MAIN state with deterministic contiguous events. It is not a player action or JSONL operation and carries no combat/defeat semantics.

- Host departure: 4.12 moves its Gear with it. Moving outside field/Legends detaches them (4.12.1). Same-owner/controller moves to HAND and TRASH are supported; removal places each card in its owner's REMOVED pile (5.13.2.1).
- Legend departure: Gear first follows to the intermediate area and detaches. The invalid-area Legend is then removed alone, leaving Gear there (4.4.1–4.4.2/4.12.2).
- Direct Gear departure: move that instance and remove its host relation; derived bonuses disappear immediately. Gear returned to HAND can later undergo a new paid play onto another legal host.
- Simultaneous TRASH placement requires an explicit complete owner-chosen order (5.9.4.1). Invalid/duplicate orders fail; multiple-owner order choices remain unsupported. Cross-owner HAND/TRASH destinations require an effect's explicit destination-player semantics and are rejected by this helper rather than inferred.

Focused trusted-transition tests cover HAND/TRASH/REMOVED, returned-Gear replay, owner-specific removal, and deterministic event/hash output without adding combat. Some focused Unit/control tests construct validated states; the headline setup/search/equip replay contains no manual state/RNG/card replacement.

11.6.6 defines moving Gear to another valid host, but does not itself authorize a new voluntary MAIN action. No UNEQUIP or re-equip player command was added. Known between-field/Legends retention and randomized equipped-group bottom-deck rules (4.12.3/11.12) await separately reviewed operations.

## Events and observations

For a Gear play with payment choice, the semantic facts are **CARD_REVEALED → PAYMENT_MADE → CARD_MOVED → GEAR_ATTACHED → CARD_PLAYED**, with PHASE_CHANGED boundaries around choices. CARD_PLAYED follows attachment as required by 11.20.2. No invented Mantis PendingEffect is emitted. Existing typed PendingChoice/TARGET_SELECTION provides the equip decision.

GEAR_ATTACHED includes gearInstanceId, hostInstanceId and reason PLAY_CARD. GEAR_DETACHED includes both IDs and HOST_LEFT_AREA or GEAR_LEFT_AREA. CARD_MOVED retains source/destination. Host departure facts move the group, detach, then move a Legend to REMOVED when applicable. State-based processing is centralized rather than duplicated in card handlers.

Public PlayerObservation exposes face-up active Gear/host identities, location, face/readiness, canonical public `attachments` and derived `effectivePower`. Gear and its host stay separately visible physical objects. Only the declared Gear is revealed from an opponent's hand during its payment/equip continuation. Other hands, face-down Legends, deck order and future RNG remain hidden; search visibility retains Viktor's existing actor-only inspected-card behavior. Derived observation fields are not state caches.

## Training positions, action IDs and replay

Model output remains **`{"actionId":"…"}`**. PLAY_CARD, PAYMENT_SELECTION and TARGET_SELECTION arrive through the existing authoritative legal-action protocol. Both headline equip choices offer real **Viktor or Royce** alternatives. A focused single-host position remains a forced non-training choice under the existing policy; no strategic choice is fabricated. POSITION_V2 is unchanged; irrelevant match/version/event counters preserve target actionIds and position hashes while changing replay hashes.

The seed `gear-equip-44` is supplied to normal engine-owned setup. Each constructed deck has 42 main cards, including three Mantis Blades replacing three synthetic support cards; the other reviewed/synthetic entries and normal legality constraints remain. No deck order is patched during gameplay.

```text
setup: first player, cuts, declined mulligans, automatic shuffle/deal
turn 1: roll D4 → SELL → CALL Viktor → exact payment
        search top 5 → choose Mantis p0-c9 and p0-c10 → same objects to HAND
turn 2: rival rolls D4, ends
turn 3: roll D6 → CALL Royce → payment
        PLAY p0-c9 → payment → choose Royce → power 10
        PLAY p0-c10 → payment → choose Royce → power 14 → MAIN
```

The new trace contains **25 semantic actions**, **25 strategic TrainingPositions**, and **99 events including initialization**. The same searched IDs are later PLAY_CARD sources and GEAR_ATTACHED objects, with all revision/ownership/control identity retained.

| Replay | Actions | Strategic positions | Current final ReplayStateHash |
|---|---:|---:|---|
| turn | 7 | 3 | `353db37d5db90f45170387325ce98b733bffc338dc236a111d4460196bd45949` |
| setup | 10 | 7 | `1521d0bdfa0e23c85fcdc7f89efe47b50ce3e1caddb45c22c8c5719b4c3da54f` |
| reviewed CALL | 11 | 11 | `f45c673ece4aa85c8f6017fca93d2994a835f2462324865da6c9cca217da452b` |
| noncombat | 24 | 23 | `ace3316572cce9ae15558909ffc1806bfe50cbfc7d861d2c8d3e3bf4a3250feb` |
| Gear/equip | 25 | 25 | `e98eee927cd0118754e8cdfaa89b021c0f0238845e6aa6157d11692644ef02e9` |

All previous replay behaviors remain regression-tested under the new artifact pin. The previous milestone report is historical and links here for current hashes.

## Persistence and Python/wire interoperability

The existing PostgreSQL integration group persists initialization plus all 25 Gear transitions, including search selection, hidden HAND, revealed play, payment, target choice and stable MAIN. Every intermediate state is read back exactly; ReplayStateHash matches that state, POSITION_V2 matches the fixture despite randomized transport UUIDs, final attachments/power match, and the complete 99-event history is compared with explicit contiguous sequences. Existing CAS, missing-history and rollback tests remain. Mongo revision/publication/search integration also passes. No database migration or persistence implementation changed.

The generic Python replay driver adds the fifth fixture. The unchanged Node subprocess adapter reproduces initialization, every legal-action set, observation, event batch, returned hashes and final state using actionId submissions. No Gear rules, schema copies, attachment logic or runtime English parsing were added to Python. The worker remains independent of Next.js/Apollo/databases; model input never receives raw GameState/content/RNG.

Wire version 1 remains additive: equip metadata, optional continuation abilityId with new EQUIP phase, attachment events and optional public observation fields. Request/response/TrainingPosition schemas were regenerated. TrainingAttempt remains unchanged. Artifact pins distinguish behavior; POSITION_V2 remains unchanged.

## Tests and exact commands

Final results: **98 TypeScript tests** (78 retained + 20 Gear tests), **2 real database integration groups**, **87 Python game tests**, **48 Python core tests**, five Python/Node replay loops and seven wire golden round trips. Zero failing or skipped tests. Typecheck, lint, card validation, schema export and production build passed. Next.js 16.3.4 generated six static pages and the dynamic GraphQL route without warnings. An early lint check found one unused test import; it was removed before the final clean run.

Application working directory: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`. **Every** Node/npm command below had the exact prefix `PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH `:

| Command after that prefix | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | Pass, including GraphQL generation and both TypeScript projects |
| `npm run lint` | Pass, zero errors/warnings |
| `npm run validate:cards` | Pass; four original catalog fixtures |
| `node --import tsx --test tests/gear.test.ts > /tmp/tcg-gear-tests.log 2>&1` | Initial focused pass, 19 tests; cross-owner departure test added afterward and included in full suite |
| `npm test > /tmp/tcg-gear-all-tests.log 2>&1` | 98/98 pass, zero skipped |
| `npm run build > /tmp/tcg-gear-build.log 2>&1` | Pass |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass; seven vectors |
| `node --import tsx scripts/generate-turn-replay.ts` | Pass; seven actions |
| `node --import tsx scripts/generate-setup-replay.ts` | Pass; ten actions |
| `node --import tsx scripts/generate-reviewed-replay.ts` | Pass; eleven actions |
| `node --import tsx scripts/generate-noncombat-replay.ts` | Pass; 24 actions / 23 strategic positions |
| `node --import tsx scripts/generate-gear-replay.ts` | Pass; 25 actions / 25 strategic positions |
| `npm run contracts:export` | Pass |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration > /tmp/tcg-gear-integration.log 2>&1` | 2/2 pass against existing services; no skips |

Database networking required approved sandbox escalation. Tests created and cleaned up only randomized test databases/schemas, leaving existing infrastructure/data intact. No new containers or infrastructure configuration were needed.

Harness working directory: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`. Exact commands:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node > /tmp/tcg-gear-python-adapter.log 2>&1
mlx_env/bin/python -B scripts/test_cyberpunk.py > /tmp/tcg-gear-python-game.log 2>&1
mlx_env/bin/python -B scripts/test_harness_core.py > /tmp/tcg-gear-python-core.log 2>&1
```

All passed with the counts above. `git diff --check` passed in both repositories. Local inspection used `git status --short`, `rg`, file reads and Python JSON/hash inspection; no secrets were printed or environment files edited. No model download or training occurred.

## Files changed in this milestone

The workspace already contained uncommitted changes from earlier milestones and unrelated harness work. This inventory compares against the byte hashes captured at the start of this Gear pass, rather than attributing the entire existing Git diff to it. Paths are relative to the application unless marked harness.

| File | Change |
|---|---|
| `packages/domain/src/card.ts` | Optional typed equip metadata on immutable card mechanics |
| `packages/domain/src/game.ts` | EQUIP continuation with optional ability ID; typed attached/detached events |
| `packages/domain/src/mechanics.ts` | Minimal actual host selector and inherited printed-power modifier |
| `packages/domain/src/ruleset.ts` | Opt-in REVIEWED_GEAR_V1 policy |
| `packages/engine/src/attachments.ts` | Strict Gear shape/host admission, canonical relation queries and invariants |
| `packages/engine/src/card-movement.ts` | Shared physical movement, attachment, trusted departure and central state-based detach/removal |
| `packages/engine/src/effect-support.ts` | Reject equip metadata from unrelated CALL admission |
| `packages/engine/src/index.ts` | Equip target labels and trusted movement export; existing action protocol retained |
| `packages/engine/src/initialization.ts` | Prevent equip metadata bypassing scoped deck admission |
| `packages/engine/src/observation.ts` | Public attachments/power and declared Gear visibility during equip |
| `packages/engine/src/payment.ts` | Require actual Legend type for Legends-area payment sources |
| `packages/engine/src/play-state.ts` | Canonical EQUIP choices, exact source/payment/host continuation validation |
| `packages/engine/src/play-support.ts` | Strict simple Gear admission and pre-payment legal-host requirement |
| `packages/engine/src/play.ts` | Shared ordinary Gear play/payment/target lifecycle with correct CARD_PLAYED ordering |
| `packages/engine/src/state.ts` | Strict opted-in attachment/location validation while retaining legacy pins |
| `packages/engine/src/view.ts` | Generalized attachment queries and printed Gear + Royce derived composition |
| `packages/wire/schemas/request.v1.json` | Regenerated additive schema |
| `packages/wire/schemas/response.v1.json` | Regenerated additive schema |
| `packages/wire/schemas/trainingPosition.v1.json` | Regenerated affected state/content/observation schema |
| `scripts/engine-identity.ts` | Increment explicit artifact version |
| `scripts/generate-gear-replay.ts` | New deterministic private fixture generator |
| `tests/gear-fixture.ts` | Handwritten real Gear normalization and constructed pinned bundle |
| `tests/gear-replay.ts` | Engine-owned setup, Viktor search and same-instance double equip trace |
| `tests/gear.test.ts` | 20 focused legality, identity, invariant, modifier, visibility, hash and departure tests |
| `tests/fixtures/gear-card-source.v1.json` | Exact raw card/printing record and errata/source provenance |
| `tests/fixtures/gear-rules.v1.json` | Exact selected rules, capture hashes and implementation decisions |
| `tests/fixtures/gear-replay.v1.json` | New 25-action replay, 25 positions and full history |
| `tests/fixtures/turn-replay.v1.json` | Refresh retained regression for new artifact |
| `tests/fixtures/setup-replay.v1.json` | Refresh retained regression for new artifact |
| `tests/fixtures/reviewed-replay.v1.json` | Refresh retained CALL regression for new artifact |
| `tests/fixtures/noncombat-replay.v1.json` | Refresh retained Program/Unit/Spend regression for new artifact |
| `tests/fixtures/wire-golden.v1.json` | Refresh seven wire vectors |
| `tests/integration/persistence.test.ts` | Persist/read back full Gear sequence, exact states/events/hashes/relations |
| `docs/executable-card-coverage.md` | Current Mantis review, source pins, lifecycle and limits; update Royce coverage |
| `docs/noncombat-play-report.md` | Mark preceding milestone report historical and link current extension |
| `docs/gear-equip-report.md` | This report |
| Harness `scripts/test_engine_adapter.py` | Add fifth replay to generic actionId traversal |
| Harness `docs/engine-interop.md` | Current Gear protocol, observation, replay and artifact documentation |

## Unsupported semantics and remaining debt

No combat actions, target resolution, damage, defeat, Blocker, Quick/Rival React, Gig stealing, Go Solo, attack triggers or combat equipment triggers were introduced. Full Gear pool, activated Gear, arbitrary printed effects, replacement/complex simultaneous effects and universal continuous-effect layering remain unsupported. The selected Mantis capture has no omitted additional behavior; Royce retains its explicitly bounded Legend-area scope.

Known rules were not mistaken for implemented operations: field/Legends Gear retention, effect-driven Move/re-equip and randomized equipped-group bottom-decking need their own reviewed transitions. General control change and cross-owner hand/trash destination/ordering protocols are deliberately not guessed. Numeric power on Null-power hosts is not certified; it remains null. Image text-box layout was not independently verified beyond local textual metadata.

The existing no-Gig Street Cred observation remains numeric 0 although the captured rules distinguish Null; Gear did not expose a dependent condition bug. Python's historical validator still has the reported repeated-entry copy-limit and Legend-in-main gaps; TypeScript remains authoritative. Complete prior history is still read on MatchRepository saves, and older incomplete histories need explicit recovery. The separate command ledger and match persistence APIs have not been redesigned. No new build/lint warnings remain.

These are headless reviewed fixture bundles, not a larger production card catalog or a web match UI. A suitable next milestone is a separately source-reviewed first combat/attack slice, beginning with explicit timing, effective Unit/Legend type and Gear retention requirements before implementing damage/defeat. Keep Quick, broad card pools and general effect layering separately bounded.

No commit, push or staging occurred. Existing unrelated application/harness work was preserved.
