# Saburo Arasaka — Stubborn Patriarch: continuous attacking aura

Implemented one complete reviewed card. All final quality gates pass. No commit or push.

## Runtime

Verified 2026-09-09 in the existing workspace. Node **v22.13.0**, npm **10.9.2**, Next.js **16.3.4**, application package version **0.3.0**. Engine identity is **0.4.0-attacking-aura-1**, artifact SHA-256 **874833c49ed68ce788f8e94943d7e631ee8deef6c766268b94efe208a749c12c**.

The starting point was the completed, uncommitted Yorinobu milestone, including Goro. Its actual roadmap was22 executable/29 distinct and46/60 copies. Before edits, file hashes, statuses, roadmap and **all23 original replay JSONs** were preserved in `/tmp/tcg-saburo-before/`. Comparisons in this report use that working-tree baseline, not HEAD. App HEAD remains `3bc5eb4`. No staging, commit or push occurred.

## Saburo exact full shape

**Saburo Arasaka — Stubborn Patriarch**, stable CardId `saburo-arasaka-stubborn-patriarch`, immutable application revision **1**; source UUID `cf50fa24-bf94-4c35-bcc1-c6d56a6f68d8`. Complete captured text:

> Friendly ARASAKA Units have +1 power while attacking.
> (Units steal an extra Gig for every 10 power.)

Printed **LEGEND**, **GREEN RAM2**, **sellable**, classifications exactly **Arasaka / Corpo**, **Null cost**, **Null power**. No Go Solo, raw keyword, markup ability, flavor text, trigger, activation, equip capability or additional executable clause. The second line is a steal-rule reminder, not another modifier.

All six printings are retained; the demo printing is **009**. The Epic retail/beta/demo variants use ADIA; the Nova Rare box-topper/event variants use Vincenzo Riccardi.

| UUID | Set | Number |
|---|---|---|
| 6ac7adce-01af-4b5b-956b-698eda0bed14 | embracingpowerretailstarterdeck | 013 |
| 54136fbd-ce97-4d23-a8e8-f876e3e64819 | embracingpowerbetastarterdeck | β013 |
| 13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca | arasakademodeck | 009 |
| 77e482f2-6090-47e9-9d03-be28417cb1cb | boxtoppersretail | 004 |
| 0cb4ae83-a7ca-4ca6-9c83-6c0581baae57 | boxtoppersbeta | β004 |
| 46387af0-342b-40c7-82fa-858d08ea473f | edgerunneropens1 | 047 |

[Full source and errata](../tests/fixtures/saburo-card-source.v1.json), [complete normalization](../tests/saburo-fixture.ts). The local raw-byte hash is `72d450459d340c1088b3713701d80bec7c289a98258aa491e0b946824af649b2`; canonical raw-record hash is `22930d73b2cf7d1ed2637d882c44f43cdf1f5fb7157708a030f4c3f88451bcc3`; normalized immutable revision hash is `d2e767a25172ebf2a8e3220131081a3114e112c2b999e5c6847ce5dba5b5f1d6`. These are implementation-reviewed fixtures, not human-certified gold.

## Rules/FAQ reviewed

Reviewed all four captured errata: Johnny's sellability, Kiroshi's equip text, and the Nocturne/Judy artist corrections. None applies to Saburo. Reviewed the complete raw card, all six printings, classifications, keywords/markup, metadata and all text. Narrow official checks matched gameplay fields and all printing identities without refreshing the harness corpus.

The [230-node rule fixture](../tests/fixtures/saburo-rules.v1.json) retains exact text and hashes. Key rules:1.7.2 controller;3.4.1 face-down effects;3.5–3.6 orientation;3.13.1 exact classification;4.2.1 field Legend effective types;4.3–4.5 Legend reveal/valid areas/Null field-cost constraints;5.7.2 Legend payment;9.3–9.5 declaration;9.7–9.9 React/Blocker;9.17 Fight comparison;9.23 current-power Steal;9.26–9.29 attack end/pending cleanup;10.4.3 and10.22–10.23 persistent effects and duration.

Official FAQ **18318e94-6979-4623-9cf5-fee73924d728**, published2026-09-04, confirms the bonus applies in both Fight and Steal. The pinned exact answer is **Yes.** Source eligibility is a combined application of the face, Legend-area and persistent-effect rules; the FAQ specifically resolves Fight/Steal rather than supplying a separate spent-source ruling.

