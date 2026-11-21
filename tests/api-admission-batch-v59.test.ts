import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsLegendSpendCard, friendlyValuePairs } from "../packages/engine/src/legend-spend-support";
import { supportsReactPlay } from "../packages/engine/src/react-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV59Cards, batchV59Context, batchV59Input, v59Source, HANAKO } from "./api-admission-batch-v59-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";


const context = batchV59Context();
const hanako = batchV59Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV59Input("batch-v59"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** Trusted arrangement: the actor's first Legend rewritten as Hanako, face up or down, ready or spent. */
function withHanako(s: GameState, face: "UP" | "DOWN" = "UP", readiness: "READY" | "SPENT" = "READY") {
    const d = GameStateSchema.parse(structuredClone(s)), id = d.players[actor].zones.LEGENDS[0], c = d.objects.cards[id];
    c.cardId = hanako.id; c.revision = hanako.revision; c.face = face; c.readiness = readiness;
    return { state: unwrap(validateState(d, context)), id };
}
/** Trusted arrangement: each player's Gig area holds exactly the listed values on its largest non-d20 dice; other dice wait in the fixer. */
function gigs(s: GameState, values: Record<PlayerId, number[]>) {
    const d = GameStateSchema.parse(structuredClone(s)), faces = (g: { dieType: string }) => Number(g.dieType.slice(1)), ids: Record<PlayerId, GigInstanceId[]> = {};
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const player of d.match.playerOrder) {
        const want = values[player] ?? [], dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
        const order = want.map((_, i) => i).sort((a, b) => want[b] - want[a]), assigned = new Map(order.map((vi, k) => [dice[k].id, vi]));
        ids[player] = [];
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === player)) {
            const vi = assigned.get(g.id), value = vi === undefined ? undefined : want[vi];
            assert.ok(value === undefined || value <= faces(g));
            g.controllerId = player; g.location = { playerId: player, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[player].gigs[g.location.zone].push(g.id);
            if (vi !== undefined) ids[player][vi] = g.id;
        }
    }
    return { state: unwrap(validateState(d, context)), ids };
}
const activate = (s: GameState, id: CardInstanceId) => take(s, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id);
const offered = (s: GameState, id: CardInstanceId) => actions(s, context).some(a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id);
const controller = (s: GameState, g: GigInstanceId) => s.objects.gigs[g].controllerId;

