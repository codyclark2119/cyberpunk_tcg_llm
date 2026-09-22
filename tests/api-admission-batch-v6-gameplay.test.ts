import test from "node:test";
import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, canonicalSerialize, createContentBundle } from "@tcg/domain";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { createGameWithEvents, listLegalActions, resolveActionId, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsMinGigProgramCard } from "../packages/engine/src/min-gig-program-support";
import { gigAdjustmentOptions } from "../packages/engine/src/gig-value";
import { transferGigs } from "../packages/engine/src/gig-transfer";
import { TurnMutation } from "../packages/engine/src/turn";
import { batchV5Context } from "./api-admission-batch-v5-fixture";
import { arrange } from "./api-admission-batch-v5-scenarios";
import { batchV6Context, batchV6Input, TRUST_NO_ONE, trustNoOne } from "./api-admission-batch-v6-fixture";
import { withGigs, playCard, pick } from "./value-conditions-focused";
import { unwrap } from "./turn-replay";

const context = batchV6Context();
type Die = "D4" | "D6" | "D8" | "D10" | "D12" | "D20";
type Side = "ACTOR" | "RIVAL";

function gigId(state: ReturnType<typeof withGigs> | ReturnType<typeof arrange>["state"], controller: string, die: Die) {
    const gig = Object.values(state.objects.gigs).find(g => g.controllerId === controller && g.dieType === die);
    assert.ok(gig, `missing ${controller} ${die}`);
    return gig.id;
}
function configured(entries: readonly [Side, Die, number][]) {
    const a = arrange({ context, sourceCard: TRUST_NO_ONE, gear: [] });
    const values: Record<string, number> = {};
    for (const [side, die, value] of entries) values[gigId(a.state, side === "ACTOR" ? a.actor : a.rival, die)] = value;
    return { ...a, state: withGigs(a.state, context, values) };
}
function resolveTrust(a: ReturnType<typeof configured>, targetId: string, amount: number) {
    const played = playCard(a.state, context, TRUST_NO_ONE);
    let state = played.state;
    const events = [...played.events];
    if (state.resolution.choice?.kind === "TARGET") {
        const next = pick(state, context, option => option.kind === "GIG" && option.gigInstanceId === targetId);
        state = next.state; events.push(...next.events);
    }
    if (state.resolution.choice?.kind === "AMOUNT") {
        const next = pick(state, context, option => option.kind === "AMOUNT" && option.amount === amount);
        state = next.state; events.push(...next.events);
    }
    return { state, events };
}
function drawn(events: ReturnType<typeof resolveTrust>["events"]) {
    return events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND");
}
function changes(events: ReturnType<typeof resolveTrust>["events"]) {
    return events.filter(e => e.payload.kind === "GIG_VALUE_CHANGED");
}

test("V6 Trust No One revision preserves source characteristics and exact authored mechanics", () => {
    assert.equal(trustNoOne.id, TRUST_NO_ONE);
    assert.equal(trustNoOne.revision, 1);
    assert.equal(trustNoOne.type, "PROGRAM");
    assert.equal(trustNoOne.power, undefined);
    assert.deepEqual(trustNoOne.colors, ["BLUE"]);
    assert.deepEqual(trustNoOne.ram, { BLUE: 1 });
    assert.deepEqual(trustNoOne.printedCost, { kind: "EDDIES", amount: 1 });
    assert.equal(trustNoOne.sellProfile.allowed, true);
    assert.deepEqual(trustNoOne.tags, ["Braindance"]);
    assert.deepEqual(trustNoOne.keywords, []);
    assert.deepEqual(trustNoOne.mechanics.keywords, []);
    assert.equal(trustNoOne.cardNumber, "139");
    assert.equal(trustNoOne.printings.length, 3);
    assert.deepEqual(trustNoOne.mechanics.abilities[0].effects, [
        { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 3, direction: "DECREASE" },
        { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE", value: 1 }, count: 1 }
    ]);
    assert.equal(supportsMinGigProgramCard(trustNoOne, context).ok, true);
    assert.equal(supportsPlay(trustNoOne, context).ok, true);
});

test("V6 preserves every V5 immutable revision while adding exactly one reviewed card", () => {
    const previous = batchV5Context();
    for (const card of previous.content.cards) {
        const found = context.content.cards.find(c => c.id === card.id && c.revision === card.revision);
        assert.ok(found);
        assert.equal(canonicalSerialize(found), canonicalSerialize(card), card.id);
    }
    assert.equal(context.content.cards.filter(c => c.id === TRUST_NO_ONE).length, 1);
});

test("V6 real-card decks require the explicit min-Gig Program policy", () => {
    const input = batchV6Input("v6-admission");
    for (const deck of input.decks) assert.equal(deck.main.length, 42);
    const admitted = input.decks.filter(deck => deck.main.includes(TRUST_NO_ONE));
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].legends.includes("restriction-blue-support"), true);
    assert.equal(admitted[0].main.filter(id => id === TRUST_NO_ONE).length, 3);
    assert.equal(createGameWithEvents(input, context).ok, true);
    const rules = RulesetSchema.parse(context.content.ruleset);
    delete rules.gameplay!.turnSlice!.minGigProgram;
    const off = { content: createContentBundle(rules, context.content.cards, context.content.manifest.engine) };
    assert.equal(createGameWithEvents(input, off).ok, false);
});

