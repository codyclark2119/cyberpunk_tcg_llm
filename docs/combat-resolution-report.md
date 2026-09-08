# Combat resolution milestone

Both bounded branches now complete: explicit PASS_REACT automatically resolves a Unit fight or opens a strategic Gig-steal choice, performs defeat/movement or same-instance Gig transfer, then restores active-player MAIN. All seven earlier replay policies remain reproducible. No card-pool expansion, demo match, commit, push, migration, model download or training occurred.

## Runtime and artifact

Verified Node **v22.13.0**, npm **10.9.2**. Application package version remains **0.3.0**; Next.js remains **16.3.4**. Behavior artifact: **0.4.0-combat-resolution-1**.

Artifact SHA-256: `50df6ad594d32a44473293fd154be7674c27345ce06883d010b120d33c3a7f6d`.

The artifact includes domain/engine/wire sources, worker bootstrap, identity script and lockfile. All replay fixtures and wire goldens were regenerated under this pin. Ruleset version `combat-resolution-1` explicitly enables `COMBAT_RESOLUTION_V1`; historical policies retain their earlier stops. No package or dependency versions changed.

## Deck-format context

Official constructed remains **40–50 main-deck cards**, preserving the repository's reviewed component interpretation, Legend count, copy rules and validation. Constructed validation was not weakened. The physical Arasaka and Merc teaching lists remain **27 main + 3 Legends = 30 total** each; Merc Psycho Squad remains **3 copies**. All 29 roadmap card/deck/copy rows were compared with HEAD and are unchanged. No `DEMO_STARTER` policy was introduced. Replays use existing legal synthetic support decks with 42 main cards and three Legends, not the physical teaching lists.

## Combat-resolution rules reviewed

[combat-resolution-rules.v1.json](../tests/fixtures/combat-resolution-rules.v1.json) contains **118 exact processed rule records**, decisions and four capture hashes. Every copied text was checked against the pinned local JSONL. No corpus refresh occurred.

| Capture | SHA-256 |
|---|---|
| Raw comprehensive rules | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed rules | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Raw errata | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

| Rules | Reviewed implementation decision |
|---|---|
| 1.7.1–1.7.3 | Ownership never changes; area control may change. |
| 2.10–2.10.2 | Negative derived numbers remain negative; all references/comparisons treat them as zero. Null is not zero. |
| 3.17.2–3.17.4 | Current power is printed power plus current Gear and modifiers; printed revisions remain immutable. |
| 5.3.2.2, 5.4.2, 5.5.2 | Entering a hidden area removes attached modifiers; Hand and Deck are hidden. |
| 5.9.2–5.9.4.2, 5.13.1 | Trash and Removed are public. Owner chooses simultaneous Trash entry order; free subsequent Trash reorder exists in the rules. |
| 4.4, 4.12 | Reuse host/Gear departure and special Legend removal contracts. No Go Solo execution added. |
| 9.14–9.17.3 | Final Unit target fights; final Gig area proceeds to steal. Compare after React; higher wins, equal/lower loses, a tie has no winner. |
| 9.18–9.20 | Fight-result triggers precede defeat; opposing Unit defeats a loser, except a zero-power Unit cannot defeat. No applicable real fight-result trigger or prevention is admitted. |
| 9.19.1.1, 11.19.2 | Defeated Unit moves to owner's Trash. DEFEATED becomes pending after declaration AND movement. No real DEFEATED card admitted. |
| 9.21–9.23.2.2 | Gig branch has no Unit fight; zero-reference power steals none, positive power permits `floor(power / 10 + 1)`. |
| 9.23.3–9.23.5.2 | Choose any available Gigs one at a time, as many as possible, then move all chosen together. Each is separately considered stolen. |
| 9.23.6–9.25 | Stolen triggers would follow all transfers, before attack end; none admitted. |
| 9.26–9.29 | Invalid attacks do not reopen target selection. After outcome/pending work, remove attack-duration effects and continue turn player's MAIN. |
| 8.16.1–8.16.2, 10.23 | Turn-duration effects survive combat cleanup and expire at global turn end. |

