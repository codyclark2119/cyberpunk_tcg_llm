import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV13Cards, batchV13Context, batchV13Input, v13Source, SCREW } from "./api-admission-batch-v13-fixture";
import { AFTERMATH } from "./api-admission-batch-v12-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { playCard, pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV13Context();
const screw = batchV13Cards.find(c => c.id === SCREW)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV13Input("batch-v13"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plainUnits = context.content.cards.filter(c => c.schemaVersion === 2 && c.type === "UNIT" && c.id !== SCREW && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length).map(c => c.id);
/** Trusted arrangement: rewrites the player's last deck card as `cardId` in hand (decks here hold no spare slice cards). */
function put(s: GameState, cardId: string, player: PlayerId) {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Moves `count` plain reviewed Units into `player`'s trash and returns their ids. */
function trash(s: GameState, player: PlayerId, count: number) {
    let state = s; const ids: CardInstanceId[] = [];
    for (let i = 0; i < count; i++) {
        const placed = put(state, plainUnits[i % plainUnits.length], player), m = new TurnMutation(placed.state, context);
        moveCardLocation(m, placed.id, "TRASH"); state = unwrap(validateState(m.state, context)); ids.push(placed.id);
    }
    return { state, ids };
}
const zone = (s: GameState, id: string) => s.objects.cards[id as CardInstanceId].zone.zone;
const optionIds = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
/** Screw on the actor's field, then Live with the Aftermath makes the actor defeat it (the only own Unit). */
function defeatScrew(s: GameState) {
    const placed = put(s, SCREW, actor), m = new TurnMutation(placed.state, context);
    moveCardLocation(m, placed.id, "BATTLEFIELD"); m.state.objects.cards[placed.id].readiness = "READY"; m.state.objects.cards[placed.id].statuses = [];
    const fielded = unwrap(validateState(m.state, context));
    return { ...playCard(put(fielded, AFTERMATH, actor).state, context, AFTERMATH), screwId: placed.id };
}

test("V13 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV13Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v13Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(screw.rulesText, "{Defeated} Add another Unit from your trash to your hand.");
});

test("Screw passes only its own exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(screw, context).ok); assert.ok(supportsPlay(screw, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(screw) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const edits: [string, (d: CardRevisionSnapshot) => void][] = [
        ["played trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 8; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }]
    ];
    for (const [label, edit] of edits) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("defeated Screw returns a chosen other Unit from its controller's trash, never itself or a rival's", () => {
    const own = trash(base, actor, 2), theirs = trash(own.state, rival, 1);
    const d = defeatScrew(theirs.state);
    assert.equal(zone(d.state, d.screwId), "TRASH");
    assert.equal(d.state.timing.step, "TARGET_SELECTION");
    assert.equal(d.state.resolution.choice!.actorId, actor);
    assert.deepEqual(optionIds(d.state), [...own.ids].sort(), "only the controller's other trash Units");
    const forged = GameStateSchema.parse(d.state);
    forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: d.screwId });
    assert.equal(validateState(forged, context).ok, false, "Screw cannot offer itself");
    const done = pick(d.state, context, o => o.kind === "CARD" && o.cardInstanceId === own.ids[1]);
    assert.deepEqual([zone(done.state, own.ids[0]), zone(done.state, own.ids[1]), zone(done.state, d.screwId), zone(done.state, theirs.ids[0])], ["TRASH", "HAND", "TRASH", "TRASH"]);
    assert.equal(done.state.objects.cards[own.ids[1]].face, "DOWN");
    assert.equal(done.state.resolution.choice, null);
    assert.ok(done.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === own.ids[1]));
});

test("one other trash Unit is returned automatically; with none, nothing happens", () => {
    const one = trash(base, actor, 1), d = defeatScrew(one.state);
    assert.equal(d.state.resolution.choice, null);
    assert.equal(zone(d.state, one.ids[0]), "HAND");
    assert.equal(zone(d.state, d.screwId), "TRASH", "Screw is not 'another Unit'");
    const none = defeatScrew(trash(base, rival, 1).state);
    assert.equal(none.state.resolution.choice, null);
    assert.equal(zone(none.state, none.screwId), "TRASH");
    assert.equal(none.state.players[actor].zones.HAND.length, base.players[actor].zones.HAND.length);
});

test("the reviewed union admits the V13 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === SCREW));
});
