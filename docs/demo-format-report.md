# Demo product format review

**Current implementation (September 10, 2026):** [DEMO_STARTER_V1 implementation report](demo-starter-report.md) admits only the fixed Arasaka/Merc pair, in either seat, using Comprehensive Rules setup order and literal opposed d20. This is the user's **application policy decision**. The publisher source conflict remains historically unresolved. Exact initialization is supported; overtime remains UNSUPPORTED and a full exact match is NOT YET VERIFIED. The review findings below retain their historical meaning.

## Runtime

Reviewed September 9, 2026 (America/Chicago); live retrievals crossed into September 10 UTC. Application 0.3.0; Node v22.13.0, npm 10.9.2, Next.js 16.3.4. Required PATH: `/Users/codyclark/.nvm/versions/node/v22.13.0/bin` first.

Engine remains **0.4.0-attack-condition-power-1**, artifact `ce50aa41d888d15c6f0c4a665de2c7d46c6d068209d936bf46d58aebbd19c78b`. This review introduces no behavior, schema or card revision change. Baseline app HEAD `39e2fe62be95a65ce732a6ab9a180862b83095a2`; harness HEAD `542c3d13c8fdfb542de4e83128859e616cd51c81`.

## Starting execution coverage

Reference execution was already complete: **29/29 distinct, 60/60 physical copies**. Arasaka 14/14 distinct and 30/30 copies; Merc 15/15 and 30/30. All 53 prior immutable bundle revisions remain unchanged. No card mechanic was added or reopened. Individual execution scopes do not certify every possible interaction or a complete match.

## Physical demo manifests

The [reference fixture](../tests/fixtures/demo-reference-manifests.v1.json) pins `ARASAKA_DEMO_V1` and `MERC_DEMO_V1`, both **REFERENCE_ONLY**. Each row includes stable CardId, revision, quantity, MAIN/LEGENDS, immutable revision hash, expected official printing UUID, current application printing ID, set/collector, local raw capture path/hash and canonical source-record hash.

All eight PDF pages were visually inspected. Each product has 9+9+9+3 card slots plus four reminder panels on page 4. The per-slot audit is separate from the aggregated manifest; both are cross-checked by tests. User quantities and all 29 roadmap rows agree, including **three Psycho Squad**. This is a visual source audit, not OCR or human-certified gold.

Arasaka main: `1+2+3+3+3+2+3+3+3+1+3 = 27`; Merc main: `2+1+2+3+2+2+3+3+1+3+3+2 = 27`. Each adds three Legends. No filler or card substitution.

