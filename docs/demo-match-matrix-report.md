# Demo match matrix and self-play readiness review

**Successor review (September 10, 2026): [Reboot multiplicity](reboot-multiplicity-report.md) remains SOURCE BLOCKED.** Fresh official card, all five printings, FAQ, rules and errata do not uniquely settle overlap consumption. The single-copy runtime and suppression guard remain unchanged; all three exact prefixes are preserved and the matrix remains paused. Historical findings below retain their original scope.

**Unattended exact Demo self-play: NO.** Six of nine attempted games completed; three reached overlapping Reboot and stopped the schedule. The original verified headline remains unchanged.

## Runtime

September 10, 2026. Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine stays **0.4.0-overtime-1**, artifact `d79422b2512215c41bddbf17945ee061c660a5b04a845ea000b7dce6fdcd877d`. Ruleset `beta@demo-overtime-1`, hash `0cf3dcd40766cd4b699e16842a0b6a66d3b1ecdf9b678986bf7686139dc800ab`; exact content `108d71feb46f427987016bd4935ab2dd563581861eee13c11a155ee9409cb6f2`. No runtime, wire, card revision, lockfile or engine identity changed.

## Baseline readiness

Reference execution remains 29/29 distinct cards and 60/60 physical copies; exact Demo legality, setup and standard overtime are supported. The original `exact-demo-match-0` stays frozen: Arasaka normal win at global turn 14, 244 actions, 195 positions, 975 events. This review finds a reachable interaction boundary that the headline never exercised. It does not retract the headline or establish exhaustive interaction support.

## Matrix configuration

The schedule was written before inspecting outcomes: seeds `demo-matrix-000` through `demo-matrix-031`, seed-major then seats A/B, FIRST and keep/keep; 64 planned base games. A is p0 Arasaka/p1 Merc; B is p0 Merc/p1 Arasaka. Every initialization uses the same 29 real revision-1 cards, 27 MAIN + 3 Legends per player, and exact unchanged manifest composition hashes. No state patches, substitutions or synthetic cards.

The predeclared expansion is the first eight seeds × two seats × FIRST/SECOND × four per-seat keep/mulligan combinations = 128 full variant games, only if all 64 base games complete. Caps are 1,500 submitted actions / 120 global turns. Three occurrences of the same known gap stop the branch; unexpected engine errors, policy cycles or caps stop immediately. This threshold counts coordinates, not distinct seed strings.

The third overlap stopped the base schedule at coordinate 004/A. The attempted subset is five A and four B; the planned 32/32 seat balance was cut short by the stop rule. There are 55 unattempted base coordinates and 128 unattempted full-game variants. None is reported as a successful or failed attempt.

Canonical matrix hash: `fa8b1bc2e2a624dac52d3e4af8f5587ca17f6acd8c06cf0931f069abed57fe1f`. Configuration, policy hash, result records, setup checks and promotion metadata are covered. Timings/RSS are excluded and recorded separately under `/tmp/tcg-demo-matrix-traces/runtime.json`.

## Policy variants

`createDemoMatchPolicy` snapshots FIRST/SECOND and two mulligan booleans. `DEMO_MATCH_POLICY_FIRST_V1` / `DEMO_MATCH_POLICY_SECOND_V1` affect setup only; each delegates all gameplay to the unchanged `DEMO_MATCH_POLICY_V1`. Both always decline cuts. Policy source hash `4c253121db4d40c253d570b1f2d361c8e8b924b9a3782ab99462fca9626f2ee6` includes the base and factory source. The policy ID identifies the FIRST/SECOND family; the coordinate records mulligan settings explicitly.

The factory was corrected during bring-up to use the actual `CHOOSE_FIRST_PLAYER` enum. The initial nine FIRST coordinates delegated to the same base chooser, and all nine final hashes were checked against the preserved initial run. No outcome or seed was dropped because of that correction.

## Policy information boundary

The chooser receives exactly `(actorObservation, [{ actionId, descriptor }])`. It cannot import state, content, RNG, filesystem or transport services. The factory receives setup preferences, never seed, game number, faction or full state. Static import/identifier checks, unchanged gameplay delegation, reversed-input ordering and a rival hidden-hand/deck counterfactual are covered by tests. Trusted instrumentation alone sees the state to detect suppressed Reboot, collect coverage and audit privacy. It never sends those diagnostics back into the chooser.

## Base matrix results

| Coordinate | Status / terminal | Winner | Turns | Actions | Positions | Events |
| --- | --- | --- | --- | --- | --- | --- |
| demo-matrix-000 / A | EMPTY_DRAW | ARASAKA_DEMO_V1 | 14 | 307 | 253 | 1220 |
| demo-matrix-000 / B | OVERTIME_GIGS | ARASAKA_DEMO_V1 | 14 | 315 | 252 | 1256 |
| demo-matrix-001 / A | START_TURN_GIGS | ARASAKA_DEMO_V1 | 12 | 206 | 170 | 817 |
| demo-matrix-001 / B | OVERTIME_GIGS | MERC_DEMO_V1 | 14 | 347 | 276 | 1409 |
| demo-matrix-002 / A | START_TURN_GIGS | ARASAKA_DEMO_V1 | 12 | 202 | 164 | 820 |
| demo-matrix-002 / B | START_TURN_GIGS | ARASAKA_DEMO_V1 | 9 | 103 | 86 | 468 |
| demo-matrix-003 / A | OVERLAPPING_REBOOT | — | 12 | 206 | 171 | 808 |
| demo-matrix-003 / B | OVERLAPPING_REBOOT | — | 5 | 51 | 40 | 208 |
| demo-matrix-004 / A | OVERLAPPING_REBOOT | — | 9 | 144 | 119 | 574 |

## Variant matrix results

