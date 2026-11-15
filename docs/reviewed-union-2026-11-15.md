# Every reviewed card in one content bundle (2026-11-15)

Plan section 6, groundwork for scope 3. A dated record.

The coverage inventory (docs/card-coverage-inventory.md, 2026-11-14) counted 29 executable
cards because it read only the Demo reference content. Reviewed revisions are spread across
the admission fixture chains: `batchV6Context` (V2-V6 and the linear fixture chain) and
`attackPowerContext` (targeted spend, Losing His Way) each carry part of them. Ten real
cards with reviewed executable revisions were outside the Demo set: Animals Wrecker,
Detonate, Japantown Jonin, Kerry Eurodyne: The Last Rockerboy, MaxTac Suppression Team,
Riding Nomad, Rockn' Rockerboy, Royce: Psycho on the Edge, Ruthless Lowlife and Trust No One.

`tests/reviewed-union-fixture.ts` `reviewedUnionContext()` builds one bundle of every
reviewed, `SUPPORTED` revision whose slug is in the engine-candidate catalog (synthetic test
cards are left out), under the union of the chains' turn-slice gates. No gate requires
another to be off, so the union is consistent; duplicate revisions and conflicting gate
values fail an assertion. Overtime comes from the Demo ruleset, the only one that reviewed
`STANDARD_OVERTIME_V1`. Demo games keep `demoStarterContext()` (exactly 29 revisions).

Changes:

- `npm run coverage:cards` and its test read admission from the union: **39 of 151 cards
  executable, 112 not** (was 29 / 122). The three cards that needed only covered families
  were already reviewed.
- `constructedContext()` (CONSTRUCTED games, deck-file setups) uses the union, so all 39
  cards can be put in constructed decks. The two reference decks are unchanged and still
  legal.
- `tests/reviewed-union.test.ts` (3 tests).

No engine source changed; the engine identity does not move.
