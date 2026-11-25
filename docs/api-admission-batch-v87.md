# API admission batch V87 (2026-11-25)

Plan section 6, scope 3c. This batch admits Arasaka Emergency Radioport, a Gear whose holder, when spent, lets its controller look at one
face-down Legend and Call it for free if it is ARASAKA or has {Go Solo}. It reuses Batch V69's "when spent" trigger and Batches V84 and
V86's free Call. The card is pinned literally in its engine gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Arasaka Emergency Radioport (`arasaka-emergency-radioport`) | Gear, Red, RAM 2, cost 2, power 2, Arasaka/Cyberware, sellable | (Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, you may look at a friendly face-down Legend. If that Legend is ARASAKA or has {Go Solo}, you may Call it for free. (You may only Call a Legend once per turn.) | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v87-fixture.ts` from `data/raw/cards/<slug>.json` at commit `3eaadb3e`
(the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: `MAY_CALL_LEGEND_FREE` takes an optional `lookAtOne: {tag: "Arasaka", keyword: "GO_SOLO"}`, and the trigger continuation a
  `lookedLegendId` (the looked-at Legend while its Call is offered).
- The pin joins the "when spent" table (`packages/engine/src/spend-trigger-support.ts`), next to Batch V69's NetWatch Netdriver. The
  free-Call table no longer claims a "when spent" ability, so the spend gate owns it.
- The trigger first offers "Look at no Legend" or "Look at friendly face-down Legend N" for each face-down friendly Legend, even when
  no Call is left. Looking grants private knowledge, as the private Legend look does. If the Legend is ARASAKA or has {Go Solo} and may
  still be Called this turn, it then offers "Call face-down Legend N for free" or "Don't Call it"; otherwise it ends.
- The Call and its queued {Call} ability work as in Batches V84 and V86 (after the action, or after the attack that spent the holder).
- Engine identity `0.4.84-defeated-free-call-v86` -> `0.4.85-spent-look-call-v87`.

## Rules readings

- "You may look" is optional, and the look is available even when the turn's Call is used; only the Call needs one left.
- The Legend that may be Called is the one looked at, not any qualifying Legend.

## Tests

`tests/api-admission-batch-v87.test.ts` covers:

- source projection and candidate match;
- the exact pin through the spend gate, rejected by the free-Call table, with forgeries (any Legend, look at all, own spend, power,
  tags) rejected;
- the holder spent by attacking: the look labels, private knowledge, an ARASAKA Legend Called for free with no payment;
- a {Go Solo} Legend (V: Streetkid) Called, its {Call} trashing 3 after the attack; a Legend that qualifies for neither only looked at;
- the Call used this turn, and declining the look or the Call;
- tampered held Legends rejected;
- union membership.

The reviewed union is now 137 cards, and coverage is 137/151.
