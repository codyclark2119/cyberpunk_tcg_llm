# Executable card coverage — reviewed play, Gear, attack and defender React

This is an implementation review of a small local capture, **not human-certified gold data, full official card coverage, or a corpus refresh**. The application still validates its four original catalog fixtures. The experimental replay bundles explicitly pin the reviewed revisions below and use synthetic support decks.

`execution: { scope: "NONCOMBAT_SLICE_V1", status: "SUPPORTED" | "UNSUPPORTED" }` is distinct from catalog `status`, source `legality`, and the existence of display text. `REVIEWED_CALL_V1` admission requires an explicit supported execution decision for **every deck card**, then checks the actual normalized abilities and modifiers against implemented handlers. Unsupported triggers, multiple CALL abilities, costs, conditions, and primitives still fail admission. Existing synthetic legacy policies remain for regression compatibility. No runtime English parsing occurs.

The sections record successive bounded scopes. Later sections supersede earlier implementation limits, while older pinned policies retain their regression boundaries. The latest addition is **FIELD_LEGENDS_V1** below with Goro — Hands Unclean (21/29 demo cards, 45/60 copies); no scope certifies a complete starter match.

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
- Normalized revision content hash: `be7d2903937458366526cf65cd7818a09394e807e4fc6cc714b17537c58bb319`.

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


## COMBAT_RESOLUTION_V1: complete bounded fight and stealing

Earlier sections describe their historical policy pins. Opting into `turnSlice.combatResolution.version: "COMBAT_RESOLUTION_V1"` with the reviewed React, attack, Gear, play and CALL policies enables automatic completion after explicit PASS_REACT. No new card or revision is admitted, and no existing execution scope becomes FULL_GAME.

The shared current characteristics query resolves ordinary Swordwise/Kerry/Bombus fights, including Mantis and Floor It. Rule 2.10.1 treats negative power as zero for comparisons while retaining the negative derived value. Higher power wins; ties have no winner and both lose, but zero-reference-power Units cannot defeat. Defeat uses a typed reusable semantic operation and the existing attachment/departure pipeline. Owners choose simultaneous Unit/Gear Trash order sequentially; no fight arithmetic becomes a model choice. No real DEFEATED, fight-win or prevention effect is supported.

Floor It's physical target retains its modifier in public Trash/Removed until turn end. Hidden entry removes it under 5.3.2.2, with a typed expiration fact. This reviewed lifecycle supersedes the React-only movement restriction for the new policy; older replay policies retain their former boundary. Modifier source, target, base revision and duration remain explicit; no damage or universal zone-object reset was added.

A final GIG_AREA target uses reviewed ruleset policy: nonpositive power steals zero; positive power allows `floor(power / 10 + 1)`. Select as many as possible, one actual Gig at a time when alternatives exist; forced all-available selection is automatic. All selected instances move together, retaining owner, die and both values. Street Cred is derived again. A Blocker-replaced target fights that Unit and never steals from the old Gig area.

See [combat-resolution-report.md](combat-resolution-report.md) for the complete rules, automatic/choice boundaries, source hashes, nine replay families, tests and limits. Official constructed remains 40–50 main cards. The 27-main + 3-Legend demo lists are unchanged execution roadmaps, not executable constructed decks; no DEMO_STARTER policy was added.


## COMBAT_RESTRICTIONS_V1: prevention, combat permissions and ordinary Units

Exactly five new immutable revision-1 cards are admitted as `COMBAT_RESTRICTIONS_V1 / SUPPORTED`, requiring the complete combat policy. Earlier sections describe historical policy boundaries. No existing revision changed; no FULL_GAME or bulk corpus certification is implied. [combat-restrictions-fixture.ts](../tests/combat-restrictions-fixture.ts) contains handwritten normalization. [combat-restrictions-card-sources.v1.json](../tests/fixtures/combat-restrictions-card-sources.v1.json) preserves every raw field and all 23 printing UUIDs.

| CardId / revision 1 | Type / RAM / Eddie cost / power / sellable | Complete captured text |
|---|---|---|
| `reboot-optics` | Program / Blue 2 / 2 / Null / True | `{Quick} The next time a rival Unit fights this turn, it doesn't defeat the opposing friendly Unit.` |
| `corpo-security` | Unit / Green 1 / 2 / 2 / False | `This Unit can't attack.<br>{Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)` |
| `mt0d12-flathead` | Unit / Blue 3 / 5 / 7 / True | `If you have less ☆ (Street Cred) than a Rival, this Unit can't be blocked.` |
| `psycho-squad` | Unit / Blue 1 / 4 / 6 / False | `[Flavour] Their protocol stops at “shoot first.”` |
| `emergency-atlus` | Unit / Green 1 / 3 / 4 / False | `"Grab the policyholder, leave the rest for the city meatwagon."` |

Reboot reuses ordinary MAIN/defender-React Program play, cost-2 payment and RESOLVING_PROGRAM → TRASH. It creates mandatory non-targeted next-fight defeat prevention. The next actual rival/friendly Unit fight consumes it, even when no defeat needs preventing. Current participants after Blocker determine applicability. Power, FIGHT_STARTED, FIGHT_RESULT and winner/loser remain unchanged; only the rival-caused friendly defeat is filtered before the shared semantic defeat/movement stage. Gig attacks do not consume it, unused effects expire at turn end, and source movement does not cancel the independent Program effect (10.21). No extra optional-use choice is invented.

One outstanding prevention globally is supported. Second creation and ambiguous multi-effect states explicitly return `UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS`; this is a scope boundary, not a game rule or array-order decision. Active records carry deterministic identity, source, controller and current turn duration. A consumed proof remains only while needed to validate filtered defeat during an owner Trash-order continuation; cleanup removes it.

Corpo's unconditional CANNOT_ATTACK is derived; its separate BLOCKER reuses the existing handler, including blocking with Lag. Flathead derives CANNOT_BE_BLOCKED when its controller's current Street Cred is strictly below a rival's. Equality permits blocking; only its own attack is affected. CALL/Quick/PASS remain legal. Current admitted reactions do not alter Street Cred, but the condition queries current state after every completed reaction. Empty-area Null compares below numeric values; two Nulls are not less than each other. The older zero-valued Street Cred observation approximation is unchanged.

Psycho Squad's explicit `[Flavour]` and Emergency Atlus's quoted narrative contain no executable instruction. Both use one reusable reviewed ordinary-Unit shape: numeric cost/power, no abilities, keywords, restrictions, equip clause or modifiers. Normal play/payment/Lag, later attacks, spent targeting and fight/defeat use the shared engine. Emergency's API text does not preserve visual italics: this is a captured-text/metadata implementation review, not publisher-image or human-gold certification. Future real cards still require explicit reviewed revisions; empty-looking text never triggers automatic admission.

| CardId | Raw-byte SHA-256 | Canonical sourceHash | Normalized revision hash |
|---|---|---|---|
| `reboot-optics` | `5e75a4492e9c5375c7dd24bfa5de6dbe9046d0ed50bacbf93a3525466362c9b9` | `26beb709278092f79d4809e436f1db5ff74c754872bd74605106faef399044ac` | `dbc84769ae27e11b67d34f83ed7d1be60b96d794289f65544b624265b86e1243` |
| `corpo-security` | `ca00222ae8b1b4c6edd7a4238b90e0a7414d678f83da652087cf2477eefe4afd` | `4ad43c7f2fc8f902b014a9f3d9c37962c1289bca43e8af7deb9dd6cae9e44eaf` | `949cb395f736e8e6a27cb07a725a2420df9123554f1b3ddc20810533491e5fee` |
| `mt0d12-flathead` | `25f9729e49b6c4b502f295c8251260b36b9f3cfab5452a7eab04b0383b46d80b` | `3be73028c2647e5c2eec3ca45115901fad377e94cd65880c7e7e530a5d49be23` | `06a6a78f8973b177ba8da90b68b7ec10de8fa40cd4349be58ee9dd4c5a2be8e4` |
| `psycho-squad` | `b684eb207662917524ab8d910582f3eb94d683c812dace6546507e2cec6df4dc` | `318d221ca664064605dac5fc2f9508f6d11f9fbe19c0345344b9ddc3da2ff387` | `d45245c914161e18a056d95fbe5a3d19075055b3d9b78600d2f555d641e09b7c` |
| `emergency-atlus` | `a521b700a916562d392a9343055a1cdc8d6c5ac163c1e0c53a539183426611d6` | `25b38856b8c1356339600969c350d0cd7353d2e78575cacdac455cfcba1d053f` | `7c821e3255667936e4f176df5390b3c3edd231fac89f4ccaa78babd5dc1fa956` |

