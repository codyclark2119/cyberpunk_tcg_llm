import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, observe, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsHandResetProgram } from "../packages/engine/src/hand-reset";
import { supportsRivalRevealProgram } from "../packages/engine/src/rival-reveal";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV78Cards, batchV78Context, batchV78Input, v78Source } from "./api-admission-batch-v78-fixture";
import { batchV76Cards } from "./api-admission-batch-v76-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV78Context();
const [shattered] = batchV78Cards, [judy] = batchV76Cards;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV78Input("batch-v78"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const gig = base.players[actor].gigs.GIGS[0], gigValue = (s: GameState) => { const r = s.objects.gigs[gig].roll; return r.kind === "ROLLED" ? r.currentValue : -1; };

type Arrangement = { mine?: number; theirs?: number; deck?: number; rivalDeck?: number; judy?: boolean };
/** Trusted arrangement on the actor's MAIN: Shattered Memories in the actor's hand; `mine` other cards left in the actor's hand and
 * `theirs` in the Rival's (extra hand cards go to the trash first); decks cut to `deck` and `rivalDeck`; and with `judy`, Judy Álvarez:
 * Braindance Maestro face up as the actor's last Legend. The actor's one Gig is a rolled d8. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), d0 = m.state.players[actor].zones.DECK, c = m.state.objects.cards[d0[d0.length - 1]];
    for (const [player, keep] of [[actor, a.mine], [rival, a.theirs]] as const) if (keep !== undefined) for (const id of m.state.players[player].zones.HAND.slice(keep)) moveCardLocation(m, id, "TRASH");
    c.cardId = shattered.id; c.revision = shattered.revision; moveCardLocation(m, c.id, "HAND");
    for (const [player, keep] of [[actor, a.deck], [rival, a.rivalDeck]] as const) if (keep !== undefined) for (const id of m.state.players[player].zones.DECK.slice(keep)) moveCardLocation(m, id, "TRASH");
    const d = GameStateSchema.parse(m.state);
    if (a.judy) { const legends = d.players[actor].zones.LEGENDS, l = d.objects.cards[legends[legends.length - 1]]; l.cardId = judy.id; l.revision = judy.revision; l.face = "UP"; l.readiness = "READY"; }
    const state = unwrap(validateState(d, context));
    return { state, shattered: c.id, mine: state.players[actor].zones.HAND.filter(id => id !== c.id), theirs: [...state.players[rival].zones.HAND] };
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
const decide = (s: GameState, mode: "DRAW" | "DECLINE") => { const r = pick(s, context, o => o.kind === "MODE" && o.mode === mode); assert.ok(validateState(r.state, context).ok); return r; };

test("the V78 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(shattered.provenance.sourceHash, hashCanonical(v78Source(shattered.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === shattered.id), [shattered]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Shattered Memories passes only its exact pin; any changed field is rejected, and no other gate admits it", () => {
    for (const gate of [supportsPlay, supportsHandResetProgram]) assert.ok(gate(shattered, context).ok);
    for (const gate of [supportsCall, supportsTriggerCard, supportsFieldLegend, supportsRivalRevealProgram]) assert.equal(gate(shattered, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(shattered) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["a condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["another effect after", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["colors", d => { d.colors = ["BLUE"]; d.ram = { BLUE: 2 }; }],
        ["scope", d => { d.execution = { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsHandResetProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("both hands are discarded, the controller chooses first, then the Rival; a total matching no Gig draws nothing more", () => {
    const a = arrange(), r = play(a.state, a.shattered), s = r.state;
    assert.notEqual(a.mine.length + a.theirs.length, gigValue(s));
    const discarded = r.events.filter(e => e.payload.kind === "CARD_DISCARDED").map(e => e.payload.kind === "CARD_DISCARDED" ? e.payload.cardInstanceId : "");
    assert.deepEqual(discarded, [...a.mine, ...a.theirs], "the controller's hand first, then the Rival's");
    for (const p of [actor, rival]) assert.equal(s.players[p].zones.HAND.length, 0);
    for (const id of discarded) assert.equal(s.objects.cards[id].zone.zone, "TRASH");
    assert.equal(s.timing.actingPlayer, actor); assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(actions(s, context).map(x => x.descriptor.label).sort(), ["Draw 5", "Draw nothing"]);
    const waiting = listLegalActions(s, rival, context); assert.equal(waiting.ok ? waiting.value.length : 0, 0, "the Rival waits for the controller");
    const deck = s.players[actor].zones.DECK.slice(0, 5), mine = decide(s, "DRAW");
    for (const id of deck) assert.equal(mine.state.objects.cards[id].zone.zone, "HAND");
    assert.equal(mine.state.timing.actingPlayer, rival); assert.equal(mine.state.resolution.choice!.actorId, rival);
    assert.notEqual(mine.state.resolution.choice!.id, s.resolution.choice!.id);
    assert.deepEqual(actions(mine.state, context).map(x => x.descriptor.label).sort(), ["Draw 5", "Draw nothing"]);
    assert.equal(unwrap(observe(mine.state, rival, context)).inspectedCards, undefined, "drawn cards stay hidden");
    const done = decide(mine.state, "DECLINE");
    assert.equal(done.state.players[rival].zones.HAND.length, 0);
    assert.equal(done.state.players[actor].zones.HAND.length, 5);
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.timing.actingPlayer, actor);
    assert.equal(done.state.objects.cards[a.shattered].zone.zone, "TRASH");
    assert.equal(done.state.resolution.playContinuation, undefined);
    assert.deepEqual(done.events.filter(e => e.payload.kind === "OPTIONAL_DRAW_CHOSEN").map(e => e.payload.kind === "OPTIONAL_DRAW_CHOSEN" ? [e.payload.playerId, e.payload.draw] : []), [[rival, false]]);
});

test("a total equal to a friendly Gig's value draws 2 after both choices", () => {
    const value = gigValue(base), a = arrange({ mine: value - 1, theirs: 1 }), s = play(a.state, a.shattered).state;
    assert.equal(a.mine.length + a.theirs.length, value);
    const mine = decide(s, "DECLINE");
    assert.equal(mine.state.players[actor].zones.HAND.length, 0, "the bonus waits for the Rival");
    const top = mine.state.players[actor].zones.DECK.slice(0, 2), rivalTop = mine.state.players[rival].zones.DECK.slice(0, 5), done = decide(mine.state, "DRAW");
    for (const id of [...top, ...rivalTop]) assert.equal(done.state.objects.cards[id].zone.zone, "HAND");
    assert.equal(done.state.players[actor].zones.HAND.length, 2);
    assert.equal(done.state.timing.step, "MAIN");
});

test("empty hands still offer each draw; the Rival's own value never counts", () => {
    const a = arrange({ mine: 0, theirs: 0 }), r = play(a.state, a.shattered);
    assert.ok(!r.events.some(e => e.payload.kind === "CARD_DISCARDED"));
    const done = decide(decide(r.state, "DECLINE").state, "DECLINE");
    for (const p of [actor, rival]) assert.equal(done.state.players[p].zones.HAND.length, 0);
    assert.equal(done.state.timing.step, "MAIN");
});

test("drawing 5 from a short deck loses: the controller's or the Rival's", () => {
    const a = arrange({ deck: 4 }), lost = decide(play(a.state, a.shattered).state, "DRAW");
    assert.equal(lost.state.match.outcome?.loserId, actor);
    const b = arrange({ rivalDeck: 4 }), s = decide(play(b.state, b.shattered).state, "DECLINE").state, rivalLost = decide(s, "DRAW");
    assert.equal(rivalLost.state.match.outcome?.loserId, rival);
    const safe = decide(s, "DECLINE");
    assert.equal(safe.state.match.outcome, undefined);
});

test("as a BRAINDANCE Program it brings Judy Álvarez: Braindance Maestro's trigger after the reset", () => {
    const a = arrange({ judy: true }), s = play(a.state, a.shattered).state, done = decide(decide(s, "DECLINE").state, "DECLINE");
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === done.state.players[actor].zones.LEGENDS.at(-1)));
    assert.equal(done.state.objects.cards[a.shattered].zone.zone, "TRASH");
    assert.ok(validateState(done.state, context).ok);
});
