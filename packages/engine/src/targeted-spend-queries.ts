import type { GameState, PlayerId, SpendUnitTarget } from "@tcg/domain";
import type { EngineContext } from "./state";
import { referencedCost } from "./cost-value";
import { isUnitSpendSubject } from "./unit-spend";
import { targetedSpendEnabled } from "./targeted-spend-support";
/** Corporate Surveillance FAQ00513475 permits SPENT targets; readiness is NOT a selector filter. */
export function listSpendUnitTargets(state: GameState, actor: PlayerId, target: SpendUnitTarget, context: EngineContext) {
    if (!targetedSpendEnabled(context)) return [];
    return Object.values(state.objects.cards).filter(c => {
        if (!isUnitSpendSubject(state, c.id, context) || target.relation === "RIVAL" && c.controllerId === actor || target.relation === "CONTROLLED" && c.controllerId !== actor) return false;
        const cost = referencedCost(state, c.id, context);
        return cost !== null && cost <= target.costAtMost;
    }).map(c => c.id).sort();
}
