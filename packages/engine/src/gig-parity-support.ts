import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A Gig-parity ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V28+: printed Units whose amounts are counted from friendly Gig values at resolution, each pinned whole. */
const GIG_PARITY_SHAPES = [
    // Batch V28: Jackie Welles: Ride or Die Choom. "{Attack} Give this Unit +2 power this turn for each friendly Gig with an even
    // value. {Defeated} Draw 1 for each friendly Gig with an odd value." Ability order is printed order.
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Merc", "Valentino"], cost: 6, power: 8, abilities: [
        ability({ trigger: "WHEN_ATTACKING", effects: [{ kind: "POWER_PER_FRIENDLY_GIG", target: { kind: "SOURCE_SUBJECT" }, amount: 2, parity: "EVEN" }] }),
        ability({ trigger: "WHEN_DEFEATED", effects: [{ kind: "DRAW_PER_FRIENDLY_GIG", count: 1, parity: "ODD" }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasGigParityEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "POWER_PER_FRIENDLY_GIG" || e.kind === "DRAW_PER_FRIENDLY_GIG")));
}
export function supportsGigParityUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !GIG_PARITY_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_GIG_PARITY", "Complete reviewed printed Unit with exact Gig-parity abilities required");
    return success(null);
}
