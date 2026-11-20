import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV33Cards, batchV33Context, batchV33Input, v33Source, MAMAN } from "./api-admission-batch-v33-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV33Context();
const maman = batchV33Cards[0];
const ATLUS = "emergency-atlus", SQUAD = "psycho-squad", MANTIS = "mantis-blades"; // Vanilla Units with power 4 and 6, and a Gear.
const PROGRAM = context.content.cards.find(c => c.type === "PROGRAM" && c.provenance.reviewed)!.id;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV33Input("batch-v33"), context)).state;
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
/** Trusted arrangement: a Mantis Blades from the host controller's deck is equipped to `host`. */
function equip(s: GameState, host: CardInstanceId) {
    const placed = put(s, MANTIS, s.objects.cards[host].controllerId, "HAND"), m = new TurnMutation(placed.state, context);
    unwrap(attachPlayedGear(m, placed.id, host));
    return { state: unwrap(validateState(m.state, context)), id: placed.id };
}
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const card = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);
const inRivalDeck = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone === "DECK" && s.objects.cards[id].face === "DOWN" && s.players[rival].zones.DECK.includes(id);

test("the V33 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(maman.provenance.sourceHash, hashCanonical(v33Source(maman.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === maman.id), [maman]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Maman Brigitte: Spirit of Death passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(maman, context).ok); assert.ok(supportsPlay(maman, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(maman) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const effect = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { count: number; then: { unequipped?: true } };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["one Program", d => { effect(d).count = 1; }],
        ["any rival Unit", d => { delete effect(d).then.unequipped; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["second ability", d => { d.mechanics.abilities.push({ ...d.mechanics.abilities[0], id: `${MAMAN}-again@1`, trigger: "WHEN_ATTACKING" }); }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 4; }],
        ["tags", d => { d.tags = ["Mystic"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("{Play} discards 2 chosen Programs, then offers only unequipped rival Units", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [PROGRAM, actor, "HAND"], [PROGRAM, actor, "HAND"], [ATLUS, rival, "READY"], [SQUAD, rival, "SPENT"], [ATLUS, rival, "SPENT"], [MAMAN, actor, "HAND"]]);
    const [p1, p2, p3, x, y, z] = a.ids, equipped = equip(a.state, z);
    let s = playCard(equipped.state, context, MAMAN).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.deepEqual(cards(s), [p1, p2, p3].sort());
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "MODE" && o.mode === "DONE"));
    s = card(s, p3).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION", "the second Program is chosen next");
    assert.deepEqual(cards(s), [p1, p2].sort());
    assert.equal(s.resolution.choice!.options.some(o => o.kind === "MODE"), false, "having discarded one, the controller discards both");
    const early = GameStateSchema.parse(s); early.resolution.triggerContinuation!.phase = "TARGET";
    assert.equal(validateState(early, context).ok, false, "the bottom-deck waits for both discards");
    s = card(s, p1).state;
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.deepEqual(cards(s), [x, y].sort(), "a Unit with Gear attached is never offered");
    assert.deepEqual(s.resolution.triggerContinuation!.discardedPrograms, [p3, p1]);
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: z });
    assert.equal(validateState(forged, context).ok, false);
    const done = card(s, y).state;
    assert.ok(inRivalDeck(done, y)); assert.equal(done.objects.cards[p2].zone.zone, "HAND");
    assert.equal(done.objects.cards[z].zone.zone, "BATTLEFIELD"); assert.equal(done.timing.step, "MAIN");
});

test("one Program in hand cannot pay for 2: nothing is offered", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [ATLUS, rival, "READY"], [MAMAN, actor, "HAND"]]);
    const played = playCard(a.state, context, MAMAN);
    assert.equal(played.state.timing.step, "MAIN");
    assert.equal(played.state.objects.cards[a.ids[0]].zone.zone, "HAND"); assert.equal(played.state.objects.cards[a.ids[1]].zone.zone, "BATTLEFIELD");
});

test("with exactly 2 Programs the second discard is forced; an only unequipped rival Unit is bottom-decked without a choice", () => {
    const a = place(base, [[PROGRAM, actor, "HAND"], [PROGRAM, actor, "HAND"], [ATLUS, rival, "READY"], [SQUAD, rival, "READY"], [MAMAN, actor, "HAND"]]);
    const [p1, p2, x, y] = a.ids, equipped = equip(a.state, y);
    const done = card(playCard(equipped.state, context, MAMAN).state, p2);
    assert.equal(done.state.objects.cards[p1].zone.zone, "TRASH"); assert.equal(done.state.objects.cards[p2].zone.zone, "TRASH");
    assert.equal(done.events.filter(e => e.payload.kind === "CARD_DISCARDED").length, 2);
    assert.ok(inRivalDeck(done.state, x)); assert.equal(done.state.objects.cards[y].zone.zone, "BATTLEFIELD");
    assert.equal(done.state.timing.step, "MAIN");
    const declined = pick(playCard(equipped.state, context, MAMAN).state, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.equal(declined.objects.cards[p1].zone.zone, "HAND"); assert.equal(declined.objects.cards[x].zone.zone, "BATTLEFIELD");
});

test("the reviewed union admits the V33 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === MAMAN));
});
