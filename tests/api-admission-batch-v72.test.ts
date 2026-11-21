import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV72Cards, batchV72Context, batchV72Input, v72Source, RITA } from "./api-admission-batch-v72-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV72Context();
const rita = batchV72Cards[0];
const PSYCHO = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV72Input("batch-v72"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: the listed Units ready (or spent) on their players' fields; with `spentBefore`, the
 * listed Ritas were already spent once this turn. */
function arrange(units: { player: PlayerId; cardId: string; readiness?: "READY" | "SPENT" }[], spentBefore: number[] = []) {
    const m = new TurnMutation(base, context), ids: CardInstanceId[] = [];
    for (const u of units) {
        const deck = m.state.players[u.player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === u.cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = u.readiness ?? "READY"; ids.push(c.id);
    }
    const d = GameStateSchema.parse(m.state);
    if (spentBefore.length) d.turnHistory!.firstSpends = spentBefore.map(i => ids[i]);
    return { state: unwrap(validateState(d, context)), ids };
}
const zones = (s: GameState, p: PlayerId) => ({ hand: s.players[p].zones.HAND.length, trash: s.players[p].zones.TRASH.length });
const discards = (s: GameState) => s.resolution.choice?.kind === "DISCARD";

test("the V72 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(rita.provenance.sourceHash, hashCanonical(v72Source(rita.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === rita.id), [rita]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Rita passes only her exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.ok(gate(rita, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(rita) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["every spend", d => { delete d.mechanics.abilities[0].guard; }],
        ["discard first", d => { d.mechanics.abilities[0].effects = [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" }]; }],
        ["no Blocker", d => { d.mechanics.keywords = []; }],
        ["power", d => { d.power = 5; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("Rita's first spend this turn (attacking) draws 1, then she discards 1 of her controller's choice", () => {
    const a = arrange([{ player: actor, cardId: RITA }, { player: rival, cardId: PSYCHO, readiness: "SPENT" }]), before = zones(a.state, actor);
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[0]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD").state;
    assert.ok(discards(s)); assert.equal(s.resolution.choice?.actorId, actor); assert.ok(validateState(s, context).ok);
    assert.equal(s.resolution.choice?.options.length, before.hand + 1, "the drawn card may be the discard");
    s = choose(s, context, 0).state;
    assert.deepEqual(zones(s, actor), { hand: before.hand, trash: before.trash + 1 }); assert.equal(s.timing.step, "RIVAL_REACT");
    assert.deepEqual(s.turnHistory?.firstSpends, [a.ids[0]]);
});

test("Rita blocking for the first time this turn draws and discards for her controller", () => {
    const a = arrange([{ player: actor, cardId: PSYCHO }, { player: rival, cardId: PSYCHO, readiness: "SPENT" }, { player: rival, cardId: RITA }]), before = zones(a.state, rival);
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[0]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.ids[1]).state;
    s = take(s, context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === a.ids[2]).state;
    assert.ok(discards(s)); assert.equal(s.resolution.choice?.actorId, rival); assert.ok(validateState(s, context).ok);
    s = choose(s, context, 0).state;
    assert.deepEqual(zones(s, rival), { hand: before.hand, trash: before.trash + 1 }); assert.equal(s.timing.step, "RIVAL_REACT");
});

test("a later spend in the same turn does not trigger again", () => {
    const a = arrange([{ player: actor, cardId: RITA }, { player: rival, cardId: PSYCHO, readiness: "SPENT" }], [0]), before = zones(a.state, actor);
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[0]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD").state;
    assert.equal(discards(s), false); assert.deepEqual(zones(s, actor), before); assert.equal(s.timing.step, "RIVAL_REACT");
});

test("the reviewed union contains Rita", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === RITA));
});
