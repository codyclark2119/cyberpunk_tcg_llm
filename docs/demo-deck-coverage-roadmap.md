# First demo match: execution coverage roadmap

These are the user-supplied physical reference lists, preserved exactly: **27 main cards + 3 Legends = 30 total per deck**. Merc Psycho Squad is **3 copies**. Official constructed remains **40–50 main cards**. The explicit **DEMO_STARTER_V1** policy now admits only one exact Arasaka deck and one exact Merc deck, in either seat. No padding or arbitrary 27-card construction is admitted.

All **29 distinct cards** have local raw captures and demo printing metadata. “Executable revision” means an implementation-reviewed application revision, distinct from the harness's display/text normalization. CardIds are stable slugs, never demo collector numbers. Earlier card-mechanic replays use constructed-size synthetic support decks. The new **demo-setup** contract fixture uses only the exact 29 real revisions and stops before normal gameplay. Neither category is human-certified gold data. The per-card rows retain their historical execution-scope descriptions; current format readiness is recorded below.

| Card | Deck | Copies | Captured? | Executable revision | Execution scope | Supported now? | Remaining blocker(s) / scope |
|---|---|---:|---|---|---|---|---|
| Goro Takemura — Hands Unclean | Arasaka | 1 | Yes; demo 008 | Yes; application revision 1 | FIELD_LEGENDS_V1 | Scoped only | Complete Green RAM 2 cost 5 power 7 Go Solo + printed Blocker; shared ordinary/Go Solo entry, pre-equipped Gear, effective Legend+Unit, attack/Blocker/fight/owner Trash order and Legend removal |
| Yorinobu Arasaka — Embracing Destruction | Arasaka | 1 | Yes; demo 001 | Yes; application revision 1 | FIRST_ATTACK_HISTORY_V1 | Scoped only | Complete face-up LEGENDS effect; source-independent first friendly Arasaka effective Unit attack per global turn; draw 1 then current Street Cred <20 chosen discard 1, including Null; no field entry |
| Saburo Arasaka — Stubborn Patriarch | Arasaka | 1 | Yes; demo 009 | Yes; application revision 1 | ATTACKING_AURA_V1 | Scoped only | Complete face-up LEGENDS source aura; friendly exact Arasaka effective Unit +1 only during declared attack, through Fight/Steal; spent source stays active, Null cost/power, no field entry |
| Minotaur | Arasaka | 1 | Yes; demo 002 | Yes; application revision 1 | TARGETED_DEFEAT_V1 | Scoped only | Complete cost 7/power 9 unsellable Red RAM 2 Unit; PLAY current Null-aware own Street Cred > rival, mandatory rival effective Unit reference power≤5, shared semantic defeat/Gear/owner order/DEFEATED |
| Swordwise Huscle | Arasaka | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_ATTACK_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; separate demo-format review and documented interaction limits |
| Mantis Blades | Arasaka | 3 | Yes; demo 004 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 + REVIEWED_GEAR_V1 | Scoped only | Supported captured function; full demo match still requires separate demo-format review and documented interaction review |
| Satori — Sword of Saburo | Arasaka | 3 | Yes; demo 005 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete printed Gear +2 inheritance and inherited fight-win draw; independent copies and controller ordering |
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | Yes; application revision 1 | VALUE_CONDITIONS_V1 | Scoped only | Complete Red RAM 1 cost 1 sellable Program: any Gig increase 0–4 within die bounds, then current any-controlled-Gig≥8 draw 1; ordered, including zero/no target |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | Yes; application revision 1 | TARGETED_DEFEAT_V1 | Scoped only | Complete cost 3/Null-power sellable Red RAM 2 Program; ANY effective Unit including own with reference power≤a current controlled rolled D20, shared semantic defeat; no D20 means no targets, play remains legal |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete cannot-attack + Blocker shape supported; independent Blocker legality |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; no executable text omitted |
| Field Operator | Arasaka | 3 | Yes; demo 012 | Yes; application revision 1 | VALUE_CONDITIONS_V1 | Scoped only | Complete Green RAM 2 cost 3 power 2 unsellable Arasaka/Corpo/Techie Unit: ordinary payment/READY+Lag, PLAY current even Street Cred draw 1; Null false |
| Goro Takemura — Losing His Way | Arasaka | 1 | Yes; demo 013 | Yes; application revision 1 | ATTACK_CONDITION_POWER_V1 | Scoped only | Complete Green RAM 3 cost 4/power 4 unsellable Arasaka/Corpo Unit; ATTACK all-friendly-Legends-face-up gate and resolution check; self+5 stacks per occurrence and lasts through MAIN until end-turn expiry |
| Corporate Surveillance | Arasaka | 3 | Yes; demo 014 | Yes; application revision 1 | TARGETED_SPEND_V1 | Scoped only | Complete Green RAM 1 cost 2 sellable Corpo Program; mandatory rival effective Unit cost≤4 selection, including already-SPENT per FAQ; semantic effect spend preserves target/Gear/Lag, no defeat or movement, normal Program Trash |
| V — Corporate Exile | Mercs | 1 | Yes; demo 008 | Yes; application revision 1 | FIELD_LEGENDS_V1 | Scoped only | Complete ordinary/Go Solo field play, exact payment, Unit+Legend types, pre-equipped Gear preservation, combat/defeat/removal and real Dying-positive delayed resolution |
| Viktor Vektor — Sit Down and Relax | Mercs | 1 | Yes; demo 001 | Yes; application revision 1 | NONCOMBAT_SLICE_V1 / reviewed CALL (MAIN + React) | Scoped only | Supported captured function; full demo match still requires separate demo-format review and documented interaction review |
| Jackie Welles — Pour One Out For Me | Mercs | 1 | Yes; demo 007 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete first Blue Unit/Gear history guard, optional friendly decrease and actual-minimum draw; Legends area only |
| Dying Night — V's Pistol | Mercs | 2 | Yes; demo 013 | Yes; application revision 1 | GEAR_DELAYED_ATTACK_V1 | Scoped only | Complete cost 2/power 2 Gear; one inherited ATTACK decrease then independent end-turn registration; public battlefield/Trash lifetime, exact Unit Name V predicate and atomic ready 2 set selection |
| Dexter DeShawn — One Last Chance | Mercs | 1 | Yes; demo 002 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete Play/Attack Gig adjustment and post-movement DEFEATED Street Cred difference/draw |
| Secondhand Bombus | Mercs | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; separate demo-format review and documented interaction limits |
| Kiroshi Optics | Mercs | 3 | Yes; demo 004 | Yes; application revision 1 | GEAR_PRIVATE_LOOK_V1 | Scoped only | Complete printed Gear +1, equip erratum, inherited ATTACK/private Legend look, public known marker and viewer-specific remembered identity |
| Mandibular Upgrade | Mercs | 2 | Yes; demo 005 | Yes; application revision 1 | GEAR_CAPABILITIES_V1 | Scoped only | Complete zero printed-power inheritance, default equip and inherited Blocker; Unit-only declaration uses existing React pipeline |
| Afterparty at Lizzie's | Mercs | 2 | Yes; demo 006 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 | Scoped only | Supported captured function; full demo match still requires separate demo-format review and documented interaction review |
| Delamain Cab | Mercs | 3 | Yes; demo 009 | Yes; application revision 1 | END_TURN_HISTORY_V1 | Scoped only | Complete cost 4 power 4 unsellable Unit; own-turn end checks this physical Unit's current-turn actual steals, then readies one own spent Eddie |
| Evelyn Parker — Scheming Siren | Mercs | 3 | Yes; demo 010 | Yes; application revision 1 | ATTACK_ORDERED_EFFECTS_V1 | Scoped only | Complete cost 2 power 0 unsellable Unit; ordered ATTACK draw 1 then current Street Cred comparison and mandatory own-hand discard 1, before React |
| MT0D12 Flathead | Mercs | 1 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Current Street Cred restriction supported; CALL/Quick/PASS remain legal |
| Psycho Squad | Mercs | 3 | Yes; demo 012 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; three physical copies unchanged |
| Floor It | Mercs | 3 | Yes; demo 014 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Supported captured function; full demo match still requires separate demo-format review and documented interaction review |
| Reboot Optics | Mercs | 2 | Yes; demo 015 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Single outstanding next-fight defeat prevention supported; overlapping copies explicitly unsupported pending interaction review |

