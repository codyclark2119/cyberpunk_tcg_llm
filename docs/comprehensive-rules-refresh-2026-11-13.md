# Comprehensive Rules refresh (2026-11-13)

Dated record. It describes the rules corpus as of 2026-11-13, when the Comprehensive
Rules snapshot moved from `updated_at` 2026-09-01 to 2026-10-29. For present behaviour
read the code and tests.

## Source and versions

| | Before | After |
| --- | --- | --- |
| Endpoint | `https://api.netdeck.gg/api/cyberpunk/comprehensive-rules` | same |
| `updated_at` | `2026-09-01T19:28:10.028Z` | `2026-10-29T15:12:02.844Z` |
| Nodes (`data/raw/comprehensive_rules.json`) | 713 | 733 (53 sections, 680 rules) |
| `rules.jsonl` rows | 713 | 733 |
| `rule_chunks.jsonl` / `corpus_chunks.jsonl` | 74 / 229 | 78 / 233 |
| `RULES_VERSION` (`games/cyberpunk/prompts.py`) | `2026-09-01` | `2026-10-29` |
| `TOURNAMENT_RULES_VERSION` | `2026-10-28` | `2026-10-28` (not refetched) |

Approved by Cody on 2026-11-13. Fetched with `python scripts/fetch_rules.py` (the
shrink guard did not trip), then `python scripts/ingest.py` and
`python scripts/chunk_corpus.py`. Ingest re-wrote `rule_sections.jsonl` and
`tournament_rules.jsonl` byte-identically; card and errata chunks did not change. No
unknown brace markup (`ingest.py --report-unknown-markup`), so the keyword vocabulary in
`games/cyberpunk/markup.py` is unchanged.

The raw snapshot, the regenerated processed files and `RULES_VERSION` are one commit;
the diff CLI, this report and the test updates are the next.

## How the diff was made

`scripts/diff_rules_snapshot.py` pairs rows by the site's `stable_anchor` first and by
display number only for rows whose anchor is on one side alone. Text is compared without
its `"<number>. "` prefix, so a renumbering on its own is not a text change. The
generated output is the appendix below:

```bash
python scripts/diff_rules_snapshot.py --old-rev 3434003   # 3434003 = master before the refresh
```

| Category | Count |
| --- | ---: |
| Added | 56 |
| Removed | 36 |
| Renumbered (same anchor) | 144 |
| Text changed | 44 (3 largely rewritten; 0 that are cross-reference renumbering only) |
| Number reused for a different rule | 89 |

What moved, in short:

