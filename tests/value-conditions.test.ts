import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type GameState } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, observe, resolveActionId, RulesView, validateState } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { valueContext, valueInput, valueCards, INDUSTRIAL, FIELD_OPERATOR } from "./value-conditions-fixture";
import { valueConditionsReplay } from "./value-conditions-replay";
import { withGigs, placeCard, playCard, pick, resolveIndustrial } from "./value-conditions-focused";
import { saburoContext } from "./saburo-fixture";
import { actions, take, end } from "./delayed-effects-focused";
import { declare, finishAttack } from "./yorinobu-focused";
import { AFTERPARTY } from "./noncombat-fixture";
import { JACKIE } from "./combat-triggers-fixture";
import { triggersContext } from "./combat-triggers-fixture";
import { satoriReplay } from "./combat-triggers-replay";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { transferGigs } from "../packages/engine/src/gig-transfer";
import { changeGigValue, gigAdjustmentOptions } from "../packages/engine/src/gig-value";
import { supportsValueConditionCard } from "../packages/engine/src/value-conditions-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { unwrap } from "./turn-replay";
import source from "./fixtures/value-conditions-card-sources.v1.json";
import rules from "./fixtures/value-conditions-rules.v1.json";
const context = valueContext(), replay = valueConditionsReplay(), { actor, rival } = replay, before = replay.beforeIndustrial;
const industrial = valueCards.find(c => c.id === INDUSTRIAL)!, operator = valueCards.find(c => c.id === FIELD_OPERATOR)!;
const condition = (s: GameState) => new RulesView(s, context).isStreetCredEven(actor);
const threshold = (s: GameState) => new RulesView(s, context).hasControlledGigWithCurrentValueAtLeast(actor, 8);
const drawn = (events: ReturnType<typeof playCard>["events"]) => events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND");
const changes = (events: ReturnType<typeof playCard>["events"]) => events.filter(e => e.payload.kind === "GIG_VALUE_CHANGED");
const gid = (s: GameState, id: string) => Object.values(s.objects.gigs).find(g => g.id === id)!.id;

