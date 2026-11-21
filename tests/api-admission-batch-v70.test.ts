import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, observe, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV70Cards, batchV70Context, batchV70Input, v70Source, RIPPLER } from "./api-admission-batch-v70-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV70Context();
const rippler = batchV70Cards[0];
const PSYCHO = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV70Input("batch-v70"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: a ready Psycho Squad with Tetratronic Rippler attached, and a spent rival Psycho Squad;
 * with `empty`, the actor's deck is empty. */
function arrange(empty = false) {
    const m = new TurnMutation(base, context), put = (player: PlayerId, cardId: string, readiness: "READY" | "SPENT" = "READY") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = readiness; return c;
    };
    const host = put(actor, PSYCHO), gear = put(actor, RIPPLER); host.attachments = [gear.id]; put(rival, PSYCHO, "SPENT");
    if (empty) for (const id of [...m.state.players[actor].zones.DECK]) moveCardLocation(m, id, "TRASH");
    return { state: unwrap(validateState(m.state, context)), host: host.id, gear: gear.id };
}
/** The host attacks the spent rival Unit; returns the state at the Rippler choice (or after the attack's batch). */
function attack(s: GameState, host: CardInstanceId) {
    let t = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === host).state;
    if (t.timing.step === "ATTACK_TARGET_SELECTION") t = pick(t, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD").state;
    return t;
}

test("the V70 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(rippler.provenance.sourceHash, hashCanonical(v70Source(rippler.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === rippler.id), [rippler]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Tetratronic Rippler passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.ok(gate(rippler, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(rippler) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["draw", d => { d.mechanics.abilities[0].effects = [{ kind: "DRAW", count: 1 }]; }],
        ["own spend", d => { delete d.mechanics.abilities[0].inherited; }],
        ["power", d => { d.power = 2; }],
        ["tags", d => { d.tags = ["Cyberware", "Netwatch"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("when the host is spent, its controller privately looks at the top card and may trash it", () => {
    const a = arrange(), top = a.state.players[actor].zones.DECK[0], s = attack(a.state, a.host);
    assert.equal(s.resolution.choice?.actorId, actor); assert.ok(validateState(s, context).ok);
    assert.deepEqual(s.resolution.choice?.options, [{ kind: "MODE", mode: "DONE" }, { kind: "CARD", cardInstanceId: top }]);
    const mine = unwrap(observe(s, actor, context)), theirs = unwrap(observe(s, rival, context));
    assert.ok(JSON.stringify(mine).includes(s.objects.cards[top].cardId), "the controller sees the top card");
    assert.equal(JSON.stringify(theirs).includes(`"${s.objects.cards[top].cardId}"`) && !JSON.stringify(unwrap(observe(a.state, rival, context))).includes(`"${s.objects.cards[top].cardId}"`), false, "the rival learns nothing new");
    const trashed = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === top).state;
    assert.equal(trashed.objects.cards[top].zone.zone, "TRASH"); assert.equal(trashed.timing.step, "RIVAL_REACT");
    const kept = pick(s, context, o => o.kind === "MODE" && o.mode === "DONE").state;
    assert.equal(kept.players[actor].zones.DECK[0], top, "otherwise it stays on top"); assert.equal(kept.timing.step, "RIVAL_REACT");
});

test("with an empty deck there is nothing to search", () => {
    const a = arrange(true), s = attack(a.state, a.host);
    assert.equal(s.resolution.choice, null); assert.equal(s.timing.step, "RIVAL_REACT");
});

test("the reviewed union contains Tetratronic Rippler", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === RIPPLER));
});
