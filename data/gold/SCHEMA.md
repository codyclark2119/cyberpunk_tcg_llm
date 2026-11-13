# Gold set schema (generic, game-agnostic template)

This is the **one** gold-data schema this template ships. It is deliberately
generic across games -- a citation-based rules game (Magic, One Piece TCG)
and a game with no numbered rulebook can both use it -- rather than each game
inventing its own fields. Add a field only if a game genuinely needs one, and
document it here as an *additive* extension so other games' tooling can keep
ignoring it safely.

One JSON object per line in `data/gold/gold_questions.jsonl`.

## Why a rubric instead of one reference answer

Scoring a model's answer against a single prose reference answer has two
common failure modes: the judge rewards length, and two
independent judges agree only weakly, because "how similar is this to my one
phrasing?" has no objective answer.

`key_points` and `common_errors` replace that with something checkable: *did
the response assert these facts, and did it avoid these mistakes?* That is
length-neutral by construction (a one-line answer hitting every key point
scores full marks) and far more reproducible across judges.

## Writing good key_points

1. **Fold the verdict into a substantive claim.** Never a bare `"Yes"`,
   `"No"`, or a single noun as point 1 -- write out what is actually true, so
   an answer cannot score on its opening word alone.
2. **One atomic, independently checkable assertion per point.** A point that
   bundles multiple claims with "and"/"so" cannot be answered yes/no, and
   that is exactly where two judges will diverge.
3. **Cut scaffolding.** Prefer 2-4 sharp points over 5-8 soft ones. A point
   true of every instance of the mechanic (rather than this specific
   situation) discriminates nothing.
4. **`common_errors` should encode the real trap**, not the negation of a key
   point. Negating a key point adds nothing the key point did not already
   catch.