No full-game variant expansion ran after the common source blocker. A separately pinned setup-only audit ran seed 000 through both seats × FIRST/SECOND × all four mulligan patterns: **16/16 passed**, each stopped after seven setup actions. These are setup contract checks, not completed matches, and do not enter completion or game-length statistics. The SECOND/both-mulligan/reversed-seat setup prefix is promoted for PostgreSQL and Python traversal. Full-game SECOND and mulligan outcome coverage remains unverified.

## Completion rate

**6/9 completed (66.7%)**, with **3/9 known unsupported boundaries**. Zero observed engine errors, policy deadlocks or caps. Repeated regeneration/check runs use the same nine coordinates and are not additional independent samples. The early stop makes this a bounded diagnostic sample, not a probability estimate.

## Failure classifications

| Coordinate | Classification | Category / code | Turn | Submitted actions | Actor / phase |
| --- | --- | --- | --- | --- | --- |
| demo-matrix-003 / A | KNOWN_UNSUPPORTED | KNOWN_UNSUPPORTED_INTERACTION / OVERLAPPING_REBOOT | 12 | 206 | 1 / MAIN |
| demo-matrix-003 / B | KNOWN_UNSUPPORTED | KNOWN_UNSUPPORTED_INTERACTION / OVERLAPPING_REBOOT | 5 | 51 | 0 / MAIN |
| demo-matrix-004 / A | KNOWN_UNSUPPORTED | KNOWN_UNSUPPORTED_INTERACTION / OVERLAPPING_REBOOT | 9 | 144 | 1 / MAIN |

Each failure record includes its coordinate, public actor observation, legal descriptor list, proposed choice, PositionHash and clear message. The proposed alternative was recorded for diagnosis and was **not submitted** past the boundary. Full hidden state is confined to the explicitly trusted promoted replay or temporary traces. The initialized records have no missing outcome classifications. The runner distinguishes `KNOWN_UNSUPPORTED`, `ENGINE_ERROR`, `POLICY_DEADLOCK` and `DEFENSIVE_CAP`; supported terminals form the fifth acceptance category.

## Terminal distribution

| Terminal | Completed games |
| --- | --- |
| START_TURN_GIGS | 3 |
| OVERTIME_GIGS | 2 |
| EMPTY_DRAW | 1 |

Other terminal reasons: zero. Nonterminal known-gap prefixes: three.

## Winner distribution

Completed games: **Arasaka 5, Merc 1**. The deterministic fixture policy is not balanced or strategically strong. It prioritizes selling toward seven Eddies, Go Solo, playing, calling and attacking under fixed rankings; these results do not measure deck balance or optimal strategy.

## Game-length distribution

| Completed games only | Min | Median | Max |
| --- | --- | --- | --- |
| turns | 9 | 13 | 14 |
| actions | 103 | 256.5 | 347 |
| positions | 86 | 211 | 276 |

The three nonterminal prefixes stopped at turns 12/5/9 and actions 206/51/144. Their partial lengths are excluded from the table.

## FIRST/SECOND breakdown

All nine base choosers selected FIRST. The d20 chooser was seat 0 in four attempts and seat 1 in five. Among the six completed games, the actual first player won two and the actual second player won four. This is not the same as a SECOND *choice* policy: no full SECOND-policy game ran.

The setup audit verifies eight FIRST and eight SECOND choices, including the inversion of actual first player when the d20 winner chooses SECOND. Eight base setups resolved without a tie, one had one tie, none had multiple ties. These counts do not establish d20 fairness.

## Mulligan breakdown

Every base match kept both opening hands. Each of keep/keep, mulligan/keep, keep/mulligan and mulligan/mulligan was independently exercised four times in the sixteen setup audits, across both seats and FIRST/SECOND. Selection uses viewer seat and public choice labels only. Full-game turn length, winner and terminal comparisons between mulligan patterns are unavailable because expansion stopped.

## Overtime reachability

Three games reached qualification progress 1 and 2. Two entered overtime and won through `OVERTIME_GIGS`; the remaining qualifying game ended through empty draw before an overtime entry. Both overtime games ended during the transition that entered overtime, leaving **zero nonterminal overtime TrainingPositions** in this matrix. The existing standalone overtime replay remains the evidence for continued decisions during active overtime.

## Mechanic coverage aggregate

