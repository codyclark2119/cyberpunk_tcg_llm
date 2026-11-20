import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { hasModalChoice } from "./modal-program-support";
import { hasSellTopEffect } from "./program-sell-support";
import { hasFightStealEffect } from "./fight-steal-support";
import { hasFreePlayEffect } from "./free-play-support";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { hasLegendStealTrigger, supportsLegendStealTrigger } from "./legend-steal-support";
import { hasLegendRevealEffect, supportsLegendReveal } from "./legend-reveal-support";
export function fieldLegendsEnabled(context: EngineContext) { return turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "fieldLegends"); }
/** Complete reviewed variants share one lifecycle. A keyword alone never admits additional Legend text.
 * Shape matching is admission metadata; movement/payment/combat do not branch on a card identity. */
const reviewedShapes = [
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Corpo", "Merc"], power: 8, keywords: ["GO_SOLO"] },
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Arasaka", "Corpo"], power: 7, keywords: ["GO_SOLO", "BLOCKER"] }
];
export function supportsFieldLegend(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, policy = context.content.ruleset.gameplay?.turnSlice;
    if (hasModalChoice(card)) return failure("UNSUPPORTED_MODAL_CHOICE", "A modal ability is admitted only by its exact Program pin"); // Batch V44.
    if (hasSellTopEffect(card)) return failure("UNSUPPORTED_EFFECT_SELL", "An effect sell is admitted only by its exact Program pin"); // Batch V45.
    if (hasFightStealEffect(card)) return failure("UNSUPPORTED_FIGHT_STEAL", "A next-fight steal is admitted only by its exact Program pin"); // Batch V47.
    if (hasFreePlayEffect(card)) return failure("UNSUPPORTED_FREE_PLAY", "A free Unit play is admitted only by its exact pin"); // Batch V48.
    // Batch V18: a Go Solo Legend with a {Play} ability is admitted only through its exact targeted-defeat pin.
    if (card?.type === "LEGEND" && card.execution?.scope === "TARGETED_DEFEAT_V1") {
        if (!fieldLegendsEnabled(context) || !turnSliceAllows(policy, "gear") || !turnSliceAllows(policy, "combat") || !turnSliceAllows(policy, "react") || canonicalSerialize(card.mechanics.keywords) !== canonicalSerialize(["GO_SOLO"]))
            return failure("UNSUPPORTED_FIELD_LEGEND", "Reviewed Go Solo Legend with a Play defeat requires the field-Legend policy");
        return supportsTargetedDefeatCard(card, context);
    }
    // Batch V40: a Go Solo Legend with a friendly-Legend steal trigger is admitted only through its exact pin.
    if (card?.type === "LEGEND" && card.execution?.scope === "COMBAT_TRIGGERS_V1" && hasLegendStealTrigger(card)) return supportsLegendStealTrigger(card, context);
    // Batch V41: likewise the Go Solo Legend with an {Attack} reveal for power.
    if (card?.type === "LEGEND" && card.execution?.scope === "COMBAT_TRIGGERS_V1" && hasLegendRevealEffect(card)) return supportsLegendReveal(card, context);
    if (!fieldLegendsEnabled(context) || !turnSliceAllows(policy, "cardPlay") || !turnSliceAllows(policy, "gear") || !turnSliceAllows(policy, "combat") || !turnSliceAllows(policy, "react") || !turnSliceAllows(policy, "combatResolution") || !card?.provenance.reviewed || card.execution?.scope !== "FIELD_LEGENDS_V1" || card.execution.status !== "SUPPORTED" || card.type !== "LEGEND" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 5 || card.power === undefined || !card.sellProfile.allowed || card.keywords.length || !m || m.equip || m.abilities.length || m.modifiers.length || m.restrictions?.length || !reviewedShapes.some(shape => canonicalSerialize(shape) === canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, power: card.power, keywords: m.keywords })))
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
