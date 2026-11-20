import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV31Cards, batchV31Context, batchV31Input, v31Source, CALIBER } from "./api-admission-batch-v31-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV31Context();
const caliber = batchV31Cards[0];
// Vanilla Units: cost 2 (power 2), cost 3 (power 4) and cost 4 (power 6); Adam Smasher has power 15.
const VOODOO = "jacked-in-voodoo-boy", ATLUS = "emergency-atlus", SQUAD = "psycho-squad", SMASHER = "adam-smasher-metal-over-meat";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV31Input("batch-v31"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the player's last deck card becomes `cardId` in hand, or on the field with the given readiness and no lag. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "READY" | "SPENT") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    if (where !== "HAND") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = where; c.statuses = []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: each listed die is rolled into its owner's Gig area at its value; all other dice wait in fixer areas. */
function gigs(s: GameState, rolled: { player: PlayerId; die: string; value: number }[]) {
    const d = GameStateSchema.parse(s);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const find = (x: { player: PlayerId; die: string }) => Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id;
    const chosen = new Map(rolled.map(x => [find(x), x.value]));
    for (const g of Object.values(d.objects.gigs)) {
        const value = chosen.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return unwrap(validateState(d, context));
}
const GIGS = [{ player: actor, die: "D4", value: 3 }, { player: rival, die: "D6", value: 4 }];
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();

/** Caliber, ready on the field, attacks a spent power-15 rival Unit and loses; the rival holds Atlus (cost 3) and Squad (cost 4). */
function defeatCaliber() {
    let s = gigs(base, GIGS); const hand: CardInstanceId[] = [];
    for (const c of [ATLUS, SQUAD]) { const placed = put(s, c, rival, "HAND"); s = placed.state; hand.push(placed.id); }
    const smasher = put(s, SMASHER, rival, "SPENT"), unit = put(smasher.state, CALIBER, actor, "READY");
    let r = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id);
    if (r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) r = pick(r.state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === smasher.id);
    r = take(r.state, context, a => a.action.kind === "PASS_REACT");
    assert.equal(r.state.objects.cards[unit.id].zone.zone, "TRASH", "5 power loses to 15");
    return { state: r.state, events: [...r.events], hand, caliberId: unit.id };
}

test("the V31 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(caliber.provenance.sourceHash, hashCanonical(v31Source(caliber.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === caliber.id), [caliber]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Caliber: Totentanz's Top Dog passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTargetedDefeatCard(caliber, context).ok); assert.ok(supportsPlay(caliber, context).ok);
    assert.equal(supportsTriggerCard(caliber, context).ok, false, "its scope is the targeted-defeat scope only");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(caliber) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const defeat = (d: CardRevisionSnapshot) => (d.mechanics.abilities[0].effects[0] as { target: { cost?: unknown } }).target;
    const discard = (d: CardRevisionSnapshot) => d.mechanics.abilities[1].effects[0] as { more?: unknown };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any cost", d => { delete defeat(d).cost; }],
        ["no second discard", d => { delete discard(d).more; }],
        ["no defeated discard", d => { d.mechanics.abilities = [d.mechanics.abilities[0]]; }],
        ["no play defeat", d => { d.mechanics.abilities = [d.mechanics.abilities[1]]; }],
        ["abilities reordered", d => { d.mechanics.abilities = [d.mechanics.abilities[1], d.mechanics.abilities[0]]; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["trigger scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 6; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTargetedDefeatCard(forge(edit), context).ok, false, label);
});

test("{Play} offers only rival Units with cost 2 or less; one such Unit is defeated without a choice", () => {
    let s = gigs(base, GIGS); const ids: CardInstanceId[] = [];
    for (const c of [VOODOO, VOODOO, ATLUS]) { const placed = put(s, c, rival, "READY"); s = placed.state; ids.push(placed.id); }
    const [v1, v2, atlus] = ids;
    const choice = playCard(put(s, CALIBER, actor, "HAND").state, context, CALIBER).state;
    assert.deepEqual(cards(choice), [v1, v2].sort(), "a cost-3 Unit is never offered");
    const done = pick(choice, context, o => o.kind === "CARD" && o.cardInstanceId === v2).state;
    assert.equal(done.objects.cards[v2].zone.zone, "TRASH"); assert.equal(done.objects.cards[v1].zone.zone, "BATTLEFIELD"); assert.equal(done.objects.cards[atlus].zone.zone, "BATTLEFIELD");
    const one = put(gigs(base, GIGS), VOODOO, rival, "READY"), other = put(one.state, ATLUS, rival, "READY");
    const forced = playCard(put(other.state, CALIBER, actor, "HAND").state, context, CALIBER);
    assert.equal(forced.state.timing.step, "MAIN");
    assert.equal(forced.state.objects.cards[one.id].zone.zone, "TRASH"); assert.equal(forced.state.objects.cards[other.id].zone.zone, "BATTLEFIELD");
});

test("{Defeated}: the Rival discards 1, and 1 more only when its cost equals a friendly Gig's value", () => {
    const a = defeatCaliber(), [atlus, squad] = a.hand;
    let s = a.state;
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.resolution.choice!.actorId, rival, "the Rival chooses their own discard");
    const first = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === atlus);
    s = first.state;
    assert.ok(first.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === true), "Atlus costs 3, the value of the friendly d4");
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.resolution.triggerContinuation!.discardedCardId, atlus);
    const forged = GameStateSchema.parse(s); forged.resolution.triggerContinuation!.discardedCardId = squad;
    assert.equal(validateState(forged, context).ok, false, "only a discarded card whose cost matched may hold the second discard open");
    const second = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === squad).state;
    assert.equal(second.objects.cards[squad].zone.zone, "TRASH");
    assert.equal(second.resolution.triggerContinuation, undefined);

    const b = defeatCaliber(), [, squad2] = b.hand, hand = b.state.players[rival].zones.HAND.length;
    const miss = pick(b.state, context, o => o.kind === "CARD" && o.cardInstanceId === squad2);
    assert.ok(miss.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === false), "Squad costs 4; the rival's own 4 is not friendly");
    assert.equal(miss.state.players[rival].zones.HAND.length, hand - 1, "only one discard");
    assert.notEqual(miss.state.timing.step, "DISCARD_SELECTION");
});

test("the reviewed union admits the V31 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === CALIBER));
});
