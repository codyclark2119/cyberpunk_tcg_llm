import { failure, success, type CardInstanceId, type DefeatInstruction, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { processDeparture } from "./card-movement";
import { supportsPlay } from "./play-support";

export function defeatBatch(state: GameState, id: CardInstanceId): CardInstanceId[] {
    return [id, ...state.objects.cards[id].attachments].sort();
}
export function defeatSupport(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!c || c.zone.zone !== "BATTLEFIELD" || c.face !== "UP" || revision?.type !== "UNIT" || !supportsPlay(revision, context).ok || revision.mechanics.abilities.some(a => a.trigger === "WHEN_DEFEATED"))
        return failure("UNSUPPORTED_DEFEAT", "Defeat currently admits reviewed ordinary field Units without DEFEATED/prevention effects; no Go Solo execution");
    if (defeatBatch(state, id).some(cid => state.objects.cards[cid].ownerId !== c.ownerId || state.objects.cards[cid].controllerId !== c.ownerId))
        return failure("UNSUPPORTED_DEFEAT_OWNERSHIP", "Cross-owner card/Gear movement requires a separately reviewed destination and ordering protocol");
    return success(null);
}
/** Trusted semantic operation, reusable by future effect handlers; not a player action.
 * All instructions/orders are checked before mutation. All defeat facts precede shared movement.
 * 11.19.2 trigger discovery belongs AFTER declaration AND movement; no admitted card has that trigger.
 */
export function defeatCards(m: TurnMutation, defeats: readonly DefeatInstruction[], orders: readonly { readonly targetId: CardInstanceId; readonly cardIds: readonly CardInstanceId[] }[]) {
    if (new Set(defeats.map(d => d.targetId)).size !== defeats.length || orders.length !== defeats.length)
        return failure("INVALID_DEFEAT_BATCH", "Distinct targets and one owner order per defeat required");
    for (const d of defeats) {
        const supported = defeatSupport(m.state, d.targetId, m.context);
        if (!supported.ok) return supported;
        const order = orders.find(o => o.targetId === d.targetId)?.cardIds, batch = defeatBatch(m.state, d.targetId);
        if (!m.state.objects.cards[d.defeatedBy] || !order || order.length !== batch.length || new Set(order).size !== batch.length || order.some(id => !batch.includes(id)))
            return failure("INVALID_DEFEAT_ORDER", "Exact owner order and existing defeat source required");
    }
    for (const d of defeats) m.emit({ kind: "CARD_DEFEATED", cardInstanceId: d.targetId, defeatedBy: d.defeatedBy });
    for (const d of defeats) {
        const moved = processDeparture(m, d.targetId, "TRASH", orders.find(o => o.targetId === d.targetId)!.cardIds);
        if (!moved.ok) return moved;
    }
    m.state.resolution.stage = "DISCOVER_TRIGGERS";
    // Full-shape admission above excludes every unresolved DEFEATED trigger. Never silently ignore one.
    return success(null);
}
