import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsFreeCallUnit } from "../packages/engine/src/free-call-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV85Cards, batchV85Context, batchV85Input, v85Source, REVERIE } from "./api-admission-batch-v85-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV85Context();
const [reverie] = batchV85Cards;
const ATLUS = "emergency-atlus", DRAW = "dev-legend-red"; // A vanilla Unit; a Legend whose {Call} draws 1.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV85Input("batch-v85"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { mine?: number; theirs?: number; gig?: number; called?: boolean };
/** Trusted arrangement on the actor's MAIN: Chrome Reverie in hand; `mine` and `theirs` ready Emergency Atlus on each field (default 1
 * each); every actor Gig rolled at `gig` (default 1, a min Gig) in the Gig area; the actor's Legends all face-down Draw-1 Legends; with
 * `called`, the turn's Call is already used. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), mine: CardInstanceId[] = [], theirs: CardInstanceId[] = [];
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(actor, REVERIE);
    for (const [player, count, ids] of [[actor, a.mine ?? 1, mine], [rival, a.theirs ?? 1, theirs]] as const)
        for (let i = 0; i < count; i++) { const c = rewrite(player, ATLUS); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = []; ids.push(c.id); }
    const d = GameStateSchema.parse(m.state), value = a.gig ?? 1;
    for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === actor && (g.location.zone === "FIXER" || g.location.zone === "GIGS"))) {
        if (g.location.zone === "FIXER") { const from = d.players[actor].gigs.FIXER; from.splice(from.indexOf(g.id), 1); g.location = { playerId: actor, zone: "GIGS" }; d.players[actor].gigs.GIGS.push(g.id); }
        g.roll = { kind: "ROLLED", initialValue: value, currentValue: value };
    }
    const legends = d.players[actor].zones.LEGENDS, r = context.content.cards.find(x => x.id === DRAW)!;
    for (const id of legends) { const l = d.objects.cards[id]; l.cardId = r.id; l.revision = r.revision; l.face = "DOWN"; }
    if (a.called) d.players[actor].economy.callsThisTurn = 1;
    return { state: unwrap(validateState(d, context)), mine, theirs, legends: [...legends] };
}
const labels = (s: GameState) => actions(s, context).map(x => x.descriptor.label);
const hand = (s: GameState) => s.players[actor].zones.HAND.length;
const play = (s: GameState) => playCard(s, context, REVERIE);
const lockedIds = (s: GameState) => (s.attackLocks ?? []).map(x => x.targetId);

test("the V85 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(reverie.provenance.sourceHash, hashCanonical(v85Source(reverie.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === reverie.id), [reverie]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Chrome Reverie passes only its exact pin; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsFreeCallUnit]) assert.ok(gate(reverie, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(reverie) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any Unit", d => { d.mechanics.abilities[0].effects[0] = { kind: "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN" }; }],
        ["unconditional Call", d => { d.mechanics.abilities[0].effects[1] = { kind: "MAY_CALL_LEGEND_FREE" }; }],
        ["d4 only", d => { d.mechanics.abilities[0].effects[1] = { kind: "MAY_CALL_LEGEND_FREE", condition: { kind: "FRIENDLY_GIG_IS_MIN", dieType: "D4" } }; }],
        ["reordered", d => { d.mechanics.abilities[0].effects.reverse(); }],
        ["modal", d => { d.mechanics.abilities[0].choose = { count: 1 }; }],
        ["cost 2", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["trigger scope", d => { d.execution = { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" }; }],
        ["tags", d => { d.tags = ["Plan"]; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsFreeCallUnit]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("a lone rival Unit is locked without a choice; with a min Gig the free Call is offered and its {Call} resolves after the Program", () => {
    const a = arrange(), r = play(a.state), s = r.state, before = hand(s);
    assert.deepEqual(lockedIds(s), a.theirs, "only the rival Unit can be locked");
    assert.ok(r.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === true));
    assert.deepEqual(labels(s).sort(), ["Call no Legend", ...a.legends.map((_, i) => `Call face-down Legend ${i + 1} for free`)].sort());
    const called = pick(s, context, o => o.kind === "LEGEND_SLOT" && o.slot === 2);
    assert.equal(called.state.objects.cards[a.legends[2]].face, "UP"); assert.equal(called.state.players[actor].economy.callsThisTurn, 1);
    assert.equal(called.events.some(e => e.payload.kind === "PAYMENT_MADE"), false);
    assert.equal(hand(called.state), before + 1, "the Legend's {Call} drew 1");
    assert.equal(called.state.players[actor].zones.TRASH.some(id => called.state.objects.cards[id].cardId === REVERIE), true);
    assert.equal(called.state.timing.step, "MAIN");
});

test("with two rival Units the controller chooses one; friendly Units are not offered", () => {
    const a = arrange({ mine: 2, theirs: 2 }), s = play(a.state).state;
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [...a.theirs].sort());
    const locked = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.theirs[1]).state;
    assert.deepEqual(lockedIds(locked), [a.theirs[1]]);
    assert.equal(locked.resolution.choice?.kind, "TARGET", "then the free Call");
    const declined = pick(locked, context, o => o.kind === "CONFIRM" && !o.confirmed);
    assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
    assert.equal(declined.state.players[actor].economy.callsThisTurn, 0); assert.equal(declined.state.timing.step, "MAIN");
});

test("without a min Gig, with the turn's Call used, or with no rival Unit, nothing more is offered", () => {
    const noMin = play(arrange({ gig: 2 }).state);
    assert.ok(noMin.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met === false));
    for (const r of [noMin, play(arrange({ called: true }).state)]) {
        assert.equal(r.state.resolution.choice, null); assert.equal(r.events.some(e => e.payload.kind === "LEGEND_CALLED"), false);
        assert.equal(r.state.timing.step, "MAIN");
    }
    const empty = arrange({ theirs: 0 }), r = play(empty.state);
    assert.deepEqual(lockedIds(r.state), []); assert.equal(r.state.resolution.choice?.kind, "TARGET", "the Call is still offered");
});

test("a paused free Call is validated", () => {
    const s = play(arrange().state).state;
    const tamper = (edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(s); edit(d); return validateState(d, context).ok; };
    assert.ok(tamper(() => undefined));
    assert.equal(tamper(d => { for (const g of Object.values(d.objects.gigs)) if (g.roll.kind === "ROLLED" && g.controllerId === actor) g.roll = { ...g.roll, currentValue: 2 }; }), false, "no min Gig");
    assert.equal(tamper(d => { d.players[actor].economy.callsThisTurn = 1; }), false, "the turn's Call used");
    assert.equal(tamper(d => { d.attackLocks![0].targetId = arrange().mine[0]; }), false, "a friendly Unit locked by a rival-only lock");
});
