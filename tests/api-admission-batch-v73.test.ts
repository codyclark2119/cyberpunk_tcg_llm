import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { supportsCallTrashProgram } from "../packages/engine/src/call-trash-program-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV73Cards, batchV73Context, batchV73Input, v73Source } from "./api-admission-batch-v73-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV73Context();
const [streetkid] = batchV73Cards;
const PYRAMID = "pyramid-song", TOWERFALL = "towerfall", BONNIE = "bonnie-and-clyde", FLOOR = "floor-it", OCTANT = "octant"; // Braindance x3; a Quickhack Program; a Unit.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV73Input("batch-v73"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer;
const revision = (cardId: string) => context.content.cards.find(x => x.id === cardId)!;
/** Trusted arrangement: V face down as `player`'s last Legend; the trash holds `trash`; the deck's top cards are `top` (the rest
 * of the deck is emptied when `deckSize` is given). */
function arrange(top: string[], trash: string[], deckSize?: number, face: "UP" | "DOWN" = "DOWN", player: PlayerId = actor) {
    const m = new TurnMutation(GameStateSchema.parse(structuredClone(base)), context), p = m.state.players[player];
    const legend = m.state.objects.cards[p.zones.LEGENDS[p.zones.LEGENDS.length - 1]];
    legend.cardId = streetkid.id; legend.revision = streetkid.revision; legend.face = face; legend.readiness = "READY";
    for (const id of [...p.zones.TRASH]) moveCardLocation(m, id, "REMOVED");
    const trashIds = trash.map(cardId => { const c = m.state.objects.cards[p.zones.DECK[p.zones.DECK.length - 1]], r = revision(cardId); c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "TRASH"); return c.id; });
    if (deckSize !== undefined) while (p.zones.DECK.length > deckSize) moveCardLocation(m, p.zones.DECK[p.zones.DECK.length - 1], "REMOVED");
    const topIds = top.map((cardId, i) => { const c = m.state.objects.cards[p.zones.DECK[i]], r = revision(cardId); c.cardId = r.id; c.revision = r.revision; return c.id; });
    return { state: unwrap(validateState(GameStateSchema.parse(m.state), context)), legend: legend.id, trashIds, topIds };
}
/** Calls `id`, paying with the first offered sources. */
function call(s: GameState, id: CardInstanceId) {
    let r = take(s, context, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === id);
    const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 10); r = choose(r.state, context, 0); events.push(...r.events); }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
const hand = (s: GameState) => s.players[actor].zones.HAND;
const trashOf = (s: GameState) => s.players[actor].zones.TRASH;

test("the V73 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(streetkid.provenance.sourceHash, hashCanonical(v73Source(streetkid.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === streetkid.id), [streetkid]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("V: Streetkid passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsCall, supportsFieldLegend, supportsCallTrashProgram]) assert.ok(gate(streetkid, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(streetkid) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no Go Solo", d => { d.mechanics.keywords = []; }],
        ["Blocker too", d => { d.mechanics.keywords = ["GO_SOLO", "BLOCKER"]; }],
        ["another trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["a condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["power", d => { d.power = 7; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsCall, supportsFieldLegend, supportsCallTrashProgram]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the Call trashes 3, then offers every BRAINDANCE Program in the trash, including one just trashed", () => {
    const a = arrange([TOWERFALL, OCTANT, FLOOR], [PYRAMID, FLOOR, OCTANT, BONNIE]);
    const r = call(a.state, a.legend), s = r.state;
    assert.equal(s.objects.cards[a.legend].face, "UP");
    for (const id of a.topIds) assert.ok(trashOf(s).includes(id), "each of the top 3 cards is trashed");
    assert.equal(s.timing.step, "TARGET_SELECTION");
    const offered = s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort();
    assert.deepEqual(offered, [a.trashIds[0], a.trashIds[3], a.topIds[0]].sort(), "Pyramid Song, Bonnie and Clyde and the just-trashed Towerfall; never a Quickhack Program or a Unit");
    const labels = actions(s, context).map(x => x.descriptor.label);
    assert.ok(labels.some(l => l?.startsWith("Add Towerfall")), labels.join(" | "));
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.topIds[0]);
    assert.ok(validateState(done.state, context).ok);
    assert.ok(hand(done.state).includes(a.topIds[0]) && !trashOf(done.state).includes(a.topIds[0]));
    assert.ok(trashOf(done.state).includes(a.trashIds[0]) && trashOf(done.state).includes(a.trashIds[3]), "only one is added");
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.resolution.playContinuation, undefined);
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_RESOLVED"));
});

test("a lone BRAINDANCE Program is added without a choice, and none adds nothing", () => {
    const lone = arrange([OCTANT, FLOOR, OCTANT], [PYRAMID, FLOOR]);
    const r = call(lone.state, lone.legend);
    assert.equal(r.state.timing.step, "MAIN");
    assert.ok(hand(r.state).includes(lone.trashIds[0]));
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === lone.trashIds[0] && e.payload.forced));
    const none = arrange([OCTANT, FLOOR, OCTANT], [FLOOR, OCTANT]);
    const before = hand(none.state).length, after = call(none.state, none.legend).state;
    assert.equal(after.timing.step, "MAIN");
    assert.equal(hand(after).length, before);
    for (const id of none.topIds) assert.ok(trashOf(after).includes(id));
});

test("an empty deck stops the trashing without a loss, and the Program is still added", () => {
    const a = arrange([BONNIE, OCTANT], [], 2);
    const r = call(a.state, a.legend);
    assert.equal(r.state.match.outcome, undefined, "only drawing from an empty deck loses (1.14)");
    assert.equal(r.state.players[actor].zones.DECK.length, 0);
    assert.ok(hand(r.state).includes(a.topIds[0]), "the just-trashed Bonnie and Clyde is the lone Program");
});

test("face up, V: Streetkid still uses {Go Solo} as a field Legend", () => {
    const a = arrange([OCTANT, FLOOR, OCTANT], [], undefined, "UP");
    assert.ok(actions(a.state, context).some(x => x.action.kind === "GO_SOLO" && x.action.cardInstanceId === a.legend));
    const r = take(a.state, context, x => x.action.kind === "GO_SOLO" && x.action.cardInstanceId === a.legend);
    let s = r.state;
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 10); s = choose(s, context, 0).state; }
    assert.ok(validateState(s, context).ok);
    assert.equal(s.objects.cards[a.legend].zone.zone, "BATTLEFIELD");
});
