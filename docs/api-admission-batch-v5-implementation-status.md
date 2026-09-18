# Batch V5 implementation status — capability slice

Second code slice on draft PR #10, against the contract at
`5323666dde0ce0c3dc506cd138cf5ce9cf026647`. It implements the reviewed Gear-defeat
**capability**. It is still **not** a Detonate admission: no real CardId, pinned source
evidence, evidence fixture or catalog publication is introduced. Tests use an explicitly
synthetic probe (`v5-gear-defeat-probe`).

## Implemented in this slice

- **Gear-aware selector.** `listDefeatableGear` enumerates rival, face-up, attached,
  reviewed Gear in `BATTLEFIELD` **and** `LEGENDS` whose own referenced effective power is
  at most 2. `listDefeatTargets` is the single typed dispatcher used by choice
  construction, resolution and continuation revalidation; `listDefeatableUnits` stays
  Unit-only and is no longer on the Gear validation path.
- **Metadata ownership partitioned and registered.** `hasTargetedDefeatMetadata` now owns
  only `TARGETED_DEFEAT_V1` and Unit-target effects; `hasTargetedGearDefeatMetadata` owns
  the Gear scope and Gear-target effects; `validateTargetedGearDefeatMetadata` is
  registered in `state.ts::validateState` beside the Unit validator. A mixed card is
  claimed by both and must satisfy both complete gates. Nothing falls between them.
- **Explicit Gear opt-in through the shared defeat pipeline.** `defeatCards` takes an
  `allowGear` flag threaded only from the effect path when the target discriminator is
  `GEAR`. `defeatSupport` stays strictly Unit-only, so the two fight call sites keep the
  narrower predicate; `gearDefeatSupport`/`effectDefeatSupport` are separate.
- **Bounded defender-React origin.** `validDefeatOrigin`/`validAftermathOrigin` replace the
  blanket active-player + `combat.stage === "NONE"` assumptions in
  `validateTargetedDefeatState` and `validateEffectDefeatFacts`. Main keeps its historical
  origin exactly. The React origin is admitted only for the Gear capability and binds
  caster, acting player, `playContinuation.actorId`, saved `RIVAL_REACT` return and attack
  identity. The shared `validGearReactOrigin` rechecks the delegated combat invariants:
  active attacking player, supported spent attacker, actual defending actor, and current
  locked-target legality. Gear aftermath checks its Main/React origin before the legacy
  active-player shortcut. No arbitrary source is admitted because combat is in React.
- **Admission dispatch.** `supportsPlay` and `supportsReactPlay` route the new scope to
  `supportsTargetedGearDefeatCard`; Floor It's exact React branch and the two-card Unit
  gate are untouched. `initialization.ts` adds the scope to its reviewed list so the card
  can enter a deck.
- **`RulesView.listDefeatTargets`** added beside the Unit-only accessor.

## Proven by execution

`tests/api-admission-batch-v5.test.ts` (9 top-level tests plus 22 subtests) and the
converted foundation suite (10) pass **41/41**, with zero failures or skips. Verified behaviours:

- Main play pauses with a genuine multi-target choice; only the chosen Gear moves; host and
  sibling Gear are retained; the defeat fact precedes movement; the one-card owner order is
  forced and owner-attributed; no fight fact is emitted.
- **Own Gear power, never the host's.** A battlefield host at effective power 7 still
  yields its power-2 Gear; a Legends-area Legend host has `null` power and its power-2 Gear
  is still eligible. Zero-power Gear is included; the threshold boundary is inclusive.
- **Legends-area Gear is a legal target** and its host Legend remains in `LEGENDS`, face-up
  and not removed.
- **Defender React**: persisted two-target pause, `returnTo` `RIVAL_REACT`, the paused state
  validates, survives serialization and independent revalidation, resumes, emits
  `RIVAL_REACT_OPENED`, and leaves the attack, attacker and locked target unchanged.
- Forged choices and stale targets are rejected `INVALID_DEFEAT_TARGET` through
  `validateState`, not only at enumeration. Friendly Gear is never offered.
- Paused React reload rejects ready, missing, Gear and lagging attackers; unrelated attacking
  players; missing/friendly locked targets; forged effect/continuation actors; and missing or
  wrong saved return contexts. The positive return also checks the spent attacker, defending
  actor, still-valid locked target, and exactly one owner-attributed forced Gear order.
- **Validator-only aftermath coverage:** valid Main and defender-React effect-defeat facts
  pass; forged active React casters and invalid attack origins reject. These fixtures call
  `validateEffectDefeatFacts` directly with an empty binding batch. Current Gear has no own
  `DEFEATED` trigger, so this does not claim a reachable persisted React trigger pause.
- A single eligible Gear resolves synchronously with no strategic prompt.
- The capability is policy-gated; vocabulary alone enables nothing.

## Mutation results

Eight mutants, **8/8 caught**, each failing named behavioural assertions; all files restored
byte-exactly (SHA-256 verified) with a green baseline before and after:
relation widened to any; threshold boundary excluded; host power substituted for own Gear
power; `LEGENDS` dropped from the area filter; React origin removed; capability policy
ignored; metadata ownership un-partitioned; detach skipped on departure.

The validation correction adds two further guard mutants, **2/2 caught**: weakening the
paused React origin fails `V5_REACT_REJECTS_MISSING_ATTACKER`; restoring the active-caster
aftermath shortcut fails `V5_AFTERMATH_REJECTS_ACTIVE_CASTER`. The runtime file was restored
byte-exactly after each mutation, with **24/24** passing regression tests before and after.

## Gates run here

`node --test` on both V5 suites (41/41), `npm run typecheck` (exit 0, 0 diagnostics),
`npm run lint` (exit 0, 0 errors, 2 pre-existing `_label` warnings), `git diff --check`
(clean). An additional **27/27** selected legacy Unit-defeat/Quick/combat checks pass with
zero failures or skips. That selection covers Minotaur/Over the Edge owner ordering and
Dexter aftermath, their forged continuations, Floor It in Main/React, and combat invariants:

```bash
node --import tsx --test --test-concurrency=1 \
  --test-name-pattern='legal headline preserves|rejects external defeat continuation|Quick pays ordinary|Quick is also legal|closed and open combat invariants' \
  tests/targeted-defeat.test.ts tests/react.test.ts
```

**Deliberately not run:** `npm test`, `npm run test:integration`, `contracts:export`,
`test:matrix`, `review:descriptor-v2` and any fixture regeneration. The generated baseline
remains on pre-V5 pins by design.

Engine identity is `0.4.0-api-admission-5`; the artifact hash is now
`e5bcf81771ad6430ad8bc16d5f8508b35c0d77e3dc96b6f6264ddea4e2366c06`. No baseline has been
regenerated against it and no fixture hash was hand-edited.

## Still required

- The real Detonate immutable revision with pinned raw/processed/candidate/printing/errata
  evidence, and the `DEFEATED_GEAR_TO_OWNER_TRASH_V1` decision recorded as
  `REVIEWED_INFERENCE` with its 11.6.1.2 / 9.19.1.1 / 4.12.1 basis and its limitation clause.
- Legal-path replay coverage alongside the labelled trusted arrangements used here.
- Descriptor V2 projection and privacy proofs for the new target actions.
- The full contract/fixture regeneration, repeatability, preserved-replay compatibility,
  matrix, Descriptor V2, unit, integration and build gates on the final commit.

Keep PR #10 draft.
