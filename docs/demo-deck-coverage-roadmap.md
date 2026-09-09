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
| Dying Night — V's Pistol | Mercs | 2 | Yes; demo 013 | No executable revision | Unreviewed | No | Inherited attack effect, named-host end-turn Eddie ready |
| Dexter DeShawn — One Last Chance | Mercs | 1 | Yes; demo 002 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete Play/Attack Gig adjustment and post-movement DEFEATED Street Cred difference/draw |
| Secondhand Bombus | Mercs | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; remaining demo mechanics and demo-format review |
| Kiroshi Optics | Mercs | 3 | Yes; demo 004 | Yes; application revision 1 | GEAR_PRIVATE_LOOK_V1 | Scoped only | Complete printed Gear +1, equip erratum, inherited ATTACK/private Legend look, public known marker and viewer-specific remembered identity |
| Mandibular Upgrade | Mercs | 2 | Yes; demo 005 | Yes; application revision 1 | GEAR_CAPABILITIES_V1 | Scoped only | Complete zero printed-power inheritance, default equip and inherited Blocker; Unit-only declaration uses existing React pipeline |
| Afterparty at Lizzie's | Mercs | 2 | Yes; demo 006 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Delamain Cab | Mercs | 3 | Yes; demo 009 | No executable revision | Unreviewed | No | Steal history and end-turn Eddie ready |
| Evelyn Parker — Scheming Siren | Mercs | 3 | Yes; demo 010 | No executable revision | Unreviewed | No | Ordered attack draw/conditional discard |
| MT0D12 Flathead | Mercs | 1 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Current Street Cred restriction supported; CALL/Quick/PASS remain legal |
| Psycho Squad | Mercs | 3 | Yes; demo 012 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; three physical copies unchanged |
| Floor It | Mercs | 3 | Yes; demo 014 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Reboot Optics | Mercs | 2 | Yes; demo 015 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Single outstanding next-fight defeat prevention supported; overlapping copies explicitly unsupported pending interaction review |

## Measured coverage after private Legend look

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 15 | 16 |
| Without reviewed executable revisions | 14 | 13 |
| Remaining cards with identified subsystem/admission blockers | 14 | 13 |
| Arasaka supported distinct cards / 14 | 5 | 5 |
| Arasaka executable physical copies / 30 | 14 | 14 |
| Mercs supported distinct cards / 15 | 10 | 11 |
| Mercs executable physical copies / 30 | 18 | 21 |
| Both decks executable physical copies / 60 | 32 | 35 |

Recalculated from the actual 29 rows above; physical quantities are unchanged. The 13 unreviewed cards and 13 cards with known blockers are the same population. Copy coverage does not imply deck readiness. Reboot's two copies remain individually supported within the existing one-outstanding-prevention scope.

Exactly one new full real-card revision is admitted: Kiroshi Optics. Its default equip (including erratum), printed Gear power 1 and inherited ATTACK/private look are all represented. The source capture retains five printings and all four errata. Rule 5.7.4.2 requires a public known-slot marker; the remembered identity is private, and is not a permission to inspect again under 5.7.4.3. See [private-information-card-source.v1.json](../tests/fixtures/private-information-card-source.v1.json), [private-information-fixture.ts](../tests/private-information-fixture.ts) and [private-information-report.md](private-information-report.md). Earlier immutable revisions and the harness corpus are unchanged.

## Exact deck readiness

**Can the exact Arasaka list initialize? No. Can the exact Merc list initialize? No. Can they play a complete deterministic match? No.** Both have 27 main cards, below the reviewed constructed minimum. Arasaka also lacks 9 distinct executable cards (16 copies); Mercs lacks 4 (9 copies), with the exact blockers in the table. No local complete demo-format rule capture was found: printing/deck metadata does not establish size, RAM/copy/setup/win-condition exceptions. The generic reference to a Gameplay Guide is not that guide. A separate source review remains necessary.

The next coherent review candidate is Evelyn Parker — Scheming Siren: its complete captured ordered ATTACK draw/conditional-discard shape is narrower than Dying Night or Delamain's end-turn/history requirements. Review the entire local record and rules before admission; no Evelyn mechanics are implemented here.

The remaining four Merc cards are V — Corporate Exile (Go Solo/field Legend), Dying Night — V's Pistol (inherited up-to-two Gig decrease plus named-host end-turn Eddie readying), Delamain Cab (steal history/end-turn readying), and Evelyn Parker (ordered ATTACK draw/conditional discard). Arasaka's nine unreviewed entries remain listed above. No DEMO_STARTER or complete starter match is introduced.

See [private-information-report.md](private-information-report.md) for this milestone and [gear-capabilities-report.md](gear-capabilities-report.md) for the preceding fifteen-card baseline.
