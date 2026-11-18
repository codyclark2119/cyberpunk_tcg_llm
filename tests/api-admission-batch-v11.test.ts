import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { playPaymentAmount, supportsPlayCostReductionUnit } from "../packages/engine/src/play-cost-support";
import { numericCost } from "../packages/engine/src/cost-value";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV11Cards, batchV11Context, batchV11Input, v11Source, OCTANT, TRAUMA, HEAVY } from "./api-admission-batch-v11-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { placeCard, playCard, withGigs } from "./value-conditions-focused";
import { clearField, fund, field } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV11Context();
const card = (id: string) => batchV11Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV11Input("batch-v11"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function plainUnit(): string {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length);
    assert.ok(r, "no plain reviewed Unit"); return r.id;
}
/** Leaves exactly `count` ready Eddies, and no ready Legend that could pay, for the active player. */
function eddies(s: GameState, count: number) {
    const d = GameStateSchema.parse(s);
    for (const id of d.players[actor].zones.LEGENDS) d.objects.cards[id].readiness = "SPENT";
    d.players[actor].zones.EDDIES.forEach((id, i) => { d.objects.cards[id].readiness = i < count ? "READY" : "SPENT"; });
    return unwrap(validateState(d, context));
}
function toTrash(s: GameState, ids: CardInstanceId[]) {
    const d = GameStateSchema.parse(s);
    for (const id of ids) {
        const c = d.objects.cards[id], p = d.players[c.controllerId];
        p.zones.BATTLEFIELD = p.zones.BATTLEFIELD.filter(x => x !== id); p.zones.TRASH.push(id);
        c.zone = { playerId: c.ownerId, zone: "TRASH" }; c.readiness = "READY"; c.statuses = [];
    }
    return unwrap(validateState(d, context));
}
const canPlay = (s: GameState, id: string) => unwrap(listLegalActions(s, actor, context)).some(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id);
const paid = (events: { payload: { kind: string } }[]) => events.flatMap(e => e.payload.kind === "PAYMENT_MADE" ? [(e.payload as unknown as { sources: unknown[] }).sources.length] : []);

test("V11 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV11Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v11Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(OCTANT).rulesText, "Play this Unit for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$.");
    assert.equal(card(TRAUMA).rulesText, "Play this Unit for -1 €$ for each Unit in your trash, to a minimum of 1 €$.");
    assert.equal(card(HEAVY).rulesText, "Play this Unit for -1 €$ for each of a Rival’s Units, to a minimum of 1 €$.");
});

test("each V11 card passes only its own exact pin; any changed field is rejected", () => {
    for (const c of batchV11Cards) { assert.ok(supportsPlayCostReductionUnit(c, context).ok, c.id); assert.ok(supportsPlay(c, context).ok, c.id); }
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const edits: [string, string, (d: CardRevisionSnapshot) => void][] = [
        [OCTANT, "swapped count", d => { d.mechanics.modifiers = [{ kind: "SELF_PLAY_COST_REDUCTION", per: "RIVAL_UNIT", amount: 1, minimum: 1 }]; }],
        [OCTANT, "cost", d => { d.printedCost = { kind: "EDDIES", amount: 6 }; }],
        [TRAUMA, "power", d => { d.power = 8; }],
        [TRAUMA, "extra ability", d => { d.mechanics.abilities = [{ id: "x", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }]; }],
        [HEAVY, "Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        [HEAVY, "tags", d => { d.tags = ["MaxTac"]; }],
        [HEAVY, "two reductions", d => { d.mechanics.modifiers = [...d.mechanics.modifiers, ...d.mechanics.modifiers]; }]
    ];
    for (const [id, label, edit] of edits) assert.equal(supportsPlay(forge(card(id), edit), context).ok, false, `${id}: ${label}`);
    const { playCostReduction: _, ...withoutPolicy } = context.content.ruleset.gameplay!.turnSlice!;
    const noPolicy = { content: { ...context.content, ruleset: { ...context.content.ruleset, gameplay: { ...context.content.ruleset.gameplay!, turnSlice: withoutPolicy } } } } as typeof context;
    assert.equal(supportsPlay(card(OCTANT), noPolicy).ok, false, "the reduction needs its reviewed policy");
});

test("Octant pays 1 less per friendly Gig of 8+, never below 1, and keeps its cost value", () => {
    const faces = (g: { dieType: string }) => Number(g.dieType.slice(1)), all = Object.values(base.objects.gigs);
    const gigs = all.filter(g => g.controllerId === actor && faces(g) >= 8 && faces(g) < 20).sort((a, b) => faces(a) - faces(b)).map(g => g.id);
    const rivalGig = all.find(g => g.controllerId === rival && faces(g) >= 10 && faces(g) < 20)!.id;
    assert.ok(gigs.length >= 3);
    const two = withGigs(base, context, { [gigs[0]]: 8, [gigs[1]]: 9, [gigs[2]]: 7, [rivalGig]: 10 });
    const placed = placeCard(two, context, OCTANT);
    assert.equal(playPaymentAmount(placed.state, actor, placed.id, context), 5, "two of three friendly Gigs are 8+; the rival's does not count");
    assert.equal(numericCost(placed.state, placed.id, context), 7, "3.11.1.2: the cost value is unchanged");
    assert.equal(canPlay(eddies(placed.state, 4), placed.id), false);
    const ok = eddies(placed.state, 5);
    assert.equal(canPlay(ok, placed.id), true);
    const played = playCard(ok, context, OCTANT);
    assert.equal(played.state.objects.cards[placed.id].zone.zone, "BATTLEFIELD");
    assert.deepEqual(paid(played.events), [5]);
    const none = placeCard(withGigs(base, context, { [gigs[0]]: 7 }), context, OCTANT);
    assert.equal(playPaymentAmount(none.state, actor, none.id, context), 7);
});

test("Trauma Team Operatives counts only Units in its controller's trash", () => {
    const a = field(base, context, plainUnit(), actor), b = field(a.state, context, plainUnit(), actor), r = field(b.state, context, plainUnit(), rival);
    const trashed = toTrash(r.state, [a.id, b.id, r.id]);
    const placed = placeCard(trashed, context, TRAUMA);
    assert.equal(playPaymentAmount(placed.state, actor, placed.id, context), 4, "two friendly trashed Units; the rival's trash does not count");
    const played = playCard(eddies(placed.state, 4), context, TRAUMA);
    assert.equal(played.state.objects.cards[placed.id].zone.zone, "BATTLEFIELD");
    assert.deepEqual(paid(played.events), [4]);
});

test("MaxTac Heavy counts a Rival's Units on the field, to a minimum of 1", () => {
    let s = base; const ids: CardInstanceId[] = [];
    for (let i = 0; i < 7; i++) { const f = field(s, context, plainUnit(), rival); s = f.state; ids.push(f.id); }
    const own = field(s, context, plainUnit(), actor), placed = placeCard(own.state, context, HEAVY);
    assert.equal(playPaymentAmount(placed.state, actor, placed.id, context), 1, "seven rival Units floor the 7 cost at 1; own Units do not count");
    const three = placeCard(toTrash(own.state, ids.slice(3)), context, HEAVY);
    assert.equal(playPaymentAmount(three.state, actor, three.id, context), 4);
    const played = playCard(eddies(placed.state, 1), context, HEAVY);
    assert.equal(played.state.objects.cards[placed.id].zone.zone, "BATTLEFIELD");
    assert.deepEqual(paid(played.events), [1]);
});

test("the reviewed union admits the V11 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [OCTANT, TRAUMA, HEAVY]) assert.ok(ids.has(id), id);
});
