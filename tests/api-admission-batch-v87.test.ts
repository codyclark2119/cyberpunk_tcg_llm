import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, hashCanonical, type CardRevisionSnapshot, type GameState } from "@tcg/domain";
import { createGameWithEvents, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsTriggerCard } from "../packages/engine/src/trigger-support";
import { supportsSpendTriggerCard } from "../packages/engine/src/spend-trigger-support";
import { supportsFreeCallUnit } from "../packages/engine/src/free-call-support";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { reviewEngineCandidateV1 } from "../scripts/lib/engine-candidates";
import { batchV87Cards, batchV87Context, batchV87Input, v87Source, RADIOPORT } from "./api-admission-batch-v87-fixture";
import { pick } from "./value-conditions-focused";
import { clearField, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

const context = batchV87Context();
const [radioport] = batchV87Cards;
const NEGOTIATORS = "augmented-negotiators", ATLUS = "emergency-atlus", PLAIN = "dev-legend-red", SABURO = "saburo-arasaka-stubborn-patriarch", STREETKID = "v-streetkid", EXILE = "v-corporate-exile";
// A spent power-2 rival Unit to attack; a vanilla Unit; a Legend neither ARASAKA nor {Go Solo}; an ARASAKA Legend without {Call}; a {Go Solo} Legend with a {Call}; a {Go Solo} Legend.
function setup(): GameState {
    let state = unwrap(createGameWithEvents(batchV87Input("batch-v87"), context)).state;
    while (state.setup) state = choose(state, context, state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0).state;
    while (state.timing.step !== "MAIN") state = take(state, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return fund(clearField(state, context), context);
}
const base = setup(), actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;

type Arrangement = { legends?: string[]; called?: boolean };
/** Trusted arrangement on the actor's MAIN: a ready Emergency Atlus holding a Radioport, and a spent rival Augmented Negotiators; the actor's Legends become `legends` in slot
 * order (default [plain, Saburo, plain]), all face down; with `called`, the turn's Call is already used. */
function arrange(a: Arrangement = {}) {
    const m = new TurnMutation(base, context);
    const put = (cardId: string, player = actor) => {
        const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
        c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND"); moveCardLocation(m, c.id, "BATTLEFIELD"); c.statuses = []; c.readiness = "READY"; return c;
    };
    const host = put(ATLUS), gear = put(RADIOPORT), target = put(NEGOTIATORS, rival); host.attachments = [gear.id]; target.readiness = "SPENT";
    const d = GameStateSchema.parse(m.state), legends = d.players[actor].zones.LEGENDS, names = a.legends ?? [PLAIN, SABURO, PLAIN];
    legends.forEach((id, i) => { const l = d.objects.cards[id], r = context.content.cards.find(x => x.id === names[i])!; l.cardId = r.id; l.revision = r.revision; l.face = "DOWN"; });
    if (a.called) d.players[actor].economy.callsThisTurn = 1;
    return { state: unwrap(validateState(d, context)), host: host.id, gear: gear.id, legends: [...legends] };
}
const lookOrCall = (s: GameState) => s.resolution.current?.effect.kind === "MAY_CALL_LEGEND_FREE" && Boolean(s.resolution.choice);
/** The host attacks the rival Unit (spending it); every other choice takes its first option, until the Radioport's choice or the Main Phase. */
function attack(a: ReturnType<typeof arrange>) {
    let r = take(a.state, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === a.host); const events = [...r.events];
    for (let n = 0; !lookOrCall(r.state) && !(r.state.timing.step === "MAIN" && r.state.timing.combat.stage === "NONE"); n++) {
        assert.ok(n < 20);
        r = r.state.timing.step === "RIVAL_REACT" && !r.state.resolution.choice ? take(r.state, context, x => x.action.kind === "PASS_REACT") : choose(r.state, context, 0);
        events.push(...r.events);
    }
    return { state: r.state, events };
}
/** Passes every later React Step and takes the first option of any other choice, until the Main Phase. */
function finish(s: GameState) {
    let state = s; const events = [];
    for (let n = 0; !(state.timing.step === "MAIN" && state.timing.combat.stage === "NONE"); n++) {
        assert.ok(n < 20);
        const r = state.timing.step === "RIVAL_REACT" && !state.resolution.choice ? take(state, context, x => x.action.kind === "PASS_REACT") : choose(state, context, 0);
        state = r.state; events.push(...r.events);
    }
    return { state, events };
}
const labels = (s: GameState) => actions(s, context).map(x => x.descriptor.label).sort();
const look = (s: GameState, slot: number) => pick(s, context, o => o.kind === "LEGEND_SLOT" && o.slot === slot);
const known = (s: GameState) => (s.privateKnowledge ?? []).filter(k => k.viewerId === actor).map(k => k.cardInstanceId);

test("the V87 revision is an exact source projection and matches its engine candidate", () => {
    const catalog = readFileSync(new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    assert.equal(radioport.provenance.sourceHash, hashCanonical(v87Source(radioport.id)));
    const review = reviewEngineCandidateV1(catalog.find(x => x.sourceCardSlug === radioport.id), [radioport]);
    assert.equal(review.status, "SOURCE_MATCH", review.differences.join(", "));
});

test("the Radioport passes only its exact pin, through the spend gate; any changed field is rejected", () => {
    for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.ok(gate(radioport, context).ok);
    assert.equal(supportsFreeCallUnit(radioport, context).ok, false, "the free-Call table does not admit it");
    const forge = (edit: (d: CardRevisionSnapshot) => void) => { const d = structuredClone(radioport) as CardRevisionSnapshot; edit(d); return CardRevisionSnapshotSchema.parse(d); };
    const forgeries: [string, (d: CardRevisionSnapshot) => void][] = [
        ["any Legend", d => { d.mechanics.abilities[0].effects = [{ kind: "MAY_CALL_LEGEND_FREE" }]; }],
        ["look at all", d => { d.mechanics.abilities[0].effects = [{ kind: "MAY_CALL_LEGEND_FREE", lookAtAll: true }]; }],
        ["own spend", d => { delete d.mechanics.abilities[0].inherited; }],
        ["power", d => { d.power = 3; }],
        ["tags", d => { d.tags = ["Cyberware"]; }]
    ];
    for (const [name, edit] of forgeries) for (const gate of [supportsPlay, supportsTriggerCard, supportsSpendTriggerCard]) assert.equal(gate(forge(edit), context).ok, false, name);
});

test("spending its host offers a look at each face-down Legend; an ARASAKA Legend may then be Called for free", () => {
    const a = arrange(), s = attack(a).state;
    assert.ok(lookOrCall(s)); assert.equal(s.objects.cards[a.host].readiness, "SPENT");
    assert.deepEqual(labels(s), ["Look at friendly face-down Legend 1", "Look at friendly face-down Legend 2", "Look at friendly face-down Legend 3", "Look at no Legend"]);
    const looked = look(s, 1);
    assert.ok(validateState(looked.state, context).ok);
    assert.ok(looked.events.some(e => e.payload.kind === "LEGEND_LOOKED_AT")); assert.deepEqual(known(looked.state), [a.legends[1]]);
    assert.equal(looked.state.resolution.triggerContinuation?.lookedLegendId, a.legends[1]);
    assert.deepEqual(labels(looked.state), ["Call face-down Legend 2 for free", "Don't Call it"]);
    const called = pick(looked.state, context, o => o.kind === "CONFIRM" && o.confirmed);
    assert.equal(called.state.objects.cards[a.legends[1]].face, "UP"); assert.equal(called.state.players[actor].economy.callsThisTurn, 1);
    assert.equal(called.events.some(e => e.payload.kind === "PAYMENT_MADE"), false); assert.deepEqual(known(called.state), []);
    const done = finish(called.state);
    assert.equal(done.state.timing.step, "MAIN"); assert.equal(done.state.turnHistory?.queuedCall, undefined);
});

test("a {Go Solo} Legend qualifies and its {Call} resolves after the attack; a Legend that does not qualify is only looked at", () => {
    const a = arrange({ legends: [STREETKID, PLAIN, EXILE] }), s = attack(a).state, deck = s.players[actor].zones.DECK.length;
    const called = pick(look(s, 0).state, context, o => o.kind === "CONFIRM" && o.confirmed), done = finish(called.state);
    assert.ok(done.events.findIndex(e => e.payload.kind === "ATTACK_ENDED") >= 0);
    assert.equal(done.state.players[actor].zones.DECK.length, deck - 3, "V: Streetkid's {Call} trashed 3 after the attack");
    const plain = look(attack(arrange({ legends: [PLAIN, PLAIN, EXILE] })).state, 0);
    assert.equal(plain.state.objects.cards[arrange().legends[0]].face, "DOWN"); assert.equal(lookOrCall(plain.state), false);
    assert.equal(plain.events.some(e => e.payload.kind === "LEGEND_CALLED"), false);
});

test("with the turn's Call used, a qualifying Legend is only looked at; declining either choice Calls nothing", () => {
    const used = look(attack(arrange({ called: true })).state, 1);
    assert.equal(lookOrCall(used.state), false); assert.equal(used.events.some(e => e.payload.kind === "LEGEND_CALLED"), false);
    for (const declined of [pick(attack(arrange()).state, context, o => o.kind === "CONFIRM" && !o.confirmed), pick(look(attack(arrange()).state, 1).state, context, o => o.kind === "CONFIRM" && !o.confirmed)]) {
        assert.ok(declined.events.some(e => e.payload.kind === "OPTIONAL_TRIGGER_DECLINED"));
        assert.equal(declined.state.players[actor].economy.callsThisTurn, 0);
    }
});

test("a held looked-at Legend is validated", () => {
    const a = arrange(), s = look(attack(a).state, 1).state;
    const tamper = (edit: (d: ReturnType<typeof GameStateSchema.parse>) => void) => { const d = GameStateSchema.parse(s); edit(d); return validateState(d, context).ok; };
    assert.ok(tamper(() => undefined));
    assert.equal(tamper(d => { d.resolution.triggerContinuation!.lookedLegendId = a.legends[0]; }), false, "a Legend that does not qualify, or was not looked at");
    assert.equal(tamper(d => { d.players[actor].economy.callsThisTurn = 1; }), false, "no Call left");
    assert.equal(tamper(d => { delete d.resolution.triggerContinuation!.lookedLegendId; }), false, "the Call choice without its Legend");
});
