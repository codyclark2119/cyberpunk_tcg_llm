import type { CardInstanceId, GameState, PendingEffect, PlayerId } from "@tcg/domain";
import { effectiveCardTypes, effectivePower, hasClassification } from "./characteristics";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { readyLockIds } from "./ready-lock";
/** "Ready a friendly face-up Legend" (batch V8). Like the reviewed spend selector, readiness is not
 * a selector filter: an already-ready Legend is a legal choice that changes nothing. */
export function readyLegendTargets(state: GameState, actor: PlayerId, _context: EngineContext): CardInstanceId[] {
    return state.players[actor].zones.LEGENDS.filter(id => { const c = state.objects.cards[id]; return c.controllerId === actor && c.face === "UP"; }).sort();
}
/** Batch V25: another friendly face-up field Unit whose current power equals the current value of the Gig the steal
 * trigger names. As with the Legend ready, readiness is not a selector filter. */
export function stolenGigReadyTargets(state: GameState, current: PendingEffect, context: EngineContext): CardInstanceId[] {
    const gig = current.trigger?.gigInstanceId ? state.objects.gigs[current.trigger.gigInstanceId] : undefined, subjectId = current.trigger?.subjectId;
    if (!gig || gig.roll.kind !== "ROLLED") return [];
    const value = gig.roll.currentValue;
    return state.players[current.controllerId].zones.BATTLEFIELD.filter(id => { const c = state.objects.cards[id]; return id !== subjectId && c.controllerId === current.controllerId && c.face === "UP" && effectiveCardTypes(state, id, context).includes("UNIT") && effectivePower(state, id, context) === value; }).sort();
}
/** Effect-caused ready. Readying a ready card is not a transition and emits nothing. */
/** Batch V29: face-up Legends in the actor's Legends area with the classification. A face-down Legend has no public
 * classification. As with the Legend ready, readiness is not a selector filter. */
export function taggedLegendReadyTargets(state: GameState, actor: PlayerId, tag: string, context: EngineContext): CardInstanceId[] {
    return readyLegendTargets(state, actor, context).filter(id => hasClassification(state, id, tag, context));
}
/** Batch V38: friendly face-up field Units, Go Solo Legends included (4.2.1). As with the other readies, readiness is not a
 * selector filter. */
export function friendlyUnitReadyTargets(state: GameState, actor: PlayerId, context: EngineContext): CardInstanceId[] {
    return state.players[actor].zones.BATTLEFIELD.filter(id => { const c = state.objects.cards[id]; return c.controllerId === actor && c.face === "UP" && effectiveCardTypes(state, id, context).includes("UNIT"); }).sort();
}
export function readyCardForEffect(m: TurnMutation, id: CardInstanceId) {
    const c = m.state.objects.cards[id];
    if (!c || c.readiness !== "SPENT") return;
    const locks = readyLockIds(m.state, id);
    if (locks.length) { m.emit({ kind: "READY_PREVENTED", cardInstanceId: id, effectIds: locks }); return; } // Batch V22, 2.6.
    c.readiness = "READY";
    m.emit({ kind: "CARD_READIED", cardInstanceId: id });
}