The prior React fixture omitted 2.10.1 and did not resolve target zone lifecycle. This review explicitly adds those rules without changing historical fixture behavior under older policies.

## Temporary modifier zone lifecycle

Floor It tracks its physical target CardInstanceId. The implementation combines the explicit hidden-entry removal rule with the public-area definitions and its explicit turn duration: no general public-zone departure reset was found or invented. A defeated ordinary Unit keeps Floor It's modifier in public Trash; a trusted public Removed departure also retains it. The modifier still contributes to the current public characteristic there. Gear bonuses disappear when detached.

The shared movement entry point removes target modifiers on supported Hand entry, emitting `POWER_MODIFIER_EXPIRED { reason: HIDDEN_AREA }`. Validation rejects modifiers on hidden targets. Returning that physical card does not resurrect the removed modifier. Deck is also hidden by rule, but a new bottom-deck movement operation was not added in this milestone. Its eventual implementation must use the same hidden-entry policy. Old React-only movement still reports its historical unsupported modifier-zone-change boundary.

End of turn uses existing expiration with reason TURN_END, including a target now in Trash. Combat cleanup never expires Floor It. No combat-duration modifier representation was introduced because no admitted mechanic needs it. No universal object-in-zone identity or general continuous-effect layering framework was invented.

## Fight state machine and power

```text
RIVAL_REACT
  → explicit PASS_REACT
  → COMBAT_RESOLUTION_PENDING (event within the same transition)
  → final CARD target: FIGHT_STARTED
  → current RulesView.getEffectivePower for both participants
  → FIGHT_RESULT
  → optional DEFEAT_ORDER_SELECTION for owner's Unit/Gear Trash order
  → typed defeat operation → shared departure/state-based movement
  → trigger-discovery boundary (no admitted DEFEATED triggers)
  → ATTACK_ENDED(COMPLETED) → MAIN
```

No RESOLVE_COMBAT action exists. The normal fight without a genuine choice completes inside PASS. `advanceResolutionWithEvents` can resume a trusted validated pending boundary with the same reducer and returns `{ state, events }`; it stops at a genuine player choice. The original state-only `advanceResolution` compatibility helper refuses event-producing progression rather than dropping the batch. No wire operation or service was added.

RulesView and validation share the same pure effective-characteristic implementation. The result event records raw effective and comparison powers; GameState has no cached fight power or winner. Negative power is preserved in observations and additive arithmetic, then referenced as zero under 2.10.1. Source-power conditions use that reference rule under the new policy too. Null combat power is explicitly unsupported rather than coerced.

| Comparison | Result |
|---|---|
| Higher versus lower | Higher wins; lower loses and is defeated by the positive-power opponent. |
| Equal positive powers | Both lose, neither wins, both are defeated. |
| Zero versus zero | Both lose, neither wins, neither can defeat. |
| Negative versus zero / another negative | Compare as zero: both lose with no defeat. |

## Defeat, Gear and Blocker

`defeatCards` is a trusted typed semantic operation reusable by future effect handlers, not a player action or a disguised generic move. It checks the complete admitted ordinary Unit shape, source identity and exact owner Trash orders before mutation. Cross-owner Unit/Gear destinations and unsupported defeat-trigger shapes fail explicitly. All defeat facts are emitted before movement; `processDeparture` handles the same physical Unit and its attached Gear, removes attachment relations and retains identity, ownership, controller metadata and revision.

A host plus Gear requires the owner's order under 5.9.4.1. `DEFEAT_ORDER_SELECTION` asks for one next card, automatically finishing a sole remainder. For a positive tie with Gear on both Units, collect both owners' orders before moving either batch. There is no interleaved effect resolution between movement entries. Ordinary one-card defeat is automatic. Although 5.9.4.2 allows free Trash reordering, the engine does not silently select an owner's initial order; a general free-reorder action remains outside this slice.

