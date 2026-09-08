# Combat restrictions and prevention milestone

Implemented the bounded `COMBAT_RESTRICTIONS_V1` milestone on 2026-09-08. Reboot Optics prevents the relevant friendly defeat without changing fight results; Corpo Security cannot attack but can Block; MT0D12 Flathead conditionally forbids blocking while preserving other reactions. Psycho Squad and Emergency Atlus are admitted as ordinary Units. All nine prior replay families remain green, with three new checked-in families and a legal expiration branch. No commit, staging or push was performed.

## Runtime

- Node **v22.13.0**, npm **10.9.2**, application package **0.3.0**, Next.js **16.3.4**.
- Engine behavior artifact **`0.4.0-combat-restrictions-1`**; application/package version is unchanged.
- Wire envelope **v1**, TrainingPosition **v2**, TrainingAttempt **v1**, semantic hashing **POSITION_V2**.
- Python uses the existing `mlx_env/bin/python`; no model, package or corpus download and no training.

Engine artifact hash: `7661a505f9c19f2af73213f25a9bba3e1c8e4f598e1a06c543804ccbd763b1d7`.

New replay bundle manifest hash: `30d8b967d3354a689f425f5d5a93fa0bbf3008917b7b8e721975d1466bf6f147`.

Ruleset `beta / combat-restrictions-1` hash: `994d16943f24ac0c57f0c43b5e0fd6d87795b4185db49602fd03e0c836eac6ea`.

## Rules reviewed

Used only existing local captures. [combat-restrictions-rules.v1.json](../tests/fixtures/combat-restrictions-rules.v1.json) stores **140 exact rule records**, capture hashes and explicit decisions. The entire local four-record errata list was checked; none matches the five cards. Card source objects, full text and all **23 printing UUIDs** are retained in [combat-restrictions-card-sources.v1.json](../tests/fixtures/combat-restrictions-card-sources.v1.json). The five raw-byte hashes were also compared directly against the original local files, and their parsed records match exactly. No publisher refresh, substitute web text or image fetch occurred.

| Capture | SHA-256 |
|---|---|
| Raw rules | `054d2d2a4664e5b560304e0962e71b195467ad097cc4c62b2698fc57467a28dd` |
| Processed rules | `1f299c9cbe2657c9d088ae4b3a812b85e46c3fd2659579229635959c59a20e19` |
| Raw errata | `1203a6c268c94d9d670a9cc145f739957fd018fa23eab86628bac94984ce1d75` |
| Processed errata | `16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340` |

The relevant interpretation anchors are 2.6 (prohibition over permission), 3.18.1.2.3 (flavor text), 4.14 (Program lifecycle), 5.11.4/5.11.4.2 (Null Street Cred), 8.16.2 (turn-duration expiration), 9.3 and 9.7–9.12 (attack/React), 9.19.3 (preventing defeat preserves winner/loser), 10.4.3/10.22 (live static effects), 10.21 (resolved effect independent of source), 10.24–10.30 (replacement and ordering distinction), and existing Lag/Blocker rules 11.3/11.24. Exact records and decisions are in the fixture, not inferred at runtime from English.

## Reboot Optics

Exact captured text:

> {Quick} The next time a rival Unit fights this turn, it doesn't defeat the opposing friendly Unit.

