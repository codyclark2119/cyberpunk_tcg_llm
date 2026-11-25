import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFreeCallUnit } from "../packages/engine/src/free-call-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV86Cards, batchV86Context, batchV86Input, v86Source, TBUG } from "./api-admission-batch-v86-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV86Context();
const [tbug] = batchV86Cards;
const SQUAD = "psycho-squad", DRAW = "dev-legend-red", MODAL = "dexter-deshawn-off-the-grid"; // A power-6 Unit; {Call} Draw 1; {Call} Choose one.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV86Input("batch-v86"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { legends?: string[]; faceUp?: number; tbug?: "READY" | "SPENT"; squad?: "READY" | "SPENT" };
/** Trusted arrangement on the actor's MAIN: T-Bug on the actor's field (`tbug`, default READY) and Psycho Squad on the rival's (`squad`,
 * default SPENT), both without Lag; the actor's Legends become `legends` in slot order (default all Draw-1), the first `faceUp` face up. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context);
    const place = (player: PlayerId, cardId: string, readiness: "READY" | "SPENT") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = readiness; c.statuses = []; return c.id;
    };
    const tbugId = place(actor, TBUG, a.tbug ?? "READY"), squadId = place(rival, SQUAD, a.squad ?? "SPENT");
    const d = GameStateSchema.parse(m.state), legends = d.players[actor].zones.LEGENDS;
    legends.forEach((id, i) => {
        const l = d.objects.cards[id], r = context.content.cards.find(x => x.id === (a.legends?.[i] ?? DRAW))!;
        l.cardId = r.id; l.revision = r.revision; l.face = i < (a.faceUp ?? 0) ? "UP" : "DOWN";
    });
    return { state: unwrap(validateState(d, context)), tbug: tbugId, squad: squadId, legends: [...legends] };
}
function attack(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    const declared = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    let state = declared.timing.step === "ATTACK_TARGET_SELECTION" ? pick(declared, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state : declared;
    const events = [];
    // Pass every React Step until the free-Call choice (or the attack's end).
    while (state.timing.step === "RIVAL_REACT") { const r = take(state, context, x => x.action.kind === "PASS_REACT"); state = r.state; events.push(...r.events); }
    return { state, events };
}
/** The actor's own attack: T-Bug attacks the spent Psycho Squad and loses. */
const ownAttack = (a: ReturnType<typeof arrange>) => attack(a.state, a.tbug, a.squad);
/** The rival's attack on the actor's spent T-Bug, on the rival's next turn. */
function rivalAttack(a: ReturnType<typeof arrange>) {
    let state = end(a.state, context).state;
    while (!(state.timing.step === "MAIN" && state.timing.activePlayer === rival)) state = take(state, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    return attack(state, a.squad, a.tbug);
}
const labels = (s: GameState) => actions(s, context).map(x => x.descriptor.label);
const hand = (s: GameState) => s.players[actor].zones.HAND.length;
const freeCallChoice = (s: GameState) => s.resolution.current?.effect.kind === "MAY_CALL_LEGEND_FREE" && s.resolution.choice?.kind === "TARGET";

test("the V86 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(tbug.provenance.sourceHash, hashCanonical(v86Source(tbug.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === tbug.id), [tbug]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("T-Bug passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsFreeCallUnit]) assert.ok(gate(tbug, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(tbug) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no look", d => { d.mechanics.abilities[0].effects = [{ kind: "MAY_CALL_LEGEND_FREE" }]; }],
        ["on play", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["power 5", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["scope", d => { d.execution = { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" }; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsFreeCallUnit]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("defeated in its own attack: it looks at every face-down Legend, Calls one for free, and the {Call} resolves after the attack", () => {
    const a = arrange({ faceUp: 1 }), r = ownAttack(a), s = r.state;
    assert.ok(freeCallChoice(s)); assert.equal(s.objects.cards[a.tbug].zone.zone, "TRASH");
    assert.deepEqual(r.events.filter(e => e.payload.kind === "LEGEND_LOOKED_AT").map(e => (e.payload as { slot: number }).slot), [1, 2]);
    assert.deepEqual((s.privateKnowledge ?? []).filter(k => k.viewerId === actor).map(k => k.cardInstanceId).sort(), a.legends.slice(1).sort());
    assert.deepEqual(labels(s).sort(), ["Call face-down Legend 2 for free", "Call face-down Legend 3 for free", "Call no Legend"]);
    const before = hand(s), called = pick(s, context, o => o.kind === "LEGEND_SLOT" && o.slot === 2);
    assert.ok(validateState(called.state, context).ok);
    assert.equal(called.state.objects.cards[a.legends[2]].face, "UP"); assert.equal(called.state.players[actor].economy.callsThisTurn, 1);
    const kinds = called.events.map(e => e.payload.kind);
    assert.ok(kinds.indexOf("ATTACK_ENDED") > kinds.indexOf("LEGEND_CALLED"), "the Call happens in the attack, its {Call} after");
    assert.equal(hand(called.state), before + 1);
    assert.deepEqual((called.state.privateKnowledge ?? []).map(k => k.cardInstanceId), [a.legends[1]], "the Called Legend is no longer hidden");
    assert.equal(called.state.timing.step, "MAIN"); assert.equal(called.state.timing.actingPlayer, actor);
    assert.equal(called.state.turnHistory?.queuedCall, undefined);
});

test("defeated in the rival's turn: its controller Calls for free, and a modal {Call} pauses for them before the rival acts again", () => {
    const a = arrange({ legends: [MODAL, DRAW, DRAW], tbug: "SPENT", squad: "READY" }), s = rivalAttack(a).state;
    assert.ok(freeCallChoice(s)); assert.equal(s.timing.activePlayer, rival); assert.equal(s.timing.actingPlayer, actor);
    const called = pick(s, context, o => o.kind === "LEGEND_SLOT" && o.slot === 0).state;
    assert.ok(validateState(called, context).ok);
    assert.equal(called.timing.combat.stage, "NONE"); assert.equal(called.turnHistory?.queuedCall?.started, true);
    assert.equal(called.timing.actingPlayer, actor); assert.equal(called.resolution.playContinuation?.phase, "MODE");
    assert.deepEqual(called.resolution.choice?.options, [{ kind: "MODE", mode: "POWER_UNTIL_END_OF_TURN" }, { kind: "MODE", mode: "DRAW" }]);
    const before = hand(called), done = pick(called, context, o => o.kind === "MODE" && o.mode === "DRAW").state;
    assert.equal(hand(done), before + 1); assert.equal(done.players[actor].economy.callsThisTurn, 1);
    assert.equal(done.timing.step, "MAIN"); assert.equal(done.timing.activePlayer, rival); assert.equal(done.timing.actingPlayer, rival);
    assert.equal(done.turnHistory?.queuedCall, undefined);
    const tamper = (edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(called); edit(d); return validateState(d, context).ok; };
    assert.equal(tamper(d => { delete d.turnHistory!.queuedCall; }), false, "the non-active player's {Call} needs its queued Call");
    assert.equal(tamper(d => { d.turnHistory!.queuedCall!.legendId = a.legends[1]; }), false, "the queue names the Called Legend");
});

test("declining Calls nothing; with every Legend face up it only finishes the attack", () => {
    const declined = pick(ownAttack(arrange()).state, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(declined.state.players[actor].economy.callsThisTurn, 0); assert.equal(declined.state.timing.step, "MAIN");
    const none = ownAttack(arrange({ faceUp: 3 }));
    assert.equal(none.events.some(e => e.payload.kind === "LEGEND_LOOKED_AT" || e.payload.kind === "LEGEND_CALLED"), false);
    assert.equal(none.state.timing.step, "MAIN");
});