11.19.2 makes DEFEATED pending after declaration and Trash movement. Full-shape admission excludes all such real cards, so this pass does not add a pretend no-op trigger, LIFO stack or generic replacement scheduler. The existing PendingEffect architecture remains the future extension point.

Shared movement still contains the prior special Legend departure rule: Gear reaches its destination and the invalid-area Legend moves alone to Removed. Executable fight defeat remains ordinary Units only. Go Solo and field-Legend combat were not admitted.

Combat reads only the current locked target. Tests start with a Gig-area target, redirect through Bombus, then prove that only Bombus fights and the original Gigs are untouched. The original target exists only in the existing redirection event history.

## Gig-area attack, allowance and selection

```text
PASS_REACT → COMBAT_RESOLUTION_PENDING
  → final GIG_AREA target: GIG_STEAL_STARTED(power, allowance, count)
  → zero count: cleanup
  → all available forced: select automatically
  → otherwise GIG_STEAL_SELECTION
       CHOOSE one actual public Gig by actionId
       exclude previously chosen Gig; decrement remaining
       repeat only while a strategic choice remains
  → move all selected Gigs together
  → per-Gig stolen facts → cleanup → MAIN
```

The pinned policy is `{ nonPositive: 0, positiveDivisor: 10, positiveBase: 1 }`. `getGigStealAllowance` centralizes the arithmetic: 1–9 allows one, 10–19 two, 20–29 three, and so forth. Count is capped by available rival Gigs. Zero/negative attacks complete without stealing. No independent redundant ATTACK_SUCCEEDED event was needed; GIG_STEAL_STARTED records the branch and allowance, including zero.

Choice IDs use deterministic turn/attacker/selected-instance data, not transport counters. Legal action IDs retain POSITION_V2. Continuations store selected Gig IDs and remaining count; validation rederives the count from current power and available Gigs, and rejects duplicates, foreign/transferred selections, forged options, wrong actors and unstable forced choices. No combinations are materialized as giant actions. No die moves before selection is complete.

Rule 9.22 specifies no stealing if the area is empty when the Steal Step begins. An empty externally supplied locked target is rejected by current target-validity checks (9.26); no admitted intervening effect can empty it between validated PASS and calculation. The count calculation handles zero available Gigs, but no unreviewed mid-resolution empty-area transition or automatic state repair was introduced.

## Transfer and Street Cred

`transferGigs` is the shared trusted batch operation, also used by the existing public `transferGigControl` primitive. It validates the whole batch first, moves all instances, then emits canonical control-change facts. Combat emits one GIG_STOLEN per selected Gig after all movements; no decision, observer or trigger can interleave transfers. Selected action order is retained in selection events, while transfer serialization sorts instance IDs so map insertion order never controls output.

Gig ID, ownerId, dieType, initialValue and currentValue remain unchanged. Only controller/location and matching player area references change. No reroll or new die occurs. Tests deliberately alter current values away from initial rolls before stealing, so resetting to the initial roll would fail. Street Cred is still computed from current values of controlled Gigs; no stored counter is mutated.

The headline steals the same `p1-D12`, current value 2. Street Cred changes from **15 → 17** for the attacker and **13 → 11** for the defender. Focused tests exercise a real Kerry with three Mantis at power 11, choosing two of three rival Gigs sequentially, and allowance exceeding the available supply.

## Cleanup, events, observation and training

Cleanup clears CombatState and outcome continuations/choices, restores acting player to the unchanged active attacker, emits ATTACK_ENDED(COMPLETED) and PHASE_CHANGED(MAIN). Surviving attacker and Blocker remain spent. Another ready eligible Unit may attack in the same turn; no arbitrary attack counter was added. Existing Spent-only Unit target legality remains intact.