test("complete Industrial and Field Operator captures, all11 printings and all4 errata are pinned", () => {
    assert.equal(industrial.rulesText, "Increase a Gig by up to 4. If you control a Gig with 8+ value, draw 1.");
    assert.equal(operator.rulesText, "{Play} If your ☆ (Street Cred) is an even number, draw 1.");
    for (const card of valueCards) { const raw = source.records.find(r => r.record.slug === card.id)!; assert.equal(card.provenance.sourceHash, hashCanonical(raw.record)); assert.deepEqual(card.provenance.errata, []); assert.ok(supportsValueConditionCard(card, context).ok); assert.deepEqual(card.keywords, []); assert.deepEqual(card.mechanics.keywords, []); }
    assert.equal(source.errata.length, 4); assert.equal(industrial.printings.length, 6); assert.equal(operator.printings.length, 5);
    assert.ok(industrial.printings.some(p => p.id === "7f0ad31f-3b16-4c7a-88bb-90dd07e55a9b" && p.collectorNumber === "006"));
    assert.ok(operator.printings.some(p => p.id === "45ae40b9-f0f3-4fd9-901a-cd1bed292133" && p.collectorNumber === "012"));
    assert.deepEqual(industrial.ram, { RED: 1 }); assert.equal(industrial.power, undefined); assert.equal(industrial.sellProfile.allowed, true); assert.deepEqual(industrial.tags, ["Arasaka", "Braindance"]);
    assert.deepEqual(operator.ram, { GREEN: 2 }); assert.equal(operator.power, 2); assert.equal(operator.sellProfile.allowed, false); assert.deepEqual(operator.tags, ["Arasaka", "Corpo", "Techie"]);
});
test("rules and official FAQs explicitly pin zero, rival targets, Null parity and resolution order", () => {
    for (const id of ["2.3", "2.4", "2.8", "2.10.2", "4.6", "4.7", "4.14.2", "5.11.4.1", "6.3.3", "6.4.4", "6.4.5", "10.2.3", "10.3.3", "10.31.1", "11.2.3", "11.20.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.ok(rules.faqs.some(f => f.id === "ad3b75f8-1401-485f-891d-7e54fdbfe30f" && f.answer.startsWith("Yes, but")));
    assert.ok(rules.faqs.some(f => f.id === "2f4ce47f-25ba-4321-a673-809fc8f75bd7" && f.answer === "Yes."));
    assert.ok(rules.faqs.some(f => f.id === "e83fc5f6-3649-4162-9415-f1ff3fde56ed" && f.answer === "No."));
});
test("legal headline uses public target/amount choices, crosses threshold and changes parity before ordinary Unit PLAY", () => {
    assert.equal(condition(before), false); assert.equal(threshold(before), false); assert.equal(condition(replay.afterIndustrial), true); assert.equal(threshold(replay.afterIndustrial), true);
    assert.equal(replay.pendingTarget.timing.step, "TARGET_SELECTION"); assert.equal(replay.pendingAmount.timing.step, "AMOUNT_SELECTION");
    assert.ok(actions(replay.pendingTarget, context).length > 1); assert.ok(actions(replay.pendingAmount, context).length > 1);
    const s = replay.finalState; assert.equal(s.objects.cards[replay.operator].readiness, "READY"); assert.ok(s.objects.cards[replay.operator].statuses.includes("LAG")); assert.equal(s.timing.step, "MAIN"); assert.equal(s.resolution.current, null);
    assert.equal(new RulesView(s, context).getEffectivePower(replay.operator), 2); assert.equal(new RulesView(s, context).isAttackEligible(actor, replay.operator), false);
});
test("Industrial condition follows actual6→8 adjustment, and retained initial roll does not decide it", () => {
    const s = withGigs(before, context, { "p0-D8": 6, "p1-D4": 2 }); assert.equal(threshold(s), false);
    const result = resolveIndustrial(s, context, "p0-D8", 2), p = result.events.map(e => e.payload);
    assert.deepEqual(result.state.objects.gigs[gid(s, "p0-D8")].roll, { kind: "ROLLED", initialValue: 1, currentValue: 8 });
    assert.equal(drawn(result.events).length, 1); assert.ok(p.findIndex(e => e.kind === "GIG_VALUE_CHANGED") < p.findIndex(e => e.kind === "CONDITION_EVALUATED"));
    assert.ok(p.findIndex(e => e.kind === "CONDITION_EVALUATED") < p.findIndex(e => e.kind === "CARD_MOVED" && e.from.zone === "DECK"));
    assert.equal(new RulesView(result.state, context).getStreetCred(actor), 8); assert.equal(condition(result.state), true);
});
for (const [value, expected] of [[7, false], [8, true], [9, true], [12, true]] as const) test("Industrial current controlled threshold " + value + " is " + expected, () => {
    const s = withGigs(before, context, { "p0-D12": value, "p1-D4": 2 }), result = resolveIndustrial(s, context, "p1-D4", 0);
    assert.equal(threshold(s), expected); assert.equal(drawn(result.events).length, expected ? 1 : 0); assert.ok(result.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === expected));
});
test("a different controlled Gig can satisfy draw while Industrial increases a rival Gig", () => {
    const result = resolveIndustrial(withGigs(before, context, { "p0-D12": 8, "p1-D8": 6 }), context, "p1-D8", 2);
    assert.equal(drawn(result.events).length, 1); assert.ok(changes(result.events).some(e => e.payload.kind === "GIG_VALUE_CHANGED" && e.payload.gigInstanceId === "p1-D8" && e.payload.current === 8));
    assert.equal(new RulesView(result.state, context).getStreetCred(actor), 8);
});
test("rival8+ alone never satisfies the controller condition", () => { const result = resolveIndustrial(withGigs(before, context, { "p0-D4": 2, "p1-D12": 8 }), context, "p1-D12", 1); assert.equal(drawn(result.events).length, 0); assert.equal(result.state.resolution.choice, null); });
for (const [die, value, expected] of [["D4", 4, [0]], ["D4", 3, [0, 1]], ["D6", 4, [0, 1, 2]], ["D8", 5, [0, 1, 2, 3]], ["D10", 3, [0, 1, 2, 3, 4]], ["D12", 8, [0, 1, 2, 3, 4]], ["D20", 19, [0, 1]], ["D20", 14, [0, 1, 2, 3, 4]]] as const) test("exact up-to4 amount set on " + die + " at " + value, () => {
    const s = withGigs(before, context, { ...(die === "D20" ? { "p0-D4": 1, "p0-D6": 1, "p0-D8": 1, "p0-D10": 1, "p0-D12": 1 } : {}), ["p0-" + die]: value, "p1-D4": 1 }), g = s.objects.gigs[gid(s, "p0-" + die)], effect = industrial.mechanics.abilities[0].effects[0]; assert.ok(effect.kind === "ADJUST_GIG_UP_TO");
    assert.deepEqual(gigAdjustmentOptions(g, effect), expected.map(amount => ({ kind: "AMOUNT", amount })));
    const pending = playCard(s, context, INDUSTRIAL).state, chosen = pick(pending, context, o => o.kind === "GIG" && o.gigInstanceId === g.id);
    if (expected.length === 1) { assert.equal(chosen.state.resolution.choice, null); assert.equal(changes(chosen.events).length, 0); }
    else { assert.deepEqual(chosen.state.resolution.choice!.options, expected.map(amount => ({ kind: "AMOUNT", amount }))); assert.ok(actions(chosen.state, context).every(a => a.descriptor.label.startsWith("Increase by "))); }
});
test("zero emits decline only and still draws from an existing controlled8+ Gig", () => {
    const result = resolveIndustrial(withGigs(before, context, { "p0-D8": 8, "p1-D4": 2 }), context, "p1-D4", 0);
    assert.equal(changes(result.events).length, 0); assert.equal(drawn(result.events).length, 1); assert.ok(result.events.some(e => e.payload.kind === "GIG_ADJUSTMENT_DECLINED"));
});
test("no eligible Gig skips adjustment, evaluates false condition and finishes Program with no fake choice", () => {
    const result = playCard(withGigs(before, context, {}), context, INDUSTRIAL);
    assert.equal(result.state.timing.step, "MAIN"); assert.equal(result.state.resolution.choice, null); assert.equal(drawn(result.events).length, 0); assert.equal(changes(result.events).length, 0);
    assert.ok(result.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    assert.ok(result.events.some(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "RESOLVING_PROGRAM" && e.payload.to.zone === "TRASH"));
});
test("single eligible Gig is forced; only its genuinely variable amount creates a choice", () => {
    const result = playCard(withGigs(before, context, { "p0-D8": 6 }), context, INDUSTRIAL);
    assert.equal(result.state.timing.step, "AMOUNT_SELECTION"); assert.ok(result.events.some(e => e.payload.kind === "GIG_TARGET_SELECTED"));
    assert.equal(result.events.some(e => e.payload.kind === "PHASE_CHANGED" && e.payload.step === "TARGET_SELECTION"), false);
});
test("single maxed Gig forces target and zero once, then executes exactly one later conditional draw", () => {
    const result = playCard(withGigs(before, context, { "p0-D8": 8 }), context, INDUSTRIAL);
    assert.equal(result.state.timing.step, "MAIN"); assert.equal(result.state.resolution.choice, null); assert.equal(drawn(result.events).length, 1);
    assert.equal(result.events.filter(e => e.payload.kind === "GIG_TARGET_SELECTED").length, 1); assert.equal(result.events.filter(e => e.payload.kind === "GIG_ADJUSTMENT_DECLINED").length, 1);
    assert.equal(result.events.filter(e => e.payload.kind === "CONDITION_EVALUATED").length, 1); assert.equal(result.events.filter(e => e.payload.kind === "EFFECT_RESOLVED").length, 2);
});
test("die maximum rejects out-of-range requested changes without clamping or changing the original", () => {
    const s = withGigs(before, context, { "p0-D4": 3 }), m = new TurnMutation(s, context), original = JSON.stringify(m.state), id = gid(s, "p0-D4");
    assert.equal(changeGigValue(m.state, id, 2, context).ok, false); assert.equal(JSON.stringify(m.state), original);
    assert.equal(changeGigValue(m.state, id, 0, context).ok, false); assert.equal(JSON.stringify(m.state), original);
});
for (const value of [null, 1, 2, 3, 4, 5, 8, 9, 10] as const) test("Field Operator resolves current Street Cred " + value + " through ordinary PLAY", () => {
    const s = withGigs(before, context, value === null ? {} : { "p0-D12": value }), expected = value !== null && value % 2 === 0;
    const result = playCard(s, context, FIELD_OPERATOR), p = result.events.map(e => e.payload);
    assert.equal(condition(s), expected); assert.equal(drawn(result.events).length, expected ? 1 : 0);
    assert.ok(p.some(e => e.kind === "CONDITION_EVALUATED" && e.met === expected)); assert.equal(result.state.resolution.choice, null);
    assert.ok(p.findIndex(e => e.kind === "PAYMENT_MADE") < p.findIndex(e => e.kind === "CARD_PLAYED"));
    assert.ok(p.findIndex(e => e.kind === "CARD_MOVED" && e.to.zone === "BATTLEFIELD") < p.findIndex(e => e.kind === "EFFECT_PENDING"));
});
test("numeric Street Cred0 cannot be fabricated from legal Gig faces and Null remains nonnumeric", () => {
    const s = GameStateSchema.parse(withGigs(before, context, { "p0-D8": 2 })), g = s.objects.gigs[gid(s, "p0-D8")]; assert.ok(g.roll.kind === "ROLLED"); g.roll.currentValue = 0;
    assert.equal(validateState(s, context).ok, false); assert.equal(condition(withGigs(before, context, {})), false);
});
for (const mode of ["EVEN", "ODD"] as const) test("legal alternative Industrial amount gives later Field Operator " + mode + " parity", () => {
    const r = valueConditionsReplay("value-46", mode), expected = mode === "EVEN";
    assert.equal(condition(r.afterIndustrial), expected); assert.equal(threshold(r.afterIndustrial), expected);
    const i = r.steps.findIndex(s => s.action.action.kind === "PLAY_CARD" && s.action.action.cardInstanceId === r.operator), p = r.steps.slice(i).flatMap(s => s.events);
    assert.equal(drawn(p).length, expected ? 1 : 0); assert.ok(p.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === expected));
});
test("Industrial increases even Street Cred to odd before Field Operator, which does not draw", () => {
    const s = withGigs(before, context, { "p0-D12": 8, "p1-D4": 1 });
    assert.equal(condition(s), true);
    const increased = resolveIndustrial(s, context, "p0-D12", 1);
    assert.equal(new RulesView(increased.state, context).getStreetCred(actor), 9);
    assert.equal(condition(increased.state), false);
    assert.equal(drawn(increased.events).length, 1); // Industrial's threshold is independent of parity.
    assert.ok(changes(increased.events).some(e => e.payload.kind === "GIG_VALUE_CHANGED" && e.payload.previous === 8 && e.payload.current === 9));
    const played = playCard(increased.state, context, FIELD_OPERATOR);
    assert.equal(drawn(played.events).length, 0);
    assert.ok(played.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    assert.equal(played.state.timing.step, "MAIN"); assert.equal(played.state.resolution.choice, null);
});
test("controlled stolen Gig, not its owner, supplies both threshold and parity", () => {
    const s = withGigs(before, context, { "p0-D4": 1, "p1-D12": 9 }), m = new TurnMutation(s, context), id = gid(s, "p1-D12");
    unwrap(transferGigs(m, [id], actor)); const transferred = unwrap(validateState(m.state, context));
    assert.equal(transferred.objects.gigs[id].ownerId, rival); assert.equal(threshold(transferred), true); assert.equal(condition(transferred), true); assert.equal(new RulesView(transferred, context).getStreetCred(actor), 10);
    const result = playCard(transferred, context, FIELD_OPERATOR); assert.equal(drawn(result.events).length, 1);
    const lost = new TurnMutation(transferred, context); unwrap(transferGigs(lost, [id], rival)); assert.equal(condition(unwrap(validateState(lost.state, context))), false); assert.equal(threshold(lost.state), false);
});
test("after an actual engine steal, later Field Operator consumes the new controller's parity", () => {
    // Trusted ordinary Unit placement; actual DECLARE/PASS/steal and later PLAY are engine actions.
    const s = withGigs(before, context, { "p0-D4": 1, "p1-D8": 3 }), m = new TurnMutation(s, context), card = Object.values(m.state.objects.cards).find(c => c.controllerId === actor && c.cardId === "emergency-atlus" && c.zone.zone === "DECK")!;
    moveCardLocation(m, card.id, "BATTLEFIELD"); card.readiness = "READY"; card.statuses = [];
    const stolen = finishAttack(declare(unwrap(validateState(m.state, context)), card.id, context).state, context); assert.ok(stolen.events.some(e => e.payload.kind === "GIG_STOLEN")); assert.equal(condition(stolen.state), true);
    assert.equal(drawn(playCard(stolen.state, context, FIELD_OPERATOR).events).length, 1);
});
for (const delta of [-1, 1]) test("Afterparty's existing signed adjustment " + delta + " changes later Field Operator parity", () => {
    const arranged = placeCard(withGigs(before, context, { "p0-D8": 3, "p1-D4": 1 }), context, AFTERPARTY), paid = playCard(arranged.state, context, AFTERPARTY), targeted = pick(paid.state, context, o => o.kind === "GIG" && o.gigInstanceId === "p0-D8");
    const result = pick(targeted.state, context, o => o.kind === "MODE" && o.mode === (delta > 0 ? "INCREASE_1" : "DECREASE_1"));
    assert.equal(condition(result.state), true); assert.equal(drawn(playCard(result.state, context, FIELD_OPERATOR).events).length, 1);
});
test("Jackie's existing decrease updates current parity before a later Field Operator PLAY", () => {
    const arranged = placeCard(withGigs(before, context, { "p0-D8": 3, "p1-D4": 1 }), context, "psycho-squad"), m = new TurnMutation(arranged.state, context), jackie = context.content.cards.find(c => c.id === JACKIE)!, source = m.state.players[actor].zones.LEGENDS[0];
    m.state.objects.cards[source].cardId = jackie.id; m.state.objects.cards[source].revision = jackie.revision; m.state.objects.cards[source].face = "UP";
    let s = playCard(unwrap(validateState(m.state, context)), context, "psycho-squad").state;
    s = pick(s, context, o => o.kind === "CONFIRM" && o.confirmed).state;
    if (s.resolution.choice?.kind === "TARGET") s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === "p0-D8").state;
    s = pick(s, context, o => o.kind === "AMOUNT" && o.amount === 1).state; assert.equal(condition(s), true);
    // Pay next Unit with restored trusted payment readiness, without changing Gigs/parity.
    const funded = GameStateSchema.parse(s); for (const id of [...funded.players[actor].zones.EDDIES, ...funded.players[actor].zones.LEGENDS]) funded.objects.cards[id].readiness = "READY";
    assert.equal(drawn(playCard(unwrap(validateState(funded, context)), context, FIELD_OPERATOR).events).length, 1);
});
for (const card of [INDUSTRIAL, FIELD_OPERATOR]) test(card + " reuses EMPTY_DRAW loss and clears every pending continuation", () => {
    const s = withGigs(before, context, { "p0-D8": 8 }), m = new TurnMutation(s, context);
    for (const id of [...m.state.players[actor].zones.DECK]) moveCardLocation(m, id, "TRASH");
    const result = playCard(unwrap(validateState(m.state, context)), context, card);
    assert.equal(result.state.match.outcome?.reason, "EMPTY_DRAW"); assert.equal(result.state.match.outcome?.loserId, actor); assert.equal(result.state.resolution.current, null); assert.equal(result.state.resolution.choice, null); assert.equal(result.state.timing.step, "FINISHED");
});
test("Field Operator is an ordinary Unit after Lag clears, including attack", () => {
    let s = replay.finalState; s = end(s, context).state; s = take(s, context, a => a.action.kind === "ROLL_GIG").state; s = end(s, context).state; s = take(s, context, a => a.action.kind === "ROLL_GIG").state;
    assert.equal(s.objects.cards[replay.operator].statuses.includes("LAG"), false); const result = declare(s, replay.operator, context); assert.ok(result.events.some(e => e.payload.kind === "ATTACK_DECLARED"));
    assert.equal(result.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === replay.operator), false);
});
test("no interleaving, rival submission or premature Field Operator action during Industrial choices", () => {
    for (const s of [replay.pendingTarget, replay.pendingAmount]) {
        assert.ok(actions(s, context).every(a => a.action.kind === "CHOOSE"));
        const id = Object.values(s.objects.cards).find(c => c.controllerId === actor && c.cardId === FIELD_OPERATOR && c.zone.zone === "HAND")!.id;
        assert.equal(applyAction(s, { actorId: actor, action: { kind: "PLAY_CARD", cardInstanceId: id } }, context).ok, false);
        assert.equal(applyAction(s, { actorId: rival, action: actions(s, context)[0].action }, context).ok, false);
    }
});
for (const defect of ["amount", "target", "stale-value", "controller", "index", "missing-next", "next-condition", "next-count", "next-source", "current-effect", "current-id", "early-main"] as const) test("external Industrial continuation rejects " + defect + " atomically", () => {
    const s = GameStateSchema.parse(replay.pendingAmount), c = s.resolution.playContinuation!;
    if (defect === "amount") s.resolution.choice!.options.push({ kind: "AMOUNT", amount: 5 });
    if (defect === "target") delete c.targetGigId;
    if (defect === "stale-value") { const g = s.objects.gigs[c.targetGigId!]; assert.ok(g.roll.kind === "ROLLED"); g.roll.currentValue = 8; }
    if (defect === "controller") c.actorId = rival;
    if (defect === "index") c.effectIndex = 1;
    if (defect === "missing-next") s.resolution.pending = [];
    if (defect === "next-condition") s.resolution.pending[0].effect = { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE_AT_LEAST", minimum: 7 }, count: 1 };
    if (defect === "next-count") s.resolution.pending[0].effect = { kind: "DRAW", count: 2 };
    if (defect === "next-source") s.resolution.pending[0].sourceId = replay.operator;
    if (defect === "current-effect") s.resolution.current!.effect = { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 };
    if (defect === "current-id") s.resolution.current!.id = "wrong";
    if (defect === "early-main") s.timing.window = "MAIN";
    const encoded = JSON.stringify(s); assert.equal(validateState(s, context).ok, false); assert.equal(applyAction(s, { actorId: actor, action: actions(replay.pendingAmount, context)[0].action }, context).ok, false); assert.equal(JSON.stringify(s), encoded);
});
test("strategic amount selection rejects duplicate indices and old action IDs after public value changes", () => {
    const s = replay.pendingAmount, action = actions(s, context)[0]; assert.equal(applyAction(s, { actorId: actor, action: { kind: "CHOOSE", choiceId: s.resolution.choice!.id, optionIndices: [0, 0] } }, context).ok, false);
    const changed = GameStateSchema.parse(s), g = changed.objects.gigs[changed.resolution.playContinuation!.targetGigId!]; assert.ok(g.roll.kind === "ROLLED"); g.roll.currentValue--;
    assert.equal(resolveActionId(changed, actor, action.actionId, context).ok, false);
});
for (const card of valueCards) for (const defect of ["missing-policy", "scope", "extra-effect", "order", "condition", "ability-condition", "keyword", "restriction", "equip", "cost", "power", "ram", "tags", "color", "sell", "trigger", "unreviewed"] as const) test(card.id + " full-shape rejection: " + defect, () => {
    const changed = CardRevisionSnapshotSchema.parse(card), ruleset = structuredClone(context.content.ruleset), a = changed.mechanics.abilities[0];
    if (defect === "missing-policy") delete ruleset.gameplay!.turnSlice!.valueConditions;
    if (defect === "scope") changed.execution!.scope = "NONCOMBAT_PLAY_V1";
    if (defect === "extra-effect") a.effects.push({ kind: "DRAW", count: 1 });
    if (defect === "order") { if (changed.type === "PROGRAM") a.effects.reverse(); else a.effects = [{ kind: "DRAW", count: 1 }]; }
    if (defect === "condition") a.effects[a.effects.length - 1] = { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE_AT_LEAST", minimum: 7 }, count: 1 };
    if (defect === "ability-condition") a.conditions = [{ kind: "STREET_CRED_IS_EVEN" }];
    if (defect === "keyword") changed.mechanics.keywords.push("QUICK");
    if (defect === "restriction") changed.mechanics.restrictions = [{ kind: "CANNOT_ATTACK" }];
    if (defect === "equip") changed.mechanics.equip = { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" };
    if (defect === "cost") changed.printedCost = { kind: "EDDIES", amount: 0 };
    if (defect === "power") changed.power = 0;
    if (defect === "ram") changed.ram = { GREEN: 3 };
    if (defect === "tags") changed.tags = ["Arasaka"];
    if (defect === "color") changed.colors = ["BLUE"];
    if (defect === "sell") changed.sellProfile.allowed = !changed.sellProfile.allowed;
    if (defect === "trigger") a.trigger = "WHEN_ATTACKING";
    if (defect === "unreviewed") { changed.provenance.reviewed = false; assert.equal(supportsValueConditionCard(changed, context).ok, false); return; }
    const ctx = { content: createContentBundle(ruleset, context.content.cards.map(c => c.id === changed.id ? changed : c), context.content.manifest.engine) };
    assert.equal(supportsValueConditionCard(changed, ctx).ok, false); assert.equal(supportsPlay(changed, ctx).ok, false); assert.equal(createGameWithEvents(valueInput("bad"), ctx).ok, false);
});
test("older Afterparty scope rejects new directional/up-to4 mechanics even with valid old conditional draw", () => {
    const c = CardRevisionSnapshotSchema.parse(context.content.cards.find(c => c.id === AFTERPARTY)!); c.mechanics.abilities[0].effects[0] = { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 4, direction: "INCREASE" };
    assert.equal(supportsPlay(c, context).ok, false);
    const old = saburoContext(); for (const card of valueCards) assert.equal(supportsValueConditionCard(card, old).ok, false);
});
test("all47 older immutable revisions and strict constructed size, copies, RAM and Legend count are retained", () => {
    const old = saburoContext(); assert.equal(old.content.cards.length, 47); assert.equal(context.content.cards.length, 49);
    for (const card of old.content.cards) assert.deepEqual(context.content.cards.find(c => c.id === card.id), card);
    const input = valueInput("format"); assert.ok(createGameWithEvents(input, context).ok); assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3));
    for (const deck of [{ ...input.decks[0], main: input.decks[0].main.slice(0, 27) }, { ...input.decks[0], main: [...input.decks[0].main, INDUSTRIAL] }, { ...input.decks[0], legends: input.decks[0].legends.slice(0, 2) }, { ...input.decks[0], main: ["psycho-squad", ...input.decks[0].main.slice(1)] }]) assert.equal(createGameWithEvents({ ...input, decks: [deck, input.decks[1]] }, context).ok, false);
});
test("public current-value changes alter both observations/hashes; parity is not stored or separately exposed", () => {
    const s = withGigs(before, context, { "p0-D8": 7, "p1-D4": 1 }), m = new TurnMutation(s, context); unwrap(changeGigValue(m.state, gid(s, "p0-D8"), 1, context)); const changed = unwrap(validateState(m.state, context));
    assert.notEqual(hashPosition(s), hashPosition(changed)); for (const player of [actor, rival]) assert.notEqual(hashObservation(unwrap(observe(s, player, context))), hashObservation(unwrap(observe(changed, player, context))));
    for (const key of ["STREET_CRED_IS_EVEN", "parity", "conditionMet"]) assert.equal(JSON.stringify(changed).includes(key), false);
});
test("existing target/amount choices survive wire/training and transport counters do not affect action IDs", () => {
    for (const s of [replay.pendingTarget, replay.pendingAmount, replay.pendingOperatorPayment]) {
        const legal = actions(s, context), p = unwrap(generatePosition(s, actor, context, "value-contract")); assert.ok(validateTrainingPosition(p, context).ok); assert.equal(JSON.stringify(modelInput(p)).includes(s.rng.seed), false);
        const response = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: context.content, state: s, actorId: actor, actionId: legal[0].actionId }); assert.ok(response.ok && response.value.kind === "transition");
        assert.deepEqual(response.value.state, unwrap(applyAction(s, { actorId: actor, action: legal[0].action }, context)).state);
        const changed = GameStateSchema.parse(s); changed.match.version = GameStateVersionSchema.parse(999); changed.match.eventSequence = GameEventSequenceSchema.parse(999);
        for (const e of [...changed.resolution.pending, ...(changed.resolution.current ? [changed.resolution.current] : [])]) e.causedBySequence = 998;
        assert.equal(hashPosition(changed), hashPosition(s)); assert.notEqual(hashReplayState(changed), hashReplayState(s)); assert.deepEqual(actions(changed, context), legal);
    }
});
test("isolated current-value policy protects actions from rival secrets without Saburo/Yorinobu/private-look scopes", () => {
    const base = triggersContext(), ruleset = structuredClone(base.content.ruleset); ruleset.gameplay!.turnSlice!.valueConditions = "VALUE_CONDITIONS_V1";
    const ctx = { content: createContentBundle(ruleset, [...base.content.cards, ...valueCards], base.content.manifest.engine) }, s = GameStateSchema.parse(satoriReplay().finalState);
    s.match.contentManifestHash = ctx.content.manifestHash; s.match.rulesetHash = ctx.content.manifest.ruleset.hash; s.match.cards = ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    const placed = placeCard(unwrap(validateState(s, ctx)), ctx, INDUSTRIAL); const pending = playCard(placed.state, ctx, INDUSTRIAL).state;
    assert.equal(pending.timing.step, "TARGET_SELECTION"); const changed = GameStateSchema.parse(pending), enemy = changed.match.playerOrder.find(p => p !== changed.timing.activePlayer)!, hand = changed.players[enemy].zones.HAND[0], deck = changed.players[enemy].zones.DECK.find(id => changed.objects.cards[id].cardId !== changed.objects.cards[hand].cardId)!;
    [changed.objects.cards[hand].cardId, changed.objects.cards[deck].cardId] = [changed.objects.cards[deck].cardId, changed.objects.cards[hand].cardId]; [changed.objects.cards[hand].revision, changed.objects.cards[deck].revision] = [changed.objects.cards[deck].revision, changed.objects.cards[hand].revision];
    unwrap(validateState(changed, ctx)); assert.notEqual(hashPosition(changed), hashPosition(pending)); assert.deepEqual(actions(changed, ctx), actions(pending, ctx));
});
test("headline golden is exact and no automatic parity/draw/forced choice creates a training position", () => {
    assert.deepEqual(JSON.parse(readFileSync(new URL("./fixtures/value-conditions-replay.v1.json", import.meta.url), "utf8")), replay);
    assert.equal(replay.positions.length, replay.steps.filter(s => s.legalActions.length > 1).length); assert.ok(replay.positions.every(p => p.legalActions.length > 1));
    assert.ok(replay.positions.some(p => p.observation.step === "TARGET_SELECTION")); assert.ok(replay.positions.some(p => p.observation.step === "AMOUNT_SELECTION"));
});

