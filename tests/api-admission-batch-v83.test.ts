import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsModalProgram } from "../packages/engine/src/modal-program-support";
import { playPaymentAmount } from "../packages/engine/src/play-cost-support";
import { legendEntryAmount } from "../packages/engine/src/legend-entry";
import { isAttackEligible } from "../packages/engine/src/combat-queries";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV83Cards, batchV83Context, batchV83Input, v83Source, NOCTURNE } from "./api-admission-batch-v83-fixture";
import { pick, playCard } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV83Context();
const [nocturne] = batchV83Cards;
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad", EXILE = "v-corporate-exile"; // Vanilla Units of power 4 and 6; a cost-5 {Go Solo} Legend.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV83Input("batch-v83"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { emptyFixer?: boolean; mine?: string[]; theirs?: string[]; exile?: boolean };
/** Trusted arrangement on the actor's MAIN: Nocturne in hand; `mine` and `theirs` ready on each field without Lag; with `emptyFixer`, every
 * actor die rolled (value 2) into the Gig area; with `exile`, V: Corporate Exile as the actor's last Legend, face up and ready. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context), mine: CardInstanceId[] = [], theirs: CardInstanceId[] = [];
    const rewrite = (player: PlayerId, cardId: string) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); return c;
    };
    rewrite(actor, NOCTURNE);
    for (const [player, list, ids] of [[actor, a.mine ?? [], mine], [rival, a.theirs ?? [], theirs]] as const)
        for (const cardId of list) { const c = rewrite(player, cardId); moveCardLocation(m, c.id, "BATTLEFIELD"); c.readiness = "READY"; c.statuses = []; ids.push(c.id); }
    const d = GameStateSchema.parse(m.state);
    if (a.emptyFixer)
        for (const g of Object.values(d.objects.gigs).filter(g => g.ownerId === actor && g.location.zone === "FIXER")) {
            const from = d.players[actor].gigs.FIXER; from.splice(from.indexOf(g.id), 1);
            g.location = { playerId: actor, zone: "GIGS" }; g.roll = { kind: "ROLLED", initialValue: 2, currentValue: 2 }; d.players[actor].gigs.GIGS.push(g.id);
        }
    const legends = d.players[actor].zones.LEGENDS, exile = d.objects.cards[legends[legends.length - 1]];
    if (a.exile) { const r = context.content.cards.find(x => x.id === EXILE)!; exile.cardId = r.id; exile.revision = r.revision; exile.face = "UP"; exile.readiness = "READY"; }
    return { state: unwrap(validateState(d, context)), mine, theirs, exileId: exile.id };
}
const handId = (s: GameState) => s.players[actor].zones.HAND.find(id => s.objects.cards[id].cardId === NOCTURNE)!;
const play = (s: GameState) => playCard(s, context, NOCTURNE);
const mode = (s: GameState, kind: string) => pick(s, context, o => o.kind === "MODE" && o.mode === kind);
const paid = (events: { payload: { kind: string } }[]) => events.flatMap(e => e.payload.kind === "PAYMENT_MADE" ? (e.payload as unknown as { sources: unknown[] }).sources : []).length;
/** Ends the current turn and plays the next one up to its MAIN (rolling its Gig and taking first choices). */
function nextMain(s: GameState) {
    let r = take(s, context, x => x.action.kind === "END_TURN"); const events = [...r.events];
    while (r.state.timing.step !== "MAIN") { r = take(r.state, context, x => x.action.kind === "ROLL_GIG" || x.action.kind === "CHOOSE"); events.push(...r.events); }
    return { state: r.state, events };
}

test("the V83 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(nocturne.provenance.sourceHash, hashCanonical(v83Source(nocturne.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === nocturne.id), [nocturne]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Nocturne Op55 N1 passes only its exact pin; any changed field is rejected, and no other gate reads it", () => {
    assert.ok(supportsModalProgram(nocturne, context).ok); assert.ok(supportsPlay(nocturne, context).ok);
    assert.equal(supportsTriggerCard(nocturne, context).ok, false);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(nocturne) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["no alternative cost", d => { d.mechanics.modifiers = []; }],
        ["a both-instead condition", d => { d.mechanics.abilities[0].choose = { count: 1, allInstead: { kind: "STREET_CRED_LESS_THAN_RIVAL" } }; }],
        ["two modes", d => { d.mechanics.abilities[0].effects.pop(); }],
        ["modes reordered", d => { d.mechanics.abilities[0].effects.reverse(); }],
        ["cost", d => { d.printedCost = { kind: "EDDIES", amount: 2 }; }],
        ["tags", d => { d.tags = ["Plan"]; }]
    ];
    for (const [label, edit] of forgeries) assert.equal(supportsPlay(forge(edit), context).ok, false, label);
});

