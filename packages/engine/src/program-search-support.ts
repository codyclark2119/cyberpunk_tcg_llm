import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A Program's one resolving ability as pinned: anything not listed is absent. */
const ability = (a: { effects: unknown[] }) => ({ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V36+: printed Programs whose resolution searches the top of their controller's deck, each pinned whole. */
const PROGRAM_SEARCH_SHAPES = [
    // Batch V36: Three Mouths One Desire. "Search the top 3 cards of your deck. Add 1 to your hand. You may add 1 more for each
    // friendly min Gig. Bottom-deck the rest."
    { colors: ["BLUE"], ram: { BLUE: 3 }, tags: ["Braindance", "Doll"], cost: 2, abilities: [ability({ effects: [{ kind: "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG", count: 3 }] })] }
].map(shape => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
export function hasProgramSearchEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG")));
}
export function supportsProgramSearch(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !PROGRAM_SEARCH_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_PROGRAM_SEARCH", "Complete reviewed printed Program with an exact top-of-deck search required");
    return success(null);
}
