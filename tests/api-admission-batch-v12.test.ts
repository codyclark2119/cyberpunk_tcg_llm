import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV12Cards, batchV12Context, batchV12Input, v12Source, BONNIE, AFTERMATH } from "./api-admission-batch-v12-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { placeCard, playCard, pick, withGigs } from "./value-conditions-focused";
import { clearField, fund, field, finishOrder } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV12Context();
const card = (id: string) => batchV12Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV12Input("batch-v12"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_OWN_TURN_ENDS"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
/** Gig counts by player, using small values on non-D20 dice so roll order stays valid. */
function gigCounts(s: GameState, own: number, theirs: number) {
    const pickGigs = (p: string, n: number) => Object.values(s.objects.gigs).filter(g => g.controllerId === p && g.dieType !== "D20").slice(0, n).map(g => [g.id, 1] as const);
    return withGigs(s, context, Object.fromEntries([...pickGigs(actor, own), ...pickGigs(rival, theirs)]));
}
function units(s: GameState, specs: [number, string][]) {
    const ids: CardInstanceId[] = []; let state = s;
    for (const [power, player] of specs) { const f = field(state, context, unitOfPower(power), player as GameState["match"]["playerOrder"][number]); state = f.state; ids.push(f.id); }
    return { state, ids };
}
const zone = (s: GameState, id: string) => s.objects.cards[id as CardInstanceId].zone.zone;
const optionIds = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);

test("V12 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV12Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v12Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(BONNIE).rulesText, "Defeat a rival Unit with power 4 or less. You may defeat 2 instead if a Rival controls at least 2 Gigs more than you.");
    assert.equal(card(AFTERMATH).rulesText, "Each player defeats one of their Units.");
});

test("each V12 card passes only its own exact pin; any changed field is rejected", () => {
    for (const c of batchV12Cards) { assert.ok(supportsTargetedDefeatCard(c, context).ok, c.id); assert.ok(supportsPlay(c, context).ok, c.id); }
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const effect = (target: object) => (d: CardRevisionSnapshot) => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target } as never]; };
    const edits: [string, string, (d: CardRevisionSnapshot) => void][] = [
        [BONNIE, "no second", effect({ kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 4 } })],
        [BONNIE, "power 5", effect({ kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 }, second: { condition: { kind: "RIVAL_GIG_COUNT_LEAD_AT_LEAST", minimum: 2 } } })],
        [BONNIE, "any relation", effect({ kind: "UNITS", relation: "ANY", power: { kind: "AT_MOST", value: 4 }, second: { condition: { kind: "RIVAL_GIG_COUNT_LEAD_AT_LEAST", minimum: 2 } } })],
        [BONNIE, "cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        [AFTERMATH, "rival only", effect({ kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, each: "PLAYER_CHOOSES_OWN" })],
        [AFTERMATH, "no each", effect({ kind: "UNITS", relation: "CONTROLLED", power: { kind: "ANY" } })],
        [AFTERMATH, "tags", d => { d.tags = ["Braindance"]; }]
    ];
    for (const [id, label, edit] of edits) assert.equal(supportsTargetedDefeatCard(forge(card(id), edit), context).ok, false, `${id}: ${label}`);
});

test("Bonnie and Clyde defeats one rival Unit of power 4 or less without a Gig lead", () => {
    const u = units(gigCounts(base, 1, 2), [[3, rival], [4, rival], [5, rival], [3, actor]]);
    const played = playCard(placeCard(u.state, context, BONNIE).state, context, BONNIE);
    assert.equal(played.state.timing.step, "TARGET_SELECTION");
    assert.deepEqual(optionIds(played.state).sort(), [u.ids[0], u.ids[1]].sort(), "only rival Units of power 4 or less; a 1-Gig lead is not enough");
    const done = finishOrder(pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === u.ids[1]).state, context).state;
    assert.equal(done.resolution.choice, null);
    assert.deepEqual([zone(done, u.ids[0]), zone(done, u.ids[1]), zone(done, u.ids[2]), zone(done, u.ids[3])], ["BATTLEFIELD", "TRASH", "BATTLEFIELD", "BATTLEFIELD"]);
});

