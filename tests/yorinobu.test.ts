import { triggersContext } from "./combat-triggers-fixture";
import { satoriReplay } from "./combat-triggers-replay";
import { goroReplay } from "./goro-replay";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type GameState } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, listLegalActions, observe, resolveActionId, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { yorinobuContext, yorinobuInput, yorinobu, YORINOBU, TRUSTED_ARASAKA } from "./yorinobu-fixture";
import { goroContext, GORO } from "./goro-fixture";
import { yorinobuReplay } from "./yorinobu-replay";
import { actions, take, choose, end, finishChoices } from "./delayed-effects-focused";
import { bare, addGear, addUnit, declare, finishAttack, readyAgain } from "./yorinobu-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, processDeparture, moveLegendToFieldWithAttachments } from "../packages/engine/src/card-movement";
import { supportsFirstAttackLegend } from "../packages/engine/src/first-attack-support";
import { qualifiesArasakaAttack } from "../packages/engine/src/first-attack-history";
import { testCondition } from "../packages/engine/src/conditions";
import { triggerChoice } from "../packages/engine/src/trigger-queries";
import { finishAttackEffects } from "../packages/engine/src/combat";
import { unwrap } from "./turn-replay";
import source from "./fixtures/yorinobu-card-source.v1.json";
import rules from "./fixtures/yorinobu-rules.v1.json";
const context = yorinobuContext(), replay = yorinobuReplay(), { actor, rival, host, legend } = replay;
const before = bare(replay.beforeAttack, host, context);
const start = (s: GameState = before) => declare(s, host, context);
const count = (s: GameState, p = actor) => s.turnHistory!.firstArasakaAttacks![p].count;
const yoriPending = (events: ReturnType<typeof start>["events"]) => events.filter(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === legend);
function order(s: GameState, first: typeof host) {
    const i = s.resolution.choice!.options.findIndex(o => o.kind === "EFFECT" && s.resolution.pending.find(e => e.id === o.effectId)?.sourceId === first);
    return choose(s, context, i);
}
function withCred(total: number | null) {
    const s = GameStateSchema.parse(before);
    if (total !== null) {
        const extra = s.objects.gigs[s.players[actor].gigs.FIXER[0]];
        s.players[actor].gigs.FIXER.splice(0, 1); s.players[actor].gigs.GIGS.push(extra.id); extra.location.zone = "GIGS";
    }
    const own = Object.values(s.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS");
    let remaining = total ?? 0;
    for (const [i, g] of own.entries()) {
        if (total === null) { g.location.zone = "FIXER"; g.roll = { kind: "UNROLLED" }; s.players[actor].gigs.GIGS.splice(s.players[actor].gigs.GIGS.indexOf(g.id), 1); s.players[actor].gigs.FIXER.push(g.id); }
        else { const value = Math.min(Number(g.dieType.slice(1)), remaining - (own.length - i - 1)); assert.ok(value >= 1); g.roll = { kind: "ROLLED", initialValue: value, currentValue: value }; remaining -= value; }
    }
    assert.equal(remaining, 0); return unwrap(validateState(s, context));
}
function hiddenSource(s = before) {
    const d = GameStateSchema.parse(s); d.objects.cards[legend].face = "DOWN";
    return unwrap(validateState(d, context));
}

test("Yorinobu complete six-printing capture, classifications, Null statistics and first-before-reveal FAQ are pinned", () => {
    assert.equal(yorinobu.rulesText, "The first time a friendly ARASAKA Unit attacks each turn, draw 1. Then, if you have less than 20 ☆ (Street Cred), discard 1.");
    assert.equal(yorinobu.provenance.sourceHash, hashCanonical(source.record)); assert.equal(source.errata.length, 4); assert.deepEqual(yorinobu.provenance.errata, []);
    assert.equal(yorinobu.printings.length, 6); assert.ok(yorinobu.printings.some(p => p.id === "aaad5db8-fcd4-42f0-8ced-e7527dbccf79" && p.collectorNumber === "001"));
    assert.deepEqual(yorinobu.ram, { RED: 2 }); assert.equal(yorinobu.power, undefined); assert.deepEqual(yorinobu.printedCost, { kind: "DASH" }); assert.deepEqual(yorinobu.tags, ["Arasaka", "Corpo"]);
    assert.ok(supportsFirstAttackLegend(yorinobu, context).ok);
    assert.ok(rules.faqs.some(f => f.id === "61ad63b3-47d9-48ee-a3f6-4c2842b11c66" && f.answer === "No."));
    for (const id of ["3.4.1", "3.13.1", "4.2.1", "9.3", "9.4", "9.5", "9.26", "10.2.3", "10.3.3", "10.16.1", "5.11.4.2", "10.31.1"]) assert.ok(rules.rules.some(r => r.id === id), id);
});
test("headline legally CALLs Yorinobu and Goro, pre-equips Dying, Go Solos and attacks as effective Arasaka Unit", () => {
    assert.equal(replay.calledLegend.objects.cards[legend].face, "UP"); assert.equal(replay.beforeGoSolo.objects.cards[host].zone.zone, "LEGENDS");
    assert.deepEqual(new RulesView(replay.beforeAttack, context).getEffectiveCardTypes(host), ["LEGEND", "UNIT"]);
    assert.equal(new RulesView(replay.beforeAttack, context).getRevision(host)!.id, GORO);
    assert.equal(new RulesView(replay.beforeAttack, context).hasClassification(host, "Arasaka"), true);
    assert.equal(count(replay.beforeAttack), 0); assert.equal(count(replay.pendingOrder), 1); assert.equal(count(replay.afterAttack), 1);
    assert.equal(replay.afterAttack.timing.step, "MAIN"); assert.equal(replay.afterAttack.objects.cards[legend].zone.zone, "LEGENDS");
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "GO_SOLO_ACTIVATED" && e.payload.cardInstanceId === host)));
});
test("Null-cost Yorinobu cannot Go Solo, ordinary field-play, attack or Block", () => {
    const view = new RulesView(before, context);
    assert.equal(view.isAttackEligible(actor, legend), false); assert.equal(view.isBlockerEligible(actor, legend), false);
    assert.equal(actions(before, context).some(a => ["GO_SOLO", "PLAY_CARD", "DECLARE_ATTACK", "DECLARE_BLOCKER"].includes(a.action.kind) && "cardInstanceId" in a.action && a.action.cardInstanceId === legend), false);
    const m = new TurnMutation(before, context); assert.equal(moveLegendToFieldWithAttachments(m, legend, "GO_SOLO").ok, false);
});
test("declaration spends and records the source-independent first immutable attacker before discovering triggers", () => {
    const result = start(), kinds = result.events.map(e => e.payload.kind);
    assert.ok(kinds.indexOf("ATTACK_DECLARED") < kinds.indexOf("EFFECT_PENDING")); assert.equal(result.state.objects.cards[host].readiness, "SPENT");
    assert.deepEqual(result.state.turnHistory!.firstArasakaAttacks![actor], { count: 1, first: { attackerId: host, attacker: { cardId: GORO, revision: 1 } } });
    assert.equal(count(result.state, rival), 0); assert.equal(yoriPending(result.events).length, 1);
});
test("enumeration and target-selection start do not consume history or spend the attacker", () => {
    const added = addUnit(before, "psycho-squad", context, rival), s = GameStateSchema.parse(added.state); s.objects.cards[added.unit].readiness = "SPENT";
    const hash = hashReplayState(s); actions(s, context); actions(s, context); assert.equal(hashReplayState(s), hash);
    const selected = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host);
    assert.equal(selected.state.timing.step, "ATTACK_TARGET_SELECTION"); assert.equal(count(selected.state), 0); assert.equal(selected.state.objects.cards[host].readiness, "READY");
    assert.equal(selected.events.some(e => e.payload.kind === "ATTACK_DECLARED"), false);
    const i = selected.state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD");
    const locked = choose(selected.state, context, i); assert.equal(count(locked.state), 1); assert.equal(yoriPending(locked.events).length, 1);
});
test("FAQ: face-down first attack counts; actual legal CALL before second same-turn attack cannot retroactively trigger", () => {
    const initial = hiddenSource(), first = start(initial); assert.equal(count(first.state), 1); assert.equal(yoriPending(first.events).length, 0);
    let state = finishAttack(first.state, context).state;
    const called = take(state, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === legend); state = finishChoices(called.state, context).state;
    assert.equal(state.objects.cards[legend].face, "UP"); assert.equal(count(state), 1); assert.equal(yoriPending(called.events).length, 0);
    const second = start(readyAgain(state, host, context)); assert.equal(count(second.state), 2); assert.equal(yoriPending(second.events).length, 0); assert.equal(second.state.timing.step, "RIVAL_REACT");
});
test("actual CALL before the first attack activates Yorinobu normally", () => {
    const called = take(hiddenSource(), context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === legend), state = finishChoices(called.state, context).state;
    assert.equal(count(state), 0); assert.equal(yoriPending(start(state).events).length, 1);
});
test("first-attack history exists when neither player has Yorinobu in their physical deck", () => {
    const s = GameStateSchema.parse(before), filler = context.content.cards.find(c => c.id === "dev-legend-red")!;
    for (const c of Object.values(s.objects.cards)) if (c.cardId === YORINOBU) { c.cardId = filler.id; c.revision = filler.revision; }
    const result = start(unwrap(validateState(s, context))); assert.equal(count(result.state), 1); assert.equal(yoriPending(result.events).length, 0);
});
test("second qualifying attack by the same Unit retains the first identity and never repeats Yorinobu", () => {
    const first = start(), done = finishAttack(first.state, context).state, second = start(readyAgain(done, host, context));
    assert.equal(count(second.state), 2); assert.equal(yoriPending(second.events).length, 0);
    assert.deepEqual(second.state.turnHistory!.firstArasakaAttacks![actor].first, first.state.turnHistory!.firstArasakaAttacks![actor].first);
});
test("printed Arasaka Unit qualifies independently of its name; another qualifying Unit later does not retrigger", () => {
    const a = addUnit(before, "psycho-squad", context), s = GameStateSchema.parse(a.state), fixture = context.content.cards.find(c => c.id === TRUSTED_ARASAKA)!;
    s.objects.cards[a.unit].cardId = fixture.id; s.objects.cards[a.unit].revision = fixture.revision;
    const first = declare(unwrap(validateState(s, context)), a.unit, context); assert.equal(yoriPending(first.events).length, 1);
    const second = start(finishAttack(first.state, context).state); assert.equal(count(second.state), 2); assert.equal(yoriPending(second.events).length, 0);
    assert.equal(second.state.turnHistory!.firstArasakaAttacks![actor].first!.attackerId, a.unit);
});
test("friendly non-Arasaka Psycho attacks first without consuming history; later Goro qualifies", () => {
    const a = addUnit(before, "psycho-squad", context), first = declare(a.state, a.unit, context); assert.equal(count(first.state), 0); assert.equal(yoriPending(first.events).length, 0);
    const second = start(finishAttack(first.state, context).state); assert.equal(count(second.state), 1); assert.equal(yoriPending(second.events).length, 1);
});
test("friendly classification uses controller rather than owner for a printed Unit", () => {
    const a = addUnit(before, "psycho-squad", context), s = GameStateSchema.parse(a.state), fixture = context.content.cards.find(c => c.id === TRUSTED_ARASAKA)!;
    s.objects.cards[a.unit].ownerId = rival; s.objects.cards[a.unit].cardId = fixture.id;
    const result = declare(unwrap(validateState(s, context)), a.unit, context); assert.equal(count(result.state), 1); assert.equal(count(result.state, rival), 0); assert.equal(yoriPending(result.events).length, 1);
});
test("classification is exact metadata, not deck membership, display name, CardId substring or Gear", () => {
    const view = new RulesView(before, context); assert.equal(view.hasClassification(host, "ARASAKA"), false); assert.equal(view.hasClassification(host, "Arasaka"), true);
    for (const id of ["psycho-squad", "corpo-security", "emergency-atlus"]) { const a = addUnit(before, id, context); assert.equal(qualifiesArasakaAttack(a.state, a.unit, context), false); }
    const a = addUnit(before, "psycho-squad", context), geared = addGear(a.state, a.unit, "satori-sword-of-saburo", context);
    assert.equal(qualifiesArasakaAttack(geared.state, a.unit, context), false);
});
for (const gear of ["mantis-blades", "satori-sword-of-saburo", "mandibular-upgrade"]) test("Goro qualifies identically with " + gear, () => {
    const added = addGear(before, host, gear, context); assert.equal(qualifiesArasakaAttack(added.state, host, context), true); assert.equal(yoriPending(start(added.state).events).length, 1);
});
test("draw precedes threshold evaluation and strategic discard; drawn card is a legal own-hand option", () => {
    const result = start(), p = result.events.map(e => e.payload), draw = p.findIndex(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK" && e.to.zone === "HAND"), condition = p.findIndex(e => e.kind === "CONDITION_EVALUATED");
    assert.ok(draw >= 0 && condition > draw); const drawn = p[draw]; assert.ok(drawn.kind === "CARD_MOVED");
    const s = result.state; assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.resolution.current!.primitiveIndex, 1);
    assert.equal(s.resolution.choice!.actorId, actor); assert.equal(s.resolution.triggerContinuation!.conditionMet, true);
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "CARD" && o.cardInstanceId === drawn.cardInstanceId));
    const next = choose(s, context, s.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === drawn.cardInstanceId));
    assert.equal(next.state.objects.cards[drawn.cardInstanceId].zone.zone, "TRASH");
    const kinds = next.events.map(e => e.payload.kind); assert.ok(kinds.indexOf("CARD_DISCARDED") < kinds.indexOf("EFFECT_RESOLVED")); assert.equal(next.state.timing.step, "RIVAL_REACT");
});
for (const total of [19, 20, 21, null]) test("absolute Street Cred threshold at " + total + " uses current Null-aware ordering", () => {
    const result = start(withCred(total)), expected = total === null || total < 20;
    assert.equal(result.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === expected), true);
    assert.equal(result.state.timing.step, expected ? "DISCARD_SELECTION" : "RIVAL_REACT");
    assert.equal(result.state.players[actor].zones.HAND.length, before.players[actor].zones.HAND.length + 1);
});
test("Null is below zero, not numerically coerced to zero", () => {
    assert.equal(testCondition(withCred(null), actor, { kind: "STREET_CRED_LESS_THAN_VALUE", value: 0 }, context), true);
});
test("empty pre-draw hand forces auto-discard of the drawn card without a fake decision", () => {
    const m = new TurnMutation(before, context); for (const id of [...m.state.players[actor].zones.HAND]) moveCardLocation(m, id, "TRASH");
    const top = m.state.players[actor].zones.DECK[0], result = start(unwrap(validateState(m.state, context)));
    assert.equal(result.state.objects.cards[top].zone.zone, "TRASH"); assert.equal(result.state.resolution.choice, null); assert.equal(result.state.timing.step, "RIVAL_REACT");
    assert.ok(result.events.some(e => e.payload.kind === "CARD_DISCARDED" && e.payload.forced));
});
test("empty-deck draw loss stops condition/discard but retains the first-attack history", () => {
    const m = new TurnMutation(before, context); for (const id of [...m.state.players[actor].zones.DECK]) moveCardLocation(m, id, "TRASH");
    const result = start(unwrap(validateState(m.state, context))); assert.equal(result.state.match.outcome?.reason, "EMPTY_DRAW"); assert.equal(count(result.state), 1);
    assert.equal(result.events.some(e => ["CONDITION_EVALUATED", "CARD_DISCARDED"].includes(e.payload.kind)), false); assert.ok(validateState(result.state, context).ok);
});
for (const gear of ["dying-night-v-s-pistol", "kiroshi-optics"]) for (const yoriFirst of [true, false]) test(gear + " and Yorinobu order " + yoriFirst + " through one shared batch without interleaving", () => {
    const added = addGear(before, host, gear, context), initial = start(added.state).state;
    assert.equal(initial.resolution.pending.length, 2); const selected = order(initial, yoriFirst ? legend : added.gear);
    let state = selected.state; const events = [...selected.events];
    if (yoriFirst) { assert.equal(state.timing.step, "DISCARD_SELECTION"); assert.equal(state.resolution.pending.length, 1); assert.equal(state.resolution.current!.sourceId, legend); }
    while (state.resolution.choice) { const next = choose(state, context); state = next.state; events.push(...next.events); }
    assert.equal(state.timing.step, "RIVAL_REACT"); assert.equal(count(state), 1);
    const payloads = events.map(e => e.payload), discard = payloads.findIndex(e => e.kind === "CARD_DISCARDED"), draw = payloads.findIndex(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK" && e.to.zone === "HAND");
    assert.ok(discard > draw); assert.equal(payloads.slice(draw + 1, discard).some(e => e.kind === "TRIGGER_ORDER_SELECTED"), false);
    if (gear === "kiroshi-optics") { assert.equal(state.privateKnowledge?.length, 1); const secret = state.privateKnowledge![0]; const own = JSON.stringify(unwrap(observe(state, actor, context))), other = JSON.stringify(unwrap(observe(state, rival, context))); assert.ok(own.includes(secret.content.cardId)); assert.equal(other.includes('"inspectedCards"'), false); }
});
test("condition is evaluated after earlier Dying adjustment, not snapshotted at attack declaration", () => {
    const added = addGear(withCred(20), host, "dying-night-v-s-pistol", context), initial = start(added.state).state;
    const selected = order(initial, added.gear).state;
    const target = Object.values(selected.objects.gigs).find(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue > 1)!;
    const targeted = choose(selected, context, selected.resolution.choice!.options.findIndex(o => o.kind === "GIG" && o.gigInstanceId === target.id)).state;
    const decreased = choose(targeted, context, targeted.resolution.choice!.options.findIndex(o => o.kind === "AMOUNT" && o.amount === 1));
    assert.equal(new RulesView(decreased.state, context).getStreetCred(actor), 19); assert.equal(decreased.state.timing.step, "DISCARD_SELECTION");
});
test("history remains after Blocker, combat cleanup and defeat/removal of Goro", () => {
    const m = new TurnMutation(before, context), other = m.state.players[rival].zones.LEGENDS.find(id => m.state.objects.cards[id].cardId === GORO)!;
    m.state.objects.cards[other].face = "UP"; unwrap(moveLegendToFieldWithAttachments(m, other, "GO_SOLO"));
    const declared = start(unwrap(validateState(m.state, context))), triggers = finishChoices(declared.state, context), blocked = take(triggers.state, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === other);
    assert.equal(count(blocked.state), 1); const done = finishAttack(blocked.state, context).state;
    assert.equal(done.objects.cards[host].zone.zone, "REMOVED"); assert.equal(count(done), 1); assert.ok(validateState(done, context).ok);
});
test("trusted post-trigger attacker departure ends combat without rolling back declaration history", () => {
    const completed = finishChoices(start().state, context).state, m = new TurnMutation(completed, context);
    unwrap(processDeparture(m, host, "TRASH")); const combat = m.state.timing.combat; assert.ok("target" in combat && combat.target); m.state.timing.combat = { ...combat, target: combat.target, stage: "ATTACK_EFFECTS" };
    unwrap(finishAttackEffects(m)); const result = unwrap(m.result()); assert.equal(result.state.timing.step, "MAIN"); assert.equal(count(result.state), 1); assert.equal(result.state.objects.cards[host].zone.zone, "REMOVED");
});
test("next global startTurn resets both counters; another natural Goro attack triggers again", () => {
    assert.equal(replay.reset.timing.turn, replay.afterAttack.timing.turn + 1); assert.equal(count(replay.reset), 0); assert.equal(count(replay.reset, rival), 0);
    assert.equal(count(replay.finalState), 1); assert.equal(replay.finalState.timing.turn, 7);
    assert.equal(replay.steps.flatMap(s => s.events).filter(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === legend).length, 2);
});
test("public history is visible with Yorinobu hidden without disclosing hidden identity", () => {
    const initial = hiddenSource(), after = start(initial).state;
    for (const player of [actor, rival]) { const obs = unwrap(observe(after, player, context)); assert.deepEqual(obs.turnAttacks, [{ seat: 0, arasakaUnitAttacks: 1 }, { seat: 1, arasakaUnitAttacks: 0 }]); const card = obs.players.flatMap(p => p.cards).find(c => c.publicId === legend); assert.equal(card?.content, undefined); assert.notEqual(hashObservation(obs), hashObservation(unwrap(observe(initial, player, context)))); }
});
test("same-board history difference changes POSITION_V2, both observation hashes and action IDs", () => {
    const consumed = GameStateSchema.parse(before); consumed.turnHistory!.firstArasakaAttacks![actor] = { count: 1, first: { attackerId: host, attacker: { cardId: before.objects.cards[host].cardId, revision: before.objects.cards[host].revision } } };
    unwrap(validateState(consumed, context)); assert.notEqual(hashPosition(consumed), hashPosition(before));
    for (const player of [actor, rival]) assert.notEqual(hashObservation(unwrap(observe(consumed, player, context))), hashObservation(unwrap(observe(before, player, context))));
    assert.notDeepEqual(actions(consumed, context).map(a => a.actionId), actions(before, context).map(a => a.actionId));
});
test("transport counters never affect history, canonical position, observations or action IDs", () => {
    const s = GameStateSchema.parse(replay.pendingDiscard); s.match.version = GameStateVersionSchema.parse(999); s.match.eventSequence = GameEventSequenceSchema.parse(999);
    for (const e of [...s.resolution.pending, ...(s.resolution.current ? [s.resolution.current] : [])]) e.causedBySequence = 998;
    assert.equal(hashPosition(s), hashPosition(replay.pendingDiscard)); assert.notEqual(hashReplayState(s), hashReplayState(replay.pendingDiscard)); assert.deepEqual(actions(s, context), actions(replay.pendingDiscard, context));
});
test("discard accepts only enumerated controller actions and survives wire/training serialization", () => {
    for (const s of [replay.beforeGoSolo, replay.pendingOrder, replay.pendingDiscard, replay.beforeReact]) {
        const legal = actions(s, context), p = unwrap(generatePosition(s, s.timing.actingPlayer, context, "yorinobu-wire")); assert.ok(validateTrainingPosition(p, context).ok); assert.ok(legal.length > 1);
        assert.equal(JSON.stringify(modelInput(p)).includes(s.rng.seed), false); unwrap(resolveActionId(s, s.timing.actingPlayer, legal[0].actionId, context));
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: context.content, state: s, actorId: s.timing.actingPlayer, actionId: legal[0].actionId }); assert.ok(response.ok && response.value.kind === "transition");
        assert.deepEqual(response.value.state, unwrap(applyAction(s, { actorId: legal[0].actorId, action: legal[0].action }, context)).state);
    }
    const s = replay.pendingDiscard; assert.deepEqual(unwrap(listLegalActions(s, rival, context)), []); assert.equal(applyAction(s, { actorId: rival, action: actions(s, context)[0].action }, context).ok, false);
});
for (const change of ["missing-policy", "wrong-scope", "extra-ability", "extra-keyword", "extra-modifier", "wrong-cost", "wrong-power", "wrong-ram", "missing-ram", "wrong-tags", "wrong-color", "wrong-guard", "wrong-threshold", "wrong-order", "unreviewed"] as const) test("complete first-attack metadata rejects " + change, () => {
    const card = CardRevisionSnapshotSchema.parse(yorinobu), ruleset = structuredClone(context.content.ruleset);
    if (change === "missing-policy") delete ruleset.gameplay!.turnSlice!.firstAttackHistory;
    if (change === "wrong-scope") card.execution!.scope = "COMBAT_TRIGGERS_V1";
    if (change === "extra-ability") card.mechanics.abilities.push({ id: "extra", trigger: "WHEN_CALLED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] });
    if (change === "extra-keyword") card.mechanics.keywords.push("GO_SOLO");
    if (change === "extra-modifier") card.mechanics.modifiers.push({ kind: "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN", amount: 2 });
    if (change === "wrong-cost") card.printedCost = { kind: "EDDIES", amount: 0 };
    if (change === "wrong-power") card.power = 0;
    if (change === "wrong-ram") card.ram = { RED: 3 };
    if (change === "missing-ram") delete card.ram;
    if (change === "wrong-tags") card.tags = ["ARASAKA", "Corpo"];
    if (change === "wrong-color") card.colors = ["GREEN"];
    if (change === "wrong-guard") card.mechanics.abilities[0].guard = "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN";
    if (change === "wrong-threshold") { const e = card.mechanics.abilities[0].effects[1]; assert.ok(e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "STREET_CRED_LESS_THAN_VALUE"); e.when.condition.value = 19; }
    if (change === "wrong-order") card.mechanics.abilities[0].effects.reverse();
    if (change === "unreviewed") { card.provenance.reviewed = false; assert.equal(supportsFirstAttackLegend(card, context).ok, false); return; }
    const ctx = { content: createContentBundle(ruleset, context.content.cards.map(c => c.id === YORINOBU ? card : c), context.content.manifest.engine) };
    assert.equal(supportsFirstAttackLegend(card, ctx).ok, false); assert.equal(createGameWithEvents(yorinobuInput("reject"), ctx).ok, false);
});
for (const mutation of ["missing", "wrong-turn", "missing-player", "extra-player", "negative", "zero-first", "positive-null", "wrong-ref", "wrong-attacker", "duplicate-first"] as const) test("external first-attack history rejects " + mutation, () => {
    const s = GameStateSchema.parse(replay.afterAttack), h = s.turnHistory!.firstArasakaAttacks!;
    if (mutation === "missing") delete s.turnHistory!.firstArasakaAttacks;
    if (mutation === "wrong-turn") s.turnHistory!.turn--;
    if (mutation === "missing-player") delete h[rival];
    if (mutation === "extra-player") Object.assign(h, { [randomUUID()]: { count: 0, first: null } });
    if (mutation === "negative") h[actor].count = -1;
    if (mutation === "zero-first") h[actor].count = 0;
    if (mutation === "positive-null") h[actor].first = null;
    if (mutation === "wrong-ref") h[actor].first!.attacker.cardId = yorinobu.id;
    if (mutation === "wrong-attacker") h[actor].first!.attackerId = legend;
    if (mutation === "duplicate-first") h[rival] = structuredClone(h[actor]);
    assert.equal(validateState(s, context).ok, false);
});
for (const mutation of ["source-down", "source-field", "origin", "history", "primitive", "condition", "options", "controller", "extra-binding"] as const) test("pending Yorinobu continuation rejects " + mutation, () => {
    const s = GameStateSchema.parse(replay.pendingDiscard), c = s.resolution.triggerContinuation!;
    if (mutation === "source-down") s.objects.cards[legend].face = "DOWN";
    if (mutation === "source-field") { const m = new TurnMutation(s, context); moveCardLocation(m, legend, "BATTLEFIELD"); assert.equal(validateState(m.state, context).ok, false); return; }
    if (mutation === "origin") c.origin = { kind: "ATTACK", subjectId: legend };
    if (mutation === "history") s.turnHistory!.firstArasakaAttacks![actor].count = 2;
    if (mutation === "primitive") delete s.resolution.current!.primitiveIndex;
    if (mutation === "condition") delete c.conditionMet;
    if (mutation === "options") s.resolution.choice!.options.reverse();
    if (mutation === "controller") s.resolution.current!.controllerId = rival;
    if (mutation === "extra-binding") c.bindings.push(structuredClone(c.bindings[0]));
    assert.equal(validateState(s, context).ok, false);
});
test("old scopes reject new history and hidden first-attack metadata rather than silently ignoring it", () => {
    const old = goroContext(), s = GameStateSchema.parse(before);
    assert.equal(supportsFirstAttackLegend(yorinobu, old).ok, false); assert.equal(validateState(s, old).ok, false);
    const ruleset = structuredClone(context.content.ruleset); delete ruleset.gameplay!.turnSlice!.firstAttackHistory;
    const ctx = { content: createContentBundle(ruleset, context.content.cards, context.content.manifest.engine) };
    assert.equal(createGameWithEvents(yorinobuInput("old"), ctx).ok, false);
});
test("constructed Legend identity forbids duplicate Yorinobu; malformed physical duplication is rejected", () => {
    const input = yorinobuInput("duplicate"), deck = { ...input.decks[0], legends: [YORINOBU, YORINOBU, "yorinobu-fixture-blue-yellow-support"] };
    assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
    const s = GameStateSchema.parse(before), other = s.players[actor].zones.LEGENDS.find(id => id !== legend)!; s.objects.cards[other].cardId = yorinobu.id; s.objects.cards[other].revision = yorinobu.revision; assert.equal(validateState(s, context).ok, false);
});
test("constructed sizes/RAM/copies and all 43 previous immutable card revisions remain unchanged", () => {
    const old = goroContext(); assert.equal(old.content.cards.length, 43); for (const card of old.content.cards) assert.deepEqual(context.content.cards.find(c => c.id === card.id && c.revision === card.revision), card);
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 }); const input = yorinobuInput("format"); assert.ok(createGameWithEvents(input, context).ok);
    for (const deck of [{ ...input.decks[0], main: input.decks[0].main.slice(0, 27) }, { ...input.decks[0], main: [...input.decks[0].main, "psycho-squad"] }, { ...input.decks[0], legends: input.decks[0].legends.slice(0, 2) }, { ...input.decks[0], legends: input.decks[0].legends.map(id => id === "yorinobu-fixture-blue-yellow-support" ? "dev-legend-red" : id) }]) assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
});
test("Yorinobu golden replay is exact and all training positions are genuine strategic choices", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/yorinobu-replay.v1.json", import.meta.url), "utf8")), replay);
    assert.ok(replay.positions.every(p => p.legalActions.length > 1)); assert.ok(replay.positions.some(p => p.observation.step === "DISCARD_SELECTION"));
    assert.deepEqual(triggerChoice(replay.pendingDiscard, context), replay.pendingDiscard.resolution.choice);
});

