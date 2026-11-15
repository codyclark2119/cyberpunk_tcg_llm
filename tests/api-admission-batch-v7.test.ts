import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, RulesView } from "@tcg/engine";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV7Cards, batchV7Context, batchV7Input, v7Source, DELAMAIN, ROYCE_SIMON, WILD_STREETS } from "./api-admission-batch-v7-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { withGigs, placeCard, playCard, pick } from "./value-conditions-focused";
import { clearField, fund, field, finishOrder } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV7Context();
const card = (id: string) => batchV7Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV7Input("batch-v7"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** A reviewed, playable Unit of exactly this printed power with no static modifiers and no PLAY or DEFEATED trigger. */
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
function place(s: GameState, power: number, player = rival, readiness: "READY" | "SPENT" = "READY") {
    const placed = field(s, context, unitOfPower(power), player), d = GameStateSchema.parse(placed.state);
    d.objects.cards[placed.id].readiness = readiness;
    return { state: d, id: placed.id };
}
const d6 = (player: string) => Object.values(base.objects.gigs).find(g => g.controllerId === player && g.dieType === "D6")!.id;
const gigs = (lead: boolean) => ({ [d6(actor)]: lead ? 6 : 1, [d6(rival)]: lead ? 1 : 6 });
const defeatTargets = (s: GameState, id: string) => {
    const e = card(id).mechanics.abilities[0].effects[0]; assert.ok(e.kind === "DEFEAT_UNIT" && e.target.kind === "UNITS");
    return new RulesView(s, context).listDefeatableUnits(actor, e.target);
};

test("V7 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV7Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v7Source(c.id)));
        assert.equal(c.rulesText, v7Source(c.id).rules_text);
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(ROYCE_SIMON).rulesText, "{Play} Defeat a rival Unit with power 2 or less. If you have more ☆ (Street Cred) than a Rival, defeat a rival Unit with power 3 or less instead.");
    assert.equal(card(WILD_STREETS).rulesText, "Defeat a spent Unit.");
    assert.equal(card(DELAMAIN).rulesText, "{Play} Draw 2.\n(Units with power 0 don't steal Gigs.)");
});

test("each V7 card passes only its own exact pin; any changed field is rejected", () => {
    assert.ok(supportsTargetedDefeatCard(card(ROYCE_SIMON), context).ok);
    assert.ok(supportsTargetedDefeatCard(card(WILD_STREETS), context).ok);
    assert.ok(supportsTriggerCard(card(DELAMAIN), context).ok);
    for (const c of batchV7Cards) assert.ok(supportsPlay(c, context).ok, c.id);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const defeatEffect = (d: CardRevisionSnapshot) => { const e = d.mechanics.abilities[0].effects[0]; assert.ok(e.kind === "DEFEAT_UNIT" && e.target.kind === "UNITS"); return e.target; };
    const royce: [string, (d: CardRevisionSnapshot) => void][] = [
        ["bound", d => { const t = defeatEffect(d); if (t.power.kind === "AT_MOST") t.power.value = 3; }],
        ["instead bound", d => { defeatEffect(d).instead!.power.value = 4; }],
        ["no instead", d => { delete defeatEffect(d).instead; }],
        ["relation", d => { defeatEffect(d).relation = "ANY"; }],
        ["readiness", d => { defeatEffect(d).readiness = "SPENT"; }],
        ["power", d => { d.power = 5; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }]
    ];
    for (const [label, edit] of royce) assert.equal(supportsTargetedDefeatCard(forge(card(ROYCE_SIMON), edit), context).ok, false, label);
    const wild: [string, (d: CardRevisionSnapshot) => void][] = [
        ["ready only", d => { delete defeatEffect(d).readiness; }],
        ["rival only", d => { defeatEffect(d).relation = "RIVAL"; }],
        ["bounded", d => { defeatEffect(d).power = { kind: "AT_MOST", value: 9 }; }],
        ["ram", d => { d.ram = { GREEN: 3 }; }]
    ];
    for (const [label, edit] of wild) assert.equal(supportsTargetedDefeatCard(forge(card(WILD_STREETS), edit), context).ok, false, label);
    const delamain: [string, (d: CardRevisionSnapshot) => void][] = [
        ["draw 3", d => { d.mechanics.abilities[0].effects = [{ kind: "DRAW", count: 3 }]; }],
        ["power", d => { d.power = 1; }],
        ["trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["tags", d => { d.tags = ["AI", "Netrunner"]; }]
    ];
    for (const [label, edit] of delamain) assert.equal(supportsTriggerCard(forge(card(DELAMAIN), edit), context).ok, false, label);
});

test("Royce: power 2 or less, or 3 or less only while the controller has more Street Cred than the Rival", () => {
    let s = place(base, 2).state; const two = Object.values(s.objects.cards).find(c => c.zone.zone === "BATTLEFIELD" && c.controllerId === rival)!.id;
    const third = place(s, 3); s = third.state; const four = place(s, 4); s = four.state;
    assert.ok(place(s, 2, actor)); // own Units are never rival targets
    const behind = withGigs(s, context, gigs(false)), ahead = withGigs(s, context, gigs(true));
    assert.deepEqual(defeatTargets(behind, ROYCE_SIMON), [two]);
    assert.deepEqual(defeatTargets(ahead, ROYCE_SIMON), [two, third.id].sort());
    // Ahead with two eligible targets: the play pauses for a strategic target choice, then defeats it.
    let played = playCard(placeCard(ahead, context, ROYCE_SIMON).state, context, ROYCE_SIMON);
    assert.equal(played.state.resolution.targetedDefeatContinuation?.phase, "TARGET");
    assert.deepEqual(played.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [two, third.id].sort());
    const chosen = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === third.id);
    const done = finishOrder(chosen.state, context).state;
    assert.equal(done.objects.cards[third.id].zone.zone, "TRASH");
    assert.equal(done.objects.cards[two].zone.zone, "BATTLEFIELD");
    assert.equal(done.objects.cards[four.id].zone.zone, "BATTLEFIELD");
    // Behind with one eligible target: the mandatory defeat resolves without a choice.
    played = playCard(placeCard(behind, context, ROYCE_SIMON).state, context, ROYCE_SIMON);
    const forced = finishOrder(played.state, context).state;
    assert.equal(forced.objects.cards[two].zone.zone, "TRASH");
    assert.equal(forced.objects.cards[third.id].zone.zone, "BATTLEFIELD");
});