| Mechanic | Games | Occurrences | First coordinate | Turn |
| --- | --- | --- | --- | --- |
| gearOnLegend | 1 | 1 | base-demo-matrix-002-B-FIRST-KK | 8 |
| preEquippedGoSolo | 0 | 0 | — | — |
| dyingNightPlayed | 4 | 4 | base-demo-matrix-000-A-FIRST-KK | 10 |
| dyingAttack | 4 | 6 | base-demo-matrix-000-A-FIRST-KK | 12 |
| dyingDelayedCreated | 4 | 6 | base-demo-matrix-000-A-FIRST-KK | 12 |
| dyingEndReady | 0 | 0 | — | — |
| dyingVEndReady | 0 | 0 | — | — |
| delamainSteal | 5 | 11 | base-demo-matrix-000-A-FIRST-KK | 12 |
| delamainEndPending | 5 | 10 | base-demo-matrix-000-A-FIRST-KK | 12 |
| delamainEddieChoice | 5 | 10 | base-demo-matrix-000-A-FIRST-KK | 12 |
| delamainEndResolved | 5 | 10 | base-demo-matrix-000-A-FIRST-KK | 12 |
| quickFloorIt | 1 | 1 | base-demo-matrix-001-B-FIRST-KK | 11 |
| quickReboot | 1 | 1 | base-demo-matrix-000-A-FIRST-KK | 13 |
| floorItPower | 6 | 8 | base-demo-matrix-000-A-FIRST-KK | 2 |
| losingPlus5 | 1 | 1 | base-demo-matrix-000-B-FIRST-KK | 14 |
| saburoAura | 7 | 34 | base-demo-matrix-000-A-FIRST-KK | 7 |
| saburoAndLosing | 1 | 1 | base-demo-matrix-000-B-FIRST-KK | 14 |
| yorinobuTrigger | 6 | 16 | base-demo-matrix-000-A-FIRST-KK | 9 |
| minotaurDefeat | 1 | 1 | base-demo-matrix-002-B-FIRST-KK | 7 |
| overTheEdgeDefeat | 1 | 1 | base-demo-matrix-000-A-FIRST-KK | 13 |
| corporateSpend | 0 | 0 | — | — |
| dexterDefeatedTrigger | 2 | 2 | base-demo-matrix-000-A-FIRST-KK | 4 |
| fieldLegendDefeated | 1 | 1 | base-demo-matrix-000-A-FIRST-KK | 13 |
| fieldLegendRemoved | 1 | 1 | base-demo-matrix-000-A-FIRST-KK | 13 |
| legendGearTrashOrder | 0 | 0 | — | — |
| multiGigSteal | 1 | 1 | base-demo-matrix-000-B-FIRST-KK | 14 |
| overtimeProgress1 | 3 | 3 | base-demo-matrix-000-A-FIRST-KK | 13 |
| overtimeProgress2 | 3 | 3 | base-demo-matrix-000-A-FIRST-KK | 14 |
| overtimeEntered | 2 | 2 | base-demo-matrix-000-B-FIRST-KK | 14 |
| overtimeWin | 2 | 2 | base-demo-matrix-000-B-FIRST-KK | 14 |
| emptyDraw | 1 | 1 | base-demo-matrix-000-A-FIRST-KK | 14 |
| multipleBlockers | 6 | 11 | base-demo-matrix-000-B-FIRST-KK | 3 |
| inheritedBlocker | 0 | 0 | — | — |
| kiroshiLook | 4 | 7 | base-demo-matrix-000-A-FIRST-KK | 6 |
| kiroshiMemoryRetained | 4 | 205 | base-demo-matrix-000-A-FIRST-KK | 6 |
| kiroshiMemoryRevealed | 4 | 4 | base-demo-matrix-000-A-FIRST-KK | 8 |
| kiroshiMemoryCleaned | 4 | 4 | base-demo-matrix-000-A-FIRST-KK | 8 |

Counts use actual semantic events and inspected decision boundaries, including failed prefixes. `multipleBlockers` counts decision boundaries offering multiple blockers; `inheritedBlocker` counts offered blocker candidates supplied by Gear; these do not count separate fights. Saburo counts distinct observed attacker/turn/attack ordinals with an actual derived aura; composition requires a concurrent +5. Kiroshi retention counts viewer/card transitions with retained memory. Delayed readiness counts actual Eddie-ready events, not just delayed-record creation. Targeted Minotaur/Over the Edge defeats require a recorded effect target, separate from combat defeat. Trigger batches count exposed simultaneous bindings; automatic effects are also counted from event payloads where applicable.

## Card participation aggregate

| Revision-1 card | Drawn | Played/called | Effect pending | Effect resolved | Unseen |
| --- | --- | --- | --- | --- | --- |
| Viktor Vektor: Sit Down and Relax | 0 | 8 | 8 | 8 | 1 |
| Afterparty at Lizzie's | 9 | 0 | 0 | 0 | 0 |
| Mantis Blades | 9 | 4 | 0 | 0 | 0 |
| Swordwise Huscle | 7 | 6 | 6 | 6 | 2 |
| Floor It | 8 | 7 | 7 | 7 | 1 |
| Secondhand Bombus | 8 | 4 | 0 | 0 | 0 |
| Reboot Optics | 8 | 7 | 7 | 7 | 0 |
| Corpo Security | 8 | 8 | 0 | 0 | 1 |
| MT0D12 Flathead | 4 | 2 | 0 | 0 | 4 |
| Psycho Squad | 8 | 7 | 0 | 0 | 0 |
| Emergency Atlus | 8 | 8 | 0 | 0 | 1 |
| Satori: Sword of Saburo | 8 | 6 | 1 | 1 | 1 |
| Dexter DeShawn: One Last Chance | 6 | 6 | 6 | 6 | 2 |
| Jackie Welles: Pour One Out For Me | 0 | 7 | 7 | 7 | 1 |
| Mandibular Upgrade | 9 | 7 | 0 | 0 | 0 |
| Kiroshi Optics | 9 | 7 | 6 | 6 | 0 |
| Evelyn Parker: Scheming Siren | 8 | 8 | 8 | 8 | 0 |
| Delamain Cab | 9 | 9 | 5 | 5 | 0 |
| Dying Night: V's Pistol | 9 | 4 | 4 | 4 | 0 |
| V: Corporate Exile | 0 | 7 | 0 | 0 | 2 |
| Goro Takemura: Hands Unclean | 0 | 7 | 0 | 0 | 2 |
| Yorinobu Arasaka: Embracing Destruction | 0 | 6 | 6 | 6 | 3 |
| Saburo Arasaka: Stubborn Patriarch | 0 | 8 | 0 | 0 | 1 |
| Industrial Assembly | 7 | 2 | 2 | 2 | 2 |
| Field Operator | 8 | 8 | 8 | 8 | 1 |
| Minotaur | 3 | 2 | 2 | 2 | 5 |
| Over the Edge | 7 | 4 | 4 | 4 | 2 |
| Corporate Surveillance | 7 | 0 | 0 | 0 | 2 |
| Goro Takemura: Losing His Way | 4 | 2 | 1 | 1 | 5 |

