import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, listLegalActions, validateState, RulesView } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsCall } from "../packages/engine/src/effect-support";
import { supportsFieldLegend } from "../packages/engine/src/field-legend-support";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV49Cards, batchV49Context, batchV49Input, v49Source, QUEEN } from "./api-admission-batch-v49-fixture";
import { batchV48Context } from "./api-admission-batch-v48-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV49Context();
const queen = batchV49Cards[0];
const PSYCHO = "psycho-squad", ATLUS = "emergency-atlus", OCTANT = "octant"; // Vanilla Units: power 6, 4, 8.
function setup(ctx = context): GameState {
    let state = unwrap(createGameWithEvents(batchV49Input("batch-v49"), ctx)).state;
    while (state.setup) state = choose(state, ctx, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, ctx, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, ctx), ctx), ctx, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { mine: string[]; theirs?: string[]; spent?: string[]; rivalGigs?: number[]; spentEddies?: number; lag?: string[] };
/** Trusted arrangement on the actor's MAIN: `mine` and `theirs` on the field (ready unless listed in `spent`), the rival's Gig area
 * holding rolled Gigs of the given values and the actor's none, and `spentEddies` of the actor's 8 Eddies spent. */
function arrange(a: Arrangement, ctx = context, from = base) {
    assert.equal(from.timing.activePlayer, actor);
    const m = new TurnMutation(from, ctx), ids: Record<string, CardInstanceId> = {};
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = ctx.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = [];
        c.readiness = a.spent?.includes(cardId) ? "SPENT" : "READY"; if (a.lag?.includes(cardId)) c.statuses.push("LAG");
        ids[cardId] = c.id; return c.id;
    };
    for (const id of a.mine) rewrite(actor, id);
    for (const id of a.theirs ?? []) rewrite(rival, id);
    m.state.players[actor].zones.EDDIES.slice(0, a.spentEddies ?? 0).forEach(id => { m.state.objects.cards[id].readiness = "SPENT"; });
    const d = GameStateSchema.parse(m.state), gigs: GigInstanceId[] = [], values = [...(a.rivalGigs ?? [])];
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const value = g.ownerId === rival ? values.shift() : undefined;
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: value === undefined ? "FIXER" : "GIGS" };
        g.roll = value === undefined ? { kind: "UNROLLED" } : { kind: "ROLLED", initialValue: 1, currentValue: value };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (value !== undefined) gigs.push(g.id);
    }
    return { state: unwrap(validateState(d, ctx)), ids, gigs };
}
function pay(s: GameState) {
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10);
        const i = s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        s = choose(s, context, i >= 0 ? i : 0).state;
    }
    return s;
}
/** `attacker` attacks the rival's Gig area (stealing `gig` when there is a choice) and the rival passes React; then any trigger
 * choices take their first option. */
function steal(s: GameState, attacker: CardInstanceId, gig?: GigInstanceId) {
    let state = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).state;
    if (state.timing.step === "ATTACK_TARGET_SELECTION") state = pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    assert.equal(state.timing.step, "RIVAL_REACT");
    let r = take(state, context, a => a.action.kind === "PASS_REACT"); const events = [...r.events];
    while (r.state.resolution.choice) {
        const c = r.state.resolution.choice, i = gig && c.kind === "TARGET" && r.state.timing.step === "GIG_STEAL_SELECTION" ? c.options.findIndex(o => o.kind === "GIG" && o.gigInstanceId === gig) : 0;
        r = choose(r.state, context, Math.max(i, 0)); events.push(...r.events);
    }
    return { state: r.state, events };
}
const spentEddies = (s: GameState, p: PlayerId) => s.players[p].zones.EDDIES.filter(id => s.objects.cards[id].readiness === "SPENT").length;
const fired = (events: { payload: { kind: string; sourceId?: string } }[], source: CardInstanceId) => events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === source);
const activations = (s: GameState, id: CardInstanceId) => unwrap(listLegalActions(s, s.timing.actingPlayer, context)).filter(a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id);
const activate = (s: GameState, id: CardInstanceId) => pay(take(s, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id).state);
type Mutable = ReturnType<typeof GameStateSchema.parse>;
const power = (s: GameState, id: CardInstanceId) => new RulesView(s, context).getEffectivePower(id);

