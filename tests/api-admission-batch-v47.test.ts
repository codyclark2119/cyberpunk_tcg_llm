import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV47Cards, batchV47Context, batchV47Input, v47Source, APPETITE } from "./api-admission-batch-v47-fixture";
import { MISTY } from "./api-admission-batch-v42-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV47Context();
const appetite = batchV47Cards[0];
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad", GOONS = "maelstrom-goons", V = "v-roamer-of-the-badlands"; // 4, 6, 3, 6 power.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV47Input("batch-v47"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Appetite in the actor's hand, the actor's ready attacker and the rival's spent defender on the field;
 * the rival's Gigs listed in `rivalGigs` (die type and value) are rolled into its Gig area, every other Gig waits unrolled. */
function arrange(attacker: string, defender: string, rivalGigs: [string, number][]) {
    const m = new TurnMutation(base, context);
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(actor, APPETITE);
    const a = rewrite(actor, attacker), d = rewrite(rival, defender);
    for (const [c, readiness] of [[a, "READY"], [d, "SPENT"]] as const) { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = readiness; c.statuses = []; }
    const s = GameStateSchema.parse(m.state), gigs: GigInstanceId[] = [];
    for (const p of Object.values(s.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(s.objects.gigs)) {
        const rolled = g.ownerId === rival ? rivalGigs.find(([die]) => die === g.dieType) : undefined;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: rolled[1] } : { kind: "UNROLLED" };
        s.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (rolled) gigs.push(g.id);
    }
    return { state: unwrap(validateState(s, context)), attacker: a.id, defender: d.id, gigs: gigs.sort() };
}
/** The actor attacks `defender`; the rival passes; every later choice takes `pickGig` when offered a Gig, else the first option. */
function attack(s: GameState, attacker: CardInstanceId, defender: CardInstanceId, pickGig?: GigInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === defender).state;
    const events = [], choices: string[] = [];
    while (state.timing.step !== "MAIN") {
        const gigChoice = state.resolution.choice?.options.some(o => o.kind === "GIG" && o.gigInstanceId === pickGig);
        if (state.resolution.choice) choices.push(state.timing.step!);
        const r = state.timing.step === "RIVAL_REACT" ? take(state, context, a => a.action.kind === "PASS_REACT") : gigChoice ? pick(state, context, o => o.kind === "GIG" && o.gigInstanceId === pickGig) : choose(state, context);
        state = r.state; events.push(...r.events);
    }
    return { state, events, choices };
}
const owner = (s: GameState, id: GigInstanceId) => s.objects.gigs[id].controllerId;
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);

test("the V47 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(appetite.provenance.sourceHash, hashCanonical(v47Source(appetite.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === appetite.id), [appetite]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Appetite for Destruction passes only its exact pin; any changed field is rejected, and no other gate reads it", () => {
    assert.ok(supportsPlay(appetite, context).ok);
    assert.equal(supportsTriggerCard(appetite, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(appetite) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["on a loss", d => { d.mechanics.abilities[0].effects = [{ kind: "REGISTER_NEXT_FIGHT_OUTCOME", on: "FRIENDLY_UNIT_LOSES", effect: { kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1 } }]; }],
        ["defeat instead", d => { d.mechanics.abilities[0].effects = [{ kind: "REGISTER_NEXT_FIGHT_OUTCOME", on: "FRIENDLY_UNIT_WINS_BY_3", effect: { kind: "DEFEAT_UNIT", target: { kind: "OPPOSING_UNIT" } } }]; }],
        ["immediate steal", d => { d.mechanics.abilities[0].effects = [{ kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1 }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["Quick", d => { d.mechanics.keywords = ["QUICK"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["tags", d => { d.tags = ["Ganger", "Plan"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("a fight won by exactly 3 fires it: after the loser is defeated the winner steals the rival's lone Gig", () => {
    const a = arrange(GOONS, MISTY, [["D8", 4]]), played = playCard(a.state, context, APPETITE).state;
    assert.equal(played.fightOutcomeEffects?.length, 1);
    const done = attack(played, a.attacker, a.defender), k = kinds(done.events);
    assert.equal(done.state.objects.cards[a.defender].zone.zone, "TRASH");
    assert.equal(owner(done.state, a.gigs[0]), actor, "stolen");
    assert.ok(k.indexOf("FIGHT_OUTCOME_EFFECT_FIRED") < k.indexOf("CARD_DEFEATED") && k.indexOf("CARD_DEFEATED") < k.indexOf("GIG_STOLEN"), "the steal resolves after the fight ends");
    assert.ok(done.events.some(e => e.payload.kind === "GIG_STOLEN" && e.payload.attackerId === a.attacker));
    assert.equal(done.state.turnHistory?.gigsStolenByUnit?.[a.attacker], 1); assert.equal(done.state.fightOutcomeEffects, undefined);
});

test("with two rival Gigs the controller chooses; the winner's own steal trigger then joins the batch", () => {
    const a = arrange(V, MISTY, [["D8", 4], ["D6", 2]]), target = a.gigs[1];
    const done = attack(playCard(a.state, context, APPETITE).state, a.attacker, a.defender, target), k = kinds(done.events);
    assert.equal(owner(done.state, target), actor); assert.equal(owner(done.state, a.gigs.find(g => g !== target)!), rival);
    assert.ok(done.choices.includes("TARGET_SELECTION"), "a Gig choice");
    assert.ok(k.lastIndexOf("EFFECT_PENDING") > k.indexOf("GIG_STOLEN"), "V's steal trigger becomes pending after the move");
});

test("a fight won by less than 3 or lost does not fire it; with no rival Gig the fired steal does nothing", () => {
    const by2 = arrange(PSYCHO, ATLUS, [["D8", 4]]), w = attack(playCard(by2.state, context, APPETITE).state, by2.attacker, by2.defender);
    assert.equal(kinds(w.events).includes("FIGHT_OUTCOME_EFFECT_FIRED"), false); assert.equal(owner(w.state, by2.gigs[0]), rival); assert.equal(w.state.fightOutcomeEffects?.length, 1);
    const lost = arrange(ATLUS, PSYCHO, [["D8", 4]]), l = attack(playCard(lost.state, context, APPETITE).state, lost.attacker, lost.defender);
    assert.equal(kinds(l.events).includes("FIGHT_OUTCOME_EFFECT_FIRED"), false);
    const none = arrange(PSYCHO, MISTY, []), n = attack(playCard(none.state, context, APPETITE).state, none.attacker, none.defender);
    assert.ok(kinds(n.events).includes("FIGHT_OUTCOME_EFFECT_FIRED")); assert.equal(kinds(n.events).includes("GIG_STOLEN"), false); assert.equal(n.state.timing.step, "MAIN");
});

test("the reviewed union admits the V47 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === APPETITE));
});
