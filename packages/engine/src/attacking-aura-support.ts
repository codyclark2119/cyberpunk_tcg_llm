import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function attackingAuraEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.attackingAura === "ATTACKING_AURA_V1"; }
/** Complete reviewed persistent Legend shape; no trigger, action, arbitrary predicate or card-name dispatch. */
export function supportsAttackingAuraLegend(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, policy = context.content.ruleset.gameplay?.turnSlice;
    if (!attackingAuraEnabled(context) || policy?.combat !== "COMBAT_ATTACK_V1" || policy.combatResolution?.version !== "COMBAT_RESOLUTION_V1" || !card?.provenance.reviewed || card.execution?.scope !== "ATTACKING_AURA_V1" || card.execution.status !== "SUPPORTED" || card.type !== "LEGEND" || card.printedCost.kind !== "DASH" || card.power !== undefined || !card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["GREEN"]) || !card.ram || canonicalSerialize(card.ram) !== canonicalSerialize({ GREEN: 2 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Arasaka", "Corpo"]) || card.keywords.length || !m || m.equip || m.keywords.length || m.restrictions?.length || m.abilities.length || canonicalSerialize(m.modifiers) !== canonicalSerialize([{ kind: "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER", amount: 1 }]))
        return failure("UNSUPPORTED_ATTACKING_AURA", "Complete reviewed sellable Green RAM2 Arasaka/Corpo Legend with Null cost/power and only friendly attacking Arasaka Unit +1 required");
    return success(null);
}
/** Hidden sources are validated too; external states cannot silently omit unsupported aura behavior. */
export function validateAttackingAuraMetadata(state: GameState, context: EngineContext) {
    const unique = new Set<string>();
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "ATTACKING_AURA_V1" || r.mechanics.modifiers.some(m => m.kind === "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER"))) {
            const supported = supportsAttackingAuraLegend(r, context); if (!supported.ok) return supported;
            const key = c.ownerId + "/" + r.deckbuildingIdentity;
            if (unique.has(key) || c.ownerId !== c.controllerId || !["LEGENDS", "REMOVED"].includes(c.zone.zone)) return failure("INVALID_ATTACKING_AURA_SOURCE", "Unique owned Legend in LEGENDS or inactive REMOVED required; field play/control changes are not admitted");
            unique.add(key);
        }
    }
    return success(null);
}
