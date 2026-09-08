# Defender React milestone report

## Runtime and result

Completed the defender-only React slice. The legal headline replay performs **Viktor CALL/search → Floor It → Secondhand Bombus → PASS_REACT**, then stops at **COMBAT_RESOLUTION_PENDING**. No fight, damage, defeat or Gig transfer occurs.

Commands used **Node v22.13.0 / npm 10.9.2** through `/Users/codyclark/.nvm/versions/node/v22.13.0/bin` on PATH. The application package remains **0.3.0**; the behavior artifact is **0.4.0-combat-react-1** with source/lockfile hash **`3ba1e81958c3b443f4a0b7543c98d883169bc34a50103f9d3c7b5fc801069a0c`**. The Next build uses the installed 16.3.4 workspace. No runtime upgrade, project restructuring, commit, push or staging was performed.

All final gates passed: **144 TypeScript tests** (120 retained + 24 React tests), **2 live infrastructure integration tests**, all **7 Python replay families**, **7 wire goldens**, **87 Python game tests**, and **48 Python core tests**. Lint, both TypeScript projects, card validation, production build, contract export and both repository whitespace checks passed without remaining build/lint warnings.

## React rules reviewed

Authority is the pinned local comprehensive-rules/errata capture, not another TCG's conventions. [react-rules.v1.json](../tests/fixtures/react-rules.v1.json) contains exact IDs/excerpts and implementation decisions. No publisher refresh or model/corpus regeneration occurred.

| Snapshot | SHA-256 |
|---|---|
| Raw comprehensive rules | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed rules JSONL | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Raw errata | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata JSONL | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

| IDs | Exact excerpt / resulting semantic decision |
|---|---|
| 9.6; retained 9.3 and 11.21.2.2 attack review | Pending ATTACK effects finish before React. Target selection still precedes attacker spending and ATTACK effects. |
| 9.7 | “They may take as many reactions as they want, in any order they choose.” No one-reaction cap. |
| 9.7.1 | “only if you are the defending player.” Active player remains attacker; acting player is the defender. No alternating priority. |
| 9.8; 8.12.2; 11.11.2.2 | CALL is permitted during rival React. |
| 11.11.1–11.11.2; 5.7.3 retained earlier review | Pay 1 Eddie to reveal a face-down Legend; keep orientation; CALL triggers; once per global turn, including rival turns. |
| 9.9; 9.9.1 | Ready Blocker “becomes the defending Unit, fully replacing the previous attack target.” CARD and Gig-area attacks use the same replacement. |
| 11.24.1–11.24.3 | Spend the friendly Unit to redirect the current rival attack. No original-target dependency or one-blocker restriction appears. Distinct ready Blockers can replace each other under 9.7. |
| 11.3.1.1–11.3.1.2; 11.15.1 | Lag prevents attacking and Spend-icon effects. Blocker is its separately defined keyword action, so Lag does not prevent blocking. It does not activate Kerry's Spend ability. |
| 9.10–9.10.1; 11.26.1–11.26.3 | Programs with QUICK may be played as reactions; MAIN remains permitted and ordinary costs remain required. The explicit Program provision controls Floor It, rather than treating it as a field-only activated ability under the broad wording of 11.26.1.2. |
| 4.14–4.14.2 | Program reveal → payment → effects outside all game areas → trash. QUICK introduces no zone. |
| 9.11; 10.2.3–10.2.5 | All pending reaction work finishes before another reaction. No nested reaction or stack scheduler. |
| 9.12 | Defender may end React “while not taking a reaction and while there are no effects pending resolution.” Explicit PASS_REACT is required; no timeout or implicit pass. |
| 9.14 | Ending React proceeds to fight or steal; this milestone stops just before those processes. PASS is not a reversible priority pass. |
| 9.13; 9.26–9.29 | Recheck attack validity after complete reaction effects. Invalid attacks end without retargeting, fight or stealing, then active-player MAIN resumes. |
| 3.17.2; 2.10; 8.16.1–8.16.2 | Power is printed power plus Gear plus current modifiers; negative values are allowed. Turn-duration effects expire after end-of-turn effects, before the next turn. |
| 10.2.1; 10.6.2; 10.31.1–10.31.2 | No eligible Floor It target skips that part, then still draws; one target resolves automatically, multiple targets form a strategic choice. |

## React state machine

