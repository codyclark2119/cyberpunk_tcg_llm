import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, canonicalSerialize, type CardInstanceId, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, listLegalActions, moveCardForEffect, observe, resolveActionId, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { capabilitiesContext, capabilitiesInput, mandibular, MANDIBULAR } from "./gear-capabilities-fixture";
import { mandibularReplay } from "./gear-capabilities-replay";
import { CORPO, FLATHEAD, PSYCHO } from "./combat-restrictions-fixture";
import { MANTIS, ROYCE } from "./gear-fixture";
import { SATORI } from "./combat-triggers-fixture";
import { BOMBUS } from "./react-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { processDeparture, moveCardLocation, attachPlayedGear } from "../packages/engine/src/card-movement";
import { attackSourceValid } from "../packages/engine/src/combat-queries";
import { supportsCapabilityGear } from "../packages/engine/src/capability-support";
import { supportsGear } from "../packages/engine/src/attachments";
import { unwrap } from "./turn-replay";
import source from "./fixtures/gear-capabilities-card-source.v1.json";
import rules from "./fixtures/gear-capabilities-rules.v1.json";
const context = capabilitiesContext(), replay = mandibularReplay();
const states: GameState[] = [replay.initialized.state]; for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const blockIndex = replay.steps.findIndex(s => s.action.action.kind === "DECLARE_BLOCKER"), react = states[blockIndex], afterBlock = states[blockIndex + 1];
const host = replay.steps[blockIndex].action.action; assert.ok(host.kind === "DECLARE_BLOCKER"); const hostId = host.cardInstanceId;
const defender = react.objects.cards[hostId].controllerId, attacker = react.timing.activePlayer, gearId = react.objects.cards[hostId].attachments[0];
const legal = (s: GameState, ctx = context) => unwrap(listLegalActions(s, s.timing.actingPlayer, ctx));
function act(s: GameState, predicate: (a: LegalAction) => boolean) { const a = legal(s).find(predicate); assert.ok(a); return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, context)); }
function choose(s: GameState) { return act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0); }
function finish(s: GameState) { const events = []; while (s.resolution.choice) { const next = choose(s); s = next.state; events.push(...next.events); } return { state: s, events }; }
function withHost(cardId: string, n = 1) {
    const m = new TurnMutation(react, context), r = context.content.cards.find(c => c.id === cardId)!;
    m.state.objects.cards[hostId].cardId = r.id; m.state.objects.cards[hostId].revision = r.revision;
    for (const g of [...m.state.objects.cards[hostId].attachments]) unwrap(processDeparture(m, g, "HAND"));
    for (const g of Object.values(m.state.objects.cards).filter(c => c.controllerId === defender && c.cardId === MANDIBULAR).slice(0, n)) {
        if (g.zone.zone !== "HAND") moveCardLocation(m, g.id, "HAND"); unwrap(attachPlayedGear(m, g.id, hostId));
    }
    return unwrap(validateState(m.state, context));
}
/** Trusted focused movement, not a player operation; headline replay uses only legal setup/actions. */
function depart(s: GameState, id: CardInstanceId, destination: "HAND" | "TRASH" | "REMOVED") {
    const m = new TurnMutation(s, context); unwrap(processDeparture(m, id, destination, destination === "TRASH" ? [id, ...s.objects.cards[id].attachments] : undefined)); return unwrap(validateState(m.state, context));
}
function replaceCard(s: GameState, id: CardInstanceId, cardId: string) { const d = GameStateSchema.parse(s), r = context.content.cards.find(c => c.id === cardId)!; d.objects.cards[id].cardId = r.id; d.objects.cards[id].revision = r.revision; return unwrap(validateState(d, context)); }

