import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsLegendSpendCard } from "../packages/engine/src/legend-spend-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { effectivePower } from "../packages/engine/src/characteristics";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV76Cards, batchV76Context, batchV76Input, v76Source } from "./api-admission-batch-v76-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, end, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV76Context();
const [judy] = batchV76Cards;
const ATLUS = "emergency-atlus", PSYCHO = "psycho-squad", BOOTLEG = "bootleg-black-sapphire-show", BONNIE = "bonnie-and-clyde", DEXTER = "dexter-deshawn-one-last-chance", TRUST = "peace-offering";
const OTHER_PROGRAM = "appetite-for-destruction"; // A non-BRAINDANCE Program with no choices.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV76Input("batch-v76"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(fund(clearField(state, context), context), context, state.match.playerOrder.find(p => p !== state.timing.activePlayer));
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { mine?: string[]; theirs?: string[]; hand?: string[]; top?: string; face?: "UP" | "DOWN"; emptyDeck?: boolean };
/** Trusted arrangement on the actor's MAIN: Judy as the actor's last Legend (face up and ready unless `face` says otherwise), `mine` and
 * `theirs` ready on each field, `hand` added to the actor's hand, and `top` (when given) as the top card of the actor's deck. */
function arrange(a: Arrangement) {
    const m = new TurnMutation(base, context), units: CardInstanceId[] = [], others: CardInstanceId[] = [], cards: CardInstanceId[] = [];
    const identify = (id: CardInstanceId, cardId: string) => { const c = m.state.objects.cards[id], r = context.content.cards.find(x => x.id === cardId)!; c.cardId = r.id; c.revision = r.revision; return c; };
    const put = (player: PlayerId, cardId: string, zone: "BATTLEFIELD" | "HAND") => {
        const deck = m.state.players[player].zones.DECK, c = identify(deck[deck.length - 1], cardId);
        moveCardLocation(m, c.id, "HAND"); if (zone === "BATTLEFIELD") { moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; }
        return c;
    };
    for (const id of a.mine ?? []) units.push(put(actor, id, "BATTLEFIELD").id);
    for (const id of a.theirs ?? []) others.push(put(rival, id, "BATTLEFIELD").id);
    for (const id of a.hand ?? []) cards.push(put(actor, id, "HAND").id);
    if (a.top) identify(m.state.players[actor].zones.DECK[0], a.top);
    if (a.emptyDeck) for (const id of [...m.state.players[actor].zones.DECK]) moveCardLocation(m, id, "TRASH");
    const d = GameStateSchema.parse(m.state), legends = d.players[actor].zones.LEGENDS, l = d.objects.cards[legends[legends.length - 1]];
    l.cardId = judy.id; l.revision = judy.revision; l.face = a.face ?? "UP"; l.readiness = "READY";
    return { state: unwrap(validateState(d, context)), units, others, cards, judy: l.id };
}
/** Takes `first`, paying with Eddies only, until no payment choice remains. */
function paid(s: GameState, first: Parameters<typeof take>[2]) {
    let r = take(s, context, first); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice?.kind === "PAYMENT"; n++) {
        assert.ok(n < 10); assert.ok(validateState(r.state, context).ok);
        const i = r.state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
        assert.ok(i >= 0); r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    return { state: r.state, events };
}
const activate = (s: GameState, id: CardInstanceId) => paid(s, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === id);
const play = (s: GameState, id: CardInstanceId) => paid(s, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id);
const powerGiven = (s: GameState) => (s.temporaryModifiers ?? []).filter(x => "scaled" in x && x.scaled === "PROGRAM_PLAY_TRIGGER");

test("the V76 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(judy.provenance.sourceHash, hashCanonical(v76Source(judy.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === judy.id), [judy]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("Judy Álvarez: Braindance Maestro passes only its exact pin; any changed field is rejected by every gate", () => {
    const gates = [supportsLegendSpendCard, supportsTriggerCard];
    for (const gate of gates) assert.ok(gate(judy, context).ok);
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(judy) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["another guard", d => { d.mechanics.abilities[0].guard = "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN"; }],
        ["no guard", d => { delete d.mechanics.abilities[0].guard; }],
        ["+2", d => { d.mechanics.abilities[0].effects = [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 2 }]; }],
        ["Quick timing", d => { d.mechanics.abilities[1].activation!.timing = "QUICK"; }],
        ["an Eddie cost", d => { d.mechanics.abilities[1].activation!.costs = [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 1 } }, { kind: "SPEND_SOURCE" }]; }],
        ["a condition", d => { d.mechanics.abilities[1].conditions = [{ kind: "CONTROLS_VALUE_PAIR" }]; }],
        ["tags", d => { d.tags = ["Mox"]; }],
        ["colors", d => { d.colors = ["RED"]; d.ram = { RED: 2 }; }],
        ["scope", d => { d.execution = { scope: "FIELD_LEGENDS_V1", status: "SUPPORTED" }; }]
    ];
    for (const [label, edit] of forgeries) for (const gate of gates) assert.equal(gate(forge(edit), context).ok, false, label);
});

