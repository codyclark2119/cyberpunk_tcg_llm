import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV51Cards, batchV51Context, batchV51Input, v51Source, ZEALOTS } from "./api-admission-batch-v51-fixture";
import { SAFETY } from "./api-admission-batch-v46-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV51Context();
const zealots = batchV51Cards[0];
const PSYCHO = "psycho-squad", OCTANT = "octant", BOMBUS = "secondhand-bombus"; // Power 6, 8 and 0 (Bombus has [Blocker]).
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV51Input("batch-v51"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: `mine` and `theirs` on the field (ready unless listed in `spent`), extra actor hand cards. */
function arrange(a: { mine: string[]; theirs: string[]; spent?: string[]; hand?: string[] }) {
    const m = new TurnMutation(base, context), ids: Record<string, CardInstanceId> = {};
    const rewrite = (player: PlayerId, cardId: string, zone: "HAND" | "BATTLEFIELD") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); if (zone !== "HAND") moveCardLocation(m, c.id, zone); c.statuses = [];
        if (zone === "BATTLEFIELD") c.readiness = a.spent?.includes(cardId) ? "SPENT" : "READY";
        ids[cardId] = c.id;
    };
    for (const id of a.mine) rewrite(actor, id, "BATTLEFIELD");
    for (const id of a.theirs) rewrite(rival, id, "BATTLEFIELD");
    for (const id of a.hand ?? []) rewrite(actor, id, "HAND");
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), ids };
}
/** `attacker` attacks `target`; the defender passes React; every later choice takes its first option. */
function fight(s: GameState, attacker: CardInstanceId, target: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === target).state;
    const events = [];
    while (!(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE")) {
        assert.ok(validateState(state, context).ok);
        const r = state.timing.step === "RIVAL_REACT" ? take(state, context, a => a.action.kind === "PASS_REACT") : choose(state, context, 0);
        state = r.state; events.push(...r.events);
    }
    return { state, events };
}
const zone = (s: GameState, id: CardInstanceId) => s.objects.cards[id].zone.zone;
const defeatedBy = (events: { payload: { kind: string; cardInstanceId?: string; defeatedBy?: string } }[], id: CardInstanceId) => events.find(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === id)?.payload.defeatedBy;

test("the V51 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(zealots.provenance.sourceHash, hashCanonical(v51Source(zealots.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === zealots.id), [zealots]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Maelstrom Zealots passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTargetedDefeatCard]) assert.ok(gate(zealots, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(zealots) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["wins", d => { d.mechanics.abilities[0].trigger = "WHEN_FIGHT_WON"; }],
        ["any rival", d => { d.mechanics.abilities[0].effects = [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" } } }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["power", d => { d.power = 1; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["Blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTargetedDefeatCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("attacking: Zealots loses, is defeated, and defeats the opposing Unit after the fight", () => {
    const a = arrange({ mine: [ZEALOTS], theirs: [PSYCHO], spent: [PSYCHO] }), z = a.ids[ZEALOTS], p = a.ids[PSYCHO];
    const done = fight(a.state, z, p);
    assert.equal(zone(done.state, z), "TRASH"); assert.equal(zone(done.state, p), "TRASH");
    assert.equal(defeatedBy(done.events, z), p); assert.equal(defeatedBy(done.events, p), z);
    assert.ok(done.events.findIndex(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === z) < done.events.findIndex(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p), "after the fight's own defeat");
});

test("defending on the rival's turn: the attacker that beat Zealots is defeated", () => {
    const a = arrange({ mine: [ZEALOTS], theirs: [OCTANT], spent: [ZEALOTS] }), z = a.ids[ZEALOTS], o = a.ids[OCTANT];
    let s = end(a.state, context).state;
    while (!(s.timing.step === "MAIN" && s.timing.activePlayer === rival)) s = take(s, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    const done = fight(s, o, z);
    assert.equal(zone(done.state, z), "TRASH"); assert.equal(zone(done.state, o), "TRASH"); assert.equal(defeatedBy(done.events, o), z);
});

test("against a power-0 Unit neither is defeated in the fight, but Zealots still lost and defeats it", () => {
    const a = arrange({ mine: [ZEALOTS], theirs: [BOMBUS], spent: [BOMBUS] }), z = a.ids[ZEALOTS], b = a.ids[BOMBUS];
    const done = fight(a.state, z, b);
    assert.equal(zone(done.state, z), "BATTLEFIELD", "power 0 defeats nothing in a fight (11.4.2.3.2)");
    assert.equal(zone(done.state, b), "TRASH"); assert.equal(defeatedBy(done.events, b), z);
});

test("with Safety Override registered too, the opposing Unit is defeated once", () => {
    const a = arrange({ mine: [ZEALOTS], theirs: [PSYCHO], spent: [PSYCHO], hand: [SAFETY] }), z = a.ids[ZEALOTS], p = a.ids[PSYCHO];
    let s = take(a.state, context, x => x.action.kind === "PLAY_CARD" && x.action.cardInstanceId === a.ids[SAFETY]).state;
    while (s.resolution.choice) s = choose(s, context, Math.max(0, s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"))).state;
    assert.ok(s.fightOutcomeEffects?.length);
    const done = fight(s, z, p);
    assert.equal(zone(done.state, p), "TRASH"); assert.equal(done.events.filter(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === p).length, 1);
    assert.equal(done.state.fightOutcomeEffects, undefined, "the registration fired on this fight");
});

test("the reviewed union contains Maelstrom Zealots", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === ZEALOTS));
});
