import { failure, success, type CardInstanceId, type Effect, type GameState, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { moveCardLocation } from "./card-movement";
import { cardRevision } from "./characteristics";

type TrashThenAdd = Extract<Effect, { kind: "TRASH_THEN_ADD_TRASH_PROGRAM" }>;
/** Batch V73: Programs with the effect's tag anywhere in its controller's trash (public, face-up), while that effect resolves. */
export function trashProgramTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const current = state.resolution.current, c = state.resolution.playContinuation;
    if (current?.effect.kind !== "TRASH_THEN_ADD_TRASH_PROGRAM" || c?.kind !== "ACTIVATE") return [];
    const tag = current.effect.tag;
    return state.players[current.controllerId].zones.TRASH.filter(id => { const card = state.objects.cards[id], r = cardRevision(state, id, context); return card.face === "UP" && r?.type === "PROGRAM" && r.tags.includes(tag); }).sort();
}
function addToHand(m: TurnMutation, id: CardInstanceId, forced: boolean) {
    const current = m.state.resolution.current!;
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    moveCardLocation(m, id, "HAND");
}
/** 11.10.2.1.1: trash each card individually (an empty deck stops trashing, without a loss: only drawing loses, 1.14). Then one tagged
 * Program from the trash: none does nothing, a lone one is added without a choice, and 2 or more pause for the controller's choice. */
export function resolveTrashThenAddProgram(m: TurnMutation, effect: TrashThenAdd, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, actor = s.resolution.current!.controllerId, deck = s.players[actor].zones.DECK;
    for (let i = 0; i < effect.count && deck.length; i++) moveCardLocation(m, deck[0], "TRASH");
    const targets = trashProgramTargets(s, m.context);
    if (targets.length > 1) return offer(m);
    if (targets.length === 1) addToHand(m, targets[0], true);
    return success(null);
}
export function chooseTrashProgram(m: TurnMutation, id: CardInstanceId): Result<null> {
    if (!trashProgramTargets(m.state, m.context).includes(id)) return failure("INVALID_TRASH_TARGET", "Choose a tagged Program in your trash");
    m.state.resolution.choice = null;
    addToHand(m, id, false);
    return success(null);
}
