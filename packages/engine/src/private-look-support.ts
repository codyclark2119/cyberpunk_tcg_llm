import { failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
/** The pinned content scope opts into observation-derived action identities; no new global gameplay flag. */
export function privateInformationEnabled(context: EngineContext) {
    return context.content.ruleset.gameplay?.turnSlice?.combatTriggers === "COMBAT_TRIGGERS_V1" && context.content.cards.some(c => c.execution?.scope === "GEAR_PRIVATE_LOOK_V1");
}
export function supportsPrivateLookGear(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.turnSlice;
    if (!privateInformationEnabled(context) || policy?.gear !== "REVIEWED_GEAR_V1" || !card || !card.provenance.reviewed || card.execution?.scope !== "GEAR_PRIVATE_LOOK_V1" || card.execution.status !== "SUPPORTED" || card.type !== "GEAR" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 1 || card.power !== 1)
        return failure("UNSUPPORTED_PRIVATE_LOOK_GEAR", "Reviewed private-look scope, trigger/equip policies and complete printed cost/power required");
    const m = card.mechanics, a = m.abilities[0];
    if (m.equip?.kind !== "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" || m.keywords.length || m.restrictions?.length || m.modifiers.length !== 1 || m.modifiers[0].kind !== "GRANT_PRINTED_POWER_TO_HOST" || m.abilities.length !== 1 || a.trigger !== "WHEN_ATTACKING" || a.inherited !== "EQUIPPED_HOST" || a.activation || a.guard || a.conditions.length || a.cost.kind !== "NONE" || a.effects.length !== 1 || a.effects[0].kind !== "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND")
        return failure("UNSUPPORTED_PRIVATE_LOOK_GEAR", "Complete default equip, printed-power inheritance and inherited friendly face-down Legend ATTACK look required");
    return success(null);
}
/** Old scopes cannot smuggle private-look metadata through a hidden card. */
export function validatePrivateLookMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "GEAR_PRIVATE_LOOK_V1" || r.mechanics.abilities.some(a => a.effects.some(e => e.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND")))) {
            const supported = supportsPrivateLookGear(r, context); if (!supported.ok) return supported;
        }
    }
    return success(null);
}