All columns count games, including aborted prefixes. Drawn means present in a hand at an observed boundary, including the opening hand. Unseen means no physical copy became visible to either player in the audited states. Pending/resolved counts are generic executable effects, including Program/CALL effects, not necessarily triggered abilities. Zero effects for a vanilla card or persistent aura does not mean it failed. Afterparty at Lizzie’s and Corporate Surveillance were drawn but never played by this policy. Roster membership is not execution evidence.

## Reboot overlap findings

The first reproduction is `demo-matrix-003 / A / FIRST / keep,keep`, after 206 actions at turn 12. It is confirmed at 003/B after 51 actions (turn 5) and 004/A after 144 actions (turn 9): **three coordinates across two seeds**. The Merc actor has an affordable second physical Reboot in hand while the first independent prevention is outstanding. `canPlay` omits the second copy; a direct submission also rejects it. The existing suppression detector stops before the policy proceeds to another offered action.

The pinned card says the next rival Unit fight this turn does not defeat the opposing friendly Unit. Rules 9.19.3 preserve fight loss; 10.21 supports source independence; 8.16.2 governs expiry. The captured Reboot FAQ confirms that preventing defeat does not erase losing the fight; the general FAQ says prevented defeat does not trigger DEFEATED. Neither addresses two outstanding copies. Replacement rules 10.24–10.29 explain ordering of replacements but do not establish which next-time prevention model applies here.

**Source blocker:** whether both effects consume on the same fight, one survives for a later fight, an affected player orders them, or redundancy changes consumption. No new ruling was guessed, no source was refreshed and no engine fix was made. The reviewed source references and exact captured FAQ records are in `demo-matrix-reboot-review.v1.json`.

## Other reachable unsupported interactions

No other explicit engine failure occurred before the stop. That is a statement about these prefixes only. The descriptor ambiguity below is a model-interface weakness, not a rule-resolution crash. Gear-before-Go-Solo, Dying Night’s positive V readiness, Corporate Surveillance play, inherited Blocker, and extended active-overtime decisions were not observed here; retain their standalone regressions. Zetatech Faceplate and WHEN_SPENT remain outside the exact decks and this milestone.

## Policy deadlocks

Zero observed. The test-only detector records `PositionHash + acting seat + semantic action`; CHOOSE identity uses its descriptor and selected option indices, excluding its opaque choice ID. A focused test changes replay counters without changing PositionHash and verifies that the repeated decision throws `POLICY_DEADLOCK`. This conservative hash still retains turn, RNG and other semantic state; caps remain necessary for long trajectories that never repeat the same exact position.

## Engine deadlocks

Zero nonterminal states with no legal action were observed. Such a boundary throws immediately and is classified as `ENGINE_ERROR`; terminal states correctly have no actions. The overlapping-Reboot states still offer other actions, so they are classified as an explicit unsupported admission boundary, not zero-action deadlocks.

## Legal-action branching

| Metric | Value |
| --- | --- |
| Min / median / p95 / max | 2 / 4 / 10 / 17 |
| Positions >20 / >50 / >100 | 0 / 0 / 0 |
| Max payment choices | 9 |
| Max Gig/amount choices | 12 |
| Max exposed trigger batch / sources | 3 / 3 |
| Max successive React-window submissions | 4 (including reaction subchoices) |

Top ten strategic positions by available actions:

| Coordinate | Turn | Actor | Phase | Legal actions | Categories |
| --- | --- | --- | --- | --- | --- |
| base-demo-matrix-001-B-FIRST-KK | 12 | 0 | MAIN | 17 | DECLARE_ATTACK, SELL_CARD, END_TURN, CALL_LEGEND, PLAY_CARD |
| base-demo-matrix-004-A-FIRST-KK | 7 | 1 | MAIN | 17 | PLAY_CARD, END_TURN, DECLARE_ATTACK, CALL_LEGEND, SELL_CARD, GO_SOLO |
| base-demo-matrix-000-A-FIRST-KK | 6 | 1 | MAIN | 16 | PLAY_CARD, END_TURN, DECLARE_ATTACK, SELL_CARD, CALL_LEGEND |
| base-demo-matrix-003-B-FIRST-KK | 3 | 0 | MAIN | 15 | PLAY_CARD, SELL_CARD, CALL_LEGEND, DECLARE_ATTACK, END_TURN |
| base-demo-matrix-004-A-FIRST-KK | 4 | 0 | MAIN | 15 | SELL_CARD, PLAY_CARD, CALL_LEGEND, DECLARE_ATTACK, END_TURN |
| base-demo-matrix-004-A-FIRST-KK | 9 | 1 | MAIN | 15 | PLAY_CARD, SELL_CARD, CALL_LEGEND, END_TURN, DECLARE_ATTACK |
| base-demo-matrix-001-B-FIRST-KK | 10 | 0 | MAIN | 14 | GO_SOLO, DECLARE_ATTACK, SELL_CARD, END_TURN, CALL_LEGEND, PLAY_CARD |
| base-demo-matrix-002-B-FIRST-KK | 4 | 0 | MAIN | 14 | END_TURN, SELL_CARD, PLAY_CARD, DECLARE_ATTACK, CALL_LEGEND |
| base-demo-matrix-003-A-FIRST-KK | 3 | 0 | MAIN | 14 | PLAY_CARD, SELL_CARD, CALL_LEGEND, END_TURN |
| base-demo-matrix-003-A-FIRST-KK | 4 | 1 | MAIN | 14 | DECLARE_ATTACK, SELL_CARD, CALL_LEGEND, PLAY_CARD, END_TURN |

The largest sets come from MAIN combining multiple physical cards, sell/play/attack/CALL/Go Solo and end-turn choices. There was no combinatorial action explosion in this sample. Authoritative legal actions were not pruned.

## Training-position counts

