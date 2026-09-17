# API Admission Batch V5 — Detonate / reviewed Gear defeat

## Summary

Batch V5 targets one API candidate:

- `detonate` — RED Program, cost 1, RAM 2, sellable
- printed text: `{Quick} Defeat a rival Gear with power 2 or less.`

The engine already has reviewed targeted defeat, target choices, Gear attachments, owner Trash ordering, defeat events, trigger discovery after defeat, public action projection and Quick React play. The missing capability is a narrowly reviewed Gear target shape.

This milestone should extend the typed defeat selector and reuse the existing defeat lifecycle rather than add a second Gear-destruction path.

## Why Detonate

Compared with the remaining unadmitted candidates, Detonate requires one bounded capability extension:

```text
reviewed Quick Program
→ choose rival Gear with printed/effective power <= 2
→ existing defeat pipeline
→ detach/move defeated Gear correctly
```

It does not require:

- a new timing window;
- hidden-area selection;
- cost modification;
- conditional attack-target permissions;
- generic MOVE_CARD;
- arbitrary scripting;
- Python-owned rules.

## Source facts

Pin the API Content Bridge evidence for `detonate` from the reviewed AI corpus. Expected source facts:

- type: Program
- color: Red
- printed cost: 1
- RAM: Red 2
- sellable: true
- classification: Quickhack
- power: none
- retail collector number: 031
- source rules text: `{Quick} Defeat a rival Gear with power 2 or less.`
- no matching errata unless the pinned corpus proves otherwise

Source and candidate records remain evidence only. Executable mechanics must be authored explicitly in the engine revision.

## Intended mechanics

The immutable reviewed revision should encode one unconditional play effect:

```ts
{
  trigger: "WHEN_PLAYED",
  cost: { kind: "NONE" },
  conditions: [],
  effects: [{
    kind: "DEFEAT_CARD",
    target: {
      kind: "GEAR",
      relation: "RIVAL",
      power: { kind: "AT_MOST", value: 2 }
    }
  }]
}
```

The exact domain shape may instead generalize the existing `DEFEAT_UNIT` target union if that produces a smaller and clearer schema change. Prefer preserving existing serialized Unit defeat shapes byte-for-byte.

Do not create a Detonate-specific runtime handler and do not dispatch on `cardId`.

## Target semantics

A legal Detonate target must be:

- a rival Gear;
- face-up and in a public active area where that physical Gear is currently a legal game object;
- power 2 or less under the rules used for Gear power references;
- still legal when the target choice resolves.

The implementation must explicitly settle and test whether Gear attached to a face-up Legend in the Legends area is a legal target under the pinned comprehensive rules. Do not infer this from Gear equip legality alone.

No Unit, Legend, Program, face-down card, friendly Gear, hidden card, or over-limit Gear may be offered.

## Power semantics

Detonate says `Gear with power 2 or less`.

Before implementation is certified, pin the relevant rule records and prove whether this reference uses the Gear's own current power or another derived characteristic. The existing Gear model keeps printed Gear power separate from the host's effective Unit/Legend power; do not accidentally compare against host power.

A Gear's host modifiers must not silently change the target filter unless the comprehensive rules explicitly say they modify that Gear's own power.

## Defeat lifecycle

Reuse the existing typed defeat operation and attachment/departure processing.

Required behavior:

- emit target selection through the existing public CARD choice path;
- emit the normal defeat fact before movement;
- detach the Gear from its host;
- move the defeated Gear to its owner's Trash;
- keep the host in its current area;
- do not move sibling Gear;
- preserve owner/controller ordering semantics;
- discover any admitted `WHEN_DEFEATED` triggers only through the normal scheduler;
- do not fabricate a fight result.

Defeating Gear is an effect defeat, not combat.

## React / Quick behavior

Detonate's printed Quick keyword means the same reviewed card must be playable:

- during its controller's normal Main phase; and
- during an eligible rival React window under the existing Quick Program path.

The new Gear target selector must behave identically in either window except for the surrounding return context.

No new reaction priority or timing protocol is introduced.

## Admission gate

Keep admission exact to the reviewed shape. At minimum require:

- reviewed provenance;
- execution status `SUPPORTED`;
- a dedicated reviewed scope or an explicit narrow extension of `TARGETED_DEFEAT_V1`;
- Program type;
- RED only;
- RAM RED 2;
- printed cost 1;
- sellable true;
- classification `Quickhack`;
- Quick keyword and no unrelated keyword;
- exactly one unconditional `WHEN_PLAYED` ability;
- no activation, guard, inherited ability, modifier, restriction or equip metadata;
- exactly one Gear-defeat effect;
- relation exactly `RIVAL`;
- threshold exactly `2`.