test("rival turn's qualifying Goro attack records only the rival history", () => {
    const ended = end(before, context), rolled = take(ended.state, context, a => a.action.kind === "ROLL_GIG"), m = new TurnMutation(rolled.state, context);
    const enemy = m.state.players[rival].zones.LEGENDS.find(id => m.state.objects.cards[id].cardId === GORO)!;
    m.state.objects.cards[enemy].face = "UP"; unwrap(moveLegendToFieldWithAttachments(m, enemy, "GO_SOLO"));
    const result = declare(unwrap(validateState(m.state, context)), enemy, context);
    assert.equal(count(result.state, rival), 1); assert.equal(count(result.state), 0); assert.equal(yoriPending(result.events).length, 0);
});
test("external state cannot omit history for an already declared hidden-source attack", () => {
    const result = start(hiddenSource()), s = GameStateSchema.parse(result.state); s.turnHistory!.firstArasakaAttacks![actor] = { count: 0, first: null };
    assert.equal(validateState(s, context).ok, false);
});
test("external state cannot drop Yorinobu from a simultaneous captured attack batch", () => {
    const s = GameStateSchema.parse(replay.pendingOrder), c = s.resolution.triggerContinuation!;
    const missing = s.resolution.pending.find(e => e.sourceId === legend)!;
    s.resolution.pending = s.resolution.pending.filter(e => e.id !== missing.id); c.bindings = c.bindings.filter(b => b.sourceId !== legend);
    assert.equal(validateState(s, context).ok, false);
});
test("history player key cannot claim the rival's unique first attacker", () => {
    const s = GameStateSchema.parse(replay.afterAttack), h = s.turnHistory!.firstArasakaAttacks!;
    h[rival] = structuredClone(h[actor]); h[actor] = { count: 0, first: null }; assert.equal(validateState(s, context).ok, false);
});
test("Satori is a later fight-win trigger and never joins Yorinobu's ATTACK batch", () => {
    const target = addUnit(before, "psycho-squad", context, rival), s = GameStateSchema.parse(target.state); s.objects.cards[target.unit].readiness = "SPENT";
    const added = addGear(s, host, "satori-sword-of-saburo", context), declared = declare(added.state, host, context, target.unit);
    assert.equal(declared.state.resolution.current?.sourceId, legend); assert.equal(declared.state.resolution.pending.length, 0);
    assert.equal(declared.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === added.gear), false);
    const done = finishAttack(declared.state, context), p = done.events.map(e => e.payload);
    assert.ok(p.findIndex(e => e.kind === "FIGHT_RESULT") < p.findIndex(e => e.kind === "EFFECT_PENDING" && e.sourceId === added.gear));
    assert.ok(p.some(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK" && e.to.zone === "HAND")); assert.equal(count(done.state), 1);
});
for (const program of ["floor-it", "reboot-optics"]) test(program + " is available only after complete Yorinobu resolution", () => {
    const m = new TurnMutation(before, context), card = Object.values(m.state.objects.cards).find(c => c.controllerId === rival && c.cardId === (program === "floor-it" ? "slice-card-2" : program))!;
    if (program === "floor-it") { const revision = context.content.cards.find(c => c.id === program)!; card.cardId = revision.id; card.revision = revision.revision; }
    moveCardLocation(m, card.id, "HAND"); for (const id of m.state.players[rival].zones.LEGENDS) m.state.objects.cards[id].readiness = "READY";
    const waiting = start(unwrap(validateState(m.state, context))).state;
    assert.equal(applyAction(waiting, { actorId: rival, action: { kind: "PLAY_CARD", cardInstanceId: card.id } }, context).ok, false);
    const react = choose(waiting, context).state, played = take(react, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === card.id), settled = finishChoices(played.state, context);
    assert.equal(settled.state.timing.step, "RIVAL_REACT"); assert.equal(count(settled.state), 1); assert.equal(settled.state.resolution.triggerContinuation, undefined);
    const done = finishAttack(settled.state, context); assert.equal(count(done.state), 1);
});

test("old-policy valid state rejects added history with the specific unsupported-history error", () => {
    const old = goroContext(), s = GameStateSchema.parse(goroReplay().fieldEntry);
    s.turnHistory!.firstArasakaAttacks = Object.fromEntries(s.match.playerOrder.map(p => [p, { count: 0, first: null }]));
    const result = validateState(s, old); assert.equal(result.ok, false); if (!result.ok) assert.ok(result.errors.some(e => e.code === "UNSUPPORTED_FIRST_ATTACK_HISTORY"));
});
test("END_TURN strategic effects retain attack history until the actual next startTurn", () => {
    const m = new TurnMutation(replay.afterAttack, context), c = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.zone.zone === "DECK" && c.cardId === "psycho-squad")!;
    const delamain = context.content.cards.find(c => c.id === "delamain-cab")!; c.cardId = delamain.id; c.revision = delamain.revision;
    moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "SPENT";
    m.state.turnHistory!.gigsStolenByUnit = { ...m.state.turnHistory!.gigsStolenByUnit, [c.id]: 1 };
    for (const id of m.state.players[actor].zones.EDDIES) m.state.objects.cards[id].readiness = "SPENT";
    const started = end(unwrap(validateState(m.state, context)), context).state; assert.equal(count(started), 1);
    const ending = started.timing.step === "TRIGGER_ORDER_SELECTION" ? order(started, c.id).state : started; assert.equal(ending.timing.step, "EDDIE_READY_SELECTION"); assert.equal(count(ending), 1); assert.equal(ending.timing.turn, replay.afterAttack.timing.turn);
    const next = choose(ending, context).state; assert.equal(count(next), 0); assert.equal(next.timing.turn, ending.timing.turn + 1);
});
test("hidden Yorinobu identity and rival hand changes cannot leak through public history or own legal action IDs", () => {
    const initial = hiddenSource(), result = start(initial).state;
    for (const viewer of [actor, rival]) { const obs = unwrap(observe(result, viewer, context)); assert.equal(JSON.stringify(obs).includes(YORINOBU), false); assert.deepEqual(Object.keys(obs.turnAttacks![0]).sort(), ["arasakaUnitAttacks", "seat"]); }
    const s = GameStateSchema.parse(replay.pendingDiscard), hand = s.players[rival].zones.HAND[0], deck = s.players[rival].zones.DECK.find(id => s.objects.cards[id].cardId !== s.objects.cards[hand].cardId)!;
    [s.objects.cards[hand].cardId, s.objects.cards[deck].cardId] = [s.objects.cards[deck].cardId, s.objects.cards[hand].cardId];
    [s.objects.cards[hand].revision, s.objects.cards[deck].revision] = [s.objects.cards[deck].revision, s.objects.cards[hand].revision];
    unwrap(validateState(s, context)); assert.deepEqual(actions(s, context), actions(replay.pendingDiscard, context)); assert.deepEqual(unwrap(observe(s, actor, context)), unwrap(observe(replay.pendingDiscard, actor, context)));
});

