# First demo match: execution coverage roadmap

These are the user-supplied physical reference lists, preserved exactly: **27 main cards + 3 Legends = 30 total per deck**. Merc Psycho Squad is **3 copies**. Official constructed remains **40–50 main cards**. No starter padding, format exception, DEMO_STARTER policy or runnable demo match is introduced.

All **29 distinct cards** have local raw captures and demo printing metadata. “Executable revision” means an implementation-reviewed application revision, distinct from the harness's display/text normalization. CardIds are stable slugs, never demo collector numbers. Replays use constructed-size synthetic support decks and are not human-certified gold data.

| Card | Deck | Copies | Captured? | Executable revision | Execution scope | Supported now? | Remaining blocker(s) / scope |
|---|---|---:|---|---|---|---|---|
| Goro Takemura — Hands Unclean | Arasaka | 1 | Yes; demo 008 | Yes; application revision 1 | FIELD_LEGENDS_V1 | Scoped only | Complete Green RAM2 cost5 power7 Go Solo + printed Blocker; shared ordinary/Go Solo entry, pre-equipped Gear, effective Legend+Unit, attack/Blocker/fight/owner Trash order and Legend removal |
| Yorinobu Arasaka — Embracing Destruction | Arasaka | 1 | Yes; demo 001 | Yes; application revision 1 | FIRST_ATTACK_HISTORY_V1 | Scoped only | Complete face-up LEGENDS effect; source-independent first friendly Arasaka effective Unit attack per global turn; draw1 then current Street Cred <20 chosen discard1, including Null; no field entry |
| Saburo Arasaka — Stubborn Patriarch | Arasaka | 1 | Yes; demo 009 | Yes; application revision 1 | ATTACKING_AURA_V1 | Scoped only | Complete face-up LEGENDS source aura; friendly exact Arasaka effective Unit +1 only during declared attack, through Fight/Steal; spent source stays active, Null cost/power, no field entry |
| Minotaur | Arasaka | 1 | Yes; demo 002 | No executable revision | Unreviewed | No | Conditional own > rival Street Cred, rival effective Unit power≤5 target and defeat |
| Swordwise Huscle | Arasaka | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_ATTACK_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; remaining demo mechanics and demo-format review |
| Mantis Blades | Arasaka | 3 | Yes; demo 004 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 + REVIEWED_GEAR_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Satori — Sword of Saburo | Arasaka | 3 | Yes; demo 005 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete printed Gear +2 inheritance and inherited fight-win draw; independent copies and controller ordering |
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | Yes; application revision 1 | VALUE_CONDITIONS_V1 | Scoped only | Complete Red RAM1 cost1 sellable Program: any Gig increase0–4 within die bounds, then current any-controlled-Gig≥8 draw1; ordered, including zero/no target |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | No executable revision | Unreviewed | No | ANY Unit power≤friendly d20 value target filter and defeat; not rival-only |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete cannot-attack + Blocker shape supported; independent Blocker legality |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; no executable text omitted |
| Field Operator | Arasaka | 3 | Yes; demo 012 | Yes; application revision 1 | VALUE_CONDITIONS_V1 | Scoped only | Complete Green RAM2 cost3 power2 unsellable Arasaka/Corpo/Techie Unit: ordinary payment/READY+Lag, PLAY current even Street Cred draw1; Null false |
| Goro Takemura — Losing His Way | Arasaka | 1 | Yes; demo 013 | No executable revision | Unreviewed | No | All Legends revealed condition, +5 turn modifier on attack |
| Corporate Surveillance | Arasaka | 3 | Yes; demo 014 | No executable revision | Unreviewed | No | Cost-filtered rival Unit spending |
| V — Corporate Exile | Mercs | 1 | Yes; demo 008 | Yes; application revision 1 | FIELD_LEGENDS_V1 | Scoped only | Complete ordinary/Go Solo field play, exact payment, Unit+Legend types, pre-equipped Gear preservation, combat/defeat/removal and real Dying-positive delayed resolution |
| Viktor Vektor — Sit Down and Relax | Mercs | 1 | Yes; demo 001 | Yes; application revision 1 | NONCOMBAT_SLICE_V1 / reviewed CALL (MAIN + React) | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Jackie Welles — Pour One Out For Me | Mercs | 1 | Yes; demo 007 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete first Blue Unit/Gear history guard, optional friendly decrease and actual-minimum draw; Legends area only |
| Dying Night — V's Pistol | Mercs | 2 | Yes; demo 013 | Yes; application revision 1 | GEAR_DELAYED_ATTACK_V1 | Scoped only | Complete cost2/power2 Gear; one inherited ATTACK decrease then independent end-turn registration; public battlefield/Trash lifetime, exact Unit Name V predicate and atomic ready2 set selection |
| Dexter DeShawn — One Last Chance | Mercs | 1 | Yes; demo 002 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete Play/Attack Gig adjustment and post-movement DEFEATED Street Cred difference/draw |
| Secondhand Bombus | Mercs | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; remaining demo mechanics and demo-format review |
| Kiroshi Optics | Mercs | 3 | Yes; demo 004 | Yes; application revision 1 | GEAR_PRIVATE_LOOK_V1 | Scoped only | Complete printed Gear +1, equip erratum, inherited ATTACK/private Legend look, public known marker and viewer-specific remembered identity |
| Mandibular Upgrade | Mercs | 2 | Yes; demo 005 | Yes; application revision 1 | GEAR_CAPABILITIES_V1 | Scoped only | Complete zero printed-power inheritance, default equip and inherited Blocker; Unit-only declaration uses existing React pipeline |
| Afterparty at Lizzie's | Mercs | 2 | Yes; demo 006 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Delamain Cab | Mercs | 3 | Yes; demo 009 | Yes; application revision 1 | END_TURN_HISTORY_V1 | Scoped only | Complete cost4 power4 unsellable Unit; own-turn end checks this physical Unit's current-turn actual steals, then readies one own spent Eddie |
| Evelyn Parker — Scheming Siren | Mercs | 3 | Yes; demo 010 | Yes; application revision 1 | ATTACK_ORDERED_EFFECTS_V1 | Scoped only | Complete cost2 power0 unsellable Unit; ordered ATTACK draw1 then current Street Cred comparison and mandatory own-hand discard1, before React |
| MT0D12 Flathead | Mercs | 1 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Current Street Cred restriction supported; CALL/Quick/PASS remain legal |
| Psycho Squad | Mercs | 3 | Yes; demo 012 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; three physical copies unchanged |
| Floor It | Mercs | 3 | Yes; demo 014 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Reboot Optics | Mercs | 2 | Yes; demo 015 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Single outstanding next-fight defeat prevention supported; overlapping copies explicitly unsupported pending interaction review |

