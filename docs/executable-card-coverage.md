# Executable card coverage — reviewed play, Gear, attack and defender React

This is an implementation review of a small local capture, **not human-certified gold data, full official card coverage, or a corpus refresh**. The application still validates its four original catalog fixtures. The experimental replay bundles explicitly pin the reviewed revisions below and use synthetic support decks.

`execution: { scope: "NONCOMBAT_SLICE_V1", status: "SUPPORTED" | "UNSUPPORTED" }` is distinct from catalog `status`, source `legality`, and the existence of display text. `REVIEWED_CALL_V1` admission requires an explicit supported execution decision for **every deck card**, then checks the actual normalized abilities and modifiers against implemented handlers. Unsupported triggers, multiple CALL abilities, costs, conditions, and primitives still fail admission. Existing synthetic legacy policies remain for regression compatibility. No runtime English parsing occurs.

The sections record successive bounded scopes. The latest **COMBAT_REACT_V1** section supersedes earlier statements that all reactions are unsupported; the older attack-only ruleset intentionally retains its unresolved React boundary for regression. No scope certifies full combat resolution.

## Captured records and implementation decisions

Exact captured records, printing metadata, whole-corpus SHA-256 and errata-capture SHA-256 are in [reviewed-card-sources.v1.json](../tests/fixtures/reviewed-card-sources.v1.json). No captured erratum joins either implemented card. Exact executable metadata is in [reviewed-card-fixture.ts](../tests/reviewed-card-fixture.ts); the replay's content bundle includes the resulting immutable revision/content hashes. Revision 1 here is a new application revision of the selected capture, not a claim about an official publisher revision number. Provenance `sourceHash` hashes the exact captured JSON record canonically; the source-file hash hashes its original bytes.

| CardId / revision | Captured text / source | Executable representation and handlers | Coverage and limits |
|---|---|---|---|
| `viktor-vektor-sit-down-and-relax` / 1 | “\[Call\] Search the top 5 cards of your deck. Reveal up to 2 Gears with cost 2 or less and add them to your hand. Bottom-deck the rest in a random order.” | One `WHEN_CALLED`, cost `NONE`, `SEARCH_GEAR { count: 5, maxCost: 2, maxTake: 2 }`; typed `HandlerRegistry`, `searchTargets`, `searchChoice`, `continueSearch`, deterministic RNG and card movement/reveal facts. | Implemented CALL in the noncombat slice. Select zero, one or two; choosing one never automatically chooses another. Search still counts cards in DECK until resolution. Zero targets and short/empty decks resolve as much as possible. No search-caused empty-draw loss. No general search DSL. |
| `royce-psycho-on-the-edge` / 1 | “During your turn, this Legend has +2 power for each of its equipped Gear.” The same captured card also has GO SOLO. | `POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN { amount: 2 }`, queried by `RulesView.getEffectivePower`: printed 6 + 2 × equipped Gear count, only face-up in LEGENDS during its controller's turn. | Implemented persistent query and ordinary CALL reveal, with no CALL trigger. Tests cover face-down, CALL, one/two Gear, rival turn and leaving LEGENDS. Base revision never changes. The reviewed Gear policy below now reaches this query through actual play/equip onto Royce in LEGENDS. Older attachment fixtures remain historical regressions. GO SOLO/combat and Royce's battlefield behavior remain unsupported. |
| `rebecca-having-a-moment` / candidate revision 1 | `PRM01`, “Set 1 Promos,” printings 005 and 007; null raw rules text, RAM, cost and power. Raw API also says `legality: "legal"`. | `execution.status: "UNSUPPORTED"`; a negative admission fixture, never a gameplay deck member. | Excluded following the user's promo identification and captured promo metadata. Neither a generic legality flag nor empty display text establishes executable playability. No blanket assumption that every promo card is unplayable. |

The retained CALL/persistent implementation tests are in [reviewed-cards.test.ts](../tests/reviewed-cards.test.ts). The headline [reviewed replay](../tests/fixtures/reviewed-replay.v1.json) begins before first-player selection and reaches Viktor's real CALL and two target choices, then MAIN. Its third Legend and main-deck Gears are explicitly synthetic support fixtures, not invented official cards.