**1,531 strategic positions** from **1,881 submitted actions**, including 330 positions in the three failed prefixes. Completed games contribute 1,201 positions, averaging **200.17 per completed game**. A strategic position has more than one action and is not a cut decision. Failed-prefix positions are diagnostics only; they are not accepted training examples or gold labels.

Early/setup choices expose the acting player’s hand and allowed setup decisions. MAIN positions expose public resources/board and own cards. Combat, React, payment, target, Gig and trigger-order positions have actor-specific observations; target and amount choices are bounded. The matrix contains no continued overtime decision sample, although the standalone overtime family does.

Observation content references do not include full printed rules/mechanics. A future strategic agent needs a pinned public card-definition resolver alongside observations. This can use immutable CardRefs without exposing opponent hand or deck order. Do not feed trusted TrainingPosition.state to the model.

## Forced-action ratio

**350/1,881 = 18.6%** submitted actions were procedural/forced under the existing position filter; **81.4%** generated strategic positions. This includes the 36 cut submissions excluded despite their multiple procedural choices. Payment and target selection often remain real choices and are not automatically treated as forced. No rules changed to improve this ratio.

Actual submitted categories (all actions):

| Phase : descriptor kind | Submissions |
| --- | --- |
| AMOUNT_SELECTION:CHOOSE | 33 |
| ATTACK_TARGET_SELECTION:CHOOSE | 177 |
| CHOOSE_FIRST_PLAYER:CHOOSE | 9 |
| CHOOSE_GIG:ROLL_GIG | 92 |
| CUT_DECISION:CHOOSE | 36 |
| DEFEAT_ORDER_SELECTION:CHOOSE | 14 |
| DISCARD_SELECTION:CHOOSE | 10 |
| EDDIE_READY_SELECTION:CHOOSE | 10 |
| GIG_STEAL_SELECTION:CHOOSE | 138 |
| MAIN:CALL_LEGEND | 34 |
| MAIN:DECLARE_ATTACK | 195 |
| MAIN:END_TURN | 94 |
| MAIN:GO_SOLO | 12 |
| MAIN:PLAY_CARD | 167 |
| MAIN:SELL_CARD | 95 |
| MULLIGAN_DECISION:CHOOSE | 18 |
| OPTIONAL_TRIGGER_SELECTION:CHOOSE | 13 |
| PAYMENT_SELECTION:CHOOSE | 379 |
| RIVAL_REACT:CALL_LEGEND | 9 |
| RIVAL_REACT:DECLARE_BLOCKER | 38 |
| RIVAL_REACT:PASS_REACT | 194 |
| RIVAL_REACT:PLAY_CARD | 2 |
| TARGET_SELECTION:CHOOSE | 88 |
| TRIGGER_ORDER_SELECTION:CHOOSE | 24 |

Available strategic categories are separately counted in the compact coverage artifact. These counts describe the existing chooser and sampling rule.

## Observation sizes

| Serialized UTF-8 bytes | Median | p95 | Max |
| --- | --- | --- | --- |
| Observation | 8691 | 12899 | 14492 |
| Legal descriptor projection | 633 | 1590 | 2636 |

These are compact JSON byte counts across strategic positions, not token estimates. No tokenizer or model was downloaded.

## Model-input sizes

| Serialized UTF-8 bytes | Median | p95 | Max |
| --- | --- | --- | --- |
| Observation + public legal actions | 9368 | 13845 | 15661 |
| Trusted TrainingPosition | 42340 | 47858 | 52591 |

**285 positions / 338 groups have duplicate `(kind,label)` descriptors.** Some are interchangeable copies in hand, but some are strategically distinct visible units. At 000/A turn 6, `Attack with Evelyn Parker: Scheming Siren` names both `p1-c19` (power 0, no Gear) and `p1-c18` (power 1, attached `p1-c9`). Opaque IDs distinguish submissions but do not tell an observation-only agent which source each ID selects. This is a concrete limitation for informed action selection.

A future descriptor contract should expose an authorized public source reference and relevant public targets/parameters, preserving slot-based anonymity for face-down cards. That needs deliberate contract/version and old-payload compatibility review. No descriptor or engine hash was changed here. The separate position-review artifact records public examples and a canonical review hash.

## Privacy audit

All 1,890 match state boundaries (initial plus each action in nine games) were checked from both viewers, with the overlap final states included. All 1,531 strategic model inputs were audited against the canonical projection. The setup audit adds both-viewer checks across sixteen setup runs. No opponent hand, deck identity/order, unauthorized face-down Legend/Eddie identity, RNG, raw action payload or seed entered the chooser. Private observations in trusted replay artifacts remain confidential to their viewer; full-state snapshots are not model data.

Tests retain static policy checks, reversed-action ordering and a hidden opponent hand/deck counterfactual. Every-action PostgreSQL cases independently rederive both observations and legal action sets after reload.

## Kiroshi audit

Seven looks occurred in four games; 205 viewer/card transitions retained memory. Four remembered cards later revealed and had their private-memory records removed. Other memory remained pending at the observed end of a game/prefix; cleanup is not invented where no reveal occurred. Every memory assertion is viewer-specific and checks the engine’s existing entitlement records; knowing a Legend never exposes Eddie identities.

## Eddie audit

All sold cards use anonymous face-down Eddie slots in each observation. Neither hidden card content nor private remembered content appears in Eddie slots. There were 95 SELL submissions across the matrix. Ten explicit Eddie-ready selections occurred through Delamain end-turn effects; delayed Dying Night records were created but no positive V-specific ready effect occurred.

## Cross-game isolation

A shared content bundle was hashed before and after the matrix. Every reducer input was checked unchanged after application. Tests interleave twelve actions from each of two different exact games, compare against their isolated replay, and verify the inactive game’s state and RNG do not change. Reinitializing after another game reproduces the original initial state; no private knowledge, history, effects or RNG state carry across games.

