import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
export function delayedEffectsEnabled(context: EngineContext) {
    return context.content.ruleset.gameplay?.turnSlice?.combatTriggers === "COMBAT_TRIGGERS_V1" && context.content.cards.some(c => c.execution?.scope === "GEAR_DELAYED_ATTACK_V1");
}
/** One complete inherited paragraph; no separately recurring end-turn ability. */
export function supportsDelayedAttackGear(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    const effects = [
        { kind: "DECREASE_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2 },
        { kind: "REGISTER_END_TURN_EFFECT", effect: { kind: "READY_EDDIES", player: "CONTROLLER", count: 2, when: { timing: "RESOLUTION", condition: { kind: "SUBJECT_IS_UNIT_NAMED", identity: "V" } } } }
    ];
    if (!delayedEffectsEnabled(context) || context.content.ruleset.gameplay?.turnSlice?.gear !== "REVIEWED_GEAR_V1" || !card?.provenance.reviewed || card.execution?.scope !== "GEAR_DELAYED_ATTACK_V1" || card.execution.status !== "SUPPORTED" || card.type !== "GEAR" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 2 || card.power !== 2 || !card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["BLUE"]) || canonicalSerialize(card.ram) !== canonicalSerialize({ BLUE: 2 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Merc", "Weapon"]) || card.keywords.length || !m || m.equip?.kind !== "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" || m.keywords.length || m.restrictions?.length || canonicalSerialize(m.modifiers) !== canonicalSerialize([{ kind: "GRANT_PRINTED_POWER_TO_HOST" }]) || m.abilities.length !== 1 || !a || a.trigger !== "WHEN_ATTACKING" || a.inherited !== "EQUIPPED_HOST" || a.activation || a.guard || a.conditions.length || a.cost.kind !== "NONE" || canonicalSerialize(a.effects) !== canonicalSerialize(effects))
        return failure("UNSUPPORTED_DELAYED_ATTACK_GEAR", "Complete reviewed Blue RAM2 sellable Merc/Weapon Gear, cost2 power2, equip and single inherited decrease/register paragraph required");
    return success(null);
}
export function validateDelayedMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && (r.execution?.scope === "GEAR_DELAYED_ATTACK_V1" || r.mechanics.abilities.some(a => a.conditions.some(c => c.kind === "SUBJECT_IS_UNIT_NAMED") || a.effects.some(e => e.kind === "DECREASE_GIG_UP_TO" || e.kind === "REGISTER_END_TURN_EFFECT" || e.kind === "READY_EDDIES" && (e.count === 2 || e.when) || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "SUBJECT_IS_UNIT_NAMED" || e.kind === "DISCARD_CARDS" && e.when?.condition.kind === "SUBJECT_IS_UNIT_NAMED")))) {
            const valid = supportsDelayedAttackGear(r, context); if (!valid.ok) return valid;
        }
    }
    return success(null);
}
