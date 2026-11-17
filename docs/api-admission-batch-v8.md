# API admission batch V8 (2026-11-17)

Plan section 6, scope 3c. Shared spend and ready effects, each admitted card pinned literally in its
engine gate (Cody's exact per-card check, 2026-11-15).

## Cards

| Card | Type | Text | Scope |
|---|---|---|---|
| Offduty Malfini (`offduty-malfini`) | Unit, Yellow, 4, power 5 | {Play} Spend this Unit and a rival Unit. | `TARGETED_SPEND_V1` |
| Modded Muramasa (`modded-muramasa`) | Unit, Blue, 5, power 4 | At the end of your turn, if you have less ☆ (Street Cred) than a Rival, ready this Unit. | `END_TURN_HISTORY_V1` |
| MaxTac Squadron (`maxtac-squadron`) | Unit, Green, 3, power 4 | At the end of your turn, if this Unit is spent, ready a friendly face-up Legend. | `END_TURN_HISTORY_V1` |

Revisions are authored in `tests/api-admission-batch-v8-fixture.ts` from `data/raw/cards/<slug>.json`
at commit `3eaadb3e` (the V7 snapshot). No erratum applies. All three are `SOURCE_MATCH`.

## Engine change

- Grammar (domain `mechanics.ts`): effects `SPEND_SOURCE` and `READY_UNIT` (target `SOURCE` or
  `FRIENDLY_FACE_UP_LEGEND`); condition `SUBJECT_IS_SPENT`; `SpendUnitTarget.costAtMost` is optional
  (absent means any cost).
- Trigger machine (`trigger-resolution.ts`, `trigger-queries.ts`, new `ready-unit.ts`): `SPEND_SOURCE`
  spends the source Unit, then advances to the ordered second primitive; a triggered `SPEND_UNIT`
  lists rival Units and pauses on a `TARGET` choice when there are 2 or more; `READY_UNIT` rechecks the
  ability's printed condition at resolution, then readies the source or pauses on a `TARGET` choice of
  friendly face-up Legends. A single option resolves without a choice, as elsewhere.
- Validator (`trigger-state.ts`): a `SPEND_UNIT` pause is only the ordered second primitive of a PLAY
  trigger; a `READY_UNIT` pause is only the Legend ready in an own-turn end batch.
- Gates are literal pin tables: `TARGETED_SPEND_SHAPES` (Corporate Surveillance unchanged, plus
  Malfini) and `END_TURN_SHAPES` (Delamain Cab unchanged, plus Muramasa and Squadron). Malfini is also
  a trigger source and the only other two-primitive ordered trigger.
- Engine identity `0.4.3-defeat-filter-v7` -> `0.4.4-ready-spend-v8`; baselines regenerated in a
  separate commit.

## Rules readings

- Malfini spends itself first, then a rival Unit. As with Corporate Surveillance (FAQ00513475),
  readiness is not a selector filter: a spent rival Unit is a legal choice. With no rival Unit it
  still spends itself.
- Muramasa uses the existing Null-aware `STREET_CRED_LESS_THAN_RIVAL` (rule 5.11.4). Its "if" is
  checked when the trigger is discovered and again at resolution.
- Squadron's "if this Unit is spent" is checked the same way. Any friendly face-up Legend is a legal
  choice, including a ready one (no effect). With no face-up Legend the ability does nothing.

## Tests

`tests/api-admission-batch-v8.test.ts`: source projection and candidate match; exact pins with
single-field forgeries rejected; Malfini with two, one and no rival Units; Muramasa behind and ahead
on Street Cred; Squadron spent with two face-up Legends (choice), ready (no trigger) and with no
face-up Legend; union membership. The reviewed union is now 45 cards, and coverage is 45/151.
