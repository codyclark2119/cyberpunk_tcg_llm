# Executable card coverage — noncombat setup milestone

This is an implementation review of a small local capture, **not human-certified gold data, full official card coverage, or a corpus refresh**. The application still validates its four original catalog fixtures. The experimental replay bundles explicitly pin the reviewed revisions below and use synthetic support decks.

`execution: { scope: "NONCOMBAT_SLICE_V1", status: "SUPPORTED" | "UNSUPPORTED" }` is distinct from catalog `status`, source `legality`, and the existence of display text. `REVIEWED_CALL_V1` admission requires an explicit supported execution decision for **every deck card**, then checks the actual normalized abilities and modifiers against implemented handlers. Unsupported triggers, multiple CALL abilities, costs, conditions, and primitives still fail admission. Existing synthetic legacy policies remain for regression compatibility. No runtime English parsing occurs.

## Captured records and implementation decisions

Exact captured records, printing metadata, whole-corpus SHA-256 and errata-capture SHA-256 are in [reviewed-card-sources.v1.json](../tests/fixtures/reviewed-card-sources.v1.json). No captured erratum joins either implemented card. Exact executable metadata is in [reviewed-card-fixture.ts](../tests/reviewed-card-fixture.ts); the replay's content bundle includes the resulting immutable revision/content hashes. Revision 1 here is a new application revision of the selected capture, not a claim about an official publisher revision number. Provenance `sourceHash` hashes the exact captured JSON record canonically; the source-file hash hashes its original bytes.

| CardId / revision | Captured text / source | Executable representation and handlers | Coverage and limits |
|---|---|---|---|
| `viktor-vektor-sit-down-and-relax` / 1 | “\[Call\] Search the top 5 cards of your deck. Reveal up to 2 Gears with cost 2 or less and add them to your hand. Bottom-deck the rest in a random order.” | One `WHEN_CALLED`, cost `NONE`, `SEARCH_GEAR { count: 5, maxCost: 2, maxTake: 2 }`; typed `HandlerRegistry`, `searchTargets`, `searchChoice`, `continueSearch`, deterministic RNG and card movement/reveal facts. | Implemented CALL in the noncombat slice. Select zero, one or two; choosing one never automatically chooses another. Search still counts cards in DECK until resolution. Zero targets and short/empty decks resolve as much as possible. No search-caused empty-draw loss. No general search DSL. |
| `royce-psycho-on-the-edge` / 1 | “During your turn, this Legend has +2 power for each of its equipped Gear.” The same captured card also has GO SOLO. | `POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN { amount: 2 }`, queried by `RulesView.getEffectivePower`: printed 6 + 2 × equipped Gear count, only face-up in LEGENDS during its controller's turn. | Implemented persistent query and ordinary CALL reveal, with no CALL trigger. Tests cover face-down, CALL, one/two Gear, rival turn and leaving LEGENDS. Base revision never changes. Equipping and GO SOLO/combat remain unsupported actions; equipped positions are explicit validated test fixtures. This does not certify Royce's battlefield combat behavior. |
| `rebecca-having-a-moment` / candidate revision 1 | `PRM01`, “Set 1 Promos,” printings 005 and 007; null raw rules text, RAM, cost and power. Raw API also says `legality: "legal"`. | `execution.status: "UNSUPPORTED"`; a negative admission fixture, never a gameplay deck member. | Excluded following the user's promo identification and captured promo metadata. Neither a generic legality flag nor empty display text establishes executable playability. No blanket assumption that every promo card is unplayable. |

All implementation tests are in [reviewed-cards.test.ts](../tests/reviewed-cards.test.ts). The headline [reviewed replay](../tests/fixtures/reviewed-replay.v1.json) begins before first-player selection and reaches Viktor's real CALL and two target choices, then MAIN. Its third Legend and main-deck Gears are explicitly synthetic support fixtures, not invented official cards.

## Rules reviewed

[setup-mechanics-rules.v1.json](../tests/fixtures/setup-mechanics-rules.v1.json) contains exact local excerpts and the full captured rules-file hash. Search follows 11.13.1–11.13.4.1: inspect the designated top cards without moving them, search fewer when necessary, and permit intentionally finding none in a hidden area. Rules 10.2.1, 10.6.2 and 10.10 require resolving what is possible. Reveal facts follow 11.14; specifically 11.14.4 makes cards hidden again after they return face-down. The current observation therefore exposes the inspected cards only to the searching actor, emits authoritative reveal facts on selection resolution, and does not grant permanent opponent access to the resulting hand.

## Requested categories not fabricated

The captured corpus contains 151 records and 27 records classified as Legends (including the Rebecca promo). No selected Legend supplies a standalone unconditional CALL-to-DRAW or a Gig-conditioned CALL-to-DRAW. The old synthetic CALL/DRAW regression remains explicitly synthetic.

| Candidate | Why it is not silently reduced to the requested example |
|---|---|
| Dexter DeShawn: Off the Grid | CALL chooses between temporary friendly Unit power and Draw 1; it also has a Spend/Gig increase ability. It is not an unconditional Draw 1 Legend. |
| Dum Dum: Maelstrom Triggerman | Optional friendly Gear defeat changes the draw count; also has QUICK/Spend. Defeat and QUICK are excluded. |
| Afterparty at Lizzie's | Program: “Adjust a Gig by up to 1. If you control 2 or more Gigs with different values, draw 1.” A useful future noncombat Program fixture, not a CALL ability. |
| Kerry Eurodyne: The Last Rockerboy | Unit Spend ability conditioned on a Gig with 8+ current value. Requires an activated-effect path, not CALL. |
| Yorinobu Arasaka: Embracing Destruction | Attack-triggered draw and Street Cred-conditioned discard; combat trigger is outside this pass. |

Consequently this change proves **two real card behaviors**, target selection, optional search completion, and a conditional persistent modifier. It does **not** prove a real Gig-conditioned CALL or add a real-card Gig modification path. Existing current-value/initial-roll/die-type/Street-Cred derivations and Gig primitive regressions remain intact. No new generic condition vocabulary, clamping policy, Program play, activated Spend, or combat was guessed to fill those categories.
