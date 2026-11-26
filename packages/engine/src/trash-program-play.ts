import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsPlay } from "./play-support";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { playPaymentAmount } from "./play-cost-support";
import { paymentCandidates } from "./payment";

type Step = (m: TurnMutation) => Result<null>;
const KIND = "PLAY_TRASH_PROGRAM_THEN_BOTTOM_DECK";
/** Batch V94: content holding the reviewed Legend that plays a Program from its controller's trash. */
export function trashProgramPlayEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.type === "LEGEND" && r.mechanics.abilities.some(a => a.effects.some(e => e.kind === KIND)) && supportsLegendSpendCard(r, context).ok);
}
/** "Play a Program from your trash ... (You still pay its cost.)": the controller's face-up trash Programs the engine can play, whose
 * cost (with any reduction, as a hand play reads it) can be paid now, in id order. */
export function trashPlayTargets(state: GameState, actor: PlayerId, context: EngineContext): CardInstanceId[] {
    return (state.players[actor]?.zones.TRASH ?? []).filter(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context), amount = playPaymentAmount(state, actor, id, context);
        return c?.face === "UP" && c.ownerId === actor && r?.type === "PROGRAM" && supportsPlay(r, context).ok && amount !== null && (amount === 0 || paymentCandidates(state, actor, context, amount, []).length > 0);
    }).sort();
}
export function currentTrashPlayTargets(state: GameState, context: EngineContext) {
    const e = state.resolution.current;
    return e?.effect.kind === KIND ? trashPlayTargets(state, e.controllerId, context) : [];
}
/** With none nothing is played; a lone Program is taken without a choice; the play itself begins once the ability has resolved. */
export function beginTrashProgramPlay(m: TurnMutation, offer: Step): Result<null> {
    const targets = currentTrashPlayTargets(m.state, m.context);
    if (!targets.length) return success(null);
    return targets.length > 1 ? offer(m) : selectTrashProgram(m, targets[0], true);
}
export function selectTrashProgram(m: TurnMutation, id: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current!;
    if (!currentTrashPlayTargets(s, m.context).includes(id)) return failure("INVALID_TRASH_PLAY", "Choose a Program in your trash whose cost you can pay");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    s.resolution.playContinuation!.trashProgramId = id;
    return success(null);
}
/** A chosen trash Program never survives to a decision; a play from the trash is a Program's, under the reviewed Legend. */
export function validateTrashProgramPlay(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation;
    if (c?.trashProgramId) return failure("INVALID_TRASH_PLAY", "A chosen trash Program is played at once");
    if (c?.fromTrash && (c.kind !== "PLAY" || cardRevision(state, c.sourceId, context)?.type !== "PROGRAM" || !trashProgramPlayEnabled(context)))
        return failure("INVALID_TRASH_PLAY", "Only a Program is played from the trash, by its reviewed Legend");
    return success(null);
}
