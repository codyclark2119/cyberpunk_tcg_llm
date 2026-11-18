import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { playPaymentAmount, supportsPlayCostReduction } from "../packages/engine/src/play-cost-support";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsGear } from "../packages/engine/src/attachments";
import { effectivePower } from "../packages/engine/src/characteristics";
import { numericCost } from "../packages/engine/src/cost-value";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV16Cards, batchV16Context, batchV16Input, v16Source, CARNAGE, BERSERK } from "./api-admission-batch-v16-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { placeCard, playCard, pick, withGigs } from "./value-conditions-focused";
import { clearField, fund, field, finishOrder } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV16Context();
const card = (id: string) => batchV16Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV16Input("batch-v16"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_OWN_TURN_ENDS"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
function units(s: GameState, specs: [number, PlayerId][]) {
    const ids: CardInstanceId[] = []; let state = s;
    for (const [power, player] of specs) { const f = field(state, context, unitOfPower(power), player); state = f.state; ids.push(f.id); }
    return { state, ids };
}
/** Leaves exactly `count` ready Eddies, and no ready Legend that could pay, for the active player. */
function eddies(s: GameState, count: number) {
    const d = GameStateSchema.parse(s);
    for (const id of d.players[actor].zones.LEGENDS) d.objects.cards[id].readiness = "SPENT";
    d.players[actor].zones.EDDIES.forEach((id, i) => { d.objects.cards[id].readiness = i < count ? "READY" : "SPENT"; });
    return unwrap(validateState(d, context));
}
/** Flips the first `count` Legends of `player` face up (trusted arrangement); the rest stay face down. */
function faceUp(s: GameState, player: PlayerId, count: number) {
    const d = GameStateSchema.parse(s);
    d.players[player].zones.LEGENDS.forEach((id, i) => { if (i < count) d.objects.cards[id].face = "UP"; });
    return unwrap(validateState(d, context));
}
const zone = (s: GameState, id: string) => s.objects.cards[id as CardInstanceId].zone.zone;
const optionIds = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const canPlay = (s: GameState, id: string) => unwrap(listLegalActions(s, actor, context)).some(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id);
const paid = (events: { payload: { kind: string } }[]) => events.flatMap(e => e.payload.kind === "PAYMENT_MADE" ? [(e.payload as unknown as { sources: unknown[] }).sources.length] : []);
const faces = (g: { dieType: string }) => Number(g.dieType.slice(1));

test("V16 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV16Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v16Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(CARNAGE).rulesText, "Play this Program for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$.\nDefeat a rival Unit with less power than a friendly Unit.");
    assert.equal(card(BERSERK).rulesText, "Play this Gear for -1 €$ for each friendly face-up Legend, to a minimum of 1 €$.");
});

