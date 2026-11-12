# Card reference in the local gameplay prompt (local-choice-v4)

2026-11-12. Scope: `games/cyberpunk/policy_prompt.py` (`PROMPT_VERSION` moves from
`local-choice-v3` to `local-choice-v4`; new `card_catalog`, `visible_slugs`,
`card_reference`), `games/cyberpunk/policy_bot.py` (`Decision.cards`),
`games/cyberpunk/local_match.py` (drivers attach card facts),
`games/cyberpunk/prompt_size.py` (new: the measurement, shared by the CLI and the
UI), `scripts/measure_prompt_size.py` (now a thin CLI; reports v2, v3 and v4;
`--sample`), `games/cyberpunk/play_app.py` (new "Prompt size" tab),
`scripts/test_local_prompt.py` (9 to 13 tests), `scripts/test_play_app.py` (12 to
13 tests). No engine, content, data or model change. The output contract is
unchanged: `{"choice": i}` selects the i-th offered action.

## Why

Up to v3 the model saw each card only as a slug (`goro-takemura-hands-unclean`)
plus its live state. The game launched in 2026, so no base model knows what a
slug does; every choice between playing, selling or attacking with a card was a
guess. v4 gives the model what the visible cards actually do.

## Where the card facts come from

Only from the engine content bundle the engine worker plays with
(`MatchSetup.content["cards"]`, the admitted `CardRevisionSnapshot`s; for the
default setup, the fixed Demo bundle from `scripts/local-match-setup.ts`).
`policy_prompt.card_catalog(content)` copies, per revision, `type`,
`printedCost`, `power`, `tags`, `mechanics.keywords` (the admitted keywords; the
top-level `keywords` is empty for every Demo card) and `rulesText`, keyed by slug
(`id`, or `id@rN` for revision N). Nothing is read from `data/`, and no card
text is interpreted: the rules text is copied and trimmed, never reworded.
Errata are already part of an admitted revision's `rulesText` (for example
Kiroshi Optics' equip reminder), so the text is used as is.

`local_match.build_decision(..., catalog)` puts into `Decision.cards` exactly
the slugs that the acting seat's `ModelInputV2` observation and offered actions
name (`visible_slugs`). The engine's observation never carries the content of a
rival's hand, any deck or a face-down card, so those cards are never in the
Decision. The renderer filters again: it prints only slugs the observation and
actions name, so even a driver that passed the whole catalog would not leak the
rival's deck list (tested). Decisions without `cards` (for example old decision
records given to `benchmark_policy_bot.py --requests`) render without a
reference.

## What v4 adds

A `Cards:` section between the position and the actions, one line per distinct
visible slug, in slug order, each card once however many copies or actions name it:

```text
Cards:
afterparty-at-lizzie-s: PROGRAM cost=1. Adjust a Gig by up to 1. If you control 2 or more Gigs with different values, draw 1.
corpo-security: UNIT cost=2 pow=2 kw=BLOCKER ...
dying-night-v-s-pistol: GEAR cost=2 pow=2. (Equip to a friendly Unit or face-up Legend.) {Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit is named "V"...
field-operator: UNIT cost=3 pow=2 tags=Arasaka ...
floor-it: PROGRAM cost=1 kw=QUICK. {Quick} Give a rival Unit -1 power this turn. Draw 1.
mantis-blades: GEAR cost=1 pow=2
mt0d12-flathead: UNIT cost=5 pow=7. If you have less ☆ than a Rival, this Unit can't be blocked.
secondhand-bombus: UNIT cost=2 pow=0 kw=BLOCKER. {Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)
```

Format: `slug: TYPE cost=N` (Eddies; `cost=DASH` or `cost=NONE` for the other
printed cost kinds) `pow=N` (printed; absent for Programs and powerless Legends)
`tags=` `kw=`, then `. ` and the rules text. A line ending in ` ...` has rules
text that was left out; text ending in `...` was cut. The position's own `pow=`
and `kw=` stay the live values; the system prompt says so in three added lines.

## Trimming rules

Full text did not fit: the first draft (full text, tags and RAM) took the
largest prompt of the default positions to 6,974 characters (~2,325 tokens).
The rules, all deterministic and listed in `DROPPED_FIELDS["card"]`:

1. **Flavour text** is dropped: a line that is wholly a quotation, or starts
   with `[Flavour]` (Psycho Squad and Emergency Atlus have no rules text left).
