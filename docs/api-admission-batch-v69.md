# API admission batch V69 (2026-11-21)

Plan section 6, scope 3c. This batch adds "when ... is spent" triggers to the engine and admits the first card that uses them,
NetWatch Netdriver, a Gear whose host inherits "When this Unit or Legend is spent, draw 1." The card is pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| NetWatch Netdriver (`netwatch-netdriver`) | Gear, Blue, RAM 2, cost 3, power 2, Cyberware/Netrunner/Netwatch, sellable | (Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, draw 1. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v69-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Rules reading (coverage question Q8)

Q8 asked which spending counts as "is spent", and whether a card that enters spent triggers it. The Core Rules settle it:

- 3.7: "To spend a ready card, turn it 90°." Being spent is that turn from ready to spent, whatever causes it.
- 10.16.1.1's example has a Gear reading "When this Unit or Legend is spent, give it +2 power this turn" trigger when its host is
  spent to declare an attack, alongside the {Attack} trigger.
- 11.28.1 ({Blocker}: "you may spend this Unit"), 11.19.2 (a {Spend} cost spends the card) and 5.7.2.1 ("spend a Legend to pay
  1 €$") are all spends.

So every turn from ready to spent counts: attacking, using {Blocker}, paying a {Spend} cost, paying a cost with a Legend, and an
effect that spends the card (either player's). A card that enters spent, or is already spent when an effect would spend it, was
never turned and does not trigger.

## Engine change

- Grammar: the trigger `WHEN_SPENT` (also a binding kind), the trigger origin `SPEND` (`spentIds`), `effectSpends` on the trigger
  continuation, and `spendTriggers` on the turn history.
- `spend-triggers.ts`: `noteSpent` runs at each of the seven places a ready card is turned spent (attack declaration, Blocker,
  payment for a play or paid activation, a {Spend} cost, Call payment, Go Solo or Legend-play payment, and an effect spend). It
  captures the card's own and its Gear's "when spent" bindings at that moment, so a later departure keeps them pending.
  - Inside a trigger batch, the bindings join that batch at once.
  - Otherwise they wait in the turn history and join the action's next batch (the attack's batch for an attacker, the Blocker
    batch for a Blocker, the play's batch for a paid Unit or Gear). If the action makes no batch, a `SPEND` batch resolves them as
    the action ends, before the Main Phase or an open React Step resumes.
- A new spend-trigger pin table (`spend-trigger-support.ts`). The play and trigger gates route the card there.
- Validators: a `WHEN_SPENT` binding names a card its batch's origin or an effect in it spent, from a pinned card, with its source
  the spent card or a Gear on it unless the source has since left the field. Queued bindings exist only inside an unfinished action
  outside any batch. The Blocker batch's exact-capture check skips the Blocker's recorded spend bindings. A `SPEND` batch pauses
  the Main Phase or the paused attack.
- Engine identity `0.4.64-free-gear-play-v68` -> `0.4.65-spend-triggers-v69`.

## Rules readings

- Spend triggers of cards spent outside any batch resolve with the action's next batch, or as the action ends. A Unit paid for
  with a geared Legend therefore resolves the draw alongside its {Play} triggers, in the controller's chosen order.
- A rival's card spent by your effect makes its own controller's trigger pending. The batch holds both players' bindings in the
  usual order.

## Tests

`tests/api-admission-batch-v69.test.ts` covers source projection and candidate match; the exact pin with forgeries; a draw for each
spend cause: an attacker, a Blocker, a face-up Legend paying for a Call, a Legend's own {Spend} ability, a Legend paying for a Gear
play, a Legend paying for a Go Solo, a defender's Legend paying for a Quick Program in React (React reopens), and a rival Unit spent
by Padre's Called spend mode; no trigger for a card placed already spent; and union membership.

The reviewed union is now 119 cards, and coverage is 119/151. The remaining "when spent" cards (Tetratronic Rippler, Zetatech
Faceplate, Rita Wheeler, Arasaka Emergency Radioport, Alt Cunningham: Mother of Daemons) can now build on this trigger.
