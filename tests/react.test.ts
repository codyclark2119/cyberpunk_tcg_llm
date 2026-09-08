import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardInstanceIdSchema, CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, createContentBundle, hashCanonical, type CardInstanceId, type GameState, type LegalAction, type Result } from "@tcg/domain";
import { applyAction, applyCommand, advanceResolution, createGameWithEvents, hashPosition, hashReplayState, listLegalActions, observe, resolveActionId, RulesView, validateState, moveCardForEffect } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { TurnMutation } from "../packages/engine/src/turn";
import { finishAttackEffects } from "../packages/engine/src/combat";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { reactCards, reactContext, reactInput, BOMBUS, FLOOR_IT, VIKTOR } from "./react-fixture";
import { reactReplay } from "./react-replay";
import { KERRY } from "./noncombat-fixture";
import { MANTIS } from "./gear-fixture";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/react-card-sources.v1.json";
import rules from "./fixtures/react-rules.v1.json";

const context = reactContext(), replay = reactReplay(), states: GameState[] = [replay.initialized.state];
for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const callIndex = replay.steps.findIndex(x => x.action.action.kind === "CALL_LEGEND"), quickIndex = replay.steps.findIndex(x => x.action.action.kind === "PLAY_CARD" && x.legalActions.some(a => a.action.kind === "PASS_REACT"));
const open = states[callIndex], afterCall = states[quickIndex], afterQuick = states[replay.steps.findIndex(x => x.action.action.kind === "DECLARE_BLOCKER")], afterBlock = states.at(-2)!, closed = states.at(-1)!;
const defender = open.timing.actingPlayer, attackerPlayer = open.timing.activePlayer, attacker = replay.attackerId;
const blocker = Object.values(open.objects.cards).find(c => c.cardId === BOMBUS && c.controllerId === defender && c.zone.zone === "BATTLEFIELD")!.id;
const viktor = Object.values(open.objects.cards).find(c => c.cardId === VIKTOR && c.controllerId === defender)!.id;
const main = [...states].reverse().find(s => s.timing.window === "MAIN")!;
const legal = (s: GameState, ctx = context) => unwrap(listLegalActions(s, s.timing.actingPlayer, ctx));
function act(s: GameState, predicate: (a: LegalAction) => boolean) { const action = legal(s).find(predicate); assert.ok(action, `Missing action at ${s.timing.step}`); return unwrap(applyAction(s, { actorId: action.actorId, action: action.action }, context)); }
function failed<T>(r: Result<T>, code?: string) { assert.equal(r.ok, false); if (!r.ok && code) assert.equal(r.errors[0].code, code); }
function drainPayment(s: GameState) { while (s.timing.step === "PAYMENT_SELECTION") s = act(s, a => a.action.kind === "CHOOSE").state; return s; }
function playQuick(s: GameState, target = attacker) {
    const started = act(s, a => a.action.kind === "PLAY_CARD" && s.objects.cards[a.action.cardInstanceId].cardId === FLOOR_IT);
    let next = drainPayment(started.state);
    if (next.timing.step === "TARGET_SELECTION") next = act(next, a => a.action.kind === "CHOOSE" && (() => { const o = next.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && o.cardInstanceId === target; })()).state;
    return next;
}
/** Trusted focused fixture preparation only; headline replay has no state/RNG patches. */
function relocate(s: ReturnType<typeof GameStateSchema.parse>, id: CardInstanceId, zone: "HAND" | "TRASH" | "BATTLEFIELD") {
    const c = s.objects.cards[id], refs = s.players[c.zone.playerId].zones[c.zone.zone]!;
    refs.splice(refs.indexOf(id), 1); s.players[c.controllerId].zones[zone].push(id); c.zone = { playerId: c.controllerId, zone }; c.face = zone === "HAND" ? "DOWN" : "UP";
    if (zone !== "BATTLEFIELD") c.statuses = c.statuses.filter(x => x !== "LAG");
}
function repin(s: GameState, ctx: typeof context) { return GameStateSchema.parse({ ...s, match: { ...s.match, rulesetVersion: ctx.content.ruleset.version, rulesetHash: ctx.content.manifest.ruleset.hash, contentManifestHash: ctx.content.manifestHash, cards: ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision })) } }); }