```text
MAIN
→ DECLARE_ATTACK(attacker)
→ ATTACK_TARGET_SELECTION if multiple legal targets
→ lock target
→ ATTACKER_SPENT / ATTACK_DECLARED
→ ATTACK effects / state-based checks
→ RIVAL_REACT (defender acts)
    → CALL / Quick PLAY_CARD / DECLARE_BLOCKER
    → any payment, search or target choice
    → finish all supported effect work
    → attack validity check
    → RIVAL_REACT again, or ATTACK_ENDED → MAIN
→ PASS_REACT
→ RIVAL_REACT_CLOSED
→ COMBAT_RESOLUTION_PENDING
→ STOP: UNSUPPORTED_COMBAT_RESOLUTION
```

The additive `turnSlice.react: COMBAT_REACT_V1` requires the existing reviewed combat/play/Gear/CALL policies. The six historical replay policies are retained. In particular, COMBAT_ATTACK_V1 **without** the React policy still ends at its historical UNSUPPORTED_RIVAL_REACT boundary; the new replay proves the extension under its own immutable ruleset/content pin.

## CALL during React

The original CALL subsystem handles Legend selection, exact payment, orientation, turn usage, trigger discovery, PendingEffect, Viktor search and final reveal. No second reaction-specific flip/payment implementation exists. Reaction CALL descriptors use public-safe Legend slots. Calling on Player A's turn consumes Player B's CALL allowance for that same global turn; further CALL actions disappear. Starting the next global turn resets both players' allowances under the existing policy.

`resolution.returnTo` is a typed discriminated union, `{ kind: MAIN } | { kind: RIVAL_REACT }`. It accompanies action continuations, including the search after CALL payment has finished. `finishAction` returns to that destination; React completion invokes the shared attack-validity boundary. Validators reject missing/wrong React return destinations, wrong actors and conflicting continuations. Legacy MAIN snapshots may omit the optional return field; newly created continuations record it explicitly.

Forced sole payments remain automatic. Multiple exact payments expose only CHOOSE. CALL search retains private inspected cards and can reveal/take up to two eligible Gear while bottom-decking the rest with the existing deterministic RNG. Payment/search states never also expose PASS, another CALL, Quick or Blocker.

## QUICK: Floor It

Real captured **Floor It**, CardId `floor-it`, application revision 1, **COMBAT_REACT_V1 / SUPPORTED**. Exact text: `{Quick} Give a rival Unit -1 power this turn. Draw 1.` Blue RAM 1, cost 1, sellable Program. Primary WNC Retail 132 and all five printing UUIDs, including Merc Demo 014, are retained.

PLAY_CARD uses ordinary payment and Program lifecycle in open MAIN or defender React. Hand visibility changes only after that card is declared. The first typed primitive selects a face-up rival field Unit (the attacker is an option, not an automatic target); the second reuses DRAW. Friendly Units, Gear, Legends-area Legends and inactive cards are not targets. Zero eligible targets skips power but still draws; a sole target is automatic. Multiple targets use existing TARGET_SELECTION/CHOOSE, then the ordered primitive chain continues and the same Program enters TRASH before React returns. The existing immediate empty-draw loss policy is preserved.

`temporaryModifiers` contains only the implemented additive POWER/-1 records with physical source/target IDs and explicit END_OF_TURN/turn expiration. No cached effective power or rewritten base value is stored. RulesView composes the modifier with printed power, attached Gear and existing supported modifiers. Negative derived power is permitted. Multiple copies add independently in canonical source order. The modifier survives early attack ending and remains in the resolution-pending state; it expires at the global end-of-turn check, not on PASS. Arbitrary duration/layer/replacement systems are not implemented.

## BLOCKER: Secondhand Bombus

Real captured **Secondhand Bombus**, CardId `secondhand-bombus`, application revision 1, **COMBAT_REACT_V1 / SUPPORTED**. Yellow RAM 2, cost 2, power 0, unsellable Unit. Exact text retains BLOCKER's spend/redirection reminder and the power-0/no-steal reminder. Primary WNC Retail 053 and all five printing UUIDs, including Merc Demo 003, are retained.

Ordinary MAIN Unit play/payment produces the ready Unit with Lag. Separate `isBlockerEligible`/`listBlockers` queries require open defender React, correct controller and field area, effective Unit type, face-up, READY, and the entire reviewed Blocker shape. Lag is permitted by the reviewed keyword distinction. Declaration rechecks legality through authoritative enumeration, emits BLOCKER_SPENT and BLOCKER_DECLARED, spends only that Unit and replaces the current target. It does not activate Spend abilities, spend payment sources, detach Gear, fight or close React.

