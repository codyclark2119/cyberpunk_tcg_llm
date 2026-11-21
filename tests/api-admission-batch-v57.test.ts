import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsStealReductionProgram } from "../packages/engine/src/steal-reduction-support";
import { supportsReactPlay } from "../packages/engine/src/react-support";
import { getGigStealAllowance } from "../packages/engine/src/combat-resolution-policy";
import { effectivePower } from "../packages/engine/src/characteristics";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV57Cards, batchV57Context, batchV57Input, v57Source, TAKE } from "./api-admission-batch-v57-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV57Context();
const take2 = batchV57Cards[0];
const OCTANT = "octant", PSYCHO = "psycho-squad", SMASHER = "adam-smasher-metal-over-meat"; // A DRONE (power 8), an NCPD Unit (power 6), and power 15 (2 steals; only a {Play}).
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV57Input("batch-v57"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
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
const allowance = (s: GameState, id: CardInstanceId) => getGigStealAllowance(effectivePower(s, id, context)!, context);
/** Plays Take Control from the actor's hand (Eddies first), then picks `target` if a choice opens. */
function playTake(s: GameState, takeId: CardInstanceId, target?: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === takeId);
    const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 30); const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); r = choose(r.state, context, i >= 0 ? i : 0); events.push(...r.events); }
    if (r.state.resolution.choice && target) { assert.ok(validateState(r.state, context).ok); r = pick(r.state, context, o => o.kind === "CARD" && o.cardInstanceId === target); events.push(...r.events); }
    return { state: r.state, events };
}
const drew = (events: { payload: { kind: string; met?: boolean } }[]) => events.filter(e => e.payload.kind === "CONDITION_EVALUATED").map(e => e.payload.met);

test("the V57 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(take2.provenance.sourceHash, hashCanonical(v57Source(take2.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === take2.id), [take2]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Take Control passes only its exact pin; no other gate reads a steal reduction", () => {
    for (const gate of [supportsPlay, supportsStealReductionProgram]) assert.ok(gate(take2, context).ok);
    for (const gate of [supportsTriggerCard, supportsReactPlay]) assert.equal(gate(take2, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(take2) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not Quick", d => { d.mechanics.keywords = []; }],
        ["also Blocker", d => { d.mechanics.keywords = ["QUICK", "BLOCKER"]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 1 }; }],
        ["tags", d => { d.tags = ["Braindance"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsStealReductionProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("in the actor's Main: the chosen rival Unit steals 1 fewer this turn; a DRONE target draws 1, another does not", () => {
    const octant = put(base, OCTANT, rival, "BATTLEFIELD"), psycho = put(octant.state, PSYCHO, rival, "BATTLEFIELD"), hand = put(psycho.state, TAKE, actor, "HAND");
    const before = hand.state.players[actor].zones.HAND.length;
    const onDrone = playTake(hand.state, hand.id, octant.id);
    assert.deepEqual(drew(onDrone.events), [true]); assert.equal(onDrone.state.players[actor].zones.HAND.length, before);
    assert.deepEqual(onDrone.state.stealReductions?.map(x => x.targetId), [octant.id]);
    const onOther = playTake(hand.state, hand.id, psycho.id);
    assert.deepEqual(drew(onOther.events), [false]); assert.equal(onOther.state.players[actor].zones.HAND.length, before - 1);
    const ended = take(onOther.state, context, a => a.action.kind === "END_TURN").state;
    assert.equal(ended.stealReductions, undefined, "it lasts this turn only");
});

test("in React on the rival's turn: the attacker steals 1 fewer Gig", () => {
    const g = gigs(base, actor, [1, 2, 3]).state, attacker = put(g, SMASHER, rival, "BATTLEFIELD"), hand = put(attacker.state, TAKE, actor, "HAND");
    const full = allowance(hand.state, attacker.id);
    assert.equal(full, 2);
    let s = toRivalMain(hand.state);
    s = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker.id).state;
    if (s.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    const played = playTake(s, hand.id);
    assert.deepEqual(played.state.stealReductions?.map(x => x.targetId), [attacker.id], "the lone rival Unit is chosen without a choice");
    const passed = take(played.state, context, a => a.action.kind === "PASS_REACT");
    const started = passed.events.find(e => e.payload.kind === "GIG_STEAL_STARTED")!.payload as unknown as { allowance: number };
    assert.equal(started.allowance, full - 1);
});

test("a reduction ends when its Unit leaves the field, and forged reductions are rejected", () => {
    const psycho = put(base, PSYCHO, rival, "BATTLEFIELD"), hand = put(psycho.state, TAKE, actor, "HAND");
    const done = playTake(hand.state, hand.id).state;
    assert.equal(done.stealReductions?.length, 1);
    const m = new TurnMutation(done, context); moveCardLocation(m, psycho.id, "TRASH");
    assert.equal(m.state.stealReductions, undefined);
    const own = GameStateSchema.parse(structuredClone(done)); own.stealReductions![0].targetId = own.players[actor].zones.LEGENDS[0];
    assert.equal(validateState(own, context).ok, false, "a rival field Unit only");
    const stale = GameStateSchema.parse(structuredClone(done)); stale.stealReductions![0].createdTurn = stale.timing.turn + 1;
    assert.equal(validateState(stale, context).ok, false, "this turn only");
});

test("the reviewed union contains Take Control", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === TAKE));
});
