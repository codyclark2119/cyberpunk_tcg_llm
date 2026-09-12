# First exact Arasaka vs Merc Demo match

**Matrix review (September 10, 2026):** [Demo match matrix and self-play readiness](demo-match-matrix-report.md) reviewed nine exact coordinates: six completed, three reached overlapping Reboot. Full-game expansion stopped; unattended self-play is **BLOCKED** pending source semantics. The original verified headline, 29-card roster and 60 physical copies remain unchanged.

## Runtime

September 10, 2026. Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine remains **0.4.0-overtime-1** / `d79422b2512215c41bddbf17945ee061c660a5b04a845ea000b7dce6fdcd877d`. No runtime, rule, card or wire change was required. This is a test/integration milestone, with a separately versioned fixture policy.

## Exact match manifests

The unchanged fixed pair is explicitly assigned p0 = **ARASAKA_DEMO_V1**, p1 = **MERC_DEMO_V1**, each 27 MAIN + 3 Legends = 30 physical cards. Arasaka has 14 distinct cards and Merc 15; Psycho Squad remains exactly three copies.

| Manifest | Verified composition hash |
|---|---|
| ARASAKA_DEMO_V1 | `7ef234191430bce642888161bcad4127c138faddb41c826a0f7b8b68fd90a386` |
| MERC_DEMO_V1 | `c0551a2293a54080e44cbf45afbd7daf96d9b8b33ef9b113037647004991c38e` |

Initialization asserts those hashes and exact per-seat physical multisets. No filler, padding, substitutions, quantity changes, alternative Legends, revision changes or fake RAM support. The complete reference manifest file and all 29 physical roadmap rows remain byte-identical within their original content.

## Real-only content bundle

Exactly **29 real reviewed revision-1 cards**, with 60 physical instances at initialization and termination. Bundle hash remains `108d71feb46f427987016bd4935ab2dd563581861eee13c11a155ee9409cb6f2`. Every snapshot equals its existing reviewed counterpart; all 53 historical reviewed revisions remain unchanged. The exact game contains none of the historical synthetic support cards. No source corpus refresh, Mongo card seed or card publication was needed.

## Format/ruleset

Explicit **DEMO_STARTER_V1**, ruleset `beta@demo-overtime-1` / `0cf3dcd40766cd4b699e16842a0b6a66d3b1ecdf9b678986bf7686139dc800ab`. Exact-pair legality, either-seat admission, copy/RAM rules, Comprehensive setup, opposed d20 and STANDARD_OVERTIME_V1 are unchanged. Constructed remains 40–50 MAIN / 3 Legends. The new policy described below is a replay chooser, not a game ruleset.

## Match policy

[demo-match-policy.ts](../tests/demo-match-policy.ts) defines **DEMO_MATCH_POLICY_V1**. It has no card-name branches, replay-step script, state argument or runtime imports. The same pure function serves both seats.

For setup, it chooses FIRST, declines all four cuts and keeps both opening hands. Among offered dice it prefers the largest die label; the engine alone withholds D20 until eligible. MAIN priorities are SELL while below seven Eddies, GO_SOLO, PLAY_CARD, blind CALL, activated ability, ATTACK, then END_TURN. Ranks apply only to offered actions; effects can make a higher-priority action available later in the same turn. React ranks offered plays/CALLs before Blocker, then PASS. This is a simple integration policy, not a strong game AI.

Choice ranking prefers Eddie payment, rival Gig-area attacks, taking inspected Gears, optional effects, higher-value Gigs to steal, rival public defeat/spend targets, ready/high-power public spend targets and larger offered adjustments. Remaining ties use label then opaque actionId, including blind Legend slot labels. Forced singleton actions are selected directly by the same ranking. All ranks operate only over engine-enumerated actions; the policy never computes legality, payment feasibility, combat outcomes or card-effect rules.

## Policy information boundary

The runner passes exactly `{ observation, legalActions: [{ actionId, descriptor }] }`. It strips actorId, raw action payload, choice indices and authoritative state before calling the chooser. Only the acting player's entitled observation is used; no bundle, future deck order, seed, RNG, private opponent cards or replay index is passed. Tests enforce type-only policy imports, two function parameters and absence of state/RNG/I/O escape identifiers; reversed legal-action input order preserves the choice.

The runner and diagnostic audit necessarily hold trusted state to invoke the engine, record snapshots and verify privacy. They never feed that state into ranking. The separately labeled hidden-permutation and suppressed-Reboot negative probes operate only on test clones, never on headline initialization or transitions.

## Seed search methodology

