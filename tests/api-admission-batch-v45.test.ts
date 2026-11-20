import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { observe } from "../packages/engine/src/observation";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV45Cards, batchV45Context, batchV45Input, v45Source, BOOTLEG } from "./api-admission-batch-v45-fixture";
import { batchV44Context } from "./api-admission-batch-v44-fixture";
import { INCITERS } from "./api-admission-batch-v43-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV45Context();
const bootleg = batchV45Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV45Input("batch-v45"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Bootleg in the actor's hand and an unsellable Mox Inciters on top of the deck; the actor's rolled Gigs
 * show `values` (in die order d4, d6, ...), every other Gig waits in its fixer area; `sold` sells already made this turn. */
function arrange(values: number[], sold = 0, deck = true) {
    const m = new TurnMutation(base, context), p = m.state.players[actor];
    const rewrite = (id: CardInstanceId, cardId: string) => { const c = m.state.objects.cards[id], r = context.content.cards.find(x => x.id === cardId)!; c.cardId = r.id; c.revision = r.revision; return c; };
    moveCardLocation(m, rewrite(p.zones.DECK[p.zones.DECK.length - 1], BOOTLEG).id, "HAND");
    rewrite(p.zones.DECK[0], INCITERS);
    const d = GameStateSchema.parse(m.state);
    if (!deck) for (const x of d.players[actor].zones.DECK.splice(0)) { d.objects.cards[x].zone = { playerId: actor, zone: "TRASH" }; d.objects.cards[x].face = "UP"; d.players[actor].zones.TRASH.push(x); }
    d.players[actor].economy.sellsThisTurn = sold;
    for (const q of Object.values(d.players)) q.gigs = { FIXER: [], GIGS: [] };
    const own = Object.values(d.objects.gigs).filter(g => g.ownerId === actor).sort((a, b) => Number(a.dieType.slice(1)) - Number(b.dieType.slice(1)));
    for (const g of Object.values(d.objects.gigs)) {
        const i = own.indexOf(g), rolled = i >= 0 && i < values.length;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: values[i] } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), top: d.players[actor].zones.DECK[0] };
}
const hand = (s: GameState) => s.players[actor].zones.HAND.length;
const canSell = (s: GameState) => actions(s, context).some(a => a.action.kind === "SELL_CARD");

test("the V45 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(bootleg.provenance.sourceHash, hashCanonical(v45Source(bootleg.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === bootleg.id), [bootleg]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Bootleg passes only its exact pin; any changed field is rejected, and no other gate reads an effect sell", () => {
    assert.ok(supportsPlay(bootleg, context).ok);
    assert.equal(supportsTriggerCard(bootleg, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(bootleg) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no sell", d => { d.mechanics.abilities[0].effects.shift(); }],
        ["draw first", d => { d.mechanics.abilities[0].effects.reverse(); }],
        ["draw 3", d => { d.mechanics.abilities[0].effects[1] = { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "FRIENDLY_GIGS_EVEN_AND_ODD" }, count: 3 }; }],
        ["other condition", d => { d.mechanics.abilities[0].effects[1] = { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "CONTROLS_VALUE_PAIR" }, count: 2 }; }],
        ["unconditional draw", d => { d.mechanics.abilities[0].effects[1] = { kind: "DRAW", count: 2 }; }],
        ["play condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "FRIENDLY_GIGS_EVEN_AND_ODD" }]; }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["tags", d => { d.tags = ["Braindance", "Doll"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("the top card is sold face-down without a Sell tag, uses the turn's sell, and an even and an odd Gig draw 2", () => {
    const a = arrange([3, 4]);
    assert.ok(canSell(a.state));
    const before = hand(a.state), played = playCard(a.state, context, BOOTLEG), s = played.state;
    const top = s.objects.cards[a.top];
    assert.equal(top.zone.zone, "EDDIES"); assert.equal(top.face, "DOWN"); assert.equal(top.readiness, "READY"); assert.deepEqual(top.statuses, ["EFFECT_SOLD"]);
    assert.equal(context.content.cards.find(c => c.id === top.cardId)!.sellProfile.allowed, false, "Mox Inciters has no Sell tag");
    assert.ok(played.events.some(e => e.payload.kind === "CARD_SOLD" && e.payload.cardInstanceId === a.top));
    assert.equal(played.events.some(e => e.payload.kind === "CARD_REVEALED" && e.payload.cardInstanceId === a.top), false, "nobody sees the sold card");
    for (const viewer of [actor, rival]) assert.equal(JSON.stringify(observe(s, viewer, context)).includes(INCITERS), false);
    assert.deepEqual(played.events.filter(e => e.payload.kind === "CONDITION_EVALUATED").map(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met), [true]);
    assert.equal(hand(s), before - 1 + 2); assert.equal(s.timing.step, "MAIN");
    assert.equal(s.players[actor].economy.sellsThisTurn, 1); assert.equal(canSell(s), false, "it counts as the turn's sell (11.12.2.2)");
});

test("without both an even and an odd Gig nothing is drawn; a sell made earlier this turn does not stop the effect sell", () => {
    for (const values of [[2, 4], [1, 3], [3], []]) {
        const a = arrange(values, 1), before = hand(a.state), s = playCard(a.state, context, BOOTLEG).state;
        assert.equal(s.objects.cards[a.top].zone.zone, "EDDIES", `${values}`); assert.equal(hand(s), before - 1, `${values}`);
        assert.equal(s.players[actor].economy.sellsThisTurn, 1);
    }
});

test("with an empty deck nothing is sold", () => {
    const a = arrange([2], 0, false), s = playCard(a.state, context, BOOTLEG);
    assert.equal(s.events.some(e => e.payload.kind === "CARD_SOLD"), false); assert.equal(s.state.players[actor].economy.sellsThisTurn, 0);
    assert.equal(s.state.timing.step, "MAIN");
});

test("the effect-sold mark is exact: only on an Eddie, required for an unsellable Eddie, and only under the reviewed Program", () => {
    const s = playCard(arrange([3, 4]).state, context, BOOTLEG).state, top = s.players[actor].zones.EDDIES.at(-1)!;
    const unmarked = GameStateSchema.parse(s); unmarked.objects.cards[top].statuses = [];
    assert.equal(validateState(unmarked, context).ok, false, "an unsellable Eddie needs the mark");
    const inHand = GameStateSchema.parse(s), h = inHand.players[actor].zones.HAND[0]; inHand.objects.cards[h].statuses = ["EFFECT_SOLD"];
    assert.equal(validateState(inHand, context).ok, false, "the mark belongs only to Eddies");
    const twice = GameStateSchema.parse(s); twice.objects.cards[top].statuses = ["EFFECT_SOLD", "EFFECT_SOLD"];
    assert.equal(validateState(twice, context).ok, false);
    const v44 = batchV44Context(), d = GameStateSchema.parse(s), cards = new Set(v44.content.cards.map(c => `${c.id}@${c.revision}`));
    for (const c of Object.values(d.objects.cards)) if (!cards.has(`${c.cardId}@${c.revision}`)) { const r = v44.content.cards.find(x => x.id === "emergency-atlus")!; c.cardId = r.id; c.revision = r.revision; }
    assert.equal(validateState({ ...d, match: { ...d.match } }, v44).ok, false, "no reviewed effect-sell Program, no mark");
});

test("the reviewed union admits the V45 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === BOOTLEG));
});
