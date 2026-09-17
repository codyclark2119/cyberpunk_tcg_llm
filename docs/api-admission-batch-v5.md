# API Admission Batch V5 — Detonate / reviewed Gear defeat

## Status and review correction

This is the amended implementation contract for draft PR #10. It incorporates the review of `0cf8619463958e3e31e42ad87e6feb37feda9e51`, based on post-V4 master `3efe0f72b0f8f04c1268b87633fbba4fdf7c269f`.

The first schema/admission-foundation slice is now present: exact Gear vocabulary, reserved scope/policy, a shape-review predicate, and fail-closed foundation tests. Runtime identity advances to `0.4.0-api-admission-5` because schemas/runtime inputs changed. **Gear execution remains disabled**; no Detonate revision, target/React lifecycle, source-evidence capture, regenerated baseline, or passing project gate is claimed. See `api-admission-batch-v5-implementation-status.md` for the precise implemented/pending split.

The initial contract understated the work. A Gear selector alone is insufficient: current targeted-defeat validation is active-player/noncombat-only, its admission gate excludes Quick, its metadata detector claims every `DEFEAT_UNIT`, and the shared defeat target gate rejects all Gear. These are explicit V5 implementation requirements, not properties the current engine already supplies.

## Summary

Batch V5 targets one API candidate:

- `detonate` — RED Program, cost 1, RAM 2, sellable;
- printed text: `{Quick} Defeat a rival Gear with power 2 or less.`

Reuse the existing target-choice, defeat, attachment/departure, Program completion, and public-action machinery. Add a narrowly reviewed Gear capability and the continuation validation needed to use that machinery during an existing defender React window. Do not add a second destruction pipeline or a new timing window.

```text
reviewed Quick Program / separate Gear-defeat capability
→ Main or defender React play and payment
→ choose eligible rival Gear in BATTLEFIELD or LEGENDS
→ reference that Gear's own effective power, at most 2
→ shared effect-defeat / detach / owner-Trash processing
→ complete the Program and return to the captured Main or React context
```

## Source facts and authority boundary

Pin the raw record, processed record, engine candidate, printings, manifest hashes, matching errata, and relevant rules from the reviewed AI snapshot:

```text
repository: codyclark2119/cyberpunk_tcg_ai
commit: af9e0e1dd93b7eb77db5883bdd18809c8446d856
raw card: data/raw/cards/detonate.json
candidate catalog: data/engine-candidates/card-catalog.v1.jsonl
rules: data/processed/rules.jsonl
```

Expected source facts: Program; Red; cost 1; RAM Red 2; sellable; Quickhack classification; no numeric Program power; retail collector number 031; the printed text above. Confirm the matching-errata result from that snapshot rather than assuming an empty join.

Source and candidate records remain evidence only. Explicitly author the immutable executable revision. Do not rewrite captured source keyword arrays to manufacture Quick metadata: preserve the raw source and author `mechanics.keywords: ["QUICK"]` using the established revision convention. No runtime English parsing, CardId dispatch, or source-hint-to-mechanics conversion.

## Rules review: conclusions and evidence classification

The following conclusions incorporate the reviewer's analysis of the pinned corpus. Preserve the cited records in the V5 evidence capture; the conclusions are not a substitute for those records or a live corpus refresh.

### Gear power reference

Use the candidate Gear's own power, not its host's power.

- 3.17.3.2 specifies printed Gear power.
- 3.17.3.3 permits modification only by effects specifically targeting the Gear.
- 3.17.2, 3.17.3.1, and 11.6.5 make Gear power contribute to the host, not the reverse.

The selector must obtain `effectivePower(state, gearId, context)`, reject a null/non-numeric reference, and compare `referencedPower(power) <= 2`. Do not read the host's effective power or substitute `revision.power` for the authoritative characteristic query. The query returns printed Gear power under the current capabilities, but keeps a future explicitly supported Gear-targeted modifier expressible without changing this selector contract.

The clamp is currently a no-op for the reviewed nonnegative Gear values. Do not infer general Gear-modification support from using the query.

### Gear in the Legends area

A rival face-up Gear attached to a face-up Legend in `LEGENDS` is an eligible target, as is an eligible Gear on a battlefield host. Do not conflate Gear targeting with targeting the Legend itself.

