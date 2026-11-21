import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsCallTrashProgram } from "../packages/engine/src/call-trash-program-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation, processDeparture } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV75Cards, batchV75Context, batchV75Input, v75Source } from "./api-admission-batch-v75-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV75Context();
const [dumDum] = batchV75Cards;
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad", OCTANT = "octant", MANTIS = "mantis-blades", OPTICS = "kiroshi-optics";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV75Input("batch-v75"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Unit = { cardId: string; gear?: string[] };
type Arrangement = { owner: PlayerId; mine?: Unit[]; theirs?: string[]; face?: "UP" | "DOWN"; gigs?: number[] };
/** Trusted arrangement on the actor's MAIN: Dum Dum as `owner`'s last Legend (face up and ready unless `face` says otherwise), `mine`
 * ready on the owner's field with their listed Gear attached, `theirs` ready on the other field, and the owner's Gig area holding
 * rolled Gigs of the given values (an attack target). */
function arrange(a: Arrangement) {
    const m = new TurnMutation(base, context), units: CardInstanceId[] = [], gears: CardInstanceId[][] = [], others: CardInstanceId[] = [], other = a.owner === actor ? rival : actor;
    const put = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    for (const u of a.mine ?? []) { const host = put(a.owner, u.cardId); units.push(host.id); const g = (u.gear ?? []).map(id => put(a.owner, id).id); host.attachments = [...g].sort(); gears.push(g); }
    for (const id of a.theirs ?? []) others.push(put(other, id).id);
    const d = GameStateSchema.parse(m.state), legends = d.players[a.owner].zones.LEGENDS, l = d.objects.cards[legends[legends.length - 1]];
    l.cardId = dumDum.id; l.revision = dumDum.revision; l.face = a.face ?? "UP"; l.readiness = "READY";
    const values = [...(a.gigs ?? [])];
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const gig of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const value = gig.ownerId === a.owner ? values.shift() : undefined;
        gig.controllerId = gig.ownerId; gig.location = { playerId: gig.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        gig.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[gig.ownerId].gigs[gig.location.zone].push(gig.id);
    }
    return { state: unwrap(validateState(d, context)), units, gears, others, dumDum: l.id };
}
/** Takes `first`, paying with Eddies only, until no payment choice remains. */
function paid(s: GameState, first: Parameters<typeof take>[2]) {
    let r = take(s, context, first); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
const call = (s: GameState, id: CardInstanceId) => paid(s, a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === id);
const activate = (s: GameState, id: CardInstanceId) => paid(s, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id);
const hand = (s: GameState, p: PlayerId = actor) => s.players[p].zones.HAND.length;

test("the V75 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(dumDum.provenance.sourceHash, hashCanonical(v75Source(dumDum.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === dumDum.id), [dumDum]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Dum Dum: Maelstrom Triggerman passes only its exact pin; any changed field is rejected by every gate", () => {
    const gates = [supportsLegendSpendCard, supportsCall];
    for (const gate of gates) assert.ok(gate(dumDum, context).ok);
    assert.equal(supportsCallTrashProgram(dumDum, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(dumDum) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["a mode", d => { d.mechanics.abilities[0].choose = { count: 1 }; }],
        ["another trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["Main timing", d => { d.mechanics.abilities[1].activation!.timing = "MAIN"; }],
        ["no Eddie cost", d => { d.mechanics.abilities[1].activation!.costs = [{ kind: "SPEND_SOURCE" }]; }],
        ["a condition", d => { d.mechanics.abilities[1].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["tags", d => { d.tags = ["Maelstrom"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        ["scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of gates) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("the Call offers each friendly Gear or the decline; a defeat draws 2", () => {
    const a = arrange({ owner: actor, mine: [{ cardId: ATLUS, gear: [MANTIS] }, { cardId: PSYCHO, gear: [OPTICS] }], face: "DOWN" });
    const before = hand(a.state), r = call(a.state, a.dumDum), s = r.state;
    assert.equal(s.objects.cards[a.dumDum].face, "UP"); assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : o.kind), ["CONFIRM", ...[a.gears[0][0], a.gears[1][0]].sort()]);
    const labels = actions(s, context).map(x => x.descriptor.label);
    assert.ok(labels.includes("Defeat no Gear and draw 1") && labels.includes(`Defeat Mantis Blades (${a.gears[0][0]}) and draw 2`), labels.join(" | "));
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.gears[0][0]);
    assert.ok(validateState(done.state, context).ok);
    assert.equal(done.state.objects.cards[a.gears[0][0]].zone.zone, "TRASH"); assert.deepEqual(done.state.objects.cards[a.units[0]].attachments, []);
    assert.equal(done.state.objects.cards[a.units[0]].zone.zone, "BATTLEFIELD", "only the Gear is defeated");
    assert.equal(hand(done.state), before + 2);
    assert.ok(done.events.some(e => e.payload.kind === "CARD_DEFEATED" && e.payload.cardInstanceId === a.gears[0][0]));
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.resolution.playContinuation, undefined);
});

test("declining, or having no friendly Gear, draws 1", () => {
    const a = arrange({ owner: actor, mine: [{ cardId: ATLUS, gear: [MANTIS] }], face: "DOWN" });
    const before = hand(a.state), s = call(a.state, a.dumDum).state;
    const declined = pick(s, context, o => o.kind === "CONFIRM");
    assert.ok(validateState(declined.state, context).ok);
    assert.equal(hand(declined.state), before + 1); assert.equal(declined.state.objects.cards[a.gears[0][0]].zone.zone, "BATTLEFIELD");
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    const none = arrange({ owner: actor, mine: [{ cardId: ATLUS }], face: "DOWN" });
    const n = call(none.state, none.dumDum);
    assert.equal(n.state.timing.step, "MAIN"); assert.equal(hand(n.state), hand(none.state) + 1);
    assert.ok(!n.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"), "nothing to decline");
});

test("Quick: a chosen friendly Unit gets +1 per equipped Gear, counted as it resolves; Gear leaving later keeps it", () => {
    const a = arrange({ owner: actor, mine: [{ cardId: ATLUS, gear: [MANTIS, OPTICS] }, { cardId: PSYCHO }] });
    const offered = actions(a.state, context).find(x => x.action.kind === "ACTIVATE_ABILITY" && x.action.sourceInstanceId === a.dumDum);
    assert.match(offered?.descriptor.label ?? "", /Pay 1 and spend to give a friendly Unit \+1 power this turn for each of its equipped Gear/);
    const powered = effectivePower(a.state, a.units[0], context)!, s = activate(a.state, a.dumDum).state;
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.equal(s.objects.cards[a.dumDum].readiness, "SPENT");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.units[0]);
    assert.ok(validateState(done.state, context).ok);
    assert.equal(effectivePower(done.state, a.units[0], context), powered + 2);
    const m = new TurnMutation(GameStateSchema.parse(structuredClone(done.state)), context);
    unwrap(processDeparture(m, a.gears[0][0], "TRASH"));
    const after = unwrap(validateState(GameStateSchema.parse(m.state), context));
    assert.equal(after.temporaryModifiers?.find(x => x.targetId === a.units[0])?.amount, 2, "fixed at resolution");
    const next = end(done.state, context).state;
    assert.equal(next.temporaryModifiers, undefined);
});

test("Quick on a lone unequipped Unit is forced and gives nothing", () => {
    const a = arrange({ owner: actor, mine: [{ cardId: PSYCHO }] });
    const r = activate(a.state, a.dumDum);
    assert.equal(r.state.timing.step, "MAIN");
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === a.units[0] && e.payload.forced));
    assert.equal(r.state.temporaryModifiers, undefined); assert.equal(effectivePower(r.state, a.units[0], context), 6);
});

test("Quick in its controller's React Step, then the React Step continues", () => {
    const a = arrange({ owner: rival, mine: [{ cardId: ATLUS, gear: [MANTIS] }], theirs: [OCTANT], gigs: [2, 5] });
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.others[0]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    const powered = effectivePower(s, a.units[0], context)!;
    s = activate(s, a.dumDum).state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.timing.actingPlayer, rival);
    assert.equal(effectivePower(s, a.units[0], context), powered + 1);
});
