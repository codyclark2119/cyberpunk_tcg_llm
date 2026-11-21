import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV62Cards, batchV62Context, batchV62Input, v62Source, PADRE } from "./api-admission-batch-v62-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV62Context();
const padre = batchV62Cards[0];
const OCTANT = "octant", PSYCHO = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV62Input("batch-v62"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function withPadre(s: GameState, face: "UP" | "DOWN") {
    const d = GameStateSchema.parse(structuredClone(s)), zone = d.players[actor].zones.LEGENDS, id = zone[zone.length - 1], c = d.objects.cards[id];
    c.cardId = padre.id; c.revision = padre.revision; c.face = face; c.readiness = "READY";
    return { state: unwrap(validateState(d, context)), id };
}
function put(s: GameState, cardId: string, player: PlayerId) {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: each player's Gig area holds exactly the listed values (d6 and up), other dice in the fixer. */
function gigs(s: GameState, values: Record<PlayerId, number[]>) {
    const d = GameStateSchema.parse(structuredClone(s)), faces = (g: { dieType: string }) => Number(g.dieType.slice(1)), ids: Record<PlayerId, GigInstanceId[]> = {};
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const player of d.match.playerOrder) {
        const want = values[player] ?? [], dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
        ids[player] = [];
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === player)) {
            const k = dice.indexOf(g), value = k >= 0 && k < want.length ? want[k] : undefined;
            g.controllerId = player; g.location = { playerId: player, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[player].gigs[g.location.zone].push(g.id);
            if (value !== undefined) ids[player][k] = g.id;
        }
    }
    return { state: unwrap(validateState(d, context)), ids };
}
const value = (s: GameState, g: GigInstanceId) => { const r = s.objects.gigs[g].roll; return r.kind === "ROLLED" ? r.currentValue : null; };
const activate = (s: GameState, id: CardInstanceId) => take(s, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id).state;
const gig = (s: GameState, g: GigInstanceId) => { assert.ok(validateState(s, context).ok); return pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === g).state; };

test("the V62 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(padre.provenance.sourceHash, hashCanonical(v62Source(padre.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === padre.id), [padre]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Padre passes only its exact pin; it is Called through that pin and never played", () => {
    for (const gate of [supportsCall, supportsLegendSpendCard]) assert.ok(gate(padre, context).ok);
    assert.equal(supportsPlay(padre, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(padre) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["cost-limited spend", d => { d.mechanics.abilities[0].effects[0] = { kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } }; }],
        ["same-player set", d => { d.mechanics.abilities[1].effects = [{ kind: "SET_GIG_TO_ANOTHER_GIG_VALUE", optional: true }]; }],
        ["no choice", d => { delete d.mechanics.abilities[0].choose; }],
        ["tags", d => { d.tags = ["Fixer"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsCall, supportsLegendSpendCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("Calling Padre and choosing the spend mode spends the chosen rival Unit", () => {
    const o = put(base, OCTANT, rival), p = put(o.state, PSYCHO, rival), padreAt = withPadre(p.state, "DOWN");
    let r = take(padreAt.state, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === padreAt.id);
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 10); r = choose(r.state, context, 0); }
    let s = pick(r.state, context, x => x.kind === "MODE" && x.mode === "SPEND_UNIT").state;
    assert.equal(s.resolution.choice?.options.length, 2); assert.ok(validateState(s, context).ok);
    s = pick(s, context, x => x.kind === "CARD" && x.cardInstanceId === p.id).state;
    assert.equal(s.objects.cards[p.id].readiness, "SPENT"); assert.equal(s.objects.cards[o.id].readiness, "READY"); assert.equal(s.timing.step, "MAIN");
});

test("{Spend}: a Gig takes another player's Gig value; never one of the same player's", () => {
    const g = gigs(base, { [actor]: [2, 5], [rival]: [6] }), h = withPadre(g.state, "UP");
    let s = activate(h.state, h.id);
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "GIG" && o.gigInstanceId).sort(), [...g.ids[actor], ...g.ids[rival]].sort(), "each Gig can take another player's value");
    s = gig(s, g.ids[rival][0]);
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "GIG" && o.gigInstanceId).sort(), [...g.ids[actor]].sort(), "only the other player's Gigs");
    s = gig(s, g.ids[actor][0]);
    assert.equal(value(s, g.ids[rival][0]), 2); assert.equal(value(s, g.ids[actor][1]), 5); assert.equal(s.timing.step, "MAIN");
    const forced = activate(withPadre(gigs(base, { [actor]: [2], [rival]: [2] }).state, "UP").state, h.id);
    assert.equal(forced.timing.step, "MAIN", "equal values: nothing to set");
    const one = gigs(base, { [actor]: [3], [rival]: [6] }), done = activate(withPadre(one.state, "UP").state, h.id);
    assert.equal(done.resolution.choice?.options.length, 2, "either Gig may be the one set");
    assert.equal(value(gig(done, one.ids[actor][0]), one.ids[actor][0]), 6, "its lone source is taken without a choice");
});

test("the reviewed union contains Padre", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PADRE));
});
