import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
import { adrenalineEnabled } from "./restriction-support";
/** Batch V20: exact per-card pin table (Cody, 2026-11-15) for two single-primitive {Play} Units. Each admitted
 * card's complete printed shape is literal here; the primitives resolve in the reviewed PLAY trigger batch. */
const PLAY_PIN_SHAPES = [
    // Hacked Corpo: "{Play} Trash 3. Add a Program from among them to your hand."
    { type: "UNIT", colors: ["BLUE"], ram: { BLUE: 1 }, tags: ["AI", "Corpo"], cost: 4, power: 3, sell: false, keywords: [],
        equip: null, modifiers: [], restrictions: [],
        abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], cost: { kind: "NONE" }, effects: [{ kind: "TRASH_THEN_RETURN_PROGRAM", count: 3 }] }] },
    // Valentino Street Racer: "{Play} Give another friendly Unit with cost 5 or less {Adrenaline} this turn."
    { type: "UNIT", colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Valentino", "Vehicle"], cost: 3, power: 3, sell: false, keywords: [],
        equip: null, modifiers: [], restrictions: [],
        abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], cost: { kind: "NONE" },
            effects: [{ kind: "GRANT_KEYWORD_UNTIL_END_OF_TURN", keyword: "ADRENALINE", target: { kind: "ANOTHER_FRIENDLY_UNIT", costAtMost: 5 } }] }] }
].map(shape => canonicalSerialize(shape));
export function hasPinnedPlayEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "TRASH_THEN_RETURN_PROGRAM" || e.kind === "GRANT_KEYWORD_UNTIL_END_OF_TURN")));
}
export function supportsPinnedPlayUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const p = context.content.ruleset.gameplay?.turnSlice, m = card?.mechanics;
    if (!turnSliceAllows(p, "combatTriggers") || !turnSliceAllows(p, "cardPlay") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.keywords.length || !m)
        return failure("UNSUPPORTED_PLAY_PIN", "Reviewed trigger scope, card play and trigger policies required");
    if (m.abilities.some(a => a.effects.some(e => e.kind === "GRANT_KEYWORD_UNTIL_END_OF_TURN")) && !adrenalineEnabled(context))
        return failure("UNSUPPORTED_PLAY_PIN", "A granted Adrenaline requires the reviewed Adrenaline policy");
    const actual = canonicalSerialize({ type: card.type, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null, sell: card.sellProfile.allowed,
        keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
        abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, cost: a.cost, effects: a.effects })) });
    return PLAY_PIN_SHAPES.includes(actual) ? success(null) : failure("UNSUPPORTED_PLAY_PIN", "Entire reviewed printed shape required");
}
