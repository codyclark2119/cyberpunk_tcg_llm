import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, observe, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPinnedPlayUnit } from "../packages/engine/src/play-pin-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTargetedSpendCard } from "../packages/engine/src/targeted-spend-support";
import { readyCardForEffect } from "../packages/engine/src/ready-unit";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV22Cards, batchV22Context, batchV22Input, v22Source, PACIFICA, RELAPSE } from "./api-admission-batch-v22-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { playCard, pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV22Context();
const card = (id: string) => batchV22Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV22Input("batch-v22"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plain = (c: CardRevisionSnapshot) => c.schemaVersion === 2 && c.type === "UNIT" && supportsPlay(c, context).ok && !c.mechanics.keywords.length && !c.mechanics.modifiers.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length && (c.power ?? 0) > 0 && (c.power ?? 0) < 10;
const attacker = context.content.cards.filter(c => plain(c as CardRevisionSnapshot)).sort((a, b) => a.power! - b.power! || (a.id < b.id ? -1 : 1))[0];

/** Trusted arrangement: the bottom deck card of `player` rewritten as `cardId` and moved to hand or, ready and not lagging, to the field. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "BATTLEFIELD") {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, where);
    if (where === "BATTLEFIELD") { c.readiness = "READY"; c.statuses = []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: `player`'s Gig area holds exactly `values` (ids returned in the same order), the largest value on the largest
 * non-d20 die; every other die waits in its fixer area. */
function gigs(s: GameState, player: PlayerId, values: number[]) {
    const d = GameStateSchema.parse(s), faces = (g: { dieType: string }) => Number(g.dieType.slice(1));
    const dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
    const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]), assigned = new Map(order.map((vi, k) => [dice[k].id, vi]));
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const ids: GigInstanceId[] = [];
    for (const g of Object.values(d.objects.gigs)) {
        const vi = assigned.get(g.id), value = vi === undefined ? undefined : values[vi];
        assert.ok(value === undefined || value <= faces(g), "each value fits its die");
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (vi !== undefined) ids[vi] = g.id;
    }
    return { state: unwrap(validateState(d, context)), ids };
}
/** End the actor's turn and reach the rival's Main phase. */
function toRivalMain(s: GameState) {
    let state = take(s, context, a => a.action.kind === "END_TURN").state;
    for (let n = 0; !(state.timing.activePlayer === rival && state.timing.step === "MAIN"); n++) { assert.ok(n < 20); state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state; }
    return state;
}
/** Trusted arrangement: set a field card's readiness. */
function setReadiness(s: GameState, id: CardInstanceId, readiness: "READY" | "SPENT") {
    const d = GameStateSchema.parse(s); d.objects.cards[id].readiness = readiness; return unwrap(validateState(d, context));
}
/** Two plain rival Units (ready, then spent) and the actor's Street Cred made even or odd. */
function arrange(even: boolean) {
    let s = put(base, attacker.id, rival, "BATTLEFIELD").state;
    s = put(s, attacker.id, rival, "BATTLEFIELD").state;
    const [readyId, spentId] = s.players[rival].zones.BATTLEFIELD;
    s = setReadiness(s, spentId, "SPENT");
    s = gigs(s, actor, even ? [2, 4] : [3]).state;
    return { state: s, readyId, spentId };
}
const legalAttackers = (s: GameState) => actions(s, context).flatMap(a => a.action.kind === "DECLARE_ATTACK" ? [a.action.cardInstanceId] : []);
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);
const targetOptions = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();

test("V22 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV22Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v22Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.ok(attacker, "a plain reviewed Unit is the rival's Unit in these tests");
});

