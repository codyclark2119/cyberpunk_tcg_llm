import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV46Cards, batchV46Context, batchV46Input, v46Source, SAFETY } from "./api-admission-batch-v46-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV46Context();
const safety = batchV46Cards[0];
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad"; // Vanilla Units, power 4 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV46Input("batch-v46"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: Safety Override in `holder`'s hand; the actor's ready attacker and the rival's spent defender on the field. */
function arrange(attacker: string, defender: string, holder: PlayerId) {
    const m = new TurnMutation(base, context);
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(holder, SAFETY);
    const a = rewrite(actor, attacker), d = rewrite(rival, defender);
    for (const [c, readiness] of [[a, "READY"], [d, "SPENT"]] as const) { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = readiness; c.statuses = []; }
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), attacker: a.id, defender: d.id };
}
/** The actor attacks `defender` with `attacker`; `react` runs in the defender's React Step before it passes. */
function attack(s: GameState, attacker: CardInstanceId, defender: CardInstanceId, react?: (s: GameState) => GameState) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === defender).state;
    assert.equal(state.timing.step, "RIVAL_REACT");
    if (react) state = react(state);
    const events = [];
    while (state.timing.step !== "MAIN") { const r = state.timing.step === "RIVAL_REACT" ? take(state, context, a => a.action.kind === "PASS_REACT") : choose(state, context); state = r.state; events.push(...r.events); }
    return { state, events };
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);

test("the V46 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(safety.provenance.sourceHash, hashCanonical(v46Source(safety.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === safety.id), [safety]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Safety Override passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsPlay(safety, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(safety) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not Quick", d => { d.mechanics.keywords = []; }],
        ["immediate defeat", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "OPPOSING_UNIT" } }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["tags", d => { d.tags = ["Quickhack", "Plan"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("played in Main, the attacker loses its fight: after the fight ends the opposing rival Unit is defeated", () => {
    const a = arrange(ATLUS, PSYCHO, actor), played = playCard(a.state, context, SAFETY);
    assert.equal(played.state.fightOutcomeEffects?.length, 1); assert.ok(kinds(played.events).includes("FIGHT_OUTCOME_EFFECT_CREATED"));
    const done = attack(played.state, a.attacker, a.defender), k = kinds(done.events);
    assert.equal(zone(done.state, a.attacker), "TRASH", "the attacker lost the fight"); assert.equal(zone(done.state, a.defender), "TRASH", "Safety Override defeats the winner");
    assert.ok(k.indexOf("FIGHT_OUTCOME_EFFECT_FIRED") > k.indexOf("FIGHT_RESULT"));
    const fightDefeat = done.events.findIndex(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.attacker), effectDefeat = done.events.findIndex(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.defender);
    assert.ok(fightDefeat >= 0 && effectDefeat > fightDefeat, "the effect resolves after the fight's defeats (11.4.2.2.1)");
    assert.equal(done.state.fightOutcomeEffects, undefined, "consumed"); assert.equal(done.state.timing.combat.stage, "NONE");
});

test("played as a React by the defending player, its losing defender takes the winning attacker with it", () => {
    const a = arrange(PSYCHO, ATLUS, rival);
    const done = attack(a.state, a.attacker, a.defender, s => {
        const r = playCard(s, context, SAFETY).state;
        assert.equal(r.fightOutcomeEffects?.[0].controllerId, rival); assert.equal(r.timing.step, "RIVAL_REACT");
        return r;
    });
    assert.equal(zone(done.state, a.defender), "TRASH"); assert.equal(zone(done.state, a.attacker), "TRASH");
    assert.equal(done.state.timing.activePlayer, actor);
});

test("in a tie both Units are defeated by the fight and the fired effect finds no opposing Unit; a won fight does not fire it", () => {
    const tie = arrange(ATLUS, ATLUS, actor), t = attack(playCard(tie.state, context, SAFETY).state, tie.attacker, tie.defender);
    assert.ok(kinds(t.events).includes("FIGHT_OUTCOME_EFFECT_FIRED")); assert.equal(zone(t.state, tie.attacker), "TRASH"); assert.equal(zone(t.state, tie.defender), "TRASH");
    assert.equal(t.events.filter(e => e.payload.kind === "DEFEAT_TARGET_SELECTED").length, 0, "nothing left to defeat");
    const win = arrange(PSYCHO, ATLUS, actor), w = attack(playCard(win.state, context, SAFETY).state, win.attacker, win.defender);
    assert.equal(kinds(w.events).includes("FIGHT_OUTCOME_EFFECT_FIRED"), false); assert.equal(zone(w.state, win.attacker), "BATTLEFIELD");
    assert.equal(w.state.fightOutcomeEffects?.length, 1, "still waiting for a lost fight this turn");
    const ended = take(w.state, context, a => a.action.kind === "END_TURN");
    assert.ok(kinds(ended.events).includes("FIGHT_OUTCOME_EFFECT_EXPIRED")); assert.equal(ended.state.fightOutcomeEffects, undefined);
});

test("a registration is exact: forged id, controller or duplicate is invalid", () => {
    const s = playCard(arrange(ATLUS, PSYCHO, actor).state, context, SAFETY).state, e = s.fightOutcomeEffects![0];
    for (const forged of [{ ...e, id: hashCanonical("x") }, { ...e, controllerId: rival }, { ...e, createdTurn: e.createdTurn + 1 }]) {
        const d = GameStateSchema.parse(s); d.fightOutcomeEffects = [forged as typeof e];
        assert.equal(validateState(d, context).ok, false);
    }
    const twice = GameStateSchema.parse(s); twice.fightOutcomeEffects = [e, e];
    assert.equal(validateState(twice, context).ok, false);
});

test("the reviewed union admits the V46 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === SAFETY));
});
