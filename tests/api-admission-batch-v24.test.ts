import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { discoverTriggers, triggerId } from "../packages/engine/src/trigger-queries";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV24Cards, batchV24Context, batchV24Input, v24Source, GOONS } from "./api-admission-batch-v24-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV24Context();
const goons = batchV24Cards[0];
const MANTIS = "mantis-blades";
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV24Input("batch-v24"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
const plainUnit = context.content.cards.find(c => c.schemaVersion === 2 && c.type === "UNIT" && (c.power ?? 0) > 0 && supportsPlay(c, context).ok && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.abilities.length)!.id;

/** Trusted arrangement: rewrites the player's last deck card as `cardId` in hand. */
function put(s: GameState, cardId: string, player: PlayerId) {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: `cardId` ready on the player's field, with no entry statuses. */
function field(s: GameState, cardId: string, player: PlayerId) {
    const placed = put(s, cardId, player), m = new TurnMutation(placed.state, context);
    moveCardLocation(m, placed.id, "BATTLEFIELD"); m.state.objects.cards[placed.id].readiness = "READY"; m.state.objects.cards[placed.id].statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: placed.id };
}
/** Trusted arrangement: `count` Mantis Blades (power 2 each) equipped to `host`. */
function equip(s: GameState, host: CardInstanceId, count: number) {
    for (let i = 0; i < count; i++) {
        const placed = put(s, MANTIS, s.objects.cards[host].controllerId), m = new TurnMutation(placed.state, context);
        unwrap(attachPlayedGear(m, placed.id, host));
        s = unwrap(validateState(m.state, context));
    }
    return s;
}
/** Trusted arrangement: each player's Gig area holds exactly its listed values; every other die waits in its owner's fixer area. */
function gigs(s: GameState, values: Record<PlayerId, number[]>) {
    const d = GameStateSchema.parse(s), faces = (g: { dieType: string }) => Number(g.dieType.slice(1));
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const ids: Record<PlayerId, GigInstanceId[]> = {};
    for (const player of Object.keys(d.players) as PlayerId[]) {
        const want = values[player] ?? [], dice = Object.values(d.objects.gigs).filter(g => g.ownerId === player && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
        const assigned = new Map(want.map((v, i) => [dice[i].id, i]));
        ids[player] = [];
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === player)) {
            const vi = assigned.get(g.id), value = vi === undefined ? undefined : want[vi];
            g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
            g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
            d.players[g.ownerId].gigs[g.location.zone].push(g.id);
            if (vi !== undefined) ids[player][vi] = g.id;
        }
    }
    return { state: unwrap(validateState(d, context)), ids };
}
const handOf = (s: GameState, p: PlayerId) => [...s.players[p].zones.HAND].sort();
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);
/** Goons (with `gear` Mantis Blades) attacks the rival's Gig area, which holds `rivalValues`; the rival passes React. */
function stealWith(gear: number, rivalValues: number[], prepare: (s: GameState) => GameState = s => s) {
    const arranged = gigs(prepare(base), { [actor]: [], [rival]: rivalValues }), unit = field(arranged.state, GOONS, actor);
    let state = equip(unit.state, unit.id, gear);
    state = take(state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id).state;
    while (state.resolution.choice && state.timing.step !== "RIVAL_REACT") state = choose(state, context).state;
    assert.equal(state.timing.step, "RIVAL_REACT");
    const passed = take(state, context, a => a.action.kind === "PASS_REACT");
    return { ...passed, goonsId: unit.id, rivalGigs: arranged.ids[rival] };
}

test("the V24 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(goons.provenance.sourceHash, hashCanonical(v24Source(goons.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === goons.id), [goons]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Maelstrom Goons passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(goons, context).ok); assert.ok(supportsPlay(goons, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(goons) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const discard = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { player: string; when?: unknown };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["no condition", d => { delete discard(d).when; }],
        ["other condition", d => { discard(d).when = { timing: "RESOLUTION", condition: { kind: "SUBJECT_IS_SPENT" } }; }],
        ["own discard", d => { discard(d).player = "CONTROLLER"; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["power", d => { d.power = 4; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["other scope", d => { d.execution = { scope: "VALUE_CONDITIONS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("equipped Goons steals a Gig, then the Rival chooses and discards 1 before the attack ends", () => {
    const withHand = (s: GameState) => [0, 1].reduce(x => put(x, plainUnit, rival).state, s);
    const r = stealWith(1, [4], withHand), before = handOf(r.state, rival), actorHand = handOf(r.state, actor);
    assert.ok(before.length >= 2);
    let s = r.state;
    assert.equal(s.objects.gigs[r.rivalGigs[0]].controllerId, actor, "the Gig moved before the trigger (11.5.1.7)");
    assert.equal(s.timing.step, "DISCARD_SELECTION");
    assert.equal(s.resolution.choice!.actorId, rival, "the affected Rival chooses");
    assert.deepEqual(s.resolution.triggerContinuation!.origin, { kind: "STEAL", subjectId: r.goonsId, gigInstanceIds: [r.rivalGigs[0]] });
    assert.equal(s.timing.combat.stage, "TRIGGER_RESOLUTION");
    const order = kinds(r.events);
    assert.ok(order.indexOf("GIG_STOLEN") < order.indexOf("EFFECT_PENDING"), "pending after the stolen Gig moves");
    assert.ok(r.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === true));
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null), before);
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: actorHand[0] ?? r.goonsId });
    assert.equal(validateState(forged, context).ok, false, "only the Rival's own hand");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === before[1]);
    s = done.state;
    assert.equal(s.objects.cards[before[1]].zone.zone, "TRASH");
    assert.deepEqual(handOf(s, rival), before.filter(id => id !== before[1]));
    assert.deepEqual(handOf(s, actor), actorHand);
    assert.ok(done.events.some(e => e.payload.kind === "CARD_DISCARDED" && e.payload.playerId === rival && e.payload.cardInstanceId === before[1]));
    assert.ok(done.events.some(e => e.payload.kind === "ATTACK_ENDED"));
    assert.equal(s.timing.step, "MAIN"); assert.equal(s.timing.combat.stage, "NONE"); assert.equal(s.timing.actingPlayer, actor);
    assert.equal(s.resolution.triggerContinuation, undefined);
});

