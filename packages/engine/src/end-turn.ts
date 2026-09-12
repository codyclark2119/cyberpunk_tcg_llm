import { enterOvertimeAfterTurn, overtimeEnabled } from "./overtime";
import { delayedEffectsEnabled } from "./delayed-effect-support";
import { takeEndTurnOrigin } from "./delayed-effects";
import { failure } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { beginTriggers } from "./trigger-resolution";
import { endTurnEnabled } from "./end-turn-support";
import { expireTemporaryPower } from "./temporary-power";
import { expireFightPreventions } from "./fight-prevention";
export function endTurn(m: TurnMutation) {
    // Historical policy pins retain their atomic preflight; supported overtime waits for all end work.
    if (!overtimeEnabled(m.context) && (m.state.timing.emptyFixerStarts ?? 0) >= 2) return failure("UNSUPPORTED_OVERTIME", "Two consecutive starts with both Fixers empty; overtime requires a reviewed implementation");
    m.phase("TURN_END");
    return endTurnEnabled(m.context) || delayedEffectsEnabled(m.context) ? beginTriggers(m, takeEndTurnOrigin(m)) : finishEndTurn(m);
}
/** 8.16.1 pending card effects finish BEFORE 8.16.2 expiration and 8.18 next turn.
 * The old cleanup event ordering is retained. No second END_TURN or intermediate MAIN. */
export function finishEndTurn(m: TurnMutation) {
    const s = m.state, actor = s.timing.activePlayer;
    if (m.context.content.ruleset.gameplay?.turnSlice?.cardPlay === "NONCOMBAT_PLAY_V1")
        for (const card of Object.values(s.objects.cards)) if (card.statuses.includes("LAG")) {
            card.statuses = card.statuses.filter(status => status !== "LAG");
            m.emit({ kind: "LAG_REMOVED", cardInstanceId: card.id });
        }
    expireTemporaryPower(m); expireFightPreventions(m);
    m.emit({ kind: "TURN_ENDED", playerId: actor, turn: s.timing.turn });
    if (enterOvertimeAfterTurn(m)) return { ok: true as const, value: null };
    s.timing.activePlayer = s.match.playerOrder[(s.players[actor].seat + 1) % s.match.playerOrder.length]; s.timing.turn++;
    return m.startTurn(); // Resets the complete current-turn history and CALL/SELL usage exactly here.
}
