import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV99Cards, batchV99Context, batchV99Input, v99Source } from "./api-admission-batch-v99-fixture";
import { pick, withGigs } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV99Context();
const [alt] = batchV99Cards;
// Vanilla Units of cost 2, 3 and 4; a cost-1 Gear; Gorilla Arms (its host's first steal each turn steals again).
const VOODOO = "jacked-in-voodoo-boy", ATLUS = "emergency-atlus", SQUAD = "psycho-squad", BLADES = "mantis-blades", GORILLA = "gorilla-arms";
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function main(s: GameState): GameState {
    while (s.setup) s = choose(s, context, s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0).state;
    while (s.timing.step !== "MAIN") s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return s;
}
const first = main(unwrap(createGameWithEvents(batchV99Input("batch-v99"), context)).state);
const base = fund(clearField(first, context), context), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** The Rival's first Main Phase, after the actor's empty turn, funded for both players. */
const rivalBase = (() => { let s = take(base, context, a => a.action.kind === "END_TURN").state; s = main(s); return fund(fund(s, context), context, actor); })();

type Unit = { card?: string; gears?: string[] };
/** Trusted arrangement on `from`'s Main: the actor's Units `mine` and the Rival's Units `theirs` (with Gear), the actor's hand holding
 * only `hand`, and Gig values (non-d20 dice) by player. */
function arrange(from: GameState, a: { mine?: Unit[]; theirs?: Unit[]; hand?: string[]; gigs?: { mine: number[]; theirs: number[] } }) {
    const m = new TurnMutation(from, context);
    for (const id of [...m.state.players[actor].zones.HAND]) moveCardLocation(m, id, "REMOVED");
    const draw = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const put = (u: Unit, player: PlayerId) => {
        const host = draw(u.card ?? ATLUS, player); moveCardLocation(m, host.id, "BATTLEFIELD"); host.statuses = []; host.readiness = "READY";
        host.attachments = (u.gears ?? []).map(g => { const c = draw(g, player); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c.id; }).sort();
        return host.id;
    };
    const mine = (a.mine ?? []).map(u => put(u, actor)), theirs = (a.theirs ?? []).map(u => put(u, rival)), hand = (a.hand ?? []).map(id => draw(id, actor).id);
    let state = unwrap(validateState(GameStateSchema.parse(m.state), context));
    const gigIds = (p: PlayerId) => Object.values(state.objects.gigs).filter(g => g.controllerId === p && g.dieType !== "D20").map(g => g.id).sort();
    const g = a.gigs ?? { mine: [3], theirs: [1] }, ids = { mine: gigIds(actor).slice(0, g.mine.length), theirs: gigIds(rival).slice(0, g.theirs.length) };
    state = withGigs(state, context, Object.fromEntries([...ids.mine.map((id, i) => [id, g.mine[i]] as const), ...ids.theirs.map((id, i) => [id, g.theirs[i]] as const)]));
    return { state, mine, theirs, hand, gigs: ids };
}
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
const name = (cardId: string) => context.content.cards.find(c => c.id === cardId)!.displayName;
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
const offering = (s: GameState) => s.resolution.choice?.continuationId === "steal-prevention@1";
function step(r: Step, f: (o: { kind: string; confirmed?: boolean; cardInstanceId?: string; gigInstanceId?: string }) => boolean): Step {
    assert.ok(validateState(r.state, context).ok, JSON.stringify(validateState(r.state, context)));
    const next = pick(r.state, context, f) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
/** Takes the first option (passing an open React Step) until `done`. */
function settle(r: Step, done: (s: GameState) => boolean): Step {
    const events = [...r.events]; let s = r.state;
    for (let n = 0; !done(s); n++) {
        assert.ok(n < 30, `stuck at ${s.timing.step}`); assert.ok(validateState(s, context).ok, JSON.stringify(validateState(s, context)));
        const next = s.timing.step === "RIVAL_REACT" && !s.resolution.choice ? take(s, context, x => x.action.kind === "PASS_REACT") : choose(s, context, 0);
        s = next.state; events.push(...(next.events as Events));
    }
    return { state: s, events };
}
/** The Rival attacks the actor's Gig area with `attacker`, choosing `gig` if the steal pauses for a choice, up to the prevention offer
 * (or the attack's end). */
function rivalSteal(s: GameState, attacker: CardInstanceId, gig?: GigInstanceId): Step {
    let r = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === attacker) as Step;
    if (r.state.timing.step === "ATTACK_TARGET_SELECTION") r = step(r, o => o.kind === "ATTACK_TARGET" && (o as unknown as { target: { kind: string } }).target.kind === "GIG_AREA");
    for (let n = 0; !offering(r.state) && !mainIdle(r.state); n++) {
        assert.ok(n < 30, `stuck at ${r.state.timing.step}`); assert.ok(validateState(r.state, context).ok, JSON.stringify(validateState(r.state, context)));
        const x = r.state, next = x.timing.step === "RIVAL_REACT" && !x.resolution.choice ? take(x, context, y => y.action.kind === "PASS_REACT")
            : gig && x.resolution.choice?.kind === "STEAL_GIGS" ? pick(x, context, o => o.kind === "GIG" && o.gigInstanceId === gig) : choose(x, context, 0);
        r = { state: next.state, events: [...r.events, ...(next.events as Events)] };
    }
    return r;
}
const stolenFrom = (s: GameState, gig: GigInstanceId) => s.objects.gigs[gig].controllerId === rival;

