import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V73+: Go Solo Legends whose {Call} trashes from the deck, then adds a tagged Program from the trash, each pinned whole. Calling
 * it resolves through the activation continuation; its {Go Solo} shares the field-Legend lifecycle. */
const CALL_TRASH_PROGRAM_SHAPES = [
    // Batch V73: V: Streetkid. "{Call} Trash 3. Then, add 1 BRAINDANCE Program from your trash to your hand. {Go Solo}"
    { colors: ["RED"], ram: { RED: 2 }, tags: ["Merc"], cost: 5, power: 6, sell: true, keywords: ["GO_SOLO"],
        abilities: [{ trigger: "WHEN_CALLED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "TRASH_THEN_ADD_TRASH_PROGRAM", count: 3, tag: "Braindance" }] }] }
].map(shape => canonicalSerialize({ type: "LEGEND", equip: null, modifiers: [], restrictions: [], ...shape }));
/** Any trash-then-add-Program effect routes here first, so no other gate can admit what it does not read. */
export function hasCallTrashProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "TRASH_THEN_ADD_TRASH_PROGRAM")));
}
export function supportsCallTrashProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "fieldLegends") || !turnSliceAllows(p, "cardPlay") || !turnSliceAllows(p, "callEffects") || !turnSliceAllows(p, "gear") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "react") || !turnSliceAllows(p, "combatResolution")
        || !card?.provenance.reviewed || card.execution?.scope !== "FIELD_LEGENDS_V1" || card.execution.status !== "SUPPORTED" || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m
        || !CALL_TRASH_PROGRAM_SHAPES.includes(canonicalSerialize({ type: card.type, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [], colors: card.colors, ram: card.ram, tags: card.tags,
            cost: card.printedCost.amount, power: card.power ?? null, sell: card.sellProfile.allowed, keywords: m.keywords,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_CALL_TRASH_PROGRAM", "Complete reviewed Go Solo Legend with an exact {Call} trash-then-add-Program ability required");
    return success(null);
}
