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
import { batchV64Cards, batchV64Context, batchV64Input, v64Source, NADIA } from "./api-admission-batch-v64-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV64Context();
const nadia = batchV64Cards[0];
const PSYCHO = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV64Input("batch-v64"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: Nadia in hand, a spent rival Psycho Squad, and each player's Gig area holding the
 * given number of rolled Gigs (value 3), every other die in the fixer area. */
function arrange(gigCounts: Record<PlayerId, number>) {
    const m = new TurnMutation(base, context), take1 = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const n = take1(actor, NADIA), p = take1(rival, PSYCHO);
    moveCardLocation(m, p.id, "BATTLEFIELD"); p.statuses = []; p.readiness = "SPENT";
    const d = GameStateSchema.parse(m.state), left: Record<PlayerId, number> = { ...gigCounts };
    for (const pl of Object.values(d.players)) pl.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const rolled = (left[g.ownerId] ?? 0) > 0; if (rolled) left[g.ownerId]--;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 1, currentValue: 3 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), nadia: n.id, psycho: p.id };
}
function play(s: GameState, id: CardInstanceId) {
    s = take(s, context, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id).state;
    for (let n = 0; s.resolution.choice; n++) { assert.ok(n < 12); s = choose(s, context, 0).state; }
    assert.equal(s.objects.cards[id].zone.zone, "BATTLEFIELD"); assert.ok(s.objects.cards[id].statuses.includes("LAG"));
    return s;
}
const attacks = (s: GameState, id: CardInstanceId) => unwrap(listLegalActions(s, actor, context)).filter(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id);

test("the V64 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(nadia.provenance.sourceHash, hashCanonical(v64Source(nadia.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === nadia.id), [nadia]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Nadia passes only her exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsAttackPermissionUnit]) assert.ok(gate(nadia, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(nadia) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["power", d => { d.power = 9; }],
        ["tags", d => { d.tags = ["Medtech"]; }],
        ["blocker", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["unconditional rival-Unit permission", d => { d.mechanics.modifiers = [{ kind: "CAN_ATTACK_RIVAL_UNITS_WHILE_LAGGING" }]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsAttackPermissionUnit]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the turn she is played, Nadia attacks only the Gig area of a Rival with more Gigs", () => {
    const a = arrange({ [actor]: 1, [rival]: 2 }), s = play(a.state, a.nadia);
    assert.equal(attacks(s, a.nadia).length, 1);
    assert.deepEqual(listAttackTargets(s, a.nadia, actor, context), [{ kind: "GIG_AREA", playerId: rival }], "the spent rival Unit is not a target while she lags");
    let r = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.nadia).state;
    if (r.timing.step === "ATTACK_TARGET_SELECTION") r = choose(r, context, 0).state;
    assert.equal(r.timing.step, "RIVAL_REACT"); assert.deepEqual(r.timing.combat.stage === "RIVAL_REACT" && r.timing.combat.target, { kind: "GIG_AREA", playerId: rival });
    assert.ok(validateState(r, context).ok);
});

test("with equal or fewer rival Gigs she cannot attack the turn she is played", () => {
    for (const counts of [{ [actor]: 2, [rival]: 2 }, { [actor]: 2, [rival]: 1 }]) {
        const a = arrange(counts), s = play(a.state, a.nadia);
        assert.equal(attacks(s, a.nadia).length, 0, JSON.stringify(Object.values(counts)));
    }
});

test("once she no longer lags, both the Gig area and spent rival Units are targets as usual", () => {
    const a = arrange({ [actor]: 2, [rival]: 1 }), s = play(a.state, a.nadia), d = GameStateSchema.parse(structuredClone(s));
    d.objects.cards[a.nadia].statuses = [];
    assert.deepEqual(listAttackTargets(unwrap(validateState(d, context)), a.nadia, actor, context).map(t => t.kind).sort(), ["CARD", "GIG_AREA"]);
});

test("the reviewed union contains Nadia", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === NADIA));
});
