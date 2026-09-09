import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CardRevisionSnapshotSchema, CardInstanceIdSchema, GameStateSchema, GameStateVersionSchema, GameEventSequenceSchema, createContentBundle, hashCanonical, type GameState, type LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashPosition, hashReplayState, hashObservation, listLegalActions, observe, resolveActionId, RulesView, transferGigControl, validateState } from "@tcg/engine";
import { generatePosition, modelInput, validateTrainingPosition } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { endTurnContext, endTurnInput, delamain, DELAMAIN } from "./end-turn-history-fixture";
import { delamainReplay } from "./end-turn-history-replay";
import { orderedContext } from "./attack-ordered-effects-fixture";
import { evelynReplay } from "./attack-ordered-effects-replay";
import { MANTIS } from "./gear-fixture";
import { FLOOR_IT } from "./react-fixture";
import { REBOOT } from "./combat-restrictions-fixture";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, attachPlayedGear } from "../packages/engine/src/card-movement";
import { grantLegendKnowledge } from "../packages/engine/src/private-knowledge";
import { readyEddie } from "../packages/engine/src/eddie-ready";
import { preventionId } from "../packages/engine/src/fight-prevention";
import { triggerChoice } from "../packages/engine/src/trigger-queries";
import { supportsEndTurnCard } from "../packages/engine/src/end-turn-support";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/end-turn-history-card-sources.v1.json";
import rules from "./fixtures/end-turn-history-rules.v1.json";
const context = endTurnContext(), replay = delamainReplay(), before = replay.beforeEndTurn, pending = replay.pendingEndTurn;
const actor = before.timing.activePlayer, rival = before.match.playerOrder.find(id => id !== actor)!;
const host = pending.resolution.current!.sourceId!, second = before.players[actor].zones.BATTLEFIELD.find(id => before.objects.cards[id].cardId === DELAMAIN && id !== host)!;
const states: GameState[] = [replay.initialized.state]; for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const attackIndex = replay.steps.findIndex(s => s.action.action.kind === "DECLARE_ATTACK"), beforeAttack = states[attackIndex];
const legal = (s: GameState) => unwrap(listLegalActions(s, s.timing.actingPlayer, context));
function act(s: GameState, predicate: (a: LegalAction) => boolean) { const a = legal(s).find(predicate); assert.ok(a, `action at ${s.timing.turn}/${s.timing.step}`); return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, context)); }
const end = (s: GameState) => act(s, a => a.action.kind === "END_TURN");
const choose = (s: GameState, i = 0) => act(s, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === i);
/** Explicit trusted focused arrangement; the headline above uses only actual player actions. */
function stockEddies(s: GameState, count: number) {
    const m = new TurnMutation(s, context);
    for (const id of [...m.state.players[actor].zones.EDDIES]) moveCardLocation(m, id, "TRASH");
    const candidates = m.state.players[actor].zones.DECK.filter(id => context.content.cards.find(c => c.id === m.state.objects.cards[id].cardId)!.sellProfile.allowed).slice(0, count);
    assert.equal(candidates.length, count);
    for (const id of candidates) {
        m.state.players[actor].zones.DECK.splice(m.state.players[actor].zones.DECK.indexOf(id), 1); m.state.players[actor].zones.EDDIES.push(id);
        Object.assign(m.state.objects.cards[id], { zone: { playerId: actor, zone: "EDDIES" }, face: "DOWN", readiness: "SPENT" });
    }
    return unwrap(validateState(m.state, context));
}
test("full source review admits exact Delamain; Dying Night remains unadmitted as one ATTACK paragraph", () => {
    assert.equal(delamain.rulesText, "At the end of your turn, if this Unit stole a Gig this turn, ready 1 Eddie.");
    assert.equal(delamain.power, 4); assert.equal(delamain.printedCost.kind === "EDDIES" && delamain.printedCost.amount, 4);
    assert.equal(delamain.sellProfile.allowed, false); assert.deepEqual(delamain.ram, { BLUE: 2 }); assert.equal(delamain.printings.length, 5);
    assert.ok(delamain.printings.some(p => p.id === "e15c07b6-f563-4825-aad4-6b3068c1ab85" && p.collectorNumber === "009"));
    assert.ok(supportsEndTurnCard(delamain, context).ok); assert.equal(sources.errata.length, 4);
    const dying = sources.records.find(r => r.record.slug === "dying-night-v-s-pistol")!;
    assert.equal(dying.record.rules_text, '(Equip to a friendly Unit or face-up Legend.)\n{Attack} Decrease a Gig by up to 2. At the end of your turn, if this Unit is named "V", ready 2 Eddies.');
    assert.equal(dying.record.printings.length, 5); assert.equal(context.content.cards.some(c => c.id === dying.record.slug), false);
    for (const id of ["3.8", "3.9.2", "3.10.2", "5.8.3.1", "8.16.1", "8.16.2", "8.18", "10.1.1", "10.1.2", "10.12", "10.13", "10.15.1", "9.23.5.2"]) assert.ok(rules.rules.some(r => r.id === id), id);
    assert.equal(delamain.provenance.sourceHash, hashCanonical(sources.records.find(r => r.record.slug === DELAMAIN)!.record));
});
test("headline pays actual cost, applies Lag, steals with the original physical Unit then pauses END_TURN", () => {
    assert.ok(states.some(s => s.objects.cards[host]?.statuses.includes("LAG")));
    assert.equal(beforeAttack.objects.cards[host].statuses.includes("LAG"), false);
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "PAYMENT_MADE" && e.payload.sources.length === 4)));
    assert.deepEqual(before.turnHistory?.gigsStolenByUnit, { [host]: 1 }); assert.equal(before.turnHistory?.gigsStolenByUnit?.[second], undefined);
    assert.equal(pending.timing.turn, before.timing.turn); assert.equal(pending.timing.activePlayer, actor); assert.equal(pending.timing.actingPlayer, actor);
    assert.equal(pending.timing.step, "EDDIE_READY_SELECTION"); assert.equal(pending.timing.combat.stage, "NONE");
    assert.deepEqual(pending.resolution.triggerContinuation!.origin, { kind: "END_TURN", playerId: actor, turn: before.timing.turn });
    assert.equal(pending.resolution.pending.length, 0); assert.equal(pending.objects.cards[second].statuses.includes("LAG"), true);
});
test("history records only actual stolen facts, not declaration, React or Gig selection", () => {
    let total = 0;
    for (let i = 0; i < replay.steps.length; i++) {
        const step = replay.steps[i], facts = step.events.filter(e => e.payload.kind === "GIG_STOLEN"); total += facts.length;
        if (states[i + 1].timing.turn === before.timing.turn) assert.equal(states[i + 1].turnHistory?.gigsStolenByUnit?.[host] ?? 0, total);
    }
    assert.equal(total, 1); assert.equal(states[attackIndex + 1].turnHistory?.gigsStolenByUnit, undefined);
});
test("one END_TURN resolves card work before Lag/expiration and next TURN_STARTED; no fake MAIN", () => {
    const entered = replay.steps.at(-2)!.events.map(e => e.payload.kind); assert.equal(entered.includes("TURN_STARTED"), false); assert.equal(entered.includes("TURN_ENDED"), false);
    const events = replay.steps.at(-1)!.events.map(e => e.payload);
    const ready = events.findIndex(e => e.kind === "CARD_READIED" && before.players[actor].zones.EDDIES.includes(e.cardInstanceId));
    const resolved = events.findIndex(e => e.kind === "EFFECT_RESOLVED"), lag = events.findIndex(e => e.kind === "LAG_REMOVED"), ended = events.findIndex(e => e.kind === "TURN_ENDED"), started = events.findIndex(e => e.kind === "TURN_STARTED");
    assert.ok(ready >= 0 && resolved > ready && lag > resolved && ended > lag && started > ended);
    assert.equal(events.some(e => e.kind === "PHASE_CHANGED" && e.step === "MAIN"), false);
    assert.equal(replay.finalState.timing.turn, before.timing.turn + 1); assert.equal(replay.finalState.timing.activePlayer, rival);
    assert.equal(replay.finalState.turnHistory?.gigsStolenByUnit, undefined); assert.equal(replay.finalState.turnHistory?.triggeredBatches, 0);
    for (const player of Object.values(replay.finalState.players)) assert.equal(player.economy.sellsThisTurn + player.economy.callsThisTurn!, 0);
});
for (const count of [0, 1, 3]) test(`${count} spent Eddies: exact-one shortfall/forced/strategic policy`, () => {
    const s = stockEddies(before, count), result = end(s);
    assert.equal(result.state.timing.step, count > 1 ? "EDDIE_READY_SELECTION" : "CHOOSE_GIG");
    if (count > 1) {
        assert.equal(legal(result.state).length, count); assert.deepEqual(result.state.resolution.choice!.options, [0,1,2].map(slot => ({ kind: "EDDIE_SLOT", slot })));
        assert.equal(unwrap(generatePosition(result.state, actor, context, "choose-eddie")).legalActions.length, 3);
    } else {
        assert.equal(result.state.resolution.choice, null);
        assert.equal(result.events.filter(e => e.payload.kind === "CARD_READIED" && s.players[actor].zones.EDDIES.includes(e.payload.cardInstanceId)).length, count);
    }
});
test("readiness changes only the selected physical Eddie; ready Eddies and Legends are ineligible", () => {
    const s = stockEddies(before, 3), p = end(s).state, chosen = choose(p, 1).state;
    for (const [i,id] of s.players[actor].zones.EDDIES.entries()) assert.deepEqual(chosen.objects.cards[id], { ...s.objects.cards[id], readiness: i === 1 ? "READY" : "SPENT" });
    const m = new TurnMutation(chosen, context); assert.equal(readyEddie(m, actor, 1).ok, false);
    assert.equal(readyEddie(m, actor, 99).ok, false);
    const d = GameStateSchema.parse(s); d.objects.cards[d.players[actor].zones.EDDIES[0]].readiness = "READY";
    assert.deepEqual(new RulesView(d, context).getReadyableEddieSlots(actor), [1,2]);
});
test("no steal and another Unit's steal cannot satisfy this Delamain; rival own-turn effects never trigger", () => {
    const d = GameStateSchema.parse(before); delete d.turnHistory!.gigsStolenByUnit;
    assert.equal(end(d).events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
    d.turnHistory!.gigsStolenByUnit = { [second]: 1 };
    const p = end(d).state; assert.equal(p.resolution.current!.sourceId, second);
    const m = new TurnMutation(before, context), enemy = Object.values(m.state.objects.cards).find(c => c.cardId === DELAMAIN && c.controllerId === rival)!;
    moveCardLocation(m, enemy.id, "BATTLEFIELD"); m.state.turnHistory!.gigsStolenByUnit = { [enemy.id]: 1 };
    assert.equal(end(m.state).events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
});
test("a prior-turn stolen Gig remains controlled but does not qualify this turn", () => {
    let s = replay.finalState;
    s = act(s, a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith("D6")).state; s = end(s).state;
    s = act(s, a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith("D10")).state;
    assert.ok(Object.values(s.objects.gigs).some(g => g.ownerId === rival && g.controllerId === actor)); assert.equal(s.turnHistory?.gigsStolenByUnit, undefined);
    assert.equal(end(s).events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
});
test("generic non-steal transfer does not write steal history", () => {
    const gig = beforeAttack.players[rival].gigs.GIGS[0], moved = unwrap(transferGigControl(beforeAttack, gig, actor, context));
    assert.equal(moved.state.objects.gigs[gig].controllerId, actor); assert.equal(moved.state.turnHistory?.gigsStolenByUnit, undefined);
    assert.equal(moved.events.some(e => e.payload.kind === "GIG_STOLEN"), false); assert.equal(end(moved.state).events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
});
test("multi-Gig steal records each actual Gig but creates one own-turn end trigger", () => {
    const m = new TurnMutation(beforeAttack, context);
    for (const gear of Object.values(m.state.objects.cards).filter(c => c.controllerId === actor && c.cardId === MANTIS)) { moveCardLocation(m, gear.id, "HAND"); unwrap(attachPlayedGear(m, gear.id, host)); }
    assert.ok(new RulesView(m.state, context).getEffectivePower(host)! >= 10);
    const attacked = act(m.state, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host).state;
    const result = act(attacked, a => a.action.kind === "PASS_REACT"); assert.equal(result.events.filter(e => e.payload.kind === "GIG_STOLEN").length, 2);
    assert.equal(result.state.turnHistory?.gigsStolenByUnit?.[host], 2);
    assert.equal(end(stockEddies(result.state, 3)).events.filter(e => e.payload.kind === "EFFECT_PENDING").length, 1);
});
for (const first of [0,1]) test(`two independent Delamains resolve order ${first} and rederive remaining spent Eddies`, () => {
    const m = new TurnMutation(before, context); m.state.objects.cards[second].statuses = []; m.state.objects.cards[second].readiness = "READY";
    const attacked = act(m.state, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === second).state;
    const stolen = act(attacked, a => a.action.kind === "PASS_REACT").state;
    assert.deepEqual(stolen.turnHistory?.gigsStolenByUnit, { [host]: 1, [second]: 1 });
    const p = end(stockEddies(stolen, 3)).state; assert.equal(p.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(p.resolution.pending.length, 2);
    const effect = choose(p, first).state; assert.equal(effect.timing.step, "EDDIE_READY_SELECTION"); assert.equal(effect.resolution.pending.length, 1);
    const next = choose(effect).state; assert.equal(next.timing.step, "EDDIE_READY_SELECTION"); assert.deepEqual(next.resolution.choice!.options, [1,2].map(slot => ({ kind: "EDDIE_SLOT", slot })));
    const done = choose(next).state; assert.equal(done.timing.turn, before.timing.turn + 1);
    assert.equal(done.players[actor].zones.EDDIES.filter(id => done.objects.cards[id].readiness === "READY").length, 2);
});
test("source absent at discovery does not trigger; an already pending source leaving does not cancel", () => {
    const m = new TurnMutation(before, context); moveCardLocation(m, host, "TRASH");
    assert.equal(end(m.state).events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
    const p = new TurnMutation(pending, context); moveCardLocation(p, host, "TRASH"); assert.ok(validateState(p.state, context).ok);
    assert.equal(choose(p.state).state.timing.turn, before.timing.turn + 1);
});
test("Floor It, unused Reboot, Lag, history and Kiroshi memory remain until their reviewed boundary", () => {
    const m = new TurnMutation(before, context), floor = Object.values(m.state.objects.cards).find(c => c.cardId === FLOOR_IT && c.controllerId === actor)!, reboot = Object.values(m.state.objects.cards).find(c => c.cardId === REBOOT && c.controllerId === actor)!;
    moveCardLocation(m, floor.id, "TRASH"); moveCardLocation(m, reboot.id, "TRASH"); unwrap(grantLegendKnowledge(m, actor, 0));
    m.state.temporaryModifiers = [{ kind: "POWER", sourceId: floor.id, targetId: host, amount: -1, expires: { kind: "END_OF_TURN", turn: before.timing.turn } }];
    m.state.fightPreventions = [{ kind: "PREVENT_NEXT_RIVAL_FIGHT_DEFEAT", id: preventionId(m.state, reboot.id, actor, before.timing.turn), sourceId: reboot.id, controllerId: actor, createdTurn: before.timing.turn, expires: { kind: "END_OF_TURN", turn: before.timing.turn } }];
    const p = end(m.state).state; assert.deepEqual(p.temporaryModifiers, m.state.temporaryModifiers); assert.deepEqual(p.fightPreventions, m.state.fightPreventions); assert.deepEqual(p.turnHistory?.gigsStolenByUnit, before.turnHistory?.gigsStolenByUnit);
    const result = choose(p), kinds = result.events.map(e => e.payload.kind), resolved = kinds.indexOf("EFFECT_RESOLVED"), expiration = kinds.indexOf("POWER_MODIFIER_EXPIRED"), prevention = kinds.indexOf("FIGHT_PREVENTION_EXPIRED");
    assert.ok(resolved >= 0 && expiration > resolved && prevention > resolved && kinds.indexOf("TURN_ENDED") > prevention);
    assert.equal(result.state.temporaryModifiers, undefined); assert.equal(result.state.fightPreventions, undefined); assert.deepEqual(result.state.privateKnowledge, m.state.privateKnowledge);
});
for (const defect of ["actor","turn","source","options","duplicate","ready","noHistory","count","orphan","main"] as const) test(`forged end-turn ${defect} is rejected atomically`, () => {
    const s = GameStateSchema.parse(pending);
    if (defect === "actor") s.resolution.choice!.actorId = rival;
    if (defect === "turn" && s.resolution.triggerContinuation!.origin.kind === "END_TURN") s.resolution.triggerContinuation!.origin.turn++;
    if (defect === "source") s.resolution.current!.sourceId = second;
    if (defect === "options") s.resolution.choice!.options.pop();
    if (defect === "duplicate") s.resolution.choice!.options[1] = s.resolution.choice!.options[0];
    if (defect === "ready") s.objects.cards[s.players[actor].zones.EDDIES[0]].readiness = "READY";
    if (defect === "noHistory") delete s.turnHistory!.gigsStolenByUnit;
    if (defect === "count") s.turnHistory!.gigsStolenByUnit![host] = 0;
    if (defect === "orphan") delete s.resolution.triggerContinuation;
    if (defect === "main") { s.timing.step = "MAIN"; s.timing.window = "MAIN"; }
    const serialized = JSON.stringify(s); assert.equal(validateState(s, context).ok, false);
    assert.equal(applyAction(s, { actorId: actor, action: legal(pending)[0].action }, context).ok, false); assert.equal(JSON.stringify(s), serialized);
});
test("stale Eddie actionId rejects after options/readiness change; second END_TURN is illegal", () => {
    const s = end(stockEddies(before, 3)).state, old = legal(s)[0], d = GameStateSchema.parse(s);
    d.objects.cards[d.players[actor].zones.EDDIES[0]].readiness = "READY";
    assert.equal(resolveActionId(d, actor, old.actionId, context).ok, false);
    d.resolution.choice = triggerChoice(d, context); assert.ok(validateState(d, context).ok);
    assert.equal(resolveActionId(d, actor, old.actionId, context).ok, false);
    assert.equal(applyAction(s, { actorId: actor, action: { kind: "END_TURN" } }, context).ok, false);
    assert.equal(applyAction(s, { actorId: rival, action: old.action }, context).ok, false);
});
test("Eddie identities are hidden from both viewers; slot action IDs ignore underlying sold cards", () => {
    const changed = GameStateSchema.parse(pending), id = changed.players[actor].zones.EDDIES[0];
    const replacement = changed.players[actor].zones.DECK.find(cid => { const r = context.content.cards.find(r => r.id === changed.objects.cards[cid].cardId)!; return r.sellProfile.allowed && r.id !== changed.objects.cards[id].cardId; })!;
    [changed.objects.cards[id].cardId, changed.objects.cards[replacement].cardId] = [changed.objects.cards[replacement].cardId, changed.objects.cards[id].cardId];
    [changed.objects.cards[id].revision, changed.objects.cards[replacement].revision] = [changed.objects.cards[replacement].revision, changed.objects.cards[id].revision];
    assert.notEqual(hashReplayState(pending), hashReplayState(changed));
    for (const viewer of [actor, rival]) {
        const obs = unwrap(observe(pending, viewer, context)); assert.deepEqual(obs, unwrap(observe(changed, viewer, context)));
        assert.ok(obs.players[0].cards.filter(c => c.zone === "EDDIES").every(c => c.content === undefined && c.rememberedContent === undefined));
    }
    assert.deepEqual(legal(pending), legal(changed)); assert.deepEqual(unwrap(listLegalActions(pending, rival, context)), []);
    assert.ok(legal(pending).every(a => /^Ready Eddie [12]$/.test(a.descriptor.label)));
    const prompt = JSON.stringify(modelInput(unwrap(generatePosition(pending, actor, context, "eddies"))));
    for (const cid of pending.players[actor].zones.EDDIES) assert.equal(prompt.includes(cid), false);
    assert.equal(prompt.includes(pending.rng.seed), false);
});
test("public steal history distinguishes otherwise identical boards/positions; transport counters do not alter action IDs", () => {
    const noHistory = GameStateSchema.parse(before); delete noHistory.turnHistory!.gigsStolenByUnit;
    assert.deepEqual(before.objects, noHistory.objects); assert.notEqual(hashPosition(before), hashPosition(noHistory));
    for (const viewer of [actor, rival]) assert.notEqual(hashObservation(unwrap(observe(before, viewer, context))), hashObservation(unwrap(observe(noHistory, viewer, context))));
    const counter = GameStateSchema.parse(pending); counter.match.version = GameStateVersionSchema.parse(999); counter.match.eventSequence = GameEventSequenceSchema.parse(999);
    assert.deepEqual(legal(pending), legal(counter));
});
test("old scopes and missing/full-shape omissions reject new metadata and steal history", () => {
    for (const input of [
        { ...delamain, execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" } },
        { ...delamain, power: 5 }, { ...delamain, sellProfile: { ...delamain.sellProfile, allowed: true } },
        { ...delamain, mechanics: { ...delamain.mechanics, abilities: [{ ...delamain.mechanics.abilities[0], conditions: [] }] } }
    ]) {
        const r = CardRevisionSnapshotSchema.parse(input), ctx = { content: createContentBundle(context.content.ruleset, context.content.cards.map(c => c.id === DELAMAIN ? r : c), context.content.manifest.engine) };
        assert.equal(supportsEndTurnCard(r, ctx).ok, false); assert.equal(createGameWithEvents(endTurnInput("reject"), ctx).ok, false);
    }
    const old = GameStateSchema.parse(evelynReplay().finalState), unit = Object.values(old.objects.cards).find(c => c.zone.zone === "BATTLEFIELD")!;
    old.turnHistory!.gigsStolenByUnit = { [unit.id]: 1 }; assert.equal(validateState(old, orderedContext()).ok, false);
    const missing = GameStateSchema.parse(before); missing.turnHistory!.gigsStolenByUnit = { [CardInstanceIdSchema.parse("missing-unit")]: 1 }; assert.equal(validateState(missing, context).ok, false);
});
test("constructed format and immutable content pins remain strict", () => {
    assert.deepEqual(context.content.ruleset.formats!.CONSTRUCTED!.mainDeck, { min: 40, max: 50 });
    const input = endTurnInput("format"); assert.ok(input.decks.every(d => d.main.length === 42 && d.legends.length === 3));
    for (const deck of [{ ...input.decks[0], main: input.decks[0].main.slice(0,27) }, { ...input.decks[0], main: [...input.decks[0].main, DELAMAIN] }, { ...input.decks[0], legends: input.decks[0].legends.slice(0,2) }]) assert.equal(createGameWithEvents({ ...input, decks: [deck,input.decks[1]] }, context).ok, false);
});
test("Eddie TrainingPosition, wire actionId-only resume and checked-in replay are exact", () => {
    const p = replay.positions.find(p => p.state.timing.step === "EDDIE_READY_SELECTION")!; assert.ok(p); assert.equal(p.legalActions.length, 2); assert.ok(validateTrainingPosition(p, context).ok);
    const r = handleRequest({ schemaVersion: 1, requestId: randomUUID(), op: "applyAction", content: context.content, state: pending, actorId: actor, actionId: legal(pending)[0].actionId });
    assert.ok(r.ok && r.value.kind === "transition"); assert.deepEqual(r.value.state, replay.finalState); assert.deepEqual(r.value.events, replay.steps.at(-1)!.events);
    const golden = JSON.parse(readFileSync(new URL("./fixtures/delamain-replay.v1.json", import.meta.url), "utf8")); assert.deepEqual(golden, replay);
});