## Rules reviewed

[setup-mechanics-rules.v1.json](../tests/fixtures/setup-mechanics-rules.v1.json) contains exact local excerpts and the full captured rules-file hash. Search follows 11.13.1–11.13.4.1: inspect the designated top cards without moving them, search fewer when necessary, and permit intentionally finding none in a hidden area. Rules 10.2.1, 10.6.2 and 10.10 require resolving what is possible. Reveal facts follow 11.14; specifically 11.14.4 makes cards hidden again after they return face-down. The current observation therefore exposes the inspected cards only to the searching actor, emits authoritative reveal facts on selection resolution, and does not grant permanent opponent access to the resulting hand.

## Requested categories not fabricated

The captured corpus contains 151 records and 27 records classified as Legends (including the Rebecca promo). No selected Legend supplies a standalone unconditional CALL-to-DRAW or a Gig-conditioned CALL-to-DRAW. The old synthetic CALL/DRAW regression remains explicitly synthetic.

| Candidate | Why it is not silently reduced to the requested example |
|---|---|
| Dexter DeShawn: Off the Grid | CALL chooses between temporary friendly Unit power and Draw 1; it also has a Spend/Gig increase ability. It is not an unconditional Draw 1 Legend. |
| Dum Dum: Maelstrom Triggerman | Optional friendly Gear defeat changes the draw count; also has QUICK/Spend. Defeat and QUICK are excluded. |
| Afterparty at Lizzie's | Program: “Adjust a Gig by up to 1. If you control 2 or more Gigs with different values, draw 1.” Now supported through its real Program lifecycle in NONCOMBAT_PLAY_V1 (below), never rewritten as CALL. |
| Kerry Eurodyne: The Last Rockerboy | Unit Spend ability conditioned on a Gig with 8+ current value. Now supported through separate Unit play and Spend activation in NONCOMBAT_PLAY_V1 (below), never rewritten as CALL. |
| Yorinobu Arasaka: Embracing Destruction | Attack-triggered draw and Street Cred-conditioned discard; combat trigger is outside this pass. |

The earlier setup milestone proved two real behaviors. This extension adds Afterparty Program play/Gig adjustment/conditional draw and Kerry Unit play/Spend draw. A real Gig-conditioned CALL is still not fabricated; the trigger/lifecycle distinctions remain authoritative.

## NONCOMBAT_PLAY_V1 admission

Enable the pinned `turnSlice.cardPlay: "NONCOMBAT_PLAY_V1"` with `gigValueBounds: "DIE_FACES_V1"`. New cards must have explicit `execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" }`. Deck admission and PLAY_CARD enumeration both check the normalized type, printed Eddie cost, all abilities, triggers/activation declarations, costs, conditions, primitives, keywords and modifiers. Only the reviewed Program/Unit shapes below, the explicitly enabled simple Gear shape, and the separately scoped attack Unit below pass. Catalog legality alone cannot admit them; unsupported extra printed mechanics cannot be omitted to certify FULL_GAME support. `FULL_GAME` is not an available certification scope.

The retained Viktor/Royce cards keep their existing NONCOMBAT_SLICE_V1 scope. Synthetic main-deck Gears and the third Legend remain clearly labelled support fixtures; they do not become playable Gears merely because they can be searched or sold. Rebecca remains an unsupported negative fixture outside gameplay decks.

## New real cards and provenance

[noncombat-card-sources.v1.json](../tests/fixtures/noncombat-card-sources.v1.json) holds exact **raw per-card captures**, original printing UUIDs, byte-level capture hashes and both raw/processed errata hashes; neither card has a matching captured erratum. [noncombat-rules.v1.json](../tests/fixtures/noncombat-rules.v1.json) holds selected exact rules, processed snapshot SHA-256 and raw rules-capture SHA-256. [noncombat-fixture.ts](../tests/noncombat-fixture.ts) is an explicit handwritten normalization, with no runtime English parser. These are implementation-reviewed fixtures, not human-certified gold. Application revision 1 is not publisher revision numbering. Canonical record `sourceHash` and normalized content hashes are listed below and pinned in the replay bundle.