## Measured coverage after Losing His Way

**REFERENCE CARD EXECUTION COVERAGE: COMPLETE.**

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 28 | 29 |
| Without reviewed executable revisions | 1 | 0 |
| Arasaka supported distinct cards /14 | 13 | 14 |
| Arasaka executable physical copies /30 | 29 | 30 |
| Mercs supported distinct cards /15 | 15 | 15 |
| Mercs executable physical copies /30 | 30 | 30 |
| Both decks executable physical copies /60 | 59 | 60 |

Calculated from the same 29 reference rows frozen before this milestone. Losing His Way contributes one physical copy. All quantities are unchanged, including three Merc Psycho Squad. All 52 previous immutable content revisions remain unchanged; exactly one full real revision is added, for 53 in the new test bundle. Existing synthetic support is excluded from these reference counts. Reboot retains its documented one-outstanding-next-fight-prevention limit.

Losing His Way is a printed Green RAM 3 cost 4/power 4 Arasaka/Corpo Unit. Its complete ATTACK effect uses current friendly Legend face state and the existing temporary-power system. The card-specific FAQ requires the condition at declaration; rules also require a current resolution-time check. Friendly Legends include controlled Legends in LEGENDS and on the field. Removed cards are outside the game. SPENT face-up Legends qualify; Kiroshi-known face-down Legends do not. Each successful occurrence adds self+5 until end-turn cleanup, independently of Saburo's attacking-only+1.

