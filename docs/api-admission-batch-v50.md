# API admission batch V50 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit whose {Play} may play a cheap Unit from hand or trash for free, and which
draws when the turn's first ARASAKA Unit is defeated. It is the last of the cards named in Cody's quiz set that the assistant
thread asked for first (2026-11-20). It extends the V48 free play to an optional play from the hand, adds a temporary
permission to attack while lagging, and adds the engine's first trigger on any Unit's defeat. The card is pinned literally in
its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Yorinobu Arasaka: Steel Dragon (`yorinobu-arasaka-steel-dragon`) | Unit, Red, 7, power 9, Arasaka/Corpo, unsellable | {Play} You may play a Unit with cost 4 or less from your hand or trash for free. It can attack rival Units this turn. The first time an ARASAKA Unit is defeated each turn, draw 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v50-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` widens `PLAY_UNIT_FREE`: `from` is `TRASH` or `HAND_OR_TRASH`, `maxCost` is 9 or 4, `exclude` and `then`
    become optional, and it gains `optional: true` and `grant: "ATTACK_RIVAL_UNITS_THIS_TURN"`. It adds the trigger
    `WHEN_UNIT_DEFEATED` with the guard `FIRST_ARASAKA_UNIT_DEFEAT_PER_TURN`.
  - `game.ts` adds the binding kind `WHEN_UNIT_DEFEATED` and two turn-history fields: `firstArasakaDefeat` and
    `rivalUnitAttackGrants`.
- `free-play-support.ts` pins the whole Unit in `FREE_PLAY_SHAPES`; any card with the new trigger or guard routes there too.
- Free play:
  - The hand-or-trash play lists the controller's hand cards and public trash cards that are Units with printed cost 4 or
    less. A hand card is revealed as it is played.
  - The optional play always offers a decline, so it pauses whenever it has a Unit to play; with none it does nothing.
  - "Then, bottom-deck this Unit" now happens only when printed (V48 unchanged).
  - The played Unit is recorded in `rivalUnitAttackGrants`. Like the V30 Unit, a lagging Unit with the grant may attack, but
    only rival Units; the Gig area stays closed to it. The turn history, and so the grant, ends with the turn.
- First ARASAKA defeat:
  - Content-gated history: when the content holds the pinned card, `defeatCards` records the turn's first face-up ARASAKA
    Unit to be defeated, of either player, before discovery and movement. Simultaneous defeats take the lowest card id. No
    other content records it, so no existing replay changes.
  - Each face-up field source of the trigger, of either player, fires in the batch that defeats the recorded Unit. The
    bindings are captured before movement, so a Yorinobu defeated in that batch fires too.
  - The binding is valid while the recorded Unit is among the batch's origin or effect defeats, and its source is on the
    field or was defeated in the batch.
- Engine identity `0.4.45-quick-activation-v49` -> `0.4.46-steel-dragon-v50`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "Play ... for free": no payment, cost changes ignored (11.11.4). The played Unit lags as any played Unit does, so "It can
  attack rival Units this turn" lets it attack rival Units, never the Gig area, as for the V30 Unit (11.3.1).
- "A Unit with cost 4 or less": the printed cost value (3.11.1.2), of a Unit card in the controller's own hand or trash.
- "You may": the controller can decline, even with eligible Units.
- "An ARASAKA Unit": either player's Unit with the ARASAKA classification, Yorinobu included.
- "The first time ... each turn": counted per turn whether or not Yorinobu was on the field at the first defeat (like the
  first-attack history). Yorinobu defeated as that first Unit still sees it, because a defeat trigger looks back to before the
  cards moved (11.23.3).

## Tests

`tests/api-admission-batch-v50.test.ts` covers:

- Source projection and candidate match.
- The exact pin, accepted by the play and trigger gates and refused by the Call and field Legend gates, with forgeries
  rejected: mandatory, trash only, cost 9, no grant, bottom-deck, any defeat, draw 2, no draw ability, power, cost, tags or
  Blocker.
- Playing Yorinobu offers a decline, the hand's Jacked-in Voodoo Boy and the trash's Psycho Squad and Arasaka Unit, but not a
  cost-7 Octant; a forged choice is refused. Psycho Squad enters ready and lagging and can attack only a rival Unit;
  Yorinobu itself cannot attack. A hand card is played face up. The grant ends with the turn.
- Declining plays nothing; with nothing eligible there is no pause; Delamain's {Play} draw 2 resolves in Yorinobu's batch.
- The actor's Arasaka Unit defeated by Octant draws 1; the rival's Arasaka Unit defeated later that turn does not.
- The rival's Arasaka Unit defeated first draws for Yorinobu's controller; Yorinobu defeated first by Adam Smasher still
  draws.
- A non-ARASAKA defeat is not recorded; forged history and grants are refused, and without the card the history is never
  recorded.
- Union membership.

The reviewed union is now 99 cards, and coverage is 99/151.