Bounded candidates were configured as `exact-demo-match-0` through `exact-demo-match-15`, with 1,200 actions and 100 global turns as defensive search ceilings, not game rules. Each candidate uses exact initialization, engine RNG, legal action enumeration and the same observation-only policy. A cap can reject a candidate; any non-cap engine, admission or deadlock error stops the search for investigation rather than trying a seed that avoids it.

A separate read-only audit also detects an affordable second next-fight prevention omitted by the current bounded canPlay gate. It checks only present resources/timing and source mechanics, does not mutate state, and stops on that known unsupported interaction. A negative fixture proves it catches the gate. Normal regeneration uses the frozen selected seed directly and never searches.

## Seed search results

[exact-demo-match-search.v1.json](../tests/fixtures/exact-demo-match-search.v1.json) records the complete search:

| Measure | Result |
|---|---:|
| Configured maximum candidates | 16 |
| Actually searched | `exact-demo-match-0` only |
| Initialized | 1 |
| Terminated | 1 |
| Unsupported/engine gap | 0 |
| Defensive cap | 0 |
| Failed candidates | 0 |

The first candidate reached the preferred normal seven-Gig terminal condition. No other seed or alternative policy was tried. Its acceptance was then confirmed by determinism, privacy, persistence, Python and full quality gates; no failed seed was hidden.

## Chosen seed

**`exact-demo-match-0`**, selected because it was the first complete legal candidate and passed all required checks. No seed, RNG, deck, hand, card, Gig or state patches occur in the generator. No winner or turn-cap adjudication is imposed.

## Initialization

The engine performs existing Comprehensive setup in its usual order: opposed first-player selection, FIRST/SECOND choice, main and Legend shuffles/cuts, first player's two leftmost Legends spent, original Fixers prepared, six-card hands and whole-hand mulligan decisions. Four cut decisions are declined legally. The runner never edits shuffled arrays or initial cards. Seven setup actions precede ordinary gameplay; initialization begins with the engine's two opposed-roll events.

## Opposed-d20 result

Round 1 naturally rolls **Arasaka 2, Merc 20**, with no tie. These results come from initialized engine RNG and are retained in state/events and both public observations. The existing tie-reroll regression remains separate.

## FIRST/SECOND decision

The higher roller, Merc/p1, legally chooses **FIRST** using the same constant policy choice available to either seat. Merc is active on odd global turns and Arasaka on even turns. This single result does not imply a seat or first-player advantage.

## Mulligans

Both players choose **keep**. This version deliberately uses an unconditional keep criterion for reproducibility; it does not evaluate unseen cards or future draws. Six-card hands and both MULLIGAN_DECLARED events are preserved. Existing whole-hand mulligan tests and the standalone setup replay are unchanged.

## Game result

```text
Winner: Arasaka (p0)
Terminal reason: START_TURN_GIGS
Seed: exact-demo-match-0
Global turn: 14
Actions: 244
Strategic positions: 195
Events: 975
```

**First exact physical Demo-vs-Demo deterministic game: VERIFIED.** Arasaka controls seven Gigs and Merc five. This proves one complete game, not exhaustive correctness across all games.

## Terminal reason

**START_TURN_GIGS.** The last submitted action is Merc’s END_TURN on turn 13. Automatic transition starts Arasaka’s turn 14, detects seven controlled Gigs and ends before Ready/draw or any turn-14 player action. No surrender, test-only win, manual control transfer or forced result is used. Arasaka wins with Street Cred 17 against Merc’s 28, illustrating that this condition uses Gig count.

## Global turns/actions/positions/events

**14** reached global turns (13 complete turns plus terminal start of 14); **244** engine-enumerated actions, including seven setup actions; **195** strategic contract positions; **975** authoritative events including initialization; exactly **one GAME_ENDED**. The four cut choices and other singleton decisions are excluded from strategic positions. No terminal position carries an action label.

## Per-turn summary

Actual global-turn diagnostics follow. Main actions are listed in order; effect/payment/target continuations and rival reactions are retained in the replay, not collapsed into fake actions. **No pending end-turn card effects occurred on any turn**; ordinary cleanup remains engine-owned.

