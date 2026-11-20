import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV40Cards, batchV40Context, batchV40Input, v40Source, ROGUE } from "./api-admission-batch-v40-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV40Context();
const rogue = batchV40Cards[0];
const EXILE = "v-corporate-exile"; // A plain Go Solo Legend (cost 5, power 8).
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV40Input("batch-v40"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plainUnit = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && (c.power ?? 0) > 0 && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length)!.id;

/** Trusted arrangement: the actor's Legends become `legends` in order (face as given), with 15 ready eddies; the rival holds 2 more cards. */
function arrange(legends: [string, "UP" | "DOWN"][], rivalValue: number) {
    const m = new TurnMutation(base, context), ids: CardInstanceId[] = [];
    legends.forEach(([cardId, face], i) => {
        const id = m.state.players[actor].zones.LEGENDS[i], c = m.state.objects.cards[id], r = context.content.cards.find(r => r.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; c.face = face; c.readiness = "READY"; ids.push(id);
    });
    while (m.state.players[actor].zones.EDDIES.length < 15) {
        const deck = m.state.players[actor].zones.DECK, card = deck.map(x => m.state.objects.cards[x]).find(c => context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision)?.sellProfile.allowed)!;
        m.state.players[actor].zones.DECK = deck.filter(x => x !== card.id); m.state.players[actor].zones.EDDIES.push(card.id);
        card.zone = { playerId: actor, zone: "EDDIES" }; card.face = "DOWN"; card.readiness = "READY";
    }
    for (let i = 0; i < 2; i++) {
        const deck = m.state.players[rival].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(r => r.id === plainUnit)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    }
    const d = GameStateSchema.parse(m.state);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    let gig: GigInstanceId | undefined;
    for (const g of Object.values(d.objects.gigs)) {
        const rolled = g.ownerId === rival && g.dieType === "D8" ;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: rivalValue } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (rolled) gig = g.id;
    }
    return { state: unwrap(validateState(d, context)), ids, gig: gig! };
}
function pay(s: GameState) {
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 30);
        const i = s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        s = choose(s, context, i >= 0 ? i : 0).state;
    }
    return s;
}
const goSolo = (s: GameState, id: CardInstanceId) => pay(take(s, context, a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === id).state);
/** `attacker` attacks the rival's Gig area and the rival passes React; the result is after the Steal Step. */
function steal(s: GameState, attacker: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    while (state.resolution.choice && state.timing.step !== "RIVAL_REACT") state = choose(state, context).state;
    assert.equal(state.timing.step, "RIVAL_REACT");
    return take(state, context, a => a.action.kind === "PASS_REACT");
}
const hand = (s: GameState, p: PlayerId) => s.players[p].zones.HAND.length;
const parity = (events: { payload: { kind: string; met?: boolean } }[]) => events.filter(e => e.payload.kind === "CONDITION_EVALUATED").map(e => e.payload.met);

test("the V40 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(rogue.provenance.sourceHash, hashCanonical(v40Source(rogue.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === rogue.id), [rogue]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Rogue Amendiares: Preem Solo passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsTriggerCard, supportsFieldLegend, supportsCall, supportsPlay]) assert.ok(gate(rogue, context).ok, gate.name);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(rogue) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any friendly Unit", d => { delete d.mechanics.abilities[0].guard; }],
        ["d6 guard", d => { d.mechanics.abilities[0].guard = "STOLEN_GIG_IS_D6"; }],
        ["own steal", d => { d.mechanics.abilities[0].trigger = "WHEN_GIG_STOLEN"; }],
        ["draw only", d => { d.mechanics.abilities[0].effects = [{ kind: "DRAW", count: 1 }]; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["no Go Solo", d => { d.mechanics.keywords = []; }],
        ["Blocker", d => { d.mechanics.keywords = ["GO_SOLO", "BLOCKER"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["power", d => { d.power = 8; }],
        ["tags", d => { d.tags = ["Corpo", "Merc"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }],
        ["field-Legend scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) {
        const forged = forge(edit);
        assert.equal(supportsTriggerCard(forged, context).ok && supportsFieldLegend(forged, context).ok, false, label);
    }
});

test("a face-up Rogue in the Legends area draws 1 when another friendly Legend steals an even Gig", () => {
    const a = arrange([[ROGUE, "UP"], [EXILE, "UP"]], 4), [, exile] = a.ids;
    const solo = goSolo(a.state, exile), before = hand(solo, actor), rivalBefore = hand(solo, rival);
    const r = steal(solo, exile);
    assert.equal(r.state.objects.gigs[a.gig].controllerId, actor);
    assert.deepEqual(parity(r.events), [true], "4 is even");
    assert.equal(hand(r.state, actor), before + 1); assert.equal(hand(r.state, rival), rivalBefore);
    assert.equal(r.state.timing.step, "MAIN"); assert.equal(r.state.resolution.triggerContinuation, undefined);
});

test("Rogue gone solo steals an odd Gig itself, and the Rival chooses a card to discard", () => {
    const a = arrange([[ROGUE, "UP"]], 5), [self] = a.ids;
    const solo = goSolo(a.state, self), before = hand(solo, actor), rivalHand = [...solo.players[rival].zones.HAND];
    const r = steal(solo, self);
    assert.deepEqual(parity(r.events), [false], "5 is odd");
    assert.equal(r.state.timing.step, "DISCARD_SELECTION"); assert.equal(r.state.resolution.choice!.actorId, rival, "the affected Rival chooses");
    assert.deepEqual(r.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [...rivalHand].sort());
    const forged = GameStateSchema.parse(r.state); forged.objects.gigs[a.gig].roll = { kind: "ROLLED", initialValue: 1, currentValue: 6 };
    assert.equal(validateState(forged, context).ok, false, "an even Gig never holds a discard");
    const done = pick(r.state, context, o => o.kind === "CARD" && o.cardInstanceId === rivalHand[0]);
    assert.equal(done.state.objects.cards[rivalHand[0]].zone.zone, "TRASH"); assert.equal(hand(done.state, actor), before, "no draw for an odd Gig");
    assert.equal(done.state.timing.step, "MAIN");
});

test("a non-Legend Unit's steal and a face-down Rogue do not trigger", () => {
    const down = arrange([[ROGUE, "DOWN"], [EXILE, "UP"]], 4), [, exile] = down.ids;
    const solo = goSolo(down.state, exile), r = steal(solo, exile);
    assert.deepEqual(parity(r.events), [], "a face-down Legend has no abilities");
    const up = arrange([[ROGUE, "UP"]], 4), m = new TurnMutation(up.state, context), deck = m.state.players[actor].zones.DECK;
    const unit = m.state.objects.cards[deck[deck.length - 1]], ur = context.content.cards.find(r => r.id === plainUnit)!;
    unit.cardId = ur.id; unit.revision = ur.revision; moveCardLocation(m, unit.id, "HAND"); moveCardLocation(m, unit.id, "BATTLEFIELD"); unit.readiness = "READY"; unit.statuses = [];
    const plain = steal(unwrap(validateState(m.state, context)), unit.id);
    assert.equal(plain.state.objects.gigs[up.gig].controllerId, actor); assert.deepEqual(parity(plain.events), [], "a friendly Unit is not a Legend");
});

test("the reviewed union admits the V40 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === ROGUE));
});