Nearby variants must fail closed:

- friendly Gear;
- any Gear;
- Unit target;
- threshold 1/3/arbitrary;
- conditional defeat;
- extra effect/ability/keyword/modifier;
- missing Quick;
- unreviewed provenance;
- unsupported execution status.

## Domain/schema design

Prefer the smallest typed generalization.

Two acceptable directions:

1. Generalize the existing defeat effect target into a discriminated union containing the existing Unit selectors plus a Gear selector.
2. Introduce a dedicated Gear-defeat effect if doing so materially reduces ambiguity and preserves old contracts more clearly.

Whichever design is selected:

- old Unit defeat JSON remains accepted unchanged;
- arbitrary card-type defeat is not admitted;
- target enumeration remains engine-owned;
- model-visible choices remain public descriptors only;
- the model still selects only `actionId`.

## Focused proofs

Batch V5 tests should prove:

1. source/candidate hashes and no errata drift;
2. exact semantic admission and nearby fail-closed mutations;
3. Main-phase Quick Program play/payment/target/defeat;
4. React-window Quick play and return to the interrupted attack correctly;
5. target set includes every legal rival Gear and excludes all non-Gear/friendly/hidden/over-limit objects;
6. target legality is rederived at resolution;
7. attached Gear defeat detaches only that Gear and leaves the host/siblings in place;
8. Gear hosted by a field Unit behaves correctly;
9. Gear hosted by a face-up Legends-area Legend is tested according to the pinned rule conclusion;
10. owner/controller and Trash ordering remain valid;
11. effect defeat emits no fight result;
12. public observation/Descriptor V2 reveals no hidden identity;
13. repeated replay generation is independent of opaque actionId ordering;
14. prior Minotaur / Over the Edge targeted-defeat behavior remains semantically unchanged.

## Mutation checks

At minimum catch deliberate mutations that:

- widen Gear relation from rival to any;
- remove the power threshold;
- change threshold 2;
- allow Unit targets;
- skip Gear detachment;
- move the host with the defeated Gear;
- omit defeat movement;
- remove Quick admission;
- bypass reviewed provenance;
- permit stale target choices.

Each mutant must fail the named behavioral assertion, not merely crash/import-fail.

## Engine identity

Planned next version:

```text
0.4.0-api-admission-5
```

Do not claim the final artifact hash until the runtime tree is complete.

## Verification plan

Fast loop:

```bash
node --import tsx --test --test-concurrency=1 tests/api-admission-batch-v5.test.ts
npm run typecheck
npm run lint
npm run validate:cards
git diff --check
```

After runtime and focused mutation tests are settled:

```bash
npm run contracts:export
# regenerate authoritative replay fixtures twice and require byte identity
npm run test:matrix
npm run test:matrix -- --check
npm run review:descriptor-v2
npm run review:descriptor-v2 -- --check
npm test
npm run test:integration
npm run build
git diff --check
```

Preserve the current Demo regression target unless an investigated rules change proves otherwise:

```text
192 / 192 supported terminal
118 START_TURN_GIGS
69  OVERTIME_GIGS
5   EMPTY_DRAW
```

Descriptor V2 must retain zero duplicate descriptors, unprojectable actions, action-set mismatches and privacy failures.

Audit preserved pre-V5 replay decisions before accepting regenerated fixtures. Classify generated changes as hash-only, order-only, or semantic.

## Non-goals

This PR does not implement:

- Valentino Guerrera's changing attack-target permissions;
- rule 9.26.3 lifecycle work;
- Octant cost reduction;
- generic MOVE_CARD;
- arbitrary Gear destruction;
- hidden-area Gear targeting;
- generic card-type selectors;
- runtime English parsing;
- source-hint-to-mechanics conversion;
- bulk admission.

## Merge criteria

Keep the PR draft until:

- Detonate has an immutable reviewed revision backed by pinned source evidence;
- Gear target-area and power-reference semantics are explicitly supported by rules evidence;
- old Unit targeted-defeat shapes remain compatible;
- all focused and mutation tests pass;
- generated contracts/fixtures are deterministic;
- preserved replay semantics remain compatible;
- matrix and Descriptor V2 gates remain clean;
- full unit/integration/typecheck/lint/card-validation/build/diff gates pass.