Rules basis: 4.10.2 permits both equip areas; 1.7.2 establishes rival control in the rival's areas; 11.6.1.2 contemplates Gear defeat and names the relevant areas; 5.7.4 establishes Legends-area visibility while the face-down-Legend restriction does not hide its face-up Gear. Detonate supplies no narrower area qualifier. This conclusion uses the combined rules review, not equip legality alone.

Hidden areas, face-down cards, Trash, Removed, and invalid/unattached arrangements are not new V5 target areas. Existing attachment/state validation still applies.

### Defeated Gear destination: explicit reviewed inference

No rule matching the reviewer's documented search supplied a general defeat definition or a direct defeated-Gear destination. The review used regex searches over the 713-node processed `rules.jsonl`: rules containing `defeat` outside the 9.19 subtree, the full 5.7 and 11.6 subtrees, and 4.10–4.12. This is a thorough pattern/subtree review, not a line-by-line audit of all 713 nodes or proof that no differently worded rule exists. Rule 9.19.1.1 is about a Unit in fight resolution; 11.19.x describes the Unit-scoped `[DEFEATED]` trigger. Neither may be quoted as a literal Gear-to-Trash rule.

For this capability, adopt the explicit reviewed decision that the defeated Gear moves alone to its owner's Trash and detaches, leaving its host and sibling Gear in place. Its basis is 11.6.1.2 together with the Unit defeat destination convention in 9.19.1.1 and the departure/detachment rule in 4.12.1. This is a bounded implementation inference, not an official publisher ruling or a new general defeat definition.

Record it in the V5 evidence fixture's `decisions` block, separate from exact rule excerpts. Required decision content, with field names adapted to the established evidence format:

```json
{
  "id": "DEFEATED_GEAR_TO_OWNER_TRASH_V1",
  "classification": "REVIEWED_INFERENCE",
  "ruleIds": ["11.6.1.2", "9.19.1.1", "4.12.1"],
  "decision": "For this admitted effect, move the defeated Gear alone to its owner's Trash and detach it; keep its host and sibling Gear in place.",
  "reviewMethod": "Reviewer-reported regex/subtree search over 713 processed rules nodes; defeat matches outside 9.19, full 5.7 and 11.6, and 4.10–4.12; not an exhaustive line-by-line audit.",
  "limitation": "No rule matching that reviewed search directly covers defeated-Gear destination. This is not a quotation, publisher ruling, general defeat rule, or claim of exhaustive absence."
}
```

The power-reference and Legends-area conclusions should also have recorded rule references and review rationale. Evidence reproduction must verify the captured records and retain the distinction between their exact text and authored decisions.

## Confirmed current-engine blockers

| Boundary | Current behavior at the reviewed base | Required V5 change |
|---|---|---|
| `validateTargetedDefeatState` in `packages/engine/src/targeted-defeat-state.ts` | Requires the effect controller to be the active player and combat stage `NONE`; accepts only the old source gate. | Add a capability-gated defender React case, preserving the old Unit case and exact source/continuation checks. |
| `validateEffectDefeatFacts` in the same file | Requires the effect source controller to be the active player and to pass the old source gate. | Validate Gear-effect aftermath against its actual caster and captured resolution context, without accepting arbitrary non-active sources. |
| `supportsTargetedDefeatCard` in `packages/engine/src/targeted-defeat-support.ts` | Requires empty catalog/executable keyword arrays and exact Minotaur/Over the Edge shapes. | Preserve this gate. Add a separate Gear source gate rather than granting Quick to old shapes. |
| `hasTargetedDefeatMetadata` in the same file | Claims every card containing `DEFEAT_UNIT`. | Partition metadata ownership by explicit scope and target discriminator; wrong-scope or mixed metadata must still reject. |
| `DefeatUnitTargetSchema` in `packages/domain/src/mechanics.ts` | Unit `AT_MOST` threshold is `z.literal(5)`. | Keep it unchanged and add a separate `GEAR` member with literal threshold 2. |
| `defeatSupport` in `packages/engine/src/defeat.ts` | Requires a face-up effective battlefield Unit and supported play semantics. | Add reviewed Gear target support for both `BATTLEFIELD` and `LEGENDS`, without making those Gear legal Unit attack targets. |
| `supportsReactPlay` in `packages/engine/src/react-support.ts` | Its existing Program branch is Floor It's exact Quick/power-minus-one/draw shape. | Add narrow Gear-capability delegation at the React/play admission boundary; retain existing branches unchanged. |
| `listDefeatableUnits` / `targetedDefeatChoice` in `packages/engine/src/targeted-defeat-queries.ts` | Unit-only selector feeds enumeration and validation. | Introduce one typed target dispatcher shared by enumeration, continuation revalidation, and owner-order validation. |
| `validateCombatState` in `packages/engine/src/combat-state.ts` | Its ordinary React-continuation branch permits only `PAYMENT_SELECTION`/`TARGET_SELECTION`, not `DEFEAT_ORDER_SELECTION`; an earlier return delegates states with trigger/targeted-defeat continuations. | Preserve forced single-Gear ordering and explicitly enforce the equivalent stage/actor/locked-attack invariants in the delegated Gear validator. Do not rely on the bypassed ordinary branch or silently add multi-card React ordering. |
| `validateState` in `packages/engine/src/state.ts` | Registers `validateTargetedDefeatMetadata` in the ordered metadata chain before continuation validation. | Register/invoke the new Gear metadata validator here before partitioning ownership; prove hidden, empty-ability, wrong-scope, and mixed sources cannot escape. |