| Manifest | CardId (revision 1) | Zone | Copies | Demo collector | Official printing UUID |
|---|---|---|---:|---|---|
| ARASAKA_DEMO_V1 | `goro-takemura-hands-unclean` | LEGENDS | 1 | 008 | `fd889659-8291-41fd-9197-9cdf7cbf6810` |
| ARASAKA_DEMO_V1 | `yorinobu-arasaka-embracing-destruction` | LEGENDS | 1 | 001 | `aaad5db8-fcd4-42f0-8ced-e7527dbccf79` |
| ARASAKA_DEMO_V1 | `saburo-arasaka-stubborn-patriarch` | LEGENDS | 1 | 009 | `13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca` |
| ARASAKA_DEMO_V1 | `minotaur` | MAIN | 1 | 002 | `6e023192-0834-4d6f-935a-e5d6d4d6eff0` |
| ARASAKA_DEMO_V1 | `swordwise-huscle` | MAIN | 2 | 003 | `39ef1f5d-50e0-405c-bd25-6961fd93d2a1` |
| ARASAKA_DEMO_V1 | `mantis-blades` | MAIN | 3 | 004 | `4ad21be4-1406-4631-bfe7-ad2effde7af2` |
| ARASAKA_DEMO_V1 | `satori-sword-of-saburo` | MAIN | 3 | 005 | `3b656cec-684d-440b-9c76-0aa9a4a98b81` |
| ARASAKA_DEMO_V1 | `industrial-assembly` | MAIN | 3 | 006 | `7f0ad31f-3b16-4c7a-88bb-90dd07e55a9b` |
| ARASAKA_DEMO_V1 | `over-the-edge` | MAIN | 2 | 007 | `cf48d5e6-21d2-4d17-a731-5dc9091c6cd1` |
| ARASAKA_DEMO_V1 | `corpo-security` | MAIN | 3 | 010 | `c165a5eb-3338-4a80-8fb9-b7e39b412e5b` |
| ARASAKA_DEMO_V1 | `emergency-atlus` | MAIN | 3 | 011 | `45dd3b11-7bd8-4239-a404-ab0c9b24fcdb` |
| ARASAKA_DEMO_V1 | `field-operator` | MAIN | 3 | 012 | `45ae40b9-f0f3-4fd9-901a-cd1bed292133` |
| ARASAKA_DEMO_V1 | `goro-takemura-losing-his-way` | MAIN | 1 | 013 | `384b716d-fe9c-4a09-86b3-fe9b25928c51` |
| ARASAKA_DEMO_V1 | `corporate-surveillance` | MAIN | 3 | 014 | `af658f81-5214-4f56-ba8a-782a4419e366` |
| MERC_DEMO_V1 | `v-corporate-exile` | LEGENDS | 1 | 008 | `20bd1c78-1773-486e-bf45-4075fd4f2a3f` |
| MERC_DEMO_V1 | `viktor-vektor-sit-down-and-relax` | LEGENDS | 1 | 001 | `2344e8d6-3aed-415b-ab6e-f1d634b5ba18` |
| MERC_DEMO_V1 | `jackie-welles-pour-one-out-for-me` | LEGENDS | 1 | 007 | `762951bd-7bcf-42cd-a44e-b5b127cf00d2` |
| MERC_DEMO_V1 | `dying-night-v-s-pistol` | MAIN | 2 | 013 | `dd423c67-68f4-4da8-884c-cbeb91554c0d` |
| MERC_DEMO_V1 | `dexter-deshawn-one-last-chance` | MAIN | 1 | 002 | `daabe14b-dc95-413f-b91a-d3e32937bfd2` |
| MERC_DEMO_V1 | `secondhand-bombus` | MAIN | 2 | 003 | `62d6b51a-ceaf-498b-8a04-27c3d3e21feb` |
| MERC_DEMO_V1 | `kiroshi-optics` | MAIN | 3 | 004 | `57e1d9b6-0f2b-497b-acaf-49c20a68cd19` |
| MERC_DEMO_V1 | `mandibular-upgrade` | MAIN | 2 | 005 | `49fc6d6e-8e86-4a05-bcd5-bd8a50edf5dc` |
| MERC_DEMO_V1 | `afterparty-at-lizzie-s` | MAIN | 2 | 006 | `eb272131-add5-4dda-b426-4166041af144` |
| MERC_DEMO_V1 | `delamain-cab` | MAIN | 3 | 009 | `e15c07b6-f563-4825-aad4-6b3068c1ab85` |
| MERC_DEMO_V1 | `evelyn-parker-scheming-siren` | MAIN | 3 | 010 | `3757f0f3-32d0-41c2-89dc-515271d2b758` |
| MERC_DEMO_V1 | `mt0d12-flathead` | MAIN | 1 | 011 | `f7742fc7-0abe-45ee-a6ce-22caf159e06d` |
| MERC_DEMO_V1 | `psycho-squad` | MAIN | 3 | 012 | `c45d93f9-bc2d-4e35-9d77-ba62d9d4e4d9` |
| MERC_DEMO_V1 | `floor-it` | MAIN | 3 | 014 | `9d62921e-382e-4e93-85d8-aa628566ccd7` |
| MERC_DEMO_V1 | `reboot-optics` | MAIN | 2 | 015 | `7a8acee6-f460-4d2d-aaa3-3d057ef7c36c` |

## Sources reviewed

Local evidence came first: the existing raw/processed comprehensive rules, FAQs, all 29 card records solely for identity/printing/RAM, existing reviewed fixtures and roadmap. Local raw rules SHA-256 `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`; processed rules `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`. The narrowly fetched current rules are parsed-equal to all 713 local nodes, updated September 1. No corpus refresh.

The [source fixture](../tests/fixtures/demo-format-sources.v1.json) retains 88 relevant complete nodes, source locations, short excerpts, source classifications, dates, hashes, decisions and limitations. It does not copy the complete corpus. The official FAQs contain 270 Q/A records; searches were restricted to question/answer text to avoid signed-image URL noise. All 25 game-category FAQs were also read. No demo construction or setup-precedence answer was found; absence in this review is not proof that no clarification exists.

