import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV32Cards, batchV32Context, batchV32Input, v32Source, PLACIDE } from "./api-admission-batch-v32-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV32Context();
const placide = batchV32Cards[0];
const ATLUS = "emergency-atlus", SQUAD = "psycho-squad"; // Vanilla Units with power 4 and 6.
const PROGRAM = context.content.cards.find(c => c.type === "PROGRAM" && c.provenance.reviewed)!.id;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV32Input("batch-v32"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    // Trusted arrangement: the starting hands hold no Program, so each test's Programs are exactly the ones it places.
    const m = new TurnMutation(fund(clearField(state, context), context), context), atlus = context.content.cards.find(c => c.id === ATLUS)!;
    for (const p of Object.values(m.state.players)) for (const id of p.zones.HAND) { m.state.objects.cards[id].cardId = atlus.id; m.state.objects.cards[id].revision = atlus.revision; }
    return unwrap(validateState(m.state, context));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the player's last deck card becomes `cardId` in hand, or on the field with the given readiness and no lag. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "READY" | "SPENT") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    if (where !== "HAND") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = where; c.statuses = []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Places each card in order and returns the state and their ids. */
function place(s: GameState, cards: [string, PlayerId, "HAND" | "READY" | "SPENT"][]) {
    const ids: CardInstanceId[] = [];
    for (const [cardId, player, where] of cards) { const placed = put(s, cardId, player, where); s = placed.state; ids.push(placed.id); }
    return { state: s, ids };
}
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const card = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);
const decline = (s: GameState) => pick(s, context, o => o.kind === "MODE" && o.mode === "DONE");
/** Placide, ready on the field, attacks `target` (the rival Gig area when omitted). */
function attack(prepared: GameState, target?: CardInstanceId) {
    const unit = put(prepared, PLACIDE, actor, "READY");
    let r = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id);
    const events = [...r.events];
    if (r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) {
        r = pick(r.state, context, o => o.kind === "ATTACK_TARGET" && (target ? o.target.kind === "CARD" && o.target.cardInstanceId === target : o.target.kind === "GIG_AREA"));
        events.push(...r.events);
    }
    return { state: r.state, events, placideId: unit.id };
}
const inRivalDeck = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone === "DECK" && s.objects.cards[id].face === "DOWN" && s.players[rival].zones.DECK.includes(id);

test("the V32 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(placide.provenance.sourceHash, hashCanonical(v32Source(placide.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === placide.id), [placide]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Placide: Voodoo Sentinel passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(placide, context).ok); assert.ok(supportsPlay(placide, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(placide) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no attack ability", d => { d.mechanics.abilities = [d.mechanics.abilities[0]]; }],
        ["no play ability", d => { d.mechanics.abilities = [d.mechanics.abilities[1]]; }],
        ["abilities reordered", d => { d.mechanics.abilities = [d.mechanics.abilities[1], d.mechanics.abilities[0]]; }],
        ["defeated trigger", d => { d.mechanics.abilities[1].trigger = "WHEN_DEFEATED"; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 7 }; }],
        ["power", d => { d.power = 9; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("{Play} offers only own-hand Programs; one discarded, a chosen rival Unit is bottom-decked", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [PROGRAM, actor, "HAND"], [ATLUS, actor, "HAND"], [ATLUS, rival, "READY"], [SQUAD, rival, "SPENT"], [PLACIDE, actor, "HAND"]]);
    const [p1, p2, unitInHand, x, y] = a.ids;
    let s = playCard(a.state, context, PLACIDE).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(cards(s), [p1, p2].sort(), "a Unit in hand is never offered");
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "MODE" && o.mode === "DONE"), "\"you may\": declining is offered");
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: unitInHand });
    assert.equal(validateState(forged, context).ok, false);
    s = card(s, p2).state;
    assert.equal(s.objects.cards[p2].zone.zone, "TRASH"); assert.equal(s.objects.cards[p1].zone.zone, "HAND");
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.deepEqual(cards(s), [x, y].sort(), "any rival Unit, ready or spent");
    assert.deepEqual(s.resolution.triggerContinuation!.discardedPrograms, [p2]);
    const skipped = GameStateSchema.parse(s); delete skipped.resolution.triggerContinuation!.discardedPrograms;
    assert.equal(validateState(skipped, context).ok, false, "the bottom-deck needs its discarded Program");
    const unpaid = GameStateSchema.parse(s); unpaid.resolution.triggerContinuation!.discardedPrograms = [p1];
    assert.equal(validateState(unpaid, context).ok, false, "a Program still in hand was not discarded");
    const done = card(s, y);
    assert.ok(inRivalDeck(done.state, y)); assert.equal(done.state.objects.cards[x].zone.zone, "BATTLEFIELD");
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.resolution.triggerContinuation, undefined);
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_RESOLVED"));
});

test("declining discards nothing; with no Program in hand nothing is offered; a single rival Unit is forced", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [ATLUS, rival, "READY"], [PLACIDE, actor, "HAND"]]), [p, x] = a.ids;
    const declined = decline(playCard(a.state, context, PLACIDE).state);
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(declined.state.objects.cards[p].zone.zone, "HAND"); assert.equal(declined.state.objects.cards[x].zone.zone, "BATTLEFIELD");
    assert.equal(declined.state.timing.step, "MAIN");
    const forced = card(playCard(a.state, context, PLACIDE).state, p);
    assert.ok(inRivalDeck(forced.state, x)); assert.equal(forced.state.timing.step, "MAIN");
    assert.ok(forced.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.forced === true));
    const none = place(base, [[ATLUS, actor, "HAND"], [ATLUS, rival, "READY"], [PLACIDE, actor, "HAND"]]);
    const played = playCard(none.state, context, PLACIDE);
    assert.equal(played.state.timing.step, "MAIN"); assert.equal(played.state.objects.cards[none.ids[1]].zone.zone, "BATTLEFIELD");
    assert.equal(played.events.some(e => e.payload.kind === "CARD_DISCARDED"), false);
});

test("with no rival Unit the Program may still be discarded, and nothing is bottom-decked", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [PLACIDE, actor, "HAND"]]);
    const s = playCard(a.state, context, PLACIDE).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION");
    const done = card(s, a.ids[0]).state;
    assert.equal(done.objects.cards[a.ids[0]].zone.zone, "TRASH"); assert.equal(done.timing.step, "MAIN");
});

test("{Attack} discards and bottom-decks before the React window; bottom-decking the attacked Unit ends the attack", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [PROGRAM, actor, "HAND"], [ATLUS, rival, "READY"], [SQUAD, rival, "SPENT"]]), [p1, p2, x, y] = a.ids;
    let s = attack(a.state, y).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION");
    s = card(s, p1).state;
    assert.deepEqual(cards(s), [x, y].sort());
    const kept = card(s, x).state;
    assert.ok(inRivalDeck(kept, x)); assert.equal(kept.timing.step, "RIVAL_REACT", "the attack on the other Unit goes on");
    const ended = card(card(attack(a.state, y).state, p2).state, y);
    assert.ok(inRivalDeck(ended.state, y));
    assert.ok(ended.events.some(e => e.payload.kind === "ATTACK_ENDED" && e.payload.reason === "TARGET_INVALID"));
    assert.equal(ended.state.timing.step, "MAIN");
});

test("the reviewed union admits the V32 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PLACIDE));
});