### Afterparty at Lizzie's

- CardId `afterparty-at-lizzie-s`, application revision **1**; Program, Yellow RAM 1, cost 1, sellable.
- Primary captured printing `d53925ee-df55-4b71-8ca0-13ec3ede2076`, Welcome to Night City — Retail **065**. All six captured printings remain in the immutable fixture.
- Exact raw text: **“Adjust a Gig by up to 1. If you control 2 or more Gigs with different values, draw 1.”**
- Normalized ability `afterparty-program@1`, `WHEN_PLAYED`, no additional ability cost or activation condition; ordered `ADJUST_GIG_UP_TO { target: { kind: GIGS, relation: ANY }, maximum: 1 }`, then `CONDITIONAL_DRAW { timing: RESOLUTION, condition: { kind: DISTINCT_GIG_VALUES, minimum: 2 }, count: 1 }`.
- Handlers: `startPlay` / shared exact payment / `HandlerRegistry` / `continuePlay` / shared `changeGigValue` / `testCondition` / existing `TurnMutation.draw`.
- Scope: NONCOMBAT_PLAY_V1; the entire captured Program effect is supported within open MAIN. No additional Quick/combat ability appears on this capture. General Programs, arbitrary composite effects and reactions remain unsupported.

### Kerry Eurodyne: The Last Rockerboy

- CardId `kerry-eurodyne-the-last-rockerboy`, application revision **1**; Unit, Red RAM 1, cost 4, power 5, **not sellable**.
- Primary captured printing `c26c7db6-f540-4073-ab33-b09335631764`, Welcome to Night City — Retail **012**; both captured printings are retained.
- Exact raw text: **“{Spend} If you control a Gig with 8+ value, draw 2.”**
- Normalized ability `kerry-spend-draw@1`, no trigger; explicit MAIN activation, `SPEND_SOURCE`, `GIG_VALUE_AT_LEAST { minimum: 8 }` checked at activation **and** resolution; existing DRAW count 2. `PAYMENT_COST` is a separate typed vocabulary and is not certified for new activated content in this slice.
- Handlers: ordinary `startPlay` / shared payment / Unit movement and LAG; `canActivate` / `activateAbility` / current-state condition query / existing DRAW.
- Scope: NONCOMBAT_PLAY_V1; Unit enters ready with Lag, which prevents Spend activation and clears at the end of each turn. Correct controller, field location, face, readiness, open MAIN and condition are required. This supports all printed noncombat ability text; ordinary Unit attacks/combat remain unavailable, not certified as FULL_GAME. No Quick/attack-triggered ability is printed on this capture.

## Reviewed semantic decisions

| Question | Local authority and encoded decision |
|---|---|
| Program lifecycle | 4.13–4.14.2, 11.4: reveal in hand → pay → outside every game area while resolving → face-up trash. Technical location `RESOLVING_PROGRAM` retains normal instance identity/location references; it is explicitly **not** BATTLEFIELD or REMOVED. |
| Timing/source | 8.13, 11.4.2: open MAIN and the actor's hand; payment must be possible before the parent action appears. |
| Payment | 11.1, 11.16 plus retained payment rules: actual eligible Eddies/Legends; exact existing subset solver. Multiple exact sets pause for choices; a single forced set is paid automatically, regardless of how many sources it contains. Spend activation is a separate cost. |
| Gig target | “a Gig” has no friendly restriction. 6.1.2–6.1.4 limit targets to rolled Gigs in either player's Gig area; Fixer dice are uncontrolled and ineligible. A rival-controlled target is legal for Afterparty, so rejecting all rival Gigs would be incorrect. |
| Amount/direction | 6.4–6.4.2 allow increase/decrease; 2.8 permits zero for “up to.” Choose decrease 1, keep, or increase 1. Modes express direction with a nonnegative magnitude, respecting 10.31.3. Zero is an explicit **decline**, not a fake same-value adjustment (6.4.5). |
| Bounds | 6.1.1, 6.3.3 and 6.4.4 resolve global bounds: 1…die maximum, including D10 whose printed 0 means 10. No clamping and no arbitrary integers. Impossible directions are absent; the trusted primitive explicitly returns GIG_VALUE_OUT_OF_BOUNDS for attempted crossing. Same-value primitive mutation returns GIG_VALUE_UNCHANGED. No boundary ambiguity remains for this slice. |
| Sequence/condition | 2.3 and 10.2 require printed order: complete/decline adjustment, then query distinct CURRENT rolled values controlled by the actor, then draw if true. Die types, initial rolls and original ownership do not stand in for current values/control. |
| Impossible part | 10.6.2, 10.7, 10.31.1: no Gig target skips that part automatically and still evaluates the second effect; no artificial target decision. |
| Spend/Lag | 8.14, 10.18–10.20, 11.15 and 11.3: explicitly spend the ready source for activation, only after Lag clears; conditions checked at activation and resolution (11.15.3.1). Paying an Eddie/Legend does not activate its Spend ability. |

