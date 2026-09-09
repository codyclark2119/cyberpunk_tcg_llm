import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function firstAttackHistoryEnabled(context: EngineContext) { return context.content.ruleset.gameplay?.turnSlice?.firstAttackHistory === "FIRST_ATTACK_HISTORY_V1"; }
/** Complete reviewed Legend shape; no runtime card name/slug or arbitrary trait-expression dispatch. */
export function supportsFirstAttackLegend(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], policy = context.content.ruleset.gameplay?.turnSlice;
    const effects = [{ kind: "DRAW", count: 1 }, { kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "STREET_CRED_LESS_THAN_VALUE", value: 20 } } }];
    if (!firstAttackHistoryEnabled(context) || policy?.combatTriggers !== "COMBAT_TRIGGERS_V1" || policy.combatRestrictions !== "COMBAT_RESTRICTIONS_V1" || !card?.provenance.reviewed || card.execution?.scope !== "FIRST_ATTACK_HISTORY_V1" || card.execution.status !== "SUPPORTED" || card.type !== "LEGEND" || card.printedCost.kind !== "DASH" || card.power !== undefined || !card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["RED"]) || !card.ram || canonicalSerialize(card.ram) !== canonicalSerialize({ RED: 2 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Arasaka", "Corpo"]) || card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_UNIT_ATTACKS" || a.guard !== "FIRST_FRIENDLY_ARASAKA_UNIT_ATTACK_PER_TURN" || a.activation || a.inherited || a.conditions.length || a.cost.kind !== "NONE" || canonicalSerialize(a.effects) !== canonicalSerialize(effects))
        return failure("UNSUPPORTED_FIRST_ATTACK_LEGEND", "Complete reviewed sellable Red RAM2 Arasaka/Corpo Legend with Null cost/power and first friendly Arasaka Unit attack draw/conditional discard required");
    return success(null);
}
export function validateFirstAttackMetadata(state: GameState, context: EngineContext) {
    const sources = new Set<string>();
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "FIRST_ATTACK_HISTORY_V1" || r.mechanics.abilities.some(a => a.trigger === "WHEN_UNIT_ATTACKS" || a.guard === "FIRST_FRIENDLY_ARASAKA_UNIT_ATTACK_PER_TURN" || a.conditions.some(c => c.kind === "STREET_CRED_LESS_THAN_VALUE") || a.effects.some(e => e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "STREET_CRED_LESS_THAN_VALUE" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "STREET_CRED_LESS_THAN_VALUE")))) {
            const valid = supportsFirstAttackLegend(r, context); if (!valid.ok) return valid;
            // Current constructed identity rules admit one copy, with no control-change or field-entry route.
            const key = c.ownerId + "/" + r.deckbuildingIdentity;
            if (sources.has(key) || c.ownerId !== c.controllerId || c.zone.zone !== "LEGENDS") return failure("INVALID_FIRST_ATTACK_LEGEND", "Unique owned Legend in LEGENDS required; field entry/control changes are not admitted");
            sources.add(key);
        }
    }
    return success(null);
}
