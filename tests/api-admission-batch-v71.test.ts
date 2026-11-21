import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV71Cards, batchV71Context, batchV71Input, v71Source, FACEPLATE } from "./api-admission-batch-v71-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV71Context();
const faceplate = batchV71Cards[0];
const PSYCHO = "psycho-squad";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV71Input("batch-v71"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: a ready Psycho Squad with Zetatech Faceplate, a spent rival Psycho Squad, and each
 * player's Gig area holding rolled Gigs of the listed values (largest dice below d20 first). */
function arrange(values: Record<PlayerId, number[]>) {
    const m = new TurnMutation(base, context), put = (player: PlayerId, cardId: string, readiness: "READY" | "SPENT" = "READY") => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = readiness; return c;
    };
    const host = put(actor, PSYCHO), gear = put(actor, FACEPLATE); host.attachments = [gear.id]; put(rival, PSYCHO, "SPENT");
    const d = GameStateSchema.parse(m.state), faces = (g: { dieType: string }) => Number(g.dieType.slice(1)), ids: Record<PlayerId, GigInstanceId[]> = { [actor]: [], [rival]: [] };
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const player of d.match.playerOrder) {
        const want = values[player] ?? [], dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === player)) {
            const k = dice.indexOf(g), value = k >= 0 && k < want.length ? want[k] : undefined;
            g.controllerId = player; g.location = { playerId: player, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[player].gigs[g.location.zone].push(g.id);
            if (value !== undefined) ids[player][k] = g.id;
        }
    }
    return { state: unwrap(validateState(d, context)), host: host.id, gear: gear.id, ids };
}
function attack(s: GameState, host: CardInstanceId) {
    let t = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === host).state;
    if (t.timing.step === "ATTACK_TARGET_SELECTION") t = pick(t, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD").state;
    return t;
}
const hand = (s: GameState) => s.players[actor].zones.HAND.length;
const value = (s: GameState, g: GigInstanceId) => { const r = s.objects.gigs[g].roll; return r.kind === "ROLLED" ? r.currentValue : null; };

test("the V71 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(faceplate.provenance.sourceHash, hashCanonical(v71Source(faceplate.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === faceplate.id), [faceplate]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Zetatech Faceplate passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.ok(gate(faceplate, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(faceplate) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no draw", d => { d.mechanics.abilities[0].effects = [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1 }]; }],
        ["up to 2", d => { d.mechanics.abilities[0].effects = [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2, then: { kind: "DRAW_IF_DISTINCT_FRIENDLY_GIG_VALUES", minimum: 3, count: 1 } }]; }],
        ["own spend", d => { delete d.mechanics.abilities[0].inherited; }],
        ["color", d => { d.colors = ["BLUE"]; d.ram = { BLUE: 2 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the host's spend adjusts a Gig by up to 1; then 3 different friendly values draw 1", () => {
    const a = arrange({ [actor]: [2, 4, 4], [rival]: [3] }), [, four] = a.ids[actor], before = hand(a.state);
    let s = attack(a.state, a.host);
    assert.equal(s.resolution.choice?.actorId, actor); assert.ok(validateState(s, context).ok);
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === four).state; assert.ok(validateState(s, context).ok);
    s = pick(s, context, o => o.kind === "MODE" && o.mode === "INCREASE_1").state;
    assert.equal(value(s, four), 5); assert.equal(hand(s), before + 1, "2, 5 and 4 are three different values"); assert.equal(s.timing.step, "RIVAL_REACT");
});

test("with fewer than 3 different friendly values after the adjustment, nothing is drawn", () => {
    const a = arrange({ [actor]: [2, 4, 4], [rival]: [3] }), [, four] = a.ids[actor], before = hand(a.state);
    let s = attack(a.state, a.host);
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === four).state;
    s = pick(s, context, o => o.kind === "MODE" && o.mode === "KEEP").state;
    assert.equal(value(s, four), 4); assert.equal(hand(s), before, "2 and 4 are only two values");
    const r = arrange({ [actor]: [2, 4, 4], [rival]: [3] }), rivalGig = r.ids[rival][0];
    let t = attack(r.state, r.host);
    t = pick(t, context, o => o.kind === "GIG" && o.gigInstanceId === rivalGig).state;
    t = pick(t, context, o => o.kind === "MODE" && o.mode === "INCREASE_1").state;
    assert.equal(value(t, rivalGig), 4); assert.equal(hand(t), before, "a rival Gig's value does not count");
});

test("the reviewed union contains Zetatech Faceplate", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === FACEPLATE));
});