test("Wild in the Streets: any spent Unit of any power on either side, never a ready one", () => {
    let s = base; const ids: Record<string, CardInstanceId> = {};
    for (const [key, power, player, readiness] of [["rivalSpent", 4, rival, "SPENT"], ["rivalReady", 2, rival, "READY"], ["ownSpent", 3, actor, "SPENT"]] as const) { const p = place(s, power, player, readiness); s = p.state; ids[key] = p.id; }
    assert.deepEqual(defeatTargets(s, WILD_STREETS), [ids.rivalSpent, ids.ownSpent].sort());
    const played = playCard(placeCard(s, context, WILD_STREETS).state, context, WILD_STREETS);
    assert.equal(played.state.resolution.targetedDefeatContinuation?.phase, "TARGET");
    const done = finishOrder(pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === ids.ownSpent).state, context).state;
    assert.equal(done.objects.cards[ids.ownSpent].zone.zone, "TRASH");
    assert.equal(done.objects.cards[ids.rivalSpent].zone.zone, "BATTLEFIELD");
    assert.equal(done.objects.cards[ids.rivalReady].zone.zone, "BATTLEFIELD");
    // No spent Unit: the Program still resolves, with no defeat.
    const none = place(base, 4, rival, "READY").state, empty = playCard(placeCard(none, context, WILD_STREETS).state, context, WILD_STREETS);
    assert.equal(empty.state.resolution.choice, null);
    assert.equal(empty.events.filter(e => e.payload.kind === "CARD_DEFEATED").length, 0);
});

test("Delamain: playing it draws exactly two cards", () => {
    const placed = placeCard(base, context, DELAMAIN), hand = placed.state.players[actor].zones.HAND.length, deck = placed.state.players[actor].zones.DECK.length;
    const played = playCard(placed.state, context, DELAMAIN);
    assert.equal(played.state.resolution.choice, null);
    assert.equal(played.state.objects.cards[placed.id].zone.zone, "BATTLEFIELD");
    assert.equal(played.state.players[actor].zones.HAND.length, hand - 1 + 2);
    assert.equal(played.state.players[actor].zones.DECK.length, deck - 2);
});

test("the reviewed union admits the V7 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [ROYCE_SIMON, WILD_STREETS, DELAMAIN]) assert.ok(ids.has(id), id);
});
