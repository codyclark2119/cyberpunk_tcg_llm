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
| Satori — Sword of Saburo | Arasaka | 3 | Yes; demo 005 | No executable revision | Unreviewed | No | Inherited fight-win trigger |
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | No executable revision | Unreviewed | No | Increase Gig up to 4 and conditional draw review |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | No executable revision | Unreviewed | No | D20 value target filter and defeat |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete cannot-attack + Blocker shape supported; independent Blocker legality |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; no executable text omitted |
| Field Operator | Arasaka | 3 | Yes; demo 012 | No executable revision | Unreviewed | No | Even Street Cred condition on play |
| Goro Takemura — Losing His Way | Arasaka | 1 | Yes; demo 013 | No executable revision | Unreviewed | No | All Legends revealed condition, +5 turn modifier on attack |
| Corporate Surveillance | Arasaka | 3 | Yes; demo 014 | No executable revision | Unreviewed | No | Cost-filtered rival Unit spending |
| V — Corporate Exile | Mercs | 1 | Yes; demo 008 | No executable revision | Unreviewed | No | Go Solo/field Legend admission |
| Viktor Vektor — Sit Down and Relax | Mercs | 1 | Yes; demo 001 | Yes; application revision 1 | NONCOMBAT_SLICE_V1 / reviewed CALL (MAIN + React) | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Jackie Welles — Pour One Out For Me | Mercs | 1 | Yes; demo 007 | No executable revision | Unreviewed | No | First Blue play per turn, optional Gig decrease/minimum draw |
| Dying Night — V's Pistol | Mercs | 2 | Yes; demo 013 | No executable revision | Unreviewed | No | Inherited attack effect, named-host end-turn Eddie ready |
| Dexter DeShawn — One Last Chance | Mercs | 1 | Yes; demo 002 | No executable revision | Unreviewed | No | Multiple trigger types, defeat, Street Cred difference |
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

## Measured coverage after combat restrictions

| Metric | Before | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 6 | 11 |
| Without reviewed executable revisions | 23 | 18 |
| Remaining cards with identified subsystem/admission blockers | 23 | 18 |
| Arasaka supported distinct cards / 14 | 2 | 4 |
| Arasaka executable physical copies / 30 | 5 | 11 |
| Mercs supported distinct cards / 15 | 4 | 7 |
| Mercs executable physical copies / 30 | 8 | 14 |
| Both decks executable physical copies / 60 | 13 | 25 |

Counts are calculated from the 29 rows above. “Unreviewed” and “blocked” overlap: the same 18 remaining cards lack an executable revision and have a known blocker recorded; these are not disjoint populations. Copy coverage is not distinct-card coverage or deck readiness. Reboot coverage is scoped to one outstanding effect, so its two physical copies are individually executable but their overlapping use is not yet supported.

Corpo Security, MT0D12 Flathead, Reboot Optics, Psycho Squad and Emergency Atlus are the only new real-card admissions. Source text, all printing UUIDs, raw/canonical/normalized hashes and pinned errata are recorded in [combat-restrictions-card-sources.v1.json](../tests/fixtures/combat-restrictions-card-sources.v1.json), [combat-restrictions-fixture.ts](../tests/combat-restrictions-fixture.ts) and [executable-card-coverage.md](executable-card-coverage.md). The earlier six revisions are unchanged. The raw sources remain `cyberpunk_llm/data/raw/cards/<CardId>.json`; the 151-card corpus was not refreshed.

## Exact deck readiness

**Can the exact Arasaka list initialize? No. Can the exact Merc list initialize? No. Can they play a complete deterministic match? No.** Both have 27 main cards, below the reviewed constructed minimum. Arasaka also lacks 10 distinct executable cards (19 copies); Mercs lacks 8 (16 copies), with the exact blockers in the table. No local complete demo-format rule capture was found: printing/deck metadata does not establish size, RAM/copy/setup/win-condition exceptions. The generic reference to a Gameplay Guide is not that guide. A separate source review remains necessary.

The next mechanic cluster should be fight-result/Defeated triggers and their timing/ordering, including Satori and the relevant Dexter/Jackie behavior. Keep inherited Gear keywords (Mandibular Upgrade), Go Solo/field Legends, steal-history effects and more general replacement chains as separate reviewed work. Minotaur/Over the Edge can reuse semantic defeat only after full targeting/condition/cost review. No remaining card is admitted merely because a shared primitive exists.

See [combat-restrictions-report.md](combat-restrictions-report.md) for the implementation, exact gates and ambiguities. [combat-resolution-report.md](combat-resolution-report.md) records the preceding milestone; its six-card coverage is historical.
