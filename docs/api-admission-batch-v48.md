# API admission batch V48 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Gear whose host, when defeated, plays another Unit from its controller's
trash for free. It is one of the cards named in Cody's quiz set that the assistant thread asked for first (2026-11-20). It
adds the engine's first free play (11.11.4): a Unit played by an effect while a trigger batch resolves, whose own {Play}
triggers join that batch. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

The batch also fixes two faults that testing found in V46 and V47 before either was pushed.

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| The Relic: Experimental Biochip (`the-relic-experimental-biochip`) | Gear, Yellow, 5, power 3, Arasaka/Cyberware | {Defeated} Play another Unit with cost 9 or less from your trash for free. Then, bottom-deck this Unit. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v48-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds the effect `PLAY_UNIT_FREE` with `from: "TRASH"`, `maxCost: 9`, `exclude: "SUBJECT"` and
    `then: "BOTTOM_DECK_SUBJECT"`. The host inherits the ability (`inherited: "EQUIPPED_HOST"`, `WHEN_DEFEATED`).
  - `game.ts` adds `effectPlays` to the trigger continuation: each Unit an effect played in the batch, with the
    first-blue-play ordinal the play recorded, if any.
- `free-play-support.ts` adds a new pin table, `FREE_PLAY_SHAPES`, which pins the whole Gear. The play and trigger gates
  route any free play to it first; the Gear gate reaches it through the trigger gate. The Call and field Legend gates
  refuse it.
- `free-play.ts` resolves the effect:
  - The targets are the face-up Units in the controller's trash with printed cost 9 or less, other than the trigger
    subject. One is forced, several are the controller's choice, and with none only the bottom-deck happens.
  - The chosen Unit is played without paying: `CARD_PLAYED`, it enters the field ready and lagging, and a blue Unit
    counts toward the first-blue-play history (the same record an ordinary play makes, now shared as
    `recordQualifyingPlay`).
  - Its {Play} bindings, and a first-blue-play Legend observer, are appended to the batch.
  - Then the subject, if it is still in its owner's trash, is bottom-decked. The Gear stays in the trash.
- `effect-play.ts` adds `isPlayedInBatch`: a {Play} effect now resolves for the batch's PLAY origin or for a Unit an
  effect played inside it. The checks that assumed a PLAY origin use it: Program discard, trash-3 Program pick, friendly
  power, the {Play} search, the {Play} targeted defeat, and the trigger-state pauses.
- A Unit played this way can be the non-active player's (the Relic's host is often defeated on the rival's turn), or be
  played during an attack's batch. So:
  - Its {Play} targeted defeat is valid for either player and in any stage (`validDefeatOrigin`).
  - Its {Play} search is valid for its non-active controller.
  - Steal restrictions, ready locks and must-attack obligations created on the rival's turn are valid. Each still ends at
    the start of its controller's next turn; an obligation created then never binds, because "next turn" is that
    player's own turn.
- Effect defeats now accumulate in a batch (`effectDefeats` is no longer limited to one), and
  `validateEffectDefeatFacts` checks each source's defeats as one group: a DEFEAT origin's Program, a fired
  next-fight-outcome Program, the PLAY origin's Unit, or an effect-played Unit. A second targeted defeat in one batch is
  no longer refused.
- Engine identity `0.4.43-fight-steal-v47` -> `0.4.44-free-play-v48`. The baselines are regenerated once for the bundle
  this batch ships in, in a separate commit.

## Fixes to V46 and V47

- V46: a fired next-fight-outcome defeat failed state validation at any later pause in its batch. The validator treated
  the fired Program, now in the trash, as a Unit on the field, and required its controller to be the active player. For
  example, Safety Override defeating Caliber, whose {Defeated} discard pauses for a choice, failed. The group check above
  accepts it.
- V47: two fired steals in one batch (two Appetite for Destruction registrations on one fight) failed on the second,
  because the continuation held one `effectSteal`. It is now `effectSteals`, one entry per steal, and the validator checks
  each one and all their steal bindings together.

## Rules readings

- 11.23.3 and its example: the host's {Defeated} uses the information from when it was on the field, so it has the Gear's
  ability. The Gear goes to the trash with it and stays there when the host is bottom-decked.
- "Another Unit": any Unit card in the trash except the host itself; another copy of the host's card is a different card.
- "Cost 9 or less": the printed cost value (3.11.1.2). No admitted Unit costs more than 9.
- "For free": no payment, and cost changes are ignored (11.11.4, 11.11.4.2). Nothing else limits the play.
- The played Unit's {Play} effects become pending in the same batch, and its controller orders them with the rest, as for
  any effect that becomes pending while a batch resolves.
- A Unit whose card the engine cannot play is not a target. No reviewed deck holds one.

## Tests

`tests/api-admission-batch-v48.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected by the play, trigger and Gear gates: not inherited, on play, a second effect, a
  condition, no power grant, power, cost, tags, sellability or Quick.
- Emergency Atlus with The Relic loses to Octant: the controller chooses Delamain over Psycho Squad and a copy of Atlus.
  Delamain enters ready and lagging, its {Play} draw 2 joins the batch, the blue play is recorded, Atlus is bottom-decked
  and The Relic stays in the trash.
- One trash Unit is played without a choice. With none, only the host is bottom-decked.
- On the rival's turn, the defending controller plays Adam Smasher, whose {Play} defeats the attacker inside the attack's
  batch.
- The rival's Adam Smasher defeats the host with its {Play}: The Relic plays the controller's own Adam Smasher in that batch,
  and its {Play} defeats the rival's.
- A blue Unit played as the turn's first blue play brings Jackie Welles' first-blue-play trigger.
- A sweep over all 20 admitted Units with a {Play} in this chain, on both players' turns, taking the first and then the
  last option at every choice.
- The V46 and V47 regressions above.
- Union membership.

Japantown Jonin is the one admitted {Play} Unit outside this fixture chain, so the sweep cannot reach it. Its friendly-power
check uses the same `isPlayedInBatch` change.

The reviewed union is now 97 cards, and coverage is 97/151.