Blue RAM 2, sellable Program, numeric cost 2, no power. Immutable application revision 1, full `COMBAT_RESTRICTIONS_V1` shape. [executable-card-coverage.md](executable-card-coverage.md#combat_restrictions_v1-prevention-combat-permissions-and-ordinary-units) lists raw-byte, canonical source and normalized revision hashes, primary/demo UUIDs and complete printing counts for all five cards.

This is **mandatory delayed defeat prevention**, not replacement of the fight, prevention of the fight, a power modifier or an optional strategic choice. The text does not select/target a Unit. It applies relative to the Program's controller: the next actual fight between a rival Unit and its opposing friendly Unit, on offense or defense. It uses the current fight participants after any Blocker redirection.

Ordinary `PLAY_CARD` works in MAIN or the acting defender's React window through existing Quick timing. Existing payment, RESOLVING_PROGRAM, pending effect dispatch and TRASH movement are reused. Typed `CREATE_NEXT_RIVAL_FIGHT_PREVENTION` creates the public record when the Program effect resolves; payment alone does not create it. No new lifecycle or wire action is introduced.

## Replacement/prevention architecture

`FightPrevention` is a distinct domain type and `state.fightPreventions` is separate from temporary power modifiers. There is no unused universal ReplacementEffect framework. `fight-prevention.ts` provides creation, applicability, pure defeat filtering, consumption, expiration and coherence validation. `combat-permissions.ts` separately derives restrictions from reviewed content/current conditions.

The existing fight pipeline still emits FIGHT_STARTED, calculates effective/reference power and emits the truthful FIGHT_RESULT. A single central `applyFightPreventions` boundary then filters applicable defeat instructions before the existing semantic defeat, Gear movement, owner order and cleanup machinery. Both resolution and stable continuation validation use the same pure filter; there are no card-slug checks in the combat reducer. Winner, losers and power are never rewritten or cached to simulate prevention. A protected Unit emits no CARD_DEFEATED and does not move.

If a positive tie protects one Unit while the other loses with attached Gear, the active effect is consumed immediately. Only the unfinished `defeatContinuation.appliedPrevention` proof remains long enough to validate the filtered result during the owner's Trash-order choice. It is not an active reusable effect. Final cleanup deletes the continuation. Forged missing/irrelevant proof is rejected. Automatic work still flows through `advanceResolutionWithEvents`, preserving the complete event batch without a RESOLVE_COMBAT player action.

## Effect lifetime

| Situation | Behavior |
|---|---|
| Next qualifying Unit fight | Consume once, using current participants |
| Friendly Unit loses and would be defeated by rival | Prevent that defeat; keep fight result |
| Friendly Unit wins | Consume; no prevented-defeat event is fabricated |
| Positive-power tie | Prevent only rival-caused friendly defeat; the friendly Unit can still defeat its rival |
| Zero-reference-power tie | Consume; neither defeat nor prevented-defeat is fabricated |
| Gig-area combat | Does not consume; no Unit fight happened |
| Invalidated attack | Does not consume; no fight occurred |
| Later fight in the same turn | Previously consumed effect is absent |
| No qualifying fight before turn end | Emit expiration and delete record before next turn |
| Source Program moves after resolving | Effect remains independent; historical source identity is retained |

Identity hashes protocol, source instance, controller seat and created turn, independent of transport UUID/version/event counters. Duration must match the current turn. Validation requires a supported source revision and controller, deterministic ID, coherent expiration, and only the supported active/proof placement. There is no target record to become stale and no dead consumed record retained until turn end. Source movement tests include a later hidden location; the already public effect's historical source reference does not expose a new undeclared hand identity.

Only **one outstanding prevention globally** is reviewed. A second Reboot PLAY_CARD is omitted from the supported legal set; an explicit attempt returns `UNSUPPORTED_MULTIPLE_FIGHT_PREVENTIONS`. Duplicate, overlapping, stale and malformed state records reject atomically. The local replacement-order rules do not settle Reboot's multiple-next-fight consumption interaction. This limitation is reported as unsupported execution, not presented as a printed deck/copy rule or resolved by array order.

## Corpo Security

Exact text:

> This Unit can't attack.
> {Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)

Green RAM 1, cost 2, power 2, unsellable Unit. Ordinary Unit play/payment gives ready + Lag. Derived CANNOT_ATTACK keeps DECLARE_ATTACK absent even when otherwise ready and Lag-free; forged client attacks fail. Its separate Blocker eligibility remains legal with or without Lag, spends the Unit and redirects normally using the existing Bombus Blocker implementation. Generic fights can defeat it normally when no prevention applies. No cached `canAttack` field or duplicate combat handler exists.

## MT0D12 Flathead

Exact text:

> If you have less ☆ (Street Cred) than a Rival, this Unit can't be blocked.

Blue RAM 3, cost 5, power 7, sellable Unit. Ordinary play/Lag and later attack are reused. CANNOT_BE_BLOCKED is a typed static restriction on this Unit, conditioned on current controller Street Cred strictly below a rival's. It is queried whenever blockers are compiled, including after each completed reaction. Declaration does not snapshot permission. Equality is false for the restriction and permits normal blocking.

The defender still gets CALL, Quick PLAY_CARD and PASS; the React window is preserved. Legal sets and action validation use the same current attacker permission. Existing admitted Quick/CALL reactions change power/cards, not Street Cred, so no presently admitted reaction changes this condition. Focused tests use the existing trusted Gig-value operation to cross the comparison and test equality, proving that future reviewed value-changing effects will see current state. Both-empty areas compare as Null/Null, not less-than; an empty area compares below a numeric rival. No mutable combat flag or power workaround is stored.

## Psycho Squad

Exact text: `[Flavour] Their protocol stops at “shoot first.”`

Admitted revision 1: Blue RAM 1, cost 4, power 6, unsellable ordinary Unit. The complete capture contains flavor only. It uses the same reusable no-ability Unit admission shape as Emergency Atlus, with strict rejection of extra keywords/abilities/modifiers/restrictions and unsupported costs. Normal play/Lag, later attacks, ordinary fight, targeting and defeat need no custom PendingEffect or reducer. The physical Merc list remains **3 copies**.

## Emergency Atlus

Exact text: `"Grab the policyholder, leave the rest for the city meatwagon."`

Admitted revision 1: Green RAM 1, cost 3, power 4, unsellable ordinary Unit. The quoted narrative has no executable instruction. Its API capture does not preserve visual italics; this is a manual text/metadata review under the flavor rule, not a claim to have inspected a card image. Full source text is retained. The legal vanilla trace plays it, clears Lag at turn end, attacks a Gig area, then exposes it spent to a later Psycho Squad attack and ordinary defeat. No synthetic behavior was added to the card.

## RulesView changes

Pure `getAttackRestrictions(id)`, `canBeBlocked(id)` and `getApplicableFightPreventions()` queries compose existing current characteristics, independent attack/Blocker eligibility and typed conditions. Printed restrictions are not persisted as booleans. Observation and legal action compilation share the same queries. Previous admission paths reject the new restriction vocabulary if it is attached to an older unreviewed shape, rather than silently dropping a line.

## Events

Added FIGHT_PREVENTION_CREATED (complete active effect identity), FIGHT_PREVENTION_CONSUMED (effect/source/controller and both participants), FIGHT_DEFEAT_PREVENTED (effect/source/protected Unit/rival causing defeat), and FIGHT_PREVENTION_EXPIRED (effect/source/TURN_END). The ordinary fight result stays historical truth. No false CARD_DEFEATED or compensating undo event is emitted for prevention. All events have the existing match/turn/contiguous-sequence envelope.

## Observation

Public active `fightPreventions` project identity, source, controller seat, created turn and expiry. Visible face-up field cards expose currently active `restrictions`; Flathead's entry disappears when its condition is false. Existing participants, attachment relations and effective power remain visible. Undeclared rival hands, deck order, hidden Legends and future RNG remain hidden. Declared Programs use the existing public declaration lifecycle. Model input remains observation plus legal descriptors, never private TrainingPosition state/content/RNG.

## Training positions and action IDs

The three new fixtures record only decision boundaries with more than one legal action: 34 prevention positions, 28 permissions positions and 35 vanilla positions. There are no samples for automatic restriction queries, prevention, fight arithmetic, expiration or cleanup. The one forced permissions action does not create a sample. Existing strategic owner/Gig order choices remain real choices.

POSITION_V2 is unchanged. IDs include the semantic position, so changing Street Cred changes all action IDs and rejects stale IDs. Unrelated CALL/Quick/PASS action payloads remain identical when a Blocker option becomes legal. Reordering object-map insertion order changes neither legal ordering nor IDs. Database tests also verify the same IDs under fresh match/player transport UUIDs, including active prevention records.

## Demo coverage

Counts were computed from all 29 rows of [demo-deck-coverage-roadmap.md](demo-deck-coverage-roadmap.md), preserving the exact physical lists.

| Metric | Before | After |
|---|---:|---:|
| Distinct reference cards | 29 | 29 |
| Reviewed executable, within stated scope | 6 | 11 |
| Without an executable revision | 23 | 18 |
| Remaining cards with a known subsystem/admission blocker | 23 | 18 |
| Arasaka supported distinct / 14 | 2 | 4 |
| Arasaka supported physical copies / 30 | 5 | 11 |
| Mercs supported distinct / 15 | 4 | 7 |
| Mercs supported physical copies / 30 | 8 | 14 |
| Combined physical copies / 60 | 13 | 25 |

Unreviewed and blocked counts overlap: these are the same remaining cards, not separate populations. Reboot's two copies are individually admitted, but overlapping effects remain outside scope. Copy coverage does not imply a runnable deck.

## Demo match readiness

**Exact Arasaka starter initialization: NO. Exact Merc starter initialization: NO. Complete deterministic match between them: NO.** Both 27-main decks fail the current constructed minimum independently of card support. Arasaka still lacks 10 distinct cards (19 copies); Mercs lacks 8 (16 copies):

- **Arasaka:** Goro Takemura — Hands Unclean; Yorinobu Arasaka — Embracing Destruction; Saburo Arasaka — Stubborn Patriarch; Minotaur; Satori — Sword of Saburo; Industrial Assembly; Over the Edge; Field Operator; Goro Takemura — Losing His Way; Corporate Surveillance.
- **Mercs:** V — Corporate Exile; Jackie Welles — Pour One Out For Me; Dying Night — V's Pistol; Dexter DeShawn — One Last Chance; Kiroshi Optics; Mandibular Upgrade; Delamain Cab; Evelyn Parker — Scheming Siren.

The roadmap gives each remaining card's specific blocker: Go Solo/field Legends, traits and first-event guards, fight-result/Defeated triggers, inherited Gear effects/keywords, targeted defeat, even/value conditions, spending filters, ordered draw/discard, steal history and end-turn ready effects. No card is certified solely because a primitive now exists.

Local demo printing metadata and the rules' generic Gameplay Guide reference do not provide complete starter rules. No authoritative local capture established starter size/Legend/RAM/copy/setup/win-condition exceptions. No demo rules were invented or implemented; an independent format review is still needed.

## Constructed validation

The reviewed official **40–50 main-card range** is unchanged. Both supplied reference decks remain **27 main + 3 Legends = 30**, with Psycho Squad 3. No padding, weakened admission or DEMO_STARTER policy. The focused suite asserts the exact min/max, no demo policy and rejection of 27-card initialization; all existing deck/differential tests remain green.

The new replays use legal **42-main + 3-Legend synthetic support decks**, not the starters. A separately identified `restriction-blue-support` synthetic Legend provides Blue RAM 3 for Flathead while retaining the existing simple synthetic CALL effect. It is a new explicit fixture identity, not an edit to a real card or an existing immutable revision. All selected real gameplay cards retain fully reviewed shapes. Headline traces use legal setup and ordinary turns with pinned seeds; no state/RNG patches. Trusted focused setups are explicitly labeled and confined to edge-case tests.

## Replays

All nine previous families retain their action counts, scenario coverage and final policy boundaries after regeneration. Some generators select the first matching legal action in hash order, so the artifact pin can change an incidental selected card or die. A separate compatibility audit replayed every original HEAD action payload against the current engine with updated content pins: all nine original sequences remained legal and every original transition event batch matched exactly. All original immutable card revisions also remain byte-identical in the regenerated bundles. The three new checked-in families prove prevention/Blocker, conditional blocker restriction with CALL still usable, and ordinary vanilla combat separately.

| Family | Actions | Strategic positions | Events including creation | Final boundary |
|---|---:|---:|---:|---|
| turn | 7 | 3 | 53 | CHOOSE_GIG |
| setup | 10 | 7 | 67 | CHOOSE_GIG |
| reviewed | 11 | 11 | 65 | MAIN |
| noncombat | 24 | 23 | 125 | MAIN |
| gear | 25 | 25 | 99 | MAIN |
| combat-attack | 41 | 40 | 185 | RIVAL_REACT |
| react | 53 | 51 | 229 | COMBAT_RESOLUTION_PENDING |
| fight | 53 | 51 | 236 | MAIN |
| gig-steal | 46 | 45 | 203 | MAIN |
| prevention | 34 | 34 | 143 | MAIN |
| permissions | 29 | 28 | 133 | MAIN |
| vanilla | 35 | 35 | 144 | MAIN |

| New family | Final replay-state hash |
|---|---|
| prevention | `64951962cdb4c3f59e33c99f7cc39fa8f247be0ef278082d0e7aa77fa7003ede` |
| permissions | `05aa0f7603654e62fbfe097add3e10e18c1e326c3a42674cb2dd0e50943ee3fa` |
| vanilla | `b55ba076d85b788c51211a2d583ddf1118ec5e50851bc6f6ba650aeb99dee210` |

The legal unused-prevention branch has **36 actions / 154 events**, ending at MAIN with hash `8380221b6aac0a9f6dc29d57907852103420a1c453f0cf7dcdd6e9010009ae98`. It shares the prevention family and is generated for focused/DB validation rather than another stored golden: decline Blocker, complete the Gig attack, end the turn, expire the unused effect and roll the next Gig.

The prevention headline ends at MAIN with the redirected Corpo still on the field, the original fight winner/loser unchanged, and the effect consumed. The permissions headline completes a Flathead Gig attack with no Blocker option and a real CALL choice. The vanilla headline plays and attacks with both ordinary Units, then defeats spent Atlus through the common engine. These are implementation-reviewed regression/training-position fixtures, not human gold or complete games.

## Persistence

Live local Mongo/Postgres integration passed **2/2 tests, zero skips**. The suite uses explicit local URLs and isolated randomized Mongo databases/Postgres schemas, then cleans up only its own resources. Existing migration, ledger concurrency/idempotency, rollback, stale state, content history, search and event-transaction checks remain green.

Mongo publishes/reads/replays all five new immutable revisions, retaining complete restrictions and source metadata. PostgreSQL saves and reads every transition of all three new traces plus the expiration branch, checks full state and contiguous history after each action, verifies replay/position hashes, and recompiles the derived legal action set after reload. Fresh transport UUIDs preserve action IDs. Creation, consumption, actual prevented defeat, expiration, fight outcome and final MAIN match expected events. No migration or persistence implementation change was required; existing JSON state/event storage is sufficient.

## Python/wire

Application-generated request, response and TrainingPosition JSON schemas and all wire/replay goldens were regenerated. TrainingAttempt was exported too and remained byte-identical. Additive v1 fields require the matching content/engine pins. No endpoint, service or action envelope changed. The worker remains independent of Next.js, Apollo, MongoDB and PostgreSQL.

Python traversed **all 12 replay families** via the unchanged generic legal-actions/actionId protocol, comparing creation, actions, observations, complete returned events, state/position/observation hashes and final states. It also passed seven wire vectors, stale/invalid-envelope checks and seven differential decks. Only the adapter test list and interop documentation changed in the harness; no prevention/permission/card-shape logic was added to Python.

## Tests

| Gate | Result |
|---|---|
| Node / npm | v22.13.0 / 10.9.2 |
| Typecheck | Pass, application and web TypeScript plus existing GraphQL generation |
| ESLint | Pass, no warnings |
| validate:cards | Pass, 4 original starter fixture records |
| Focused restrictions suite | 26/26 pass |
| Full TypeScript suite | 198/198 pass, zero skips |
| Original nine replay payload sequences | All accepted by the current engine, with exact original transition event batches |
| Production build | Pass, compile/typecheck/static generation; `/api/graphql` retained |
| Contracts export | Pass; generated artifacts verified by tests |
| Mongo/Postgres integration | 2/2 pass, zero skips |
| Python engine adapter | 12 replay families + 7 wire vectors + 7 differential cases pass |
| Python game tests | 87 pass |
| Python core tests | 48 pass |
| Git whitespace check | Pass in both repositories |

`validate:cards` intentionally still reads the original four starter fixture records. It is not a count of reviewed gameplay bundle revisions or the 151 captured source cards. The five new revision admissions are validated by the focused/full suite, content manifests, all new replays and Mongo round trips.

Focused coverage includes full-shape/cost/scope rejection, constructed regression, MAIN/React Program payment and source lifecycle, friendly win/loss/positive tie/zero tie, Gear owner ordering with consumed proof, single use and a later same-turn fight, expiry, Gig attacks, invalid/forged atomic rejection, Blocker redirection, Corpo attack ban versus independent Lag-compatible blocking, Flathead true/false/equality/Null conditions and other React options, both vanilla lifecycles, public/private observations, automatic event preservation, stable hashes and wire actionId traversal.

During test authoring, assertions were corrected to expect unreviewed content rejection at bundle creation, omit an absent policy instead of hashing `undefined`, and choose a legal next Gig rather than assuming D20 was in Fixer. The initial focused runs exposed these test-authoring errors; the final 26-test run and full suite pass. A read-only ESM stdin metadata probe was retried with the repository's CJS-compatible `require` mode; project module settings were not changed. A documentation-generation field-name typo was corrected before the final documentation audit.

## Commands

Executed in the application root unless otherwise shown. Outputs were retained in `/tmp/tcg-restrictions-*.log` during this session. All final gate commands below returned exit 0; no skipped infrastructure test is counted as a pass.

```bash
export PATH=/Users/codyclark/.nvm/versions/node/v22.13.0/bin:$PATH
node -v
npm -v

node --import tsx --test tests/combat-restrictions.test.ts > /tmp/tcg-restrictions-focused.log 2>&1

for script in generate-wire-golden generate-turn-replay generate-setup-replay generate-reviewed-replay generate-noncombat-replay generate-gear-replay generate-combat-attack-replay generate-react-replay generate-combat-resolution-replays generate-combat-restrictions-replays; do
  node --import tsx scripts/$script.ts > /tmp/tcg-restrictions-$script.log 2>&1 || exit 1
done
npm run contracts:export > /tmp/tcg-restrictions-contracts.log 2>&1

npm run typecheck > /tmp/tcg-restrictions-typecheck.log 2>&1
npm run lint > /tmp/tcg-restrictions-lint.log 2>&1
npm run validate:cards > /tmp/tcg-restrictions-cards.log 2>&1
npm test > /tmp/tcg-restrictions-tests.log 2>&1
npm run build > /tmp/tcg-restrictions-build.log 2>&1

TEST_MONGODB_URI=mongodb://127.0.0.1:27018 TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/cyberpunk_tcg npm run test:integration > /tmp/tcg-restrictions-integration.log 2>&1

git diff --check
```

The initial new fixture generation also ran `node --import tsx scripts/generate-combat-restrictions-replays.ts`. Read-only source inspection used `rg`, file reads and Python JSON/SHA-256 comparison; fixture seed authoring used deterministic legal engine creation and action selection rather than RNG/state patching. Metadata inspection used `node --import tsx` stdin with `require` to calculate normalized hashes and expiration trace statistics. Coverage was calculated from the exact Markdown table and checked against 29 rows and 30 copies per deck.

Executed in `/Users/codyclark/Documents/personal_code/tcg_ai_training/cyberpunk_llm`:

```bash
mlx_env/bin/python -B scripts/test_engine_adapter.py --app-root /Users/codyclark/Documents/personal_code/cyberpunk-tcg-online --node /Users/codyclark/.nvm/versions/node/v22.13.0/bin/node > /tmp/tcg-restrictions-python-adapter.log 2>&1
mlx_env/bin/python -B scripts/test_cyberpunk.py > /tmp/tcg-restrictions-python-game.log 2>&1
mlx_env/bin/python -B scripts/test_harness_core.py > /tmp/tcg-restrictions-python-core.log 2>&1
git diff --check
```

The additional read-only compatibility audit used the original committed replay payloads without mutating either checkout:

```bash
node --import tsx - > /tmp/tcg-restrictions-legacy-payloads.log 2>&1 <<'JS'
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {createContentBundle}=require('@tcg/domain');
const {createGameWithEvents,applyAction}=require('@tcg/engine');
const {engineIdentity}=require('./scripts/engine-identity.ts');
const unwrap=r=>{assert.ok(r.ok,JSON.stringify(r)); return r.value};
for (const family of ['turn','setup','reviewed','noncombat','gear','combat-attack','react','fight','gig-steal']) {
 const before=JSON.parse(execFileSync('git',['show',`HEAD:tests/fixtures/${family}-replay.v1.json`],{encoding:'utf8',maxBuffer:100*1024*1024}));
 const context={content:createContentBundle(before.content.ruleset,before.content.cards,engineIdentity())};
 let state=unwrap(createGameWithEvents(before.initialization,context)).state;
 for(const [i,step] of before.steps.entries()) {
  const next=unwrap(applyAction(state,step.action,context));
  assert.deepEqual(next.events,step.events,`${family} original event batch ${i}`);
  state=next.state;
 }
 console.log(`${family}: original ${before.steps.length} action payloads accepted; original event batches unchanged; final ${state.timing.step}`);
}
JS
```

## Files changed

The inventory below compares bytes with the before-work baseline, including new files. Pre-existing staged/untracked harness work is preserved and excluded unless its bytes changed in this milestone. Generated artifacts are listed individually. GraphQL generation and TrainingAttempt export ran but produced no changed bytes.

### Application — 51 files

| File | Change |
|---|---|
| [docs/combat-restrictions-report.md](../docs/combat-restrictions-report.md) | New complete milestone report: evidence, semantics, metrics, gates, commands, inventory and limits. |
| [docs/demo-deck-coverage-roadmap.md](../docs/demo-deck-coverage-roadmap.md) | Preserve all 29 rows/copy counts; update five admissions, exact before/after metrics and readiness/blockers. |
| [docs/executable-card-coverage.md](../docs/executable-card-coverage.md) | Record all five complete shapes, exact text, raw/canonical/normalized hashes and printing/errata pins. |
| [packages/domain/src/card.ts](../packages/domain/src/card.ts) | Add the bounded execution scope and optional typed printed restrictions without changing older card revisions. |
| [packages/domain/src/game.ts](../packages/domain/src/game.ts) | Add distinct prevention state, consumed continuation proof and four typed lifecycle event payloads. |
| [packages/domain/src/mechanics.ts](../packages/domain/src/mechanics.ts) | Define only the required two restrictions, Street Cred comparison and prevention-creation primitive. |
| [packages/domain/src/ruleset.ts](../packages/domain/src/ruleset.ts) | Add opt-in COMBAT_RESTRICTIONS_V1 policy, leaving constructed format bounds intact. |
| [packages/engine/src/attachments.ts](../packages/engine/src/attachments.ts) | Reject unsupported restriction-bearing Gear through full-shape admission. |
| [packages/engine/src/attack-support.ts](../packages/engine/src/attack-support.ts) | Reject extra restrictions on the older reviewed attack shape. |
| [packages/engine/src/combat-outcome-state.ts](../packages/engine/src/combat-outcome-state.ts) | Validate filtered defeat continuations with the same pure prevention filter and scoped consumed proof. |
| [packages/engine/src/combat-permissions.ts](../packages/engine/src/combat-permissions.ts) | New pure current-state restriction, cannot-attack and can-be-blocked queries. |
| [packages/engine/src/combat-queries.ts](../packages/engine/src/combat-queries.ts) | Apply derived attack restrictions to existing attacker eligibility. |
| [packages/engine/src/combat-resolution.ts](../packages/engine/src/combat-resolution.ts) | Insert the central prevention hook between truthful fight result and ordinary semantic defeat. |
| [packages/engine/src/combat-state.ts](../packages/engine/src/combat-state.ts) | Require complete combat policy when the new restrictions policy is enabled. |
| [packages/engine/src/conditions.ts](../packages/engine/src/conditions.ts) | Implement live Street Cred less-than-rival comparison with explicit Null behavior. |
| [packages/engine/src/effect-support.ts](../packages/engine/src/effect-support.ts) | Reject extra restrictions in older CALL/Legend support rather than ignoring them. |
| [packages/engine/src/effects.ts](../packages/engine/src/effects.ts) | Register the typed prevention-creation primitive in the existing effect dispatcher. |
| [packages/engine/src/fight-prevention.ts](../packages/engine/src/fight-prevention.ts) | New deterministic effect identity, validation, creation, applicability, defeat filtering, consumption and expiration. |
| [packages/engine/src/index.ts](../packages/engine/src/index.ts) | Expire prevention at END_TURN and return explicit unsupported-overlap errors on attempted second creation. |
| [packages/engine/src/initialization.ts](../packages/engine/src/initialization.ts) | Admit complete new reviewed shapes and reject unrelated unsupported restriction metadata. |
| [packages/engine/src/observation.ts](../packages/engine/src/observation.ts) | Expose public active prevention and derived visible-field restrictions through additive schema fields. |
| [packages/engine/src/play-support.ts](../packages/engine/src/play-support.ts) | Route the new complete shapes through ordinary play and omit unsupported overlapping creation. |
| [packages/engine/src/react-queries.ts](../packages/engine/src/react-queries.ts) | Reuse Blocker for Corpo and query the current attacker blocking permission independently of other reactions. |
| [packages/engine/src/react-support.ts](../packages/engine/src/react-support.ts) | Keep older React admission strict against unreviewed printed restrictions. |
| [packages/engine/src/restriction-support.ts](../packages/engine/src/restriction-support.ts) | New complete reviewed admission shapes for Reboot, Corpo, Flathead and reusable ordinary Units. |
| [packages/engine/src/state.ts](../packages/engine/src/state.ts) | Validate active prevention and consumed continuation records before combat-state validation. |
| [packages/engine/src/view.ts](../packages/engine/src/view.ts) | Expose the three new read-only combat restriction/prevention queries. |
| [packages/wire/schemas/request.v1.json](../packages/wire/schemas/request.v1.json) | Regenerate additive content, mechanics and state request schema. |
| [packages/wire/schemas/response.v1.json](../packages/wire/schemas/response.v1.json) | Regenerate additive state, events, observation and returned-position response schema. |
| [packages/wire/schemas/trainingPosition.v1.json](../packages/wire/schemas/trainingPosition.v1.json) | Regenerate the shared private-state/public-observation contract; TrainingPosition remains schema 2. |
| [scripts/engine-identity.ts](../scripts/engine-identity.ts) | Increment behavior artifact to 0.4.0-combat-restrictions-1. |
| [scripts/generate-combat-restrictions-replays.ts](../scripts/generate-combat-restrictions-replays.ts) | New deterministic generator for the three focused checked-in replay families. |
| [tests/combat-restrictions-fixture.ts](../tests/combat-restrictions-fixture.ts) | Normalize five immutable real cards, pin policy bundle, and define explicit synthetic constructed support. |
| [tests/combat-restrictions-replay.ts](../tests/combat-restrictions-replay.ts) | Create three legal setup/turn/combat traces plus a legal unused-prevention expiration branch. |
| [tests/combat-restrictions.test.ts](../tests/combat-restrictions.test.ts) | Add 26 focused source/admission, timing, combat, lifetime, view, visibility, hash and wire tests. |
| [tests/fixtures/combat-attack-replay.v1.json](../tests/fixtures/combat-attack-replay.v1.json) | Regenerate the existing combat-attack family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/combat-restrictions-card-sources.v1.json](../tests/fixtures/combat-restrictions-card-sources.v1.json) | New complete five-card local source snapshot, original byte hashes, printing objects and errata pin. |
| [tests/fixtures/combat-restrictions-rules.v1.json](../tests/fixtures/combat-restrictions-rules.v1.json) | New 140-record captured rule review with four capture hashes and explicit bounded decisions. |
| [tests/fixtures/fight-replay.v1.json](../tests/fixtures/fight-replay.v1.json) | Regenerate the existing fight family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/gear-replay.v1.json](../tests/fixtures/gear-replay.v1.json) | Regenerate the existing gear family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/gig-steal-replay.v1.json](../tests/fixtures/gig-steal-replay.v1.json) | Regenerate the existing gig-steal family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/noncombat-replay.v1.json](../tests/fixtures/noncombat-replay.v1.json) | Regenerate the existing noncombat family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/permissions-replay.v1.json](../tests/fixtures/permissions-replay.v1.json) | New 29-action/28-position/133-event Flathead restriction and CALL golden ending at MAIN. |
| [tests/fixtures/prevention-replay.v1.json](../tests/fixtures/prevention-replay.v1.json) | New 34-action/34-position/143-event prevention and Blocker golden ending at MAIN. |
| [tests/fixtures/react-replay.v1.json](../tests/fixtures/react-replay.v1.json) | Regenerate the existing react family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/reviewed-replay.v1.json](../tests/fixtures/reviewed-replay.v1.json) | Regenerate the existing reviewed family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/setup-replay.v1.json](../tests/fixtures/setup-replay.v1.json) | Regenerate the existing setup family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/turn-replay.v1.json](../tests/fixtures/turn-replay.v1.json) | Regenerate the existing turn family artifact/content/hashes and positions; retain its scenario and policy behavior; first-matching hash-order selections may shift with the artifact pin. |
| [tests/fixtures/vanilla-replay.v1.json](../tests/fixtures/vanilla-replay.v1.json) | New 35-action/35-position/144-event ordinary Psycho/Atlus golden ending at MAIN. |
| [tests/fixtures/wire-golden.v1.json](../tests/fixtures/wire-golden.v1.json) | Regenerate all seven wire vectors against the new artifact/content pins. |
| [tests/integration/persistence.test.ts](../tests/integration/persistence.test.ts) | Round-trip five revisions in Mongo and three traces plus expiration through PostgreSQL state/events/hashes/legal sets. |