## Measured coverage after Industrial Assembly + Field Operator

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 23 | 25 |
| Without reviewed executable revisions | 6 | 4 |
| Arasaka supported distinct cards / 14 | 8 | 10 |
| Arasaka executable physical copies / 30 | 17 | 23 |
| Mercs supported distinct cards / 15 | 15 | 15 |
| Mercs executable physical copies / 30 | 30 | 30 |
| Both decks executable physical copies / 60 | 47 | 53 |

Calculated from the actual 29 rows preserved before editing. Industrial Assembly contributes3 copies and Field Operator3; no quantities change. All47 prior immutable content revisions are preserved, with exactly2 complete real revisions added and no new synthetic revision. Synthetic support cards remain excluded from real/demo counts. Reboot retains its one-outstanding-prevention limit.

Industrial uses the existing Program ordered continuation: choose any rolled Gig, increase by0–4 within its actual die maximum, then inspect all currently controlled Gigs for value8+. Zero does not adjust but does not cancel the second clause. Field Operator enters through ordinary Unit play/payment/READY+Lag, then evaluates current Street Cred parity in its PLAY trigger; Null is never even. The legal combined replay changes a D8 from7 to8 and Street Cred from11 to12, then both cards draw. See [value-conditions-report.md](value-conditions-report.md) for complete source review, focused regressions and the legal odd/no-draw alternative.

Field Operator supplies a real printed Arasaka Unit to the reviewed content bundle. Existing exact-classification/effective-Unit queries apply to it without changing Yorinobu or Saburo. Their earlier reports describe their own historical admission baselines.

Saburo uses the same exact **Arasaka** classification and effective Unit query as Yorinobu, with independent current attacking/source eligibility. Face-up spent Saburo still contributes; Goro7 + Mantis2 becomes10 during attack and returns9 at cleanup. The legal replay crosses the actual steal allowance1→2 threshold. See [saburo-attacking-aura-report.md](saburo-attacking-aura-report.md).

