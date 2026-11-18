# API admission batch V12 (2026-11-18)

Plan section 6, scope 3c. Two Programs that widen Unit defeat. Each admitted card is pinned literally
in its engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Bonnie and Clyde (`bonnie-and-clyde`) | Program, Red, 3 | Defeat a rival Unit with power 4 or less. You may defeat 2 instead if a Rival controls at least 2 Gigs more than you. | `TARGETED_DEFEAT_V1` |
| Live with the Aftermath (`live-with-the-aftermath`) | Program, Yellow, 3 | Each player defeats one of their Units. | `TARGETED_DEFEAT_V1` |

Revisions are authored in `tests/api-admission-batch-v12-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): the Unit defeat target gains
  `second: { condition: RIVAL_GIG_COUNT_LEAD_AT_LEAST 2 }` and `each: "PLAYER_CHOOSES_OWN"`. The
  targeted-defeat continuation (domain `game.ts`) gains the phases `SECOND` and `EACH`. No new policy.
- Optional second target (`targeted-defeat.ts`, `targeted-defeat-queries.ts`): after the first target
  is chosen, if the condition holds and another eligible Unit remains, the controller picks a second
  distinct Unit or declines (`CONFIRM false`). Both are then defeated in one batch.
- Each player (`targeted-defeat.ts`): in turn order from the controller, each player with Units picks
  one they control. One candidate is forced, and a player with none is skipped. The rival picks as the
  acting player. Nothing is defeated until every player has picked, and then all are defeated in one
  batch, with each owner ordering only its own Gear.
- State validators (`targeted-defeat-state.ts`): a `SECOND` pause needs exactly one still-eligible
  first target, a true condition and the exact current choice. An `EACH` pause must replay as the forced
  or chosen prefix with the exact current chooser. At `ORDER`, the declared set must match its form
  (all, each, optional second, or single). Effect-defeat facts accept several defeats only for these
  forms.
- Gate: `TARGETED_DEFEAT_SHAPES` gains both cards.
- Engine identity `0.4.7-play-cost-reduction-v11` -> `0.4.8-defeat-second-each-v12`; baselines
  regenerated in a separate commit.

## Rules readings

- "A Rival controls at least 2 Gigs more than you" counts Gigs in each player's Gig area, and is
  checked when the second target would be offered, after the first is chosen.
- "Defeat 2 instead" defeats both together, so `{Defeated}` triggers on both are captured in one
  batch. Choosing one target and declining is the printed default.
- "Each player defeats one of their Units": the snapshot rules name no order for players' choices
  within one effect. The engine has the effect's controller pick first (it is "your" effect, 10.1.6),
  then the other players in turn order. Picks are public and the defeats are simultaneous, so the
  order only decides who sees the other's pick. This is a reading to confirm, not a cited rule.

## Tests

`tests/api-admission-batch-v12.test.ts`: source projection and candidate match; exact pins with
single-field forgeries rejected; Bonnie and Clyde without a Gig lead (one target, power bound and rival
relation enforced); Bonnie and Clyde with a lead (second target offered, taken together or declined, and
a forged pause without its first target rejected); Live with the Aftermath with both players choosing,
the rival as the acting player, a forced single Unit, an empty field, and a forged pause that drops the
controller's pick rejected; union membership. The reviewed union is now 55 cards, and coverage is 55/151.