Added facts are FIGHT_STARTED, FIGHT_RESULT, CARD_DEFEATED, DEFEAT_TRASH_ORDER_SELECTED, GIG_STEAL_STARTED, GIG_STEAL_SELECTED and GIG_STOLEN. Existing React closure, card movement, Gear detach, control change and phase facts complete the explanation. Modifier expiration adds HIDDEN_AREA alongside TURN_END.

Both viewers observe public participants/targets, current effective power, public modifier records, attachments, public Trash/Removed cards and final boards. Fight history/results and movement order are delivered through the typed transition event batch rather than duplicated in state. Gig selection adds public selected IDs/remaining count to observation; existing public Gig records retain identity/type/current value/controller. The defender receives no attacker actions. Hand/deck identities and RNG remain excluded from modelInput.

TrainingPosition remains schema version 2; wire envelopes remain v1 and POSITION_V2 is unchanged. The exporter regenerates request, response and TrainingPosition schemas; TrainingAttempt output is byte-unchanged. Replay generators include only positions with more than one legal action. Automatic fight arithmetic, movement and cleanup produce no samples. Strategic Gig selection does; owner Trash ordering is also a real decision when necessary.

## Demo roadmap and card coverage

No new normalized card revision was introduced. Completed bounded combat now covers the existing reviewed Swordwise, Kerry, Mantis, Floor It and Bombus interactions. Viktor CALL/search and all prior mechanics remain intact. The demo roadmap removes generic fight as a blocker while retaining explicit admission gaps for Emergency Atlus, Psycho Squad and all other unreviewed full printed shapes. Generic defeat availability does not certify Minotaur or Over the Edge effects. No card is newly labeled FULL_GAME.

## Replays

All nine fixtures initialize through the engine. The two headline traces use ordinary legal setup, play/payment, Lag, turns, equip and attacks without state/RNG patches. The fight extends the React trace: Swordwise `p0-c12` at power 4 versus Bombus `p1-c19` at zero, Bombus defeated into Trash, then MAIN with Floor It and Mantis still affecting the spent attacker. The Gig trace chooses among three rival Gigs and completes control transfer. Focused tests are explicitly identified as trusted validated fixture preparation.

| Family | Actions | Strategic positions | Events including initialization | Final ReplayStateHash |
|---|---:|---:|---:|---|
| turn-replay | 7 | 3 | 53 | `75143da590a1ef836fe0c271d37d96524c39a6baabb14ca7fc9ac47692c2aa35` |
| setup-replay | 10 | 7 | 67 | `ebd65aca1f6df459e6ba254b3f79155cabf95fdb04905cca5d6e3cc71e5df84c` |
| reviewed-replay | 11 | 11 | 65 | `d96613e90e5be54d5718d984d08285b4ed09abbdc8f84d17dab27659f84a0258` |
| noncombat-replay | 24 | 23 | 125 | `b132203a9aa375046ad64dad1e8cad0626cc1e0c5cc836ed0de8dc07eaae57e0` |
| gear-replay | 25 | 25 | 99 | `daa92a9743f536d197d2c648234f0b9acc60c153d093e85e22de67b36d339b69` |
| combat-attack-replay | 41 | 40 | 185 | `e03fec8f0959265a85b6694775fcba2c399782f6c939299fe2ee1ef640d572da` |
| react-replay | 53 | 51 | 229 | `f7f6aea0707497bdc61cd4b73eb4876a69bdfe718f552307b421fac6a9f0df3e` |
| fight-replay | 53 | 51 | 236 | `7a47607f4eaf93f891f8a8c4b5149a8ffea97d577411fe5a1529a48fe2a8e2de` |
| gig-steal-replay | 46 | 45 | 203 | `3ae09d1688eec885f8ea9d64396d7ccce244e41837c5f95bb307da14c8b07b4f` |

## Persistence and Python/wire

