import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameStateSchema, CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical, type GameState, type LegalAction, type PendingChoice } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, validateState, observe, RulesView, hashPosition, hashReplayState, modifyGigValue, resolveActionId } from "@tcg/engine";
import { noncombatContext, noncombatInput, noncombatCards, AFTERPARTY, KERRY } from "./noncombat-fixture";
import { noncombatReplay } from "./noncombat-replay";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/noncombat-card-sources.v1.json";
import rules from "./fixtures/noncombat-rules.v1.json";
const context = noncombatContext();
function legal(state: GameState, ctx = context) { return unwrap(listLegalActions(state, state.timing.actingPlayer, ctx)); }
function act(state: GameState, predicate: (a: LegalAction) => boolean, ctx = context) {
    const a = legal(state, ctx).find(predicate); assert.ok(a, `Missing action in ${state.timing.step}`);
    return unwrap(applyAction(state, { actorId: a.actorId, action: a.action }, ctx));
}
function choose(state: GameState, predicate: (option: PendingChoice["options"][number]) => boolean, ctx = context) {
    return act(state, a => a.action.kind === "CHOOSE" && predicate(state.resolution.choice!.options[a.action.optionIndices[0]]), ctx);
}
function main(ctx = context) {
    let s = unwrap(createGameWithEvents(noncombatInput("noncombat-play-34"), ctx)).state;
    while (s.setup) {
        const index = s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0;
        s = act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index, ctx).state;
    }
    return act(s, a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId === "p0-D12", ctx).state;
}
function cardId(state: GameState, slug: string, zone = "HAND") { const c = Object.values(state.objects.cards).find(c => c.cardId === slug && c.controllerId === state.timing.actingPlayer && c.zone.zone === zone); assert.ok(c); return c.id; }
function play(state: GameState, slug = AFTERPARTY, ctx = context) { return act(state, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === cardId(state, slug), ctx); }
function payAll(state: GameState, ctx = context) {
    let s = state;
    while (s.timing.step === "PAYMENT_SELECTION") s = choose(s, o => o.kind === "PAYMENT", ctx).state;
    return s;
}
// Explicit focused positions: no claim these mutations constitute a replay. Original object registries are retained.
function gigs(state: GameState, values: [number, number], rivalValue = 2) {
    const s = GameStateSchema.parse(state);
    for (const [key, value] of [["p0-D12", values[0]], ["p0-D8", values[1]], ["p1-D4", rivalValue]] as const) {
        const g = Object.values(s.objects.gigs).find(g => g.id === key)!;
        if (g.location.zone === "FIXER") {
            const p = s.players[g.controllerId]; p.gigs.FIXER.splice(p.gigs.FIXER.indexOf(g.id), 1); p.gigs.GIGS.push(g.id); g.location.zone = "GIGS";
        }
        g.roll = { kind: "ROLLED", initialValue: value, currentValue: value };
    }
    return unwrap(validateState(s, context));
}
function target(state: GameState, id = "p0-D8") { return choose(state, o => o.kind === "GIG" && o.gigInstanceId === id).state; }
function adjust(state: GameState, mode: string) { return choose(state, o => o.kind === "MODE" && o.mode === mode); }
function kerryPosition() {
    const s = GameStateSchema.parse(main()), id = cardId(s, KERRY), c = s.objects.cards[id];
    s.players[c.controllerId].zones.HAND.splice(s.players[c.controllerId].zones.HAND.indexOf(id), 1);
    s.players[c.controllerId].zones.BATTLEFIELD.push(id); c.zone.zone = "BATTLEFIELD"; c.face = "UP";
    return unwrap(validateState(s, context));
}
function repin(state: GameState, ctx: ReturnType<typeof noncombatContext>) {
    return GameStateSchema.parse({ ...state, match: { ...state.match, rulesetVersion: ctx.content.ruleset.version, rulesetHash: ctx.content.manifest.ruleset.hash, contentManifestHash: ctx.content.manifestHash, cards: ctx.content.manifest.cards.map(({cardId, revision}) => ({cardId, revision})) } });
}
test("reviewed raw provenance preserves exact Afterparty/Kerry text, printing IDs, RAM and separate execution scope", () => {
    assert.equal(sources.matchingErrata.length, 0);
    for (const card of noncombatCards) {
        const source = sources.records.find(s => s.record.slug === card.id)!;
        assert.equal(card.provenance.sourceHash, hashCanonical(source.record));
        assert.equal(card.rulesText, source.record.rules_text);
        assert.equal(card.revision, 1);
        assert.equal(card.execution?.scope, "NONCOMBAT_PLAY_V1");
        assert.equal(card.printings[0].id, source.record.printings[0].id);
        assert.match(source.captureHash, /^[a-f0-9]{64}$/);
    }
    for (const id of ["2.8", "4.14.2", "6.3.3", "6.4.4", "6.4.5", "10.2", "11.15.3.1", "11.3.2"]) assert.ok(rules.records.some(r => r.id === id));
});
test("PLAY_CARD is one parent per eligible hand instance; no Cartesian payment actions", () => {
    let s = main(); s = act(s, a => a.action.kind === "SELL_CARD" && s.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card")).state;
    const id = cardId(s, AFTERPARTY), actions = legal(s).filter(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id);
    assert.equal(actions.length, 1);
    const result = play(s);
    assert.equal(result.state.timing.step, "PAYMENT_SELECTION");
    assert.equal(result.state.objects.cards[id].zone.zone, "HAND");
    assert.equal(result.state.objects.cards[id].face, "UP");
    assert.ok(result.state.resolution.choice!.options.length > 1);
    assert.equal(result.events.some(e => e.payload.kind === "PAYMENT_MADE"), false);
});
test("payment labels protect hidden sources while a declared Program is revealed to both players", () => {
    let s = main(); s = act(s, a => a.action.kind === "SELL_CARD" && s.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card")).state; s = play(s).state;
    const actor = s.timing.actingPlayer, rival = s.match.playerOrder[1], id = cardId(s, AFTERPARTY);
    const obs = unwrap(observe(s, rival, context));
    assert.equal(obs.players[0].cards.filter(c => c.zone === "HAND").length, 1);
    assert.ok(obs.players[0].cards.some(c => c.publicId === id && c.content?.cardId === AFTERPARTY));
    assert.equal(obs.inspectedCards, undefined);
    assert.equal(JSON.stringify(obs).includes(s.rng.seed), false);
    assert.deepEqual(unwrap(listLegalActions(s, rival, context)), []);
    assert.ok(legal(s).every(a => /^Pay with (eddie|legend) \d+$/.test(a.descriptor.label)));
    assert.ok(unwrap(observe(s, actor, context)).players[0].cards.filter(c => c.zone === "HAND").length > 1);
    const extra = GameStateSchema.parse(s);
    for (const cid of extra.players[actor].zones.HAND) extra.objects.cards[cid].face = "UP";
    assert.equal(unwrap(observe(extra, rival, context)).players[0].cards.filter(c => c.zone === "HAND").length, 1);
});
test("Program uses a separate temporary location and moves the same instance to face-up trash after effects", () => {
    const before = main(), id = cardId(before, AFTERPARTY), result = play(before), s = result.state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.objects.cards[id].zone.zone, "RESOLVING_PROGRAM");
    assert.deepEqual(s.players[s.timing.actingPlayer].zones.RESOLVING_PROGRAM, [id]);
    assert.ok(unwrap(observe(s, s.match.playerOrder[1], context)).players[0].cards.some(c => c.publicId === id && c.content?.cardId === AFTERPARTY));
    const done = adjust(target(s, "p0-D12"), "KEEP");
    assert.equal(done.state.objects.cards[id].zone.zone, "TRASH");
    assert.equal(done.state.objects.cards[id].face, "UP");
    assert.equal(done.state.players[done.state.timing.actingPlayer].zones.RESOLVING_PROGRAM, undefined);
    assert.equal(Object.keys(done.state.objects.cards).length, Object.keys(before.objects.cards).length);
    assert.equal(done.state.timing.step, "MAIN");
    assert.equal(done.state.resolution.current, null);
    assert.equal(result.events.filter(e => e.payload.kind === "EFFECT_PENDING").length, 2);
});
for (const [mode, delta] of [["INCREASE_1", 1], ["DECREASE_1", -1], ["KEEP", 0]] as const) test(`Afterparty ${mode} preserves original roll and identity; Street Cred derives from current values`, () => {
    const before = gigs(main(), [3, 3]), s = target(play(before).state), gid = s.resolution.playContinuation!.targetGigId!, original = s.objects.gigs[gid];
    const done = adjust(s, mode), gig = done.state.objects.gigs[gid];
    assert.deepEqual({ ...gig, roll: original.roll }, original);
    assert.deepEqual(gig.roll, { kind: "ROLLED", initialValue: 3, currentValue: 3 + delta });
    assert.equal(new RulesView(done.state, context).getStreetCred(s.timing.actingPlayer), 6 + delta);
    assert.equal(done.events.filter(e => e.payload.kind === "GIG_VALUE_CHANGED").length, delta ? 1 : 0);
    assert.equal(done.events.filter(e => e.payload.kind === "GIG_ADJUSTMENT_DECLINED").length, delta ? 0 : 1);
    const facts = done.events.map(e => e.payload.kind);
    assert.ok(facts.indexOf("CONDITION_EVALUATED") > facts.indexOf(delta ? "GIG_VALUE_CHANGED" : "GIG_ADJUSTMENT_DECLINED"));
});
test("conditional draw evaluates resulting current values: false-to-true and true-to-false", () => {
    for (const [values, mode, met] of [[[3, 3], "INCREASE_1", true], [[3, 2], "INCREASE_1", false], [[3, 3], "KEEP", false]] as const) {
        const before = gigs(main(), [...values]), s = target(play(before).state), actor = s.timing.actingPlayer;
        const done = adjust(s, mode);
        assert.ok(done.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === met));
        assert.equal(done.state.players[actor].zones.HAND.length, s.players[actor].zones.HAND.length + Number(met));
        if (met) {
            const top = s.players[actor].zones.DECK[0];
            assert.equal(done.state.objects.cards[top].zone.zone, "HAND");
            assert.ok(done.events.some(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId === top));
        }
    }
});
test("Afterparty may target rival Gigs; own condition counts controllers, not owners or die types", () => {
    const s = play(gigs(main(), [3, 3])).state;
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "GIG" && o.gigInstanceId === "p1-D4"));
    const selected = target(s, "p1-D4"), done = adjust(selected, "INCREASE_1");
    assert.equal(new RulesView(done.state, context).getStreetCred(done.state.match.playerOrder[1]), 3);
    assert.ok(done.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    const owned = GameStateSchema.parse(gigs(main(), [3, 3]));
    const transferred = Object.values(owned.objects.gigs).find(g => g.id === "p1-D4")!;
    owned.players[owned.match.playerOrder[1]].gigs.GIGS = [];
    transferred.controllerId = owned.match.playerOrder[0]; transferred.location.playerId = transferred.controllerId;
    owned.players[transferred.controllerId].gigs.GIGS.push(transferred.id);
    const view = new RulesView(owned, context);
    assert.equal(view.testCondition(transferred.controllerId, {kind: "DISTINCT_GIG_VALUES", minimum: 2}), true);
});
test("three controlled die types at current 3, 3, 7 yield two distinct values despite matching initial rolls", () => {
    const s = GameStateSchema.parse(gigs(main(), [3, 3])), actor = s.timing.actingPlayer;
    const d4 = Object.values(s.objects.gigs).find(g => g.id === "p0-D4")!;
    s.players[actor].gigs.FIXER.splice(s.players[actor].gigs.FIXER.indexOf(d4.id), 1);
    s.players[actor].gigs.GIGS.push(d4.id); d4.location.zone = "GIGS";
    d4.roll = {kind: "ROLLED", initialValue: 3, currentValue: 3};
    const d12 = Object.values(s.objects.gigs).find(g => g.id === "p0-D12")!;
    d12.roll = {kind: "ROLLED", initialValue: 3, currentValue: 7};
    const view = new RulesView(s, context);
    assert.equal(view.testCondition(actor, {kind: "GIG_COUNT", minimum: 3}), true);
    assert.equal(view.testCondition(actor, {kind: "DISTINCT_GIG_DIE_TYPES", minimum: 3}), true);
    assert.equal(view.testCondition(actor, {kind: "DISTINCT_GIG_VALUES", minimum: 2}), true);
    assert.equal(view.testCondition(actor, {kind: "DISTINCT_GIG_VALUES", minimum: 3}), false);
    assert.equal(view.getStreetCred(actor), 13);
});
test("Fixer/unrolled Gigs and nonexistent controllers are rejected; stale target options are rederived", () => {
    const s = play(gigs(main(), [3, 3])).state;
    assert.equal(s.resolution.choice!.options.some(o => o.kind === "GIG" && o.gigInstanceId.endsWith("D20")), false);
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options[0] = {kind: "GIG", gigInstanceId: Object.values(s.objects.gigs).find(g => g.id === "p0-D20")!.id};
    assert.equal(validateState(forged, context).ok, false);
    const amount = target(s), stale = GameStateSchema.parse(amount), gid = stale.resolution.playContinuation!.targetGigId!;
    stale.objects.gigs[gid].location.zone = "FIXER";
    assert.equal(validateState(stale, context).ok, false);
    const invalid = GameStateSchema.parse(s); invalid.objects.gigs[gid].controllerId = "00000000-0000-4000-8000-000000000099" as typeof invalid.timing.actingPlayer;
    assert.equal(validateState(invalid, context).ok, false);
    assert.equal(resolveActionId(amount, amount.timing.actingPlayer, legal(s)[0].actionId, context).ok, false);
});
test("reviewed die-face bounds reject zero/overflow without clamping and enumerate only possible adjustments", () => {
    for (const value of [1, 8]) {
        const s = target(play(gigs(main(), [3, value])).state);
        const modes = s.resolution.choice!.options.map(o => o.kind === "MODE" ? o.mode : "");
        assert.ok(modes.includes("KEEP"));
        assert.equal(modes.includes(value === 1 ? "DECREASE_1" : "INCREASE_1"), false);
        const before = gigs(main(), [3, value]), id = Object.values(before.objects.gigs).find(g => g.id === "p0-D8")!.id;
        const result = modifyGigValue(before, id, value === 1 ? -1 : 1, context);
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.errors[0].code, "GIG_VALUE_OUT_OF_BOUNDS");
        assert.equal(modifyGigValue(before, id, 0, context).ok, false);
        const bad = GameStateSchema.parse(before); bad.objects.gigs[id].roll = {kind: "ROLLED", initialValue: value, currentValue: value === 1 ? 0 : 9};
        assert.equal(validateState(bad, context).ok, false);
    }
});
test("forged payment, source, pending primitive, amount and effect identity fail state validation", () => {
    let s = main(); s = act(s, a => a.action.kind === "SELL_CARD" && s.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card")).state;
    const payment = play(s).state;
    const forged = GameStateSchema.parse(payment); forged.resolution.playContinuation!.remainingCost++;
    assert.equal(validateState(forged, context).ok, false);
    const targetState = payAll(payment), amount = target(targetState, "p0-D12");
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.current!.effect = {kind: "DRAW", count: 99}; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.current!.id = "forged"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.pending[0].effect = {kind: "DRAW", count: 99}; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[s.resolution.playContinuation!.sourceId].face = "DOWN"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.choice!.options.push({kind: "MODE", mode: "INCREASE_99"}); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.playContinuation!.selectedSources = []; },
    ]) { const bad = GameStateSchema.parse(amount); mutate(bad); assert.equal(validateState(bad, context).ok, false); }
});
test("payment, target and amount decisions preserve POSITION_V2/action IDs across transport provenance changes", () => {
    let s = main(); s = act(s, a => a.action.kind === "SELL_CARD" && s.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card")).state;
    const payment = play(s).state, targeting = payAll(payment), amount = target(targeting, "p0-D12");
    for (const original of [s, payment, targeting, amount, kerryPosition()]) {
        const changed = GameStateSchema.parse({...original, match: {...original.match, version: original.match.version + 20, eventSequence: original.match.eventSequence + 50}});
        changed.match.id = "00000000-0000-4000-8000-000000000099" as typeof changed.match.id;
        for (const e of [...changed.resolution.pending, ...(changed.resolution.current ? [changed.resolution.current] : [])]) e.causedBySequence += 50;
        const valid = unwrap(validateState(changed, context));
        assert.equal(hashPosition(original), hashPosition(valid));
        assert.deepEqual(legal(original), legal(valid));
        assert.notEqual(hashReplayState(original), hashReplayState(valid));
    }
});
test("unreviewed metadata, unsupported primitives/costs and promo do not certify play or deck admission", () => {
    const original = main();
    for (const change of [
        {execution: undefined}, {execution: {scope: "NONCOMBAT_PLAY_V1", status: "UNSUPPORTED"}},
        {printedCost: {kind: "DASH"}},
        {mechanics: {keywords: ["QUICK"], modifiers: [], abilities: noncombatCards[0].mechanics.abilities}},
        {mechanics: {keywords: [], modifiers: [], abilities: [{...noncombatCards[0].mechanics.abilities[0], effects: [{kind: "DAMAGE", target: {kind: "SELF"}, amount: 1}]}]}},
    ]) {
        const cards = context.content.cards.map(c => c.id === AFTERPARTY ? CardRevisionSnapshotSchema.parse(JSON.parse(JSON.stringify({...c, ...change}))) : CardRevisionSnapshotSchema.parse(c));
        const ctx = {content: createContentBundle(RulesetSchema.parse(context.content.ruleset), cards, context.content.manifest.engine)};
        assert.equal(createGameWithEvents(noncombatInput(), ctx).ok, false);
        assert.equal(legal(repin(original, ctx), ctx).some(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === cardId(original, AFTERPARTY)), false);
    }
    const input = noncombatInput(); input.decks[0].legends[0] = "rebecca-having-a-moment";
    assert.equal(createGameWithEvents(input, context).ok, false);
});
test("insufficient or inexact payment removes play; wrong source zone and actor reject semantic submission", () => {
    const before = main(), id = cardId(before, AFTERPARTY), bad = GameStateSchema.parse(before);
    for (const c of Object.values(bad.objects.cards)) if (c.zone.zone === "LEGENDS") c.readiness = "SPENT";
    assert.equal(legal(bad).some(a => a.action.kind === "PLAY_CARD"), false);
    assert.equal(applyAction(before, {actorId: before.match.playerOrder[1], action: {kind: "PLAY_CARD", cardInstanceId: id}}, context).ok, false);
    const moved = GameStateSchema.parse(before); moved.players[moved.timing.actingPlayer].zones.HAND.splice(moved.players[moved.timing.actingPlayer].zones.HAND.indexOf(id), 1); moved.players[moved.timing.actingPlayer].zones.TRASH.push(id); moved.objects.cards[id].zone.zone = "TRASH";
    assert.equal(applyAction(moved, {actorId: moved.timing.actingPlayer, action: {kind: "PLAY_CARD", cardInstanceId: id}}, context).ok, false);
    const cards = context.content.cards.map(c => CardRevisionSnapshotSchema.parse(c)), rules = RulesetSchema.parse(context.content.ruleset); rules.gameplay!.legendPaymentValue = 2;
    const ctx = {content: createContentBundle(rules, cards, context.content.manifest.engine)};
    assert.equal(legal(repin(before, ctx), ctx).some(a => a.action.kind === "PLAY_CARD"), false); // available value 2 cannot exactly pay 1 or 4.
});
test("Kerry appears only ready, friendly, unlagged in open MAIN with a CURRENT controlled Gig at 8+", () => {
    const before = kerryPosition(), id = cardId(before, KERRY, "BATTLEFIELD");
    assert.ok(legal(before).some(a => a.action.kind === "ACTIVATE_ABILITY"));
    for (const mutate of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[id].readiness = "SPENT"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[id].statuses.push("LAG"); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[id].controllerId = s.match.playerOrder[1]; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { const g = Object.values(s.objects.gigs).find(g => g.id === "p0-D12")!; g.roll = {kind: "ROLLED", initialValue: 12, currentValue: 7}; },
    ]) { const s = GameStateSchema.parse(before); mutate(s); assert.equal(legal(s).some(a => a.action.kind === "ACTIVATE_ABILITY"), false); }
    const pending = play(before).state;
    assert.equal(legal(pending).some(a => a.action.kind === "ACTIVATE_ABILITY"), false);
    assert.equal(applyAction(before, {actorId: before.timing.actingPlayer, action: {kind: "ACTIVATE_ABILITY", sourceInstanceId: id, abilityId: "wrong@1"}}, context).ok, false);
});
test("Kerry activation spends only its source, draws through the common primitive, and refreshes observation/actions", () => {
    const before = kerryPosition(), actor = before.timing.actingPlayer, id = cardId(before, KERRY, "BATTLEFIELD");
    const after = act(before, a => a.action.kind === "ACTIVATE_ABILITY");
    assert.equal(after.state.objects.cards[id].readiness, "SPENT");
    assert.equal(after.state.players[actor].zones.HAND.length, before.players[actor].zones.HAND.length + 2);
    assert.equal(after.events.some(e => e.payload.kind === "PAYMENT_MADE"), false);
    assert.deepEqual(after.events.slice(0,2).map(e => e.payload.kind), ["CARD_SPENT", "ABILITY_ACTIVATED"]);
    assert.equal(legal(after.state).some(a => a.action.kind === "ACTIVATE_ABILITY"), false);
    assert.equal(unwrap(observe(after.state, actor, context)).players[0].cards.find(c => c.publicId === id)?.readiness, "SPENT");
    assert.equal(after.state.timing.step, "MAIN");
});
test("multi-source ordinary play retains exact payment continuation and spends each selected object once", () => {
    const draft = GameStateSchema.parse(main()), actor = draft.timing.actingPlayer;
    for (const id of draft.players[actor].zones.LEGENDS) draft.objects.cards[id].readiness = "READY";
    for (const id of draft.players[actor].zones.HAND.filter(id => draft.objects.cards[id].cardId.startsWith("slice-card")).slice(0, 2)) {
        draft.players[actor].zones.HAND.splice(draft.players[actor].zones.HAND.indexOf(id), 1);
        draft.players[actor].zones.EDDIES.push(id); draft.objects.cards[id].zone.zone = "EDDIES";
    }
    let s = play(unwrap(validateState(draft, context)), KERRY).state;
    assert.equal(s.timing.step, "PAYMENT_SELECTION");
    const id = cardId(s, KERRY);
    for (let paid = 1; paid <= 4; paid++) {
        const result = choose(s, o => o.kind === "PAYMENT"); s = result.state;
        if (paid < 4) {
            assert.equal(s.resolution.playContinuation!.remainingCost, 4 - paid);
            for (const p of s.resolution.playContinuation!.selectedSources) {
                assert.equal(s.objects.cards[p.cardInstanceId].readiness, "READY");
                assert.equal(s.resolution.choice!.options.some(o => o.kind === "PAYMENT" && o.source.cardInstanceId === p.cardInstanceId), false);
            }
            const stale = GameStateSchema.parse(s);
            stale.objects.cards[stale.resolution.playContinuation!.selectedSources[0].cardInstanceId].readiness = "SPENT";
            assert.equal(validateState(stale, context).ok, false);
        } else {
            assert.equal(s.timing.step, "MAIN");
            const payment = result.events.find(e => e.payload.kind === "PAYMENT_MADE")!.payload;
            assert.equal(payment.kind, "PAYMENT_MADE");
            if (payment.kind === "PAYMENT_MADE") {
                assert.equal(payment.sources.length, 4);
                for (const p of payment.sources) assert.equal(s.objects.cards[p.cardInstanceId].readiness, "SPENT");
            }
        }
    }
    assert.equal(s.objects.cards[id].zone.zone, "BATTLEFIELD");
    assert.deepEqual(s.objects.cards[id].statuses, ["LAG"]);
    assert.equal(legal(s).some(a => a.action.kind === "ACTIVATE_ABILITY"), false);
});
test("no-target Program skips impossible first part, evaluates condition, and resolves; empty draw retains loss policy", () => {
    const unrolled = GameStateSchema.parse(main());
    for (const g of Object.values(unrolled.objects.gigs)) if (g.roll.kind === "ROLLED") { g.roll = {kind: "UNROLLED"}; g.location.zone = "FIXER"; const p = unrolled.players[g.controllerId]; p.gigs.GIGS.splice(p.gigs.GIGS.indexOf(g.id),1); p.gigs.FIXER.push(g.id); }
    const noTargets = play(unrolled); assert.equal(noTargets.state.timing.step, "MAIN");
    assert.ok(noTargets.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    const empty = GameStateSchema.parse(gigs(main(), [3,3])), actor = empty.timing.actingPlayer;
    for (const id of empty.players[actor].zones.DECK) { empty.objects.cards[id].zone.zone = "TRASH"; empty.objects.cards[id].face = "UP"; empty.players[actor].zones.TRASH.push(id); }
    empty.players[actor].zones.DECK = [];
    const id = cardId(empty, AFTERPARTY), after = adjust(target(play(empty).state), "INCREASE_1");
    assert.equal(after.state.match.outcome?.reason, "EMPTY_DRAW");
    assert.equal(after.state.timing.step, "FINISHED");
    assert.equal(after.state.objects.cards[id].zone.zone, "TRASH");
});
test("full real noncombat replay is deterministic, persists lag semantics, and exposes only strategic positions", () => {
    const replay = noncombatReplay();
    assert.deepEqual(replay, JSON.parse(readFileSync(new URL("./fixtures/noncombat-replay.v1.json", import.meta.url), "utf8")));
    assert.deepEqual(replay, noncombatReplay());
    assert.equal(replay.steps.length, 24);
    const unitPlay = replay.steps.find(s => s.action.action.kind === "PLAY_CARD" && s.events.some(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "BATTLEFIELD"))!;
    assert.equal(unitPlay.step, "MAIN"); // The only exact set needs no ordering choices.
    assert.ok(unitPlay.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.length === 4));
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "GIG_VALUE_CHANGED")));
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "LAG_REMOVED")));
    for (const step of ["MAIN", "PAYMENT_SELECTION", "TARGET_SELECTION", "AMOUNT_SELECTION"]) assert.ok(replay.positions.some(p => p.state.timing.step === step));
    assert.ok(replay.positions.some(p => p.legalActions.some(a => a.action.kind === "ACTIVATE_ABILITY")));
    assert.ok(replay.positions.every(p => p.legalActions.length > 1));
    assert.equal(replay.steps.some(s => s.legalActions.some(a => ["DECLARE_ATTACK", "DECLARE_BLOCKER", "GO_SOLO", "PASS_REACT"].includes(a.action.kind))), false);
});