| Reviewed source | SHA-256 |
|---|---|
| [Official Saburo response](https://api.netdeck.gg/api/cards/cyberpunk/saburo-arasaka-stubborn-patriarch) | `3a28a40a678febfc2a4e1dd5c17d6977db96874c51c4b99131bb016915cf4f9e` |
| [Official FAQ response](https://api.netdeck.gg/api/faqs/cyberpunk) | `b4240c9cd3b6af0fa6e00c3148fb0f9588ceae5482f4e181453bf2bc9fa14a48` |
| [Official comprehensive rules response](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) | `b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a` |
| Local raw rules | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Local processed rules | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Local raw errata | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Local processed errata | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

Live parsed comprehensive rules exactly equal the local raw JSON; serialization accounts for their different byte hashes. Signed image URLs do not define gameplay identity.

## Continuous aura architecture

Added narrow **ATTACKING_AURA_V1** execution scope/policy and strict continuous modifier `{kind:"FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount:1}`. Full-shape admission checks policy, reviewed status, exact metadata and the entire executable shape, including rejection of extra abilities/keywords/modifiers/restrictions.

The existing characteristic query derives `{sourceId, subjectId, kind, amount}` from current source, controller, classification, effective type and CombatState. `RulesView.getEffectivePower` sums it with the existing base/Gear/Royce/temporary contributions. Each input remains separate. No card ID/name dispatch, arbitrary predicates, aura DSL, new GameState field, PendingEffect, action or event was added. Aura-only tests prove it works without Yorinobu/history or later private-information card scopes.

## Source eligibility

The admitted active source is the controller's unique face-up Saburo in **LEGENDS**. READY and SPENT both qualify. Face-down and REMOVED do not. Inactive REMOVED is accepted for trusted future-source-departure checks; field/hand placements and unsupported source control changes are rejected.

Legend uniqueness uses existing constructed deckbuilding identity; malformed physical duplicates are also rejected. Rival Saburo independently supports that rival's attackers. No illegal stacking case was introduced.

## Face-down behavior

A qualifying attack with face-down Saburo has no +1. A trusted face change during an already active React window immediately changes power9→10, and hiding/removing the source immediately restores9. This checks live derivation without inventing an active-player reveal action during React. The headline reveals Saburo through actual CALL.

## Spent source behavior

Spent orientation does not suppress this persistent text. Rules3.5/3.6 distinguish orientation,5.7 permits Legend payment, and10.22 makes persistent effects continuous while their source is active. Saburo's text has no READY condition. The legal replay spends face-up Saburo for Mantis and later Go Solo payment; he remains SPENT/UP in LEGENDS while Goro attacks at10. A focused READY/SPENT comparison gives the same power.

## Friendly filtering

Friendly is the subject/source controller relationship and current controller's area, not owner alone. A trusted query-only owner change proves the implementation does not accidentally use ownership as the aura selector. No control-transfer action is admitted; current source validation preserves the supported ownership/control invariant.

## ARASAKA classification

Reuses the exact immutable `hasClassification(instanceId, "Arasaka")` query from Yorinobu. Capitalized display text does not change the stored canonical value; `ARASAKA`/`arasaka` are not aliases. No color, slug, card name, deck membership, affiliation or attached-Gear inference. Real Psycho Squad and Emergency Atlus attack without receiving the bonus. The existing trusted printed Arasaka Unit isolates this filter without creating a new synthetic revision.

## Effective Unit filtering

Uses the shared effective type query. Printed Units qualify when tagged; field Goro qualifies as both LEGEND and UNIT. Goro in LEGENDS is not a Unit and receives nothing. Saburo has Null power and no field-entry action; his own modifier is a source effect, not self power. Royce retains its existing per-Gear modifier and gets no Saburo contribution.

## Attacking-state boundary

`RulesView.isAttacking` derives from a canonical locked attack whose attackerId is the queried instance. The shared `isAttacking` helper requires a non-null `target`; NONE, pre-declaration target selection and non-executable legacy targetId vocabulary do not qualify.

After target lock, the existing atomic declaration spends the attacker and emits ATTACK_DECLARED. The aura is then live through ATTACK effects, trigger continuations, React, combat resolution, strategic steal/defeat choices and pending attack cleanup. Clearing CombatState ends it. The target, Blocker and other friendly Units are never marked attacking by this query.

## Target-selection boundary

Adding a valid spent rival target produces an actual ATTACK_TARGET_SELECTION pause. Goro is still READY, no ATTACK_DECLARED has occurred, `isAttacking` is false and power is9. Selecting the target performs the existing lock/spend/declaration sequence; power becomes10 and the attacker is SPENT. Legal queries themselves do not mutate state or add the bonus early.

## React lifetime

The bonus is visible during Yorinobu's pending discard and remains through RIVAL_REACT, Quick Program payment/resolution and subsequent choices. Floor It uses existing React priority and cannot be played during the unfinished Yorinobu continuation. Live source invalidation during React is tested separately with trusted state arrangements.

## Blocker interaction

A real rival field Goro can redirect the Gig attack using printed Blocker. The attacker stays at10; the new defender stays at7 even with its own Saburo face-up. Current target changes while attacker identity and its eligible source stay fixed. The ensuing authoritative Fight uses10 against7.

## Fight power

Focused actual Fight compares real Goro+Satori against rival Goro+Mantis. Without Saburo:9 versus9, tie, both Legends leave the field. With Saburo:10 versus9, attacker wins and survives, defender is removed, and Satori produces its truthful win draw. This changes the engine outcome, not only displayed power.

Power is queried at actual Fight resolution. Historical FIGHT_RESULT then remains the basis for later fight-win triggers/defeats; it is not recomputed as a display value after cleanup.

## Gig-steal power

Actual PASS_REACT enters Steal and queries current shared effective power. The headline emits GIG_STEAL_STARTED with **power10, allowance2, count2**, pauses for two strategic selections among three rival Gigs, transfers two, and returns MAIN. The matched face-down-source case emits **power9, allowance1, count1** and transfers only one.

No allowance is cached at declaration. The existing atomic Steal selection continuation captures its allowance at the actual Steal step; there is no newly admitted effect interleaving between those selections.

## Goro integration

The headline legally CALLs Saburo, Goro and Yorinobu using blind public Legend slots, equips Mantis to Goro while still in LEGENDS, pays Go Solo including Saburo, and moves the same Goro/attachment identities to the field. Real Goro is the canonical Arasaka effective Unit; all46 older pinned revisions are byte-preserved. No new synthetic revision was necessary.

## Goro + Mantis threshold

Goro's printed7 plus Mantis2 equals9 in LEGENDS and before declaration in FIELD. Saburo contributes one additional source-aware point only during attack: **7+2+1=10**. This crosses the unchanged steal formula's one-to-two allowance threshold. MAIN cleanup restores9 with Mantis still equipped. Bare Goro separately tests7→8.

## Yorinobu interaction

Yorinobu's source-independent historical first-attack counter and Saburo's current-state power query are independent. In the legal headline, first Goro declaration records history and resolves Yorinobu DRAW/conditional DISCARD while Saburo already contributes. No Saburo source appears in the pending trigger batch. A second same-turn qualifying attack still gets+1 although Yorinobu cannot trigger again.

## Satori interaction

Satori supplies its existing printed+2 Gear contribution once, and its inherited fight-win trigger uses the true10–9 result. The tie case does not trigger a win draw. After combat, surviving Goro+Satori returns to9. No attack-trigger approximation or double counting was added.

## Floor It interaction

A legal rival Quick play after Yorinobu resolves adds the existing stored−1. Current power becomes **7+2+1−1=9** and actual Steal allowance is1. After ATTACK_ENDED, Saburo's derived+1 disappears while Floor It's END_OF_TURN−1 remains, giving8. Existing reference/clamp policy is unchanged: raw contributions are summed before Fight/Steal reference rules; no new pre-addition clamp or negative-power rule was introduced.

## Multiple attacks

A focused validated trusted readiness arrangement allows another attack by the same Goro in the same turn. History advances1→2, Yorinobu has no new pending effect, Saburo still contributes+1, and cleanup again removes it. Advancing to the next global turn resets first-event history while the continuous-source logic remains independent. No new repeat-ready action was invented.

## Events

No new event kind. Existing LEGEND_CALLED, PAYMENT_MADE, GO_SOLO_ACTIVATED, ATTACKER_SPENT, ATTACK_DECLARED, RIVAL_REACT_OPENED, FIGHT_RESULT, GIG_STEAL_STARTED and ATTACK_ENDED supply the existing semantics. Saburo never emits POWER_MODIFIER_APPLIED, an expiration event or EFFECT_PENDING. Target/attacker invalidation reuses existing ATTACK_ENDED reasons and CombatState cleanup.

## Observation

Both players see10 in the existing public `effectivePower` field during ATTACK effects/React/Steal and9 again afterward. Public face-up Saburo and combat state supply the ordinary model context. No internal source-list plumbing, aura annotation, secret identity or new observation field is exposed.

## Training positions

The new replay contains44 actions and44 genuine strategic positions, each with more than one legal action. Positions arise from setup/payment/turn/trigger/React/Gig choices, never from the continuous bonus itself. Model input remains only observation plus enumerated legalActions; authoritative state, seed and opponent secrets remain excluded. Existing wire actionId submission and training validation cover the new positions. No model download/training or gold/evaluation changes.

## Hash behavior

Attack versus MAIN differs through CombatState; face-up versus face-down source differs through ordinary state, observation and derived power. POSITION_V2 needs no redundant aura record. Transport version/event counters alter replay hash but leave position and action IDs unchanged.

Aura-only policy enables the existing observation-based action-ID protocol, so unrelated rival secrets cannot change legal action IDs even without other private-information scopes. Hidden-hand permutation coverage proves this. Final Saburo replay-state hash: `56693fd10f71a75a3d2b2444e073ef74f34b999eba0fffebeca9c880db072e28`.

## Demo coverage

Recalculated from the actual unchanged29 reference rows:

| Metric | Before | After |
|---|---:|---:|
| Executable distinct /29 | 22 | 23 |
| Blocked distinct | 7 | 6 |
| Arasaka distinct /14 | 7 | 8 |
| Arasaka physical copies /30 | 16 | 17 |
| Merc distinct /15 | 15 | 15 |
| Merc physical copies /30 | 30 | 30 |
| Combined physical copies /60 | 46 | 47 |

Only Saburo's one physical copy changed status. Both source lists retain27 main+3 Legends; no quantities or source identities changed. [Updated roadmap](demo-deck-coverage-roadmap.md).

## Remaining Arasaka blockers

All six complete local source rows were inspected read-only. **6 distinct /13 copies** remain:

| Card | Copies | Remaining complete behavior |
|---|---:|---|
| Minotaur | 1 | PLAY own Street Cred > rival, then defeat a rival Unit with power≤5; conditional targeting and defeat resolution. |
| Industrial Assembly | 3 | Increase a Gig by up to4, then draw1 if a controlled Gig has value≥8; bounded adjustment plus current condition and exact ordering. |
| Over the Edge | 2 | Defeat **a Unit**, power≤friendly d20 value; ANY-Unit relationship, d20 semantics/filter and targeted defeat. Not rival-only. |
| Field Operator | 3 | PLAY draw1 if Street Cred is even; current parity and Null review. |
| Goro — Losing His Way | 1 | ATTACK all friendly Legends face-up condition, then own+5 this turn; printed Unit and temporary modifier. |
| Corporate Surveillance | 3 | Spend rival Unit with cost≤4; cost filtering, legal spending and Null review. |

Full metadata and refined blockers are in the roadmap. No implementation, publishing or new fixture revision for any of these rows.

## Merc status

Execution coverage stays **15/15 distinct and30/30 physical copies** within admitted scopes. Rebecca's promo observation does not justify adding a playable revision; no Rebecca admission was made. Merc's exact teaching deck still lacks an independently reviewed teaching-format policy. Reboot retains its pre-existing single-outstanding-prevention limitation.

## Demo-format readiness

Neither exact27-main+3-Legend teaching list initializes as constructed. There is no DEMO_STARTER policy, physical deck padding or full demo match. A separately sourced teaching-format review must establish all applicable setup/deckbuilding/win-condition exceptions before that changes.

## Constructed validation

Official constructed stays **40–50 main cards, exactly3 Legends**, existing RAM and copy limits, and deckbuilding-identity uniqueness. Tests reject27-main teaching shape, a fourth Mantis, duplicate Saburo, only2 Legends and an unsupported Blue RAM requirement under the real Red/Green Legend line-up.

The legal replay has42 main cards and exactly the three actual Saburo/Goro/Yorinobu Legends. Its main deck uses reviewed Red/Green cards plus eight pre-existing synthetic Gear filler revisions. It is explicitly a constructed test deck, not an altered physical teaching list.

## Replays

New family **saburo-replay**, seed **saburo-1**,44 actions/44 strategic positions/172 events, turn7 MAIN finish. Setup and every subsequent transition use actual enumerated engine actions. Public slots1/2/3 are selected without inspecting hidden identities; assertions after CALL enforce the frozen reviewed route. No state/RNG patch appears in the headline.

Sequence: setup → CALL Saburo → CALL Goro → Mantis equip in LEGENDS → CALL Yorinobu → Go Solo payment with spent face-up Saburo → declare Goro Gig attack → Yorinobu draw/discard → React/PASS → two strategic Gig selections → cleanup/power9.

All20 replay/golden generator scripts passed. There are now24 replay families/816 total decisions; existing families were regenerated only for current engine/content pins. Fight, source invalidation/reveal and the same-turn repeat are explicitly labeled focused trusted arrangements, not fabricated legal headline traces.

## Original payload compatibility

`node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-saburo-before/replays` passed against **23 untouched pre-milestone payloads /772 decisions**. It compares original initial/final states under updated manifest/engine pins, semantic legal actions and descriptors, observations and each event batch. This audit uses saved originals, not regenerated JSON as proof of compatibility. All previous Goro, Yorinobu, Dying, Delamain and other families retain behavior.

## Persistence

Live **MongoDB and PostgreSQL both passed (2/2, no skips)** using existing local infrastructure at127.0.0.1:27018 and127.0.0.1:5433. Tests use isolated temporary databases/schemas with cleanup.

Mongo publishes the full immutable Saburo revision, reads an exact match and treats re-publication as REPLAY. Existing concurrent/conflict/history/index/projection tests remain active.

PostgreSQL persists/reloads every step of the full44-action legal trace: initial DOWN source, CALL/reveal, pre-equipped Goro, payment/SPENT Saburo, Go Solo, attack effects, React, both strategic Steal pauses, cleanup and post-attack power9. Each reload compares exact state, replay/position hashes, both observations/hashes, legal actions and full accumulated events. It explicitly checks active power10/source identity and two steals. No schema migration, new column or stored aura target was needed.

## Python/wire

The sole harness change appends `"saburo-replay"` to the existing adapter-test family tuple. No Saburo, classification, aura, combat or legality logic moved into Python. Its Node adapter reproduced all24 families/816 actions, exact states/events/observations/hashes, plus7 golden round trips and existing invalid/stale-envelope checks.

Wire stays **v1**, with additive request content metadata for the new scope/policy/modifier. Relative to the saved Saburo baseline, only **request.v1.json** changes; response.v1.json, trainingPosition.v1.json and trainingAttempt.v1.json are byte-identical. GameState and observation shapes are unchanged.

The503 other harness file hashes are preserved. The291 pre-existing staged status entries are unchanged. Known legacy Python differential gaps `repeated-entry-copy-bypass` and `legend-in-main` remain documented; the authoritative Node boundary does not use those legacy checks as gameplay rules.

## Tests

Final application result: **644/644 pass**, including **60 Saburo-focused tests**, with no skips. The prior584 tests remain, including86 Yorinobu,45 Goro and47 V tests. Typecheck, lint (zero warnings), validate:cards, build, all20 generators, contract export, old-payload compatibility and live persistence pass. Python game tests **87/87**, harness core **48/48**, adapter24 families/816 actions plus7 goldens pass.

During implementation, the first focused check found a test context annotation and two test assumptions (Royce's actual slug and payment descriptors); these were corrected. One unused test import was removed. The first full suite ran before the new request schema export and reported643/644; exporting contracts and rerunning the entire suite produced644/644. No engine behavior was disabled to make these checks pass. No remaining lint/build warnings.

## Commands

Run in the application root unless marked harness, with:

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

| Exact command | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; zero warnings |
| `npm run validate:cards` | PASS;4 legacy fixture records |
| `npm test` | First pass643/644 before export; final rerun644/644 |
| `npm run build` | PASS; Next16.3.4 compiled/typechecked all routes |
| `npm run contracts:export` | PASS; request adds content metadata, other3 exports unchanged |
| `node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-saburo-before/replays` | PASS;23 original families/772 decisions |
| `git diff --check` | PASS |
| `npm test` (after contract export) | PASS;644/644, zero failures/skips |
| `node --import tsx --test tests/saburo.test.ts` | PASS;60/60 focused tests |
| `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration` | PASS;2/2 live tests, no skips |

All generator commands (each exit0):

```bash
node --import tsx scripts/generate-attack-ordered-effects-replay.ts
node --import tsx scripts/generate-combat-attack-replay.ts
node --import tsx scripts/generate-combat-resolution-replays.ts
node --import tsx scripts/generate-combat-restrictions-replays.ts
node --import tsx scripts/generate-combat-triggers-replays.ts
node --import tsx scripts/generate-delayed-effects-replay.ts
node --import tsx scripts/generate-end-turn-history-replay.ts
node --import tsx scripts/generate-field-legends-replay.ts
node --import tsx scripts/generate-gear-capabilities-replay.ts
node --import tsx scripts/generate-gear-replay.ts
node --import tsx scripts/generate-goro-replay.ts
node --import tsx scripts/generate-noncombat-replay.ts
node --import tsx scripts/generate-private-information-replay.ts
node --import tsx scripts/generate-react-replay.ts
node --import tsx scripts/generate-reviewed-replay.ts
node --import tsx scripts/generate-saburo-replay.ts
node --import tsx scripts/generate-setup-replay.ts
node --import tsx scripts/generate-turn-replay.ts
node --import tsx scripts/generate-wire-golden.ts
node --import tsx scripts/generate-yorinobu-replay.ts
```

In `tcg_ai_training/cyberpunk_llm`:

| Exact command | Result |
|---|---|
| `mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node` | PASS;24 families/816 actions,7 goldens, invalid/stale checks |
| `mlx_env/bin/python -B scripts/test_cyberpunk.py` | PASS;87 tests |
| `mlx_env/bin/python -B scripts/test_harness_core.py` | PASS;48 tests |

`npm run validate:cards` intentionally validates the existing **four legacy fixture records**; it is not an executable-engine coverage count. Saburo's reviewed test bundle pins47 immutable revisions including existing synthetic support. Generator/gate logs and exit-status records are retained under `/tmp/tcg-saburo-*`; `npm test`'s final green log is `/tmp/tcg-saburo-test-final.log`.

## Files changed

Incremental changes relative to the saved **completed Yorinobu working-tree baseline**: **9 new +38 modified application files**, no deletions; **one modified harness file**, no additions/deletions. Earlier uncommitted Goro/Yorinobu work is preserved. Report-generated counts exclude temporary `/tmp` tooling.

| Application file | Change |
|---|---|
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Measured23/29 and47/60 coverage; six read-only blockers and next-cluster comparison. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Complete Saburo source/printings/hashes, eligibility, behavior, replay and limits. |
| [docs/saburo-attacking-aura-report.md](../docs/saburo-attacking-aura-report.md) | This complete41-section source, architecture, behavior and verification report. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add ATTACKING_AURA_V1 execution scope. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Add one strict friendly Arasaka attacking Unit +1 continuous modifier. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add optional ATTACKING_AURA_V1 policy. |
| [packages/engine/src/attacking-aura-support.ts](../packages/engine/src/attacking-aura-support.ts) | Full-shape admission, hidden-source metadata checks, source area/control/uniqueness validation. |
| [packages/engine/src/characteristics.ts](../packages/engine/src/characteristics.ts) | Shared current attacking predicate and live source-aware power contribution. |
| [packages/engine/src/effect-support.ts](../packages/engine/src/effect-support.ts) | Route CALL support to complete aura admission. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Use existing observation-derived action IDs under isolated aura policy. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Validate aura metadata at initialization, including hidden Legends. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Reject unsupported/malformed aura sources in external states. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose isAttacking and admit the reviewed source modifier in keyword queries. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive content scope/policy/modifier schema. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Bump artifact version; content hash reflects finalized engine source. |
| [scripts/generate-saburo-replay.ts](../scripts/generate-saburo-replay.ts) | Generate one complete legal headline replay and positions. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/defeated-replay.v1.json](../tests/fixtures/defeated-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/delamain-replay.v1.json](../tests/fixtures/delamain-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/dying-night-replay.v1.json](../tests/fixtures/dying-night-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/evelyn-replay.v1.json](../tests/fixtures/evelyn-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/field-legends-replay.v1.json](../tests/fixtures/field-legends-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/first-blue-replay.v1.json](../tests/fixtures/first-blue-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/goro-replay.v1.json](../tests/fixtures/goro-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/kiroshi-replay.v1.json](../tests/fixtures/kiroshi-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/saburo-card-source.v1.json](../tests/fixtures/saburo-card-source.v1.json) | Pin complete raw source, six printings, all four errata and live-source comparison. |
| [tests/fixtures/saburo-replay.v1.json](../tests/fixtures/saburo-replay.v1.json) | New44-action/44-position/172-event legal replay. |
| [tests/fixtures/saburo-rules.v1.json](../tests/fixtures/saburo-rules.v1.json) | Pin230 exact rule nodes and focused official Fight/Steal FAQ with hashes. |
| [tests/fixtures/satori-replay.v1.json](../tests/fixtures/satori-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate existing wire goldens for current engine/content pins. |
| [tests/fixtures/yorinobu-replay.v1.json](../tests/fixtures/yorinobu-replay.v1.json) | Regenerate existing replay for current engine/content pins; original semantic payloads pass the23-family audit. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Immutable Mongo Saburo publish/read and full44-step PostgreSQL reload trace. |
| [tests/saburo-fixture.ts](../tests/saburo-fixture.ts) | One complete real immutable revision and constructed42-main/3-real-Legend input. |
| [tests/saburo-replay.ts](../tests/saburo-replay.ts) | Setup/CALL/equip/payment/Go Solo/attack/steal/cleanup recording without state patches. |
| [tests/saburo.test.ts](../tests/saburo.test.ts) | 60 focused source, behavior, isolation, strict validation and contract regressions. |

Harness: `cyberpunk_llm/scripts/test_engine_adapter.py` appends exactly one family string. All503 other baseline harness files retain their hashes; its291 pre-existing staged status entries are unchanged. All260 other application baseline files retain their hashes. No new dependencies, package-lock edits, migration or infrastructure change. Nothing staged, committed or pushed.

## Unsupported mechanics

Only Saburo is newly executable. Minotaur, Industrial Assembly, Over the Edge, Field Operator, Losing His Way, Corporate Surveillance, Faceplate, WHEN_SPENT, general aura/trait scripting, teaching format and full demo matches remain unsupported. Saburo has no Go Solo/ordinary field action, field-source admission, control-transfer or mid-attack reveal/removal action. Trusted tests exercise derived availability without adding those mechanics.

## Ambiguities not guessed

Rules4.4 describe Legend-valid areas generally, but no admitted action/effect can put this Null-cost Saburo into FIELD. Field-source states are rejected rather than claiming all hypothetical future field interactions are settled. A future legal entry/control/reveal effect requires its own complete source review; current eligibility is not snapshotted and can be extended then.

Spent-source eligibility follows the persistent-effect and orientation rules; the FAQ explicitly confirms Fight/Steal, not a separate readiness condition. No unsupported multi-Saburo stacking, control-transfer action, off-turn attack action or special teaching-format exception was inferred. Negative-power arithmetic/reference policy is unchanged; no new clamp rule or synthetic negative card was added.

## Recommended next milestone

**Industrial Assembly + Field Operator**:2 complete cards,6 physical copies. Their bounded work builds on current Gig adjustment and ordered condition/draw resolution. Review exact full shapes, printings/errata/FAQ, current-value timing and Street Cred parity/Null before adding the two narrow conditions and up-to4 adjustment.

Minotaur + Over the Edge also unlock2 cards but only3 copies and require a new targeted-defeat operation with distinct rival/any relationships, current-power/d20 filters and complete defeat continuation semantics. Corporate Surveillance shares target selection but adds cost-filtered spending, so it should not be folded into defeat merely for count. Losing His Way is a separate all-Legends/turn-modifier card. Keep every card fully reviewed and teaching-format legality separate.