test("unequipped Goons triggers but the resolution-time condition fails, so nobody discards", () => {
    const withHand = (s: GameState) => put(s, plainUnit, rival).state;
    const r = stealWith(0, [4], withHand);
    assert.ok(r.events.some(e => e.payload.kind === "EFFECT_PENDING"), "the trigger is pending regardless of the condition (10.16.1.1)");
    assert.ok(r.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === false));
    assert.equal(r.events.some(e => e.payload.kind === "CARD_DISCARDED"), false);
    assert.equal(r.state.timing.step, "MAIN"); assert.equal(r.state.timing.combat.stage, "NONE");
    assert.equal(r.state.objects.gigs[r.rivalGigs[0]].controllerId, actor);
});

test("a single card is discarded automatically and an empty hand discards nothing", () => {
    const emptyHand = (s: GameState) => { const d = GameStateSchema.parse(s); for (const id of [...d.players[rival].zones.HAND]) { d.players[rival].zones.HAND = d.players[rival].zones.HAND.filter(x => x !== id); d.players[rival].zones.DECK.push(id); d.objects.cards[id].zone = { playerId: rival, zone: "DECK" }; } return unwrap(validateState(d, context)); };
    const none = stealWith(1, [4], emptyHand);
    assert.equal(none.events.some(e => e.payload.kind === "CARD_DISCARDED"), false);
    assert.equal(none.state.timing.step, "MAIN");
    const one = stealWith(1, [4], s => put(emptyHand(s), plainUnit, rival).state), card = one.state.objects.cards;
    const discarded = one.events.find(e => e.payload.kind === "CARD_DISCARDED");
    assert.ok(discarded && discarded.payload.kind === "CARD_DISCARDED" && discarded.payload.playerId === rival && discarded.payload.forced === true);
    assert.equal(card[discarded.payload.cardInstanceId].zone.zone, "TRASH");
    assert.equal(one.state.timing.step, "MAIN");
});

test("stealing 2 Gigs at once makes the trigger pending twice, one per Gig (10.16.3)", () => {
    const withHand = (s: GameState) => [0, 1, 2].reduce(x => put(x, plainUnit, rival).state, s);
    const r = stealWith(4, [3, 5], withHand); // power 3 + 4 x 2 = 11 steals 2 Gigs (9.20.1.2).
    const pending = r.events.filter(e => e.payload.kind === "EFFECT_PENDING");
    assert.equal(pending.length, 2);
    const c = r.state.resolution.triggerContinuation!;
    assert.deepEqual(c.origin, { kind: "STEAL", subjectId: r.goonsId, gigInstanceIds: [...r.rivalGigs].sort() });
    assert.deepEqual(c.bindings.map(b => b.gigInstanceId).sort(), [...r.rivalGigs].sort());
    assert.equal(new Set(c.bindings.map(b => triggerId(r.state, b, c.ordinal))).size, 2, "distinct pending identities");
    let s = r.state, discards = 0;
    while (s.timing.step !== "MAIN") {
        if (s.timing.step === "DISCARD_SELECTION") { assert.equal(s.resolution.choice!.actorId, rival); discards++; }
        s = choose(s, context).state;
    }
    assert.equal(discards, 2);
    assert.equal(handOf(s, rival).length, handOf(r.state, rival).length - 2);
});

test("forged steal batches are rejected: a Gig that was not stolen, a missing binding, a non-steal origin", () => {
    const r = stealWith(1, [4], s => [0, 1].reduce(x => put(x, plainUnit, rival).state, s));
    const c = r.state.resolution.triggerContinuation!;
    const ownGig = Object.values(r.state.objects.gigs).find(g => g.ownerId === actor)!.id;
    const notStolen = GameStateSchema.parse(r.state); notStolen.resolution.triggerContinuation!.origin = { kind: "STEAL", subjectId: r.goonsId, gigInstanceIds: [ownGig] };
    assert.equal(validateState(notStolen, context).ok, false, "a fixer-area die was not stolen");
    const otherSubject = GameStateSchema.parse(r.state); (otherSubject.resolution.triggerContinuation!.origin as { subjectId: string }).subjectId = handOf(r.state, rival)[0];
    assert.equal(validateState(otherSubject, context).ok, false, "the subject is the attacker");
    const noGig = GameStateSchema.parse(r.state); delete noGig.resolution.triggerContinuation!.bindings[0].gigInstanceId;
    assert.equal(validateState(noGig, context).ok, false, "a steal binding names its Gig");
    assert.equal(discoverTriggers(r.state, { kind: "ATTACK", subjectId: r.goonsId }, context).length, 0, "no attack trigger");
    assert.equal(c.bindings.length, 1);
});

test("the reviewed union admits the V24 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === GOONS));
});
