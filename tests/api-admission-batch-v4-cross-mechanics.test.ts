import test from "node:test";
import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, GameStateSchema, canonicalSerialize, hashCanonical } from "@tcg/domain";
import { RulesView, observe, resolveActionId, validateState } from "@tcg/engine";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { friendlyPowerTargets } from "../packages/engine/src/friendly-play-power-queries";
import { arrangedScenario, crossMechanicContext, JONIN } from "./api-admission-batch-v4-scenarios";
import { attackPowerContext } from "./attack-condition-power-fixture";
import { must } from "./api-admission-batch-v4-replay";

test("V4: cross-content retains every previous immutable revision", () => {
    const context = crossMechanicContext();
    for (const old of attackPowerContext().content.cards) {
        const card = context.content.cards.find(c => c.id === old.id && c.revision === old.revision);
        assert.ok(card); assert.equal(hashCanonical(card), hashCanonical(old));
    }
    const scenario = arrangedScenario(); // initialization enforces constructed size, copies and RAM
    assert.equal(must(validateState(scenario.driver.state, context)).timing.window, "MAIN");
});

test("V4: paid friendly PLAY changes effective power without changing printed data", () => {
    const { driver, context, joninSource, oldJonin } = arrangedScenario();
    const before = new RulesView(driver.state, context), printed = CardRevisionSnapshotSchema.parse(before.getRevision(oldJonin));
    const events = driver.buff(joninSource, oldJonin);
    assert.equal(new RulesView(driver.state, context).getEffectivePower(oldJonin), 2, "V4_POWER_APPLICATION");
    assert.deepEqual(CardRevisionSnapshotSchema.parse(new RulesView(driver.state, context).getRevision(oldJonin)), printed);
    assert.ok(events.some(e => e.payload.kind === "CARD_PLAYED" && e.payload.cardInstanceId === joninSource));
    assert.ok(events.some(e => e.payload.kind === "PAYMENT_MADE"));
    assert.equal(events.filter(e => e.payload.kind === "POWER_MODIFIER_APPLIED" && e.payload.modifier.sourceId === joninSource).length, 1);
});

test("V4: field Legends are friendly Unit targets but Legends-area cards and Gear are not", () => {
    const s = arrangedScenario(), { driver, context, actor, fieldLegend, joninSource } = s;
    const entered = driver.steps.length;
    driver.take(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === fieldLegend); driver.pay();
    assert.ok(driver.steps.slice(entered).some(step => step.events.some(e => e.payload.kind === "GO_SOLO_ACTIVATED")));
    const field = driver.state.objects.cards[fieldLegend];
    assert.deepEqual(new RulesView(driver.state, context).getEffectiveCardTypes(fieldLegend), ["LEGEND", "UNIT"]);
    assert.equal(field.statuses.includes("LAG"), true);
    const printed = new RulesView(driver.state, context).getRevision(fieldLegend)!.power;
    driver.play(joninSource);
    const targets = friendlyPowerTargets(driver.state, actor, context);
    assert.ok(targets.includes(fieldLegend)); assert.ok(targets.includes(joninSource));
    for (const id of driver.state.players[actor].zones.LEGENDS) assert.equal(targets.includes(id), false);
    assert.equal(targets.includes(s.rivalUnit), false); assert.equal(targets.includes(s.gear), false);
    const input = must(buildModelInputV2(driver.state, actor, context));
    const legal = input.legalActions.map(a => must(resolveActionId(driver.state, actor, a.actionId, context)));
    const index = driver.state.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === fieldLegend);
    assert.ok(legal.some(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index));
    driver.chooseCard(fieldLegend);
    assert.equal(new RulesView(driver.state, context).getEffectivePower(fieldLegend), printed! + 2);
    assert.equal(driver.state.objects.cards[fieldLegend].readiness, field.readiness);
    assert.deepEqual(driver.state.objects.cards[fieldLegend].statuses, field.statuses);
    assert.equal(new RulesView(driver.state, context).getRevision(fieldLegend)!.power, printed);
});

test("V4: two paid Jonins stack on one physical target", () => {
    const { driver, context, joninSource, secondJonin, oldJonin } = arrangedScenario();
    driver.buff(joninSource, oldJonin); driver.buff(secondJonin, oldJonin);
    const occurrences = driver.state.temporaryModifiers!.filter(x => x.targetId === oldJonin && x.amount === 2);
    assert.equal(occurrences.length, 2, "V4_STACKING");
    assert.equal(new Set(occurrences.map(x => x.amount === 2 ? x.origin.effectId : "")).size, 2);
    assert.deepEqual(occurrences.map(x => x.sourceId).sort(), [joninSource, secondJonin].sort());
    assert.equal(new RulesView(driver.state, context).getEffectivePower(oldJonin), 4);
    assert.equal(driver.steps.flatMap(s => s.events).filter(e => e.payload.kind === "CARD_PLAYED").length, 2);
});

function mixedScenario(kind: "CARD" | "GIG_AREA", buff = true) {
    const s = arrangedScenario(), { driver, context, goroUnit } = s;
    assert.equal(new RulesView(driver.state, context).getEffectivePower(goroUnit), 4);
    if (buff) { driver.buff(s.joninSource, goroUnit); assert.equal(new RulesView(driver.state, context).getEffectivePower(goroUnit), 6); }
    driver.attack(goroUnit, kind, kind === "CARD" ? s.defender : undefined);
    assert.equal(new RulesView(driver.state, context).getEffectivePower(goroUnit), buff ? 11 : 9);
    return s;
}

