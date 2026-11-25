import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFreeCallUnit } from "../packages/engine/src/free-call-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV84Cards, batchV84Context, batchV84Input, v84Source } from "./api-admission-batch-v84-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV84Context();
const [whisper] = batchV84Cards;
const DRAW = "dev-legend-red", MODAL = "dexter-deshawn-off-the-grid", PLAIN = "royce-psycho-on-the-edge"; // {Call} Draw 1; {Call} Choose one; no {Call}.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV84Input("batch-v84"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer;

type Arrangement = { legends?: string[]; faceUp?: number; called?: boolean };
/** Trusted arrangement on the actor's MAIN: Tyger's Whisper in hand; the actor's Legends become `legends` in slot order (default all
 * Draw-1 Legends), the first `faceUp` of them face up; with `called`, the turn's Call is already used. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]];
    c.cardId = whisper.id; c.revision = whisper.revision; moveCardLocation(m, c.id, "HAND");
    const d = GameStateSchema.parse(m.state), legends = d.players[actor].zones.LEGENDS;
    legends.forEach((id, i) => {
        const l = d.objects.cards[id], r = context.content.cards.find(x => x.id === (a.legends?.[i] ?? DRAW))!;
        l.cardId = r.id; l.revision = r.revision; l.face = i < (a.faceUp ?? 0) ? "UP" : "DOWN";
    });
    if (a.called) d.players[actor].economy.callsThisTurn = 1;
    return { state: unwrap(validateState(d, context)), whisper: c.id, legends: [...legends] };
}
const labels = (s: GameState) => actions(s, context).map(x => x.descriptor.label);
const hand = (s: GameState) => s.players[actor].zones.HAND.length;
/** Plays Tyger's Whisper, paying with Eddies, up to its free-Call choice (or its end). */
const play = (s: GameState) => playCard(s, context, whisper.id);
function callSlot(s: GameState, slot: number) { return pick(s, context, o => o.kind === "LEGEND_SLOT" && o.slot === slot); }

test("the V84 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(whisper.provenance.sourceHash, hashCanonical(v84Source(whisper.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === whisper.id), [whisper]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Tyger's Whisper passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsFreeCallUnit]) assert.ok(gate(whisper, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(whisper) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost 1", d => { d.printedCost = { kind: "EDDIES", amount: 1 }; }],
        ["power 2", d => { d.power = 2; }],
        ["on attack", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["two Calls", d => { d.mechanics.abilities[0].effects = [{ kind: "MAY_CALL_LEGEND_FREE" }, { kind: "MAY_CALL_LEGEND_FREE" }]; }],
        ["plus a draw", d => { d.mechanics.abilities[0].effects = [{ kind: "MAY_CALL_LEGEND_FREE" }, { kind: "DRAW", count: 1 }]; }],
        ["tags", d => { d.tags = ["Fixer"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsFreeCallUnit]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("playing it offers each face-down Legend slot or no Call; the Legend is Called for free and its {Call} resolves after the {Play}", () => {
    const a = arrange({ faceUp: 1 }), s = play(a.state).state, before = hand(s), eddies = s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "READY").length;
    assert.equal(s.resolution.choice?.kind, "TARGET");
    assert.deepEqual(labels(s), ["Call no Legend", ...a.legends.slice(1).map((_, i) => `Call face-down Legend ${i + 2} for free`)]);
    const r = callSlot(s, 1), kinds = r.events.map(e => e.payload.kind);
    assert.ok(validateState(r.state, context).ok);
    assert.equal(r.state.objects.cards[a.legends[1]].face, "UP"); assert.equal(r.state.players[actor].economy.callsThisTurn, 1);
    assert.equal(kinds.includes("PAYMENT_MADE"), false, "the Call is free");
    assert.equal(r.state.players[actor].zones.EDDIES.filter(id => r.state.objects.cards[id].readiness === "READY").length, eddies);
    const called = kinds.indexOf("LEGEND_CALLED"), resolved = r.events.findIndex(e => e.payload.kind === "EFFECT_RESOLVED" && r.events.slice(0, called).every(x => x.payload.kind !== "EFFECT_RESOLVED"));
    assert.ok(called >= 0 && resolved > called, "the {Play} effect finishes after the Call");
    assert.equal(hand(r.state), before + 1, "the Legend's {Call} drew 1 after the {Play}");
    assert.equal(r.state.turnHistory?.queuedCall, undefined);
    assert.equal(r.state.timing.step, "MAIN");
    assert.equal(actions(r.state, context).some(x => x.action.kind === "CALL_LEGEND"), false, "the once-per-turn Call is used");
});

test("declining Calls nothing, and the turn's Call stays available", () => {
    const a = arrange(), s = play(a.state).state, r = pick(s, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(r.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(r.events.some(e => e.payload.kind === "LEGEND_CALLED"), false);
    assert.equal(r.state.players[actor].economy.callsThisTurn, 0);
    assert.equal(r.state.timing.step, "MAIN");
    assert.ok(actions(r.state, context).some(x => x.action.kind === "CALL_LEGEND"));
});

test("with the turn's Call used, or no face-down Legend, the {Play} resolves without a choice", () => {
    for (const a of [arrange({ called: true }), arrange({ faceUp: 3 })]) {
        const r = play(a.state);
        assert.equal(r.state.resolution.choice, null);
        assert.equal(r.events.some(e => e.payload.kind === "LEGEND_CALLED"), false);
        assert.equal(r.state.timing.step, "MAIN");
    }
});

test("a Legend without a {Call} ability is Called with nothing queued", () => {
    const a = arrange({ legends: [PLAIN, DRAW, DRAW] }), s = play(a.state).state, before = hand(s), r = callSlot(s, 0);
    assert.equal(r.state.objects.cards[a.legends[0]].face, "UP");
    assert.equal(hand(r.state), before); assert.equal(r.state.timing.step, "MAIN");
});

test("a modal {Call} pauses for its mode once the {Play} is done, and a pending Call is validated", () => {
    const a = arrange({ legends: [MODAL, DRAW, DRAW] }), s = play(a.state).state, before = hand(s), r = callSlot(s, 0);
    assert.ok(validateState(r.state, context).ok);
    assert.equal(r.state.resolution.triggerContinuation, undefined);
    assert.equal(r.state.resolution.playContinuation?.sourceId, a.legends[0]); assert.equal(r.state.resolution.playContinuation?.phase, "MODE");
    assert.deepEqual(r.state.resolution.choice?.options, [{ kind: "MODE", mode: "POWER_UNTIL_END_OF_TURN" }, { kind: "MODE", mode: "DRAW" }]);
    const done = pick(r.state, context, o => o.kind === "MODE" && o.mode === "DRAW").state;
    assert.equal(done.timing.step, "MAIN"); assert.equal(hand(done), before + 1);
    const tamper = (s: GameState, edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(s); edit(d); return validateState(d, context).ok; };
    assert.equal(tamper(s, d => { d.players[actor].economy.callsThisTurn = 1; }), false, "the choice needs a Call left this turn");
    assert.equal(tamper(done, d => { d.turnHistory!.queuedCall = { playerId: actor, legendId: a.legends[0] }; }), false, "a queued Call needs its unfinished action");
});
