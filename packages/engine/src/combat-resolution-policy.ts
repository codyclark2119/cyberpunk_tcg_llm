import type { EngineContext } from "./state";
export function combatResolutionEnabled(context: EngineContext) {
    return context.content.ruleset.gameplay?.turnSlice?.combatResolution?.version === "COMBAT_RESOLUTION_V1";
}
/** 2.10.1 changes references/comparisons, never the additive derived characteristic. */
export function referencedPower(power: number) { return Math.max(0, power); }
export function getGigStealAllowance(power: number, context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.turnSlice?.combatResolution?.gigSteal;
    if (!policy) throw new Error("UNSUPPORTED_COMBAT_RESOLUTION");
    return referencedPower(power) === 0 ? policy.nonPositive : Math.floor(power / policy.positiveDivisor + policy.positiveBase);
}