test("V4: mixed +2 +5 and -1 feed the actual fight and survive attack cleanup", () => {
    const s = mixedScenario("CARD"), { driver, context, goroUnit, defender } = s;
    driver.play(s.floor); driver.chooseCard(goroUnit);
    assert.equal(new RulesView(driver.state, context).getEffectivePower(goroUnit), 10);
    const modifiers = driver.state.temporaryModifiers!.filter(x => x.targetId === goroUnit);
    assert.deepEqual(modifiers.map(x => x.amount).sort((a, b) => a - b), [-1, 2, 5]);
    const receipt = modifiers.find(x => x.amount === -1)!;
    assert.equal("origin" in receipt, false, "legacy one-shot -1 serialization stays intact");
    const before = driver.steps.length; driver.passReact();
    const events = driver.steps.slice(before).flatMap(step => step.events);
    const fight = events.find(e => e.payload.kind === "FIGHT_RESULT");
    assert.ok(fight?.payload.kind === "FIGHT_RESULT");
    assert.equal(fight.payload.attackerPower, 10); assert.equal(fight.payload.defenderPower, 9);
    assert.equal(fight.payload.winnerId, goroUnit);
    assert.ok(events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === defender));
    assert.equal(driver.state.objects.cards[defender].zone.zone, "TRASH");
    assert.equal(new RulesView(driver.state, context).getEffectivePower(goroUnit), 10);
    assert.equal(events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED"), false);
    assert.equal(new RulesView(driver.state, context).getRevision(goroUnit)!.power, 4);
    assert.equal(must(validateState(JSON.parse(JSON.stringify(driver.state)), context)).timing.window, "MAIN");
});

test("V4: the real Gig resolver distinguishes power nine from mixed power ten", () => {
    for (const buff of [false, true]) {
        const s = mixedScenario("GIG_AREA", buff), { driver, context, goroUnit, rival } = s;
        if (buff) { driver.play(s.floor); driver.chooseCard(goroUnit); }
        assert.equal(new RulesView(driver.state, context).getEffectivePower(goroUnit), buff ? 10 : 9);
        const available = Object.values(driver.state.objects.gigs).filter(g => g.controllerId === rival && g.location.zone === "GIGS");
        assert.ok(available.length >= 2, "threshold proof requires two real rolled rival Gigs");
        const before = driver.steps.length; driver.passReact();
        const events = driver.steps.slice(before).flatMap(step => step.events), started = events.find(e => e.payload.kind === "GIG_STEAL_STARTED");
        assert.ok(started?.payload.kind === "GIG_STEAL_STARTED");
        assert.equal(started.payload.power, buff ? 10 : 9); assert.equal(started.payload.allowance, buff ? 2 : 1);
        assert.equal(events.filter(e => e.payload.kind === "GIG_STOLEN").length, buff ? 2 : 1);
        assert.equal(driver.state.timing.window, "MAIN");
    }
});

test("V4: an old zero-power Jonin can attack but only steals after a separate paid +2", () => {
    for (const buff of [false, true]) {
        const s = arrangedScenario(), { driver, context, oldJonin } = s;
        assert.equal(driver.state.objects.cards[oldJonin].statuses.includes("LAG"), false);
        if (buff) driver.buff(s.joninSource, oldJonin);
        driver.attack(oldJonin, "GIG_AREA");
        const before = driver.steps.length; driver.passReact();
        const events = driver.steps.slice(before).flatMap(step => step.events), started = events.find(e => e.payload.kind === "GIG_STEAL_STARTED");
        assert.ok(started?.payload.kind === "GIG_STEAL_STARTED");
        assert.equal(started.payload.power, buff ? 2 : 0); assert.equal(started.payload.allowance, buff ? 1 : 0);
        assert.equal(events.filter(e => e.payload.kind === "GIG_STOLEN").length, buff ? 1 : 0);
        assert.equal(new RulesView(driver.state, context).getRevision(oldJonin)!.id, JONIN);
        assert.equal(new RulesView(driver.state, context).getRevision(oldJonin)!.power, 0);
    }
});

test("V4: mixed-power observations round-trip with exact public occurrences", () => {
    const s = mixedScenario("CARD"), { driver, context } = s;
    driver.play(s.floor); driver.chooseCard(s.goroUnit);
    for (const viewer of [s.actor, s.rival]) {
        const observation = must(observe(driver.state, viewer, context));
        assert.deepEqual(observation.temporaryModifiers, driver.state.temporaryModifiers);
        const input = must(buildModelInputV2(driver.state, viewer, context));
        assert.deepEqual(input.observation, observation);
        const descriptors = input.legalActions.map(a => canonicalSerialize(Object.fromEntries(Object.entries(a.descriptor).filter(([key]) => key !== "label"))));
        assert.equal(new Set(descriptors).size, descriptors.length);
    }
    assert.equal(hashCanonical(driver.state), hashCanonical(GameStateSchema.parse(driver.state)));
});
