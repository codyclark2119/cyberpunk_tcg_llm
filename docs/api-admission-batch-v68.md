# API admission batch V68 (2026-11-21)

Plan section 6, scope 3c. This batch admits Viktor Vektor: You Might Feel a Little Pinch, a Unit whose {Play} ability plays a
cheap Cyberware Gear from its controller's trash for free onto another friendly Unit. The card is pinned literally in its engine
gate (Cody's exact per-card check, 2026-11-15).

## Card

| Card | Type | Text | Scope |
|---|---|---|---|
| Viktor Vektor: You Might Feel a Little Pinch (`viktor-vektor-you-might-feel-a-little-pinch`) | Unit, Yellow, RAM 2, cost 3, power 3, Ripperdoc, not sellable | {Play} Play a CYBERWARE Gear with cost 2 or less from your trash for free. Equip it only to another friendly Unit. | `COMBAT_TRIGGERS_V1` |

The revision is authored in `tests/api-admission-batch-v68-fixture.ts` from `data/raw/cards/<slug>.json` at
commit `3eaadb3e` (the V7 snapshot). No erratum applies. It is a `SOURCE_MATCH`.

## Engine change

- Grammar: the effect `PLAY_GEAR_FREE` (`from: "TRASH"`, `maxCost: 2`, `tag: "Cyberware"`, `host: "ANOTHER_FRIENDLY_UNIT"`), and
  `selectedGearId` on the trigger continuation for the Gear chosen before its host.
- The free-play pin table (`free-play-support.ts`) gains Viktor's shape, and the free-play router reads the new effect.
- Targets: face-up Gear in the controller's trash with the Cyberware tag, printed cost 2 or less, an admitted revision, no {Play}
  ability of its own, and at least one host. Hosts are the Gear's legal equip hosts narrowed to Units on the controller's field
  other than Viktor, so face-up Legends are excluded.
- Resolution: one Gear is taken without a choice, several are the controller's choice; then one host is taken without a choice,
  several are a choice. With no eligible Gear or no host, it does nothing. The Gear is played (`CARD_PLAYED`), attached and
  ready, at no cost.
- The free Gear play is recorded like a free Unit play: it counts toward the first-blue-play and Cyberware Gear play histories,
  and the played Gear's play observers join the current batch. The `effectPlays` validator now accepts Gear. Before this batch,
  the V53 free Gear plays were not recorded in those histories; that path is unchanged here and noted for review.
- Engine identity `0.4.63-gear-first-steal-v67` -> `0.4.64-free-gear-play-v68`.

## Rules readings

- "Equip it only to another friendly Unit" narrows the Gear's usual hosts (a friendly Unit or face-up Legend) to Units other
  than Viktor.
- The effect is mandatory: "Play a ... Gear" has no "you may". When nothing can be played it does nothing.
- Gear with their own {Play} ability are not offered. None of the eligible Gear in the snapshot (Adrenaline Converter, Arasaka
  Emergency Radioport, Kiroshi Optics, Mandibular Upgrade, Mantis Blades, Tetratronic Rippler, Zetatech Faceplate) has one, so
  this excludes nothing today. Radioport, Rippler and Faceplate are not admitted yet, so they are not offered either.

## Tests

`tests/api-admission-batch-v68.test.ts` covers source projection and candidate match; the exact pin with forgeries; a lone
eligible Gear played free onto the lone other Unit (a cost-4 Cyberware Gear stays in trash and only Viktor's cost is paid); a
choice of Gear then of host, with Viktor never a host; nothing when there is no other friendly Unit or no eligible Gear; and union
membership.

The reviewed union is now 118 cards, and coverage is 118/151.
