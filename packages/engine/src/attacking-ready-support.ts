import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V38+: printed Units with a live attacking-power aura for other friendly Units and an own-turn end ready, each pinned whole. */
const ATTACKING_READY_SHAPES = [
    // Batch V38: Saul Bright: Stormrider. "Other friendly Units have +2 power while attacking. At the end of your turn, ready up to
    // 3 friendly Units."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Aldecado", "Nomad"], cost: 8, power: 14, modifiers: [{ kind: "OTHER_FRIENDLY_ATTACKING_UNIT_POWER", amount: 2 }],
        abilities: [ability({ trigger: "WHEN_OWN_TURN_ENDS", effects: [{ kind: "READY_UNITS_UP_TO", relation: "FRIENDLY", maximum: 3 }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, restrictions: [], ...shape }));
export function hasAttackingReadyMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === "OTHER_FRIENDLY_ATTACKING_UNIT_POWER") || card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "READY_UNITS_UP_TO")));
}
export function supportsAttackingReadyUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "combat") || !turnSliceAllows(p, "combatResolution") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !ATTACKING_READY_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, modifiers: m.modifiers,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_ATTACKING_READY", "Complete reviewed printed Unit with an exact attacking aura and own-turn end ready required");
    return success(null);
}
