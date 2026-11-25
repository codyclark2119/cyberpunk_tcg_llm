import { failure, success, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsCall } from "./effect-support";

/** Batch V84: "You may Call a Legend for free. (You can only Call a Legend once per turn.)" The public slots of the controller's
 * face-down Legends they may Call now: none once the turn's Call limit is used. */
export function freeCallSlots(state: GameState, actor: PlayerId, context: EngineContext) {
    const limit = context.content.ruleset.gameplay?.turnSlice?.callLimitPerTurn ?? 0;
    if ((state.players[actor]?.economy.callsThisTurn ?? 0) >= limit) return [];
    return state.players[actor].zones.LEGENDS.flatMap((id, slot) => {
        const c = state.objects.cards[id];
        return c.face === "DOWN" && c.controllerId === actor && c.zone.zone === "LEGENDS" && supportsCall(cardRevision(state, id, context), context).ok ? [slot] : [];
    });
}
/** The Call happens now; the Legend's {Call} ability (a trigger of its own) waits until the action's trigger batches are done. */
export function callLegendFree(m: TurnMutation, slot: number): Result<null> {
    const current = m.state.resolution.current, actor = current?.controllerId;
    if (current?.effect.kind !== "MAY_CALL_LEGEND_FREE" || !actor || !freeCallSlots(m.state, actor, m.context).includes(slot)) return failure("INVALID_FREE_CALL", "Choose a friendly face-down Legend you may Call");
    const legendId = m.state.players[actor].zones.LEGENDS[slot];
    m.revealCalledLegend(actor, legendId);
    if (cardRevision(m.state, legendId, m.context)?.mechanics.abilities.some(a => a.trigger === "WHEN_CALLED")) m.state.turnHistory!.queuedCall = { playerId: actor, legendId };
    return success(null);
}
/** Run by the action's end: the queued {Call} ability starts as an ordinary Call's would, returning to the same Main Phase. */
export function startQueuedCall(m: TurnMutation): Result<null> | null {
    const h = m.state.turnHistory, queued = h?.queuedCall;
    if (!queued) return null;
    delete h.queuedCall;
    if (m.state.match.outcome) return null;
    m.state.resolution.returnTo = { kind: "MAIN" };
    return m.startCallAbility(queued.playerId, queued.legendId);
}
/** A queued Call belongs to the turn player's unfinished Main Phase action: its Legend is face up, Called this turn, and has a
 * supported {Call} ability. */
export function validateQueuedCall(state: GameState, context: EngineContext) {
    const q = state.turnHistory?.queuedCall, r = state.resolution;
    if (!q) return success(null);
    const legend = state.objects.cards[q.legendId], revision = cardRevision(state, q.legendId, context);
    if (q.playerId !== state.timing.activePlayer || state.timing.combat.stage !== "NONE" || !r.triggerContinuation || !legend || legend.face !== "UP" || legend.zone.zone !== "LEGENDS"
        || legend.zone.playerId !== q.playerId || legend.controllerId !== q.playerId || !(state.players[q.playerId].economy.callsThisTurn! >= 1)
        || !revision?.mechanics.abilities.some(a => a.trigger === "WHEN_CALLED") || !supportsCall(revision, context).ok)
        return failure("INVALID_QUEUED_CALL", "A queued {Call} needs its face-up Called Legend and its {Call} ability, while the turn player's action's triggers resolve");
    return success(null);
}