A second ready Blocker can redirect again; the first spent object cannot block again without a separately supported readying effect. No per-attack blocker counter or speculative multiple-blocker array exists. Nonblocking Units, inherited Gear Blocker, Legends/Go Solo, extra printed effects and conditional unblockability are not automatically certified. Power-0 stealing belongs to the deliberately unavailable next combat slice.

## PASS and multiple reactions

PASS_REACT appears alongside other legal reactions and as the sole action when none are available. It is absent during unfinished payment/search/target effects. It emits one RIVAL_REACT_CLOSED event with reason PASS_REACT, then COMBAT_RESOLUTION_PENDING with final participants. It neither compares power nor mutates cards/Gigs. The defender cannot react afterward. Both players have empty legal lists there; applyAction, resolveActionId, wire applyAction and advanceResolution explicitly report UNSUPPORTED_COMBAT_RESOLUTION. TrainingPosition generation reports NO_PLAYER_DECISION.

The replay proves CALL → Quick → Blocker → PASS. Focused tests additionally prove two Quick copies before Blocker/PASS, two successive Blockers, further CALL/Quick availability after blocking, and ordinary global CALL limits regardless of ordering. The only restrictions are actual reviewed timing, costs, usage and object state.

## CombatState, invalidation and events

Combat still stores only `attackerId`, `attackingPlayerId`, current typed `target` and `stage`. COMBAT_RESOLUTION_PENDING is the new stable closed stage. The defending player is derived from player order. `BLOCKER_DECLARED.previousTarget` preserves history; no duplicated blocker/original target/current target IDs or cached power are added. Current target is enough for the next rule-defined fight or steal process because 9.9.1 fully replaces the prior target.

After CALL/Quick/Blocker resolution, the shared trusted `finishAttackEffects` boundary checks attacker existence/field/controller/effective Unit eligibility and current target legality. Invalid attacks emit ATTACK_ENDED, retain any turn-duration effects still valid, restore active-player MAIN and never reopen target selection. Focused trusted transitions test attacker departure, original target departure and redirected Blocker departure after reaction effects. Unfinished pending work cannot invoke that completion boundary. Arbitrary malformed external states are rejected instead of repaired.

New events: POWER_MODIFIER_APPLIED, POWER_MODIFIER_EXPIRED, BLOCKER_SPENT, BLOCKER_DECLARED, RIVAL_REACT_CLOSED and COMBAT_RESOLUTION_PENDING. Existing payment, reveal/play/movement, Legend CALL, effect pending/resolved and RIVAL_REACT_OPENED events are reused. Reopening follows complete effects/Program trash movement; PASS closes once. No damage, defeat, fight-result or Gig-control events are emitted by the new path.

## Observation and training positions

The defender sees their own hand and engine-generated Quick actions, safe CALL slots and private Viktor search. The attacker sees opponent hand counts and publicly declared Programs, called Legends, field Units/Gear, derived power and current combat target. No potential Quick hand contents, hidden Legend identities, deck order or RNG are exposed. Temporary power records are public because their Program source and Unit target are public. The current target displays a declared Blocker without storing redundant historical role data in state.

React legal ordering is explicit: CALL_LEGEND → Quick PLAY_CARD → DECLARE_BLOCKER → PASS_REACT, with canonical semantic object ordering within each category. Existing other-window ordering and actionId hashing remain unchanged. POSITION_V2 ignores match/player transport identities, state/event counters and effect provenance as before. Focused tests verify equivalent React and continuation actions/position hashes while replay hashes remain distinct.

The new replay records **51 strategic TrainingPositions** across **53 actions**, including four open React decisions and Quick target/payment/CALL search decisions. Focused positions also include two Blocker alternatives. Forced sole payments/targets and automatic effects never create strategic samples; no position is generated for COMBAT_RESOLUTION_PENDING. Python/model choice remains `{ actionId }`; no legality or reaction state is inferred by the client.

## Demo-deck coverage roadmap

[demo-deck-coverage-roadmap.md](demo-deck-coverage-roadmap.md) preserves both exact user lists: **Arasaka Embracing Power Demo Deck** and **Mercs The Heist Demo Deck**, each **27 main + 3 Legends = 30**, with **Psycho Squad = 3**. All 29 distinct names have local captures and demo printings; six have bounded executable application coverage within those lists. The table gives card, deck, copies, capture, executable normalization, scope, support and blocking subsystem.

