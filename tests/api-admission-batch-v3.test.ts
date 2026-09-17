import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, observe, resolveActionId } from "@tcg/engine";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsRestrictedPlay } from "../packages/engine/src/restriction-support";
import { supportsAttackPreventionUnit } from "../packages/engine/src/attack-prevention-support";
import { currentCombatRestrictions, getAttackRestrictions, imposedAttackPrevention } from "../packages/engine/src/combat-permissions";
import { attackSourceValid, isAttackEligible, laggingAttackPermitted, listAttackTargets } from "../packages/engine/src/combat-queries";
import { RIDING_NOMAD, batchV2Context } from "./api-admission-batch-v2-fixture";
import { MAXTAC_SUPPRESSION, RUTHLESS_LOWLIFE, batchV3Cards, batchV3Context, batchV3Input } from "./api-admission-batch-v3-fixture";
import { BATCH_V3_UNITS, batchV3Replay } from "./api-admission-batch-v3-replay";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/api-admission-batch-v3-card-sources.v1.json";
import rules from "./fixtures/api-admission-batch-v3-rules.v1.json";
import v2Sources from "./fixtures/api-admission-batch-v2-card-sources.v1.json";
import v2Rules from "./fixtures/api-admission-batch-v2-rules.v1.json";

// Built lazily and memoised so a broken revision, gate or replay fails the test that needs it, never the whole file at load.
let builtContext: ReturnType<typeof batchV3Context> | undefined, builtReplay: ReturnType<typeof batchV3Replay> | undefined;
let builtNoTargets: ReturnType<typeof batchV3Context> | undefined, builtNoPrevention: ReturnType<typeof batchV3Context> | undefined;
const getContext = () => (builtContext ??= batchV3Context());
const getReplay = () => (builtReplay ??= batchV3Replay());
const isBatchUnit = (cardId: string) => (BATCH_V3_UNITS as readonly string[]).includes(cardId);
const structured = (descriptor: object) => canonicalSerialize(Object.fromEntries(Object.entries(descriptor).filter(([key]) => key !== "label")));
function withoutPolicy(flag: "attackTargetRestrictions" | "attackPrevention") {
    const ruleset = RulesetSchema.parse(getContext().content.ruleset);
    delete ruleset.gameplay!.turnSlice![flag];
    return { content: createContentBundle(ruleset, getContext().content.cards.map(c => CardRevisionSnapshotSchema.parse(c)), getContext().content.manifest.engine) };
}
const getNoTargets = () => (builtNoTargets ??= withoutPolicy("attackTargetRestrictions"));
const getNoPrevention = () => (builtNoPrevention ??= withoutPolicy("attackPrevention"));
const controlled = (state: GameState, actor: string, cardId: string, ready?: "READY" | "SPENT") =>
    Object.values(state.objects.cards).find(c => c.cardId === cardId && c.controllerId === actor && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && (!ready || c.readiness === ready));
const readyUnit = (state: GameState, actor: string, cardId: string) =>
    Object.values(state.objects.cards).find(c => c.cardId === cardId && c.controllerId === actor && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && c.readiness === "READY" && !c.statuses.includes("LAG"));
const mainDecision = (s: { before: GameState; actorId: string }) => s.before.timing.window === "MAIN" && s.before.resolution.stage === "DECISION"
    && s.before.timing.combat.stage === "NONE" && s.before.timing.activePlayer === s.actorId && s.before.timing.actingPlayer === s.actorId;
const rivalHasGigs = (state: GameState, actor: string) => Object.values(state.objects.gigs).some(g => g.controllerId === state.match.playerOrder.find(p => p !== actor) && g.location.zone === "GIGS" && g.roll.kind === "ROLLED");
// The same card id and revision with its printed restriction removed: an exact counterfactual for the
// restriction itself, holding the state, the instance, the policy and every other characteristic fixed.
let builtTwin: ReturnType<typeof batchV3Context> | undefined;
const unrestrictedTwin = () => (builtTwin ??= (() => {
    const cards = getContext().content.cards.map(c => CardRevisionSnapshotSchema.parse(c.id === RUTHLESS_LOWLIFE ? { ...c, mechanics: { ...c.mechanics, restrictions: [] } } : c));
    return { content: createContentBundle(RulesetSchema.parse(getContext().content.ruleset), cards, getContext().content.manifest.engine) };
})());

