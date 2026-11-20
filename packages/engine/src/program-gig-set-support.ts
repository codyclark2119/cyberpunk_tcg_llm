import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A Program's one resolving ability as pinned: anything not listed is absent. */
const ability = (a: { effects: unknown[] }) => ({ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V37+: printed Programs that set a Gig to another Gig's value, each pinned whole. */
const PROGRAM_GIG_SET_SHAPES = [
    // Batch V37: Peace Offering. "You may set a Gig's value to the value of another Gig. Then, if you control a value-pair, draw 1."
    { colors: ["GREEN"], ram: { GREEN: 1 }, tags: ["Braindance"], cost: 1, abilities: [ability({ effects: [
        { kind: "SET_GIG_TO_ANOTHER_GIG_VALUE", optional: true },
        { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "CONTROLS_VALUE_PAIR" }, count: 1 }] })] }
].map(shape => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasGigSetEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "SET_GIG_TO_ANOTHER_GIG_VALUE")));
}
export function supportsGigSetProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !PROGRAM_GIG_SET_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_PROGRAM_GIG_SET", "Complete reviewed printed Program with an exact optional Gig set required");
    return success(null);
}