test("it costs 3, or 1 with an empty fixer area; the mode is always chosen", () => {
    for (const [emptyFixer, cost] of [[false, 3], [true, 1]] as const) {
        const a = arrange({ emptyFixer });
        assert.equal(playPaymentAmount(a.state, actor, handId(a.state), context), cost);
        const r = play(a.state);
        assert.equal(paid(r.events), cost, String(emptyFixer));
        assert.equal(r.state.resolution.choice!.kind, "MODE");
        assert.deepEqual(actions(r.state, context).map(x => x.descriptor.label).sort(), ["A Unit can't attack until your next turn", "A friendly Legend may use Go Solo for -2 this turn, to a minimum of 1", "Draw 2"]);
    }
});

test("Draw 2", () => {
    const a = arrange(), r = play(a.state), hand = r.state.players[actor].zones.HAND.length, done = mode(r.state, "DRAW");
    assert.equal(done.state.players[actor].zones.HAND.length, hand + 2);
    assert.equal(done.state.timing.step, "MAIN");
});

test("a rival Unit locked by the attack mode can't attack in the Rival's turn; the lock ends at the controller's next turn", () => {
    const a = arrange({ mine: [ATLUS], theirs: [PSYCHO, ATLUS] }), [locked, free] = a.theirs, r = mode(play(a.state).state, "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN");
    assert.deepEqual(r.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [...a.mine, ...a.theirs].sort(), "either player's Units");
    const done = pick(r.state, context, o => o.kind === "CARD" && o.cardInstanceId === locked);
    assert.ok(done.events.some(e => e.payload.kind === "ATTACK_LOCKED" && e.payload.lock.targetId === locked));
    assert.equal(done.state.timing.step, "MAIN");
    const d = GameStateSchema.parse(done.state); d.objects.cards[a.mine[0]].readiness = "SPENT"; // A spent friendly Unit for the Rival to attack.
    const theirTurn = nextMain(unwrap(validateState(d, context))).state;
    assert.equal(theirTurn.timing.activePlayer, rival);
    assert.equal(isAttackEligible(theirTurn, rival, locked, context), false);
    assert.ok(isAttackEligible(theirTurn, rival, free, context), "the other Unit still attacks");
    const back = nextMain(theirTurn);
    assert.ok(back.events.some(e => e.payload.kind === "ATTACK_LOCK_EXPIRED" && e.payload.targetId === locked && e.payload.reason === "NEXT_TURN"));
    assert.equal(back.state.attackLocks, undefined);
});

test("a lone Unit is locked without a choice, and a locked friendly Unit can't attack this turn", () => {
    const a = arrange({ mine: [ATLUS] }), [unit] = a.mine, d = GameStateSchema.parse(a.state);
    const r = mode(play(unwrap(validateState(d, context))).state, "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN");
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === unit && e.payload.forced));
    assert.equal(isAttackEligible(r.state, actor, unit, context), false);
    assert.equal(actions(r.state, context).some(x => x.action.kind === "DECLARE_ATTACK"), false);
    assert.equal(r.state.timing.step, "MAIN");
    const none = mode(play(arrange().state).state, "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN");
    assert.equal(none.state.attackLocks, undefined, "no Unit: nothing happens");
});

test("the Go Solo mode makes the next friendly Go Solo this turn cost 2 less", () => {
    const a = arrange({ exile: true });
    assert.equal(legendEntryAmount(a.state, actor, a.exileId, "GO_SOLO", context), 5);
    const r = mode(play(a.state).state, "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN");
    assert.ok(r.events.some(e => e.payload.kind === "GO_SOLO_DISCOUNT_GRANTED"));
    assert.equal(legendEntryAmount(r.state, actor, a.exileId, "GO_SOLO", context), 3);
    let s = take(r.state, context, x => x.action.kind === "GO_SOLO" && x.action.cardInstanceId === a.exileId); const events = [...s.events];
    while (s.state.resolution.choice?.kind === "PAYMENT") { s = pick(s.state, context, o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); events.push(...s.events); }
    assert.equal(paid(events), 3);
    assert.ok(events.some(e => e.payload.kind === "GO_SOLO_DISCOUNT_USED" && e.payload.cardInstanceId === a.exileId));
    assert.equal(s.state.turnHistory?.goSoloDiscounts, undefined);
    assert.equal(s.state.objects.cards[a.exileId].zone.zone, "BATTLEFIELD");
});

test("locks and discounts are validated", () => {
    const a = arrange({ mine: [ATLUS] }), locked = mode(play(a.state).state, "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN").state;
    const tamper = (s: GameState, edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(s); edit(d); return validateState(d, context).ok; };
    assert.ok(tamper(locked, () => undefined));
    assert.equal(tamper(locked, d => { d.attackLocks![0].lockingPlayerId = rival; }), false, "another locking player");
    assert.equal(tamper(locked, d => { d.attackLocks![0].sourceId = a.mine[0]; }), false, "not the Program");
    assert.equal(tamper(locked, d => { d.attackLocks![0].createdTurn = d.timing.turn + 1; }), false, "from the future");
    const granted = mode(play(arrange().state).state, "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN").state;
    assert.equal(tamper(granted, d => { d.turnHistory!.goSoloDiscounts = [d.turnHistory!.goSoloDiscounts![0], d.turnHistory!.goSoloDiscounts![0]]; }), false, "a duplicate grant");
});
