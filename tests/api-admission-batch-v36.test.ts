import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsProgramSearch } from "../packages/engine/src/program-search-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV36Cards, batchV36Context, batchV36Input, v36Source, THREE_MOUTHS } from "./api-admission-batch-v36-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV36Context();
const program = batchV36Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV36Input("batch-v36"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the Program in hand (from the deck's bottom); `keep` deck cards remain, the rest are trashed. */
function arrange(s: GameState, keep?: number) {
    const m = new TurnMutation(s, context), deck = m.state.players[actor].zones.DECK, r = context.content.cards.find(c => c.id === THREE_MOUTHS)!;
    const hand = m.state.objects.cards[deck[deck.length - 1]]; hand.cardId = r.id; hand.revision = r.revision; moveCardLocation(m, hand.id, "HAND");
    const d = GameStateSchema.parse(m.state), p = d.players[actor];
    for (const id of keep === undefined ? [] : p.zones.DECK.splice(keep)) { d.objects.cards[id].zone = { playerId: actor, zone: "TRASH" }; d.objects.cards[id].face = "UP"; p.zones.TRASH.push(id); }
    return { state: unwrap(validateState(d, context)), top: p.zones.DECK.slice(0, 3), program: hand.id };
}
/** Trusted arrangement: each listed die is rolled into its owner's Gig area at its value; all other dice wait in fixer areas. */
function gigs(s: GameState, rolled: { player: PlayerId; die: string; value: number }[]) {
    const d = GameStateSchema.parse(s);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const find = (x: { player: PlayerId; die: string }) => Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id;
    const chosen = new Map(rolled.map(x => [find(x), x.value]));
    for (const g of Object.values(d.objects.gigs)) {
        const value = chosen.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return unwrap(validateState(d, context));
}
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const hasDone = (s: GameState) => s.resolution.choice!.options.some(o => o.kind === "MODE" && o.mode === "DONE");
const take1 = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);
const inHand = (s: GameState, id: CardInstanceId) => s.players[actor].zones.HAND.includes(id);
const bottom = (s: GameState, n: number) => s.players[actor].zones.DECK.slice(-n);
// No friendly min Gig: the Rival's 1 is not friendly. Two friendly min Gigs: a d4 and a d6 at 1.
const NO_MIN = [{ player: actor, die: "D4", value: 2 }, { player: rival, die: "D6", value: 1 }];
const TWO_MIN = [{ player: actor, die: "D4", value: 1 }, { player: actor, die: "D6", value: 1 }, { player: actor, die: "D8", value: 5 }, { player: rival, die: "D4", value: 1 }];

test("the V36 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(program.provenance.sourceHash, hashCanonical(v36Source(program.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === program.id), [program]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Three Mouths One Desire passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsProgramSearch(program, context).ok); assert.ok(supportsPlay(program, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(program) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["Gear search", d => { d.mechanics.abilities[0].effects = [{ kind: "SEARCH_GEAR", count: 3, maxTake: 1 }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["trigger scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 1 }; }],
        ["tags", d => { d.tags = ["Braindance"]; }],
        ["keyword", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("with no friendly min Gig exactly 1 looked-at card is added, unrevealed; the other 2 are bottom-decked", () => {
    const a = arrange(gigs(base, NO_MIN)), [x, y, z] = a.top;
    const s = playCard(a.state, context, THREE_MOUTHS).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(cards(s), [x, y, z].sort()); assert.equal(hasDone(s), false, "\"Add 1\" is not optional");
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.unshift({ kind: "MODE", mode: "DONE" });
    assert.equal(validateState(forged, context).ok, false, "no stopping before the first card");
    const done = take1(s, y);
    assert.ok(inHand(done.state, y)); assert.deepEqual(bottom(done.state, 2).sort(), [x, z].sort());
    assert.equal(done.events.some(e => e.payload.kind === "CARD_REVEALED" && e.payload.cardInstanceId === y), false, "the card is added, not revealed");
    assert.ok(done.events.some(e => e.payload.kind === "SEARCH_REMAINDER_BOTTOMED"));
    assert.equal(done.state.objects.cards[a.program].zone.zone, "TRASH"); assert.equal(done.state.timing.step, "MAIN");
});

test("each friendly min Gig allows 1 more card; the extra cards are optional", () => {
    const a = arrange(gigs(base, TWO_MIN)), [x, y, z] = a.top;
    let s = take1(playCard(a.state, context, THREE_MOUTHS).state, z).state;
    assert.equal(s.timing.step, "TARGET_SELECTION", "two friendly min Gigs: up to 3"); assert.ok(hasDone(s)); assert.deepEqual(cards(s), [x, y].sort());
    const held = GameStateSchema.parse(s); held.resolution.searchContinuation!.selected = [a.program];
    assert.equal(validateState(held, context).ok, false, "only a looked-at card can be held as taken");
    s = take1(s, x).state;
    assert.deepEqual(cards(s), [y]); assert.ok(hasDone(s));
    const all = take1(s, y).state;
    assert.ok([x, y, z].every(id => inHand(all, id))); assert.equal(all.timing.step, "MAIN");
    const stopped = pick(take1(playCard(a.state, context, THREE_MOUTHS).state, x).state, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.ok(inHand(stopped, x)); assert.deepEqual(bottom(stopped, 2).sort(), [y, z].sort());
});

test("a lone looked-at card is added without a choice; an empty deck adds nothing", () => {
    const one = arrange(gigs(base, TWO_MIN), 1), played = playCard(one.state, context, THREE_MOUTHS);
    assert.equal(played.state.timing.step, "MAIN"); assert.ok(inHand(played.state, one.top[0]));
    const none = arrange(gigs(base, NO_MIN), 0), empty = playCard(none.state, context, THREE_MOUTHS);
    assert.equal(empty.state.timing.step, "MAIN"); assert.equal(empty.state.objects.cards[none.program].zone.zone, "TRASH");
});

test("the reviewed union admits the V36 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === THREE_MOUTHS));
});
