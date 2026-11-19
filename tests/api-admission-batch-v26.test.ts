import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV26Cards, batchV26Context, batchV26Input, v26Source, RECRUITS } from "./api-admission-batch-v26-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV26Context();
const recruits = batchV26Cards[0];
const ATLUS = "emergency-atlus", WRAITH = "wraith-marauders"; // A vanilla power-4 Unit and the V25 steal-trigger Unit.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV26Input("batch-v26"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: rewrites the player's last deck card as `cardId` on the field, with the given readiness and no entry statuses. */
function field(s: GameState, cardId: string, player: PlayerId, readiness: "READY" | "SPENT" = "READY") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = readiness; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: each listed die of a player is rolled into that player's Gig area at its value; all other dice wait in fixer areas. */
function gigs(s: GameState, rolled: { player: PlayerId; die: string; value: number }[]) {
    const d = GameStateSchema.parse(s), ids: GigInstanceId[] = [];
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const chosen = new Map(rolled.map(x => [Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id, x.value]));
    for (const g of Object.values(d.objects.gigs)) {
        const value = chosen.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    for (const x of rolled) ids.push(Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id);
    return { state: unwrap(validateState(d, context)), ids };
}
/** `attacker` (fresh, ready) attacks the rival Gig area; `observers` are placed first; the rival passes React. */
function steal(prepared: GameState, attacker: string, observers: { cardId: string; player: PlayerId }[] = []) {
    let s = prepared; const ids: CardInstanceId[] = [];
    for (const o of observers) { const placed = field(s, o.cardId, o.player, "SPENT"); s = placed.state; ids.push(placed.id); }
    const unit = field(s, attacker, actor);
    s = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id).state;
    while (s.resolution.choice && s.timing.step !== "RIVAL_REACT") s = choose(s, context).state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    return { ...take(s, context, a => a.action.kind === "PASS_REACT"), attackerId: unit.id, observers: ids };
}
const value = (s: GameState, id: GigInstanceId) => { const r = s.objects.gigs[id].roll; return r.kind === "ROLLED" ? r.currentValue : null; };
const gigOptions = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "GIG" ? [o.gigInstanceId] : []).sort();

test("the V26 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(recruits.provenance.sourceHash, hashCanonical(v26Source(recruits.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === recruits.id), [recruits]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("6th Street Recruits passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(recruits, context).ok); assert.ok(supportsPlay(recruits, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(recruits) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const adjust = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { maximum: number; direction?: string };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["own steal trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_GIG_STOLEN"; }],
        ["no d6 guard", d => { delete d.mechanics.abilities[0].guard; }],
        ["maximum 4", d => { adjust(d).maximum = 4; }],
        ["decrease", d => { adjust(d).direction = "DECREASE"; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 3 }; }],
        ["power", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Ganger"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["guard on another card's shape", d => { d.mechanics.abilities[0] = { ...d.mechanics.abilities[0], trigger: "WHEN_GIG_STOLEN", guard: "STOLEN_GIG_IS_D6", effects: [{ kind: "READY_UNIT", target: { kind: "ANOTHER_FRIENDLY_UNIT", power: "EQUALS_STOLEN_GIG_VALUE" } }] }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("a friendly Unit stealing a d6 lets Recruits' controller increase any Gig by up to 6, then the attack ends", () => {
    const arranged = gigs(base, [{ player: rival, die: "D6", value: 2 }, { player: rival, die: "D8", value: 3 }, { player: actor, die: "D12", value: 5 }]);
    const [d6, d8, own] = arranged.ids;
    // Power 4 steals 1 Gig: choose the d6 during the steal selection.
    let s = arranged.state;
    const r0 = steal(s, ATLUS, [{ cardId: RECRUITS, player: actor }]);
    s = r0.state;
    assert.equal(s.timing.step, "GIG_STEAL_SELECTION");
    const r = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === d6);
    s = r.state;
    assert.equal(s.objects.gigs[d6].controllerId, actor);
    assert.deepEqual(s.resolution.triggerContinuation!.origin, { kind: "STEAL", subjectId: r0.attackerId, gigInstanceIds: [d6] });
    assert.deepEqual(s.resolution.triggerContinuation!.bindings.map(b => [b.sourceId, b.gigInstanceId]), [[r0.observers[0], d6]]);
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(gigOptions(s), [d6, d8, own].sort(), "a Gig: any rolled Gig in a Gig area");
    s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === own).state;
    assert.equal(s.timing.step, "AMOUNT_SELECTION");
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "AMOUNT" ? o.amount : null), [0, 1, 2, 3, 4, 5, 6]);
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "AMOUNT", amount: 7 });
    assert.equal(validateState(forged, context).ok, false, "never more than 6");
    const done = pick(s, context, o => o.kind === "AMOUNT" && o.amount === 6);
    s = done.state;
    assert.equal(value(s, own), 11); assert.equal(value(s, d6), 2); assert.equal(value(s, d8), 3);
    assert.ok(done.events.some(e => e.payload.kind === "ATTACK_ENDED"));
    assert.equal(s.timing.step, "MAIN");
});