/** Isolated policy bundle: no Kiroshi/Evelyn/Delamain/Dying/V/Goro admission to accidentally supply behavior. */
function independentFirstAttack() {
    const base = triggersContext(), ruleset = structuredClone(base.content.ruleset); ruleset.gameplay!.turnSlice!.firstAttackHistory = "FIRST_ATTACK_HISTORY_V1";
    const unit = context.content.cards.find(c => c.id === TRUSTED_ARASAKA)!;
    const ctx = { content: createContentBundle(ruleset, [...base.content.cards, yorinobu, unit], base.content.manifest.engine) }, s = GameStateSchema.parse(satoriReplay().finalState);
    s.match.contentManifestHash = ctx.content.manifestHash; s.match.rulesetHash = ctx.content.manifest.ruleset.hash; s.match.cards = ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    s.turnHistory!.firstArasakaAttacks = Object.fromEntries(s.match.playerOrder.map(p => [p, { count: 0, first: null }]));
    const player = s.timing.activePlayer, source = s.players[player].zones.LEGENDS.find(id => s.objects.cards[id].cardId === "dev-legend-red")!;
    s.objects.cards[source].cardId = yorinobu.id; s.objects.cards[source].revision = yorinobu.revision; s.objects.cards[source].face = "UP";
    const attacker = s.players[player].zones.BATTLEFIELD.find(id => s.objects.cards[id].cardId === "swordwise-huscle")!;
    assert.ok(attacker); s.objects.cards[attacker].readiness = "READY";
    return { context: ctx, state: unwrap(validateState(s, ctx)), source, attacker, player, unit };
}
test("first-attack policy alone preserves Swordwise's older conditional ATTACK draw", () => {
    const f = independentFirstAttack(), result = declare(f.state, f.attacker, f.context);
    assert.equal(result.state.timing.step, "RIVAL_REACT"); assert.ok(result.events.some(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND"));
    assert.equal(result.state.turnHistory!.firstArasakaAttacks![f.player].count, 0);
});
test("first-attack policy alone protects action IDs from rival secrets and supports ordered discard", () => {
    const f = independentFirstAttack(), s = GameStateSchema.parse(f.state); s.objects.cards[f.attacker].cardId = f.unit.id; s.objects.cards[f.attacker].revision = f.unit.revision;
    const result = declare(unwrap(validateState(s, f.context)), f.attacker, f.context); assert.equal(result.state.timing.step, "DISCARD_SELECTION");
    const altered = GameStateSchema.parse(result.state), enemy = altered.match.playerOrder.find(id => id !== f.player)!, hand = altered.players[enemy].zones.HAND[0], deck = altered.players[enemy].zones.DECK.find(id => altered.objects.cards[id].cardId !== altered.objects.cards[hand].cardId)!;
    [altered.objects.cards[hand].cardId, altered.objects.cards[deck].cardId] = [altered.objects.cards[deck].cardId, altered.objects.cards[hand].cardId];
    [altered.objects.cards[hand].revision, altered.objects.cards[deck].revision] = [altered.objects.cards[deck].revision, altered.objects.cards[hand].revision];
    unwrap(validateState(altered, f.context)); assert.notEqual(hashPosition(altered), hashPosition(result.state)); assert.deepEqual(actions(altered, f.context), actions(result.state, f.context));
});