test("each V22 card passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPinnedPlayUnit, supportsTriggerCard, supportsPlay]) assert.ok(gate(card(PACIFICA), context).ok, `${PACIFICA}: ${gate.name}`);
    for (const gate of [supportsTargetedSpendCard, supportsPlay]) assert.ok(gate(card(RELAPSE), context).ok, `${RELAPSE}: ${gate.name}`);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const patch = (i: number, p: object) => (d: CardRevisionSnapshot) => { const a = d.mechanics.abilities[0]; a.effects = a.effects.map((e, k) => k === i ? { ...e, ...p } : e) as never; };
    const pacifica: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no condition", d => { const a = d.mechanics.abilities[0]; a.effects = [{ kind: "PREVENT_UNIT_READY", target: { kind: "UNITS", relation: "RIVAL" }, duration: "UNTIL_YOUR_NEXT_TURN" }] as never; }],
        ["friendly target", patch(0, { target: { kind: "UNITS", relation: "CONTROLLED" } })],
        ["cost-limited target", patch(0, { target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } })],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["power", d => { d.power = 2; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }]
    ];
    for (const [label, edit] of pacifica) { const f = forge(card(PACIFICA), edit); assert.equal(supportsTriggerCard(f, context).ok, false, label); assert.equal(supportsPinnedPlayUnit(f, context).ok, false, label); }
    const relapse: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no lock", d => { const a = d.mechanics.abilities[0]; a.effects = [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" } }, a.effects[1]] as never; }],
        ["no draw", d => { d.mechanics.abilities[0].effects.pop(); }],
        ["draw 2", patch(1, { count: 2 })],
        ["cost-limited target", patch(0, { target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } })],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["tags", d => { d.tags = ["Corpo"]; }]
    ];
    for (const [label, edit] of relapse) assert.equal(supportsTargetedSpendCard(forge(card(RELAPSE), edit), context).ok, false, label);
});

test("Memory Relapse: spend a rival Unit; it can't ready until your next turn; even Street Cred draws 1", () => {
    const a = arrange(true);
    let s = put(a.state, RELAPSE, actor, "HAND").state;
    const hand = s.players[actor].zones.HAND.length;
    const played = playCard(s, context, RELAPSE);
    s = played.state;
    assert.equal(s.resolution.choice?.kind, "TARGET", "two rival Units: a real choice, spent ones included");
    assert.deepEqual(targetOptions(s), [a.readyId, a.spentId].sort());
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.readyId);
    s = done.state;
    assert.equal(s.objects.cards[a.readyId].readiness, "SPENT");
    assert.deepEqual(s.readyLocks?.map(x => [x.targetId, x.lockingPlayerId, x.createdTurn, x.origin.ordinal]), [[a.readyId, actor, s.timing.turn, undefined]]);
    assert.ok(kinds(done.events).includes("READY_LOCKED"));
    assert.equal(s.players[actor].zones.HAND.length, hand, "the Program left the hand and its even-Street-Cred draw replaced it");
    assert.deepEqual(unwrap(observe(s, rival, context)).readyLocks, [{ targetId: a.readyId, sourceId: s.readyLocks![0].sourceId, lockingSeat: s.players[actor].seat, createdTurn: s.timing.turn }], "the lock is public");
    const forged = GameStateSchema.parse(s); forged.readyLocks![0].origin.ordinal = 1;
    assert.equal(validateState(forged, context).ok, false, "a Program lock has no trigger ordinal");
    const rivalTurn = take(s, context, a => a.action.kind === "END_TURN");
    assert.equal(rivalTurn.state.timing.activePlayer, rival);
    const prevented = rivalTurn.events.filter(e => e.payload.kind === "READY_PREVENTED");
    assert.deepEqual(prevented.map(e => (e.payload as unknown as { cardInstanceId: string }).cardInstanceId), [a.readyId], "2.6: the lock beats the 8.6.3 Ready Phase");
    assert.equal(rivalTurn.state.objects.cards[a.readyId].readiness, "SPENT");
    assert.equal(rivalTurn.state.objects.cards[a.spentId].readiness, "READY", "the unlocked Unit readies as usual");
    s = toRivalMain(s);
    assert.ok(!legalAttackers(s).includes(a.readyId), "the locked spent Unit can't attack");
    const back = take(s, context, a => a.action.kind === "END_TURN");
    assert.equal(back.state.timing.activePlayer, actor);
    assert.equal(back.state.readyLocks, undefined, "8.6.2.1: it ends at the start of the locking player's next turn");
    assert.ok(back.events.some(e => e.payload.kind === "READY_LOCK_EXPIRED" && (e.payload as unknown as { reason: string }).reason === "NEXT_TURN"));
    let mine = back.state;
    for (let n = 0; mine.timing.step !== "MAIN"; n++) { assert.ok(n < 20); mine = take(mine, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state; }
    const later = take(mine, context, a => a.action.kind === "END_TURN");
    assert.equal(later.state.objects.cards[a.readyId].readiness, "READY", "its controller's next Ready Phase readies it");
});

