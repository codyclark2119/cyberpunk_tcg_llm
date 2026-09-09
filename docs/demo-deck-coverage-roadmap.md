# First demo match: execution coverage roadmap

These are the user-supplied physical reference lists, preserved exactly: **27 main cards + 3 Legends = 30 total per deck**. Merc Psycho Squad is **3 copies**. Official constructed remains **40–50 main cards**. No starter padding, format exception, DEMO_STARTER policy or runnable demo match is introduced.

All **29 distinct cards** have local raw captures and demo printing metadata. “Executable revision” means an implementation-reviewed application revision, distinct from the harness's display/text normalization. CardIds are stable slugs, never demo collector numbers. Replays use constructed-size synthetic support decks and are not human-certified gold data.

| Card | Deck | Copies | Captured? | Executable revision | Execution scope | Supported now? | Remaining blocker(s) / scope |
|---|---|---:|---|---|---|---|---|
| Goro Takemura — Hands Unclean | Arasaka | 1 | Yes; demo 008 | No executable revision | Unreviewed | No | Full-shape admission of Green RAM2 cost5 power7 Go Solo + printed Blocker; structural lifecycle now available, card still unadmitted |
| Yorinobu Arasaka — Embracing Destruction | Arasaka | 1 | Yes; demo 001 | No executable revision | Unreviewed | No | First attack per turn, trait trigger, discard |
| Saburo Arasaka — Stubborn Patriarch | Arasaka | 1 | Yes; demo 009 | No executable revision | Unreviewed | No | Friendly trait aura while attacking |
| Minotaur | Arasaka | 1 | Yes; demo 002 | No executable revision | Unreviewed | No | Street Cred comparison and targeted defeat |
| Swordwise Huscle | Arasaka | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_ATTACK_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; remaining demo mechanics and demo-format review |
| Mantis Blades | Arasaka | 3 | Yes; demo 004 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 + REVIEWED_GEAR_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Satori — Sword of Saburo | Arasaka | 3 | Yes; demo 005 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete printed Gear +2 inheritance and inherited fight-win draw; independent copies and controller ordering |
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | No executable revision | Unreviewed | No | Increase Gig up to 4 and conditional draw review |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | No executable revision | Unreviewed | No | D20 value target filter and defeat |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete cannot-attack + Blocker shape supported; independent Blocker legality |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; no executable text omitted |
| Field Operator | Arasaka | 3 | Yes; demo 012 | No executable revision | Unreviewed | No | Even Street Cred condition on play |
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

## Measured coverage after field Legends / V

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 19 | 20 |
| Without reviewed executable revisions | 10 | 9 |
| Arasaka supported distinct cards / 14 | 5 | 5 |
| Arasaka executable physical copies / 30 | 14 | 14 |
| Mercs supported distinct cards / 15 | 14 | 15 |
| Mercs executable physical copies / 30 | 29 | 30 |
| Both decks executable physical copies / 60 | 43 | 44 |

Recalculated from the 29 actual rows. V's one physical copy is the only newly executable demo copy. Previous immutable real revisions and physical quantities are unchanged. Reboot retains its one-outstanding-prevention limit. Coverage does not imply unrestricted combinations or deck readiness.

Exactly one complete real revision is newly admitted: **V — Corporate Exile**. Ordinary play and Go Solo both pay cost5, preserve the physical host and pre-equipped Gear, and derive UNIT + LEGEND on FIELD. Go Solo enters ready and permits attacking despite Lag; ordinary entry preserves orientation. Defeat sends host and Gear to Trash, detaches Gear, then removes V. Real Dying Night's delayed benefit now succeeds with this real V, including after defeat. See [field-legends-report.md](field-legends-report.md).

## Exact deck readiness

**Merc card execution coverage: COMPLETE (15/15 distinct, 30/30 physical copies).**

**Merc exact demo initialization: still NO until DEMO_STARTER policy is reviewed.**

Neither exact 27-main + 3-Legend reference list passes constructed's unchanged 40–50-main + exactly-3-Legends requirement. Copy and RAM rules are unchanged. Arasaka additionally lacks nine distinct executable cards (16 copies). No DEMO_STARTER policy, padded physical teaching list, or complete demo match is introduced.

## Next review

Start with **Goro Takemura — Hands Unclean**, Green RAM2, cost5, power7, Go Solo + printed Blocker. Its structural primitives now exist, but its complete captured shape still needs its own admission. No Arasaka card was admitted here.

Yorinobu needs first qualifying ARASAKA attack history and ordered conditional discard. Saburo needs a trait-filtered attacking aura. Goro — Losing His Way is a **Unit**, not a Legend, and needs an all-friendly-Legends-face-up condition and +5 turn modifier. Keep these separate unless a subsequent full-shape review supports a coherent cluster.

A later teaching-format review must establish size, Legend, RAM, copy, setup, win-condition and other exceptions before exact demos can initialize. See [delayed-effects-report.md](delayed-effects-report.md) for the preserved nineteen-card baseline.
