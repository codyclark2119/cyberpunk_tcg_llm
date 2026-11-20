import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsGigSetProgram } from "../packages/engine/src/program-gig-set-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV37Cards, batchV37Context, batchV37Input, v37Source, PEACE_OFFERING } from "./api-admission-batch-v37-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV37Context();
const program = batchV37Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV37Input("batch-v37"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Roll = { player: PlayerId; die: string; value: number };
/** Trusted arrangement: each listed die is rolled into its owner's Gig area at its value, and the Program is in hand. */
function arrange(rolled: Roll[]) {
    const d = GameStateSchema.parse(base);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const find = (x: { player: PlayerId; die: string }) => Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id;
    const chosen = new Map(rolled.map(x => [find(x), x.value]));
    for (const g of Object.values(d.objects.gigs)) {
        const value = chosen.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    const m = new TurnMutation(unwrap(validateState(d, context)), context), deck = m.state.players[actor].zones.DECK, r = context.content.cards.find(c => c.id === PEACE_OFFERING)!;
    const hand = m.state.objects.cards[deck[deck.length - 1]]; hand.cardId = r.id; hand.revision = r.revision; moveCardLocation(m, hand.id, "HAND");
    return { state: unwrap(validateState(m.state, context)), gig: (x: { player: PlayerId; die: string }) => find(x), program: hand.id };
}
const gigs = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "GIG" ? [o.gigInstanceId] : []).sort();
const value = (s: GameState, id: GigInstanceId) => { const r = s.objects.gigs[id].roll; return r.kind === "ROLLED" ? r.currentValue : null; };
const gig1 = (s: GameState, id: GigInstanceId) => pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === id);
const handAfterPlay = (s: GameState) => s.players[actor].zones.HAND.length - 1;
// Friendly 2 (d4) and 5 (d6), rival 4 (d8). The d4 can take only the 4 (5 is not on its faces); the d6 and d8 have two sources each.
const ROLLED: Roll[] = [{ player: actor, die: "D4", value: 2 }, { player: actor, die: "D6", value: 5 }, { player: rival, die: "D8", value: 4 }];

test("the V37 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(program.provenance.sourceHash, hashCanonical(v37Source(program.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === program.id), [program]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Peace Offering passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsGigSetProgram(program, context).ok); assert.ok(supportsPlay(program, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(program) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no draw", d => { d.mechanics.abilities[0].effects.pop(); }],
        ["draw 2", d => { d.mechanics.abilities[0].effects[1] = { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "CONTROLS_VALUE_PAIR" }, count: 2 }; }],
        ["draw first", d => { d.mechanics.abilities[0].effects.reverse(); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["trigger scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["tags", d => { d.tags = ["Doll"]; }],
        ["keyword", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("the Gig to set is any Gig with a source on its faces; setting into a value-pair draws 1", () => {
    const a = arrange(ROLLED), d4 = a.gig({ player: actor, die: "D4" }), d6 = a.gig({ player: actor, die: "D6" }), d8 = a.gig({ player: rival, die: "D8" }), hand = handAfterPlay(a.state);
    let s = playCard(a.state, context, PEACE_OFFERING).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(gigs(s), [d4, d6, d8].sort(), "either player's Gigs"); assert.ok(s.resolution.choice!.options.some(o => o.kind === "CONFIRM" && !o.confirmed));
    s = gig1(s, d6).state;
    assert.deepEqual(gigs(s), [d4, d8].sort(), "the d6 takes another Gig's value");
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "GIG", gigInstanceId: d6 });
    assert.equal(validateState(forged, context).ok, false, "a Gig is never its own source");
    const done = gig1(s, d4);
    assert.equal(value(done.state, d6), 2); assert.ok(done.events.some(e => e.payload.kind === "GIG_VALUE_CHANGED" && e.payload.previous === 5 && e.payload.current === 2));
    assert.ok(done.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met), "2 and 2 are a friendly value-pair");
    assert.equal(done.state.players[actor].zones.HAND.length, hand + 1);
    assert.equal(done.state.objects.cards[a.program].zone.zone, "TRASH"); assert.equal(done.state.timing.step, "MAIN");
});

test("a lone source applies without a choice; a rival Gig can be set; no friendly pair draws nothing", () => {
    const a = arrange(ROLLED), d4 = a.gig({ player: actor, die: "D4" }), d6 = a.gig({ player: actor, die: "D6" }), d8 = a.gig({ player: rival, die: "D8" }), hand = handAfterPlay(a.state);
    const lone = gig1(playCard(a.state, context, PEACE_OFFERING).state, d4);
    assert.equal(value(lone.state, d4), 4, "5 is not a d4 face, so the rival 4 is the only source (6.5.1)");
    assert.ok(lone.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met)); assert.equal(lone.state.players[actor].zones.HAND.length, hand);
    const theirs = gig1(gig1(playCard(a.state, context, PEACE_OFFERING).state, d8).state, d6).state;
    assert.equal(value(theirs, d8), 5); assert.equal(theirs.players[actor].zones.HAND.length, hand, "the Rival's 5 does not pair with a friendly 5");
});

test("declining sets nothing but a value-pair still draws; with nothing to set there is no choice", () => {
    const a = arrange([{ player: actor, die: "D4", value: 3 }, { player: actor, die: "D6", value: 3 }, { player: rival, die: "D8", value: 6 }]), hand = handAfterPlay(a.state);
    const declined = pick(playCard(a.state, context, PEACE_OFFERING).state, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED")); assert.equal(declined.events.some(e => e.payload.kind === "GIG_VALUE_CHANGED"), false);
    assert.equal(declined.state.players[actor].zones.HAND.length, hand + 1, "\"Then, if you control a value-pair\" is checked either way");
    const none = arrange([{ player: actor, die: "D4", value: 3 }]), played = playCard(none.state, context, PEACE_OFFERING);
    assert.equal(played.state.timing.step, "MAIN"); assert.equal(played.state.players[actor].zones.HAND.length, handAfterPlay(none.state));
});

test("the reviewed union admits the V37 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PEACE_OFFERING));
});