5. **Write a `common_error` as the false CLAIM, not as the player's
   behaviour.** The judge is asked the same extraction question about both
   lists -- *which of these did the candidate assert?* -- and that question
   is only answerable when the entry is itself a sentence a wrong answer
   could contain verbatim.

   | Don't (behaviour) | Do (claim) |
   | --- | --- |
   | Thinks the effect blocks all the damage | The effect blocks all the damage |
   | Plays card X, spending a resource to save a small amount of life | Playing card X here is worth the life cost |
   | Holds a removal spell for a better target | Holding the removal spell for a better target is correct here |

   The test: **could a wrong answer contain this sentence verbatim?** If not,
   it is a description of a mistake rather than the mistake itself.

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | stable slug, e.g. `combat-lethal-damage-01`. Never reuse. |
| `question` | yes | the question as a **player** would ask it -- natural, first-person, messy is fine |
| `paraphrases` | no | other natural phrasings of the *same* question; used to test robustness to wording |
| `answer` | yes | the ruling in the judge's own words, 1-4 sentences |
| `key_points` | yes | list of assertions a correct answer **must** contain. Scoring unit. |
| `common_errors` | no | wrong beliefs a response must **not** assert |
| `citations` | yes if the game has a numbered rulebook | citation ids supporting the ruling (e.g. rule/section numbers), validated against the pinned rules corpus. Generic name so a citation-less game can simply omit it. |
| `entities` | no | named game entities referenced (cards, units, characters, ...), validated against that game's card/entity database. |
| `category` | yes | one of this game's defined categories (see the validator) |
| `difficulty` | yes | `basic` \| `intermediate` \| `advanced` |
| `format_context` | no | e.g. a specific match format, if rulings differ by format |
| `source` | yes | `judge:<name-or-initials>`, `<community-source>:<url>`, `official-ruling`, `rules-derived` |
| `verified_by` | no | second reviewer who confirmed it -- mark disputed rulings clearly |
| `rules_version` | yes | the pinned rules-corpus version this was checked against (this game's analog of a comprehensive-rules effective date) |
| `notes` | no | edge cases, why players get it wrong, related interactions |

## Isolation from other games

This schema, and the gold data built on it, live entirely under
`data/<this game>/gold/`. A sibling game instantiated from this same template
gets its **own** clone of this file and its **own** `data/<that game>/gold/`
directory -- gold sets are never shared or merged across game instances, to
keep cross-game contamination impossible by construction (see the top-level
README's "Cloning this template for a new game" section).

## Example

```json
{
  "id": "example-lethal-damage-01",
  "question": "my creature has 5 toughness and got hit by something that only deals 1 damage but has a special lethal-damage keyword. does it die?",
  "paraphrases": [
    "does a special lethal-damage effect kill something even if the raw damage number is way less than its toughness?"
  ],
  "answer": "Yes -- the keyword marks any nonzero amount of damage from that source as lethal, regardless of the printed damage number.",
  "key_points": [
    "Any nonzero damage from a source with the lethal-damage keyword is treated as lethal",
    "The printed damage amount does not need to meet or exceed toughness"
  ],
  "common_errors": [
    "The damage amount must still meet or exceed toughness for the creature to die"
  ],
  "citations": ["000.0a"],
  "entities": [],
  "category": "combat-damage",
  "difficulty": "basic",
  "source": "judge:CC",
  "rules_version": "2026-01-01",
  "notes": "Common confusion: players conflate the keyword with damage prevention rather than a lethality override."
}
```

## Additive extension: multiple-choice sets

A multiple-choice set is a separate file in this directory, one question per
line, scored by `scripts/eval_assistant.py` (letter chosen vs letter keyed)
rather than by a rubric judge. It uses `id`, `question` and `source` as above
and these fields instead of `answer`/`key_points`:

| Field | Required | Notes |
| --- | --- | --- |
| `choices` | yes | list of `{"letter": "A", "text": "..."}`, two or more, uppercase letters, unique |
| `correct` | yes | the keyed letter, or `null` when the key is not known. **Items with `correct: null` are unscored**: they are run and recorded but count toward neither the score nor its denominator |
| `known_incorrect` | yes (may be `[]`) | letters a reviewer has marked wrong; never the `correct` letter. On an unscored item this is all that is known |
| `answer_key_by` | yes | who supplied the key, e.g. `Cody` |
| `source` | yes | where the set came from, e.g. `Cody, project thread 2026-11-12` |

`quiz_mc_2026-11-12.jsonl` is Cody's 40-question quiz (38 keyed; `cody-quiz-04`
and `cody-quiz-15` only mark a known-incorrect option), copied unchanged except
that two typographic quotes (Q13, Q29) were normalised to ASCII. Review notes
on its questions go in `eval/notes/`, never into this file.

`quiz_mc_2026-11-13.jsonl` is that set plus Cody's second quiz (2026-11-13), 64
questions and 60 keyed. Its first 40 rows are the 11-12 rows unchanged, except one.
The second quiz repeated 16 of the 11-12 questions word for word, with the same keys,
so they are not duplicated. The exception is `cody-quiz-04` (Sketchy Ripper),
repeated as the new Q15: there Cody marked A wrong and B "most likely", so A is
added to its `known_incorrect` and it stays unscored. The 24 new questions follow as
`cody-quiz2-NN`, numbered as Cody sent them. "Most likely" answers (Q01, Q14) are
unscored, with the choice he marked wrong in `known_incorrect`. HTML entities from the
chat copy were decoded to ASCII quotes. Run the new questions alone with
`--ids cody-quiz2-01,...` to measure on questions the assistant was never tuned against.

Two optional fields, so far only in the official-test set below:

| Field | Required | Notes |
| --- | --- | --- |
| `cards` | no | the card slugs the question links, in order, deduplicated (`[]`: it links none). A slug, never a name: several cards share names. When present, `scripts/eval_assistant.py` preloads exactly these cards with `get_card` instead of guessing cards from names in the text |
| `official` | no | where an official-test item came from: `{attempt_id, question_id, level, option_ids, pass_percent}`. `option_ids` are the site's own option ids in letter order (they are not letters); `pass_percent` is the attempt's pass rule |

`official_basic_test.jsonl` is the official "Level 1 Basic Test", imported from Cody's
attempt of 2026-11-13 (`data/raw/official_tests/`) by `scripts/import_test_attempt.py`:
40 questions and 37 keyed, with the site's exact wording (keyword brackets such as
`[Blocker]` kept) and its linked cards. The site returns only whether each submitted
answer was right, so the key is derived: a right answer is the key; a wrong answer to a
two-option question makes the other option the key; a wrong answer with more options
leaves the item unscored with that option in `known_incorrect` (`official-cbfafd82`,
`official-798ace59`, `official-4a61b648`, the attempt's Q01, Q14 and Q15).
`answer_key_by` is `official test result (Cody's attempt)`. Ids are
`official-<first 8 hex of the question uuid>`. Later attempts are added with the
importer's `--merge`, which fills in unscored keys and refuses a conflict. 38 of its 40
questions are also in `quiz_mc_2026-11-13.jsonl` (by text without the brackets); Q17 and
Q31 read differently there.

**These sets are eval-only, never training data.** Do not use them, their
paraphrases or the assistant's answers to them in any SFT, LoRA or prompt
example.
