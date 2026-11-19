import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, observe, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPinnedPlayUnit } from "../packages/engine/src/play-pin-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { stealableGigsFor } from "../packages/engine/src/combat-outcome-queries";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV21Cards, batchV21Context, batchV21Input, v21Source, FANG, WESTBROOK } from "./api-admission-batch-v21-fixture";
import { ENDER } from "./api-admission-batch-v18-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { playCard, pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV21Context();
const card = (id: string) => batchV21Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV21Input("batch-v21"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plain = (c: CardRevisionSnapshot) => c.schemaVersion === 2 && c.type === "UNIT" && supportsPlay(c, context).ok && !c.mechanics.keywords.length && !c.mechanics.modifiers.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length && (c.power ?? 0) > 0 && (c.power ?? 0) < 10;
const attacker = context.content.cards.filter(c => plain(c as CardRevisionSnapshot)).sort((a, b) => a.power! - b.power! || (a.id < b.id ? -1 : 1))[0];
const ender = context.content.cards.find(c => c.id === ENDER)!;

/** Trusted arrangement: the bottom deck card of `player` rewritten as `cardId` and moved to hand or, ready and not lagging, to the field. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "BATTLEFIELD") {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, where);
    if (where === "BATTLEFIELD") { c.readiness = "READY"; c.statuses = []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: `player`'s Gig area holds exactly `values` (ids returned in the same order), the largest value on the largest
 * non-d20 die; every other die waits in its fixer area. */
function gigs(s: GameState, player: PlayerId, values: number[]) {
    const d = GameStateSchema.parse(s), faces = (g: { dieType: string }) => Number(g.dieType.slice(1));
    const dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
    const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]), assigned = new Map(order.map((vi, k) => [dice[k].id, vi]));
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const ids: GigInstanceId[] = [];
    for (const g of Object.values(d.objects.gigs)) {
        const vi = assigned.get(g.id), value = vi === undefined ? undefined : values[vi];
        assert.ok(value === undefined || value <= faces(g), "each value fits its die");
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (vi !== undefined) ids[vi] = g.id;
    }
    return { state: unwrap(validateState(d, context)), ids };
}
/** End the actor's turn and reach the rival's Main phase. */
function toRivalMain(s: GameState) {
    let state = take(s, context, a => a.action.kind === "END_TURN").state;
    for (let n = 0; !(state.timing.activePlayer === rival && state.timing.step === "MAIN"); n++) { assert.ok(n < 20); state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state; }
    return state;
}
/** The rival attacks the actor's Gig area and the actor passes React; stops at a steal choice or back in Main. */
function attackGigs(s: GameState, attackerId: CardInstanceId) {
    let { state, events } = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attackerId);
    events = [...events];
    if (state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) { const next = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"); state = next.state; events.push(...next.events); }
    assert.equal(state.timing.step, "RIVAL_REACT");
    const pass = take(state, context, a => a.action.kind === "PASS_REACT");
    return { state: pass.state, events: [...events, ...pass.events] };
}
const stolen = (events: { payload: { kind: string } }[]) => events.flatMap(e => e.payload.kind === "GIG_STOLEN" ? [(e.payload as unknown as { gigInstanceId: string }).gigInstanceId] : []);
const gigOptions = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "GIG" ? [o.gigInstanceId] : []).sort();
/** Trusted arrangement: `player`'s first Legend becomes Ender, face up and ready, with 10 ready eddies (as in the V18 tests). */
function withEnder(s: GameState, player: PlayerId) {
    const m = new TurnMutation(s, context), id = m.state.players[player].zones.LEGENDS[0], c = m.state.objects.cards[id];
    c.cardId = ender.id; c.revision = ender.revision; c.face = "UP"; c.readiness = "READY";
    while (m.state.players[player].zones.EDDIES.length < 10) {
        const deck = m.state.players[player].zones.DECK, e = deck.map(x => m.state.objects.cards[x]).find(c => context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision)?.sellProfile.allowed)!;
        m.state.players[player].zones.DECK = deck.filter(x => x !== e.id); m.state.players[player].zones.EDDIES.push(e.id);
        e.zone = { playerId: player, zone: "EDDIES" }; e.face = "DOWN"; e.readiness = "READY";
    }
    for (const x of m.state.players[player].zones.EDDIES) m.state.objects.cards[x].readiness = "READY";
    return { state: unwrap(validateState(m.state, context)), id };
}
function goSolo(s: GameState, id: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === id).state;
    for (let n = 0; state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 30); const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); state = choose(state, context, i >= 0 ? i : 0).state; }
    return state;
}

