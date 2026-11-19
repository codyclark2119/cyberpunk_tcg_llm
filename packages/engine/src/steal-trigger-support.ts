import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A steal-trigger ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; guard?: string; conditions?: unknown[]; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: a.guard ?? null, activation: null, conditions: a.conditions ?? [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V24+: printed Units with "When this Unit steals a Gig" or "When a friendly Unit steals a d6" (10.16.3, 11.5.1.7), each pinned whole. */
const STEAL_TRIGGER_SHAPES = [
    // Batch V24: Maelstrom Goons. "When this Unit steals a Gig, if it's equipped, a Rival discards 1."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ganger", "Maelstrom"], cost: 3, power: 3, abilities: [ability({ trigger: "WHEN_GIG_STOLEN",
        effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "SUBJECT_IS_EQUIPPED" } } }] })] },
    // Batch V25: Wraith Marauders. "When this Unit steals a Gig, ready another friendly Unit with power equal to the Gig's value."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Ganger", "Nomad", "Raffen Shiv"], cost: 5, power: 4, abilities: [ability({ trigger: "WHEN_GIG_STOLEN",
        effects: [{ kind: "READY_UNIT", target: { kind: "ANOTHER_FRIENDLY_UNIT", power: "EQUALS_STOLEN_GIG_VALUE" } }] })] },
    // Batch V26: 6th Street Recruits. "When a friendly Unit steals a d6, increase a Gig by up to 6."
    { colors: ["RED"], ram: { RED: 1 }, tags: ["6th Street", "Ganger"], cost: 4, power: 6, abilities: [ability({ trigger: "WHEN_FRIENDLY_UNIT_STEALS_GIG", guard: "STOLEN_GIG_IS_D6",
        effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 6, direction: "INCREASE" }] })] },
    // Batch V27: V: Roamer of the Badlands. "When this Unit steals a Gig, increase it by up to 5. At the end of your turn, if you control
    // 2 or more Gigs with 8+ value, draw 1." Ability order is printed order.
    { colors: ["RED"], ram: { RED: 2 }, tags: ["Merc", "Nomad"], cost: 5, power: 6, abilities: [
        ability({ trigger: "WHEN_GIG_STOLEN", effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "STOLEN_GIG" }, maximum: 5, direction: "INCREASE" }] }),
        ability({ trigger: "WHEN_OWN_TURN_ENDS", effects: [{ kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_COUNT_WITH_VALUE_AT_LEAST", minimum: 8, count: 2 }, count: 1 }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasStealTrigger(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.trigger === "WHEN_GIG_STOLEN" || a.trigger === "WHEN_FRIENDLY_UNIT_STEALS_GIG" || a.guard === "STOLEN_GIG_IS_D6"
        || a.effects.some(e => e.kind === "READY_UNIT" && e.target.kind === "ANOTHER_FRIENDLY_UNIT" || e.kind === "ADJUST_GIG_UP_TO" && e.target.kind === "STOLEN_GIG" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "GIG_COUNT_WITH_VALUE_AT_LEAST")
        || a.conditions.some(c => c.kind === "SUBJECT_IS_EQUIPPED" || c.kind === "GIG_COUNT_WITH_VALUE_AT_LEAST") || a.effects.some(e => "when" in e && e.when?.condition.kind === "SUBJECT_IS_EQUIPPED")));
}
export function supportsStealTriggerUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !STEAL_TRIGGER_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_STEAL_TRIGGER", "Complete reviewed printed Unit with exact steal-trigger abilities required");
    return success(null);
}
