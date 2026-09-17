import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize, type CardInstanceId, type GameEvent, type GameState } from "@tcg/domain";
import { applyAction, hashReplayState, listLegalActions, moveCardForEffect, observe, RulesView, validateState } from "@tcg/engine";
import { friendlyPowerTargets } from "../packages/engine/src/friendly-play-power-queries";
import { arrangedScenario } from "./api-admission-batch-v4-scenarios";
import { must } from "./api-admission-batch-v4-replay";
import { selectReplayAction } from "./replay-selection";

function buffed() {
    const s = arrangedScenario(); s.driver.buff(s.joninSource, s.oldJonin);
    const modifier = s.driver.state.temporaryModifiers!.find(x => x.amount === 2 && x.sourceId === s.joninSource);
    assert.ok(modifier?.amount === 2);
    assert.notEqual(modifier.sourceId, modifier.targetId, "Source and target must differ to isolate lifetime semantics");
    return { ...s, modifier, effectId: modifier.origin.effectId };
}
function expired(events: GameEvent[], effectId: string) {
    return events.filter(e => e.payload.kind === "POWER_MODIFIER_EXPIRED" && e.payload.effectId === effectId);
}
function references(state: GameState, id: CardInstanceId) {
    return Object.values(state.players).flatMap(p => Object.values(p.zones)).flatMap(ids => ids ?? []).filter(x => x === id).length;
}

test("V4: source to Trash preserves the separate target and the resolved +2", () => {
    const s = buffed(), before = canonicalSerialize(s.modifier);
    const result = must(moveCardForEffect(s.driver.state, s.joninSource, "TRASH", s.context));
    assert.equal(result.state.objects.cards[s.joninSource].zone.zone, "TRASH");
    assert.equal(references(result.state, s.joninSource), 1);
    assert.equal(new RulesView(result.state, s.context).getEffectivePower(s.oldJonin), 2);
    assert.equal(canonicalSerialize(result.state.temporaryModifiers!.find(x => x.sourceId === s.joninSource)), before);
    assert.equal(expired(result.events, s.effectId).length, 0);
    assert.equal(must(validateState(JSON.parse(JSON.stringify(result.state)), s.context)).timing.window, "MAIN");
});

test("V4: public target departure retains its duration but does not create a new target", () => {
    for (const destination of ["TRASH", "REMOVED"] as const) {
        const s = buffed(), result = must(moveCardForEffect(s.driver.state, s.oldJonin, destination, s.context));
        assert.equal(result.state.objects.cards[s.oldJonin].zone.zone, destination);
        assert.equal(references(result.state, s.oldJonin), 1);
        assert.equal(new RulesView(result.state, s.context).getEffectivePower(s.oldJonin), 2);
        assert.equal(friendlyPowerTargets(result.state, s.actor, s.context).includes(s.oldJonin), false);
        assert.equal(expired(result.events, s.effectId).length, 0);
        assert.equal(result.state.temporaryModifiers!.some(x => x.amount === 2 && x.origin.effectId === s.effectId), true);
        must(validateState(JSON.parse(JSON.stringify(result.state)), s.context));
    }
});