Also audit `play-support.ts`, `play-state.ts`, `targeted-defeat.ts`, `effects.ts`, `action-return.ts`, `combat-state.ts`, and trigger state/completion validators for scope, target-type, actor, and saved-return assumptions. This is a required integration audit, not a claim that every file needs a change. Retain the existing shared departure implementation unless a focused proof demonstrates an actual defect.

## Chosen schema direction

Use a `kind`-discriminated target union: unchanged `UNITS` and new `GEAR`. Keep the existing serialized effect kind `DEFEAT_UNIT` for compatibility; document that historical wire name instead of renaming existing payloads or adding generic `DEFEAT_CARD`.

Conceptual schema extension:

```ts
const DefeatGearTargetSchema = z.strictObject({
  kind: z.literal("GEAR"),
  relation: z.literal("RIVAL"),
  power: z.strictObject({
    kind: z.literal("AT_MOST"),
    value: z.literal(2)
  })
});

const DefeatTargetSchema = z.discriminatedUnion("kind", [
  DefeatUnitTargetSchema, // unchanged: literal 5 or controlled D20 value
  DefeatGearTargetSchema
]);
```

The explicitly authored Detonate effect becomes:

```ts
{
  trigger: "WHEN_PLAYED",
  cost: { kind: "NONE" },
  conditions: [],
  effects: [{
    kind: "DEFEAT_UNIT", // preserved historical effect discriminator
    target: {
      kind: "GEAR",
      relation: "RIVAL",
      power: { kind: "AT_MOST", value: 2 }
    }
  }]
}
```

No condition, additional target family, threshold range, or arbitrary card-type destruction is admitted. The Gear branch must reject the old effect's optional `when` metadata, even if retained in the shared schema for backward compatibility. Preserve all old Unit payload values and their serialization; later engine/content hash changes are a separate artifact concern.

Do not put two indistinguishable `DEFEAT_UNIT` alternatives into the outer effect-kind discriminator. Generalize the target inside that effect and retain complete source/semantic admission checks.

## Separate admission and metadata ownership

Use the separate execution scope and opt-in policy `TARGETED_GEAR_DEFEAT_V1` (policy field `targetedGearDefeat`). The foundation slice reserves these schema fields and provides `reviewTargetedGearDefeatShape`; a successful shape review is not executable admission. `supportsPlay` and `supportsReactPlay` do not delegate to it yet. Do not extend the two-card acceptance predicate of `TARGETED_DEFEAT_V1` to allow Quick.

The new source gate must require reviewed provenance, supported execution under the new scope, Program type, RED only, RAM RED 2, numeric cost 1, sellable true, Quickhack classification, no numeric Program power, executable keywords exactly `["QUICK"]`, and exactly the one unconditional `WHEN_PLAYED` Gear-target effect above. Reject activation, guard, inheritance, equip, restrictions, modifiers, extra abilities/effects/keywords, alternative relations, conditions, and thresholds. Preserve source/canonical keyword metadata according to existing authored-revision conventions.

Explicitly check the required play, Gear, React, combat-resolution, trigger-scheduler, and applicable transitive ruleset dependencies. Test removal of each required dependency. A new execution scope by itself must not enable runtime behavior; old rulesets must not acquire Gear defeat by loading new vocabulary.

