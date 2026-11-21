import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV60Cards, batchV60Context, batchV60Input, v60Source, WAKAKO, DEXTER } from "./api-admission-batch-v60-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV60Context();
const [wakako, dexter] = batchV60Cards;
const OCTANT = "octant", PSYCHO = "psycho-squad"; // Power 8 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV60Input("batch-v60"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** Trusted arrangement: `player`'s last Legend rewritten as `card`, face down (to Call) or up and ready (to {Spend}). */
function withLegend(s: GameState, card: CardRevisionSnapshot, face: "UP" | "DOWN", player: PlayerId = actor) {
    const d = GameStateSchema.parse(structuredClone(s)), zone = d.players[player].zones.LEGENDS, id = zone[zone.length - 1], c = d.objects.cards[id];
    c.cardId = card.id; c.revision = card.revision; c.face = face; c.readiness = "READY";
    return { state: unwrap(validateState(d, context)), id };
}
/** Trusted arrangement: the bottom deck card of `player` rewritten as `cardId`, on the field (ready unless `spent`). */
function put(s: GameState, cardId: string, player: PlayerId, spent = false) {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = spent ? "SPENT" : "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Calls `id`, paying with the first offered sources, and stops at its mode choice. */
function call(s: GameState, id: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === id);
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 10); r = choose(r.state, context, 0); }
    return r.state;
}
const mode = (s: GameState, kind: string) => { assert.ok(validateState(s, context).ok); return pick(s, context, o => o.kind === "MODE" && o.mode === kind).state; };
const unit = (s: GameState, id: CardInstanceId) => { assert.ok(validateState(s, context).ok); return pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id).state; };
const gig = (s: GameState, id: GigInstanceId) => { assert.ok(validateState(s, context).ok); return pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === id).state; };
const amount = (s: GameState, n: number) => { assert.ok(validateState(s, context).ok); return pick(s, context, o => o.kind === "AMOUNT" && o.amount === n).state; };
const power = (s: GameState, id: CardInstanceId) => effectivePower(s, id, context);

test("the V60 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const card of batchV60Cards) {
        assert.equal(card.provenance.sourceHash, hashCanonical(v60Source(card.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === card.id), [card]);
        assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
    }
});

test("each Legend passes only its exact pin; Calling is admitted through it and neither is played", () => {
    for (const card of batchV60Cards) {
        for (const gate of [supportsCall, supportsLegendSpendCard]) assert.ok(gate(card, context).ok, card.id);
        assert.equal(supportsPlay(card, context).ok, false);
        const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(card) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
        const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
            ["both instead", d => { d.mechanics.abilities[0].choose = { count: 1, allInstead: { kind: "CONTROLS_VALUE_PAIR" } }; }],
            ["no choice", d => { delete d.mechanics.abilities[0].choose; }],
            ["draw 2", d => { d.mechanics.abilities[0].effects[1] = { kind: "DRAW", count: 2 }; }],
            ["adjust 3", d => { const e = d.mechanics.abilities[1].effects[0]; if (e.kind === "ADJUST_GIG_UP_TO") e.maximum = 3; }],
            ["other direction", d => { const e = d.mechanics.abilities[1].effects[0]; if (e.kind === "ADJUST_GIG_UP_TO") e.direction = e.direction === "INCREASE" ? "DECREASE" : "INCREASE"; }],
            ["Quick", d => { d.mechanics.abilities[1].activation!.timing = "QUICK"; }],
            ["tags", d => { d.tags = ["Corpo"]; }],
            ["swapped modes", d => { d.mechanics.abilities[0].effects.reverse(); }]
        ];
        for (const [label, edit] of forgeries) for (const gate of [supportsCall, supportsLegendSpendCard]) assert.equal(gate(forge(edit), context).ok, false, `${card.id} ${label}`);
    }
});

