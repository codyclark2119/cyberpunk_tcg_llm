import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV30Cards, batchV30Context, batchV30Input, v30Source, SANDAYU } from "./api-admission-batch-v30-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV30Context();
const sandayu = batchV30Cards[0];
const ATLUS = "emergency-atlus", SQUAD = "psycho-squad"; // Vanilla Units with power 4 and 6.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV30Input("batch-v30"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: the player's last deck card becomes `cardId` in hand, or on the field with the given readiness and no lag. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "READY" | "SPENT") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    if (where !== "HAND") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = where; c.statuses = []; }
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
    return unwrap(validateState(d, context));
}
/** Rival Units (ready unless named in `spent`) wait while Sandayu is put in hand; returns their ids in order. */
function arrange(rolled: { player: PlayerId; die: string; value: number }[], rivals: string[], spent: number[] = []) {
    let s = gigs(base, rolled); const ids = [];
    for (const [i, r] of rivals.entries()) { const placed = put(s, r, rival, spent.includes(i) ? "SPENT" : "READY"); s = placed.state; ids.push(placed.id); }
    const hand = put(s, SANDAYU, actor, "HAND");
    return { state: hand.state, rivals: ids, sandayuId: hand.id };
}
const TWO_PAIRS = [{ player: actor, die: "D4", value: 2 }, { player: actor, die: "D6", value: 2 }, { player: actor, die: "D8", value: 5 }, { player: actor, die: "D10", value: 5 }, { player: rival, die: "D12", value: 7 }];
const cards = (s: GameState) => s.resolution.choice!.options.flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []).sort();
const spend = (s: GameState, id: string) => pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === id);

test("the V30 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(sandayu.provenance.sourceHash, hashCanonical(v30Source(sandayu.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === sandayu.id), [sandayu]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Sandayu Oda: Hanako's Guardian passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(sandayu, context).ok); assert.ok(supportsPlay(sandayu, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(sandayu) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no attack permission", d => { d.mechanics.modifiers = []; }],
        ["no play spend", d => { d.mechanics.abilities = []; }],
        ["attack trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["one plain spend", d => { d.mechanics.abilities[0].effects = [{ kind: "SPEND_UNIT", target: { kind: "UNITS", relation: "RIVAL" } }]; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 6 }; }],
        ["power", d => { d.power = 7; }],
        ["tags", d => { d.tags = ["Corpo"]; }],
        ["keyword", d => { d.mechanics.keywords = ["ADRENALINE"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("two friendly value-pairs spend two chosen rival Units, one pick at a time", () => {
    const a = arrange(TWO_PAIRS, [ATLUS, SQUAD, ATLUS]), [x, y, z] = a.rivals;
    let s = playCard(a.state, context, SANDAYU).state;
    assert.equal(s.timing.step, "TARGET_SELECTION");
    assert.deepEqual(cards(s), [x, y, z].sort());
    assert.equal(s.resolution.triggerContinuation!.spendsRemaining, 2);
    const inflated = GameStateSchema.parse(s); inflated.resolution.triggerContinuation!.spendsRemaining = 3;
    assert.equal(validateState(inflated, context).ok, false, "never more spends than friendly value-pairs");
    s = spend(s, y).state;
    assert.equal(s.objects.cards[y].readiness, "SPENT");
    assert.equal(s.resolution.triggerContinuation!.spendsRemaining, 1);
    assert.deepEqual(cards(s), [x, y, z].sort(), "readiness is not a selector filter");
    const done = spend(s, x);
    assert.equal(done.state.objects.cards[x].readiness, "SPENT"); assert.equal(done.state.objects.cards[z].readiness, "READY");
    assert.equal(done.state.timing.step, "MAIN");
    assert.ok(done.events.some(e => e.payload.kind === "EFFECT_RESOLVED"));
});

test("6.6.1: three Gigs of one value are one pair; a rival's matching Gig adds none; a single rival Unit is forced", () => {
    const a = arrange([{ player: actor, die: "D4", value: 2 }, { player: actor, die: "D6", value: 2 }, { player: actor, die: "D8", value: 2 }, { player: rival, die: "D12", value: 2 }], [SQUAD]);
    const played = playCard(a.state, context, SANDAYU);
    assert.equal(played.state.timing.step, "MAIN");
    assert.equal(played.state.objects.cards[a.rivals[0]].readiness, "SPENT");
    assert.equal(played.events.filter(e => e.payload.kind === "CARD_SPENT").length, 1);
    assert.ok(played.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.forced === true));
});

test("with no friendly value-pair nothing is spent", () => {
    const a = arrange([{ player: actor, die: "D4", value: 2 }, { player: actor, die: "D6", value: 3 }, { player: rival, die: "D12", value: 2 }], [ATLUS, SQUAD]);
    const played = playCard(a.state, context, SANDAYU);
    assert.equal(played.state.timing.step, "MAIN");
    assert.ok(a.rivals.every(id => played.state.objects.cards[id].readiness === "READY"));
});

test("the turn it's played it can attack spent rival Units, never the Gig area", () => {
    const a = arrange([{ player: actor, die: "D4", value: 2 }, { player: rival, die: "D12", value: 7 }], [ATLUS, SQUAD], [1]);
    const s = playCard(a.state, context, SANDAYU).state, id = a.sandayuId;
    assert.ok(s.objects.cards[id].statuses.includes("LAG"), "it is lagging");
    assert.ok(actions(s, context).some(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === id));
    const declared = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === id).state;
    const targets = declared.resolution.choice ? declared.resolution.choice.options.flatMap(o => o.kind === "ATTACK_TARGET" ? [o.target] : []) : [declared.timing.combat.stage !== "NONE" && "target" in declared.timing.combat ? declared.timing.combat.target : null];
    assert.deepEqual(targets, [{ kind: "CARD", cardInstanceId: a.rivals[1] }], "only the spent rival Unit; the rival's Gig area is closed");
    const none = arrange([{ player: actor, die: "D4", value: 2 }, { player: rival, die: "D12", value: 7 }], [ATLUS]);
    const alone = playCard(none.state, context, SANDAYU).state;
    assert.equal(actions(alone, context).some(x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === none.sandayuId), false, "no spent rival Unit: it cannot attack");
});

test("the reviewed union admits the V30 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === SANDAYU));
});