test("Bonnie and Clyde may defeat a second Unit while a Rival controls 2+ more Gigs", () => {
    const u = units(gigCounts(base, 1, 3), [[3, rival], [4, rival], [3, rival], [5, rival]]);
    const played = playCard(placeCard(u.state, context, BONNIE).state, context, BONNIE);
    const first = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === u.ids[0]).state;
    assert.equal(first.resolution.targetedDefeatContinuation!.phase, "SECOND");
    assert.deepEqual(optionIds(first).sort(), [u.ids[1], u.ids[2]].sort());
    assert.ok(first.resolution.choice!.options.some(o => o.kind === "CONFIRM" && !o.confirmed), "the second defeat is optional");
    const second = pick(first, context, o => o.kind === "CARD" && o.cardInstanceId === u.ids[2]), ordered = finishOrder(second.state, context);
    const both = { state: ordered.state, events: [...second.events, ...ordered.events] };
    assert.deepEqual([zone(both.state, u.ids[0]), zone(both.state, u.ids[1]), zone(both.state, u.ids[2]), zone(both.state, u.ids[3])], ["TRASH", "BATTLEFIELD", "TRASH", "BATTLEFIELD"]);
    const defeated = both.events.flatMap(e => e.payload.kind === "CARD_DEFEATED" ? [e.payload.cardInstanceId] : []);
    assert.deepEqual(defeated.sort(), [u.ids[0], u.ids[2]].sort(), "both defeated together");
    const noFirst = GameStateSchema.parse(first); delete noFirst.resolution.defeatContinuation;
    assert.equal(validateState(noFirst, context).ok, false, "the second choice needs its first target");
    const declined = finishOrder(pick(first, context, o => o.kind === "CONFIRM").state, context).state;
    assert.deepEqual([zone(declined, u.ids[0]), zone(declined, u.ids[1]), zone(declined, u.ids[2])], ["TRASH", "BATTLEFIELD", "BATTLEFIELD"]);
});

test("Live with the Aftermath has each player defeat one of their own Units, starting with its controller", () => {
    const u = units(base, [[3, actor], [4, actor], [5, rival], [3, rival]]);
    const played = playCard(placeCard(u.state, context, AFTERMATH).state, context, AFTERMATH);
    assert.equal(played.state.resolution.choice!.actorId, actor);
    assert.deepEqual(optionIds(played.state).sort(), [u.ids[0], u.ids[1]].sort());
    const mine = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === u.ids[1]).state;
    assert.equal(mine.resolution.choice!.actorId, rival);
    assert.equal(mine.timing.actingPlayer, rival);
    assert.deepEqual(optionIds(mine).sort(), [u.ids[2], u.ids[3]].sort());
    assert.equal(zone(mine, u.ids[1]), "BATTLEFIELD", "nothing is defeated before every player has chosen");
    const skipped = GameStateSchema.parse(mine); delete skipped.resolution.defeatContinuation;
    assert.equal(validateState(skipped, context).ok, false, "the controller's pick cannot be dropped");
    const done = finishOrder(pick(mine, context, o => o.kind === "CARD" && o.cardInstanceId === u.ids[2]).state, context).state;
    assert.deepEqual(u.ids.map(id => zone(done, id)), ["BATTLEFIELD", "TRASH", "TRASH", "BATTLEFIELD"]);
    assert.equal(done.timing.actingPlayer, actor);
    assert.equal(done.resolution.choice, null);
    // One Unit is forced and a player with none is skipped.
    const forced = units(base, [[3, rival]]);
    const alone = playCard(placeCard(forced.state, context, AFTERMATH).state, context, AFTERMATH).state;
    assert.equal(alone.resolution.choice, null);
    assert.equal(zone(alone, forced.ids[0]), "TRASH");
    const empty = playCard(placeCard(base, context, AFTERMATH).state, context, AFTERMATH).state;
    assert.equal(empty.resolution.choice, null);
});

test("the reviewed union admits the V12 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [BONNIE, AFTERMATH]) assert.ok(ids.has(id), id);
});
