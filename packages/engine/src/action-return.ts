import { failure, success, type ActionReturnContext, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { finishAttackEffects } from "./combat";
import { reactEnabled } from "./react-support";

export function actionReturnContext(state: GameState): ActionReturnContext {
    return state.resolution.returnTo ?? { kind: state.timing.combat.stage === "RIVAL_REACT" ? "RIVAL_REACT" : "MAIN" };
}
export function validateActionReturn(state: GameState, context: EngineContext) {
    const r = state.resolution, destination = r.returnTo;
    const continuation = r.playContinuation || r.callContinuation || r.searchContinuation;
    if (!continuation) return destination ? failure("INVALID_RETURN_CONTEXT", "Return context requires an unfinished action") : success(null);
    if (state.timing.combat.stage === "RIVAL_REACT") {
        if (!reactEnabled(context) || destination?.kind !== "RIVAL_REACT" || state.timing.actingPlayer === state.timing.activePlayer) return failure("INVALID_RETURN_CONTEXT", "Defender continuation must explicitly return to React");
    } else if (state.timing.combat.stage !== "NONE" || (destination && destination.kind !== "MAIN") || state.timing.actingPlayer !== state.timing.activePlayer) return failure("INVALID_RETURN_CONTEXT", "Noncombat continuation must return to active-player MAIN");
    return success(null);
}
export function finishAction(m: TurnMutation) {
    const destination = actionReturnContext(m.state);
    m.state.resolution = { stage: "STATE_BASED_CHECKS", current: null, pending: [], discovered: [], choice: null };
    if (destination.kind === "RIVAL_REACT") return finishAttackEffects(m);
    m.phase("MAIN");
    return success(null);
}
