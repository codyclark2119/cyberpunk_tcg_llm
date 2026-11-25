import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, observe, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsRivalRevealProgram } from "../packages/engine/src/rival-reveal";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV77Cards, batchV77Context, batchV77Input, v77Source } from "./api-admission-batch-v77-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV77Context();
const [fool] = batchV77Cards;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV77Input("batch-v77"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: Fool on the Hill in the actor's hand, and the actor's deck cut to `deck` cards. */
function arrange(deck?: number) {
    const m = new TurnMutation(base, context), d0 = m.state.players[actor].zones.DECK, c = m.state.objects.cards[d0[d0.length - 1]];
    c.cardId = fool.id; c.revision = fool.revision; moveCardLocation(m, c.id, "HAND");
    if (deck !== undefined) for (const id of m.state.players[actor].zones.DECK.slice(deck)) moveCardLocation(m, id, "TRASH");
    const state = unwrap(validateState(GameStateSchema.parse(m.state), context));
    return { state, fool: c.id, top: state.players[actor].zones.DECK.slice(0, 2) };
}
function play(s: GameState, id: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}

test("the V77 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(fool.provenance.sourceHash, hashCanonical(v77Source(fool.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === fool.id), [fool]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Fool on the Hill passes only its exact pin; any changed field is rejected, and no other gate admits it", () => {
    for (const gate of [supportsPlay, supportsRivalRevealProgram]) assert.ok(gate(fool, context).ok);
    for (const gate of [supportsCall, supportsTriggerCard]) assert.equal(gate(fool, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(fool) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["a condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["another effect after", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 1 }; }],
        ["tags", d => { d.tags = ["Braindance"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 3 }; }],
        ["scope", d => { d.execution = { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsRivalRevealProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the top 2 are revealed to both players and the Rival chooses; hand adds them", () => {
    const a = arrange(), hand = a.state.players[actor].zones.HAND.length, r = play(a.state, a.fool), s = r.state;
    assert.deepEqual(r.events.filter(e => e.payload.kind === "CARD_REVEALED").map(e => e.payload.kind === "CARD_REVEALED" ? e.payload.cardInstanceId : "").filter(id => id !== a.fool), a.top);
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.equal(s.timing.actingPlayer, rival); assert.equal(s.resolution.choice!.actorId, rival);
    for (const viewer of [actor, rival]) assert.deepEqual(unwrap(observe(s, viewer, context)).inspectedCards?.map(x => x.instanceId), a.top, viewer);
    const labels = actions(s, context).map(x => x.descriptor.label);
    assert.deepEqual(labels.sort(), ["Put the revealed cards into their owner's hand", "Trash the revealed cards (their owner draws 2)"]);
    const done = pick(s, context, o => o.kind === "MODE" && o.mode === "HAND");
    assert.ok(validateState(done.state, context).ok);
    for (const id of a.top) assert.equal(done.state.objects.cards[id].zone.zone, "HAND");
    assert.equal(done.state.players[actor].zones.HAND.length, hand - 1 + 2, "Fool left the hand, both revealed cards joined it");
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.timing.actingPlayer, actor);
    assert.equal(done.state.objects.cards[a.fool].zone.zone, "TRASH");
    assert.ok(done.events.some(e => e.payload.kind === "DESTINATION_CHOSEN" && e.payload.playerId === rival && e.payload.destination === "HAND"));
    assert.equal(unwrap(observe(done.state, rival, context)).inspectedCards, undefined, "no longer revealed");
});

test("trash sends both to the trash and the owner draws 2", () => {
    const a = arrange(), s = play(a.state, a.fool).state, next = s.players[actor].zones.DECK.slice(2, 4);
    const done = pick(s, context, o => o.kind === "MODE" && o.mode === "TRASH");
    assert.ok(validateState(done.state, context).ok);
    for (const id of a.top) assert.equal(done.state.objects.cards[id].zone.zone, "TRASH");
    for (const id of next) assert.equal(done.state.objects.cards[id].zone.zone, "HAND");
    assert.equal(done.state.timing.actingPlayer, actor);
});

test("a short deck reveals what it has; an empty deck reveals nothing and asks nothing", () => {
    const one = arrange(1), s = play(one.state, one.fool).state;
    assert.equal(s.resolution.choice!.actorId, rival); assert.deepEqual(unwrap(observe(s, rival, context)).inspectedCards?.map(x => x.instanceId), one.top);
    const trashed = pick(s, context, o => o.kind === "MODE" && o.mode === "TRASH");
    assert.equal(trashed.state.match.outcome?.loserId, actor, "drawing 2 from an empty deck loses");
    const none = arrange(0), n = play(none.state, none.fool);
    assert.equal(n.state.timing.step, "MAIN"); assert.equal(n.state.timing.actingPlayer, actor);
    assert.ok(!n.events.some(e => e.payload.kind === "CARD_REVEALED" && e.payload.cardInstanceId !== none.fool), "only the played Fool itself was revealed");
    assert.equal(n.state.objects.cards[none.fool].zone.zone, "TRASH");
});
