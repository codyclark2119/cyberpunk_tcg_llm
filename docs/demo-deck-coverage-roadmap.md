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
| Kiroshi Optics | Mercs | 3 | Yes; demo 004 | No executable revision | Unreviewed | No | Inherited attack/private Legend look; erratum review |
| Mandibular Upgrade | Mercs | 2 | Yes; demo 005 | No executable revision | Unreviewed | No | Inherited Blocker keyword/equip permission |
| Afterparty at Lizzie's | Mercs | 2 | Yes; demo 006 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Delamain Cab | Mercs | 3 | Yes; demo 009 | No executable revision | Unreviewed | No | Steal history and end-turn Eddie ready |
| Evelyn Parker — Scheming Siren | Mercs | 3 | Yes; demo 010 | No executable revision | Unreviewed | No | Ordered attack draw/conditional discard |
| MT0D12 Flathead | Mercs | 1 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Current Street Cred restriction supported; CALL/Quick/PASS remain legal |
| Psycho Squad | Mercs | 3 | Yes; demo 012 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; three physical copies unchanged |
| Floor It | Mercs | 3 | Yes; demo 014 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Reboot Optics | Mercs | 2 | Yes; demo 015 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Single outstanding next-fight defeat prevention supported; overlapping copies explicitly unsupported pending interaction review |

## Measured coverage after combat triggers

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 11 | 14 |
| Without reviewed executable revisions | 18 | 15 |
| Remaining cards with identified subsystem/admission blockers | 18 | 15 |
| Arasaka supported distinct cards / 14 | 4 | 5 |
| Arasaka executable physical copies / 30 | 11 | 14 |
| Mercs supported distinct cards / 15 | 7 | 9 |
| Mercs executable physical copies / 30 | 14 | 16 |
| Both decks executable physical copies / 60 | 25 | 30 |

Counts are recalculated from the 29 rows above. The 15 unreviewed cards and the 15 cards with known blockers are the same population. Copy coverage does not imply deck readiness. Reboot's two copies remain individually supported with the previous one-outstanding-prevention scope; overlapping use still needs review.

Exactly three new complete real-card revisions are admitted: Satori, Dexter and Jackie. Their source text, all 14 printing UUIDs, raw/canonical/normalized hashes and errata pins are recorded in [combat-triggers-card-sources.v1.json](../tests/fixtures/combat-triggers-card-sources.v1.json), [combat-triggers-fixture.ts](../tests/combat-triggers-fixture.ts) and [executable-card-coverage.md](executable-card-coverage.md). Satori includes both printed-power inheritance and its inherited draw trigger. Dexter has no static modifier; Jackie has no static modifier or DEFEATED line. Earlier revisions and the 151-card source corpus are unchanged.

## Exact deck readiness

**Can the exact Arasaka list initialize? No. Can the exact Merc list initialize? No. Can they play a complete deterministic match? No.** Both have 27 main cards, below the reviewed constructed minimum. Arasaka also lacks 9 distinct executable cards (16 copies); Mercs lacks 6 (14 copies), with the exact blockers in the table. No local complete demo-format rule capture was found: printing/deck metadata does not establish size, RAM/copy/setup/win-condition exceptions. The generic reference to a Gameplay Guide is not that guide. A separate source review remains necessary.

The next bounded review should address inherited Gear keywords, starting with Mandibular Upgrade's complete captured shape and equip permission. Keep Dying Night/Kiroshi effects, Go Solo/field Legends, Yorinobu's first-attack/trait cluster, steal-history and general replacement chains as separate reviewed work. Minotaur/Over the Edge can reuse semantic defeat only after full targeting/condition/cost review. No remaining card is admitted merely because a shared primitive exists.

See [combat-triggers-report.md](combat-triggers-report.md) for this milestone's source review, exact gates and limits. The [combat-restrictions report](combat-restrictions-report.md) records the preceding eleven-card baseline.
