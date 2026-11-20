# API admission batch V42 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Unit that can't attack. At the end of its controller's turn, the controller
names a card type and reveals the top card of their deck. A card of the named type goes to hand and readies 1 Eddie, and
any other card is trashed. It is one of the cards named in Cody's quiz set that the assistant thread asked for first
(2026-11-20). The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Misty Olszewski: Mender of Broken Spirits (`misty-olszewski-mender-of-broken-spirits`) | Unit, Blue, 3, power 0 | This Unit can't attack. At the end of your turn, choose a card type. Then, reveal the top card of your deck. If it's the chosen type, add it to your hand and ready 1 Eddie. Otherwise, trash it. (Card types include Unit, Gear, and Program.) | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v42-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar:
  - `mechanics.ts` adds a new effect, `CHOOSE_TYPE_REVEAL_TOP_ADD_AND_READY_EDDIE` with `ready` 1.
  - `game.ts` adds a new event, `CARD_TYPE_CHOSEN`, which records the named type (`UNIT`, `GEAR` or `PROGRAM`).
- `type-reveal-support.ts` adds a new pin table, `TYPE_REVEAL_SHAPES`. It pins the whole Unit, its printed `CANNOT_ATTACK`
  restriction and its own-turn end ability, and it requires the trigger, combat and combat-restriction policies. The
  trigger gate routes this metadata to that pin. End-turn metadata validation and `combat-permissions.ts` accept the
  restriction under the same pin.
- `trigger-queries.ts`: the effect offers a `MODE` choice of the three types.
- `trigger-resolution.ts`:
  - With an empty deck the effect does nothing and offers no choice.
  - Otherwise it pauses for the type. It then emits `CARD_TYPE_CHOSEN` and `CARD_REVEALED`, plus `CONDITION_EVALUATED`
    (met on a match), and moves the card to hand or Trash.
  - On a match with exactly one spent Eddie, that Eddie is readied. With two or more, it pauses in the existing Eddie-slot
    choice.
- `trigger-state.ts` lets the effect pause only in its END_TURN batch:
  - to name a type, while there is a card to reveal;
  - to pick an Eddie, after a match, with two or more spent Eddies.
- Engine identity `0.4.37-legend-reveal-v41` -> `0.4.38-type-reveal-v42`. The baselines are regenerated once for the
  bundle this batch ships in, in a separate commit.

## Rules readings

- "This Unit can't attack" is printed and always applies. So a rival Mox Inciters cannot force Misty to attack (official
  Level 1 test, answer B).
- The types to name are those in the reminder text: Unit, Gear and Program. Legends never sit in a deck.
- "Choose a card type. Then, reveal": the name is fixed before the card is seen. With an empty deck nothing is revealed,
  so the choice has no effect and is not offered.
- "Ready 1 Eddie": a spent Eddie of the controller's. With none spent, nothing is readied, but the card still goes to hand.
- "Otherwise, trash it": the revealed card goes to its owner's Trash.

## Tests

`tests/api-admission-batch-v42.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - no restriction or only a Gig-area ban, a {Play} trigger, an added condition, or a second effect;
  - a keyword, cost, power, tags or sellability.
- Misty is never offered an attack. At the end of the turn the choice lists the three types:
  - Naming the top card's type reveals it and adds it to hand, and the lone spent Eddie is readied.
  - A wrong name trashes it and readies nothing.
- With three spent Eddies the controller picks which one is readied. A forged state that names the type again is
  rejected. With no spent Eddie the card still goes to hand.
- With an empty deck nothing is named.
- Union membership.

The reviewed union is now 91 cards, and coverage is 91/151.