[noncombat.test.ts](../tests/noncombat.test.ts) covers true→false/false→true after adjustment, zero, both directions, both players' Gigs, initial-value preservation, current-value Street Cred, physical-face boundaries, no-target/empty-draw handling, exact/forced/multi-source payment, Lag/Spend/condition legality, private observations, forged/stale continuations, and POSITION_V2 equivalence. The [noncombat replay](../tests/fixtures/noncombat-replay.v1.json) reaches both real cards through engine-owned setup and normal legal turns; no manual state edit is part of that replay. See [the complete milestone report](noncombat-play-report.md).

## Hash pins for the new reviews

| CardId / application revision | Raw capture SHA-256 | Canonical record sourceHash | Normalized revision content hash |
|---|---|---|---|
| `afterparty-at-lizzie-s` / 1 | `892b6eef568aa7cada92ba77f01307f4130bf8870653df97ef5e8b866e29f241` | `7557229547a745ed79dd6287604534e772ee57517165d0bd9ee4f18b8eac8b4e` | `3d4b39e64dabab7e84ea066976d6956668c8e7ca27c1721abb104af1cfea7587` |
| `kerry-eurodyne-the-last-rockerboy` / 1 | `7395900e0b45f85ff896afd6ee18eadbc99e5b76e9f02469f106b61d730a3c9c` | `5d5cdbddf7c8d43852e217edea75256aad902ccfcd7604d9f5bb8af8488f5070` | `db3e0da684b05d82077ebfe161cb6e0fafd1ce4940919f6393e0790ef9ce7197` |

## Reviewed Gear: Mantis Blades

The additional pinned `turnSlice.gear: "REVIEWED_GEAR_V1"` enables the simple Gear shape under the existing **NONCOMBAT_PLAY_V1** execution scope. This extends ordinary PLAY_CARD/payment/target continuations. Catalog existence, source legality and the synthetic searchable Gears still do not grant play admission.

- CardId `mantis-blades`, application revision **1**, raw ID `28198e04-60e2-4f81-9786-903a9a947d7a`.
- Real Gear, Cyberware, Red RAM 1, **cost 1**, **power 2**, sellable; no captured keywords or additional activated/triggered ability.
- Exact raw text, preserved with its newline:

  ```text
  (Equip to a friendly Unit or face-up Legend.)
  "One cut, one kill."
  ```

- Primary printing `7ffa8ba4-f187-4ba0-a719-fa8ebf45a03b`, Welcome to Night City — Retail **025**. All six printing UUIDs are retained: Retail 025, Beta β025, Embracing Power Retail 007 and Beta β007, Arasaka Demo 004, Pre-Release Beta 011.
- Raw capture SHA-256: `a711d560ac0c863b1df894cc1c6443212b28bd4b8ad60de581094797c97302e2`.
- Canonical record sourceHash: `2b801a356c0239342909fc9fe3b5edab19bc31d79719ade6deac161e1352d62e`.
- Normalized revision content hash: `be7d2903937458366526cf65cd7818a09394e807e4fc6cc714b16937c58bb319`.

