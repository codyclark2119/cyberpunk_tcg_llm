import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, observe, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPinnedPlayUnit } from "../packages/engine/src/play-pin-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { effectiveKeywords } from "../packages/engine/src/capabilities";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV20Cards, batchV20Context, batchV20Input, v20Source, HACKED, RACER } from "./api-admission-batch-v20-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { placeCard, playCard, pick, withGigs } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV20Context();
const card = (id: string) => batchV20Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV20Input("batch-v20"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const reviewed = (type: string, ok: (c: CardRevisionSnapshot) => boolean = () => true) => context.content.cards.filter(c => c.schemaVersion === 2 && c.type === type && supportsPlay(c, context).ok && ok(c as CardRevisionSnapshot));
const programs = reviewed("PROGRAM").map(c => c.id);
const plain = (c: CardRevisionSnapshot) => !c.mechanics.keywords.length && !c.mechanics.modifiers.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length && c.printedCost.kind === "EDDIES";
const cheap = reviewed("UNIT", c => plain(c) && c.printedCost.kind === "EDDIES" && c.printedCost.amount <= 5).map(c => c.id);
// No plain reviewed Unit costs 6+; a fielded one's own text never runs here (it is placed, not played).
const costly = reviewed("UNIT", c => !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && c.printedCost.kind === "EDDIES" && c.printedCost.amount > 5 && c.printedCost.amount < 10).map(c => c.id);
const nonProgram = reviewed("UNIT", plain)[0].id;
const zone = (s: GameState, id: string) => s.objects.cards[id as CardInstanceId].zone.zone;
const optionIds = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const gigOf = (s: GameState, p: PlayerId) => Object.values(s.objects.gigs).filter(g => g.controllerId === p).map(g => g.id).sort()[0] as GigInstanceId;
/** Trusted arrangement: Hacked Corpo in hand and the actor's top deck cards rewritten as `top` (an empty list empties the deck). */
function arrangeDeck(s: GameState, top: string[] | null) {
    const m = new TurnMutation(s, context), deck = m.state.players[actor].zones.DECK;
    if (top === null) { for (const id of [...deck]) { m.state.objects.cards[id].zone = { playerId: actor, zone: "TRASH" }; m.state.objects.cards[id].face = "UP"; m.state.players[actor].zones.TRASH.push(id); } deck.length = 0; }
    else top.forEach((cardId, i) => { const t = m.state.objects.cards[deck[i]], r = context.content.cards.find(x => x.id === cardId)!; t.cardId = r.id; t.revision = r.revision; });
    return { state: unwrap(validateState(m.state, context)), top: deck.slice(0, top?.length ?? 0) };
}
/** Trusted arrangement: the bottom deck card of `player` rewritten as `cardId` and moved to hand or the field (`lag`: it entered this turn). */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "BATTLEFIELD", lag = false) {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, where);
    if (where === "BATTLEFIELD") { c.readiness = "READY"; c.statuses = lag ? ["LAG"] : []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
const lagging = (s: GameState, cardId: string) => put(s, cardId, actor, "BATTLEFIELD", true);
const fielded = (s: GameState, cardId: string, player: PlayerId) => put(s, cardId, player, "BATTLEFIELD");
const racerInHand = (s: GameState) => put(s, RACER, actor, "HAND").state;

test("V20 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV20Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v20Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.ok(programs.length >= 2 && cheap.length >= 2 && costly.length >= 1, "the bundle has the reviewed cards these tests need");
});