test("Spend trashes the top card; a Program pauses to add it or leave it", () => {
    const a = arrange({ top: TRUST });
    const offered = actions(a.state, context).find(x => x.action.kind === "ACTIVATE_ABILITY" && x.action.sourceInstanceId === a.judy);
    assert.equal(offered?.descriptor.label, "Activate Judy Álvarez: Braindance Maestro: Spend to trash the top card of your deck");
    const top = a.state.players[actor].zones.DECK[0], hand = a.state.players[actor].zones.HAND.length, s = activate(a.state, a.judy).state;
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.equal(s.objects.cards[a.judy].readiness, "SPENT");
    assert.equal(s.objects.cards[top].zone.zone, "TRASH");
    assert.deepEqual(s.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : o.kind), ["CONFIRM", top]);
    const labels = actions(s, context).map(x => x.descriptor.label);
    assert.ok(labels.includes("Leave it in your trash") && labels.includes(`Add Peace Offering (${top}) from your trash to your hand`), labels.join(" | "));
    const taken = pick(s, context, o => o.kind === "CARD");
    assert.ok(validateState(taken.state, context).ok);
    assert.equal(taken.state.objects.cards[top].zone.zone, "HAND"); assert.equal(taken.state.players[actor].zones.HAND.length, hand + 1);
    assert.equal(taken.state.timing.step, "MAIN"); assert.equal(taken.state.resolution.playContinuation, undefined);
    const left = pick(s, context, o => o.kind === "CONFIRM");
    assert.ok(validateState(left.state, context).ok);
    assert.equal(left.state.objects.cards[top].zone.zone, "TRASH"); assert.ok(left.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
});

test("Spend on a non-Program top card or an empty deck does not pause", () => {
    const a = arrange({ top: ATLUS }), top = a.state.players[actor].zones.DECK[0], r = activate(a.state, a.judy);
    assert.equal(r.state.timing.step, "MAIN"); assert.equal(r.state.objects.cards[top].zone.zone, "TRASH");
    const empty = arrange({ emptyDeck: true }), e = activate(empty.state, empty.judy);
    assert.equal(e.state.timing.step, "MAIN"); assert.equal(e.state.match.outcome, undefined, "trashing from an empty deck draws nothing, so no loss");
});

test("playing a BRAINDANCE Program gives a chosen friendly Unit +1 power this turn after the Program resolves", () => {
    const a = arrange({ mine: [ATLUS, PSYCHO], hand: [BOOTLEG] }), before = effectivePower(a.state, a.units[1], context)!;
    const s = play(a.state, a.cards[0]).state;
    assert.equal(s.objects.cards[a.cards[0]].zone.zone, "TRASH", "the Program has resolved");
    assert.equal(s.timing.step, "TARGET_SELECTION"); assert.ok(s.resolution.triggerContinuation);
    assert.ok(actions(s, context).some(x => x.descriptor.label === `Give Psycho Squad (${a.units[1]}) +1 power this turn`));
    const done = pick(s, context, o => o.kind === "CARD" && o.cardInstanceId === a.units[1]);
    assert.ok(validateState(done.state, context).ok);
    assert.equal(effectivePower(done.state, a.units[1], context), before + 1); assert.equal(powerGiven(done.state).length, 1);
    assert.equal(done.state.timing.step, "MAIN");
    assert.equal(end(done.state, context).state.temporaryModifiers, undefined);
});

test("a lone friendly Unit is forced, no Unit does nothing, and a face-down Judy or another Program triggers nothing", () => {
    const lone = arrange({ mine: [ATLUS], hand: [BOOTLEG] }), r = play(lone.state, lone.cards[0]);
    assert.equal(r.state.timing.step, "MAIN"); assert.equal(powerGiven(r.state).length, 1);
    assert.ok(r.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.targetId === lone.units[0] && e.payload.forced));
    const none = arrange({ hand: [BOOTLEG] }), n = play(none.state, none.cards[0]);
    assert.equal(n.state.timing.step, "MAIN"); assert.equal(n.state.temporaryModifiers, undefined);
    const down = arrange({ mine: [ATLUS], hand: [BOOTLEG], face: "DOWN" }), d = play(down.state, down.cards[0]);
    assert.equal(d.state.timing.step, "MAIN"); assert.equal(d.state.temporaryModifiers, undefined);
    assert.ok(!d.events.some(e => e.payload.kind === "EFFECT_PENDING" && e.payload.sourceId === down.judy));
    const o = arrange({ mine: [ATLUS], hand: [OTHER_PROGRAM] }), p = play(o.state, o.cards[0]);
    assert.equal(p.state.objects.cards[o.cards[0]].zone.zone, "TRASH"); assert.equal(p.state.timing.step, "MAIN"); assert.equal(powerGiven(p.state).length, 0);
});

test("a BRAINDANCE Program's own defeat batch holds Judy's trigger too, and both resolve", () => {
    const a = arrange({ mine: [ATLUS, PSYCHO], theirs: [DEXTER], hand: [BONNIE] });
    let r = play(a.state, a.cards[0]); const events = [...r.events];
    for (let n = 0; r.state.resolution.choice && r.state.timing.step !== "MAIN"; n++) {
        assert.ok(n < 20); assert.ok(validateState(r.state, context).ok, r.state.timing.step);
        const opts = r.state.resolution.choice.options;
        const i = Math.max(0, opts.findIndex(o => o.kind === "CARD" && (o.cardInstanceId === a.others[0] || o.cardInstanceId === a.units[1])));
        r = choose(r.state, context, i); events.push(...r.events);
    }
    assert.ok(validateState(r.state, context).ok);
    assert.equal(r.state.objects.cards[a.others[0]].zone.zone, "TRASH", "Dexter was defeated");
    assert.equal(powerGiven(r.state).length, 1, "Judy's trigger resolved");
    const pending = events.filter(e => e.payload.kind === "EFFECT_PENDING").map(e => e.payload.kind === "EFFECT_PENDING" ? e.payload.sourceId : "");
    assert.ok(pending.includes(a.judy) && pending.includes(a.others[0]), pending.join(","));
});
