import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTargetedGearDefeatCard } from "../packages/engine/src/targeted-gear-defeat-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV55Cards, batchV55Context, batchV55Input, v55Source, MATON } from "./api-admission-batch-v55-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV55Context();
const maton = batchV55Cards[0];
// A vanilla Unit (cost 3, power 4), reviewed Gear with cost 1 (Mantis Blades) and cost 3 (Sandevistan), and rival Units with
// cost 3 (Field Operator, its {Play} long resolved) and cost 4 (Psycho Squad).
const ATLUS = "emergency-atlus", MANTIS = "mantis-blades", SANDEVISTAN = "sandevistan", OPERATOR = "field-operator", PSYCHO = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV55Input("batch-v55"), context)).state;
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
/** The actor's Mantis Blades and the rival's Sandevistan, each equipped to an ATLUS; Gilded Matón in hand; extra rival Units. */
function arrange(rivalUnits: string[] = [], ownGear = true, rivalGear = true) {
    let s = gigs(base, [{ player: actor, die: "D4", value: 3 }, { player: rival, die: "D6", value: 1 }]);
    const own = ownGear ? equipped(s, actor, MANTIS) : undefined; if (own) s = own.state;
    const theirs = rivalGear ? equipped(s, rival, SANDEVISTAN) : undefined; if (theirs) s = theirs.state;
    const extra: CardInstanceId[] = [];
    for (const id of rivalUnits) { const p = put(s, id, rival, "READY"); s = p.state; extra.push(p.id); }
    const hand = put(s, MATON, actor, "HAND");
    return { state: hand.state, own, theirs, extra, maton: hand.id };
}
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;

test("the V55 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(maton.provenance.sourceHash, hashCanonical(v55Source(maton.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === maton.id), [maton]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Gilded Matón passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTargetedGearDefeatCard(maton, context).ok); assert.ok(supportsPlay(maton, context).ok);
    assert.equal(supportsTriggerCard(maton, context).ok, false, "its scope is the Gear-defeat scope only");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(maton) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const effect = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { optional?: true; then?: { cost?: { value: number }; relation: string }; target: { relation: string } };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any Gear", d => { effect(d).target.relation = "ANY"; }],
        ["mandatory", d => { delete effect(d).optional; }],
        ["no second defeat", d => { delete effect(d).then; }],
        ["cost 2", d => { effect(d).then!.cost = { value: 2 } as never; Object.assign(effect(d).then!.cost!, { kind: "AT_MOST" }); }],
        ["any relation", d => { effect(d).then!.relation = "ANY"; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["power", d => { d.power = 4; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsTargetedGearDefeatCard, supportsPlay]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("{Play} offers only friendly Gear and a decline; defeating it lets the controller defeat a rival Unit with cost 3 or less", () => {
    const a = arrange([OPERATOR, PSYCHO]), [operator, psycho] = a.extra;
    const s = playCard(a.state, context, MATON).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(cards(s), [a.own!.gear], "the rival's Sandevistan is not friendly");
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "CONFIRM" && !o.confirmed));
    const then = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.own!.gear).state;
    assert.equal(zone(then, a.own!.gear), "TRASH");
    assert.equal(then.resolution.targetedDefeatContinuation?.phase, "THEN");
    assert.deepEqual(cards(then), [a.theirs!.host, operator].sort(), "cost 3 or less; Psycho Squad costs 4");
    assert.equal(then.resolution.choice!.options.some(o => o.kind === "CONFIRM"), false, "the second defeat is not optional");
    const forged = GameStateSchema.parse(structuredClone(then)); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: psycho });
    assert.equal(validateState(forged, context).ok, false);
    const early = GameStateSchema.parse(structuredClone(then)); early.resolution.triggerContinuation!.effectDefeats = [];
    assert.equal(validateState(early, context).ok, false, "the second clause needs the first defeat");
    const done = pick(then, context, o => o.kind === "CARD" && o.cardInstanceId === operator).state;
    assert.equal(zone(done, operator), "TRASH"); assert.equal(zone(done, a.theirs!.host), "BATTLEFIELD"); assert.equal(zone(done, a.maton), "BATTLEFIELD");
    assert.equal(done.timing.step, "MAIN");
});

test("one eligible rival Unit is defeated without a choice, and with none only the Gear is defeated", () => {
    const one = arrange([PSYCHO]);
    let forced = pick(playCard(one.state, context, MATON).state, context, o => o.kind === "CARD" && o.cardInstanceId === one.own!.gear);
    assert.ok(forced.events.some(e => e.payload.kind === "DEFEAT_TARGET_SELECTED" && (e.payload as { targetId?: string; forced?: boolean }).targetId === one.theirs!.host && (e.payload as { forced?: boolean }).forced === true));
    assert.equal(forced.state.timing.step, "DEFEAT_ORDER_SELECTION", "the rival orders ATLUS and its Sandevistan into the trash");
    assert.equal(forced.state.timing.actingPlayer, rival);
    while (forced.state.resolution.choice) { assert.ok(validateState(forced.state, context).ok); forced = choose(forced.state, context, 0); }
    assert.equal(zone(forced.state, one.theirs!.host), "TRASH"); assert.equal(zone(forced.state, one.theirs!.gear), "TRASH"); assert.equal(zone(forced.state, one.extra[0]), "BATTLEFIELD");
    assert.equal(forced.state.timing.step, "MAIN");
    const none = arrange([PSYCHO], true, false);
    const only = pick(playCard(none.state, context, MATON).state, context, o => o.kind === "CARD" && o.cardInstanceId === none.own!.gear).state;
    assert.equal(zone(only, none.own!.gear), "TRASH"); assert.equal(zone(only, none.extra[0]), "BATTLEFIELD"); assert.equal(only.timing.step, "MAIN");
});

test("declining defeats nothing, and with no friendly Gear nothing is offered", () => {
    const a = arrange([OPERATOR]);
    const declined = pick(playCard(a.state, context, MATON).state, context, o => o.kind === "CONFIRM" && !o.confirmed).state;
    for (const id of [a.own!.gear, a.theirs!.host, a.extra[0]]) assert.equal(zone(declined, id), "BATTLEFIELD");
    assert.equal(declined.timing.step, "MAIN");
    const bare = arrange([OPERATOR], false), none = playCard(bare.state, context, MATON).state;
    assert.equal(none.timing.step, "MAIN"); assert.equal(zone(none, bare.extra[0]), "BATTLEFIELD"); assert.equal(zone(none, bare.theirs!.gear), "BATTLEFIELD");
});

test("the reviewed union contains Gilded Matón", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === MATON));
});
