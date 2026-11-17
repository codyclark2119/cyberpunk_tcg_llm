import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameEvent, type GameState } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsEndTurnCard } from "../packages/engine/src/end-turn-support";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV9Cards, batchV9Context, batchV9Input, v9Source, SANDEVISTAN, KUSANAGI, REAPER } from "./api-admission-batch-v9-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { placeCard, playCard, pick } from "./value-conditions-focused";
import { clearField, fund, field, equip, finishOrder } from "./targeted-defeat-focused";
import { choose, take, end } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV9Context();
const card = (id: string) => batchV9Cards.find(c => c.id === id)!;
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV9Input("batch-v9"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
function unitOfPower(power: number) {
    const r = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && c.power === power && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_OWN_TURN_ENDS"));
    assert.ok(r, `no plain reviewed Unit with power ${power}`); return r.id;
}
function put(s: GameState, cardId: string, player = rival, readiness: "READY" | "SPENT" = "READY") {
    const placed = field(s, context, cardId, player), d = GameStateSchema.parse(placed.state);
    d.objects.cards[placed.id].readiness = readiness;
    return { state: unwrap(validateState(d, context)), id: placed.id };
}
function setReadiness(s: GameState, id: CardInstanceId, readiness: "READY" | "SPENT") {
    const d = GameStateSchema.parse(s); d.objects.cards[id].readiness = readiness; return unwrap(validateState(d, context));
}
function faceUpLegend(s: GameState, readiness: "READY" | "SPENT") {
    const d = GameStateSchema.parse(s), id = [...d.players[actor].zones.LEGENDS].sort()[0] as CardInstanceId;
    d.objects.cards[id].face = "UP"; d.objects.cards[id].readiness = readiness;
    return { state: unwrap(validateState(d, context)), id };
}
const readied = (events: readonly GameEvent[]) => events.flatMap(e => e.payload.kind === "CARD_READIED" ? [e.payload.cardInstanceId] : []);
const spentBy = (events: readonly GameEvent[]) => events.flatMap(e => e.payload.kind === "CARD_SPENT" ? [e.payload.cardInstanceId] : []);

test("V9 revisions are exact source projections and match their engine candidates", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const c of batchV9Cards) {
        assert.equal(c.provenance.sourceHash, hashCanonical(v9Source(c.id)));
        const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === c.id), [c]);
        assert.equal(review.status, "SOURCE_MATCH", `${c.id}: ${review.differences.join(", ")}`);
    }
    assert.match(card(SANDEVISTAN).rulesText, /At the end of your turn, ready this Unit or Legend\.$/);
    assert.match(card(KUSANAGI).rulesText, /At the end of your turn, return this Unit to its owner's hand\.$/);
    assert.equal(card(REAPER).rulesText, "Spend all rival Units. Then, defeat a spent Unit.");
});

