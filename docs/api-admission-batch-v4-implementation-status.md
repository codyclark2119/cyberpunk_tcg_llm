# Batch V4 initial implementation status

This document describes the first implementation on draft PR #9. It is not a completed admission certification or a green verification report. The original contract remains in `api-admission-batch-v4.md`.

## Implemented in the initial patch

- `FRIENDLY_PLAY_POWER_V1` is an opt-in ruleset policy with explicit dependency checks for card play, trigger scheduling, combat restrictions, React, combat resolution and the reviewed Gig-value policy.
- `POWER_UNTIL_END_OF_TURN` has a distinct `FRIENDLY_UNIT` target kind.
- Persisted `+2` power occurrences require effect/ability/ordinal provenance. Existing `-1` and `+5` serialized shapes remain separate and unchanged.
- A complete unconditional Unit PLAY/friendly+2 shape is admitted through `COMBAT_TRIGGERS_V1`, without CardId dispatch. Nearby unsupported shapes still fail admission.
- The trigger scheduler owns target enumeration and continuation. No Program play continuation is fabricated for a Unit trigger.
- Friendly targets are face-up effective Units on the controller's battlefield, including the source. Readiness and Lag do not filter the power target set.
- Independent occurrences are additive; the same occurrence is rejected on reapplication. Shared end-turn/hidden-target-entry expiry carries the new effect identity.
- Current-state validation verifies the full new metadata even when its source is hidden and there are no live temporary modifiers. Persisted +2 effects require a supported source and resolved current-turn occurrence.
- The historical non-minus-one metadata catch-all now delegates `FRIENDLY_UNIT` to its own validator instead of incorrectly classifying it as the self+5 capability.
- A human label is added for the new target choice. Descriptor V2 continues to project public CARD references; action ID hashing/order are not changed.
- Japantown Jonin revision 1 is authored as an implementation-reviewed test content snapshot. Existing Demo decks and previous revisions are not edited. The support deck retains 42 main cards and the existing synthetic Red RAM 3 Legend.

The state extension is deliberately bounded to +2 rather than accepting arbitrary numeric modifier records. Future amounts still need an explicit admission/lifecycle review. No generic movement, target-invalidates-mid-attack logic, new payment economy or Python rules code is introduced.

## Evidence

`tests/fixtures/api-admission-batch-v4-jonin-source.v1.json` preserves the raw upstream file bytes from `cyberpunk_tcg_ai` commit `af9e0e1dd93b7eb77db5883bdd18809c8446d856`:

- Git blob: `25f4fb476d26e611290516892b915398a5c6933a`
- File SHA-256: `97837cab5849a76922492b3b3e2a42cb73e4f96c92df4dbad679aae2c0393585`
- Canonical record SHA-256: `dc383b1c512492ca22ee5d811677f8c6a27d28e3c33b6d382dde9326f3fe1365`

The copied file's Git blob and SHA-256 were checked during drafting. Both printing UUIDs and all source facts are retained. The pinned processed errata file has no Jonin entry.

The read-only `scripts/verify-api-admission-batch-v4-source.ts` checks a local AI checkout against raw bytes, catalog/manifest hashes, the processed candidate hash, printed facts, printings and errata. This cross-repository script has been authored but not executed here. A committed processed-candidate/rules-excerpt evidence capture remains outstanding; the full evidence-capture requirement of the design contract is not claimed complete.

## Tests authored, not yet executed

Thirteen focused tests cover source preservation, complete admission and policy dependencies, old/new modifier schema shapes, trigger target selection, exact +2, self-targeting/Lag, automatic one-target and zero-target handling, occurrence stacking/duplicate rejection, forged state rejection, expiry, public Descriptor V2/privacy and semantic replay determinism.

The headline replay uses only legal initialization/actions and the shared semantic selector. Branch-specific reducer arrangements are explicitly labeled trusted test fixtures, not presented as paid-play trajectories. The fixed replay seed still needs execution/reachability confirmation. The initial focused suite does not yet provide all field-Legend, mixed -1/+2/+5, combat/steal, or source-departure integration proofs required for final admission. Extend those before declaring completion.

Only TypeScript syntax parsing of the newly authored fixture, replay, tests and source-verifier files has run in the drafting environment. This is not project typechecking, lint, or test execution. Project dependencies were unavailable and dependency downloads failed. No unit, integration, mutation, matrix or replay-compatibility pass is claimed.

## First local checks

Run from the application root after pulling this branch:

```bash
node --import tsx --test --test-concurrency=1 tests/api-admission-batch-v4.test.ts
npm run typecheck
npm run lint
node --import tsx scripts/verify-api-admission-batch-v4-source.ts \
  --ai-root ../tcg_ai_training/cyberpunk_llm
```

Do not begin an expensive matrix regeneration until these checks pass and runtime changes are settled. Add and execute the remaining targeted proofs and mutation checks first. Existing Floor It and self+5 behavior must also be tested against the frozen pre-change replay decisions.

## Generated baseline intentionally pending

Runtime version is now `0.4.0-api-admission-4`; the final artifact hash must be computed from the final runtime tree. The initial patch does not regenerate or manually repin old fixtures, and does not hand-author generated wire schemas. Consequently the draft is not a merge-ready golden-test baseline.

Before merge, run `contracts:export` and all authoritative affected replay generators, check repeated output, preserve frozen historical artifacts and classify all diffs. The 192-game generation/check and Descriptor V2 audit remain required. Two matrix-dependent review scripts must run after the matrix. Do not run trace-writing generators concurrently with matrix/descriptor readers; preserve and recheck trace hashes when a generator shares their directory.

Finish with full typecheck, lint, card validation, unit tests, integration, build and diff checks on the exact commit candidate. Record actual counts and exit codes rather than copying the previous batch's totals. Keep PR #9 draft until this evidence is present.
