import { hasStealReduction } from "./steal-reduction-support";
import { hasFightWinMetadata } from "./fight-win-support";
import { supportsAttackingAuraLegend } from "./attacking-aura-support";
import { supportsFirstAttackLegend } from "./first-attack-support";
import { supportsFieldLegend } from "./field-legend-support";
import { supportsTriggerCard } from "./trigger-support";
import { turnSliceAllows, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
import { hasModalChoice } from "./modal-program-support";
import { hasSellTopEffect } from "./program-sell-support";
import { hasFightStealEffect } from "./fight-steal-support";
import { hasFreePlayEffect } from "./free-play-support";
import { hasQuickActivation } from "./quick-activation-support";
export function supportsCall(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (hasModalChoice(card)) return failure("UNSUPPORTED_MODAL_CHOICE", "A modal ability is admitted only by its exact Program pin"); // Batch V44.
    if (hasSellTopEffect(card)) return failure("UNSUPPORTED_EFFECT_SELL", "An effect sell is admitted only by its exact Program pin"); // Batch V45.
    if (hasFightStealEffect(card)) return failure("UNSUPPORTED_FIGHT_STEAL", "A next-fight steal is admitted only by its exact Program pin"); // Batch V47.
    if (hasFreePlayEffect(card)) return failure("UNSUPPORTED_FREE_PLAY", "A free Unit play is admitted only by its exact pin"); // Batch V48.
    if (hasQuickActivation(card)) return failure("UNSUPPORTED_QUICK_ACTIVATION", "A Quick activation is admitted only by its exact Unit pin"); // Batch V49.
    if (hasFightWinMetadata(card)) return failure("UNSUPPORTED_FIGHT_WIN", "A fight-win override is admitted only by its exact Unit pin"); // Batch V52.
    if (hasStealReduction(card)) return failure("UNSUPPORTED_STEAL_REDUCTION", "A steal reduction is admitted only by its exact Quick Program pin"); // Batch V57.
    if (card?.execution?.scope === "ATTACKING_AURA_V1") return supportsAttackingAuraLegend(card, context);
    if (card?.execution?.scope === "FIRST_ATTACK_HISTORY_V1") return supportsFirstAttackLegend(card, context);
    if (card?.execution?.scope === "FIELD_LEGENDS_V1") return supportsFieldLegend(card, context);
    // Batch V18: a Go Solo Legend with a {Play} defeat has no {Call} effect; Calling it is admitted through its field-Legend pin.
    if (card?.type === "LEGEND" && card.execution?.scope === "TARGETED_DEFEAT_V1") return supportsFieldLegend(card, context);
    if (card?.type === "LEGEND" && card.execution?.scope === "COMBAT_TRIGGERS_V1") return supportsTriggerCard(card, context);
    if (card?.mechanics.abilities.some(a => a.inherited || a.guard)) return failure("UNSUPPORTED_TRIGGER_METADATA", "Unsupported granted/guarded CALL shape");
    const reviewed = turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "callEffects");
    if (!card || card.mechanics.restrictions?.length || card.mechanics.equip || (reviewed && card.execution?.status !== "SUPPORTED") || card.execution?.status === "UNSUPPORTED" || card.mechanics.abilities.length > 1 || card.mechanics.abilities.some(a => a.trigger !== "WHEN_CALLED") || card.mechanics.modifiers.some(m => !reviewed || m.kind !== "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN"))
        return failure("UNSUPPORTED_CALL_EFFECT", "Card requires unimplemented automatic or continuous mechanics");
    const ability = card.mechanics.abilities[0];
    if (ability && (ability.activation || ability.cost.kind !== "NONE" || ability.conditions.length || ability.effects.length !== 1 || !(ability.effects[0].kind === "DRAW" || (reviewed && ability.effects[0].kind === "SEARCH_GEAR"))))
        return failure("UNSUPPORTED_CALL_EFFECT", "Only reviewed single-trigger DRAW or Gear search is supported");
    return success(null);
}
