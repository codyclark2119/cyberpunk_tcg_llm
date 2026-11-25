import { failure, success, type GameState, type PendingChoice, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsCall } from "./effect-support";
import { testCondition } from "./conditions";
import { grantLegendKnowledge, privateLookTargets } from "./private-knowledge";

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
/** Batch V85: a Program's free Call, after its condition ("If you control a min Gig") is checked as it resolves; with no Legend to
 * Call it does nothing. */
export function beginProgramFreeCall(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const current = m.state.resolution.current!, condition = current.effect.kind === "MAY_CALL_LEGEND_FREE" ? current.effect.condition : undefined;
    if (condition) {
        const met = testCondition(m.state, current.controllerId, condition, m.context, current.sourceId);
        m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
        if (!met) return success(null);
    }
    return freeCallSlots(m.state, current.controllerId, m.context).length ? offer(m) : success(null);
}
/** Batch V84, V86: a trigger's free Call, after "Look at all friendly face-down Legends" when printed; with no Legend to Call it
 * completes. */
export function beginTriggerFreeCall(m: TurnMutation): Result<boolean> {
    const current = m.state.resolution.current!, actor = current.controllerId;
    if (current.effect.kind === "MAY_CALL_LEGEND_FREE" && current.effect.lookAtAll)
        for (const slot of privateLookTargets(m.state, actor, m.context)) { const looked = grantLegendKnowledge(m, actor, slot); if (!looked.ok) return looked; }
    return success(freeCallSlots(m.state, actor, m.context).length > 0);
}
/** The decline, or a public Legend slot. */
export function chooseFreeCall(m: TurnMutation, option: PendingChoice["options"][number]): Result<null> {
    const current = m.state.resolution.current!;
    if (option.kind === "CONFIRM" && !option.confirmed) { m.emit({ kind: "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: current.controllerId }); return success(null); }
    if (option.kind !== "LEGEND_SLOT") return failure("INVALID_FREE_CALL", "Choose a public Legend slot or decline");
    return callLegendFree(m, option.slot);
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
/** Run by the action's end (Batch V86: or the attack's end): the queued {Call} ability starts as an ordinary Call's would, returning to
 * the same Main Phase, with its controller acting (Batch V86: who may be the non-active player); once it has resolved, the turn player
 * acts again. */
export function startQueuedCall(m: TurnMutation): Result<null> | null {
    const h = m.state.turnHistory, queued = h?.queuedCall;
    if (!queued) return null;
    if (queued.started || m.state.match.outcome) { delete h.queuedCall; m.state.timing.actingPlayer = m.state.timing.activePlayer; return null; }
    queued.started = true;
    m.state.resolution.returnTo = { kind: "MAIN" };
    m.state.timing.actingPlayer = queued.playerId;
    return m.startCallAbility(queued.playerId, queued.legendId);
}
/** The {Call} ability of a queued Call in progress, for the Legend activation and return-context validators. */
export function startedQueuedCall(state: GameState) {
    const q = state.turnHistory?.queuedCall;
    return q?.started ? q : undefined;
}
/** A queued Call waits for its action's trigger batches (or its attack) to end, then resolves its {Call} ability in the Main Phase. Its
 * Legend is face up, Called this turn, and has a supported {Call} ability. */
export function validateQueuedCall(state: GameState, context: EngineContext) {
    const q = state.turnHistory?.queuedCall, r = state.resolution;
    if (!q) return success(null);
    const legend = state.objects.cards[q.legendId], revision = cardRevision(state, q.legendId, context);
    const waiting = !q.started && (r.triggerContinuation || state.timing.combat.stage !== "NONE");
    const resolving = q.started && state.timing.combat.stage === "NONE" && r.returnTo?.kind === "MAIN" && (r.playContinuation?.sourceId === q.legendId || r.searchContinuation || r.triggerContinuation);
    if (!state.players[q.playerId] || !(waiting || resolving) || !legend || legend.face !== "UP" || legend.zone.zone !== "LEGENDS"
        || legend.zone.playerId !== q.playerId || legend.controllerId !== q.playerId || !(state.players[q.playerId].economy.callsThisTurn! >= 1)
        || !revision?.mechanics.abilities.some(a => a.trigger === "WHEN_CALLED") || !supportsCall(revision, context).ok)
        return failure("INVALID_QUEUED_CALL", "A queued {Call} needs its face-up Called Legend and its {Call} ability, waiting for its action or attack to end, or resolving in the Main Phase");
    return success(null);
}
