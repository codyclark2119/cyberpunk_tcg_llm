import { failure, success, type CardInstanceId, type GameState, type PendingChoice, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsPlay } from "./play-support";
import { supportsFreePlayCard } from "./free-play-support";
import { startPlay } from "./play";

type Option = PendingChoice["options"][number];
const KIND = "MAY_PLAY_PROGRAM_FREE_FROM_HAND_OR_TRASH_THEN_BOTTOM_DECK";
/** Batch V97: content holding the reviewed Unit whose {Play} trigger plays a Program for free from hand or trash. */
export function queuedProgramPlayEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.effects.some(e => e.kind === KIND)) && supportsFreePlayCard(r, context).ok);
}
/** A Program `player` may play this way: in hand, or face up in the trash, owned, with printed cost 3 or less, and playable by the engine. */
function eligibleProgram(state: GameState, player: string, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], r = cardRevision(state, id, context);
    return Boolean(c && c.ownerId === player && c.controllerId === player && c.zone.playerId === player && (c.zone.zone === "HAND" || c.zone.zone === "TRASH" && c.face === "UP")
        && r?.type === "PROGRAM" && r.printedCost.kind === "EDDIES" && r.printedCost.amount <= 3 && supportsPlay(r, context).ok);
}
/** "A Program with cost 3 or less from your hand or trash": the controller's eligible Programs, in id order; none while another play
 * is queued, or for a controller who is not the turn player (fail-closed: one queued play at a time, in the turn player's own Main
 * Phase; the snapshot can produce neither). */
export function freeProgramTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const current = state.resolution.current, player = current?.controllerId;
    if (current?.effect.kind !== KIND || !current.trigger || !player || !state.players[player] || player !== state.timing.activePlayer || state.turnHistory?.queuedProgramPlay) return [];
    const z = state.players[player].zones;
    return [...z.HAND, ...z.TRASH].filter(id => eligibleProgram(state, player, id, context)).sort();
}
export function freeProgramOptions(state: GameState, context: EngineContext): Option[] {
    return [{ kind: "CONFIRM", confirmed: false }, ...freeProgramTargets(state, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))];
}
/** "You may play": the decline, or the chosen Program, which is played once the action's trigger batches are done (as a free Call's
 * {Call} ability waits, batch V84), since a Program cannot resolve inside a trigger batch. */
export function chooseFreeProgram(m: TurnMutation, option: Option): Result<null> {
    const current = m.state.resolution.current!;
    if (option.kind === "CONFIRM" && !option.confirmed) { m.emit({ kind: "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: current.controllerId }); return success(null); }
    if (option.kind !== "CARD" || !freeProgramTargets(m.state, m.context).includes(option.cardInstanceId)) return failure("INVALID_FREE_PROGRAM_PLAY", "Choose a Program with cost 3 or less in your hand or trash, or decline");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: option.cardInstanceId, controllerId: current.controllerId, forced: false });
    m.state.turnHistory!.queuedProgramPlay = { playerId: current.controllerId, cardInstanceId: option.cardInstanceId };
    return success(null);
}
/** Run by the action's end (or the attack's end): the queued Program is played for free, from where it is now, with its controller
 * acting; once it has resolved the queue clears and the turn player acts again. A Program that has left hand and trash is not played. */
export function startQueuedProgramPlay(m: TurnMutation): Result<null> | null {
    const h = m.state.turnHistory, q = h?.queuedProgramPlay;
    if (!q) return null;
    if (q.started || m.state.match.outcome || !eligibleProgram(m.state, q.playerId, q.cardInstanceId, m.context)) { delete h.queuedProgramPlay; m.state.timing.actingPlayer = m.state.timing.activePlayer; return null; }
    q.started = true;
    m.state.timing.actingPlayer = q.playerId;
    return startPlay(m, q.playerId, q.cardInstanceId, m.state.objects.cards[q.cardInstanceId].zone.zone === "TRASH" ? "TRASH" : "HAND", true);
}
/** A queued play waits for its action's trigger batches (or its attack) to end, with its Program still eligible; once started, its free
 * Program resolves in the Main Phase. A free bottom-decked play is exactly the started queued Program. */
export function validateQueuedProgramPlay(state: GameState, context: EngineContext) {
    const q = state.turnHistory?.queuedProgramPlay, r = state.resolution, c = r.playContinuation;
    if (c?.freeBottomDeck && (c.kind !== "PLAY" || !q?.started || q.cardInstanceId !== c.sourceId || c.actorId !== q.playerId || cardRevision(state, c.sourceId, context)?.type !== "PROGRAM"))
        return failure("INVALID_QUEUED_PROGRAM_PLAY", "A free bottom-decked Program is the started queued play");
    if (!q) return success(null);
    const waiting = !q.started && (r.triggerContinuation || state.timing.combat.stage !== "NONE") && eligibleProgram(state, q.playerId, q.cardInstanceId, context);
    const resolving = q.started && state.timing.combat.stage === "NONE" && r.returnTo?.kind === "MAIN";
    if (!queuedProgramPlayEnabled(context) || !state.players[q.playerId] || !(waiting || resolving))
        return failure("INVALID_QUEUED_PROGRAM_PLAY", "A queued Program play waits for its action or attack with an eligible Program, or resolves in the Main Phase");
    return success(null);
}