| Turn | Active | Die/result | Main actions | Attacks / Gig transfers | Overtime progress |
|---:|---|---|---|---:|---:|
| 1 | Merc | D12=2 | Sell Floor It; Play Evelyn Parker: Scheming Siren; END_TURN | 0 / 0 | 0 |
| 2 | Arasaka | D12=6 | Sell Industrial Assembly; Play Corpo Security; Play Industrial Assembly; Call face-down Legend 1; END_TURN | 0 / 0 | 0 |
| 3 | Merc | D10=6 | Sell Mandibular Upgrade; Play Delamain Cab; Play Mandibular Upgrade; Attack with Evelyn Parker: Scheming Siren; END_TURN | 1 / 0 | 0 |
| 4 | Arasaka | D10=5 | Sell Over the Edge; Go Solo with Goro Takemura: Hands Unclean; Attack with Goro Takemura: Hands Unclean; END_TURN | 1 / 0 | 0 |
| 5 | Merc | D8=3 | Sell Floor It; Play Psycho Squad; Play Kiroshi Optics; Call face-down Legend 1; END_TURN | 0 / 0 | 0 |
| 6 | Arasaka | D8=3 | Sell Satori: Sword of Saburo; Play Field Operator; Play Corporate Surveillance; Attack with Goro Takemura: Hands Unclean; END_TURN | 1 / 1 | 0 |
| 7 | Merc | D6=3 | Sell Dying Night: V's Pistol; Play Kiroshi Optics; Play Psycho Squad; Call face-down Legend 2; Attack with Psycho Squad; END_TURN | 1 / 0 | 0 |
| 8 | Arasaka | D6=2 | Sell Satori: Sword of Saburo; Play Emergency Atlus; Play Field Operator; Attack with Field Operator; Attack with Goro Takemura: Hands Unclean; END_TURN | 2 / 2 | 0 |
| 9 | Merc | D4=2 | Go Solo with V: Corporate Exile; Sell Afterparty at Lizzie's; Play Evelyn Parker: Scheming Siren; Attack with Psycho Squad; Attack with Psycho Squad; Attack with V: Corporate Exile; END_TURN | 3 / 3 | 0 |
| 10 | Arasaka | D4=2 | Sell Mantis Blades; Play Goro Takemura: Losing His Way; Play Over the Edge; Attack with Emergency Atlus; Attack with Field Operator; Attack with Field Operator; Attack with Goro Takemura: Hands Unclean; END_TURN | 4 / 4 | 0 |
| 11 | Merc | D20=7 | Sell Dying Night: V's Pistol; Play Psycho Squad; Attack with Evelyn Parker: Scheming Siren; Play Secondhand Bombus; Attack with Psycho Squad; Attack with Psycho Squad; Attack with V: Corporate Exile; END_TURN | 4 / 3 | 0 |
| 12 | Arasaka | D20=2 | Play Corpo Security; Play Swordwise Huscle; Call face-down Legend 1; Attack with Emergency Atlus; Attack with Field Operator; Attack with Field Operator; Attack with Goro Takemura: Hands Unclean; Attack with Goro Takemura: Losing His Way; END_TURN | 5 / 4 | 0 |
| 13 | Merc | — | Sell Kiroshi Optics; Attack with Evelyn Parker: Scheming Siren; Play Dexter DeShawn: One Last Chance; Attack with Psycho Squad; Attack with Psycho Squad; Attack with Psycho Squad; Attack with V: Corporate Exile; END_TURN | 5 / 4 | 1 |
| 14 | Arasaka | — | Terminal start; no action | 0 / 0 | 2 |

## Mechanic occurrence matrix

Presence in the exact deck is not credited as execution.

| Mechanic | Status | Actual evidence/limit |
|---|---|---|
| CALL | OCCURRED | 6, including 2 in React |
| SELL | OCCURRED | 12 |
| Gear equip | OCCURRED | 3 onto Units |
| Gear on LEGENDS / pre-equipped Go Solo | DID NOT OCCUR | Prior focused regressions retained |
| Go Solo | OCCURRED | Hands Unclean and V |
| Attack / React | OCCURRED | 27 attacks; 27 closed reaction windows |
| Quick Program | DID NOT OCCUR | 0 |
| Blocker | OCCURRED | 5 declarations |
| Fight / semantic defeat | OCCURRED | 5 fights and 5 defeats |
| Gig stealing | OCCURRED | 21 transfers; 22 steal-resolution starts |
| Simultaneous multi-Gig steal | DID NOT OCCUR | No batch moved two Gigs |
| Program play | OCCURRED | Industrial Assembly, Corporate Surveillance, Over the Edge |
| Effect/order resolution | OCCURRED | 22 pending/resolved effects; 17 ordering facts |
| DEFEATED-trigger execution | DID NOT OCCUR | Dexter is played but not defeated |
| Kiroshi private look | OCCURRED | 2 looks; viewer-specific memory |
| Current Gig-value changes | OCCURRED | 3 GIG_VALUE_CHANGED facts |
| Targeted spend | OCCURRED | 1 effect-caused spend |
| Actual targeted defeat | DID NOT OCCUR | Over the Edge had no rolled-D20 target path |
| Delayed end-turn work | DID NOT OCCUR | Dying Night not played |
| Delamain end-turn trigger | DID NOT OCCUR | No qualifying pending work |
| Temporary power / Floor It | DID NOT OCCUR | No temporary power event |
| Positive Losing His Way +5 | DID NOT OCCUR | Declaration gate false |
| Positive Saburo attacking aura | DID NOT OCCUR | Revealed after last Arasaka attack turn |
| Yorinobu effect | OCCURRED | 1 pending/resolved effect |
| Reboot prevention / overlap | DID NOT OCCUR | Both copies undrawn |
| Lag cleanup | OCCURRED | 17 removals |
| Overtime qualification | OCCURRED | Progress 1 then 2 |
| Active overtime / overtime victory | DID NOT OCCUR | Normal victory occurs first |
| Deck-out | DID NOT OCCUR | Decks retain 11 / 9 cards |
| Normal seven-Gig victory | OCCURRED | Arasaka at start 14 |

