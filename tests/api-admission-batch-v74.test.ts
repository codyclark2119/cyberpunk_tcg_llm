import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsQuickActivationCard } from "../packages/engine/src/quick-activation-support";
import { effectiveKeywords } from "../packages/engine/src/capabilities";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV74Cards, batchV74Context, batchV74Input, v74Source } from "./api-admission-batch-v74-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV74Context();
const [goro] = batchV74Cards;
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad", FLATHEAD = "mt0d12-flathead", CORPO = "corpo-security", OCTANT = "octant"; // Costs 3, 4, 5; a cost-2 printed Blocker; an attacker.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV74Input("batch-v74"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { owner: PlayerId; mine?: string[]; theirs?: string[]; gigs?: number[]; face?: "UP" | "DOWN"; hand?: number };
/** Trusted arrangement on the actor's MAIN: Goro as `owner`'s last Legend (face up and ready unless `face` says otherwise), `mine` (the
 * owner's) and `theirs` ready on the field, the owner's Gig area holding rolled Gigs of the given values, and the owner's hand cut to `hand`. */
function arrange(a: Arrangement) {
    const m = new TurnMutation(base, context), ids: Record<string, CardInstanceId> = {}, other = a.owner === actor ? rival : actor;
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY";
        ids[cardId] = c.id;
    };
    for (const id of a.mine ?? []) rewrite(a.owner, id);
    for (const id of a.theirs ?? []) rewrite(other, id);
    if (a.hand !== undefined) for (const id of m.state.players[a.owner].zones.HAND.slice(a.hand)) moveCardLocation(m, id, "TRASH");
    const d = GameStateSchema.parse(m.state), legends = d.players[a.owner].zones.LEGENDS, g = d.objects.cards[legends[legends.length - 1]];
    g.cardId = goro.id; g.revision = goro.revision; g.face = a.face ?? "UP"; g.readiness = "READY";
    const values = [...(a.gigs ?? [])];
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const gig of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const value = gig.ownerId === a.owner ? values.shift() : undefined;
        gig.controllerId = gig.ownerId; gig.location = { playerId: gig.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        gig.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[gig.ownerId].gigs[gig.location.zone].push(gig.id);
    }
    return { state: unwrap(validateState(d, context)), ids, goro: g.id };
}
const isGoro = (id: CardInstanceId) => (a: { action: { kind: string; sourceInstanceId?: string } }) => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id;
const spentEddies = (s: GameState, p: PlayerId) => s.players[p].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "SPENT").length;
/** Activates Goro, paying with Eddies only (a spent Legend cannot pay for itself). */
function activate(s: GameState, id: CardInstanceId) {
    let r = take(s, context, isGoro(id)); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
/** The actor attacks the rival's Gig area with `attacker`, leaving the rival's React Step open. */
function attack(s: GameState, attacker: CardInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(state.timing.step, "RIVAL_REACT"); assert.equal(state.timing.actingPlayer, rival);
    return state;
}

test("the V74 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(goro.provenance.sourceHash, hashCanonical(v74Source(goro.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === goro.id), [goro]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Goro Takemura: Vengeful Bodyguard passes only its exact pin; any changed field is rejected by every gate", () => {
    const gates = [supportsLegendSpendCard, supportsCall, supportsTriggerCard];
    for (const gate of gates) assert.ok(gate(goro, context).ok);
    assert.equal(supportsQuickActivationCard(goro, context).ok, false, "the Unit Quick gate never admits a Legend");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(goro) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const quick = (d: CardRevisionSnapshot) => d.mechanics.abilities[0], trigger = (d: CardRevisionSnapshot) => d.mechanics.abilities[1];
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["Main timing", d => { quick(d).activation!.timing = "MAIN"; }],
        ["no Eddie cost", d => { quick(d).activation!.costs = [{ kind: "SPEND_SOURCE" }]; }],
        ["a mandatory discard", d => { const e = trigger(d).effects[0]; if (e.kind === "DISCARD_CARDS") delete e.optional; }],
        ["no draw", d => { const e = trigger(d).effects[0]; if (e.kind === "DISCARD_CARDS") delete e.thenDrawOne; }],
        ["its own Blocker only", d => { trigger(d).trigger = "WHEN_BLOCKER_USED"; }],
        ["a keyword", d => { d.mechanics.keywords = ["BLOCKER"]; }],
        ["tags", d => { d.tags = ["Arasaka"]; }],
        ["unsellable", d => { d.sellProfile = { allowed: false, baseEddieValue: 1 }; }],
        ["scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of gates) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("in the Main Phase, Goro pays 1 and spends to give a chosen cost-4-or-less friendly Unit Blocker and, with a value pair, +1 power", () => {
    const a = arrange({ owner: actor, mine: [ATLUS, PSYCHO, FLATHEAD], gigs: [3, 3] });
    const offered = actions(a.state, context).find(isGoro(a.goro));
    assert.match(offered?.descriptor.label ?? "", /Pay 1 and spend to give a friendly Unit with cost 4 or less Blocker this turn/);
    const before = spentEddies(a.state, actor), s = activate(a.state, a.goro).state;
    assert.equal(s.objects.cards[a.goro].readiness, "SPENT"); assert.equal(spentEddies(s, actor), before + 1);
    assert.equal(s.timing.step, "TARGET_SELECTION");
    const offeredTargets = s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort();
    assert.deepEqual(offeredTargets, [a.ids[ATLUS], a.ids[PSYCHO]].sort(), "the cost-5 Unit is never offered");
    assert.ok(actions(s, context).some(x => x.descriptor.label === `Give Psycho Squad (${a.ids[PSYCHO]}) Blocker this turn`));
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[PSYCHO]);
    assert.ok(validateState(done.state, context).ok);
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.resolution.playContinuation, undefined);
    assert.ok(effectiveKeywords(done.state, a.ids[PSYCHO], context).includes("BLOCKER"));
    assert.ok(!effectiveKeywords(done.state, a.ids[ATLUS], context).includes("BLOCKER"));
    assert.equal(effectivePower(done.state, a.ids[PSYCHO], context), 7);
    assert.ok(done.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met));
    assert.ok(!actions(done.state, context).some(isGoro(a.goro)), "spent, Goro cannot activate again");
    const next = end(done.state, context).state;
    assert.ok(validateState(next, context).ok);
    assert.ok(!effectiveKeywords(next, a.ids[PSYCHO], context).includes("BLOCKER")); assert.equal(effectivePower(next, a.ids[PSYCHO], context), 6);
});

