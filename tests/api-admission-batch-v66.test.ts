import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { effectiveCallCost, supportsFreeCallUnit } from "../packages/engine/src/free-call-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV66Cards, batchV66Context, batchV66Input, v66Source, PANAM } from "./api-admission-batch-v66-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV66Context();
const panam = batchV66Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV66Input("batch-v66"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { panam?: boolean; broke?: boolean; faceUp?: number; hand?: number; target?: boolean };
/** Trusted arrangement on the actor's MAIN: Panam ready on the field (unless `panam` is false); with `broke`, every Eddie and every
 * Legend spent, so no Call payment exists; `faceUp` of the actor's first Legends face up; `hand` cards in hand; with `target`,
 * a spent rival Psycho Squad to attack. */
function arrange(a: Arrangement) {
    const m = new TurnMutation(base, context);
    let id: CardInstanceId | undefined;
    if (a.panam !== false) {
        const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]];
        c.cardId = panam.id; c.revision = panam.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; id = c.id;
    }
    if (a.target) {
        const deck = m.state.players[rival].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === "psycho-squad")!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "SPENT";
    }
    const d = GameStateSchema.parse(m.state), p = d.players[actor], legends = p.zones.LEGENDS;
    if (a.broke) { for (const e of p.zones.EDDIES) d.objects.cards[e].readiness = "SPENT"; for (const l of legends) d.objects.cards[l].readiness = "SPENT"; }
    legends.slice(0, a.faceUp ?? 0).forEach(l => { d.objects.cards[l].face = "UP"; });
    while (a.hand !== undefined && p.zones.HAND.length > a.hand) { const h = p.zones.HAND.pop()!; p.zones.DECK.push(h); d.objects.cards[h].zone = { playerId: actor, zone: "DECK" }; }
    return { state: unwrap(validateState(d, context)), panam: id!, legend: legends[legends.length - 1] };
}
const calls = (s: GameState, legend: CardInstanceId) => unwrap(listLegalActions(s, s.timing.actingPlayer, context)).filter(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === legend);

test("the V66 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(panam.provenance.sourceHash, hashCanonical(v66Source(panam.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === panam.id), [panam]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Panam passes only her exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsFreeCallUnit]) assert.ok(gate(panam, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(panam) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no free Call", d => { d.mechanics.modifiers = []; }],
        ["plain discard", d => { d.mechanics.abilities[0].effects = [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" }]; }],
        ["rival discards", d => { d.mechanics.abilities[0].effects = [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", thenDraw: "PER_FRIENDLY_FACE_UP_LEGEND" }]; }],
        ["power", d => { d.power = 7; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsFreeCallUnit]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("in her controller's turn a Legend is Called for free, once per turn", () => {
    const a = arrange({ broke: true });
    assert.equal(calls(a.state, a.legend).length, 1);
    const r = take(a.state, context, x => x.action.kind === "CALL_LEGEND" && x.action.cardInstanceId === a.legend);
    assert.ok(r.events.some(e => e.payload.kind === "PAYMENT_MADE" && "sources" in e.payload && (e.payload.sources as unknown[]).length === 0), "no payment source is spent");
    let s = r.state;
    for (let n = 0; s.resolution.choice; n++) { assert.ok(n < 10); s = choose(s, context, 0).state; }
    assert.equal(s.objects.cards[a.legend].face, "UP"); assert.equal(s.players[actor].economy.callsThisTurn, 1);
    const other = s.players[actor].zones.LEGENDS.find(l => s.objects.cards[l].face === "DOWN")!;
    assert.equal(calls(s, other).length, 0, "the once-per-turn Call allowance still applies");
});

test("without Panam, or outside her controller's turn, the Call costs its usual Eddie", () => {
    const none = arrange({ panam: false, broke: true });
    assert.equal(calls(none.state, none.legend).length, 0);
    const paid = arrange({ panam: false }), r = take(paid.state, context, x => x.action.kind === "CALL_LEGEND" && x.action.cardInstanceId === paid.legend);
    assert.ok(r.state.resolution.choice?.kind === "PAYMENT" || r.events.some(e => e.payload.kind === "PAYMENT_MADE" && (e.payload as { sources: unknown[] }).sources.length === 1), "a usual Call pays 1");
    const rivalTurn = end(arrange({}).state, context).state;
    assert.equal(effectiveCallCost(rivalTurn, actor, context), 1, "in a Rival's turn (React) the Call is not free");
    assert.equal(effectiveCallCost(arrange({}).state, rival, context), 1, "Panam frees only her controller's Calls");
});

test("{Attack}: discard 1, then draw 1 for each friendly face-up Legend; with an empty hand nothing is drawn", () => {
    const a = arrange({ faceUp: 2, hand: 3, target: true }), handBefore = a.state.players[actor].zones.HAND.length;
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.panam).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = choose(s, context, 0).state;
    assert.equal(s.resolution.choice?.options.length, handBefore, "each hand card may be the discard"); assert.ok(validateState(s, context).ok);
    const discarded = (s.resolution.choice!.options[0] as { cardInstanceId: CardInstanceId }).cardInstanceId;
    s = choose(s, context, 0).state;
    assert.equal(s.objects.cards[discarded].zone.zone, "TRASH");
    assert.equal(s.players[actor].zones.HAND.length, handBefore - 1 + 2);
    assert.equal(s.timing.step, "RIVAL_REACT");
    const one = arrange({ faceUp: 1, hand: 1, target: true });
    let u = take(one.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === one.panam).state;
    if (u.timing.step === "ATTACK_TARGET_SELECTION") u = choose(u, context, 0).state;
    assert.equal(u.timing.step, "RIVAL_REACT", "a lone hand card is discarded without a choice"); assert.equal(u.players[actor].zones.HAND.length, 1, "then 1 draw for 1 face-up Legend");
    const empty = arrange({ faceUp: 2, hand: 0, target: true });
    let t = take(empty.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === empty.panam).state;
    if (t.timing.step === "ATTACK_TARGET_SELECTION") t = choose(t, context, 0).state;
    assert.equal(t.players[actor].zones.HAND.length, 0, "no discard, so no draw"); assert.equal(t.timing.step, "RIVAL_REACT");
});

test("the reviewed union contains Panam", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === PANAM));
});
