import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTargetedGearDefeatCard } from "../packages/engine/src/targeted-gear-defeat-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV34Cards, batchV34Context, batchV34Input, v34Source, HEYWOOD } from "./api-admission-batch-v34-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV34Context();
const heywood = batchV34Cards[0];
// A vanilla Unit (power 4), and reviewed Gear with cost 1 (Mantis Blades) and cost 3 (Sandevistan).
const ATLUS = "emergency-atlus", MANTIS = "mantis-blades", SANDEVISTAN = "sandevistan";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV34Input("batch-v34"), context)).state;
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
/** A friendly 3 and a rival 1; the actor's Mantis Blades (cost 1) and the rival's Sandevistan (cost 3) are each equipped to a Unit. */
function arrange() {
    const own = equipped(gigs(base, [{ player: actor, die: "D4", value: 3 }, { player: rival, die: "D6", value: 1 }]), actor, MANTIS);
    const theirs = equipped(own.state, rival, SANDEVISTAN), hand = put(theirs.state, HEYWOOD, actor, "HAND");
    return { state: hand.state, own, theirs };
}
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const handAfterPlay = (s: GameState) => s.players[actor].zones.HAND.length - 1;

test("the V34 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(heywood.provenance.sourceHash, hashCanonical(v34Source(heywood.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === heywood.id), [heywood]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Heywood Ripperdoc passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTargetedGearDefeatCard(heywood, context).ok); assert.ok(supportsPlay(heywood, context).ok);
    assert.equal(supportsTriggerCard(heywood, context).ok, false, "its scope is the Gear-defeat scope only");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(heywood) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const effect = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { optional?: true; draw?: unknown; target: { relation: string } };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["rival Gear only", d => { effect(d).target.relation = "RIVAL"; }],
        ["mandatory", d => { delete effect(d).optional; }],
        ["no draw", d => { delete effect(d).draw; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["trigger scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["power", d => { d.power = 7; }],
        ["tags", d => { d.tags = ["Corpo"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTargetedGearDefeatCard(forge(edit), context).ok, false, label);
});

test("{Play} offers every Gear on the field and a decline; a Gear whose cost matches a friendly Gig draws 1", () => {
    const a = arrange(), hand = handAfterPlay(a.state);
    const s = playCard(a.state, context, HEYWOOD).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(cards(s), [a.own.gear, a.theirs.gear].sort(), "friendly and rival Gear alike");
    assert.ok(s.resolution.choice!.options.some(o => o.kind === "CONFIRM" && !o.confirmed));
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: a.own.host });
    assert.equal(validateState(forged, context).ok, false, "a Unit is never a Gear target");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.theirs.gear);
    assert.equal(done.state.objects.cards[a.theirs.gear].zone.zone, "TRASH"); assert.equal(done.state.objects.cards[a.theirs.gear].zone.playerId, rival);
    assert.equal(done.state.objects.cards[a.theirs.host].zone.zone, "BATTLEFIELD"); assert.deepEqual(done.state.objects.cards[a.theirs.host].attachments, []);
    assert.ok(done.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === true), "Sandevistan costs 3, the friendly d4's value");
    assert.equal(done.state.players[actor].zones.HAND.length, hand + 1);
    assert.equal(done.state.timing.step, "MAIN");
});

test("a friendly Gear can be defeated; a cost matched only by a Rival's Gig draws nothing", () => {
    const a = arrange(), hand = handAfterPlay(a.state);
    const done = pick(playCard(a.state, context, HEYWOOD).state, context, o => o.kind === "CARD" && o.cardInstanceId === a.own.gear);
    assert.equal(done.state.objects.cards[a.own.gear].zone.zone, "TRASH");
    assert.ok(done.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === false), "Mantis Blades costs 1; only the Rival has a 1");
    assert.equal(done.state.players[actor].zones.HAND.length, hand);
});

test("declining defeats nothing; a lone Gear is still optional; with no Gear nothing is offered", () => {
    const a = arrange(), hand = handAfterPlay(a.state);
    const declined = pick(playCard(a.state, context, HEYWOOD).state, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(declined.state.objects.cards[a.own.gear].zone.zone, "BATTLEFIELD"); assert.equal(declined.state.objects.cards[a.theirs.gear].zone.zone, "BATTLEFIELD");
    assert.equal(declined.state.players[actor].zones.HAND.length, hand); assert.equal(declined.state.timing.step, "MAIN");
    const lone = equipped(base, rival, SANDEVISTAN), s = playCard(put(lone.state, HEYWOOD, actor, "HAND").state, context, HEYWOOD).state;
    assert.equal(s.timing.step, "TARGET_SELECTION", "one Gear and the decline"); assert.deepEqual(cards(s), [lone.gear]);
    const none = playCard(put(put(base, ATLUS, rival, "READY").state, HEYWOOD, actor, "HAND").state, context, HEYWOOD);
    assert.equal(none.state.timing.step, "MAIN"); assert.equal(none.events.some(e => e.payload.kind === "CARD_DEFEATED"), false);
});

test("the reviewed union admits the V34 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === HEYWOOD));
});
