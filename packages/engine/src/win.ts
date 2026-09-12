import { controlledGigCount, overtimeEnabled } from "./overtime";
import { failure, success, type GameState, type PlayerId, type Result } from "@tcg/domain";
import { validateState, type EngineContext } from "./state";
/** Checkpoints are explicit; handlers never implement their own victory arithmetic. */
export function evaluateWinConditions(state: GameState, context: EngineContext, checkpoint: "STABLE_DECISION" | "TURN_START" = "STABLE_DECISION"): Result<PlayerId[]> {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    const policy = context.content.ruleset.gameplay;
    if (policy?.turnSlice) {
        if (overtimeEnabled(context) && state.match.overtime) return success(state.match.playerOrder.filter(id => controlledGigCount(state, id) >= 7));
        if (checkpoint !== "TURN_START")
            return success([]);
        const actor = state.timing.activePlayer;
        const count = Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED").length;
        return success(count >= policy.turnSlice.startTurnGigWinCount ? [actor] : []);
    }
    if (!policy?.win || policy.win === "UNSUPPORTED")
        return failure("UNSUPPORTED_WIN_POLICY", "Win threshold/timing requires reviewed policy");
    if (state.resolution.stage !== "DECISION")
        return failure("UNSTABLE_STATE", "Win check requires stable decision state");
    const threshold = policy.win.streetCred;
    const winners = state.match.playerOrder.filter(id => Object.values(state.objects.gigs).reduce((sum, g) => sum + (g.controllerId === id && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" ? g.roll.currentValue : 0), 0) >= threshold);
    return winners.length > 1 ? failure("UNSUPPORTED_SIMULTANEOUS_WIN", "Tie resolution is not defined") : success(winners);
}
