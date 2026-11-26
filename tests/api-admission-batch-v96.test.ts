import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTrashUnitsProgram } from "../packages/engine/src/trash-units-play";
import { supportsPlay } from "../packages/engine/src/play-support";
import { playPaymentAmount } from "../packages/engine/src/play-cost-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV96Cards, batchV96Context, batchV96Input, v96Source } from "./api-admission-batch-v96-fixture";
import { pick, playCard, withGigs } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV96Context();
const [program] = batchV96Cards;
// Vanilla Units of cost 2; a blue cost-3 Unit with "{Play} Draw 1"; a cost-3 Unit with a {Play} draw; a vanilla cost-8 Unit.
const CORPO = "corpo-security", BOMBUS = "secondhand-bombus", DELAMAIN = "delamain-rideshare-ai", FIELD_OP = "field-operator", OCTANT = "octant";
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV96Input("batch-v96"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: the Program in hand, `trash` cards in the actor's trash (and nothing else there). */
function arrange(trash: string[], state = base) {
    const m = new TurnMutation(state, context), z = m.state.players[actor].zones;
    for (const id of [...z.TRASH]) moveCardLocation(m, id, "REMOVED");
    const take = (cardId: string) => { const c = m.state.objects.cards[z.DECK[z.DECK.length - 1]], r = context.content.cards.find(x => x.id === cardId)!; c.cardId = r.id; c.revision = r.revision; return c; };
    const p = take(program.id); moveCardLocation(m, p.id, "HAND");
    const units = trash.map(cardId => { const c = take(cardId); moveCardLocation(m, c.id, "TRASH"); return c.id; });
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), program: p.id, units };
}
/** Gig counts by player, using small values on non-D20 dice. */
function gigCounts(s: GameState, own: number, theirs: number) {
    const pickGigs = (p: string, n: number) => Object.values(s.objects.gigs).filter(g => g.controllerId === p && g.dieType !== "D20").slice(0, n).map(g => [g.id, 1] as const);
    return withGigs(s, context, Object.fromEntries([...pickGigs(actor, own), ...pickGigs(rival, theirs)]));
}
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
const name = (cardId: string) => context.content.cards.find(c => c.id === cardId)!.displayName;
function then(r: Step, f: (o: { kind: string; confirmed?: boolean; cardInstanceId?: string }) => boolean): Step {
    assert.ok(validateState(r.state, context).ok);
    const next = pick(r.state, context, f) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
function played(s: GameState, id: CardInstanceId) {
    const c = s.objects.cards[id];
    return c.zone.zone === "BATTLEFIELD" && c.controllerId === actor && c.readiness === "READY" && c.statuses.includes("LAG");
}

test("the V96 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(program.provenance.sourceHash, hashCanonical(v96Source(program.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === program.id), [program]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("We Gotta Live Together passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTrashUnitsProgram(program, context).ok);
    assert.ok(supportsPlay(program, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(program) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no alternative cost", d => { d.mechanics.modifiers = []; }],
        ["alternative cost 2", d => { d.mechanics.modifiers = [{ kind: "ALTERNATIVE_PLAY_COST_IF_FIXER_EMPTY", amount: 1 }]; }],
        ["cost 4", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["tags", d => { d.tags = ["Nomad"]; }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }]
    ];
    for (const [label, edit] of forgeries) {
        assert.equal(supportsTrashUnitsProgram(forge(edit), context).ok, false, label);
        assert.equal(supportsPlay(forge(edit), context).ok, false, label);
    }
});

test("it costs 3 while a Rival controls at least 2 more Gigs, otherwise 5", () => {
    const at = (own: number, theirs: number) => { const a = arrange([], gigCounts(base, own, theirs)); return playPaymentAmount(a.state, actor, a.program, context); };
    assert.equal(at(2, 2), 5);
    assert.equal(at(1, 2), 5, "a 1-Gig lead is not enough");
    assert.equal(at(1, 3), 3);
    assert.equal(at(0, 2), 3);
});

test("two trash Units are played for free, one at a time; their {Play} triggers resolve together after the Program", () => {
    const a = arrange([CORPO, DELAMAIN, OCTANT, FIELD_OP]), [corpo, delamain, octant, fieldOp] = a.units, hand = a.state.players[actor].zones.HAND.length;
    let r = playCard(a.state, context, program.id) as Step;
    assert.deepEqual(cardOptions(r.state), [corpo, delamain, fieldOp].sort(), "the cost-8 Unit is not offered");
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Play ${name(DELAMAIN)} (${delamain}) from your trash for free`));
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === "Play no more Units"));
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === delamain);
    assert.ok(played(r.state, delamain));
    assert.deepEqual(cardOptions(r.state), [corpo, fieldOp].sort());
    assert.deepEqual(r.state.resolution.playContinuation?.trashPlayedIds, [delamain]);
    const forged = GameStateSchema.parse(structuredClone(r.state)); forged.resolution.playContinuation!.trashPlayedIds = [delamain, corpo];
    assert.equal(validateState(forged, context).ok, false, "a played Unit must be on the field");
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === fieldOp);
    assert.ok(played(r.state, fieldOp));
    assert.equal(r.state.objects.cards[a.program].zone.zone, "TRASH", "the Program has resolved");
    assert.equal(r.state.objects.cards[octant].zone.zone, "TRASH"); assert.equal(r.state.objects.cards[corpo].zone.zone, "TRASH");
    const c = r.state.resolution.triggerContinuation;
    assert.ok(c, "both {Play} triggers wait in one batch for their order");
    assert.deepEqual(c.origin, { kind: "PLAY", subjectId: delamain });
    assert.deepEqual(c.effectPlays?.map(p => p.subjectId), [fieldOp]);
    assert.equal(c.freePlaySource, a.program);
    assert.ok(validateState(r.state, context).ok);
    const orphan = GameStateSchema.parse(structuredClone(r.state)); delete orphan.resolution.triggerContinuation!.freePlaySource;
    assert.equal(validateState(orphan, context).ok, false, "an effect play needs its free-play source");
    let s = r.state;
    for (let n = 0; !mainIdle(s); n++) { assert.ok(n < 10); assert.ok(validateState(s, context).ok, JSON.stringify(validateState(s, context))); s = choose(s, context, 0).state; }
    assert.ok(s.players[actor].zones.HAND.length >= hand, "Delamain drew a card (the Program left the hand)");
    assert.ok(validateState(s, context).ok);
});

test("the controller may stop at any time; with no eligible Unit nothing is offered", () => {
    const a = arrange([CORPO, BOMBUS]), [corpo, bombus] = a.units;
    let r = playCard(a.state, context, program.id) as Step;
    r = then(r, o => o.kind === "CONFIRM" && o.confirmed === false);
    assert.ok(mainIdle(r.state));
    assert.equal(r.state.objects.cards[corpo].zone.zone, "TRASH"); assert.equal(r.state.objects.cards[bombus].zone.zone, "TRASH");
    assert.ok(!has(r.events, "CARD_PLAYED", p => p.cardInstanceId === corpo || p.cardInstanceId === bombus));
    const b = arrange([CORPO]);
    let one = playCard(b.state, context, program.id) as Step;
    assert.deepEqual(cardOptions(one.state), [b.units[0]], "a lone Unit is still optional");
    one = then(one, o => o.kind === "CARD");
    assert.ok(mainIdle(one.state)); assert.ok(played(one.state, b.units[0]));
    const c = arrange([OCTANT]), none = playCard(c.state, context, program.id);
    assert.ok(mainIdle(none.state)); assert.equal(none.state.objects.cards[c.program].zone.zone, "TRASH");
});
