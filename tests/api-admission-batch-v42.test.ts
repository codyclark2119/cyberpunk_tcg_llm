import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV42Cards, batchV42Context, batchV42Input, v42Source, MISTY } from "./api-admission-batch-v42-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV42Context();
const misty = batchV42Cards[0];
const ATLUS = "emergency-atlus"; // A vanilla Unit.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV42Input("batch-v42"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Misty ready on the actor's field; the deck's top card becomes `top` (or the deck is emptied); exactly
 * `spent` of the actor's Eddies are spent; the rival's d8 is rolled into its Gig area. */
function arrange(top: string | null, spent: number) {
    const m = new TurnMutation(base, context), deck = m.state.players[actor].zones.DECK, r = context.content.cards.find(c => c.id === MISTY)!;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = [];
    if (top) { const t = m.state.objects.cards[m.state.players[actor].zones.DECK[0]], tr = context.content.cards.find(x => x.id === top)!; t.cardId = tr.id; t.revision = tr.revision; }
    const d = GameStateSchema.parse(m.state);
    if (!top) for (const x of d.players[actor].zones.DECK.splice(0)) { d.objects.cards[x].zone = { playerId: actor, zone: "TRASH" }; d.objects.cards[x].face = "UP"; d.players[actor].zones.TRASH.push(x); }
    assert.ok(d.players[actor].zones.EDDIES.length >= spent);
    d.players[actor].zones.EDDIES.forEach((x, i) => { d.objects.cards[x].readiness = i < spent ? "SPENT" : "READY"; });
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs)) {
        const rolled = g.ownerId === rival && g.dieType === "D8";
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: 4 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), id: c.id, top: d.players[actor].zones.DECK[0] as CardInstanceId | undefined };
}
const endTurn = (s: GameState) => take(s, context, a => a.action.kind === "END_TURN");
const name = (s: GameState, type: string) => pick(s, context, o => o.kind === "MODE" && o.mode === type);
const spentEddies = (s: GameState) => s.players[actor].zones.EDDIES.filter(x => s.objects.cards[x].readiness === "SPENT").length;

test("the V42 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(misty.provenance.sourceHash, hashCanonical(v42Source(misty.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === misty.id), [misty]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Misty Olszewski passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(misty, context).ok); assert.ok(supportsPlay(misty, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(misty) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["can attack", d => { d.mechanics.restrictions = []; }],
        ["Gig-area ban only", d => { d.mechanics.restrictions = [{ kind: "CANNOT_ATTACK_GIG_AREA" }]; }],
        ["Play trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["power", d => { d.power = 1; }],
        ["tags", d => { d.tags = ["Netrunner"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("Misty can't attack; at the end of the turn naming the top card's type adds it and readies the lone spent Eddie", () => {
    const a = arrange(ATLUS, 1);
    assert.equal(actions(a.state, context).some(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.id), false, "can't attack");
    const s = endTurn(a.state).state;
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.equal(s.resolution.choice!.kind, "MODE");
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "MODE" ? o.mode : null), ["UNIT", "GEAR", "PROGRAM"]);
    const done = name(s, "UNIT");
    assert.ok(done.events.some(e => e.payload.kind === "CARD_TYPE_CHOSEN" && e.payload.cardType === "UNIT"));
    assert.ok(done.events.some(e => e.payload.kind === "CARD_REVEALED" && e.payload.cardInstanceId === a.top));
    assert.equal(done.state.objects.cards[a.top!].zone.zone, "HAND"); assert.equal(spentEddies(done.state), 0, "the Eddie is readied");
    assert.equal(done.state.timing.activePlayer, rival);
});

test("a wrong guess trashes the card and readies nothing", () => {
    const a = arrange(ATLUS, 1), done = name(endTurn(a.state).state, "PROGRAM").state;
    assert.equal(done.objects.cards[a.top!].zone.zone, "TRASH"); assert.equal(spentEddies(done), 1); assert.equal(done.timing.activePlayer, rival);
});

test("with several spent Eddies the controller picks which one to ready; with none, the card still goes to hand", () => {
    const a = arrange(ATLUS, 3), s = name(endTurn(a.state).state, "UNIT").state;
    assert.equal(s.timing.step, "EDDIE_READY_SELECTION"); assert.equal(s.resolution.choice!.options.length, 3);
    const forged = GameStateSchema.parse(s); forged.resolution.triggerContinuation!.phase = "TARGET";
    assert.equal(validateState(forged, context).ok, false, "a revealed card is never named twice");
    const slot = pick(s, context, o => o.kind === "EDDIE_SLOT" && o.slot === 2).state;
    assert.equal(spentEddies(slot), 2); assert.equal(slot.objects.cards[slot.players[actor].zones.EDDIES[2]].readiness, "READY"); assert.equal(slot.timing.activePlayer, rival);
    const none = arrange(ATLUS, 0), added = name(endTurn(none.state).state, "UNIT").state;
    assert.equal(added.objects.cards[none.top!].zone.zone, "HAND"); assert.equal(added.timing.activePlayer, rival);
});

test("with an empty deck there is nothing to name", () => {
    const a = arrange(null, 1), done = endTurn(a.state);
    assert.equal(done.events.some(e => e.payload.kind === "CARD_TYPE_CHOSEN"), false); assert.equal(done.state.timing.activePlayer, rival);
});

test("the reviewed union admits the V42 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === MISTY));
});