The real MongoDB test passed against `127.0.0.1:27018`; PostgreSQL passed against `127.0.0.1:5433/cyberpunk_tcg`. Tests create randomized isolated databases/schemas, and remove only their own fixtures in finally blocks. No application data migration was necessary.

PostgreSQL now saves and reloads every state in both complete combat traces, checking replay and semantic hashes after each transition, complete contiguous event history, final MAIN, attachments/modifiers and derived Street Cred. Existing ledger idempotency, stale updates and transaction rollback checks remain passing. Mongo immutable revision/history/search tests are also unchanged and passing. The synchronous pending/automatic stages are represented by events within a transition, not fabricated separately persisted player decisions.

The generic Python adapter reproduced initialization, all actionIds, exact event batches, observations, hashes and final states for **all nine replay families**, plus seven wire golden round trips. No Python combat rules, data schemas or runtime adapter implementation changed: only its fixture list and interop documentation changed. The original 87 game tests and 48 core tests passed. Existing seven-case deck-validator differential still reports the same two known legacy Python gaps: `repeated-entry-copy-bypass` and `legend-in-main`.

## Tests and commands

All final gates exited **0**. The TypeScript suite has **172 passing tests**, comprising 144 retained tests and 28 new combat-resolution tests. The new matrix covers higher/lower/tie/zero/negative power, current Gear/Floor It and immutable revisions; semantic defeat/identity/Gear ordering/movement/modifier duration; redirected Gig-area fights; steal bands, strategic sequential choice and insufficient supply; owner/control/initial/current values and derived Street Cred; cleanup/another attack; malformed participants and continuations, stale/forged atomic failures; private observation boundaries, POSITION_V2 equivalence, event-preserving automatic resume and both exact wire replays.

Verification commands below were run from the indicated repositories. Output redirection captured logs in `/tmp`; it did not change the checks. Scripts were rerun after implementation corrections and the final artifact change.

Application runtime and gates:

```bash
cd /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
npm run typecheck > /tmp/tcg-resolution-typecheck.log 2>&1
npm run lint > /tmp/tcg-resolution-lint.log 2>&1
npm run validate:cards
npm test > /tmp/tcg-resolution-tests.log 2>&1
npm run build > /tmp/tcg-resolution-build.log 2>&1
npm run contracts:export
git diff --check
```

| Command | Final result |
|---|---|
| node / npm versions | v22.13.0 / 10.9.2 |
| typecheck | Pass, root and web TypeScript after GraphQL generation |
| lint | Pass, no warnings |
| validate:cards | Pass, 4 bootstrap catalog records; this does not count the separate reviewed engine fixture bundles |
| npm test | 172/172 pass, no skips |
| build | Pass: compiled, typechecked, prerendered; `/api/graphql` retained |
| contracts:export | Pass; request/response/TrainingPosition updated, TrainingAttempt unchanged |
| git diff --check | Pass in both repositories |

Final regeneration used the exact loop:

```bash
for script in generate-wire-golden generate-turn-replay generate-setup-replay generate-reviewed-replay generate-noncombat-replay generate-gear-replay generate-combat-attack-replay generate-react-replay generate-combat-resolution-replays; do
  node --import tsx scripts/$script.ts || exit $?
done
npm run contracts:export
```

All generators passed with counts and hashes in the replay table. The wire generator retains seven golden cases. The focused command also ran during implementation:

```bash
node --import tsx --test tests/combat-resolution.test.ts > /tmp/tcg-resolution-focused.log 2>&1
```

That run passed 27/27 before adding the automatic-resume test; the final full suite includes all 28. Early development checks caught a narrowed-union assignment, test-only branded identifiers/library compatibility, and a test using the wrong wire envelope. These were corrected before final gates. One initial typecheck invocation from the outer training workspace exited before reaching the application and was rerun from the correct repository.