Metadata validation must cover hidden source instances too. The old detector must retain explicit ownership of `TARGETED_DEFEAT_V1` and Unit-target effects; a new detector must own the Gear scope and Gear-target effects. A wrong-scope or mixed card must fail a complete validator, not evade validation because both detectors skipped it. Do not merely return false for all Gear metadata in the old detector without installing and invoking its replacement.

The registration point is **`validateState` in `packages/engine/src/state.ts`**, next to the existing `validateTargetedDefeatMetadata` call. Register the replacement Gear metadata validator and partition the old detector in the same integration change. During this foundation slice the old catch-all is deliberately retained and additionally claims the reserved Gear scope even when its ability array is empty; its unchanged acceptance gate rejects that scope. This interim rejection path is not the completed Gear validator. A direct hidden-state reload test pins the current fail-closed behavior.

Require explicit regressions that unchanged Minotaur and Over the Edge still pass their original gate, while adding Quick, a Gear target, or threshold 2 to either still fails. Floor It and other existing Quick paths must remain unchanged as well.

## Target enumeration and power semantics

The shared typed selector must use the effect controller as the relation reference, not the active player. In React these differ. It must return only currently supported, rival-controlled, face-up Gear in `BATTLEFIELD` or `LEGENDS` whose own referenced effective power is at most 2. Preserve existing ownership/attachment validation and fail closed on unsupported ownership changes.

Use that same target dispatcher in choice construction, `continueTargetedDefeat`, and `validateTargetedDefeatState`, including selected-target/owner-order revalidation. Do not leave a Unit-only `listDefeatableUnits` call on the validation path after broadening enumeration. Retaining a Unit-only wrapper for older callers is acceptable if it delegates without broadening their semantics.

Zero is included. The reviewed Gear values identified in the review are Mandibular Upgrade 0, Kiroshi Optics 1, and Mantis Blades, Satori, and Dying Night 2. Use unchanged captured revisions and a clearly synthetic over-limit fixture when needed; do not edit a real Gear's printed stats. The existing `gear-replay.v1.json` Legends-area Mantis provides an exact-threshold regression candidate.

Host power, host temporary modifiers, sibling Gear, readiness, and unrelated printed host restrictions must not change the Gear's own threshold. A null power reference is not silently treated as zero.

## Defeat lifecycle

Reuse `defeatCards` and `processDeparture` after extending their admission/validation boundaries, not a second move-to-Trash implementation.

Required behavior:

- emit the existing target-selection and effect-defeat facts;
- preserve the normal defeat-before-movement ordering;
- move and detach only the chosen Gear, applying the reviewed destination decision;
- retain its host, sibling Gear, host area/readiness, and unrelated state;
- attribute the shared forced one-card Trash order to the Gear's owner;
- do not manufacture a strategic order prompt for a one-card Gear batch;
- keep unsupported cross-owner/control-change movement rejected rather than guessing a destination;
- preserve last-valid trigger binding capture and enqueue only after departure processing;
- do not fabricate a host `[DEFEATED]` trigger because its Gear was removed;
- do not reinterpret an inherited host ability as the Gear's own defeated trigger;
- emit no fight result or fight-win facts and do not consume fight-only prevention.

`processDeparture` already finds a Gear's host, moves its own batch, detaches it, and leaves siblings in place. Its Legend-removal step is type-gated; defeating a Gear on a Legend must not remove the Legend. Preserve the existing operation's ordering rather than impose a new detach-before-move protocol.

## React / Quick capability work

Main and React must have the same Gear-target semantics, but their actor and continuation invariants are different. Supporting the second case is new validation work, not merely passing `QUICK` through a keyword check.

| Resolution origin | Caster | Combat state | Saved return |
|---|---|---|---|
| Main | Active player | `NONE` | `MAIN` |
| Existing defender React | Defending/non-active player | `RIVAL_REACT` with the same attack identity | `RIVAL_REACT` |

During target selection, the timing step/window is `TARGET_SELECTION`, not an idle React decision. Validate it as an unfinished Program action with its saved return context; do not require `isReactDecision()` to be true while the continuation is paused.

For the Gear capability only, replace the blanket active-player/noncombat assumptions in both `validateTargetedDefeatState` and `validateEffectDefeatFacts` with the explicit appropriate origin case. Bind source, effect, `playContinuation.actorId`, controller, saved return, and combat identity. Keep the old Unit-scoped assumptions intact and reject forged controller/return/source-zone/attack associations. Do not accept any arbitrary non-active source merely because combat stage is React.

