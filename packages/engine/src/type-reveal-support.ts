import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V42+: printed Units whose own-turn end names a card type and reveals the top card, each pinned whole. */
const TYPE_REVEAL_SHAPES = [
    // Batch V42: Misty Olszewski: Mender of Broken Spirits. "This Unit can't attack. At the end of your turn, choose a card type. Then,
    // reveal the top card of your deck. If it's the chosen type, add it to your hand and ready 1 Eddie. Otherwise, trash it."
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Mystic"], cost: 3, power: 0, restrictions: [{ kind: "CANNOT_ATTACK" }],
        abilities: [ability({ trigger: "WHEN_OWN_TURN_ENDS", effects: [{ kind: "CHOOSE_TYPE_REVEAL_TOP_ADD_AND_READY_EDDIE", ready: 1 }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, modifiers: [], ...shape }));
export const REVEAL_TYPES = ["UNIT", "GEAR", "PROGRAM"] as const;
export function hasTypeRevealEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "CHOOSE_TYPE_REVEAL_TOP_ADD_AND_READY_EDDIE")));
}
export function supportsTypeRevealUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "combatRestrictions") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !TYPE_REVEAL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_TYPE_REVEAL", "Complete reviewed printed Unit with an exact can't-attack restriction and own-turn end type reveal required");
    return success(null);
}