Live infrastructure:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 \
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg \
npm run test:integration > /tmp/tcg-resolution-integration.log 2>&1
```

Result: **2/2 pass, no skips**, including persistence of both completed traces. The command used the approved local-network sandbox escalation; existing infrastructure was reused.

Harness:

```bash
cd /Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm
mlx_env/bin/python -B scripts/test_engine_adapter.py \
  --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online \
  --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node \
  > /tmp/tcg-resolution-python-adapter.log 2>&1
mlx_env/bin/python -B scripts/test_cyberpunk.py > /tmp/tcg-resolution-python-game.log 2>&1
mlx_env/bin/python -B scripts/test_harness_core.py > /tmp/tcg-resolution-python-core.log 2>&1
git diff --check
```

Results: nine complete replays and seven wire goldens pass; **87/87** game tests; **48/48** core tests. A read-only Python verification additionally matched all four capture SHA-256s and all 118 copied rule texts, checked the 29 roadmap rows against HEAD, and compared file bytes against a before-work baseline. Only the two listed harness files changed during this milestone; its pre-existing staged/raw-data work was preserved.

## Files changed

Paths below are relative to the indicated repository. Generated replay changes are expected because the behavior artifact is part of their content/state/action pins.

Application: **43 files**.

| File | Change |
|---|---|
| [docs/combat-resolution-report.md](../docs/combat-resolution-report.md) | Complete rules, behavior, gates, pins, inventory and limitations for this milestone. |
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Update generic combat availability while preserving every card/deck/copy row and separate format review. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Document bounded resolution capability with no new card/revision or FULL_GAME admission. |
| [docs/pre-gameplay-contracts.md](../docs/pre-gameplay-contracts.md) | Document the additive event-preserving automatic-resolution driver. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Typed outcome stages, continuations, defeat instructions and historical events; hidden-entry expiration reason. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Explicit reviewed resolution, negative-reference, modifier identity and Gig formula policy. |
| [packages/engine/src/card-movement.ts](../packages/engine/src/card-movement.ts) | Expose shared trusted departure processing and connect hidden-entry modifier expiration. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Retain turn power modifiers on public departed targets under the new policy. |
| [packages/engine/src/combat-outcome-queries.ts](../packages/engine/src/combat-outcome-queries.ts) | Pure fight evaluation, stealable Gigs and deterministic choice construction. |
| [packages/engine/src/combat-outcome-state.ts](../packages/engine/src/combat-outcome-state.ts) | Validate exact exclusive steal/defeat-order continuations and current combat coherence. |
| [packages/engine/src/combat-resolution-policy.ts](../packages/engine/src/combat-resolution-policy.ts) | Policy opt-in, negative-reference rule and centralized Gig allowance arithmetic. |
| [packages/engine/src/combat-resolution.ts](../packages/engine/src/combat-resolution.ts) | Automatic fight/steal branches, strategic continuations and MAIN cleanup. |
| [packages/engine/src/combat-state.ts](../packages/engine/src/combat-state.ts) | Integrate new outcome validation and policy dependencies; retain old boundaries. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Apply the reviewed nonnegative reference rule to source-power comparisons. |
| [packages/engine/src/defeat.ts](../packages/engine/src/defeat.ts) | Reusable typed defeat support, batches and shared state-based departure operation. |
| [packages/engine/src/gig-transfer.ts](../packages/engine/src/gig-transfer.ts) | Reusable validated simultaneous control-transfer batch and canonical events. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Enumerate/dispatch outcome choices, reuse Gig transfer and expose event-preserving automatic resume. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Public outcome stages/steal progress and current power on public departed cards. |
| [packages/engine/src/rival-reactions.ts](../packages/engine/src/rival-reactions.ts) | Explicit PASS invokes automatic combat only under the new policy. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Accept reviewed outcome timing/actors while preserving all existing invariants. |
| [packages/engine/src/temporary-power.ts](../packages/engine/src/temporary-power.ts) | Validate public target lifecycle and remove hidden-entry modifiers with a fact. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Read-only defender, steal allowance, stealable Gig and controlled-count queries. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerated additive ruleset/state request schema. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerated additive state/event/observation response schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerated TrainingPosition v2 contents under the existing contract filename. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Increment behavior artifact version; source hash automatically changes. |
| [scripts/generate-combat-resolution-replays.ts](../scripts/generate-combat-resolution-replays.ts) | Generate both complete replays and report counts/final hashes. |
| [tests/combat-resolution-fixture.ts](../tests/combat-resolution-fixture.ts) | Opt-in reviewed resolution bundle using unchanged existing card revisions. |
| [tests/combat-resolution-replay.ts](../tests/combat-resolution-replay.ts) | Named fight and Gig replay entry points. |
| [tests/combat-resolution.test.ts](../tests/combat-resolution.test.ts) | 28 focused rules, invariants, power, choice, privacy, atomicity and replay/wire tests. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/combat-resolution-rules.v1.json](../tests/fixtures/combat-resolution-rules.v1.json) | 118 exact pinned rules, four source hashes and explicit implementation decisions. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | New complete 53-action fight replay with private audit states and strategic positions. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | New complete 46-action strategic steal replay. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate the existing replay under the new artifact while preserving its historical policy. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate seven existing wire cases under the new engine artifact. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Persist/read-check both complete combat traces and histories against real PostgreSQL. |
| [tests/react-replay.ts](../tests/react-replay.ts) | Reuse the existing legal trace with optional new-policy fight/Gig branches; historical default retained. |

Harness: **2 files** modified during this milestone.

| File | Change |
|---|---|
| `docs/engine-interop.md` | Explain new Node-authoritative outcome/choice boundaries, contracts, privacy and unchanged format scope. |
| `scripts/test_engine_adapter.py` | Add fight and Gig-steal fixtures to the generic replay driver; no gameplay implementation. |

## Unsupported semantics and deliberately unresolved questions

No build/lint/typecheck warnings remain. Known scope and technical debt are explicit:

- Go Solo, executable battlefield Legends and cross-owner card/Gear defeat destinations remain unadmitted. Existing generalized Legend movement contracts were preserved and their earlier tests still pass.
- Reboot Optics prevention, replacement effects, cannot-attack/cannot-be-blocked restrictions, Satori fight-win effects, complex DEFEATED effects, stolen/steal-history effects and Yorinobu trait/first-attack/discard behavior remain unsupported. Complete unknown shapes cannot silently no-op through defeat support.
- Generic simultaneous trigger scheduling, general free Trash reordering, new bottom-deck departure operations, additional continuous layers and broader card pools were not inferred from this bounded implementation.
- Null power is not treated as zero or admitted to numeric combat. The earlier zero-valued no-Gig Street Cred observation remains an existing documented Null approximation; this pass did not overhaul Street Cred semantics.
- The two legacy Python deck-validation differential gaps remain unchanged and reported. Python owns no new combat rule/schema copy.
- Physical demo policy exceptions still require separate source review. Emergency Atlus and Psycho Squad remain explicitly unreviewed for execution despite baseline fight availability. The application bootstrap card validator still checks four catalog records, independently of the richer pinned engine test bundles.

No additional unresolved rule gap blocks these admitted fight/steal branches. The public/hidden modifier decision is recorded as a reading of the explicit hidden-entry removal rule and duration/public-area rules, not a universal identity law borrowed from another game. No new combat-duration mechanic, damage system, card effect or demo-format exception was guessed.

## Recommended next milestone

Review replacement/prevention and simple remaining combat restrictions using the pinned captures and explicit focused fixtures. Then close full printed-shape execution gaps in the two demo lists systematically. Review a separate starter/demo legality/setup policy before attempting the exact 27-main + 3-Legend full match. Preserve official constructed independently.

No changes were staged, committed or pushed. Pre-existing harness work, corpus/gold/eval data and model assets were preserved.