test("Batch V3 pins exact API records, candidate facts, printings and attack-restriction rules for two new immutable revisions", () => {
    assert.deepEqual(batchV3Cards.map(c => c.id), [RUTHLESS_LOWLIFE, MAXTAC_SUPPRESSION]);
    assert.deepEqual(sources.matchingErrata, []);
    assert.equal(sources.errataSha256, v2Sources.errataSha256);
    assert.equal(sources.processedErrataSha256, v2Sources.processedErrataSha256);
    assert.equal(sources.candidateManifest.catalogSha256, v2Sources.candidateManifest.catalogSha256);
    assert.equal(rules.sha256, v2Rules.sha256); assert.equal(rules.processedSha256, v2Rules.processedSha256);
    assert.deepEqual(rules.rules.map(r => r.id), ["2.6", "4.2.1", "4.7", "5.6.4", "9.1", "9.3", "9.3.1", "9.3.1.1", "9.3.2", "9.3.2.1", "9.3.2.2", "9.3.2.3", "9.3.2.3.1", "9.3.2.4", "9.26", "9.26.3", "11.3", "11.3.1", "11.3.2", "11.23.1", "11.23.2"]);
    // The prevention capability is the worked example inside rule 2.6 itself.
    assert.match(rules.rules.find(r => r.id === "2.6")!.text, /Rival Units can't attack the turn they're played/);
    assert.match(rules.rules.find(r => r.id === "2.6")!.text, /preventing effect always takes precedence/);
    assert.match(rules.rules.find(r => r.id === "9.3.2.2")!.text, /rival Gig area containing one or more Gigs is a valid attack target/);
    assert.match(rules.rules.find(r => r.id === "9.3.2.3")!.text, /add to, remove, or restrict a Unit.s valid attack targets/);
    assert.match(rules.rules.find(r => r.id === "9.3.2.4")!.text, /If there are no valid targets, you cannot attack/);
    const priorIds = batchV2Context().content.cards.map(c => c.id);
    for (const card of batchV3Cards) {
        const { record: r, processedRecord: p, candidate: k } = sources.records.find(s => s.record.slug === card.id)!;
        assert.equal(priorIds.includes(card.id), false, "no earlier immutable revision exists");
        assert.equal(card.revision, 1); assert.equal(card.status, "ACTIVE"); assert.equal(card.provenance.reviewed, true);
        assert.equal(card.provenance.sourceHash, hashCanonical(r));
        assert.equal(k.sourceRecordHash, hashCanonical(p), "candidate hash re-derives from the processed API record");
        assert.equal(k.sourceCardSlug, card.id); assert.equal(k.identityCandidate.cardId, card.id); assert.equal(p.id, card.id);
        assert.equal(card.name, r.name); assert.equal(card.cardNumber, r.print_number);
        assert.equal(card.deckbuildingIdentity, k.identityCandidate.deckbuildingIdentity);
        assert.equal(card.displayName, k.identityCandidate.displayName); assert.equal(card.subtitle, k.identityCandidate.subtitle);
        assert.equal(card.type, k.catalog.type); assert.deepEqual(card.colors, k.catalog.colors);
        assert.deepEqual(card.printedCost, { kind: "EDDIES", amount: k.catalog.cost });
        assert.deepEqual(card.ram, { [k.catalog.colors[0]]: k.catalog.ram });
        assert.equal(card.power, k.catalog.power);
        assert.deepEqual(card.tags, k.catalog.classifications);
        assert.deepEqual(card.sellProfile, { allowed: k.catalog.sellable, baseEddieValue: 1 });
        assert.equal(card.sourceMarkup, r.rules_text); assert.equal(card.sourceMarkup, k.rulesSource.markup); assert.equal(p.text_markup, r.rules_text);
        assert.equal(card.rulesText, r.rules_text);
        // Hints are diagnostics only; the reviewed restriction/modifier is authored explicitly in the fixture.
        assert.deepEqual([k.rulesSource.keywordHints, k.rulesSource.referencedKeywordHints, k.rulesSource.timingTriggerHints], [[], [], []]);
        assert.deepEqual(k.errata, []); assert.deepEqual(card.provenance.errata, []);
        assert.deepEqual(card.printings.map(x => [x.id, x.setCode, x.collectorNumber]), r.printings.map(x => [x.id, x.set.code, x.collector_number]));
        assert.equal(card.printings.some(x => x.collectorNumber === card.id), false, "CardId is not a collector number");
        assert.deepEqual(card.keywords, []); assert.deepEqual(card.mechanics.keywords, []); assert.deepEqual(card.mechanics.abilities, []);
    }
    const ruthless = batchV3Cards.find(c => c.id === RUTHLESS_LOWLIFE)!, maxtac = batchV3Cards.find(c => c.id === MAXTAC_SUPPRESSION)!;
    assert.deepEqual(ruthless.execution, { scope: "COMBAT_RESTRICTIONS_V1", status: "SUPPORTED" });
    assert.deepEqual(ruthless.mechanics.restrictions, [{ kind: "CANNOT_ATTACK_GIG_AREA" }]); assert.deepEqual(ruthless.mechanics.modifiers, []);
    assert.deepEqual(maxtac.execution, { scope: "ATTACK_PREVENTION_V1", status: "SUPPORTED" });
    assert.deepEqual(maxtac.mechanics.modifiers, [{ kind: "RIVAL_LAGGING_UNITS_CANNOT_ATTACK" }]); assert.equal(maxtac.mechanics.restrictions, undefined);
});

