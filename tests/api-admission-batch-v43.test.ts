import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV43Cards, batchV43Context, batchV43Input, v43Source, INCITERS } from "./api-admission-batch-v43-fixture";
import { MISTY } from "./api-admission-batch-v42-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV43Context();
const inciters = batchV43Cards[0];
const ATLUS = "emergency-atlus"; // A vanilla Unit.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV43Input("batch-v43"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Inciters in the actor's hand; each listed card ready on the rival's field with no lag; one rolled Gig
 * for each player, so each side has a Gig area to attack. */
function arrange(rivalUnits: string[]) {
    const m = new TurnMutation(base, context), ids: CardInstanceId[] = [];
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(actor, INCITERS);
    for (const cardId of rivalUnits) { const c = rewrite(rival, cardId); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = []; ids.push(c.id); }
    const d = GameStateSchema.parse(m.state);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs)) {
        const rolled = g.dieType === "D8";
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: 4 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids };
}
/** The actor plays Inciters (choosing `target` if asked), ends the turn, and the rival's turn reaches MAIN. */
function nextTurn(s: GameState, target?: CardInstanceId) {
    let state = playCard(s, context, INCITERS).state;
    if (state.resolution.choice?.kind === "TARGET") state = pick(state, context, o => o.kind === "CARD" && o.cardInstanceId === target).state;
    assert.equal(state.timing.step, "MAIN");
    state = take(state, context, a => a.action.kind === "END_TURN").state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    assert.equal(state.timing.activePlayer, rival);
    return state;
}
const canEnd = (s: GameState) => actions(s, context).some(a => a.action.kind === "END_TURN");
const canAttack = (s: GameState, id: CardInstanceId) => actions(s, context).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id);

test("the V43 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(inciters.provenance.sourceHash, hashCanonical(v43Source(inciters.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === inciters.id), [inciters]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Mox Inciters passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(inciters, context).ok); assert.ok(supportsPlay(inciters, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(inciters) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no Blocker", d => { d.mechanics.keywords = []; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["power", d => { d.power = 3; }],
        ["tags", d => { d.tags = ["Mox"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("the chosen rival Unit must attack on its controller's next turn; the turn cannot end until it has", () => {
    const a = arrange([ATLUS, ATLUS]), [x, y] = a.ids;
    const played = playCard(a.state, context, INCITERS).state;
    assert.equal(played.timing.step, "TARGET_SELECTION"); assert.deepEqual(played.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [x, y].sort());
    let s = nextTurn(a.state, x);
    assert.equal(s.mustAttack?.[0].targetId, x);
    assert.ok(canAttack(s, x)); assert.equal(canEnd(s), false, "x can still attack");
    assert.equal(validateState(GameStateSchema.parse({ ...s, mustAttack: [{ ...s.mustAttack![0], targetId: y }] }), context).ok, true, "either rival Unit may be bound");
    const declared = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === x);
    assert.ok(declared.events.some(e => e.payload.kind === "MUST_ATTACK_ENDED" && e.payload.reason === "ATTACKED"));
    s = declared.state;
    while (s.timing.step !== "MAIN") s = s.timing.step === "RIVAL_REACT" ? take(s, context, a => a.action.kind === "PASS_REACT").state : choose(s, context).state;
    assert.equal(s.mustAttack, undefined); assert.ok(canEnd(s), "the obligation is met");
});

test("a Unit that can't attack is not forced: a spent Unit, or Misty, lets the turn end; the obligation ends at the forcing player's next turn", () => {
    const a = arrange([MISTY]), s = nextTurn(a.state);
    assert.equal(s.mustAttack?.[0].targetId, a.ids[0], "Misty can be chosen");
    assert.equal(canAttack(s, a.ids[0]), false); assert.ok(canEnd(s), "Misty can't attack, so nothing is forced (official test)");
    const spent = GameStateSchema.parse(nextTurn(arrange([ATLUS]).state)); spent.objects.cards[spent.mustAttack![0].targetId].readiness = "SPENT";
    assert.ok(canEnd(unwrap(validateState(spent, context))), "a spent Unit can't attack");
    let back = take(s, context, a => a.action.kind === "END_TURN").state;
    while (back.timing.step !== "MAIN") back = take(back, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    assert.equal(back.timing.activePlayer, actor); assert.equal(back.mustAttack, undefined, "next turn is over");
});

test("with no rival Unit on the field the {Play} does nothing", () => {
    const a = arrange([]), played = playCard(a.state, context, INCITERS).state;
    assert.equal(played.timing.step, "MAIN"); assert.equal(played.mustAttack, undefined);
});

test("the reviewed union admits the V43 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === INCITERS));
});
