import { otherPlayerMayChoose } from "./rival-reveal";
import { failure, success, type ActionReturnContext, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { finishAttackEffects } from "./combat";
import { reactEnabled } from "./react-support";
import { beginTriggers } from "./trigger-resolution";
import { spentSubjects } from "./spend-triggers";
import { startQueuedCall, startedQueuedCall } from "./free-call-effect";

export function actionReturnContext(state: GameState): ActionReturnContext {
    return state.resolution.returnTo ?? { kind: state.timing.combat.stage === "RIVAL_REACT" ? "RIVAL_REACT" : "MAIN" };
}
export function validateActionReturn(state: GameState, context: EngineContext) {
    const r = state.resolution, destination = r.returnTo;
    // Batch V19: an attack-trigger search belongs to its trigger batch, which trigger-state validates.
    const continuation = r.legendEntryContinuation || r.playContinuation || r.callContinuation || (!r.triggerContinuation && r.searchContinuation);
    if (!continuation) return destination ? failure("INVALID_RETURN_CONTEXT", "Return context requires an unfinished action") : success(null);
    if (state.timing.combat.stage === "RIVAL_REACT") {
        if (!reactEnabled(context) || destination?.kind !== "RIVAL_REACT" || state.timing.actingPlayer === state.timing.activePlayer) return failure("INVALID_RETURN_CONTEXT", "Defender continuation must explicitly return to React");
    // Batch V77: a Rival-choice reveal hands only its choice to the Rival (play-state checks the exact pause).
    } else if (state.timing.combat.stage !== "NONE" || (destination && destination.kind !== "MAIN") || (state.timing.actingPlayer !== state.timing.activePlayer && !otherPlayerMayChoose(state) && startedQueuedCall(state)?.playerId !== state.timing.actingPlayer /* Batch V86 */ && state.resolution.targetedDefeatContinuation?.phase !== "ORDER" && state.resolution.targetedDefeatContinuation?.phase !== "EACH")) return failure("INVALID_RETURN_CONTEXT", "Noncombat continuation must return to active-player MAIN");
    return success(null);
}
export function finishAction(m: TurnMutation) {
    const destination = actionReturnContext(m.state);
    m.state.resolution = { stage: "STATE_BASED_CHECKS", current: null, pending: [], discovered: [], choice: null };
    // Batch V69: "when spent" bindings no batch of this action took resolve now, before it returns.
    const queued = m.state.turnHistory?.spendTriggers;
    if (queued?.length && !m.state.match.outcome) {
        const c = m.state.timing.combat;
        if (destination.kind === "RIVAL_REACT" && "target" in c && c.target) m.state.timing.combat = { ...c, stage: "RIVAL_REACT" };
        return beginTriggers(m, { kind: "SPEND", spentIds: spentSubjects(queued) });
    }
    if (destination.kind === "RIVAL_REACT") return finishAttackEffects(m);
    // Batch V84: a Legend an effect Called for free resolves its {Call} ability once the action's batches are done.
    const call = startQueuedCall(m);
    if (call) return call;
    m.phase("MAIN");
    return success(null);
}