test("without a value pair a lone target gets Blocker only; with no target the cost is still paid", () => {
    const lone = arrange({ owner: actor, mine: [ATLUS, FLATHEAD], gigs: [3, 4] });
    const r = activate(lone.state, lone.goro);
    assert.equal(r.state.timing.step, "MAIN");
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === lone.ids[ATLUS] && e.payload.forced));
    assert.ok(r.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    assert.ok(effectiveKeywords(r.state, lone.ids[ATLUS], context).includes("BLOCKER")); assert.equal(effectivePower(r.state, lone.ids[ATLUS], context), 4);
    assert.equal(r.state.temporaryModifiers, undefined);
    const none = arrange({ owner: actor, mine: [FLATHEAD], gigs: [3, 3] });
    const before = spentEddies(none.state, actor), n = activate(none.state, none.goro).state;
    assert.equal(n.timing.step, "MAIN"); assert.equal(spentEddies(n, actor), before + 1); assert.equal(n.temporaryKeywords, undefined);
});

test("in its controller's React Step, Goro makes a ready Unit a Blocker, and its use offers the may discard, then draw 1", () => {
    const a = arrange({ owner: rival, mine: [ATLUS], theirs: [OCTANT], gigs: [2, 5] });
    let s = attack(a.state, a.ids[OCTANT]);
    assert.ok(!actions(s, context).some(x => x.action.kind === "DECLARE_BLOCKER"), "no Blocker yet");
    assert.ok(actions(s, context).some(isGoro(a.goro)));
    s = activate(s, a.goro).state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.timing.actingPlayer, rival);
    assert.ok(effectiveKeywords(s, a.ids[ATLUS], context).includes("BLOCKER"));
    const hand = [...s.players[rival].zones.HAND];
    const blocked = take(s, context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === a.ids[ATLUS]);
    s = blocked.state;
    assert.ok(validateState(s, context).ok);
    assert.equal(s.timing.step, "DISCARD_SELECTION"); assert.equal(s.timing.actingPlayer, rival);
    assert.ok(blocked.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.goro));
    const labels = actions(s, context).map(x => x.descriptor.label);
    assert.ok(labels.includes("Discard nothing"), labels.join(" | "));
    assert.equal(s.resolution.choice!.options.length, hand.length + 1);
    const discarded = hand[0], r = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === discarded);
    assert.ok(validateState(r.state, context).ok);
    assert.ok(r.state.players[rival].zones.TRASH.includes(discarded));
    assert.equal(r.state.players[rival].zones.HAND.length, hand.length, "discard 1, then draw 1");
    assert.equal(r.state.timing.step, "RIVAL_REACT", "the React Step reopens after the Blocker-used batch (9.11)");
});

