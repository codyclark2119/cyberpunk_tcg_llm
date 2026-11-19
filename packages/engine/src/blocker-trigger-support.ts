import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V17: printed Blocker Units with one "When this Unit uses [Blocker]" ability, each pinned whole. */
const BLOCKER_USED_SHAPES = [
    { colors: ["RED"], ram: { RED: 1 }, tags: ["Ganger", "Valentino"], cost: 3, power: 3,
        effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 3, direction: "INCREASE" }] },
    { colors: ["YELLOW"], ram: { YELLOW: 1 }, tags: ["Arasaka", "Corpo"], cost: 3, power: 2,
        effects: [{ kind: "DISCARD_CARDS", player: "RIVAL", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER" }] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: ["BLOCKER"], equip: null, modifiers: [], restrictions: [], trigger: "WHEN_BLOCKER_USED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, ...shape }));
export function supportsBlockerUsedUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0];
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "react") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !a || m.abilities.length !== 1 || !BLOCKER_USED_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [], trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, effects: a.effects })))
        return failure("UNSUPPORTED_BLOCKER_TRIGGER", "Complete reviewed printed Blocker Unit with one exact Blocker-used ability required");
    return success(null);
}