test("Memory Relapse with odd Street Cred and one rival Unit: forced target, lock, no draw", () => {
    let s = put(base, attacker.id, rival, "BATTLEFIELD").state;
    const unitId = s.players[rival].zones.BATTLEFIELD[0];
    s = put(gigs(s, actor, [3]).state, RELAPSE, actor, "HAND").state;
    const hand = s.players[actor].zones.HAND.length;
    const played = playCard(s, context, RELAPSE);
    assert.equal(played.state.resolution.choice, null);
    assert.deepEqual(played.state.readyLocks?.map(x => x.targetId), [unitId]);
    assert.equal(played.state.players[actor].zones.HAND.length, hand - 1, "odd Street Cred: no draw");
    assert.ok(played.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && (e.payload as unknown as { met: boolean }).met === false));
});

test("Pacifica Netrunner: even Street Cred locks a chosen rival Unit, ready or spent", () => {
    const a = arrange(true);
    let s = playCard(put(a.state, PACIFICA, actor, "HAND").state, context, PACIFICA).state;
    assert.equal(s.resolution.choice?.kind, "TARGET");
    assert.deepEqual(targetOptions(s), [a.readyId, a.spentId].sort());
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: s.players[actor].zones.BATTLEFIELD.find(id => s.objects.cards[id].cardId === PACIFICA)! });
    assert.equal(validateState(forged, context).ok, false, "a friendly Unit is never an option");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.spentId);
    s = done.state;
    assert.equal(s.objects.cards[a.spentId].readiness, "SPENT");
    assert.equal(s.readyLocks?.[0].origin.ordinal !== undefined, true, "a PLAY lock records its trigger ordinal");
    type Lock = { createdTurn: number; lockingPlayerId: PlayerId; targetId: CardInstanceId; origin: { ordinal?: number } };
    const forgeries: [string, (d: { readyLocks?: Lock[]; players: GameState["players"] }) => void][] = [
        ["created on the rival's turn", d => { d.readyLocks![0].createdTurn += 1; }],
        ["stale", d => { d.readyLocks![0].createdTurn -= 2; }],
        ["locking the rival", d => { d.readyLocks![0].lockingPlayerId = rival; }],
        ["other ordinal", d => { d.readyLocks![0].origin.ordinal! += 1; }],
        ["friendly target", d => { d.readyLocks![0].targetId = d.players[actor].zones.BATTLEFIELD[0]; }],
        ["duplicate", d => { d.readyLocks!.push({ ...d.readyLocks![0] }); }]
    ];
    for (const [label, edit] of forgeries) { const d = GameStateSchema.parse(s); edit(d as never); assert.equal(validateState(d, context).ok, false, label); }
    const rivalTurn = take(s, context, a => a.action.kind === "END_TURN");
    assert.equal(rivalTurn.state.objects.cards[a.spentId].readiness, "SPENT");
    assert.equal(rivalTurn.state.objects.cards[a.readyId].readiness, "READY");
});

test("Pacifica Netrunner: odd Street Cred does nothing (10.16.1.1: checked on resolution)", () => {
    const a = arrange(false);
    const played = playCard(put(a.state, PACIFICA, actor, "HAND").state, context, PACIFICA);
    assert.equal(played.state.resolution.choice, null);
    assert.equal(played.state.readyLocks, undefined);
    assert.ok(played.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && (e.payload as unknown as { met: boolean }).met === false));
});

test("a lock prevents effect readying too, and ends when its Unit leaves the field", () => {
    let s = put(base, attacker.id, rival, "BATTLEFIELD").state;
    const unitId = s.players[rival].zones.BATTLEFIELD[0];
    s = playCard(put(gigs(s, actor, [2, 4]).state, PACIFICA, actor, "HAND").state, context, PACIFICA).state;
    s = setReadiness(s, unitId, "SPENT");
    assert.deepEqual(s.readyLocks?.map(x => x.targetId), [unitId], "one rival Unit: forced target");
    const m = new TurnMutation(s, context);
    readyCardForEffect(m, unitId);
    assert.equal(m.state.objects.cards[unitId].readiness, "SPENT", "2.6: an effect cannot ready a locked Unit");
    const m2 = new TurnMutation(s, context);
    moveCardLocation(m2, unitId, "TRASH");
    assert.equal(m2.state.readyLocks, undefined, "a Unit that leaves the field is a new object");
    assert.ok(validateState(m2.state, context).ok);
});