test("any friendly Blocker fires the trigger; declining draws nothing, and an empty hand never pauses", () => {
    const a = arrange({ owner: rival, mine: [CORPO], theirs: [OCTANT], gigs: [2, 5] });
    const s = take(attack(a.state, a.ids[OCTANT]), context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === a.ids[CORPO]).state;
    assert.equal(s.timing.step, "DISCARD_SELECTION");
    const hand = s.players[rival].zones.HAND.length, deck = s.players[rival].zones.DECK.length;
    const r = pick(s, context, o => o.kind === "MODE" && o.mode === "DONE");
    assert.ok(validateState(r.state, context).ok);
    assert.ok(r.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(r.state.players[rival].zones.HAND.length, hand); assert.equal(r.state.players[rival].zones.DECK.length, deck);
    assert.equal(r.state.timing.step, "RIVAL_REACT");
    const empty = arrange({ owner: rival, mine: [CORPO], theirs: [OCTANT], gigs: [2, 5], hand: 0 });
    const e = take(attack(empty.state, empty.ids[OCTANT]), context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === empty.ids[CORPO]);
    assert.equal(e.state.timing.step, "RIVAL_REACT"); assert.ok(e.events.some(x => x.payload.kind === "EFFECT_PENDING" && x.payload.sourceId === empty.goro));
});

test("face down, Goro neither activates nor observes a Blocker", () => {
    const a = arrange({ owner: rival, mine: [CORPO], theirs: [OCTANT], gigs: [2, 5], face: "DOWN" });
    const s = attack(a.state, a.ids[OCTANT]);
    assert.ok(!actions(s, context).some(isGoro(a.goro)));
    const r = take(s, context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === a.ids[CORPO]);
    assert.equal(r.state.timing.step, "RIVAL_REACT"); assert.ok(!r.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.goro));
});

test("with the Blocker's own Blocker-used trigger, its controller orders both, and each resolves", () => {
    const NEGOTIATORS = "augmented-negotiators"; // Blocker; "When this Unit uses {Blocker}, a Rival discards 1."
    const a = arrange({ owner: rival, mine: [NEGOTIATORS], theirs: [OCTANT], gigs: [2, 5] });
    let r = take(attack(a.state, a.ids[OCTANT]), context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === a.ids[NEGOTIATORS]);
    assert.equal(r.state.timing.step, "TRIGGER_ORDER_SELECTION"); assert.equal(r.state.timing.actingPlayer, rival);
    const rivalHand = r.state.players[actor].zones.HAND.length;
    for (let n = 0; r.state.resolution.choice; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        r = r.state.resolution.choice.options.some(o => o.kind === "MODE") ? pick(r.state, context, o => o.kind === "MODE") : choose(r.state, context, 0);
    }
    assert.ok(validateState(r.state, context).ok);
    assert.equal(r.state.timing.step, "RIVAL_REACT");
    assert.equal(r.state.players[actor].zones.HAND.length, rivalHand - 1, "the attacker discarded 1");
});
