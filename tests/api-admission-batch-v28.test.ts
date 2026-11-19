import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV28Cards, batchV28Context, batchV28Input, v28Source, JACKIE } from "./api-admission-batch-v28-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV28Context();
const jackie = batchV28Cards[0];
const SMASHER = "adam-smasher-metal-over-meat"; // Power 15; its {Play} never fires when arranged directly.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV28Input("batch-v28"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

/** Trusted arrangement: rewrites the player's last deck card as `cardId` on the field with the given readiness and no entry statuses. */
function field(s: GameState, cardId: string, player: PlayerId, readiness: "READY" | "SPENT" = "READY") {
    const m = new TurnMutation(s, context), r = context.content.cards.find(c => c.id === cardId)!, deck = m.state.players[player].zones.DECK;
    const c = m.state.objects.cards[deck[deck.length - 1]]; c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD");
    c.readiness = readiness; c.statuses = [];
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
/** Jackie attacks `target` (the rival Gig area when omitted); returns the state at the rival's React window. */
function attack(prepared: GameState, target?: CardInstanceId) {
    const unit = field(prepared, JACKIE, actor);
    let r = take(unit.state, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit.id);
    const events = [...r.events];
    if (r.state.resolution.choice?.options.some(o => o.kind === "ATTACK_TARGET")) {
        r = pick(r.state, context, o => o.kind === "ATTACK_TARGET" && (target ? o.target.kind === "CARD" && o.target.cardInstanceId === target : o.target.kind === "GIG_AREA"));
        events.push(...r.events);
    }
    assert.equal(r.state.timing.step, "RIVAL_REACT");
    return { state: r.state, events, jackieId: unit.id };
}
const EVEN_TWO = [{ player: actor, die: "D4", value: 2 }, { player: actor, die: "D6", value: 6 }, { player: actor, die: "D8", value: 5 }, { player: rival, die: "D10", value: 4 }];

test("the V28 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(jackie.provenance.sourceHash, hashCanonical(v28Source(jackie.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === jackie.id), [jackie]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Jackie Welles: Ride or Die Choom passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsTriggerCard(jackie, context).ok); assert.ok(supportsPlay(jackie, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(jackie) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["play trigger", d => { d.mechanics.abilities[0].trigger = "WHEN_PLAYED"; }],
        ["draw on attack", d => { d.mechanics.abilities[0].effects = [{ kind: "DRAW_PER_FRIENDLY_GIG", count: 1, parity: "ODD" }]; }],
        ["no defeated draw", d => { d.mechanics.abilities = [d.mechanics.abilities[0]]; }],
        ["only the defeated draw", d => { d.mechanics.abilities = [d.mechanics.abilities[1]]; }],
        ["abilities reordered", d => { d.mechanics.abilities = [d.mechanics.abilities[1], d.mechanics.abilities[0]]; }],
        ["condition", d => { d.mechanics.abilities[0].conditions = [{ kind: "SUBJECT_IS_EQUIPPED" }]; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 5 }; }],
        ["power", d => { d.power = 7; }],
        ["tags", d => { d.tags = ["Merc"]; }],
        ["keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsTriggerCard(forge(edit), context).ok, false, label);
});

test("{Attack} gives +2 for each friendly even Gig, counted at resolution; a rival's even Gig and an odd Gig do not count", () => {
    const r = attack(gigs(base, EVEN_TWO)), s = r.state;
    assert.equal(effectivePower(s, r.jackieId, context), 12, "8 + 2 x 2 even friendly Gigs");
    const applied = r.events.flatMap(e => e.payload.kind === "POWER_MODIFIER_APPLIED" ? [e.payload.modifier] : []);
    assert.equal(applied.length, 1); assert.equal(applied[0].amount, 4); assert.equal(applied[0].targetId, r.jackieId);
    const inflated = GameStateSchema.parse(s); (inflated.temporaryModifiers![0] as { amount: number }).amount = 2 * (Object.keys(s.objects.gigs).length + 1);
    assert.equal(validateState(inflated, context).ok, false, "never more than +2 per Gig in the game");
    const forged = GameStateSchema.parse(s); (forged.temporaryModifiers![0] as { origin: { effectId: string } }).origin.effectId = "f".repeat(64);
    assert.equal(validateState(forged, context).ok, false, "only its own resolved ATTACK occurrence");
    const ended = take(take(s, context, a => a.action.kind === "PASS_REACT").state, context, a => a.action.kind === "END_TURN");
    assert.equal(ended.state.temporaryModifiers, undefined, "the power lasts this turn only");
});

test("with no friendly even Gig the attack changes nothing", () => {
    const r = attack(gigs(base, [{ player: actor, die: "D8", value: 5 }, { player: rival, die: "D10", value: 4 }]));
    assert.equal(effectivePower(r.state, r.jackieId, context), 8);
    assert.equal(r.events.some(e => e.payload.kind === "POWER_MODIFIER_APPLIED"), false);
    assert.equal(r.state.temporaryModifiers, undefined);
});

test("{Defeated} draws 1 for each friendly odd Gig after it loses a fight", () => {
    const run = (rolled: { player: PlayerId; die: string; value: number }[]) => {
        const smasher = field(gigs(base, rolled), SMASHER, rival, "SPENT"), r = attack(smasher.state, smasher.id);
        const hand = r.state.players[actor].zones.HAND.length;
        let next = take(r.state, context, a => a.action.kind === "PASS_REACT");
        const events = [...next.events];
        while (next.state.resolution.choice && next.state.timing.step !== "MAIN") { next = choose(next.state, context); events.push(...next.events); }
        return { state: next.state, events, jackieId: r.jackieId, drawn: next.state.players[actor].zones.HAND.length - hand };
    };
    const odd = run([{ player: actor, die: "D4", value: 2 }, { player: actor, die: "D6", value: 3 }, { player: actor, die: "D8", value: 7 }, { player: rival, die: "D10", value: 5 }]);
    assert.equal(odd.state.objects.cards[odd.jackieId].zone.zone, "TRASH", "10 power loses to 15");
    assert.ok(odd.events.some(e => e.payload.kind === "EFFECT_PENDING"));
    assert.equal(odd.drawn, 2, "two friendly odd Gigs; the rival's odd Gig does not count");
    const even = run([{ player: actor, die: "D4", value: 2 }, { player: rival, die: "D10", value: 5 }]);
    assert.equal(even.state.objects.cards[even.jackieId].zone.zone, "TRASH");
    assert.equal(even.drawn, 0);
});

test("the reviewed union admits the V28 card", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === JACKIE));
});
