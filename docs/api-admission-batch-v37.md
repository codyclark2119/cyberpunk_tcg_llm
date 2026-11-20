# API admission batch V37 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Program that may set a Gig's value to the value of another Gig, then
draws 1 if its controller has a value-pair. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Peace Offering (`peace-offering`) | Program, Green, 1 | You may set a Gig's value to the value of another Gig. Then, if you control a value-pair, draw 1. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v37-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`): a new effect, `SET_GIG_TO_ANOTHER_GIG_VALUE` with `optional: true`. The draw reuses
  `CONDITIONAL_DRAW` with the V29 `CONTROLS_VALUE_PAIR` condition.
- `gig-value.ts`:
  - `gigSetSources` lists the other rolled Gigs in either Gig area whose value differs from the target's and is on
    the target's faces.
  - `gigSetTargets` lists every Gig that has at least one source.
  - The change itself is the shared `changeGigValue`, so the bounds stay fail-closed.
- `effects.ts`: the handler offers the choice when some Gig can be set, and otherwise does nothing.
- `play-state.ts`:
  - The choice offers a decline (`CONFIRM false`) and each settable Gig first, then the chosen Gig's sources.
  - The validator accepts the primitive only while its target and sources remain eligible.
- `play.ts`:
  - `continueGigSet` declines with `OPTIONAL_TRIGGER_DECLINED`, or holds the chosen Gig in the play continuation's
    `targetGigId`.
  - A lone source is applied without a choice.
  - `setGig` moves the target to the source's value and completes the primitive. The Program's draw then resolves as
    its second primitive.
- Gate (`program-gig-set-support.ts`): the whole printed Program is pinned. `supportsPlay` delegates to it.
- Engine identity `0.4.32-program-search-v36` -> `0.4.33-gig-set-v37`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "A Gig" and "another Gig": either player's Gig in a Gig area. This is the same reading as Afterparty's "a Gig".
- "Set" (6.5): the Gig takes the other Gig's value. A value that isn't on the target's faces can't be set (6.5.1), so
  such a source is never offered. Setting a Gig to the value it already has changes nothing (6.4.3), so equal-value
  sources are never offered either. Declining has the same outcome.
- "Then, if you control a value-pair, draw 1": checked on resolution whether or not a Gig was set. A value-pair is two
  Gigs with the same value in the controller's own Gig area (6.6). A Rival's Gig never pairs with a friendly one.

## Tests

`tests/api-admission-batch-v37.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no draw, draw 2, the draw first, a condition, or the trigger scope;
  - cost, tags, a keyword or sellability.
- With a friendly 2 (d4) and 5 (d6) and a rival 4 (d8):
  - all three Gigs and a decline are offered;
  - the d6 is offered the d4 and d8 as sources, and a forged self-source is rejected;
  - setting the d6 to 2 makes a friendly pair and draws 1, and the Program is trashed.
- The d4's only source is the rival 4, because 5 is not a d4 face, so it applies without a choice and draws nothing.
  A rival Gig can be set, and a rival 5 does not pair with a friendly 5.
- Declining changes nothing but still draws with an existing pair. With only one Gig there is no choice.
- Union membership.

The reviewed union is now 86 cards, and coverage is 86/151.
