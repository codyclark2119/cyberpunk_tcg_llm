# Demo setup clarification follow-up

**Current implementation (September 10, 2026):** [DEMO_STARTER_V1 implementation report](demo-starter-report.md) admits only the fixed Arasaka/Merc pair, in either seat, using Comprehensive Rules setup order and literal opposed d20. This is the user's **application policy decision**. The publisher source conflict remains historically unresolved. Exact initialization is supported; overtime remains UNSUPPORTED and a full exact match is NOT YET VERIFIED. The review findings below retain their historical meaning.

## Runtime

Review date: September 9, 2026 (America/Chicago); captures use September 10 UTC timestamps. Application 0.3.0; Node v22.13.0, npm 10.9.2, Next.js 16.3.4. Engine stays **0.4.0-attack-condition-power-1**, artifact `ce50aa41d888d15c6f0c4a665de2c7d46c6d068209d936bf46d58aebbd19c78b`. No runtime behavior or contract changes, so no artifact bump.

Application HEAD `39e2fe62be95a65ce732a6ab9a180862b83095a2`; harness HEAD `542c3d13c8fdfb542de4e83128859e616cd51c81`. Existing uncommitted prior-review work and harness changes were frozen at `/tmp/tcg-demo-setup-before`; none was reset, staged or committed.

## Previous demo-review blocker

The [previous format review](demo-format-report.md) confirmed direct-play intent and the two exact 27-main/3-Legend products. It retained their manifests as REFERENCE_ONLY because setup instructions disagree: demo materials shuffle/randomize before selecting play order, while formal 7.4–7.9 selects the player first. The opposed-d20 versus general agreed-random-method question also remained unresolved.

This follow-up checks current official evidence rather than choosing a winner from document dates or titles. No card mechanic, overtime implementation or complete match is in scope.

## New sources reviewed

The [focused follow-up fixture](../tests/fixtures/demo-setup-review.v1.json) records **20 fresh official captures**, retrieval times, HTTP results, hashes, relevant locations and scoped findings. It references **22 existing pinned rule nodes by stable anchor and hash**, reusing the previous source fixture rather than duplicating its corpus.

The main PDF/HTML comparisons are all **byte-identical to the previous review**: Arasaka print-and-play, Merc print-and-play, Convention Demo Reminder, printable guide and HTML guide. Thus there is no relevant setup revision to interpret. The complete formal rules response is also identical: 713 nodes, updated September 1, 2026. Previous image-page inspection remains applicable because the bytes match.

