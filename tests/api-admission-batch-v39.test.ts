import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsCapabilityGear } from "../packages/engine/src/capability-support";
import { effectiveKeywords } from "../packages/engine/src/capabilities";
import { effectivePower } from "../packages/engine/src/characteristics";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV39Cards, batchV39Context, batchV39Input, v39Source, CONVERTER } from "./api-admission-batch-v39-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { attachPlayedGear, moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV39Context();
const gear = batchV39Cards[0];
const ATLUS = "emergency-atlus"; // A vanilla Unit with power 4.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV39Input("batch-v39"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: each listed die is rolled into its owner's Gig area; all other dice wait in fixer areas. */
function gigs(s: GameState, rolled: { player: PlayerId; die: string }[]) {
    const d = GameStateSchema.parse(s);
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    const chosen = new Set(rolled.map(x => Object.values(d.objects.gigs).find(g => g.ownerId === x.player && g.dieType === x.die)!.id));
    for (const g of Object.values(d.objects.gigs)) {
        const rolledIn = chosen.has(g.id);
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolledIn ? "GIGS" : "FIXER" };
        g.roll = rolledIn ? { kind: "ROLLED", initialValue: 1, currentValue: 2 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
    }
    return unwrap(validateState(d, context));
}
/** Trusted arrangement: the player's last deck card becomes `cardId` in hand, or on the field ready, lagging as if played this turn. */
function put(s: GameState, cardId: string, player: PlayerId, where: "HAND" | "LAGGING") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    if (where !== "HAND") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = ["LAG"]; }
    return { state: unwrap(validateState(m.state, context)), id: c.id };
}
/** Trusted arrangement: a lagging Unit for the actor with the Converter equipped. */
function equipped(s: GameState) {
    const host = put(s, ATLUS, actor, "LAGGING"), placed = put(host.state, CONVERTER, actor, "HAND"), m = new TurnMutation(placed.state, context);
    unwrap(attachPlayedGear(m, placed.id, host.id));
    return { state: unwrap(validateState(m.state, context)), host: host.id, gear: placed.id };
}
const canAttack = (s: GameState, id: CardInstanceId) => actions(s, context).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id);
// The actor controls 1 Gig. Three rival Gigs is 2 more; two rival Gigs is only 1 more.
const AHEAD = [{ player: actor, die: "D4" }, { player: rival, die: "D4" }, { player: rival, die: "D6" }, { player: rival, die: "D8" }];
const CLOSE = [{ player: actor, die: "D4" }, { player: rival, die: "D4" }, { player: rival, die: "D6" }];

test("the V39 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(gear.provenance.sourceHash, hashCanonical(v39Source(gear.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === gear.id), [gear]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Adrenaline Converter passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsCapabilityGear(gear, context).ok); assert.ok(supportsPlay(gear, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(gear) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["unconditional", d => { d.mechanics.modifiers = [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "GRANT_KEYWORD_TO_HOST", keyword: "BLOCKER" }]; }],
        ["no printed power", d => { d.mechanics.modifiers = [d.mechanics.modifiers[1]]; }],
        ["an ability", d => { d.mechanics.abilities = [{ id: `${CONVERTER}-x@1`, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }]; }],
        ["plain Gear scope", d => { d.execution = { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" }; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 1 }; }],
        ["power", d => { d.power = 0; }],
        ["tags", d => { d.tags = ["Cyberware"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("while a Rival controls 2 more Gigs, the equipped lagging Unit has Adrenaline and can attack", () => {
    const a = equipped(gigs(base, AHEAD));
    assert.deepEqual(effectiveKeywords(a.state, a.host, context), ["ADRENALINE"]); assert.equal(effectivePower(a.state, a.host, context), 7, "printed power 3 is granted too");
    assert.ok(canAttack(a.state, a.host));
    const declared = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.host).state;
    assert.notEqual(declared.timing.combat.stage, "NONE");
});

test("one more Gig is not enough, the count is live, and the Gear's own controller is \"you\"", () => {
    const close = equipped(gigs(base, CLOSE));
    assert.deepEqual(effectiveKeywords(close.state, close.host, context), []); assert.equal(canAttack(close.state, close.host), false, "lagging without Adrenaline");
    const live = gigs(close.state, AHEAD);
    assert.ok(canAttack(live, close.host), "a third rival Gig grants it at once");
    const reversed = equipped(gigs(base, [{ player: rival, die: "D4" }, { player: actor, die: "D4" }, { player: actor, die: "D6" }, { player: actor, die: "D8" }]));
    assert.equal(canAttack(reversed.state, reversed.host), false, "the actor being ahead does not count");
});

test("the Gear is played and equipped as ordinary Gear", () => {
    const host = put(gigs(base, AHEAD), ATLUS, actor, "LAGGING"), hand = put(host.state, CONVERTER, actor, "HAND");
    let s = playCard(hand.state, context, CONVERTER).state;
    if (s.resolution.choice) s = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === host.id).state;
    assert.deepEqual(s.objects.cards[host.id].attachments, [hand.id]); assert.ok(canAttack(s, host.id));
});

test("the reviewed union admits the V39 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === CONVERTER));
});
