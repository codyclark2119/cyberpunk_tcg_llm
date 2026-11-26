import test from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema, type GameState, type PlayerId } from "@tcg/domain";
import { createGameWithEvents, validateState } from "../packages/engine/src/index";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { batchV46Context, batchV46Input, SAFETY } from "./api-admission-batch-v46-fixture";
import { batchV100Context, batchV100Input } from "./api-admission-batch-v100-fixture";
import { pick, playCard, placeCard } from "./value-conditions-focused";
import { clearField, equip, field, fund } from "./targeted-defeat-focused";
import { actions, choose, take } from "./delayed-effects-focused";
import { unwrap } from "./turn-replay";

// Engine card audit (2026-11-26), fix scope 1: crashes and rejected legal plays found by the audit's probes.

type Ctx = ReturnType<typeof batchV100Context>;
function mainPhase(state: GameState, context: Ctx) {
    let s = state;
    while (s.setup) s = choose(s, context, s.setup.stage === "FIRST_PLAYER" && s.timing.actingPlayer !== s.match.playerOrder[0] ? 1 : 0).state;
    while (s.timing.step !== "MAIN") s = take(s, context, a => a.action.kind === "ROLL_GIG" || a.action.kind === "CHOOSE").state;
    return s;
}
function opened(context: Ctx, input: ReturnType<typeof batchV100Input>, fundRival = true) {
    const s = mainPhase(unwrap(createGameWithEvents(input, context)).state, context), funded = fund(clearField(s, context), context);
    return fundRival ? fund(funded, context, s.match.playerOrder.find(p => p !== s.timing.activePlayer)) : funded;
}
/** Rewrites the top deck card of `player` as `cardId` and moves it through hand to `zone`. */
function put(m: TurnMutation, context: Ctx, player: PlayerId, cardId: string, zone: "HAND" | "BATTLEFIELD" | "TRASH") {
    const deck = m.state.players[player].zones.DECK, c = m.state.objects.cards[deck[deck.length - 1]], r = context.content.cards.find(x => x.id === cardId)!;
    c.cardId = r.id; c.revision = r.revision; moveCardLocation(m, c.id, "HAND");
    if (zone !== "HAND") moveCardLocation(m, c.id, zone);
    if (zone === "BATTLEFIELD") { c.statuses = []; c.readiness = "READY"; }
    return c;
}
function faceUpLegend(m: TurnMutation, context: Ctx, player: PlayerId, cardId: string, slot = 0) {
    const l = m.state.objects.cards[m.state.players[player].zones.LEGENDS[slot]], r = context.content.cards.find(x => x.id === cardId)!;
    l.cardId = r.id; l.revision = r.revision; l.face = "UP"; l.readiness = "READY";
    return l.id;
}
function settle(state: GameState, context: Ctx, chooseOption: (s: GameState) => number = () => 0) {
    let r: { state: GameState; events: readonly { payload: { kind: string } }[] } = { state, events: [] }; const events: string[] = [];
    for (let n = 0; n < 60 && !(r.state.timing.step === "MAIN" && r.state.timing.combat.stage === "NONE" && !r.state.resolution.choice); n++) {
        r = r.state.timing.step === "RIVAL_REACT" && !r.state.resolution.choice ? take(r.state, context, a => a.action.kind === "PASS_REACT")
            : r.state.resolution.choice?.kind === "PAYMENT" ? pick(r.state, context, o => o.kind === "PAYMENT" && o.source.kind === "EDDIE")
            : choose(r.state, context, chooseOption(r.state));
        events.push(...r.events.map(e => e.payload.kind));
    }
    return { state: r.state, events };
}
const cardOption = (cardId: string) => (s: GameState) => Math.max(0, s.resolution.choice!.options.findIndex(o => o.kind === "CARD" && s.objects.cards[o.cardInstanceId]?.cardId === cardId));

test("B1: Safety Override's fired defeat of a Unit carrying ordinary Gear resolves instead of throwing", () => {
    const context = batchV46Context(), base = opened(context, batchV46Input("audit-b1"));
    const actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
    const m = new TurnMutation(base, context);
    put(m, context, actor, SAFETY, "HAND");
    const attacker = put(m, context, actor, "emergency-atlus", "BATTLEFIELD"), defender = put(m, context, rival, "psycho-squad", "BATTLEFIELD");
    defender.readiness = "SPENT";
    const gear = put(m, context, rival, "satori-sword-of-saburo", "BATTLEFIELD"); defender.attachments.push(gear.id);
    let s = unwrap(validateState(GameStateSchema.parse(m.state), context));
    s = playCard(s, context, SAFETY).state;
    s = take(s, context, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker.id).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === defender.id).state;
    const r = settle(s, context);
    assert.ok(r.events.includes("FIGHT_OUTCOME_EFFECT_FIRED"));
    for (const id of [attacker.id, defender.id, gear.id]) assert.equal(r.state.objects.cards[id].zone.zone, "TRASH");
});

test("B2: a Program Alt Cunningham plays from the trash keeps its this-turn power after it is bottom-decked", () => {
    const context = batchV100Context(), base = opened(context, batchV100Input("audit-b2"));
    const actor = base.timing.activePlayer, m = new TurnMutation(base, context);
    const host = put(m, context, actor, "emergency-atlus", "BATTLEFIELD"), blades = put(m, context, actor, "mantis-blades", "BATTLEFIELD"); host.attachments.push(blades.id);
    const program = put(m, context, actor, "cyberpsychosis", "TRASH"), alt = faceUpLegend(m, context, actor, "alt-cunningham-soulkiller-architect");
    let s = unwrap(validateState(GameStateSchema.parse(m.state), context));
    s = take(s, context, a => a.action.kind === "ACTIVATE_ABILITY" && a.action.sourceInstanceId === alt).state;
    const r = settle(s, context, cardOption("cyberpsychosis"));
    const deck = r.state.players[actor].zones.DECK;
    assert.equal(deck[deck.length - 1] === program.id || deck[0] === program.id, true, "the played Program is bottom-decked");
    assert.ok((r.state.temporaryModifiers ?? []).some(x => x.sourceId === program.id && x.targetId === host.id), "its power record survives");
    assert.ok(validateState(r.state, context).ok);
});

