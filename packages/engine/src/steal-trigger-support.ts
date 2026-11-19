import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V24+: printed Units with one "When this Unit steals a Gig" ability (10.16.3, 11.5.1.7), each pinned whole. */
const STEAL_TRIGGER_SHAPES = [
    // Batch V24: Maelstrom Goons. "When this Unit steals a Gig, if it's equipped, a Rival discards 1."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ganger", "Maelstrom"], cost: 3, power: 3,
        effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", when: { timing: "RESOLUTION", condition: { kind: "SUBJECT_IS_EQUIPPED" } } }] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], trigger: "WHEN_GIG_STOLEN", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, ...shape }));
export function hasStealTrigger(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.trigger === "WHEN_GIG_STOLEN" || a.conditions.some(c => c.kind === "SUBJECT_IS_EQUIPPED") || a.effects.some(e => "when" in e && e.when?.condition.kind === "SUBJECT_IS_EQUIPPED")));
}
export function supportsStealTriggerUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !a || m.abilities.length !== 1 || !STEAL_TRIGGER_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [], trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, effects: a.effects })))
        return failure("UNSUPPORTED_STEAL_TRIGGER", "Complete reviewed printed Unit with one exact steal-trigger ability required");
    return success(null);
}
