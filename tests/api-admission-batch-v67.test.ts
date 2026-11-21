import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsGearStealCard } from "../packages/engine/src/gear-steal-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV67Cards, batchV67Context, batchV67Input, v67Source, GORILLA } from "./api-admission-batch-v67-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV67Context();
const gorilla = batchV67Cards[0];
const PSYCHO = "psycho-squad"; // Power 6, 9 with Gorilla Arms: one steal.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV67Input("batch-v67"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement on the actor's MAIN: a ready Psycho Squad with Gorilla Arms attached, each player's Gig area holding rolled
 * Gigs of the listed values (largest dice below d20 first), and optionally a steal already recorded for the host this turn. */
function arrange(values: Record<PlayerId, number[]>, stoleBefore = false) {
    const m = new TurnMutation(base, context), put = (cardId: string) => {
        const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    const host = put(PSYCHO), gear = put(GORILLA); host.attachments = [gear.id];
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
    if (stoleBefore) d.turnHistory!.gigsStolenByUnit = { [host.id]: 1 };
    return { state: unwrap(validateState(d, context)), host: host.id, gear: gear.id, ids };
}
/** The host attacks the rival's Gig area, steals `gig`, the rival passes React, and every later choice takes `pickLater`. */
function attack(s: GameState, host: CardInstanceId, gig: GigInstanceId, pickLater?: GigInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    let r = take(state, context, a => a.action.kind === "PASS_REACT"); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const c = r.state.resolution.choice, want = r.state.timing.step === "GIG_STEAL_SELECTION" ? gig : pickLater;
        const i = want ? c.options.findIndex(o => o.kind === "GIG" && o.gigInstanceId === want) : 0;
        r = choose(r.state, context, Math.max(i, 0)); events.push(...r.events);
    }
    return { state: r.state, events };
}
const owner = (s: GameState, g: GigInstanceId) => s.objects.gigs[g].controllerId;
const fired = (events: { payload: { kind: string; sourceId?: string } }[], source: CardInstanceId) => events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === source);

test("the V67 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(gorilla.provenance.sourceHash, hashCanonical(v67Source(gorilla.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === gorilla.id), [gorilla]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Gorilla Arms passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsGearStealCard]) assert.ok(gate(gorilla, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(gorilla) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["every steal", d => { delete d.mechanics.abilities[0].guard; }],
        ["any Gig", d => { d.mechanics.abilities[0].effects = [{ kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1 }]; }],
        ["own steal", d => { delete d.mechanics.abilities[0].inherited; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsGearStealCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the host's first steal this turn steals again: the only rival Gig whose value no friendly Gig shares", () => {
    const a = arrange({ [actor]: [5], [rival]: [3, 4, 5] }), [three, four, five] = a.ids[rival];
    const r = attack(a.state, a.host, three);
    assert.ok(fired(r.events, a.gear));
    assert.equal(owner(r.state, three), actor); assert.equal(owner(r.state, four), actor, "4 is shared by no friendly Gig (3 and 5 now are)"); assert.equal(owner(r.state, five), rival);
    assert.equal(r.state.turnHistory?.gigsStolenByUnit?.[a.host], 2); assert.equal(r.state.timing.step, "MAIN");
});

test("with several unshared values the controller chooses; with none the extra steal does nothing", () => {
    const a = arrange({ [actor]: [], [rival]: [2, 4, 6] }), [two, four, six] = a.ids[rival];
    const r = attack(a.state, a.host, two, six);
    assert.equal(owner(r.state, six), actor); assert.equal(owner(r.state, four), rival);
    const b = arrange({ [actor]: [4], [rival]: [3, 4] }), [three, fourB] = b.ids[rival];
    const t = attack(b.state, b.host, three);
    assert.ok(fired(t.events, b.gear)); assert.equal(owner(t.state, fourB), rival, "4 is shared by a friendly Gig");
});

test("a host that already stole this turn does not trigger it", () => {
    const a = arrange({ [actor]: [], [rival]: [3, 4] }, true), r = attack(a.state, a.host, a.ids[rival][0]);
    assert.equal(fired(r.events, a.gear), false); assert.equal(owner(r.state, a.ids[rival][1]), rival);
});

test("the reviewed union contains Gorilla Arms", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === GORILLA));
});