test("B2: Lizzy Wizzy's free Cyberpsychosis with a friendly equipped Unit resolves", () => {
    const context = batchV100Context(), base = opened(context, batchV100Input("audit-g4"), false);
    const actor = base.timing.activePlayer;
    const placed = field(base, context, "emergency-atlus", actor), host = placed.id;
    let s = equip(placed.state, context, "mantis-blades", host).state;
    s = placeCard(s, context, "lizzy-wizzy-delicate-weapon").state;
    const program = placeCard(s, context, "cyberpsychosis"); s = program.state;
    const r = settle(playCard(s, context, "lizzy-wizzy-delicate-weapon").state, context, cardOption("cyberpsychosis"));
    assert.ok((r.state.temporaryModifiers ?? []).some(x => x.sourceId === program.id && x.targetId === host));
    assert.equal(r.state.objects.cards[program.id].zone.zone, "DECK");
});

test("B3: Lizzy Wizzy's free Chrome Reverie with Judy Alvarez: Braindance Maestro face up resolves Judy's trigger", () => {
    const context = batchV100Context(), base = opened(context, batchV100Input("audit-g4"), false);
    const actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
    let s = field(base, context, "emergency-atlus", rival).state;
    s = field(s, context, "emergency-atlus", actor).state;
    const m = new TurnMutation(s, context), judy = faceUpLegend(m, context, actor, "judy-a-lvarez-braindance-maestro");
    s = unwrap(validateState(GameStateSchema.parse(m.state), context));
    s = placeCard(s, context, "lizzy-wizzy-delicate-weapon").state;
    const program = placeCard(s, context, "chrome-reverie"); s = program.state;
    const r = settle(playCard(s, context, "lizzy-wizzy-delicate-weapon").state, context, cardOption("chrome-reverie"));
    assert.equal(r.state.objects.cards[program.id].zone.zone, "DECK");
    assert.ok((r.state.temporaryModifiers ?? []).some(x => x.sourceId === judy), `Judy's +1 trigger resolved: ${judy} ${JSON.stringify(r.state.temporaryModifiers)} ${r.events.join(",")}`);
    assert.equal(r.state.turnHistory?.queuedProgramPlay, undefined);
    assert.equal(r.state.timing.actingPlayer, actor);
});

test("B7: two free Calls in one attack both resolve their {Call} abilities", () => {
    const context = batchV100Context(), base = opened(context, batchV100Input("audit-b7"));
    const actor = base.timing.activePlayer, rival = base.match.playerOrder.find(p => p !== actor)!;
    const m = new TurnMutation(base, context);
    const host = put(m, context, actor, "psycho-squad", "BATTLEFIELD"), radioport = put(m, context, actor, "arasaka-emergency-radioport", "BATTLEFIELD");
    const tbug = put(m, context, rival, "t-bug-amateur-philosopher", "BATTLEFIELD");
    host.attachments = [radioport.id]; tbug.readiness = "SPENT";
    const d = GameStateSchema.parse(m.state);
    for (const p of [actor, rival]) d.players[p].zones.LEGENDS.forEach((id, i) => {
        const l = d.objects.cards[id], r = context.content.cards.find(x => x.id === ["v-streetkid", "dev-legend-red", "v-corporate-exile"][i])!;
        l.cardId = r.id; l.revision = r.revision; l.face = "DOWN";
    });
    let s = unwrap(validateState(d, context));
    const deck = { a: s.players[actor].zones.DECK.length, r: s.players[rival].zones.DECK.length };
    s = take(s, context, x => x.action.kind === "DECLARE_ATTACK" && x.action.cardInstanceId === host.id).state;
    if (s.timing.step === "ATTACK_TARGET_SELECTION") s = pick(s, context, o => o.kind === "ATTACK_TARGET" && o.target.kind === "CARD" && o.target.cardInstanceId === tbug.id).state;
    s = pick(s, context, o => o.kind === "LEGEND_SLOT" && o.slot === 0).state;
    s = pick(s, context, o => o.kind === "CONFIRM" && o.confirmed).state;
    let n = 0;
    while (!(s.timing.step === "MAIN" && s.timing.combat.stage === "NONE" && !s.resolution.choice) && n++ < 40) {
        if (s.timing.step === "RIVAL_REACT" && !s.resolution.choice) { s = take(s, context, x => x.action.kind === "PASS_REACT").state; continue; }
        const labels = actions(s, context).map(a => a.descriptor.label), i = labels.findIndex(l => /Legend 1/.test(l));
        s = i >= 0 ? take(s, context, a => a.descriptor.label === labels[i]).state : choose(s, context, 0).state;
    }
    assert.equal(deck.a - s.players[actor].zones.DECK.length, 3, "the attacker's V: Streetkid {Call} resolved");
    assert.equal(deck.r - s.players[rival].zones.DECK.length, 3, "the rival's V: Streetkid {Call} resolved");
    assert.equal(s.turnHistory?.queuedCall, undefined);
    assert.equal(s.turnHistory?.queuedCallsNext, undefined);
});
