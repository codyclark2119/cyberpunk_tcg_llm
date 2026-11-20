# API admission batch V34 (2026-11-20)

Plan section 6, scope 3b. This batch admits one Unit whose {Play} may defeat any Gear. It then draws 1 if that Gear's
cost equals the value of a friendly Gig. The card is pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Heywood Ripperdoc (`heywood-ripperdoc`) | Unit, Yellow, 6, power 8 | {Play} You may defeat a Gear. If its cost equals the value of a friendly Gig, draw 1. | `TARGETED_GEAR_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v34-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - The Gear defeat target takes relation `ANY` as well as `RIVAL`. Its power bound becomes optional, so "a Gear" has
    none.
  - `DEFEAT_UNIT` gains `optional` ("you may") and a `draw` clause ("if its cost equals the value of a friendly Gig,
    draw 1").
- `targeted-defeat-queries.ts`:
  - A Gear target with relation `ANY` lists every reviewed attached face-up Gear, friendly or rival.
  - An optional defeat with a target also offers a decline, `CONFIRM false`.
- `targeted-defeat.ts`:
  - Declining emits `OPTIONAL_TRIGGER_DECLINED` and defeats nothing.
  - After the defeat and its movement, the DEFEATED bindings are appended. Then the `draw` condition is evaluated
    and recorded, and 1 card is drawn when it holds.
  - The match is the V31 one: the defeated card's printed cost against the controller's own rolled Gigs.
- Gate (`targeted-gear-defeat-support.ts`):
  - A Unit is admitted only by its whole pinned shape. The V5 Program review is unchanged.
  - `supportsEffectiveTriggerSource` accepts a Unit that passes the Gear-defeat gate, so its {Play} is discovered.
- The focused fixture switches on the reviewed Gear-defeat policy (`targetedGearDefeat`, batch V5) for the chain.
  The reviewed union already had it.
- `tests/api-admission-batch-v5-foundation.test.ts`: the vocabulary assertion now accepts relation `ANY` with no
  power bound. `CONTROLLED` is still rejected.
- Engine identity `0.4.29-program-discard-two-v33` -> `0.4.30-gear-defeat-draw-v34`. The baselines are regenerated
  once for the bundle this batch ships in, in a separate commit.

## Rules readings

- "You may defeat a Gear": optional, even with a single Gear on the field. Any controller's Gear qualifies. The
  defeated Gear goes to its owner's trash, and its host stays.
- "If its cost equals the value of a friendly Gig": the Gear's printed cost against a Gig in the controller's own Gig
  area (6.1.2). It is checked after the Gear has moved.
- With no Gear on the field nothing is offered.

## Tests

`tests/api-admission-batch-v34.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - rival Gear only, a mandatory defeat, or no draw;
  - an attack trigger, or the trigger scope;
  - cost, power, tags, a keyword or sellability.
- {Play}:
  - friendly and rival Gear are both offered with a decline, and a forged Unit option is rejected;
  - defeating the rival Sandevistan (cost 3, friendly 3) draws 1, and its host stays unequipped;
  - defeating the friendly Mantis Blades (cost 1, matched only by the Rival's 1) draws nothing.
- Declining defeats nothing. A lone Gear still offers the decline, and with no Gear nothing happens.
- Union membership.

The reviewed union is now 83 cards, and coverage is 83/151.