test("complete Mandibular capture retains zero power, exact text, RAM/cost/sellability and all five printings", () => {
    assert.equal(mandibular.rulesText, source.record.rules_text); assert.equal(mandibular.provenance.sourceHash, hashCanonical(source.record));
    assert.equal(mandibular.power, 0); assert.deepEqual(mandibular.ram, { YELLOW: 2 }); assert.deepEqual(mandibular.printedCost, { kind: "EDDIES", amount: 1 }); assert.equal(mandibular.sellProfile.allowed, true);
    assert.deepEqual(mandibular.tags, ["Cyberware"]); assert.deepEqual(mandibular.printings.map(p => p.id), source.record.printings.map(p => p.id)); assert.equal(mandibular.printings.length, 5);
    assert.equal(mandibular.printings.find(p => p.setCode === "mercdemodeck")!.collectorNumber, "005"); assert.equal(mandibular.revision, 1);
    assert.deepEqual(mandibular.mechanics.modifiers, [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST", keyword: "BLOCKER" }]); assert.deepEqual(mandibular.mechanics.abilities, []);
    assert.deepEqual(source.matchingErrata, []); assert.equal(source.errataSha256, rules.errataSha256);
    for (const id of ["3.18.1.2.2.1", "3.18.3", "4.2.1", "4.10.2", "4.10.3", "4.11.3.1", "4.12.1", "9.9", "11.3.1.2", "11.24.1"]) assert.ok(rules.rules.some(r => r.id === id), id);
});
test("complete-shape admission rejects dropped or extra power, keyword, trigger, scope and provenance", () => {
    const variants = [
        { ...mandibular, power: undefined }, { ...mandibular, power: 2 }, { ...mandibular, printedCost: { kind: "EDDIES", amount: 2 } },
        { ...mandibular, provenance: { ...mandibular.provenance, reviewed: false } }, { ...mandibular, execution: { scope: "GEAR_CAPABILITIES_V1", status: "UNSUPPORTED" } },
        ...[[], [mandibular.mechanics.modifiers[0]], [mandibular.mechanics.modifiers[1]], [...mandibular.mechanics.modifiers, mandibular.mechanics.modifiers[1]]].map(modifiers => ({ ...mandibular, mechanics: { ...mandibular.mechanics, modifiers } })),
        { ...mandibular, mechanics: { ...mandibular.mechanics, keywords: ["BLOCKER"] } },
        { ...mandibular, mechanics: { ...mandibular.mechanics, equip: undefined } },
        { ...mandibular, mechanics: { ...mandibular.mechanics, restrictions: [{ kind: "CANNOT_ATTACK" }] } },
        { ...mandibular, mechanics: { ...mandibular.mechanics, abilities: [{ id: "extra", trigger: "WHEN_PLAYED", conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "DRAW", count: 1 }] }] } }
    ];
    for (const v of variants) assert.equal(supportsCapabilityGear(CardRevisionSnapshotSchema.parse(v), context).ok, false);
    assert.equal(CardRevisionSnapshotSchema.safeParse({ ...mandibular, mechanics: { ...mandibular.mechanics, modifiers: [{ kind: "GRANT_KEYWORD_TO_HOST", keyword: "QUICK" }] } }).success, false);
});
test("older scopes/policies reject inherited metadata even on a hidden hand/deck source", () => {
    for (const scope of ["NONCOMBAT_PLAY_V1", "COMBAT_REACT_V1", "COMBAT_RESTRICTIONS_V1", "COMBAT_TRIGGERS_V1"] as const) {
        const c = CardRevisionSnapshotSchema.parse({ ...mandibular, execution: { scope, status: "SUPPORTED" } }); assert.equal(supportsGear(c, context).ok, false);
        const ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.map(r => r.id === c.id ? c : r), context.content.manifest.engine) };
        assert.equal(createGameWithEvents(capabilitiesInput("old-scope"), ctx).ok, false);
    }
    const { gearCapabilities, ...turnSlice } = context.content.ruleset.gameplay!.turnSlice!; void gearCapabilities;
    const ctx = { content: createContentBundle(RulesetSchema.parse({ ...context.content.ruleset, gameplay: { ...context.content.ruleset.gameplay, turnSlice } }), context.content.cards, context.content.manifest.engine) };
    assert.equal(createGameWithEvents(capabilitiesInput("old-policy"), ctx).ok, false);
});
test("legal replay grants Blocker only after equip and keeps the host action/source identities distinct", () => {
    const equip = replay.steps.findIndex(s => s.events.some(e => e.payload.kind === "GEAR_ATTACHED")); assert.ok(equip >= 0);
    assert.deepEqual(new RulesView(states[equip], context).getEffectiveKeywords(hostId), []);
    const view = new RulesView(states[equip + 1], context); assert.deepEqual(view.getEffectiveKeywords(hostId), ["BLOCKER"]); assert.deepEqual(view.getKeywords(hostId), ["BLOCKER"]);
    assert.equal(view.getEffectivePower(hostId), 6); assert.deepEqual(view.getCapabilitySources(hostId, "BLOCKER"), [{ sourceId: gearId, subjectId: hostId, controllerId: defender, source: { cardId: mandibular.id, revision: 1 }, origin: "EQUIPPED_HOST" }]);
    assert.deepEqual(view.getEffectiveKeywords(gearId), []); assert.deepEqual(context.content.cards.find(c => c.id === PSYCHO)!.mechanics.keywords, []);
    assert.equal("keywords" in react.objects.cards[hostId], false); assert.ok(legal(react).some(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === hostId));
    assert.equal(legal(react).some(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === gearId), false);
});
test("printed Bombus and inherited Psycho use the same host spend/redirection event pipeline", () => {
    for (const s of [withHost(BOMBUS, 0), react]) {
        const r = act(s, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === hostId);
        assert.equal(r.state.objects.cards[hostId].readiness, "SPENT"); const combat = r.state.timing.combat; assert.ok("target" in combat); assert.deepEqual(combat.target, { kind: "CARD", cardInstanceId: hostId });
        assert.deepEqual(r.events.map(e => e.payload.kind), replay.steps[blockIndex].events.map(e => e.payload.kind));
        assert.deepEqual(r.events.map(e => e.payload), replay.steps[blockIndex].events.map(e => e.payload));
        assert.equal(new RulesView(r.state, context).isBlockerEligible(defender, hostId), false);
    }
});
test("Lag forbids attack while inherited Blocker still spends and redirects", () => {
    const d = GameStateSchema.parse(react); d.objects.cards[hostId].statuses = ["LAG"]; const s = unwrap(validateState(d, context));
    assert.equal(attackSourceValid(s, defender, hostId, context), false); assert.equal(new RulesView(s, context).isBlockerEligible(defender, hostId), true);
    const withoutLag = GameStateSchema.parse(s); withoutLag.objects.cards[hostId].statuses = []; assert.equal(attackSourceValid(withoutLag, defender, hostId, context), true);
    assert.equal(act(s, a => a.action.kind === "DECLARE_BLOCKER").state.objects.cards[hostId].readiness, "SPENT");
});
test("Corpo cannot attack, but its printed and inherited Blocker sources coexist", () => {
    const s = withHost(CORPO), view = new RulesView(s, context);
    assert.equal(attackSourceValid(s, defender, hostId, context), false); assert.equal(view.isBlockerEligible(defender, hostId), true);
    assert.equal(view.getCapabilitySources(hostId, "BLOCKER").length, 2); assert.deepEqual(view.getEffectiveKeywords(hostId), ["BLOCKER"]);
    assert.equal(legal(s).filter(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === hostId).length, 1);
    const removed = depart(s, gearId, "HAND"); assert.equal(new RulesView(removed, context).isBlockerEligible(defender, hostId), true); // Printed source remains.
});
test("Flathead suppresses printed and inherited Blocker without closing CALL/Quick/PASS", () => {
    assert.ok("attackerId" in react.timing.combat); const attackingId = react.timing.combat.attackerId;
    for (const base of [react, withHost(CORPO)]) {
        const d = GameStateSchema.parse(replaceCard(base, attackingId, FLATHEAD));
        for (const g of Object.values(d.objects.gigs)) if (g.roll.kind === "ROLLED") g.roll.currentValue = g.controllerId === attacker ? 1 : Number(g.dieType.slice(1));
        const s = unwrap(validateState(d, context)); assert.equal(new RulesView(s, context).canBeBlocked(attackingId), false);
        const actions = legal(s); assert.equal(actions.some(a => a.action.kind === "DECLARE_BLOCKER"), false);
        for (const kind of ["CALL_LEGEND", "PLAY_CARD", "PASS_REACT"]) assert.ok(actions.some(a => a.action.kind === kind));
        for (const g of Object.values(d.objects.gigs)) if (g.roll.kind === "ROLLED") g.roll.currentValue = g.controllerId === attacker ? Number(g.dieType.slice(1)) : 1;
        assert.equal(new RulesView(unwrap(validateState(d, context)), context).isBlockerEligible(defender, hostId), true);
    }
});
test("multiple Mandibular sources are canonical and produce one equivalent host action", () => {
    const s = withHost(PSYCHO, 2), view = new RulesView(s, context); const sources = view.getCapabilitySources(hostId, "BLOCKER");
    assert.equal(sources.length, 2); assert.deepEqual(sources.map(s => s.sourceId), [...sources.map(s => s.sourceId)].sort());
    assert.deepEqual(view.getEffectiveKeywords(hostId), ["BLOCKER"]); assert.equal(legal(s).filter(a => a.action.kind === "DECLARE_BLOCKER").length, 1);
    const d = GameStateSchema.parse(s); d.objects.cards[hostId].attachments.reverse(); d.objects.cards = Object.fromEntries(Object.entries(d.objects.cards).reverse());
    assert.deepEqual(new RulesView(d, context).getEffectiveCapabilities(hostId), view.getEffectiveCapabilities(hostId));
    const oneLeft = depart(s, sources[0].sourceId, "HAND"); assert.equal(new RulesView(oneLeft, context).isBlockerEligible(defender, hostId), true);
    const none = depart(oneLeft, sources[1].sourceId, "HAND"); assert.equal(new RulesView(none, context).isBlockerEligible(defender, hostId), false);
    assert.deepEqual(none.resolution, s.resolution);
});
for (const destination of ["HAND", "TRASH", "REMOVED"] as const) test(`Gear departure to ${destination} removes inherited permission immediately`, () => {
    const s = depart(react, gearId, destination), view = new RulesView(s, context);
    assert.deepEqual(view.getEffectiveKeywords(hostId), []); assert.equal(view.isBlockerEligible(defender, hostId), false); assert.equal(legal(s).some(a => a.action.kind === "DECLARE_BLOCKER"), false);
    assert.equal(s.objects.cards[gearId].zone.zone, destination); assert.deepEqual(s.objects.cards[hostId].attachments, []);
    assert.notEqual(hashPosition(s), hashPosition(react));
});
test("public trusted MAIN movement removes the grant and replaying the Gear restores it only after re-equip", () => {
    const s = replay.finalState, moved = unwrap(moveCardForEffect(s, gearId, "HAND", context)); assert.deepEqual(new RulesView(moved.state, context).getEffectiveKeywords(hostId), []);
    const m = new TurnMutation(moved.state, context); unwrap(attachPlayedGear(m, gearId, hostId)); assert.deepEqual(new RulesView(unwrap(validateState(m.state, context)), context).getEffectiveKeywords(hostId), ["BLOCKER"]);
});
for (const destination of ["HAND", "TRASH", "REMOVED"] as const) test(`host departure to ${destination} follows existing Gear movement without cached capability`, () => {
    const s = depart(react, hostId, destination); assert.equal(s.objects.cards[gearId].zone.zone, destination); assert.deepEqual(s.objects.cards[hostId].attachments, []);
    assert.deepEqual(new RulesView(s, context).getEffectiveKeywords(hostId), []); assert.equal(legal(s).some(a => a.action.kind === "DECLARE_BLOCKER"), false);
});
test("face-up Legends-area host inherits text but cannot perform Unit-only Blocker; hidden/rival hosts are illegal equip targets", () => {
    const m = new TurnMutation(react, context); unwrap(processDeparture(m, gearId, "HAND"));
    const legend = m.state.players[defender].zones.LEGENDS[0]; m.state.objects.cards[legend].face = "UP";
    const before = new RulesView(unwrap(validateState(m.state, context)), context); assert.ok(before.getLegalTargets(gearId, { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }).some(id => id === legend));
    for (const id of m.state.players[attacker].zones.LEGENDS) assert.equal(before.getLegalTargets(gearId, { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }).some(target => target === id), false);
    for (const id of m.state.players[defender].zones.LEGENDS.filter(id => id !== legend)) assert.equal(before.getLegalTargets(gearId, { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }).some(target => target === id), false);
    unwrap(attachPlayedGear(m, gearId, legend)); const s = unwrap(validateState(m.state, context)), view = new RulesView(s, context);
    assert.deepEqual(view.getEffectiveKeywords(legend), ["BLOCKER"]); assert.deepEqual(view.getEffectiveCardTypes(legend), ["LEGEND"]); assert.equal(view.isBlockerEligible(defender, legend), false);
    assert.equal(legal(s).some(a => a.action.kind === "DECLARE_BLOCKER"), false); assert.equal(view.getEffectivePower(legend), null);
    const moved = depart(s, legend, "TRASH"); assert.equal(moved.objects.cards[legend].zone.zone, "REMOVED"); assert.equal(moved.objects.cards[gearId].zone.zone, "TRASH"); assert.deepEqual(new RulesView(moved, context).getCapabilitySources(legend, "BLOCKER"), []);
});
test("Mandibular, Satori and Mantis compose power, independent inherited trigger and Blocker through one host", () => {
    const m = new TurnMutation(react, context);
    for (const id of [SATORI, MANTIS]) { const g = Object.values(m.state.objects.cards).find(c => c.cardId === id && c.controllerId === defender)!; if (g.zone.zone !== "HAND") moveCardLocation(m, g.id, "HAND"); unwrap(attachPlayedGear(m, g.id, hostId)); }
    const s = unwrap(validateState(m.state, context)), view = new RulesView(s, context); assert.equal(view.getEffectivePower(hostId), 10); assert.equal(view.getApplicableCharacteristicModifiers(hostId).length, 3);
    assert.deepEqual(view.getEffectiveKeywords(hostId), ["BLOCKER"]); assert.equal(view.getEffectiveTriggeredAbilities(hostId).filter(b => b.kind === "WHEN_FIGHT_WON").length, 1);
    const block = act(s, a => a.action.kind === "DECLARE_BLOCKER"), passed = act(block.state, a => a.action.kind === "PASS_REACT"); const events = [...passed.events, ...finish(passed.state).events];
    assert.ok(events.some(e => e.payload.kind === "FIGHT_RESULT" && e.payload.defenderPower === 10 && e.payload.winnerId === hostId));
    assert.ok(events.some(e => e.payload.kind === "EFFECT_PENDING" && s.objects.cards[e.payload.sourceId].cardId === SATORI));
});
test("Royce counts zero-power Mandibular as one Gear while capability does not alter type", () => {
    const m = new TurnMutation(react, context), legend = m.state.players[attacker].zones.LEGENDS[0], r = context.content.cards.find(c => c.id === ROYCE)!;
    m.state.objects.cards[legend] = { ...m.state.objects.cards[legend], cardId: r.id, revision: r.revision, face: "UP" };
    const g = Object.values(m.state.objects.cards).find(c => c.cardId === MANDIBULAR && c.controllerId === attacker)!; moveCardLocation(m, g.id, "HAND"); unwrap(attachPlayedGear(m, g.id, legend));
    const view = new RulesView(unwrap(validateState(m.state, context)), context); assert.equal(view.getEffectivePower(legend), 8); assert.deepEqual(view.getEffectiveKeywords(legend), ["BLOCKER", "GO_SOLO"]); assert.equal(view.isUnitForGameplay(legend), false);
});
test("ready/actor/area constraints and stale action IDs still fail atomically", () => {
    const action = legal(react).find(a => a.action.kind === "DECLARE_BLOCKER")!, before = hashReplayState(react);
    assert.equal(applyAction(react, { actorId: attacker, action: action.action }, context).ok, false);
    assert.equal(applyAction(react, { actorId: defender, action: { kind: "DECLARE_BLOCKER", cardInstanceId: gearId } }, context).ok, false);
    assert.equal(resolveActionId(afterBlock, defender, action.actionId, context).ok, false);
    const noGear = depart(react, gearId, "HAND"); assert.equal(resolveActionId(noGear, defender, action.actionId, context).ok, false);
    const spent = GameStateSchema.parse(react); spent.objects.cards[hostId].readiness = "SPENT"; assert.equal(new RulesView(spent, context).isBlockerEligible(defender, hostId), false);
    assert.equal(hashReplayState(react), before);
});
test("invalid source revision, illegal host/controller, duplicate attachment and cached keyword arrays are rejected", () => {
    const mutations = [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[gearId].revision++; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[gearId].controllerId = attacker; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[gearId].face = "DOWN"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[hostId].attachments.push(gearId); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[gearId].attachments.push(hostId); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { Object.assign(s.objects.cards[hostId], { keywords: ["BLOCKER"] }); }
    ];
    for (const mutate of mutations) { const d = GameStateSchema.parse(react); mutate(d); assert.equal(validateState(d, context).ok, false); }
});
test("public observation shows Gear/host/effective keyword without hidden hands or duplicated internal sources", () => {
    for (const actor of [attacker, defender]) {
        const observation = unwrap(observe(react, actor, context)), cards = observation.players.flatMap(p => p.cards), host = cards.find(c => c.publicId === hostId)!;
        assert.deepEqual(host.effectiveKeywords, ["BLOCKER"]); assert.deepEqual(host.attachments, [gearId]); assert.ok(cards.some(c => c.publicId === gearId && c.content?.cardId === MANDIBULAR));
        assert.equal(JSON.stringify(observation).includes('"EQUIPPED_HOST"'), false);
    }
    assert.deepEqual(unwrap(listLegalActions(react, attacker, context)), []);
    const position = unwrap(generatePosition(react, defender, context, "inherited-blocker")), input = JSON.stringify(modelInput(position));
    for (const kind of ["DECLARE_BLOCKER", "CALL_LEGEND", "PLAY_CARD", "PASS_REACT"]) assert.ok(position.legalActions.some(a => a.action.kind === kind));
    assert.equal(input.includes(react.rng.seed), false); for (const id of react.players[attacker].zones.HAND) assert.equal(input.includes(id), false);
    assert.ok(replay.positions.every(p => p.legalActions.length > 1));
});
test("derived capability adds no redundant state and transport counters do not alter POSITION_V2/action IDs", () => {
    const d = GameStateSchema.parse(react); d.match.version = GameStateVersionSchema.parse(d.match.version + 10); d.match.eventSequence = GameEventSequenceSchema.parse(d.match.eventSequence + 50);
    assert.equal(hashPosition(d), hashPosition(react)); assert.notEqual(hashReplayState(d), hashReplayState(react)); assert.deepEqual(legal(d).map(a => a.actionId), legal(react).map(a => a.actionId));
    assert.equal(hashPosition(JSON.parse(canonicalSerialize(react))), hashPosition(react)); assert.equal("capabilities" in d, false);
});
test("constructed/deck support remains separate from exact demos and unreviewed future Gear", () => {
    const input = capabilitiesInput("short-demo"); input.decks = input.decks.map(d => ({ ...d, main: d.main.slice(0, 27) })); assert.equal(createGameWithEvents(input, context).ok, false);
    assert.deepEqual(context.content.ruleset.deckbuilding, { mainDeck: { min: 40, max: 50 }, legendCount: 3, maxCopies: 3 });
    for (const id of ["kiroshi-optics", "dying-night-v-s-pistol"]) assert.equal(context.content.cards.some(c => c.id === id), false);
});
test("Mandibular golden traverses wire v1 action IDs with exact events, hashes, attachment and final MAIN", () => {
    assert.deepEqual(JSON.parse(readFileSync("tests/fixtures/mandibular-replay.v1.json", "utf8")), replay); let state = replay.initialized.state;
    for (const step of replay.steps) {
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: replay.content, state, actorId: step.actorId, actionId: step.actionId }); assert.ok(response.ok, JSON.stringify(response));
        if (!response.ok || response.value.kind !== "transition") throw new Error("Expected transition"); assert.deepEqual(response.value.events, step.events); assert.equal(response.value.stateHash, step.stateHash); state = response.value.state;
    }
    assert.deepEqual(state, replay.finalState); assert.equal(state.timing.window, "MAIN"); assert.equal(state.timing.combat.stage, "NONE"); assert.equal(state.objects.cards[gearId].zone.zone, "BATTLEFIELD"); assert.ok(state.objects.cards[hostId].attachments.includes(gearId));
});