Yorinobu uses immutable exact **Arasaka** classification and effective Unit type, including real field Goro. Swordwise Huscle is **Merc**, Corpo Security is **Corpo**, and Emergency Atlus is **Trauma Team/Vehicle/Zetatech**; their presence in the Arasaka deck does not make them qualifying Units. A first attack while Yorinobu is face-down or absent consumes the same per-controller global-turn history. CALL later that turn cannot restore the first occurrence. See [yorinobu-first-attack-report.md](yorinobu-first-attack-report.md).

## Exact deck readiness

**Merc card execution coverage: COMPLETE (15/15 distinct, 30/30 physical copies).**

**Merc exact demo initialization: still NO until DEMO_STARTER policy is reviewed.**

Neither exact 27-main + 3-Legend reference list passes constructed's unchanged 40–50-main + exactly-3-Legends requirement. Copy and RAM rules are unchanged. Arasaka additionally lacks four distinct executable cards (7 copies). No DEMO_STARTER policy, padded physical teaching list, or complete demo match is introduced.

## Remaining Arasaka review and next milestone

All four remaining complete local source records, all their printings and the captured errata were reviewed read-only. None is admitted here. Quantities remain **4 distinct / 7 copies**. This blocker review does not replace the focused FAQ/rules review required before the next implementation.

| Card | Copies | Complete executable behavior still blocked |
|---|---:|---|
| Minotaur | 1 | Red RAM2 Unit, cost7/power9, unsellable, Arasaka/Drone/Militech;3 printings. PLAY: if own Street Cred is greater than a rival's, defeat a rival Unit with power≤5. Needs resolution-time Null-aware comparison, current effective-power filtering, rival-only target legality and complete defeat/departure ordering. |
| Over the Edge | 2 | Red RAM2 Program, cost3/Null power, sellable, Merc;5 printings. Defeat **a Unit** with power≤value of a friendly d20. ANY Unit relationship, not rival-only. Needs current controlled-d20/Null semantics, current effective-power filtering and complete targeted defeat. |
| Goro Takemura — Losing His Way | 1 | Green RAM3 Unit, cost4/power4, unsellable, Arasaka/Corpo;3 printings. ATTACK: if all friendly Legends are face-up, this Unit gets+5 this turn. Needs the all-friendly-Legends condition and own temporary-power lifetime. This is a printed Unit, not another field-Legend admission. |
| Corporate Surveillance | 3 | Green RAM1 Program, cost2/Null power, sellable, Corpo;5 printings. Spend a rival Unit with cost≤4. Needs current effective-Unit/cost filtering, Null-cost review and spending eligibility; spending is distinct from defeat. |

**Recommended next cluster: Minotaur + Over the Edge** (2 complete cards / 3 copies). Review both complete shapes and focused sources, then share the smallest targeted-defeat operation. Preserve their different RIVAL/ANY relationships, conditional PLAY versus Program timing, current effective-power and current d20/Street Cred filters, no-target/forced-target behavior, owner ordering, Gear departure and field-Legend removal. Do not infer those details from combat defeat alone.

Corporate Surveillance can follow as a cost-filtered spending milestone; shared target selection alone is insufficient to certify it alongside defeat. Losing His Way remains a separate all-Legends condition/temporary-modifier pass. Saburo's continuous aura must not be converted to a stored turn modifier.

The two new complete sources, all11 printings, all4 captured errata and3 focused official FAQs are pinned in [value-conditions-card-sources.v1.json](../tests/fixtures/value-conditions-card-sources.v1.json) and [value-conditions-rules.v1.json](../tests/fixtures/value-conditions-rules.v1.json). Neither card has an applicable captured erratum. The narrow live source check agrees on gameplay fields/printing identities, and live parsed rules equal the local snapshot. No broad harness corpus refresh occurred. Faceplate, WHEN_SPENT, general control-transfer actions, arithmetic/condition DSLs and full demo matches remain outside scope.

A later teaching-format review must establish size, Legend, RAM, copy, setup, win-condition and other exceptions before exact demos can initialize. Neither constructed's 40–50 requirement nor the physical 27+3 lists have changed.