An action ID from one replay rejects in an unrelated state from another replay. Existing v2 IDs bind observation hash and viewer seat, not match UUID. Identical public views across distinct match IDs intentionally produce identical action IDs, confirmed by a test. The caller must bind requests to the intended match, actor and current state; an ID is not an authorization token or globally unique game identifier.

The engine is synchronous and its RNG is state-local. The module-level handler registry contains fixed stateless functions, not mutable match state. Content objects are parsed/validated and reducers did not mutate them; callers should still treat bundles as immutable because construction itself does not deep-freeze them. Separate workers can isolate CPU-bound parallel games. The interleaving smoke checks independence, not thread-safety of a shared Python adapter.

## Determinism

The dedicated `npm run test:matrix -- --check` reexecutes all nine attempted coordinates and sixteen setup audits, enforcing byte-identical compact results and four promoted replay files. Final matrix hash: `fa8b1bc2e2a624dac52d3e4af8f5587ca17f6acd8c06cf0931f069abed57fe1f`. All nine outcomes/final hashes also match the preserved first run. Runtime measurements vary and are excluded from canonical identity. No outcome-dependent seed replacement or smarter gameplay policy was introduced.

## Position/hash duplication

Among 1,531 strategic positions there are 1,531 distinct PositionHashes and zero PositionHashes shared across coordinates. There are 1,527 distinct ObservationHashes; four hashes occur across games. This is not a useful dataset deduplication guarantee: `POSITION_V2` intentionally includes RNG seed/counter and conservative physical identities, so different seeded games generally cannot share a PositionHash even with similar visible boards. A future dataset-equivalence key must be designed separately, without weakening authoritative replay/state hashing.

## Performance

| Coordinate | Generation ms | Actions/sec | Sampled RSS MiB |
| --- | --- | --- | --- |
| base-demo-matrix-000-A-FIRST-KK | 17846.6 | 17.2 | 285.9 |
| base-demo-matrix-000-B-FIRST-KK | 17004.7 | 18.52 | 519.5 |
| base-demo-matrix-001-A-FIRST-KK | 11161.4 | 18.46 | 545.6 |
| base-demo-matrix-001-B-FIRST-KK | 20149.2 | 17.22 | 626.4 |
| base-demo-matrix-002-A-FIRST-KK | 10990.3 | 18.38 | 725.4 |
| base-demo-matrix-002-B-FIRST-KK | 5557.3 | 18.53 | 642.8 |
| base-demo-matrix-003-A-FIRST-KK | 11128.3 | 18.51 | 611.5 |
| base-demo-matrix-003-B-FIRST-KK | 2663.0 | 19.15 | 703.0 |
| base-demo-matrix-004-A-FIRST-KK | 7714.0 | 18.67 | 703.1 |

Measurements are from this local audited check run, with other gates running concurrently. They include repeated validation, both-viewer privacy checks, position generation and retained snapshots; they are not production engine throughput or DB benchmarks. The matrix/coverage JSON totals **157,627 bytes**. Sampled RSS is not an exact process peak. Full trace retention and repeated schema validation/canonical hashing are clear costs to address in a future pipeline rather than exporting this diagnostic runner unchanged.

## Replay/storage implications

| Extrapolated uncompressed storage | Per completed game | 100 games | 10,000 games |
| --- | --- | --- | --- |
| Model inputs only | 1.96 MB | 0.20 GB | 19.65 GB |
| Trusted TrainingPositions | 8.58 MB | 0.86 GB | 85.77 GB |
| Full snapshot replay (two promoted terminal samples) | 29.28 MB | 2.93 GB | 292.83 GB |

The completed-game averages are 200.17 strategic positions; model inputs average 9,815 bytes/position and trusted positions 42,848 bytes/position. Extrapolations exclude compression, attempts/labels, indexes, card catalog storage and source-gap retries. The full-replay estimate comes from only two exact completed promoted traces, now compact JSON; the original pretty-printed headline stays 44,672,403 bytes (~42.6 MiB).

Retain full snapshot replays for a small golden/debug regression set. A scalable store should separate content/rules/engine pins and initialization, canonical action payloads plus decision provenance/action IDs, events or periodic checkpoints, and privacy-safe TrainingPosition/TrainingAttempt records. IDs alone depend on the exact current observation and version; retain enough information for checked replay reconstruction. The present every-action replay tests establish reconstruction for reviewed traces, not an implemented compact archival format. No pipeline, dataset split, compression system or DB redesign was added.

## Promoted representative replays

| Family | Coordinate | Actions | Bytes | Purpose |
| --- | --- | --- | --- | --- |
| demo-matrix-empty-draw-replay | base-demo-matrix-000-A-FIRST-KK | 307 | 29,406,140 | First exact matrix empty-draw terminal |
| demo-matrix-overtime-replay | base-demo-matrix-000-B-FIRST-KK | 315 | 29,160,589 | First exact matrix overtime terminal; also reversed seats |
| demo-matrix-overlap-replay | base-demo-matrix-003-A-FIRST-KK | 206 | 18,296,067 | First exact reachable overlap; legal prefix stopping before suppressed second Reboot |
| demo-matrix-second-setup-replay | variant-demo-matrix-000-B-SECOND-MM | 7 | 505,534 | SECOND chooser, reversed seats, both mulligan; setup-only because full-game variant expansion is blocked |

Only these four families were added: **835 actions**, **77,368,330 bytes** total. The original headline continues to cover a normal win. The overlap file is a legal nonterminal prefix and the SECOND file is a setup-only prefix; neither is counted as a completed match. Remaining full traces stay under `/tmp`, outside the repository.

## PostgreSQL representative replays

**11/11 live integration tests passed, zero skipped.** The four promoted families reload all 835 new actions. Before each action the tests compare full state, ReplayStateHash, PositionHash, both observations and ObservationHashes, both players’ legal actions and exact event history; then choose through the public policy, resolve action ID, apply and persist. Final terminal or gap/setup boundaries are checked explicitly.

