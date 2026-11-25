import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState, type GigInstanceId } from "@tcg/domain";
import { applyAction, createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { drawDeterministicInteger } from "../packages/engine/src/rng";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV81Cards, batchV81Context, batchV81Input, v81Source } from "./api-admission-batch-v81-fixture";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

type DieType = "D4" | "D6" | "D8" | "D10" | "D12" | "D20";
type Mutable = ReturnType<typeof GameStateSchema.parse>;
const context = batchV81Context();
const [kerry] = batchV81Cards;
/** The first player's opening CHOOSE_GIG, after setup. */
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV81Input("batch-v81"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    assert.equal(state.timing.step, "CHOOSE_GIG");
    return state;
}
const base = setup(), actor = base.timing.activePlayer;

type Arrangement = { face?: "UP" | "DOWN"; d20?: boolean; rolls: number[]; die: DieType; deck?: number };
/** The first RNG counter from which `die` rolls `rolls` in order. */
function counterFor(s: GameState, die: DieType, rolls: number[]) {
    for (let counter = 0; counter < 100000; counter++) {
        let rng = { ...s.rng, counter }, ok = true;
        for (const want of rolls) { const r = drawDeterministicInteger(rng, Number(die.slice(1))); rng = r.rng; if (r.rawValue !== want) { ok = false; break; } }
        if (ok) return counter;
    }
    throw new Error("no counter");
}
/** Trusted arrangement on the actor's CHOOSE_GIG: Kerry as the actor's last Legend (face up by default); with `d20`, every other original
 * die already rolled into the Gig area so only the d20 remains; the RNG counter set so `die` rolls `rolls` in order; with `deck`, only
 * that many cards left in the actor's deck (the rest moved to the trash). */
function arrange(a: Arrangement) {
    const d = GameStateSchema.parse(base), legends = d.players[actor].zones.LEGENDS, l = d.objects.cards[legends[legends.length - 1]];
    l.cardId = kerry.id; l.revision = kerry.revision; l.face = a.face ?? "UP";
    if (a.d20)
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === actor && g.dieType !== "D20" && g.location.zone === "FIXER")) {
            const from = d.players[actor].gigs.FIXER; from.splice(from.indexOf(g.id), 1);
            g.location = { playerId: actor, zone: "GIGS" }; g.roll = { kind: "ROLLED", initialValue: 2, currentValue: 2 };
            d.players[actor].gigs.GIGS.push(g.id);
        }
    if (a.deck !== undefined) {
        const deck = d.players[actor].zones.DECK;
        for (const id of deck.splice(a.deck)) { d.objects.cards[id].zone = { playerId: actor, zone: "TRASH" }; d.players[actor].zones.TRASH.push(id); }
    }
    d.rng = { ...d.rng, counter: counterFor(d, a.die, a.rolls) };
    return unwrap(validateState(d, context));
}
const gigOf = (s: GameState, die: DieType) => Object.values(s.objects.gigs).find(g => g.ownerId === actor && g.dieType === die)!;
function roll(s: GameState, die: DieType) {
    const id = gigOf(s, die).id;
    return { id, ...take(s, context, x => x.action.kind === "ROLL_GIG" && x.action.gigInstanceId === id) };
}
const hand = (s: GameState) => s.players[actor].zones.HAND.length;
const value = (s: GameState, id: GigInstanceId) => { const g = s.objects.gigs[id]; return g.roll.kind === "ROLLED" ? [g.roll.initialValue, g.roll.currentValue] : []; };