## Card participation matrix

Counts cover physical copies; drawn means observed in HAND at a recorded boundary. Played includes field play through Go Solo; called is separate. Effect counts are EFFECT_PENDING/EFFECT_RESOLVED records attributed to the source object, not proof of every printed function; continuous effects do not emit pending records. Unseen means the physical identity never appeared in a hand, face-up zone, entitled inspected set or remembered Legend identity. A card may be inspected by Viktor without being drawn. This is trusted audit data, not player/model input.

| Reference card | Copies | Drawn | Played / called | Effects pending / resolved | Unseen copies |
|---|---:|---:|---:|---:|---:|
| Afterparty at Lizzie's | 2 | 1 | 0 / 0 | 0 / 0 | 0 |
| Corpo Security | 3 | 2 | 2 / 0 | 0 / 0 | 1 |
| Corporate Surveillance | 3 | 1 | 1 / 0 | 1 / 1 | 2 |
| Delamain Cab | 3 | 1 | 1 / 0 | 0 / 0 | 2 |
| Dexter DeShawn: One Last Chance | 1 | 1 | 1 / 0 | 1 / 1 | 0 |
| Dying Night: V's Pistol | 2 | 2 | 0 / 0 | 0 / 0 | 0 |
| Emergency Atlus | 3 | 1 | 1 / 0 | 0 / 0 | 2 |
| Evelyn Parker: Scheming Siren | 3 | 2 | 2 / 0 | 3 / 3 | 0 |
| Field Operator | 3 | 2 | 2 / 0 | 2 / 2 | 1 |
| Floor It | 3 | 2 | 0 / 0 | 0 / 0 | 0 |
| Goro Takemura: Hands Unclean | 1 | 0 | 1 / 1 | 0 / 0 | 0 |
| Goro Takemura: Losing His Way | 1 | 1 | 1 / 0 | 0 / 0 | 0 |
| Industrial Assembly | 3 | 2 | 1 / 0 | 2 / 2 | 1 |
| Jackie Welles: Pour One Out For Me | 1 | 0 | 0 / 1 | 2 / 2 | 0 |
| Kiroshi Optics | 3 | 3 | 2 / 0 | 8 / 8 | 0 |
| MT0D12 Flathead | 1 | 0 | 0 / 0 | 0 / 0 | 0 |
| Mandibular Upgrade | 2 | 2 | 1 / 0 | 0 / 0 | 0 |
| Mantis Blades | 3 | 1 | 0 / 0 | 0 / 0 | 1 |
| Minotaur | 1 | 0 | 0 / 0 | 0 / 0 | 1 |
| Over the Edge | 2 | 2 | 1 / 0 | 1 / 1 | 0 |
| Psycho Squad | 3 | 3 | 3 / 0 | 0 / 0 | 0 |
| Reboot Optics | 2 | 0 | 0 / 0 | 0 / 0 | 2 |
| Saburo Arasaka: Stubborn Patriarch | 1 | 0 | 0 / 1 | 0 / 0 | 0 |
| Satori: Sword of Saburo | 3 | 2 | 0 / 0 | 0 / 0 | 1 |
| Secondhand Bombus | 2 | 1 | 1 / 0 | 0 / 0 | 1 |
| Swordwise Huscle | 2 | 1 | 1 / 0 | 0 / 0 | 1 |
| V: Corporate Exile | 1 | 0 | 1 / 1 | 0 / 0 | 0 |
| Viktor Vektor: Sit Down and Relax | 1 | 0 | 0 / 1 | 1 / 1 | 0 |
| Yorinobu Arasaka: Embracing Destruction | 1 | 0 | 0 / 1 | 1 / 1 | 0 |

