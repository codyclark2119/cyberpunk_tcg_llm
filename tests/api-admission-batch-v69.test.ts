import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV69Cards, batchV69Context, batchV69Input, v69Source, NETDRIVER } from "./api-admission-batch-v69-fixture";
import { PADRE } from "./api-admission-batch-v62-fixture";
import { HANAKO } from "./api-admission-batch-v59-fixture";
import { reviewedUnionContext } from "./reviewed-union-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV69Context();
const netdriver = batchV69Cards[0];
const PSYCHO = "psycho-squad", NEGOTIATORS = "augmented-negotiators"; // A vanilla 6; a power-2 Blocker.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV69Input("batch-v69"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Placed = { player: PlayerId; cardId: string; readiness?: "READY" | "SPENT"; gear?: boolean };
/** Trusted arrangement on the actor's MAIN: each listed Unit on its player's field (a Netdriver attached with `gear`). */
function arrange(units: Placed[], s: GameState = base) {
    const m = new TurnMutation(s, context), ids: CardInstanceId[] = [], gears: CardInstanceId[] = [];
    const put = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    for (const u of units) {
        const host = put(u.player, u.cardId); host.readiness = u.readiness ?? "READY"; ids.push(host.id);
        if (u.gear) { const g = put(u.player, NETDRIVER); host.attachments = [g.id]; gears.push(g.id); }
    }
    return { state: unwrap(validateState(m.state, context)), ids, gears };
}
const hand = (s: GameState, p: PlayerId) => s.players[p].zones.HAND.length;
const fired = (events: { payload: { kind: string; sourceId?: string } }[], gear: CardInstanceId) => events.filter(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === gear).length;
/** Takes `first`, then the first option of every later choice until the actor's Main Phase is open again. */
function run(s: GameState, first: Parameters<typeof take>[2]) {
    let r = take(s, context, first); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice || r.state.timing.step === "RIVAL_REACT"; n++) {
        assert.ok(n < 20); assert.ok(validateState(r.state, context).ok);
        r = r.state.timing.step === "RIVAL_REACT" && !r.state.resolution.choice ? take(r.state, context, a => a.action.kind === "PASS_REACT") : choose(r.state, context, 0);
        events.push(...r.events);
    }
    return { state: r.state, events };
}

