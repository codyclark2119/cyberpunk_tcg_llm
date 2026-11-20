import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A Program-discard ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
const PLACIDE_EFFECT = { kind: "DISCARD_PROGRAMS_THEN_BOTTOM_DECK", count: 1, then: { relation: "RIVAL" } };
/** Batch V32+: printed Units with "You may discard N Programs. If you do, bottom-deck a rival Unit.", each pinned whole. */
const PROGRAM_DISCARD_SHAPES = [
    // Batch V32: Placide: Voodoo Sentinel. "{Play} {Attack} You may discard 1 Program. If you do, bottom-deck a rival Unit."
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Ganger", "Netrunner", "Voodoo Boys"], cost: 8, power: 10, abilities: [
        ability({ trigger: "WHEN_PLAYED", effects: [PLACIDE_EFFECT] }), ability({ trigger: "WHEN_ATTACKING", effects: [PLACIDE_EFFECT] })] },
    // Batch V33: Maman Brigitte: Spirit of Death. "{Play} You may discard 2 Programs. If you do, bottom-deck a rival unequipped Unit."
    { colors: ["BLUE"], ram: { BLUE: 4 }, tags: ["Mystic", "Netrunner", "Voodoo Boys"], cost: 5, power: 3, abilities: [
        ability({ trigger: "WHEN_PLAYED", effects: [{ kind: "DISCARD_PROGRAMS_THEN_BOTTOM_DECK", count: 2, then: { relation: "RIVAL", unequipped: true } }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasProgramDiscardEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "DISCARD_PROGRAMS_THEN_BOTTOM_DECK")));
}
export function supportsProgramDiscardUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !PROGRAM_DISCARD_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_PROGRAM_DISCARD", "Complete reviewed printed Unit with exact Program-discard abilities required");
    return success(null);
}