- **Fight, Steal and Defeat became glossary terms.** The fight procedure (old 9.17 to
  9.19) is now 11.4 *Fight*; stealing (old 6.7.1 to 6.7.5 and the Steal Step's 9.23.x)
  is now 11.5 *Steal*; 11.6 *Defeat* is new. Every later section of 11 shifted: old
  11.4 *Play* is 11.7, [BLOCKER] 11.24 is 11.28, [GO SOLO] 11.25 is 11.29, [QUICK]
  11.26 is 11.30, [CALL] 11.18 is 11.22. 11.16 *Top-deck* is new.
- **Gigs (section 6) renumbered:** "Set" is now its own rule 6.5, so 6.5 to 6.7
  became 6.6 to 6.8 (Steal is 6.8).
- **The attack steps shortened:** 9.20 to 9.29 became 9.17 to 9.24.
- **Rules changes, not just wording** (read the appendix for the full text):
  5.7.6 (a face-up Legend's [Spend Icon] effect may be activated *during your main
  phase*, previously "at any point"); 5.8.2.2 and 8.11 (the once-per-turn Main-phase
  Sell is renamed "Sell for Turn" and reveals the card; 11.12.1 no longer requires a
  reveal for Sell in general; 5.8.2.1, "a sold card enters face-down and ready", is gone
  from section 5 but still stated at 11.12.1.1); 11.11.2 and
  11.11.3 (cost increases also leave the cost value unchanged; the 1 €$ floor now
  applies only to playing a card); 11.11.4.2 (playing for free ignores cost increases
  and reductions) new; 11.23.1 ([DEFEATED] covers Units, Legends and Gear); 11.23.3
  (last-known information for [DEFEATED]) new; 11.28.3.1 (a Unit can't redirect an
  attack to itself if it is already the target) new; 10.3 (a condition is a
  requirement for an effect to apply, no longer also to become pending and resolve);
  10.16.1.1 (trigger conditions beyond the trigger need only be true on resolution)
  new; 11.15.3.1 (a [Spend Icon] effect's condition must hold at activation and
  resolution) removed; 7.6.2 and 7.7.2 (the Rival may cut *or shuffle*); 3.9.2, 3.9.3
  (own-name and "&" names), 10.1.1, 10.1.5, 10.17.1, 11.9.1.3 new.
- **"enters pending" became "becomes pending"** throughout, and "0 power" became
  "power 0".

**An anchor is not always the same rule.** Old 9.23.4 ("After all Gigs are chosen,
apply any effects that prevent...") kept its anchor but is now 9.20.2 with unrelated
text ("After stealing Gigs, resolve all pending effects..."; similarity 0.10). The CLI
flags such rows "largely rewritten"; anything keyed on anchors should treat them as new.

## Impact checks

### Expected-rules draft (`eval/sets/quiz_mc_expected_rules_draft.jsonl`)

Every comprehensive id was traced through its old anchor. Twelve rows changed; status
stays `draft`, authorship unchanged, no other field touched. Tournament Rules ids are
untouched.

| Question | Old id | New id | Why |
| --- | --- | --- | --- |
| cody-quiz-08 | 9.23.2.1 | 9.20.1.1 | renumbered (wording "0 power" -> "power 0") |
| cody-quiz-11 | 11.26.1 | 11.30.1 | renumbered ([QUICK]) |
| cody-quiz-12 | 11.13.4.1 | 11.17.4.1 | renumbered (Search) |
| cody-quiz-22 | 11.24.3 | 11.28.3 | renumbered ([BLOCKER]) |
| cody-quiz-23 | 11.26.2 | 11.30.2 | renumbered ([QUICK]) |
| cody-quiz-26 | 11.23 | 11.27 | renumbered ([ADRENALINE]) |
| cody-quiz-28 | 9.23.3.1 | 11.5.1.4.1 | **removed and re-added** under 11.5 *Steal* with a new anchor; same meaning ("You may choose to steal any Gig ... regardless of its value"), similarity 0.88. Chosen by reading both texts, not by number |
| cody-quiz-30 | 11.25.1 | 11.29.1 | renumbered ([GO SOLO]) |
| cody-quiz-32 | 11.18, 11.20.2 | 11.22, 11.24.2 | renumbered ([CALL], [PLAY]); 11.24.2 "enters pending" -> "becomes pending" |
| cody-quiz-34 | 11.4.1.2 | 11.7.1.2 | renumbered (Play) |
| cody-quiz-35 | 6.7, 6.6.2 | 6.8, 6.7.2 | renumbered (Steal, Swap); 6.8 gains "See Steal." |
| cody-quiz-37 | 11.25.1 | 11.29.1 | renumbered ([GO SOLO]) |

Unchanged ids were checked to name the same anchor. Without these fixes
`eval_retrieval.py` refuses the old file (8 of its ids no longer exist), and the other
6 stale ids would load and silently score against different rules: 11.18 is now
*Reveal* (was [CALL]), 11.23 is now [DEFEATED] (was [ADRENALINE]), 11.25.1 is now
[ATTACK] (was [GO SOLO]), 11.4.1.2 is now a fight rule (was Play) and 6.7 is now *Swap*
(was Steal).

### Cody's quiz (`data/gold/quiz_mc_2026-11-12.jsonl`, read only)

`git diff --quiet data/gold eval/runs` passed before and after this change; gold was
not edited. For Cody to review; none of these is known to change an answer:

**Expected rule changed or moved**

| Question | Key | What changed | Assessment |
| --- | --- | --- | --- |
| cody-quiz-28 (choose any Gig to steal) | A | 9.23.3.1 removed; same rule now 11.5.1.4.1 in the new 11.5 *Steal*; "attacking player" became "You"/"the actor" | key looks unaffected; please confirm |
| cody-quiz-35 (Appetite for Destruction steal counts for the Unit) | A | 6.7 -> 6.8; the "actor" rules (old 6.7.1.x) moved to 11.5.1.1.x, which now say "If an effect specifies a different actor..." | **review**: the actor rule is the deciding rule and is not in the expected list (11.5.1.1 would be) |
| cody-quiz-01 (Gear stays equipped when Legend played as Unit) | A | 4.12.1 "outside of" -> "other than"; new 11.9.1.3 (equipped Gear is in the same area as its Unit or Legend) | wording; new 11.9.1.3 supports A |
| cody-quiz-04 (Sketchy Ripper power) | none yet | 2.10.1 example rewritten ("gives it -3 power", "power -1") | wording; no key to check |
| cody-quiz-08 (attack with 0 power) | A | 9.23.2.1 -> 9.20.1.1, "0 power" -> "power 0" | wording |
| cody-quiz-32 (Adam Smasher Call vs Play) | B | 11.18 -> 11.22, 11.20.2 -> 11.24.2 ("becomes pending") | wording |

Renumbered only (no text change in the expected rule): 11, 12, 22, 23, 26, 30, 34, 37.

**Not in the expected list, but a changed or new rule bears on the question**

| Question | Key | Rule | Note |
| --- | --- | --- | --- |
| cody-quiz-22 (Blocker redirect again) | A | new 11.28.3.1: a Unit can't redirect an attack to itself if it is already the target | **review**: directly about re-redirecting; likely consistent with A but worth a look |
| cody-quiz-06 (Carnage cost) | B | 11.11.2 now covers increases too; 11.11.3 floor only for playing | supports B |
| cody-quiz-15 (Johnny steal count) | none yet | fight rules moved to 11.4; 11.4.2.3.1 (still defeats if the opposing Unit left) new; 11.23.3 last-known information | no key to check |
| cody-quiz-39 (Yorinobu [DEFEATED]) | A | 11.23.1 [DEFEATED] covers Units, Legends, Gear; 11.6 *Defeat*; 11.23.3 new | likely unaffected |
| cody-quiz-30 (V bottom-decked) | C | 4.12.2 wording; 11.6.3.1, 11.15.3 new | likely unaffected |
| cody-quiz-17, 37 (Spend effects, Go Solo) | B, A | 5.7.6 Legend [Spend Icon] effects only in your main phase; 11.19.1 "activation trigger" -> "activation cost"; 11.15.3.1 removed | likely unaffected; 5.7.6 is a real timing change for Legend Spend effects |

### Pins in code and tests

Updated, each because the refresh moved it:

- `scripts/test_cyberpunk.py`: `RULES_VERSION` pin 2026-09-01 -> 2026-10-29
  (`TOURNAMENT_RULES_VERSION` still asserted 2026-10-28); new
  `test_rules_version_is_the_comprehensive_snapshot_date` (the constant equals the raw
  snapshot's `updated_at` date, 733 rows, `rules.jsonl` equals what ingest makes of the
  raw file); four tests for the diff CLI; a comment's rule number (11.11.1.4 -> 11.14.1.4).
- `scripts/test_assistant_tools.py`: [BLOCKER] 11.24 -> 11.28 (and children), Draw
  11.5 -> 11.8, [GO SOLO] 11.25 -> 11.29, [CALL] 11.18 -> 11.22.
- `scripts/test_assistant_retrieval.py`: 713 -> 733 rows; [BLOCKER] and [GO SOLO]
  glossary ids; "stealing gigs from a rival" now ranks 6.8 (was 6.7, same anchor);
  report `rules_version`.
- `scripts/test_assistant_prompt.py`: the system prompt's snapshot line reads
  "Snapshot 2026-10-29".
- `scripts/run_tests.sh`: the `py-cyberpunk` pin row, `all 95` -> `all 100 tests passed`.
  No other suite's count changed.
- Glossary mapping (`card_interactions`, `term_rules`) is derived from `### [TERM]`
  headings in the snapshot, so it followed the renumbering without code changes; only
  the tests' literal ids moved.

**System prompt.** `assistant-chat-v4` cites rules 9.1 and 9.3.2.1. Both kept their
anchor, number and exact text, so the prompt version stays `assistant-chat-v4`; only the
snapshot date it prints changes, as it does on every refresh.

**Prompts outside the assistant.** No gameplay or policy prompt
(`games/cyberpunk/policy_prompt.py`, local play) quotes `RULES_VERSION`; nothing there
changed.

**Engine side: one TypeScript unit test fails, not fixed here.**
`tests/api-admission-batch-v6-source.test.ts` ("V6 source: imported monorepo data
exactly matches the preserved AI source commit") calls `verifyV6Source`
(`scripts/lib/api-admission-batch-v6-source.ts`), which requires the working tree's
`data/processed/rules.jsonl` to equal the V6 source commit's copy byte for byte and to
hold 713 rows. It fails with `V6_SOURCE_DIRTY: data/processed/rules.jsonl`, so
`scripts/run_tests.sh --quick` fails its `unit` step (1379 pass, 1 fail). Resolving it
means changing TypeScript admission-evidence code (for example, reading the pinned
rules from the source commit rather than the working tree), which this change was told
to leave to the engine side. The Batch V4 and V5 capture scripts pin the same
2026-09-01 blob (`5d8343c6...`) and would also refuse to re-capture; no test runs them.
No engine-identity input changed.

### Hybrid index

The rule-level corpus fingerprint changed (`757007fb...` -> `21075f44...`). An index
built from the 2026-09-01 corpus is refused with the stale reason, checked by building a
fake index from the old rows and querying the new corpus:

```
lexical-bm25-rules / .../rules_index.npz is stale: it was not built from the current rule-level corpus (rebuild it with scripts/build_rules_index.py)
```

Rebuild on the Mac: `python scripts/build_rules_index.py` (then
`python scripts/build_rules_index.py --check`). There is no index in this container.

### Retrieval recall (lexical, `scripts/eval_retrieval.py`)

Before: the 2026-09-01 corpus and expected set at `3434003`. After: this change.
36 questions are scored (4 card-only are skipped). "Rules" is the 30 questions with at
least one comprehensive id, "policy" the 8 with at least one Tournament Rules id (2
questions, 18 and 21, are in both).

| Method | Group | R@1 before -> after | R@5 before -> after | R@10 before -> after |
| --- | --- | --- | --- | --- |
| lexical-bm25-rules | rules (30) | 15 -> 13 | 23 -> 22 | 24 -> 23 |
| lexical-bm25-rules | policy (8) | 6 -> 6 | 7 -> 7 | 8 -> 8 |
| lexical-bm25-rules | all (36) | 0.556 -> 0.500 | 0.778 -> 0.750 | 0.833 -> 0.806 |
| lexical-bm25-chunks | rules (30) | 16 -> 15 | 22 -> 23 | 26 -> 26 |
| lexical-bm25-chunks | policy (8) | 2 -> 2 | 2 -> 2 | 2 -> 2 |
| lexical-bm25-chunks | all (36) | 0.444 -> 0.417 | 0.611 -> 0.639 | 0.722 -> 0.722 |

The rule-level method lost one hit at each k. First-hit rank changes: quiz-04 9 -> miss,
11 1 -> 2, 14 4 -> 5, 28 1 -> 7, 35 2 -> 4. quiz-28 fell because its rule moved from
the Steal Step into 11.5 *Steal* among several similar new steal rules. These numbers
are on a new corpus and a re-mapped expected set, so they are not a like-for-like
retrieval comparison. No report file was written; the committed `eval/reports/` files
are dated 2026-09-01 measurements and were left as they are.

## Other endpoints (read only, 2026-11-13)

| Data | Live | Snapshot | Stale? |
| --- | --- | --- | --- |
| Tournament Rules | `updated_at` 2026-10-28T19:55:57.636Z | same | no |
| Errata (CMS) | `updatedAt` 2026-08-29T20:59:04.847Z | same | no (the first query returned HTTP 502; a retry succeeded) |
| Cards | the index has no `updated_at`; it lists 152 cards | 151 | **yes**: one new card, `lucyna-kushinada-fresh-beginnings` |
| Decks | not checked | | |

Nothing was refetched except the comprehensive rules.

## Appendix: generated diff

Old: `3434003:data/raw/comprehensive_rules.json` (713 rows). New: `data/raw/comprehensive_rules.json` (733 rows).

| Category | Count |
| --- | ---: |
| added | 56 |
| removed | 36 |
| renumbered (same anchor) | 144 |
| text changed | 44 |
| text changed, cross-references only | 0 |
| text changed, largely rewritten (similarity < 0.5) | 3 |
| re-anchored (paired by number) | 0 |
| number reused for a different rule | 89 |

### Added (56)

- **3.9.2** (rule): When a card refers to its own name, assume it’s referring to itself (not another card of the same name).
- **3.9.3** (rule): If a card's name contains 2 names connected by an ampersand (&), that card has 3 names: both contained names, plus the combined name. > **EXAMPLE:** The card "Pilar & Rebecca: Runs in the Family" is n…
- **10.1.1** (rule): If a card’s effect text is unclear based on the official rules, refer to the FAQ on its official card database page.
- **10.1.5** (rule): If an effect refers to multiple potential targets, you can assume any restrictions and stipulations apply to all of them unless the effect delineates them separately. > **EXAMPLE:** The reminder text…
- **10.16.1.1** (rule): If a trigger effect has conditions beyond the trigger, those conditions do not need to be true when it triggers, only when you resolve it. > **EXAMPLE:** A friendly Unit with power 3 has an effect rea…
- **10.17.1** (rule): When there are multiple trigger keywords before an effect, the effect activates when either trigger is met. > EXAMPLE: A Unit's effect reads "[PLAY] [ATTACK] Adjust a Gig by up to 1." The effect trigg…
- **11.4** (rule): ### Fight
- **11.4.1** (rule): A “fight” is a game process in which two opposing Units compare power to determine at least one loser and potentially one winner.
- **11.4.1.1** (rule): A Unit wins a fight when it has a higher power than the opposing Unit.
- **11.4.1.1.1** (rule): When a Unit wins a fight, the opposing Unit always loses, regardless of power.
- **11.4.1.2** (rule): A Unit loses a fight when it has equal or lower power than the opposing Unit.
- **11.4.1.3** (rule): If both Units in a fight have the same power, neither Unit wins and both Units lose the fight.
- **11.4.1.4** (rule): If a card effect says that a Unit wins or loses a fight, it supersedes any win or loss status determined by power comparison.
- **11.4.2** (rule): A fight proceeds in this order.
- **11.4.2.1** (rule): Before calculating the fight, apply effects that last “while fighting” and variations thereof.
- **11.4.2.2** (rule): After applying relevant effects, compare the Units’ power. Declare the loser(s) and any winners.
- **11.4.2.2.1** (rule): When you determine the losers and winners, any effects triggered by the fight (i.e. “when this Unit fights,” “when this Unit loses a fight,” etc.) become pending. Resolve them after the fight ends.
- **11.4.2.3** (rule): Losers are defeated by the opposing Unit. See Defeat. Defeated triggers become pending.
- **11.4.2.3.1** (rule): Even if the opposing Unit is no longer on the field or removed from the game, it still defeats the loser.
- **11.4.2.3.2** (rule): Units with power 0 cannot defeat a Unit in a fight.
- **11.4.2.3.3** (rule): Cards that refer to being “defeated in a fight” apply only to defeats from the opposing Unit as a result of losing.
- **11.4.2.3.4** (rule): If a Unit loses a fight but an effect prevents it from being defeated in a fight, that Unit still loses the fight, it only ignores the resulting defeat.
- **11.4.2.4** (rule): The fight ends. Remove effects that apply “while fighting” and variations thereof.
- **11.4.3** (rule): After the fight ends, resolve all pending effects.
- **11.5** (rule): ### Steal
- **11.5.1** (rule): “Steal” is a game process in which you take control of one or more rival Gigs, such that they become friendly Gigs.
- **11.5.1.1** (rule): Whenever a Gig is stolen, there is an “actor” that steals it.
- **11.5.1.1.1** (rule): When a Unit or Legend attacks to steal a Gig, they are the actor, the one doing the stealing
- **11.5.1.1.2** (rule): If an effect specifies a different actor, the specified actor is the one that steals.
- **11.5.1.2** (rule): A Gig’s value can’t change during stealing. If an effect adjusts the Gig’s value, you must resolve it either before choosing the Gig(s), or after they change control.
- **11.5.1.3** (rule): Before selecting Gigs to steal, apply effects that last “while stealing” and variations thereof. Apply any other effects that modify, prevent, or restrict the attacker’s power or ability to steal.
- **11.5.1.4** (rule): Before moving any Gigs, select all the Gigs the actor steals from the rival Gig area.
- **11.5.1.4.1** (rule): You may choose to steal any Gig in the defending Gig area, regardless of its value.
- **11.5.1.4.2** (rule): If the actor is stealing multiple Gigs, choose the Gigs one at a time.
- **11.5.1.5** (rule): If a card effect prevents or restricts one or more selected Gigs from being stolen or triggers when a Gig “would be stolen,” resolve the effect after the Gig is selected, but before the Gig changes co…
- **11.5.1.6** (rule): After all Gigs are chosen and prevention effects are applied, the actor moves the Gig(s). You take control of the Gigs; they become friendly Gigs.
- **11.5.1.6.1** (rule): Move all chosen Gigs from the rival Gig area to the friendly Gig area at the same time.
- **11.5.1.6.2** (rule): If multiple Gigs are stolen at the same time, each Gig is considered a separate stolen Gig.
- **11.5.1.7** (rule): Effects that trigger when a Gig is stolen become pending after a stolen Gig is moved.
- **11.6** (rule): ### Defeat
- **11.6.1** (rule): “Defeat” is a game process in which you move a Unit, Legend, or Gear from the field or Legends area to your trash.
- **11.6.2** (rule): A defeated Unit is considered to be in the trash while resolving [DEFEATED] effects and any effects that trigger on a defeat. See [DEFEATED].
- **11.6.3** (rule): When a Unit or Legend is defeated, all of its equipped Gear moves with it to the trash.
- **11.6.3.1** (rule): When a Unit or Legend is defeated, its Gear is no longer equipped in the trash. Its Gear remains in the trash if an effect moves the Unit or Legend to a different area.
- **11.9.1.3** (rule): While a Gear is equipped to a Unit or Legend, it is located in the same game area as the Unit or Legend it's equipped to.
- **11.11.4.2** (rule): When you play a card for free, ignore effects that increase or reduce the amount you pay to play it.
- **11.15.3** (rule): If an effect tells you to bottom-deck a Program after you play it, bottom-deck it instead of moving it to the trash after resolving the effect.
- **11.16** (rule): ### Top-deck
- **11.16.1** (rule): “Top-deck” is a game action in which you place a card (or cards) on the top of your deck in a random order.
- **11.16.1.1** (rule): Place top-decked cards in the face-down position, in the same orientation as the rest of the deck cards. Top-decked cards should be indistinguishable from the rest of the deck.
- **11.16.1.2** (rule): You cannot top-deck a card you don’t own. If you would top-deck a card you don’t own, its owner top-decks it instead.
- **11.16.1.3** (rule): When you are made to top-deck multiple cards at the same time, you must randomize all of them together before placing them at the top of your deck. This includes any Units or Legends with Gears attach…
- **11.16.2** (rule): If an effect tells you to top-deck a group of cards “in any order,” forgo randomizing the cards and instead choose the order you place them on the top of your deck.
- **11.16.3** (rule): If an effect tells you to top-deck a Program after you play it, top-deck it instead of moving it to the trash after resolving the effect.
- **11.23.3** (rule): While resolving a Unit, Legend’s [DEFEATED] effects, use the information from when the piece was last on the field or in the Legend’s area, including its equipped state and power adjustments. > **EXAM…
- **11.28.3.1** (rule): A Unit can't redirect an attack to itself if it's already the target of that attack.

### Removed (36)

"Likely successor" names the added rule with the most similar text (word similarity >= 0.6); it is a hint for a reviewer, not a pairing.

- **5.8.2.1** (rule): When you sell a card, it enters the Eddies area face-down and ready.
- **6.7.1** (rule): Whenever a Gig is stolen, there is an “actor” that steals it. *Likely successor: 11.5.1.1 (similarity 1.00).*
- **6.7.1.1** (rule): When a Unit/Legend attacks to steal a Gig, they are the actor, the one doing the stealing *Likely successor: 11.5.1.1.1 (similarity 0.89).*
- **6.7.1.2** (rule): If card text specifies a different actor, the specified actor is the one that steals. *Likely successor: 11.5.1.1.2 (similarity 0.87).*
- **6.7.2** (rule): When you or a friendly actor steals one or more Gig(s), follow these steps in order.
- **6.7.2.1** (rule): Choose the rival Gig(s) to steal.
- **6.7.2.2** (rule): Move the Gig(s) to your Gig area.
- **6.7.2.2.1** (rule): When an actor steals multiple Gigs simultaneously, choose the Gigs first, then move them all at the same time.
- **6.7.2.3** (rule): You take control of the Gig(s). They become friendly Gigs.
- **6.7.3** (rule): If a card effect triggers when a Gig is stolen, resolve the effect after the Gig changes control.
- **6.7.4** (rule): If a card effect triggers when a Gig would be stolen, resolve the effect after the Gig is selected, but before the Gig changes control. > **EXAMPLE:** A Unit’s card text reads “When a rival Unit would… *Likely successor: 11.5.1.5 (similarity 0.92).*
- **6.7.5** (rule): A Gig’s value can’t change during stealing. If an effect adjusts the Gig’s value, you must resolve it either before choosing the Gig(s), or after the Gig(s) change control. *Likely successor: 11.5.1.2 (similarity 0.95).*
- **9.16.1** (rule): At the start of the Fight Step, apply effects that last “while fighting” and variations thereof. *Likely successor: 11.4.2.1 (similarity 0.69).*
- **9.17** (rule): A “fight” is a game process in which two opposing Units compare power to determine at least one loser and potentially one winner. *Likely successor: 11.4.1 (similarity 1.00).*
- **9.17.1** (rule): A Unit wins a fight when it has a higher power than the opposing Unit. *Likely successor: 11.4.1.1 (similarity 1.00).*
- **9.17.1.1** (rule): When a Unit wins a fight, the opposing Unit always loses, regardless of power. *Likely successor: 11.4.1.1.1 (similarity 1.00).*
- **9.17.2** (rule): A Unit loses a fight when it has equal or lower power than the opposing Unit. *Likely successor: 11.4.1.2 (similarity 1.00).*
- **9.17.3** (rule): If both Units in a fight have the same power, neither Unit wins and both Units lose the fight. *Likely successor: 11.4.1.3 (similarity 1.00).*
- **9.17.4** (rule): If a card effect says that a Unit wins or loses a fight, it supersedes any win or loss status determined by power comparison. *Likely successor: 11.4.1.4 (similarity 1.00).*
- **9.18** (rule): When you determine the loser(s), any effects triggered by the fight (i.e. “when this Unit fights,” “when this Unit loses a fight,” etc.) become pending. Both players must resolve all pending effects b… *Likely successor: 11.4.2.2.1 (similarity 0.70).*
- **9.19** (rule): After resolving all effects triggered by the fight, resolve the fight’s result.
- **9.19.1** (rule): When a Unit loses a fight, the opposing Unit defeats it as a result.
- **9.19.1.1** (rule): When a Unit is defeated, its owner moves it to their trash. *Likely successor: 11.6.3 (similarity 0.67).*
- **9.19.2** (rule): A Unit with 0 power cannot defeat a Unit as the result of a fight. *Likely successor: 11.4.2.3.2 (similarity 0.62).*
- **9.19.3** (rule): If an effect prevents a Unit from being defeated in a fight, it is still a loser that has lost the fight, it only ignores the resulting defeat. *Likely successor: 11.4.2.3.4 (similarity 0.67).*
- **9.23.1** (rule): At the start of the Steal Step, before choosing which Gigs are stolen, apply effects that last “while stealing” and variations thereof. Apply any other effects that modify, prevent, or restrict the at… *Likely successor: 11.5.1.3 (similarity 0.76).*
- **9.23.3** (rule): The attacking player chooses which Gigs the attacker will steal from the attacked Gig area.
- **9.23.3.1** (rule): An attacking player may choose to steal any Gig in the defending Gig area, regardless of its value. *Likely successor: 11.5.1.4.1 (similarity 0.88).*
- **9.23.3.2** (rule): If the attacker will steal multiple Gigs, the attacking player chooses the Gigs one at a time. *Likely successor: 11.5.1.4.2 (similarity 0.65).*
- **9.23.5** (rule): After all Gigs are chosen and prevention effects are applied, the attacker steals the Gig(s). *Likely successor: 11.5.1.6 (similarity 0.65).*
- **9.23.5.1** (rule): To steal the Gig(s), move all chosen Gigs from the defending Gig area to the attacking Gig area at the same time. *Likely successor: 11.5.1.6.1 (similarity 0.75).*
- **9.23.5.2** (rule): Multiple Gigs are stolen at the same time, each stolen Gig is considered a separate stolen Gig. *Likely successor: 11.5.1.6.2 (similarity 0.88).*
- **9.23.6** (rule): Effects that trigger when a Gig is stolen become pending after a stolen Gig is moved. *Likely successor: 11.5.1.7 (similarity 1.00).*
- **9.24** (rule): Resolve all pending effects. See EFFECTS > Pending Resolution.
- **9.25** (rule): After all pending effects from the Steal Step are resolved, the attack ends. See Ending an Attack.
- **11.15.3.1** (rule): If a [Spend Icon] effect also has a condition, the condition must be met at the time of activation and resolution.

### Renumbered (144)

| Old | New | Text also changed |
| --- | --- | --- |
| 3.9.2 | 3.9.4 |  |
| 5.8.2.2 | 5.8.2.1 |  |
| 5.8.2.3 | 5.8.2.2 | yes |
| 5.8.4 | 5.8.2.3 | yes |
| 6.4.5 | 6.4.3 |  |
| 6.4.3 | 6.5 | yes |
| 6.4.4 | 6.5.1 | yes |
| 6.5 | 6.6 |  |
| 6.5.1 | 6.6.1 |  |
| 6.6 | 6.7 |  |
| 6.6.1 | 6.7.1 |  |
| 6.6.2 | 6.7.2 |  |
| 6.7 | 6.8 | yes |
| 9.20 | 9.17 | yes |
| 9.21 | 9.18 |  |
| 9.22 | 9.19 |  |
| 9.23 | 9.20 |  |
| 9.23.2 | 9.20.1 |  |
| 9.23.2.1 | 9.20.1.1 | yes |
| 9.23.2.2 | 9.20.1.2 | yes |
| 9.23.3.3 | 9.20.1.3 |  |
| 9.23.4 | 9.20.2 | yes |
| 9.26 | 9.21 |  |
| 9.26.1 | 9.21.1 |  |
| 9.26.2 | 9.21.2 |  |
| 9.26.3 | 9.21.3 | yes |
| 9.26.4 | 9.21.4 |  |
| 9.27 | 9.22 |  |
| 9.27.1 | 9.22.1 |  |
| 9.27.2 | 9.22.2 |  |
| 9.28 | 9.23 |  |
| 9.29 | 9.24 |  |
| 10.1.1 | 10.1.2 |  |
| 10.1.2 | 10.1.3 |  |
| 10.1.3 | 10.1.4 |  |
| 10.1.4 | 10.1.6 |  |
| 11.4 | 11.7 |  |
| 11.4.1 | 11.7.1 |  |
| 11.4.1.1 | 11.7.1.1 |  |
| 11.4.1.2 | 11.7.1.2 |  |
| 11.4.2 | 11.7.2 |  |
| 11.4.3 | 11.7.3 |  |
| 11.5 | 11.8 |  |
| 11.5.1 | 11.8.1 |  |
| 11.5.2 | 11.8.2 |  |
| 11.5.2.1 | 11.8.2.1 |  |
| 11.5.2.2 | 11.8.2.2 |  |
| 11.5.2.3 | 11.8.2.3 |  |
| 11.6 | 11.9 |  |
| 11.6.1 | 11.9.1 |  |
| 11.6.1.1 | 11.9.1.1 | yes |
| 11.6.1.2 | 11.9.1.2 |  |
| 11.6.2 | 11.9.2 |  |
| 11.6.3 | 11.9.3 |  |
| 11.6.4 | 11.9.4 |  |
| 11.6.5 | 11.9.5 |  |
| 11.6.6 | 11.9.6 |  |
| 11.7 | 11.10 |  |
| 11.7.1 | 11.10.1 |  |
| 11.7.2 | 11.10.2 |  |
| 11.7.2.1 | 11.10.2.1 |  |
| 11.7.2.1.1 | 11.10.2.1.1 |  |
| 11.7.2.1.2 | 11.10.2.1.2 |  |
| 11.8 | 11.11 |  |
| 11.8.1 | 11.11.1 |  |
| 11.8.2 | 11.11.2 | yes |
| 11.8.3 | 11.11.3 | yes |
| 11.8.4 | 11.11.4 | yes |
| 11.8.4.1 | 11.11.4.1 | yes |
| 11.9 | 11.12 |  |
| 11.9.1 | 11.12.1 | yes |
| 11.9.1.1 | 11.12.1.1 |  |
| 11.9.1.2 | 11.12.1.2 |  |
| 11.9.2 | 11.12.2 |  |
| 11.9.2.1 | 11.12.2.1 |  |
| 11.9.2.2 | 11.12.2.2 |  |
| 11.10 | 11.13 |  |
| 11.10.1 | 11.13.1 |  |
| 11.11 | 11.14 |  |
| 11.11.1 | 11.14.1 |  |
| 11.11.1.1 | 11.14.1.1 |  |
| 11.11.1.2 | 11.14.1.2 |  |
| 11.11.1.3 | 11.14.1.3 |  |
| 11.11.1.4 | 11.14.1.4 |  |
| 11.11.2 | 11.14.2 |  |
| 11.11.2.1 | 11.14.2.1 |  |
| 11.11.2.2 | 11.14.2.2 |  |
| 11.12 | 11.15 |  |
| 11.12.1 | 11.15.1 |  |
| 11.12.1.1 | 11.15.1.1 |  |
| 11.12.1.2 | 11.15.1.2 |  |
| 11.12.1.3 | 11.15.1.3 |  |
| 11.12.2 | 11.15.2 |  |
| 11.13 | 11.17 |  |
| 11.13.1 | 11.17.1 |  |
| 11.13.1.1 | 11.17.1.1 |  |
| 11.13.2 | 11.17.2 |  |
| 11.13.3 | 11.17.3 |  |
| 11.13.4 | 11.17.4 |  |
| 11.13.4.1 | 11.17.4.1 |  |
| 11.14 | 11.18 |  |
| 11.14.1 | 11.18.1 |  |
| 11.14.2 | 11.18.2 |  |
| 11.14.3 | 11.18.3 |  |
| 11.14.4 | 11.18.4 |  |
| 11.15 | 11.19 |  |
| 11.15.1 | 11.19.1 | yes |
| 11.15.2 | 11.19.2 | yes |
| 11.15.3 | 11.19.3 |  |
| 11.15.3.2 | 11.19.3.1 | yes |
| 11.16 | 11.20 |  |
| 11.16.1 | 11.20.1 |  |
| 11.16.1.1 | 11.20.1.1 |  |
| 11.17 | 11.21 | yes |
| 11.18 | 11.22 |  |
| 11.18.1 | 11.22.1 |  |
| 11.18.2 | 11.22.2 | yes |
| 11.19 | 11.23 |  |
| 11.19.1 | 11.23.1 | yes |
| 11.19.2 | 11.23.2 | yes |
| 11.20 | 11.24 |  |
| 11.20.1 | 11.24.1 |  |
| 11.20.2 | 11.24.2 | yes |
| 11.21 | 11.25 |  |
| 11.21.1 | 11.25.1 |  |
| 11.21.2 | 11.25.2 | yes |
| 11.21.2.1 | 11.25.2.1 | yes |
| 11.21.2.2 | 11.25.2.2 |  |
| 11.22 | 11.26 |  |
| 11.23 | 11.27 |  |
| 11.23.1 | 11.27.1 |  |
| 11.23.2 | 11.27.2 |  |
| 11.24 | 11.28 |  |
| 11.24.1 | 11.28.1 |  |
| 11.24.2 | 11.28.2 |  |
| 11.24.3 | 11.28.3 |  |
| 11.25 | 11.29 |  |
| 11.25.1 | 11.29.1 |  |
| 11.26 | 11.30 |  |
| 11.26.1 | 11.30.1 |  |
| 11.26.1.1 | 11.30.1.1 |  |
| 11.26.1.2 | 11.30.1.2 |  |
| 11.26.2 | 11.30.2 |  |
| 11.26.3 | 11.30.3 |  |

### Number reused for a different rule (89)

Each number below exists in both snapshots but names a different rule now.

- **3.9.2** was: A card’s subtitle is not part of its name. / now: When a card refers to its own name, assume it’s referring to itself (not another card of the same name).
- **5.8.2.1** was: When you sell a card, it enters the Eddies area face-down and ready. / now: There is no limit on the number of Eddies you may have in your Eddies area.
- **5.8.2.2** was: There is no limit on the number of Eddies you may have in your Eddies area. / now: Once per turn during your Main phase, you may reveal and sell a card with a Sell Tag from your hand. See Sell a Card.
- **5.8.2.3** was: During your Main Phase, you may sell a card with a Sell Tag from your hand as an action. See Sell a Card. / now: There is no limit to the number of cards you may Sell through card effects in a turn. (Only the Main phase Sell action i…
- **6.4.3** was: “Set” a Gig by adjusting it to a specific value. / now: A Gig’s value cannot be adjusted to the value it already has. If an effect tells you to do so, the effect fails. > **EXA…
- **6.5** was: A value-pair is 2 dice with the same value in the same Gig area. / now: “Set” a Gig by changing its face a specific value.
- **6.5.1** was: A Gig can only count towards a single value-pair at a time. > **EXAMPLE:** A Unit’s card text reads “Draw 1 for each fri… / now: You cannot set a Gig to a value that isn’t on its face (i.e. set a d6 to 8).
- **6.6** was: To swap a Gig is to choose a friendly Gig die and a rival Gig die, then move the friendly Gig die to the rival Gig area… / now: A value-pair is 2 dice with the same value in the same Gig area.
- **6.6.1** was: The values on both Gigs remain the same throughout the swap, and cannot be adjusted during it. / now: A Gig can only count towards a single value-pair at a time. > **EXAMPLE:** A Unit’s card text reads “Draw 1 for each fri…
- **6.7** was: To steal a Gig is to take control of a rival Gig, such that it becomes a friendly Gig. / now: To swap a Gig is to choose a friendly Gig die and a rival Gig die, then move the friendly Gig die to the rival Gig area…
- **6.7.1** was: Whenever a Gig is stolen, there is an “actor” that steals it. / now: The values on both Gigs remain the same throughout the swap, and cannot be adjusted during it.
- **6.7.2** was: When you or a friendly actor steals one or more Gig(s), follow these steps in order. / now: A swap is not considered stealing, and doesn’t trigger any effects related to stealing.
- **9.17** was: A “fight” is a game process in which two opposing Units compare power to determine at least one loser and potentially on… / now: After the fight, resolve all pending effects. Then, the Fight Step and the attack end. See ATTACK, FIGHT, AND STEAL > En…
- **9.18** was: When you determine the loser(s), any effects triggered by the fight (i.e. “when this Unit fights,” “when this Unit loses… / now: The Steal Step only happens if the attack target is a Gig area. If the attack target is a Unit, the Fight Step happens i…
- **9.19** was: After resolving all effects triggered by the fight, resolve the fight’s result. / now: If the attacked Gig area has no Gigs in it when the Steal Step begins, no Gigs can be or are stolen.
- **9.20** was: After resolving all effects triggered by the fight’s result, the Fight Step and the attack ends. See ATTACK, FIGHT, AND… / now: During the “Steal Step” of an attack, the attacker attempts to steal one or more Gig dice from the defending Gig area.
- **9.21** was: The Steal Step only happens if the attack target is a Gig area. If the attack target is a Unit, the Fight Step happens i… / now: An attack ends if any of the following are true:
- **9.22** was: If the attacked Gig area has no Gigs in it when the Steal Step begins, no Gigs can be or are stolen. / now: An attack can end before reaching the React Step, Fight Step or Steal Step.
- **9.23** was: During the “Steal Step” of an attack, the attacker attempts to steal one or more Gig dice from the defending Gig area. / now: When an attack ends, resolve any pending effects that are already pending for the current timing window.
- **9.24** was: Resolve all pending effects. See EFFECTS > Pending Resolution. / now: After an attack ends and all effects and pending effects for the current timing window have resolved, remove effects tha…
- **10.1.1** was: Within card text, a line break indicates the end of the effect text. / now: If a card’s effect text is unclear based on the official rules, refer to the FAQ on its official card database page.
- **10.1.2** was: Each separate paragraph on a card is considered a single effect. / now: Within card text, a line break indicates the end of the effect text.
- **10.1.3** was: When an effect refers to “this card,” “this Unit,” “this Legend,” “this Gear,” or another similar phrase, it refers to t… / now: Each separate paragraph on a card is considered a single effect.
- **10.1.4** was: If you control the source of an effect, it is considered “your” effect. You are the one who resolves it. / now: When an effect refers to “this card,” “this Unit,” “this Legend,” “this Gear,” or another similar phrase, it refers to t…
- **11.4** was: ### Play / now: ### Fight
- **11.4.1** was: To play a card, reveal it, pay its cost, and then follow the rules for playing that specific card type detailed in CARD… / now: A “fight” is a game process in which two opposing Units compare power to determine at least one loser and potentially on…
- **11.4.1.1** was: If you can’t pay for or follow the rules for playing the card, you cannot play it. It’s considered “invalid” to play. / now: A Unit wins a fight when it has a higher power than the opposing Unit.
- **11.4.1.2** was: If you play or attempt to play an invalid card, undo the play attempt and return the game to the previous legal game sta… / now: A Unit loses a fight when it has equal or lower power than the opposing Unit.
- **11.4.2** was: You can only play cards from your hand unless an effect instructs otherwise. / now: A fight proceeds in this order.
- **11.4.3** was: Effects that allow a player to play a card follows the normal rules for playing that card unless the effect instructs ot… / now: After the fight ends, resolve all pending effects.
- **11.5** was: ### Draw / now: ### Steal
- **11.5.1** was: “Draw” is a game action in which you move the top card of your deck to your hand. / now: “Steal” is a game process in which you take control of one or more rival Gigs, such that they become friendly Gigs.
- **11.6** was: ### Equip / now: ### Defeat
- **11.6.1** was: “Equip” is a game action in which you attach a Gear to a Unit or Legend by placing the card beneath it. When you do, the… / now: “Defeat” is a game process in which you move a Unit, Legend, or Gear from the field or Legends area to your trash.
- **11.6.2** was: A Unit or Legend with one or more Gears attached is “equipped.” / now: A defeated Unit is considered to be in the trash while resolving [DEFEATED] effects and any effects that trigger on a de…
- **11.6.3** was: A Unit or Legend with no Gear attached is “unequipped.” / now: When a Unit or Legend is defeated, all of its equipped Gear moves with it to the trash.
- **11.7** was: ### Trash / now: ### Play
- **11.7.1** was: When used as a location, “trash” refers to the “Trash area” of the game board. See Trash Area. / now: To play a card, reveal it, pay its cost, and then follow the rules for playing that specific card type detailed in CARD…
- **11.7.2** was: When used as an instruction, “trash” refers to the game action in which you reveal the top card of your deck and move it… / now: You can only play cards from your hand unless an effect instructs otherwise.
- **11.8** was: ### Pay / now: ### Draw
- **11.8.1** was: “Pay” is a game action in which you spend a number of Eddies and/or Legends in the Legends area equal to a cost. / now: “Draw” is a game action in which you move the top card of your deck to your hand.
- **11.8.2** was: Effects that reduce the amount you pay to play a card or activate an effect do not change the card’s cost value, nor the… / now: When an effect says “Draw X” (where X is a number), take the draw action X number of times. Literally, it means “move th…
- **11.9** was: ### Sell / now: ### Equip
- **11.9.1** was: “Sell” is a game action in which you turn a card into an Eddie by revealing it to your Rival and placing it face-down in… / now: “Equip” is a game action in which you attach a Gear to a Unit or Legend by placing the card beneath it. When you do, the…
- **11.9.1.1** was: When you sell a card, it enters the Eddies area face-down and ready. See Eddies Area. / now: When a Gear is equipped, make sure only the bottom text box is showing under the equipped card.
- **11.9.1.2** was: If you would sell multiple cards at the same time, you must sell each card individually. / now: Gear stays equipped unless it (or the Unit/Legend it’s equipped to) is defeated or moves outside of the Legends area or…
- **11.9.2** was: During your Main Phase, you may sell a card with a Sell Tag from your hand as an action. See Sell a Card. / now: A Unit or Legend with one or more Gears attached is “equipped.”
- **11.10** was: ### Flip / now: ### Trash
- **11.10.1** was: “Flip” is a game action in which you take a card in a face-down and turn it to the face-up position, or vice versa. / now: When used as a location, “trash” refers to the “Trash area” of the game board. See Trash Area.
- **11.11** was: ### Call a Legend / now: ### Pay
- **11.11.1** was: “Call a Legend” is a game action in which you pay 1 €$ to flip a face-down Legend face-up. / now: “Pay” is a game action in which you spend a number of Eddies and/or Legends in the Legends area equal to a cost.
- **11.11.2** was: You may only Call a Legend once per turn. / now: Effects that increase or reduce the amount you pay to play a card or activate an effect do not change the card’s cost va…
- **11.12** was: ### Bottom-deck / now: ### Sell
- **11.12.1** was: “Bottom-deck” is a game action in which you place a card (or cards) on the bottom of your deck in a random order. / now: “Sell” is a game action in which you turn a card into an Eddie by placing it face-down in the Eddies area.
- **11.12.1.1** was: Place bottom-decked cards in the face-down position, in the same orientation as the rest of the deck cards. Bottom-decke… / now: When you sell a card, it enters the Eddies area face-down and ready. See Eddies Area.
- **11.12.1.2** was: You cannot bottom-deck a card you don’t own. If you would bottom-deck a card you don’t own, its owner bottom-decks it in… / now: If you would sell multiple cards at the same time, you must sell each card individually.
- **11.12.2** was: If an effect tells you to bottom-deck a group of cards “in any order,” forgo randomizing the cards and instead choose th… / now: During your Main Phase, you may sell a card with a Sell Tag from your hand as an action. See Sell a Card.
- **11.13** was: ### Search / now: ### Flip
- **11.13.1** was: “Search” is a game action in which you look at a designated amount of cards. / now: “Flip” is a game action in which you take a card in a face-down and turn it to the face-up position, or vice versa.
- **11.14** was: ### Reveal / now: ### Call a Legend
- **11.14.1** was: "Reveal" is a game action in which you show designated cards to your Rival. / now: “Call a Legend” is a game action in which you pay 1 €$ to flip a face-down Legend face-up.
- **11.14.2** was: Revealing a card is not removing it from the designated area unless specified after effect resolution. (Such as adding a… / now: You may only Call a Legend once per turn.
- **11.15** was: ### [Spend Icon] (Spend Icon) / now: ### Bottom-deck
- **11.15.1** was: The [Spend Icon] symbol is shorthand for an activation cost. It means: “Spend this Unit or Legend to activate the follow… / now: “Bottom-deck” is a game action in which you place a card (or cards) on the bottom of your deck in a random order.
- **11.15.2** was: To activate a [Spend Icon] effect, you must spend the card with the express purpose of paying its activation cost. When… / now: If an effect tells you to bottom-deck a group of cards “in any order,” forgo randomizing the cards and instead choose th…
- **11.15.3** was: After paying the cost to use a [Spend Icon] effect, immediately resolve the effect. / now: If an effect tells you to bottom-deck a Program after you play it, bottom-deck it instead of moving it to the trash afte…
- **11.16** was: ### X €$ / now: ### Top-deck
- **11.16.1** was: “X €$” (where X is a number) denotes Eddies and/or Legends spent to pay a cost. / now: “Top-deck” is a game action in which you place a card (or cards) on the top of your deck in a random order.
- **11.16.1.1** was: When bolded and preceding a colon, before the effect text, it represents an activation cost (or part of an activation co… / now: Place top-decked cards in the face-down position, in the same orientation as the rest of the deck cards. Top-decked card…
- **11.17** was: Trigger keywords are a shorthand for specific conditions. When those conditions are met, the effect associated with it a… / now: ### Search
- **11.18** was: ### [CALL] / now: ### Reveal
- **11.18.1** was: The [CALL] trigger is shorthand for “When you flip this Legend face-up through the ‘Call a Legend’ action, [...]” / now: "Reveal" is a game action in which you show designated cards to your Rival.
- **11.18.2** was: The effect attached to the [CALL] trigger enters pending when you reveal the Called Legend. / now: Revealing a card is not removing it from the designated area unless specified after effect resolution. (Such as adding a…
- **11.19** was: ### [DEFEATED] / now: ### [Spend Icon] (Spend Icon)
- **11.19.1** was: The [DEFEATED] trigger is shorthand for ”When this Unit is defeated, [...]” / now: The [Spend Icon] symbol is shorthand for an activation cost. It means: “Spend this Unit or Legend to activate the follow…
- **11.19.2** was: The effect attached to the [DEFEATED] trigger enters pending when the Unit has been declared defeated and is moved to tr… / now: To activate a [Spend Icon] effect, you must spend the card with the express purpose of paying its activation cost. When…
- **11.20** was: ### [PLAY] / now: ### X €$
- **11.20.1** was: The [PLAY] trigger is shorthand for “When you play this card, [...]” / now: “X €$” (where X is a number) denotes Eddies and/or Legends spent to pay a cost.
- **11.21** was: ### [ATTACK] / now: Trigger keywords are a shorthand for specific conditions. When those conditions are met, the effect associated with it a…
- **11.22** was: Effect keywords are a shorthand for specific effects. / now: ### [CALL]
- **11.23** was: ### [ADRENALINE] / now: ### [DEFEATED]
- **11.23.1** was: The [ADRENALINE] keyword is shorthand for “This Unit can attack the turn it's played.” / now: The [DEFEATED] trigger is shorthand for ”When this Unit, Legend, or Gear is defeated, [...]”
- **11.23.2** was: Units with [ADRENALINE] may attack even if they’re lagging. All other criteria for valid attack targets still apply. See… / now: The effect attached to the [DEFEATED] trigger becomes pending when the Unit has been declared defeated moves to trash. S…
- **11.24** was: ### [BLOCKER] / now: ### [PLAY]
- **11.24.1** was: The [BLOCKER] keyword is shorthand for “When a rival Unit attacks, you may spend this Unit to redirect the attack to it… / now: The [PLAY] trigger is shorthand for “When you play this card, [...]”
- **11.24.2** was: Activate [BLOCKER] as a reaction during the React Step of your Rival’s attack action. / now: The effect attached to the [PLAY] trigger becomes pending when you meet all the requirements when playing that card type…
- **11.25** was: ### [GO SOLO] / now: ### [ATTACK]
- **11.25.1** was: The [GO SOLO] keyword is shorthand for “Pay this Legend's cost to play it as a ready Unit. It can attack this turn. If i… / now: The [ATTACK] trigger is shorthand for “When this Unit attacks, [...]”
- **11.26** was: ### [QUICK] / now: Effect keywords are a shorthand for specific effects.

### Re-anchored, paired by number (0)

None.

### Text changed (44)

#### 2.10.1 (rule)

Old:

> … is treated as 0 for all references and comparisons of values.
> 
> > **EXAMPLE:** A Unit has 2 power. An effect reduces its power by 3. The Unit has -1 power, but is treated as having 0 power when attacking, fighting, or when a card effect references its power. If it then gains +2 power, that Unit has 1 power. The order of these effects being applied does not alter this outcome.

New:

> … is treated as 0 for all references and comparisons of values.
> 
> > **EXAMPLE:** A Unit has power 2. An effect gives it -3 power. The Unit has power -1, but is treated as having power 0 when attacking, fighting, or when a card effect references its power. If it then gains +2 power, that Unit has power 1. The order of these effects being applied does not alter this outcome.

#### 4.4.2 (rule)

Old:

> If a Legend moves to an invalid area, any effects that trigger from the card entering the area enter pending. Remove the Legend from the game before you resolve them. See GAME AREAS > Removed from Game.

New:

> If a Legend moves to an invalid area, any effects that trigger from the card entering the area become pending. Remove the Legend from the game before you resolve them. See GAME AREAS > Removed from Game.

#### 4.12.1 (rule)

Old:

> When a Gear moves with a Unit or Legend to an area outside of the field or Legends area, the Gear isn’t equipped to the Unit or Legend in that area.
> 
> >…

New:

> When a Gear moves with a Unit or Legend to an area other than the field or Legends area, the Gear isn’t equipped to the Unit or Legend in that area.
> 
> >…

#### 4.12.2 (rule)

Old:

> If an equipped Legend moves to an area outside of the Field or Legends area, the Gear follows the Legend to the new area. The Gear is no longer equipped in the new area, so it stays there when you remove the Legend from play.

New:

> If an equipped Legend moves to an area other than the Field or Legends area, the Gear follows the Legend to the new area. The Gear is no longer equipped in the new area, so it stays there when you remove the Legend from play.

#### 5.7.4.3 (rule)

Old:

> If an effect asks you to look at a face-down legend, you cannot look at it again once that effect has resolved, unless otherwise specified.

New:

> If an effect asks you to look at a face-down Legend, you cannot look at it again once that effect has resolved, unless otherwise specified.

#### 5.7.6 (rule, largely rewritten, similarity 0.24)

Old:

> A Legend in the Legend area may use its [Spend Icon] at any point it is face-up in the Legend’s area.

New:

> While a Legend is face-up in the Legends area, you may activate its [Spend Icon] effect during your main phase.

#### 5.8.2.3 -> 5.8.2.2 (rule)

Old:

> During your Main Phase, you may sell a card with a Sell Tag from your hand as an action. See Sell a Card.

New:

> Once per turn during your Main phase, you may reveal and sell a card with a Sell Tag from your hand. See Sell a Card.

#### 5.8.4 -> 5.8.2.3 (rule, largely rewritten, similarity 0.39)

Old:

> During your turn you may Sell as many cards you want through card effects, but may only take the main phase Sell action once per turn.

New:

> There is no limit to the number of cards you may Sell through card effects in a turn. (Only the Main phase Sell action is limited to once per turn.)

#### 5.11.3 (rule)

Old:

> The Gigs in the friendly Gig area are under your control, and are friendly Gigs. Their values count towards your Street Cred. See GIGS.

New:

> The Gigs in the friendly Gig area are under your control, and are friendly Gigs. Their values count towards your total Street Cred. See GIGS.

#### 6.4 (rule)

Old:

> Adjust a Gig by changing its value.

New:

> Adjust a Gig by incrementing or decrementing its value.

#### 6.4.3 -> 6.5 (rule)

Old:

> “Set” a Gig by adjusting it to a specific value.

New:

> “Set” a Gig by changing its face a specific value.

#### 6.4.4 -> 6.5.1 (rule)

Old:

> You cannot adjust a Gig to a value that isn’t on its face. (i.e. set a d6 to 8). If an effect tells you to do so, the effect fails.

New:

> You cannot set a Gig to a value that isn’t on its face (i.e. set a d6 to 8).

#### 6.7 -> 6.8 (rule)

Old:

> To steal a Gig is to take control of a rival Gig, such that it becomes a friendly Gig.

New:

> To steal a Gig is to take control of a rival Gig, such that it becomes a friendly Gig. See Steal.

#### 7.6.2 (rule)

Old:

> When both players finish shuffling, present your deck to your Rival. Your Rival may “cut the deck” for you, if they choose.

New:

> When both players finish shuffling, present your deck to your Rival. Your Rival may cut or shuffle the deck for you, if they choose.

#### 7.7.2 (rule)

Old:

> When both players finish shuffling, present your Legends face-down to your Rival. Your Rival may “cut the deck” of Legends for you, if they choose.

New:

> When both players finish shuffling, present your Legends face-down to your Rival. Your Rival may cut or shuffle of Legends for you, if they choose.

#### 8.11 (rule)

Old:

> ### Sell a Card
> 
> As an action during your Main phase, you may “Sell a Card.”; sell 1 card from your hand with a Sell Tag in the top-left corner. See Sell.

New:

> ### Sell for Turn
> 
> As an action during your Main phase, you may “Sell for Turn”; reveal a card from your hand with a Sell Tag in the top-left corner, then sell it. See Sell.

#### 8.11.1 (rule)

Old:

> You may only take the “Sell a Card” game action once per turn.

New:

> You may only take the “Sell for Turn” action once per turn.

#### 8.14 (rule)

Old:

> ### Activate an Effect
> 
> As an action during your Main phase, you may activate any activated effects on friendly Units or Legends. They may be used during the open state of the main phase. For the full rules on activating effects, see EFFECTS > Activated Effects.

New:

> ### Activate an Effect
> 
> As an action during your Main phase, you may activate any activated effects on friendly Units or Legends. They may be used during the open state of the Main phase. For the full rules on activating effects, see EFFECTS > Activated Effects.

#### 9.16 (rule)

Old:

> During the “Fight Step” of an attack, the attacking Unit and the defending Unit fight.

New:

> During the “Fight Step” of an attack, the attacking Unit and the defending Unit fight. See Fight.

#### 9.20 -> 9.17 (rule)

Old:

> After resolving all effects triggered by the fight’s result, the Fight Step and the attack ends. See ATTACK, FIGHT, AND STEAL > Ending an Attack.

New:

> After the fight, resolve all pending effects. Then, the Fight Step and the attack end. See ATTACK, FIGHT, AND STEAL > Ending an Attack.

#### 9.23.2.1 -> 9.20.1.1 (rule)

Old:

> If the attacking Unit has 0 power, it steals 0 Gigs.

New:

> If the attacking Unit has power 0, it steals 0 Gigs.

#### 9.23.2.2 -> 9.20.1.2 (rule)

Old:

> If the attacking Unit has 1 or more power, it steals X Gigs (rounded down) according to this formula, where P = the attacking Unit’s power.
> 
> `X = (P / 10) + 1)`
> 
> > **EXAMPLE:** A Unit with 1 to 9 power steals 1 Gig. A Unit with 10 to 19 power steals 2 Gigs. Continue this pattern for higher power values.

New:

> If the attacking Unit has power 1+, it steals X Gigs (rounded down) according to this formula, where P = the attacking Unit’s power.
> 
> `X = (P / 10) + 1)`
> 
> > **EXAMPLE:** A Unit with power 1 to 9 steals 1 Gig. A Unit with power 10 to 19 steals 2 Gigs. Continue this pattern for higher power values.

#### 9.23.4 -> 9.20.2 (rule, largely rewritten, similarity 0.10)

Old:

> After all Gigs are chosen, apply any effects that prevent or restrict one or more of those Gigs from being stolen.

New:

> After stealing Gigs, resolve all pending effects. Then, the Steal Step and the attack end. See Ending an Attack.

#### 9.26.3 -> 9.21.3 (rule)

Old:

> The attack target is no longer a legal attack target for the attacking Unit.

New:

> The attack target is no longer a valid attack target for the attacking Unit.

#### 10.2.4 (rule)

Old:

> Effects cannot interrupt the activation or resolution of other effects. If an effect triggers in the middle of an activation or resolution, it becomes “pending resolution.” See EFFECTS > Pending Resolution.

New:

> Effects cannot interrupt the activation or resolution of other effects. If an effect triggers in the middle of an activation or resolution, it becomes “pending resolution.” See Pending Resolution.

#### 10.3 (rule)

Old:

> An effect may include conditions. A “condition” is a requirement that must be true for an effect to apply, become pending, and resolve. (Conditions are often “if” or “when” clauses.)

New:

> An effect may include conditions. A “condition” is a requirement that must be true for an effect to apply. (Conditions are often “if” or “when” clauses.)

#### 10.4 (rule)

Old:

> There are four types of effects: triggered effects, activated effects, permanent effects, and replacement effects.

New:

> There are four types of effects: triggered effects, activated effects, persistent effects, and replacement effects.

#### 10.14.1 (rule)

Old:

> If both players have a new effect enter pending while resolving an effect, the player currently resolving pending effects finishes resolving all of their pending effects (including the new ones) before their Rival resolves their new ones.

New:

> If both players have a new effect become pending while resolving an effect, the player currently resolving pending effects finishes resolving all of their pending effects (including the new ones) before their Rival resolves their new ones.

#### 11.6.1.1 -> 11.9.1.1 (rule)

Old:

> When a Gear is equipped make sure only the bottom text box is showing under the equipped card.

New:

> When a Gear is equipped, make sure only the bottom text box is showing under the equipped card.

#### 11.8.2 -> 11.11.2 (rule)

Old:

> Effects that reduce the amount you pay to play a card or activate an effect do not change the card’s cost value, nor the activation cost value.

New:

> Effects that increase or reduce the amount you pay to play a card or activate an effect do not change the card’s cost value, nor the activation cost value.

#### 11.8.3 -> 11.11.3 (rule)

Old:

> Effects that reduce the amount you pay to play a card or activate an effect cannot reduce the amount below 1.

New:

> Effects that reduce the amount you pay to play a card cannot reduce the amount below 1 €$.

#### 11.8.4 -> 11.11.4 (rule)

Old:

> When you play a card “for Free,” play the card without paying its cost.

New:

> When you play a card “for free,” play the card without paying its cost.

#### 11.8.4.1 -> 11.11.4.1 (rule)

Old:

> When playing a card for free, you must still meet any additional conditions outside of the cost.

New:

> When you play a card for free, you must still meet any additional conditions outside of the cost.

#### 11.9.1 -> 11.12.1 (rule)

Old:

> “Sell” is a game action in which you turn a card into an Eddie by revealing it to your Rival and placing it face-down in the Eddies area.

New:

> “Sell” is a game action in which you turn a card into an Eddie by placing it face-down in the Eddies area.

#### 11.15.1 -> 11.19.1 (rule)

Old:

> …endly Unit has the effect “[Spend Icon] Draw 1.” The [Spend Icon] symbol is an activation trigger. You must specifically spend this Unit as a cost. If you do, you draw a card.

New:

> …endly Unit has the effect “[Spend Icon] Draw 1.” The [Spend Icon] symbol is an activation cost. You must specifically spend this Unit to pay for this effect. If you do, you draw a card.

#### 11.15.2 -> 11.19.2 (rule)

Old:

> To activate a [Spend Icon] effect, you must spend the card with the express purpose of paying its activation cost. When you spend a Unit or Legend with this symbol for any other reason, it does not trigger the [Spend Icon] effect.

New:

> To activate a [Spend Icon] effect, you must spend the card with the express purpose of paying its activation cost. When you spend a Unit or Legend with this symbol for any other reason, it does not activate the [Spend Icon] effect.

#### 11.15.3.2 -> 11.19.3.1 (rule)

Old:

> If additional effects conditions are met in the process of using a [Spend Icon:] effect, resolve the [Spend Icon] effect, then resolve any other pending effects.

New:

> If additional effects conditions are met in the process of using a [Spend Icon] effect, resolve the [Spend Icon] effect first, then resolve any other pending effects.

#### 11.17 -> 11.21 (rule)

Old:

> Trigger keywords are a shorthand for specific conditions. When those conditions are met, the effect associated with it automatically enters pending.
> 
> > **EXAMPLE:** A friendly Unit has the effect “[ATTACK] Draw 1.” [ATTACK] is a timing trigger. Whenever this Unit attacks, you draw a card.

New:

> Trigger keywords are a shorthand for specific conditions. When those conditions are met, the effect associated with it automatically becomes pending.
> 
> > **EXAMPLE:** A friendly Unit has the effect “[ATTACK] Draw 1.” [ATTACK] is a timing trigger. Whenever this Unit attacks, you draw a card.

#### 11.18.2 -> 11.22.2 (rule)

Old:

> The effect attached to the [CALL] trigger enters pending when you reveal the Called Legend.

New:

> The effect attached to the [CALL] trigger becomes pending when you reveal the Called Legend.

#### 11.19.1 -> 11.23.1 (rule)

Old:

> The [DEFEATED] trigger is shorthand for ”When this Unit is defeated, [...]”

New:

> The [DEFEATED] trigger is shorthand for ”When this Unit, Legend, or Gear is defeated, [...]”

#### 11.19.2 -> 11.23.2 (rule)

Old:

> The effect attached to the [DEFEATED] trigger enters pending when the Unit has been declared defeated and is moved to trash.

New:

> The effect attached to the [DEFEATED] trigger becomes pending when the Unit has been declared defeated moves to trash. See Defeat.

#### 11.20.2 -> 11.24.2 (rule)

Old:

> The effect attached to the [PLAY] trigger enters pending when you meet all the requirements when playing that card type. See CARD TYPES.

New:

> The effect attached to the [PLAY] trigger becomes pending when you meet all the requirements when playing that card type. See CARD TYPES.

#### 11.21.2 -> 11.25.2 (rule)

Old:

> The effect attached to the [ATTACK] trigger enters pending when you spend the Unit for the purpose of declaring an attack.

New:

> The effect attached to the [ATTACK] trigger becomes pending when you spend the Unit for the purpose of declaring an attack.

#### 11.21.2.1 -> 11.25.2.1 (rule)

Old:

> Any effects triggered by spending this Unit enter pending at the same time as any [ATTACK] effect(s). See EFFECTS.

New:

> Any effects triggered by spending this Unit become pending at the same time as any [ATTACK] effect(s). See EFFECTS.