test("each V9 card passes only its own exact pin; any changed field is rejected", () => {
    assert.ok(supportsEndTurnCard(card(SANDEVISTAN), context).ok);
    assert.ok(supportsEndTurnCard(card(KUSANAGI), context).ok);
    assert.ok(supportsTargetedDefeatCard(card(REAPER), context).ok);
    for (const c of batchV9Cards) assert.ok(supportsPlay(c, context).ok, c.id);
    const forge = (c: CardRevisionSnapshot, edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(c) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const endTurn: [string, CardRevisionSnapshot, (d: CardRevisionSnapshot) => void][] = [
        ["Sandevistan not inherited", card(SANDEVISTAN), d => { delete (d.mechanics.abilities[0] as { inherited?: string }).inherited; }],
        ["Sandevistan no printed power grant", card(SANDEVISTAN), d => { d.mechanics.modifiers = []; }],
        ["Sandevistan readies a Legend", card(SANDEVISTAN), d => { d.mechanics.abilities[0].effects = [{ kind: "READY_UNIT", target: { kind: "FRIENDLY_FACE_UP_LEGEND" } }]; }],
        ["Sandevistan cost", card(SANDEVISTAN), d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["Kusanagi without Adrenaline", card(KUSANAGI), d => { d.mechanics.keywords = []; }],
        ["Kusanagi with Blocker", card(KUSANAGI), d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["Kusanagi conditional", card(KUSANAGI), d => { d.mechanics.abilities[0].conditions = [{ kind: "SUBJECT_IS_SPENT" }]; }],
        ["Kusanagi power", card(KUSANAGI), d => { d.power = 9; }]
    ];
    for (const [label, c, edit] of endTurn) assert.equal(supportsEndTurnCard(forge(c, edit), context).ok, false, label);
    const reaper: [string, (d: CardRevisionSnapshot) => void][] = [
        ["defeat first", d => { d.mechanics.abilities[0].effects = [...d.mechanics.abilities[0].effects].reverse(); }],
        ["no mass spend", d => { d.mechanics.abilities[0].effects = d.mechanics.abilities[0].effects.slice(1); }],
        ["any readiness", d => { d.mechanics.abilities[0].effects = [{ kind: "SPEND_ALL_UNITS", relation: "RIVAL" }, { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" } } }]; }],
        ["rival only", d => { d.mechanics.abilities[0].effects = [{ kind: "SPEND_ALL_UNITS", relation: "RIVAL" }, { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, readiness: "SPENT" } }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 6 }; }]
    ];
    for (const [label, edit] of reaper) assert.equal(supportsTargetedDefeatCard(forge(card(REAPER), edit), context).ok, false, label);
});

test("Sandevistan readies its spent host at its controller's turn end, Unit or face-up Legend", () => {
    const host = put(base, unitOfPower(3), actor, "SPENT"), gear = equip(host.state, context, SANDEVISTAN, host.id);
    const ended = end(gear.state, context);
    assert.ok(readied(ended.events).includes(host.id));
    const ready = end(setReadiness(gear.state, host.id, "READY"), context);
    assert.ok(!readied(ready.events).includes(host.id));
    const legend = faceUpLegend(base, "SPENT"), onLegend = equip(legend.state, context, SANDEVISTAN, legend.id);
    assert.ok(readied(end(onLegend.state, context).events).includes(legend.id));
});

test("Modded Kusanagi can attack the turn it is played and returns to hand with its Gear at turn end", () => {
    const placed = placeCard(base, context, KUSANAGI), played = playCard(placed.state, context, KUSANAGI);
    assert.equal(played.state.objects.cards[placed.id].zone.zone, "BATTLEFIELD");
    assert.ok(played.state.objects.cards[placed.id].statuses.includes("LAG"));
    const attack = (s: GameState) => unwrap(listLegalActions(s, actor, context)).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === placed.id);
    assert.ok(attack(put(played.state, unitOfPower(3), rival, "SPENT").state), "Adrenaline lets the lagging Unit attack");
    const gear = equip(played.state, context, SANDEVISTAN, placed.id);
    let ended = end(gear.state, context);
    assert.equal(ended.state.timing.step, "TRIGGER_ORDER_SELECTION"); // Both own-turn end triggers; the controller orders them.
    while (ended.state.resolution.choice) ended = choose(ended.state, context, 0);
    const k = ended.state.objects.cards[placed.id], g = ended.state.objects.cards[gear.id];
    assert.equal(k.zone.zone, "HAND"); assert.equal(k.face, "DOWN"); assert.deepEqual(k.attachments, []);
    assert.equal(g.zone.zone, "HAND");
    assert.ok(ended.state.players[actor].zones.HAND.includes(placed.id));
});

test("Don't Fear the Reaper spends every rival Unit, then defeats a chosen spent Unit of either side", () => {
    const a = put(base, unitOfPower(3)), b = put(a.state, unitOfPower(4), rival, "SPENT"), own = put(b.state, unitOfPower(5), actor, "SPENT"), mine = put(own.state, unitOfPower(6), actor);
    const placed = placeCard(mine.state, context, REAPER), played = playCard(placed.state, context, REAPER);
    assert.deepEqual(spentBy(played.events), [a.id]);
    assert.equal(played.state.objects.cards[mine.id].readiness, "READY");
    assert.deepEqual(played.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null), [a.id, b.id, own.id].sort());
    const done = finishOrder(pick(played.state, context, o => o.kind === "CARD" && o.cardInstanceId === own.id).state, context);
    assert.equal(done.state.objects.cards[own.id].zone.zone, "TRASH");
    assert.equal(done.state.objects.cards[a.id].zone.zone, "BATTLEFIELD");
    const lone = put(base, unitOfPower(3)), forced = finishOrder(playCard(placeCard(lone.state, context, REAPER).state, context, REAPER).state, context);
    assert.equal(forced.state.objects.cards[lone.id].zone.zone, "TRASH");
    const empty = playCard(placeCard(base, context, REAPER).state, context, REAPER);
    assert.equal(empty.state.resolution.choice, null);
});

test("the reviewed union admits the V9 cards", () => {
    const ids = new Set<string>(reviewedUnionContext().content.cards.map(c => c.id));
    for (const id of [SANDEVISTAN, KUSANAGI, REAPER]) assert.ok(ids.has(id), id);
});