| Source | Fresh retrieval (UTC) | Prior-byte comparison | Current SHA-256 |
|---|---|---|---|
| [arasaka.pdf](https://cyberpunktcg.com/docs/print-and-play-araska.pdf) | 2026-09-10T04:35:12.843670+00:00 | UNCHANGED | `4df4ef76929bcebe2188bdc3d6fcb8350776b949c3119a3cf587c1b5bde9a52e` |
| [mercs.pdf](https://cyberpunktcg.com/docs/print-and-play-mercs.pdf) | 2026-09-10T04:35:12.843995+00:00 | UNCHANGED | `47469c3ed21cca8c4c2f214ef12b28ba13720aaac90ad768528d7d2a8a70f8cb` |
| [guide.pdf](https://cyberpunktcg.com/docs/printable-gameplay-guide.pdf) | 2026-09-10T04:35:12.844074+00:00 | UNCHANGED | `d7b090d8f6b0ce71e5a180c578d9c2ac9a625cd242ce304fda7f7a624d596378` |
| [reminder.pdf](https://cyberpunktcg.com/docs/printable-reminder-sheet.pdf) | 2026-09-10T04:35:12.844133+00:00 | UNCHANGED | `a36c0ccaa4919da34b8ca1ad1d46c9510e62be0263c495623f36deb4abaa289d` |
| [guide.html](https://cyberpunktcg.com/gameplay-guide) | 2026-09-10T04:35:13.300547+00:00 | UNCHANGED | `2393ca089412ff38f0dc926594770a472abe225998ae8218380c02cbc681dcd9` |
| [rules.json](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) | 2026-09-10T04:35:13.314012+00:00 | UNCHANGED | `b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a` |
| [faqs.json](https://api.netdeck.gg/api/faqs/cyberpunk) | 2026-09-10T04:35:13.341048+00:00 | CHANGED | `3a482c2be10191762d946259e9c958fc0eb1a340615a01fac18f6f7c36ab49d1` |
| [comp-rules-published.html](https://cyberpunktcg.com/blog/comp-rules-published) | 2026-09-10T04:35:13.545525+00:00 | UNCHANGED | `2afa56dfa294c36a4efc623eb946b1472566472be8369e42a41f91f7b861b77f` |
| [ax-announcements.html](https://cyberpunktcg.com/blog/ax-announcements) | 2026-09-10T04:35:13.754749+00:00 | UNCHANGED | `2c67ccd3929d3ccd75d177200d3d5366b95673e0b15caaedd5cdf6bfba738b29` |
| [ax-preview.html](https://cyberpunktcg.com/blog/ax-preview) | 2026-09-10T04:35:13.840973+00:00 | UNCHANGED | `149f44f6693a54b30aa0431253db39307c0085b6814df649ccdc2c4d41611b09` |
| [blog.html](https://cyberpunktcg.com/blog?page=3) | 2026-09-10T04:35:13.898892+00:00 | UNCHANGED | `ab6ed4308afc276cf9d0da56af439cfb59e70eec184c37c8849a5fd01f7347b5` |
| [faq.html](https://cyberpunktcg.com/faq) | 2026-09-10T04:35:14.032028+00:00 | UNCHANGED | `fa5c7bcd65d7c950217b3e1cc3d0d06a00bd09aa102bc5a539b5142bd750b194` |
| [beta-event-guide.html](https://cyberpunktcg.com/beta-event-guide) | 2026-09-10T04:35:14.056078+00:00 | New comparison source | `a176b4f8cebfcd0b851d71fe8aa5fb34df9ca8cd6a82a0adc807690ef883127a` |
| [beta-rule-updates.html](https://cyberpunktcg.com/blog/beta-rule-updates) | 2026-09-10T04:35:14.081120+00:00 | New comparison source | `37c6db9ce40d02c3011d7f4f1689462739937500967b12ccf22ccc710b13faf8` |
| [rules.html](https://cyberpunktcg.com/comprehensive-rules) | 2026-09-10T04:35:14.250060+00:00 | New comparison source | `0c4cad5c46252e63829f6b4c607e451febc1fc461a996ab9fd3aa30d4a2e88fb` |
| [errata.html](https://cyberpunktcg.com/errata) | 2026-09-10T04:35:14.265985+00:00 | New comparison source | `5a90b75c355d2c090b2041d7f019721a240bcf291c734dbf1db50378a9306bdf` |
| [gameplay-videos-2.html](https://cyberpunktcg.com/blog/gameplay-videos-2) | 2026-09-10T04:37:05.102145+00:00 | New comparison source | `2123a880949c95c712e5f696c3c1be469f353319ec11215d12dbe2098a6e3961` |
| [gen-con-announcements.html](https://cyberpunktcg.com/blog/gen-con-announcements) | 2026-09-10T04:37:05.102440+00:00 | New comparison source | `287d874b67a4d3b5abd24f6beb48f4cf71b01471491d9b5ded3e6f2237686223` |
| [developer-insights-gig-dice.html](https://cyberpunktcg.com/blog/developer-insights-gig-dice) | 2026-09-10T04:37:05.102558+00:00 | New comparison source | `28f1209b66ed86df051fcae3ae92f0c09d8a589e57ab697a591d1423d8a836fc` |
| [errata-cms.json](https://api.netdeck.gg/api/cyberpunk/content/query) | 2026-09-10T04:37:05.102645+00:00 | New comparison source | `7daccd21432f93f70237b4a0844debc9671c1326d6979af73bf0d7862b67c5a9` |

FAQ response bytes differ, but recursive comparison finds exactly **245 `items[*].card.image_url` changes**. Every other field is identical, including all 270 question/answer records and the September 8 update timestamp. Canonical `{id,scope,question,answer}` hash is `43d093d28443132e1f14aa3d5e412d86d0e5672c657576d0dab0ca5f43432d21`. Setup/precedence/method terms match zero Q/A records. Image URL churn is not a rules change.

Sixteen narrowly targeted web queries are recorded in the fixture. The unchanged publisher blog response contains 31 article bodies; a targeted setup/precedence search supplied leads without fetching card records. Relevant additional reads include the Beta Event Guide, May 29 Alpha-to-Beta update, September 7 gameplay-video announcement, Gen Con announcement and Gig design article. The last two supply no setup clarification. The September 7 article advertises starter/custom-deck games, not a written demo ruling; linked gameplay videos were not reviewed or used as authority. The public card-errata CMS route was checked only for the scope of its precedence statement. No broad corpus refresh.

The absence finding is bounded to these accessible official sources; it does not assert that every possible publisher communication was exhausted. Raw captures are in `/tmp/tcg-demo-setup-sources`; durable hashes and concise findings are in the new fixture.

## Source hierarchy / precedence evidence

No applicable publisher statement was found resolving these two demo procedures. Four authority leads were considered separately:

| Lead | Explicit evidence and scope | Why it does not settle this demo conflict |
|---|---|---|
| Formal rules 1.1–1.3 | Comprehensive reference; English supersedes translations | No English demo-guide versus English formal-rules precedence clause |
| [Beta Event Guide](https://cyberpunktcg.com/beta-event-guide), “Learn the Cyberpunk TCG Game Rules” | Calls comprehensive rules a “Reference document that adjudicates every possible gameplay process and interaction.” It directs event disputes there. | Strong relevant guidance for its expressly sealed Beta Event scope, but no express extension to the June demo products or their differing ordered setup |
| [May 29 Beta update](https://cyberpunktcg.com/blog/beta-rule-updates), closing paragraphs | Makes the described Beta changes effective and recommends them for Alpha/print-and-play players | The described changes concern turn structure, CALL and victory, not the later competing setup sequences or method permission |
| [Card errata](https://cyberpunktcg.com/errata) and matching CMS intro | Updated card text supersedes printed text for listed cards | Its scope is card text/characteristics; it does not amend product setup instructions |

The [August 28 publication announcement](https://cyberpunktcg.com/blog/comp-rules-published) remains unchanged and distinguishes detailed reference from the introductory guide without an explicit document-conflict rule. Document title, later publication, product specificity and card-text precedence were not promoted into a general hierarchy. The newly examined leads have dates/hashes/locations in the fixture; their relevance is recorded without overstating their scope.

## Demo setup sequence decision

**UNRESOLVED.** The competing explicit orders remain:

| Stage | Demo panels/current guide | Formal 7.4–7.9 |
|---|---|---|
| First | Main shuffle and face-down Legend randomization | Randomly select player, who chooses FIRST/SECOND |
| Next | Opposed d20 determines chooser; FIRST/SECOND selection | Main shuffle/optional rival cuts, then Legend randomization/optional rival cuts |
| Thereafter | First player spends two leftmost Legends; six-card opening/mulligan | Spend first player's two leftmost randomized Legends; prepare Fixers; draw/mulligan |

The product panel is explicitly ordered; formal 7.4 explicitly orders 7.5–7.9. This is not merely a reminder omitting detail. No setup policy is selected. Both document groups still require randomization, so printed card order remains presentation-only.

## First-player method decision

**D — remains unresolved for the Demo Decks, independently of setup order.** The physical instructions say “Both players roll a d20 (reroll on a tie).” They instruct opposed rolls rather than labelling them a recommendation; the higher roller chooses who goes first. Formal 7.5.1 allows an agreed random-player method and presents opposed d20 as a recommendation; 7.5.2 gives the selected player FIRST/SECOND choice.

No source establishes whether the identified demo products inherit that broader permission. Knowing which step comes first would not by itself establish whether physical opposed rolls are mandatory, recommended or substitutable. We therefore do not select A, B or C as an authoritative demo method ruling.

## Physical opposed-d20 vs digital abstraction

Physical protocol: both players roll fair d20s, repeat on ties, and let the higher roller select FIRST/SECOND. Under independent uniform rolls, the 400 ordered outcomes contain 190 wins for each seat and 20 ties. Repeating ties gives each seat probability `190 / (400 − 20) = 1/2`.

This establishes **distributional equivalence of the winning seat** to one uniform binary selection. It does not establish the same RNG consumption, public roll history or publisher permission to substitute procedures. The reviewed setup text gives no later gameplay use to those roll values. That supports a conditional design candidate, not a ruling that a mandated physical ritual may be omitted.

If allowed, the existing seeded random-seat selection followed by FIRST/SECOND choice is the smallest candidate. It need not invent Gig objects or literal public roll events merely to represent that probability distribution. If literal rolls are required, ties consume an unbounded geometric number of roll pairs and their order/events would need explicit review. Neither representation is newly implemented here, and **no demo abstraction is admitted**. Current constructed `ENGINE_SETUP_V1` remains unchanged under its existing formal rule authority.

## Direct-play status

**DIRECT PLAY CONFIRMED.** Unchanged [June 26 AX preview](https://cyberpunktcg.com/blog/ax-preview) and [July 3 print-and-play announcement](https://cyberpunktcg.com/blog/ax-announcements) invite independent play of the updated products. This follow-up does not reopen that conclusion or confuse application non-admission with physical unplayability.

## Fixed-manifest status

**CONFIRMED; both remain REFERENCE_ONLY.** Reuse [ARASAKA_DEMO_V1 and MERC_DEMO_V1](../tests/fixtures/demo-reference-manifests.v1.json) unchanged, with stable CardId/revision/zone/quantity and separate printing provenance. Counts remain Arasaka 14 distinct/30 copies and Merc 15 distinct/30 copies; each is exactly 27 main/3 Legends, including three Psycho Squads. No synthetic filler or substitutions. The reference fixture's complete byte hash is pinned in the new review fixture.

## General 27-card construction status

**NOT ESTABLISHED.** Two published products plus direct-play intent justify only the existing narrow fixed-list candidate. No arbitrary small-deck construction rule, substitution permission, printing-based inference or auto-demo fallback is introduced.

## DEMO_STARTER_V1 policy decision

**DEMO_STARTER: NOT ADMITTED. DEMO_STARTER_V1: NOT ADMITTED.** Outcome C applies under request §§12,48,49,50: required setup precedence and first-player-method permission remain unresolved after targeted review.

| Question | Result |
|---|---|
| Direct play | CONFIRMED |
| General 27-card construction | NOT ESTABLISHED |
| Fixed demo manifests | CONFIRMED; REFERENCE_ONLY |
| Setup precedence | UNRESOLVED |
| First-player method | D — UNRESOLVED for demo products |
| DEMO_STARTER_V1 | NOT ADMITTED |
| Initialization | NOT RUN |
| Overtime | UNSUPPORTED |
| Full exact match | NOT YET VERIFIED |

| Layer | Before this follow-up | After |
|---|---|---|
| Direct play | Confirmed | Confirmed; source bytes rechecked |
| Fixed manifests | Exact/reference-only | Unchanged |
| Setup | Precedence and method unresolved | Same questions; additional scoped authority leads and byte/semantic comparisons documented |
| Format admission | Not admitted | Not admitted |
| Initialization | Not run | Not run |
| Overtime | Unsupported | Unsupported; no implementation |
| Full match | Not verified | Not verified; no gameplay generated |

## Format architecture

Not applicable: no admission. Domain format enum, default constructed validator, ruleset policies, setup, game state and engine artifact remain unchanged. The new fixture is source-review evidence only; it does not authorize runtime format selection or act as a second deck validator. `DEMO_STARTER`, `DEMO_STARTER_V1`, `DEMO_STARTER_V2` and unknown formats remain outside the accepted runtime enum.

## Exact Arasaka validation

Existing focused regression verifies 27 main/3 Legends and all 14 real supported revisions. Default and explicit constructed validation return only `MAIN_DECK_SIZE`; Green 4/Red 2 available versus Green 3/Red 2 required, copy counts and Legend identity comply. No DEMO_STARTER_V1 positive validation is claimed.

## Exact Merc validation

Existing focused regression verifies 27 main/3 Legends and all 15 real supported revisions, including Psycho Squad quantity 3. Default and explicit constructed validation return only `MAIN_DECK_SIZE`; Blue 4/Yellow 2 available versus Blue 3/Yellow 2 required, copy counts and Legend identity comply. No DEMO_STARTER_V1 positive validation is claimed.

## Constructed negatives

Both exact lists continue failing constructed, including public high-level initialization with missing format or explicit CONSTRUCTED. There is no size/printing-based fallback. Constructed remains 40–50 main, exactly three Legends, current copy/RAM/Name constraints and `ENGINE_SETUP_V1`. Existing 42-main/3-Legend support decks remain valid and initialize identically. The focused suite reruns these cases.

## Fixed-manifest mutation negatives

Runtime fixed-format mutations are not applicable because no demo policy is admitted. Existing reference tests prove quantity/card/revision/zone/Legend changes alter the composition hash while order and equivalent split entries do not. Constructed negatives cover split four-copy entries, wrong zones, wrong Legend counts, unknown CardIds and RAM failure. These remain reference/constructed tests, not fabricated demo acceptance tests. Unsupported format IDs and manifest/policy fields fail closed through the strict wire boundary.

## Setup implementation

Not applicable: no demo implementation. Read-only inspection confirms current `packages/engine/src/setup.ts` begins with random-seat determination and FIRST/SECOND choice, then shuffles main decks, offers each rival a cut, randomizes Legends and offers their cuts. After those choices it spends the first player's two leftmost Legends, prepares Fixers, draws six and offers first-player-first whole-hand mulligans. Existing cuts are actual player choices with cyclic rotation and SETUP_CUT events, not an assumed abstraction. Existing code/tests remain unchanged.

## Deterministic RNG/setup ordering

Not applicable to demo admission; no new order is selected or seeded demo state created. Existing constructed setup tests check semantic order, state, events and RNG progression. The first player is determined before any shuffle under current ENGINE_SETUP_V1. Same-distribution first-player selection is not used to claim same seed-to-state results after reordering shuffles.

## Initialization smoke test

**NOT RUN.** The prerequisite—sourced demo policy—is unsatisfied. Required existing constructed/negative initialization tests run, but there is no exact demo positive initialization, no new initialization replay family, no gameplay seed search and no complete demo game.

## Real-card-only content bundle

The existing [demoReferenceContext helper](../tests/demo-format-fixture.ts) is reused unchanged. It contains exactly the 29 actual reviewed reference revisions, no synthetic constructed support. All 60 physical copies resolve to SUPPORTED immutable revisions. The parent 53-revision bundle is preserved.

Real-only manifest hash: `3ff587118bac2acee9d669a25aff86db5c3fbc70c6d204e1623a8de97e4a75e5`.
Ruleset hash: `72f1e130e62c3d1efe9f77a49b8d0c00e61cc5fa2a608463f079a9e51a41b24c`.

Composition hashes remain Arasaka `7ef234191430bce642888161bcad4127c138faddb41c826a0f7b8b68fd90a386` and Merc `c0551a2293a54080e44cbf45afbd7daf96d9b8b33ef9b113037647004991c38e`. Existing Viktor printing-ID provenance debt is preserved and documented in the prior report; no immutable metadata repair.

## Observation / format visibility

Unchanged. There is no admitted demo state to expose. A future admitted format must flow through ordinary public match/ruleset observations and model input; research evidence hashes remain internal. No Python prompt or observation fields added.

## Hash behavior

Runtime ReplayStateHash, PositionHash, ObservationHash and engine identity remain unchanged. Reference manifests and the real-only content bundle retain their hashes. The new source-review fixture has its own file bytes/provenance but is not a runtime policy. Event-history or RNG differences are not normalized away to declare demo setup equivalent.

## Wire

Wire v1 and exported schemas remain unchanged. Missing format retains constructed meaning; existing strict schemas reject unsupported IDs/unknown fields. A supplemental read-only wire check explicitly verifies DEMO_STARTER, DEMO_STARTER_V1, DEMO_STARTER_V2 and an unknown format return INVALID_REQUEST. No permissive cast or Python-side format validator.

## Persistence

No runtime/persisted format or game state changes, so the conditional live Mongo/Postgres requirement does not apply. No database writes, card republishing, seeding or migration. This review makes no new live-persistence claim. Future admission must round-trip format/ruleset/state, hashes, observations and legal actions as requested.

## Python

Harness files and its pre-existing working tree/index remain unchanged. The three requested suites run against the existing authoritative Node worker. No legality code, model download, training, gold promotion, new TrainingAttempt or corpus refresh. Known Python duplicate-entry and Legend-in-main differences remain explicit in differential validation.

## Replay compatibility

All 29 original families/1042 decisions were frozen before this follow-up in `/tmp/tcg-demo-setup-before/replays`. Original-payload audit compares semantic legal actions/descriptors, both observations, event batches and initial/final states; all existing replay/golden generators also run. Regeneration alone is not claimed as compatibility evidence. No new demo replay family.

## Overtime status

**UNSUPPORTED, unchanged.** Previous source evidence establishes overtime as part of these demo rules. No setup ruling would remove that separate full-match boundary. No overtime implementation in this milestone. After successful format admission, the next execution milestone must be **CYBERPUNK TCG — OVERTIME EXECUTION**, before the first exact demo match.

## Match-readiness status

| Layer | Status |
|---|---|
| Reference card execution | COMPLETE within reviewed scopes: 29/29 distinct, 60/60 copies |
| Publisher direct-play intent | CONFIRMED |
| Application demo deck legality | NOT ADMITTED |
| Exact demo initialization | NOT RUN |
| Full exact match | NOT YET VERIFIED; overtime and existing interaction limits remain |

These layers are deliberately separate. No complete demo match is claimed.

## Tests

**All final required gates pass.** Full application: **1072 passed, 0 failed, 0 skipped**. Focused existing format/setup suites: **54 passed** (44 reference/format tests plus 10 setup tests). Typecheck, lint, four-record starter validation, build and contracts export pass. No warnings were observed. All 24 generators pass; all prior generated artifacts remain byte-identical. Original-payload compatibility preserves **29 families/1042 decisions**.

Python adapter: **29 families/1042 actions**, exact states/events/observations/hashes, 7 golden round trips, model input/submission/stale/envelope checks and 7 differential cases pass. Gameplay suite: **87 passed**. Harness core: **48 passed**. The two known Python legality differences remain explicit; no new Python rules were added.

Supplemental wire checks reject DEMO_STARTER, DEMO_STARTER_V1, DEMO_STARTER_V2 and unknown-format with INVALID_REQUEST. A read-only integrity audit verifies 20 captured source hashes, 22 referenced prior rule-node hashes, unchanged prior source/reference fixtures, the 270-record FAQ semantic comparison and the conditional 400-outcome d20 probability calculation. This mathematical check is not engine roll implementation or demo admission.

Preservation audit: all 53 immutable parent revisions, 29 frozen replays, reference manifest bytes, 29 roadmap rows, runtime/contracts/generated files and all 504 captured harness files remain unchanged. Both HEADs/indexes match baseline. The new report has all 34 requested headings; the prior report retains its 48 headings; local links and whitespace checks pass. Changes are documentation/source evidence only, so no additional repository unit tests were added and no live database gate was required.

## Commands

Application cwd: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`.

```sh
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

Each command below ran separately and exited 0. Ledger: `/tmp/tcg-demo-setup-gates.json`; logs `/tmp/tcg-demo-setup-gate-00.log` through `-33.log`.

| Exact command | Result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | Codegen and both TypeScript projects pass |
| `npm run lint` | PASS; no warnings |
| `npm run validate:cards` | 4 starter records valid |
| `npm test` | 1072 passed; 0 failed/skipped |
| `npm run build` | Compilation, TypeScript and all 6 pages pass |
| `npm run contracts:export` | PASS; exported bytes unchanged |
| `node --import tsx scripts/generate-attack-condition-power-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-attack-ordered-effects-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-combat-attack-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-combat-resolution-replays.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-combat-restrictions-replays.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-combat-triggers-replays.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-delayed-effects-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-end-turn-history-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-field-legends-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-gear-capabilities-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-gear-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-goro-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-noncombat-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-private-information-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-react-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-reviewed-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-saburo-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-setup-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-targeted-defeat-replays.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-targeted-spend-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-turn-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-value-conditions-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-wire-golden.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/generate-yorinobu-replay.ts` | PASS; prior generated bytes unchanged |
| `node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-demo-setup-before/replays` | PASS; 29 original families/1042 decisions preserved |
| `git diff --check` | PASS |

Additional application command:

```sh
node --import tsx --test tests/demo-format.test.ts tests/setup.test.ts
```

Exit 0, 54 passed; `/tmp/tcg-demo-setup-focused.log`.

Supplemental read-only wire check (same cwd/PATH; stdout recorded at `/tmp/tcg-demo-setup-wire-check.log`):

```sh
node --import tsx - <<'JS'
const assert = require('node:assert/strict');
const { handleRequest } = require('@tcg/wire');
const prior = require('./tests/fixtures/attack-condition-power-replay.v1.json');
for (const format of ['DEMO_STARTER', 'DEMO_STARTER_V1', 'DEMO_STARTER_V2', 'unknown-format']) {
 const response = handleRequest({ schemaVersion: 1, requestId: 'setup-followup', op: 'createGame', content: prior.content, initialization: { ...prior.initialization, format } });
 assert.equal(response.ok, false);
 assert.equal(response.errors[0].code, 'INVALID_REQUEST');
 console.log(format + ': INVALID_REQUEST');
}
JS
```

Exit 0, four explicit rejections. No game was admitted by this check.

Harness cwd: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```sh
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

All exited 0. Adapter: 29 families/1042 actions and 7 goldens plus differential/envelope checks; gameplay: 87; core: 48. Logs `/tmp/tcg-demo-setup-python-adapter.log`, `/tmp/tcg-demo-setup-python-game.log`, `/tmp/tcg-demo-setup-python-core.log`.

Read-only source capture and preservation commands:

```sh
python3 /tmp/tcg-demo-setup-fetch.py
python3 /tmp/tcg-demo-setup-fetch-extra.py
python3 /tmp/tcg-demo-setup-final-audit.py
```

All exited 0. Fetches wrote only to `/tmp/tcg-demo-setup-sources`: 20 official HTTP 200 responses, including one CMS POST with its exact body retained in the fixture. The final audit compares SHA-256 files against `/tmp/tcg-demo-setup-before/baseline.json`, `git rev-parse HEAD`, `git ls-files --stage`, unchanged harness status, prior replay bytes/revisions, source comparisons, required headings and local links. Result `/tmp/tcg-demo-setup-final-audit.json`.

`git diff --check` ran in both repositories; `git diff --no-index --check /dev/null <file>` also checks each of the two newly added files (difference exit 1, no whitespace diagnostics). No staging, commit, push, model download, corpus write, external message or live database operation.

## Files changed

Changes made by this follow-up only:

| File | Change |
|---|---|
| [tests/fixtures/demo-setup-review.v1.json](../tests/fixtures/demo-setup-review.v1.json) | New focused capture comparison, 22 references to prior rule nodes, scoped authority leads, independent setup/method decisions and unsent publisher questions |
| [docs/demo-setup-review-report.md](demo-setup-review-report.md) | New successor report with all 34 requested headings and before/after decision tables |
| [docs/demo-format-report.md](demo-format-report.md) | Link to this follow-up; previous 48-section report and results preserved |
| [docs/demo-deck-coverage-roadmap.md](demo-deck-coverage-roadmap.md) | Current follow-up result and next-step ordering; all 29 card rows/quantities preserved |

The seven earlier review files were already uncommitted at this milestone's start. They are not counted as newly created by this follow-up. No source code, tests, prior source fixture, reference manifest, harness file or runtime artifact is changed here. No staging, commit or push.

## Unsupported/unresolved rules

The exact outstanding publisher questions are:

> For the June 2026 Arasaka/Merc Print-and-Play Demo Decks, should setup follow the Demo Reminder's shuffle/randomize-before-play-order sequence, or Comprehensive Rules 7.4–7.9's determine-first-player-before-randomization sequence?

> For those products, is opposed d20 mandatory, or may the general agreed random-player method in 7.5 be used? If physical rolls are mandatory, is digital uniform winning-seat selection followed by FIRST/SECOND choice an acceptable equivalent when setup roll values have no later use?

These questions are documented only; **no message was sent**. Arbitrary 27-card construction remains unsourced. Overtime and existing bounded interaction limitations remain unsupported, independently of this source conflict.

## Ambiguities not guessed

No hierarchy inferred from timestamps, the word comprehensive, product-specific wording, an unrelated sealed-event dispute reference or card errata authority. No FAQ image URL change treated as amended rule text. No d20 instruction relabelled a recommendation. No winning-seat probability calculation treated as a publisher substitution ruling or identical RNG history. No missing cut/mulligan detail treated as a teaching ban. No default demo format, general 27-card legality or new win condition.

## Recommended next milestone

Obtain explicit publisher clarification of the two separate questions, or an official revised instruction that resolves them. Then admit only the two versioned fixed lists with explicit format identity and the sourced setup/method; reuse existing primitives wherever confirmed. Prove exact legality and one deterministic real-only initialization, then stop.

After successful admission, the next execution milestone is **CYBERPUNK TCG — OVERTIME EXECUTION**: two consecutive turns starting with empty Fixers, entry after end-turn effects, immediate seven-Gig victory, TURN_END/TURN_START behavior, deterministic replay, persistence, observations and hashes. Only after that should the **FIRST EXACT ARASAKA VS MERC DEMO MATCH** be built. No unsolicited publisher contact or follow-on execution was performed.
