import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV27Cards, batchV27Context, batchV27Input, v27Source, ROAMER } from "./api-admission-batch-v27-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV27Context();
const roamer = batchV27Cards[0];
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV27Input("batch-v27"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: rewrites the player's last deck card as `cardId`, ready on the field with no entry statuses. */
function field(s: GameState, cardId: string, player: PlayerId) {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = "READY"; c.statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: each listed die is rolled into its owner's Gig area at its value; all other dice wait in fixer areas. */
function gigs(s: GameState, rolled: { player: PlayerId; die: string; value: number }[]) {
    const d = GameStateSchema.parse(s);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const find = (x: { player: PlayerId; die: string }) => Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id;
    const chosen = new Map(rolled.map(x => [find(x), x.value]));
    for (const g of Object.values(d.objects.gigs)) {
        const value = chosen.get(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return { state: unwrap(validateState(d, context)), ids: rolled.map(find) };
}
/** V: Roamer of the Badlands attacks the rival Gig area; the rival passes React. */
function steal(prepared: GameState) {
    const unit = field(prepared, ROAMER, actor);
    let s = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id).state;
    while (s.resolution.choice && s.timing.step !== "RIVAL_REACT") s = choose(s, context).state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    return { ...take(s, context, a => a.action.kind === "PASS_REACT"), roamerId: unit.id };
}
const value = (s: GameState, id: GigInstanceId) => { const r = s.objects.gigs[id].roll; return r.kind === "ROLLED" ? r.currentValue : null; };
const amounts = (s: GameState) => s.resolution.choice!.options.map(o => o.kind === "AMOUNT" ? o.amount : null);

test("the V27 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(roamer.provenance.sourceHash, hashCanonical(v27Source(roamer.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === roamer.id), [roamer]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("V: Roamer of the Badlands passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(roamer, context).ok); assert.ok(supportsPlay(roamer, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(roamer) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const adjust = (d: CardRevisionSnapshot) => d.mechanics.abilities[0].effects[0] as { maximum: number; target: unknown };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any Gig", d => { adjust(d).target = { kind: "GIGS", relation: "ANY" }; }],
        ["maximum 6", d => { adjust(d).maximum = 6; }],
        ["no end-turn draw", d => { d.mechanics.abilities = [d.mechanics.abilities[0]]; }],
        ["only the end-turn draw", d => { d.mechanics.abilities = [d.mechanics.abilities[1]]; }],
        ["abilities reordered", d => { d.mechanics.abilities = [d.mechanics.abilities[1], d.mechanics.abilities[0]]; }],
        ["draw 2", d => { (d.mechanics.abilities[1].effects[0] as { count: number }).count = 2; }],
        ["unconditional draw", d => { d.mechanics.abilities[1].effects = [{ kind: "DRAW", count: 1 }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["power", d => { d.power = 5; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("stealing a Gig offers only that Gig, which rises by up to 5 before the attack ends", () => {
    const arranged = gigs(base, [{ player: rival, die: "D8", value: 2 }, { player: actor, die: "D12", value: 3 }]), [d8, own] = arranged.ids;
    const r = steal(arranged.state);
    let s = r.state;
    assert.equal(s.objects.gigs[d8].controllerId, actor, "the Gig moved first");
    assert.equal(s.timing.step, "AMOUNT_SELECTION", "\"it\" is the stolen Gig only, so its pick is forced");
    assert.equal(s.resolution.triggerContinuation!.targetGigId, d8);
    assert.deepEqual(amounts(s), [0, 1, 2, 3, 4, 5]);
    const forged = GameStateSchema.parse(s); forged.resolution.choice!.options.push({ kind: "AMOUNT", amount: 6 });
    assert.equal(validateState(forged, context).ok, false, "never more than 5");
    const other = GameStateSchema.parse(s); other.resolution.triggerContinuation!.targetGigId = own;
    assert.equal(validateState(other, context).ok, false, "never another Gig");
    const done = pick(s, context, o => o.kind === "AMOUNT" && o.amount === 5);
    s = done.state;
    assert.equal(value(s, d8), 7); assert.equal(value(s, own), 3);
    assert.ok(done.events.some(e => e.payload.kind === "ATTACK_ENDED"));
    assert.equal(s.timing.step, "MAIN");
});

test("the increase stops at the die's faces", () => {
    const arranged = gigs(base, [{ player: rival, die: "D6", value: 4 }]), r = steal(arranged.state);
    assert.deepEqual(amounts(r.state), [0, 1, 2]);
    const top = gigs(base, [{ player: rival, die: "D4", value: 4 }]), full = steal(top.state);
    assert.equal(full.state.timing.step, "MAIN", "a Gig at its maximum keeps its value without a choice");
    assert.equal(value(full.state, top.ids[0]), 4);
});

test("at the end of its controller's turn it draws 1 only with 2 or more Gigs of 8+ value", () => {
    const end = (rolled: { player: PlayerId; die: string; value: number }[]) => {
        const s = field(gigs(base, rolled).state, ROAMER, actor).state, hand = s.players[actor].zones.HAND.length;
        let ended = take(s, context, a => a.action.kind === "END_TURN");
        let state = ended.state; const events = [...ended.events];
        while (state.resolution.choice && state.timing.activePlayer === actor) { ended = choose(state, context); state = ended.state; events.push(...ended.events); }
        return { events, drawn: state.players[actor].zones.HAND.length - hand };
    };
    const two = end([{ player: actor, die: "D10", value: 8 }, { player: actor, die: "D12", value: 9 }, { player: rival, die: "D8", value: 8 }]);
    assert.ok(two.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === true));
    assert.equal(two.drawn, 1);
    const one = end([{ player: actor, die: "D10", value: 8 }, { player: actor, die: "D12", value: 7 }, { player: rival, die: "D8", value: 8 }]);
    assert.ok(one.events.some(e => e.payload.kind === "EFFECT_PENDING"), "the trigger is pending; the condition is checked on resolution (10.16.1.1)");
    assert.ok(one.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === false), "a rival's 8 does not count");
    assert.equal(one.drawn, 0);
});

test("the reviewed union admits the V27 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === ROAMER));
});
