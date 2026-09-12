# Reboot Optics multiplicity source review

**REBOOT MULTIPLICITY: SOURCE BLOCKED.** Reviewed September 10, 2026. No unique overlap consumption rule was located in current published sources. Runtime semantics, the guard, all prior payloads and the stopped matrix remain intact. The publisher question below is prepared but has not been sent.

## Runtime

Node **v22.13.0**, npm **10.9.2**, application **0.3.0**, Next.js **16.3.4**. Engine **0.4.0-overtime-1**, artifact `d79422b2512215c41bddbf17945ee061c660a5b04a845ea000b7dce6fdcd877d`. Ruleset `beta@demo-overtime-1`, hash `0cf3dcd40766cd4b699e16842a0b6a66d3b1ecdf9b678986bf7686139dc800ab`; exact content manifest `108d71feb46f427987016bd4935ab2dd563581861eee13c11a155ee9409cb6f2`.

No identity bump: there is no runtime, card, ruleset, wire or Python change. `reboot-optics@1` remains complete, with revision hash `dbc84769ae27e11b67d34f83ed7d1be60b96d794289f65544b624265b86e1243`. Its `COMBAT_RESTRICTIONS_V1 / SUPPORTED` metadata describes the reviewed primitive; it does not encode a single-outstanding card restriction. Reference execution remains **29/29 distinct cards, 60/60 copies**. This count does not certify every interaction.

## Exact overlap reproductions

The [focused prefix fixture](../tests/fixtures/reboot-multiplicity-reproducers.v1.json) preserves the original initialization, each submitted action/actionId, legal-action and both-observation hashes, events, state/position hashes and final boundary for all three coordinates. It derives from the original traces, before any behavior change. These are legal prefixes ending at an unsupported interaction, not completed games or new promoted wire replay families.

| Coordinate (FIRST; keep/keep) | Turn | Submitted actions | Outstanding source | Second physical source | ReplayStateHash at stop |
| --- | --- | --- | --- | --- | --- |
| demo-matrix-003 / A | 12 | 206 | `p1-c28` | `p1-c29` | `8d0927024c3768263541ecf3431df0b608f1369e7b02346a9e70b9b1cdfed696` |
| demo-matrix-003 / B | 5 | 51 | `p0-c29` | `p0-c28` | `f9e200fab525e2078a00913c10170f5e650913ea707ee38ef7c8d615d475191d` |
| demo-matrix-004 / A | 9 | 144 | `p1-c28` | `p1-c29` | `d04279a84466b0bf20b3cf2bd32dff1eabf9926510078a0e62699432c2b267ff` |

A seats Arasaka/Merc; B seats Merc/Arasaka. At each boundary the Merc actor has an affordable second Reboot in hand, the original prevention remains outstanding, the state validates, and `listLegalActions` omits that play. Direct submission returns `UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS` without mutation. The diagnostic still throws `REACHABLE_UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS` before an alternate policy action can proceed. Regression checks replay only these **401 already-submitted actions**; they do not cross the boundary or expand the matrix. Every initialization still has exactly two Reboot copies, without deck, RNG, hand, state or policy patches.

## Current single-copy behavior

The [single-copy tests](../tests/combat-restrictions.test.ts) and [combat-trigger tests](../tests/combat-triggers.test.ts) preserve the following behavior:

- Normal Quick play/payment resolves the Program, registers one public independent prevention and moves the Program to Trash. MAIN play is also supported.
- The next qualifying **fight** consumes it. Attack declaration, React opening and a Gig steal with no Blocker/fight do not. A Blocker-created fight uses its actual participants.
- Qualification uses the stored effect controller. A friendly attacker fighting a rival defender qualifies too: a rival Unit is fighting in that encounter. The existing offensive-protection regression is preserved; this is not an attacker-only trigger.
- The friendly Unit cannot be defeated by its opposing rival Unit's fight result. Actual power, winners and losers stay truthful; opponent defeat on a positive tie still happens. Prevented defeat produces no false `CARD_DEFEATED`/movement and therefore no DEFEATED binding for that Unit. Satori's real fight-win draw still resolves before prevention.
- Consumption occurs even when the friendly Unit already wins, or a reviewed 0–0 fight produces no defeat. The implementation does **not** wait for the next attempted defeat. A subsequent same-turn fight is unprotected.
- An unused effect expires at end-turn cleanup. Its source leaving the resolving area/Trash does not cancel it; the controller is captured at creation.