## Final board/resource summary

BATTLEFIELD counts include Gear and field Legends. Each side has one field Legend and two face-up Legends remaining in LEGENDS; no cards are REMOVED. Counts account for all 60 objects. Ready/spent states are the actual terminal snapshot before Arasaka’s Ready step.

| Player | Deck | Hand | Trash | Field | LEGENDS states | Eddies | Gigs | Fixers | Street Cred |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
| Arasaka | 11 | 0 | 5 | 7 | UP/SPENT, UP/SPENT | 5 | 7 | 0 | 17 |
| Merc | 9 | 0 | 5 | 7 | UP/READY, UP/READY | 7 | 5 | 0 | 28 |

## Privacy audit

Both viewer projections are independently audited at all **245 state boundaries**, including initial and terminal state. Both observations are also stored before each of the 244 actions. Opponent hands are absent except a card explicitly declared for play; decks expose counts, with inspected cards only for the entitled search viewer. Hidden public objects use slots rather than content-bearing instance IDs.

All **195 model inputs** are checked as exactly observation plus `{ actionId, descriptor }` actions. They contain no raw state, events, raw action payloads, actor IDs, option indices, seed, RNG, privateKnowledge store or unentitled hidden physical IDs. Full TrainingPositions and replay snapshots are trusted artifacts and are never model input. Re-derivation validates every position against its exact bundle. A separate counterfactual rival-hand/deck permutation preserves the actor observation, action IDs and chooser result.

## Kiroshi/private knowledge audit

Two Kiroshi copies are equipped to the same Psycho Squad. Two actual LEGEND_LOOKED_AT facts occur during turn 7, both looking at friendly Legend slot 3. Only Merc receives remembered identity; Arasaka receives the permitted public knowledge metadata without that identity. The slot is later called in React during turn 8 and becomes public. Each viewer's rememberedContent is compared against its own entitlement at every boundary. The policy uses slot/descriptor ranking and does not need to exploit the remembered name.

## Eddie privacy audit

Twelve SELL actions produce five Arasaka and seven Merc Eddies. At every boundary, face-down Eddies have slot identifiers, no content, remembered identity or effective-power disclosure. Model actions expose payment/ready slot labels without raw physical payment payloads. The trusted report supplies counts and per-turn chosen SELL labels for diagnostics; it is not fed to either player policy or model.

## Gear-on-Legend regression

**DID NOT OCCUR in this game.** Three Gear attachments occur on Units: one Mandibular Upgrade on Delamain, and two Kiroshi copies on Psycho Squad. No Legend was pre-equipped. The unchanged full application suite retains its explicit face-up LEGENDS Gear-host/inheritance and pre-equipped movement regressions; this match is not credited with them.

## Go Solo interactions

**OCCURRED twice:** Hands Unclean enters through GO_SOLO on turn 4; V enters on turn 9. Both use ordinary engine payment, field entry, Lag and later combat. Both finish on BATTLEFIELD. Neither has attached Gear at entry or termination, so Gear-following-Go-Solo and field-Legend defeat/removal remain covered by prior focused tests, not this trace.

## Trigger ordering

The trace records 17 TRIGGER_ORDER_SELECTED facts and 22 EFFECT_PENDING / 22 EFFECT_RESOLVED facts. It includes Jackie first-Blue effects, Kiroshi optional work, Evelyn and current-value conditional draws, and one Yorinobu effect. All choices and automatic work remain engine-owned.

Yorinobu is revealed on turn 12 before that turn's first qualifying attack; its later-reveal-after-an-earlier-same-turn-attack edge is not exercised here. Saburo is revealed in rival React on turn 13; the game ends before Arasaka attacks again, so a positive attacking aura is not credited. Losing His Way attacks while a friendly Legend remains face-down, so its +5 declaration gate does not register a pending effect. Existing positive/negative source and history regressions remain unchanged.

## React/Blocker interactions

Every attack follows the engine's reaction path: 27 attacks close 27 React windows, with additional openings on continuation (34 RIVAL_REACT_OPENED facts). There are **two CALL actions in rival React**, **five Blocker declarations**, and normal PASS_REACT actions. No Quick Program is played. Printed and inherited Blocker remain engine-enumerated; the fixed policy does not implement their legality or bypass them with a reducer.

## Fight/Steal interactions

