import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function attackConditionPowerEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.attackConditionPower === "ATTACK_CONDITION_POWER_V1"; }
/** Entire reviewed Unit shape. No card-name dispatch or expansion of Floor It's admission. */
export function supportsAttackConditionPowerCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], policy = context.content.ruleset.gameplay?.turnSlice;
    if (!attackConditionPowerEnabled(context) || policy?.cardPlay !== "NONCOMBAT_PLAY_V1" || policy.combatTriggers !== "COMBAT_TRIGGERS_V1" || policy.react !== "COMBAT_REACT_V1" || policy.combatResolution?.version !== "COMBAT_RESOLUTION_V1" || !card?.provenance.reviewed || card.execution?.scope !== "ATTACK_CONDITION_POWER_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 4 || card.power !== 4 || card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["GREEN"]) || canonicalSerialize(card.ram) !== canonicalSerialize({ GREEN: 3 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Arasaka", "Corpo"]) || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_ATTACKING" || a.activation || a.inherited || a.guard || a.cost.kind !== "NONE" || canonicalSerialize(a.conditions) !== canonicalSerialize([{ kind: "ALL_FRIENDLY_LEGENDS_FACE_UP" }]) || canonicalSerialize(a.effects) !== canonicalSerialize([{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "SOURCE_SUBJECT" }, amount: 5 }]))
        return failure("UNSUPPORTED_ATTACK_CONDITION_POWER", "Complete reviewed Green RAM3 cost4/power4 unsellable Arasaka/Corpo Unit with conditional ATTACK self+5 this turn required");
    return success(null);
}
export function hasAttackConditionPowerMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.execution?.scope === "ATTACK_CONDITION_POWER_V1" || card.mechanics.abilities.some(a => a.conditions.some(c => c.kind === "ALL_FRIENDLY_LEGENDS_FACE_UP") || a.effects.some(e => e.kind === "POWER_UNTIL_END_OF_TURN" && (e.target.kind === "SOURCE_SUBJECT" || e.amount !== -1) || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "ALL_FRIENDLY_LEGENDS_FACE_UP" || e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "ALL_FRIENDLY_LEGENDS_FACE_UP"));
}
export function validateAttackConditionPowerMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasAttackConditionPowerMetadata(r)) { const v = supportsAttackConditionPowerCard(r, context); if (!v.ok) return v; }
    }
    return success(null);
}
