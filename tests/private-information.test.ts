import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameActionSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, canonicalSerialize, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, listLegalActions, moveCardForEffect, observe, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { privateContext, privateInput, kiroshi, KIROSHI } from "./private-information-fixture";
import { kiroshiReplay } from "./private-information-replay";
import { MANTIS } from "./gear-fixture";
import { SATORI, DEXTER } from "./combat-triggers-fixture";
import { SWORDWISE } from "./combat-fixture";
import { FLOOR_IT } from "./react-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, attachPlayedGear } from "../packages/engine/src/card-movement";
import { grantLegendKnowledge, privateLookTargets } from "../packages/engine/src/private-knowledge";
import { supportsPrivateLookGear } from "../packages/engine/src/private-look-support";
import { supportsGear } from "../packages/engine/src/attachments";
import { unwrap } from "./turn-replay";
import source from "./fixtures/private-information-card-source.v1.json";
import rules from "./fixtures/private-information-rules.v1.json";
const context = privateContext(), replay = kiroshiReplay();
const states: GameState[] = [replay.initialized.state]; for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const attackIndex = replay.steps.findIndex(s => s.action.action.kind === "DECLARE_ATTACK");
const beforeAttack = states[attackIndex], pending = states[attackIndex + 1], afterLook = states[attackIndex + 2];
const attack = replay.steps[attackIndex].action.action; assert.ok(attack.kind === "DECLARE_ATTACK"); const hostId = attack.cardInstanceId;
const viewer = beforeAttack.timing.activePlayer, rival = beforeAttack.match.playerOrder.find(id => id !== viewer)!, gearId = beforeAttack.objects.cards[hostId].attachments[0];
const learnedId = replay.learned.cardInstanceId;
const legal = (s: GameState) => unwrap(listLegalActions(s, s.timing.actingPlayer, context));
function act(s: GameState, predicate: (a: LegalAction) => boolean) { const a = legal(s).find(predicate); assert.ok(a, `action at ${s.timing.step}`); return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, context)); }
function choose(s: GameState, index = 0) { return act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
function finish(s: GameState) { const events = []; while (s.resolution.choice) { const next = choose(s); s = next.state; events.push(...next.events); } return { state: s, events }; }
function look(s: GameState, slot = 0) { return act(s, a => a.action.kind === "CHOOSE" && (() => { const o = s.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "LEGEND_SLOT" && o.slot === slot; })()); }
/** Explicit trusted focused fixture operations; headline uses only player actions. */
function attach(m: TurnMutation, card: string) {
    const g = Object.values(m.state.objects.cards).find(c => c.controllerId === viewer && c.cardId === card && !m.state.objects.cards[hostId].attachments.includes(c.id))!;
    if (g.zone.zone !== "HAND") moveCardLocation(m, g.id, "HAND"); unwrap(attachPlayedGear(m, g.id, hostId)); return g.id;
}
function alteredHost(card: string, extra: string[] = []) {
    const m = new TurnMutation(beforeAttack, context), r = context.content.cards.find(c => c.id === card)!;
    m.state.objects.cards[hostId].cardId = r.id; m.state.objects.cards[hostId].revision = r.revision;
    for (const g of extra) attach(m, g);
    return unwrap(validateState(m.state, context));
}
function start(s: GameState) { return act(s, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === hostId); }
function hiddenSwap(s: GameState, withKnowledge = false) {
    const d = GameStateSchema.parse(s), [a,b] = d.players[viewer].zones.LEGENDS;
    [d.objects.cards[a].cardId, d.objects.cards[b].cardId] = [d.objects.cards[b].cardId, d.objects.cards[a].cardId];
    [d.objects.cards[a].revision, d.objects.cards[b].revision] = [d.objects.cards[b].revision, d.objects.cards[a].revision];
    if (withKnowledge) for (const k of d.privateKnowledge ?? []) k.content = { cardId: d.objects.cards[k.cardInstanceId].cardId, revision: d.objects.cards[k.cardInstanceId].revision };
    return unwrap(validateState(d, context));
}

test("Kiroshi complete capture pins exact text, five printings, four errata and all executable characteristics", () => {
    assert.equal(kiroshi.rulesText, source.record.rules_text); assert.equal(kiroshi.provenance.sourceHash, hashCanonical(source.record));
    assert.equal(kiroshi.power, 1); assert.deepEqual(kiroshi.colors, ["YELLOW"]); assert.deepEqual(kiroshi.ram, { YELLOW: 1 }); assert.deepEqual(kiroshi.printedCost, { kind: "EDDIES", amount: 1 }); assert.equal(kiroshi.sellProfile.allowed, true);
    assert.deepEqual(kiroshi.tags, ["Cyberware"]); assert.equal(kiroshi.printings.length, 5); assert.deepEqual(kiroshi.printings.map(p => p.id), source.record.printings.map(p => p.id));
    assert.equal(kiroshi.printings.find(p => p.setCode === "mercdemodeck")!.collectorNumber, "004"); assert.equal(source.errata.length, 4); assert.equal(kiroshi.provenance.errata.length, 1);
    assert.equal(kiroshi.mechanics.abilities.length, 1); assert.deepEqual(kiroshi.mechanics.keywords, []);
    for (const id of ["4.11.3", "5.3.2.5", "5.7.4.1", "5.7.4.2", "5.7.4.3", "7.7.1", "10.7", "10.12", "10.16.2", "11.14.1", "11.21.2.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
});
test("private-look admission rejects partial/extra mechanics and unsupported scope/provenance", () => {
    const m = kiroshi.mechanics, a = m.abilities[0];
    const variants = [
        { ...kiroshi, power: 0 }, { ...kiroshi, printedCost: { kind: "EDDIES", amount: 2 } }, { ...kiroshi, provenance: { ...kiroshi.provenance, reviewed: false } },
        { ...kiroshi, execution: { scope: "GEAR_PRIVATE_LOOK_V1", status: "UNSUPPORTED" } },
        ...[{ ...m, equip: undefined }, { ...m, modifiers: [] }, { ...m, abilities: [] }, { ...m, abilities: [a,a] }, { ...m, keywords: ["BLOCKER"] }, { ...m, restrictions: [{ kind: "CANNOT_ATTACK" }] },
            ...[{ ...a, inherited: undefined }, { ...a, trigger: "WHEN_FIGHT_WON" }, { ...a, effects: [...a.effects, { kind: "DRAW", count: 1 }] }, { ...a, conditions: [{ kind: "STREET_CRED", minimum: 1 }] }].map(a => ({ ...m, abilities: [a] }))].map(mechanics => ({ ...kiroshi, mechanics }))
    ];
    for (const c of variants) assert.equal(supportsPrivateLookGear(CardRevisionSnapshotSchema.parse(c), context).ok, false);
});
test("older Gear scopes reject inherited private look even in hidden deck/hand metadata", () => {
    for (const scope of ["NONCOMBAT_PLAY_V1", "COMBAT_REACT_V1", "COMBAT_RESTRICTIONS_V1", "COMBAT_TRIGGERS_V1", "GEAR_CAPABILITIES_V1"] as const) {
        const c = CardRevisionSnapshotSchema.parse({ ...kiroshi, execution: { scope, status: "SUPPORTED" } }); assert.equal(supportsGear(c, context).ok, false);
        const ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.map(r => r.id === c.id ? c : r), context.content.manifest.engine) };
        assert.equal(createGameWithEvents(privateInput("old-scope"), ctx).ok, false);
    }
});
test("setup starts without knowledge and exposes only anonymous Legend slots", () => {
    for (const s of states.filter(s => s.setup)) {
        assert.equal(s.privateKnowledge, undefined);
        for (const actor of s.match.playerOrder) for (const p of unwrap(observe(s, actor, context)).players) for (const c of p.cards.filter(c => c.zone === "LEGENDS")) {
            assert.equal(c.content, undefined); assert.equal(c.rememberedContent, undefined); assert.equal(c.knownToSeats, undefined);
        }
    }
});
test("legal Gear play pays cost and attaches the same physical source before power/trigger inheritance", () => {
    const index = replay.steps.findIndex(s => s.events.some(e => e.payload.kind === "GEAR_ATTACHED"));
    assert.ok(index > 0); assert.equal(states[index].objects.cards[gearId].zone.zone, "HAND");
    const equipped = states[index + 1]; assert.ok(equipped.objects.cards[hostId].attachments.includes(gearId));
    assert.equal(new RulesView(equipped, context).getEffectivePower(hostId), 7); // Psycho 6 + Gear 1.
    assert.equal(new RulesView(states[index], context).getEffectivePower(hostId), 6);
    const binding = new RulesView(equipped, context).getEffectiveTriggeredAbilities(hostId).find(b => b.sourceId === gearId)!;
    assert.equal(binding.subjectId, hostId); assert.equal(binding.controllerId, viewer); assert.equal(binding.source.cardId, KIROSHI);
    assert.ok(replay.steps.slice(0,index).some(s => s.events.some(e => e.payload.kind === "PAYMENT_MADE")));
});
test("attack spends host and schedules private look before any React action", () => {
    assert.equal(pending.timing.step, "TARGET_SELECTION"); assert.equal(pending.timing.combat.stage, "TRIGGER_RESOLUTION");
    assert.equal(pending.objects.cards[hostId].readiness, "SPENT"); assert.equal(pending.resolution.current!.sourceId, gearId); assert.equal(pending.resolution.current!.trigger!.subjectId, hostId);
    assert.deepEqual(pending.resolution.choice!.options, [0,1,2].map(slot => ({ kind: "LEGEND_SLOT", slot })));
    assert.ok(legal(pending).every(a => a.action.kind === "CHOOSE" && /^Look at friendly face-down Legend slot [123]$/.test(a.descriptor.label)));
    assert.deepEqual(unwrap(listLegalActions(pending, rival, context)), []);
    assert.equal(applyAction(pending, { actorId: rival, action: { kind: "PASS_REACT" } }, context).ok, false);
});
test("look stores remembered identity and public known marker without flipping or moving Legend", () => {
    assert.deepEqual(afterLook.objects, pending.objects); assert.deepEqual(afterLook.players, pending.players);
    assert.equal(afterLook.objects.cards[learnedId].face, "DOWN"); assert.equal(afterLook.objects.cards[learnedId].zone.zone, "LEGENDS");
    assert.deepEqual(afterLook.privateKnowledge, [replay.learned]); assert.equal(afterLook.timing.step, "RIVAL_REACT");
    const ours = unwrap(observe(afterLook, viewer, context)).players[0].cards.find(c => c.publicId === "seat:0:LEGENDS:0")!;
    const theirs = unwrap(observe(afterLook, rival, context)).players[0].cards.find(c => c.publicId === ours.publicId)!;
    assert.deepEqual(ours.rememberedContent, replay.learned.content); assert.equal(ours.content, undefined); assert.deepEqual(ours.knownToSeats, [0]);
    assert.deepEqual(theirs.knownToSeats, [0]); assert.equal(theirs.content, undefined); assert.equal(theirs.rememberedContent, undefined);
});
test("look public event and opponent model input contain no hidden identity or physical Legend ID", () => {
    const batch = replay.steps[attackIndex + 1].events;
    assert.deepEqual(batch.find(e => e.payload.kind === "LEGEND_LOOKED_AT")!.payload, { kind: "LEGEND_LOOKED_AT", viewerId: viewer, legendSeat: 0, slot: 0 });
    assert.equal(batch.some(e => e.payload.kind === "CARD_REVEALED" || e.payload.kind === "LEGEND_CALLED"), false);
    const out = JSON.stringify({ events: batch, prompt: modelInput(unwrap(generatePosition(afterLook, rival, context, "rival"))) });
    for (const secret of [learnedId, replay.learned.content.cardId, context.content.cards.find(c => c.id === replay.learned.content.cardId)!.displayName]) assert.equal(out.includes(secret), false, secret);
});
test("pre-look observations, choices and action IDs do not depend on unlearned hidden identities", () => {
    for (const s of [beforeAttack, pending]) {
        const swapped = hiddenSwap(s);
        assert.notEqual(hashPosition(s), hashPosition(swapped)); assert.deepEqual(unwrap(observe(s, viewer, context)), unwrap(observe(swapped, viewer, context)));
        assert.deepEqual(legal(s), legal(swapped));
    }
});
test("private knowledge affects replay/position/viewer hashes; public marker is the only opponent change", () => {
    const bare = GameStateSchema.parse(replay.afterCombat); delete bare.privateKnowledge; const noKnowledge = unwrap(validateState(bare, context));
    assert.notEqual(hashReplayState(noKnowledge), hashReplayState(replay.afterCombat)); assert.notEqual(hashPosition(noKnowledge), hashPosition(replay.afterCombat));
    assert.notEqual(hashObservation(unwrap(observe(noKnowledge, viewer, context))), hashObservation(unwrap(observe(replay.afterCombat, viewer, context))));
    const withMarker = unwrap(observe(replay.afterCombat, rival, context)), withoutMarker = unwrap(observe(noKnowledge, rival, context));
    // 5.7.4.2 requires this public difference: hiding the marker to keep hashes equal would violate the rule.
    assert.notEqual(hashObservation(withMarker), hashObservation(withoutMarker));
    const stripMarkers = (o: typeof withMarker) => ({ ...o, players: o.players.map(p => ({ ...p, cards: p.cards.map(({ knownToSeats, ...c }) => { void knownToSeats; return c; }) })) });
    assert.deepEqual(stripMarkers(withMarker), withoutMarker);
});
test("changing only remembered hidden identity leaves the opponent observation hash unchanged", () => {
    const swapped = hiddenSwap(replay.afterCombat, true);
    assert.notEqual(hashObservation(unwrap(observe(swapped, viewer, context))), hashObservation(unwrap(observe(replay.afterCombat, viewer, context))));
    assert.equal(hashObservation(unwrap(observe(swapped, rival, context))), hashObservation(unwrap(observe(replay.afterCombat, rival, context))));
    assert.notEqual(hashPosition(swapped), hashPosition(replay.afterCombat));
});
test("post-look TrainingPosition carries memory in observation only; no raw knowledge/event/state in model input", () => {
    const p = unwrap(generatePosition(replay.afterCombat, viewer, context, "known")), input = modelInput(p);
    assert.ok(input.observation.players[0].cards.some(c => c.rememberedContent?.cardId === replay.learned.content.cardId));
    assert.deepEqual(Object.keys(input).sort(), ["legalActions", "observation"]); assert.equal(JSON.stringify(input).includes('"privateKnowledge"'), false);
    assert.ok(validateTrainingPosition(p, context).ok);
    const bare = GameStateSchema.parse(replay.afterCombat); delete bare.privateKnowledge;
    const other = unwrap(generatePosition(bare, viewer, context, "unknown")); assert.notEqual(p.positionHash, other.positionHash); assert.notDeepEqual(input.legalActions, modelInput(other).legalActions);
});
test("CALL after private look reveals the matching immutable Legend to both players and removes redundant memory", () => {
    assert.equal(replay.finalState.objects.cards[learnedId].face, "UP"); assert.equal(replay.finalState.privateKnowledge, undefined);
    for (const actor of [viewer, rival]) {
        const c = unwrap(observe(replay.finalState, actor, context)).players[0].cards.find(c => c.publicId === learnedId)!;
        assert.deepEqual(c.content, replay.learned.content); assert.equal(c.rememberedContent, undefined); assert.equal(c.knownToSeats, undefined);
    }
});
test("a second legal look at the same slot resolves independently without duplicate memory", () => {
    const m = new TurnMutation(pending, context); unwrap(grantLegendKnowledge(m, viewer, 0));
    const s = unwrap(validateState(m.state, context)), next = look(s);
    assert.equal(next.state.privateKnowledge!.length, 1); assert.equal(next.events.filter(e => e.payload.kind === "LEGEND_LOOKED_AT").length, 1);
});
test("zero hidden targets skip look, one target is forced, and multiple targets create a real choice", () => {
    for (const count of [0,1,2,3]) {
        const d = GameStateSchema.parse(beforeAttack); for (const [i,id] of d.players[viewer].zones.LEGENDS.entries()) if (i >= count) d.objects.cards[id].face = "UP";
        const next = start(unwrap(validateState(d, context)));
        assert.equal(next.state.timing.step, count > 1 ? "TARGET_SELECTION" : "RIVAL_REACT");
        assert.equal(next.events.filter(e => e.payload.kind === "LEGEND_LOOKED_AT").length, count === 1 ? 1 : 0);
        assert.equal(next.state.resolution.choice?.options.length ?? 0, count > 1 ? count : 0);
        assert.equal(next.events.some(e => e.payload.kind === "PHASE_CHANGED" && e.payload.step === "TARGET_SELECTION"), count > 1);
    }
});
test("look selector rejects face-up, rival, field, non-Legend and invalid slots", () => {
    for (const kind of ["FACE_UP", "RIVAL", "FIELD", "NON_LEGEND"] as const) {
        const m = new TurnMutation(pending, context), c = m.state.objects.cards[m.state.players[viewer].zones.LEGENDS[0]];
        if (kind === "FACE_UP") c.face = "UP"; if (kind === "RIVAL") c.controllerId = rival; if (kind === "FIELD") c.zone.zone = "BATTLEFIELD";
        if (kind === "NON_LEGEND") { c.cardId = kiroshi.id; c.revision = kiroshi.revision; }
        assert.equal(privateLookTargets(m.state, viewer, context).includes(0), false); assert.equal(grantLegendKnowledge(m, viewer, 0).ok, false);
    }
    for (const slot of [-1,3,999,0.5]) assert.equal(grantLegendKnowledge(new TurnMutation(pending, context), viewer, slot).ok, false);
    const d = GameStateSchema.parse(pending); d.resolution.choice!.options[0] = { kind: "LEGEND_SLOT", slot: 99 }; assert.equal(validateState(d, context).ok, false);
});
test("knowledge survives turn change and tracked physical separation, never jumping to another slot's identity", () => {
    const afterTurn = act(replay.afterCombat, a => a.action.kind === "END_TURN").state;
    assert.deepEqual(afterTurn.privateKnowledge, replay.afterCombat.privateKnowledge);
    // 5.7.4.2 explicitly allows separating the marked physical Legend from unknown Legends.
    const d = GameStateSchema.parse(replay.afterCombat), zone = d.players[viewer].zones.LEGENDS;
    zone.push(zone.shift()!); const reordered = unwrap(validateState(d, context));
    assert.deepEqual(reordered.privateKnowledge, replay.afterCombat.privateKnowledge);
    const observed = unwrap(observe(reordered, viewer, context));
    assert.deepEqual(observed.players[0].cards.find(c => c.publicId === "seat:0:LEGENDS:2")!.rememberedContent, replay.learned.content);
    assert.equal(observed.players[0].cards.find(c => c.publicId === "seat:0:LEGENDS:0")!.rememberedContent, undefined);
});
test("Legend departure invalidates private knowledge through the shared movement lifecycle", () => {
    const next = unwrap(moveCardForEffect(replay.afterCombat, learnedId, "REMOVED", context));
    assert.equal(next.state.privateKnowledge, undefined); assert.equal(next.state.objects.cards[learnedId].zone.zone, "REMOVED"); assert.ok(validateState(next.state, context).ok);
});
test("knowledge validator rejects orphan viewer/object, stale revision, revealed/moved targets and duplicate/unsorted records", () => {
    const mutations: ((d: ReturnType<typeof GameStateSchema.parse>) => void)[] = [
        d => { d.privateKnowledge![0].viewerId = rival; }, d => { d.privateKnowledge![0].cardInstanceId = hostId; },
        d => { d.privateKnowledge![0].content = { cardId: kiroshi.id, revision: kiroshi.revision }; },
        d => { d.objects.cards[learnedId].face = "UP"; }, d => { d.privateKnowledge!.push(d.privateKnowledge![0]); }
    ];
    for (const mutate of mutations) { const d = GameStateSchema.parse(replay.afterCombat); mutate(d); assert.equal(validateState(d, context).ok, false); }
    const m = new TurnMutation(replay.afterCombat, context); unwrap(grantLegendKnowledge(m, viewer, 1)); m.state.privateKnowledge!.reverse(); assert.equal(validateState(m.state, context).ok, false);
    const orphan = JSON.parse(JSON.stringify(replay.afterCombat)); orphan.privateKnowledge[0].viewerId = randomUUID(); assert.equal(validateState(orphan, context).ok, false);
    orphan.privateKnowledge[0].viewerId = viewer; orphan.privateKnowledge[0].cardInstanceId = 'missing-legend'; assert.equal(validateState(orphan, context).ok, false);
    const setup = GameStateSchema.parse(replay.initialized.state); setup.privateKnowledge = GameStateSchema.parse(replay.afterCombat).privateKnowledge; assert.equal(validateState(setup, context).ok, false);
});
test("multiple Kiroshi schedule independent sources, preserve target continuation and finish both before React", () => {
    const s = alteredHost(beforeAttack.objects.cards[hostId].cardId, [KIROSHI]), begun = start(s);
    assert.equal(begun.state.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(begun.state.resolution.pending.length, 2);
    for (const order of [0,1]) {
        const first = choose(begun.state, order); assert.equal(first.state.timing.step, "TARGET_SELECTION");
        const next = look(first.state, 0); assert.equal(next.state.timing.step, "TARGET_SELECTION"); assert.equal(next.state.resolution.triggerContinuation!.origin.kind, "ATTACK");
        assert.notEqual(first.state.resolution.current!.sourceId, next.state.resolution.current!.sourceId);
        const last = look(next.state, 1); assert.equal(last.state.timing.step, "RIVAL_REACT"); assert.equal(last.state.privateKnowledge!.length, 2);
        const events = [...begun.events,...first.events,...next.events,...last.events]; assert.equal(events.filter(e => e.payload.kind === "LEGEND_LOOKED_AT").length, 2);
    }
});
test("older printed Swordwise ATTACK and inherited look share controller-selected order with current host power", () => {
    const s = alteredHost(SWORDWISE, [MANTIS]), begun = start(s); assert.equal(begun.state.timing.step, "TRIGGER_ORDER_SELECTION");
    assert.equal(begun.state.resolution.pending.length, 2);
    for (const order of [0,1]) {
        let r = choose(begun.state, order); const events = [...r.events];
        if (r.state.timing.step === "TARGET_SELECTION") { r = look(r.state); events.push(...r.events); }
        assert.equal(r.state.timing.step, "RIVAL_REACT"); assert.equal(events.filter(e => e.payload.kind === "LEGEND_LOOKED_AT").length, 1);
        assert.equal(events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND").length, 1);
    }
});
test("Dexter printed ATTACK Gig choices and inherited look retain nested continuation in either order", () => {
    const begun = start(alteredHost(DEXTER)); assert.equal(begun.state.timing.step, "TRIGGER_ORDER_SELECTION");
    for (const index of [0,1]) { const resolved = finish(choose(begun.state,index).state); assert.equal(resolved.state.timing.step, "RIVAL_REACT"); assert.equal(resolved.state.privateKnowledge!.length,1); }
});
test("Kiroshi ATTACK and Satori fight-win trigger coexist at distinct timings", () => {
    const m = new TurnMutation(beforeAttack, context); attach(m, SATORI);
    const defender = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === SWORDWISE)!;
    moveCardLocation(m, defender.id, "BATTLEFIELD"); defender.readiness = "SPENT";
    let r = start(unwrap(validateState(m.state, context)));
    r = act(r.state, a => a.action.kind === "CHOOSE" && (() => { const o = r.state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === defender.id; })());
    assert.equal(r.state.resolution.current!.trigger!.source.cardId, KIROSHI); r = look(r.state);
    const hand = r.state.players[viewer].zones.HAND.length; const fight = act(r.state,a => a.action.kind === "PASS_REACT");
    assert.equal(fight.state.players[viewer].zones.HAND.length, hand + 1); assert.equal(fight.state.timing.step, "MAIN");
    const kinds = fight.events.map(e => e.payload.kind); assert.ok(kinds.indexOf("FIGHT_RESULT") < kinds.indexOf("EFFECT_PENDING")); assert.ok(fight.events.findIndex(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK") < kinds.indexOf("CARD_DEFEATED"));
    assert.deepEqual(fight.state.privateKnowledge, r.state.privateKnowledge);
});
test("Kiroshi, Mantis, Satori and a legally played rival Floor It compose via ordinary power queries", () => {
    const m = new TurnMutation(beforeAttack, context); attach(m, MANTIS); attach(m, SATORI);
    const floor = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === FLOOR_IT)!; moveCardLocation(m, floor.id, "HAND");
    const s = unwrap(validateState(m.state, context)); const base = context.content.cards.find(c => c.id === s.objects.cards[hostId].cardId)!.power!;
    const mantisPower = context.content.cards.find(c => c.id === MANTIS)!.power!; const total = base + 1 + mantisPower + 2;
    assert.equal(new RulesView(s, context).getEffectivePower(hostId), total);
    let r = look(start(s).state); r = act(r.state, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === floor.id);
    while (r.state.timing.step === "PAYMENT_SELECTION") r = choose(r.state);
    if (r.state.resolution.choice) r = choose(r.state);
    assert.equal(new RulesView(r.state, context).getEffectivePower(hostId), total - 1); assert.equal(r.state.timing.step, "RIVAL_REACT");
    assert.equal('kiroshiPowerBonus' in r.state, false);
});
test("unequipping Kiroshi removes future power/trigger inheritance without erasing existing memory", () => {
    const next = unwrap(moveCardForEffect(replay.afterCombat, gearId, "HAND", context));
    assert.equal(new RulesView(next.state, context).getEffectivePower(hostId), 6); assert.equal(new RulesView(next.state, context).getEffectiveTriggeredAbilities(hostId).some(b => b.sourceId === gearId), false);
    assert.deepEqual(next.state.privateKnowledge, replay.afterCombat.privateKnowledge);
});
test("transport UUID/version/event counter changes preserve knowledge position and observation/action identities", () => {
    const base = replay.afterCombat, replacement = new Map<string, string>(base.match.playerOrder.map(id => [id, randomUUID()])); replacement.set(base.match.id, randomUUID());
    const renamed = JSON.parse(JSON.stringify(base).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, value => replacement.get(value) ?? value));
    const d = GameStateSchema.parse(renamed); d.match.version = GameStateVersionSchema.parse(d.match.version + 20); d.match.eventSequence = GameEventSequenceSchema.parse(d.match.eventSequence + 20);
    const valid = unwrap(validateState(d, context)); assert.equal(hashPosition(valid),hashPosition(base)); assert.notEqual(hashReplayState(valid),hashReplayState(base));
    assert.deepEqual(unwrap(observe(valid, valid.timing.actingPlayer, context)), unwrap(observe(base, viewer, context)));
    assert.deepEqual(legal(valid).map(a => a.actionId), legal(base).map(a => a.actionId));
});
test("wire carries authoritative knowledge only in trusted transitions and viewer-filtered memory in observations", () => {
    for (const actor of [viewer,rival]) {
        const r = handleRequest({ schemaVersion: 1, requestId: "private-observe", op: "observe", content: context.content, state: afterLook, actorId: actor });
        assert.ok(r.ok); if (r.ok) { assert.equal(r.value.kind,"observation"); assert.equal(JSON.stringify(r.value).includes('"rememberedContent"'), actor === viewer); }
    }
});
test("golden replay is deterministic and retains genuine target and post-look training decisions", () => {
    assert.equal(canonicalSerialize(replay), canonicalSerialize(kiroshiReplay()));
    assert.equal(canonicalSerialize(replay), canonicalSerialize(JSON.parse(readFileSync(new URL("./fixtures/kiroshi-replay.v1.json", import.meta.url), "utf8"))));
    assert.ok(replay.positions.some(p => p.state.resolution.current?.effect.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND" && p.legalActions.length === 3));
    assert.ok(replay.positions.some(p => p.actingSeat === 0 && p.observation.players[0].cards.some(c => c.rememberedContent)));
    assert.ok(states.every(s => validateState(s,context).ok)); assert.equal(replay.finalState.timing.step, "MAIN");
});
test("default equip accepts face-up Legend host without granting permission to attack or inspect while hidden", () => {
    const m = new TurnMutation(beforeAttack, context), legend = m.state.players[viewer].zones.LEGENDS[0];
    m.state.objects.cards[legend].face = "UP";
    const extra = Object.values(m.state.objects.cards).find(c => c.cardId === KIROSHI && c.controllerId === viewer && c.id !== gearId)!;
    moveCardLocation(m, extra.id, "HAND"); unwrap(attachPlayedGear(m, extra.id, legend));
    const s = unwrap(validateState(m.state, context)), view = new RulesView(s, context);
    assert.ok(s.objects.cards[legend].attachments.includes(extra.id)); assert.equal(s.objects.cards[extra.id].zone.zone, "LEGENDS");
    assert.equal(view.getEffectivePower(legend), null); assert.equal(view.isAttackEligible(viewer, legend), false);
    assert.equal(view.getEffectiveTriggeredAbilities(legend)[0].subjectId, legend); assert.equal(s.privateKnowledge, undefined);
});
test("no later unreviewed Legend randomization action or repeat-inspection command is admitted", () => {
    for (const kind of ["RANDOMIZE_LEGENDS", "LOOK_AGAIN"]) assert.equal(GameActionSchema.safeParse({ actorId: viewer, action: { kind } }).success, false);
    // Typed transport rejects unreviewed operations too; no new general hidden-zone API.
    assert.equal(handleRequest({ schemaVersion: 1, requestId: "randomize", op: "randomizeLegends", state: replay.afterCombat, content: context.content, actorId: viewer }).ok, false);
});
