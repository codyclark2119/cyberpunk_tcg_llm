import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV14Cards, batchV14Context, batchV14Input, v14Source, ALL_IS_LOST } from "./api-admission-batch-v14-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { playCard, pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV14Context();
const lost = batchV14Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV14Input("batch-v14"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer;
const v2 = context.content.cards.filter(c => c.schemaVersion === 2);
const UNIT_A = v2.find(c => c.type === "UNIT" && c.id !== "screw-lovelorn-fool")!.id, UNIT_B = v2.filter(c => c.type === "UNIT").map(c => c.id).find(id => id !== UNIT_A)!;
const PROGRAM = v2.find(c => c.type === "PROGRAM" && c.id !== ALL_IS_LOST)!.id, GEAR = v2.find(c => c.type === "GEAR")!.id;
/** Trusted arrangement: All Is Lost in hand, then the deck's top cards rewritten as `top` and the deck cut to `size`. */
function arrange(top: string[], size?: number) {
    const m = new TurnMutation(base, context), p = m.state.players[actor], rewrite = (id: CardInstanceId, cardId: string) => { const r = context.content.cards.find(c => c.id === cardId)!; m.state.objects.cards[id].cardId = r.id; m.state.objects.cards[id].revision = r.revision; };
    const hand = p.zones.DECK[p.zones.DECK.length - 1]; rewrite(hand, ALL_IS_LOST); moveCardLocation(m, hand, "HAND");
    if (size !== undefined) for (const id of p.zones.DECK.slice(size)) moveCardLocation(m, id, "REMOVED");
    const ids = p.zones.DECK.slice(0, top.length); ids.forEach((id, i) => rewrite(id, top[i]));
    return { state: unwrap(validateState(m.state, context)), ids };
}
const zone = (s: GameState, id: string) => s.objects.cards[id as CardInstanceId].zone.zone;
const optionIds = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const lostId = (s: GameState) => Object.values(s.objects.cards).find(c => c.cardId === ALL_IS_LOST)!.id;

test("V14 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(lost.provenance.sourceHash, hashCanonical(v14Source(lost.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === lost.id), [lost]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
    assert.equal(lost.rulesText, "Trash 3. Add a Unit from among them to your hand.");
});

test("All Is Lost passes only its own exact pin; any changed field is rejected", () => {
    assert.ok(supportsPlay(lost, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(lost) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const edits: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["color", d => { d.colors = ["BLUE"]; d.ram = { BLUE: 2 }; }],
        ["tags", d => { d.tags = []; }],
        ["not sellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }],
        ["extra draw", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["unit type", d => { d.type = "UNIT"; d.power = 1; }]
    ];
    for (const [label, edit] of edits) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("All Is Lost trashes the top 3 one at a time and returns a chosen Unit from among them", () => {
    const a = arrange([UNIT_A, PROGRAM, UNIT_B]);
    const played = playCard(a.state, context, ALL_IS_LOST);
    assert.equal(played.state.timing.step, "TARGET_SELECTION");
    assert.deepEqual(optionIds(played.state), [a.ids[0], a.ids[2]].sort(), "only the trashed Units");
    assert.deepEqual(played.state.players[actor].zones.TRASH.slice(-3), a.ids, "trashed individually, in deck order");
    assert.deepEqual(played.events.filter(e => e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "TRASH").map(e => e.payload.kind === "CARD_MOVED" && e.payload.cardInstanceId), a.ids);
    const forged = GameStateSchema.parse(played.state); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: a.ids[1] });
    assert.equal(validateState(forged, context).ok, false, "a non-Unit cannot be offered");
    const shifted = GameStateSchema.parse(played.state); shifted.resolution.playContinuation!.trashedIds = [a.ids[0], a.ids[2]];
    assert.equal(validateState(shifted, context).ok, false, "the record must be exactly the trashed cards");
    const done = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[2]).state;
    assert.deepEqual(a.ids.map(id => zone(done, id)), ["TRASH", "TRASH", "HAND"]);
    assert.equal(zone(done, lostId(done)), "TRASH");
    assert.equal(done.resolution.playContinuation, undefined);
    assert.equal(done.resolution.choice, null);
});

test("one trashed Unit returns automatically; none returns nothing", () => {
    const one = arrange([GEAR, UNIT_A, PROGRAM]), played = playCard(one.state, context, ALL_IS_LOST).state;
    assert.equal(played.resolution.choice, null);
    assert.deepEqual(one.ids.map(id => zone(played, id)), ["TRASH", "HAND", "TRASH"]);
    const none = arrange([GEAR, PROGRAM, PROGRAM]), after = playCard(none.state, context, ALL_IS_LOST).state;
    assert.equal(after.resolution.choice, null);
    assert.deepEqual(none.ids.map(id => zone(after, id)), ["TRASH", "TRASH", "TRASH"]);
    assert.equal(after.players[actor].zones.HAND.length, none.state.players[actor].zones.HAND.length - 1);
});

test("a short deck trashes what it has and does not lose", () => {
    const short = arrange([UNIT_A, UNIT_B], 2), played = playCard(short.state, context, ALL_IS_LOST);
    assert.equal(played.state.match.outcome, undefined);
    assert.equal(played.state.players[actor].zones.DECK.length, 0);
    assert.deepEqual(optionIds(played.state), [...short.ids].sort());
    const done = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === short.ids[0]).state;
    assert.equal(done.match.outcome, undefined);
    assert.deepEqual(short.ids.map(id => zone(done, id)), ["HAND", "TRASH"]);
    const empty = arrange([], 0), nothing = playCard(empty.state, context, ALL_IS_LOST).state;
    assert.equal(nothing.match.outcome, undefined);
    assert.equal(zone(nothing, lostId(nothing)), "TRASH");
});

test("the reviewed union admits the V14 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === ALL_IS_LOST));
});