The legal 55-action headline uses three blind CALLs, real Saburo/Yorinobu/Hands Unclean, ordinary Losing/Mantis play and legal Hands Unclean field entry. Losing reaches 12 during attack, steals two Gigs, retains 11 in MAIN, then returns to 6 on turn 10. There are 53 strategic positions and 224 events including setup. No state/RNG patches. Focused tests additionally exercise true/false conditions, separate trigger/resolution timing, stacking, real Fight/Satori and Floor It, Gear, Kiroshi/Dying/Yorinobu ordering, end-turn pending effects, departure, hashes/privacy and malformed inputs. See [attack-condition-power-report.md](attack-condition-power-report.md).

## Exact deck readiness

**Arasaka card execution: COMPLETE within documented scopes (14/14 distinct, 30/30 copies).**

**Merc card execution: COMPLETE within documented scopes (15/15 distinct, 30/30 copies).**

**Demo fixed-list legality: SUPPORTED — DEMO_STARTER_V1. Exact demo initialization: SUPPORTED.**

The user's application policy selects Comprehensive Rules setup ordering, retaining physical opposed-d20 selection. One exact Arasaka and one exact Merc deck are required; either seat assignment works. Both still fail default/explicit constructed MAIN_DECK_SIZE. Setup seed `demo-setup-14` rolls 20–20 then 12–11; p0 chooses SECOND, so p1's two leftmost Legends are spent. The six-action contract trace proves cuts, six-card hands and the first whole-hand mulligan, then stops at the second mulligan before turn 1.

**Overtime: UNSUPPORTED. Full exact match: NOT YET VERIFIED.** Existing card interaction limits remain. Next: **CYBERPUNK TCG — OVERTIME EXECUTION**. See the [current implementation report](demo-starter-report.md).

## Historical DEMO_STARTER source review outcome

The historical [setup clarification follow-up](demo-setup-review-report.md): all four downloadable instructions and the HTML guide are byte-unchanged; FAQ changes affect image URLs only. Additional sealed-event/card-errata authority statements do not resolve the demo-specific setup conflict. The source review left setup precedence and first-player method separately UNRESOLVED and admitted no runtime format. The subsequent application decision above resolves implementation policy without inventing publisher clarification.

**DIRECT PLAY CONFIRMED. DEMO_STARTER: NOT ADMITTED.** Official publisher announcements invite independent home play of these two exact products; visual PDF audit confirms both 27-main/3-Legend lists, including three Psycho Squads. This finding supersedes the earlier unanswered direct-play question.

The product reminders/current gameplay guide expressly put shuffling before first-player determination; formal rule 7.4 requires first-player determination before shuffling. No explicit publisher precedence or demo exception resolves that ordered setup conflict. The exact two fixed lists are the narrow future candidate, not general 27-card construction. The review therefore retains them as **REFERENCE_ONLY** under the user's source-conflict requirement.

[Reference manifests](../tests/fixtures/demo-reference-manifests.v1.json) now pin all 60 physical copies and their printing provenance; [44 focused tests](../tests/demo-format.test.ts) calculate counts, resolve exactly 29 real supported revisions, preserve all 53 prior revisions, and reject both exact lists under default/explicit constructed. Both pass existing RAM/copy/Legend checks; only MAIN_DECK_SIZE fails. The real-only bundle is deterministic and contains no synthetic support.

At that historical review, the next step was to resolve setup precedence before admission. The subsequent user decision supplies application authority; it does not alter those source findings. Overtime is explicitly present in the demo instructions and remains an independent unsupported full-match boundary. No exact teaching match was played. See the [complete format report](demo-format-report.md) and [source fixture](../tests/fixtures/demo-format-sources.v1.json).

The final card's complete three-printing source and all four captured errata are pinned in [attack-condition-power-card-source.v1.json](../tests/fixtures/attack-condition-power-card-source.v1.json). The [rules fixture](../tests/fixtures/attack-condition-power-rules.v1.json) contains 362 complete rule nodes and 3 FAQs. Narrow live gameplay/printing checks agree with local data; parsed live rules equal the local snapshot. No corpus refresh occurred. Earlier milestone reports retain their historical baselines.

Faceplate, WHEN_SPENT scheduling, a general spending-path refactor, generic condition/filter/modifier languages, control-transfer actions and a full teaching match remain outside this milestone. The empty-Legend query is explicitly a universal-text inference in an unsupported trusted arrangement, not a new legal zero-Legend state or format.