2. **A repeated reminder** (parenthesised text, such as Blocker's) is printed
   only the first time it appears in the prompt; a reminder cut by rule 3 does
   not count as shown.
3. **Per-card cap**: text longer than 140 characters is cut at a word and ends in `...`.
4. **Tags** are printed only when some visible card's rules text names them
   (Saburo and Yorinobu name ARASAKA, so Arasaka cards keep that tag). RAM,
   colours, names, sets, printings, sell profile and provenance are never copied.
5. **Text budget**: at most 600 characters of rules text per prompt, given in
   tier order, then slug order: cards an offered action names; your own cards
   outside TRASH/REMOVED; the rival's cards outside TRASH/REMOVED; cards seen
   only in a TRASH or REMOVED zone. A card past the budget keeps its line (type,
   cost, power, tags, keywords) and ends in ` ...`.

Over the 278 default positions the reference has 3,380 lines (13 distinct cards
per position at the median, 21 at most). The text budget leaves out the text of
3 of 469 lines for offered-action cards, 233 of 1,481 for the seat's own cards,
589 of 820 for the rival's in-play cards and 541 of 610 for trash-only cards;
202 lines are cut by the per-card cap. Rival cards in play, such as a Blocker
Legend, often lose their text late in a game: that is the cost of the budget.

## Sizes

`python scripts/measure_prompt_size.py` (defaults: 3 baseline games, seeds
`benchmark-0..2`, 278 decisions). Characters are system plus user message;
tokens assume 3 characters per token. v3 is the same renderer without the card
reference (byte-identical to the v3 prompt on all 278 positions).

| Phase | v3 min / median / max | v4 min / median / max | v4 ~tokens median / max |
| --- | --- | --- | --- |
| early | 1,740 / 2,510 / 3,189 | 1,958 / 3,503 / 4,578 | ~1,168 / ~1,526 |
| mid | 2,545 / 2,873 / 3,411 | 3,814 / 4,298 / 5,038 | ~1,433 / ~1,679 |
| late | 2,720 / 3,104 / 3,665 | 4,110 / 4,760 / 5,318 | ~1,587 / ~1,773 |
| all | 1,740 / 2,900 / 3,665 | 1,958 / 4,283 / 5,318 | ~1,428 / ~1,773 |

The median prompt grows by about half (~967 to ~1,428 estimated tokens) and the
largest from ~1,222 to ~1,773, under the 2,000-token target and far under the
worker's 4,096 cap. The system prompt grows by 218 characters (1,252 to 1,470).
Rules text is English prose and likely tokenizes at more than 3 characters per
token, so these estimates should be high; the Mac run will tell.

## The prompt-size view

`measure_prompt_size.py` was CLI-only. The play UI (`scripts/play_local.py`)
now has a "Prompt size" tab: it plays 1-5 baseline games of the Demo setup
through the same code (`games/cyberpunk/prompt_size.py`), shows the table above
for v2, v3 and the current prompt, the trimming rules, and the largest current
prompt in full (system and user message). `POST /api/prompt-size` takes
`{"matches": 1..5, "seed": "<prefix>"}`; one measurement runs at a time. No
model runs.

## Tests

`scripts/test_local_prompt.py` (`PASS local prompt: 13/13`) adds: every visible
slug (by the test's own walk over the observation and actions) has exactly one
reference line, in slug order, whose type, cost, power, keywords and tags match
the content bundle and whose text equals the content's rules text after the
documented trimming; against the real engine state over 80 decisions of another
game, no card the seat cannot see (rival hand, decks, face-down cards) reaches
the reference or the Decision, and passing the whole catalog renders the same
prompt; each trimming rule on synthetic cards; identical bytes for reversed
legal-action and card lists; v3 equals v4 without the reference; and no
position of the test games passes 5,550 characters. The existing fact-recovery
tests are unchanged. `scripts/test_play_app.py` (`PASS local play UI: 13/13`)
checks the tab, input refusal, and that the endpoint's numbers and largest
prompt equal `report()` and `largest_prompt()` on the same games.

## For the Mac re-measurement and the strength evaluation

- Re-run `benchmark_policy_bot.py`: v4 prompts are about 1.5 times v3's
  median, so expect decision time to grow by about that much (v3: Qwen3-8B
  p50 1.43 s, Qwen3-4B p50 0.84 s) and compare `promptTokens` with the
  estimates above.
- Whether the reference helps play is not measured. A strength evaluation
  should compare v3 and v4 seats on the same seeds (match records carry
  `promptVersion` per seat), and could vary `MAX_REFERENCE_TEXT_CHARS`
  (600) since the rival's in-play cards often lose their text.
- An adapter trained under v3 is not valid for v4: the prompt fingerprint
  changes with `PROMPT_VERSION` and `SYSTEM_PROMPT`.
