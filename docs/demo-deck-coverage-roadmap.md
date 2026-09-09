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
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | No executable revision | Unreviewed | No | Up-to4 Gig increase, then current friendly Gig value≥8 conditional draw |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | No executable revision | Unreviewed | No | ANY Unit power≤friendly d20 value target filter and defeat; not rival-only |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete cannot-attack + Blocker shape supported; independent Blocker legality |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; no executable text omitted |
| Field Operator | Arasaka | 3 | Yes; demo 012 | No executable revision | Unreviewed | No | Current Street Cred parity/Null review and conditional PLAY draw1 |
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

## Measured coverage after Saburo — Stubborn Patriarch

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 22 | 23 |
| Without reviewed executable revisions | 7 | 6 |
| Arasaka supported distinct cards / 14 | 7 | 8 |
| Arasaka executable physical copies / 30 | 16 | 17 |
| Mercs supported distinct cards / 15 | 15 | 15 |
| Mercs executable physical copies / 30 | 30 | 30 |
| Both decks executable physical copies / 60 | 46 | 47 |

Calculated from the actual 29 rows before and after admitting Saburo. Only its one physical Legend copy changes status; no quantities change. All 46 prior immutable content revisions are preserved. Saburo adds exactly one real revision and no synthetic revision. Existing synthetic support cards remain excluded from real/demo counts. Reboot retains its one-outstanding-prevention limit.

Saburo uses the same exact **Arasaka** classification and effective Unit query as Yorinobu, with independent current attacking/source eligibility. Face-up spent Saburo still contributes; Goro7 + Mantis2 becomes10 during attack and returns9 at cleanup. The legal replay crosses the actual steal allowance1→2 threshold. See [saburo-attacking-aura-report.md](saburo-attacking-aura-report.md).

Yorinobu uses immutable exact **Arasaka** classification and effective Unit type, including real field Goro. Swordwise Huscle is **Merc**, Corpo Security is **Corpo**, and Emergency Atlus is **Trauma Team/Vehicle/Zetatech**; their presence in the Arasaka deck does not make them qualifying Units. A first attack while Yorinobu is face-down or absent consumes the same per-controller global-turn history. CALL later that turn cannot restore the first occurrence. See [yorinobu-first-attack-report.md](yorinobu-first-attack-report.md).

## Exact deck readiness

**Merc card execution coverage: COMPLETE (15/15 distinct, 30/30 physical copies).**

**Merc exact demo initialization: still NO until DEMO_STARTER policy is reviewed.**

Neither exact 27-main + 3-Legend reference list passes constructed's unchanged 40–50-main + exactly-3-Legends requirement. Copy and RAM rules are unchanged. Arasaka additionally lacks six distinct executable cards (13 copies). No DEMO_STARTER policy, padded physical teaching list, or complete demo match is introduced.

## Remaining Arasaka review and next milestone

All six remaining complete local source rows were reviewed read-only; none is admitted in this milestone. Quantities remain **6 distinct / 13 copies**. The following summarizes executable text, not a substitute for the next full printing/errata/FAQ/rules review.

| Card | Copies | Complete executable behavior still blocked |
|---|---:|---|
| Minotaur | 1 | Red RAM2 Unit, cost7/power9, unsellable, Arasaka/Drone/Militech. PLAY: if own Street Cred is greater than a rival's, defeat a rival Unit with power ≤5. Needs complete conditional targeted-defeat resolution and target legality. |
| Industrial Assembly | 3 | Red RAM1 Program, cost1/Null power, sellable, Arasaka/Braindance. Increase a Gig by up to4; then draw1 if a controlled Gig has value8+. Needs bounded up-to4 adjustment and current controlled-Gig threshold condition with exact ordered timing. |
| Over the Edge | 2 | Red RAM2 Program, cost3/Null power, sellable, Merc. Defeat **a Unit**, with power ≤ value of a friendly d20. Target relation is not rival-only. Needs d20 value/filter semantics, eligible Unit selection and targeted defeat. |
| Field Operator | 3 | Green RAM2 Unit, cost3/power2, unsellable, Arasaka/Corpo/Techie. PLAY: draw1 if current Street Cred is even. Needs complete current parity condition, including a rules review of Null. |
| Goro Takemura — Losing His Way | 1 | Green RAM3 Unit, cost4/power4, unsellable, Arasaka/Corpo. ATTACK: if all friendly Legends are face-up, this Unit gets +5 this turn. Needs all-Legends condition and bounded own-turn temporary power. This is a printed Unit, not another field-Legend admission. |
| Corporate Surveillance | 3 | Green RAM1 Program, cost2/Null power, sellable, Corpo. Spend a rival Unit with cost ≤4. Needs cost-filtered rival effective-Unit targeting, spending eligibility and Null-cost review. |

**Recommended next cluster: Industrial Assembly + Field Operator** (2 complete cards / 6 copies). Reuse current Gig adjustment and ordered condition/draw machinery; add only reviewed current Gig/Street Cred conditions and the required up-to4 bound. These are distinct narrow conditions, not a trait/expression DSL. Review their complete shapes and exact condition timing/Null semantics before implementation.

**Alternative: Minotaur + Over the Edge** (2 cards / 3 copies) shares a new targeted-defeat operation, but also needs different relationship and current-power/d20 filters plus defeat scheduling/owner ordering. Corporate Surveillance adds3 copies, but shares target selection rather than defeat; spending and cost filtering are another behavior and should not be bundled merely to raise counts. Losing His Way is a separate one-card temporary-power step; Saburo's continuous aura must not be repurposed into a stored turn modifier.

The Saburo source, six printings, all four local errata and focused official Fight/Steal FAQ are pinned in its new fixtures. Neither Saburo nor Yorinobu has an applicable captured erratum. No broad harness corpus refresh occurred. Faceplate, WHEN_SPENT, control changes, general aura/trait scripting and full demo matches remain outside this scope.

A later teaching-format review must establish size, Legend, RAM, copy, setup, win-condition and other exceptions before exact demos can initialize. Neither constructed's 40–50 requirement nor the physical 27+3 lists have changed.