[gear-card-source.v1.json](../tests/fixtures/gear-card-source.v1.json) preserves the exact local record, original-byte hash and raw/processed errata hashes. There is no matching captured erratum. [gear-rules.v1.json](../tests/fixtures/gear-rules.v1.json) preserves exact selected rules, raw/processed snapshot hashes and implementation decisions. [gear-fixture.ts](../tests/gear-fixture.ts) normalizes this review by hand. The parenthetical is reminder text; the quoted sentence carries no gameplay instruction. No card image was available locally or fetched; this review uses the captured text/metadata and comprehensive rules, not image-layout certification.

Normalized mechanics are `equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }`, no abilities or keywords, and one `GRANT_PRINTED_POWER_TO_HOST` modifier. Its amount comes from the actual immutable Gear revision's printed power. Admission checks the entire shape, Eddie cost, numeric power, execution status/scope, selector and all ability/keyword/modifier arrays. Extra mechanics, missing metadata and dash costs fail. No runtime English parsing occurs.

### Gear lifecycle and legal hosts

Rules 4.10 and 11.20.2 require reveal → pay → equip before the play is complete. The same HAND instance is face-up during PAYMENT and the explicit paid EQUIP continuation. After payment, TARGET_SELECTION lists actual valid hosts; selecting one moves the Gear beneath that host in its field or Legends area. There is no independent field entry, no stable unattached Gear, no separate equip cost/Spend, and no printed Mantis effect to put into PendingEffect. CARD_PLAYED occurs after GEAR_ATTACHED. Payment and target choices use the existing CHOOSE/actionId protocol.

4.10.1–4.10.2 explicitly permit friendly Units and friendly face-up Legends in field/Legends areas. Current admitted hosts are face-up printed Units in BATTLEFIELD and face-up printed Legends in LEGENDS. Royce does not need Go Solo to receive Gear in its Legends area. Battlefield Legends are also Units in the rules, but executing that lifecycle remains unsupported here. Host readiness/Spend/Lag does not prohibit equip. Gear enters READY under 5.6.2; it neither readies nor spends the host. It remains a Gear and cannot pay as a Legend merely because it shares LEGENDS.

4.10.3 explicitly gives Units no Gear limit. Repeated equip is allowed for Legends and 5.7.7 has no Legends-area card cap; no additional generic named-Gear, duplicate or Cyberware limit was found or invented. This permits two Mantis Blades on Royce. Friendly eligibility uses controller, not owner; Gear/host share their controller's area. Identity and ownership survive; general control changes remain unimplemented.

### Relation, derived values and departure

`host.attachments[]` is canonical. `RulesView.getAttachedGear`, `getEquippedGearCount` and `getAttachmentHost` derive both directions; no `attachedTo`, cached count or effective power is stored. Strict opted-in validation rejects missing/self/duplicate/shared/cyclic/wrong-type attachments, hidden or unsupported Gear, illegal hosts, mismatched areas/controllers and orphan Gear in active areas. Legacy policies retain their old historical fixture representation.

3.17.2–3.17.3 and 11.6.5 add Gear printed power to the host. Royce's existing own-turn modifier uses the same attachment query: **6 → 10 → 14** for zero/one/two Mantis Blades, then **10** on the rival turn. The added 4 per Gear consists of printed Gear power 2 plus Royce's 2, not a rewritten Royce ability. A Kerry host derives 5 + 2 = 7; a Mantis itself remains power 2. Viktor is a valid host, but its absent/null printed power stays null; numeric null arithmetic is not certified. Base revisions remain unchanged and numeric evaluation is independent of attachment order.

A central trusted `moveCardForEffect` operation exercises 4.12/11.6.1.2 without adding a player/wire action: host and Gear follow to HAND/TRASH/REMOVED, detach outside active areas, and a Legend then moves alone to REMOVED (4.4/4.12.2). Direct Gear departure removes the same relation and both bonuses immediately. Same-owner/controller HAND/TRASH movement and owners' REMOVED piles are supported. Simultaneous trash entries require explicit owner ordering (5.9.4.1); multiple owners or cross-owner return destinations require a future reviewed protocol. No arbitrary invalid-state repair occurs. Between-field/Legends movement retains Gear by rule, but Go Solo/Legend play, defeat, bottom-deck groups and effect-driven re-equip remain future work. 11.6.6 defines Move; it does not grant a voluntary MAIN action or authorize a new UNEQUIP command.

