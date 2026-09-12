import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, canonicalSerialize, type CardInstanceId, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, advanceResolutionWithEvents, createGameWithEvents, hashPosition, hashReplayState, listLegalActions, moveCardForEffect, observe, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { TurnMutation } from "../packages/engine/src/turn";
import { processDeparture } from "../packages/engine/src/card-movement";
import { recordPlayedCard } from "../packages/engine/src/trigger-resolution";
import { testCondition } from "../packages/engine/src/conditions";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { triggersContext, triggersInput, triggerCards, SATORI, DEXTER, JACKIE } from "./combat-triggers-fixture";
import { satoriReplay, defeatedReplay, firstBlueReplay } from "./combat-triggers-replay";
import { PSYCHO, REBOOT } from "./combat-restrictions-fixture";
import { SWORDWISE } from "./combat-fixture";
import { MANTIS, ROYCE } from "./gear-fixture";
import { FLOOR_IT, BOMBUS } from "./react-fixture";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/combat-triggers-card-sources.v1.json";
import rules from "./fixtures/combat-triggers-rules.v1.json";
const context = triggersContext(), satori = satoriReplay(), defeated = defeatedReplay(), blue = firstBlueReplay();
function states(trace: typeof satori) { const result: GameState[] = [trace.initialized.state]; for (const step of trace.steps) result.push(unwrap(applyAction(result.at(-1)!, step.action, context)).state); return result; }
const ss = states(satori), bs = states(blue);
const main = ss[satori.steps.map((s, i) => s.action.action.kind === "DECLARE_ATTACK" ? i : -1).filter(i => i >= 0).at(-1)!];
const active = main.timing.activePlayer, rival = main.match.playerOrder.find(id => id !== active)!;
const legal = (s: GameState, ctx = context) => unwrap(listLegalActions(s, s.timing.actingPlayer, ctx));
function act(s: GameState, predicate: (a: LegalAction) => boolean, ctx = context) { const a = legal(s, ctx).find(predicate); assert.ok(a, `Missing action at ${s.timing.step}`); return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, ctx)); }
function choose(s: GameState, index = 0) { return act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
function finish(s: GameState) { const events = []; while (s.resolution.choice) { const next = choose(s); s = next.state; events.push(...next.events); } return { state: s, events }; }
function relocate(s: ReturnType<typeof GameStateSchema.parse>, id: CardInstanceId, zone: "HAND" | "TRASH" | "BATTLEFIELD") {
    const c = s.objects.cards[id], refs = s.players[c.zone.playerId].zones[c.zone.zone]!;
    refs.splice(refs.indexOf(id), 1); s.players[c.controllerId].zones[zone].push(id); c.zone = { playerId: c.controllerId, zone }; c.face = zone === "HAND" ? "DOWN" : "UP"; c.statuses = [];
}
/** Trusted focused preparations only; all headline replay generation uses legal engine actions. */
function combat(attacking = SWORDWISE, defending = DEXTER, gear = 1, extraMantis = 0, attackMinus = 0, defendMinus = 0, defendingGear = 0) {
    const s = GameStateSchema.parse(main);
    for (const c of Object.values(s.objects.cards)) c.attachments = [];
    for (const c of Object.values(s.objects.cards)) if ([SATORI, MANTIS].includes(c.cardId) && c.zone.zone === "BATTLEFIELD") relocate(s, c.id, "HAND");
    const attacker = Object.values(s.objects.cards).find(c => c.cardId === attacking && c.controllerId === active)!.id;
    const defender = Object.values(s.objects.cards).find(c => c.cardId === defending && c.controllerId === rival)!.id;
    for (const [id, sat, mantis, minus] of [[attacker, gear, extraMantis, attackMinus], [defender, defendingGear, 0, defendMinus]] as const) {
        relocate(s, id, "BATTLEFIELD"); s.objects.cards[id].readiness = "SPENT";
        const controller = s.objects.cards[id].controllerId;
        for (const [card, count] of [[SATORI, sat], [MANTIS, mantis]] as const) for (const g of Object.values(s.objects.cards).filter(c => c.cardId === card && c.controllerId === controller).slice(0, count)) { relocate(s, g.id, "BATTLEFIELD"); s.objects.cards[id].attachments.push(g.id); }
        for (const f of Object.values(s.objects.cards).filter(c => c.cardId === FLOOR_IT && c.controllerId !== controller).slice(0, minus)) { relocate(s, f.id, "TRASH"); (s.temporaryModifiers ??= []).push({ kind: "POWER", sourceId: f.id, targetId: id, amount: -1, expires: { kind: "END_OF_TURN", turn: s.timing.turn } }); }
    }
    s.temporaryModifiers?.sort((a, b) => a.sourceId < b.sourceId ? -1 : 1);
    s.timing.combat = { stage: "RIVAL_REACT", attackerId: attacker, attackingPlayerId: active, target: { kind: "CARD", cardInstanceId: defender } };
    s.timing.actingPlayer = rival; s.timing.step = "RIVAL_REACT"; s.timing.window = "RIVAL_REACT";
    return { state: unwrap(validateState(s, context)), attacker, defender };
}
const pass = (s: GameState) => act(s, a => a.action.kind === "PASS_REACT");
function asMain(s: GameState) { const next = GameStateSchema.parse(s); next.timing.combat = { stage: "NONE" }; next.timing.actingPlayer = active; next.timing.step = "MAIN"; next.timing.window = "MAIN"; return unwrap(validateState(next, context)); }
function playProgram(s: GameState, card = REBOOT) {
    const d = GameStateSchema.parse(s), source = Object.values(d.objects.cards).find(c => c.cardId === card && c.controllerId === s.timing.actingPlayer && !s.fightPreventions?.some(e => e.sourceId === c.id))!.id;
    relocate(d, source, "HAND");
    const first = act(unwrap(validateState(d, context)), a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === source); let state = first.state; const events = [...first.events];
    while (state.timing.step === "PAYMENT_SELECTION") { const next = choose(state); state = next.state; events.push(...next.events); }
    return { state, events, source };
}
const order = ss.find(s => s.timing.step === "TRIGGER_ORDER_SELECTION")!;
const optional = bs.find(s => s.timing.step === "OPTIONAL_TRIGGER_SELECTION")!;
const draws = (events: typeof satori.initialized.events) => events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND");

test("all three full source records, fourteen printings, rule and errata pins survive normalization", () => {
    assert.equal(triggerCards.length, 3); assert.equal(triggerCards.reduce((n, c) => n + c.printings.length, 0), 14);
    assert.deepEqual(sources.matchingErrata, []); assert.equal(sources.errataSha256, rules.errataSha256);
    for (const card of triggerCards) {
        const capture = sources.records.find(s => s.record.slug === card.id)!;
        assert.equal(card.rulesText, capture.record.rules_text); assert.equal(card.provenance.sourceHash, hashCanonical(capture.record));
        assert.deepEqual(card.printings.map(p => p.id), capture.record.printings.map(p => p.id));
        assert.equal(card.power, capture.record.power ?? undefined); assert.equal(card.revision, 1); assert.equal(supportsTriggerCard(card, context).ok, true);
    }
    assert.equal(triggerCards.find(c => c.id === JACKIE)!.mechanics.abilities.some(a => a.trigger === "WHEN_DEFEATED"), false);
    for (const id of ["3.17.3", "4.11.3", "6.4.5", "9.18", "9.19.2", "10.10.1", "10.12", "10.13", "10.15", "11.19.2", "11.20.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
});
test("full-shape admission requires Satori power plus inheritance/draw and every Dexter/Jackie line", () => {
    for (const card of triggerCards) for (const change of [
        { ...card, provenance: { ...card.provenance, reviewed: false } },
        { ...card, mechanics: { ...card.mechanics, abilities: card.mechanics.abilities.slice(1) } },
        { ...card, mechanics: { ...card.mechanics, abilities: [...card.mechanics.abilities, card.mechanics.abilities[0]] } },
        { ...card, mechanics: { ...card.mechanics, keywords: ["BLOCKER"] } },
        { ...card, execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" } }
    ]) assert.equal(supportsTriggerCard(CardRevisionSnapshotSchema.parse(change), context).ok, false);
    const card = triggerCards.find(c => c.id === SATORI)!;
    for (const change of [{ ...card, power: 0 }, { ...card, mechanics: { ...card.mechanics, modifiers: [] } }, { ...card, mechanics: { ...card.mechanics, abilities: [{ ...card.mechanics.abilities[0], inherited: undefined }] } }]) assert.equal(supportsTriggerCard(CardRevisionSnapshotSchema.parse(change), context).ok, false);
    const old = context.content.cards.find(c => c.id === MANTIS)!;
    const malformed = CardRevisionSnapshotSchema.parse({ ...old, mechanics: { ...old.mechanics, abilities: card.mechanics.abilities } });
    const ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.map(c => c.id === MANTIS ? malformed : c), context.content.manifest.engine) };
    assert.equal(createGameWithEvents(triggersInput("reject-shape"), ctx).ok, false);
});
test("Satori power is exactly +2 per physical source before combat and vanishes on departure without base mutation", () => {
    const revision = canonicalSerialize(context.content.cards.find(c => c.id === SWORDWISE));
    for (const n of [0, 1, 2]) { const p = combat(SWORDWISE, DEXTER, n); assert.equal(new RulesView(p.state, context).getEffectivePower(p.attacker), 3 + n * 2); }
    const p = combat(SWORDWISE, DEXTER, 2), state = asMain(p.state), gear = state.objects.cards[p.attacker].attachments[0];
    const next = unwrap(moveCardForEffect(state, gear, "HAND", context));
    assert.equal(new RulesView(next.state, context).getEffectivePower(p.attacker), 5);
    assert.equal(new RulesView(next.state, context).getApplicableCharacteristicModifiers(p.attacker).length, 1);
    assert.equal(canonicalSerialize(context.content.cards.find(c => c.id === SWORDWISE)), revision);
    assert.equal("currentPower" in next.state.objects.cards[p.attacker], false);
});
test("Satori, Mantis and Floor It compose through the same query with distinct physical modifier sources", () => {
    const p = combat(SWORDWISE, DEXTER, 1, 1, 1), view = new RulesView(p.state, context);
    assert.equal(view.getEffectivePower(p.attacker), 6); // 3 + 2 + 2 - 1
    const mods = view.getApplicableCharacteristicModifiers(p.attacker); assert.equal(mods.length, 3); assert.equal(new Set(mods.map(m => m.sourceId)).size, 3);
    const result = pass(p.state), fact = result.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload;
    assert.ok(fact.kind === "FIGHT_RESULT"); assert.equal(fact.attackerPower, 6); assert.equal(fact.winnerId, p.attacker);
});
for (const [label, attacking, defending, gears, minus, expected] of [
    ["loss to tie", DEXTER, PSYCHO, 1, 0, null], ["tie to win", DEXTER, DEXTER, 1, 0, "attacker"],
    ["loss to win", SWORDWISE, DEXTER, 1, 0, "attacker"], ["two copies overcome power six", SWORDWISE, PSYCHO, 2, 0, "attacker"],
    ["Floor It converts loss to positive tie", SWORDWISE, PSYCHO, 1, 1, null]
] as const) test(`adjusted truthful fight: ${label}`, () => {
    const p = combat(attacking, defending, gears, 0, 0, minus), r = pass(p.state), f = r.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload;
    assert.ok(f.kind === "FIGHT_RESULT"); assert.equal(f.winnerId, expected ? p.attacker : null);
    const pending = r.events.filter(e => e.payload.kind === "EFFECT_PENDING" && p.state.objects.cards[e.payload.sourceId].cardId === SATORI);
    assert.equal(pending.length, expected ? gears : 0);
    const final = finish(r.state); assert.equal(final.state.timing.window, "MAIN");
    assert.equal(final.state.objects.cards[p.defender].zone.zone, "TRASH");
});
test("losing Satori host never emits a fight-win trigger; defender winner does", () => {
    const lost = combat(SWORDWISE, PSYCHO, 1), l = pass(lost.state);
    assert.equal(l.events.some(e => e.payload.kind === "EFFECT_PENDING" && lost.state.objects.cards[e.payload.sourceId].cardId === SATORI), false);
    const won = combat(SWORDWISE, PSYCHO, 0, 0, 0, 0, 1), r = pass(won.state);
    const pending = r.events.find(e => e.payload.kind === "EFFECT_PENDING")!.payload; assert.ok(pending.kind === "EFFECT_PENDING");
    assert.equal(won.state.objects.cards[pending.sourceId].controllerId, rival); assert.equal(draws(r.events).length, 1);
});
test("zero/negative comparisons preserve no winner, no fight-win trigger and no defeat at zero", () => {
    const p = combat(SWORDWISE, BOMBUS, 0, 0, 3, 3), r = pass(p.state);
    const f = r.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload; assert.ok(f.kind === "FIGHT_RESULT");
    assert.ok(f.attackerPower <= 0); assert.ok(f.defenderPower <= 0); assert.equal(f.winnerId, null);
    assert.equal(r.events.some(e => ["CARD_DEFEATED", "EFFECT_PENDING"].includes(e.payload.kind)), false);
});
test("two Satori sources create a real controller ordering choice before defeat; either order resolves both", () => {
    assert.ok(order); assert.equal(order.resolution.pending.length, 2); assert.equal(order.timing.combat.stage, "TRIGGER_RESOLUTION");
    const sources = order.resolution.pending.map(e => e.sourceId); assert.equal(new Set(sources).size, 2);
    const view = new RulesView(order, context), host = order.resolution.pending[0].trigger!.subjectId;
    assert.equal(view.getEffectivePower(host), 7); assert.equal(view.getEffectiveTriggeredAbilities(host).filter(b => b.kind === "WHEN_FIGHT_WON").length, 2);
    for (const index of [0, 1]) {
        const selected = order.resolution.choice!.options[index]; assert.ok(selected.kind === "EFFECT");
        const r = choose(order, index); assert.equal(r.events.find(e => e.payload.kind === "TRIGGER_ORDER_SELECTED")!.payload.kind, "TRIGGER_ORDER_SELECTED");
        const resolved = r.events.filter(e => e.payload.kind === "EFFECT_RESOLVED"); assert.ok(resolved[0].payload.kind === "EFFECT_RESOLVED"); assert.equal(resolved[0].payload.effectId, selected.effectId);
        assert.equal(draws(r.events.slice(0, r.events.findIndex(e => e.payload.kind === "CARD_DEFEATED"))).length, 2);
        assert.equal(r.state.resolution.triggerContinuation, undefined); assert.equal(r.state.timing.window, "MAIN");
    }
});
test("already pending inherited triggers survive Gear detachment and retain historical fight winner", () => {
    const m = new TurnMutation(order, context), gear = order.resolution.pending[0].sourceId!, host = order.resolution.pending[0].trigger!.subjectId;
    unwrap(processDeparture(m, gear, "TRASH")); m.state.resolution.stage = "CHOICE";
    const state = unwrap(validateState(m.state, context)); assert.equal(new RulesView(state, context).getEffectivePower(host), 5);
    const r = choose(state); assert.equal(draws(r.events.slice(0, r.events.findIndex(e => e.payload.kind === "CARD_DEFEATED"))).length, 2);
    assert.equal(r.state.objects.cards[gear].zone.zone, "TRASH"); assert.equal(r.state.timing.window, "MAIN");
});
test("Satori draw occurs on truthful win before Reboot prevention; protected loser is not DEFEATED", () => {
    const p = combat(), armed = playProgram(p.state), r = pass(armed.state);
    const kinds = r.events.map(e => e.payload.kind); assert.ok(kinds.includes("FIGHT_DEFEAT_PREVENTED"));
    assert.ok(kinds.indexOf("EFFECT_RESOLVED") < kinds.indexOf("FIGHT_DEFEAT_PREVENTED"));
    const f = r.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload; assert.ok(f.kind === "FIGHT_RESULT"); assert.equal(f.winnerId, p.attacker);
    assert.equal(draws(r.events).length, 1); assert.equal(kinds.includes("CARD_DEFEATED"), false); assert.equal(r.state.objects.cards[p.defender].zone.zone, "BATTLEFIELD");
});
test("real Floor It during React composes with Satori and changes the pending fight", () => {
    const p = combat(), program = playProgram(p.state, FLOOR_IT); let state = program.state;
    while (state.resolution.choice) { const i = state.resolution.choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === p.attacker); state = choose(state, Math.max(0, i)).state; }
    assert.equal(new RulesView(state, context).getEffectivePower(p.attacker), 4);
    const r = pass(state), f = r.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload; assert.ok(f.kind === "FIGHT_RESULT"); assert.equal(f.winnerId, null);
    assert.equal(r.events.some(e => e.payload.kind === "EFFECT_PENDING" && state.objects.cards[e.payload.sourceId].cardId === SATORI), false);
});
test("Dexter DEFEATED source moves before pending, then reads current Street Cred and draws two", () => {
    const e = defeated.steps.flatMap(s => s.events), index = e.findIndex(e => e.payload.kind === "CARD_DEFEATED"); assert.ok(index >= 0);
    const d = e[index].payload; assert.ok(d.kind === "CARD_DEFEATED");
    const after = e.slice(index), move = after.findIndex(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId === d.cardInstanceId), pending = after.findIndex(e => e.payload.kind === "EFFECT_PENDING");
    assert.ok(move >= 0 && pending > move); assert.equal(draws(after).length, 2); assert.ok(after.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met));
    assert.equal(defeated.finalState.objects.cards[d.cardInstanceId].cardId, DEXTER); assert.equal(defeated.finalState.objects.cards[d.cardInstanceId].zone.zone, "TRASH");
});
test("positive tie defeats both Dexters and resolves turn-player pending effects before rival effects", () => {
    const p = combat(DEXTER, DEXTER, 0), r = pass(p.state), events = [...r.events, ...finish(r.state).events];
    const pending = events.filter(e => e.payload.kind === "EFFECT_PENDING"); assert.equal(pending.length, 2);
    const selected = events.filter(e => e.payload.kind === "TRIGGER_ORDER_SELECTED").map(e => e.payload.kind === "TRIGGER_ORDER_SELECTED" ? e.payload.controllerId : null);
    assert.deepEqual(selected, [active, rival]);
    const lastMove = Math.max(...events.map((e, i) => e.payload.kind === "CARD_MOVED" && [p.attacker, p.defender].includes(e.payload.cardInstanceId) ? i : -1));
    assert.ok(events.findIndex(e => e.payload.kind === "EFFECT_PENDING") > lastMove);
});
test("Dexter absolute difference is current and Null-aware in either player direction", () => {
    const s = GameStateSchema.parse(main), condition = { kind: "STREET_CRED_DIFFERENCE_AT_LEAST", minimum: 10 } as const;
    const rolled = Object.values(s.objects.gigs).filter(g => g.roll.kind === "ROLLED");
    for (const g of rolled) if (g.roll.kind === "ROLLED") g.roll.currentValue = 1;
    assert.equal(testCondition(s, active, condition, context), false);
    for (const g of rolled) if (g.controllerId === rival && g.roll.kind === "ROLLED") g.roll.currentValue = Number(g.dieType.slice(1));
    assert.equal(testCondition(s, active, condition, context), true); assert.equal(testCondition(s, rival, condition, context), true);
    for (const g of rolled) if (g.controllerId === active) g.roll = { kind: "UNROLLED" };
    assert.equal(testCondition(s, active, condition, context), false); assert.equal(testCondition(s, rival, condition, context), false);
    for (const g of rolled) g.roll = { kind: "UNROLLED" };
    assert.equal(testCondition(s, active, condition, context), false);
});
test("Jackie provides explicit accept/decline; decline consumes historical first Blue play independently of CALL", () => {
    assert.ok(optional); const actor = optional.timing.actingPlayer, beforeUsage = optional.players[actor].economy.callsThisTurn;
    const r = choose(optional, 1); assert.equal(r.state.timing.window, "MAIN"); assert.equal(draws(r.events).length, 0);
    assert.ok(r.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED")); assert.equal(r.state.turnHistory!.blueUnitOrGearPlays[actor], 1);
    assert.equal(r.state.players[actor].economy.callsThisTurn, beforeUsage);
    const m = new TurnMutation(r.state, context), source = Object.values(m.state.objects.cards).find(c => c.cardId === PSYCHO && c.controllerId === actor)!;
    unwrap(recordPlayedCard(m, source.id)); assert.equal(m.state.turnHistory!.blueUnitOrGearPlays[actor], 2); assert.equal(m.state.resolution.triggerContinuation, undefined);
});
test("Jackie actual decrease to minimum draws one; zero decrease and already-minimum Gig do not draw", () => {
    const last = blue.steps.at(-1)!; assert.equal(draws(last.events).length, 1); assert.ok(last.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met));
    const amount = bs.find(s => s.resolution.triggerContinuation?.phase === "AMOUNT")!;
    const zero = choose(amount, 0); assert.equal(draws(zero.events).length, 0); assert.ok(zero.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    const draft = GameStateSchema.parse(optional);
    for (const g of Object.values(draft.objects.gigs)) if (g.controllerId === draft.timing.actingPlayer && g.roll.kind === "ROLLED") g.roll.currentValue = 1;
    const accepted = choose(unwrap(validateState(draft, context)), 0), r = finish(accepted.state);
    assert.equal(draws([...accepted.events, ...r.events]).length, 0); assert.equal(r.state.timing.window, "MAIN");
});
test("completed first play before Jackie reveal is historical; later reveal cannot reclaim it", () => {
    const start = bs[blue.steps.findIndex(s => s.action.action.kind === "CALL_LEGEND")], m = new TurnMutation(start, context);
    const source = Object.values(m.state.objects.cards).find(c => c.cardId === PSYCHO && c.controllerId === m.state.timing.activePlayer)!;
    unwrap(recordPlayedCard(m, source.id)); assert.equal(m.state.turnHistory!.blueUnitOrGearPlays[source.controllerId], 1); assert.equal(m.state.resolution.triggerContinuation, undefined);
    const jackie = Object.values(m.state.objects.cards).find(c => c.cardId === JACKIE && c.controllerId === source.controllerId)!; jackie.face = "UP";
    unwrap(recordPlayedCard(m, source.id)); assert.equal(m.state.resolution.triggerContinuation, undefined);
});
test("turn history resets for both players; CALL, SELL and failed payment do not count as Blue plays", () => {
    for (let i = 0; i < blue.steps.length; i++) {
        const kind = blue.steps[i].action.action.kind;
        if (["CALL_LEGEND", "SELL_CARD"].includes(kind)) assert.deepEqual(bs[i + 1].turnHistory?.blueUnitOrGearPlays, bs[i].turnHistory?.blueUnitOrGearPlays);
        if (kind === "END_TURN") { assert.equal(bs[i + 1].turnHistory!.turn, bs[i + 1].timing.turn); assert.deepEqual(Object.values(bs[i + 1].turnHistory!.blueUnitOrGearPlays), [0, 0]); }
    }
    const before = hashReplayState(optional);
    const source = Object.values(optional.objects.cards).find(c => c.cardId === PSYCHO)!;
    assert.equal(applyAction(optional, { actorId: optional.timing.actingPlayer, action: { kind: "PLAY_CARD", cardInstanceId: source.id } }, context).ok, false);
    assert.equal(hashReplayState(optional), before);
});
test("trigger ordering/optional observations expose public source and power, with action IDs only for controller", () => {
    for (const s of [order, optional]) {
        const actor = s.timing.actingPlayer, other = s.match.playerOrder.find(id => id !== actor)!;
        assert.deepEqual(unwrap(listLegalActions(s, other, context)), []);
        for (const id of [actor, other]) assert.ok(unwrap(observe(s, id, context)).pendingTriggers?.length);
        const p = unwrap(generatePosition(s, actor, context, "trigger-choice")), input = JSON.stringify(modelInput(p));
        assert.ok(p.legalActions.length > 1); assert.equal(input.includes(s.rng.seed), false); assert.equal(input.includes('"rng"'), false);
        for (const id of s.players[other].zones.HAND) assert.equal(input.includes(id), false);
    }
    const host = order.resolution.pending[0].trigger!.subjectId;
    for (const actor of order.match.playerOrder) assert.equal(unwrap(observe(order, actor, context)).players.flatMap(p => p.cards).find(c => c.publicId === host)!.effectivePower, 7);
});
test("invalid or forged trigger state, missing bindings, order, actor and history fail atomically", () => {
    const before = hashReplayState(order);
    const mutations = [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.pending.pop(); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.pending.push(s.resolution.pending[0]); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.triggerContinuation!.bindings[0].controllerId = rival; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.pending[0].trigger!.source.revision++; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.triggerContinuation!.bindings[0].subjectId = s.resolution.triggerContinuation!.bindings[0].sourceId; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.triggerContinuation!.phase = "OPTIONAL"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.combat = { stage: "NONE" }; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.actingPlayer = rival; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.turnHistory!.turn++; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { delete s.turnHistory!.blueUnitOrGearPlays[rival]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { const o = s.resolution.triggerContinuation!.origin; if (o.kind === "FIGHT") o.result.winnerId = o.result.defenderId; }
    ];
    for (const mutate of mutations) { const s = GameStateSchema.parse(order); mutate(s); assert.equal(validateState(s, context).ok, false); }
    assert.equal(applyAction(order, { actorId: rival, action: legal(order)[0].action }, context).ok, false);
    const stale = GameStateSchema.parse(order); stale.resolution.choice!.id = hashCanonical("stale"); assert.equal(validateState(stale, context).ok, false);
    assert.equal(hashReplayState(order), before);
});
test("POSITION_V2 ignores transport counters with pending triggers, while semantic source/history changes matter", () => {
    const s = GameStateSchema.parse(order); s.match.version = GameStateVersionSchema.parse(s.match.version + 31); s.match.eventSequence = GameEventSequenceSchema.parse(s.match.eventSequence + 100);
    for (const e of s.resolution.pending) e.causedBySequence += 100;
    assert.equal(validateState(s, context).ok, true); assert.equal(hashPosition(s), hashPosition(order)); assert.notEqual(hashReplayState(s), hashReplayState(order));
    assert.deepEqual(legal(s).map(a => a.actionId), legal(order).map(a => a.actionId));
    s.turnHistory!.blueUnitOrGearPlays[active]++; assert.notEqual(hashPosition(s), hashPosition(order));
    assert.equal(hashPosition(JSON.parse(canonicalSerialize(order))), hashPosition(order));
});
test("automatic driver preserves fight and pending events then pauses at actual Satori ordering", () => {
    const p = combat(SWORDWISE, DEXTER, 2), pending = GameStateSchema.parse(p.state); assert.ok("target" in pending.timing.combat && pending.timing.combat.target);
    pending.timing.combat = { ...pending.timing.combat, target: pending.timing.combat.target, stage: "COMBAT_RESOLUTION_PENDING" }; pending.timing.step = "COMBAT_RESOLUTION_PENDING"; pending.timing.window = "COMBAT_RESOLUTION_PENDING";
    const r = unwrap(advanceResolutionWithEvents(pending, context)), passed = pass(p.state);
    assert.deepEqual(r.events.map(e => e.payload), passed.events.slice(2).map(e => e.payload)); assert.equal(hashPosition(r.state), hashPosition(passed.state));
    assert.equal(r.state.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(generatePosition(pending, rival, context, "automatic").ok, false);
});
test("constructed remains 40–50 with no demo format or field-Legend execution", () => {
    const input = triggersInput("short-demo"); input.decks = input.decks.map(d => ({ ...d, main: d.main.slice(0, 27) }));
    assert.equal(createGameWithEvents(input, context).ok, false);
    assert.equal(JSON.stringify(context.content.ruleset).includes("DEMO_STARTER"), false);
    const jackie = Object.values(blue.finalState.objects.cards).find(c => c.cardId === JACKIE && c.controllerId === active)!;
    assert.equal(new RulesView(blue.finalState, context).getEffectivePower(jackie.id), null);
});

test("Royce own-turn modifier stacks with distinct Satori and Mantis; Null Legend remains Null", () => {
    const p = combat(SWORDWISE, DEXTER, 1, 1), m = new TurnMutation(asMain(p.state), context);
    const legend = m.state.players[active].zones.LEGENDS[1], royce = context.content.cards.find(c => c.id === ROYCE)!;
    m.state.objects.cards[legend] = { ...m.state.objects.cards[legend], cardId: royce.id, revision: royce.revision, face: "UP" };
    for (const gear of [...m.state.objects.cards[p.attacker].attachments]) {
        m.state.objects.cards[p.attacker].attachments = m.state.objects.cards[p.attacker].attachments.filter(id => id !== gear);
        const card = m.state.objects.cards[gear]; m.state.players[active].zones.BATTLEFIELD.splice(m.state.players[active].zones.BATTLEFIELD.indexOf(gear), 1);
        card.zone = { playerId: active, zone: "LEGENDS" }; m.state.players[active].zones.LEGENDS.push(gear); m.state.objects.cards[legend].attachments.push(gear);
    }
    const view = new RulesView(unwrap(validateState(m.state, context)), context); assert.equal(view.getEffectivePower(legend), 14); // Royce 6 + 2 + 2 + own-turn 2*2
    const jackie = triggerCards.find(c => c.id === JACKIE)!; m.state.objects.cards[legend] = { ...m.state.objects.cards[legend], cardId: jackie.id, revision: jackie.revision };
    const nullView = new RulesView(unwrap(validateState(m.state, context)), context); assert.equal(nullView.getEffectivePower(legend), null);
    assert.equal(nullView.getEffectiveTriggeredAbilities(legend).filter(b => b.kind === "WHEN_FIGHT_WON").length, 1);
});
test("Blue Gear qualifies while Blue Programs and non-Blue Gear do not; no extra real-card admission", () => {
    // Explicit synthetic color variant tests the generic guard. It is not a reviewed real card or replay admission.
    const mantis = context.content.cards.find(c => c.id === MANTIS)!;
    const synthetic = CardRevisionSnapshotSchema.parse({ ...mantis, id: "synthetic-blue-gear", printings: [{ ...mantis.printings[0], id: "synthetic-blue-gear-print" }], colors: ["BLUE"], ram: { BLUE: 1 }, provenance: { ...mantis.provenance, source: "Synthetic guard test only", sourceHash: hashCanonical("synthetic-blue-gear") } });
    const ctx = { content: createContentBundle(context.content.ruleset, [...context.content.cards, synthetic], context.content.manifest.engine) };
    const original = bs[blue.steps.findIndex(s => s.action.action.kind === "CALL_LEGEND")];
    for (const [cardId, expected] of [[REBOOT, 0], [SATORI, 0], [synthetic.id, 1]] as const) {
        const draft = GameStateSchema.parse(original), source = Object.values(draft.objects.cards).find(c => c.cardId === SATORI && c.controllerId === active)!;
        const revision = ctx.content.cards.find(c => c.id === cardId)!; source.cardId = revision.id; source.revision = revision.revision;
        // Internal completed-play hook isolated from payment/equip: the headline exercises the full Unit path.
        const m = new TurnMutation(draft, ctx); unwrap(recordPlayedCard(m, source.id)); assert.equal(m.state.turnHistory!.blueUnitOrGearPlays[active], expected);
    }
});

for (const [name, replay] of [["satori-replay", satori], ["defeated-replay", defeated], ["first-blue-replay", blue]] as const) test(`${name}: legal setup, exact golden and Node wire actionId traversal`, () => {
    assert.deepEqual(JSON.parse(readFileSync(`tests/fixtures/${name}.v1.json`, "utf8")), replay);
    let state = replay.initialized.state;
    for (const step of replay.steps) {
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: replay.content, state, actorId: step.actorId, actionId: step.actionId });
        assert.ok(response.ok, JSON.stringify(response)); if (!response.ok || response.value.kind !== "transition") throw new Error("Expected transition");
        assert.deepEqual(response.value.events, step.events); assert.equal(response.value.stateHash, step.stateHash); state = response.value.state;
    }
    assert.deepEqual(state, replay.finalState); assert.equal(state.timing.window, "MAIN"); assert.ok(replay.positions.every(p => p.legalActions.length > 1));
});

test("multiplicity: protected Dexter has no DEFEATED trigger while the truthful Satori win still draws", () => {
    const p = combat(), one = playProgram(p.state), two = playProgram(one.state), result = pass(two.state);
    assert.equal(two.state.fightPreventions!.length, 2);
    assert.notEqual(one.source, two.source);
    assert.equal(result.events.filter(e => e.payload.kind === "FIGHT_PREVENTION_CONSUMED").length, 2);
    assert.equal(result.events.filter(e => e.payload.kind === "FIGHT_DEFEAT_PREVENTED").length, 1);
    assert.equal(result.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.defender), false);
    assert.equal(result.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === p.defender), false);
    assert.equal(draws(result.events).length, 1);
    const single = pass(one.state);
    assert.deepEqual(result.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload, single.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload);
    assert.equal(result.state.objects.cards[p.defender].zone.zone, "BATTLEFIELD");
    assert.ok(pass(p.state).events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p.defender));
});
