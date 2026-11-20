# API admission batch V47 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Program that makes a friendly Unit steal a Gig after it wins a fight by 3
or more power. It is one of the cards named in Cody's quiz set that the assistant thread asked for first (2026-11-20). It
reuses the V46 next-fight-outcome registration. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Appetite for Destruction (`appetite-for-destruction`) | Program, Red, 3, Ganger | The next time a friendly Unit wins a fight by 3+ power this turn, it also steals a Gig. | `NONCOMBAT_PLAY_V1` |

The revision is authored in `tests/api-admission-batch-v47-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` widens `REGISTER_NEXT_FIGHT_OUTCOME`: `on` may be `FRIENDLY_UNIT_WINS_BY_3`, and the registered effect may
    be `STEAL_GIG`.
  - It also adds `STEAL_GIG` as an effect, with `actor: "TRIGGER_SUBJECT"` and `count: 1`.
  - `game.ts` adds `effectSteal` to the trigger continuation: the subject and the one Gig an effect stole in the batch.
- `fight-steal-support.ts` adds a new pin table, `FIGHT_STEAL_SHAPES`, which pins the whole Program. The play gate routes
  any effect steal to it first. The trigger, field Legend and effect gates refuse it.
- `fight-outcome.ts` fires a "wins by 3+" registration when its controller's Unit wins with a comparison power at least 3
  above the loser's. The subject is the winner.
- `fight-steal.ts` resolves the steal in the post-fight batch:
  - The winner is the actor (11.5.1.1.2). It must still be a face-up friendly field Unit with a steal allowance.
  - It steals one rival Gig that its steal restrictions permit. One candidate is forced, several are the controller's
    choice, and none means nothing happens.
  - The move records the stolen fact and the per-Unit steal history.
  - The steal triggers it causes are appended to the batch (11.5.1.7).
- `trigger-state.ts` validates the steal:
  - the choice pause;
  - the `effectSteal` record against its fired registration;
  - the appended steal bindings, with the same rules as a Steal Step.
- Engine identity `0.4.42-fight-outcome-v46` -> `0.4.43-fight-steal-v47`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "Wins a fight by 3+ power": the winner's power exceeds the loser's by 3 or more, compared as the fight compared them, with
  negative power counted as 0 (2.10.1).
- "It also steals a Gig": the effect resolves after the fight ends (11.4.2.2.1), so the loser is defeated first. The
  winning Unit steals one Gig from the rival Gig area, chosen by its controller (11.5.1.4.1).
- Effects that restrict the actor's stealing still apply (11.5.1.3). A Unit with power 0 steals nothing.
- If the winner has left the field, it cannot steal, and nothing happens.

## Tests

`tests/api-admission-batch-v47.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - firing on a loss, a defeat instead, an immediate steal, a second effect or Quick;
  - cost, tags or sellability.
- Maelstrom Goons (3) beats Misty (0): a fight won by exactly 3 fires the effect. After Misty is defeated, Goons steals
  the rival's lone Gig, and the steal history counts it.
- V (6) beats Misty with two rival Gigs: the controller chooses one, and V's own steal trigger becomes pending after the
  move.
- A fight won by 2 or a lost fight does not fire it. With no rival Gig, the fired steal does nothing.
- Union membership.

The reviewed union is now 96 cards, and coverage is 96/151.
