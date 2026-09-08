import { failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
export function combatEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.combat === "COMBAT_ATTACK_V1"; }
/** Entire reviewed Swordwise shape, including its only trigger and resolution-time condition. */
export function supportsAttackPlay(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (!combatEnabled(context) || !card || card.type !== "UNIT" || card.execution?.scope !== "COMBAT_ATTACK_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount > 1000 || card.power === undefined || card.mechanics.restrictions?.length || card.mechanics.equip || card.mechanics.keywords.length || card.mechanics.modifiers.length || card.mechanics.abilities.length !== 1)
        return failure("UNSUPPORTED_ATTACK_CARD", "Complete reviewed attack scope, Unit cost/power and mechanics required");
    const a = card.mechanics.abilities[0], e = a.effects[0];
    return a.trigger === "WHEN_ATTACKING" && !a.activation && a.cost.kind === "NONE" && !a.conditions.length && a.effects.length === 1 && e.kind === "CONDITIONAL_DRAW" && e.timing === "RESOLUTION" && e.condition.kind === "SOURCE_POWER_AT_LEAST" && e.condition.minimum === 5 && e.count === 1
        ? success(null) : failure("UNSUPPORTED_ATTACK_CARD", "Only the reviewed attack/power-condition/draw shape is supported");
}
