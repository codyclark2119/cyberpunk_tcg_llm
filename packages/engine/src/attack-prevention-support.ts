import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { restrictionsEnabled } from "./restriction-support";
export function attackPreventionEnabled(context: EngineContext) { return restrictionsEnabled(context) && context.content.ruleset.gameplay?.turnSlice?.attackPrevention === "ATTACK_PREVENTION_V1"; }
/** Complete reviewed persistent Unit shape; no trigger, action, arbitrary predicate or card-name dispatch. */
export function supportsAttackPreventionUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, policy = context.content.ruleset.gameplay?.turnSlice;
    if (!attackPreventionEnabled(context) || policy?.combat !== "COMBAT_ATTACK_V1" || policy.combatResolution?.version !== "COMBAT_RESOLUTION_V1" || !card?.provenance.reviewed || card.execution?.scope !== "ATTACK_PREVENTION_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 5 || card.power !== 7 || card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["YELLOW"]) || !card.ram || canonicalSerialize(card.ram) !== canonicalSerialize({ YELLOW: 1 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["NCPD"]) || card.keywords.length || !m || m.equip || m.keywords.length || m.restrictions?.length || m.abilities.length || canonicalSerialize(m.modifiers) !== canonicalSerialize([{ kind: "RIVAL_LAGGING_UNITS_CANNOT_ATTACK" }]))
        return failure("UNSUPPORTED_ATTACK_PREVENTION", "Complete reviewed unsellable Yellow RAM1 NCPD Unit with cost5/power7 and only rival lagging-attack prevention required");
    return success(null);
}
/** Hidden sources are validated too; external states cannot silently omit unsupported prevention behavior. */
export function validateAttackPreventionMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "ATTACK_PREVENTION_V1" || r.mechanics.modifiers.some(m => m.kind === "RIVAL_LAGGING_UNITS_CANNOT_ATTACK"))) {
            const supported = supportsAttackPreventionUnit(r, context); if (!supported.ok) return supported;
            if (c.ownerId !== c.controllerId) return failure("INVALID_ATTACK_PREVENTION_SOURCE", "Owned source required; control changes are not admitted");
        }
    }
    return success(null);
}
