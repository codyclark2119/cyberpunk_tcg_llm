# First demo match: execution coverage roadmap

These are the user-supplied physical reference lists, preserved exactly: **27 main cards + 3 Legends = 30 total per deck**. Merc Psycho Squad is **3 copies**. Official constructed remains **40–50 main cards**. No starter padding, format exception, DEMO_STARTER policy or runnable demo match is introduced.

All **29 distinct cards** have local raw captures and demo printing metadata. “Executable revision” means an implementation-reviewed application revision, distinct from the harness's display/text normalization. CardIds are stable slugs, never demo collector numbers. Replays use constructed-size synthetic support decks and are not human-certified gold data.

| Card | Deck | Copies | Captured? | Executable revision | Execution scope | Supported now? | Remaining blocker(s) / scope |
|---|---|---:|---|---|---|---|---|
| Goro Takemura — Hands Unclean | Arasaka | 1 | Yes; demo 008 | No executable revision | Unreviewed | No | Go Solo/field Legend admission; printed Blocker on Legend |
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
| V — Corporate Exile | Mercs | 1 | Yes; demo 008 | No executable revision | Unreviewed | No | Go Solo/field Legend admission |
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

## Measured coverage after Dying Night delayed effects

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 18 | 19 |
| Without reviewed executable revisions | 11 | 10 |
| Remaining cards with identified subsystem/admission blockers | 11 | 10 |
| Arasaka supported distinct cards / 14 | 5 | 5 |
| Arasaka executable physical copies / 30 | 14 | 14 |
| Mercs supported distinct cards / 15 | 13 | 14 |
| Mercs executable physical copies / 30 | 27 | 29 |
| Both decks executable physical copies / 60 | 41 | 43 |

Recalculated from the 29 rows above, with unchanged quantities. Dying Night's two physical copies are the only newly executable demo copies. Reboot retains its existing one-outstanding-prevention limit. Coverage does not imply deck readiness.

Exactly one complete real-card revision is newly admitted: **Dying Night — V's Pistol**. All five official images confirm its single inherited ATTACK paragraph. Newly retrieved official card FAQs establish that choosing zero Gig decrease does not cancel the later benefit, and that the benefit survives defeat of its attacking V host. Each actual paragraph resolution registers independent end-of-current-turn work, which shares the existing end-turn scheduler with Delamain. See [delayed-effects-report.md](delayed-effects-report.md) for the evidence, bounded public source/subject lifetime and complete test matrix.

The legal replay uses Delamain as a non-V host and proves the false condition. A clearly synthetic trusted Unit tests the true V predicate and ready-two path; it does not admit a real V card. Existing immutable revisions and the harness source corpus remain unchanged.

## Exact deck readiness

**Can the exact Arasaka list initialize? No. Can the exact Merc list initialize? No. Can they play a complete deterministic match? No.** Both have 27 main cards, below the unchanged constructed minimum of 40. Arasaka lacks 9 distinct executable cards (16 copies); Mercs lacks 1 (1 copy). Printing/deck metadata does not establish demo size, RAM/copy/setup/win-condition exceptions; separate DEMO_STARTER source review remains necessary.

Merc's only remaining card blocker is **V — Corporate Exile (1 copy)**. No V revision, Go Solo, or field Legend execution is introduced. Dying Night's named-V benefit cannot currently be reached with a real executable V Unit; the full instruction is architecture-tested using a trusted synthetic Unit.

The next structural milestone is **Go Solo + field Legend execution**, starting with V and then separately reviewing Arasaka Legends that share that structure. Demo legality stays a separate source review even after individual-card execution is complete.

See [end-turn-history-report.md](end-turn-history-report.md) for the preserved eighteen-card baseline.