test("the V69 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(netdriver.provenance.sourceHash, hashCanonical(v69Source(netdriver.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === netdriver.id), [netdriver]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("NetWatch Netdriver passes only its exact pin; any changed field is rejected by every gate", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.ok(gate(netdriver, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(netdriver) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["draw 2", d => { d.mechanics.abilities[0].effects = [{ kind: "DRAW", count: 2 }]; }],
        ["own spend", d => { delete d.mechanics.abilities[0].inherited; }],
        ["on attack", d => { d.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("an attacking host is spent to declare, so its controller draws 1 in the attack's batch", () => {
    const a = arrange([{ player: actor, cardId: PSYCHO, gear: true }, { player: rival, cardId: PSYCHO, readiness: "SPENT" }]), before = hand(a.state, actor);
    const declared = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[0]);
    let s = declared.state; const events = [...declared.events];
    if (s.timing.step === "ATTACK_TARGET_SELECTION") { const r = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD"); s = r.state; events.push(...r.events); }
    assert.equal(fired(events, a.gears[0]), 1); assert.equal(hand(s, actor), before + 1); assert.equal(s.timing.step, "RIVAL_REACT");
});

test("a Blocker host is spent to block, so its controller draws 1", () => {
    const a = arrange([{ player: actor, cardId: PSYCHO }, { player: rival, cardId: PSYCHO, readiness: "SPENT" }, { player: rival, cardId: NEGOTIATORS, gear: true }]), before = hand(a.state, rival);
    let s = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[0]).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === a.ids[1]).state;
    const r = take(s, context, x => x.action.kind === "DECLARE_BLOCKER" && x.action.cardInstanceId === a.ids[2]);
    let t = r.state; const events = [...r.events];
    for (let n = 0; t.resolution.choice; n++) { assert.ok(n < 10); const c = choose(t, context, 0); t = c.state; events.push(...c.events); }
    assert.equal(fired(events, a.gears[0]), 1); assert.equal(hand(t, rival), before + 1);
});

test("a face-up Legend host that pays for a Call is spent, so its controller draws 1 after the Call", () => {
    const run1 = (gear: boolean) => {
        const d = GameStateSchema.parse(structuredClone(base)), p = d.players[actor], [payer, called] = p.zones.LEGENDS;
        for (const e of p.zones.EDDIES) d.objects.cards[e].readiness = "SPENT";
        for (const l of p.zones.LEGENDS) d.objects.cards[l].readiness = "SPENT";
        d.objects.cards[payer].face = "UP"; d.objects.cards[payer].readiness = "READY";
        const m = new TurnMutation(unwrap(validateState(d, context)), context);
        let gearId: CardInstanceId | undefined;
        if (gear) {
            const deck = m.state.players[actor].zones.DECK, g = m.state.objects.cards[deck[deck.length - 1]];
            g.cardId = netdriver.id; g.revision = netdriver.revision; moveCardLocation(m, g.id, "HAND"); moveCardLocation(m, g.id, "LEGENDS"); g.readiness = "READY"; g.statuses = [];
            m.state.objects.cards[payer].attachments = [g.id]; gearId = g.id;
        }
        const s = unwrap(validateState(m.state, context)), r = run(s, x => x.action.kind === "CALL_LEGEND" && x.action.cardInstanceId === called);
        assert.equal(r.state.objects.cards[payer].readiness, "SPENT"); assert.equal(r.state.objects.cards[called].face, "UP");
        return { hand: hand(r.state, actor), fired: gearId ? fired(r.events, gearId) : 0, step: r.state.timing.step };
    };
    const without = run1(false), withGear = run1(true);
    assert.equal(withGear.fired, 1); assert.equal(withGear.hand, without.hand + 1); assert.equal(withGear.step, "MAIN");
});

/** Trusted arrangement: every actor Eddie and Legend spent except the first Legend, face up and ready, with a Netdriver (or not);
 * optionally that Legend becomes `cardId`, each player's Gig area holds one Gig, and the actor holds `inHand`. */
function legendHost(gear: boolean, opts: { cardId?: string; gigs?: boolean; inHand?: string; unit?: boolean } = {}) {
    const d = GameStateSchema.parse(structuredClone(base)), p = d.players[actor], [host] = p.zones.LEGENDS;
    for (const e of p.zones.EDDIES) d.objects.cards[e].readiness = "SPENT";
    for (const l of p.zones.LEGENDS) d.objects.cards[l].readiness = "SPENT";
    d.objects.cards[host].face = "UP"; d.objects.cards[host].readiness = "READY";
    if (opts.cardId) { const r = context.content.cards.find(c => c.id === opts.cardId)!; d.objects.cards[host].cardId = r.id; d.objects.cards[host].revision = r.revision; }
    if (opts.gigs) {
        for (const pl of Object.values(d.players)) pl.gigs = { FIXER: [], GIGS: [] };
        const done = new Set<PlayerId>();
        for (const g of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
            const roll = g.dieType !== "D20" && !done.has(g.ownerId); if (roll) done.add(g.ownerId);
            g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: roll ? "GIGS" : "FIXER" };
            g.roll = roll ? { kind: "ROLLED", initialValue: 1, currentValue: g.ownerId === actor ? 2 : 3 } : { kind: "UNROLLED" };
            d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        }
    }
    const m = new TurnMutation(unwrap(validateState(d, context)), context), take1 = (cardId: string) => {
        const deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    let gearId: CardInstanceId | undefined, handId: CardInstanceId | undefined;
    if (gear) { const g = take1(NETDRIVER); moveCardLocation(m, g.id, "LEGENDS"); g.readiness = "READY"; g.statuses = []; m.state.objects.cards[host].attachments = [g.id]; gearId = g.id; }
    if (opts.unit) { const u = take1(PSYCHO); moveCardLocation(m, u.id, "BATTLEFIELD"); u.readiness = "READY"; u.statuses = []; }
    if (opts.inHand) handId = take1(opts.inHand).id;
    return { state: unwrap(validateState(m.state, context)), host, gearId, handId };
}

test("a face-up Legend host spent for its own {Spend} ability draws 1 after the ability resolves", () => {
    const go = (gear: boolean) => {
        const a = legendHost(gear, { cardId: HANAKO, gigs: true }), r = run(a.state, x => x.action.kind === "ACTIVATE_ABILITY" && x.action.sourceInstanceId === a.host);
        assert.equal(r.state.objects.cards[a.host].readiness, "SPENT");
        return { hand: hand(r.state, actor), fired: a.gearId ? fired(r.events, a.gearId) : 0, step: r.state.timing.step };
    };
    const without = go(false), withGear = go(true);
    assert.equal(withGear.fired, 1); assert.equal(withGear.hand, without.hand + 1); assert.equal(withGear.step, "MAIN");
});

test("a face-up Legend host that pays for a Gear play draws 1 in the play's batch", () => {
    const go = (gear: boolean) => {
        const a = legendHost(gear, { inHand: "mantis-blades", unit: true }), r = run(a.state, x => x.action.kind === "PLAY_CARD" && x.action.cardInstanceId === a.handId);
        assert.equal(r.state.objects.cards[a.host].readiness, "SPENT"); assert.equal(r.state.objects.cards[a.handId!].zone.zone === "HAND", false);
        return { hand: hand(r.state, actor), fired: a.gearId ? fired(r.events, a.gearId) : 0, step: r.state.timing.step };
    };
    const without = go(false), withGear = go(true);
    assert.equal(withGear.fired, 1); assert.equal(withGear.hand, without.hand + 1); assert.equal(withGear.step, "MAIN");
});

test("a face-up Legend host that pays for a Go Solo draws 1", () => {
    const go = (gear: boolean) => {
        const a = legendHost(gear), d = GameStateSchema.parse(structuredClone(a.state)), p = d.players[actor], solo = p.zones.LEGENDS[1], r0 = context.content.cards.find(c => c.id === "v-corporate-exile")!;
        d.objects.cards[solo].cardId = r0.id; d.objects.cards[solo].revision = r0.revision; d.objects.cards[solo].face = "UP"; d.objects.cards[solo].readiness = "READY";
        p.zones.EDDIES.slice(0, 4).forEach(e => { d.objects.cards[e].readiness = "READY"; });
        const r = run(unwrap(validateState(d, context)), x => x.action.kind === "GO_SOLO" && x.action.cardInstanceId === solo);
        assert.equal(r.state.objects.cards[a.host].readiness, "SPENT"); assert.equal(r.state.objects.cards[solo].zone.zone, "BATTLEFIELD");
        return { hand: hand(r.state, actor), fired: a.gearId ? fired(r.events, a.gearId) : 0, step: r.state.timing.step };
    };
    const without = go(false), withGear = go(true);
    assert.equal(withGear.fired, 1); assert.equal(withGear.hand, without.hand + 1); assert.equal(withGear.step, "MAIN");
});

test("a defending Legend host that pays for a Quick Program in React draws 1, and React reopens", () => {
    const go = (gear: boolean) => {
        const a = arrange([{ player: actor, cardId: PSYCHO }, { player: rival, cardId: PSYCHO, readiness: "SPENT" }]), d = GameStateSchema.parse(structuredClone(a.state)), p = d.players[rival], [host] = p.zones.LEGENDS;
        for (const e of p.zones.EDDIES) d.objects.cards[e].readiness = "SPENT";
        for (const l of p.zones.LEGENDS) d.objects.cards[l].readiness = "SPENT";
        d.objects.cards[host].face = "UP"; d.objects.cards[host].readiness = "READY";
        const m = new TurnMutation(unwrap(validateState(d, context)), context), take1 = (cardId: string) => {
            const deck = m.state.players[rival].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
            c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
        };
        let gearId: CardInstanceId | undefined;
        if (gear) { const g = take1(NETDRIVER); moveCardLocation(m, g.id, "LEGENDS"); g.readiness = "READY"; g.statuses = []; m.state.objects.cards[host].attachments = [g.id]; gearId = g.id; }
        const floor = take1("floor-it").id;
        let s = take(unwrap(validateState(m.state, context)), context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.ids[0]).state;
        if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD").state;
        let r = take(s, context, x => x.action.kind === "PLAY_CARD" && x.action.cardInstanceId === floor); const events = [...r.events];
        for (let n = 0; r.state.resolution.choice; n++) { assert.ok(n < 10); assert.ok(validateState(r.state, context).ok); r = choose(r.state, context, 0); events.push(...r.events); }
        assert.equal(r.state.objects.cards[host].readiness, "SPENT"); assert.equal(r.state.timing.step, "RIVAL_REACT");
        return { hand: hand(r.state, rival), fired: gearId ? fired(events, gearId) : 0 };
    };
    const without = go(false), withGear = go(true);
    assert.equal(withGear.fired, 1); assert.equal(withGear.hand, without.hand + 1);
});

test("a rival host spent by an effect makes its controller draw 1 as the action ends", () => {
    const a = arrange([{ player: rival, cardId: PSYCHO, gear: true }]), d = GameStateSchema.parse(structuredClone(a.state)), zone = d.players[actor].zones.LEGENDS, padreId = zone[zone.length - 1];
    const padre = context.content.cards.find(c => c.id === PADRE)!; d.objects.cards[padreId].cardId = padre.id; d.objects.cards[padreId].revision = padre.revision; d.objects.cards[padreId].face = "DOWN"; d.objects.cards[padreId].readiness = "READY";
    const s0 = unwrap(validateState(d, context)), before = hand(s0, rival);
    let r = take(s0, context, x => x.action.kind === "CALL_LEGEND" && x.action.cardInstanceId === padreId); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 10); r = choose(r.state, context, 0); events.push(...r.events); }
    const t = pick(r.state, context, x => x.kind === "MODE" && x.mode === "SPEND_UNIT"); events.push(...t.events);
    assert.equal(t.state.objects.cards[a.ids[0]].readiness, "SPENT"); assert.equal(fired(events, a.gears[0]), 1);
    assert.equal(hand(t.state, rival), before + 1); assert.equal(t.state.timing.step, "MAIN"); assert.equal(t.state.timing.actingPlayer, actor);
});

test("a host already spent is not spent again, so nothing triggers", () => {
    const a = arrange([{ player: actor, cardId: PSYCHO, readiness: "SPENT", gear: true }]);
    assert.equal(a.state.turnHistory?.spendTriggers, undefined, "entering spent is not being spent");
});

test("the reviewed union contains NetWatch Netdriver", () => {
    assert.ok(reviewedUnionContext().content.cards.some(c => c.id === NETDRIVER));
});
