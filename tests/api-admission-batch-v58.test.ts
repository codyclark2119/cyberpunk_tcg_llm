import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsFightPowerProgram } from "../packages/engine/src/fight-power-grant-support";
import { supportsReactPlay } from "../packages/engine/src/react-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV58Cards, batchV58Context, batchV58Input, v58Source, SYNAPSE } from "./api-admission-batch-v58-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV58Context();
const synapse = batchV58Cards[0];
const OCTANT = "octant", PSYCHO = "psycho-squad"; // Power 8 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV58Input("batch-v58"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** Trusted arrangement: the bottom deck card of `player` rewritten as `cardId`, moved to hand or to the field (ready unless `spent`). */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "BATTLEFIELD", spent = false) {
    const m = new TurnMutation(s, context), deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); if (where !== "HAND") moveCardLocation(m, c.id, where);
    if (where === "BATTLEFIELD") { c.readiness = spent ? "SPENT" : "READY"; c.statuses = []; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: exactly `n` of `player`'s Legends face up. */
function legendsUp(s: GameState, player: PlayerId, n: number) {
    const d = GameStateSchema.parse(structuredClone(s));
    d.players[player].zones.LEGENDS.forEach((id, i) => { d.objects.cards[id].face = i < n ? "UP" : "DOWN"; });
    return unwrap(validateState(d, context));
}
/** Plays Synapse Burnout from the actor's hand (Eddies first), then picks `target` if a choice opens. */
function playSynapse(s: GameState, id: CardInstanceId, target?: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id);
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 30); const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); r = choose(r.state, context, i >= 0 ? i : 0); }
    if (r.state.resolution.choice && target) { assert.ok(validateState(r.state, context).ok); r = pick(r.state, context, o => o.kind === "CARD" && o.cardInstanceId === target); }
    return r.state;
}
/** `attacker` attacks `target`; the defender passes React unless `react` plays first; every later choice takes its first option. */
function fight(s: GameState, attacker: CardInstanceId, target: CardInstanceId, react?: (s: GameState) => GameState) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION" || state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state;
    if (react) { assert.equal(state.timing.step, "RIVAL_REACT"); state = react(state); }
    for (let n = 0; !(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE"); n++) {
        assert.ok(n < 40); assert.ok(validateState(state, context).ok);
        state = (state.timing.step === "RIVAL_REACT" ? take(state, context, a => a.action.kind === "PASS_REACT") : choose(state, context, 0)).state;
    }
    return state;
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;

test("the V58 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(synapse.provenance.sourceHash, hashCanonical(v58Source(synapse.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === synapse.id), [synapse]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Synapse Burnout passes only its exact pin; no other gate reads a while-fighting grant", () => {
    for (const gate of [supportsPlay, supportsFightPowerProgram]) assert.ok(gate(synapse, context).ok);
    for (const gate of [supportsTriggerCard, supportsReactPlay]) assert.equal(gate(synapse, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(synapse) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not Quick", d => { d.mechanics.keywords = []; }],
        ["also Blocker", d => { d.mechanics.keywords = ["QUICK", "BLOCKER"]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["RAM", d => { d.ram = { GREEN: 2 }; }],
        ["tags", d => { d.tags = ["Braindance"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsFightPowerProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("attacking: +1 power per friendly face-up Legend turns a lost fight into a win, only while fighting", () => {
    const mine = put(base, PSYCHO, actor, "BATTLEFIELD"), theirs = put(mine.state, OCTANT, rival, "BATTLEFIELD", true), hand = put(theirs.state, SYNAPSE, actor, "HAND");
    const unplayed = fight(legendsUp(hand.state, actor, 3), mine.id, theirs.id);
    assert.equal(zone(unplayed, mine.id), "TRASH", "6 loses to 8"); assert.equal(zone(unplayed, theirs.id), "BATTLEFIELD");
    const played = playSynapse(legendsUp(hand.state, actor, 3), hand.id);
    assert.deepEqual(played.fightPowerGrants?.map(x => x.targetId), [mine.id], "the lone friendly Unit is chosen without a choice");
    assert.equal(effectivePower(played, mine.id, context), 6, "no power outside a fight");
    const won = fight(played, mine.id, theirs.id);
    assert.equal(zone(won, mine.id), "BATTLEFIELD", "6 + 3 beats 8"); assert.equal(zone(won, theirs.id), "TRASH");
    const tied = fight(playSynapse(legendsUp(hand.state, actor, 2), hand.id), mine.id, theirs.id);
    assert.equal(zone(tied, mine.id), "TRASH"); assert.equal(zone(tied, theirs.id), "TRASH", "6 + 2 ties 8");
    const faceDown = fight(playSynapse(legendsUp(hand.state, actor, 1), hand.id), mine.id, theirs.id);
    assert.equal(zone(faceDown, mine.id), "TRASH", "face-down Legends do not count"); assert.equal(zone(faceDown, theirs.id), "BATTLEFIELD");
});

test("with two friendly Units the controller chooses one, and only it gains power", () => {
    const a = put(base, PSYCHO, actor, "BATTLEFIELD"), b = put(a.state, OCTANT, actor, "BATTLEFIELD"), hand = put(b.state, SYNAPSE, actor, "HAND");
    const done = playSynapse(legendsUp(hand.state, actor, 3), hand.id, a.id);
    assert.deepEqual(done.fightPowerGrants?.map(x => x.targetId), [a.id]);
    const ended = take(done, context, x => x.action.kind === "END_TURN").state;
    assert.equal(ended.fightPowerGrants, undefined, "it lasts this turn only");
});

test("in React on the rival's turn: the defending friendly Unit gains the power", () => {
    const mine = put(base, PSYCHO, actor, "BATTLEFIELD", true), theirs = put(mine.state, OCTANT, rival, "BATTLEFIELD"), hand = put(theirs.state, SYNAPSE, actor, "HAND");
    let s = legendsUp(hand.state, actor, 3);
    s = take(s, context, a => a.action.kind === "END_TURN").state;
    for (let n = 0; !(s.timing.activePlayer === rival && s.timing.step === "MAIN"); n++) { assert.ok(n < 20); s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state; }
    assert.equal(s.objects.cards[mine.id].readiness, "SPENT");
    const done = fight(s, theirs.id, mine.id, r => playSynapse(r, hand.id));
    assert.equal(zone(done, mine.id), "BATTLEFIELD", "6 + 3 beats the attacking 8"); assert.equal(zone(done, theirs.id), "TRASH");
});

test("a grant ends when its Unit leaves the field, and forged grants are rejected", () => {
    const mine = put(base, PSYCHO, actor, "BATTLEFIELD"), theirs = put(mine.state, OCTANT, rival, "BATTLEFIELD"), hand = put(theirs.state, SYNAPSE, actor, "HAND");
    const done = playSynapse(hand.state, hand.id);
    assert.equal(done.fightPowerGrants?.length, 1);
    const m = new TurnMutation(done, context); moveCardLocation(m, mine.id, "TRASH");
    assert.equal(m.state.fightPowerGrants, undefined);
    const rivals = GameStateSchema.parse(structuredClone(done)); rivals.fightPowerGrants![0].targetId = theirs.id;
    assert.equal(validateState(rivals, context).ok, false, "a friendly field Unit only");
    const stale = GameStateSchema.parse(structuredClone(done)); stale.fightPowerGrants![0].createdTurn = stale.timing.turn + 1;
    assert.equal(validateState(stale, context).ok, false, "this turn only");
});

test("the reviewed union contains Synapse Burnout", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === SYNAPSE));
});
