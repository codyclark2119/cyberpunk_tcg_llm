# API admission batch V39 (2026-11-20)

Plan section 6, scope 3c. This batch admits one Gear whose host has [Adrenaline] while a Rival controls at least 2 more
Gigs than the host's controller. It is the first host keyword that depends on a live condition. The card is pinned
literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Adrenaline Converter (`adrenaline-converter`) | Gear, Yellow, 2, power 3 | (Equip to a friendly Unit or face-up Legend.) If a Rival controls at least 2 more Gigs than you, this Unit has [Adrenaline]. (This Unit can attack the turn it's played.) | `GEAR_CAPABILITIES_V1` |

The revision is authored in `tests/api-admission-batch-v39-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar (`mechanics.ts`):
  - A new condition, `RIVAL_CONTROLS_MORE_GIGS` with `minimum` 2.
  - A new continuous modifier, `GRANT_KEYWORD_TO_HOST_IF`, with keyword `ADRENALINE` and that condition.
- `conditions.ts`: the condition holds when some Rival's Gig area holds at least 2 more Gigs than the actor's.
- `capabilities.ts`: an equipped, supported capability Gear adds the keyword to its host only while the condition holds,
  read from the host controller's side. It is evaluated whenever the keyword is consulted, so nothing is stored.
- `capability-support.ts`:
  - A new pin table, `CONDITIONAL_KEYWORD_GEAR_SHAPES`, pins the whole Gear, its equip clause and both modifiers.
  - The gate also requires the reviewed Adrenaline policy. The older Blocker Gear gate is unchanged.
  - `validateCapabilityMetadata` covers the new modifier too.
- `characteristics.ts` and `view.ts` list the modifier as supported only under its pin. It never changes power.
- Engine identity `0.4.34-attacking-ready-v38` -> `0.4.35-conditional-adrenaline-v39`. The baselines are regenerated
  once for the bundle this batch ships in, in a separate commit.

## Rules readings

- "A Rival controls at least 2 more Gigs than you": Gigs in each player's Gig area, and "you" is the Gear's controller.
  A player who is ahead never satisfies it.
- "This Unit has [Adrenaline]": a static ability, so the condition is checked whenever it matters, which is when an
  attack is declared (11.23.2). Nothing ends an attack that was already declared if the counts change later, because
  9.21 lists no such case.
- The printed power 3 is granted to the host as for every reviewed Gear.

## Tests

`tests/api-admission-batch-v39.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with forgeries rejected:
  - an unconditional Blocker grant, no printed power, an added ability, or the plain Gear scope;
  - cost, power, tags or sellability.
- With 1 friendly Gig against 3 rival Gigs, the equipped lagging Unit has Adrenaline and 7 power, and it declares an
  attack.
- With 1 against 2 it has no keyword and cannot attack. Adding a third rival Gig grants the keyword at once. Being 2
  Gigs ahead yourself does not count.
- The Gear is played and equipped through the ordinary Gear play.
- Union membership.

The reviewed union is now 88 cards, and coverage is 88/151.
