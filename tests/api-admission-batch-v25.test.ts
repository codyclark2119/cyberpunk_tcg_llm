import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV25Cards, batchV25Context, batchV25Input, v25Source, WRAITH } from "./api-admission-batch-v25-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV25Context();
const wraith = batchV25Cards[0];
const ATLUS = "emergency-atlus", SQUAD = "psycho-squad"; // Vanilla Units with power 4 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV25Input("batch-v25"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: rewrites the player's last deck card as `cardId` on the field with the given readiness and no entry statuses. */
function field(s: GameState, cardId: string, player: PlayerId, readiness: "READY" | "SPENT") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = readiness; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: the rival's Gig area holds exactly `values`; the actor's dice wait in the fixer area. */
function rivalGigs(s: GameState, values: number[]) {
    const d = GameStateSchema.parse(s), faces = (g: { dieType: string }) => Number(g.dieType.slice(1));
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const dice = Object.values(d.objects.gigs).filter(g => g.ownerId === rival && faces(g) < 20).sort((a, b) => faces(b) - faces(a) || (a.id < b.id ? -1 : 1));
    const assigned = new Map(values.map((v, i) => [dice[i].id, v])), ids: GigInstanceId[] = [];
    for (const g of Object.values(d.objects.gigs)) {
        const value = assigned.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (value !== undefined) ids.push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids };
}
/** Spent friendly Units wait while Wraith Marauders attacks the rival Gig area (one Gig of `value`); the rival passes React. */
function stealWith(value: number, friends: string[]) {
    const gig = rivalGigs(base, [value]);
    let s = gig.state; const ids: CardInstanceId[] = [];
    for (const f of friends) { const placed = field(s, f, actor, "SPENT"); s = placed.state; ids.push(placed.id); }
    const unit = field(s, WRAITH, actor, "READY");
    s = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id).state;
    while (s.resolution.choice && s.timing.step !== "RIVAL_REACT") s = choose(s, context).state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    return { ...take(s, context, a => a.action.kind === "PASS_REACT"), wraithId: unit.id, friends: ids, gigId: gig.ids[0] };
}
const options = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();

test("the V25 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(wraith.provenance.sourceHash, hashCanonical(v25Source(wraith.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === wraith.id), [wraith]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Wraith Marauders passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(wraith, context).ok); assert.ok(supportsPlay(wraith, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(wraith) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["ready a Legend", d => { d.mechanics.abilities[0].effects = [{ kind: "READY_UNIT", target: { kind: "FRIENDLY_FACE_UP_LEGEND" } }]; }],
        ["ready itself", d => { d.mechanics.abilities[0].effects = [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }]; }],
        ["second effect", d => { d.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "SUBJECT_IS_EQUIPPED" }]; }],
        ["inherited", d => { d.mechanics.abilities[0].inherited = "EQUIPPED_HOST"; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Ganger", "Nomad"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["other card's effect on Goons' shape", d => { d.colors = ["YELLOW"]; d.ram = { YELLOW: 2 }; d.tags = ["Ganger", "Maelstrom"]; d.printedCost = { kind: "EDDIES", amount: 3 }; d.power = 3; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("stealing a 4 offers only the other friendly power-4 Units, then readies the chosen one before the attack ends", () => {
    const r = stealWith(4, [ATLUS, ATLUS, SQUAD]), [a1, a2, squad] = r.friends;
    let s = r.state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.equal(s.resolution.choice!.actorId, actor);
    assert.deepEqual(options(s), [a1, a2].sort(), "Wraith itself (power 4) is not another Unit; the power-6 Unit is not equal");
    assert.ok(actions(s, context).some(x => x.descriptor.label.startsWith("Ready Emergency Atlus")));
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: squad });
    assert.equal(validateState(forged, context).ok, false, "a Unit with other power is never offered");
    const self = GameStateSchema.parse(s); self.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: r.wraithId });
    assert.equal(validateState(self, context).ok, false, "the trigger subject is never offered");
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a2);
    s = done.state;
    assert.equal(s.objects.cards[a2].readiness, "READY"); assert.equal(s.objects.cards[a1].readiness, "SPENT"); assert.equal(s.objects.cards[squad].readiness, "SPENT");
    assert.ok(done.events.some(e => e.payload.kind === "CARD_READIED" && e.payload.cardInstanceId === a2));
    assert.ok(done.events.some(e => e.payload.kind === "ATTACK_ENDED"));
    assert.equal(s.timing.step, "MAIN"); assert.equal(s.timing.combat.stage, "NONE");
    assert.equal(s.objects.cards[r.wraithId].readiness, "SPENT", "the attacker stays spent");
});

test("one matching Unit is readied automatically; no matching Unit means nothing happens", () => {
    const one = stealWith(6, [ATLUS, SQUAD]), [atlus, squad] = one.friends;
    assert.equal(one.state.timing.step, "MAIN");
    assert.equal(one.state.objects.cards[squad].readiness, "READY"); assert.equal(one.state.objects.cards[atlus].readiness, "SPENT");
    assert.ok(one.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === squad && e.payload.forced === true));
    const none = stealWith(5, [ATLUS, SQUAD]);
    assert.ok(none.events.some(e => e.payload.kind === "EFFECT_PENDING"), "the trigger is pending");
    assert.equal(none.events.some(e => e.payload.kind === "CARD_READIED"), false);
    assert.equal(none.state.timing.step, "MAIN");
    assert.ok(none.friends.every(id => none.state.objects.cards[id].readiness === "SPENT"));
});

test("an already-ready Unit of matching power is a legal choice that changes nothing", () => {
    const gig = rivalGigs(base, [4]), spent = field(gig.state, ATLUS, actor, "SPENT"), ready = field(spent.state, ATLUS, actor, "READY");
    const unit = field(ready.state, WRAITH, actor, "READY");
    let s = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id).state;
    while (s.resolution.choice && s.timing.step !== "RIVAL_REACT") s = choose(s, context).state;
    s = take(s, context, a => a.action.kind === "PASS_REACT").state;
    assert.deepEqual(options(s), [spent.id, ready.id].sort());
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === ready.id);
    assert.equal(done.events.some(e => e.payload.kind === "CARD_READIED"), false);
    assert.equal(done.state.objects.cards[spent.id].readiness, "SPENT");
    assert.equal(done.state.timing.step, "MAIN");
});

test("the reviewed union admits the V25 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === WRAITH));
});
