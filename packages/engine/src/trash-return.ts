import { canonicalSerialize, failure, success, type CardInstanceId, type Effect, type GameState, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { moveCardLocation } from "./card-movement";
import { revisionOf } from "./play-support";

type TrashThenReturn = Extract<Effect, { kind: "TRASH_THEN_RETURN_UNIT" }>;
/** Batch V14: Units among the cards this Program primitive trashed that are still in its controller's trash. */
export function trashedUnitTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const c = state.resolution.playContinuation;
    if (!c?.trashedIds || state.resolution.current?.effect.kind !== "TRASH_THEN_RETURN_UNIT") return [];
    const trash = state.players[c.actorId].zones.TRASH;
    return c.trashedIds.filter(id => trash.includes(id) && state.objects.cards[id].face === "UP" && revisionOf(state, id, context)?.type === "UNIT").sort();
}
function returnToHand(m: TurnMutation, id: CardInstanceId, forced: boolean) {
    const current = m.state.resolution.current!;
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    moveCardLocation(m, id, "HAND");
}
/** 11.10.2.1.1: trash each card individually; an empty deck stops trashing (no loss: only drawing loses, 1.14). */
export function resolveTrashThenReturn(m: TurnMutation, effect: TrashThenReturn, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, deck = s.players[c.actorId].zones.DECK, trashed: CardInstanceId[] = [];
    for (let i = 0; i < effect.count && deck.length; i++) { const id = deck[0]; moveCardLocation(m, id, "TRASH"); trashed.push(id); }
    if (!trashed.length) return success(null);
    c.trashedIds = trashed;
    const targets = trashedUnitTargets(s, m.context);
    if (targets.length > 1) return offer(m);
    if (targets.length === 1) returnToHand(m, targets[0], true);
    delete c.trashedIds;
    return success(null);
}
export function chooseTrashedUnit(m: TurnMutation, id: CardInstanceId): Result<null> {
    if (!trashedUnitTargets(m.state, m.context).includes(id)) return failure("INVALID_TRASH_TARGET", "Choose a Unit among the trashed cards");
    returnToHand(m, id, false);
    delete m.state.resolution.playContinuation!.trashedIds;
    return success(null);
}
/** A pause holds exactly the trashed top of the trash, fewer than three only from an empty deck, and 2+ Units to choose from. */
export function validateTrashReturn(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, current = state.resolution.current, ids = c.trashedIds ?? [];
    if (current?.effect.kind !== "TRASH_THEN_RETURN_UNIT") return c.trashedIds ? failure("INVALID_TRASH_RETURN", "Trashed cards belong only to the current trash-return primitive") : success(null);
    const trash = state.players[c.actorId].zones.TRASH;
    if (!ids.length || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || ids.length > current.effect.count || (ids.length < current.effect.count && state.players[c.actorId].zones.DECK.length)
        || canonicalSerialize(trash.slice(-ids.length)) !== canonicalSerialize(ids) || ids.some(id => state.objects.cards[id].ownerId !== c.actorId) || trashedUnitTargets(state, context).length < 2
        || state.resolution.targetedDefeatContinuation || state.resolution.defeatContinuation || state.resolution.triggerContinuation)
        return failure("INVALID_TRASH_RETURN", "Exact trashed top cards, an empty deck for a short trash, and a strategic Unit choice required");
    return success(null);
}