These are existing bounded semantics, not newly discovered overlap rulings. Fight resolution filters defeat instructions before defeat movement and DEFEATED trigger collection. An otherwise malformed fight without a valid opposing friendly participant is rejected by the normal combat/state invariants; no new semantics are invented for it. Field Legends participate only through the existing reviewed Unit treatment.

## Sources reviewed

The [successor source fixture](../tests/fixtures/reboot-multiplicity-source-review.v1.json) records exact URLs, publisher attribution, UTC retrieval times, HTTP results, raw byte hashes, normalized comparisons, 55 relevant rule nodes, three focused FAQ records and all five printing reviews. The [historical review](../tests/fixtures/demo-matrix-reboot-review.v1.json) remains byte-for-byte intact.

The authoritative entry points are the Weird Co. [official card page](https://cyberpunktcg.com/cards/reboot-optics), [Comprehensive Rules](https://cyberpunktcg.com/comprehensive-rules), [Rules FAQ](https://cyberpunktcg.com/rules-faq) and [errata](https://cyberpunktcg.com/errata). Their published data are served through Netdeck; the card page identifies that integration. Rules/FAQ HTML are SPA shells, so their full current JSON feeds were read instead of treating empty HTML extraction as absent rules.

| Fresh payload | Publisher/feed date | Retrieved UTC on 2026-09-10 | Raw SHA-256 | Result |
| --- | --- | --- | --- | --- |
| [Card JSON](https://api.netdeck.gg/api/cards/cyberpunk/reboot-optics) | No content update field; printing modification dates are separately recorded | 14:51:45 | `902cc2bdc1909cc745d6e119084604653d030da8f025cb42bd9d0d89e402f5a4` | Complete normalized record equals local source |
| [Rules JSON](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) | 2026-09-01T19:28:10.028Z | 14:50:53 | `b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a` | All 713 parsed nodes and envelope equal pinned local capture |
| [FAQ JSON](https://api.netdeck.gg/api/faqs/cyberpunk) | 2026-09-08T20:55:01.135Z | 14:50:53 | `a053078e5e26b4e8e1cbcb5945f2905fd861588d9f81fd971542fd5605b79a04` | 270 entries; normalized payload equals preceding matrix capture |
| Errata CMS read query, linked from official page | Markdown block 2026-09-07T06:54:35.485Z | 14:56:41 | `7daccd21432f93f70237b4a0844debc9671c1326d6979af73bf0d7862b67c5a9` | Complete parsed response equals local capture; four entries, none for Reboot |

Raw source files in the harness are untouched: card SHA-256 `5e75a4492e9c5375c7dd24bfa5de6dbe9046d0ed50bacbf93a3525466362c9b9`; rules `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`; errata `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75`. Serialization and expiring signed image URLs explain differing retrieval byte hashes; normalization removes only signing query strings, preserving other fields and array order. Raw captures/images are retained locally under `/tmp/tcg-reboot-multiplicity-sources`; only focused evidence is added to the application, not a corpus refresh.

The complete card is a **Blue Program / Quickhack**, **Quick**, cost **2 Eddies**, **Blue RAM 2**, with the **Sell** icon, null printed power and no additional effect paragraph. The local rules text supplied for this review is:

> {Quick} The next time a rival Unit fights this turn, it doesn't defeat the opposing friendly Unit.

The raw keyword array is empty, but the text's Quick marker is correctly normalized as `QUICK`. All printings are Common, illustrated by Miguel Valderrama. All five official images were retrieved and visually inspected: Welcome to Night City retail **136**, beta **β136**; The Heist retail **020**, beta **β020**; Merc Demo **015**. Each has the same complete ability and characteristics. Their UUIDs and individual image hashes are pinned in the successor fixture. Initial unsigned image requests returned 403; all five retries using the card API's current signed URLs succeeded. No printing introduces a second-copy restriction or overlap ruling.

The complete errata record concerns Johnny Silverhand's Beta Iconic sell tag, Kiroshi Optics' equip reminder, Nocturne's artist credit and Judy Álvarez's artist credit. None changes Reboot. The one Reboot FAQ (`e18d31dd-7ee1-4494-8098-a72db45bfa2d`) preserves losing the fight despite prevented defeat. The prevented-DEFEATED FAQ (`d05760ef-d02e-4be9-9cda-aee7a2fe196f`) denies that trigger. The simultaneous ATTACK FAQ (`3bfca564-d31f-46c6-b15c-88c7e6f31f5e`) permits ordering pending ATTACK effects. All three have publication time 2026-09-04T22:57:19.946Z. None answers overlapping Reboot consumption.

Search covered the requested Reboot/two/multiple/next-time/prevention/replacement-order/redundancy phrases on publisher-controlled pages and the full current rule/FAQ payloads. Other simultaneous examples were card-specific Gig/trigger rulings, not Reboot rulings. No specific overlap answer was located. Two unqualified searches produced unrelated Cyberpunk 2077 and optics results, which were discarded. This conclusion is bounded to public indexed pages and published feeds; no private publisher/Discord answer was obtained or inferred.

## Replacement/prevention rules reviewed

The complete effects chapter was read alongside the fight and cleanup rules. The focused fixture preserves exact local rule text and stable anchors; the current rules response is structurally identical to that local source.

| Provisions | What they establish | What they do not establish for this case |
| --- | --- | --- |
| 9.19–9.19.3 | Resolve fight-triggered effects before fight results; loss normally causes defeat; zero power cannot defeat; prevention preserves loss | Whether two future fight preventions both exhaust at that first fight |
| 10.1–10.6, 10.10 | Follow text; apply conditions and resolve valid portions as far as possible | Whether ignoring a redundant portion leaves a next-time duration alive |
| 10.11–10.17 | Pending effects resolve in controller-selected order; active player's batch first; simultaneous triggers all become pending | That Reboot's already-established future clause is a new pending trigger at fight time |
| 10.21 | An activated effect's resolution survives its source leaving its area | A classification or multiplicity rule for the continuing Reboot effect; this citation alone cannot establish either |
| 10.22–10.23.1 | Persistent effects apply continuously without entering pending; duration limits apply | A general procedure to consume multiple independently created one-shot preventions |
| 10.24–10.27 | Replacements substitute an action/process; replaced process does not happen; optional and impossible replacements have defined handling | Whether the process here is the fight, its defeat result, or a future fight-scoped prohibition |
| 10.28–10.28.2 | Mandatory before optional; affected player/card controller selects among applicable replacements | Permission to expose a Reboot choice before establishing that classification and affected process |
| 10.29–10.29.1 | Recheck remaining replacement applicability; same replacement cannot apply twice to the same process | Whether an unapplied next-time effect persists to a later fight after this fight occurred |
| 10.30–10.33 | Game-mechanic replacements have priority; choices follow their instructions | A new Reboot-specific choice actor or consumption rule |
| 8.16.2 | Remove effects lasting this turn at cleanup | Which effects remain after a qualifying fight earlier in that turn |

“Would/instead” are described as common replacement wording, not mandatory syntax. Their absence on Reboot does not prove that it cannot involve replacement. Conversely, describing all prevention as replacement without an explicit bridge is insufficient. Pending-effect ordering and replacement selection are distinct procedures; neither can be transferred automatically to Reboot.

## Models considered

These are conditional engineering branches, **not implemented rules**. They are not equally supported: the literal fight-based reading favors A, but this task requires a uniquely established written result.

| Model | Possible basis | Missing authoritative fact | Implementation branch after a ruling |
| --- | --- | --- | --- |
| A: both consume | Each independent effect points to the same first rival fight; consistent with single-copy consumption even when protection is unnecessary | Whether all matching future occurrences exhaust together and whether ordering is relevant | Snapshot every qualifying occurrence; consume each once, filter actual defeats, leave zero matching occurrences; later fight unprotected; no new choice unless explicitly required |
| B: one remains | Replacement/recheck could render the second prevention inapplicable | Whether the unused occurrence keeps its duration despite the first fight occurring, and which occurrence is used | Apply the source-defined selection procedure; retain only the unapplied occurrence with its original expiry; next same-turn fight or cleanup consumes/expires it |
| C: player orders | 10.28.1/10.29 for replacements or 10.12/10.13 for pending effects, if that classification is established | Classification, affected process, actor and unselected occurrence lifetime | Add only the specifically required continuation/choice and its actor; recheck as ruled; C still needs A/B-style lifetime clarification |
| D: another rule | No such source was located | Exact publisher wording | Reassess narrowly against the new source before designing anything |

B cannot silently redefine single-copy Reboot as “next attempted defeat.” Creation-order FIFO, arbitrary array order, simultaneous consumption, or a new strategic choice are not interchangeable implementation conveniences. A publisher answer also needs to settle redundant protection when the friendly Unit survives anyway. Existing single-copy behavior remains the regression contract unless a new ruling expressly corrects it in a separately acknowledged change.

Future acceptance must branch on the actual ruling: both real Merc copies register distinct occurrences, same unchanged prefix admits the second play, next qualifying fight leaves exactly the ruled remainder, a later fight behaves accordingly, and each still-unused occurrence expires at cleanup. Include ordinary loss, positive tie, reviewed 0–0, friendly win, no-fight Gig steal, Blocker fight, source movement, and actual DEFEATED suppression. For B/C, test both first-fight-then-expiry and two distinct same-turn fights. Do not invent a third copy, mirror deck, repeat-ready action or new content to obtain an edge case.

## Why rules do not uniquely select one

There are two separate missing links. First, the published rules do not explicitly classify Reboot's future clause and identify the game process it modifies for overlap ordering. Second, even if one assumes defeat replacement, the replacement recheck rules do not say whether a redundant, unapplied next-time occurrence expires because the first fight has occurred or remains available for a later fight.

Thus invoking 10.28.1 alone can propose who would choose **if** the effects are applicable replacements, but cannot establish how many remain. Invoking 10.16.2 alone assumes these future modifications become pending triggered effects. Invoking the literal next-fight text supports consuming both but does not remove the competing applicability/lifetime interpretation from the rules as written. The existing engine's singleton limit is a capability guard, not a publisher ruling. Three occurrences in nine attempted games establish reachability and importance only.

## Exact unresolved question

At the first qualifying rival Unit fight after two resolved Reboots, **how many independent occurrences remain after the fight, and which rule determines their consumption and any selection actor?** The important distinction is occurrence of the fight versus useful prevention of an attempted defeat. A choice or an applicability recheck does not, by itself, determine that lifetime.

## Engine guard retained

The limitation is distributed. Removing only `canPlay` would admit states the rest of the engine rejects or resolves with singleton assumptions.

| Layer / important file | Current representation or guard | Required audit if support becomes sourced |
| --- | --- | --- |
| Content: `tests/combat-restrictions-fixture.ts`, `packages/engine/src/restriction-support.ts` | Generic `CREATE_NEXT_RIVAL_FIGHT_PREVENTION`; no card-name/count branch; immutable ability `next-rival-fight-prevention@1` | Retain revision 1 and complete-source admission; expand only engine capability policy if needed |
| Domain: `packages/domain/src/game.ts` | `fightPreventions` is already an optional array of full records. Each retains `id`, physical `sourceId`, `controllerId`, creation turn and end-turn expiry. `defeatContinuation.appliedPrevention` is singular | Audit both active occurrences and retained consumed proof; an array schema alone does not confer runtime multiplicity |
| Play: `packages/engine/src/play-support.ts`, `packages/engine/src/index.ts` | `canPlay` excludes a prevention Program while one is outstanding; direct play fails explicitly | Update enumeration and submission together only after resolution and validation support |
| Creation/validation: `packages/engine/src/fight-prevention.ts` | Creation rejects an existing record. Validation requires exactly one if present, rejects empty/multiple arrays and outstanding plus another prevention play continuation | Unique physical occurrences, no double registration, valid source revision/controller/turn/policy, no consumed or expired survivors, no source-zone dependency |
| Applicability/consumption: same file | Perspective-based fight qualification; `effects[0]` relies on singleton validation; consumption deletes the active collection | Apply the ruled matching/consumption procedure, preserving unmatched occurrences and truthful fight result |
| Combat continuation: `packages/engine/src/combat-resolution.ts`, `combat-outcome-state.ts`, `targeted-defeat-state.ts` | Singular consumed proof reconstructs filtered tie defeats during owner ordering; applied proof cannot coexist with active effects | Broaden only the proof/lifetime combinations the ruling requires, without weakening validation |
| Expiry: `fight-prevention.ts` and end-turn cleanup | Iterates records and emits a per-source expiry event before deletion | Preserve independent occurrence provenance; do not combine with Dying Night scheduled end-turn work |
| Public interface: `packages/engine/src/observation.ts`, hashes, exported wire schemas | Public occurrence projection is already an array; position/observation identities include it | Ensure zero/one/two differ for both viewers; preserve only order that affects future semantics, no hidden information |
| Matrix: `tests/demo-match-replay.ts` | Explicit affordable-suppressed-play detector fails the run before the chooser bypasses the gap | Replace with positive supported validation only after all three original boundaries cross under unchanged ranking |

Current occurrence identity hashes protocol `next-rival-fight-prevention@1`, physical source, controller seat and turn. Two physical copies can have different identities without a new card revision. Reusing the **same** source/controller/turn for a later physical replay would reuse that identity; a future implementation must audit whether an occurrence ordinal is needed and distinguish repeated completed plays from duplicate registration of one play. No such replay action is invented here. Current storage records creation turn, not an independent creation ordinal. Canonical arrays are order-sensitive, so any future ordering decision must distinguish semantic order from irrelevant history before changing PositionHash.

A future selected branch must retain independent public occurrence provenance and per-occurrence consumed/expired facts, preserve the existing generic event vocabulary where possible, and include fight participants in consumption evidence. No LIFO stack, generic replacement language, Reboot-specific count flag, Python rules or training decision for automatic work is justified. A new TrainingPosition is appropriate only for a sourced choice. No descriptor contract V2 work is included.

After a ruling: pin exact source/date/wording/hash in another successor; freeze and audit old payloads **before regeneration**; implement the narrow branch with the three unchanged prefix acceptances; verify every promoted step through Postgres and generic Node/Python wire traversal; update engine identity only for behavior changes. Then rerun the original schedule from 000, advance to 64 only after crossing the three former boundaries, and attempt 128 variants only after all 64 complete. Do not change policy priorities or select new seeds based on outcomes.

## Matrix remains paused

The historical matrix remains **9 attempted, 6 supported terminals, 3 overlapping-Reboot boundaries**, with **0 engine deadlocks, 0 policy deadlocks and 0 defensive caps**. Canonical matrix hash stays `fa8b1bc2e2a624dac52d3e4af8f5587ca17f6acd8c06cf0931f069abed57fe1f`. **55 base games and 128 full-game variants remain unattempted.** The existing 16 setup-only checks are not full variant games.

`exact-demo-match-0` still ends at global turn 14 with Arasaka's normal win, 244 actions, 195 positions and 975 events. It contains no Reboot play. The completed 000/A single-Reboot game and standalone prevention replay retain their original payloads and compatibility results. All 36 pre-milestone replay families / 2,182 actions were copied before work; no replay regeneration was performed.

The original matrix, overlap prefix, position review and duplicate-label regressions remain intact. Descriptor evidence still records **285 positions with duplicate public `(kind,label)` descriptors** including strategically different visible attackers. This remains a separate informed-agent-interface blocker.

## Tests/checks

Commands below ran from the application root with the pinned Node directory prepended to PATH. Logs are under `/tmp/tcg-reboot-multiplicity-*.log`.

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v
node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-reboot-multiplicity-before/replays
node --import tsx --test tests/reboot-multiplicity-review.test.ts tests/combat-restrictions.test.ts tests/combat-triggers.test.ts
npm run typecheck
npm run lint
npm run validate:cards
npm test
git diff --check
```

| Check | Result this milestone |
| --- | --- |
| Node / npm | v22.13.0 / 10.9.2 |
| Frozen original compatibility | PASS: 36 families / 2,182 original actions; semantic legal actions/descriptors, actor observations, events and final states preserved. This audit also exercises the old Demo setup under the current supported policy. No pins changed in this milestone. |
| Focused source, restrictions and trigger tests | PASS: 62 tests, including all 401 actions of the three boundary prefixes; both observations, exact legal actions/actionIds, unchanged public policy selection, events, replay/position hashes and retained atomic rejection |
| Typecheck | PASS after correcting the new test's plain string physical ID through `CardInstanceIdSchema.parse`; initial TS7053 is retained in the initial log. No cast or `any` introduced. |
| Lint | PASS, no warnings; rerun after the typed-ID correction |
| Card validation | PASS: 4 catalog fixture records; separate from the exact 29-card execution bundle |
| Full test suite | PASS: **1,168 tests**, 0 failed/skipped/cancelled |
| Whitespace check | PASS in application and harness |
| Baseline/source audit | PASS: only the seven listed application files changed; all 36 original replay files match their frozen bytes; all 504 baseline harness files and raw card/rules/errata captures unchanged; both HEADs and Git indexes unchanged |

The fresh read-only retrievals used `python3 /tmp/tcg-reboot-fetch.py` and `python3 /tmp/tcg-reboot-finish-fetch.py`, with the intervening card/FAQ-route fetch recorded in `retrievals.json`; the complete request URLs/method and payload hashes are in the successor fixture. `python3 /tmp/tcg-reboot-prepare-evidence.py` prepared the focused successor and copied original prefix projections into temporary files before authorized installation. `python3 /tmp/tcg-reboot-multiplicity-audit.py` verifies source captures, changed-file scope, frozen bytes and Git metadata.

No `test:matrix` or matrix/position-review generation was run. The full unit suite includes the existing 16 setup-only preference checks; it does not continue full matrix games. Build, contract/replay/golden regeneration, live Mongo/Postgres integration and Python suites were not rerun: the request makes those expansion gates conditional on a runtime change, and no runtime, wire, payload-family or harness change occurred. Earlier integration/Python results remain historical evidence, not new claims for this milestone.

## Files changed

Only these seven application files belong to this milestone; earlier dirty work remains intact:

| File | Change |
| --- | --- |
| `docs/reboot-multiplicity-report.md` | This 14-section source-blocked decision analysis, architecture audit, conditional implementation plan and unsent publisher question |
| `tests/fixtures/reboot-multiplicity-source-review.v1.json` | Successor focused source/printing/FAQ/rule review with retrieval hashes and unchanged historical identities |
| `tests/fixtures/reboot-multiplicity-reproducers.v1.json` | Compact frozen initializations and 401 original actions with per-step golden hashes for the three exact boundaries |
| `tests/reboot-multiplicity-review.test.ts` | Source preservation and all-three-prefix regression checks; stops at retained guard |
| `docs/demo-match-matrix-report.md` | Adds successor status/link; preserves historical findings |
| `docs/executable-card-coverage.md` | Adds source-blocked overlap status/link without changing the roster |
| `docs/combat-restrictions-report.md` | Adds successor link identifying single-copy scope and unchanged overlap guard |

No application runtime, package/lockfile, schema, contract, existing fixture, generator, policy or harness file changed. No infrastructure publication, staging, commit, push, training, model download or gold promotion.

## Self-play readiness

**Unattended exact Demo self-play: NO.** The rules environment remains blocked by a reachable, unsourced overlap interaction. The informed agent interface separately remains blocked by descriptor ambiguity. Existing legal Demo initialization, overtime and six observed terminals do not establish unattended readiness.

The next action is to obtain the publisher's overlap ruling, then follow the conditional implementation and unchanged-matrix acceptance sequence above. If the rules matrix later passes, public legal-action descriptor contract V2 remains its own milestone. A self-play data pipeline begins only after both rules and informed-choice boundaries pass.

## Publisher clarification wording

Prepared only; **not sent**:

> If two Reboot Optics have resolved in the same turn before any rival Unit fights, what happens on the next qualifying fight? Are both effects consumed by that same fight, or does one remain for a later fight? If only one applies, who determines which effect is used?