Use `validateActionReturn` in `packages/engine/src/action-return.ts` as the established **bounded-exception precedent**: its noncombat branch permits a non-active actor only for `targetedDefeatContinuation?.phase === "ORDER"`. That exception is phase-specific and is not a general React permission. Follow the same explicit origin/phase checks for V5; do not copy the Main owner-order exception into React or invent a parallel return protocol.

Completion must finish the Program's effect and Trash lifecycle, process only admitted aftermath, and return to the same defender React decision. It must not advance the turn, reset the attack, change its declared participants/locked target, grant the attacker reaction priority, or automatically pass React. Removing Gear must update live host power and granted capabilities before any later fight. Validate the stored origin after movement too; fixing only the target pause is insufficient.

**Named invariant: `V5_REACT_FORCED_GEAR_ORDER`.** The ordinary continuation branch of `validateCombatState` (`combat-state.ts`) allows only `PAYMENT_SELECTION` and `TARGET_SELECTION`. A persisted `DEFEAT_ORDER_SELECTION` is not part of the existing defender Program-continuation contract. A single Gear has no attached Gear, so its one-card owner order must resolve synchronously; it must never expose a strategic owner-order state or transfer the acting decision to the active player. Assert the forced owner-attributed event and absence of an externally returned order-selection state.

Important validator control flow: `validateCombatState` returns early when `triggerContinuation` or `targetedDefeatContinuation` is present. Its later stage/attacker/locked-target checks therefore do not protect those paused states automatically. The dedicated Gear continuation validator must enforce the equivalent invariants explicitly, including the stage restriction and a valid unchanged locked attack. If Gear defeat ever expands to multi-card batches or multiple simultaneous targets, treat paused React ordering as a new capability requiring review, not an already supported consequence of shared owner ordering.

Any temporary actor handling must restore the actual effect controller consistently with these validators. No general multi-owner React ordering capability is added.

Require zero-target, forced one-target, and strategic multi-target Main/React paths. A React proof with at least two legal targets must pause, serialize/reload, validate, resume the chosen action, finish departure, and return correctly. Testing only the automatic single-target path can miss the original validator defect.

## Focused proofs

The V5 suite must directly prove:

1. Raw/processed/candidate hashes, printings, errata join, exact rules records, and separately classified reviewed decisions.
2. Exact new semantic admission, opt-in dependency checks, and rejection of hidden/mixed/wrong-scope metadata.
3. Unchanged Minotaur/Over the Edge admission and old Unit payload serialization; their Quick/Gear/threshold-2 mutations remain rejected.
4. Main play, payment, no-target completion, forced target, and multi-target choice through authoritative actions.
5. Defender-owned Quick React play with at least two Gear targets, persisted target pause, resume, shared defeat, Program Trash, and exact React return.
6. Zero/one-target React completion; no turn/attack/priority reset and no automatic pass.
7. Forged active-caster, effect-controller, saved-return, attack identity, and post-movement source facts reject rather than weakening old validators.
8. Both battlefield and Legends-area Gear targets, including exact-threshold Mantis and zero-power Mandibular; friendly/non-Gear/hidden/inactive-area/over-limit targets excluded.
9. The target filter references the Gear instance's effective power, independently of high/low or temporarily modified host power.
10. Stale/forged target sets reject through the shared dispatcher at enumeration and resolution/validation, not merely in one UI path.
11. Only the chosen Gear detaches/moves; host and sibling Gear remain; the one-card forced Trash-order event names its owner.
12. Removing attacker's Gear during React changes later combat power or inherited capabilities **and the attack survives**: the returned state is the same defender `RIVAL_REACT`, attacker remains spent, attacker/locked-target identities are unchanged, the locked target remains in `listAttackTargets`, and `validateState` succeeds. The spell must not defeat the host, reset/end the attack, or invent a fight result. Check paused-state attack validity explicitly because `validateCombatState` delegates those states.
13. No host/inherited `[DEFEATED]` trigger, fight-win event, or fight-prevention consumption is manufactured by Gear defeat.
14. Every public target action projects through Descriptor V2, round-trips via actionId, and exposes no hidden identity.
15. Deterministic legal replay selection independent of opaque actionId order, with trusted arrangements labelled separately from legal paid-play trajectories.
16. Prior Minotaur, Over the Edge, Floor It, Reboot, attachment, and relevant inherited-effect behavior remains compatible with preserved decisions.
17. `V5_REACT_FORCED_GEAR_ORDER`: one owner-attributed forced order, no persisted `DEFEAT_ORDER_SELECTION`, no strategic actor transfer, and explicit rejection of a forged order-phase React state.
18. The registered `validateState` metadata chain, not only a direct source-gate call, rejects hidden/mixed/wrong-scope/empty new-scope sources; disabling the new validator after ownership partition must be caught by the corresponding test.