| CardId | Primary printing UUID / collector number | Demo printing UUID / collector number | Captured printings |
|---|---|---|---:|
| `reboot-optics` | `fb096d3f-48eb-47c0-a065-81b39691e12f` / 136 | `7a8acee6-f460-4d2d-aaa3-3d057ef7c36c` / 015 | 5 |
| `corpo-security` | `80dcc139-d31d-4b89-86ff-cdbdd2664953` / 076 | `c165a5eb-3338-4a80-8fb9-b7e39b412e5b` / 010 | 5 |
| `mt0d12-flathead` | `5f0d9dac-2547-4ecb-896e-0c603968422a` / 015 | `f7742fc7-0abe-45ee-a6ce-22caf159e06d` / 011 | 3 |
| `psycho-squad` | `d7e0e2e5-6e22-4b45-9e91-50936773e2e1` / 124 | `c45d93f9-bc2d-4e35-9d77-ba62d9d4e4d9` / 012 | 5 |
| `emergency-atlus` | `9c18b6ae-765d-4244-8de4-e382c4767de1` / 077 | `45dd3b11-7bd8-4239-a404-ab0c9b24fcdb` / 011 | 5 |

Pinned raw errata SHA-256: `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75`; processed errata SHA-256: `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340`. All four local records were reviewed; none matches these five cards. The source fixture stores full raw record objects and original byte hashes. Content manifests pin normalized revision hashes. Runtime reads typed mechanics only.

[combat-restrictions-rules.v1.json](../tests/fixtures/combat-restrictions-rules.v1.json) pins 140 exact rules and interpretation decisions. [combat-restrictions.test.ts](../tests/combat-restrictions.test.ts) covers complete-shape rejection, lifetime, combat, visibility and ordering. Three new legal replay families plus an expiration branch pass through PostgreSQL; Python traverses all 12 goldens by actionId without rules duplication. The [demo roadmap](demo-deck-coverage-roadmap.md) is 11/29 distinct cards, still insufficient for either exact starter. See [combat-restrictions-report.md](combat-restrictions-report.md) for runtime pins, commands and limits.


## COMBAT_TRIGGERS_V1: complete characteristic and trigger composition

This milestone adds exactly three immutable revision-1 cards under `COMBAT_TRIGGERS_V1 / SUPPORTED`, enabled only by `turnSlice.combatTriggers: "COMBAT_TRIGGERS_V1"` with the preceding combat policies. Earlier sections retain their historical boundaries. Existing revisions are unchanged. Complete raw records and all fourteen printing objects are pinned in [combat-triggers-card-sources.v1.json](../tests/fixtures/combat-triggers-card-sources.v1.json); [combat-triggers-fixture.ts](../tests/combat-triggers-fixture.ts) performs handwritten normalization. Runtime has no card-name dispatch or English interpretation.

| CardId / revision 1 | Printed characteristics | Characteristic modifiers / restrictions | Entire executable effect shape |
|---|---|---|---|
| `satori-sword-of-saburo` | Red RAM 1; Gear, Arasaka/Weapon; cost 2; power 2; sellable | `GRANT_PRINTED_POWER_TO_HOST`, ordinary friendly Unit/face-up Legend equip. Exactly +2 from printed Gear power, with no separate bonus line. | Inherited `WHEN_FIGHT_WON` on equipped Unit → `DRAW 1`. Gear is physical source, host is subject, host controller is captured. |
| `dexter-deshawn-one-last-chance` | Yellow RAM 2; Unit/Fixer; cost 3; power 4; not sellable | No static modifier, keyword or restriction. | `WHEN_PLAYED` and `WHEN_ATTACKING`: adjust any rolled Gig by up to 1. `WHEN_DEFEATED`: current numeric absolute Street Cred difference of at least 10 from a rival → draw 2. |
| `jackie-welles-pour-one-out-for-me` | Blue RAM 2; Legend/Merc; dash field cost; Null power; sellable | No static modifier, keyword or restriction. Legends-area execution only. | First completed Blue Unit/Gear play each global turn → explicit optional friendly Gig decrease by 0–2; draw 1 only when an actual decrease makes it minimum. No DEFEATED line. |

**Satori: Sword of Saburo — complete captured text:**

> (Equip to a friendly Unit or face-up Legend.)
> When this Unit wins a fight against a rival Unit, draw 1.

**Dexter DeShawn: One Last Chance — complete captured text:**

> {Play} {Attack} Adjust a Gig by up to 1.
> {Defeated} If your ☆ (Street Cred) differs from a Rival's by 10+, draw 2.

**Jackie Welles: Pour One Out For Me — complete captured text:**

> The first time you play a Blue Unit or Blue Gear each turn, you may decrease a friendly Gig by up to 2. If it becomes a min Gig, draw 1.

The Satori bonus is counted once per physical Gear through the same derivation as Mantis, Royce and Floor It. Two Satori grant +4 and independently create two draw triggers; power adjustments never enter the pending queue. Dropping either power inheritance or the draw line fails full-shape admission. Older scopes reject new metadata they do not understand.

Rule 9.18 places fight-result effects before defeat. Rule 11.19.2 places DEFEATED pending effects after declaration and movement. The small scheduler uses controller-selected next effects (10.12), turn-player-first cross-player groups (10.13), immutable source/revision/subject/controller snapshots and historical fight-result facts (10.10.1/10.15). No recursive trigger DSL or LIFO stack is introduced. Selected primitives cannot create nested supported triggers; those cases explicitly remain outside this scope.

Jackie's historical first-play counter is separate from CALL usage and resets for both players at each global turn start. It counts plays before reveal and after declining. Programs, CALL, SELL and incomplete/failed plays do not qualify. Rule 6.4.5 means zero decrease or an already-minimum Gig does not earn a draw. Dexter's numeric difference does not treat Null as zero.

| CardId | Raw-byte SHA-256 | Canonical sourceHash | Normalized revision hash |
|---|---|---|---|
| `satori-sword-of-saburo` | `de1018613a3e9bc3255614635d07efe0342c0513dca73b317b009d543856bec0` | `84009143dfce688adb70f003db7fd3605d0f9e246eeff4ec287ccf0b84b8bb1c` | `121dfed616aa22d1ceb01a2196a45bbca1f5ae7c6f0dee449f1060e7b084310a` |
| `dexter-deshawn-one-last-chance` | `c3ece59708f92495fbc3508fbcb8a3ef00603ac558e3fdf15e201ccff8b9c7f0` | `420729845ee84c1c1b9a7a3014082e1421751640c7165a25035dd0d1a97a586d` | `20cfcd10698a2d6c04d13e16a7d92a5f43b27570f9aae2bf479ee24322a4dd10` |
| `jackie-welles-pour-one-out-for-me` | `c92a779b5b4ac21bac4f243e357121e2d90e9fe6f8beaca6562de8c247c66dd8` | `f920079646c57179f1a173313611c5e3957c5b4d76a4c1134196892696833d69` | `32ce0a027f7319aa347c0b0d9832478814033e2843957aa2879b55a9d90be16c` |

| CardId | Printing UUID | Set | Collector number |
|---|---|---|---|
| `satori-sword-of-saburo` | `11a8fed4-5401-4cfc-901b-ab9b5b94d0ab` | `welcometonightcityretail` | 026 |
| `satori-sword-of-saburo` | `b12e1665-bf29-4b2c-b92d-865cff227a67` | `welcometonightcitybeta` | β026 |
| `satori-sword-of-saburo` | `0e0e7e20-eaf3-4dea-a177-cb54e01ffec6` | `embracingpowerretailstarterdeck` | 008 |
| `satori-sword-of-saburo` | `e9dba54d-79bf-4f33-bd67-ba026e371c03` | `embracingpowerbetastarterdeck` | β008 |
| `satori-sword-of-saburo` | `3b656cec-684d-440b-9c76-0aa9a4a98b81` | `arasakademodeck` | 005 |
| `dexter-deshawn-one-last-chance` | `e2f38541-ecc9-41dc-ae15-164171391bff` | `theheistretailstarterdeck` | 002 |
| `dexter-deshawn-one-last-chance` | `f9c512f2-a41f-4114-9500-cee3f8d8cc35` | `theheistbetastarterdeck` | β002 |
| `dexter-deshawn-one-last-chance` | `daabe14b-dc95-413f-b91a-d3e32937bfd2` | `mercdemodeck` | 002 |
| `jackie-welles-pour-one-out-for-me` | `a33d3324-fe48-4a9f-80a8-8545a0a4727f` | `theheistretailstarterdeck` | 011 |
| `jackie-welles-pour-one-out-for-me` | `a0ef9536-ad3b-47f6-8c2a-171aa3b8b181` | `theheistbetastarterdeck` | β011 |
| `jackie-welles-pour-one-out-for-me` | `762951bd-7bcf-42cd-a44e-b5b127cf00d2` | `mercdemodeck` | 007 |
| `jackie-welles-pour-one-out-for-me` | `e4e17d32-3ec4-4c74-927c-fd0911b86e72` | `boxtoppersretail` | 005 |
| `jackie-welles-pour-one-out-for-me` | `328cd3e4-4177-4d6a-86c0-00d1a5a12b38` | `boxtoppersbeta` | β005 |
| `jackie-welles-pour-one-out-for-me` | `3f37a0e1-e31f-4c6b-b97e-bec9f929432c` | `edgerunneropens1` | 050 |

