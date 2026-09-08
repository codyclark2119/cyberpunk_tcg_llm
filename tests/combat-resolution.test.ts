import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { canonicalSerialize, GameStateSchema, MatchIdSchema, GameStateVersionSchema, GameEventSequenceSchema, CardInstanceIdSchema, type CardInstanceId, type GameState, type LegalAction, type Result } from "@tcg/domain";
import { applyAction, applyCommand, advanceResolutionWithEvents, advanceResolution, hashPosition, hashReplayState, listLegalActions, observe, resolveActionId, RulesView, validateState, moveCardForEffect, transferGigControl, modifyGigValue } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { resolutionContext } from "./combat-resolution-fixture";
import { fightReplay, gigStealReplay } from "./combat-resolution-replay";
import { SWORDWISE } from "./combat-fixture";
import { BOMBUS, FLOOR_IT } from "./react-fixture";
import { KERRY } from "./noncombat-fixture";
import { MANTIS } from "./gear-fixture";
import { unwrap } from "./turn-replay";
import { getGigStealAllowance } from "../packages/engine/src/combat-resolution-policy";
import rules from "./fixtures/combat-resolution-rules.v1.json";

const context = resolutionContext(), fight = fightReplay(), steal = gigStealReplay();
const states: GameState[] = [fight.initialized.state];
for (const step of fight.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const main = states[fight.steps.findIndex(s => s.action.action.kind === "DECLARE_ATTACK")];
const active = main.timing.activePlayer, rival = main.match.playerOrder.find(id => id !== active)!;
const legal = (s: GameState) => unwrap(listLegalActions(s, s.timing.actingPlayer, context));
function act(s: GameState, predicate: (a: LegalAction) => boolean) {
    const a = legal(s).find(predicate); assert.ok(a, `Missing action at ${s.timing.step}`);
    return unwrap(applyAction(s, unwrap(resolveActionId(s, a.actorId, a.actionId, context)), context));
}
function fail<T>(result: Result<T>) { assert.equal(result.ok, false); }
function pass(s: GameState) { return act(s, a => a.action.kind === "PASS_REACT"); }
function finish(s: GameState) {
    const events = [];
    while (s.resolution.defeatContinuation || s.resolution.gigStealContinuation) {
        const result = act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
        s = result.state; events.push(...result.events);
    }
    return { state: s, events };
}
/** Trusted, validated focused fixtures. Headline traces use only engine setup and real actions. */
function position(attacking = SWORDWISE, defending = KERRY, attackGear = 0, defendGear = 0, attackMinus = 0, defendMinus = 0) {
    const s = GameStateSchema.parse(main);
    const relocate = (id: CardInstanceId, zone: "BATTLEFIELD" | "TRASH") => {
        const c = s.objects.cards[id], refs = s.players[c.zone.playerId].zones[c.zone.zone]!;
        refs.splice(refs.indexOf(id), 1); s.players[c.controllerId].zones[zone].push(id);
        c.zone = { playerId: c.controllerId, zone }; c.face = "UP"; c.statuses = [];
    };
    for (const c of Object.values(s.objects.cards)) c.attachments = [];
    for (const c of Object.values(s.objects.cards)) if (c.cardId === MANTIS && ["BATTLEFIELD", "LEGENDS"].includes(c.zone.zone)) relocate(c.id, "TRASH");
    const attacker = Object.values(s.objects.cards).find(c => c.cardId === attacking && c.controllerId === active)!.id;
    const defender = Object.values(s.objects.cards).find(c => c.cardId === defending && c.controllerId === rival)!.id;
    for (const [id, gear, minus] of [[attacker, attackGear, attackMinus], [defender, defendGear, defendMinus]] as const) {
        relocate(id, "BATTLEFIELD"); s.objects.cards[id].readiness = "SPENT";
        const owner = s.objects.cards[id].controllerId;
        for (const g of Object.values(s.objects.cards).filter(c => c.cardId === MANTIS && c.controllerId === owner).slice(0, gear)) { relocate(g.id, "BATTLEFIELD"); s.objects.cards[id].attachments.push(g.id); }
        for (const source of Object.values(s.objects.cards).filter(c => c.cardId === FLOOR_IT && c.controllerId !== owner).slice(0, minus)) {
            relocate(source.id, "TRASH");
            (s.temporaryModifiers ??= []).push({ kind: "POWER", sourceId: source.id, targetId: id, amount: -1, expires: { kind: "END_OF_TURN", turn: s.timing.turn } });
        }
    }
    s.temporaryModifiers?.sort((a, b) => a.sourceId < b.sourceId ? -1 : 1);
    s.timing.combat = { stage: "RIVAL_REACT", attackerId: attacker, attackingPlayerId: active, target: { kind: "CARD", cardInstanceId: defender } };
    s.timing.actingPlayer = rival; s.timing.window = "RIVAL_REACT"; s.timing.step = "RIVAL_REACT";
    return { state: unwrap(validateState(s, context)), attacker, defender };
}
function gigPosition(gear = 0, card = SWORDWISE, minus = 0) {
    const p = position(card, KERRY, gear, 0, minus), s = GameStateSchema.parse(p.state);
    assert.ok("target" in s.timing.combat); s.timing.combat.target = { kind: "GIG_AREA", playerId: rival };
    return { ...p, state: unwrap(validateState(s, context)) };
}

test("resolution review pins fight, negative references, defeat timing, public/hidden lifecycle and all steal rules", () => {
    for (const id of ["2.10.1", "2.10.2", "3.17.2", "5.3.2.2", "5.9.2", "5.9.4.1", "9.17.3", "9.19.2", "11.19.2", "9.23.2.2", "9.23.3.2", "9.23.5.1", "9.29", "8.16.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.equal(rules.sha256, context.content.ruleset.gameplay!.turnSlice!.rulesSourceHash);
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    assert.equal(Object.keys(context.content.ruleset.formats!).includes("DEMO_STARTER"), false);
    assert.ok(fight.initialization.decks.every(d => d.main.length === 42 && d.legends.length === 3));
});
for (const [label, a, d, ag, dg, am, dm, winner, defeats] of [
    ["higher current Gear power wins", KERRY, SWORDWISE, 1, 0, 0, 0, "A", ["D"]],
    ["lower power loses", SWORDWISE, KERRY, 0, 0, 0, 0, "D", ["A"]],
    ["positive tie defeats both", SWORDWISE, KERRY, 1, 0, 0, 0, null, ["A", "D"]],
    ["zero tie loses both but defeats neither", BOMBUS, BOMBUS, 0, 0, 0, 0, null, []],
    ["positive Unit defeats zero", SWORDWISE, BOMBUS, 0, 0, 0, 0, "A", ["D"]],
    ["zero Unit loses to positive", BOMBUS, SWORDWISE, 0, 0, 0, 0, "D", ["A"]],
    ["negative and zero compare equal", BOMBUS, BOMBUS, 0, 0, 1, 0, null, []],
    ["different negatives compare equal", BOMBUS, BOMBUS, 0, 0, 1, 2, null, []],
    ["Floor It breaks Gear tie late", SWORDWISE, KERRY, 1, 0, 1, 0, "D", ["A"]]
] as const) test(`fight: ${label}`, () => {
    const p = position(a, d, ag, dg, am, dm), beforeContent = canonicalSerialize(context.content), beforeHash = hashReplayState(p.state);
    const result = pass(p.state), completed = finish(result.state), events = [...result.events, ...completed.events];
    const outcome = events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload;
    assert.ok(outcome.kind === "FIGHT_RESULT");
    const view = new RulesView(p.state, context);
    assert.equal(outcome.attackerPower, view.getEffectivePower(p.attacker)); assert.equal(outcome.defenderPower, view.getEffectivePower(p.defender));
    assert.equal(outcome.attackerComparisonPower, Math.max(0, outcome.attackerPower)); assert.equal(outcome.defenderComparisonPower, Math.max(0, outcome.defenderPower));
    assert.equal(outcome.winnerId, winner === null ? null : winner === "A" ? p.attacker : p.defender);
    assert.deepEqual(events.filter(e => e.payload.kind === "CARD_DEFEATED").map(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId), defeats.map(x => x === "A" ? p.attacker : p.defender));
    if (winner === null) assert.deepEqual(outcome.loserIds, [p.attacker, p.defender]);
    assert.equal(completed.state.timing.window, "MAIN"); assert.equal(completed.state.timing.combat.stage, "NONE");
    assert.equal(completed.state.timing.actingPlayer, active); assert.equal(completed.state.timing.activePlayer, active);
    assert.equal(completed.state.objects.cards[p.attacker].readiness, "SPENT"); assert.equal(completed.state.objects.cards[p.defender].readiness, "SPENT");
    assert.equal(canonicalSerialize(context.content), beforeContent); assert.equal(hashReplayState(p.state), beforeHash);
});
test("defeat with Gear waits for owner ordering, preserves identity, follows/detaches centrally and retains Floor It in public Trash", () => {
    const p = position(SWORDWISE, KERRY, 1, 0, 1), initial = pass(p.state), host = p.state.objects.cards[p.attacker], gearId = host.attachments[0];
    assert.equal(initial.state.timing.step, "DEFEAT_ORDER_SELECTION"); assert.equal(initial.state.timing.actingPlayer, host.ownerId);
    assert.equal(initial.events.some(e => e.payload.kind === "CARD_MOVED"), false);
    const result = act(initial.state, a => a.action.kind === "CHOOSE" && initial.state.resolution.choice!.options[a.action.optionIndices[0]].kind === "CARD" && a.action.optionIndices[0] === 1);
    for (const id of [p.attacker, gearId]) {
        const old = p.state.objects.cards[id], current = result.state.objects.cards[id];
        assert.equal(current.id, old.id); assert.equal(current.ownerId, old.ownerId); assert.equal(current.controllerId, old.controllerId); assert.equal(current.revision, old.revision); assert.equal(current.cardId, old.cardId); assert.equal(current.zone.zone, "TRASH");
    }
    assert.deepEqual(result.state.objects.cards[p.attacker].attachments, []);
    assert.equal(new RulesView(result.state, context).getEffectivePower(p.attacker), 2); // Gear no longer attached; Floor It persists.
    assert.deepEqual(result.state.temporaryModifiers, p.state.temporaryModifiers);
    const kinds = result.events.map(e => e.payload.kind);
    assert.ok(kinds.indexOf("CARD_DEFEATED") < kinds.indexOf("CARD_MOVED")); assert.ok(kinds.includes("GEAR_DETACHED")); assert.equal(kinds.includes("POWER_MODIFIER_EXPIRED"), false);
    const ended = act(result.state, a => a.action.kind === "END_TURN"); assert.equal(ended.state.temporaryModifiers, undefined); assert.equal(new RulesView(ended.state, context).getEffectivePower(p.attacker), 3);
});
test("positive tie collects both owners Gear orders before simultaneous result movement", () => {
    const p = position(SWORDWISE, SWORDWISE, 1, 1), start = pass(p.state);
    assert.equal(start.state.timing.actingPlayer, active);
    const next = act(start.state, a => a.action.kind === "CHOOSE");
    assert.equal(next.state.timing.actingPlayer, rival); assert.equal(next.events.some(e => e.payload.kind === "CARD_MOVED"), false);
    const result = finish(next.state); assert.equal(result.events.filter(e => e.payload.kind === "CARD_DEFEATED").length, 2);
    assert.equal(result.events.filter(e => e.payload.kind === "CARD_MOVED").length, 4); unwrap(validateState(result.state, context));
});
test("shared effect departure removes Floor It only on hidden entry and does not resurrect it on return", () => {
    const p = position(SWORDWISE, KERRY, 0, 0, 1), s = GameStateSchema.parse(p.state);
    s.timing.combat = { stage: "NONE" }; s.timing.actingPlayer = active; s.timing.window = "MAIN"; s.timing.step = "MAIN";
    for (const destination of ["TRASH", "REMOVED", "HAND"] as const) {
        const result = unwrap(moveCardForEffect(s, p.attacker, destination, context));
        assert.equal(Boolean(result.state.temporaryModifiers), destination !== "HAND");
        assert.equal(result.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED" && e.payload.reason === "HIDDEN_AREA"), destination === "HAND");
        assert.equal(new RulesView(result.state, context).getEffectivePower(p.attacker), destination === "HAND" ? 3 : 2);
    }
    const hidden = unwrap(moveCardForEffect(s, p.attacker, "HAND", context)).state;
    const returned = GameStateSchema.parse(hidden), c = returned.objects.cards[p.attacker];
    returned.players[active].zones.HAND.splice(returned.players[active].zones.HAND.indexOf(c.id), 1); returned.players[active].zones.BATTLEFIELD.push(c.id); c.zone.zone = "BATTLEFIELD"; c.face = "UP";
    assert.equal(new RulesView(returned, context).getEffectivePower(c.id), 3);
    const forged = GameStateSchema.parse(hidden); forged.temporaryModifiers = structuredClone(s.temporaryModifiers); fail(validateState(forged, context));
});
test("Gig-area Blocker redirection fights only the final Unit; original Gigs stay untouched", () => {
    const p = gigPosition(), blocker = Object.values(p.state.objects.cards).find(c => c.cardId === BOMBUS && c.controllerId === rival && c.zone.zone === "BATTLEFIELD")!.id;
    const blocked = act(p.state, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === blocker), result = pass(blocked.state);
    assert.ok(result.events.some(e => e.payload.kind === "FIGHT_STARTED" && e.payload.defenderId === blocker));
    assert.equal(result.events.some(e => e.payload.kind === "GIG_STOLEN" || e.payload.kind === "GIG_STEAL_STARTED"), false);
    assert.deepEqual(result.state.objects.gigs, p.state.objects.gigs); assert.equal(result.state.objects.cards[blocker].readiness, "SPENT");
});
test("event-preserving automatic driver resumes pending fight or steal without a player action", () => {
    for (const p of [position(SWORDWISE, BOMBUS), gigPosition()]) {
        const pending = GameStateSchema.parse(p.state);
        assert.ok("target" in pending.timing.combat && pending.timing.combat.target);
        pending.timing.combat = { ...pending.timing.combat, target: pending.timing.combat.target, stage: "COMBAT_RESOLUTION_PENDING" };
        pending.timing.step = "COMBAT_RESOLUTION_PENDING"; pending.timing.window = "COMBAT_RESOLUTION_PENDING";
        const resumed = unwrap(advanceResolutionWithEvents(pending, context)), viaPass = pass(p.state);
        assert.deepEqual(resumed.events.map(e => e.payload), viaPass.events.slice(2).map(e => e.payload));
        assert.equal(resumed.state.timing.step, viaPass.state.timing.step);
        if (resumed.state.resolution.choice) fail(advanceResolutionWithEvents(resumed.state, context));
        fail(advanceResolution(pending, context)); // State-only compatibility helper must not drop events.
        fail(generatePosition(pending, active, context, "automatic"));
    }
});
test("ruleset steal allowance covers every band boundary and nonpositive reference", () => {
    for (const [power, expected] of [[-9, 0], [-1, 0], [0, 0], [1, 1], [9, 1], [10, 2], [19, 2], [20, 3], [29, 3], [30, 4], [99, 10]]) assert.equal(getGigStealAllowance(power, context), expected);
});
test("strategic multi-Gig selection moves nothing until complete, excludes prior selections and preserves owner/die/value", () => {
    const p = gigPosition(3, KERRY);
    for (const g of new RulesView(p.state, context).getControlledGigs(rival)) {
        assert.ok(g.roll.kind === "ROLLED");
        p.state = unwrap(modifyGigValue(p.state, g.id, g.roll.currentValue === 1 ? 1 : -1, context)).state;
    }
    const before = new RulesView(p.state, context), result = pass(p.state);
    assert.equal(before.getEffectivePower(p.attacker), 11); assert.equal(result.state.resolution.gigStealContinuation?.remaining, 2);
    assert.equal(result.state.resolution.choice!.options.length, 3);
    const first = act(result.state, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 1);
    assert.equal(first.state.resolution.gigStealContinuation?.remaining, 1); assert.equal(first.state.resolution.choice!.options.length, 2);
    assert.deepEqual(first.state.objects.gigs, p.state.objects.gigs); assert.equal(first.events.some(e => e.payload.kind === "GIG_STOLEN"), false);
    assert.equal(legal(first.state).length, 2); unwrap(generatePosition(first.state, active, context, "second-gig"));
    const selectedFirst = first.state.resolution.gigStealContinuation!.selected[0];
    assert.equal(first.state.resolution.choice!.options.some(o => o.kind === "GIG" && o.gigInstanceId === selectedFirst), false);
    const last = act(first.state, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    const stolen = last.events.flatMap(e => e.payload.kind === "GIG_STOLEN" ? [e.payload.gigInstanceId] : []);
    assert.equal(stolen.length, 2); assert.ok(stolen.includes(selectedFirst));
    let value = 0;
    for (const id of stolen) {
        const old = p.state.objects.gigs[id], next = last.state.objects.gigs[id];
        assert.deepEqual(next, { ...old, controllerId: active, location: { playerId: active, zone: "GIGS" } });
        assert.ok(old.roll.kind === "ROLLED"); assert.notEqual(old.roll.currentValue, old.roll.initialValue); value += old.roll.currentValue;
    }
    const after = new RulesView(last.state, context);
    assert.equal(after.getStreetCred(active), before.getStreetCred(active) + value); assert.equal(after.getStreetCred(rival), before.getStreetCred(rival) - value);
    assert.equal(last.state.timing.window, "MAIN");
    assert.ok(last.events.findIndex(e => e.payload.kind === "GIG_STOLEN") > last.events.map(e => e.payload.kind).lastIndexOf("GIG_CONTROL_CHANGED"));
    assert.deepEqual(stolen, [...stolen].sort());
});
test("forced all available Gigs auto-transfer even when allowance exceeds supply", () => {
    const p = gigPosition(3, KERRY);
    const original = new RulesView(p.state, context).getControlledGigs(rival);
    let s = p.state;
    for (const g of original.slice(1)) s = unwrap(transferGigControl(s, g.id, active, context)).state;
    const result = pass(s); assert.equal(result.state.timing.window, "MAIN"); assert.equal(result.state.resolution.choice, null);
    const event = result.events.find(e => e.payload.kind === "GIG_STEAL_STARTED")!.payload;
    assert.ok(event.kind === "GIG_STEAL_STARTED"); assert.equal(event.allowance, 2); assert.equal(event.count, 1);
    assert.ok(result.events.some(e => e.payload.kind === "GIG_STEAL_SELECTED" && e.payload.forced));
    assert.equal(new RulesView(result.state, context).getControlledGigCount(rival), 0);
});
for (const minus of [0, 1]) test(`nonpositive Gig attack (${minus ? "negative" : "zero"}) completes without stealing or choosing`, () => {
    const p = gigPosition(0, BOMBUS, minus), result = pass(p.state);
    assert.equal(result.state.timing.window, "MAIN"); assert.deepEqual(result.state.objects.gigs, p.state.objects.gigs);
    assert.equal(result.events.some(e => e.payload.kind === "GIG_STOLEN"), false);
    assert.ok(result.events.some(e => e.payload.kind === "GIG_STEAL_STARTED" && e.payload.allowance === 0));
});
test("cleanup retains spent attacker and turn modifiers, restores MAIN actions and another ready attacker", () => {
    const final = fight.finalState, view = new RulesView(final, context);
    assert.equal(final.timing.combat.stage, "NONE"); assert.equal(final.resolution.choice, null); assert.equal(final.resolution.returnTo, undefined);
    assert.equal(view.getEffectivePower(fight.attackerId), 4); assert.equal(final.objects.cards[fight.attackerId].readiness, "SPENT");
    assert.equal(legal(final).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === fight.attackerId), false);
    const other = legal(final).find(a => a.action.kind === "DECLARE_ATTACK"); assert.ok(other);
    const next = unwrap(applyAction(final, { actorId: other.actorId, action: other.action }, context));
    assert.notEqual(next.state.timing.combat.stage, "NONE"); assert.equal(next.state.temporaryModifiers?.length, 1);
});
test("invalid participant, target/control, empty area and hidden modifier states reject atomically", () => {
    const p = position();
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { delete s.objects.cards[p.attacker]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { delete s.objects.cards[p.defender]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[p.defender].controllerId = active; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[p.defender].readiness = "READY"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { if ("target" in s.timing.combat) s.timing.combat.target = { kind: "CARD", cardInstanceId: CardInstanceIdSchema.parse("absent") }; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.gigStealContinuation = { selected: [], remaining: 1 }; }
    ]) {
        const s = GameStateSchema.parse(p.state); mutate(s); const hash = hashReplayState(s);
        fail(validateState(s, context)); fail(applyAction(s, { actorId: rival, action: { kind: "PASS_REACT" } }, context)); assert.equal(hashReplayState(s), hash);
    }
    const g = gigPosition(), s = GameStateSchema.parse(g.state);
    for (const id of [...s.players[rival].gigs.GIGS]) { const die = s.objects.gigs[id]; die.controllerId = active; die.location.playerId = active; s.players[active].gigs.GIGS.push(id); }
    s.players[rival].gigs.GIGS = []; fail(validateState(s, context));
});
test("forged remaining/duplicate/foreign Gig choices and stale command/action IDs reject atomically", () => {
    const initial = pass(gigPosition(3, KERRY).state).state, chosen = legal(initial)[0], next = act(initial, a => a.actionId === chosen.actionId).state;
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.gigStealContinuation!.remaining++; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.gigStealContinuation!.selected.push(s.resolution.gigStealContinuation!.selected[0]); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.gigStealContinuation!.selected[0] = s.players[active].gigs.GIGS[0]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.choice!.options.reverse(); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.actingPlayer = rival; }
    ]) { const s = GameStateSchema.parse(next); mutate(s); fail(validateState(s, context)); }
    const hash = hashReplayState(next);
    fail(resolveActionId(next, active, chosen.actionId, context));
    fail(applyCommand(next, { actorId: active, action: legal(next)[0].action, commandId: randomUUID(), idempotencyKey: "stale", expectedStateVersion: initial.match.version }, context));
    for (const indices of [[999], [0, 1], []]) fail(applyAction(next, { actorId: active, action: { kind: "CHOOSE", choiceId: next.resolution.choice!.id, optionIndices: indices } }, context));
    assert.equal(hashReplayState(next), hash);
});
test("forged defeat targets, owner orders and MAIN with orphan combat work reject", () => {
    const p = position(SWORDWISE, KERRY, 1, 0, 1), choice = pass(p.state).state;
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.defeatContinuation!.defeats[0].targetId = p.defender; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.defeatContinuation!.orders[0].cardIds = [p.defender]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.defeatContinuation!.orders[0].cardIds = [p.attacker, p.attacker]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.combat = { stage: "NONE" }; s.timing.window = "MAIN"; s.timing.step = "MAIN"; }
    ]) { const s = GameStateSchema.parse(choice); mutate(s); fail(validateState(s, context)); }
});
test("Gig observations and model inputs contain public choices only; defender gets no attacker actions", () => {
    const s = pass(gigPosition(3, KERRY).state).state;
    const own = unwrap(observe(s, active, context)), other = unwrap(observe(s, rival, context));
    assert.equal(own.combat?.stage, "GIG_STEAL_SELECTION"); assert.deepEqual(own.gigSteal, { selectedIds: [], remaining: 2 });
    assert.deepEqual(own.players.map(p => p.gigs), other.players.map(p => p.gigs));
    assert.deepEqual(unwrap(listLegalActions(s, rival, context)), []);
    const position = unwrap(generatePosition(s, active, context, "steal-choice")), input = JSON.stringify(modelInput(position));
    assert.equal(input.includes(s.rng.seed), false); assert.equal(input.includes('"rng"'), false);
    for (const id of s.players[rival].zones.HAND) assert.equal(input.includes(`"${id}"`), false);
    assert.equal(position.legalActions.length, 3);
});
test("POSITION_V2 action IDs ignore transport identity and map insertion order at steal decisions", () => {
    const s = pass(gigPosition(3, KERRY).state).state, changed = GameStateSchema.parse(s);
    changed.match.id = MatchIdSchema.parse(randomUUID()); changed.match.version = GameStateVersionSchema.parse(changed.match.version + 200); changed.match.eventSequence = GameEventSequenceSchema.parse(changed.match.eventSequence + 300);
    changed.objects.gigs = Object.fromEntries(Object.entries(changed.objects.gigs).reverse());
    assert.notEqual(hashReplayState(changed), hashReplayState(s)); assert.equal(hashPosition(changed), hashPosition(s)); assert.deepEqual(legal(changed), legal(s));
});
for (const [name, replay] of [["fight-replay", fight], ["gig-steal-replay", steal]] as const) test(`${name} exact complete replay, strategic positions and wire actionId traversal`, () => {
    assert.deepEqual(JSON.parse(readFileSync(`tests/fixtures/${name}.v1.json`, "utf8")), replay);
    let s = replay.initialized.state;
    for (const step of replay.steps) {
        const response = handleRequest({ schemaVersion: 1, requestId: `${name}-${s.match.version}`, op: "applyAction", content: replay.content, state: s, actorId: step.actorId, actionId: step.actionId });
        assert.equal(response.ok, true);
        if (!response.ok || response.value.kind !== "transition") throw new Error(JSON.stringify(response));
        assert.deepEqual(response.value.events, step.events); assert.equal(response.value.stateHash, step.stateHash); s = response.value.state;
    }
    assert.deepEqual(s, replay.finalState); assert.equal(s.timing.window, "MAIN");
    assert.ok(replay.positions.every(p => p.legalActions.length > 1));
    assert.equal(replay.positions.some(p => p.state.timing.combat.stage === "COMBAT_RESOLUTION_PENDING"), false);
    if (name === "gig-steal-replay") assert.ok(replay.positions.some(p => p.state.timing.combat.stage === "GIG_STEAL_SELECTION"));
    else assert.equal(replay.steps.length, 53);
});