test("each V16 card passes only its own exact pins; any changed field is rejected", () => {
    for (const c of batchV16Cards) { assert.ok(supportsPlayCostReduction(c, context).ok, c.id); assert.ok(supportsPlay(c, context).ok, c.id); }
    assert.ok(supportsTargetedDefeatCard(card(CARNAGE), context).ok);
    assert.ok(supportsGear(card(BERSERK), context).ok);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const reduction = (per: string) => ({ kind: "SELF_PLAY_COST_REDUCTION", per, amount: 1, minimum: 1 }) as never;
    const edits: [string, string, (d: CardRevisionSnapshot) => void][] = [
        [CARNAGE, "no reduction", d => { d.mechanics.modifiers = []; }],
        [CARNAGE, "other count", d => { d.mechanics.modifiers = [reduction("RIVAL_UNIT")]; }],
        [CARNAGE, "fixed bound", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 4 } } }]; }],
        [CARNAGE, "any relation", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "LESS_THAN_FRIENDLY_UNIT" } } }]; }],
        [CARNAGE, "cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        [CARNAGE, "tags", d => { d.tags = ["Braindance"]; }],
        [BERSERK, "power", d => { d.power = 4; }],
        [BERSERK, "no printed power grant", d => { d.mechanics.modifiers = [reduction("FRIENDLY_FACE_UP_LEGEND")]; }],
        [BERSERK, "modifier order", d => { d.mechanics.modifiers = [reduction("FRIENDLY_FACE_UP_LEGEND"), { kind: "GRANT_PRINTED_POWER_TO_HOST" }]; }],
        [BERSERK, "other count", d => { d.mechanics.modifiers = [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, reduction("RIVAL_UNIT")]; }],
        [BERSERK, "extra ability", d => { d.mechanics.abilities = [{ id: "x", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }]; }],
        [BERSERK, "no equip", d => { delete d.mechanics.equip; }],
        [BERSERK, "plain scope", d => { d.execution = { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" }; }]
    ];
    for (const [id, label, edit] of edits) assert.equal(supportsPlay(forge(card(id), edit), context).ok, false, `${id}: ${label}`);
    const reductionOnUnit = forge(card(BERSERK), d => { d.mechanics.modifiers = [reduction("FRIENDLY_FACE_UP_LEGEND")]; delete d.mechanics.equip; d.type = "UNIT"; d.execution = { scope: "PLAY_COST_REDUCTION_V1", status: "SUPPORTED" }; });
    assert.equal(supportsPlay(reductionOnUnit, context).ok, false, "the face-up-Legend count is pinned to Zetatech Berserk only");
});

test("Carnage at the Colosseum pays 1 less per friendly Gig of 8+, never below 1, and keeps its cost value", () => {
    const all = Object.values(base.objects.gigs), gigs = all.filter(g => g.controllerId === actor && faces(g) >= 8 && faces(g) < 20).sort((a, b) => faces(a) - faces(b)).map(g => g.id);
    assert.ok(gigs.length >= 3);
    const placed = placeCard(withGigs(base, context, { [gigs[0]]: 8, [gigs[1]]: 9, [gigs[2]]: 7 }), context, CARNAGE);
    assert.equal(playPaymentAmount(placed.state, actor, placed.id, context), 4);
    assert.equal(numericCost(placed.state, placed.id, context), 6, "3.11.1.2: the cost value is unchanged");
    assert.equal(canPlay(eddies(placed.state, 3), placed.id), false);
    const played = playCard(eddies(placed.state, 4), context, CARNAGE);
    assert.deepEqual(paid(played.events), [4]);
    assert.equal(zone(played.state, placed.id), "TRASH");
    const none = placeCard(withGigs(base, context, { [gigs[0]]: 7 }), context, CARNAGE);
    assert.equal(playPaymentAmount(none.state, actor, none.id, context), 6);
});

test("Carnage defeats a rival Unit with less power than some friendly Unit", () => {
    const u = units(base, [[5, actor], [3, actor], [4, rival], [5, rival], [6, rival], [0, rival]]);
    const played = playCard(placeCard(u.state, context, CARNAGE).state, context, CARNAGE);
    assert.equal(played.state.timing.step, "TARGET_SELECTION");
    assert.deepEqual(optionIds(played.state).sort(), [u.ids[2], u.ids[5]].sort(), "rival power 4 and 0 are below the friendly 5; 5 and 6 are not; own Units never");
    const forged = GameStateSchema.parse(played.state); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: u.ids[3] });
    assert.equal(validateState(forged, context).ok, false, "an equal-power rival Unit cannot be offered");
    const done = finishOrder(pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === u.ids[2]).state, context).state;
    assert.equal(done.resolution.choice, null);
    assert.deepEqual(u.ids.map(id => zone(done, id)), ["BATTLEFIELD", "BATTLEFIELD", "TRASH", "BATTLEFIELD", "BATTLEFIELD", "BATTLEFIELD"]);
});

test("Carnage with no friendly Unit, or none stronger, defeats nothing", () => {
    const alone = units(base, [[3, rival]]), a = playCard(placeCard(alone.state, context, CARNAGE).state, context, CARNAGE).state;
    assert.equal(a.resolution.choice, null);
    assert.equal(zone(a, alone.ids[0]), "BATTLEFIELD");
    const weaker = units(base, [[3, actor], [3, rival], [4, rival]]), w = playCard(placeCard(weaker.state, context, CARNAGE).state, context, CARNAGE).state;
    assert.equal(w.resolution.choice, null);
    assert.deepEqual(weaker.ids.map(id => zone(w, id)), ["BATTLEFIELD", "BATTLEFIELD", "BATTLEFIELD"]);
});

test("Zetatech Berserk pays 1 less per friendly face-up Legend and grants its printed power", () => {
    const legends = base.players[actor].zones.LEGENDS.length;
    assert.ok(legends >= 2);
    const host = units(faceUp(faceUp(base, actor, 2), rival, 3), [[3, actor]]);
    const placed = placeCard(host.state, context, BERSERK);
    assert.equal(playPaymentAmount(placed.state, actor, placed.id, context), 4, "two own face-up Legends; face-down and rival Legends do not count");
    assert.equal(numericCost(placed.state, placed.id, context), 6);
    assert.equal(canPlay(eddies(placed.state, 3), placed.id), false);
    let played = playCard(eddies(placed.state, 4), context, BERSERK);
    assert.deepEqual(paid(played.events), [4]);
    if (played.state.resolution.choice) played = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === host.ids[0]);
    assert.ok(played.state.objects.cards[host.ids[0]].attachments.includes(placed.id));
    assert.equal(effectivePower(played.state, host.ids[0], context), 6);
    const none = placeCard(units(base, [[3, actor]]).state, context, BERSERK);
    assert.equal(playPaymentAmount(none.state, actor, none.id, context), 6);
});

test("the reviewed union admits the V16 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [CARNAGE, BERSERK]) assert.ok(ids.has(id), id);
});
