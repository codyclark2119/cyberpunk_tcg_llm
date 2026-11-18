import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, canonicalSerialize, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV17Cards, batchV17Context, batchV17Input, v17Source, LLORONA, NEGOTIATORS } from "./api-admission-batch-v17-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, withGigs } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV17Context();
const llorona = batchV17Cards.find(c => c.id === LLORONA)!, negotiators = batchV17Cards.find(c => c.id === NEGOTIATORS)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV17Input("batch-v17"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plainUnit = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && (c.power ?? 0) > 0 && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length)!.id;
const vanillaBlocker = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && supportsPlay(c, context).ok && canonicalSerialize(c.mechanics) === canonicalSerialize({ keywords: ["BLOCKER"], modifiers: [], abilities: [] }))!.id;
/** Trusted arrangement: rewrites the player's last deck card as `cardId` in hand. */
function put(s: GameState, cardId: string, player: PlayerId) {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: `cardId` ready on the player's field, with no entry statuses. */
function field(s: GameState, cardId: string, player: PlayerId) {
    const placed = put(s, cardId, player), m = new TurnMutation(placed.state, context);
    moveCardLocation(m, placed.id, "BATTLEFIELD"); m.state.objects.cards[placed.id].readiness = "READY"; m.state.objects.cards[placed.id].statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: placed.id };
}
const gigOf = (s: GameState, p: PlayerId) => Object.values(s.objects.gigs).filter(g => g.controllerId === p).map(g => g.id).sort()[0] as GigInstanceId;
const gigValue = (s: GameState, id: GigInstanceId) => { const g = s.objects.gigs[id]; return g.roll.kind === "ROLLED" ? g.roll.currentValue : null; };
/** The actor attacks the rival with a plain ready Unit while `cardId` waits on the rival's field (a rival Gig is rolled if none is). */
function attackInto(cardId: string, prepare: (s: GameState) => GameState = s => s) {
    const prepared = prepare(base), rivalGig = prepared.players[rival].gigs.GIGS.length ? prepared : withGigs(prepared, context, { [gigOf(prepared, rival)]: 2 });
    const attacker = field(rivalGig, plainUnit, actor), blocker = field(attacker.state, cardId, rival);
    let state = take(blocker.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker.id).state;
    while (state.resolution.choice && state.timing.step !== "RIVAL_REACT") state = choose(state, context).state;
    assert.equal(state.timing.step, "RIVAL_REACT");
    return { state, attackerId: attacker.id, blockerId: blocker.id };
}
const block = (s: GameState, id: CardInstanceId) => take(s, context, a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === id);
const handOf = (s: GameState, p: PlayerId) => [...s.players[p].zones.HAND].sort();

test("V17 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV17Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v17Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
});

test("each Blocker trigger passes only its own exact pin; any changed field is rejected", () => {
    for (const card of [llorona, negotiators]) { assert.ok(supportsTriggerCard(card, context).ok, card.id); assert.ok(supportsPlay(card, context).ok, card.id); }
    const forge = (card: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(card) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const common: [string, (d: CardRevisionSnapshot) => void][] = [
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["no Blocker", d => { d.mechanics.keywords = []; }],
        ["extra keyword", d => { d.mechanics.keywords = ["BLOCKER", "ADRENALINE"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Corpo"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }]
    ];
    for (const card of [llorona, negotiators]) for (const [label, edit] of common) assert.equal(supportsTriggerCard(forge(card, edit), context).ok, false, `${card.id}: ${label}`);
    const own: [CardRevisionSnapshot, string, (d: CardRevisionSnapshot) => void][] = [
        [llorona, "maximum 4", d => { (d.mechanics.abilities[0].effects[0] as { maximum: number }).maximum = 4; }],
        [llorona, "decrease", d => { (d.mechanics.abilities[0].effects[0] as { direction: string }).direction = "DECREASE"; }],
        [negotiators, "own discard", d => { (d.mechanics.abilities[0].effects[0] as { player: string }).player = "CONTROLLER"; }],
        [llorona, "other card's effect", d => { d.mechanics.abilities[0].effects = structuredClone(negotiators.mechanics.abilities[0].effects) as never; }]
    ];
    for (const [card, label, edit] of own) assert.equal(supportsTriggerCard(forge(card, edit), context).ok, false, `${card.id}: ${label}`);
});

test("La Llorona blocking lets its controller increase any Gig by up to 3, then React reopens", () => {
    const own = gigOf(base, rival), theirs = gigOf(base, actor);
    const a = attackInto(LLORONA, s => withGigs(s, context, { [own]: 2, [theirs]: 3 }));
    const blocked = block(a.state, a.blockerId);
    let s = blocked.state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.resolution.choice!.actorId, rival);
    assert.deepEqual(s.resolution.triggerContinuation!.origin, { kind: "BLOCK", subjectId: a.blockerId });
    assert.deepEqual(s.timing.combat, { ...a.state.timing.combat, stage: "TRIGGER_RESOLUTION", target: { kind: "CARD", cardInstanceId: a.blockerId } });
    assert.equal(s.objects.cards[a.blockerId].readiness, "SPENT");
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === theirs).state;
    assert.equal(s.timing.step, "AMOUNT_SELECTION");
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "AMOUNT" ? o.amount : null), [0, 1, 2, 3]);
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "AMOUNT", amount: 4 });
    assert.equal(validateState(forged, context).ok, false, "never more than 3");
    s = pick(s, context, o => o.kind === "AMOUNT" && o.amount === 3).state;
    assert.equal(gigValue(s, theirs), 6); assert.equal(gigValue(s, own), 2);
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.timing.actingPlayer, rival);
    assert.equal(s.resolution.triggerContinuation, undefined);
    assert.deepEqual(s.timing.combat.stage, "RIVAL_REACT");
    assert.ok(actions(s, context).some(x => x.action.kind === "PASS_REACT"));
});

