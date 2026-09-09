import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function fieldLegendsEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.fieldLegends === "FIELD_LEGENDS_V1"; }
/** Full captured simple Go Solo Legend shape. A shared keyword does not admit additional Legend abilities. */
export function supportsFieldLegend(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, policy = context.content.ruleset.gameplay?.turnSlice;
    if (!fieldLegendsEnabled(context) || policy?.cardPlay !== "NONCOMBAT_PLAY_V1" || policy.gear !== "REVIEWED_GEAR_V1" || policy.combat !== "COMBAT_ATTACK_V1" || policy.react !== "COMBAT_REACT_V1" || policy.combatResolution?.version !== "COMBAT_RESOLUTION_V1" || !card?.provenance.reviewed || card.execution?.scope !== "FIELD_LEGENDS_V1" || card.execution.status !== "SUPPORTED" || card.type !== "LEGEND" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 5 || card.power !== 8 || !card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["BLUE"]) || canonicalSerialize(card.ram) !== canonicalSerialize({ BLUE: 2 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Corpo", "Merc"]) || card.keywords.length || !m || m.equip || m.abilities.length || m.modifiers.length || m.restrictions?.length || canonicalSerialize(m.keywords) !== canonicalSerialize(["GO_SOLO"]))
        return failure("UNSUPPORTED_FIELD_LEGEND", "Full reviewed sellable Blue RAM2 Corpo/Merc Legend, cost5 power8, Go Solo only, and explicit field-Legend policy required");
    return success(null);
}
export function validateFieldLegendMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r?.execution?.scope === "FIELD_LEGENDS_V1" || r?.type === "LEGEND" && c.zone.zone === "BATTLEFIELD" && context.content.ruleset.gameplay?.turnSlice) {
            const valid = supportsFieldLegend(r, context); if (!valid.ok) return valid;
            if (c.zone.zone === "BATTLEFIELD" && (c.face !== "UP" || c.zone.playerId !== c.controllerId || c.ownerId !== c.controllerId || new Set(c.statuses).size !== c.statuses.length)) return failure("INVALID_FIELD_LEGEND", "Reviewed field Legends are public, retain owner/controller and occur in that controller's field");
        }
    }
    return success(null);
}