**Five fights** produce five FIGHT_RESULT and five CARD_DEFEATED facts, including owner Trash handling and one Gear detachment. **Twenty-one Gigs** transfer through actual steals; 22 steal-resolution starts include a no-transfer result. Every control movement follows declared attack, effects, React and combat selection. No action batch steals two Gigs in this game. Simultaneous multi-Gig movement and overtime short-circuiting remain covered by the unchanged standalone/focused overtime tests.

## Delayed/end-turn effects

**DID NOT OCCUR as pending card work.** Delamain is played/equipped and defeated before producing a qualifying end-turn ready effect; both drawn Dying Night copies are sold rather than played. No END_TURN trigger continuation or delayed registration appears. Ordinary end-turn processing and 17 Lag removals do occur. The report diagnostic counts end-turn work only when the actual continuation origin is END_TURN, avoiding mislabeling ATTACK/PLAY ordering choices as end-turn effects.

## Targeted defeat/spend interactions

Corporate Surveillance produces **one effect-caused CARD_SPENT** on Psycho Squad during turn 6; the target remains the same object with its Gear, and no defeat is attributed to that spend. Over the Edge is legally played on turn 10 before Arasaka has a rolled D20 and resolves without a valid defeat target. Minotaur remains unseen. Accordingly targeted spend occurred, but actual Program-caused targeted defeat did not. The five defeat facts in the trace arise from fights.

## Overtime behavior

**NOT REACHED.** Both original Fixers are empty after the last roll on turn 12. Starts 13 and 14 record progress 1 and 2, respectively, but Arasaka wins normally at start 14 before a second qualifying turn can end. There is no OVERTIME_STARTED event or active overtime marker. The existing legal overtime replay remains unchanged and separately passing.

## Deck-out behavior

**NOT REACHED.** Arasaka retains 11 deck cards and Merc nine. No required-empty-draw loss occurs. The terminal start-of-turn victory precedes Arasaka’s next Ready/draw. Existing empty-draw tests remain green; no terminal outcome was discarded in search for a more interesting result.

## Terminal-state validation

The final state validates with timing.step FINISHED, winner/loser and START_TURN_GIGS reason, combat NONE, and exactly empty decision resolution `{ stage: DECISION, current: null, pending: [], discovered: [], choice: null }`. Both players have zero legal actions. Reusing the previous actionId fails, and submitting its raw prior action also rejects. GAME_ENDED occurs once, and the complete stored history has 975 consecutive events.

## Replay determinism

The fixed seed/policy generator reproduces all 244 selected action IDs/payloads, full state snapshots, both observations, events, 195 positions and hashes. Tests separately re-execute every action through resolveActionId/applyAction and compare results with the stored trace, while verifying input states are unchanged.

Final ReplayStateHash: `f4c0944db34366171ec253de07fb5a942c1900e339803afbe01ef06f91767ecf`.

The authoritative golden is **44,672,403 bytes** (about 42.6 MiB), retaining full snapshots and trusted TrainingPositions per the requested audit scope. The smaller diagnostic artifact supplies the report tables. Replay-policy changes do not enter the engine artifact hash.

## Original payload compatibility

PASS: **31 pre-existing families / 1,103 original actions**, frozen in `/tmp/tcg-demo-match-before/replays` before new implementation/search files. The auditor ran before regeneration and checked initialization, semantic actions/descriptors, observations, events and final states; current Demo setup also receives its additional policy check. After all 27 generators, every one of those 31 replay files is **byte-identical** to its frozen original. Standalone setup still stops at turn 0; standalone overtime still has 55 actions. Runtime/content/ruleset/wire pins did not change.

## PostgreSQL every-action replay

PASS: the isolated PostgreSQL test creates the match from fresh engine initialization, saves its complete initialization events, and reloads **before every one of the 244 actions**. It compares full state, ReplayStateHash, PositionHash, both observations and ObservationHashes, both legal-action sets/descriptors and accumulated event history. It then reruns the observation-only chooser on the reloaded projection, resolves its actionId and applies/saves the resulting exact batch.

Terminal state is reloaded separately, with the same winner/reason/hash, empty actions and all 975 events. There are 29 immutable content references. The dedicated test took about 37 seconds in this run; no checkpoints were substituted for actions, no timeout or gameplay shortcut was added. The full seven-test live suite took about 171 seconds and passed without skips. Its randomized test schema is cleaned up in finally.

## Mongo/rules/content behavior

The real-only Demo bundle remains fixture-controlled. No new card/ruleset publication or Mongo seed is required for this unchanged bundle. Existing isolated Mongo Demo/overtime ruleset and revision tests pass as part of the live suite. Mongo 127.0.0.1:27018 and PostgreSQL 127.0.0.1:5433 are healthy existing local containers. Test-owned schemas/databases are cleaned up; production collections are untouched.

