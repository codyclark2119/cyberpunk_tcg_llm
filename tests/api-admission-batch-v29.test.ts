import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV29Cards, batchV29Context, batchV29Input, v29Source, PEPE } from "./api-admission-batch-v29-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV29Context();
const pepe = batchV29Cards[0];
// Merc Legends with no attack trigger, and a non-Merc Legend.
const V = "v-corporate-exile", ENDER = "adam-smasher-ender-of-legends", GORO = "goro-takemura-hands-unclean";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV29Input("batch-v29"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the actor's Legends become `cards` in slot order, face up and spent; the rest stay face down. */
function legends(s: GameState, cards: string[]) {
    const m = new TurnMutation(s, context), ids = m.state.players[actor].zones.LEGENDS.slice(0, cards.length);
    ids.forEach((id, i) => { const c = m.state.objects.cards[id], r = context.content.cards.find(r => r.id === cards[i])!; c.cardId = r.id; c.revision = r.revision; c.face = "UP"; c.readiness = "SPENT"; });
    return { state: unwrap(validateState(m.state, context)), ids };
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
/** Pepe, ready on the field, attacks the rival Gig area. */
function attack(prepared: GameState) {
    const m = new TurnMutation(prepared, context), r = context.content.cards.find(c => c.id === PEPE)!, deck = m.state.players[actor].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = "READY"; c.statuses = [];
    let next = take(unwrap(validateState(m.state, context)), context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === c.id);
    const events = [...next.events];
    if (next.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) { next = pick(next.state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"); events.push(...next.events); }
    return { state: next.state, events };
}
const PAIR = [{ player: actor, die: "D4", value: 3 }, { player: actor, die: "D6", value: 3 }, { player: rival, die: "D8", value: 5 }];
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const done = (s: GameState) => pick(s, context, o => o.kind === "MODE" && o.mode === "DONE");
const ready = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);

test("the V29 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(pepe.provenance.sourceHash, hashCanonical(v29Source(pepe.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === pepe.id), [pepe]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Pepe Najarro: Working Doubles passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(pepe, context).ok); assert.ok(supportsPlay(pepe, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(pepe) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["play trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["any Legend, unconditionally", d => { d.mechanics.abilities[0].effects = [{ kind: "READY_UNIT", target: { kind: "FRIENDLY_FACE_UP_LEGEND" } }]; }],
        ["condition at trigger time", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["second ability", d => { d.mechanics.abilities.push({ ...d.mechanics.abilities[0], id: `${PEPE}-again@1` }); }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["power", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("with a value-pair it offers only face-up MERC Legends, readies up to 2, then the attack goes on", () => {
    const placed = legends(gigs(base, PAIR), [V, ENDER, GORO]), [v, ender, goro] = placed.ids;
    let s = attack(placed.state).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(cards(s), [v, ender].sort(), "a non-MERC Legend is never offered");
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "MODE" && o.mode === "DONE"), "\"up to\": the controller may stop");
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: goro });
    assert.equal(validateState(forged, context).ok, false);
    s = ready(s, v).state;
    assert.equal(s.objects.cards[v].readiness, "READY");
    assert.deepEqual(cards(s), [ender], "a chosen Legend is not offered again");
    const held = GameStateSchema.parse(s); held.resolution.triggerContinuation!.readiedLegends = [goro];
    assert.equal(validateState(held, context).ok, false, "only an eligible Legend can be held as chosen");
    s = ready(s, ender).state;
    assert.equal(s.objects.cards[ender].readiness, "READY"); assert.equal(s.objects.cards[goro].readiness, "SPENT");
    assert.equal(s.timing.step, "RIVAL_REACT");
    assert.equal(s.resolution.triggerContinuation, undefined);
});

test("the controller may stop after one Legend or ready none", () => {
    const placed = legends(gigs(base, PAIR), [V, ENDER]), [v, ender] = placed.ids;
    const one = done(ready(attack(placed.state).state, v).state).state;
    assert.equal(one.objects.cards[v].readiness, "READY"); assert.equal(one.objects.cards[ender].readiness, "SPENT");
    assert.equal(one.timing.step, "RIVAL_REACT");
    const none = done(attack(placed.state).state).state;
    assert.equal(none.objects.cards[v].readiness, "SPENT"); assert.equal(none.objects.cards[ender].readiness, "SPENT");
});

test("without a friendly value-pair nothing is offered; a rival's matching Gig does not make a pair", () => {
    const placed = legends(gigs(base, [{ player: actor, die: "D4", value: 3 }, { player: actor, die: "D6", value: 4 }, { player: rival, die: "D8", value: 3 }]), [V]);
    const r = attack(placed.state);
    assert.ok(r.events.some(e => e.payload.kind === "EFFECT_PENDING"), "the trigger is pending; the condition is checked on resolution (10.16.1.1)");
    assert.ok(r.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === false));
    assert.equal(r.state.timing.step, "RIVAL_REACT");
    assert.equal(r.state.objects.cards[placed.ids[0]].readiness, "SPENT");
});

test("a single MERC Legend completes the effect once it is chosen", () => {
    const placed = legends(gigs(base, PAIR), [V, GORO]), [v] = placed.ids;
    const s = attack(placed.state).state;
    assert.deepEqual(cards(s), [v]);
    const after = ready(s, v).state;
    assert.equal(after.objects.cards[v].readiness, "READY");
    assert.equal(after.timing.step, "RIVAL_REACT");
});

test("the reviewed union admits the V29 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PEPE));
});
