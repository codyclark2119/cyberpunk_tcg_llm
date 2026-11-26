import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsQuickActivationCard } from "../packages/engine/src/quick-activation-support";
import { supportsPlay } from "../packages/engine/src/play-support";
import { attachedGear } from "../packages/engine/src/attachments";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV98Cards, batchV98Context, batchV98Input, v98Source } from "./api-admission-batch-v98-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV98Context();
const [overwatch] = batchV98Cards;
// Vanilla Units of cost 2, 3, 4 and 5; a cost-1 Gear; a cost-5 Unit whose {Defeated} makes a Rival discard 1.
const VOODOO = "jacked-in-voodoo-boy", ATLUS = "emergency-atlus", SQUAD = "psycho-squad", FLATHEAD = "mt0d12-flathead", BLADES = "mantis-blades", CALIBER = "caliber-totentanz-s-top-dog";
type Events = { payload: { kind: string } & Record<string, unknown> }[];
type Step = { state: GameState; events: Events };
function main(s: GameState): GameState {
    while (s.setup) s = choose(s, context, s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0).state;
    while (s.timing.step !== "MAIN") s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return s;
}
const first = main(unwrap(createGameWithEvents(batchV98Input("batch-v98"), context)).state);
const base = fund(clearField(first, context), context), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
/** The Rival's first Main Phase, after the actor's empty turn, funded for both players. */
const rivalBase = (() => { let s = take(base, context, a => a.action.kind === "END_TURN").state; s = main(s); return fund(fund(s, context), context, actor); })();

type Unit = { card?: string; gears?: string[]; readiness?: "READY" | "SPENT"; lag?: boolean };
/** Trusted arrangement on `from`'s Main: the actor's Units `mine` and the Rival's Units `theirs` (with Gear), the actor's hand holding
 * only `hand`. */
function arrange(from: GameState, a: { mine?: Unit[]; theirs?: Unit[]; hand?: string[] }) {
    const m = new TurnMutation(from, context);
    for (const id of [...m.state.players[actor].zones.HAND]) moveCardLocation(m, id, "REMOVED");
    const draw = (cardId: string, player: PlayerId) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const put = (u: Unit, player: PlayerId) => {
        const host = draw(u.card ?? ATLUS, player); moveCardLocation(m, host.id, "BATTLEFIELD"); host.statuses = u.lag ? ["LAG"] : []; host.readiness = u.readiness ?? "READY";
        host.attachments = (u.gears ?? []).map(g => { const c = draw(g, player); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c.id; }).sort();
        return host.id;
    };
    const mine = (a.mine ?? []).map(u => put(u, actor)), theirs = (a.theirs ?? []).map(u => put(u, rival)), hand = (a.hand ?? []).map(id => draw(id, actor).id);
    const state = unwrap(validateState(GameStateSchema.parse(m.state), context));
    return { state, mine, theirs, hand, gear: mine.length ? attachedGear(state, mine[0], context).find(g => g.cardId === overwatch.id)?.id : undefined };
}
const isOverwatch = (id: CardInstanceId | undefined) => (a: { action: { kind: string; sourceInstanceId?: string } }) => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id;
const cardOptions = (s: GameState) => (s.resolution.choice?.options ?? []).flatMap(o => o.kind === "CARD" ? [o.cardInstanceId] : []);
const has = (events: Events, kind: string, f: (p: Record<string, unknown>) => boolean = () => true) => events.some(e => e.payload.kind === kind && f(e.payload));
const name = (cardId: string) => context.content.cards.find(c => c.id === cardId)!.displayName;
const mainIdle = (s: GameState) => s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice;
function then(r: Step, f: (o: { kind: string; cardInstanceId?: string }) => boolean): Step {
    assert.ok(validateState(r.state, context).ok, JSON.stringify(validateState(r.state, context)));
    const next = pick(r.state, context, f) as Step;
    return { state: next.state, events: [...r.events, ...next.events] };
}
/** Activates Overwatch and pays its Eddie, choosing the first source while payment pauses. */
function activate(s: GameState, gear: CardInstanceId | undefined): Step {
    let r = take(s, context, isOverwatch(gear)) as Step;
    while (r.state.resolution.choice?.kind === "PAYMENT") r = then(r, o => o.kind === "PAYMENT");
    return r;
}
const invalid = (s: GameState, edit: (s: ReturnType<typeof GameStateSchema.parse>) => void) => { const f = GameStateSchema.parse(structuredClone(s)); edit(f); return !validateState(f, context).ok; };
function attack(s: GameState, attacker: CardInstanceId) {
    s = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === attacker).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(s.timing.step, "RIVAL_REACT"); assert.equal(s.timing.actingPlayer, actor);
    return s;
}

