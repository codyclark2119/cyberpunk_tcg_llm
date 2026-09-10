import { failure, success, type CardInstanceId, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { offerPlayChoice } from "./play";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import { spendUnitForEffect } from "./unit-spend";
export function resolveSpendTarget(m: TurnMutation, targetId: CardInstanceId, forced = false): Result<null> {
    const current = m.state.resolution.current;
    if (current?.effect.kind !== "SPEND_UNIT" || !current.sourceId || !listSpendUnitTargets(m.state, current.controllerId, current.effect.target, m.context).includes(targetId)) return failure("INVALID_SPEND_TARGET", "Choose a current qualifying rival effective Unit");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    const spent = spendUnitForEffect(m, targetId, current.sourceId, current.id);
    return spent.ok ? success(null) : spent;
}
export function beginTargetedSpend(m: TurnMutation): Result<null> {
    const current = m.state.resolution.current!;
    if (current.effect.kind !== "SPEND_UNIT") return failure("INVALID_SPEND_EFFECT", "Expected typed spend primitive");
    const targets = listSpendUnitTargets(m.state, current.controllerId, current.effect.target, m.context);
    return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? resolveSpendTarget(m, targets[0], true) : success(null);
}
