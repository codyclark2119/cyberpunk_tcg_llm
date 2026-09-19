# Batch V5 implementation status — Detonate evidence and legal-replay slice

PR #10 (**merged** at `f4562acd84e6e4f31dee0285fe97f9eaa6fe4ee8`) delivered the reviewed
Gear-defeat **runtime capability**. This branch,
`review/api-admission-batch-v5-detonate`, adds the follow-on slice: the real Detonate
immutable revision, its pinned source evidence, and legal Main/React replay coverage.

The two are deliberately separate. Nothing in this slice changes a hashed runtime input:
engine identity remains `0.4.0-api-admission-5` with artifact hash
`e5bcf81771ad6430ad8bc16d5f8508b35c0d77e3dc96b6f6264ddea4e2366c06`, exactly as merged.

## Already merged in PR #10 (runtime capability)

Gear target schema and `TARGETED_GEAR_DEFEAT_V1`; the `targetedGearDefeat` policy; the
Gear-aware selector and shared `listDefeatTargets` dispatcher; metadata ownership split
with `validateState` registration; the explicit Gear opt-in through `defeatCards`;
battlefield and Legends-area Gear support; Main and bounded defender-React continuation
validation; the forced one-card owner Trash order; stale/forged target rejection; and
host/sibling retention with live host-power update.

## Added by this slice

- **The immutable reviewed Detonate revision.** CardId `detonate`, revision 1; Program,
  RED, cost 1, RAM RED 2; sellable `Quickhack`, collector number 031; no numeric Program
  power. Raw source keywords remain `[]`; the executable `["QUICK"]` keyword is authored
  explicitly, never parsed from text. One unconditional `WHEN_PLAYED` effect:
  `DEFEAT_UNIT` with target `{ kind: "GEAR", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 } }`,
  under execution scope `TARGETED_GEAR_DEFEAT_V1`.
- **Three new evidence fixtures only** — `api-admission-batch-v5-detonate-source.v1.json`,
  `-card-sources.v1.json`, `-rules.v1.json` — plus the capture/verify scripts that produce
  and re-check them. No existing generated fixture, wire schema, matrix or replay baseline
  is touched.
- **Legal replay helpers.** `batchV5Replay("MAIN")` (seed `legal-v5-5`) legally plays and
  pays Detonate against two attached rival Gear. `batchV5Replay("REACT")` (seed
  `legal-v5-3`) declares an attack, has the defender play Detonate during `RIVAL_REACT`,
  pauses on a persisted two-target choice, reloads, resolves, and returns to the same React
  decision. Selection is semantic, never by opaque actionId order.
- **Descriptor V2 / privacy coverage** for the new target actions, and evidence-drift tests.

## Evidence, independently verified

Source commit `af9e0e1dd93b7eb77db5883bdd18809c8446d856`; raw
`data/raw/cards/detonate.json`, git blob `cce28a602b8c645e62d637d70f6fa717499df646`,
SHA-256 `23b8734ca36627e9ec88ee00c06bf7a6f24154ebf8d3d6e5fa72f4c7424eba8b`; raw record hash
`6d9353061811cacef33e1082cc46fdf0cf827b62d930043284f9924784007418`; processed record hash
`aeaf918462702fb4d4a84ae8939607472b008fb388e6b0e5fe15911dd33f8582`, which the bridge
candidate's `sourceRecordHash` re-derives; candidate hash
`3c03e9f500602742f8a71531983b589e4220f5a7b9372115173d60fd0c54be60`; catalog SHA-256
`b96ca8d583ab087148c9ed3563379e6c42fd9e729188a042215bb503a8879c3d`; rules
`data/processed/rules.jsonl`, blob `5d8343c6fa8a596e354a2868a8bd511a6b04ca0e`, 36 selected
records with projection hash
`5331d2e400f10a119a1065e9e7ac9747c806e783a030d3437a6fa468de805755`. `matchingErrata` is
empty. The blobs, SHA-256 and AI HEAD were recomputed directly against the checkout rather
than taken from the capture report.

Three decisions are recorded separately from exact rule text, with rule ids and limitation
clauses: `GEAR_OWN_EFFECTIVE_POWER_V1` and `LEGENDS_AREA_GEAR_TARGET_V1` as
`REVIEWED_RULE_INTERPRETATION`, and `DEFEATED_GEAR_TO_OWNER_TRASH_V1` as
`REVIEWED_INFERENCE` on the 11.6.1.2 / 9.19.1.1 / 4.12.1 basis. None of the evidence files
contains any `forbiddenAuthority` field.

## Gates run on this slice

| Gate | Result |
|---|---|
| Source verifier | `SOURCE_MATCH`, 36 rules, 3 decisions, no matching errata |
| Evidence capture `--check` | `EVIDENCE_MATCH`, `repeatedCaptureIdentical: true` |
| Six focused V5 suites (serial) | **73 / 73**, 0 fail / 0 skip / 0 todo |
| Selected legacy compatibility checks | **27 / 27**, 0 fail / 0 skipped |
| `npm run typecheck` | exit 0, 0 diagnostics |
| `npm run lint` | exit 0, 0 errors (2 pre-existing `_label` warnings) |
| `git diff --check` | clean |

### Correction made while running these gates

The legal-replay determinism test originally asserted that perturbing the engine artifact
hash *must* change opaque action IDs. That invariant is false on this path:
`listLegalActions` binds version-2 action IDs to the entitled observation rather than the
position hash whenever a projecting policy is enabled (`targetedDefeat` is one), and that
binding is deliberately pin-independent. Measurement confirmed the pin reaches
`state.match.engineArtifactHash` while the tokens are unchanged, and that the pre-existing
V4 replay — which takes the position-hash path — still changes tokens under the identical
perturbation, so the merged engine has not regressed. The assertion now proves the
perturbation actually took effect via the differing state pin and pins the version-2
binding itself, so a silent switch back to position-hash tokens fails the test.

## Deliberately deferred

`npm test`, `npm run test:integration`, `npm run build`, `contracts:export`,
`test:matrix` (and its `--check`), the matrix-dependent reviews, and the full
`review:descriptor-v2` corpus regeneration are **not** run here, by instruction. The
existing generated baseline remains on its pre-V5 pins and is untouched; because this slice
changes no hashed runtime input, it neither worsens nor repairs that staleness. Those gates,
together with preserved-replay compatibility classification, remain required before merge.

PR #10 is merged. This branch is prepared for review as a new draft PR and must not be
merged without the deferred gates above.