test("each revision passes only its own reviewed gate, and each capability requires its explicit policy", () => {
    const ruthless = batchV3Cards.find(c => c.id === RUTHLESS_LOWLIFE)!, maxtac = batchV3Cards.find(c => c.id === MAXTAC_SUPPRESSION)!;
    assert.equal(getContext().content.ruleset.gameplay?.turnSlice?.attackTargetRestrictions, "ATTACK_TARGET_RESTRICTIONS_V1");
    assert.equal(getContext().content.ruleset.gameplay?.turnSlice?.attackPrevention, "ATTACK_PREVENTION_V1");
    assert.equal(supportsRestrictedPlay(ruthless, getContext()).ok, true);
    assert.equal(supportsAttackPreventionUnit(maxtac, getContext()).ok, true);
    assert.equal(supportsPlay(ruthless, getContext()).ok, true); assert.equal(supportsPlay(maxtac, getContext()).ok, true);
    // Neither card is executable without its own policy, and neither policy enables the other card.
    assert.equal(supportsPlay(ruthless, getNoTargets()).ok, false); assert.equal(supportsRestrictedPlay(ruthless, getNoTargets()).ok, false);
    assert.equal(supportsPlay(maxtac, getNoPrevention()).ok, false); assert.equal(supportsAttackPreventionUnit(maxtac, getNoPrevention()).ok, false);
    assert.equal(supportsPlay(ruthless, getNoPrevention()).ok, true); assert.equal(supportsPlay(maxtac, getNoTargets()).ok, true);
    // The prevention shape is a Unit modifier, not a restriction-family shape, and vice versa.
    assert.equal(supportsRestrictedPlay(maxtac, getContext()).ok, false);
    assert.equal(supportsAttackPreventionUnit(ruthless, getContext()).ok, false);
    const gates = ["packages/engine/src/restriction-support.ts", "packages/engine/src/attack-prevention-support.ts", "packages/engine/src/play-support.ts", "packages/engine/src/combat-queries.ts", "packages/engine/src/combat-permissions.ts"].map(path => readFileSync(path, "utf8")).join("\n");
    for (const card of batchV3Cards) assert.equal(gates.includes(card.id), false, `${card.id} must not be named by a support gate`);
});