test("the V98 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(overwatch.provenance.sourceHash, hashCanonical(v98Source(overwatch.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === overwatch.id), [overwatch]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Overwatch: Panam's Gift passes only its exact pin; any changed field is rejected", () => {
    assert.ok(supportsQuickActivationCard(overwatch, context).ok);
    assert.ok(supportsPlay(overwatch, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(overwatch) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["not inherited", d => { delete d.mechanics.abilities[0].inherited; }],
        ["Main timing", d => { d.mechanics.abilities[0].activation!.timing = "MAIN"; }],
        ["fixed cost bound", d => { d.mechanics.abilities[0].effects[1] = { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, readiness: "SPENT", cost: { kind: "AT_MOST", value: 3 } } }; }],
        ["any readiness", d => { d.mechanics.abilities[0].effects[1] = { kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "ANY" }, cost: { kind: "AT_MOST_DISCARDED" } } }; }],
        ["no power grant", d => { d.mechanics.modifiers = []; }],
        ["power", d => { d.power = 3; }]
    ];
    for (const [label, edit] of forgeries) {
        assert.equal(supportsQuickActivationCard(forge(edit), context).ok, false, label);
        assert.equal(supportsPlay(forge(edit), context).ok, false, label);
    }
});

test("in the Main Phase its host is spent to discard 1, then defeat a spent rival Unit costing no more than the discarded card", () => {
    const a = arrange(base, { mine: [{ gears: [overwatch.id] }], theirs: [{ card: VOODOO, readiness: "SPENT" }, { card: ATLUS, readiness: "SPENT" }, { card: FLATHEAD, readiness: "SPENT" }, { card: SQUAD }], hand: [ATLUS, VOODOO] });
    const [host] = a.mine, [voodoo, atlus, flathead, squad] = a.theirs, [cost3, cost2] = a.hand;
    const offered = actions(a.state, context).find(x => isOverwatch(a.gear)(x));
    assert.ok(offered, "the equipped Gear's ability is offered");
    assert.equal(offered.descriptor.label, `Activate ${name(overwatch.id)}: Pay 1 and spend ${name(ATLUS)} to discard 1, then defeat a spent rival Unit with cost up to the discarded card's`);
    let r = activate(a.state, a.gear);
    assert.ok(has(r.events, "CARD_SPENT", p => p.cardInstanceId === host));
    assert.equal(r.state.objects.cards[host].readiness, "SPENT", "the host is spent");
    assert.equal(r.state.objects.cards[a.gear!].readiness, "READY", "the Gear itself is not");
    assert.deepEqual(cardOptions(r.state), [cost3, cost2].sort());
    assert.ok(actions(r.state, context).some(x => x.descriptor.label === `Discard ${name(ATLUS)} (${cost3})`));
    assert.ok(invalid(r.state, f => { f.objects.cards[host].readiness = "READY"; }), "the host stays spent");
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === cost3);
    assert.ok(has(r.events, "CARD_DISCARDED", p => p.cardInstanceId === cost3 && p.forced === false));
    assert.equal(r.state.objects.cards[cost3].zone.zone, "TRASH");
    assert.equal(r.state.resolution.playContinuation?.discardedCostId, cost3);
    assert.deepEqual(cardOptions(r.state), [voodoo, atlus].sort(), "cost 3 or less, spent only");
    assert.ok(!cardOptions(r.state).includes(flathead)); assert.ok(!cardOptions(r.state).includes(squad));
    assert.ok(validateState(r.state, context).ok);
    assert.ok(invalid(r.state, f => { delete f.resolution.playContinuation!.discardedCostId; }), "no discard, no bound");
    assert.ok(invalid(r.state, f => { f.resolution.playContinuation!.discardedCostId = cost2; }), "the discarded card is in the trash");
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === atlus);
    assert.equal(r.state.objects.cards[atlus].zone.zone, "TRASH");
    assert.equal(r.state.objects.cards[voodoo].zone.zone, "BATTLEFIELD");
    assert.ok(mainIdle(r.state));
    assert.deepEqual(attachedGear(r.state, host, context).map(g => g.id), [a.gear], "Overwatch stays equipped");
    assert.ok(validateState(r.state, context).ok);
    assert.ok(!actions(r.state, context).some(isOverwatch(a.gear)), "the host is spent");
});

