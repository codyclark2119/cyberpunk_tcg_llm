import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameEvent, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTargetedSpendCard } from "../packages/engine/src/targeted-spend-support";
import { supportsEndTurnCard } from "../packages/engine/src/end-turn-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV8Cards, batchV8Context, batchV8Input, v8Source, MALFINI, MURAMASA, SQUADRON } from "./api-admission-batch-v8-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { withGigs, placeCard, playCard, pick } from "./value-conditions-focused";
import { clearField, fund, field } from "./targeted-defeat-focused";
import { choose, take, end } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV8Context();
const card = (id: string) => batchV8Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV8Input("batch-v8"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_OWN_TURN_ENDS"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
function put(s: GameState, cardId: string, player = rival, readiness: "READY" | "SPENT" = "READY") {
    const placed = field(s, context, cardId, player), d = GameStateSchema.parse(placed.state);
    d.objects.cards[placed.id].readiness = readiness;
    return { state: unwrap(validateState(d, context)), id: placed.id };
}
const d6 = (player: string) => Object.values(base.objects.gigs).find(g => g.controllerId === player && g.dieType === "D6")!.id;
const cred = (s: GameState, lead: boolean) => withGigs(s, context, { [d6(actor)]: lead ? 6 : 1, [d6(rival)]: lead ? 1 : 6 });
/** Flip the active player's Legends face up and set their readiness (trusted arrangement). */
function legends(s: GameState, readiness: "READY" | "SPENT") {
    const d = GameStateSchema.parse(s);
    for (const id of d.players[actor].zones.LEGENDS) { d.objects.cards[id].face = "UP"; d.objects.cards[id].readiness = readiness; }
    return { state: unwrap(validateState(d, context)), ids: [...d.players[actor].zones.LEGENDS].sort() as CardInstanceId[] };
}
const readied = (events: readonly GameEvent[]) => events.flatMap(e => e.payload.kind === "CARD_READIED" ? [e.payload.cardInstanceId] : []);

test("V8 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV8Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v8Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.equal(card(MALFINI).rulesText, "{Play} Spend this Unit and a rival Unit.");
    assert.equal(card(MURAMASA).rulesText, "At the end of your turn, if you have less ☆ (Street Cred) than a Rival, ready this Unit.");
    assert.equal(card(SQUADRON).rulesText, "At the end of your turn, if this Unit is spent, ready a friendly face-up Legend.");
});

test("each V8 card passes only its own exact pin; any changed field is rejected", () => {
    assert.ok(supportsTargetedSpendCard(card(MALFINI), context).ok);
    assert.ok(supportsEndTurnCard(card(MURAMASA), context).ok);
    assert.ok(supportsEndTurnCard(card(SQUADRON), context).ok);
    for (const c of batchV8Cards) assert.ok(supportsPlay(c, context).ok, c.id);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const malfini: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no self spend", d => { d.mechanics.abilities[0].effects = d.mechanics.abilities[0].effects.slice(1); }],
        ["cost cap", d => { d.mechanics.abilities[0].effects = [{ kind: "SPEND_SOURCE" }, { kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL", costAtMost: 4 } }]; }],
        ["any relation", d => { d.mechanics.abilities[0].effects = [{ kind: "SPEND_SOURCE" }, { kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "ANY" } }]; }],
        ["power", d => { d.power = 4; }]
    ];
    for (const [label, edit] of malfini) assert.equal(supportsTargetedSpendCard(forge(card(MALFINI), edit), context).ok, false, label);
    const endTurn: [string, CardRevisionSnapshot, (d: CardRevisionSnapshot) => void][] = [
        ["Muramasa condition", card(MURAMASA), d => { d.mechanics.abilities[0].conditions = [{ kind: "STREET_CRED_GREATER_THAN_RIVAL" }]; }],
        ["Muramasa unconditional", card(MURAMASA), d => { d.mechanics.abilities[0].conditions = []; }],
        ["Muramasa readies a Legend", card(MURAMASA), d => { d.mechanics.abilities[0].effects = [{ kind: "READY_UNIT", target: { kind: "FRIENDLY_FACE_UP_LEGEND" } }]; }],
        ["Squadron readies itself", card(SQUADRON), d => { d.mechanics.abilities[0].effects = [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }]; }],
        ["Squadron tags", card(SQUADRON), d => { d.tags = ["NCPD", "Corpo"]; }],
        ["Squadron trigger", card(SQUADRON), d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }]
    ];
    for (const [label, c, edit] of endTurn) assert.equal(supportsEndTurnCard(forge(c, edit), context).ok, false, label);
});

test("Offduty Malfini spends itself, then a chosen rival Unit (ready or spent); one target is forced; none still spends itself", () => {
    const a = put(base, unitOfPower(2)), b = put(a.state, unitOfPower(4), rival, "SPENT"), own = put(b.state, unitOfPower(3), actor);
    const placed = placeCard(own.state, context, MALFINI), played = playCard(placed.state, context, MALFINI);
    assert.equal(played.state.objects.cards[placed.id].readiness, "SPENT");
    assert.equal(played.state.timing.step, "TARGET_SELECTION");
    assert.deepEqual(played.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null), [a.id, b.id].sort());
    const done = pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === a.id);
    assert.equal(done.state.resolution.choice, null);
    assert.equal(done.state.objects.cards[a.id].readiness, "SPENT");
    assert.equal(done.state.objects.cards[own.id].readiness, "READY");
    const one = playCard(placeCard(a.state, context, MALFINI).state, context, MALFINI);
    assert.equal(one.state.resolution.choice, null);
    assert.equal(one.state.objects.cards[a.id].readiness, "SPENT");
    const none = placeCard(base, context, MALFINI), alone = playCard(none.state, context, MALFINI);
    assert.equal(alone.state.resolution.choice, null);
    assert.equal(alone.state.objects.cards[none.id].readiness, "SPENT");
});

test("Modded Muramasa readies itself at its controller's turn end only while behind on Street Cred", () => {
    const m = put(base, MURAMASA, actor, "SPENT");
    const behind = end(cred(m.state, false), context);
    assert.ok(readied(behind.events).includes(m.id));
    assert.equal(behind.state.objects.cards[m.id].readiness, "READY");
    const ahead = end(cred(m.state, true), context);
    assert.ok(!readied(ahead.events).includes(m.id));
    assert.equal(ahead.state.objects.cards[m.id].readiness, "SPENT");
});

test("MaxTac Squadron readies a chosen friendly face-up Legend only if it is spent at turn end", () => {
    const up = legends(base, "SPENT"); assert.ok(up.ids.length >= 2, "needs two Legends");
    const spent = put(up.state, SQUADRON, actor, "SPENT"), paused = end(spent.state, context);
    assert.equal(paused.state.timing.step, "TARGET_SELECTION");
    assert.deepEqual(paused.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null), up.ids);
    const chosen = pick(paused.state, context, o => o.kind === "CARD" && o.cardInstanceId === up.ids[1]);
    assert.deepEqual(readied(chosen.events), [up.ids[1]]);
    const ready = put(up.state, SQUADRON, actor, "READY"), skipped = end(ready.state, context);
    assert.deepEqual(readied(skipped.events).filter(id => up.ids.includes(id)), []);
    const faceDown = put(base, SQUADRON, actor, "SPENT"), noLegend = end(faceDown.state, context);
    assert.equal(noLegend.state.resolution.choice?.kind === "TARGET", false);
});

test("the reviewed union admits the V8 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [MALFINI, MURAMASA, SQUADRON]) assert.ok(ids.has(id), id);
});