test("the V49 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(queen.provenance.sourceHash, hashCanonical(v49Source(queen.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === queen.id), [queen]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Rogue passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard]) assert.ok(gate(queen, context).ok);
    for (const gate of [supportsCall, supportsFieldLegend]) assert.equal(gate(queen, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(queen) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["main timing", d => { d.mechanics.abilities[1].activation!.timing = "MAIN"; }],
        ["cheaper", d => { d.mechanics.abilities[1].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }]; }],
        ["no spend", d => { d.mechanics.abilities[1].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }]; }],
        ["unscaled", d => { const e = d.mechanics.abilities[1].effects[0]; if (e.kind === "POWER_UNTIL_END_OF_TURN") delete e.scale; }],
        ["friendly target", d => { const e = d.mechanics.abilities[1].effects[0]; if (e.kind === "POWER_UNTIL_END_OF_TURN") e.target = { kind: "FRIENDLY_UNIT" }; }],
        ["any steal", d => { delete d.mechanics.abilities[0].guard; }],
        ["ready 1", d => { d.mechanics.abilities[0].effects = [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 1 }]; }],
        ["no trigger", d => { d.mechanics.abilities.shift(); }],
        ["condition", d => { d.mechanics.abilities[1].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["power", d => { d.power = 5; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 4 }; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }],
        ["tags", d => { d.tags = ["Fixer"]; }],
        ["Quick keyword", d => { d.mechanics.keywords = ["QUICK"]; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("as a reaction to a rival attack: pay 2, spend Rogue, and the attacker loses 4 power, so it loses the fight", () => {
    const a = arrange({ mine: [QUEEN, PSYCHO], theirs: [OCTANT], spent: [PSYCHO] }), q = a.ids[QUEEN], psycho = a.ids[PSYCHO], octant = a.ids[OCTANT];
    assert.equal(activations(a.state, q).length, 1, "Quick: also offered in its controller's own MAIN");
    let s = end(a.state, context).state;
    while (!(s.timing.step === "MAIN" && s.timing.activePlayer === rival)) s = take(s, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    s = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === octant).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === psycho).state;
    assert.equal(s.timing.step, "RIVAL_REACT");
    assert.equal(activations(s, q).length, 1, "Quick: offered in its controller's React Step");
    const eddies = spentEddies(s, actor);
    s = activate(s, q);
    assert.equal(s.objects.cards[q].readiness, "SPENT"); assert.equal(spentEddies(s, actor), eddies + 2);
    assert.equal(power(s, octant), 4);
    const m = s.temporaryModifiers?.find(x => x.targetId === octant);
    assert.ok(m && "scaled" in m && m.scaled === "SOURCE_POWER" && m.amount === -4 && m.sourceId === q);
    assert.equal(s.timing.step, "RIVAL_REACT", "the activation returns to the React Step");
    assert.equal(activations(s, q).length, 0, "spent: no second activation");
    while (!(s.timing.step === "MAIN" && s.timing.combat.stage === "NONE")) s = s.timing.step === "RIVAL_REACT" ? take(s, context, x => x.action.kind === "PASS_REACT").state : choose(s, context).state;
    assert.equal(s.objects.cards[octant].zone.zone, "TRASH"); assert.equal(s.objects.cards[psycho].zone.zone, "BATTLEFIELD");
    let next = end(s, context).state;
    while (next.timing.activePlayer !== actor || next.timing.step !== "MAIN") next = take(next, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE").state;
    assert.equal(next.temporaryModifiers, undefined, "this turn only");
});

test("in MAIN with two rival Units the controller chooses one; every pause validates and a forged choice is rejected", () => {
    const a = arrange({ mine: [QUEEN], theirs: [OCTANT, PSYCHO] }), q = a.ids[QUEEN];
    let s = take(a.state, context, x => x.action.kind === "ACTIVATE_ABILITY" && x.action.sourceInstanceId === q).state;
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(validateState(s, context).ok);
        const forged = GameStateSchema.parse(structuredClone(s)); forged.resolution.playContinuation!.remainingCost++; assert.equal(validateState(forged, context).ok, false);
        s = choose(s, context, s.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE")).state;
    }
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.equal(s.resolution.choice?.options.length, 2);
    assert.ok(validateState(s, context).ok);
    for (const edit of [(f: Mutable) => { f.resolution.choice!.options.pop(); }, (f: Mutable) => { f.objects.cards[q].readiness = "READY"; }, (f: Mutable) => { f.resolution.current!.effect = { kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -1 }; }]) {
        const forged = GameStateSchema.parse(structuredClone(s)); edit(forged); assert.equal(validateState(forged, context).ok, false);
    }
    s = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.ids[PSYCHO]).state;
    assert.equal(power(s, a.ids[PSYCHO]), 2); assert.equal(power(s, a.ids[OCTANT]), 8);
    assert.equal(s.timing.step, "MAIN");
});

test("no activation while lagging, spent or unable to pay; a readied Rogue activates again as a distinct occurrence", () => {
    const lag = arrange({ mine: [QUEEN], theirs: [OCTANT], lag: [QUEEN] }); assert.equal(activations(lag.state, lag.ids[QUEEN]).length, 0);
    const spent = arrange({ mine: [QUEEN], theirs: [OCTANT], spent: [QUEEN] }); assert.equal(activations(spent.state, spent.ids[QUEEN]).length, 0);
    const poor = arrange({ mine: [QUEEN], theirs: [OCTANT], spentEddies: 8 }), m = new TurnMutation(poor.state, context);
    for (const id of m.state.players[actor].zones.LEGENDS) m.state.objects.cards[id].readiness = "SPENT";
    assert.equal(activations(unwrap(validateState(m.state, context)), poor.ids[QUEEN]).length, 0);
    const a = arrange({ mine: [QUEEN], theirs: [OCTANT] }), q = a.ids[QUEEN], octant = a.ids[OCTANT];
    let s = activate(a.state, q); assert.equal(power(s, octant), 4);
    const again = new TurnMutation(s, context); again.state.objects.cards[q].readiness = "READY";
    s = activate(unwrap(validateState(again.state, context)), q);
    assert.equal(power(s, octant), 0); assert.equal(s.temporaryModifiers?.length, 2);
    const forged = GameStateSchema.parse(structuredClone(s)); forged.temporaryModifiers![1] = structuredClone(forged.temporaryModifiers![0]); assert.equal(validateState(forged, context).ok, false);
    const owner = GameStateSchema.parse(structuredClone(s)); owner.temporaryModifiers![0].targetId = q; assert.equal(validateState(owner, context).ok, false);
});

test("the first below-power steal by another friendly Unit readies 2 Eddies; a later one does not", () => {
    const a = arrange({ mine: [QUEEN, PSYCHO, ATLUS], rivalGigs: [3, 3], spentEddies: 4 }), q = a.ids[QUEEN];
    const first = steal(a.state, a.ids[PSYCHO], a.gigs[0]);
    assert.ok(fired(first.events, q)); assert.equal(spentEddies(first.state, actor), 2);
    assert.deepEqual(first.state.turnHistory?.belowPowerSteals?.[actor], [{ stealerId: a.ids[PSYCHO], gigInstanceId: a.gigs[0] }]);
    const second = steal(first.state, a.ids[ATLUS]);
    assert.equal(fired(second.events, q), false); assert.equal(spentEddies(second.state, actor), 2);
});

test("Rogue's own steal is not another Unit's: the next Unit's below-power steal is Rogue's first", () => {
    const a = arrange({ mine: [QUEEN, PSYCHO], rivalGigs: [3, 3], spentEddies: 3 }), q = a.ids[QUEEN];
    const own = steal(a.state, q, a.gigs[0]);
    assert.equal(fired(own.events, q), false); assert.equal(spentEddies(own.state, actor), 3);
    const other = steal(own.state, a.ids[PSYCHO]);
    assert.ok(fired(other.events, q)); assert.equal(spentEddies(other.state, actor), 1);
});

test("a steal of a Gig worth at least the stealer's power is not counted, so a later qualifying steal is the first", () => {
    const a = arrange({ mine: [QUEEN, ATLUS, PSYCHO], rivalGigs: [4, 4], spentEddies: 2 }), q = a.ids[QUEEN];
    const even = steal(a.state, a.ids[ATLUS], a.gigs[0]);
    assert.equal(fired(even.events, q), false); assert.equal(even.state.turnHistory?.belowPowerSteals, undefined);
    const below = steal(even.state, a.ids[PSYCHO]);
    assert.ok(fired(below.events, q)); assert.equal(spentEddies(below.state, actor), 0);
});

test("the history exists only with its reviewed reader and is checked", () => {
    const old = batchV48Context(), a = arrange({ mine: [PSYCHO], rivalGigs: [3] }, old, setup(old));
    let s = take(a.state, old, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[PSYCHO]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, old, o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA").state;
    s = take(s, old, x => x.action.kind === "PASS_REACT").state;
    assert.equal(s.turnHistory?.belowPowerSteals, undefined);
    const forged = GameStateSchema.parse(structuredClone(s)); forged.turnHistory!.belowPowerSteals = { [actor]: [{ stealerId: a.ids[PSYCHO], gigInstanceId: a.gigs[0] }] };
    assert.equal(validateState(forged, old).ok, false);
    const b = arrange({ mine: [QUEEN, PSYCHO], rivalGigs: [3] }), done = steal(b.state, b.ids[PSYCHO]);
    for (const edit of [(f: Mutable) => { f.turnHistory!.belowPowerSteals![actor].push(structuredClone(f.turnHistory!.belowPowerSteals![actor][0])); },
        (f: Mutable) => { f.turnHistory!.belowPowerSteals = { [rival]: f.turnHistory!.belowPowerSteals![actor] }; }]) {
        const bad = GameStateSchema.parse(structuredClone(done.state)); edit(bad); assert.equal(validateState(bad, context).ok, false);
    }
});

test("the reviewed union contains Rogue Amendiares: Queen of the Afterlife", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === QUEEN));
});
