# API admission batch V9 (2026-11-17)

Plan section 6, scope 3c. Own-turn end effects on a Gear host and a returning Unit, and a Program
mass spend, each admitted card pinned literally in its engine gate (Cody's exact per-card check,
2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Sandevistan (`sandevistan`) | Gear, Green, 3, power 2 | (Equip to a friendly Unit or face-up Legend.) At the end of your turn, ready this Unit or Legend. | `END_TURN_HISTORY_V1` |
| Modded Kusanagi (`modded-kusanagi`) | Unit, Blue, 6, power 8 | {Adrenaline} At the end of your turn, return this Unit to its owner's hand. | `END_TURN_HISTORY_V1` |
| Don't Fear the Reaper (`don-t-fear-the-reaper`) | Program, Green, 7 | Spend all rival Units. Then, defeat a spent Unit. | `TARGETED_DEFEAT_V1` |

Revisions are authored in `tests/api-admission-batch-v9-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. All three are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): effects `SPEND_ALL_UNITS` (relation `RIVAL`) and `RETURN_TO_HAND`
  (target `SOURCE`).
- Program chain (`effects.ts`): `SPEND_ALL_UNITS` spends every rival face-up Unit in instance-id
  order, one `CARD_SPENT` each for a ready Unit. The Program and targeted-defeat validators
  (`play-state.ts`, `targeted-defeat-state.ts`) now check a paused primitive against the Program's
  current effect index, so a defeat may pause as the second effect.
- Trigger machine (`trigger-resolution.ts`, `trigger-queries.ts`, `trigger-state.ts`): own-turn end
  discovery also scans the Legends area, so a Gear on a face-up Legend triggers; an inherited Gear
  binding is valid in an end-turn batch; `READY_UNIT` on the source readies a host in either area;
  `RETURN_TO_HAND` moves the subject and its equipped Gear to hand (rule 4.12) and does nothing if the
  subject has already left the field.
- Gates: `END_TURN_SHAPES` gains Kusanagi (with its reviewed `ADRENALINE` keyword, which needs the
  `ADRENALINE_V1` policy), a new `END_TURN_GEAR_SHAPES` table holds Sandevistan, and
  `TARGETED_DEFEAT_SHAPES` gains Don't Fear the Reaper. Any card carrying `SPEND_ALL_UNITS` or
  `RETURN_TO_HAND` must pass these gates.
- Engine identity `0.4.4-ready-spend-v8` -> `0.4.5-end-turn-reaper-v9`; baselines regenerated in a
  separate commit.

## Rules readings

- Kusanagi: rule 4.12 and its example cover this card's text: equipped Gear moves to hand with the
  Unit and is no longer equipped there (4.12.1). If Kusanagi and a Gear on it both trigger at turn
  end, the controller orders them; once Kusanagi has left, the Gear's ready does nothing.
- Sandevistan readies its host only if the host is spent; a ready host is unchanged and emits nothing.
- Don't Fear the Reaper: "a spent Unit" has no controller restriction, so friendly spent Units are
  legal choices, as with Wild in the Streets. Already spent rival Units stay spent. With one spent
  Unit the defeat is forced; with none the Program finishes.

## Tests

`tests/api-admission-batch-v9.test.ts`: source projection and candidate match; exact pins with
single-field forgeries rejected; Sandevistan on a spent and a ready Unit host and on a spent face-up
Legend; Kusanagi attacking while lagging, then returning to hand with its Gear after ordering both
end-turn triggers; Don't Fear the Reaper with mixed ready and spent Units on both sides, one Unit and
none; union membership. The reviewed union is now 48 cards, and coverage is 48/151.
