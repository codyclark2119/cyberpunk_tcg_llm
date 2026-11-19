# API admission batch V23 (2026-11-19)

Plan section 6, scope 3c. A {Play} Unit that may swap a friendly Gig with a rival Gig. The card is pinned
literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| MaxTac AV (`maxtac-av`) | Unit, Green, 5, power 8 | [Play] You may swap a friendly Gig with a rival Gig. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v23-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- `mechanics.ts`: a new effect, `SWAP_GIGS` with `optional: true`.
- `gig-transfer.ts`: `swapGigs` moves both dice at the same time. Each keeps its value and owner, and
  `GIG_CONTROL_CHANGED` is emitted for both, followed by a new `GIGS_SWAPPED` event. No stolen facts are recorded.
  The overtime check runs as it does after any control change.
- `trigger-resolution.ts`: the effect resolves in the reviewed PLAY trigger batch.
  1. With no rolled friendly Gig or no rolled rival Gig in a Gig area, it does nothing.
  2. Otherwise the controller accepts or declines (the existing optional-trigger choice).
  3. After accepting, the controller chooses the friendly Gig, which the continuation holds as `targetGigId`.
  4. The controller then chooses the rival Gig, and the swap happens.
  A single option at either pick is forced.
- `trigger-state.ts`: the swap may pause only as the pinned {Play} ability of its source. A held Gig appears only
  in the second pick and must be a rolled friendly Gig in a Gig area. Both sides must still have a Gig.
- `play-pin-support.ts`: the complete MaxTac AV shape is added to the {Play} pin table.
- Option labels: "Swap a friendly Gig with a rival Gig", then "Give your ..." and "Take rival ... in the swap".
- Engine identity `0.4.18-ready-locks-v22` -> `0.4.19-gig-swap-v23`. The baselines are regenerated in a
  separate commit.

## Rules readings

- 6.7: to swap is to choose a friendly Gig die and a rival Gig die, then move each to the other's Gig area at the
  same time. The friendly Gig is chosen first. This is presentation order only, because both moves happen
  together.
- 6.7.1: values stay the same and can't be adjusted during the swap.
- 6.7.2: a swap is not stealing. It records nothing in the steal history (Delamain Cab) and is not limited by
  steal restrictions (Chrome Fang, Westbrook Netrunner).
- "You may": declining does nothing. When either side has no Gig, the controller is not asked.
- Gig counts don't change, so a swap can't by itself satisfy a Gig-count victory. The overtime check is
  still run for consistency with other control changes.

## Tests

`tests/api-admission-batch-v23.test.ts` covers:

- Source projection and candidate match.
- The exact pin, with single-field forgeries rejected: another trigger, a second effect, power, cost, tags,
  sellability and a keyword.
- With two Gigs on each side:
  - acceptance is offered with its labels;
  - only friendly Gigs are first picks, and a forged rival first pick is rejected;
  - then only rival Gigs are offered, and a forged rival held Gig is rejected;
  - the swap moves both Gigs, which keep their values and owners, emits two control changes and the swap
    event, and records no steal.
- Declining changes nothing.
- One Gig on each side swaps after acceptance, with forced picks.
- With no Gig on either side, there is no choice and no swap.
- Union membership.

The reviewed union is now 72 cards, and coverage is 72/151.