The unchanged headline still reloads its 244 actions. Existing setup, overtime, content immutability, search, persistence and concurrency regressions also run. PostgreSQL uses isolated disposable schemas at localhost:5433; Mongo tests use localhost:27018 and isolated databases. Cleanup is in finally blocks. Tests run serially to preserve the existing migration-extension safety workaround. No production data or app database schema was modified by this milestone.

## Python

**Adapter passed: 36 replay families / 2,182 actions; 7 wire goldens and 7 differential cases.** Cyberpunk tests: **89 passed**. Harness-core tests: **48 passed**. Only the four promoted replay families were added to generic traversal; compact matrix JSON is never treated as a replay.

The Python adapter can reuse a worker for sequential create → model_input → selected actionId submission → terminal detection → fresh creation. The added test alternates two exact initializations in one process and verifies reset and unrelated action rejection. The initial version of that test compared the complete wire response (which includes extra hashes) with the smaller replay initialization object; it was corrected to compare state/events explicitly. This was a test assertion error, not cross-game engine leakage.

Future model replacement stays at `Observation + [{actionId, descriptor}] → actionId`. Python owns prompting, model calls, attempts and orchestration; Node owns all rules and legal action derivation. Transport is infrastructure-free JSONL, with no Next.js, Apollo, Mongo or PostgreSQL dependency. One EngineAdapter has a shared sequence/reply queue without request serialization for concurrent callers; use sequential calls or one adapter per worker, not a single instance from multiple threads. Existing legacy Python deck-check disagreements (`repeated-entry-copy-bypass`, `legend-in-main`) remain explicit; Node validation is authoritative.

## Original payload compatibility

Before changes, 32 replay families / 1,347 actions were copied to `/tmp/tcg-demo-matrix-before/replays`. The original-payload auditor passed every semantic action/descriptor, observation, event and final state; the current Demo policy additionally rechecked the setup family. All 27 pre-existing replay/golden generators passed, including exact Demo and overtime.

SHA-256 comparisons confirm every original replay remains byte-identical, including the 244-action headline. All pre-existing fixture/source payloads, all 53 historical reviewed revisions, all 29 exact revisions, all runtime/wire packages, worker and engine identity sources and the lockfile remain unchanged. There was no engine repin or runtime regeneration churn. Existing unrelated/uncommitted work was preserved. Final metadata checks compare HEAD and index to the beginning of this milestone.

## Tests

Application: **1,164 passed**, zero failed/skipped (the prior 1,156 plus eight matrix regressions). Dedicated matrix: nine accounted match coordinates, sixteen setup checks, four exact replay regeneration checks. Source gap: valid untouched exact state, affordable suppressed Reboot, failed direct submission. Policy: import/argument boundary, stable ordering and unchanged delegation. Isolation: interleaved games, reset, unrelated action rejection and documented same-view ID reuse. Cycle detector: semantic repeats survive changed replay counters. Descriptor review: 285 duplicate-label positions, with public non-equivalent source examples. Full suite did not rerun all 64/128 planned games inside ordinary `npm test`.

Final typecheck, lint, validate:cards, build, contract export and diff checks pass. `validate:cards` still validates the four original application catalog fixtures; the separate test bundles carry the 29 reviewed exact Demo revisions. Early test-tooling issues (setup enum, diagnostic type narrowing and wire-response comparison) were corrected and the affected checks rerun; no engine bug was hidden or patched in a runner.

## Commands

All Node commands used the application root and:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
npm run typecheck
npm run lint
npm run validate:cards
npm test
npm run build
npm run contracts:export
git diff --check
npm run test:matrix
npm run test:matrix -- --check
node --import tsx scripts/review-demo-matrix-positions.ts
node --import tsx scripts/review-demo-matrix-positions.ts --check
node --import tsx --test tests/demo-matrix.test.ts
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-demo-matrix-before/replays
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg TEST_MONGODB_URI=mongodb://127.0.0.1:27018 npm run test:integration
```

Node/npm reported 22.13.0/10.9.2. Focused tests passed 8/8; full tests passed 1,164/1,164. Matrix generation/check exited 0 with six completed and three expected explicitly reported source gaps; exit 0 means the diagnostic expectation passed, not that the environment is ready. The position review/check exited 0. Compatibility passed 32/1,347. The remaining gate results are recorded above.

Every pre-existing generator was invoked individually and exited 0:

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

Harness commands, from `tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

The adapter’s first full traversal passed all replay families before its newly added reset test hit the response-shape assertion described above; the corrected full command was rerun. Typecheck/lint were repeated after final diagnostic additions. Logs and preservation snapshots are under `/tmp/tcg-demo-matrix-*`; these contain trusted diagnostic data and are not model inputs. No training, model download, human-gold promotion, staging, commit or push command ran.

## Files changed