test("Field Operator evaluates parity after payment, not a snapshot from the initial PLAY action", () => {
    const s = withGigs(before, context, { "p0-D8": 3 }), played = take(s, context, a => a.action.kind === "PLAY_CARD" && s.objects.cards[a.action.cardInstanceId].cardId === FIELD_OPERATOR);
    assert.equal(played.state.timing.step, "PAYMENT_SELECTION"); assert.equal(played.events.some(e => e.payload.kind === "CONDITION_EVALUATED"), false);
    // Trusted value change at a continuation boundary; no new payment-interleaving player action.
    const m = new TurnMutation(played.state, context); unwrap(changeGigValue(m.state, gid(s, "p0-D8"), 1, context)); let current = unwrap(validateState(m.state, context)); const events = [];
    while (current.resolution.choice?.kind === "PAYMENT") { const next = pick(current, context, o => o.kind === "PAYMENT"); current = next.state; events.push(...next.events); }
    assert.equal(drawn(events).length, 1); assert.equal(condition(current), true);
});
test("Industrial draws from a currently controlled stolen8+ Gig even when adjusting a different die", () => {
    const s = withGigs(before, context, { "p0-D4": 1, "p1-D12": 8 }), m = new TurnMutation(s, context); unwrap(transferGigs(m, [gid(s, "p1-D12")], actor));
    const result = resolveIndustrial(unwrap(validateState(m.state, context)), context, "p0-D4", 0); assert.equal(drawn(result.events).length, 1);
});
for (const defect of ["missing-direction", "maximum-one", "wrong-draw-count"] as const) test("Industrial rejects a partial increase shape: " + defect, () => {
    const card = CardRevisionSnapshotSchema.parse(industrial), effect = card.mechanics.abilities[0].effects[0]; assert.ok(effect.kind === "ADJUST_GIG_UP_TO");
    if (defect === "missing-direction") delete effect.direction;
    if (defect === "maximum-one") effect.maximum = 1;
    if (defect === "wrong-draw-count") { const draw = card.mechanics.abilities[0].effects[1]; assert.ok(draw.kind === "CONDITIONAL_DRAW"); draw.count = 2; }
    assert.equal(supportsValueConditionCard(card, context).ok, false); assert.equal(supportsPlay(card, context).ok, false);
});
