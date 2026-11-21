import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV44Cards, batchV44Context, batchV44Input, v44Source, PYRAMID } from "./api-admission-batch-v44-fixture";
import { MISTY } from "./api-admission-batch-v42-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV44Context();
const pyramid = batchV44Cards[0];
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad"; // Vanilla Units, power 4 and 6; Misty has power 0.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV44Input("batch-v44"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Pyramid Song in the actor's hand; each listed card on the rival's field; the actor's d4 rolled to `d4` and
 * the rival's d4 rolled to 1 (a rival min Gig never counts); every other Gig waits in its fixer area. */
function arrange(rivalUnits: string[], d4: number) {
    const m = new TurnMutation(base, context), ids: CardInstanceId[] = [];
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(actor, PYRAMID);
    for (const cardId of rivalUnits) { const c = rewrite(rival, cardId); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = []; ids.push(c.id); }
    const d = GameStateSchema.parse(m.state);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs)) {
        const rolled = g.dieType === "D4";
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: g.ownerId === actor ? d4 : 1 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids };
}
function pay(s: GameState) {
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 30); s = choose(s, context, 0).state; }
    return s;
}
const play = (s: GameState) => { const r = playCard(s, context, PYRAMID); return { ...r, state: pay(r.state) }; };
const mode = (s: GameState, kind: string) => pick(s, context, o => o.kind === "MODE" && o.mode === kind);
const unit = (s: GameState, id: CardInstanceId) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);
const met = (events: { payload: { kind: string; met?: boolean } }[]) => events.filter(e => e.payload.kind === "CONDITION_EVALUATED").map(e => e.payload.met);
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;

test("the V44 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(pyramid.provenance.sourceHash, hashCanonical(v44Source(pyramid.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === pyramid.id), [pyramid]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Pyramid Song passes only its exact pin; any changed field is rejected, and no other gate reads a modal ability", () => {
    assert.ok(supportsPlay(pyramid, context).ok);
    assert.equal(supportsTriggerCard(pyramid, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(pyramid) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not modal", d => { delete d.mechanics.abilities[0].choose; }],
        ["other condition", d => { d.mechanics.abilities[0].choose = { count: 1, allInstead: { kind: "CONTROLS_VALUE_PAIR" } }; }],
        ["-4 power", d => { d.mechanics.abilities[0].effects[0] = { kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -4 }; }],
        ["any power", d => { d.mechanics.abilities[0].effects[1] = { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL" } }; }],
        ["swapped modes", d => { d.mechanics.abilities[0].effects.reverse(); }],
        ["third mode", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["tags", d => { d.tags = ["Braindance", "Doll"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("without a friendly min d4 the controller chooses one mode: -5 power to a chosen rival Unit this turn", () => {
    const a = arrange([ATLUS, PSYCHO], 3), [atlus, psycho] = a.ids, played = play(a.state);
    assert.deepEqual(met(played.events), [false], "the rival's min d4 does not count");
    assert.equal(played.state.timing.step, "TARGET_SELECTION"); assert.equal(played.state.resolution.choice!.kind, "MODE");
    assert.deepEqual(played.state.resolution.choice!.options.map(o => o.kind === "MODE" ? o.mode : null), ["POWER_UNTIL_END_OF_TURN", "BOTTOM_DECK_UNIT"]);
    const forged = GameStateSchema.parse(played.state), d4 = Object.values(forged.objects.gigs).find(g => g.ownerId === actor && g.dieType === "D4")!;
    d4.roll = { kind: "ROLLED", initialValue: 1, currentValue: 1 };
    assert.equal(validateState(forged, context).ok, false, "with a friendly min d4 there is no mode to choose");
    const chosen = mode(played.state, "POWER_UNTIL_END_OF_TURN");
    assert.ok(chosen.events.some(e => e.payload.kind === "EFFECT_MODE_CHOSEN" && e.payload.effectIndex === 0));
    assert.deepEqual(chosen.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [atlus, psycho].sort());
    const done = unit(chosen.state, psycho).state;
    assert.equal(effectivePower(done, psycho, context), 1); assert.equal(effectivePower(done, atlus, context), 4);
    assert.equal(zone(done, psycho), "BATTLEFIELD", "only one mode resolves"); assert.equal(done.timing.step, "MAIN");
    assert.equal(zone(done, done.players[actor].zones.TRASH.at(-1)!), "TRASH");
});

test("the bottom-deck mode takes only a rival Unit with power 0; with none it does nothing", () => {
    const a = arrange([ATLUS, MISTY], 2), [atlus, misty] = a.ids;
    const done = mode(play(a.state).state, "BOTTOM_DECK_UNIT");
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_MODE_CHOSEN" && e.payload.effectIndex === 1));
    assert.equal(zone(done.state, misty), "DECK"); assert.equal(done.state.players[rival].zones.DECK.at(-1), misty, "bottom of its owner's deck");
    assert.equal(zone(done.state, atlus), "BATTLEFIELD"); assert.equal(done.state.timing.step, "MAIN");
    const none = arrange([ATLUS], 4), nothing = mode(play(none.state).state, "BOTTOM_DECK_UNIT").state;
    assert.equal(zone(nothing, none.ids[0]), "BATTLEFIELD"); assert.equal(nothing.timing.step, "MAIN");
});

test("with a friendly min d4 both modes resolve in order: the weakened Unit can then be bottom-decked", () => {
    const a = arrange([ATLUS, PSYCHO], 1), [atlus, psycho] = a.ids, played = play(a.state);
    assert.deepEqual(met(played.events), [true]); assert.equal(played.state.resolution.choice!.kind, "TARGET", "no mode choice");
    const done = unit(played.state, atlus);
    assert.equal(zone(done.state, atlus), "DECK", "-1 power counts as 0 (2.10.1), the only rival Unit with power 0");
    assert.equal(zone(done.state, psycho), "BATTLEFIELD"); assert.equal(done.state.timing.step, "MAIN");
    assert.equal(done.state.temporaryModifiers, undefined, "the modifier left with the Unit");
    const b = arrange([ATLUS, MISTY], 1), [atlus2, misty] = b.ids, s = play(b.state).state;
    const weakened = unit(s, atlus2).state;
    assert.equal(weakened.timing.step, "TARGET_SELECTION", "two rival Units now have power 0");
    assert.deepEqual(weakened.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [atlus2, misty].sort());
    assert.ok(validateState(weakened, context).ok);
    const forged = GameStateSchema.parse(weakened); forged.resolution.playContinuation!.chosenEffect = 1;
    assert.equal(validateState(forged, context).ok, false, "both modes resolve while the condition holds");
    const end = unit(weakened, misty).state;
    assert.equal(zone(end, misty), "DECK"); assert.equal(zone(end, atlus2), "BATTLEFIELD"); assert.equal(effectivePower(end, atlus2, context), -1);
});

test("the reviewed union admits the V44 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PYRAMID));
});
