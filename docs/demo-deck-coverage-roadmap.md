# First demo match: execution coverage roadmap

These are the user-supplied physical reference lists, preserved exactly: **27 main cards + 3 Legends = 30 total per deck**. Merc Psycho Squad is **3 copies**. This document does not create a runnable demo match or change constructed deck validation (40–50 main cards in the current synthetic fixture policy). A future demo format needs its own source review.

“Normalized?” below means a reviewed executable application revision, not the harness's display/text normalization. All 29 distinct cards have local raw captures and demo printing metadata; only six have executable application revisions within these two lists. Application CardIds are stable slugs, never demo collector numbers. The current replay bundles are implementation-reviewed synthetic support decks, not human-certified gold data.

| Card | Deck | Copies | Captured? | Normalized? | Execution scope | Supported now? | Blocking subsystem |
|---|---|---:|---|---|---|---|---|
| Goro Takemura — Hands Unclean | Arasaka | 1 | Yes; demo 008 | No executable revision | Unreviewed | No | Go Solo/field Legend admission; printed Blocker on Legend |
| Yorinobu Arasaka — Embracing Destruction | Arasaka | 1 | Yes; demo 001 | No executable revision | Unreviewed | No | First attack per turn, trait trigger, discard |
| Saburo Arasaka — Stubborn Patriarch | Arasaka | 1 | Yes; demo 009 | No executable revision | Unreviewed | No | Friendly trait aura while attacking |
| Minotaur | Arasaka | 1 | Yes; demo 002 | No executable revision | Unreviewed | No | Street Cred comparison and targeted defeat |
| Swordwise Huscle | Arasaka | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_ATTACK_V1 | Scoped only | Fight/defeat/Gig stealing remain unimplemented |
| Mantis Blades | Arasaka | 3 | Yes; demo 004 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 + REVIEWED_GEAR_V1 | Scoped only | Supported captured function; full match still requires combat and remaining deck mechanics |
| Satori — Sword of Saburo | Arasaka | 3 | Yes; demo 005 | No executable revision | Unreviewed | No | Inherited fight-win trigger |
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | No executable revision | Unreviewed | No | Increase Gig up to 4 and conditional draw review |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | No executable revision | Unreviewed | No | D20 value target filter and defeat |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | No executable revision | Unreviewed | No | Cannot-attack restriction plus separate Blocker shape review |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | No executable revision | Unreviewed | No | Vanilla Unit shape review/admission; fight |
| Field Operator | Arasaka | 3 | Yes; demo 012 | No executable revision | Unreviewed | No | Even Street Cred condition on play |
| Goro Takemura — Losing His Way | Arasaka | 1 | Yes; demo 013 | No executable revision | Unreviewed | No | All Legends revealed condition, +5 turn modifier on attack |
| Corporate Surveillance | Arasaka | 3 | Yes; demo 014 | No executable revision | Unreviewed | No | Cost-filtered rival Unit spending |
| V — Corporate Exile | Mercs | 1 | Yes; demo 008 | No executable revision | Unreviewed | No | Go Solo/field Legend admission |
| Viktor Vektor — Sit Down and Relax | Mercs | 1 | Yes; demo 001 | Yes; application revision 1 | NONCOMBAT_SLICE_V1 / reviewed CALL (MAIN + React) | Scoped only | Supported captured function; full match still requires combat and remaining deck mechanics |
| Jackie Welles — Pour One Out For Me | Mercs | 1 | Yes; demo 007 | No executable revision | Unreviewed | No | First Blue play per turn, optional Gig decrease/minimum draw |
| Dying Night — V's Pistol | Mercs | 2 | Yes; demo 013 | No executable revision | Unreviewed | No | Inherited attack effect, named-host end-turn Eddie ready |
| Dexter DeShawn — One Last Chance | Mercs | 1 | Yes; demo 002 | No executable revision | Unreviewed | No | Multiple trigger types, defeat, Street Cred difference |
| Secondhand Bombus | Mercs | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Fight/defeat/Gig stealing remain unimplemented |
| Kiroshi Optics | Mercs | 3 | Yes; demo 004 | No executable revision | Unreviewed | No | Inherited attack/private Legend look; erratum review |
| Mandibular Upgrade | Mercs | 2 | Yes; demo 005 | No executable revision | Unreviewed | No | Inherited Blocker keyword/equip permission |
| Afterparty at Lizzie's | Mercs | 2 | Yes; demo 006 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 | Scoped only | Supported captured function; full match still requires combat and remaining deck mechanics |
| Delamain Cab | Mercs | 3 | Yes; demo 009 | No executable revision | Unreviewed | No | Steal history and end-turn Eddie ready |
| Evelyn Parker — Scheming Siren | Mercs | 3 | Yes; demo 010 | No executable revision | Unreviewed | No | Ordered attack draw/conditional discard |
| MT0D12 Flathead | Mercs | 1 | Yes; demo 011 | No executable revision | Unreviewed | No | Conditional cannot-be-blocked restriction |
| Psycho Squad | Mercs | 3 | Yes; demo 012 | No executable revision | Unreviewed | No | Vanilla Unit shape review/admission; fight |
| Floor It | Mercs | 3 | Yes; demo 014 | Yes; application revision 1 | COMBAT_REACT_V1 | Scoped only | Supported captured function; full match still requires combat and remaining deck mechanics |
| Reboot Optics | Mercs | 2 | Yes; demo 015 | No executable revision | Unreviewed | No | Next-fight replacement/prevention and turn expiration |

Floor It and Secondhand Bombus were selected for this milestone because their entire captured text fits the bounded React implementation. Reboot Optics requires next-fight prevention, which cannot be certified before combat resolution. Corpo Security adds a cannot-attack restriction; Mandibular Upgrade adds inherited Gear keywords. Their shared words do not automatically grant execution support.

Raw sources: `cyberpunk_llm/data/raw/cards/<CardId>.json`. New reviewed snapshots and printing UUIDs: [react-card-sources.v1.json](../tests/fixtures/react-card-sources.v1.json). Current per-card certification: [executable-card-coverage.md](executable-card-coverage.md).