[gear.test.ts](../tests/gear.test.ts) covers the complete play/equip, target/payment forgery, invariants, actual modifier composition, identity, public/hidden observations, POSITION_V2 counter equivalence and trusted departure matrix. The [Gear replay](../tests/fixtures/gear-replay.v1.json) uses engine-owned setup and normal turns: Viktor finds **p0-c9** and **p0-c10**, then these same objects are played and equipped to Royce. Both target decisions offer real Viktor/Royce alternatives. PostgreSQL and the generic Python actionId driver reproduce it. [gear-equip-report.md](gear-equip-report.md) records all gates, hashes and limitations.

Mantis's captured noncombat functionality is covered; no additional printed ability was dropped. This is one reviewed Gear, not FULL_GAME or the entire Gear pool. Combat beyond the attack-initiation extension below, damage/defeat, Quick/Rival React actions, Blocker, Go Solo, equipment triggers and general continuous-effect layering remain unsupported. The existing no-Gig Street Cred observation of numeric 0 remains an explicitly known Null approximation.

## COMBAT_ATTACK_V1: reviewed attack initiation

The pinned `turnSlice.combat: "COMBAT_ATTACK_V1"` opts into offensive attack initiation and requires the existing reviewed CALL, play and Gear policies. It permits attacks by the fully reviewed Kerry Unit shape and the new Swordwise shape. Catalog legality and power alone never admit an attacker. Each remains bounded by execution scope; neither is certified for FULL_GAME combat resolution.

### Swordwise Huscle

- CardId **`swordwise-huscle`**, application revision **1**, raw ID `3c4e7fcb-933d-4712-9ce7-6052a14f8e94`.
- Unit / Merc; Red RAM **2**, printed cost **3**, power **3**, not sellable.
- Exact captured text: **`{Attack} If this Unit has power 5+, draw 1.`**
- Primary printing `1c053198-187e-49ab-a9e0-0661b4c3b337`, Welcome to Night City — Retail **019**. Five printings retained: Retail 019, Beta β019, Embracing Power Retail 005, Beta β005 and Arasaka Demo 003.
- Raw-byte capture SHA-256: `f71f7b0ad57d370d2fb602d29f4bba1aa8e2aa0f2ff21e5837891e1aa4b07f7a`.
- Canonical raw sourceHash: `6303e45dd851708391d23625ca5b2c0059bfd7f1675d8bfcdeeaf496df91de8b`.
- Immutable normalized revision hash: `91e8146afcf3b57b8adac59c9ab2be82a4f6ac0e0f6c405a98656f79f0ed4bda`.
- Execution: **COMBAT_ATTACK_V1 / SUPPORTED**. One `WHEN_ATTACKING` ability, no activation/cost/trigger guard, containing `CONDITIONAL_DRAW { timing: RESOLUTION, condition: SOURCE_POWER_AT_LEAST(5), count: 1 }`. No additional keyword, modifier, Play, Defeated, Quick or activated behavior is printed or omitted.

[combat-card-source.v1.json](../tests/fixtures/combat-card-source.v1.json) retains the raw record, five printing UUIDs and errata provenance; no captured erratum matches. [combat-fixture.ts](../tests/combat-fixture.ts) is the handwritten normalization. No image was available locally or fetched; this is a captured-text/metadata implementation review. Admission checks the complete executable shape, numeric power, printed Eddie cost, selector-free mechanics and exact conditional-draw trigger. Added abilities, Quick, wrong trigger/scope and unsupported effects fail.

Ordinary Unit PLAY_CARD/payment/Lag handles Swordwise entering play; its ATTACK ability does not fire on play. At attack declaration the existing PendingEffect registry resolves CONDITIONAL_DRAW through the common current derived-power query and DRAW primitive. Unmodified power 3 resolves the condition false; actual Mantis Gear yields power 5 and draws one. Both paths produce one pending/resolved effect and reach the same React boundary without an extra model decision.

### Attack semantics and limits