The local raw rules hash is `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`; processed rules `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`. Raw errata `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75`; processed errata `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340`. All four captured errata records were reviewed; none matches these three cards. [combat-triggers-rules.v1.json](../tests/fixtures/combat-triggers-rules.v1.json) stores 327 exact rule records and the bounded interpretation decisions.

The [new focused suite](../tests/combat-triggers.test.ts) and three legal replay families prove full-card admission, source identity, shared power, trigger ordering, current conditions, history, hidden-information boundaries, wire traversal and complete event preservation. Coverage is now 14/29 distinct demo cards, 30/60 physical copies. Neither exact 27-main + 3-Legend starter is playable under constructed 40–50; no DEMO_STARTER is introduced. See [combat-triggers-report.md](combat-triggers-report.md).


## GEAR_CAPABILITIES_V1: Mandibular Upgrade

The only new admission is `mandibular-upgrade`, application revision **1**, `GEAR_CAPABILITIES_V1 / SUPPORTED`. It requires the explicit `gearCapabilities` policy with reviewed Gear and React policies. Earlier sections retain their historical boundaries; no prior immutable revision changes. Runtime uses reviewed typed metadata, never English parsing or card-slug dispatch.

| Captured characteristic | Value |
|---|---|
| Type / classification | Gear / Cyberware |
| Color / RAM | Yellow / 2 |
| Eddie cost / printed power | 1 / 0 |
| Sellability | Yes |
| Equip selector | Friendly Unit or friendly face-up Legend, in field/Legends area |
| Complete modifiers | `GRANT_PRINTED_POWER_TO_HOST` (zero) and `GRANT_KEYWORD_TO_HOST: BLOCKER` |
| Other executable text | No extra trigger, activated effect, restriction or classification bonus |

Complete captured text:

> (Equip to a friendly Unit or face-up Legend.)
> {Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)

The physical Gear is the capability source; its host possesses the inherited text, and the host controller performs the ordinary `DECLARE_BLOCKER(hostInstanceId)` action. The printed base revision and CardInstance gain no cached keyword. The existing attachment relation supplies power, Satori triggers and Mandibular capability through distinct RulesView queries. Printed power 0 is represented explicitly; Mandibular still counts as a Gear for Royce's existing modifier.

Rules 3.18.3, 4.11.3–4.11.3.1 and 11.6.4 make bottom text apply to the host while equipped. Parenthetical reminder text is not an independent effect (3.18.1.2.2.1). The capability ends immediately on detachment/departure under 4.12.1. Each identical source is retained in deterministic source order; the equivalent host spend/redirect action is enumerated once under 9.9/11.24. This is not a general rule that all duplicate keywords or triggers fail to stack.

A face-up Legends-area Legend can receive the text but **cannot declare Blocker**, because 9.9/11.24 require a ready Unit and 4.2.1 gives Unit type only to field Legends. Go Solo/field-Legend admission remains outside scope. Lag does not forbid the separate Blocker cost; cannot-attack remains independent; cannot-be-blocked suppresses all sources of Blocker without closing React.

Raw-byte SHA-256: `df528346515df46bfcb8b90e4eea7e1dfcae9ea89acc0872fcf5b911623acb87`. Canonical sourceHash: `910fd5afe70fdb58426683410224568d35a1132e1f9495e98d1cacba80eee8a4`. Normalized revision hash: `83329470ed73fc56508de3f4f4f3967bd91d8b2d546949b5c78876442aed44eb`.

| Printing UUID | Set | Collector number |
|---|---|---|
| `219b7a29-0f8b-4750-bc46-0f39eec6721b` | `welcometonightcityretail` | 062 |
| `dc0a7e03-54b6-4334-965f-27a3d469fed6` | `welcometonightcitybeta` | β062 |
| `d13b8b15-8e31-448c-b28b-322bb498d0a7` | `theheistretailstarterdeck` | 008 |
| `c3399413-d205-49e7-871a-4f16d7c3ade6` | `theheistbetastarterdeck` | β008 |
| `49fc6d6e-8e86-4a05-bcd5-bd8a50edf5dc` | `mercdemodeck` | 005 |

[The source fixture](../tests/fixtures/gear-capabilities-card-source.v1.json) retains the full raw record and all five printing objects. All four local errata were inspected; none matches Mandibular. Raw errata hash `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75`; processed errata `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340`. The Kiroshi equip erratum is already reflected in its local card text, but it remained unadmitted at that milestone (the private-look extension below now admits it).

[gear-capabilities-rules.v1.json](../tests/fixtures/gear-capabilities-rules.v1.json) pins 101 exact relevant records: raw rules `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`, processed rules `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`. [gear-capabilities.test.ts](../tests/gear-capabilities.test.ts) adds 25 focused tests; [mandibular-replay.v1.json](../tests/fixtures/mandibular-replay.v1.json) uses 31 legal setup/turn/equip/Blocker/fight actions, 29 genuine decisions and 142 events, ending at MAIN. Real Mongo/Postgres and the generic Python actionId adapter exercise the new revision/replay. See [gear-capabilities-report.md](gear-capabilities-report.md).

The roadmap is now **15/29 distinct cards, 32/60 physical copies**. Exact demos remain **27+3** and cannot initialize under constructed **40–50**. No DEMO_STARTER, full match, private-look Gear, named-host end-turn effect or generic keyword framework is enabled.


## GEAR_PRIVATE_LOOK_V1: Kiroshi Optics

`kiroshi-optics`, application revision **1**, is the only new real-card admission. The full reviewed shape requires existing Gear and combat-trigger policies and its explicit content scope; no new global gameplay flag. No older immutable revision changes. This remains an experimental executable replay bundle, not an automatic catalog import or human-certified gold.

| Captured characteristic | Value |
|---|---|
| Type / classification | Gear / Cyberware |
| Color / RAM | Yellow / 1 |
| Eddie cost / printed power | 1 / 1 |
| Sellability | Yes |
| Equip | Friendly Unit or friendly face-up Legend in field/Legends area |
| Modifier | `GRANT_PRINTED_POWER_TO_HOST` |
| Inherited ability | `WHEN_ATTACKING`, source Gear / subject host / controller host controller |
| Complete effect | `LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND` |
| Additional executable text | None; no additional keyword, condition, activation cost or restriction |

Complete captured text, including the already-applied equip reminder erratum:

> (Equip to a friendly Unit or face-up Legend.)
> {Attack} Look at a friendly face-down Legend. (Don't reveal it.)

The shared attachment query adds printed power 1. The existing trigger queue combines inherited ATTACK with other reviewed ATTACK sources, permits same-controller ordering, and resolves each independent Gear before React. Zero legal targets skip; one resolves automatically; multiple friendly face-down Legends produce public slot choices. Neither the Gear nor the hidden Legend becomes the attacker.

A deterministic `privateKnowledge` record stores the viewer, marked physical Legend and immutable remembered CardRef. Rule 5.7.4.2 explicitly allows visually separating marked known Legends: knowledge follows that trackable physical object, not a vacated slot. `rememberedContent` is the viewer's recorded memory; it is not an ongoing permission to look again (5.7.4.3). CALL/reveal or leaving the Legends area removes the redundant/stale hidden-object record. Initial randomization has no memory. A later effect that conceals identity by randomization remains unadmitted; no epoch or invented shuffle effect is introduced.

Both players see `knownToSeats` on the anonymous slot, as 5.7.4.2 requires. Only the entitled viewer receives `rememberedContent`; face remains DOWN, publicId remains the slot, and public `content` stays absent. `LEGEND_LOOKED_AT` carries viewer/seat/slot only. Full state/history/TrainingPosition artifacts are private; UI/model payloads use observation projections. No GraphQL gameplay endpoint exposes raw events.

The public marker necessarily changes the opponent's ObservationHash when first added. With public markers fixed, changing privately remembered identity leaves the opponent hash unchanged. ReplayStateHash and POSITION_V2 include memory; private-look bundles derive action IDs from entitled observation instead of full hidden state. Legacy bundle IDs retain their old protocol, with original-payload compatibility separately audited.

Raw-byte SHA-256: `be8f06622ad9c01a615157e67e312216063cba23d446ae12eede0ea21326888b`. Canonical sourceHash: `437f9f77917cb88b25b0f2386f7afba8bada54b869d2810f4c0da3b698666502`. Normalized revision hash: `85e33a64bce450f9864f402be2f6d380936c9de91e92031708d70b289096d4d9`.

| Printing UUID | Set | Collector number |
|---|---|---|
| `ec3368a9-79f1-4dfc-9cf7-1cb464ec1c88` | `welcometonightcityretail` | 061 |
| `d35720e4-f307-4732-ae3d-8f47f1351549` | `welcometonightcitybeta` | β061 |
| `aa9b8a2e-ffd6-4435-8bed-c4e64e1c32ac` | `theheistretailstarterdeck` | 007 |
| `b18ce43d-3441-4a55-a6a9-34ae8765aa27` | `theheistbetastarterdeck` | β007 |
| `57e1d9b6-0f2b-497b-acaf-49c20a68cd19` | `mercdemodeck` | 004 |

[private-information-card-source.v1.json](../tests/fixtures/private-information-card-source.v1.json) retains the complete raw record and all four errata, including the one applicable equip correction. [private-information-rules.v1.json](../tests/fixtures/private-information-rules.v1.json) pins 210 local rules and the same raw/processed rules and errata hashes as the prior milestone. No network refresh occurred.

[private-information.test.ts](../tests/private-information.test.ts) adds 30 focused tests. The [Kiroshi replay](../tests/fixtures/kiroshi-replay.v1.json) contains 31 legal actions, 29 strategic positions and 136 events, including setup, host/equip, a later attack, private look, React/PASS, MAIN and CALL of the remembered Legend. Real database persistence and the generic Python adapter cover the new state. See [private-information-report.md](private-information-report.md).

Current demo coverage is **16/29 distinct cards, 35/60 physical copies**. Arasaka stays 5/14 and 14/30; Merc advances to 11/15 and 21/30. Constructed remains 40–50 main plus three Legends and existing copy/RAM rules. Neither exact 27+3 starter can initialize or play a complete match.


## Evelyn Parker — Scheming Siren: complete ordered ATTACK

Application CardId `evelyn-parker-scheming-siren`, immutable application revision **1**, execution `ATTACK_ORDERED_EFFECTS_V1 / SUPPORTED`. This is an implementation review, not human-certified gold. Blue RAM 3, Unit / Doll, cost 2 Eddies, printed power **0**, Uncommon, artist Olgierd Ciszak, **no Sell tag**, no additional keywords or executable clauses. Retail 113 and Merc demo 010 refer to the same captured card. All five printings and all four captured errata were inspected; no Evelyn erratum applies.

Exact captured text:

> {Attack} Draw 1. Then, if you have more ☆ (Street Cred) than a Rival, discard 1.
> (Units with power 0 don't steal Gigs.)

The second sentence is a reminder of current-power stealing rules. It does not permanently prohibit stealing after Gear increases her power. Ordinary Unit play/payment/Lag uses existing code.

One `WHEN_ATTACKING` ability contains two distinct ordered primitives:

```json
[
  { "kind": "DRAW", "count": 1 },
  { "kind": "DISCARD_CARDS", "player": "CONTROLLER", "count": 1,
    "selection": "CHOSEN_BY_AFFECTED_PLAYER",
    "when": { "timing": "RESOLUTION", "condition": { "kind": "STREET_CRED_GREATER_THAN_RIVAL" } } }
]
```

The existing DRAW handler moves the top physical card DECK→HAND. Rules 10.2, 10.2.3 and 10.3.3 require the second clause to evaluate against the state after that movement, without interleaving another pending ability. Street Cred is derived from current Gigs; drawing cannot change it. The comparison reuses the inverse of the existing Null-aware less-than query: numeric beats Null; equal numbers and Null/Null are false.

**Her controller chooses and discards from their own hand.** The rival is only part of the Street Cred comparison. No rival-choice, random discard, optional decline or hand-reveal permission is printed. Rules 10.1.4 and 10.31 govern resolution and choices. The local comprehensive snapshot has no standalone discard definition: the reviewed synthesis combines that controller/choice wording, captured Shattered Memories' explicit hand-discard wording, and the official guide's confirmation that discarded cards enter face-up Trash. This supplemental guide review is limited to the discard destination and visibility. [Official Gameplay Guide](https://cyberpunktcg.com/gameplay-guide).

`DISCARD_SELECTION` offers every currently eligible own-hand physical card, including the new draw. Zero eligible cards skip; one mandatory card resolves automatically; multiple cards create a strategic TrainingPosition. A successful Evelyn draw always leaves at least one card; zero-card discard is tested only at the trusted primitive boundary. Empty-deck DRAW loses immediately before any condition/discard. No fake forced-choice training sample is generated.

The existing trigger binding retains source revision, subject/controller, turn/batch and ATTACK return context. `primitiveIndex: 1` and `conditionMet: true` persist the paused second clause. The same ability stays current through discard; independent inherited Kiroshi triggers can resolve before or after it. React opens only after the batch completes. Satori still waits until fight win. Floor It/Reboot react after Evelyn finishes and do not reevaluate her condition.

Discard uses a typed semantic operation plus ordinary movement. `CARD_DISCARDED` records physical card, affected player, source/effect and forced status; `CARD_MOVED` records the actual area transition. Full event/history and TrainingPosition state remain authoritative private records. Only observation and action descriptors become model input. The rival sees hand counts before resolution and the face-up discarded identity afterward. Previous Kiroshi memory survives unchanged.

ReplayStateHash and PositionHash distinguish private hand differences. The chooser's ObservationHash and action IDs reflect their visible hand options; the other viewer's hash does not expose those identities. New ordered-effect bundles use observation-derived action IDs even without Kiroshi. Legacy bundles retain their protocol. Old scopes reject the new metadata, including hidden cards; incomplete full shapes cannot initialize.

Raw-byte SHA-256: `a902a898742d6af0a16f37070dcb0d0f5f6a4fac97212522f839857873fd3c7c`. Canonical sourceHash: `df97cd7c2e340aae07ffbf56bd52425a25ca364f18f0272ccfde67710880f540`. Normalized revision hash: `015f486f2a90cd29964dd9086992148bdbdaaa9eef7115629427ccc9a7523b29`.

| Printing UUID | Set | Collector number |
|---|---|---|
| `7d174619-2183-4058-a89a-082c6b7b5a5c` | `welcometonightcityretail` | 113 |
| `c40f0461-c757-4e09-94cc-27ed31f08dd7` | `welcometonightcitybeta` | β113 |
| `4b037f20-0cb8-4dfa-bd34-3a3b8381632b` | `theheistretailstarterdeck` | 014 |
| `c7bc2b37-c1a4-43aa-a4c3-5dd60514b098` | `theheistbetastarterdeck` | β014 |
| `3757f0f3-32d0-41c2-89dc-515271d2b758` | `mercdemodeck` | 010 |

[attack-ordered-effects-card-source.v1.json](../tests/fixtures/attack-ordered-effects-card-source.v1.json) preserves the full record and errata. [attack-ordered-effects-rules.v1.json](../tests/fixtures/attack-ordered-effects-rules.v1.json) pins 61 numbered rules, raw/processed rules and errata SHA-256 values, source-review decisions and the supplemental guide excerpt. No harness corpus refresh occurred.

[attack-ordered-effects.test.ts](../tests/attack-ordered-effects.test.ts) adds 34 focused tests. The [Evelyn replay](../tests/fixtures/evelyn-replay.v1.json) records 17 legal actions, 16 strategic positions and 90 events, including an actual multi-card discard position and return to MAIN. Mongo revision round trips, PostgreSQL reload/resume, all 18 Python replay families and the original 17-payload audit cover this addition. See [attack-ordered-effects-report.md](attack-ordered-effects-report.md) for commands and measured results.

Current demo coverage is **17/29 distinct cards, 38/60 physical copies**: Arasaka 5/14 and 14/30 unchanged; Merc 12/15 and 24/30. Remaining Merc cards are V — Corporate Exile, Dying Night — V's Pistol and Delamain Cab. Constructed remains 40–50 main plus 3 Legends with existing copy/RAM limits; neither exact 27+3 starter can initialize or run a complete match.


## END_TURN_HISTORY_V1: Delamain Cab

Application CardId `delamain-cab`, immutable application revision **1**, `END_TURN_HISTORY_V1 / SUPPORTED`. Full captured Unit / Vehicle, Blue RAM2, cost4 Eddies, printed power4, **unsellable**, Common. Retail artist CD PROJEKT RED; beta artist Daniel Valaisis; all five printing records and all four captured errata reviewed, none applicable. No additional reminder, keyword, restriction, activation cost, equip clause or effect was omitted. This is an implementation-reviewed executable bundle, not human-certified gold or an automatic catalog import.

Exact captured text:

> At the end of your turn, if this Unit stole a Gig this turn, ready 1 Eddie.

The single `WHEN_OWN_TURN_ENDS` ability has condition `SUBJECT_STOLE_GIG_THIS_TURN`, no cost, and effect `{kind:"READY_EDDIES",player:"CONTROLLER",count:1}`. The narrow admission validator requires this whole shape. Existing ordinary Unit payment, play, Lag, Gear-derived power, attack/React/fight and actual Gig stealing are reused.

The authoritative history extends Jackie's existing current-turn summary with optional `gigsStolenByUnit: Record<CardInstanceId, positive integer>`. Only actual `GIG_STOLEN` facts increment the attacking physical Unit's count. Another Unit's steal, mere attack declaration, ownership/control, an earlier turn's steal and generic control transfer do not qualify Delamain. Multi-Gig steals increment per Gig but produce just one end-turn trigger per qualifying Delamain. No runtime card-name branch or general event-query language was added.

Rules 8.9 and 8.16.1 begin end-turn effects; the existing pending-effect scheduler can pause for controller-selected order or Eddie selection. Only after that batch completes does cleanup remove Lag, expire Floor It/unused Reboot, emit TURN_ENDED and begin the rival's next turn. History and CALL/SELL counters reset in startTurn, after the old turn's work. Conditions are checked at discovery and resolution. Pending-source departure follows 10.15; a focused Trash move does not cancel an already pending ability. No supported effect changes controller or re-equips Gear here.

Readying changes the selected own spent face-down Eddie's **SPENT→READY** on the same CardInstance, with no zone movement or numeric currency counter. It uses existing `CARD_READIED`. “Ready 1” is mandatory if possible: zero eligible cards skip, one auto-resolves, multiple produce `EDDIE_READY_SELECTION`. Each subsequent source rederives options from current readiness. Both players are forbidden to inspect underlying Eddie identities by 5.8.3.1; descriptors use public slots such as “Ready Eddie 1.” Ready Eddies, rival Eddies and Legends are ineligible.

Public observation adds current-turn physical-attacker/count facts only when present; full histories affect replay and POSITION_V2 hashes. This bundle uses observation-derived action IDs. Sold CardIds/revisions do not appear in Eddie options, descriptors or either viewer's observation. Kiroshi memory is untouched. Full replay state/history remains private; model input is only the entitled observation plus actionId/descriptors. TrainingAttempt and wire protocol v1 are unchanged; additive schemas are regenerated.

Raw-byte SHA-256: `201a4b6123f8c7ce153a86af4abf6d1e225f0dc7c618982bc081a0b0d453292c`. Canonical record sourceHash: `e0b999c826a7b7456d86a4142b168e9b43825563c600ca2f39fd18b40f5df473`. Normalized revision hash: `e696327e1483d61a95b00550b25412645f19f2a3feef6cf584b346a64f0ffddd`.

| Printing UUID | Set | Collector number |
|---|---|---|
| `5b9cdefa-29f4-4a3a-a426-eea46302ef60` | `welcometonightcityretail` | 112 |
| `cddf9659-8ba5-4718-827f-5a6518e7df83` | `welcometonightcitybeta` | β112 |
| `8092ff00-bff0-4a33-98e1-1fa33adabb8d` | `theheistretailstarterdeck` | 013 |
| `a6bc4a11-ed78-49dc-999b-68b7fe50aefd` | `theheistbetastarterdeck` | β013 |
| `e15c07b6-f563-4825-aad4-6b3068c1ab85` | `mercdemodeck` | 009 |

[The two-card source fixture](../tests/fixtures/end-turn-history-card-sources.v1.json) preserves both complete raw records and all errata. [The rules fixture](../tests/fixtures/end-turn-history-rules.v1.json) pins 175 numbered rules, decisions, raw/processed rules hashes and errata hashes. Raw rules SHA-256 `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd`; processed `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19`. No corpus refresh occurred.

[32 focused tests](../tests/end-turn-history.test.ts) cover complete admission, one/two-source ordering, actual and non-steal history, prior-turn negatives, zero/one/multiple Eddies, hidden identity, stale/forged state, expiration and immutable format pins. [The legal Delamain replay](../tests/fixtures/delamain-replay.v1.json) contains 33 actions, 33 strategic positions and 140 events, ending at turn6/CHOOSE_GIG. Mongo immutable revision and PostgreSQL reload/resume tests plus the generic Python adapter cover the new state. See [end-turn-history-report.md](end-turn-history-report.md) for the complete source review and gates.

## Dying Night — V's Pistol: complete bounded delayed ATTACK support

Application revision 1 uses `GEAR_DELAYED_ATTACK_V1`, status `SUPPORTED`. The complete captured shape is Blue RAM2, cost2, printed power2, sellable Gear / Merc / Weapon, Rare, artist Ivan Shavrin, Merc Demo Deck **013**, retail128. Exact captured text:

> (Equip to a friendly Unit or face-up Legend.)
> {Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit is named "V", ready 2 Eddies.

Both sentences remain **one ATTACK paragraph**, confirmed by all five current official printing images; the Merc image is retained in [dying-night-demo013.webp](../tests/fixtures/dying-night-demo013.webp). The earlier Delamain milestone left this card blocked; this review found the official site's card FAQ API, including two explicit rulings: choosing no decrease preserves the benefit, and defeat of the attacking V host does not cancel it. [Official Dying Night FAQ](https://api.netdeck.gg/api/faqs/cyberpunk?scope=card&card_slug=dying-night-v-s-pistol).

The normalized inherited `WHEN_ATTACKING` ability has exactly two ordered primitives: `DECREASE_GIG_UP_TO` and `REGISTER_END_TURN_EFFECT`. There is no recurring end-turn ability on this Gear. Normal Gear play/payment/equip and printed power inheritance remain shared. First choose either player's rolled Gig in GIGS, never Fixer, then choose 0..min(2,currentValue−1). Zero emits no value-change fact. Rules10.2.1/10.6.2 and the explicit zero FAQ mean the later registration still runs when the first instruction does nothing or lacks a target.

`DelayedEffect` holds deterministic occurrence identity, creation turn/controller, physical Gear source plus immutable CardRef, original host plus immutable CardRef, and originating ATTACK ability/batch/effect identity. It is distinct from `PendingEffect`: registration completes the ATTACK paragraph and allows React, combat and normal MAIN actions. IDs use semantic turn/source/subject/occurrence and controller seat, never counters or transport UUIDs. Two Gear copies or repeated attacks register separately (4.11.3,11.6.4,10.16.2–3).

Registered work survives source or host departure to public Trash, including semantic defeat and Gear detachment (official host-defeat FAQ,4.12,10.10.1). It never rebinds to a later attachment. Unchanged immutable subject data supplies the later Unit/Name query. Hidden-zone departures, control changes and type/name-changing mechanics remain unsupported; such delayed states reject explicitly. No unsupported general lifecycle is inferred.

At the current own-turn end, stored work moves into the existing scheduler alongside board-discovered Delamain abilities (8.16.1,10.12–13). Controller orders independent effects. The internal condition is evaluated when reached (10.3.3): subject revision type UNIT and exact `deckbuildingIdentity === "V"`. Name excludes subtitle (3.9.2/3.10.2); no display parsing or slug matching. A Legends-area Legend named V does not qualify. False condition and zero eligible Eddies complete and remove the one-shot instruction.

`READY_EDDIES count2` collects an unordered set before changing any readiness (3.8,5.8,10.31.2). Zero/one/two eligible Eddies auto-resolve as far as possible. With three or more, public-slot choices gather two distinct slots, then commit both in canonical order in one effect; the first selection leaves every Eddie spent. No other effect interleaves (10.2.3). It is not two count1 effects. Later effects recompute eligibility; both Dying/Delamain orders are tested. Lag, Floor It, unused Reboot, history and private memory retain the established cleanup ordering.

Public observation exposes future source/subject, controller seat, timing and reviewed condition/count, plus the public partial Eddie selection. It omits occurrence internals and sold-card identities. Replay and POSITION_V2 hashes include exact future work; entitled observation hashes include its public projection. Action IDs remain independent of hidden Eddie contents. Generic `DELAYED_EFFECT_CREATED` makes registration auditable; end turn reuses `EFFECT_PENDING`, `CONDITION_EVALUATED`, `CARD_READIED` and `EFFECT_RESOLVED`.

Raw-byte SHA-256: `ff35eafac6b1c3c89c3eef1d997dad09a03244fbdd00ff577cc25dfd8ba320b0`. Canonical raw record hash: `33229b2912f87aadec96b43ab24bc7b39d2a569ab4bed37676c2797d05011069`. Normalized revision hash: `162169d6cb32d35f93bb6aeedaee44d08f5aece9bdee82ddc388647b5522cb4a`. The [complete source fixture](../tests/fixtures/delayed-effects-card-source.v1.json) pins all printings, four errata and five image hashes; no Dying erratum exists in the reviewed set. The [focused rules fixture](../tests/fixtures/delayed-effects-rules.v1.json) pins 204 rules, raw/processed hashes and five narrowly relevant official FAQ record hashes/summaries. Current official rules and errata still match the local captures; no corpus refresh occurred.

| Printing UUID | Set | Collector number |
|---|---|---|
| `2b1b6268-193f-4b9e-a63c-0cbc200d6db7` | `welcometonightcityretail` | 128 |
| `3ceebded-0941-477f-b486-f2cb22ca653d` | `welcometonightcitybeta` | β128 |
| `4bb35017-9842-4178-99a6-34353a3de2d4` | `theheistretailstarterdeck` | 017 |
| `1dc3c618-a40a-4717-bf4d-a573915c8ac0` | `theheistbetastarterdeck` | β017 |
| `dd423c67-68f4-4da8-884c-cbeb91554c0d` | `mercdemodeck` | 013 |

[55 focused tests](../tests/delayed-effects.test.ts) cover complete admission, zero/no-target clauses, lifetime, multiplicity, ready2 forced/strategic choices, stale/malformed state, privacy, hashes, V identity/type, Delamain/Kiroshi/Evelyn/Dexter/Satori interactions and cleanup. The [legal Dying Night replay](../tests/fixtures/dying-night-replay.v1.json) has 36 actions, 35 strategic positions and 154 events through turn6. Its real host is Delamain: the V condition is false. The true named-V path uses a clearly labeled synthetic trusted Unit, not a real V admission. Mongo round-trips the immutable revision; PostgreSQL reloads the legal trace and both positive ready2 choice stages. Python traverses the replay through generic action IDs.

Current measured demo coverage: **19/29 executable distinct, 43/60 physical copies**. Arasaka remains5/14 and14/30; Merc reaches14/15 and29/30. Its only remaining card blocker is **V — Corporate Exile (1 copy)**. Exact27+3 lists still fail constructed **40–50 main + exactly3 Legends**, with copy/RAM unchanged. Neither demo can initialize or play a complete match. See [delayed-effects-report.md](delayed-effects-report.md) for evidence, commands and remaining boundaries.

The Gear/Legend steering audit confirms that Dying grants power and inherited ATTACK text to a friendly face-up Legend in `LEGENDS`, while attack legality and the later Unit-and-Name condition remain separate. Faceplate is still unadmitted; spend-trigger and future field-Legend integration gaps are recorded in [Gear on Legends-area hosts](delayed-effects-report.md#gear-on-legends-area-hosts).


## FIELD_LEGENDS_V1 — V — Corporate Exile

New immutable application revision v-corporate-exile / 1 is fully admitted under the explicit field-Legend policy. Complete captured text:

> {Go Solo} (Pay this Legend's cost to play it as a ready Unit. It can attack this turn. When it leaves the field, remove it from the game.)

Printed LEGEND, Blue RAM2, cost5, power8, sellable, classifications Corpo/Merc. Raw keywords are empty; opening markup normalizes to GO_SOLO. No other abilities, conditions, costs, modifiers or triggers occur in the captured card. All four local errata were reviewed; none applies to V. That first admission covered only V; the Goro extension below adds a second complete shape.

| Printing UUID | Set | Number |
|---|---|---|
| 4a5591f9-743e-4186-8deb-560971bb3f82 | theheistretailstarterdeck | 012 |
| a6511c82-3a16-41b3-a39a-5194897c8648 | theheistbetastarterdeck | β012 |
| 20bd1c78-1773-486e-bf45-4075fd4f2a3f | mercdemodeck | 008 |
| f509ebd8-c8b7-4a22-8922-2d71c6df0b6f | boxtoppersretail | 006 |
| e44580df-d78d-4b09-bb53-edb1ee32ac96 | boxtoppersbeta | β006 |
| 848e3de6-3a3e-462e-8186-0a214ff03b79 | edgerunneropens1 | 053 |

Complete record/printings/errata: [field-legends-card-source.v1.json](../tests/fixtures/field-legends-card-source.v1.json). Raw file SHA-256: deac316764ac93da51d4cae2602d52ca7b63551d2ccbc048f2e849d9ef5b8f67. Canonical record hash: d1b56071f0eabd301c6e5ca5d1b63cae6bb68267a2a6c368f54d32f3d424ab9b. Immutable normalized revision hash: 7d9d2b9a32b578db8fb254142b506d8224b7345dd0ca8a78189bd08d76e35aeb. [Rule fixture](../tests/fixtures/field-legends-rules.v1.json) pins216 local rule nodes and16 relevant official FAQ IDs/findings/hashes. Current official rules parse identically to the local capture; V differs only in image URLs. No corpus refresh.

Both PLAY_CARD and GO_SOLO require own open MAIN, face-up reviewed LEGENDS source and exact printed payment. Readiness is not required. The entering Legend may pay for itself. Ordinary entry preserves its post-payment orientation and applies Lag. Go Solo enters READY with Lag and specifically permits attacking that turn; Spend-icon effects remain prohibited. Other attack restrictions still apply. Both modes count as Unit PLAY for Jackie's first-Blue guard; moving attached Gear is not another play.

The semantic moveLegendToFieldWithAttachments operation moves the same host and sorted attached Gear to BATTLEFIELD in one action result, retaining attachments, owner/controller and printed identity. Effective types become LEGEND + UNIT without revision mutation or a new Unit instance. Existing Gear power/text continues to apply; Unit-only action eligibility changes through shared combat queries. Pre-equipped Mandibular can Block, Satori can draw after a fight win, and Kiroshi can privately look after ATTACK. Legends-area hosting and ordinary CALL/payment remain supported.

Defeat uses shared fight/owner-ordered Trash movement: host and Gear reach Trash, detach, then V reaches REMOVED while Gear stays. Outside FIELD V's current effective type is LEGEND. Dying's new field-Legend delayed records retain last-valid LEGEND + UNIT types for the reviewed public defeat/removal lifetime, following10.10.1 and the Dying FAQ. Exact Name identity is evaluated at resolution. Ordinary Unit delayed records remain unchanged.

The canonical real V-positive [field-Legend replay](../tests/fixtures/field-legends-replay.v1.json) has **38 actions, 37 strategic positions, 159 events**: setup, blind CALL slot1, pre-equip Dying, Go Solo, same-turn ATTACK, decrease2/registration, React/steal, real V-positive ready2, next turn. No state/RNG patches. [47 focused tests](../tests/field-legends.test.ts) cover ordinary play, readiness, self-payment, multiple Gears, Blocker, Satori, Kiroshi, defeat, malformed states, privacy, hashes, wire and training. Original Dying/Delamain negative and synthetic isolated Name regressions remain.

Merc individual execution coverage is **15/15 distinct, 30/30 copies**; Arasaka remains **5/14, 14/30**. Exact teaching-list initialization remains unavailable pending format review. Faceplate/WHEN_SPENT, other Legend shapes, control changes and return-to-LEGENDS effects remain outside this scope. See [field-legends-report.md](field-legends-report.md).

## FIELD_LEGENDS_V1 — Goro Takemura — Hands Unclean

Immutable application CardId **goro-takemura-hands-unclean**, revision **1**, execution **SUPPORTED / FIELD_LEGENDS_V1**. Complete captured text:

> {Go Solo} (Pay this Legend's cost to play it as a ready Unit. It can attack this turn. If it leaves the field, remove it from the game.)
> {Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)

Printed Legend, Green RAM 2, €5, power 7, sellable, classifications Arasaka/Corpo. API keywords is empty; the two printed markup clauses explicitly normalize to GO_SOLO and BLOCKER. There are no additional triggers, conditions, modifiers, restrictions or activated abilities. All four captured errata were reviewed; none applies. The exact raw record, all six printings and errata are retained in [goro-card-source.v1.json](../tests/fixtures/goro-card-source.v1.json); [goro-fixture.ts](../tests/goro-fixture.ts) contains the complete explicit normalization.

| Printing UUID | Set | Number |
|---|---|---|
| 2ba68619-7050-44c5-b0ce-b32d48b8f40f | embracingpowerretailstarterdeck | 012 |
| 25b09451-8cc8-4581-898d-3b5ee6ff6b14 | embracingpowerbetastarterdeck | β012 |
| fd889659-8291-41fd-9197-9cdf7cbf6810 | arasakademodeck | 008 |
| 1b6e44dd-d6e7-46eb-a5e5-24c38eed888b | boxtoppersretail | 003 |
| 15430373-fafd-479c-84d4-5737c71d0850 | boxtoppersbeta | β003 |
| 8bdba66b-a20e-49f3-8e85-2e3d7e0c6a37 | edgerunneropens1 | 041 |

Arasaka Demo printing: **fd889659-8291-41fd-9197-9cdf7cbf6810 / 008**. Raw-byte SHA-256: a70354773e9362bc2f5b919d9be28ba1c8d4d33326573067413586fd3e0fb4f2. Canonical raw-record hash: ea8be33a89100f6a55d104961b0f0a60878c1c9c2690118d7fe4bc1ad2bfd525. Normalized immutable revision hash: ffe03cff4ba12a5f241d5d92d71e8da39e006bc5d866fd1a1ece2c2d284f8703.

[goro-rules.v1.json](../tests/fixtures/goro-rules.v1.json) preserves the 216 exact field-Legend rule nodes and 16 prior focused FAQ findings, plus Hands Unclean's own FAQ 9ad7e1cf-9965-4ba0-8503-ac17c897ffbd: Blocker cannot be used in LEGENDS. It pins raw/processed rules and errata hashes and the narrow live FAQ review. Current official gameplay fields and printing identities match the local Goro capture; all 270 FAQ questions/answers/publication dates match the previous review. Signed image URLs change response-byte hashes without changing semantics. No corpus refresh.

Only the complete-shape admission predicate changes in the engine. Both variants share payment, CALL, ordinary play, Go Solo, movement, effective types, Gear inheritance, attack, Blocker, fight, defeat, observation and delayed-effects infrastructure. No card ID/name branch, Goro action or second field-Legend policy is added. Green RAM 2 is evaluated by ordinary constructed validation; Green entry does not consume Jackie's first-Blue history.

Same CardInstanceId/owner/controller/revision/face/attachments move atomically from LEGENDS to FIELD. Mantis gives **7+2=9** in both areas; Satori gives 9 and inherits fight-win draw; Kiroshi gives 8 and private ATTACK look; Mandibular adds a second physical Blocker source while there remains one semantic declaration; Dying gives 9, registers normally, and later evaluates false for Goro's Name, including after defeat. Multiple Gear do not double-count power or detach/re-equip. General Legends-area Gear hosting remains intact for future Faceplate work.

Printed Blocker exists in LEGENDS but cannot be declared there. On FIELD, ready Goro uses the existing React spend/redirect/fight pipeline. Lag does not independently prevent Blocker; own-turn Go Solo/ordinary play's Lag clears at end turn before the later legal rival attack. Go Solo grants its same-turn attack exception; ordinary entry preserves post-payment orientation and cannot attack while Lagging. Field Goro cannot CALL or pay as a Legends-area source. Defeat offers the owner's Gear/host Trash order, then removes the Legend and leaves detached Gear in Trash.

[45 focused tests](../tests/goro.test.ts) cover full admission, payment/self-payment, ordinary entry, pre-equipped Gear, all inherited compositions, duplicate Blocker sources, attack restrictions, Green history/RAM, eligibility, visibility, transport-normalized hashes, wire action IDs, constructed invariants and retained V behavior. The [legal Goro replay](../tests/fixtures/goro-replay.v1.json) has **58 actions, 56 strategic positions, 229 events**, finishing turn 8 MAIN after printed-Blocker defeat. It uses constructed 42-main/3-Legend synthetic support decks and no state/RNG patches.

Engine **0.4.0-field-legends-2**. All 21 original families/665 original decisions preserve their semantic payloads under new pins. Mongo tests publish/read the immutable revision; PostgreSQL reloads every legal trace state and event batch, including payment and owner-order pauses; Python adds only the new generic replay family. Wire v1 schemas and TrainingAttempt remain unchanged.

Demo coverage is now **21/29 distinct and 45/60 copies**: Merc stays 15/15, 30/30; Arasaka reaches 6/14, 15/30. Remaining Arasaka cards, Faceplate/WHEN_SPENT, unreviewed Legend shapes, arbitrary control changes and return-to-LEGENDS effects remain unsupported. Exact 27+3 teaching decks still cannot initialize under constructed. See [goro-field-legends-report.md](goro-field-legends-report.md).

## FIRST_ATTACK_HISTORY_V1 — Yorinobu Arasaka — Embracing Destruction

Immutable application CardId **yorinobu-arasaka-embracing-destruction**, revision **1**, execution **SUPPORTED / FIRST_ATTACK_HISTORY_V1**. Complete captured text:

> The first time a friendly ARASAKA Unit attacks each turn, draw 1. Then, if you have less than 20 ☆ (Street Cred), discard 1.

Legend, Red RAM2, sellable, Arasaka/Corpo, Null printed cost/power, no Go Solo, no markup keywords, no flavor text and no additional rules text. ADIA illustrates the three Epic starter/demo printings; Vincenzo Riccardi illustrates the three Nova Rare variants. Full normalization is in [yorinobu-fixture.ts](../tests/yorinobu-fixture.ts). All six printings and all four local errata are pinned in [yorinobu-card-source.v1.json](../tests/fixtures/yorinobu-card-source.v1.json); no erratum applies.

| Printing UUID | Set | Number |
|---|---|---|
| f70b75b5-aa2f-4c2d-b8c3-01fcb2a670ec | embracingpowerretailstarterdeck | 001 |
| 362bef23-c935-4729-a13b-dc3bc646d9b3 | embracingpowerbetastarterdeck | β001 |
| aaad5db8-fcd4-42f0-8ced-e7527dbccf79 | arasakademodeck | 001 |
| dc7bb3cf-1005-4584-ad7a-447f0ccf07bf | boxtoppersretail | 001 |
| 12337d92-713c-4c7c-8a16-595a7b4717f1 | boxtoppersbeta | β001 |
| ba15a39b-fc76-474b-a2f0-76e5069a69e4 | edgerunneropens1 | 034 |

Arasaka Demo printing: **aaad5db8-fcd4-42f0-8ced-e7527dbccf79 / 001**. Raw-byte SHA-256: **9a01723fde94d8feca1582272de879bba21feec88faa012856a448226061c51d**. Canonical captured-record hash: **5d94f9d0d3d9851efcb49f81878af2a3b47faf71aeea47c95336570ab4bcdbba**. Normalized immutable revision hash: **63333c2d8392b6368390474593bb897066a792276b7af8b54d6d08635f120f3d**. The focused live card check matches gameplay fields and all printing identities; signed images/selected printing are transport metadata. No AI corpus refresh.

[yorinobu-rules.v1.json](../tests/fixtures/yorinobu-rules.v1.json) pins **252** exact local rule nodes, source hashes and the two focused official FAQ records. FAQ **61ad63b3-47d9-48ee-a3f6-4c2842b11c66** explicitly forbids triggering after an earlier qualifying attack before reveal. Saburo FAQ **18318e94-6979-4623-9cf5-fee73924d728** is retained only for next-milestone review. The raw/processed rules and errata hashes are unchanged.

Qualification is per controller, per global turn: an actual face-up FIELD effective Unit with exact immutable **Arasaka** tag. A field Goro is LEGEND + UNIT and qualifies. Deck affiliation, display name, slug, case-folding and attached Gear never supply classification. No currently admitted printed demo Unit supplies Arasaka; the narrow printed-Unit test uses a distinct synthetic revision. Source-independent history records at ATTACK_DECLARED after target lock/spend even with Yorinobu hidden or absent. Enumeration and target-selection start do not record. Retain count and first physical attacker/CardRef; Blocker, invalidation, combat cleanup, defeat and Goro removal do not undo it. Only next global startTurn resets both players.

The face-up LEGENDS source joins the shared ATTACK batch for the first qualifying occurrence. No field entry is added for Null-cost Yorinobu. DRAW1 then current Street Cred <20 then controller chosen discard1 reuse the ordered continuation. Null is below 0 under5.11.4.2 and therefore below20, without numerical coercion. The drawn card is eligible; one hand option resolves automatically, multiple produce DISCARD_SELECTION, ≥20 skips discard, and empty draw loss stops the remaining clauses. Dying/Kiroshi can be ordered before or after this effect; nothing interleaves within it. Satori remains fight-win timing; Floor It/Reboot remain later React.

Public per-seat **turnAttacks** exposes only the count even when Yorinobu is face-down. Hidden Legend identity and rival hand data stay private. Position and both observation hashes change with consumed history; transport counters do not. The first-attack policy independently opts into observation-derived action IDs and preserves older Swordwise ATTACK execution without requiring other late-scope cards in the content bundle.

[86 focused tests](../tests/yorinobu.test.ts) cover source-independent/reveal timing, real Goro, printed synthetic Unit, exact filtering, controller/global-turn semantics, ordered thresholds/Null/empty cases, composed scheduling, removal/reset, strict metadata/history/pending validation, complete captured batches, hashes, privacy, wire and constructed boundaries. The legal [Yorinobu replay](../tests/fixtures/yorinobu-replay.v1.json) has **49 actions, 48 strategic positions, 209 events**, through turn7 MAIN: setup, blind CALL slots1/2, real Dying pre-equip, Goro Go Solo, Yorinobu-first ordering, chosen discard, React/combat, reset and another qualifying attack. No state/RNG patches. The same-turn second attack is a validated trusted focused setup because no admitted repeat-ready card is used.

Engine **0.4.0-first-attack-history-1**. All22 original families/723 original decisions retain their semantic payloads under new pins. Mongo publishes/reads the immutable revision; PostgreSQL reloads the legal trace and a separately identified trusted second-attack/next-turn trace. Python adds only one family name. Wire v1 is additive; TrainingAttempt is byte-unchanged.

Demo coverage becomes **22/29 distinct and46/60 copies**: Arasaka7/14 and16/30; Merc15/15 and30/30. The physical27+3 lists remain unchanged and illegal under constructed40–50 main/exactly3 Legends. Saburo, Losing His Way, the other five Arasaka blockers, Faceplate/WHEN_SPENT, control changes, off-turn attack actions and general trait/event languages remain unadmitted. See [yorinobu-first-attack-report.md](yorinobu-first-attack-report.md).

## ATTACKING_AURA_V1 — Saburo Arasaka — Stubborn Patriarch

Immutable application CardId **saburo-arasaka-stubborn-patriarch**, revision **1**, execution **SUPPORTED / ATTACKING_AURA_V1**. Complete captured text:

> Friendly ARASAKA Units have +1 power while attacking.
> (Units steal an extra Gig for every 10 power.)

Legend, Green RAM2, sellable, Arasaka/Corpo, Null printed cost/power, no Go Solo, no markup abilities, no raw keywords and no flavor text. The six printings and all four local errata are retained in [saburo-card-source.v1.json](../tests/fixtures/saburo-card-source.v1.json); no Saburo erratum applies. [saburo-fixture.ts](../tests/saburo-fixture.ts) contains full normalization. Three Epic starter/demo printings use ADIA; the three Nova Rare variants use Vincenzo Riccardi.

| Printing UUID | Set | Number |
|---|---|---|
| 6ac7adce-01af-4b5b-956b-698eda0bed14 | embracingpowerretailstarterdeck | 013 |
| 54136fbd-ce97-4d23-a8e8-f876e3e64819 | embracingpowerbetastarterdeck | β013 |
| 13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca | arasakademodeck | 009 |
| 77e482f2-6090-47e9-9d03-be28417cb1cb | boxtoppersretail | 004 |
| 0cb4ae83-a7ca-4ca6-9c83-6c0581baae57 | boxtoppersbeta | β004 |
| 46387af0-342b-40c7-82fa-858d08ea473f | edgerunneropens1 | 047 |

Arasaka Demo printing is **13ba5cd2-5000-4cf8-bcfc-6f1b8afe44ca / 009**. Local raw-byte SHA-256: **72d450459d340c1088b3713701d80bec7c289a98258aa491e0b946824af649b2**. Live source SHA-256: **3a28a40a678febfc2a4e1dd5c17d6977db96874c51c4b99131bb016915cf4f9e**. The narrow live check matched all gameplay fields and printing identities. Canonical raw-record and normalized revision hashes are recorded in the [milestone report](saburo-attacking-aura-report.md).

[saburo-rules.v1.json](../tests/fixtures/saburo-rules.v1.json) pins exact rules for controller relationship, face/readiness, Legend source areas and payment, classification/effective Unit type, persistent effects, attack boundaries, Fight and Steal. Official FAQ **18318e94-6979-4623-9cf5-fee73924d728** explicitly answers **Yes** to the +1 applying in Fight and Steal. Live parsed comprehensive rules exactly match the local snapshot; no broad corpus refresh. These are implementation-reviewed sources, not human-certified gold.

The source must be its controller's unique face-up Saburo in LEGENDS. READY and SPENT both work; actual legal payment with Saburo is covered. Face-down/REMOVED sources do not contribute. Current source eligibility is queried live, so trusted mid-attack reveal/removal changes power immediately. Saburo has Null cost and no Go Solo, so FIELD entry and control-transfer actions remain unadmitted; hypothetical field-source semantics are not guessed.

The target must currently be the declared attacker, on its controller's field, face-up, effective UNIT and exactly tagged **Arasaka**. Effective type includes real Go Solo Goro; Gear does not confer tags. Owner alone, deck membership, name, CardId and color are not selectors. A target/Blocker/non-Arasaka Unit receives nothing. Before target lock/spend/declaration the aura is absent. It remains through ATTACK effects, React/Quick effects, Blocker redirection, Fight, Steal and pending cleanup, then disappears when combat clears, including early invalidation.

One narrow continuous modifier is derived by the shared **RulesView.getApplicableCharacteristicModifiers/getEffectivePower**, retaining physical source/subject IDs. There is no PendingEffect, new action, event, stored target/duration/modifier or cleanup mutation for Saburo. Both observations use existing public effectivePower. Source availability and CombatState already distinguish positions; transport counters remain irrelevant to position/action IDs.

Real Goro7 + Mantis2 is9 before attack,10 while attacking with Saburo, then9 afterward. The headline's actual steal allowance changes from1 to2 with two strategic selections. Real Goro+Satori changes a9–9 tie to a10–9 win and truthfully triggers Satori's draw. Floor It composes as7+2+1−1=9 before actual Steal; its end-turn −1 remains after Saburo naturally stops. Yorinobu triggers only on the first qualifying attack; Saburo contributes again to a trusted second same-turn attack. Royce's existing per-Gear modifier remains unchanged.

[60 focused tests](../tests/saburo.test.ts) cover complete admission, source eligibility/spending, exact filters, timing, Fight/Steal outcomes, composition, strict old-scope/state rejection, uniqueness, privacy, hashes, wire, training and constructed invariants. The [legal Saburo replay](../tests/fixtures/saburo-replay.v1.json) has **44 actions, 44 strategic positions, 172 events** through turn7 MAIN. It uses 42 main cards, three actual Legends and eight existing synthetic Gear filler revisions; no new synthetic revision or state/RNG patch. Every old immutable revision is preserved.

Engine **0.4.0-attacking-aura-1**, additive wire v1. Mongo publishes/reads the immutable revision; PostgreSQL reloads the complete legal trace including spent source and live power across both Gig choices. Python adds only one replay-family name. See the report for all quality gates and the original-payload audit.

Measured demo coverage becomes **23/29 distinct, 47/60 copies**: Arasaka8/14 and17/30; Merc15/15 and30/30. Six Arasaka cards/13 copies remain blocked. Both physical27+3 lists stay unchanged and invalid under constructed40–50 main/exactly3 Legends. The [roadmap](demo-deck-coverage-roadmap.md) records the read-only next-cluster review.