test("V6 directional decrease enumerates only legal die-face-bounded amounts, including zero", () => {
    const effect = trustNoOne.mechanics.abilities[0].effects[0];
    assert.ok(effect.kind === "ADJUST_GIG_UP_TO");
    for (const [value, expected] of [[4, [0, 1, 2, 3]], [3, [0, 1, 2]], [2, [0, 1]], [1, [0]]] as const) {
        const a = configured([["ACTOR", "D4", value]]);
        const id = gigId(a.state, a.actor, "D4");
        assert.deepEqual(gigAdjustmentOptions(a.state.objects.gigs[id], effect), expected.map(amount => ({ kind: "AMOUNT", amount })));
    }
});

test("V6 decreasing a friendly Gig to min evaluates the later condition and draws exactly once", () => {
    const a = configured([["ACTOR", "D4", 3], ["RIVAL", "D6", 4]]);
    const own = gigId(a.state, a.actor, "D4");
    const result = resolveTrust(a, own, 2);
    const gig = result.state.objects.gigs[own];
    assert.ok(gig.roll.kind === "ROLLED");
    assert.equal(gig.roll.currentValue, 1);
    assert.equal(changes(result.events).length, 1);
    assert.equal(drawn(result.events).length, 1);
    const valueIndex = result.events.findIndex(e => e.payload.kind === "GIG_VALUE_CHANGED");
    const conditionIndex = result.events.findIndex(e => e.payload.kind === "CONDITION_EVALUATED");
    const drawIndex = result.events.findIndex(e => e.payload.kind === "CARD_MOVED" && e.payload.from.zone === "DECK" && e.payload.to.zone === "HAND");
    assert.ok(valueIndex >= 0 && valueIndex < conditionIndex && conditionIndex < drawIndex);
});

test("V6 may target a rival Gig, but a rival min alone never satisfies the controller condition", () => {
    const noFriendlyMin = configured([["ACTOR", "D4", 2], ["RIVAL", "D6", 4]]);
    const rivalTarget = gigId(noFriendlyMin.state, noFriendlyMin.rival, "D6");
    const falseResult = resolveTrust(noFriendlyMin, rivalTarget, 3);
    assert.equal(changes(falseResult.events).length, 1);
    assert.equal(drawn(falseResult.events).length, 0);
    assert.ok(falseResult.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));

    const existingFriendlyMin = configured([["ACTOR", "D4", 1], ["RIVAL", "D6", 4]]);
    const rivalAgain = gigId(existingFriendlyMin.state, existingFriendlyMin.rival, "D6");
    const trueResult = resolveTrust(existingFriendlyMin, rivalAgain, 3);
    assert.equal(drawn(trueResult.events).length, 1);
    assert.ok(trueResult.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met));
});

test("V6 zero is a decline, not a value change, and still resolves the later condition", () => {
    const a = configured([["ACTOR", "D4", 1], ["RIVAL", "D6", 4]]);
    const rival = gigId(a.state, a.rival, "D6");
    const result = resolveTrust(a, rival, 0);
    assert.equal(changes(result.events).length, 0);
    assert.equal(result.events.filter(e => e.payload.kind === "GIG_ADJUSTMENT_DECLINED").length, 1);
    assert.equal(drawn(result.events).length, 1);
    assert.equal(result.state.resolution.choice, null);
    assert.equal(result.state.timing.step, "MAIN");
});