[combat-rules.v1.json](../tests/fixtures/combat-rules.v1.json) holds exact rules, raw/processed hashes and decisions. **9.3 requires choosing the target before spending and before ATTACK effects**. The engine's sequence is MAIN → incomplete ATTACK_TARGET_SELECTION → lock target → spend attacker → declare → ATTACK effects → state-based checks → RIVAL_REACT. A unique target resolves automatically. The existing DECLARE_ATTACK cardInstanceId action and CHOOSE/actionId contract are reused.

9.3.1/11.3 require a friendly ready, face-up field Unit without Lag. 4.2.1 makes Legends in the field effective Units while retaining Legend identity; RulesView now shares that type query with combat. Their field/Go Solo lifecycle is still unadmitted. Royce in LEGENDS cannot attack regardless of its power. No arbitrary once-per-turn attack count is added. Kerry's existing Lag clearing naturally makes the same Unit attack-eligible on a later turn; attacking does not activate its Spend ability.

9.3.2 permits a **spent rival Unit** or a **rival Gig area containing at least one Gig**. A ready rival Unit, friendly card, Gear, Legends-area Legend, empty Gig area or individual Gig die is not a target. `AttackTarget` carries a CardInstanceId or a PlayerId for the area; no die-to-steal selection or player-life target is fabricated.

11.21.1–11.21.2.2 defines ATTACK's spend-to-declare trigger, resolved before React. 10.3.3/10.15.1 checks Swordwise's embedded power condition at resolution. 9.6/9.26–9.29 ends an invalid attack after pending work without retargeting, fight or steal. The selected trigger cannot move a participant; trusted post-effect tests exercise departure/readiness invalidation. Malformed external stable states are rejected rather than repaired.

Attacks retain Mantis objects, attachment relations and current power. Kerry + Mantis is 7, Swordwise + Mantis is 5; no power snapshot/cache is stored and no comparison resolves combat. Both players see public attacker, Gear, current power, target and combat step. RIVAL_REACT transfers the acting role to the defender, exposes an explicit `UNSUPPORTED_RIVAL_REACT` capability marker, enumerates no supported actions and rejects attempted progression. It never auto-passes.

The [41-action replay](../tests/fixtures/combat-attack-replay.v1.json) uses normal engine setup/turns, real Kerry play/Lag/Spend, Swordwise play, Mantis equip, strategic target selection and conditional attack draw, ending with **40 strategic positions** and unresolved React. [combat.test.ts](../tests/combat.test.ts) covers admission, eligibility, ordering, conditions, effective types/power, target forgery/staleness, invalidation, visibility, transport-counter equivalence and the wire boundary. PostgreSQL and Python reproduce the complete trace. See [combat-attack-report.md](combat-attack-report.md) for current pins and quality gates.

The attack-only policy retains its historical stop. The additional React policy below enables defender CALL, reviewed Quick/Blocker and explicit PASS. Fight/power comparison, damage, defeat, Gig stealing, completed combat, Go Solo, generic simultaneous scheduling/replacements and broader card pools remain unsupported.

## COMBAT_REACT_V1: defender reactions

Enable `turnSlice.react: "COMBAT_REACT_V1"` alongside the existing attack, reviewed CALL, play and Gear policies. This adds two explicitly reviewed shapes, not generic support for all QUICK or BLOCKER text. [react-fixture.ts](../tests/react-fixture.ts) holds handwritten normalization; [react-card-sources.v1.json](../tests/fixtures/react-card-sources.v1.json) retains exact raw records and printing UUIDs. No publisher refresh or image fetch occurred. Neither card has a matching entry in the pinned local errata. Application revision 1 is independent of publisher printing/version numbering.

