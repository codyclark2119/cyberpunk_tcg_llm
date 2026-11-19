import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPinnedPlayUnit } from "../packages/engine/src/play-pin-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV23Cards, batchV23Context, batchV23Input, v23Source, MAXTAC_AV } from "./api-admission-batch-v23-fixture";
import { playCard, pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV23Context();
const card = batchV23Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV23Input("batch-v23"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: MaxTac AV rewritten from the actor's bottom deck card into the hand. */
function inHand(s: GameState) {
    const m = new TurnMutation(s, context), deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]];
    c.cardId = card.id; c.revision = card.revision; moveCardLocation(m, c.id, "HAND");
    return unwrap(validateState(m.state, context));
}
/** Trusted arrangement: each player's Gig area holds exactly its listed values (ids in the same order), largest value on the
 * largest non-d20 die; every other die waits in its owner's fixer area. */
function gigs(s: GameState, values: Record<PlayerId, number[]>) {
    const d = GameStateSchema.parse(s), faces = (g: { dieType: string }) => Number(g.dieType.slice(1));
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const ids: Record<PlayerId, GigInstanceId[]> = {};
    for (const player of Object.keys(d.players) as PlayerId[]) {
        const want = values[player] ?? [], dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
        const order = want.map((v, i) => i).sort((a, b) => want[b] - want[a]), assigned = new Map(order.map((vi, k) => [dice[k].id, vi]));
        ids[player] = [];
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === player)) {
            const vi = assigned.get(g.id), value = vi === undefined ? undefined : want[vi];
            assert.ok(value === undefined || value <= faces(g), "each value fits its die");
            g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[g.ownerId].gigs[g.location.zone].push(g.id);
            if (vi !== undefined) ids[player][vi] = g.id;
        }
    }
    return { state: unwrap(validateState(d, context)), ids };
}
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);
const gigOptions = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "GIG" ? [o.gigInstanceId] : []).sort();
const labels = (s: GameState) => actions(s, context).map(a => a.descriptor.label);
const value = (s: GameState, id: GigInstanceId) => { const r = s.objects.gigs[id].roll; return r.kind === "ROLLED" ? r.currentValue : null; };

test("the V23 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(card.provenance.sourceHash, hashCanonical(v23Source(card.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === card.id), [card]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("MaxTac AV passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPinnedPlayUnit, supportsTriggerCard, supportsPlay]) assert.ok(gate(card, context).ok, gate.name);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(card) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const edits: [string, (d: CardRevisionSnapshot) => void][] = [
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["power", d => { d.power = 7; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["tags", d => { d.tags = ["NCPD"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }]
    ];
    for (const [label, edit] of edits) { const f = forge(edit); assert.equal(supportsTriggerCard(f, context).ok, false, label); assert.equal(supportsPinnedPlayUnit(f, context).ok, false, label); }
});

test("MaxTac AV: accept, choose a friendly Gig, then a rival Gig; both move at once and keep their values (6.7, 6.7.1)", () => {
    const arranged = gigs(inHand(base), { [actor]: [2, 5], [rival]: [3, 6] }), [mine2, mine5] = arranged.ids[actor], [theirs3, theirs6] = arranged.ids[rival];
    let s = playCard(arranged.state, context, MAXTAC_AV).state;
    assert.equal(s.resolution.choice?.kind, "OPTIONAL");
    assert.deepEqual(labels(s).sort(), ["Decline the optional effect", "Swap a friendly Gig with a rival Gig"]);
    s = pick(s, context, o => o.kind === "CONFIRM" && o.confirmed).state;
    assert.equal(s.resolution.choice?.kind, "TARGET");
    assert.deepEqual(gigOptions(s), [mine2, mine5].sort(), "the friendly Gig is chosen first");
    const forgedFirst = GameStateSchema.parse(s); forgedFirst.resolution.choice!.options.push({ kind: "GIG", gigInstanceId: theirs3 });
    assert.equal(validateState(forgedFirst, context).ok, false, "a rival Gig is not a first pick");
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === mine2).state;
    assert.equal(s.resolution.choice?.kind, "TARGET");
    assert.deepEqual(gigOptions(s), [theirs3, theirs6].sort(), "then the rival Gig");
    assert.ok(labels(s).every(l => l.startsWith("Take rival ") && l.endsWith(" in the swap")));
    const forgedHeld = GameStateSchema.parse(s); forgedHeld.resolution.triggerContinuation!.targetGigId = theirs6;
    assert.equal(validateState(forgedHeld, context).ok, false, "the held Gig must be friendly");
    const done = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === theirs6);
    s = done.state;
    assert.deepEqual([s.objects.gigs[mine2].controllerId, s.objects.gigs[theirs6].controllerId], [rival, actor]);
    assert.deepEqual([s.objects.gigs[mine2].location, s.objects.gigs[theirs6].location], [{ playerId: rival, zone: "GIGS" }, { playerId: actor, zone: "GIGS" }]);
    assert.deepEqual([value(s, mine2), value(s, theirs6)], [2, 6], "6.7.1: values are unchanged");
    assert.deepEqual([...s.players[actor].gigs.GIGS].sort(), [mine5, theirs6].sort());
    assert.deepEqual([...s.players[rival].gigs.GIGS].sort(), [theirs3, mine2].sort());
    assert.deepEqual(kinds(done.events).filter(k => k === "GIG_CONTROL_CHANGED" || k === "GIGS_SWAPPED"), ["GIG_CONTROL_CHANGED", "GIG_CONTROL_CHANGED", "GIGS_SWAPPED"]);
    assert.equal(s.turnHistory?.gigsStolenByUnit, undefined, "6.7.2: a swap is not stealing");
    assert.equal(s.objects.gigs[mine2].ownerId, actor, "ownership never changes");
    assert.equal(s.resolution.choice, null);
});

test("MaxTac AV: declining changes nothing", () => {
    const arranged = gigs(inHand(base), { [actor]: [2], [rival]: [6] });
    const s = playCard(arranged.state, context, MAXTAC_AV).state;
    const done = pick(s, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(kinds(done.events).includes("OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(done.state.objects.gigs[arranged.ids[actor][0]].controllerId, actor);
    assert.equal(done.state.objects.gigs[arranged.ids[rival][0]].controllerId, rival);
    assert.equal(done.state.resolution.choice, null);
});

test("MaxTac AV: one Gig on each side swaps after acceptance with forced picks", () => {
    const arranged = gigs(inHand(base), { [actor]: [2], [rival]: [6] });
    const s = playCard(arranged.state, context, MAXTAC_AV).state;
    const done = pick(s, context, o => o.kind === "CONFIRM" && o.confirmed);
    assert.equal(done.state.resolution.choice, null);
    assert.equal(done.state.objects.gigs[arranged.ids[actor][0]].controllerId, rival);
    assert.equal(done.state.objects.gigs[arranged.ids[rival][0]].controllerId, actor);
    assert.equal(kinds(done.events).filter(k => k === "GIG_TARGET_SELECTED").length, 2);
});

test("MaxTac AV: without a Gig on both sides there is nothing to swap and no choice", () => {
    for (const values of [{ [actor]: [2], [rival]: [] }, { [actor]: [], [rival]: [6] }]) {
        const arranged = gigs(inHand(base), values);
        const played = playCard(arranged.state, context, MAXTAC_AV);
        assert.equal(played.state.resolution.choice, null);
        assert.ok(!kinds(played.events).includes("GIGS_SWAPPED"));
    }
});
