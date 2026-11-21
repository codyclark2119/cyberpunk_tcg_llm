# API admission batch V67 (2026-11-21)

Plan section 6, scope 3c. This batch admits Gorilla Arms, a Gear whose host inherits "The first time this Unit steals 1 or more
Gigs each turn, steal a rival Gig with a value not shared by a friendly Gig." The card is pinned literally in its engine gate
(Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Gorilla Arms (`gorilla-arms`) | Gear, Yellow, RAM 3, cost 4, power 3, Cyberware, sellable | (Equip to a friendly Unit or face-up Legend.) The first time this Unit steals 1 or more Gigs each turn, steal a rival Gig with a value not shared by a friendly Gig. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v67-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the trigger guard `FIRST_HOST_STEAL_PER_TURN`, and `valueNotSharedByFriendly: true` on `STEAL_GIG`.
- A new Gear-steal pin table (`gear-steal-support.ts`). The play and trigger gates route the card there before the V47
  effect-steal gate.
- Discovery: the stealer's equipped Gear binds once per steal, on its first stolen Gig, when no steal by that Unit precedes it
  this turn. `isFirstHostSteal` reads the turn's per-Unit steal count, less this steal and any effect steals by the Unit
  recorded later in the current batch, so the check stays true while the batch resolves.
- The extra steal reuses the V47 effect steal with the host as its subject. Its targets are the rival Gigs the host may steal
  whose value no friendly Gig shares, read as it resolves (after the first steal moved). One target is forced, several are a
  choice, none does nothing. The stolen Gig's own steal triggers join the Steal Step batch.
- Validators: Steal Step batches may now hold effect steals (at most one per first-steal Gear binding of the stealer), and the
  batch's bindings are checked as the union of the origin's and each effect steal's discoveries.
- Engine identity `0.4.62-free-call-v66` -> `0.4.63-gear-first-steal-v67`.

## Rules readings

- "The first time this Unit steals 1 or more Gigs each turn" is one trigger for the Unit's first steal, however many Gigs it
  takes. The extra steal is itself a later steal, so it cannot trigger the Gear again.
- "A value not shared by a friendly Gig" is read against the controller's Gigs as the effect resolves, including the Gig the
  first steal just took.
- How this extra steal stacks with Take Control or Alt Cunningham (coverage question Q6) is not settled here. The extra steal
  goes through the existing steal allowance, which already applies Take Control's reduction.

## Tests

`tests/api-admission-batch-v67.test.ts` covers source projection and candidate match; the exact pin with forgeries; a first
steal followed by a forced extra steal of the only unshared value; a choice among several unshared values; no extra steal when
every value is shared; no trigger for a host that already stole this turn; and union membership.

The reviewed union is now 117 cards, and coverage is 117/151.