| Official source | Date/scope reviewed | Captured SHA-256 |
|---|---|---|
| [arasaka.pdf](https://cyberpunktcg.com/docs/print-and-play-araska.pdf) | retrieved September 9 local; pages 1–4; page 4 reminder panels | `4df4ef76929bcebe2188bdc3d6fcb8350776b949c3119a3cf587c1b5bde9a52e` |
| [mercs.pdf](https://cyberpunktcg.com/docs/print-and-play-mercs.pdf) | retrieved September 9 local; pages 1–4; page 3 slots 5,6,7 and page 4 panels | `47469c3ed21cca8c4c2f214ef12b28ba13720aaac90ad768528d7d2a8a70f8cb` |
| [guide.pdf](https://cyberpunktcg.com/docs/printable-gameplay-guide.pdf) | 2026-06-04; PDF pages 3,9,12 (printed pages 01,07,10) | `d7b090d8f6b0ce71e5a180c578d9c2ac9a625cd242ce304fda7f7a624d596378` |
| [reminder.pdf](https://cyberpunktcg.com/docs/printable-reminder-sheet.pdf) | 2026-06-04; page 1; PDF title Convention Demo Sheet - PRINTABLE | `a36c0ccaa4919da34b8ca1ad1d46c9510e62be0263c495623f36deb4abaa289d` |
| [guide.html](https://cyberpunktcg.com/gameplay-guide) | retrieved September 9 local; Setup; Deck Building & RAM; Win Condition | `2393ca089412ff38f0dc926594770a472abe225998ae8218380c02cbc681dcd9` |
| [blog.html](https://cyberpunktcg.com/blog?page=3) | retrieved September 9 local; Embedded publisher article metadata; rendered pagination remained on first page | `ab6ed4308afc276cf9d0da56af439cfb59e70eec184c37c8849a5fd01f7347b5` |
| [faq.html](https://cyberpunktcg.com/faq) | retrieved September 9 local; Where can I find the Alpha Kit decks? | `fa5c7bcd65d7c950217b3e1cc3d0d06a00bd09aa102bc5a539b5142bd750b194` |
| [rules.json](https://api.netdeck.gg/api/cyberpunk/comprehensive-rules) | 2026-09-01T19:28:10.028Z; 1.1–1.3; 1.10–1.14; 3.20; 7; 8 | `b1e36a820eefa70885cee00b2116b55077dd90565554f81400bc1700e6cbe06a` |
| [faqs.json](https://api.netdeck.gg/api/faqs/cyberpunk) | retrieved September 9 local; 270 question/answer records; no format/setup/overtime matches | `844a439524c09aa14cc26415b4bbdd623026974fdbe11803a39dc0fbb1c5aaa3` |
| [ax-preview.html](https://cyberpunktcg.com/blog/ax-preview) | 2026-06-26; New Cyberpunk TCG Demo Decks will make their first appearance at AX | `149f44f6693a54b30aa0431253db39307c0085b6814df649ccdc2c4d41611b09` |
| [ax-announcements.html](https://cyberpunktcg.com/blog/ax-announcements) | 2026-07-03; Our updated demo decks are ready for you to Print-and-Play right now! | `2c67ccd3929d3ccd75d177200d3d5366b95673e0b15caaedd5cdf6bfba738b29` |
| [comp-rules-published.html](https://cyberpunktcg.com/blog/comp-rules-published) | 2026-08-28; Introduction and gameplay-guide recommendation | `2afa56dfa294c36a4efc623eb946b1472566472be8369e42a41f91f7b861b77f` |
| [wnc-starter-decks.html](https://cyberpunktcg.com/blog/wnc-starter-decks) | 2026-08-21; Embracing Power Starter Deck; The Heist Starter Deck | `dd6165daa367273f2868f959c590d41cb7b6277e484a11c9d74d53bc53899c30` |
| [guide-cms.json](https://api.netdeck.gg/api/cyberpunk/content/query) | retrieved September 9 local; Existing content/query pattern for gameplay-guide | `6c7ae1da6a288986ed7a1a3624ef90e2a94b284bafe4a210ebe4fbe504688074` |

The print-and-play files are image-only for card text; browser PDF extraction failed on their size, so direct official downloads and page rendering supplied the evidence. The guide's construction page was also visually checked (PDF page 12, printed page 10). The narrow CMS query returned HTTP 200/total 0; the existing HTML guide supplied the actual guide text. Neither access result was used as evidence of a missing rule. Raw downloads/renderings are temporary in `/tmp/tcg-demo-sources`; durable excerpts, locations and hashes are in the fixtures.

Chronology/scope: June 4 guide/reminder PDF creation, June 26 AX preview, June 30 demo PDF creation, July 3 print-and-play announcement, August 21 retail/Beta starter announcement, August 28 comprehensive-rules announcement, September 1 formal rules update. September 8 HTTP Last-Modified values appear to be deployment dates, not proof of rule precedence. The current HTML guide still presents the opposing setup sequence. Formal rules 1.1–1.2 call themselves comprehensive reference material and direct learners to the guide; 1.3 specifies English-over-translations authority. Neither that clause nor the publication announcement expressly resolves this English guide/demo versus formal setup conflict.

## Publisher terminology

The publisher calls these “Demo Decks” and “Print-and-Play” decks, identified as Arasaka / Embracing Power and Mercs / The Heist. `DEMO_STARTER`, `ARASAKA_DEMO_V1` and `MERC_DEMO_V1` are internal candidate/reference identifiers, not claimed official format names. The later retail/Beta Starter Deck products contain 40 main plus three Legends and must not be conflated with these demos. No authority calls these products Sealed/Limited. [Official starter article](https://cyberpunktcg.com/blog/wnc-starter-decks).

## Direct-play evidence

**DIRECT PLAY CONFIRMED**

The June 26 [AX preview](https://cyberpunktcg.com/blog/ax-preview) expressly invites players to take the updated demo decks home and keep playing. The July 3 [AX announcement](https://cyberpunktcg.com/blog/ax-announcements) links these two print-and-play products, invites home/store play and directs players to gameplay-guide resources. This establishes intended independent play of the pair, not merely collectible/reference samples. Normal dice and play materials are still required. It does not establish arbitrary 27-card deck construction or settle conflicting setup instructions. Confidence: high publisher statement, bounded by those distinctions.

## Main-deck size

The official [Arasaka PDF](https://cyberpunktcg.com/docs/print-and-play-araska.pdf) and [Merc PDF](https://cyberpunktcg.com/docs/print-and-play-mercs.pdf), pages 1–4, establish exactly 27 main cards in each identified product. Classification: product evidence combined with explicit direct-play statements. No source establishes a general minimum/maximum of 27 or arbitrary 27-card construction. Formal 7.3/.2 still specifies 40–50. The exact fixed products are the only candidate exception; construction by substitution remains UNKNOWN.

## Legend count

Both exact products contain three Legends. Independently, formal rule 7.3 requires three, and 7.7 expressly randomizes three. No teaching override was found. This is both product evidence and a general explicit rule, not merely a count inferred to authorize a format.

## Fixed-list vs general construction

The narrow future candidate is **fixed-list only**, by stable CardId/revision, quantity and area. This is a bounded application choice from the publisher's two directly playable products under request §71; it is not a claim that the publisher bans all modifications in every casual setting. No general 27-card construction policy is sourced. Required setup details remain in conflict, so §66/72 takes precedence over implementing the candidate now.

## Copy limits

Formal 7.3.3 limits identical Name+Subtitle cards to three copies, regardless of printing numbers. Existing Node validation aggregates duplicate CardId entries; it remains authoritative and unchanged. These exact products comply. No demo waiver was found; compliance is not itself proof of a new construction rule. Split-entry four-copy mutations fail `COPY_LIMIT`. The existing Python duplicate-entry discrepancy remains documented, not copied into Node.

## RAM rules

Formal 7.3.4 and 3.20.3–3.20.6 define a per-color ceiling equal to the sum of Legend RAM; compare each main card's requirement against that ceiling, not summed main-card RAM. No demo waiver was found.

| Exact list | Available from Legends | Highest main-card requirement | Existing RAM result |
|---|---|---|---|
| Arasaka | Green 4, Red 2 | Green 3, Red 2 | Pass |
| Merc | Blue 4, Yellow 2 | Blue 3, Yellow 2 | Pass |

The formal 3.20.5.1 example even uses the three Arasaka Legends. A Merc substitution with Field Operator preserves 27 cards/copy limits but fails Green RAM. This tests existing constructed rules, not an admitted demo format.

## Legend identity rules

Formal 7.3.1 prohibits repeated Legend Names, even with different subtitles. Existing constructed `DECKBUILDING_IDENTITY` remains unchanged. Both products use three distinct Legend Names. Goro's main-deck Unit shares a Name with a Legend without becoming a Legend or a duplicate Legend entry. No teaching identity exception was found.

## Printing vs CardId legality

Gameplay composition uses stable CardId plus revision/area/quantity. Demo collector numbers and official printing UUIDs remain provenance only; no source requires a particular physical printing for equivalent gameplay identity. The two current lists have disjoint CardIds, so no cross-list revision collision exists.

One pre-existing provenance mismatch is recorded explicitly: Viktor revision 1 has application printing ID `viktor-vektor-sit-down-and-relax-printing-2`; the captured official Merc Demo 001 UUID is `2344e8d6-3aed-415b-ab6e-f1d634b5ba18`. Set/collector join confirms the intended printing. Both IDs are pinned and tested. The other 28 rows' application/official IDs agree. No immutable revision was rewritten to repair this metadata debt.

## Setup procedure

**Unresolved official conflict:** the product page-4 panels and [Convention Demo Reminder](https://cyberpunktcg.com/docs/printable-reminder-sheet.pdf) explicitly label their sequence “IN ORDER”: shuffle main/randomize Legends → determine play order → spend first player's two leftmost Legends → draw six/mulligan. The current [HTML guide](https://cyberpunktcg.com/gameplay-guide) repeats shuffle before play-order selection.

Formal 7.4 explicitly requires 7.5–7.9 in listed order: random player/FIRST–SECOND choice → main shuffle and rival cut → Legend randomization and rival cut → first-player two-Legend spending → prepare Fixers → draw/mulligan. Existing `ENGINE_SETUP_V1` follows that formal sequence. Cuts and first-player-first mulligan resolution are omitted by the short reminder, not expressly prohibited. The opposite ordering of two expressly sequenced steps is stronger than a mere omission.

No publisher hierarchy or current demo exception was found that tells us which sequence governs these products. Later publication alone does not establish precedence under the user's §66. Selecting either sequence now would choose an unsupported deterministic setup policy. No preset first player/hand, stacked deck, prescribed Legend arrangement or scripted opening was found.

## First-player procedure

Product instructions specify opposed d20 rolls, reroll ties, winner chooses who goes first. Formal 7.5.1–.2 permits an agreed random method, recommends that d20 procedure and gives the selected player FIRST/SECOND choice. Existing engine draws a uniform seat and exposes that choice; it does not simulate opposed d20 rolls. Whether the demo mandates those physical rolls or accepts the formal general random method is unresolved along with sequencing. Both sources require first player's two leftmost Legends spent and kept spent on their first turn. No preset winner.

## Legend randomization

Explicitly required in both product reminder panels and formal 7.7. Face-down randomized placement; formal rules additionally offer the rival a cut. Printed PDF order is presentation only. No fixed Legend arrangement is admitted.

## Main-deck randomization

Both products explicitly require shuffling; formal 7.6 specifies proper randomization and optional rival cut. There is no sourced teaching stack or scripted draw order. Composition hashing consequently ignores row order; deterministic gameplay would still need a reviewed ordering of RNG operations.

## Initial hand

Six cards is explicit in the product panels and formal 7.9.1. No preset contents. No demo initialization was admitted or executed.

## Mulligan

The product panels explicitly permit one optional whole-hand return/shuffle and six-card redraw. Formal 7.9.2–.3.3 adds first player's declaration/completion before the second player's declaration/completion. No partial, mandatory or disabled teaching mulligan was found. The short reminder omits that resolution detail rather than declaring an exception.

## Fixer dice

Formal 7.2/7.8: one each D4,D6,D8,D10,D12,D20, initially in Fixer order. Product turn panels and 8.6.5.1.1 retain D20-last selection. No predetermined roll results or reduced teaching dice set; existing Fixer mechanics remain unchanged.

## Turn structure

Product reminders retain Ready → Draw → gain/roll Gig → Main. Formal 8.1,8.6,8.16–.18 provide start checks/effects and ordered end-turn checks. Engine mapping remains TURN_START → READY → DRAW → CHOOSE_GIG → ROLL → MAIN → END_TURN. No actual teaching exception was sourced from omitted explanatory detail. Product panels explicitly retain Quick/React and Blocker. No Go Solo, Gear-on-Legend or other action ban was found; card presence alone was not used to establish format policy. Existing scoped card behavior is unchanged.

## CALL / SELL rules

Product turn panels state once per turn for CALL and SELL. Formal 8.11/.1 and 8.12/.1/.2 confirm the limits, CALL cost one Eddie and CALL during the rival's React step. A turn is global, not a personal round. No extra free teaching CALL, lowered price or additional SELL was introduced.

## Win condition

Product panels and formal 1.10/.1 require seven or more controlled Gig dice at own turn start, checked before Ready. Street Cred is the sum of die values and affects cards; it is not a separate 50-point victory threshold. Formal 1.13 gives instant win resolution. Existing reviewed turn-slice policy already supports the seven-Gig start check. No demo-specific threshold was found.

## Deck-out

The printed guide's win-condition page (PDF page 3) and formal 1.14/.1 retain immediate loss on a required draw from an empty deck, including the first unsatisfied card of a multi-draw. An empty deck alone is not a loss before a required draw. No teaching waiver was found; existing empty-draw loss remains unchanged.

## Overtime

**Overtime is explicitly present, not UNKNOWN or disabled.** Both product panels say sudden death begins after the last player's seventh turn, with seven Gigs winning immediately. Formal 1.11/.1/.2 and 8.17 express the trigger precisely as two consecutive turns where both players begin with empty Fixers, after end-turn effects; seven Gigs then wins immediately, including at entry.

For ordinary six-die progression without an early win/deck-out, both descriptions reach the same boundary. That equivalence is a bounded inference, not a played trace or a general rule that every future Fixer-changing effect preserves turn seven. No teaching end rule prevents these decks reaching overtime: seven draws per player do not by themselves exhaust a 27-card main deck, and the sources do not require an earlier winner. No seed search or match was run to demonstrate reachability.

Current `turnSlice.overtime` is `UNSUPPORTED`. Even after deck/setup admission, a complete demo-match claim would require a separate overtime implementation/review and replay. Overtime alone need not block admitting deck/setup policy under request §64; the unresolved setup conflict is the reason this review does not admit it.

## Constructed comparison

The demo column describes sourced products and the candidate, not implemented legality.

| Policy | CONSTRUCTED (unchanged) | Demo product / DEMO_STARTER finding |
|---|---|---|
| Main | 40–50 | Exact products 27; general construction UNKNOWN |
| Legends | Exactly 3 | Exactly 3 in products and formal rule; no override found |
| Copy limit | Existing max 3 | Standard rule; products comply; no waiver found |
| RAM | Existing Legend sum ceilings | Same published rule; both products comply |
| Legend identity | Unique deckbuilding Name | Same published rule; no exception found |
| Fixed list | No | Only two fixed manifests are a justified narrow candidate |
| Setup | ENGINE_SETUP_V1 / formal order | UNKNOWN precedence: shuffle-first versus select-first |
| Opening/mulligan | Six; one optional whole hand | Explicitly six and one optional whole hand |
| Win | Seven Gigs at own turn start | Same explicit condition, no Street Cred win |
| Deck-out | Required empty draw loses | Same published rule; no waiver found |
| Overtime | Formal rule; engine unsupported | Explicitly retained; engine unsupported |
| Runtime admission | Supported | NOT ADMITTED |

## DEMO_STARTER policy decision

**DEMO_STARTER: NOT ADMITTED**

Request §§66 and 72 require unresolved official setup conflicts to stay unsupported. Direct play is established, and §71 supports only the two exact fixed lists as a future narrow candidate. It does not authorize guessing the required setup policy. No general 27-card construction rule is invented. This is a successful source-review outcome, not evidence that the physical products are unplayable. Resolving source precedence should precede implementation.

## Format implementation architecture

No runtime enum, ruleset, validator, setup, state, observation, persistence or wire changes. `CONSTRUCTED` and existing `SEALED_LIMITED` stay exactly as before; neither physical count nor demo printing selects a format. The new helper is under tests and builds reference artifacts only. It does not implement a parallel legality validator.

If clarification later establishes one sequence, add a versioned explicit fixed-list policy through current domain/engine boundaries. Match exact CardId/revision/zone/aggregated quantity; retain printing separately. Reuse standard setup only if confirmed; otherwise add the smallest sourced difference. Reject unsupported manifests/policy versions and propagate explicit format/ruleset identity normally. No Python legality hardcoding.

## Exact Arasaka validation

Reference composition: 14 distinct /30 copies, 27 main/3 Legends, all revision 1 and SUPPORTED. Existing default and explicit constructed validation both return `legal: false`, `mainDeckCount: 27`, with **only `MAIN_DECK_SIZE`** (40–50 required). RAM, copies and Legend identity comply. No positive DEMO_STARTER result is claimed.

## Exact Merc validation

Reference composition: 15 distinct /30 copies, 27 main/3 Legends, all revision 1 and SUPPORTED; Psycho Squad remains three. Existing default and explicit constructed validation both return `legal: false`, `mainDeckCount: 27`, with **only `MAIN_DECK_SIZE`**. RAM, copies and Legend identity comply. No positive DEMO_STARTER result is claimed.

## Constructed negative validation

Both exact lists are rejected by the public high-level initializer as `INVALID_DECK` with the specific `MAIN_DECK_SIZE` issue, with missing format and explicit CONSTRUCTED. Tests do not bypass validation through low-level state construction. Existing 42-main/3-Legend support decks still validate and initialize identically with implicit/explicit CONSTRUCTED. No auto-demo based on 27 or printings.

## Mutation/invalid-deck cases

The [44 focused tests](../tests/demo-format.test.ts) cover reference hash changes for card/quantity/revision/zone/Legend replacement, split-entry normalization, presentation/printing independence, and unknown reference IDs/versions at the reference-schema boundary.

Constructed checks cover 26/27/28 main rejection, two/four or duplicated Legends, four copies split across rows, Legend-in-main, main-card-in-Legends, unknown CardId and a size-preserving RAM failure. These are constructed regressions, not fabricated demo policy positives. Wire tests reject DEMO_STARTER, DEMO_STARTER_V1, unknown format, extra manifest/policy fields and attempts to send a 42-card support deck as a demo. Unknown fields do not silently fall back. No 27-card positive or demo initialization is manufactured.

## Reference manifest hashing

Canonical composition includes schema version, manifest ID and normalized entries `{cardId, revision, zone, quantity}`, aggregated by zone/CardId/revision and sorted by zone, CardId, revision. Display order and printing metadata are excluded because the products require shuffling. Provenance remains separately present in the full artifact. Serialization/deserialization and split entries preserve identity; quantity, card, Legend, revision or area changes alter it.

| Artifact | Composition SHA-256 |
|---|---|
| ARASAKA_DEMO_V1 | `7ef234191430bce642888161bcad4127c138faddb41c826a0f7b8b68fd90a386` |
| MERC_DEMO_V1 | `c0551a2293a54080e44cbf45afbd7daf96d9b8b33ef9b113037647004991c38e` |

These are reference composition identities, not authorized runtime policy hashes. Parsed reference data is recursively frozen; tests mutate independent parsed copies.

## Real-card-only content bundle

[demoReferenceContext](../tests/demo-format-fixture.ts) deterministically selects exactly the existing 29 real revision-1 cards from the prior 53-revision reviewed bundle and calls the existing validated content-bundle constructor. No synthetic filler, duplicate gameplay identities, new revisions or production catalog import.

Manifest hash: `3ff587118bac2acee9d669a25aff86db5c3fbc70c6d204e1623a8de97e4a75e5`.
Ruleset hash: `72f1e130e62c3d1efe9f77a49b8d0c00e61cc5fa2a608463f079a9e51a41b24c`.

Every manifest row resolves to its pinned supported revision hash and intended set/collector. JSON bundle round trip is validated. The bundle retains the unchanged existing ruleset: containing these cards does not make 27-main decks legal. The 53-revision parent bundle remains byte/content-identical.

## Initialization smoke test

Not applicable: policy is not admitted. Only required negative exact-list initialization tests ran. The existing constructed support initialization regression stops at turn 0/FIRST_PLAYER choice. No exact demo state, RNG sequence, position, replay or full match was generated.

## Observation / format visibility

Unchanged. No new demo state exists to observe. Future admitted format metadata must follow ordinary entitled observation/model-input contracts; internal source hashes must not be exposed. No observation field or Python prompt was added in this reference review.

## Hash behavior

Runtime ReplayStateHash, PositionHash and ObservationHash semantics are unchanged. No behavior artifact bump. New reference composition/content-bundle identities are offline artifacts. A future format with different setup or win semantics must be represented through canonical ruleset/format identity rather than inferred from cards or just the deck composition hash.

## Wire

Wire v1 remains unchanged. Missing format retains constructed meaning. Unsupported demo IDs and unrecognized policy/manifest fields reject as INVALID_REQUEST at the existing strict boundary. Contract export is required to remain byte-identical; no GraphQL/UI format selector or generated-schema extension.

## Persistence

No persisted format or game state changed, so the request's conditional live Mongo/Postgres gate is not triggered. No migrations, Mongo seed, infrastructure changes or database writes. Existing generated replays and pure regression gates are checked. This pass makes no new live-persistence claim. The four-record application bootstrap catalog remains separate from reviewed engine bundles.

## Python

Harness files, corpora, schemas, TrainingAttempt and model inputs remain unchanged. Node remains the authority via JSON/wire. Required adapter, gameplay and harness-core suites run against the existing contracts; results below. The known Python duplicate-entry and Legend-in-main differences remain explicit differential-test findings. No download, training, gold promotion or generated demo training data.

## Replay compatibility

The original 29 families/1042 decisions were frozen before implementation under `/tmp/tcg-demo-before/replays`. The original-payload audit compares semantic legal actions/descriptors, both observations, event batches and initial/final states. It consumes those original payloads, independently of regeneration. All 24 existing replay/golden generators are rerun; no new replay family. Final outcomes are recorded below.

## Tests

**All final required gates pass.** Focused demo review: 44/44. Full application: 1072 passed, 0 failed, 0 skipped. Typecheck, lint (no warnings), four-record starter validation, production build and contracts export pass. All 24 replay/golden generators pass and their prior artifacts remain byte-identical. Original-payload audit preserves 29 families/1042 decisions.

Python adapter verifies all 29 replay families/1042 actions, exact states/events/observations/hashes, 7 golden round trips, model inputs, submission/stale/envelope checks and 7 differential cases. Python gameplay: 87 passed; harness core: 48 passed. Existing two Python legality differences remain explicit. No new runtime warnings were observed.

Baseline comparison: all 53 prior revisions and 29 original replay files unchanged; all 29 roadmap row names/decks/quantities unchanged; all 504 captured harness files/status unchanged; application runtime/manifests/lockfile/.nvmrc/generated contracts unchanged. Both HEADs and indexes match the initial snapshot. All 48 required report headings and local documentation links verify. Independent local raw-source audit verifies all 29 official printing UUID/set/collector joins and raw/record hashes.

Initial typecheck caught one new test dereferencing optional `card.execution`; the assertion now safely checks `card.execution?.status`. The subsequent complete gate run passes. Live database integration was not required because persisted state/format contracts did not change.

## Commands

Application cwd: `/Users/codyclark/Documents/personal_code/cyberpunk-tcg-online`.

```sh
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
```

Each command below ran individually. The exact command/exit ledger is `/tmp/tcg-demo-gates.json`, with logs `/tmp/tcg-demo-gate-00.log` through `-33.log`.

| Exact command | Final result |
|---|---|
| `node -v` | v22.13.0 |
| `npm -v` | 10.9.2 |
| `npm run typecheck` | PASS; exit 0 |
| `npm run lint` | PASS; no warnings |
| `npm run validate:cards` | 4 starter records valid |
| `npm test` | 1072 passed; 0 failed/skipped |
| `npm run build` | Compilation, TypeScript and all 6 pages pass |
| `npm run contracts:export` | PASS; bytes unchanged |
| `node --import tsx scripts/generate-attack-condition-power-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-attack-ordered-effects-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-combat-attack-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-combat-resolution-replays.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-combat-restrictions-replays.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-combat-triggers-replays.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-delayed-effects-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-end-turn-history-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-field-legends-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-gear-capabilities-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-gear-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-goro-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-noncombat-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-private-information-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-react-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-reviewed-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-saburo-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-setup-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-targeted-defeat-replays.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-targeted-spend-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-turn-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-value-conditions-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-wire-golden.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/generate-yorinobu-replay.ts` | PASS; generated artifacts byte-unchanged |
| `node --import tsx scripts/audit-replay-compatibility.ts /tmp/tcg-demo-before/replays` | PASS; 29 original families/1042 decisions preserved |
| `git diff --check` | PASS; exit 0 |

Additional application check:

```sh
node --import tsx --test tests/demo-format.test.ts
```

44 passed, exit 0; `/tmp/tcg-demo-focused.log`. The initial `npm run typecheck` attempt exited 2 for TS18048 in the new test only; corrected optional access as described above, then reran the full ledger successfully. Initial evidence: `/tmp/tcg-demo-typecheck-initial.log`, `/tmp/tcg-demo-gates-initial.json`.

Harness cwd: `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```sh
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node
mlx_env/bin/python -B scripts/test_cyberpunk.py
mlx_env/bin/python -B scripts/test_harness_core.py
git diff --check
```

All exited 0. Results respectively: 29 families/1042 actions plus 7 goldens and differential checks; 87 gameplay tests; 48 core tests; clean diff check. Logs: `/tmp/tcg-demo-python-adapter.log`, `/tmp/tcg-demo-python-game.log`, `/tmp/tcg-demo-python-core.log`.

Read-only final audit:

```sh
python3 /tmp/tcg-demo-final-audit.py
```

Exit 0; `/tmp/tcg-demo-final-audit.json`. This compares SHA-256 hashes to `/tmp/tcg-demo-before/baseline.json`, both `git rev-parse HEAD` and `git ls-files --stage`, harness status, all 29 frozen replay payloads, all 53 prior revisions, roadmap rows, raw printing records, required headings and local links. `git diff --check` also ran in both repositories, plus `git diff --no-index --check /dev/null <file>` for each of the five new files. Nothing was staged, committed or pushed. Temporary research/snapshot/log files are outside both projects.

## Files changed

Application files only:

| File | Purpose |
|---|---|
| [tests/fixtures/demo-format-sources.v1.json](../tests/fixtures/demo-format-sources.v1.json) | Focused authoritative evidence, 88 rule nodes, capture hashes, conflicts and review decisions |
| [tests/fixtures/demo-reference-manifests.v1.json](../tests/fixtures/demo-reference-manifests.v1.json) | Both exact reference-only manifests, official/current printing IDs, per-slot PDF audit and revision/source hashes |
| [tests/demo-format-fixture.ts](../tests/demo-format-fixture.ts) | Strict reference schema, frozen artifacts, canonical multiset hash and exact real-only bundle |
| [tests/demo-format.test.ts](../tests/demo-format.test.ts) | 44 composition/coverage/provenance/hash/constructed/wire regressions |
| [docs/demo-format-report.md](demo-format-report.md) | This source review, decision, evidence, readiness and validation report |
| [docs/demo-deck-coverage-roadmap.md](demo-deck-coverage-roadmap.md) | Current format finding and next blocker; all card rows/quantities preserved |
| [docs/executable-card-coverage.md](executable-card-coverage.md) | Append reference invariant and format-review outcome without changing historical records |

No harness file changed. No commit, staging or push.

## Unsupported / unresolved format rules

Blocking format question: which expressly ordered setup governs these demo products, and may an agreed uniform random selection replace their stated opposed d20 procedure? No explicit source hierarchy/exception found. General 27-card deck construction and substitution rules remain UNKNOWN, not necessary for a narrow fixed-list candidate once setup is settled.

Full-match limitation: overtime is required and currently unsupported. Existing scoped interaction limitations, including overlapping Reboot Optics prevention, remain as previously documented; this review does not certify all combined interactions. Viktor's printing-ID mismatch remains provenance debt. Starter catalog still has four records; no automatic production population.

## Ambiguities not guessed

No newer-timestamp precedence invented; no omitted cut/mulligan detail treated as a prohibition; no general 27-card format inferred from two products; no Sealed/Limited relabeling; no demo-printing runtime identity; no fixed card order; no default demo format; no absent FAQ result treated as proof of nonexistence; no overtime waiver or Street Cred victory invented. No card text, costs, RAM or quantities changed to obtain a legal result.

## Match-readiness status

| Layer | Status |
|---|---|
| Card execution | COMPLETE within reviewed scopes: 29/29 distinct, 60/60 copies |
| Publisher direct-play intent | CONFIRMED for the identified products |
| Application demo deck legality | NOT ADMITTED pending required setup source resolution |
| Exact demo initialization | NOT ADMITTED / not run |
| Full exact match | NOT TESTED; additionally blocked by unsupported overtime and existing interaction limits |

Coverage, publisher intent, application legality and match execution are distinct claims.

## Recommended next milestone

Resolve the narrow official setup conflict before implementation: obtain an explicit publisher clarification or revised demo instructions identifying whether formal 7.4–7.9 supersedes the shuffle-first demo panels/current guide, and whether the opposed d20 procedure is mandatory. No message to the publisher was sent.

Then implement only the two versioned fixed manifests with explicit initialization format, preserving constructed. If standard setup is confirmed, reuse it; otherwise encode only the sourced difference. Validate exact positive/negative admission and deterministic initialization, then stop. Overtime needs its own bounded execution milestone before claiming complete match support. Build the first exact Arasaka-vs-Merc replay only after those boundaries are established. No new card mechanic is needed for this review.