test("the V99 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(alt.provenance.sourceHash, hashCanonical(v99Source(alt.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === alt.id), [alt]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Alt Cunningham: Mother of Daemons passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsSpendTriggerCard(alt, context).ok);
    assert.ok(supportsPlay(alt, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(alt) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no prevention", d => { d.mechanics.modifiers = []; }],
        ["unguarded spend", d => { delete d.mechanics.abilities[0].guard; }],
        ["first-spend guard", d => { d.mechanics.abilities[0].guard = "FIRST_SPEND_PER_TURN"; }],
        ["draw 2", d => { d.mechanics.abilities[0].effects = [{ kind: "DRAW", count: 2 }]; }],
        ["power", d => { d.power = 7; }]
    ];
    for (const [label, edit] of forgeries) {
        assert.equal(supportsSpendTriggerCard(forge(edit), context).ok, false, label);
        assert.equal(supportsPlay(forge(edit), context).ok, false, label);
    }
});

test("a friendly equipped Unit spent by its attack draws 1; an unequipped one does not", () => {
    const a = arrange(base, { mine: [{ card: alt.id }, { gears: [BLADES] }, { card: SQUAD }] }), [, equipped, plain] = a.mine;
    const hand = a.state.players[actor].zones.HAND.length;
    const attack = (s: GameState, id: CardInstanceId) => {
        let r = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === id) as Step;
        if (r.state.timing.step === "ATTACK_TARGET_SELECTION") r = step(r, o => o.kind === "ATTACK_TARGET" && (o as unknown as { target: { kind: string } }).target.kind === "GIG_AREA");
        return r;
    };
    const r = attack(a.state, equipped);
    assert.ok(has(r.events, "EFFECT_PENDING", p => p.sourceId === a.mine[0]), "Alt's draw is pending");
    const done = settle(r, mainIdle);
    assert.equal(done.state.players[actor].zones.HAND.length, hand + 1);
    assert.deepEqual(done.state.turnHistory?.equippedSpends, [equipped]);
    assert.ok(validateState(done.state, context).ok);
    const n = settle(attack(a.state, plain), mainIdle);
    assert.ok(!has(n.events, "EFFECT_PENDING", p => p.sourceId === a.mine[0]));
    assert.equal(n.state.players[actor].zones.HAND.length, hand);
    assert.equal(n.state.turnHistory?.equippedSpends, undefined);
});

test("Alt itself, equipped, draws when spent; unequipped it does not", () => {
    const a = arrange(base, { mine: [{ card: alt.id, gears: [BLADES] }] }), hand = a.state.players[actor].zones.HAND.length;
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.mine[0]) as Step;
    if (r.state.timing.step === "ATTACK_TARGET_SELECTION") r = step(r, o => o.kind === "ATTACK_TARGET" && (o as unknown as { target: { kind: string } }).target.kind === "GIG_AREA");
    assert.equal(settle(r, mainIdle).state.players[actor].zones.HAND.length, hand + 1);
    const b = arrange(base, { mine: [{ card: alt.id }] });
    let q = take(b.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === b.mine[0]) as Step;
    if (q.state.timing.step === "ATTACK_TARGET_SELECTION") q = step(q, o => o.kind === "ATTACK_TARGET" && (o as unknown as { target: { kind: string } }).target.kind === "GIG_AREA");
    assert.equal(settle(q, mainIdle).state.players[actor].zones.HAND.length, b.state.players[actor].zones.HAND.length);
});