test("each V20 card passes only its exact pin; any changed field is rejected", () => {
    for (const c of batchV20Cards) for (const gate of [supportsPinnedPlayUnit, supportsTriggerCard, supportsPlay]) assert.ok(gate(c, context).ok, `${c.id}: ${gate.name}`);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const edits: [string, string, (d: CardRevisionSnapshot) => void][] = [
        [HACKED, "attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        [HACKED, "second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        [HACKED, "Unit pick", d => { d.mechanics.abilities[0].effects = [{ kind: "TRASH_THEN_RETURN_UNIT", count: 3 }]; }],
        [HACKED, "cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        [HACKED, "power", d => { d.power = 4; }],
        [HACKED, "tags", d => { d.tags = ["Corpo"]; }],
        [HACKED, "sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        [HACKED, "keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        [RACER, "attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        [RACER, "second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        [RACER, "condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "STREET_CRED_GREATER_THAN_RIVAL" }] as never; }],
        [RACER, "color", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        [RACER, "inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }],
        [RACER, "printed Adrenaline", d => { d.mechanics.keywords = ["ADRENALINE"]; }]
    ];
    for (const [id, label, edit] of edits) { const f = forge(card(id), edit); assert.equal(supportsTriggerCard(f, context).ok, false, `${id}: ${label}`); assert.equal(supportsPinnedPlayUnit(f, context).ok, false, `${id}: ${label}`); }
});

test("Hacked Corpo trashes the top 3 and its controller picks a Program from among them", () => {
    const placed = placeCard(base, context, HACKED), deck = arrangeDeck(placed.state, [programs[0], nonProgram, programs[1]]);
    const handBefore = deck.state.players[actor].zones.HAND.length, s = playCard(deck.state, context, HACKED).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(s.players[actor].zones.TRASH.slice(-3), deck.top, "trashed one at a time in deck order (11.10.2.1.1)");
    assert.deepEqual(optionIds(s), [deck.top[0], deck.top[2]].sort(), "only Programs among the trashed cards");
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: deck.top[1] });
    assert.equal(validateState(forged, context).ok, false, "a trashed Unit cannot be offered");
    const short = GameStateSchema.parse(s); short.resolution.triggerContinuation!.trashedIds = deck.top.slice(1);
    assert.equal(validateState(short, context).ok, false, "a pause holds all 3 trashed cards while the deck is not empty");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === deck.top[2]);
    assert.equal(zone(done.state, deck.top[2]), "HAND");
    assert.deepEqual([zone(done.state, deck.top[0]), zone(done.state, deck.top[1])], ["TRASH", "TRASH"]);
    assert.equal(done.state.players[actor].zones.HAND.length, handBefore, "Hacked Corpo left the hand and one Program joined it");
    assert.equal(done.state.resolution.triggerContinuation, undefined);
    assert.ok(done.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && (e.payload as { forced: boolean }).forced === false));
});

test("Hacked Corpo: one Program returns automatically; none returns nothing; an empty deck trashes nothing", () => {
    const one = arrangeDeck(placeCard(base, context, HACKED).state, [nonProgram, programs[0], nonProgram]);
    const a = playCard(one.state, context, HACKED).state;
    assert.equal(a.resolution.choice, null);
    assert.equal(zone(a, one.top[1]), "HAND");
    const none = arrangeDeck(placeCard(base, context, HACKED).state, [nonProgram, nonProgram, nonProgram]);
    const b = playCard(none.state, context, HACKED).state;
    assert.equal(b.resolution.choice, null);
    assert.deepEqual(none.top.map(id => zone(b, id)), ["TRASH", "TRASH", "TRASH"]);
    const empty = arrangeDeck(placeCard(base, context, HACKED).state, null), trash = empty.state.players[actor].zones.TRASH.length;
    const c = playCard(empty.state, context, HACKED).state;
    assert.equal(c.resolution.choice, null);
    assert.equal(c.match.outcome, undefined, "trashing from an empty deck is not a loss (only drawing loses, 1.14)");
    assert.equal(c.players[actor].zones.TRASH.length, trash);
});

test("Valentino Street Racer gives another friendly Unit with cost 5 or less Adrenaline, so a lagging Unit can attack", () => {
    let s = withGigs(base, context, { [gigOf(base, rival)]: 2 });
    const fresh = lagging(s, cheap[0]); s = fresh.state;
    const other = fielded(s, cheap[1], actor); s = other.state;
    const big = fielded(s, costly[0], actor); s = big.state;
    const rivalUnit = fielded(s, cheap[0], rival); s = rivalUnit.state;
    const canAttack = (x: GameState) => unwrap(listLegalActions(x, actor, context)).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === fresh.id);
    assert.equal(canAttack(s), false, "a lagging Unit cannot attack without Adrenaline");
    const played = playCard(racerInHand(s), context, RACER).state;
    assert.equal(played.timing.step, "TARGET_SELECTION");
    const racer = Object.values(played.objects.cards).find(c => c.cardId === RACER && c.zone.zone === "BATTLEFIELD")!.id;
    assert.deepEqual(optionIds(played), [fresh.id, other.id].sort(), "another friendly Unit with cost 5 or less: not the Racer itself, not cost 6+, not a rival Unit");
    const forged = GameStateSchema.parse(played); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: big.id });
    assert.equal(validateState(forged, context).ok, false, "a cost 6+ Unit cannot be offered");
    const done = pick(played, context, o => o.kind === "CARD" && o.cardInstanceId === fresh.id).state;
    assert.ok(effectiveKeywords(done, fresh.id, context).includes("ADRENALINE"));
    assert.equal(effectiveKeywords(done, racer, context).includes("ADRENALINE"), false);
    assert.equal(canAttack(done), true, "11.23.2: Adrenaline lets the lagging Unit attack");
    assert.deepEqual(unwrap(observe(done, rival, context)).temporaryKeywords?.map(g => g.targetId), [fresh.id], "the grant is public");
    const forgedGrant = GameStateSchema.parse(done); forgedGrant.temporaryKeywords![0].targetId = big.id as CardInstanceId;
    assert.equal(validateState(forgedGrant, context).ok, false, "a recorded grant must keep an eligible target");
    const left = new TurnMutation(done, context); moveCardLocation(left, fresh.id, "HAND");
    assert.equal(left.state.temporaryKeywords, undefined, "a card that leaves the field loses the grant; it would return as a new object");
    assert.ok(unwrap(validateState(left.state, context)));
    const ended = take(done, context, a => a.action.kind === "END_TURN");
    assert.equal(ended.state.temporaryKeywords, undefined, "the grant expires at end of turn");
    assert.ok(ended.events.some(e => e.payload.kind === "KEYWORD_GRANT_EXPIRED"));
});

test("Valentino Street Racer: a single eligible Unit is chosen automatically, and none means nothing happens", () => {
    let s = withGigs(base, context, { [gigOf(base, rival)]: 2 });
    const only = lagging(s, cheap[0]); s = fielded(only.state, costly[0], actor).state;
    const a = playCard(racerInHand(s), context, RACER);
    assert.equal(a.state.resolution.choice, null);
    assert.ok(effectiveKeywords(a.state, only.id, context).includes("ADRENALINE"));
    assert.ok(a.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && (e.payload as { forced: boolean }).forced === true));
    const alone = playCard(racerInHand(base), context, RACER).state;
    assert.equal(alone.resolution.choice, null);
    assert.equal(alone.temporaryKeywords, undefined);
});

test("V20 cards are members of the reviewed union", () => {
    const union = reviewedUnionContext();
    for (const c of batchV20Cards) assert.ok(union.content.cards.some(u => u.id === c.id && u.revision === c.revision), c.id);
});
