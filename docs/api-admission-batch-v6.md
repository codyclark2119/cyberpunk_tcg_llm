# API Admission Batch V6 — Trust No One

## Status: admitted and merged

Trust No One revision 1 is admitted under `MIN_GIG_PROGRAM_V1`; see
[Executable V6 slice](#executable-v6-slice). PR #19 merged the source foundation,
the runtime admission (`b9e6c65`) and the regenerated baseline (`2b39b97`, see the
[verification record](api-admission-batch-v6-verification.md)). The engine identity is
`0.4.0-api-admission-6` with artifact hash
`29d5a9e0e542b09b808e0f6c06bbb6df13a12bfb16faa5f2e58bf1327db34960`.

The rest of this document is the review record in the order it was written: the
source foundation and proposed contract first, then the executable slice.

### Original foundation status

Rebased onto the unified monorepo after PR #20, starting from `1aaba357f46e83296419c1871fac3c28ea70dcff`.
This first slice adds retained source evidence, a read-only independent verifier,
14 source tests and five tests of the unchanged V5 execution boundary. It does not
add a CardRevision, new engine scope/policy, runtime handler, generated contract,
or replay baseline. Trust No One remains unadmitted. A successful source check
explicitly reports `admissionReady: false` and `revisionAssigned: false`.

The runtime identity remains V5; do not bump it or regenerate artifacts for this
foundation. Keep the PR draft for review of the proposed implementation contract.
Full CI remains enabled. Do not suppress full tests to hide a stale baseline when
runtime implementation is subsequently added.

## Candidate and retained authority

Trust No One is a Blue Program, printed cost 1, Blue RAM 1, sellable, Braindance,
collector 139, with null printed power and no Quick keyword. Its exact source text is:

> Decrease a Gig by up to 3. Then, if you control a min Gig, draw 1.

Retained AI snapshot: `af9e0e1dd93b7eb77db5883bdd18809c8446d856`, now preserved as an ancestor of this monorepo by PR #20.

- Raw file: `data/raw/cards/trust-no-one.json`; Git blob `24383b5e7cd8c559dab493f7a9c19e4263ab83c4`.
- Raw SHA-256: `4c09d3def515cc4eddcfea91dbd87f7121fefb4d00255b0dccdf1d859ea7a0e5`.
- Processed canonical hash: `c734132576aca6b7a8137aa88df781c5e4baa03e95b55af08556862c2209545e`.
- Candidate canonical hash: `3aaf043440c319a9347659bfc910e96e7eb11dedc29979d891e65c3ce38c3571`.
- Complete catalog SHA-256: `b96ca8d583ab087148c9ed3563379e6c42fd9e729188a042215bb503a8879c3d`.

The new evidence fixture contains the complete retrieved processed record, candidate,
candidate manifest, and nine selected full rule records. The candidate records no
matching errata. The verifier additionally checks the full four-record errata corpus,
151-record card/candidate corpora, 713-rule corpus and raw index against their pins
and the exact imported Git commit. Current in-repo files must be byte-identical to the preserved source commit. The verifier is read-only.

These nine excerpts are an initial rules basis, not a complete targeting/timing audit.
They cover control (1.7.2), empty draw (1.14), exclusion of fixer dice (6.1.4), current
Gig values/minimum (6.3, 6.3.1, 6.3.3), decrease and boundaries (6.4.2, 6.4.4, 6.4.5).
Complete the remaining effect-order/target-choice review before runtime admission.

External comparison on September 22, 2026: the official page at
`https://cyberpunktcg.com/cards/trust-no-one` displayed the same rules sentence, but
four printings rather than the snapshot's three (139, beta 139, 007). Do not silently
add the fourth printing or update the corpus. That comparison is not a new evidence
snapshot or publisher approval of these implementation decisions.

Source wording, API legality and parser hints never generate executable mechanics.
The eventual immutable revision must be explicitly authored and reviewed separately.

## Why this next slice

Industrial Assembly already covers an ordered Program adjustment followed by a current-
state conditional draw. Dying Night covers a decrease on the trigger-scheduler path.
Trust No One is a small adjacent capability, but neither existing admission gate accepts
it as-is. It does not need a new combat target lifecycle, zone-movement primitive, or
WHEN_SPENT scheduler event. Only one card is proposed for V6.

## Confirmed implementation boundaries on the starting tree

| Location | Boundary to preserve or extend deliberately |
| --- | --- |
| `packages/domain/src/mechanics.ts` | `DECREASE_GIG_UP_TO.maximum` is literal 2; `ADJUST_GIG_UP_TO.maximum` is 1 or 4, with only optional INCREASE direction. Three is not presently representable. |
| `packages/engine/src/effects.ts` | The ordinary Program/CALL registry handles ADJUST, but has no DECREASE primitive handler. Trigger-only decrease support does not supply a Program continuation. |
| `packages/engine/src/value-conditions-support.ts` | Directional or non-one ADJUST metadata is claimed by the complete Industrial/Field Operator validator. Adding a new direction without partitioning validation ownership repeats the earlier metadata-routing trap. |
| Gear delayed-attack metadata validator | It claims DECREASE_GIG_UP_TO for the Dying Night shape. Do not globally weaken it or send a Program down the inherited Gear path. |
| `packages/engine/src/conditions.ts` | GIG_VALUE already checks current rolled Gigs in the actor's Gig area by controller, not ownership. Value 1 represents min under the pinned 6.3.3/DIE_FACES_V1 rules. No new zero-based minimum is needed. |
| `packages/engine/src/play-support.ts` | Existing Program gates do not certify the new Blue Braindance shape. Schema acceptance is not gameplay admission. |

The five foundation tests execute against the real existing schemas/gates. Their
negative future-vocabulary assertions document this intermediate boundary; replace them
with stronger positive/negative tests when the complete V6 capability lands. Do not
leave an obsolete expected rejection or simply delete the coverage.

## Proposed runtime contract — not implemented by this foundation

Prefer the existing Program adjustment continuation with an explicit new directional
shape, rather than widening Dying Night's trigger-only primitive:

```text
WHEN_PLAYED
  ADJUST_GIG_UP_TO { GIGS, ANY }, maximum 3, direction DECREASE
  CONDITIONAL_DRAW at RESOLUTION, condition GIG_VALUE 1, count 1
```

`MIN_GIG_PROGRAM_V1` is a proposed separate execution scope/opt-in policy, not an
existing field. Require ordinary Program play plus DIE_FACES_V1. Establish every
additional dependency from source; do not enable unrelated policies as a workaround.

Domain vocabulary may broaden, but admission remains exact: reviewed/supported Blue
RAM1 cost1 sellable Braindance Program; no numeric power, Quick, equip data, modifiers,
restrictions, activation, inherited ability, guard or extra effect; one unconditional
play ability with the two effects above in that order. Nearby amounts, directions,
target relations, timing, conditions, costs or extra mechanics must remain rejected.
No runtime card-name dispatch.

If directional ADJUST is chosen, register its new complete metadata validator in
`validateState` in the same change that partitions the old metadata owner. Hidden and
unused physical sources must not escape validation. Keep Industrial/Field Operator,
Afterparty, Dying Night and Jackie accepted unchanged. Do not repurpose Jackie's
OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN: its target relation and conditional
semantics differ from this card.

The Program continuation owns payment, target selection, amount selection, serialization,
validation and completion. Reuse the validated Gig movement/value-change machinery,
not a second mutating arithmetic implementation. This is Main-only: adding Quick or
allowing defender React is explicitly out of scope.

## Gameplay proofs required before V6 admission

1. Pay the printed cost through normal legal play; preserve Blue RAM validation. Reach
   a real multi-target decision, save/reload it, select a target and amount, and finish
   the same Program continuation. Target any rolled friendly or rival Gig in play,
   never an unrolled/fixer die. A Gig already at min may be targeted; do not make it
   disappear solely because only a zero/no-change outcome remains.
2. Enumerate only non-increasing choices within 0..3 and legal die faces. A zero choice
   is no adjustment, not a fabricated GIG_VALUE_CHANGED event. From 4, -3 reaches 1;
   from 3, -3 is illegal; from 1, no positive decrease is legal. Test every supported
   die type and reject forged/stale amount/target choices through normal validation.
3. Evaluate the draw condition after adjustment, from the effect controller's current
   Gig area. Creating a friendly min can enable the draw. Creating only a rival min
   cannot. A separate pre-existing friendly min qualifies even when the chosen target
   is rival or no change occurs. The condition is not "the selected Gig became min"
   and is not gated on positive decrease. Confirm this proposed reading in the final
   effect-order review; it follows the two sentences, not Jackie's special effect.
4. Distinguish original die ownership from current control. A stolen friendly-controlled
   min counts; an owned but rival-controlled min does not. No Gigs is false, never
   numeric zero/min. d10 face notation 0 is 10, not a min.
5. Resolve both true and false draw paths, including the normal empty-draw terminal.
   Audit no/one/multiple target boundaries and continuation cleanup. Preserve Program
   source handling, events, public observations and hidden draw privacy.
6. Project every decision through Descriptor V2; validate action resolution, no duplicate
   descriptors, and hidden-information invariance. Replay with reversed legal-action
   lists separately from an engine-pin perturbation. No hash-order-dependent selection.
7. Mutation-test admission, direction, lower bound, controller relation, post-adjustment
   condition timing and zero-choice handling. A crash or unrelated assertion is not a
   successfully detected behavior mutant.

These are requirements, not tests claimed to exist or pass in this foundation.

## Validation and completion

```bash
node --import tsx --test --test-concurrency=1 --test-reporter=tap \
  tests/api-admission-batch-v6-source.test.ts \
  tests/api-admission-batch-v6-foundation.test.ts
npm run typecheck
npm run lint
node --import tsx scripts/verify-api-admission-batch-v6-source.ts --repo-root .
```

Expected newly authored count: 19. Locally observed: the 14 source tests pass using
Node 22.16.0 and the globally installed ts-node loader in an isolated source mirror;
the unchanged canonical helper's Git blob matches master. This is not a full checkout
or the project's tsx run. The five schema/gate tests, whole-project checks and independent
monorepo source verifier require hosted/local project execution. CI must establish the actual complete result.

When runtime changes land, the planned engine version is `0.4.0-api-admission-6`.
Calculate the artifact hash from final inputs, preserve the committed V5 originals,
regenerate affected contracts/replays through their authoritative generators twice,
classify differences semantically, and replay the preserved decisions. Finish ordinary
trace writers before the matrix/check and dependent reviews/Descriptor V2. Require the
unchanged 192 supported terminals / 118-69-5 Demo target, zero Descriptor failures and
full unit/integration/build gates on the exact committed tree. Those are future gates;
none is replaced by source verification or this PR's foundation tests.

Do not merge an incomplete runtime milestone or relax the unconditional CI workflow.
No merge is authorized by this document.


## Executable V6 slice

The implementation slice advances the deterministic engine to
`0.4.0-api-admission-6` and admits exactly one reviewed immutable revision:
Trust No One revision 1 under `MIN_GIG_PROGRAM_V1`.

The runtime change deliberately reuses the existing noncombat Program continuation:
`ADJUST_GIG_UP_TO` now has an exact directional `DECREASE` form with maximum 3,
enumerating public amount choices from zero through
`min(3, currentValue - 1)`. Zero emits the existing decline fact and never fabricates
a value-change event. Positive amounts route through the shared `changeGigValue`
primitive, preserving DIE_FACES_V1 bounds and no-clamping semantics.

The second ordered primitive is the existing resolution-time `CONDITIONAL_DRAW`
with `GIG_VALUE 1`. Because that condition reads current rolled Gigs controlled by
the effect controller, a separate or stolen friendly min Gig qualifies while a rival
min alone does not. The condition is evaluated after the adjustment.

Admission remains exact and fail-closed. A dedicated metadata owner claims
`MIN_GIG_PROGRAM_V1` and all directional-decrease Program metadata. The legacy
value-condition owner explicitly excludes the new DECREASE direction, preventing the
new card from being routed through Industrial Assembly's complete gate. Hidden,
wrong-scope, nearby-maximum and extra-effect copies are rejected by state validation.

Focused V6 tests cover source characteristics, V5 revision preservation, policy-off
initialization, legal amount sets, friendly/rival targets, zero decline, no-target
resolution, controller-vs-owner semantics, target/amount serialization, Descriptor V2
projection/actionId round trips, stale action rejection, list-order independence and
registered hidden-state rejection.

Because the engine identity changes, committed wire/replay/review fixtures must be
regenerated by authoritative writers before this PR can be considered merge-ready.
No hash or generated JSON should be edited manually. That regeneration is `2b39b97`.
