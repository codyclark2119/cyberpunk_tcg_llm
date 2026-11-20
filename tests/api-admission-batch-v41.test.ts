import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV41Cards, batchV41Context, batchV41Input, v41Source, SASHA } from "./api-admission-batch-v41-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV41Context();
const sasha = batchV41Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV41Input("batch-v41"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const vanilla = context.content.cards.filter(c => c.schemaVersion === 2 && c.type === "UNIT" && supportsPlay(c, context).ok && c.printedCost.kind === "EDDIES" && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length)
    .sort((a, b) => (a.power ?? 0) - (b.power ?? 0) || (a.id < b.id ? -1 : 1));
const cost = (id: string) => { const c = context.content.cards.find(c => c.id === id)!.printedCost; return c.kind === "EDDIES" ? c.amount : 0; };
const CHEAP = vanilla.find(c => cost(c.id) > 0)!.id, BIG = vanilla[vanilla.length - 1].id;

/** Trusted arrangement: the actor's first Legend is a face-up Sasha with 15 ready eddies; the deck's top card becomes `top` (or the
 * deck is emptied); the rival holds 2 more cards and, optionally, a spent `BIG` Unit. */
function arrange(top: string | null, rivalUnit = false) {
    const m = new TurnMutation(base, context), id = m.state.players[actor].zones.LEGENDS[0], c = m.state.objects.cards[id];
    c.cardId = sasha.id; c.revision = sasha.revision; c.face = "UP"; c.readiness = "READY";
    while (m.state.players[actor].zones.EDDIES.length < 15) {
        const deck = m.state.players[actor].zones.DECK, card = deck.map(x => m.state.objects.cards[x]).find(c => context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision)?.sellProfile.allowed)!;
        m.state.players[actor].zones.DECK = deck.filter(x => x !== card.id); m.state.players[actor].zones.EDDIES.push(card.id);
        card.zone = { playerId: actor, zone: "EDDIES" }; card.face = "DOWN"; card.readiness = "READY";
    }
    const rewrite = (cardId: CardInstanceId, as: string) => { const x = m.state.objects.cards[cardId], r = context.content.cards.find(r => r.id === as)!; x.cardId = r.id; x.revision = r.revision; };
    for (let i = 0; i < (rivalUnit ? 3 : 2); i++) {
        const deck = m.state.players[rival].zones.DECK, x = deck[deck.length - 1]; rewrite(x, i === 2 ? BIG : CHEAP); moveCardLocation(m, x, "HAND");
        if (i === 2) { moveCardLocation(m, x, "BATTLEFIELD"); m.state.objects.cards[x].readiness = "SPENT"; m.state.objects.cards[x].statuses = []; }
    }
    if (top) rewrite(m.state.players[actor].zones.DECK[0], top);
    const d = GameStateSchema.parse(m.state);
    if (!top) for (const x of d.players[actor].zones.DECK.splice(0)) { d.objects.cards[x].zone = { playerId: actor, zone: "TRASH" }; d.objects.cards[x].face = "UP"; d.players[actor].zones.TRASH.push(x); }
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs)) { // The rival's d8 waits in its Gig area at 4, so there is a Gig to steal.
        const rolled = g.ownerId === rival && g.dieType === "D8";
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: 4 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), id, top: d.players[actor].zones.DECK[0], unit: rivalUnit ? d.players[rival].zones.BATTLEFIELD[0] : undefined };
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
const declare = (s: GameState, id: CardInstanceId) => take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id);
const hand = (s: GameState, p: PlayerId) => s.players[p].zones.HAND;

test("the V41 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(sasha.provenance.sourceHash, hashCanonical(v41Source(sasha.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === sasha.id), [sasha]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Sasha Yakovleva: Won't Let You Down passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsTriggerCard, supportsFieldLegend, supportsCall, supportsPlay]) assert.ok(gate(sasha, context).ok, gate.name);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(sasha) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no Defeated", d => { d.mechanics.abilities.pop(); }],
        ["own discard", d => { d.mechanics.abilities[1].effects = [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" }]; }],
        ["Play reveal", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["swapped order", d => { d.mechanics.abilities.reverse(); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["no Go Solo", d => { d.mechanics.keywords = []; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 1; }],
        ["tags", d => { d.tags = ["Merc", "Netrunner"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }],
        ["field-Legend scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) {
        const forged = forge(edit);
        assert.equal(supportsTriggerCard(forged, context).ok && supportsFieldLegend(forged, context).ok, false, label);
    }
});

test("at 0 power Sasha can attack the Gig area; the revealed top card goes to hand and adds its cost as power this turn", () => {
    const a = arrange(CHEAP), solo = goSolo(a.state, a.id);
    assert.equal(effectivePower(solo, a.id, context), 0);
    const attacked = declare(solo, a.id);
    let s = attacked.state;
    while (s.resolution.choice && s.timing.step !== "RIVAL_REACT") s = choose(s, context).state;
    assert.ok(attacked.events.some(e => e.payload.kind === "CARD_REVEALED" && e.payload.cardInstanceId === a.top), "revealed, not drawn");
    assert.ok(hand(s, actor).includes(a.top)); assert.equal(effectivePower(s, a.id, context), cost(CHEAP));
    const forged = GameStateSchema.parse(s), x = forged.temporaryModifiers!.find(x => x.targetId === a.id)!; x.amount = cost(CHEAP) + 1;
    assert.equal(validateState(forged, context).ok, false, "the amount is the revealed card's cost");
    const done = take(s, context, x => x.action.kind === "PASS_REACT").state;
    assert.equal(done.timing.step, "MAIN"); assert.equal(effectivePower(done, a.id, context), cost(CHEAP), "until end of turn");
});

test("an empty deck reveals nothing and the attack goes on", () => {
    const a = arrange(null), r = declare(goSolo(a.state, a.id), a.id);
    assert.equal(r.events.some(e => e.payload.kind === "CARD_REVEALED"), false); assert.equal(r.state.match.outcome, undefined);
    assert.equal(effectivePower(r.state, a.id, context), 0);
});

test("when Sasha is defeated in a fight it leaves the game and the Rival chooses a card to discard", () => {
    const a = arrange(CHEAP, true);
    let s = declare(goSolo(a.state, a.id), a.id).state;
    s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.unit).state;
    while (s.resolution.choice && s.timing.step !== "RIVAL_REACT") s = choose(s, context).state;
    const rivalHand = [...hand(s, rival)];
    s = take(s, context, x => x.action.kind === "PASS_REACT").state;
    assert.equal(s.objects.cards[a.id].zone.zone, "REMOVED", "Go Solo: it is removed from the game");
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.resolution.choice!.actorId, rival);
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [...rivalHand].sort());
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === rivalHand[0]).state;
    assert.equal(done.objects.cards[rivalHand[0]].zone.zone, "TRASH"); assert.equal(done.timing.step, "MAIN");
});

test("the reviewed union admits the V41 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === SASHA));
});