test("Calling Wakako offers both printed modes; -2 goes to the chosen rival Unit this turn, and Draw 1 draws", () => {
    const o = put(base, OCTANT, rival), p = put(o.state, PSYCHO, rival), w = withLegend(p.state, wakako, "DOWN");
    const called = call(w.state, w.id);
    assert.deepEqual(called.resolution.choice?.options, [{ kind: "MODE", mode: "POWER_UNTIL_END_OF_TURN" }, { kind: "MODE", mode: "DRAW" }]);
    const minus = unit(mode(called, "POWER_UNTIL_END_OF_TURN"), p.id);
    assert.equal(power(minus, p.id), 4); assert.equal(power(minus, o.id), 8); assert.equal(minus.timing.step, "MAIN");
    assert.ok(validateState(minus, context).ok);
    const forged = GameStateSchema.parse(structuredClone(minus)); forged.temporaryModifiers![0].targetId = forged.players[actor].zones.LEGENDS[0];
    assert.equal(validateState(forged, context).ok, false, "a public rival Unit only");
    const ended = take(minus, context, a => a.action.kind === "END_TURN").state;
    assert.equal(power(ended, p.id), 6, "this turn only");
    const before = called.players[actor].zones.HAND.length, drew = mode(called, "DRAW");
    assert.equal(drew.players[actor].zones.HAND.length, before + 1); assert.equal(drew.temporaryModifiers, undefined);
});

test("Calling Dexter gives a lone friendly Unit +2 without a target choice", () => {
    const mine = put(base, PSYCHO, actor), d = withLegend(mine.state, dexter, "DOWN");
    const done = mode(call(d.state, d.id), "POWER_UNTIL_END_OF_TURN");
    assert.equal(power(done, mine.id), 8); assert.equal(done.timing.step, "MAIN"); assert.ok(validateState(done, context).ok);
});

test("in React on the rival's turn, Calling Wakako weakens the attacker", () => {
    const attacker = put(base, OCTANT, rival), w = withLegend(attacker.state, wakako, "DOWN");
    let s = take(w.state, context, a => a.action.kind === "END_TURN").state;
    for (let n = 0; !(s.timing.activePlayer === rival && s.timing.step === "MAIN"); n++) { assert.ok(n < 20); s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state; }
    s = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker.id).state;
    if (s.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    const done = mode(call(s, w.id), "POWER_UNTIL_END_OF_TURN");
    assert.equal(power(done, attacker.id), 6, "the lone rival Unit is chosen without a choice"); assert.equal(done.timing.step, "RIVAL_REACT");
});

test("{Spend}: Wakako decreases a chosen Gig by 0 to 2; Dexter increases by at most the die's room", () => {
    const g = GameStateSchema.parse(structuredClone(base)), mine = g.players[actor].gigs.GIGS[0], die = g.objects.gigs[mine];
    assert.ok(die.roll.kind === "ROLLED");
    die.roll = { ...die.roll, currentValue: Math.max(3, Number(die.dieType.slice(1)) - 1) };
    const start = unwrap(validateState(g, context)), value = (s: GameState) => { const r = s.objects.gigs[mine].roll; return r.kind === "ROLLED" ? r.currentValue : 0; };
    const w = withLegend(start, wakako, "UP");
    let s = take(w.state, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === w.id).state;
    if (s.timing.step === "TARGET_SELECTION") s = gig(s, mine);
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "AMOUNT" && o.amount), [0, 1, 2]);
    const lowered = amount(s, 2);
    assert.equal(value(lowered), value(start) - 2); assert.equal(lowered.objects.cards[w.id].readiness, "SPENT"); assert.equal(lowered.timing.step, "MAIN");
    const d = withLegend(start, dexter, "UP");
    s = take(d.state, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === d.id).state;
    if (s.timing.step === "TARGET_SELECTION") s = gig(s, mine);
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "AMOUNT" && o.amount), [0, 1], "one below the die's maximum");
    assert.equal(value(amount(s, 1)), value(start) + 1);
    assert.equal(actions(withLegend(start, wakako, "DOWN").state, context).some(a => a.action.kind === "ACTIVATE_ABILITY"), false, "face down: no {Spend}");
});

test("the reviewed union contains Wakako and Dexter", () => {
    for (const id of [WAKAKO, DEXTER]) assert.ok(reviewedUnionContext().content.cards.some(c => c.id === id));
});