test("the V59 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(hanako.provenance.sourceHash, hashCanonical(v59Source(hanako.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === hanako.id), [hanako]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Hanako passes only its exact pin; it is Called through that pin and never played", () => {
    for (const gate of [supportsCall, supportsLegendSpendCard]) assert.ok(gate(hanako, context).ok);
    for (const gate of [supportsPlay, supportsTriggerCard, supportsReactPlay]) assert.equal(gate(hanako, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(hanako) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["optional swap", d => { d.mechanics.abilities[0].effects = [{ kind: "SWAP_GIGS", optional: true }]; }],
        ["Quick", d => { d.mechanics.abilities[0].activation!.timing = "QUICK"; }],
        ["paid", d => { d.mechanics.abilities[0].activation!.costs.push({ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }); }],
        ["second draw", d => { d.mechanics.abilities[1].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[1].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["no trigger", d => { d.mechanics.abilities.pop(); }],
        ["Go Solo", d => { d.mechanics.keywords = ["GO_SOLO"]; }],
        ["RAM", d => { d.ram = { GREEN: 3 }; }],
        ["tags", d => { d.tags = ["Arasaka", "Corpo"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsCall, supportsLegendSpendCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("value-pairs count disjoint same-value Gigs (6.6.1)", () => {
    for (const [values, pairs] of [[[3, 3, 3], 1], [[3, 3, 3, 3], 2], [[2, 2, 5, 5, 6], 2], [[1, 2, 4], 0]] as const)
        assert.equal(friendlyValuePairs(gigs(base, { [actor]: [...values] }).state, actor), pairs, values.join(","));
});

test("{Spend}: with one Gig on each side the swap is forced; it is offered only face up, ready, in Main", () => {
    const g = gigs(base, { [actor]: [2], [rival]: [6] }), h = withHanako(g.state);
    assert.ok(offered(h.state, h.id));
    for (const other of [withHanako(g.state, "DOWN"), withHanako(g.state, "UP", "SPENT")]) assert.equal(offered(other.state, other.id), false);
    const done = activate(h.state, h.id);
    assert.equal(done.state.objects.cards[h.id].readiness, "SPENT");
    assert.equal(controller(done.state, g.ids[actor][0]), rival); assert.equal(controller(done.state, g.ids[rival][0]), actor);
    assert.ok(done.events.some(e => e.payload.kind === "GIGS_SWAPPED"));
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(offered(done.state, h.id), false, "spent");
});

test("{Spend}: the controller chooses the friendly Gig, then the rival Gig", () => {
    const g = gigs(base, { [actor]: [2, 4], [rival]: [6, 8] }), h = withHanako(g.state);
    let s = activate(h.state, h.id).state;
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "GIG" && o.gigInstanceId), [...g.ids[actor]].sort());
    assert.ok(validateState(s, context).ok);
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === g.ids[actor][1]).state;
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "GIG" && o.gigInstanceId), [...g.ids[rival]].sort());
    assert.ok(validateState(s, context).ok);
    const forged = GameStateSchema.parse(structuredClone(s)); forged.resolution.playContinuation!.targetGigId = g.ids[rival][0];
    assert.equal(validateState(forged, context).ok, false, "the held Gig must be friendly");
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === g.ids[rival][0]).state;
    assert.equal(controller(s, g.ids[actor][1]), rival); assert.equal(controller(s, g.ids[rival][0]), actor);
    assert.equal(controller(s, g.ids[actor][0]), actor); assert.equal(controller(s, g.ids[rival][1]), rival);
    assert.equal(s.timing.step, "MAIN");
});

test("{Spend} with no rival Gig spends Hanako and swaps nothing", () => {
    const g = gigs(base, { [actor]: [2] }), h = withHanako(g.state);
    const done = activate(h.state, h.id);
    assert.equal(done.state.objects.cards[h.id].readiness, "SPENT"); assert.equal(controller(done.state, g.ids[actor][0]), actor);
    assert.equal(done.events.some(e => e.payload.kind === "GIGS_SWAPPED"), false);
});

/** End the actor's turn and play through the rival's turn (rolling only) to the actor's next Main phase, collecting events. */
function nextOwnTurn(s: GameState) {
    let r = take(s, context, a => a.action.kind === "END_TURN"); const events = [...r.events];
    for (let n = 0; !(r.state.timing.activePlayer === rival && r.state.timing.step === "MAIN"); n++) { assert.ok(n < 20); r = take(r.state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE"); events.push(...r.events); }
    r = take(r.state, context, a => a.action.kind === "END_TURN"); events.push(...r.events);
    for (let n = 0; !(r.state.timing.activePlayer === actor && r.state.timing.step === "MAIN"); n++) { assert.ok(n < 20); r = take(r.state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE"); events.push(...r.events); }
    return { state: r.state, events };
}
test("at the start of its controller's turn, face-up Hanako draws 1 per friendly value-pair, before the turn's draw", () => {
    const g = gigs(base, { [actor]: [3, 3, 3, 5, 5] }).state;
    const up = withHanako(g), down = withHanako(g, "DOWN");
    const a = nextOwnTurn(up.state), b = nextOwnTurn(down.state);
    assert.equal(a.state.players[actor].zones.HAND.length - b.state.players[actor].zones.HAND.length, 2, "3,3,3,5,5 holds two value-pairs");
    assert.equal(a.state.players[rival].zones.HAND.length, b.state.players[rival].zones.HAND.length, "nothing on the rival's turn");
    const pending = a.events.filter(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === up.id);
    assert.equal(pending.length, 1, "once, on its controller's turn only");
    const order = (kind: string) => a.events.findIndex((e, i) => i > a.events.indexOf(pending[0]) && e.payload.kind === kind);
    assert.ok(order("EFFECT_RESOLVED") < order("CARD_READIED") || order("CARD_READIED") < 0, "8.6.2.2 precedes READY");
});

test("the reviewed union contains Hanako Arasaka", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === HANAKO));
});
