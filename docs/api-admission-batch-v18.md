# API admission batch V18 (2026-11-19)

Plan section 6, scope 3c. A printed Go Solo Legend whose {Play} ability defeats a rival Unit. The card is
pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Adam Smasher: Ender of Legends (`adam-smasher-ender-of-legends`) | Legend, Red, 9, power 9 | [Go Solo]. [Play] Defeat a rival Unit. | `TARGETED_DEFEAT_V1` |

The revision is authored in `tests/api-admission-batch-v18-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

No new grammar, policy, scope or runtime path. Go Solo already records the Legend as played and begins a
`PLAY` trigger batch, and the existing targeted defeat resolves the ability. Only the gates change:

- `targeted-defeat-support.ts`: the pin table now includes the printed keywords (empty for every earlier
  entry) and adds the complete Ender shape: type, colors, RAM, tags, cost, sellability, power, the `GO_SOLO`
  keyword and its single `WHEN_PLAYED` defeat of a rival Unit with no power filter.
- `field-legend-support.ts`: a Legend in `TARGETED_DEFEAT_V1` is a field Legend only with exactly `GO_SOLO`,
  the field-Legend policy and the exact targeted-defeat pin. The two cost-5 Demo shapes are unchanged.
- `effect-support.ts`: Calling the Legend is admitted through the same pin. It has no {Call} effect.
- `trigger-support.ts`: trigger discovery accepts the pinned defeat on a Legend source as well as a Unit.
- Engine identity `0.4.13-blocker-used-v17` -> `0.4.14-go-solo-play-v18`. The baselines are regenerated in a
  separate commit.

## Rules readings

- 11.29.1: Go Solo is "Pay this Legend's cost to play it as a ready Unit." 11.24.1 and 11.24.2: [Play] is
  "When you play this card", and becomes pending once the play requirements are met. Going Solo therefore
  triggers the defeat, after the Legend is on the field.
- Calling the Legend face-up is not playing it, so it defeats nothing.
- "A rival Unit": the controller chooses among the rival's Units. A single Unit is defeated automatically,
  and with none the ability does nothing. Ender and friendly Units are never options.

## Tests

`tests/api-admission-batch-v18.test.ts` covers:

- Source projection and candidate match.
- The exact pin across the defeat, field-Legend and play gates, with single-field forgeries rejected:
  another trigger, a missing or extra keyword, cost, power, tags, color, sellability, any-Unit or power-filtered
  targets, a second effect, a condition, and the plain field-Legend scope.
- Going Solo with two rival Units: the controller chooses, only rival Units are offered, the chosen one is
  defeated by Ender, and Ender stays ready with Go Solo and can attack.
- One rival Unit is defeated automatically. With none, nothing happens and a friendly Unit is untouched.
- Calling Ender defeats nothing.
- Union membership.

The reviewed union is now 64 cards, and coverage is 64/151.