test("the V81 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(kerry.provenance.sourceHash, hashCanonical(v81Source(kerry.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === kerry.id), [kerry]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Kerry Eurodyne: Axe, Attitude, Audience passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsLegendSpendCard(kerry, context).ok);
    for (const gate of [supportsTriggerCard, supportsFieldLegend]) assert.equal(gate(kerry, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(kerry) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no reroll", d => { d.mechanics.modifiers = [d.mechanics.modifiers[1]]; }],
        ["no draw", d => { d.mechanics.modifiers = [d.mechanics.modifiers[0]]; }],
        ["swapped order", d => { d.mechanics.modifiers = [d.mechanics.modifiers[1], d.mechanics.modifiers[0]]; }],
        ["tags", d => { d.tags = ["Rocker"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        ["not sellable", d => { d.sellProfile.allowed = false; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsLegendSpendCard(forge(edit), context).ok, false, label);
});

test("without a face-up Kerry the roll goes straight to the Main Phase and a max value draws nothing", () => {
    const s = arrange({ face: "DOWN", die: "D6", rolls: [6] }), before = hand(s), r = roll(s, "D6");
    assert.equal(r.state.timing.step, "MAIN");
    assert.equal(r.state.resolution.choice, null);
    assert.deepEqual(value(r.state, r.id), [6, 6]);
    assert.equal(hand(r.state), before);
});

test("a face-up Kerry offers the reroll once; keeping a middle value draws nothing", () => {
    const s = arrange({ die: "D6", rolls: [3] }), before = hand(s), r = roll(s, "D6");
    assert.equal(r.state.timing.step, "ROLL_GIG");
    assert.equal(r.state.resolution.choice!.actorId, actor);
    assert.deepEqual(actions(r.state, context).map(x => x.descriptor.label).sort(), ["Ignore the D6 result (3) and reroll it", "Keep the D6 result (3)"]);
    const kept = choose(r.state, context, 1);
    assert.ok(kept.events.some(e => e.payload.kind === "GIG_REROLL_CHOSEN" && !e.payload.reroll));
    assert.equal(kept.events.filter(e => e.payload.kind === "GIG_DIE_ROLLED").length, 0);
    assert.equal(kept.state.timing.step, "MAIN");
    assert.deepEqual(value(kept.state, r.id), [3, 3]);
    assert.equal(hand(kept.state), before);
});

test("keeping a min or max value draws 1", () => {
    for (const rolled of [1, 6]) {
        const s = arrange({ die: "D6", rolls: [rolled] }), before = hand(s), kept = choose(roll(s, "D6").state, context, 1);
        assert.equal(hand(kept.state), before + 1, String(rolled));
        assert.equal(kept.state.timing.step, "MAIN");
    }
});

test("a reroll ignores the first result: an ignored min draws nothing, a rerolled max draws 1", () => {
    const s = arrange({ die: "D8", rolls: [1, 5] }), before = hand(s), r = roll(s, "D8"), rerolled = choose(r.state, context, 0);
    assert.ok(rerolled.events.some(e => e.payload.kind === "GIG_REROLL_CHOSEN" && e.payload.reroll));
    assert.deepEqual(rerolled.events.filter(e => e.payload.kind === "GIG_DIE_ROLLED").map(e => e.payload.kind === "GIG_DIE_ROLLED" ? e.payload.rawValue : 0), [5]);
    assert.deepEqual(value(rerolled.state, r.id), [5, 5]);
    assert.equal(hand(rerolled.state), before);
    assert.equal(rerolled.state.timing.step, "MAIN", "only once: no second reroll offer");
    const t = arrange({ die: "D8", rolls: [4, 8] }), more = choose(roll(t, "D8").state, context, 0);
    assert.equal(hand(more.state), hand(t) + 1);
});

test("a d20 min or max draws 3, and drawing past an empty deck loses", () => {
    const s = arrange({ d20: true, die: "D20", rolls: [20] }), kept = choose(roll(s, "D20").state, context, 1);
    assert.equal(hand(kept.state), hand(s) + 3);
    const t = arrange({ d20: true, die: "D20", rolls: [7, 1], deck: 2 }), lost = choose(roll(t, "D20").state, context, 0);
    assert.equal(lost.state.match.outcome?.loserId, actor);
    assert.equal(lost.state.match.outcome?.reason, "EMPTY_DRAW");
    assert.equal(lost.state.timing.step, "FINISHED");
});

test("the reroll choice is exclusive and validated", () => {
    const r = roll(arrange({ die: "D6", rolls: [3] }), "D6"), rival = r.state.match.playerOrder.find(p => p !== actor)!;
    const tamper = (edit: (d: Mutable) => void) => { const d = GameStateSchema.parse(r.state); edit(d); return validateState(d, context).ok; };
    assert.equal(tamper(d => { const g = d.objects.gigs[r.id]; if (g.roll.kind === "ROLLED") g.roll.currentValue = 4; }), false, "a modified Gig");
    assert.equal(tamper(d => { const l = d.players[actor].zones.LEGENDS; d.objects.cards[l[l.length - 1]].face = "DOWN"; }), false, "no face-up Kerry");
    assert.equal(tamper(d => { delete d.resolution.gigRerollContinuation; }), false, "orphan choice");
    assert.equal(applyAction(r.state, { actorId: rival, action: { kind: "END_TURN" } }, context).ok, false);
});