test("V4: a buffed field Legend follows normal departure processing into Removed", () => {
    const s = arrangedScenario(), { driver, context, fieldLegend } = s;
    driver.take(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === fieldLegend); driver.pay();
    driver.buff(s.joninSource, fieldLegend);
    const basePower = new RulesView(driver.state, context).getRevision(fieldLegend)!.power!;
    const result = must(moveCardForEffect(driver.state, fieldLegend, "TRASH", context));
    assert.equal(result.state.objects.cards[fieldLegend].zone.zone, "REMOVED");
    assert.deepEqual(new RulesView(result.state, context).getEffectiveCardTypes(fieldLegend), ["LEGEND"]);
    assert.equal(new RulesView(result.state, context).getEffectivePower(fieldLegend), basePower + 2);
    assert.equal(friendlyPowerTargets(result.state, s.actor, context).includes(fieldLegend), false);
    assert.equal(result.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED"), false);
    assert.equal(references(result.state, fieldLegend), 1);
    must(validateState(JSON.parse(JSON.stringify(result.state)), context));
});

test("V4: actual target-to-Hand movement expires exactly its occurrence and preserves privacy", () => {
    const s = buffed(), moved = moveCardForEffect(s.driver.state, s.oldJonin, "HAND", s.context);
    assert.ok(moved.ok, `V4_HIDDEN_EXPIRY: ${!moved.ok ? JSON.stringify(moved.errors) : ""}`);
    const result = moved.value;
    assert.equal(result.state.objects.cards[s.oldJonin].zone.zone, "HAND");
    assert.equal(result.state.objects.cards[s.oldJonin].face, "DOWN");
    assert.equal(references(result.state, s.oldJonin), 1);
    assert.equal(result.state.temporaryModifiers?.some(x => x.targetId === s.oldJonin) ?? false, false);
    const facts = expired(result.events, s.effectId); assert.equal(facts.length, 1);
    assert.ok(facts[0].payload.kind === "POWER_MODIFIER_EXPIRED" && facts[0].payload.reason === "HIDDEN_AREA");
    const rival = must(observe(result.state, s.rival, s.context));
    assert.equal(JSON.stringify(rival).includes(`"${s.oldJonin}"`), false, "No live public reference to the newly hidden target");
    must(validateState(JSON.parse(JSON.stringify(result.state)), s.context));
});

test("V4: expiry is target-specific and an already expired receipt is not emitted again", () => {
    const s = buffed(); s.driver.buff(s.secondJonin, s.goroUnit);
    const second = s.driver.state.temporaryModifiers!.find(x => x.amount === 2 && x.sourceId === s.secondJonin);
    assert.ok(second?.amount === 2);
    const result = must(moveCardForEffect(s.driver.state, s.oldJonin, "HAND", s.context));
    s.driver.state = result.state;
    assert.equal(result.state.temporaryModifiers!.length, 1);
    assert.equal(new RulesView(result.state, s.context).getEffectivePower(s.goroUnit), 6);
    assert.equal(expired(result.events, second.origin.effectId).length, 0);
    const start = s.driver.steps.length; s.driver.endTurn();
    const events = s.driver.steps.slice(start).flatMap(step => step.events);
    assert.equal(expired(events, s.effectId).length, 0);
    assert.equal(expired(events, second.origin.effectId).length, 1);
    assert.equal(s.driver.state.temporaryModifiers, undefined);
});

test("V4: unrelated movement cannot expire a resolved modifier", () => {
    const s = buffed(), result = must(moveCardForEffect(s.driver.state, s.rivalUnit, "TRASH", s.context));
    assert.deepEqual(result.state.temporaryModifiers, s.driver.state.temporaryModifiers);
    assert.equal(result.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED"), false);
    assert.equal(new RulesView(result.state, s.context).getEffectivePower(s.oldJonin), 2);
});

test("V4: real END_TURN expires +2 exactly once before the next turn", () => {
    const s = buffed(), before = s.driver.state;
    const action = selectReplayAction(must(listLegalActions(before, s.actor, s.context)), a => a.action.kind === "END_TURN");
    assert.ok(action);
    const result = applyAction(before, { actorId: action.actorId, action: action.action }, s.context);
    assert.ok(result.ok, `V4_TURN_EXPIRY: ${!result.ok ? JSON.stringify(result.errors) : ""}`);
    assert.equal(result.value.state.timing.turn, before.timing.turn + 1);
    assert.equal(result.value.state.temporaryModifiers, undefined);
    assert.equal(new RulesView(result.value.state, s.context).getEffectivePower(s.oldJonin), 0);
    assert.equal(expired(result.value.events, s.effectId).length, 1);
    must(validateState(JSON.parse(JSON.stringify(result.value.state)), s.context));
});

test("V4: source-hidden and source-Removed lifetimes remain explicitly unsupported and atomic", () => {
    // This pins an implementation boundary, NOT a ruling that source departure should expire the buff.
    // No admitted card in this batch bounces/removes Jonin; supporting that interaction requires
    // a separate historical-source representation and observation/privacy review.
    for (const destination of ["HAND", "REMOVED"] as const) {
        const s = buffed(), before = hashReplayState(s.driver.state);
        const result = moveCardForEffect(s.driver.state, s.joninSource, destination, s.context);
        assert.equal(result.ok, false, `source ${destination} is outside the current +2 source lifetime`);
        assert.ok(!result.ok && result.errors.some(e => e.code === "INVALID_TEMPORARY_POWER"));
        assert.equal(hashReplayState(s.driver.state), before, "Rejected movement must not mutate input");
        assert.ok(s.driver.state.temporaryModifiers?.some(x => x.amount === 2 && x.origin.effectId === s.effectId));
        assert.equal(new RulesView(s.driver.state, s.context).getEffectivePower(s.oldJonin), 2);
    }
});