test("a Gig already at its maximum is only kept; La Llorona attacked without blocking triggers nothing", () => {
    const own = gigOf(base, rival), theirs = gigOf(base, actor), top = Number(base.objects.gigs[own].dieType.slice(1));
    const a = attackInto(LLORONA, s => withGigs(s, context, { [own]: top }));
    const blocked = block(a.state, a.blockerId).state;
    assert.equal(blocked.timing.step, "RIVAL_REACT", "one Gig at maximum resolves automatically with +0");
    assert.equal(gigValue(blocked, own), top); assert.equal(gigValue(blocked, theirs), null);
    const vanilla = attackInto(vanillaBlocker), plain = block(vanilla.state, vanilla.blockerId);
    assert.equal(plain.state.resolution.triggerContinuation, undefined);
    assert.equal(plain.events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
});

test("Augmented Negotiators blocking makes the attacking rival choose and discard one of their cards", () => {
    const withHand = [0, 1].reduce(s => put(s, plainUnit, actor).state, base);
    const hand = handOf(withHand, actor);
    assert.ok(hand.length >= 2);
    const a = attackInto(NEGOTIATORS, () => withHand), before = handOf(a.state, actor), rivalHand = handOf(a.state, rival);
    const blocked = block(a.state, a.blockerId).state;
    assert.equal(blocked.timing.step, "DISCARD_SELECTION");
    assert.equal(blocked.resolution.choice!.actorId, actor, "the affected player chooses");
    assert.deepEqual(blocked.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null), before);
    const forged = GameStateSchema.parse(blocked); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: rivalHand[0] ?? a.blockerId });
    assert.equal(validateState(forged, context).ok, false, "only the attacking player's own hand");
    const done = pick(blocked, context, o => o.kind === "CARD" && o.cardInstanceId === before[1]);
    assert.equal(done.state.objects.cards[before[1]].zone.zone, "TRASH");
    assert.deepEqual(handOf(done.state, actor), before.filter(id => id !== before[1]));
    assert.deepEqual(handOf(done.state, rival), rivalHand);
    assert.ok(done.events.some(e => e.payload.kind === "CARD_DISCARDED" && e.payload.playerId === actor && e.payload.cardInstanceId === before[1]));
    assert.equal(done.state.timing.step, "RIVAL_REACT"); assert.equal(done.state.timing.actingPlayer, rival);
});

test("one card is discarded automatically; an empty hand discards nothing", () => {
    const emptyHand = (s: GameState) => { const d = GameStateSchema.parse(s); for (const id of [...d.players[actor].zones.HAND]) { d.players[actor].zones.HAND = d.players[actor].zones.HAND.filter(x => x !== id); d.players[actor].zones.DECK.push(id); d.objects.cards[id].zone = { playerId: actor, zone: "DECK" }; } return unwrap(validateState(d, context)); };
    const empty = attackInto(NEGOTIATORS, emptyHand), none = block(empty.state, empty.blockerId);
    assert.equal(none.state.timing.step, "RIVAL_REACT");
    assert.equal(none.events.some(e => e.payload.kind === "CARD_DISCARDED"), false);
    const one = attackInto(NEGOTIATORS, s => put(emptyHand(s), plainUnit, actor).state), card = handOf(one.state, actor)[0];
    const forced = block(one.state, one.blockerId);
    assert.equal(forced.state.timing.step, "RIVAL_REACT");
    assert.equal(forced.state.objects.cards[card].zone.zone, "TRASH");
    assert.ok(forced.events.some(e => e.payload.kind === "CARD_DISCARDED" && e.payload.playerId === actor && e.payload.forced === true));
});

test("the reviewed union admits the V17 cards", () => {
    const ids: string[] = reviewedUnionContext().content.cards.map(c => c.id);
    for (const id of [LLORONA, NEGOTIATORS]) assert.ok(ids.includes(id), id);
});