No list was padded to constructed size, no demo deck policy was invented, and no complete demo match was attempted. Floor It and Bombus advance real demo coverage. Reboot Optics requires fight prevention; Corpo Security requires its cannot-attack restriction; Mandibular Upgrade requires inherited keywords. None was silently reduced to a supported fragment. `npm run validate:cards` still validates the original **4 catalog fixtures**, a different collection from the 151-record local corpus and these explicitly reviewed replay bundles.

## Replay pins

All seven families were regenerated against this artifact. Event counts include creation/setup events.

| Replay | Actions | Strategic positions | Events | Final ReplayStateHash |
|---|---:|---:|---:|---|
| turn | 7 | 3 | 53 | `b8ea60af41ce573bd71c0e978de0e39caee4c5685bb2c656b82fdf6267a12d9c` |
| setup | 10 | 7 | 67 | `4fbbfe84d28188eaef64674a5341efd7c0e75e17c9109447a0f1650f42e6f630` |
| reviewed | 11 | 11 | 65 | `517493226392beb0f4a19fd728aff09c4b03d6b0ab79822246a60cad8859f99b` |
| noncombat | 24 | 23 | 125 | `a88e09b0697d85a1626a2a5c7a3384d98abd1a1ac5e0b2260b82a773049f9b4e` |
| gear | 25 | 25 | 99 | `8400ba240e2a04693139af8f9493efa715c9c53fc68a9370a13c2e1e28ee70ed` |
| combat-attack | 41 | 40 | 185 | `60e11d4bf61f32b5ff6af14bd1a601c6443770674660ca84f1b74b2da1116a47` |
| react | 53 | 51 | 229 | `c2939ac69c385e0e9f061d92362bc558995b9b4c95be294b98d666acad1460ee` |

The new trace extends the previous seed `combat-attack-46` with real Bombus play during normal turns and new reviewed deck slots. It retains legal setup, real Kerry play/Lag/Spend, Swordwise + Mantis at power 5 and the existing ATTACK draw. It then uses defender Viktor search, Floor It, Bombus and explicit PASS. Final attacker is `p0-c12` at derived power **4**; final target is Blocker `p1-c19`, spent at power **0**. Gear remains attached to the attacker. No hand/state/RNG patch is part of the headline replay; focused unit tests label their trusted fixture preparation separately.

## Persistence and Python/wire

The live MongoDB/PostgreSQL integration suite passes against the existing services at 27018/5433. Mongo uses an isolated temporary database; PostgreSQL uses an isolated temporary schema, with cleanup in finally blocks. Existing immutable publication, concurrency and rollback checks remain. Every React transition is saved and read back, including payment/search/target continuations, return context, effects, modifier, redirected target and final resolution-pending state. Read-back replay hashes, transport-independent position hashes and complete contiguous event history are verified. No migration or application data reset was needed.

Wire v1 remains additive; request, response and TrainingPosition JSON Schemas and wire goldens were regenerated. No endpoint was added. The Python change adds only `react-replay` to the existing generic fixture loop, plus interoperability documentation. Node handles all new rules; no Python runtime adapter, core harness, ingestion, validation, training, model, measurement or corpus logic was changed. No model downloads or training ran. The historical Python validator's known repeated-entry copy-limit bypass and Legend-in-main gaps remain explicitly measured by the differential cases.

## Tests and commands

Commands below ran from the application root unless a different working directory is shown. Every Node/npm invocation used this PATH prefix:

```bash
PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

| Exact command (with that PATH) | Final result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | Pass: GraphQL generation + root/app TypeScript |
| `npm run lint` | Pass: no errors or warnings |
| `npm run validate:cards` | Pass: 4 original catalog fixture records |
| `npm test` | Pass: 144/144 tests, 0 skipped |
| `npm run build` | Pass: compilation, Next route TypeScript, six static pages and `/api/graphql` route |
| `npm run contracts:export` | Pass: request/response/TrainingPosition schemas |
| `node --import tsx scripts/generate-wire-golden.ts` | Pass: all wire vectors regenerated |
| `node --import tsx scripts/generate-turn-replay.ts` | Pass: 7 actions / 3 positions |
| `node --import tsx scripts/generate-setup-replay.ts` | Pass: 10 / 7 |
| `node --import tsx scripts/generate-reviewed-replay.ts` | Pass: 11 / 11 |
| `node --import tsx scripts/generate-noncombat-replay.ts` | Pass: 24 / 23 |
| `node --import tsx scripts/generate-gear-replay.ts` | Pass: 25 / 25 |
| `node --import tsx scripts/generate-combat-attack-replay.ts` | Pass: 41 / 40 |
| `node --import tsx scripts/generate-react-replay.ts` | Pass: 53 / 51 |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | Pass: 2/2, including final artifact replay persistence |
| `git diff --check` | Pass in both application and harness repositories |

Generator commands were executed sequentially using Python subprocess orchestration with their exact argument vectors. Final gate logs are `/tmp/tcg-react-{typecheck,lint,all-tests,build,integration,generators}.log`.

From `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
# PASS: seven complete replay families; seven wire golden round trips;
# model inputs/action submission/stale and malformed rejection; differential checks.

mlx_env/bin/python -B scripts/test_cyberpunk.py
# PASS: 87 tests.

mlx_env/bin/python -B scripts/test_harness_core.py
# PASS: 48 tests.

