import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV61Cards, batchV61Context, batchV61Input, v61Source, MUAMAR } from "./api-admission-batch-v61-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV61Context();
const muamar = batchV61Cards[0];
const OCTANT = "octant", PSYCHO = "psycho-squad"; // Power 8 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV61Input("batch-v61"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function withMuamar(s: GameState, face: "UP" | "DOWN") {
    const d = GameStateSchema.parse(structuredClone(s)), zone = d.players[actor].zones.LEGENDS, id = zone[zone.length - 1], c = d.objects.cards[id];
    c.cardId = muamar.id; c.revision = muamar.revision; c.face = face; c.readiness = "READY";
    return { state: unwrap(validateState(d, context)), id };
}
function put(s: GameState, cardId: string, player: PlayerId, spent = false) {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = spent ? "SPENT" : "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
function callImmunity(s: GameState, id: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === id);
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 10); r = choose(r.state, context, 0); }
    assert.ok(validateState(r.state, context).ok);
    return pick(r.state, context, o => o.kind === "MODE" && o.mode === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN").state;
}
function fight(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker);
    if (r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) r = pick(r.state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target);
    const events = [...r.events];
    for (let n = 0; !(r.state.timing.step === "MAIN" && r.state.timing.combat.stage === "NONE"); n++) {
        assert.ok(n < 40); assert.ok(validateState(r.state, context).ok);
        r = r.state.timing.step === "RIVAL_REACT" ? take(r.state, context, a => a.action.kind === "PASS_REACT") : choose(r.state, context, 0); events.push(...r.events);
    }
    return { state: r.state, events };
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;

test("the V61 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(muamar.provenance.sourceHash, hashCanonical(v61Source(muamar.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === muamar.id), [muamar]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Muamar passes only its exact pin; it is Called through that pin and never played", () => {
    for (const gate of [supportsCall, supportsLegendSpendCard]) assert.ok(gate(muamar, context).ok);
    assert.equal(supportsPlay(muamar, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(muamar) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no choice", d => { delete d.mechanics.abilities[0].choose; }],
        ["draw 2", d => { d.mechanics.abilities[0].effects[1] = { kind: "DRAW", count: 2 }; }],
        ["directional", d => { const e = d.mechanics.abilities[1].effects[0]; if (e.kind === "ADJUST_GIG_UP_TO") e.direction = "INCREASE"; }],
        ["adjust 2", d => { const e = d.mechanics.abilities[1].effects[0]; if (e.kind === "ADJUST_GIG_UP_TO") e.maximum = 2; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsCall, supportsLegendSpendCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the immune Unit still loses its fight but is not defeated by it, all turn", () => {
    const mine = put(base, PSYCHO, actor), theirs = put(mine.state, OCTANT, rival, true), m = withMuamar(theirs.state, "DOWN");
    const plain = fight(m.state, mine.id, theirs.id);
    assert.equal(zone(plain.state, mine.id), "TRASH", "control: 6 loses to 8");
    const immune = callImmunity(m.state, m.id);
    assert.deepEqual(immune.fightDefeatImmunities?.map(x => x.targetId), [mine.id], "the lone friendly Unit is chosen without a choice");
    const done = fight(immune, mine.id, theirs.id);
    const result = done.events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload as unknown as { loserIds: string[] };
    assert.deepEqual(result.loserIds, [mine.id], "it still loses");
    assert.equal(zone(done.state, mine.id), "BATTLEFIELD"); assert.equal(zone(done.state, theirs.id), "BATTLEFIELD");
    const ended = take(done.state, context, a => a.action.kind === "END_TURN").state;
    assert.equal(ended.fightDefeatImmunities, undefined, "this turn only");
});

test("with two friendly Units the controller chooses one; forged immunities are rejected", () => {
    const a = put(base, PSYCHO, actor), b = put(a.state, OCTANT, actor), theirs = put(b.state, OCTANT, rival), m = withMuamar(theirs.state, "DOWN");
    let s = callImmunity(m.state, m.id);
    assert.equal(s.resolution.choice?.options.length, 2); assert.ok(validateState(s, context).ok);
    s = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === b.id).state;
    assert.deepEqual(s.fightDefeatImmunities?.map(x => x.targetId), [b.id]);
    const rivalTarget = GameStateSchema.parse(structuredClone(s)); rivalTarget.fightDefeatImmunities![0].targetId = theirs.id;
    assert.equal(validateState(rivalTarget, context).ok, false, "a friendly field Unit only");
    const stale = GameStateSchema.parse(structuredClone(s)); stale.fightDefeatImmunities![0].createdTurn = s.timing.turn + 1;
    assert.equal(validateState(stale, context).ok, false, "this turn only");
    const mv = new TurnMutation(s, context); moveCardLocation(mv, b.id, "TRASH");
    assert.equal(mv.state.fightDefeatImmunities, undefined, "it ends when the Unit leaves the field");
});

test("{Spend} adjusts a chosen Gig by 1 either way, or keeps it", () => {
    const m = withMuamar(base, "UP"), gig = base.players[actor].gigs.GIGS[0];
    let s = take(m.state, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === m.id).state;
    assert.ok(validateState(s, context).ok);
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === gig).state;
    assert.ok(validateState(s, context).ok);
    assert.ok(s.resolution.choice?.options.some(o => o.kind === "MODE" && o.mode === "KEEP"));
    const before = base.objects.gigs[gig].roll, kept = pick(s, context, o => o.kind === "MODE" && o.mode === "KEEP").state;
    assert.deepEqual(kept.objects.gigs[gig].roll, before); assert.equal(kept.objects.cards[m.id].readiness, "SPENT"); assert.equal(kept.timing.step, "MAIN");
});

test("the reviewed union contains Muamar Reyes", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === MUAMAR));
});