test("V21 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV21Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v21Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.ok(attacker && attacker.power! < 9, "a plain reviewed Unit with a small power attacks in these tests");
});

test("each V21 card passes only its exact pin; any changed field is rejected", () => {
    for (const c of batchV21Cards) for (const gate of [supportsPinnedPlayUnit, supportsTriggerCard, supportsPlay]) assert.ok(gate(c, context).ok, `${c.id}: ${gate.name}`);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const swap = (d: CardRevisionSnapshot, patch: object) => { d.mechanics.abilities[0].effects = [{ ...d.mechanics.abilities[0].effects[0], ...patch }] as never; };
    const edits: [string, string, (d: CardRevisionSnapshot) => void][] = [
        [FANG, "Legend actor", d => swap(d, { actor: "LEGEND" })],
        [FANG, "below-power comparison", d => swap(d, { forbidden: "VALUE_BELOW_POWER" })],
        [FANG, "attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        [FANG, "second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        [FANG, "cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        [FANG, "power", d => { d.power = 5; }],
        [FANG, "tags", d => { d.tags = ["Ganger", "Netrunner"]; }],
        [FANG, "keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        [WESTBROOK, "Unit actor", d => swap(d, { actor: "UNIT" })],
        [WESTBROOK, "above-power comparison", d => swap(d, { forbidden: "VALUE_ABOVE_POWER" })],
        [WESTBROOK, "condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "STREET_CRED_GREATER_THAN_RIVAL" }] as never; }],
        [WESTBROOK, "color", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        [WESTBROOK, "sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        [WESTBROOK, "inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }]
    ];
    for (const [id, label, edit] of edits) { const f = forge(card(id), edit); assert.equal(supportsTriggerCard(f, context).ok, false, `${id}: ${label}`); assert.equal(supportsPinnedPlayUnit(f, context).ok, false, `${id}: ${label}`); }
});

test("Chrome Fang: until its controller's next turn, rival Units can't steal friendly Gigs with value higher than their power", () => {
    const p = attacker.power!;
    let s = put(base, attacker.id, rival, "BATTLEFIELD").state;
    const unitId = s.players[rival].zones.BATTLEFIELD[0];
    const played = playCard(put(s, FANG, actor, "HAND").state, context, FANG);
    s = played.state;
    assert.equal(s.resolution.choice, null, "no choice: the restriction applies at once");
    assert.deepEqual(s.gigStealRestrictions?.map(x => [x.actor, x.forbidden, x.protectedPlayerId, x.createdTurn]), [["UNIT", "VALUE_ABOVE_POWER", actor, s.timing.turn]]);
    assert.ok(played.events.some(e => e.payload.kind === "GIG_STEAL_RESTRICTED"));
    assert.deepEqual(unwrap(observe(s, rival, context)).gigStealRestrictions?.map(x => [x.actor, x.forbidden, x.createdTurn]), [["UNIT", "VALUE_ABOVE_POWER", s.timing.turn]], "the restriction is public");
    s = toRivalMain(s);
    assert.ok(s.gigStealRestrictions, "the restriction lasts through the rival's turn");
    const arranged = gigs(s, actor, [p - 1 || p, p, p + 1]);
    assert.deepEqual(stealableGigsFor(arranged.state, context, actor, unitId).map(g => g.id).sort(), arranged.ids.slice(0, 2).sort());
    const attack = attackGigs(arranged.state, unitId);
    assert.equal(attack.state.timing.step, "GIG_STEAL_SELECTION", "two permitted Gigs, one steal: a real choice");
    assert.deepEqual(gigOptions(attack.state), arranged.ids.slice(0, 2).sort(), "the Gig above the attacker's power is never offered (11.5.1.3)");
    const forged = GameStateSchema.parse(attack.state); forged.resolution.choice!.options.push({ kind: "GIG", gigInstanceId: arranged.ids[2] });
    assert.equal(validateState(forged, context).ok, false, "a restricted Gig cannot be offered");
    const done = pick(attack.state, context, o => o.kind === "GIG" && o.gigInstanceId === arranged.ids[1]);
    assert.deepEqual(stolen(done.events), [arranged.ids[1]], "a Gig equal to the attacker's power is not higher");
    assert.equal(done.state.objects.gigs[arranged.ids[1]].controllerId, rival);
    const next = take(done.state, context, a => a.action.kind === "END_TURN");
    assert.equal(next.state.timing.activePlayer, actor);
    assert.equal(next.state.gigStealRestrictions, undefined, "8.6.2.1: it ends at the start of its controller's next turn");
    assert.ok(next.events.some(e => e.payload.kind === "GIG_STEAL_RESTRICTION_EXPIRED"));
});

test("Chrome Fang: only higher Gigs means nothing is stolen, and a forged restriction is rejected", () => {
    let s = put(base, attacker.id, rival, "BATTLEFIELD").state;
    const unitId = s.players[rival].zones.BATTLEFIELD[0];
    s = toRivalMain(playCard(put(s, FANG, actor, "HAND").state, context, FANG).state);
    const arranged = gigs(s, actor, [attacker.power! + 1, attacker.power! + 2]);
    const attack = attackGigs(arranged.state, unitId);
    assert.equal(attack.state.timing.step, "MAIN");
    assert.deepEqual(stolen(attack.events), []);
    assert.ok(attack.events.some(e => e.payload.kind === "GIG_STEAL_STARTED" && (e.payload as { count: number }).count === 0));
    const forgeries: [string, (d: GameState & { gigStealRestrictions?: { createdTurn: number; protectedPlayerId: PlayerId; actor: string }[] }) => void][] = [
        ["created on the rival's turn", d => { d.gigStealRestrictions![0].createdTurn += 1; }],
        ["protecting the rival", d => { d.gigStealRestrictions![0].protectedPlayerId = rival; }],
        ["against Legends", d => { d.gigStealRestrictions![0].actor = "LEGEND"; }],
        ["stale", d => { d.gigStealRestrictions![0].createdTurn -= 2; }]
    ];
    for (const [label, edit] of forgeries) { const d = GameStateSchema.parse(arranged.state); edit(d as never); assert.equal(validateState(d, context).ok, false, label); }
});

test("Westbrook Netrunner: rival Legends can't steal friendly Gigs with value less than their power, even after it leaves the field", () => {
    let s = put(base, attacker.id, rival, "BATTLEFIELD").state;
    const unitId = s.players[rival].zones.BATTLEFIELD[0];
    s = playCard(put(s, WESTBROOK, actor, "HAND").state, context, WESTBROOK).state;
    const westbrook = Object.values(s.objects.cards).find(c => c.cardId === WESTBROOK && c.zone.zone === "BATTLEFIELD")!.id;
    s = toRivalMain(s);
    const e = withEnder(s, rival);
    s = goSolo(e.state, e.id);
    assert.equal(s.objects.cards[westbrook].zone.zone, "TRASH", "Ender's [Play] defeated Westbrook Netrunner");
    assert.ok(s.gigStealRestrictions, "the restriction does not depend on its source staying on the field");
    const power = ender.power!;
    const arranged = gigs(s, actor, [power - 1, power, power + 1]);
    assert.deepEqual(stealableGigsFor(arranged.state, context, actor, unitId).map(g => g.id).sort(), [...arranged.ids].sort(), "a rival Unit that is not a Legend is unaffected");
    const attack = attackGigs(arranged.state, e.id);
    assert.equal(attack.state.timing.step, "GIG_STEAL_SELECTION");
    assert.deepEqual(gigOptions(attack.state), arranged.ids.slice(1).sort(), "the Gig below the Legend's power is never offered");
    const done = pick(attack.state, context, o => o.kind === "GIG" && o.gigInstanceId === arranged.ids[1]);
    assert.deepEqual(stolen(done.events), [arranged.ids[1]], "a Gig equal to the Legend's power is not less");
});

test("Chrome Fang also restricts a field Legend, which is a Unit there", () => {
    let s = toRivalMain(playCard(put(base, FANG, actor, "HAND").state, context, FANG).state);
    const e = withEnder(s, rival);
    s = goSolo(e.state, e.id);
    const power = ender.power!, arranged = gigs(s, actor, [power, power + 1]);
    assert.deepEqual(stealableGigsFor(arranged.state, context, actor, e.id).map(g => g.id), [arranged.ids[0]]);
});

test("V21 cards are members of the reviewed union", () => {
    const union = reviewedUnionContext();
    for (const c of batchV21Cards) assert.ok(union.content.cards.some(u => u.id === c.id && u.revision === c.revision), c.id);
});
