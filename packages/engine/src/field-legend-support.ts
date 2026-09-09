import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function fieldLegendsEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.fieldLegends === "FIELD_LEGENDS_V1"; }
/** Complete reviewed variants share one lifecycle. A keyword alone never admits additional Legend text.
 * Shape matching is admission metadata; movement/payment/combat do not branch on a card identity. */
const reviewedShapes = [
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Corpo", "Merc"], power: 8, keywords: ["GO_SOLO"] },
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Arasaka", "Corpo"], power: 7, keywords: ["GO_SOLO", "BLOCKER"] }
];
export function supportsFieldLegend(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, policy = context.content.ruleset.gameplay?.turnSlice;
    if (!fieldLegendsEnabled(context) || policy?.cardPlay !== "NONCOMBAT_PLAY_V1" || policy.gear !== "REVIEWED_GEAR_V1" || policy.combat !== "COMBAT_ATTACK_V1" || policy.react !== "COMBAT_REACT_V1" || policy.combatResolution?.version !== "COMBAT_RESOLUTION_V1" || !card?.provenance.reviewed || card.execution?.scope !== "FIELD_LEGENDS_V1" || card.execution.status !== "SUPPORTED" || card.type !== "LEGEND" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 5 || card.power === undefined || !card.sellProfile.allowed || card.keywords.length || !m || m.equip || m.abilities.length || m.modifiers.length || m.restrictions?.length || !reviewedShapes.some(shape => canonicalSerialize(shape) === canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, power: card.power, keywords: m.keywords })))
        return failure("UNSUPPORTED_FIELD_LEGEND", "Complete reviewed cost5 Go Solo Legend variant (Blue RAM2 Corpo/Merc power8, or Green RAM2 Arasaka/Corpo power7 with printed Blocker) and explicit field-Legend policy required");
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