### AI harness — 2 files

| File | Change |
|---|---|
| [docs/engine-interop.md](../../tcg_ai_training/cyberpunk_llm/docs/engine-interop.md) | Document current 12-family protocol behavior, visibility, prevention limits, metrics and Node ownership; retain historical policy notes. |
| [scripts/test_engine_adapter.py](../../tcg_ai_training/cyberpunk_llm/scripts/test_engine_adapter.py) | Add the three new replay names to the generic Node/actionId driver without Python gameplay logic. |

## Unsupported mechanics

No general replacement chains, ambiguous simultaneous Reboot overlap, generic simultaneous ordering, fight-win/DEFEATED trigger cluster, Satori inheritance, Dexter/Jackie/Yorinobu complex behaviors, Mandibular inherited Blocker, Go Solo/field Legend execution, steal-history effects, free Trash reordering, broader unreviewed cards, full demo format or complete demo match. Existing completed fight/defeat/Gig-transfer/Gear/Floor It/React paths remain covered by regression tests. No larger architecture pass or UI refactor was undertaken.

## Ambiguities not guessed and remaining debt

Multiple next-fight prevention interaction is unresolved in the local capture; explicitly reject rather than impose replacement-array order or assume stacking. Demo-format rules are absent; constructed is not weakened. Emergency Atlus's capture lacks visual typography, so its narrative-only classification is documented as text review. No publisher-image or human-gold certification is claimed.

