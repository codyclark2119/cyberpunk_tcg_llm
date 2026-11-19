import { failure, success, type CardInstanceId, type DiscardCardsEffect, type GameState, type PlayerId } from "@tcg/domain";
import { moveCardLocation } from "./card-movement";
import type { TurnMutation } from "./turn";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
/** Own hand only; selectors never reveal a rival hand through a player action. */
export function getDiscardableCards(state: GameState, player: PlayerId): CardInstanceId[] {
    return [...state.players[player].zones.HAND].filter(id => {
        const c = state.objects.cards[id];
        return c?.ownerId === player && c.controllerId === player && c.zone.playerId === player && c.zone.zone === "HAND";
    }).sort();
}
/** Typed semantic primitive after its caller resolves any condition and strategic selection.
 * Trash is public; CARD_DISCARDED records why, CARD_MOVED records the actual area transition. */
export function discardCard(m: TurnMutation, effect: DiscardCardsEffect, cardInstanceId: CardInstanceId, forced: boolean) {
    const current = m.state.resolution.current;
    if (effect.kind !== "DISCARD_CARDS" || !current?.sourceId) return failure("INVALID_DISCARD", "Discard the affected controller's currently eligible hand card");
    // Batch V17: a RIVAL discard affects the player other than the effect's controller.
    const player = effect.player === "RIVAL" ? m.state.match.playerOrder.find(id => id !== current.controllerId)! : current.controllerId;
    if (!getDiscardableCards(m.state, player).includes(cardInstanceId)) return failure("INVALID_DISCARD", "Discard the affected controller's currently eligible hand card");
    moveCardLocation(m, cardInstanceId, "TRASH");
    m.emit({ kind: "CARD_DISCARDED", cardInstanceId, playerId: player, sourceId: current.sourceId, effectId: current.id, forced });
    return success(null);
}
/** Batch V31: "If the card's cost equals the value of a friendly Gig": the discarded card's printed cost against the effect
 * controller's own rolled Gigs (6.1.2). A card with no numeric cost matches nothing. */
export function discardedCostMatchesFriendlyGig(state: GameState, controller: PlayerId, cardInstanceId: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, cardInstanceId, context);
    if (r?.printedCost.kind !== "EDDIES") return false;
    const cost = r.printedCost.amount;
    return Object.values(state.objects.gigs).some(g => g.controllerId === controller && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue === cost);
}