| CardId / application revision | Exact captured text | Timing, cost, targets and effect | Limits |
|---|---|---|---|
| `floor-it` / 1 | `{Quick} Give a rival Unit -1 power this turn. Draw 1.` | Blue RAM 1, sellable Program, cost 1. Ordinary PLAY_CARD in MAIN or defender React; exact existing payment. One rival face-up field Unit, including the attacker but not limited to it. Typed `POWER_UNTIL_END_OF_TURN { target: RIVAL_UNIT, amount: -1 }` followed by DRAW 1. No target skips only the first primitive; a sole target resolves automatically. | Full captured effect supported within COMBAT_REACT_V1. Additive power derives from current state, never mutates base. Technical RESOLVING_PROGRAM → TRASH lifecycle retained. No extra printed ability is omitted. Modifier target leave/return lifecycle requires separate source review and is explicitly unsupported by trusted movement. |
| `secondhand-bombus` / 1 | `{Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)` followed by `(Units with power 0 don't steal Gigs.)` | Yellow RAM 2, unsellable Unit, cost 2, power 0. Ordinary MAIN Unit play/payment/Lag. Defender React DECLARE_BLOCKER requires ready, face-up, friendly field Unit with the complete reviewed shape. Lag does not prevent this distinct keyword action. Spend and fully replace the current CARD/GIG_AREA target. | COMBAT_REACT_V1, not FULL_GAME. No extra printed ability is omitted. The zero-power steal reminder belongs to the deliberately unavailable Gig-stealing subsystem. Repeated declarations require distinct still-ready objects; no arbitrary per-attack counter. |

Both cards have five captured printings. Floor It uses primary WNC Retail 132 (`91f9d30c-f74d-4be4-8505-52f05d309c92`) and includes Merc Demo 014 (`9d62921e-382e-4e93-85d8-aa628566ccd7`). Bombus uses primary WNC Retail 053 (`fcbb6d58-6666-4bd3-8ff0-64930fb0f422`) and includes Merc Demo 003 (`62d6b51a-ceaf-498b-8a04-27c3d3e21feb`). Collector numbers are printing metadata only.

| CardId | Raw capture SHA-256 | Canonical sourceHash | Normalized revision hash |
|---|---|---|---|
| `floor-it` | `4370c66d95ac3d3000397f0f03c603b36e5dd97101122819a0d0bd293de79f83` | `80922d41909881e9ea8e5b7184f337778beea19d030d0e0f0107fc7882863f82` | `dc0484009279e457a47e46a838c4f3debbd61aae5afea1da92c7baa73e2f6bcc` |
| `secondhand-bombus` | `542dcc586363882708e6768ca5e61285aa3b478d6c53e3f113daac77503b3fc4` | `1ccbafe3251e2acef6c460eba31d7da27cb14a52ff73e72c5ad335a835cf4200` | `2753476bfee920145e5cb26a2aa6c73211b7d4e7321a8311ff0576eb534981f6` |

Existing Viktor CALL/search, Royce reveal and synthetic unconditional CALL use the same call/payment/effect handlers in React. Each player's call allowance belongs to the global turn; reacting consumes it. Typed resolution `returnTo` keeps payment, Program targets and CALL/search returning to React. No nested reaction can interrupt an unresolved choice/effect.

Rules 9.7–9.12 allow any number/order of defender reactions with complete effect resolution between them. 9.9.1 makes the current target the sole future-relevant target; BLOCKER_DECLARED events preserve the previous target. 11.3 restricts Lag's attacks and Spend-icon effects, while 11.24 defines a distinct Blocker keyword cost. PASS_REACT explicitly closes the window and stops at COMBAT_RESOLUTION_PENDING; later progression returns UNSUPPORTED_COMBAT_RESOLUTION. The attacker never receives reaction choices. The complete rule record and raw/processed hashes are in [react-rules.v1.json](../tests/fixtures/react-rules.v1.json).

[react.test.ts](../tests/react.test.ts) covers exact admission, actors/timing, costs/forced payments, searches, repeated reactions/Blockers, current target, Gear/power, turn duration, no-target/sole-target handling, empty draw, stale/forged atomic rejection, invariants, trusted attack invalidation, observations, POSITION_V2 and strategic training positions. [react-replay.v1.json](../tests/fixtures/react-replay.v1.json) traverses legal setup and normal turns, Viktor CALL/search → Floor It → Bombus → PASS, stopping before combat results. PostgreSQL persists every boundary; Python uses the same generic actionId loop. See [combat-react-report.md](combat-react-report.md) and the exact [demo deck roadmap](demo-deck-coverage-roadmap.md).
