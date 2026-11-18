# API admission batch V10 (2026-11-17)

Plan section 6, scope 3c. A Unit play effect that defeats every other Unit, and a Unit whose only
text is an attack ban lifted by playing a Program. Each admitted card is pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Adam Smasher: Metal Over Meat (`adam-smasher-metal-over-meat`) | Unit, Yellow, 9, power 15 | {Play} Defeat all other Units. | `TARGETED_DEFEAT_V1` |
| Jacked-in Voodoo Boy (`jacked-in-voodoo-boy`) | Unit, Blue, 2, power 2 | This Unit can't attack unless you played a Program this turn. | `COMBAT_RESTRICTIONS_V1` |

Revisions are authored in `tests/api-admission-batch-v10-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. Both are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): the Unit defeat target gains `all: "OTHER_THAN_SOURCE"`, and the
  combat restrictions gain `CANNOT_ATTACK_UNLESS_PROGRAM_PLAYED_THIS_TURN`.
- Mass defeat (`targeted-defeat.ts`, `targeted-defeat-queries.ts`): with `all`, there is no target
  choice. Every currently eligible Unit except the source is defeated in one batch, in instance-id
  order; each defeated Unit's owner orders only its own Gear batch, and a batch of one card is
  forced. The existing `defeatCards` path declares all defeats before any movement, so `{Defeated}`
  triggers on several Units are captured together. The state validators
  (`targeted-defeat-state.ts`) accept several defeats only for this target: the declared set must
  equal the current eligible set, orders finish in sequence, and only the paused order may be
  partial.
- Program-play history (domain `game.ts`, `ruleset.ts`): new turn-slice policy
  `programPlayHistory: "PROGRAM_PLAY_HISTORY_V1"` adds per-player `turnHistory.programPlays`,
  reset each turn (`initialization.ts`, `turn.ts`), counted when a Program is played after payment
  (`play.ts`), validated exactly per player (`trigger-state.ts`), and published in the observation's
  `turnPlays`. Without the policy the field must be absent, so earlier rulesets are unchanged.
- The ban (`combat-permissions.ts`) reads as `CANNOT_ATTACK` until its controller has played a
  Program this turn, so attack enumeration and observations need no new restriction kind.
- Gates: `TARGETED_DEFEAT_SHAPES` gains Adam Smasher, and a new `CONDITIONAL_ATTACK_BAN_SHAPES` table in
  `restriction-support.ts` holds Voodoo Boy. The table needs the Program-play policy.
- Engine identity `0.4.5-end-turn-reaper-v9` -> `0.4.6-mass-defeat-program-ban-v10`; baselines
  regenerated in a separate commit.

## Rules readings

- "All other Units" covers both players' field Units and never Adam Smasher itself. Legends that are
  not Units are untouched. With no other Unit the ability does nothing.
- Trash order within one owner's defeated batch keeps the engine's existing owner-order choice; rule
  5.9.4.2 lets players reorder their own trash freely, so the order carries no strategic weight.
- "You played a Program this turn" counts any Program its controller played this turn, before or after
  Voodoo Boy entered the field, including a Quick Program played during that player's own turn.

## Tests

`tests/api-admission-batch-v10.test.ts`: source projection and candidate match; exact pins with
single-field forgeries rejected, and the ban rejected without its policy; Adam Smasher defeating
Units on both sides with the rival ordering its equipped Unit's Gear, and with no other Unit; Voodoo
Boy unable to attack before a Program and able to after, with forged missing counters rejected; union
membership. The reviewed union is now 50 cards, and coverage is 50/151.