## Wire

No change. Wire schemaVersion 1, authoritative state schemaVersion 2, TrainingPosition schemaVersion 2 and TrainingAttempt schemaVersion 1 remain as before. All four exported JSON Schema files and the original wire golden are byte-identical after export/generation. Existing generic request/response/actionId handling covers the full match.

## Python

Only the exact-demo-match-replay name is appended to scripts/test_engine_adapter.py. The generic Node worker traversal replays all **244 exact-game actions by actionId** and matches initialization, observations, events, hashes and final state. Total adapter coverage is now **32 families / 1,347 actions**, plus seven golden round trips and seven differential cases. Python test_cyberpunk passes 89 tests; test_harness_core passes 48. No deterministic policy or card rule is copied to Python; no model download, training or gold promotion occurs.

## Tests

PASS: **1,156 application tests**, including 12 new exact-match tests; **7 live integration tests**, including the new every-action full-game replay; all three Python suites. Typecheck, lint, four-record card validation, production build, contracts export and whitespace checks pass. Final Node suites have zero failures/skips. The initial TypeScript pass caught a mutable-versus-readonly observation-array annotation in the new runner; it was corrected. No engine test or validation was disabled or weakened.

## Commands

From `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-demo-match-before/replays
node --import tsx scripts/search-demo-match.ts
node --import tsx scripts/generate-demo-match-replay.ts
node --import tsx --test tests/demo-match.test.ts
node --import tsx --test --test-name-pattern='known overlap' tests/demo-match.test.ts
npm run typecheck
npm run lint
npm run validate:cards
npm test
npm run build
npm run contracts:export
git diff --check
docker compose ps
TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration
```

Results: Node v22.13.0/npm 10.9.2; original audit 31/1,103 passed before regeneration; first seed terminated; direct generator reproduced 244/195/975 and the final hash; focused tests passed; negative gate check passed; typecheck/lint passed; four starter records validated; full 1,156 tests passed; optimized Next build passed; unchanged schemas exported; whitespace clean; both containers healthy; all seven live tests passed. The generator was rerun after correcting only the end-turn diagnostic classification, with the same game/hash.

All 27 replay/golden generators ran successfully (each command exit 0):

```bash
node --import tsx scripts/generate-attack-condition-power-replay.ts
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-delayed-effects-replay.ts
node --import tsx scripts/generate-demo-match-replay.ts
node --import tsx scripts/generate-demo-setup-replay.ts
node --import tsx scripts/generate-end-turn-history-replay.ts
node --import tsx scripts/generate-field-legends-replay.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-goro-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-overtime-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-saburo-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-targeted-defeat-replays.ts
node --import tsx scripts/generate-targeted-spend-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-value-conditions-replay.ts
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-yorinobu-replay.ts
```

From `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
```

Results: generic adapter 32 families/1,347 actions, seven golden round trips and seven differential cases passed; Cyberpunk 89 passed; harness core 48 passed. Known legacy Python deck-validation differences remain `repeated-entry-copy-bypass` and `legend-in-main`; Node is authoritative. Unit-test corpus writes are temporary test fixtures, not a corpus refresh.

`python3 /tmp/tcg-demo-match-audit.py` compares the new milestone’s 384-file application / 504-file harness snapshot, old replay bytes, runtime files, revision payloads and physical rows. Logs and preserved originals live under `/tmp/tcg-demo-match-*`; the checked-in generator does not depend on those temporary audit files.

## Files changed

