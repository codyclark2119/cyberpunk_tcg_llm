# First demo match: execution coverage roadmap

These are the user-supplied physical reference lists, preserved exactly: **27 main cards + 3 Legends = 30 total per deck**. Merc Psycho Squad is **3 copies**. Official constructed remains **40–50 main cards**. No starter padding, format exception, DEMO_STARTER policy or runnable demo match is introduced.

All **29 distinct cards** have local raw captures and demo printing metadata. “Executable revision” means an implementation-reviewed application revision, distinct from the harness's display/text normalization. CardIds are stable slugs, never demo collector numbers. Replays use constructed-size synthetic support decks and are not human-certified gold data.

| Card | Deck | Copies | Captured? | Executable revision | Execution scope | Supported now? | Remaining blocker(s) / scope |
|---|---|---:|---|---|---|---|---|
| Goro Takemura — Hands Unclean | Arasaka | 1 | Yes; demo 008 | Yes; application revision 1 | FIELD_LEGENDS_V1 | Scoped only | Complete Green RAM2 cost5 power7 Go Solo + printed Blocker; shared ordinary/Go Solo entry, pre-equipped Gear, effective Legend+Unit, attack/Blocker/fight/owner Trash order and Legend removal |
| Yorinobu Arasaka — Embracing Destruction | Arasaka | 1 | Yes; demo 001 | Yes; application revision 1 | FIRST_ATTACK_HISTORY_V1 | Scoped only | Complete face-up LEGENDS effect; source-independent first friendly Arasaka effective Unit attack per global turn; draw1 then current Street Cred <20 chosen discard1, including Null; no field entry |
| Saburo Arasaka — Stubborn Patriarch | Arasaka | 1 | Yes; demo 009 | Yes; application revision 1 | ATTACKING_AURA_V1 | Scoped only | Complete face-up LEGENDS source aura; friendly exact Arasaka effective Unit +1 only during declared attack, through Fight/Steal; spent source stays active, Null cost/power, no field entry |
| Minotaur | Arasaka | 1 | Yes; demo 002 | Yes; application revision 1 | TARGETED_DEFEAT_V1 | Scoped only | Complete cost7/power9 unsellable Red RAM2 Unit; PLAY current Null-aware own Street Cred > rival, mandatory rival effective Unit reference power≤5, shared semantic defeat/Gear/owner order/DEFEATED |
| Swordwise Huscle | Arasaka | 2 | Yes; demo 003 | Yes; application revision 1 | COMBAT_ATTACK_V1 | Scoped only | Generic fight/defeat/Gig stealing now supported under COMBAT_RESOLUTION_V1; remaining demo mechanics and demo-format review |
| Mantis Blades | Arasaka | 3 | Yes; demo 004 | Yes; application revision 1 | NONCOMBAT_PLAY_V1 + REVIEWED_GEAR_V1 | Scoped only | Supported captured function; full demo match still requires remaining deck mechanics and separate demo-format review |
| Satori — Sword of Saburo | Arasaka | 3 | Yes; demo 005 | Yes; application revision 1 | COMBAT_TRIGGERS_V1 | Scoped only | Complete printed Gear +2 inheritance and inherited fight-win draw; independent copies and controller ordering |
| Industrial Assembly | Arasaka | 3 | Yes; demo 006 | Yes; application revision 1 | VALUE_CONDITIONS_V1 | Scoped only | Complete Red RAM1 cost1 sellable Program: any Gig increase0–4 within die bounds, then current any-controlled-Gig≥8 draw1; ordered, including zero/no target |
| Over the Edge | Arasaka | 2 | Yes; demo 007 | Yes; application revision 1 | TARGETED_DEFEAT_V1 | Scoped only | Complete cost3/Null-power sellable Red RAM2 Program; ANY effective Unit including own with reference power≤a current controlled rolled D20, shared semantic defeat; no D20 means no targets, play remains legal |
| Corpo Security | Arasaka | 3 | Yes; demo 010 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete cannot-attack + Blocker shape supported; independent Blocker legality |
| Emergency Atlus | Arasaka | 3 | Yes; demo 011 | Yes; application revision 1 | COMBAT_RESTRICTIONS_V1 | Scoped only | Complete ordinary Unit shape supported; no executable text omitted |
| Field Operator | Arasaka | 3 | Yes; demo 012 | Yes; application revision 1 | VALUE_CONDITIONS_V1 | Scoped only | Complete Green RAM2 cost3 power2 unsellable Arasaka/Corpo/Techie Unit: ordinary payment/READY+Lag, PLAY current even Street Cred draw1; Null false |
| Goro Takemura — Losing His Way | Arasaka | 1 | Yes; demo 013 | No executable revision | Unreviewed | No | All Legends revealed condition, +5 turn modifier on attack |
| Corporate Surveillance | Arasaka | 3 | Yes; demo 014 | Yes; application revision 1 | TARGETED_SPEND_V1 | Scoped only | Complete Green RAM1 cost2 sellable Corpo Program; mandatory rival effective Unit cost≤4 selection, including already-SPENT per FAQ; semantic effect spend preserves target/Gear/Lag, no defeat or movement, normal Program Trash |
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

## Measured coverage after Corporate Surveillance

