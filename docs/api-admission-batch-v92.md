# API admission batch V92 (2026-11-25)

Plan section 6, bundle 14. This batch admits River Ward: Detective on the Hunt, a Legend whose {Quick} {Spend} ability plays a hand
Gear for free and whose trigger watches friendly equipped Units being defeated. It adds the engine's first card played from hand by an
ability, and its first play batch that can pause an attack. The card is pinned literally in its engine gate (Cody's exact per-card
check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| River Ward: Detective on the Hunt (`river-ward-detective-on-the-hunt`) | Legend, Yellow, RAM 2, NCPD, sellable | {Quick} {Spend} Play a Gear with cost 2 or less from your hand for free. When a friendly equipped Unit is defeated, search the top 2 cards of your deck and trash 1. | `VALUE_CONDITIONS_V1` |

The revision is authored in `tests/api-admission-batch-v92-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effects `PLAY_GEAR_FROM_HAND_FREE {maxCost: 2}` and `SEARCH_TOP_TRASH_ONE {count: 2}`, the guard
  `FRIENDLY_EQUIPPED_UNIT_DEFEATED` (with `WHEN_UNIT_DEFEATED`), the activation continuation fields `handGearId` (the chosen Gear while
  its host is chosen) and `playedGearId` (never present at a decision), and the turn history `equippedDefeats`.
- The card is a row in the Legend pin table (`legend-spend-support.ts`).
- `packages/engine/src/hand-gear-play.ts`:
  - The free play offers the controller's hand Gear with printed cost 2 or less that the engine can play and that have a legal host.
    None in the snapshot has a {Play} ability; one would not be offered. A lone Gear and a lone host are taken without a choice; with
    no eligible Gear nothing is played. The Gear is revealed, equipped, readied and counted as played (11.20.2), with no payment.
  - Once the ability has resolved, the Gear's own play batch starts (its {Play} observers, such as a first-blue-play Legend). In the
    React Step that batch pauses the attack as a SPEND batch does, then the React Step reopens.
  - Before a defeat batch moves its cards, each defeated face-up field Unit with an attached Gear is recorded. Each face-up Legend of
    that Unit's controller with the pinned trigger binds once per such Unit, with the Unit as its subject.
- An unpaid {Quick} activation now returns to the decision it was taken from (an open React Step), as a paid one already did.
- The search looks at the controller's top 2 cards privately and trashes the chosen one; the other stays on top (11.17.2). With one
  card it is trashed without a choice; an empty deck does nothing.
- Engine identity `0.4.89-paid-attack-power-v91` -> `0.4.90-hand-gear-play-v92`.

## Rules readings

- "Play a Gear" is mandatory when an eligible Gear is in hand, as printed; a Legend's {Spend} ability may still be used with none.
- "Equipped" is read just before the defeat, while the Gear is still attached (its Gear go to the trash with it).
- A defeat that a Gear replaces (Batch V89) defeats the Gear, not the Unit, so it does not trigger.
- "Search the top 2 ... and trash 1" must trash a card when one is looked at (11.17.3: a short deck searches what it has).

## Tests

`tests/api-admission-batch-v92.test.ts` covers:

- source projection and candidate match;
- the exact pin through the Legend and trigger gates, with forgeries (timing, a payment, a missing or changed trigger, the effect,
  tags, colors) rejected;
- in the Main Phase: the Gear choice (a cost-3 Gear is not offered), the host choice (a Unit or a face-up Legend), and a free, ready,
  played Gear;
- a lone Gear and host taken without a choice; no eligible Gear plays nothing;
- in the React Step: the Gear is played and the React Step reopens; a blue Gear's first-blue-play observer runs in a PLAY batch that
  pauses the attack, then the React Step reopens;
- an equipped friendly Unit defeated in a fight: the search choice, the chosen card trashed and the other kept on top; no trigger for
  an unequipped friendly Unit or a rival's equipped Unit; one card left is trashed without a choice;
- forged continuation and history states rejected.

The reviewed union is now 142 cards, and coverage is 142/151.
