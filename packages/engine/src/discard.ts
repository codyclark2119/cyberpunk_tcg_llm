import { failure, success, type CardInstanceId, type DiscardCardsEffect, type GameState, type PlayerId } from "@tcg/domain";
import { moveCardLocation } from "./card-movement";
import type { TurnMutation } from "./turn";
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
    if (effect.kind !== "DISCARD_CARDS" || !current?.sourceId || !getDiscardableCards(m.state, current.controllerId).includes(cardInstanceId)) return failure("INVALID_DISCARD", "Discard the affected controller's currently eligible hand card");
    moveCardLocation(m, cardInstanceId, "TRASH");
    m.emit({ kind: "CARD_DISCARDED", cardInstanceId, playerId: current.controllerId, sourceId: current.sourceId, effectId: current.id, forced });
    return success(null);
}