const withMechanics = (card: CardRevisionSnapshot, mechanics: Partial<CardRevisionSnapshot["mechanics"]>) => ({ ...card, mechanics: { ...card.mechanics, ...mechanics } });
const variants: [string, (card: CardRevisionSnapshot) => unknown][] = [
    ["unreviewed provenance", c => ({ ...c, provenance: { ...c.provenance, reviewed: false } })],
    ["unsupported execution status", c => ({ ...c, execution: { scope: c.execution!.scope, status: "UNSUPPORTED" } })],
    ["swapped execution scope", c => ({ ...c, execution: { scope: c.execution!.scope === "ATTACK_PREVENTION_V1" ? "COMBAT_RESTRICTIONS_V1" : "ATTACK_PREVENTION_V1", status: "SUPPORTED" } })],
    ["added Blocker keyword", c => withMechanics(c, { keywords: [...c.mechanics.keywords, "BLOCKER"] })],
    ["added Adrenaline keyword", c => withMechanics(c, { keywords: [...c.mechanics.keywords, "ADRENALINE"] })],
    ["added outright attack ban", c => withMechanics(c, { restrictions: [...(c.mechanics.restrictions ?? []), { kind: "CANNOT_ATTACK" }] })],
    ["added triggered draw", c => withMechanics(c, { abilities: [{ id: "unreviewed-draw", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }] })],
    ["added host power modifier", c => withMechanics(c, { modifiers: [...c.mechanics.modifiers, { kind: "GRANT_PRINTED_POWER_TO_HOST" }] })],
    ["added equip clause", c => withMechanics(c, { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" } })],
    ["non-numeric printed cost", c => ({ ...c, printedCost: { kind: "DASH" } })],
    ["missing printed power", c => ({ ...c, power: undefined })],
    ["different card type", c => ({ ...c, type: "PROGRAM", power: undefined })]
];
// Printed power is part of the pinned prevention shape, but deliberately NOT of the shared ordinary-Unit
// restriction shape, which serves every reviewed vanilla Unit. Each card's own power is pinned to its
// source record by the provenance assertions above, never by a gate.
const powerPinned: [string, boolean][] = [[MAXTAC_SUPPRESSION, false], [RUTHLESS_LOWLIFE, true]];

test("nearby unreviewed or unsupported variants fail closed at every play gate, under both policies", () => {
    for (const card of batchV3Cards) for (const [name, mutate] of variants) {
        const variant = CardRevisionSnapshotSchema.parse(mutate(card));
        assert.equal(supportsPlay(variant, getContext()).ok, false, `${card.id}: ${name}`);
        assert.equal(supportsRestrictedPlay(variant, getContext()).ok, false, `${card.id}: ${name}`);
        assert.equal(supportsAttackPreventionUnit(variant, getContext()).ok, false, `${card.id}: ${name}`);
    }
    for (const [id, stillAccepted] of powerPinned) {
        const card = batchV3Cards.find(c => c.id === id)!;
        const altered = CardRevisionSnapshotSchema.parse({ ...card, power: (card.power ?? 0) + 1 });
        assert.equal(supportsPlay(altered, getContext()).ok, stillAccepted, `${id}: altered printed power`);
        assert.notEqual(altered.power, sources.records.find(s => s.record.slug === id)!.candidate.catalog.power, "the altered power no longer matches the pinned source record");
    }
    const unreviewed = CardRevisionSnapshotSchema.parse(variants[0][1](batchV3Cards[0]));
    const cards = getContext().content.cards.map(c => c.id === unreviewed.id ? unreviewed : CardRevisionSnapshotSchema.parse(c));
    assert.throws(() => createContentBundle(RulesetSchema.parse(getContext().content.ruleset), cards, getContext().content.manifest.engine));
});

test("a RAM-legal constructed deck initializes with both Units; either missing policy rejects the deck outright", () => {
    const input = batchV3Input("api-admission-batch-v3-init"), created = createGameWithEvents(input, getContext());
    assert.equal(created.ok, true, created.ok ? undefined : JSON.stringify(created.errors));
    if (created.ok) for (const id of BATCH_V3_UNITS) assert.equal(Object.values(created.value.state.objects.cards).filter(c => c.cardId === id).length, 6, id);
    assert.equal(createGameWithEvents(input, getNoTargets()).ok, false, "Ruthless Lowlife is not executable content without ATTACK_TARGET_RESTRICTIONS_V1");
    assert.equal(createGameWithEvents(input, getNoPrevention()).ok, false, "MaxTac Suppression Team is not executable content without ATTACK_PREVENTION_V1");
});

test("Ruthless Lowlife never receives the rival Gig area as a valid attack target (9.3.2.2/9.3.2.3)", () => {
    let checked = 0, withGigs = 0;
    for (const s of getReplay().steps) {
        const rival = s.before.match.playerOrder.find(p => p !== s.actorId)!;
        const unit = controlled(s.before, s.actorId, RUTHLESS_LOWLIFE);
        if (!unit) continue;
        const targets = listAttackTargets(s.before, unit.id, s.actorId, getContext());
        assert.equal(targets.some(t => t.kind === "GIG_AREA"), false, "Gig area must never be offered to Ruthless Lowlife");
        assert.deepEqual(currentCombatRestrictions(s.before, unit.id, getContext()), [{ kind: "CANNOT_ATTACK_GIG_AREA" }]);
        // The restriction removes a target class only; it is never an outright prohibition.
        assert.deepEqual(getAttackRestrictions(s.before, unit.id, getContext()), []);
        checked++;
        if (Object.values(s.before.objects.gigs).some(g => g.controllerId === rival && g.location.zone === "GIGS" && g.roll.kind === "ROLLED")) withGigs++;
    }
    assert.ok(checked > 0, "Ruthless Lowlife reached the battlefield"); assert.ok(withGigs > 0, "the rival Gig area was nonempty while it was in play");
    assert.ok(getReplay().attacks.some(a => a.cardId === RUTHLESS_LOWLIFE && a.target.kind === "CARD"), "it fought a spent rival Unit");
    assert.equal(getReplay().attacks.some(a => a.cardId === RUTHLESS_LOWLIFE && a.target.kind === "GIG_AREA"), false);
    assert.ok(getReplay().attacks.some(a => a.cardId !== RUTHLESS_LOWLIFE && a.target.kind === "GIG_AREA"), "an unrestricted Unit still steals from the Gig area");
});

test("with no valid target Ruthless Lowlife cannot attack at all, and only its printed restriction causes that (9.3.2.4)", () => {
    const step = getReplay().steps.find(s => mainDecision(s) && readyUnit(s.before, s.actorId, RUTHLESS_LOWLIFE) && rivalHasGigs(s.before, s.actorId));
    assert.ok(step, "a MAIN position with a ready, non-lagging Ruthless Lowlife and a nonempty rival Gig area");
    const state = GameStateSchema.parse(step.before), rival = state.match.playerOrder.find(p => p !== step.actorId)!;
    // Ready every rival Unit, so the Gig area is the only target class left in the position.
    for (const c of Object.values(state.objects.cards)) if (c.controllerId === rival && c.zone.zone === "BATTLEFIELD") c.readiness = "READY";
    const ruthless = readyUnit(state, step.actorId, RUTHLESS_LOWLIFE)!;
    assert.deepEqual(listAttackTargets(state, ruthless.id, step.actorId, getContext()), []);
    assert.equal(attackSourceValid(state, step.actorId, ruthless.id, getContext()), true, "the attacker itself stays legal; it simply has no valid target");
    assert.equal(isAttackEligible(state, step.actorId, ruthless.id, getContext()), false, "9.3.2.4: no valid targets means no attack");
    assert.deepEqual(getAttackRestrictions(state, ruthless.id, getContext()), [], "this is a target-class restriction, never an attack prohibition");
    // Identical state, instance and policy; only the printed restriction differs.
    assert.deepEqual(listAttackTargets(state, ruthless.id, step.actorId, unrestrictedTwin()), [{ kind: "GIG_AREA", playerId: rival }]);
    assert.equal(isAttackEligible(state, step.actorId, ruthless.id, unrestrictedTwin()), true, "without the printed restriction the same Unit may attack the Gig area");
});

test("MaxTac Suppression Team prevents rival Units played this turn from attacking, outranking printed Adrenaline (2.6)", () => {
    const step = getReplay().steps.find(s => {
        const rival = s.before.match.playerOrder.find(p => p !== s.actorId)!;
        const nomad = controlled(s.before, s.actorId, RIDING_NOMAD);
        return Boolean(nomad && nomad.statuses.includes("LAG") && controlled(s.before, rival, MAXTAC_SUPPRESSION));
    });
    assert.ok(step, "a lagging Riding Nomad faced a rival MaxTac Suppression Team");
    const nomad = controlled(step.before, step.actorId, RIDING_NOMAD)!;
    assert.deepEqual(nomad.statuses, ["LAG"]);
    assert.deepEqual(imposedAttackPrevention(step.before, nomad.id, getContext()), [{ kind: "CANNOT_ATTACK" }]);
    assert.deepEqual(getAttackRestrictions(step.before, nomad.id, getContext()), [{ kind: "CANNOT_ATTACK" }]);
    // The Adrenaline permission is still present; the preventing effect simply takes precedence.
    assert.equal(laggingAttackPermitted(step.before, nomad.id, getContext()), true);
    assert.equal(attackSourceValid(step.before, step.actorId, nomad.id, getContext()), false);
    assert.equal(isAttackEligible(step.before, step.actorId, nomad.id, getContext()), false);
    assert.equal(step.legalActions.some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === nomad.id), false);
    // Same position without the prevention policy: Adrenaline alone would let it attack while lagging.
    assert.deepEqual(imposedAttackPrevention(step.before, nomad.id, getNoPrevention()), []);
    assert.equal(attackSourceValid(step.before, step.actorId, nomad.id, getNoPrevention()), true, "only the prevention stops this attack");
    // Prevention is rival-facing only: the controller's own lagging Units are unaffected by their own card.
    const own = Object.values(step.before.objects.cards).find(c => c.controllerId !== step.actorId && c.statuses.includes("LAG") && c.zone.zone === "BATTLEFIELD" && c.face === "UP");
    if (own) assert.deepEqual(imposedAttackPrevention(step.before, own.id, getContext()), [], "a MaxTac controller's own lagging Units are not prevented");
});

test("prevention tracks the source leaving the field and the end-of-turn Lag removal, never a stored flag", () => {
    const step = getReplay().steps.find(s => {
        const rival = s.before.match.playerOrder.find(p => p !== s.actorId)!;
        const nomad = controlled(s.before, s.actorId, RIDING_NOMAD);
        return Boolean(nomad && nomad.statuses.includes("LAG") && controlled(s.before, rival, MAXTAC_SUPPRESSION));
    })!;
    assert.ok(step);
    const nomad = controlled(step.before, step.actorId, RIDING_NOMAD)!;
    const rival = step.before.match.playerOrder.find(p => p !== step.actorId)!;
    const noLag = GameStateSchema.parse(step.before);
    noLag.objects.cards[nomad.id].statuses = [];
    assert.deepEqual(imposedAttackPrevention(noLag, nomad.id, getContext()), [], "11.3.2: a Unit that has lost Lag is no longer prevented");
    const noSource = GameStateSchema.parse(step.before);
    const maxtac = controlled(step.before, rival, MAXTAC_SUPPRESSION)!;
    noSource.objects.cards[maxtac.id].face = "DOWN";
    assert.deepEqual(imposedAttackPrevention(noSource, nomad.id, getContext()), [], "a hidden source imposes nothing");
});

test("Batch V3 Units in hand stay hidden from the rival except while publicly declared for payment", () => {
    let hidden = 0, declared = 0;
    for (const s of getReplay().steps) {
        const hand = s.before.players[s.actorId].zones.HAND.filter(id => isBatchUnit(s.before.objects.cards[id].cardId));
        if (!hand.length) continue;
        const rival = s.before.match.playerOrder.find(p => p !== s.actorId)!;
        const rivalObservation = unwrap(observe(s.before, rival, getContext())), rivalView = JSON.stringify(rivalObservation);
        const ownView = JSON.stringify(unwrap(observe(s.before, s.actorId, getContext())));
        const play = s.before.resolution.playContinuation;
        const declaredSource = play && (play.phase === "PAYMENT" || play.phase === "EQUIP") ? play.sourceId : undefined;
        for (const id of hand) {
            assert.ok(ownView.includes(`"${id}"`), id);
            if (id === declaredSource) { declared++; assert.ok(rivalView.includes(`"${id}"`), `${id} is public while declared`); }
            else { hidden++; assert.equal(rivalView.includes(`"${id}"`), false, `${id} must stay hidden`); }
        }
        const seat = s.before.players[s.actorId].seat;
        assert.equal(rivalObservation.players.find(p => p.seat === seat)!.counts.HAND, s.before.players[s.actorId].zones.HAND.length);
    }
    assert.ok(hidden > 0); assert.ok(declared > 0);
});

test("every replay position projects to Descriptor V2 without duplicates, private fields or lost actions", () => {
    let batchActions = 0;
    for (const s of getReplay().steps) {
        const input = unwrap(buildModelInputV2(s.before, s.actorId, getContext()));
        assert.deepEqual(input.legalActions.map(a => a.actionId), s.legalActions.map(a => a.actionId));
        assert.equal(new Set(input.legalActions.map(a => structured(a.descriptor))).size, input.legalActions.length);
        for (const a of input.legalActions) assert.ok(resolveActionId(s.before, s.actorId, a.actionId, getContext()).ok);
        const publicJson = JSON.stringify(input.legalActions);
        for (const forbidden of ["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"]) assert.equal(publicJson.includes(`"${forbidden}"`), false, forbidden);
        batchActions += s.legalActions.filter(a => "cardInstanceId" in a.action && isBatchUnit(s.before.objects.cards[a.action.cardInstanceId].cardId)).length;
    }
    assert.ok(batchActions > 0);
});

test("the Batch V3 replay is deterministic and independent of actionId ordering", () => {
    const again = batchV3Replay(getReplay().seed, batchV3Context());
    assert.equal(again.finalStateHash, getReplay().finalStateHash);
    assert.deepEqual(again.steps.map(s => [s.actionId, s.stateHash, s.positionHash, s.observationHash]), getReplay().steps.map(s => [s.actionId, s.stateHash, s.positionHash, s.observationHash]));
    const perturbed = batchV3Replay(getReplay().seed, batchV3Context({ ...getContext().content.manifest.engine, artifactHash: "f".repeat(64) }));
    assert.notDeepEqual(perturbed.steps.map(s => s.actionId), getReplay().steps.map(s => s.actionId));
    assert.deepEqual(perturbed.steps.map(s => [s.actorId, s.action.action]), getReplay().steps.map(s => [s.actorId, s.action.action]));
    assert.deepEqual(perturbed.attacks, getReplay().attacks);
});
