import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsAttackPermissionUnit } from "../packages/engine/src/attack-permission-support";
import { listAttackTargets } from "../packages/engine/src/combat-queries";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV65Cards, batchV65Context, batchV65Input, v65Source, GUERRERA } from "./api-admission-batch-v65-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV65Context();
const guerrera = batchV65Cards[0];
const NEGOTIATORS = "augmented-negotiators", PSYCHO = "psycho-squad"; // A power-2 Blocker ("When this Unit uses {Blocker}, a Rival discards 1."); a vanilla 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV65Input("batch-v65"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: a ready Valentino Guerrera; a ready rival Blocker and a ready vanilla rival Unit (plus
 * a spent one when `spent`); each player's Gig area holding one rolled Gig (its largest die below d20) of the given value. */
function arrange(values: Record<PlayerId, number>, spent = false) {
    const m = new TurnMutation(base, context), ids: Record<string, CardInstanceId> = {}, put = (player: PlayerId, cardId: string, key = cardId, readiness: "READY" | "SPENT" = "READY") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = readiness;
        ids[key] = c.id;
    };
    put(actor, GUERRERA); put(rival, NEGOTIATORS); put(rival, PSYCHO);
    if (spent) put(rival, PSYCHO, "spent", "SPENT");
    const d = GameStateSchema.parse(m.state), left: Record<PlayerId, number | undefined> = { ...values };
    for (const pl of Object.values(d.players)) pl.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs).sort((x, y) => Number(y.dieType.slice(1)) - Number(x.dieType.slice(1)) || (x.id < y.id ? -1 : 1))) {
        const value = g.dieType === "D20" ? undefined : left[g.ownerId]; if (value !== undefined) left[g.ownerId] = undefined;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids };
}
const cardTargets = (s: GameState, id: CardInstanceId) => listAttackTargets(s, id, actor, context).flatMap(t => t.kind === "CARD" ? [t.cardInstanceId] : []).sort();

test("the V65 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(guerrera.provenance.sourceHash, hashCanonical(v65Source(guerrera.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === guerrera.id), [guerrera]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Valentino Guerrera passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsAttackPermissionUnit]) assert.ok(gate(guerrera, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(guerrera) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["power", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Valentino"]; }],
        ["Gig-area permission", d => { d.mechanics.modifiers = [{ kind: "CAN_ATTACK_GIG_AREA_WHILE_LAGGING_IF", condition: { kind: "RIVAL_CONTROLS_MORE_GIGS", minimum: 1 } }]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsAttackPermissionUnit]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("with more Street Cred, it may attack a ready rival Blocker, never a ready non-Blocker", () => {
    const a = arrange({ [actor]: 6, [rival]: 3 }, true);
    assert.deepEqual(cardTargets(a.state, a.ids[GUERRERA]), [a.ids[NEGOTIATORS], a.ids.spent].sort());
    const declared = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[GUERRERA]).state;
    let s = pick(declared, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.ids[NEGOTIATORS]).state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.ok(validateState(s, context).ok);
    const blocks = unwrap(listLegalActions(s, rival, context)).filter(x => x.action.kind === "DECLARE_BLOCKER");
    assert.equal(blocks.length, 0, "the attacked Blocker cannot redirect the attack to itself");
    s = take(s, context, x => x.action.kind === "PASS_REACT").state;
    for (let n = 0; s.resolution.choice; n++) { assert.ok(n < 10); s = choose(s, context, 0).state; }
    assert.equal(s.objects.cards[a.ids[NEGOTIATORS]].zone.zone, "TRASH", "power 4 defeats the power-2 Blocker");
    assert.equal(s.objects.cards[a.ids[GUERRERA]].zone.zone, "BATTLEFIELD");
});

test("with equal or less Street Cred, ready Blockers are not targets", () => {
    for (const values of [{ [actor]: 3, [rival]: 3 }, { [actor]: 2, [rival]: 5 }]) {
        const a = arrange(values);
        assert.deepEqual(cardTargets(a.state, a.ids[GUERRERA]), [], JSON.stringify(Object.values(values)));
    }
});

test("another ready rival Blocker may still redirect an attack on a ready Blocker", () => {
    const a = arrange({ [actor]: 6, [rival]: 3 }), m = new TurnMutation(a.state, context), deck = m.state.players[rival].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]];
    const r = context.content.cards.find(x => x.id === NEGOTIATORS)!; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY";
    const state = unwrap(validateState(m.state, context));
    const declared = take(state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[GUERRERA]).state;
    const s = pick(declared, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.ids[NEGOTIATORS]).state;
    assert.deepEqual(unwrap(listLegalActions(s, rival, context)).filter(x => x.action.kind === "DECLARE_BLOCKER").map(x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId), [c.id]);
});

test("the reviewed union contains Valentino Guerrera", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === GUERRERA));
});
