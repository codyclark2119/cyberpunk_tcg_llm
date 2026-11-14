# Card coverage inventory (2026-11-14)

Plan section 6 ("Expand the engine to every current card"), scope 1. A dated record:
the numbers below are for the card snapshot pinned by
`data/engine-candidates/manifest.v1.json` (catalog `b96ca8d583ab…`, 151 cards) and the
engine as of this date.

## What was added

- `data/engine-candidates/mechanic-families.v1.json`: hand-authored review notes. Every
  one of the 151 slugs is mapped to the mechanic families its errata-applied text needs,
  from a closed vocabulary of 50 families. Each family records its engine support
  (`COVERED`, `PARTIAL`, `MISSING`, `OUT_OF_SCOPE`) and which existing execution scopes and
  effect kinds cover it. Authority is `REVIEW_NOTES_ONLY`: families never admit a card or
  supply mechanics; admission still needs a reviewed `CardRevisionSnapshot`.
- `npm run coverage:cards` (`scripts/card-coverage.ts`, `scripts/lib/card-coverage.ts`):
  joins the engine-candidate review with the family notes and writes
  `data/engine-candidates/card-coverage.v1.json`. `--check` fails when the committed
  report is stale. It fails closed when a slug is missing from or unknown to the notes, a
  family is outside the vocabulary, a rules question names an unknown slug, or the notes
  pin another catalog. Candidate loading and pin checks moved into
  `loadVerifiedCandidates`, now shared with `npm run review:engine-candidates`.
- A "Coverage" tab in the local play UI (`/api/coverage`), with filters by admission,
  type, color and family, the per-family table and the open rules questions.
- Tests: `tests/card-coverage.test.ts` (report matches committed inputs, five fail-closed
  cases) and one test in `scripts/test_play_app.py` (14 tests).

## Totals

| | Cards |
| --- | --- |
| Snapshot | 151 |
| Executable (reviewed revision, source match) | 29 (the Demo reference cards) |
| Not admitted | 122 |
| Not admitted, needing only `COVERED` families | 3 (`animals-wrecker`, `rockn-rockerboy`, `riding-nomad`) |

Of the 50 families, 3 are `COVERED`, 29 `PARTIAL` (support exists only as bespoke
per-card execution scopes), 17 `MISSING`, 1 `OUT_OF_SCOPE` (the textless promo).
Not-admitted cards need 2 to 8 non-covered families each; most need 3 or more.

Largest families among not-admitted cards: CONDITION_GIG 36, CONDITION_BOARD 30, DRAW 28,
TRIGGER_PLAY 24, SCALED_AMOUNT 18, GEAR_EQUIP 17, SPEND_ABILITY 17, TEMPORARY_BUFF 17,
UNIT_DEFEAT 16. Largest missing families: COST_MODIFIER 10, UNIT_ZONE_MOVE 10,
PLAY_BY_EFFECT 9, MODAL_CHOICE 8, STEAL_CONTROL 8, TRIGGER_STEAL 8, TRASH_RECURSION 7.

## What this means for the order of work

No single family unlocks many cards: only two cards (both ATTACK_PERMISSION) have one
blocking family. Adding families greedily, by cards fully unlocked, unlocks cards a few at
a time throughout (5 after one family, 20 after twelve, 50 after twenty-two, all 122
after all 47 non-covered families). Admitting cards family by family on the current
per-card execution scopes would therefore not reach most cards until the very end.

So scope 3 (the shared effect language) comes first and must generalize the 29 `PARTIAL`
families, starting with the conditions (CONDITION_GIG, CONDITION_BOARD,
CONDITION_STREET_CRED), amounts (SCALED_AMOUNT), durations (TEMPORARY_BUFF,
DURATION_DELAYED) and the common effects (DRAW, DISCARD, UNIT_DEFEAT, SPEND_OR_READY,
GIG_ADJUST, DECK_SEARCH_REVEAL) and triggers (TRIGGER_PLAY, TRIGGER_ATTACK, TRIGGER_CALL,
TRIGGER_DEFEATED, TRIGGER_END_OF_TURN).

Recommended scope 4 family order (missing families, by the greedy unlock order):

1. UNIT_ZONE_MOVE, COST_MODIFIER, PLAY_BY_EFFECT, TRASH_RECURSION (zone moves and
   alternative plays)
2. STEAL_CONTROL, TRIGGER_STEAL, MASS_EFFECT
3. TRIGGER_WHEN_SPENT, MODAL_CHOICE, FREE_CALL, TRIGGER_OTHER_EVENT, TRIGGER_BLOCKER_USED
4. REPLACEMENT_EFFECT, GEAR_MOVE_OR_SACRIFICE, RIVAL_CHOICE, TRIGGER_START_OF_TURN, GIG_ROLL

The three cards that need only covered families can join the first admission batch.

## Open rules questions

Twelve questions the notes could not settle are in the family file (`rulesQuestions`,
Q1 to Q12) and on the Coverage tab: Gear without equip reminder text, The Relic's
"this Unit", Legend triggers through Go Solo, "can attack spent Units the turn it's
played" timing, how Legends steal, stacking steal modifiers, ordering two replacement
effects, what counts as "is spent", Gig reroll and min/max checks, Muamar's adjust
direction, simultaneous discard-and-draw order, and whether Legend is a choosable type for
Misty. These need the person's ruling before the affected cards are admitted.