test("the increase stops at the die's faces; stealing a non-d6 triggers nothing; a rival's Recruits never triggers", () => {
    const one = gigs(base, [{ player: rival, die: "D6", value: 3 }]), d6 = one.ids[0];
    const s = steal(one.state, ATLUS, [{ cardId: RECRUITS, player: actor }]).state;
    assert.equal(s.timing.step, "AMOUNT_SELECTION", "the only Gig is forced");
    assert.equal(s.resolution.triggerContinuation!.targetGigId, d6);
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "AMOUNT" ? o.amount : null), [0, 1, 2, 3], "a d6 at 3 can rise by 3");
    const d8 = gigs(base, [{ player: rival, die: "D8", value: 3 }]), plain = steal(d8.state, ATLUS, [{ cardId: RECRUITS, player: actor }]);
    assert.equal(plain.events.some(e => e.payload.kind === "EFFECT_PENDING"), false);
    assert.equal(plain.state.timing.step, "MAIN");
    const theirs = steal(gigs(base, [{ player: rival, die: "D6", value: 3 }]).state, ATLUS, [{ cardId: RECRUITS, player: rival }]);
    assert.equal(theirs.events.some(e => e.payload.kind === "EFFECT_PENDING"), false, "a rival Unit's steal is not a friendly steal for the rival's Recruits");
    assert.equal(theirs.state.timing.step, "MAIN");
});

test("Recruits stealing a d6 itself triggers its own ability", () => {
    const one = gigs(base, [{ player: rival, die: "D6", value: 1 }]);
    const r = steal(one.state, RECRUITS);
    assert.deepEqual(r.state.resolution.triggerContinuation!.bindings.map(b => b.sourceId), [r.attackerId]);
    assert.equal(r.state.timing.step, "AMOUNT_SELECTION", "the stolen d6 is the only Gig");
});

test("with Wraith Marauders stealing a d6 next to Recruits, both are pending and the controller orders them", () => {
    const arranged = gigs(base, [{ player: rival, die: "D6", value: 4 }]), d6 = arranged.ids[0];
    const r = steal(arranged.state, WRAITH, [{ cardId: RECRUITS, player: actor }, { cardId: ATLUS, player: actor }]);
    let s = r.state;
    assert.equal(s.resolution.triggerContinuation!.bindings.length, 2);
    assert.equal(s.timing.step, "TRIGGER_ORDER_SELECTION");
    assert.equal(s.resolution.choice!.options.length, 2);
    while (s.timing.step !== "MAIN") s = choose(s, context).state;
    assert.equal(s.objects.cards[r.observers[1]].readiness, "READY", "Wraith readied the power-4 Unit (the Gig was a 4 when it resolved first)");
    assert.equal(s.objects.gigs[d6].controllerId, actor);
});

test("a forged friendly-steal binding for a stolen non-d6 Gig is rejected", () => {
    const arranged = gigs(base, [{ player: rival, die: "D6", value: 2 }]);
    const r = steal(arranged.state, ATLUS, [{ cardId: RECRUITS, player: actor }]);
    const forged = GameStateSchema.parse(r.state);
    const d8 = Object.values(forged.objects.gigs).find(g => g.ownerId === rival && g.dieType === "D8")!;
    d8.controllerId = actor; d8.location = { playerId: actor, zone: "GIGS" }; d8.roll = { kind: "ROLLED", initialValue: 1, currentValue: 2 };
    forged.players[rival].gigs.FIXER = forged.players[rival].gigs.FIXER.filter(id => id !== d8.id); forged.players[actor].gigs.GIGS.push(d8.id);
    forged.resolution.triggerContinuation!.origin = { kind: "STEAL", subjectId: r.attackerId, gigInstanceIds: [d8.id] };
    forged.resolution.triggerContinuation!.bindings[0].gigInstanceId = d8.id;
    assert.equal(validateState(forged, context).ok, false);
});

test("the reviewed union admits the V26 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === RECRUITS));
});