| Metric | Before this milestone | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable distinct cards, within stated scopes | 27 | 28 |
| Without reviewed executable revisions | 2 | 1 |
| Arasaka supported distinct cards / 14 | 12 | 13 |
| Arasaka executable physical copies / 30 | 26 | 29 |
| Mercs supported distinct cards / 15 | 15 | 15 |
| Mercs executable physical copies / 30 | 30 | 30 |
| Both decks executable physical copies / 60 | 56 | 59 |

Calculated from the same 29 rows frozen before editing. Corporate Surveillance contributes three physical copies. Every reference quantity is unchanged. All 51 prior immutable content revisions remain unchanged; exactly one complete real revision is added, for 52 in the targeted-spend test bundle. Query-only unsupported synthetic costs do not enter that bundle or these counts. Reboot retains its one-outstanding-next-fight-prevention limit.

Corporate Surveillance uses current rival control, public effective Unit typing and the reviewed cost characteristic. Numeric cost≤4 qualifies. Payment changes do not alter cost value; Gear cost and power are irrelevant. Generic Null is not zero, while the explicit Legend Null-reference exception in3.11.2.3 is preserved without allowing Null-cost field play. Real field Goro and V are effective Units but cost5 excludes them.

The card-specific FAQ permits both play with no target and choosing an already-SPENT Unit. Zero targets resolves as much as possible, one is forced internally, and multiple create a mandatory source-controller choice. READY becomes SPENT; already-SPENT selection produces no second spend fact. The Unit stays in place with its Gear, modifiers and Lag. No defeat, target movement, owner ordering or DEFEATED trigger occurs. The Program enters Trash after its own effect and MAIN resumes.

The legal 44-action headline reaches real rival Dexter and Swordwise on turn7, spends equipped Dexter, retains Mandibular Upgrade and leaves Swordwise READY. All setup, rolls, sells, payments and plays use enumerated actions without state/RNG patches. The 79 focused tests also compare Minotaur defeat, test cost boundaries, real field-Legend exclusions, Lag/Blocker/readiness, strict continuations, stale IDs, privacy, hashes and wire. See [targeted-spend-report.md](targeted-spend-report.md). Previous Minotaur/Over the Edge behavior remains covered by the original-payload audit and [targeted-defeat report](targeted-defeat-report.md).

## Exact deck readiness

**Merc card execution coverage: COMPLETE (15/15 distinct, 30/30 physical copies).**

**Merc exact demo initialization: still NO; teaching-format policy requires a separate review.**

Neither exact 27-main +3-Legend reference list passes constructed's unchanged 40–50-main +exactly3-Legends requirement. Copy and RAM rules are unchanged. Arasaka additionally lacks one executable card (one physical copy). No DEMO_STARTER policy, padded physical teaching list or complete demo match is introduced.

## Remaining Arasaka review and next milestone

After implementing Corporate Surveillance, the complete local Losing His Way record, all three printings, and all four captured raw/processed errata were reviewed read-only. No applicable captured erratum exists. This blocker review does not admit the card or replace its separate focused rules/FAQ review.

| Card | Copies | Complete executable behavior still blocked |
|---|---:|---|
| Goro Takemura — Losing His Way | 1 | Green RAM3 Unit, cost4/power4, unsellable, Arasaka/Corpo; three Uncommon Ilya Kuvshinov printings. Exact text: “{Attack} If all friendly Legends are face-up, this Unit has +5 power this turn.” Needs resolution-time all-friendly-Legends condition, exact treatment of field Legends/hidden Legends/absence, and self +5 with current-turn duration, stacking and expiry. This is a printed Unit, not another field-Legend admission. |

Source UUID **08e6a687-56b7-4ac1-982f-8a8d6d0c0bc5**; raw SHA-256 **579743b07f78c80d9b7e664006767e686f462a390994a2345a7fb39d1fbb973c**. Printings: retail starter017 **42e03e7a-923d-4f2b-8d79-191e69873947**; beta starterβ017 **fb45ca8c-cb8a-4de9-8cf4-04a697c3fdfd**; Arasaka Demo013 **384b716d-fe9c-4a09-86b3-fe9b25928c51**. No additional keyword, flavor or executable clause was omitted from the blocker review.

**Recommended next milestone: Goro Takemura — Losing His Way**, as a separate all-friendly-Legends-face-up +self +5 until end of current turn ATTACK admission. Review its complete source and exact condition/timing before reusing the existing ATTACK and temporary-modifier systems. Do not implement Faceplate, WHEN_SPENT or an arbitrary condition/filter language as part of that card.

Corporate's five-printing source and all four errata are pinned in [targeted-spend-card-source.v1.json](../tests/fixtures/targeted-spend-card-source.v1.json). The [rules fixture](../tests/fixtures/targeted-spend-rules.v1.json) pins206 rule nodes and8 complete FAQ records. Narrow live card/printing checks agree with local data; parsed live rules equal the local snapshot. No broad corpus refresh occurred. Earlier milestone reports retain their historical baselines.

Only after card execution reaches29/29 distinct and60/60 copies should a separate DEMO_STARTER format review establish 27-card main-deck legality, three Legends, copy/RAM rules, setup, win conditions and every teaching exception. Exact Arasaka-vs-Merc deterministic teaching play comes after that evidence and policy work. Physical27+3 lists are unchanged. Faceplate/WHEN_SPENT, a general spending-path refactor, control-transfer actions, arbitrary filter DSLs and a complete teaching match remain outside this pass.