The older no-Gig Street Cred observation remains numeric 0; the new strict comparison handles Null explicitly. Current admitted React effects cannot change Street Cred; live-condition behavior is verified through the trusted value primitive rather than inventing a new Quick effect. The two measured legacy Python deck-validator gaps remain repeated-entry copy bypass and Legends in main; authoritative gameplay/deck admission is in TypeScript. New reviewed revisions live in pinned gameplay content bundles; the starter catalog validator is still a separate four-record fixture check.

A pre-existing fixture-authoring limitation remains: choosing the first hash-sorted legal action can change incidental fixture selections across artifact pins. Explicit semantic selectors would make future golden diffs narrower. The separate original-payload compatibility audit verifies that this pass did not invalidate the old gameplay traces.

No lint/build warning or failing final gate remains. The remaining limitations are explicit execution/source-review boundaries, not hidden fallbacks.

## Recommended next milestone

Use the roadmap to review one coherent fight-result/Defeated trigger cluster, starting with exact Satori text and its inheritance/timing requirements, then the applicable Dexter/Jackie behaviors with explicit first-event guards and ordering. Treat inherited Gear keywords and Go Solo/field Legends as subsequent bounded passes. Review demo-format source rules separately before introducing DEMO_STARTER or attempting the first complete exact Arasaka-versus-Merc match. Resolve multiple Reboot overlap from authoritative evidence before claiming those copies can coexist during one turn.