test("V6 no rolled Gigs skips adjustment and evaluates the min condition false", () => {
    const a = configured([]);
    const result = playCard(a.state, context, TRUST_NO_ONE);
    assert.equal(result.state.resolution.choice, null);
    assert.equal(result.state.timing.step, "MAIN");
    assert.equal(changes(result.events).length, 0);
    assert.equal(drawn(result.events).length, 0);
    assert.ok(result.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
});

test("V6 min condition uses current control rather than original ownership", () => {
    const a = configured([["ACTOR", "D6", 3], ["RIVAL", "D4", 1], ["RIVAL", "D6", 4]]);
    const stolenMin = gigId(a.state, a.rival, "D4");
    const rivalTarget = gigId(a.state, a.rival, "D6");
    const m = new TurnMutation(a.state, context);
    unwrap(transferGigs(m, [stolenMin], a.actor));
    const transferred = unwrap(validateState(m.state, context));
    assert.equal(transferred.objects.gigs[stolenMin].ownerId, a.rival);
    assert.equal(transferred.objects.gigs[stolenMin].controllerId, a.actor);

    const played = playCard(transferred, context, TRUST_NO_ONE);
    let state = played.state;
    const events = [...played.events];
    if (state.resolution.choice?.kind === "TARGET") {
        const next = pick(state, context, option => option.kind === "GIG" && option.gigInstanceId === rivalTarget);
        state = next.state; events.push(...next.events);
    }
    if (state.resolution.choice?.kind === "AMOUNT") {
        const next = pick(state, context, option => option.kind === "AMOUNT" && option.amount === 0);
        state = next.state; events.push(...next.events);
    }
    assert.equal(drawn(events).length, 1);
});

test("V6 target and amount pauses survive reload and project stable public actionIds", () => {
    const a = configured([["ACTOR", "D4", 3], ["RIVAL", "D6", 4]]);
    const rivalTarget = gigId(a.state, a.rival, "D6");
    const paid = playCard(a.state, context, TRUST_NO_ONE);
    assert.equal(paid.state.resolution.choice?.kind, "TARGET");

    const targetState = GameStateSchema.parse(JSON.parse(JSON.stringify(paid.state)));
    unwrap(validateState(targetState, context));
    const trusted = unwrap(listLegalActions(targetState, a.actor, context));
    const input = unwrap(buildModelInputV2(targetState, a.actor, context));
    assert.deepEqual(input.legalActions.map(x => x.actionId), trusted.map(x => x.actionId));
    const serialized = JSON.stringify(input);
    for (const field of ["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"])
        assert.equal(serialized.includes(`"${field}"`), false, field);

    const targetIndex = targetState.resolution.choice!.options.findIndex(o => o.kind === "GIG" && o.gigInstanceId === rivalTarget);
    assert.ok(targetIndex >= 0);
    const targetAction = trusted.find(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === targetIndex);
    assert.ok(targetAction);
    assert.deepEqual(unwrap(resolveActionId(targetState, a.actor, targetAction.actionId, context)), { actorId: targetAction.actorId, action: targetAction.action });

    const targeted = pick(targetState, context, o => o.kind === "GIG" && o.gigInstanceId === rivalTarget);
    assert.equal(resolveActionId(targeted.state, a.actor, targetAction.actionId, context).ok, false);
    assert.equal(targeted.state.resolution.choice?.kind, "AMOUNT");

    const amountState = GameStateSchema.parse(JSON.parse(JSON.stringify(targeted.state)));
    unwrap(validateState(amountState, context));
    const amounts = unwrap(listLegalActions(amountState, a.actor, context));
    const labels = amounts.map(x => x.descriptor.label).sort();
    assert.deepEqual(labels, ["Decrease by 0 (no adjustment)", "Decrease by 1", "Decrease by 2", "Decrease by 3"].sort());
    const selected = amounts.find(x => x.descriptor.label === "Decrease by 3");
    const reversed = [...amounts].reverse().find(x => x.descriptor.label === "Decrease by 3");
    assert.ok(selected && reversed);
    assert.equal(selected.actionId, reversed.actionId);
});

for (const [name, mutate] of [
    ["WRONG_SCOPE", (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.execution!.scope = "VALUE_CONDITIONS_V1"; }],
    ["WRONG_MAX", (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => {
        const effect = c.mechanics.abilities[0].effects[0];
        if (effect.kind === "ADJUST_GIG_UP_TO") effect.maximum = 1;
    }],
    ["EXTRA_EFFECT", (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }]
] as const) test(`V6 hidden Trust No One ${name} reaches and is rejected by registered metadata validation`, () => {
    const initial = unwrap(createGameWithEvents(batchV6Input("v6-hidden"), context)).state;
    const forged = CardRevisionSnapshotSchema.parse(trustNoOne);
    mutate(forged);
    const content = createContentBundle(context.content.ruleset, context.content.cards.map(c => c.id === TRUST_NO_ONE ? forged : c), context.content.manifest.engine);
    const state = GameStateSchema.parse(initial);
    state.match.contentManifestHash = content.manifestHash;
    const result = validateState(state, { content });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some(e => e.code === "UNSUPPORTED_MIN_GIG_PROGRAM"), JSON.stringify(result.errors));
});
