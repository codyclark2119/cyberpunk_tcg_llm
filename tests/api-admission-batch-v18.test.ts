import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV18Cards, batchV18Context, batchV18Input, v18Source, ENDER } from "./api-admission-batch-v18-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, withGigs } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV18Context();
const ender = batchV18Cards.find(c => c.id === ENDER)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV18Input("batch-v18"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plainUnit = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && (c.power ?? 0) > 0 && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length)!.id;
/** Trusted arrangement: `cardId` ready on the player's field, rewritten from their last deck card. */
function field(s: GameState, cardId: string, player: PlayerId) {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision;
    moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: the actor's first Legend becomes Ender, face-up (Called earlier) or face-down, with 10 ready eddies. */
function withEnder(s: GameState, face: "UP" | "DOWN" = "UP") {
    const m = new TurnMutation(s, context), id = m.state.players[actor].zones.LEGENDS[0], c = m.state.objects.cards[id];
    c.cardId = ender.id; c.revision = ender.revision; c.face = face; c.readiness = "READY";
    while (m.state.players[actor].zones.EDDIES.length < 10) {
        const deck = m.state.players[actor].zones.DECK, card = deck.map(x => m.state.objects.cards[x]).find(c => context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision)?.sellProfile.allowed)!;
        m.state.players[actor].zones.DECK = deck.filter(x => x !== card.id); m.state.players[actor].zones.EDDIES.push(card.id);
        card.zone = { playerId: actor, zone: "EDDIES" }; card.face = "DOWN"; card.readiness = "READY";
    }
    return { state: unwrap(validateState(m.state, context)), id };
}
function pay(s: GameState) {
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 30);
        const i = s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        s = choose(s, context, i >= 0 ? i : 0).state;
    }
    return s;
}
const gigOf = (s: GameState, p: PlayerId) => Object.values(s.objects.gigs).filter(g => g.controllerId === p).map(g => g.id).sort()[0];
const goSolo = (s: GameState, id: CardInstanceId) => pay(take(s, context, a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === id).state);

test("V18 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(ender.provenance.sourceHash, hashCanonical(v18Source(ender.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === ender.id), [ender]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Ender passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsTargetedDefeatCard, supportsFieldLegend, supportsPlay]) assert.ok(gate(ender, context).ok, gate.name);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(ender) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["no Go Solo", d => { d.mechanics.keywords = []; }],
        ["extra keyword", d => { d.mechanics.keywords = ["GO_SOLO", "BLOCKER"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["power", d => { d.power = 8; }],
        ["tags", d => { d.tags = ["Arasaka"]; }],
        ["color", d => { d.colors = ["YELLOW"]; d.ram = { YELLOW: 2 }; }],
        ["not sellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }],
        ["any Unit", d => { (d.mechanics.abilities[0].effects[0] as { target: { relation: string } }).target.relation = "ANY"; }],
        ["power filter", d => { (d.mechanics.abilities[0].effects[0] as { target: { power: unknown } }).target.power = { kind: "AT_MOST", value: 5 }; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "STREET_CRED_GREATER_THAN_RIVAL" }] as never; }],
        ["field-Legend scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) {
        const f = forge(edit);
        assert.equal(supportsFieldLegend(f, context).ok && supportsTargetedDefeatCard(f, context).ok, false, label);
    }
});

test("Ender Going Solo defeats the rival Unit its controller chooses, then stays a ready attacker", () => {
    const a = field(withGigs(base, context, { [gigOf(base, rival)]: 2 }), plainUnit, rival), b = field(a.state, plainUnit, rival), own = field(b.state, plainUnit, actor), e = withEnder(own.state);
    let s = goSolo(e.state, e.id);
    assert.equal(s.objects.cards[e.id].zone.zone, "BATTLEFIELD");
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.resolution.choice!.actorId, actor);
    const targets = s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort();
    assert.deepEqual(targets, [a.id, b.id].sort(), "only rival Units; never Ender or a friendly Unit");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === b.id);
    s = done.state;
    assert.equal(s.objects.cards[b.id].zone.zone, "TRASH");
    assert.equal(s.objects.cards[a.id].zone.zone, "BATTLEFIELD");
    assert.equal(s.objects.cards[own.id].zone.zone, "BATTLEFIELD");
    assert.ok(done.events.some(x => x.payload.kind === "CARD_DEFEATED" && x.payload.cardInstanceId === b.id && x.payload.defeatedBy === e.id), "defeated by Ender");
    assert.equal(s.timing.step, "MAIN");
    assert.equal(s.objects.cards[e.id].readiness, "READY");
    assert.ok(s.objects.cards[e.id].statuses.includes("GO_SOLO"));
    assert.ok(actions(s, context).some(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === e.id), "Go Solo can attack this turn");
});

test("a single rival Unit is defeated automatically; none means nothing happens", () => {
    const one = field(base, plainUnit, rival), e = withEnder(one.state), s = goSolo(e.state, e.id);
    assert.equal(s.timing.step, "MAIN");
    assert.equal(s.objects.cards[one.id].zone.zone, "TRASH");
    assert.equal(s.objects.cards[e.id].zone.zone, "BATTLEFIELD");
    const own = field(base, plainUnit, actor), lone = withEnder(own.state), quiet = goSolo(lone.state, lone.id);
    assert.equal(quiet.timing.step, "MAIN");
    assert.equal(quiet.objects.cards[own.id].zone.zone, "BATTLEFIELD", "a friendly Unit is never the target");
    assert.equal(quiet.objects.cards[lone.id].zone.zone, "BATTLEFIELD");
});

test("Calling Ender face-up is not playing it: no defeat", () => {
    const one = field(base, plainUnit, rival), e = withEnder(one.state, "DOWN");
    const call = actions(e.state, context).find(x => x.action.kind === "CALL_LEGEND" && x.action.cardInstanceId === e.id);
    assert.ok(call, "a face-down Ender can be Called");
    const s = pay(take(e.state, context, x => x.actionId === call.actionId).state);
    assert.equal(s.objects.cards[e.id].face, "UP");
    assert.equal(s.objects.cards[e.id].zone.zone, "LEGENDS");
    assert.equal(s.objects.cards[one.id].zone.zone, "BATTLEFIELD");
    assert.equal(s.resolution.choice, null);
});

test("the reviewed union admits the V18 card", () => {
    const ids: string[] = reviewedUnionContext().content.cards.map(c => c.id);
    assert.ok(ids.includes(ENDER));
});