All scenarios must execute; no conditional assertion that silently skips a required case. Where current Gear revisions produce no defeated-trigger aftermath, exercise the bounded fact validator through clearly labelled validator tests rather than inventing a real Gear trigger or claiming a nonexistent reachable pause.

## Mutation checks

Catch deliberate mutations that widen relation/type/area/threshold, exclude zero power or Legends-area Gear, compare host instead of Gear power, bypass the new scope or provenance, accidentally admit Quick on old Unit-defeat shapes, skip detach/movement, move the host/siblings, permit stale targets, reinstate active-player-only React validation, or accept a forged caster/return context.

Each mutant must fail a named behavioral assertion, not a syntax/import/setup/hash error. Restore exact original bytes and rerun the unmodified focused suite. Keep runtime writers, generators, and matrix/descriptor jobs stopped during mutations.

## Engine identity and verification plan

The foundation schema/runtime change advances identity to `0.4.0-api-admission-5`; no final artifact hash is claimed while implementation is incomplete. Existing generated schemas and replay pins are intentionally not regenerated in this slice. Derive the final artifact hash after the lifecycle implementation settles. Do not prefill hashes or manually repin generated files.

The current foundation loop uses the new file below. Full `api-admission-batch-v5.test.ts` gameplay coverage remains to be implemented; a green foundation run does not prove Detonate play or React behavior:

```bash
node --import tsx --test --test-concurrency=1 tests/api-admission-batch-v5-foundation.test.ts
npm run typecheck
npm run lint
npm run validate:cards
git diff --check
```

After source capture/check, focused tests, and mutations pass and runtime is settled:

```bash
npm run contracts:export
# Audit frozen pre-V5 replay decisions; regenerate authoritative fixtures twice.
# Preserve designated historical evidence and review hash/order/semantic diffs.
npm run test:matrix
npm run test:matrix -- --check
# Run both matrix-dependent reviews and their checks against finalized traces.
npm run review:descriptor-v2
npm run review:descriptor-v2 -- --check
npm test
npm run test:integration
npm run build
git diff --check
```

Require actual integration execution with configured test databases and zero skips; an exit-0 all-skipped run is not evidence. Record observed counts, not copied earlier totals. Do not run trace writers concurrently with matrix/descriptor readers.

Existing Demo regression target: 192/192 supported terminal; 118 START_TURN_GIGS, 69 OVERTIME_GIGS, 5 EMPTY_DRAW. Descriptor V2 requires zero duplicate descriptors, unprojectable actions, action-set mismatches, and privacy failures. These are requirements, not V5 results.

Old Unit payload compatibility does not mean entire regenerated fixtures remain byte-identical after the eventual identity bump. Distinguish preserved payload values from expected hash/list-order changes, and investigate any semantic difference.

## Non-goals and merge criteria

No Valentino Guerrera/rule 9.26.3 target-legality lifecycle, Octant cost reduction, generic MOVE_CARD, arbitrary Gear/card-type defeat, hidden-area targeting, new reaction priority, general cross-owner movement, Python rules, or bulk admission. Do not silently broaden V4's retained source-lifetime limitation.

Keep PR #10 draft until Detonate has pinned evidence and an explicit immutable revision; the reviewed destination decision is recorded honestly; both target areas and own-power semantics are tested; new React validation and old admission isolation pass; generated outputs are reproducible; preserved replays, matrix, Descriptor V2, full tests, configured integration, typecheck, lint, card validation, build, and diff checks all pass.

The first foundation slice implements vocabulary and isolated shape review only, with execution deliberately closed. Ten foundation tests are authored, not claimed executed here. No complete V5 gameplay, mutation, evidence-capture, regeneration, matrix, or full-repository gate is claimed completed.
