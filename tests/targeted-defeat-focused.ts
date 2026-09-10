import { type GameState, type PlayerId, type CardInstanceId } from "@tcg/domain";
import { validateState, type EngineContext } from "@tcg/engine";
import { TurnMutation } from "../packages/engine/src/turn";
import { moveCardLocation, processDeparture, attachPlayedGear } from "../packages/engine/src/card-movement";
import { defeatBatch } from "../packages/engine/src/defeat";
import { placeCard, pick } from "./value-conditions-focused";
import { unwrap } from "./turn-replay";
/** Trusted edge-case arrangements only. Headline replay imports none of these helpers. */
export function clearField(s: GameState, context: EngineContext) {
    const m = new TurnMutation(s, context);
    for (const c of Object.values(m.state.objects.cards)) if (c.zone.zone === "BATTLEFIELD" && !Object.values(m.state.objects.cards).some(h => h.attachments.includes(c.id))) unwrap(processDeparture(m, c.id, "TRASH", defeatBatch(m.state, c.id)));
    return unwrap(validateState(m.state, context));
}
export function fund(s: GameState, context: EngineContext, player = s.timing.activePlayer) {
    const m = new TurnMutation(s, context);
    for (const id of [...m.state.players[player].zones.EDDIES, ...m.state.players[player].zones.LEGENDS]) m.state.objects.cards[id].readiness = "READY";
    while (m.state.players[player].zones.EDDIES.length < 8) {
        const card = Object.values(m.state.objects.cards).find(c => c.controllerId === player && c.zone.zone === "DECK" && c.cardId.startsWith("slice-card-"))!;
        if (!card) break;
        m.state.players[player].zones.DECK = m.state.players[player].zones.DECK.filter(id => id !== card.id);
        m.state.players[player].zones.EDDIES.push(card.id); card.zone = { playerId: player, zone: "EDDIES" }; card.face = "DOWN"; card.readiness = "READY";
    }
    return unwrap(validateState(m.state, context));
}
export function field(s: GameState, context: EngineContext, cardId: string, player: PlayerId) {
    const placed = placeCard(s, context, cardId, player), m = new TurnMutation(placed.state, context);
    moveCardLocation(m, placed.id, "BATTLEFIELD"); m.state.objects.cards[placed.id].readiness = "READY"; m.state.objects.cards[placed.id].statuses = [];
    return { state: unwrap(validateState(m.state, context)), id: placed.id };
}
export function equip(s: GameState, context: EngineContext, cardId: string, host: CardInstanceId) {
    const placed = placeCard(s, context, cardId, s.objects.cards[host].controllerId), m = new TurnMutation(placed.state, context);
    unwrap(attachPlayedGear(m, placed.id, host));
    return { state: unwrap(validateState(m.state, context)), id: placed.id };
}
export function reduced(s: GameState, context: EngineContext, targetId: CardInstanceId) {
    const owner = s.match.playerOrder.find(p => p !== s.objects.cards[targetId].controllerId)!, placed = placeCard(s, context, "floor-it", owner), m = new TurnMutation(placed.state, context);
    moveCardLocation(m, placed.id, "TRASH");
    m.state.temporaryModifiers = [...(m.state.temporaryModifiers ?? []), { kind: "POWER", sourceId: placed.id, targetId, amount: -1, expires: { kind: "END_OF_TURN", turn: s.timing.turn } }];
    m.state.temporaryModifiers.sort((a, b) => a.sourceId < b.sourceId ? -1 : 1);
    return unwrap(validateState(m.state, context));
}
export function payOnly(s: GameState, context: EngineContext) {
    let state = s; const events: ReturnType<typeof pick>["events"] = [];
    while (state.resolution.choice?.kind === "PAYMENT") { const next = pick(state, context, o => o.kind === "PAYMENT"); state = next.state; events.push(...next.events); }
    return { state, events };
}
export function finishOrder(s: GameState, context: EngineContext) {
    let state = s; const events: ReturnType<typeof pick>["events"] = [];
    while (state.resolution.targetedDefeatContinuation?.phase === "ORDER") { const next = pick(state, context, o => o.kind === "CARD"); state = next.state; events.push(...next.events); }
    return { state, events };
}
