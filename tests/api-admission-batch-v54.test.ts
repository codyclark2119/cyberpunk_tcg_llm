import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { supportsModalProgram } from "../packages/engine/src/modal-program-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV54Cards, batchV54Context, batchV54Input, v54Source, TOWERFALL } from "./api-admission-batch-v54-fixture";
import { MISTY } from "./api-admission-batch-v42-fixture";
import { ZEALOTS } from "./api-admission-batch-v51-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV54Context();
const towerfall = batchV54Cards[0];
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad"; // Vanilla Units, power 4 and 6; Misty and Maelstrom Zealots have power 0.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV54Input("batch-v54"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Towerfall in the actor's hand; each listed card on the rival's field; the actor's d4 rolled to `mine`
 * and the rival's to `theirs` (Street Cred is their sum); every other Gig waits in its fixer area. */
function arrange(rivalUnits: string[], mine: number, theirs: number) {
    const m = new TurnMutation(base, context), ids: CardInstanceId[] = [];
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(actor, TOWERFALL);
    for (const cardId of rivalUnits) { const c = rewrite(rival, cardId); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = []; ids.push(c.id); }
    const d = GameStateSchema.parse(m.state);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs)) {
        const rolled = g.dieType === "D4";
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: g.ownerId === actor ? mine : theirs } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids };
}
function pay(s: GameState) {
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 30); s = choose(s, context, 0).state; }
    return s;
}
const play = (s: GameState) => { const r = playCard(s, context, TOWERFALL); return { ...r, state: pay(r.state) }; };
const mode = (s: GameState, kind: string) => pick(s, context, o => o.kind === "MODE" && o.mode === kind);
const met = (events: { payload: { kind: string; met?: boolean } }[]) => events.filter(e => e.payload.kind === "CONDITION_EVALUATED").map(e => e.payload.met);
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;

const power = (s: GameState, id: CardInstanceId) => effectivePower(s, id, context);
const settled = (s: GameState) => s.timing.step === "MAIN" && !s.resolution.playContinuation;

test("the V54 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(towerfall.provenance.sourceHash, hashCanonical(v54Source(towerfall.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === towerfall.id), [towerfall]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Towerfall passes only its exact pin; any changed field is rejected, and no other gate reads a modal ability", () => {
    for (const gate of [supportsPlay, supportsModalProgram]) assert.ok(gate(towerfall, context).ok);
    assert.equal(supportsTriggerCard(towerfall, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(towerfall) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not modal", d => { delete d.mechanics.abilities[0].choose; }],
        ["other condition", d => { d.mechanics.abilities[0].choose = { count: 1, allInstead: { kind: "CONTROLS_VALUE_PAIR" } }; }],
        ["one rival Unit", d => { d.mechanics.abilities[0].effects[0] = { kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -5 }; }],
        ["one bottom-deck", d => { d.mechanics.abilities[0].effects[1] = { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", power: 0 } }; }],
        ["-4 power", d => { d.mechanics.abilities[0].effects[0] = { kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "ALL_RIVAL_UNITS" }, amount: -4 }; }],
        ["swapped modes", d => { d.mechanics.abilities[0].effects.reverse(); }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsModalProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
    // Pyramid Song's single-target shape cannot borrow Towerfall's all-target primitives.
    assert.equal(supportsModalProgram(forge(d => { d.printedCost = { kind: "EDDIES", amount: 3 }; d.ram = { BLUE: 3 }; }), context).ok, false);
});

test("equal Street Cred, power mode: every rival Unit gets -5 this turn with no target choice", () => {
    const a = arrange([ATLUS, PSYCHO, MISTY], 2, 2), [atlus, psycho, misty] = a.ids;
    const played = play(a.state);
    assert.deepEqual(met(played.events), [false]);
    const done = mode(played.state, "POWER_UNTIL_END_OF_TURN");
    assert.ok(settled(done.state));
    assert.deepEqual([power(done.state, atlus), power(done.state, psycho), power(done.state, misty)], [-1, 1, -5]);
    assert.equal(done.state.temporaryModifiers?.length, 3);
    for (const id of a.ids) assert.equal(zone(done.state, id), "BATTLEFIELD");
});

test("equal Street Cred, bottom-deck mode: every rival power-0 Unit leaves at once; others stay", () => {
    const a = arrange([ATLUS, MISTY, ZEALOTS], 3, 3), [atlus, misty, zealots] = a.ids;
    const done = mode(play(a.state).state, "BOTTOM_DECK_UNIT");
    assert.ok(settled(done.state));
    assert.equal(zone(done.state, atlus), "BATTLEFIELD"); assert.equal(zone(done.state, misty), "DECK"); assert.equal(zone(done.state, zealots), "DECK");
    assert.deepEqual([...done.state.players[rival].zones.DECK.slice(-2)].sort(), [misty, zealots].sort(), "both on the bottom of their owner's deck");
    assert.equal(done.events.filter(e => e.payload.kind === "CARD_TARGET_SELECTED").length, 2);
});

test("less Street Cred: both effects, in order; the -5 makes stronger Units power 0 before the bottom-deck", () => {
    const a = arrange([ATLUS, PSYCHO, MISTY], 1, 4), [atlus, psycho, misty] = a.ids;
    const done = play(a.state);
    assert.deepEqual(met(done.events), [true]);
    assert.ok(settled(done.state), "no mode choice and no target choice");
    assert.equal(zone(done.state, atlus), "DECK", "power 4 - 5 counts as 0"); assert.equal(zone(done.state, misty), "DECK"); assert.equal(zone(done.state, psycho), "BATTLEFIELD");
    assert.equal(power(done.state, psycho), 1);
    assert.deepEqual(done.state.temporaryModifiers?.map(x => x.targetId), [psycho], "bottom-decked Units' modifiers expire");
});

test("forged all-rival modifiers are rejected", () => {
    const a = arrange([ATLUS, PSYCHO], 2, 2);
    const done = mode(play(a.state).state, "POWER_UNTIL_END_OF_TURN").state;
    const dup = GameStateSchema.parse(structuredClone(done)); dup.temporaryModifiers![1] = { ...dup.temporaryModifiers![1], targetId: dup.temporaryModifiers![0].targetId };
    assert.equal(validateState(dup, context).ok, false, "one modifier per target");
    const friendly = GameStateSchema.parse(structuredClone(done)); const own = Object.values(friendly.objects.cards).find(c => c.controllerId === actor && c.zone.zone === "HAND")!;
    friendly.temporaryModifiers![0] = { ...friendly.temporaryModifiers![0], targetId: own.id };
    assert.equal(validateState(friendly, context).ok, false, "rival public Units only");
});

test("the reviewed union contains Towerfall", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === TOWERFALL));
});
