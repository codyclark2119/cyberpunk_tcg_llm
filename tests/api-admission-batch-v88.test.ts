import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type GigInstanceId, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV88Cards, batchV88Context, batchV88Input, v88Source, MEREDITH } from "./api-admission-batch-v88-fixture";
import { pick, playCard, resolveIndustrial } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV88Context();
const [meredith] = batchV88Cards;
const INDUSTRIAL = "industrial-assembly", DEXTER = "dexter-deshawn-one-last-chance", MAXTAC = "maxtac-av", SQUAD = "psycho-squad", EXILE = "v-corporate-exile", FILLER = "emergency-atlus";
// A Program that increases any Gig by up to 4; a Unit whose {Play} adjusts any Gig by up to 1; a Unit whose {Play} may swap Gigs; a
// power-6 Unit; a {Go Solo} Legend with power 8; a vanilla Unit (trash filler).
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV88Input("batch-v88"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { owner?: PlayerId; readiness?: "READY" | "SPENT"; trash?: number; hand?: string[]; legend?: boolean };
/** Trusted arrangement on the actor's MAIN: Meredith Stout on `owner`'s field (default the rival's, ready), `trash` vanilla Units in
 * that player's trash (default 2), `hand` in the actor's hand; each player's d6 and d8 rolled at 2 in their Gig area, every other Gig
 * unrolled in the fixer area; with `legend`, the actor's first Legend is a face-up V: Corporate Exile. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), owner = a.owner ?? rival;
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    const unit = rewrite(owner, MEREDITH); moveCardLocation(m, unit.id, "BATTLEFIELD"); unit.readiness = a.readiness ?? "READY"; unit.statuses = [];
    const trash: CardInstanceId[] = [];
    for (let i = 0; i < (a.trash ?? 2); i++) { const c = rewrite(owner, FILLER); moveCardLocation(m, c.id, "TRASH"); trash.push(c.id); }
    for (const id of a.hand ?? []) rewrite(actor, id);
    const d = GameStateSchema.parse(m.state), gigs: Record<PlayerId, GigInstanceId[]> = { [actor]: [], [rival]: [] };
    for (const p of Object.values(d.players)) p.gigs = { FIXER: [], GIGS: [] };
    for (const g of Object.values(d.objects.gigs).sort((x, y) => x.id < y.id ? -1 : 1)) {
        const rolled = g.dieType === "D6" || g.dieType === "D8";
        g.controllerId = g.ownerId; g.location = { playerId: g.ownerId, zone: rolled ? "GIGS" : "FIXER" };
        g.roll = rolled ? { kind: "ROLLED", initialValue: 2, currentValue: 2 } : { kind: "UNROLLED" };
        d.players[g.ownerId].gigs[g.location.zone].push(g.id);
        if (rolled) gigs[g.ownerId].push(g.id);
    }
    let legend: CardInstanceId | undefined;
    if (a.legend) { legend = d.players[actor].zones.LEGENDS[0]; const l = d.objects.cards[legend], r = context.content.cards.find(x => x.id === EXILE)!; l.cardId = r.id; l.revision = r.revision; l.face = "UP"; l.readiness = "READY"; }
    return { state: unwrap(validateState(d, context)), meredith: unit.id, trash, gigs, legend };
}
const labels = (s: GameState) => actions(s, context).map(x => x.descriptor.label).sort();
const hand = (s: GameState, p: PlayerId) => s.players[p].zones.HAND;
const offered = (s: GameState) => s.resolution.current?.effect.kind === "MAY_RETURN_TRASH_CARD_TO_HAND" && s.resolution.choice?.kind === "TARGET";
/** Takes the first option of every choice that is not the trash return, until the trash return or the Main Phase. */
function settle(s: GameState) {
    let state = s; const events = [];
    for (let n = 0; !offered(state) && !(state.timing.step === "MAIN" && !state.resolution.choice); n++) {
        assert.ok(n < 20);
        const r = state.resolution.choice?.kind === "PAYMENT" ? pick(state, context, o => o.kind === "PAYMENT") : choose(state, context, 0);
        state = r.state; events.push(...r.events);
    }
    return { state, events };
}
/** Resolves Industrial Assembly on `target` by `amount`, then settles; with every event. */
function industrial(s: GameState, target: GigInstanceId, amount: number) {
    const played = resolveIndustrial(s, context, target, amount), settled = settle(played.state);
    return { state: settled.state, events: [...played.events, ...settled.events] };
}
/** Plays a Unit from the actor's hand, paying with Eddies, up to its first non-payment choice. */
const playUnit = (s: GameState, cardId: string) => playCard(s, context, cardId);

test("the V88 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(meredith.provenance.sourceHash, hashCanonical(v88Source(meredith.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === meredith.id), [meredith]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Meredith Stout passes only her exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsTriggerCard]) assert.ok(gate(meredith, context).ok);
    assert.equal(supportsSpendTriggerCard(meredith, context).ok, false, "the spend table does not admit her");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(meredith) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no Blocker", d => { d.mechanics.keywords = []; }],
        ["no Legend power", d => { d.mechanics.modifiers = []; }],
        ["a Unit's trash only", d => { d.mechanics.abilities[0].effects = [{ kind: "RETURN_TRASH_UNIT_TO_HAND", exclude: "SUBJECT" }]; }],
        ["on spend", d => { d.mechanics.abilities[0].trigger = "WHEN_SPENT"; }],
        ["power 6", d => { d.power = 6; }],
        ["tags", d => { d.tags = ["Corpo"]; }],
        ["sellable", d => { d.sellProfile = { allowed: true, baseEddieValue: 1 }; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("a Rival's Program increases her controller's Gig: after it, she may add any card from the trash to hand", () => {
    const a = arrange({ hand: [INDUSTRIAL] }), s = industrial(a.state, a.gigs[rival][0], 1).state;
    assert.ok(offered(s)); assert.ok(validateState(s, context).ok);
    assert.equal(s.resolution.triggerContinuation?.origin.kind, "GIG_CHANGE");
    assert.equal(s.timing.activePlayer, actor); assert.equal(s.timing.actingPlayer, rival);
    assert.deepEqual(labels(s), ["Add no card", ...a.trash.map(id => `Add Emergency Atlus (${id}) from your trash to your hand`)].sort());
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.trash[1]).state;
    assert.ok(hand(done, rival).includes(a.trash[1])); assert.equal(done.objects.cards[a.trash[1]].zone.zone, "HAND");
    assert.equal(done.timing.step, "MAIN"); assert.equal(done.timing.actingPlayer, actor); assert.equal(done.turnHistory?.gigChangeTriggers, undefined);
    const declined = pick(s, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED")); assert.deepEqual(hand(declined.state, rival), hand(s, rival));
});

test("her controller's own adjust, a Rival's adjust of a Gig that is not hers, or a declined adjust triggers nothing", () => {
    for (const [a, gig, amount] of [[arrange({ owner: actor, hand: [INDUSTRIAL] }), "own", 1], [arrange({ hand: [INDUSTRIAL] }), "actor", 1], [arrange({ hand: [INDUSTRIAL] }), "rival", 0]] as const) {
        const target = gig === "rival" ? a.gigs[rival][0] : a.gigs[actor][0];
        const r = industrial(a.state, target, amount);
        assert.equal(offered(r.state), false); assert.equal(r.state.timing.step, "MAIN");
        assert.equal(r.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.meredith), false);
    }
});

test("an empty trash resolves the trigger without a choice", () => {
    const a = arrange({ trash: 0, hand: [INDUSTRIAL] }), r = industrial(a.state, a.gigs[rival][0], 1);
    assert.equal(offered(r.state), false); assert.equal(r.state.timing.step, "MAIN");
    assert.ok(r.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.meredith), "the trigger still went pending");
});

test("a Rival's {Play} adjust joins its trigger batch, and she resolves after the Rival's own effects", () => {
    const a = arrange({ hand: [DEXTER] }), played = playUnit(a.state, DEXTER).state;
    const target = pick(played, context, o => o.kind === "GIG" && o.gigInstanceId === a.gigs[rival][0]).state;
    const r = pick(target, context, o => o.kind === "MODE" && o.mode === "INCREASE_1"), s = settle(r.state).state;
    assert.ok(r.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === a.meredith));
    assert.ok(offered(s)); assert.ok(validateState(s, context).ok);
    assert.equal(s.resolution.triggerContinuation?.origin.kind, "PLAY"); assert.deepEqual(s.resolution.triggerContinuation?.effectGigChanges, [a.meredith]);
    const done = pick(s, context, o => o.kind === "CARD").state;
    assert.equal(done.timing.step, "MAIN"); assert.equal(done.timing.actingPlayer, actor);
});

test("a Rival's swap triggers her; her controller's own swap does not", () => {
    for (const owner of [rival, actor]) {
        const a = arrange({ owner, hand: [MAXTAC] }), played = playUnit(a.state, MAXTAC).state;
        let s = pick(played, context, o => o.kind === "CONFIRM" && o.confirmed).state;
        s = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === a.gigs[actor][0]).state;
        const r = pick(s, context, o => o.kind === "GIG" && o.gigInstanceId === a.gigs[rival][0]), settled = settle(r.state).state;
        assert.ok(r.events.some(e => e.payload.kind === "GIGS_SWAPPED"));
        assert.equal(offered(settled), owner === rival, owner);
    }
});

