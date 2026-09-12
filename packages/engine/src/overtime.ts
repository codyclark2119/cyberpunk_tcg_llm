import { failure, success, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";

export const overtimeEnabled = (context: EngineContext) => context.content.ruleset.gameplay?.turnSlice?.overtime === "STANDARD_OVERTIME_V1";
/** Original Fixer objects, independent of current Gig control or Street Cred. */
export function areBothFixersEmpty(state: GameState) {
    return state.match.playerOrder.length === 2 && state.match.playerOrder.every(id =>
        !Object.values(state.objects.gigs).some(g => g.ownerId === id && g.location.zone === "FIXER"));
}
export const controlledGigCount = (state: GameState, playerId: GameState["timing"]["activePlayer"]) =>
    Object.values(state.objects.gigs).filter(g => g.controllerId === playerId && g.location.zone === "GIGS" && g.roll.kind === "ROLLED").length;
export function recordOvertimeTurnStart(m: TurnMutation) {
    const s = m.state;
    if (s.match.outcome || s.match.overtime) return;
    const count = areBothFixersEmpty(s) ? (s.timing.emptyFixerStarts ?? 0) + 1 : 0;
    // Preserve legacy counter semantics under their immutable UNSUPPORTED policy.
    s.timing.emptyFixerStarts = overtimeEnabled(m.context) ? Math.min(count, 2) : count;
}
/** Run after a complete atomic control-change batch and its semantic facts, before any continuation. */
export function checkOvertimeVictory(m: TurnMutation): boolean {
    const s = m.state;
    if (!overtimeEnabled(m.context) || !s.match.overtime || s.match.outcome) return false;
    const winner = s.match.playerOrder.find(id => controlledGigCount(s, id) >= 7);
    if (!winner) return false; // Two winners require >=14 dice; validated two-player states have exactly 12.
    m.finish(winner, s.match.playerOrder.find(id => id !== winner)!, "OVERTIME_GIGS");
    return true;
}
/** 8.16 effects and expiration have finished; 8.17 precedes the 8.18 next turn. */
export function enterOvertimeAfterTurn(m: TurnMutation): boolean {
    const s = m.state;
    if (!overtimeEnabled(m.context) || s.match.overtime || s.match.outcome || s.timing.emptyFixerStarts !== 2) return false;
    s.match.overtime = { startedAfterTurn: s.timing.turn };
    delete s.timing.emptyFixerStarts; // Qualification history no longer drives an active match phase.
    m.emit({ kind: "OVERTIME_STARTED", turn: s.timing.turn });
    return checkOvertimeVictory(m);
}
export function validateOvertimeState(s: GameState, context: EngineContext) {
    const active = s.match.overtime, count = s.timing.emptyFixerStarts;
    if (!overtimeEnabled(context)) return active || s.match.outcome?.reason === "OVERTIME_GIGS"
        ? failure("UNSUPPORTED_OVERTIME_STATE", "Overtime state requires its pinned supported policy") : success(null);
    if (s.setup) return active || count !== undefined
        ? failure("INVALID_OVERTIME_STATE", "Setup has no qualifying turn or active overtime") : success(null);
    if (s.match.outcome && (s.timing.combat.stage !== "NONE" || s.resolution.stage !== "DECISION" ||
        s.resolution.current || s.resolution.pending.length || s.resolution.discovered.length || s.resolution.choice ||
        Object.keys(s.resolution).some(k => !["stage", "current", "pending", "discovered", "choice"].includes(k)) || s.delayedEffects))
        return failure("INVALID_OVERTIME_TERMINAL_STATE", "Terminal match state cannot retain effects, choices or continuations");
    if (active) {
        if (count !== undefined || active.startedAfterTurn > s.timing.turn ||
            (active.startedAfterTurn === s.timing.turn && s.timing.step !== "TURN_END" && s.timing.step !== "FINISHED"))
            return failure("INVALID_OVERTIME_STATE", "Active overtime replaces progress after a completed qualifying turn");
        if (active.startedAfterTurn === s.timing.turn && (s.resolution.current || s.resolution.pending.length || s.resolution.discovered.length || s.resolution.choice))
            return failure("INVALID_OVERTIME_STATE", "Entry cannot precede pending end-turn work");
        if (s.match.outcome?.reason === "START_TURN_GIGS") return failure("INVALID_OVERTIME_OUTCOME", "Active overtime uses immediate victory, not the normal turn-start reason");
        // Historical starts cannot be reconstructed from later boards. Do not require future Fixer monotonicity.
        const winner = s.match.playerOrder.find(id => controlledGigCount(s, id) >= 7);
        if (winner && (!s.match.outcome || s.match.outcome.winnerId !== winner || s.match.outcome.reason !== "OVERTIME_GIGS"))
            return failure("UNRESOLVED_OVERTIME_WIN", "Seven controlled Gigs must terminate in the same atomic batch");
    } else if (count === undefined || count > 2 || count > s.timing.turn || s.timing.turn < 1)
        return failure("INVALID_OVERTIME_PROGRESS", "Playing states require zero, one or two recorded consecutive starts");
    if (s.match.outcome?.reason === "OVERTIME_GIGS" && (!active || controlledGigCount(s, s.match.outcome.winnerId) < 7))
        return failure("INVALID_OVERTIME_OUTCOME", "Overtime victory requires its active phase and seven controlled Gigs");
    return success(null);
}