test("a rival attacker's steal is offered for prevention; discarding a card of the Gig's value keeps the Gig", () => {
    const a = arrange(rivalBase, { mine: [{ card: alt.id }], theirs: [{ card: SQUAD }], hand: [ATLUS, VOODOO], gigs: { mine: [3], theirs: [1] } }), [cost3] = a.hand, [gig] = a.gigs.mine;
    let r = rivalSteal(a.state, a.theirs[0]);
    assert.ok(offering(r.state)); assert.equal(r.state.timing.actingPlayer, actor);
    assert.equal(r.state.timing.combat.stage, "GIG_STEAL_SELECTION");
    assert.deepEqual(cardOptions(r.state), [cost3], "only the cost-3 card");
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Discard ${name(ATLUS)} (${cost3}) so the Gig isn't stolen`));
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === "Let the Gig be stolen"));
    assert.ok(validateState(r.state, context).ok);
    const forged = GameStateSchema.parse(structuredClone(r.state)); forged.timing.actingPlayer = rival;
    assert.equal(validateState(forged, context).ok, false, "the defending player answers");
    r = step(r, o => o.kind === "CARD" && o.cardInstanceId === cost3);
    assert.ok(has(r.events, "GIG_STEAL_PREVENTED", p => p.gigInstanceId === gig && p.discardedId === cost3 && p.sourceId === a.mine[0]));
    assert.ok(!has(r.events, "GIG_STOLEN"));
    assert.equal(r.state.objects.cards[cost3].zone.zone, "TRASH");
    r = settle(r, mainIdle);
    assert.ok(!stolenFrom(r.state, gig)); assert.equal(r.state.timing.activePlayer, rival);
    assert.ok(validateState(r.state, context).ok);
});

test("the offer may be declined; with no card of the Gig's value nothing is offered", () => {
    const a = arrange(rivalBase, { mine: [{ card: alt.id }], theirs: [{ card: SQUAD }], hand: [ATLUS], gigs: { mine: [3], theirs: [1] } }), [gig] = a.gigs.mine;
    let r = step(rivalSteal(a.state, a.theirs[0]), o => o.kind === "CONFIRM" && o.confirmed === false);
    assert.ok(has(r.events, "GIG_STEAL_PREVENTION_DECLINED", p => p.gigInstanceId === gig));
    r = settle(r, mainIdle);
    assert.ok(stolenFrom(r.state, gig)); assert.equal(r.state.objects.cards[a.hand[0]].zone.zone, "HAND");
    const b = arrange(rivalBase, { mine: [{ card: alt.id }], theirs: [{ card: SQUAD }], hand: [VOODOO], gigs: { mine: [3], theirs: [1] } });
    const n = rivalSteal(b.state, b.theirs[0]);
    assert.ok(!offering(n.state)); assert.ok(stolenFrom(settle(n, mainIdle).state, b.gigs.mine[0]));
    const c = arrange(rivalBase, { theirs: [{ card: SQUAD }], hand: [ATLUS], gigs: { mine: [3], theirs: [1] } });
    assert.ok(!offering(rivalSteal(c.state, c.theirs[0]).state), "no Alt, no offer");
});

test("an effect steal (Gorilla Arms' second steal) is offered too, after its Gig is chosen", () => {
    const a = arrange(rivalBase, { mine: [{ card: alt.id }], theirs: [{ card: ATLUS, gears: [GORILLA] }], hand: [VOODOO], gigs: { mine: [3, 2], theirs: [1] } }), [g3, g2] = a.gigs.mine, [cost2] = a.hand;
    let r = rivalSteal(a.state, a.theirs[0], g3);
    assert.ok(!offering(r.state) || r.state.resolution.triggerContinuation, "the cost-3 Gig cannot be prevented");
    for (let n = 0; !offering(r.state) && !mainIdle(r.state); n++) { assert.ok(n < 10); r = step(r, () => true); }
    assert.ok(offering(r.state), "the second steal is offered");
    assert.equal(r.state.resolution.triggerContinuation?.stealPrevention?.gigInstanceId, g2);
    assert.equal(r.state.timing.actingPlayer, actor);
    assert.ok(stolenFrom(r.state, g3));
    assert.ok(validateState(r.state, context).ok);
    const forged = GameStateSchema.parse(structuredClone(r.state)); delete forged.resolution.triggerContinuation!.stealPrevention;
    assert.equal(validateState(forged, context).ok, false);
    r = step(r, o => o.kind === "CARD" && o.cardInstanceId === cost2);
    assert.ok(has(r.events, "GIG_STEAL_PREVENTED", p => p.gigInstanceId === g2));
    r = settle(r, mainIdle);
    assert.ok(!stolenFrom(r.state, g2)); assert.ok(validateState(r.state, context).ok);
});