**17 application files** relative to the fresh pre-milestone snapshot: 11 new files and six existing documentation updates. **One harness file** changes. Earlier uncommitted overtime work is preserved; it is not counted again here.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Record one verified exact game and the next review phase; preserve all physical rows. |
| [docs/demo-format-report.md](../docs/demo-format-report.md) | Update current verification banner; retain historical source findings. |
| [docs/demo-setup-review-report.md](../docs/demo-setup-review-report.md) | Update current verification banner; retain historical setup review. |
| [docs/demo-starter-report.md](../docs/demo-starter-report.md) | Update current verification banner; retain initialization milestone. |
| [docs/exact-demo-match-report.md](../docs/exact-demo-match-report.md) | This complete milestone report. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Update current verification banner without expanding card-mechanic claims. |
| [docs/overtime-report.md](../docs/overtime-report.md) | Add successor link while preserving the overtime milestone’s historical result. |
| [scripts/generate-demo-match-replay.ts](../scripts/generate-demo-match-replay.ts) | Direct fixed-seed generator; writes exact match and diagnostic artifacts. |
| [scripts/search-demo-match.ts](../scripts/search-demo-match.ts) | Bounded candidate search; stops on the first complete game or first non-cap gap. |
| [tests/demo-match-audit.ts](../tests/demo-match-audit.ts) | Both-viewer/model-input privacy checks and trusted report diagnostics. |
| [tests/demo-match-policy.ts](../tests/demo-match-policy.ts) | Pure observation/descriptor-only DEMO_MATCH_POLICY_V1 chooser. |
| [tests/demo-match-replay.ts](../tests/demo-match-replay.ts) | Exact 29-card/60-copy runner, legal transitions, separate suppressed-interaction audit and full snapshots. |
| [tests/demo-match.test.ts](../tests/demo-match.test.ts) | 12 determinism, legality, information-boundary, exact-deck, terminal and diagnostic regressions. |
| [tests/fixtures/exact-demo-match-diagnostics.v1.json](../tests/fixtures/exact-demo-match-diagnostics.v1.json) | Generated mechanic counts, 29-card participation, final resources and 14-turn summary. |
| [tests/fixtures/exact-demo-match-replay.v1.json](../tests/fixtures/exact-demo-match-replay.v1.json) | Complete authoritative exact-game replay and 195 strategic contract positions. |
| [tests/fixtures/exact-demo-match-search.v1.json](../tests/fixtures/exact-demo-match-search.v1.json) | Complete one-attempt search record and defensive bounds. |
| [tests/integration/demo-match.test.ts](../tests/integration/demo-match.test.ts) | PostgreSQL reload/resume and compare before every one of 244 actions plus terminal reload. |

Harness `scripts/test_engine_adapter.py`: append only the exact replay-family name. All other 503 snapshotted harness files remain unchanged. Application runtime/packages, engine identity, all old replay/wire goldens, manifests, source evidence and card payloads are byte-identical to this milestone’s baseline. Both repositories’ HEAD and Git index remain unchanged. No staging, commit, push, model download, training, gold promotion or source refresh was performed.

## Bugs/integration gaps discovered

**No engine defect or new reachable gap was encountered in this game.** The first seed completed under the existing engine without changes. Test-authoring corrections were limited to a readonly observation annotation and a report diagnostic that initially grouped all trigger-order choices as end-turn work; the diagnostic now requires an END_TURN origin and has a regression assertion. Neither correction changed the policy, chosen actions, match hash or game rules.

## Unsupported mechanics still reachable/unreachable

Overlapping Reboot remains a known unsupported combination for this card pool; it was **not encountered** here because both physical copies remain undrawn in Merc’s deck. This is a coverage limit, not a claim of unreachability. The runner stops if an otherwise affordable second prevention is suppressed by the bounded admission gate, and a separate negative test proves that stop. No alternate seed was selected to evade the limit.

Other unexercised combinations include Gear on Legends/Go Solo transfer, delayed Dying Night work, Delamain end-turn work, Quick Programs, positive Losing/Saburo interactions, two-Gig steals, targeted defeat, field-Legend defeat/removal and exact-Demo overtime/deck-out. Existing focused tests cover many of these; this game does not. Zetatech Faceplate is absent from both exact decks, so its WHEN_SPENT dispatcher is not needed for this game. No generic card-control transfer, new mechanic or broad self-play matrix was added.

## Ambiguities not guessed

No new rule interpretation was required. Existing sourced mechanics and the separate application-selected Demo setup policy remain authoritative. One successful first seed does not establish a terminal distribution, seat advantage, all-game reachability or exhaustive interaction correctness. Authoritative audit artifacts may describe hidden-card participation; model projections remain entitled. No legal gap, failed candidate or policy redesign is concealed by the result.

## Match-readiness status

```text
Reference card execution:
COMPLETE — 29/29, 60/60

Demo fixed-list legality:
SUPPORTED

Exact Demo initialization:
SUPPORTED

Overtime:
SUPPORTED

First exact Arasaka-vs-Merc Demo match:
VERIFIED — one deterministic legal game

Exhaustive all-game interaction proof:
NOT CLAIMED
```

## Recommended next phase

**DEMO MATCH MATRIX + SELF-PLAY READINESS REVIEW.** Assess multiple seeds, both seats, FIRST/SECOND and mulligan variants, terminal distribution, interaction gaps, policy deadlocks, unsupported-but-reachable combinations, performance and position quality. Stop Demo roadmap implementation here: that future matrix and any training work were not performed in this milestone.
