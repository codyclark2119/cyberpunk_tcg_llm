import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsCapabilityGear } from "../packages/engine/src/capability-support";
import { effectiveKeywords } from "../packages/engine/src/capabilities";
import { legendEntryAmount } from "../packages/engine/src/legend-entry";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV56Cards, batchV56Context, batchV56Input, v56Source, RIOT } from "./api-admission-batch-v56-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV56Context();
const riot = batchV56Cards[0];
// A vanilla Unit (power 4) and a {Go Solo} Legend with cost 5.
const ATLUS = "emergency-atlus", V = "v-corporate-exile";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV56Input("batch-v56"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the player's last deck card becomes `cardId` in hand, or ready on the field with no lag. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "READY") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    if (where !== "HAND") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = where; c.statuses = []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: a Unit for `player` with `gear` equipped (from that player's deck). */
function equipped(s: GameState, player: PlayerId, gear: string) {
    const host = put(s, ATLUS, player, "READY"), placed = put(host.state, gear, player, "HAND"), m = new TurnMutation(placed.state, context);
    unwrap(attachPlayedGear(m, placed.id, host.id));
    return { state: unwrap(validateState(m.state, context)), host: host.id, gear: placed.id };
}
/** Trusted arrangement: `player`'s first Legend becomes V (cost 5), face up and ready, with exactly `eddies` ready Eddies; the other Legends are spent. */
function withLegend(s: GameState, player: PlayerId, eddies: number) {
    const m = new TurnMutation(s, context), id = m.state.players[player].zones.LEGENDS[0], c = m.state.objects.cards[id], r = context.content.cards.find(x => x.id === V)!;
    for (const x of m.state.players[player].zones.LEGENDS) m.state.objects.cards[x].readiness = "SPENT"; // Only V itself can pay (1 €$).
    c.cardId = r.id; c.revision = r.revision; c.face = "UP"; c.readiness = "READY";
    for (const x of m.state.players[player].zones.EDDIES) m.state.objects.cards[x].readiness = "SPENT";
    for (const x of m.state.players[player].zones.EDDIES.slice(0, eddies)) m.state.objects.cards[x].readiness = "READY";
    while (m.state.players[player].zones.EDDIES.filter(x => m.state.objects.cards[x].readiness === "READY").length < eddies) {
        const deck = m.state.players[player].zones.DECK, e = deck.map(x => m.state.objects.cards[x]).find(c => context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision)?.sellProfile.allowed)!;
        m.state.players[player].zones.DECK = deck.filter(x => x !== e.id); m.state.players[player].zones.EDDIES.push(e.id);
        e.zone = { playerId: player, zone: "EDDIES" }; e.face = "DOWN"; e.readiness = "READY";
    }
    return { state: unwrap(validateState(m.state, context)), id };
}
const goSoloOffered = (s: GameState, id: CardInstanceId) => listLegalActions(s, actor, context).ok && unwrap(listLegalActions(s, actor, context)).some(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === id);
function goSolo(s: GameState, id: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === id), paid = 0;
    paid += r.events.filter(e => e.payload.kind === "PAYMENT_MADE").flatMap(e => (e.payload as unknown as { sources: unknown[] }).sources).length;
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 30); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); r = choose(r.state, context, i >= 0 ? i : 0);
        paid += r.events.filter(e => e.payload.kind === "PAYMENT_MADE").flatMap(e => (e.payload as unknown as { sources: unknown[] }).sources).length;
    }
    return { state: r.state, paid };
}

test("the V56 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(riot.provenance.sourceHash, hashCanonical(v56Source(riot.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === riot.id), [riot]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Riot Shield passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsCapabilityGear, supportsPlay]) assert.ok(gate(riot, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(riot) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no tax", d => { d.mechanics.modifiers.pop(); }],
        ["no Blocker", d => { d.mechanics.modifiers.splice(1, 1); }],
        ["no printed power", d => { d.mechanics.modifiers.shift(); }],
        ["ability", d => { d.mechanics.abilities = [{ id: "x@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 1 }; }],
        ["power", d => { d.power = 2; }],
        ["tags", d => { d.tags = ["Cyberware"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsCapabilityGear, supportsPlay]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the host has {Blocker}", () => {
    const e = equipped(base, rival, RIOT);
    assert.deepEqual(effectiveKeywords(e.state, e.host, context), ["BLOCKER"]);
});

test("a rival's Riot Shield makes {Go Solo} cost 2 more; the exact amount is paid", () => {
    const free = withLegend(base, actor, 5);
    assert.equal(legendEntryAmount(free.state, actor, free.id, "GO_SOLO", context), 5);
    assert.ok(goSoloOffered(free.state, free.id));
    const taxed = withLegend(equipped(base, rival, RIOT).state, actor, 5);
    assert.equal(legendEntryAmount(taxed.state, actor, taxed.id, "GO_SOLO", context), 7);
    assert.equal(goSoloOffered(taxed.state, taxed.id), false, "5 Eddies and V itself no longer pay for it");
    const rich = withLegend(equipped(base, rival, RIOT).state, actor, 7);
    assert.ok(goSoloOffered(rich.state, rich.id));
    const done = goSolo(rich.state, rich.id);
    assert.equal(done.paid, 7); assert.equal(done.state.objects.cards[rich.id].zone.zone, "BATTLEFIELD");
});

test("two rival Riot Shields add +4; the actor's own Riot Shield adds nothing", () => {
    const two = withLegend(equipped(equipped(base, rival, RIOT).state, rival, RIOT).state, actor, 9);
    assert.equal(legendEntryAmount(two.state, actor, two.id, "GO_SOLO", context), 9);
    const own = withLegend(equipped(base, actor, RIOT).state, actor, 5);
    assert.equal(legendEntryAmount(own.state, actor, own.id, "GO_SOLO", context), 5);
    assert.ok(goSoloOffered(own.state, own.id));
});

test("the reviewed union contains Riot Shield", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === RIOT));
});