test("React review pins exact rules, real demo printings, full text, costs and normalized mechanics", () => {
    for (const id of ["9.7", "9.7.1", "9.9.1", "9.11", "9.12", "11.11.2", "11.24.1", "11.26.3", "8.16.2", "11.3.1.2"]) assert.ok(rules.rules.some(r => r.id === id));
    for (const r of reactCards) {
        const source = sources.cards.find(s => s.record.slug === r.id)!;
        assert.equal(r.provenance.sourceHash, hashCanonical(source.record)); assert.equal(r.rulesText, source.record.rules_text);
        assert.equal(r.printings.length, 5); assert.ok(r.printings.some(p => p.setCode === "mercdemodeck"));
        assert.deepEqual(r.printedCost, { kind: "EDDIES", amount: source.record.cost });
        assert.equal(r.execution?.scope, "COMBAT_REACT_V1");
    }
    assert.deepEqual(reactCards.find(c => c.id === BOMBUS)!.mechanics, { keywords: ["BLOCKER"], abilities: [], modifiers: [] });
});
test("complete Quick and Blocker shapes are checked at admission and action enumeration", () => {
    for (const id of [FLOOR_IT, BOMBUS]) for (const change of [
        (c: typeof reactCards[number]) => ({ ...c, execution: { scope: "COMBAT_REACT_V1", status: "UNSUPPORTED" } }),
        (c: typeof reactCards[number]) => ({ ...c, printedCost: { kind: "DASH" } }),
        (c: typeof reactCards[number]) => ({ ...c, mechanics: { ...c.mechanics, keywords: [...c.mechanics.keywords, "ADRENALINE"] } }),
        (c: typeof reactCards[number]) => ({ ...c, mechanics: { ...c.mechanics, abilities: [...c.mechanics.abilities, { id: "unreviewed", trigger: "WHEN_DEFEATED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 3 }] }] } })
    ]) {
        const cards = context.content.cards.map(c => CardRevisionSnapshotSchema.parse(c.id === id ? change(CardRevisionSnapshotSchema.parse(c)) : c));
        const ctx = { content: createContentBundle(RulesetSchema.parse(context.content.ruleset), cards, context.content.manifest.engine) };
        failed(createGameWithEvents(reactInput(), ctx));
        const actions = legal(repin(open, ctx), ctx);
        assert.equal(actions.some(a => (a.action.kind === "PLAY_CARD" || a.action.kind === "DECLARE_BLOCKER") && open.objects.cards[a.action.cardInstanceId].cardId === id), false);
    }
});
test("only the defender receives React actions in an explicit deterministic category/object order", () => {
    assert.deepEqual(unwrap(listLegalActions(open, attackerPlayer, context)), []);
    const actions = legal(open), kinds = [...new Set(actions.map(a => a.action.kind))];
    assert.deepEqual(kinds, ["CALL_LEGEND", "PLAY_CARD", "DECLARE_BLOCKER", "PASS_REACT"]);
    assert.ok(actions.filter(a => a.action.kind === "PLAY_CARD").every(a => a.action.kind === "PLAY_CARD" && open.objects.cards[a.action.cardInstanceId].cardId === FLOOR_IT));
    for (const kind of ["END_TURN", "SELL_CARD", "ACTIVATE_ABILITY", "DECLARE_ATTACK", "GO_SOLO"]) assert.equal(kinds.includes(kind as typeof kinds[number]), false);
    const reordered = GameStateSchema.parse(open); reordered.objects.cards = Object.fromEntries(Object.entries(reordered.objects.cards).reverse());
    assert.deepEqual(legal(reordered), actions);
    failed(applyAction(open, { actorId: attackerPlayer, action: { kind: "PASS_REACT" } }, context));
    failed(advanceResolution(open, context), "PLAYER_DECISION_REQUIRED");
});
test("React CALL reuses exact payment, preserves orientation, resolves Viktor search and returns to React", () => {
    const start = act(open, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === viktor).state;
    assert.equal(start.timing.step, "PAYMENT_SELECTION"); assert.deepEqual(start.resolution.returnTo, { kind: "RIVAL_REACT" });
    assert.ok(legal(start).every(a => a.action.kind === "CHOOSE"));
    const source = start.resolution.choice!.options.find(o => o.kind === "PAYMENT" && o.source.cardInstanceId !== viktor)!;
    assert.equal(source.kind, "PAYMENT");
    const called = act(start, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === start.resolution.choice!.options.indexOf(source));
    assert.equal(called.state.objects.cards[viktor].face, "UP"); assert.equal(called.state.objects.cards[viktor].readiness, open.objects.cards[viktor].readiness);
    assert.equal(called.state.timing.activePlayer, attackerPlayer); assert.equal(called.state.players[defender].economy.callsThisTurn, 1);
    assert.equal(called.events.filter(e => e.payload.kind === "PAYMENT_MADE").length, 1);
    let s = called.state;
    while (s.resolution.searchContinuation) s = act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0).state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.resolution.returnTo, undefined); assert.equal(s.resolution.current, null);
    assert.ok(legal(s).some(a => a.action.kind === "PASS_REACT")); assert.equal(legal(s).some(a => a.action.kind === "CALL_LEGEND"), false);
    assert.equal(s.players[attackerPlayer].economy.callsThisTurn, 0);
});
test("CALL uses the current global turn allowance and cannot bypass usage by changing reaction order", () => {
    const s = GameStateSchema.parse(open); s.players[defender].economy.callsThisTurn = 1;
    assert.equal(legal(s).some(a => a.action.kind === "CALL_LEGEND"), false);
    failed(applyAction(s, { actorId: defender, action: { kind: "CALL_LEGEND", cardInstanceId: viktor } }, context));
    const blocked = act(afterCall, a => a.action.kind === "DECLARE_BLOCKER").state;
    assert.equal(legal(blocked).some(a => a.action.kind === "CALL_LEGEND"), false);
    const later = unwrap((() => { const m = new TurnMutation(afterCall, context); m.state.timing.combat = { stage: "NONE" }; m.state.timing.actingPlayer = attackerPlayer; m.phase("MAIN"); return m.result(); })()).state;
    const next = act(later, a => a.action.kind === "END_TURN").state;
    assert.equal(next.timing.activePlayer, defender); assert.equal(next.players[defender].economy.callsThisTurn, 0); assert.equal(next.players[defender].economy.usageTurn, next.timing.turn);
});
test("sole exact CALL/Quick payments resolve automatically and cannot be supplied as fabricated extra choices", () => {
    for (const kind of ["CALL_LEGEND", "PLAY_CARD"] as const) {
        const s = GameStateSchema.parse(open);
        const keep = new RulesView(s, context).listPaymentSources(defender)[0];
        for (const c of Object.values(s.objects.cards)) if (c.controllerId === defender && ["EDDIES", "LEGENDS"].includes(c.zone.zone) && c.id !== keep.cardInstanceId) c.readiness = "SPENT";
        const result = act(s, a => a.action.kind === kind && (kind !== "CALL_LEGEND" || (a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === viktor)));
        assert.notEqual(result.state.timing.step, "PAYMENT_SELECTION");
        assert.equal(result.state.objects.cards[keep.cardInstanceId].readiness, "SPENT");
        const payment = result.events.find(e => e.payload.kind === "PAYMENT_MADE")!;
        assert.ok(payment.payload.kind === "PAYMENT_MADE"); assert.deepEqual(payment.payload.sources, [keep]);
    }
});
test("Quick pays ordinary cost, reveals the Program, offers rival Unit targets and resolves to trash before reopening", () => {
    const chosen = legal(afterCall).find(a => a.action.kind === "PLAY_CARD")!;
    assert.ok(chosen.action.kind === "PLAY_CARD"); const id = chosen.action.cardInstanceId;
    const started = unwrap(applyAction(afterCall, { actorId: chosen.actorId, action: chosen.action }, context));
    assert.equal(started.state.timing.step, "PAYMENT_SELECTION"); assert.equal(started.state.objects.cards[id].zone.zone, "HAND"); assert.equal(started.state.objects.cards[id].face, "UP");
    const target = drainPayment(started.state);
    assert.equal(target.timing.step, "TARGET_SELECTION"); assert.equal(target.objects.cards[id].zone.zone, "RESOLVING_PROGRAM"); assert.deepEqual(target.resolution.returnTo, { kind: "RIVAL_REACT" });
    assert.ok(target.resolution.choice!.options.every(o => o.kind === "CARD" && target.objects.cards[o.cardInstanceId].controllerId === attackerPlayer));
    const resolved = act(target, a => a.action.kind === "CHOOSE" && (() => { const o = target.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && o.cardInstanceId === attacker; })());
    assert.equal(resolved.state.objects.cards[id].zone.zone, "TRASH"); assert.equal(resolved.state.objects.cards[id].id, id);
    assert.equal(resolved.state.players[defender].zones.HAND.length, afterCall.players[defender].zones.HAND.length); // One played, one drawn.
    assert.equal(new RulesView(resolved.state, context).getEffectivePower(attacker), 4); assert.equal(resolved.state.timing.step, "RIVAL_REACT");
    assert.deepEqual(resolved.events.map(e => e.payload.kind), ["POWER_MODIFIER_APPLIED", "EFFECT_RESOLVED", "CARD_MOVED", "EFFECT_RESOLVED", "CARD_MOVED", "RIVAL_REACT_OPENED"]);
    assert.equal(context.content.cards.find(c => c.id === resolved.state.objects.cards[attacker].cardId)!.power, 3);
});
test("payment, search and Quick target choices exclude PASS and all new reactions, including forged choices", () => {
    const continuations = states.filter(s => s.timing.combat.stage === "RIVAL_REACT" && s.resolution.choice);
    assert.ok(continuations.some(s => s.resolution.searchContinuation)); assert.ok(continuations.some(s => s.resolution.playContinuation?.phase === "EFFECT"));
    for (const s of continuations) {
        assert.deepEqual(s.resolution.returnTo, { kind: "RIVAL_REACT" }); assert.ok(legal(s).every(a => a.action.kind === "CHOOSE"));
        const hash = hashReplayState(s);
        for (const action of [{ kind: "PASS_REACT" as const }, { kind: "DECLARE_BLOCKER" as const, cardInstanceId: blocker }, { kind: "CALL_LEGEND" as const, cardInstanceId: viktor }]) failed(applyAction(s, { actorId: defender, action }, context));
        failed(applyAction(s, { actorId: defender, action: { kind: "CHOOSE", choiceId: s.resolution.choice!.id, optionIndices: [999] } }, context));
        assert.equal(hashReplayState(s), hash);
        for (const destination of [undefined, { kind: "MAIN" as const }]) { const invalid = GameStateSchema.parse(s); invalid.resolution.returnTo = destination; failed(validateState(invalid, context)); }
    }
});
test("Quick is also legal in MAIN; negative power is derived and expires at global turn end", () => {
    const s = GameStateSchema.parse(main), floor = Object.values(s.objects.cards).find(c => c.cardId === FLOOR_IT && c.controllerId === attackerPlayer)!;
    relocate(s, floor.id, "HAND");
    const played = playQuick(s, blocker);
    assert.equal(played.timing.window, "MAIN"); assert.equal(new RulesView(played, context).getEffectivePower(blocker), -1);
    assert.equal(played.temporaryModifiers![0].expires.turn, played.timing.turn);
    const ended = act(played, a => a.action.kind === "END_TURN");
    assert.equal(ended.state.temporaryModifiers, undefined); assert.equal(new RulesView(ended.state, context).getEffectivePower(blocker), 0);
    assert.ok(ended.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED"));
    const rolled = states.find(s => s.timing.window === "CHOOSE_GIG")!;
    assert.equal(legal(rolled).some(a => a.action.kind === "PLAY_CARD"), false);
});
test("Quick resolves as much as possible: no rival Unit skips power but still draws; sole target is automatic", () => {
    const s = GameStateSchema.parse(main), floor = Object.values(s.objects.cards).find(c => c.cardId === FLOOR_IT && c.controllerId === attackerPlayer)!;
    relocate(s, floor.id, "HAND");
    for (const id of [...s.players[defender].zones.BATTLEFIELD]) relocate(s, id, "TRASH");
    const noTarget = playQuick(s);
    assert.equal(noTarget.timing.window, "MAIN"); assert.equal(noTarget.temporaryModifiers, undefined); assert.equal(noTarget.players[attackerPlayer].zones.HAND.length, s.players[attackerPlayer].zones.HAND.length);
    const sole = GameStateSchema.parse(afterCall);
    for (const id of [...sole.players[attackerPlayer].zones.BATTLEFIELD]) if (id !== attacker && !sole.objects.cards[attacker].attachments.includes(id)) relocate(sole, id, "TRASH");
    const paid = drainPayment(act(sole, a => a.action.kind === "PLAY_CARD").state);
    assert.equal(paid.timing.window, "RIVAL_REACT"); assert.equal(paid.resolution.choice, null); assert.equal(new RulesView(paid, context).getEffectivePower(attacker), 4);
});
test("empty defender draw during Quick uses the existing immediate loss policy and does not reopen React", () => {
    const s = GameStateSchema.parse(afterCall);
    for (const id of [...s.players[defender].zones.DECK]) relocate(s, id, "TRASH");
    const result = playQuick(s);
    assert.equal(result.match.outcome?.reason, "EMPTY_DRAW"); assert.equal(result.match.outcome?.loserId, defender);
    assert.equal(result.timing.combat.stage, "NONE"); assert.equal(result.timing.step, "FINISHED");
    assert.equal(result.players[defender].zones.RESOLVING_PROGRAM, undefined);
});
test("Blocker has separate eligibility: Lag is permitted, readiness/control/type/zone and full support are required", () => {
    const lagging = GameStateSchema.parse(open); lagging.objects.cards[blocker].statuses = ["LAG"];
    const view = new RulesView(lagging, context); assert.equal(view.isBlockerEligible(defender, blocker), true); assert.equal(view.isAttackEligible(defender, blocker), false);
    for (const change of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[blocker].readiness = "SPENT"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[blocker].face = "DOWN"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { relocate(s, blocker, "HAND"); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[blocker].controllerId = attackerPlayer; }
    ]) { const s = GameStateSchema.parse(open); change(s); assert.equal(new RulesView(s, context).isBlockerEligible(defender, blocker), false); failed(applyAction(s, { actorId: defender, action: { kind: "DECLARE_BLOCKER", cardInstanceId: blocker } }, context)); }
    for (const c of Object.values(open.objects.cards).filter(c => [KERRY, MANTIS, VIKTOR, FLOOR_IT].includes(c.cardId))) assert.equal(view.isBlockerEligible(defender, c.id), false);
    assert.deepEqual(new RulesView(main, context).listBlockers(defender), []);
});
test("Blocker spends only itself, redirects both Unit and Gig-area attacks, retains Gear and returns to React", () => {
    for (const area of [false, true]) {
        const s = GameStateSchema.parse(open); assert.equal(s.timing.combat.stage, "RIVAL_REACT"); if (s.timing.combat.stage !== "RIVAL_REACT") throw new Error("Expected React");
        if (area) s.timing.combat.target = { kind: "GIG_AREA", playerId: defender };
        const gear = Object.values(s.objects.cards).find(c => c.controllerId === defender && c.cardId === MANTIS && c.zone.zone === "HAND")!;
        relocate(s, gear.id, "BATTLEFIELD"); s.objects.cards[blocker].attachments.push(gear.id);
        const result = act(s, a => a.action.kind === "DECLARE_BLOCKER");
        assert.deepEqual(result.events.map(e => e.payload.kind), ["BLOCKER_SPENT", "BLOCKER_DECLARED", "RIVAL_REACT_OPENED"]);
        assert.deepEqual(new RulesView(result.state, context).getCombatTarget(), { kind: "CARD", cardInstanceId: blocker });
        assert.deepEqual(result.state.objects.cards[blocker].attachments, [gear.id]); assert.equal(new RulesView(result.state, context).getEffectivePower(blocker), 2);
        assert.equal(result.state.objects.cards[blocker].readiness, "SPENT"); assert.deepEqual(result.state.objects.cards[attacker], s.objects.cards[attacker]);
        assert.equal(result.state.timing.step, "RIVAL_REACT"); assert.ok(legal(result.state).some(a => a.action.kind === "PASS_REACT"));
        const event = result.events.find(e => e.payload.kind === "BLOCKER_DECLARED")!; assert.ok(event.payload.kind === "BLOCKER_DECLARED"); assert.deepEqual(event.payload.previousTarget, s.timing.combat.target);
        assert.equal("blockerId" in result.state.timing.combat, false); assert.equal("originalTarget" in result.state.timing.combat, false);
    }
});
test("distinct ready Blockers may replace each other; spent Blocker cannot repeat, and reactions remain legal afterward", () => {
    const s = GameStateSchema.parse(open), other = Object.values(s.objects.cards).find(c => c.cardId === BOMBUS && c.controllerId === defender && c.id !== blocker)!;
    relocate(s, other.id, "BATTLEFIELD"); other.readiness = "READY"; other.statuses = ["LAG"];
    assert.equal(new RulesView(s, context).listBlockers(defender).length, 2);
    const first = act(s, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === blocker).state;
    failed(applyAction(first, { actorId: defender, action: { kind: "DECLARE_BLOCKER", cardInstanceId: blocker } }, context));
    const second = act(first, a => a.action.kind === "DECLARE_BLOCKER").state;
    assert.deepEqual(new RulesView(second, context).getCombatTarget(), { kind: "CARD", cardInstanceId: other.id });
    assert.ok(legal(second).some(a => a.action.kind === "CALL_LEGEND")); assert.ok(legal(second).some(a => a.action.kind === "PLAY_CARD"));
    assert.ok(unwrap(generatePosition(s, defender, context, "two-blockers")).legalActions.filter(a => a.action.kind === "DECLARE_BLOCKER").length === 2);
});
test("CALL, repeated Quick, Blocker and PASS compose without a one-reaction cap or extra CALL allowance", () => {
    const ready = GameStateSchema.parse(afterCall);
    const extra = Object.values(ready.objects.cards).find(c => c.cardId === FLOOR_IT && c.controllerId === defender && c.zone.zone === "DECK")!;
    relocate(ready, extra.id, "HAND");
    const once = playQuick(ready), twice = playQuick(once);
    assert.equal(twice.temporaryModifiers?.length, 2); assert.equal(new RulesView(twice, context).getEffectivePower(attacker), 3);
    assert.equal(twice.players[defender].economy.callsThisTurn, 1);
    const blocked = act(twice, a => a.action.kind === "DECLARE_BLOCKER").state;
    const passed = act(blocked, a => a.action.kind === "PASS_REACT").state;
    assert.equal(passed.timing.step, "COMBAT_RESOLUTION_PENDING"); assert.equal(passed.temporaryModifiers?.length, 2);
});
test("PASS alone is always an explicit decision and closes React irreversibly without resolving combat", () => {
    const s = GameStateSchema.parse(open);
    for (const c of Object.values(s.objects.cards).filter(c => c.controllerId === defender && c.id !== attacker)) c.readiness = "SPENT";
    assert.deepEqual(legal(s).map(a => a.action.kind), ["PASS_REACT"]);
    const passed = act(s, a => a.action.kind === "PASS_REACT");
    assert.deepEqual(passed.events.map(e => e.payload.kind), ["RIVAL_REACT_CLOSED", "COMBAT_RESOLUTION_PENDING"]);
    assert.deepEqual(passed.state.objects, s.objects); assert.deepEqual(passed.state.temporaryModifiers, s.temporaryModifiers);
    for (const player of s.match.playerOrder) assert.deepEqual(unwrap(listLegalActions(passed.state, player, context)), []);
    failed(advanceResolution(passed.state, context), "UNSUPPORTED_COMBAT_RESOLUTION");
    failed(applyAction(passed.state, { actorId: defender, action: { kind: "PASS_REACT" } }, context), "UNSUPPORTED_COMBAT_RESOLUTION");
    failed(resolveActionId(passed.state, defender, legal(s)[0].actionId, context), "UNSUPPORTED_COMBAT_RESOLUTION");
    failed(generatePosition(passed.state, defender, context, "closed"), "NO_PLAYER_DECISION");
});
test("stale Blocker/actionIds and malformed reaction choices fail atomically", () => {
    const stale = legal(open).find(a => a.action.kind === "DECLARE_BLOCKER")!;
    failed(resolveActionId(afterCall, defender, stale.actionId, context), "UNKNOWN_ACTION_ID");
    failed(applyCommand(open, { actorId: defender, action: stale.action, commandId: "00000000-0000-4000-8000-000000000050", idempotencyKey: "react-stale", expectedStateVersion: open.match.version - 1 }, context), "STALE_STATE");
    const beforeHash = hashReplayState(open);
    failed(applyAction(open, { actorId: defender, action: { kind: "DECLARE_BLOCKER", cardInstanceId: CardInstanceIdSchema.parse("missing") } }, context)); assert.equal(hashReplayState(open), beforeHash);
    const target = states.find(s => s.resolution.playContinuation?.phase === "EFFECT" && s.timing.combat.stage === "RIVAL_REACT")!;
    const forged = GameStateSchema.parse(target); forged.resolution.choice!.options[0] = { kind: "CARD", cardInstanceId: blocker };
    const hash = hashReplayState(forged); failed(applyAction(forged, { actorId: defender, action: legal(target)[0].action }, context)); assert.equal(hashReplayState(forged), hash);
});
test("closed and open combat invariants reject incoherent stage, actor, target and pending work", () => {
    for (const base of [open, closed]) for (const change of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.actingPlayer = attackerPlayer; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.window = "MAIN"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.combat = { stage: "NONE" }; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.returnTo = { kind: "RIVAL_REACT" }; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.pending.push({ id: "forged", sourceId: attacker, controllerId: defender, effect: { kind: "DRAW", count: 1 }, causedBySequence: 0 }); }
    ]) { const s = GameStateSchema.parse(base); change(s); failed(validateState(s, context)); }
    const bad = GameStateSchema.parse(afterQuick); bad.temporaryModifiers![0].expires.turn--; failed(validateState(bad, context));
});
test("trusted post-reaction invalidation ends attacker/target/redirected-target attacks without retargeting", () => {
    for (const [base, change] of [
        [afterCall, (m: TurnMutation) => { for (const gear of m.state.objects.cards[attacker].attachments) moveCardLocation(m, gear, "HAND"); m.state.objects.cards[attacker].attachments = []; moveCardLocation(m, attacker, "HAND"); }],
        [afterCall, (m: TurnMutation) => { const c = m.state.timing.combat; if (c.stage === "RIVAL_REACT" && c.target.kind === "CARD") moveCardLocation(m, c.target.cardInstanceId, "TRASH"); }],
        [afterBlock, (m: TurnMutation) => { moveCardLocation(m, blocker, "TRASH"); }]
    ] as const) {
        const m = new TurnMutation(base, context); change(m); unwrap(finishAttackEffects(m)); const ended = unwrap(m.result());
        assert.equal(ended.state.timing.combat.stage, "NONE"); assert.equal(ended.state.timing.actingPlayer, attackerPlayer); assert.equal(ended.state.timing.window, "MAIN");
        assert.equal(ended.events.filter(e => e.payload.kind === "ATTACK_ENDED").length, 1); assert.equal(ended.events.some(e => e.payload.kind === "RIVAL_REACT_OPENED"), false);
        assert.deepEqual(ended.state.objects.gigs, base.objects.gigs);
        if (base.temporaryModifiers) assert.deepEqual(ended.state.temporaryModifiers, base.temporaryModifiers); // 'This turn' outlives the attack.
    }
    const pending = new TurnMutation(open, context); pending.state.resolution.pending.push({ id: "unfinished", sourceId: viktor, controllerId: defender, effect: { kind: "DRAW", count: 1 }, causedBySequence: 0 });
    failed(finishAttackEffects(pending), "INVALID_ATTACK_RESOLUTION");
});
test("temporary modifier target departure stays explicitly unsupported until zone lifecycle is source-reviewed", () => {
    const m = new TurnMutation(afterQuick, context); m.state.timing.combat = { stage: "NONE" }; m.state.timing.actingPlayer = attackerPlayer; m.phase("MAIN"); const s = unwrap(m.result()).state;
    failed(moveCardForEffect(s, attacker, "HAND", context), "UNSUPPORTED_MODIFIER_ZONE_CHANGE");
});
test("defender sees own Quick actions and private search; attacker sees only declared/public reaction information", () => {
    const attackObs = unwrap(observe(open, attackerPlayer, context)), defendObs = unwrap(observe(open, defender, context));
    const rival = attackObs.players.find(p => p.seat === attackObs.actingSeat)!;
    assert.equal(rival.cards.some(c => c.zone === "HAND"), false); assert.equal(rival.counts.HAND, open.players[defender].zones.HAND.length);
    assert.ok(defendObs.players.find(p => p.seat === defendObs.viewerSeat)!.cards.some(c => c.content?.cardId === FLOOR_IT));
    assert.equal(attackObs.unsupportedCapabilities, undefined);
    for (const a of legal(open).filter(a => a.action.kind === "CALL_LEGEND")) assert.match(a.descriptor.label, /^Call face-down Legend \d+$/);
    for (const s of states.filter(s => s.resolution.searchContinuation && s.timing.combat.stage === "RIVAL_REACT")) {
        assert.equal(unwrap(observe(s, attackerPlayer, context)).inspectedCards, undefined); assert.ok(unwrap(observe(s, defender, context)).inspectedCards?.length);
    }
    const declared = states.find(s => s.resolution.playContinuation?.phase === "PAYMENT" && s.timing.combat.stage === "RIVAL_REACT")!;
    assert.ok(unwrap(observe(declared, attackerPlayer, context)).players.flatMap(p => p.cards).some(c => c.content?.cardId === FLOOR_IT));
    for (const viewer of [attackerPlayer, defender]) {
        const o = unwrap(observe(closed, viewer, context));
        assert.deepEqual(o.combat?.target, { kind: "CARD", cardInstanceId: blocker }); assert.deepEqual(o.unsupportedCapabilities, ["UNSUPPORTED_COMBAT_RESOLUTION"]);
        assert.deepEqual(o.temporaryModifiers, closed.temporaryModifiers); assert.ok(o.players.flatMap(p => p.cards).some(c => c.content?.cardId === VIKTOR && c.face === "UP"));
        assert.equal(o.players.flatMap(p => p.cards).find(c => c.publicId === attacker)!.effectivePower, 4);
        assert.equal(JSON.stringify(o).includes(closed.rng.seed), false);
    }
});
test("POSITION_V2/actionIds survive UUID/counter/provenance changes throughout React and continuations", () => {
    for (const s of [open, afterCall, afterQuick, afterBlock, ...states.filter(s => s.timing.combat.stage === "RIVAL_REACT" && s.resolution.current)]) {
        const changed = GameStateSchema.parse({ ...s, match: { ...s.match, id: "00000000-0000-4000-8000-000000000099", version: s.match.version + 10, eventSequence: s.match.eventSequence + 100 } });
        if (changed.resolution.current) changed.resolution.current.causedBySequence += 100;
        for (const p of changed.resolution.pending) p.causedBySequence += 100;
        assert.equal(hashPosition(changed), hashPosition(s)); assert.deepEqual(legal(changed), legal(s)); assert.notEqual(hashReplayState(changed), hashReplayState(s));
        const selected = legal(s)[0], a = unwrap(applyAction(s, { actorId: selected.actorId, action: selected.action }, context)), b = unwrap(applyAction(changed, { actorId: selected.actorId, action: selected.action }, context));
        assert.equal(hashPosition(a.state), hashPosition(b.state));
    }
});
test("React TrainingPositions contain strategic legal choices, never forced resolution or closed combat", () => {
    assert.ok(replay.positions.some(p => p.state.timing.step === "RIVAL_REACT" && p.legalActions.some(a => a.action.kind === "CALL_LEGEND") && p.legalActions.some(a => a.action.kind === "PLAY_CARD") && p.legalActions.some(a => a.action.kind === "DECLARE_BLOCKER")));
    assert.ok(replay.positions.some(p => p.state.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN"));
    assert.ok(replay.positions.every(p => p.legalActions.length > 1 && p.state.timing.step !== "COMBAT_RESOLUTION_PENDING"));
    for (const p of replay.positions.filter(p => p.state.timing.combat.stage === "RIVAL_REACT")) {
        const input = JSON.stringify(modelInput(p)); assert.equal(input.includes('"rng"'), false); assert.equal(input.includes(replay.initialization.seed), false);
    }
});
test("React replay/wire retain contiguous exact events and stop at the pinned closed boundary", () => {
    assert.deepEqual(replay, reactReplay()); assert.deepEqual(replay, JSON.parse(readFileSync(new URL("./fixtures/react-replay.v1.json", import.meta.url), "utf8")));
    const events = [...replay.initialized.events, ...replay.steps.flatMap(s => s.events)];
    assert.deepEqual(events.map(e => e.sequence), Array.from({ length: events.length }, (_, i) => i + 1));
    assert.equal(closed.timing.combat.stage, "COMBAT_RESOLUTION_PENDING"); assert.equal(events.at(-1)!.payload.kind, "COMBAT_RESOLUTION_PENDING");
    assert.equal(closed.match.outcome, undefined); assert.ok(Object.values(closed.objects.cards).every(c => c.damage === 0));
    const request = { schemaVersion: 1, requestId: "react-boundary", content: context.content, state: closed, actorId: defender };
    const result = handleRequest({ ...request, op: "applyAction", actionId: "0".repeat(64) });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.errors[0].code, "UNSUPPORTED_COMBAT_RESOLUTION");
});
