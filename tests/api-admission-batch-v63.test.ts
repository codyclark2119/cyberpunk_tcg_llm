import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV63Cards, batchV63Context, batchV63Input, v63Source, EVELYN } from "./api-admission-batch-v63-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV63Context();
const evelyn = batchV63Cards[0];
const GOONS = "maelstrom-goons", PSYCHO = "psycho-squad", OCTANT = "octant"; // Ganger power 3 (its own trigger needs Gear); NCPD 6; 8.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV63Input("batch-v63"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { mine?: string[]; theirs?: string[]; rivalGigs?: number[]; spentEddies?: number; face?: "UP" | "DOWN" | null };
/** Trusted arrangement on the actor's MAIN: Evelyn as the actor's last Legend (face up and ready unless `face` says otherwise),
 * `mine` and `theirs` ready on the field, the rival's Gig area holding rolled Gigs of the given values, `spentEddies` spent. */
function arrange(a: Arrangement) {
    const m = new TurnMutation(base, context), ids: Record<string, CardInstanceId> = {};
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY";
        ids[cardId] = c.id;
    };
    for (const id of a.mine ?? []) rewrite(actor, id);
    for (const id of a.theirs ?? []) rewrite(rival, id);
    m.state.players[actor].zones.EDDIES.slice(0, a.spentEddies ?? 0).forEach(id => { m.state.objects.cards[id].readiness = "SPENT"; });
    const d = GameStateSchema.parse(m.state), legends = d.players[actor].zones.LEGENDS, e = d.objects.cards[legends[legends.length - 1]];
    if (a.face !== null) { e.cardId = evelyn.id; e.revision = evelyn.revision; e.face = a.face ?? "UP"; e.readiness = "READY"; }
    const gigs: GigInstanceId[] = [], values = [...(a.rivalGigs ?? [])];
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const value = g.ownerId === rival ? values.shift() : undefined;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (value !== undefined) gigs.push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids, gigs, evelyn: e.id };
}
function steal(s: GameState, attacker: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    let r = take(state, context, a => a.action.kind === "PASS_REACT"); const events = [...r.events];
    while (r.state.resolution.choice) { assert.ok(validateState(r.state, context).ok); r = choose(r.state, context, 0); events.push(...r.events); }
    return { state: r.state, events };
}
const spentEddies = (s: GameState) => s.players[actor].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "SPENT").length;
const fired = (events: { payload: { kind: string; sourceId?: string } }[], source: CardInstanceId) => events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === source);
const activations = (s: GameState, id: CardInstanceId) => unwrap(listLegalActions(s, s.timing.actingPlayer, context)).filter(a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id);
function activate(s: GameState, id: CardInstanceId) {
    s = take(s, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id).state;
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(s, context).ok);
        const i = s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0, "only Eddies pay; Evelyn cannot pay for herself"); s = choose(s, context, i).state;
    }
    return s;
}