git diff --check
# PASS.
```

Python logs are `/tmp/tcg-react-python-{adapter,game,core}.log`.

Development verification also used `node node_modules/typescript/bin/tsc --noEmit` and `node --import tsx --test tests/react.test.ts`. Early fixture failures were corrected by supplying the required second real Quick in the focused multi-reaction fixture and preserving Gear coherence during trusted attacker departure. An ES2023-only test helper was replaced with a compatible reversed-array search. The first full test run found stale exported JSON Schemas; export resolved it. Lint rejected the module filename `react` under the engine's existing no-React-import boundary; it was renamed `rival-reactions` without weakening the restriction. Replay fixtures and gates were rerun after the final behavior artifact changed.

## Files changed in this milestone

This inventory compares bytes against the beginning of this pass. Earlier milestones already left many tracked modifications and untracked files in both repositories; those were preserved. The list does not misattribute prior work to this milestone.

### Application

| File | Change |
|---|---|
| [docs/combat-react-report.md](../docs/combat-react-report.md) | This complete milestone report, rules, verification, artifact pins and file inventory. |
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Preserve both exact reference lists and identify every card's coverage/dependency. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Add real-card certification/provenance/limits and qualify historical unsupported claims. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add explicit COMBAT_REACT_V1 execution scope. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Typed return context, turn power modifiers, closed combat stage/timing and reaction events. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add only the reviewed rival-Unit, -1, end-of-turn power primitive. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add opt-in reviewed React policy. |
| [packages/engine/src/action-return.ts](../packages/engine/src/action-return.ts) | Shared typed continuation return/validation and post-action completion. |
| [packages/engine/src/card-movement.ts](../packages/engine/src/card-movement.ts) | Explicitly reject unresolved modifier-target zone-change semantics in trusted movement. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Derive additive current-turn power with existing characteristics. |
| [packages/engine/src/combat-state.ts](../packages/engine/src/combat-state.ts) | Validate defender continuations and the stable closed combat boundary. |
| [packages/engine/src/combat.ts](../packages/engine/src/combat.ts) | Reuse attack-validity/completion boundary after reactions. |
| [packages/engine/src/effects.ts](../packages/engine/src/effects.ts) | Resolve power primitive using forced or strategic typed targets. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Compile/order/dispatch React actions, guard closed combat, expire turn modifiers and propagate continuation completion errors. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Require full new-card shape checks at deck admission. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Expose public modifiers/current combat and explicit closed capability marker. |
| [packages/engine/src/play-state.ts](../packages/engine/src/play-state.ts) | Validate Quick payment/target continuations and existing ordered primitive chain. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Admit the two reviewed shapes and Quick timing through ordinary play. |
| [packages/engine/src/play.ts](../packages/engine/src/play.ts) | Retain typed return context; reuse payment/Program lifecycle and finish selected power effects. |
| [packages/engine/src/react-queries.ts](../packages/engine/src/react-queries.ts) | Pure separate Blocker eligibility and rival-Unit power target queries. |
| [packages/engine/src/react-support.ts](../packages/engine/src/react-support.ts) | Explicit policy, open defender decision and complete reviewed card-shape admission. |
| [packages/engine/src/rival-reactions.ts](../packages/engine/src/rival-reactions.ts) | Implement Blocker spend/redirection and explicit PASS/closed boundary. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Validate return/modifier state, actor/timing and exclusive CALL continuations. |
| [packages/engine/src/temporary-power.ts](../packages/engine/src/temporary-power.ts) | Apply/validate canonical typed modifiers and expire them at turn end. |
| [packages/engine/src/turn.ts](../packages/engine/src/turn.ts) | Share CALL/search return destination; preserve active actor on immediate match ending. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose pure Blocker/Quick queries and React CALL timing. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive request schema. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive response/event/observation schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate TrainingPosition schema. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Increment behavior artifact to 0.4.0-combat-react-1. |
| [scripts/generate-react-replay.ts](../scripts/generate-react-replay.ts) | Write deterministic new replay and report counts/hash. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate retained replay family under the new source artifact and additive state contract. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate retained replay family under the new source artifact and additive state contract. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate retained replay family under the new source artifact and additive state contract. |
| [tests/fixtures/react-card-sources.v1.json](../tests/fixtures/react-card-sources.v1.json) | Pin raw Floor It/Bombus records, capture hashes and printing metadata. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | New complete 53-action/51-position replay with content, observations/events/hashes. |
| [tests/fixtures/react-rules.v1.json](../tests/fixtures/react-rules.v1.json) | Pin exact reviewed rule excerpts, raw/processed rules/errata hashes and decisions. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate retained replay family under the new source artifact and additive state contract. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate retained replay family under the new source artifact and additive state contract. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate retained replay family under the new source artifact and additive state contract. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing wire vectors under the final engine pin. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Persist/read-check the full React trace and contiguous history under final pins. |
| [tests/react-fixture.ts](../tests/react-fixture.ts) | Handwritten real-card normalization and separate reviewed ruleset/deck fixture. |
| [tests/react-replay.ts](../tests/react-replay.ts) | Legal setup/normal turns/real reaction flow without state or RNG patches. |
| [tests/react.test.ts](../tests/react.test.ts) | 24 substantive tests covering reactions, continuations, privacy, hashing, replay and limits. |

### Python harness

| File | Change |
|---|---|
| `scripts/test_engine_adapter.py` | Add `react-replay` to the generic Node-authoritative fixture loop. |
| `docs/engine-interop.md` | Document seven replays, current artifact, reaction observations/decisions, closed boundary and retained legacy gaps. |

## Unsupported mechanics and rule ambiguities not guessed

- Combat resolution remains intentionally unavailable: power comparison/fight, damage, defeat/state-based defeated movement, Gig steal counts/selection/transfer, normal combat cleanup and return from completed combat.
- Go Solo/field Legend execution, ordinary activated abilities during React, inherited Gear Blocker, cannot-be-blocked restrictions, unreviewed Quick cards, generic simultaneous triggers, replacements and universal modifier layers remain unsupported.
- The selected Floor It modifier has exactly the reviewed turn duration. The pinned rules do not clearly establish modifier persistence when the affected Unit leaves and returns. The current trusted movement API returns UNSUPPORTED_MODIFIER_ZONE_CHANGE for such departures. This must be reviewed before supporting movement/fight consequences involving those modifiers; no generalized zone-reset rule was invented.
- QUICK's broad field-effect wording (11.26.1.2) is read with the specific Program rule (9.10.1) and MAIN/React permission (11.26.2). No generic field Quick activation was inferred. No arbitrary blocker count, Lag restriction, original-target cache or priority exchange was introduced.
- Full deck-format execution is not certified. Both supplied 30-card reference lists stay unchanged; constructed fixture requirements stay unchanged. Other apparently simple cards still require their own complete shape/source review before admission.
- Existing no-Gig Street Cred numeric 0 remains a known approximation of Null. Existing legacy Python deck-validator gaps remain. These are not expanded or silently fixed by the reaction slice.
- Final verification has no remaining lint/build warnings. Source text/metadata reviews are implementation reviews, not human-certified gold labels.

## Recommended next milestone

Separately review and implement bounded combat resolution from COMBAT_RESOLUTION_PENDING: final target → fight or successful Gig-area hit → power/loser rules → defeat/state-based movement and Gear-follow semantics → Gig steal count and strategic selection → control transfer → combat-duration cleanup → MAIN. Resolve temporary-modifier zone lifecycle before enabling affected departures. Keep the admitted card set narrow; do not begin an entire demo match until its necessary card and format policies are reviewed.
