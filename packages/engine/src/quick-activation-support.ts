import { hasLegendSpendMetadata } from "./legend-spend-support";
import { turnSliceAllows, canonicalSerialize, failure, success, type Ability, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V49+: Units with a paid "[Quick] cost: effect" activation (11.30) or a below-power first-steal trigger, each pinned whole. */
const QUICK_ACTIVATION_SHAPES = [
    // Batch V49: Rogue Amendiares: Queen of the Afterlife. "The first time another friendly Unit steals a Gig with value less than its
    // power each turn, ready 2 Eddies. {Quick} 2 €$, {Spend} A rival Unit loses power equal to this Unit's power this turn."
    { type: "UNIT", sell: false, power: 4, colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Fixer", "Merc"], cost: 5,
        abilities: [
            { trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", inherited: null, guard: "FIRST_OTHER_FRIENDLY_STEAL_BELOW_POWER_PER_TURN", activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "READY_EDDIES", player: "CONTROLLER", count: 2 }] },
            { trigger: null, inherited: null, guard: null, activation: { timing: "QUICK", conditionTiming: "ACTIVATION_AND_RESOLUTION", costs: [{ kind: "PAYMENT_COST", cost: { kind: "EDDIES", amount: 2 } }, { kind: "SPEND_SOURCE" }] },
                conditions: [], abilityCost: { kind: "NONE" }, choose: null,
                effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -1, scale: "SOURCE_POWER" }] }] }
].map(shape => canonicalSerialize({ keywords: [], restrictions: [], equip: null, modifiers: [], ...shape }));
/** Any Quick activation, paid activation, source-power scale or below-power steal guard routes here first. */
export function hasQuickActivation(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    if (hasLegendSpendMetadata(card)) return false; // Batch V63: a Legend's paid {Spend} ability is pinned by the Legend gate.
    return Boolean(card?.mechanics.abilities.some(a => a.activation?.timing === "QUICK" || a.activation?.costs.some(c => c.kind === "PAYMENT_COST") || a.guard === "FIRST_OTHER_FRIENDLY_STEAL_BELOW_POWER_PER_TURN" || a.effects.some(e => e.kind === "POWER_UNTIL_END_OF_TURN" && e.scale)));
}
export function supportsQuickActivationCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !turnSliceAllows(g?.turnSlice, "react") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !QUICK_ACTIVATION_SHAPES.includes(canonicalSerialize({ keywords: m.keywords, restrictions: m.restrictions ?? [], equip: m.equip ?? null, modifiers: m.modifiers,
            type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_QUICK_ACTIVATION", "Complete reviewed printed Unit with an exact Quick activation and first-steal trigger required");
    return success(null);
}
/** The Eddie part of an activation's costs ("2 €$"), or 0 when it has none. */
export function activationPaymentAmount(ability: DeepReadonly<Ability> | undefined) {
    const cost = ability?.activation?.costs.find(c => c.kind === "PAYMENT_COST");
    return cost?.kind === "PAYMENT_COST" && cost.cost.kind === "EDDIES" ? cost.cost.amount : 0;
}
/** The first-steal history exists only for content holding a reviewed card that reads it. */
export function belowPowerHistoryEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.guard === "FIRST_OTHER_FRIENDLY_STEAL_BELOW_POWER_PER_TURN") && supportsQuickActivationCard(r, context).ok);
}