test("the V63 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(evelyn.provenance.sourceHash, hashCanonical(v63Source(evelyn.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === evelyn.id), [evelyn]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Evelyn passes only her exact pin; she is Called and triggers through that pin and is never played", () => {
    for (const gate of [supportsCall, supportsTriggerCard, supportsLegendSpendCard]) assert.ok(gate(evelyn, context).ok);
    assert.equal(supportsPlay(evelyn, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(evelyn) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any steal", d => { delete d.mechanics.abilities[0].guard; }],
        ["ready 2", d => { d.mechanics.abilities[0].effects = [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 2 }]; }],
        ["free spend", d => { d.mechanics.abilities[1].activation!.costs = [{ kind: "SPEND_SOURCE" }]; }],
        ["quick", d => { d.mechanics.abilities[1].activation!.timing = "QUICK"; }],
        ["tags", d => { d.tags = ["Corpo"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsCall, supportsTriggerCard, supportsLegendSpendCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("a friendly GANGER Unit's steal readies 1 Eddie; an NCPD Unit's steal does not", () => {
    const a = arrange({ mine: [GOONS, PSYCHO], rivalGigs: [3, 4], spentEddies: 3 });
    const first = steal(a.state, a.ids[GOONS]);
    assert.ok(fired(first.events, a.evelyn)); assert.equal(spentEddies(first.state), 2); assert.ok(validateState(first.state, context).ok);
    const second = steal(first.state, a.ids[PSYCHO]);
    assert.equal(fired(second.events, a.evelyn), false); assert.equal(spentEddies(second.state), 2);
});

test("a face-down Evelyn does not observe steals", () => {
    const a = arrange({ mine: [GOONS], rivalGigs: [3], spentEddies: 3, face: "DOWN" }), r = steal(a.state, a.ids[GOONS]);
    assert.equal(fired(r.events, a.evelyn), false); assert.equal(spentEddies(r.state), 3);
});

test("an NCPD Unit's steal binds no Evelyn trigger", () => {
    const a = arrange({ mine: [PSYCHO], rivalGigs: [3], spentEddies: 3 });
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[PSYCHO]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    s = take(s, context, x => x.action.kind === "PASS_REACT").state;
    assert.equal(s.resolution.pending.some(p => p.sourceId === a.evelyn), false, "an NCPD steal binds nothing");
});

test("{Spend}: pay 1 Eddie, spend Evelyn, and choose the rival Unit that must attack next turn", () => {
    const a = arrange({ theirs: [PSYCHO, OCTANT] });
    assert.equal(activations(a.state, a.evelyn).length, 1);
    let s = activate(a.state, a.evelyn);
    assert.equal(s.objects.cards[a.evelyn].readiness, "SPENT"); assert.equal(spentEddies(s), 1);
    assert.deepEqual(s.resolution.choice?.options.map(o => o.kind === "CARD" && o.cardInstanceId).sort(), [a.ids[PSYCHO], a.ids[OCTANT]].sort());
    assert.ok(validateState(s, context).ok);
    s = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[OCTANT]).state;
    assert.equal(s.timing.step, "MAIN");
    assert.deepEqual(s.mustAttack?.map(x => [x.targetId, x.forcingPlayerId, "activated" in x.origin]), [[a.ids[OCTANT], actor, true]]);
    assert.ok(validateState(s, context).ok);
    assert.equal(activations(s, a.evelyn).length, 0, "a spent Legend cannot activate again");
    const next = end(s, context).state;
    assert.equal(next.timing.activePlayer, rival); assert.ok(validateState(next, context).ok);
    assert.equal(next.mustAttack?.length, 1, "the obligation carries into the rival's turn");
});

test("{Spend}: a lone rival Unit is forced without a choice; no rival Unit means nothing happens", () => {
    const one = arrange({ theirs: [PSYCHO] }), s = activate(one.state, one.evelyn);
    assert.equal(s.timing.step, "MAIN"); assert.deepEqual(s.mustAttack?.map(x => x.targetId), [one.ids[PSYCHO]]);
    const none = arrange({}), t = activate(none.state, none.evelyn);
    assert.equal(t.timing.step, "MAIN"); assert.equal(t.mustAttack?.length ?? 0, 0); assert.equal(t.objects.cards[none.evelyn].readiness, "SPENT");
});

test("{Spend} needs another payment source and a face-up ready Evelyn; she cannot pay for herself", () => {
    const noEddies = arrange({ theirs: [PSYCHO], spentEddies: 99 });
    assert.equal(activations(noEddies.state, noEddies.evelyn).length, 1, "another ready Legend can still pay the Eddie");
    const broke = GameStateSchema.parse(structuredClone(noEddies.state));
    for (const id of broke.players[actor].zones.LEGENDS) if (id !== noEddies.evelyn) broke.objects.cards[id].readiness = "SPENT";
    assert.equal(activations(unwrap(validateState(broke, context)), noEddies.evelyn).length, 0);
    const down = arrange({ theirs: [PSYCHO], face: "DOWN" });
    assert.equal(activations(down.state, down.evelyn).length, 0);
});

test("a forged activated obligation is rejected", () => {
    const one = arrange({ theirs: [PSYCHO] }), s = activate(one.state, one.evelyn);
    type Mutable = ReturnType<typeof GameStateSchema.parse>;
    for (const edit of [(f: Mutable) => { f.mustAttack![0].origin.effectId = "forged"; }, (f: Mutable) => { f.objects.cards[one.evelyn].face = "DOWN"; }]) {
        const forged = GameStateSchema.parse(structuredClone(s)); edit(forged); assert.equal(validateState(forged, context).ok, false);
    }
});

test("the reviewed union contains Evelyn", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === EVELYN));
});
