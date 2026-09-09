import { supportsAttackingAuraLegend } from "./attacking-aura-support";
import { supportsFirstAttackLegend } from "./first-attack-support";
import { supportsFieldLegend } from "./field-legend-support";
import { supportsTriggerCard } from "./trigger-support";
import { failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
export function supportsCall(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    if (card?.execution?.scope === "ATTACKING_AURA_V1") return supportsAttackingAuraLegend(card, context);
    if (card?.execution?.scope === "FIRST_ATTACK_HISTORY_V1") return supportsFirstAttackLegend(card, context);
    if (card?.execution?.scope === "FIELD_LEGENDS_V1") return supportsFieldLegend(card, context);
    if (card?.type === "LEGEND" && card.execution?.scope === "COMBAT_TRIGGERS_V1") return supportsTriggerCard(card, context);
    if (card?.mechanics.abilities.some(a => a.inherited || a.guard)) return failure("UNSUPPORTED_TRIGGER_METADATA", "Unsupported granted/guarded CALL shape");
    const reviewed = context.content.ruleset.gameplay?.turnSlice?.callEffects === "REVIEWED_CALL_V1";
    if (!card || card.mechanics.restrictions?.length || card.mechanics.equip || (reviewed && card.execution?.status !== "SUPPORTED") || card.execution?.status === "UNSUPPORTED" || card.mechanics.abilities.length > 1 || card.mechanics.abilities.some(a => a.trigger !== "WHEN_CALLED") || card.mechanics.modifiers.some(m => !reviewed || m.kind !== "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN"))
        return failure("UNSUPPORTED_CALL_EFFECT", "Card requires unimplemented automatic or continuous mechanics");
    const ability = card.mechanics.abilities[0];
    if (ability && (ability.activation || ability.cost.kind !== "NONE" || ability.conditions.length || ability.effects.length !== 1 || !(ability.effects[0].kind === "DRAW" || (reviewed && ability.effects[0].kind === "SEARCH_GEAR"))))
        return failure("UNSUPPORTED_CALL_EFFECT", "Only reviewed single-trigger DRAW or Gear search is supported");
    return success(null);
}
