import { failure, success, type CardInstanceId, type PlayerId } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { isBlockerEligible } from "./react-queries";
import { isReactDecision } from "./react-support";
import { finishAttackEffects } from "./combat";

export function declareBlocker(m: TurnMutation, actor: PlayerId, id: CardInstanceId) {
    const s = m.state, c = s.timing.combat;
    if (c.stage !== "RIVAL_REACT" || !isBlockerEligible(s, actor, id, m.context)) return failure("INELIGIBLE_BLOCKER", "Choose a current ready friendly field Blocker during open React");
    s.objects.cards[id].readiness = "SPENT";
    m.emit({ kind: "BLOCKER_SPENT", cardInstanceId: id });
    m.emit({ kind: "BLOCKER_DECLARED", cardInstanceId: id, previousTarget: c.target });
    c.target = { kind: "CARD", cardInstanceId: id }; // 9.9.1: fully replaces previous target; history belongs in events.
    return finishAttackEffects(m);
}
export function passReact(m: TurnMutation, actor: PlayerId) {
    const s = m.state, c = s.timing.combat;
    if (c.stage !== "RIVAL_REACT" || !isReactDecision(s, actor, m.context)) return failure("INVALID_REACT_PASS", "Finish the current reaction and pending choices before passing");
    m.emit({ kind: "RIVAL_REACT_CLOSED", defendingPlayerId: actor, reason: "PASS_REACT" });
    s.timing.combat = { ...c, stage: "COMBAT_RESOLUTION_PENDING" };
    s.timing.step = "COMBAT_RESOLUTION_PENDING"; s.timing.window = "COMBAT_RESOLUTION_PENDING";
    m.emit({ kind: "COMBAT_RESOLUTION_PENDING", attackerId: c.attackerId, target: c.target });
    return success(null);
}