test("a lone hand card is discarded at once, and a lone target is defeated; an empty hand defeats nothing", () => {
    const a = arrange(base, { mine: [{ gears: [overwatch.id] }], theirs: [{ card: VOODOO, readiness: "SPENT" }, { card: SQUAD, readiness: "SPENT" }], hand: [ATLUS] }), [voodoo, squad] = a.theirs;
    const r = activate(a.state, a.gear);
    assert.ok(has(r.events, "CARD_DISCARDED", p => p.cardInstanceId === a.hand[0] && p.forced === true));
    assert.equal(r.state.objects.cards[voodoo].zone.zone, "TRASH"); assert.equal(r.state.objects.cards[squad].zone.zone, "BATTLEFIELD");
    assert.ok(mainIdle(r.state)); assert.ok(validateState(r.state, context).ok);
    const b = arrange(base, { mine: [{ gears: [overwatch.id] }], theirs: [{ card: VOODOO, readiness: "SPENT" }] });
    const n = activate(b.state, b.gear);
    assert.ok(!has(n.events, "CARD_DISCARDED")); assert.equal(n.state.objects.cards[b.theirs[0]].zone.zone, "BATTLEFIELD");
    assert.ok(mainIdle(n.state)); assert.equal(n.state.objects.cards[b.mine[0]].readiness, "SPENT");
});

test("it is not offered while the host is spent or lagging, or while the Gear is unequipped", () => {
    for (const host of [{ readiness: "SPENT" as const }, { lag: true }]) {
        const a = arrange(base, { mine: [{ ...host, gears: [overwatch.id] }], theirs: [{ card: VOODOO, readiness: "SPENT" }], hand: [ATLUS] });
        assert.ok(!actions(a.state, context).some(isOverwatch(a.gear)), JSON.stringify(host));
    }
    const a = arrange(base, { hand: [ATLUS, overwatch.id] }), gear = a.hand[1];
    assert.ok(!actions(a.state, context).some(isOverwatch(gear)));
});

test("as a reaction it defeats the spent attacker; its owner orders the trash and the attack ends", () => {
    const a = arrange(rivalBase, { mine: [{ gears: [overwatch.id] }], theirs: [{ card: SQUAD, gears: [BLADES] }], hand: [FLATHEAD, VOODOO] }), [squad] = a.theirs, [cost5] = a.hand;
    const blades = a.state.objects.cards[squad].attachments[0];
    let r: Step = { state: attack(a.state, squad), events: [] };
    assert.ok(actions(r.state, context).some(isOverwatch(a.gear)), "offered in the React Step");
    r = activate(r.state, a.gear);
    assert.equal(r.state.timing.step, "TARGET_SELECTION"); assert.equal(r.state.timing.combat.stage, "RIVAL_REACT");
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === cost5);
    assert.equal(r.state.timing.step, "DEFEAT_ORDER_SELECTION", "the attacker and its Gear go to the trash together");
    assert.equal(r.state.timing.actingPlayer, rival);
    assert.deepEqual(cardOptions(r.state), [squad, blades].sort());
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === blades);
    assert.equal(r.state.objects.cards[squad].zone.zone, "TRASH"); assert.equal(r.state.objects.cards[blades].zone.zone, "TRASH");
    assert.ok(has(r.events, "ATTACK_ENDED", p => p.reason === "ATTACKER_INVALID"));
    assert.ok(mainIdle(r.state)); assert.equal(r.state.timing.activePlayer, rival);
    assert.ok(validateState(r.state, context).ok);
});

test("an attacker's {Defeated} trigger resolves in the React Step's batch before the attack ends", () => {
    const a = arrange(rivalBase, { mine: [{ gears: [overwatch.id] }], theirs: [{ card: CALIBER }], hand: [FLATHEAD, ATLUS, VOODOO] }), [caliber] = a.theirs, [cost5] = a.hand;
    let r = activate(attack(a.state, caliber), a.gear);
    r = then(r, o => o.kind === "CARD" && o.cardInstanceId === cost5);
    assert.equal(r.state.objects.cards[caliber].zone.zone, "TRASH");
    assert.equal(r.state.timing.combat.stage, "TRIGGER_RESOLUTION");
    assert.deepEqual(r.state.resolution.triggerContinuation?.origin, { kind: "DEFEAT", effectSource: a.gear, defeated: [{ targetId: caliber, defeatedBy: a.gear }] });
    for (let n = 0; !mainIdle(r.state); n++) { assert.ok(n < 10, r.state.timing.step); r = then(r, () => true); }
    assert.ok(has(r.events, "CARD_DISCARDED", p => p.playerId === actor && p.sourceId === caliber), "the Rival (the reacting player) discarded 1");
    assert.ok(has(r.events, "ATTACK_ENDED", p => p.reason === "ATTACKER_INVALID"));
    assert.ok(validateState(r.state, context).ok);
});