| Application file | Change |
| --- | --- |
| docs/demo-deck-coverage-roadmap.md | Adds current matrix/source-blocker status; preserves roster rows. |
| docs/demo-match-matrix-report.md | This 48-section review and readiness decision. |
| docs/exact-demo-match-report.md | Links the successor review while preserving the original match report. |
| docs/executable-card-coverage.md | Adds current matrix/source-blocker status; preserves historical findings. |
| package.json | Adds the dedicated test:matrix command. |
| scripts/generate-demo-match-matrix.ts | Runs the fixed schedule, stops and accounts for gaps, audits setup variants, promotes four traces, and checks canonical artifacts. |
| scripts/review-demo-matrix-positions.ts | Reproducible duplicate descriptor/public-source and overtime-position audit. |
| tests/demo-matrix-config.ts | Pins seeds, seats, policy schedule, caps, stop threshold and setup-only audit. |
| tests/demo-matrix-metrics.ts | Event/position coverage, card participation, sizes, branching and aggregates. |
| tests/demo-matrix-policy.ts | Observation-only FIRST/SECOND and per-seat mulligan factory; delegates gameplay. |
| tests/demo-matrix-replay.ts | Exact legal-action runner, privacy/state/content checks, semantic cycle detector and classified failure prefixes. |
| tests/demo-matrix.test.ts | Eight schedule, policy, source-gap, metrics, isolation and privacy regressions. |
| tests/fixtures/demo-match-coverage.v1.json | Aggregated mechanics, all 29 cards, branching, sizes and positions. |
| tests/fixtures/demo-match-matrix.v1.json | Nine compact result records, sixteen setup checks, config/policy/pins/promotion identity. |
| tests/fixtures/demo-matrix-empty-draw-replay.v1.json | First exact matrix empty-draw terminal. |
| tests/fixtures/demo-matrix-overlap-replay.v1.json | First exact reachable overlap; legal prefix stopping before suppressed second Reboot. |
| tests/fixtures/demo-matrix-overtime-replay.v1.json | First exact matrix overtime terminal; also reversed seats. |
| tests/fixtures/demo-matrix-position-review.v1.json | Compact descriptor ambiguity and public example evidence. |
| tests/fixtures/demo-matrix-reboot-review.v1.json | Pinned-source overlap review and unresolved semantics. |
| tests/fixtures/demo-matrix-second-setup-replay.v1.json | SECOND chooser, reversed seats, both mulligan; setup-only because full-game variant expansion is blocked. |
| tests/integration/demo-matrix.test.ts | Every-action PostgreSQL checks for all four promoted families. |

Harness: `scripts/test_engine_adapter.py` adds the four promoted families and one-worker reset/unrelated-action checks. No other harness file changed. All changes listed here are relative to the start of this milestone, not to HEAD, which already included prior uncommitted engine work.

## Engine bugs fixed

**None.** Matrix tooling and tests changed only. Source evidence does not justify choosing an overlapping-Reboot semantic model. The diagnostic descriptor finding is documented for a later explicit contract review. Engine remains `0.4.0-overtime-1`; all card revisions and original replay bytes remain unchanged.

## Remaining engine gaps

1. **Reachable overlapping Reboot prevention:** three of nine attempted coordinates; explicit detector and source review required before support.
2. **Public descriptor source ambiguity:** distinct visible units can share the same descriptor while action IDs are opaque; blocks informed agent selection for those actions until the contract is clarified.
3. **Coverage limits:** full-game SECOND/mulligan variants and continued exact overtime decisions remain unreviewed because expansion stopped. Several already implemented mechanics were not reached by this simple policy; no universal interaction claim is made.

## Self-play API readiness

| Area | Verdict | Scope |
| --- | --- | --- |
| ENGINE SELF-PLAY API | READY | Synchronous bounded legal-action execution/replay; Reboot guard required for reviewed Demo test runs. |
| EXACT DEMO ENVIRONMENT | BLOCKED | Common reachable overlap; full variants stopped. |
| OBSERVATION PRIVACY | READY | Reviewed boundaries and counterfactuals passed; no exhaustive proof. |
| ACTION-ID INTERFACE | BLOCKED for complete agent integration | Submission/resolution works; match/actor binding belongs to caller; duplicate labels need public source descriptors. |
| MULTI-GAME LOOP | READY | Sequential/interleaved pure execution and Python worker reuse; separate adapter per concurrent worker. |
| LARGE-SCALE DATA STORAGE | NEEDS DESIGN | Current full-snapshot fixtures are unsuitable as bulk storage. |

The future model contract remains observation plus public descriptor projection to selected action ID. Full legal action payloads and trusted state stay on the engine/orchestration side. This API boundary does not require web or database infrastructure.

## Unattended self-play readiness

**NO — blocked for unattended thousands of exact Demo games.** Overlapping Reboot is a common reachable source-dependent rule boundary, and the production legal-action API currently suppresses the unsupported second play. The test guard makes it visible; simply running an unguarded loop would silently alter the available game choices. Duplicate source labels also limit intelligent agent selection. Interactive/test self-play with explicit gap detection is useful; it is not evidence that bulk training-position generation is ready.

## Data-storage readiness

**NEEDS DESIGN.** Keep compact diagnostics and a small trusted replay set now. Design a separate action/checkpoint archive, immutable public card-definition resolution, TrainingPosition/TrainingAttempt records, provenance and deduplication/split rules after the rule blocker is settled. No training data pipeline was implemented around the gap, and no human-gold labels were generated.

## Ambiguities not guessed

Overlapping next-time consumption, redundancy and ordering remain unresolved in the pinned sources. Full-game SECOND/mulligan behavior, unseen interactions and prolonged exact overtime play were not inferred from setup success or constructed fixtures. Win counts do not imply balance; d20 counts do not imply fairness. PositionHash uniqueness does not establish dataset diversity. Observation-only action IDs do not establish global match authorization. Missing descriptor source references were not filled with hidden-state access. No source refresh, new format, Faceplate, WHEN_SPENT or out-of-deck card implementation was attempted.

## Recommended next phase

Address **overlapping Reboot Optics** first: obtain a specific authoritative ruling or sufficient source text, pin the evidence, implement only the supported consumption/ordering semantics with focused tests, run original-payload compatibility before regeneration, then rerun this same nine-coordinate prefix and resume the fixed 64/128 schedule. Keep the current suppression guard until positive semantics replace it.

Before serious agent-driven self-play, separately version and verify public source/target descriptors and resolve pinned public card definitions for models. Only after the exact environment passes the matrix should **SELF-PLAY DATA PIPELINE V1** begin. Model training remains a later phase.