test("she has +2 power while fighting a Legend, and only then", () => {
    const fight = (s: GameState, attacker: CardInstanceId) => {
        let state = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === attacker).state; const events = [];
        for (let n = 0; !(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE"); n++) {
            assert.ok(n < 20);
            const r = state.timing.step === "RIVAL_REACT" && !state.resolution.choice ? take(state, context, x => x.action.kind === "PASS_REACT")
                : state.resolution.choice?.kind === "TARGET" && state.resolution.choice.options.some(o => o.kind === "ATTACK_TARGET") ? pick(state, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD") : choose(state, context, 0);
            state = r.state; events.push(...r.events);
        }
        return events.find(e => e.payload.kind === "FIGHT_RESULT")!.payload as { defenderId: string; defenderPower: number };
    };
    const a = arrange({ readiness: "SPENT", legend: true }), solo = take(a.state, context, x => x.action.kind === "GO_SOLO" && x.action.cardInstanceId === a.legend);
    let s = solo.state;
    for (let n = 0; s.resolution.choice?.kind === "PAYMENT"; n++) { assert.ok(n < 20); s = pick(s, context, o => o.kind === "PAYMENT").state; }
    const versusLegend = fight(s, a.legend!);
    assert.equal(versusLegend.defenderId, a.meredith); assert.equal(versusLegend.defenderPower, 7);
    const m = new TurnMutation(arrange({ readiness: "SPENT" }).state, context), deck = m.state.players[actor].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === SQUAD)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = [];
    const versusUnit = fight(unwrap(validateState(GameStateSchema.parse(m.state), context)), c.id);
    assert.equal(versusUnit.defenderPower, 5);
});

test("queued and joined Rival-change bindings are validated", () => {
    const a = arrange({ hand: [INDUSTRIAL] }), s = industrial(a.state, a.gigs[rival][0], 1).state;
    const tamper = (edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(s); edit(d); return validateState(d, context).ok; };
    assert.ok(tamper(() => undefined));
    assert.equal(tamper(d => { delete d.resolution.triggerContinuation!.bindings[0].changeEffectId; }), false, "the changing effect is named");
    assert.equal(tamper(d => { const c = d.resolution.triggerContinuation!; if (c.origin.kind === "GIG_CHANGE") c.origin.subjectIds = [a.trash[0]]; }), false, "the origin names the observer");
    assert.equal(tamper(d => { d.turnHistory!.gigChangeTriggers = [...d.resolution.triggerContinuation!.bindings]; }), false, "no queue beside a batch");
});
