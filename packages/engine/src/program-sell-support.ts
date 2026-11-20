import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** Batch V45+: Programs that sell a card from the deck by effect (11.12.2.1), each pinned whole. Anything not listed is absent. */
const SELL_PROGRAM_SHAPES = [
    // Batch V45: Bootleg Black Sapphire Show. "Sell the top card of your deck. If you control a Gig with an even value and a Gig
    // with an odd value, draw 2."
    { colors: ["YELLOW"], ram: { YELLOW: 4 }, tags: ["Braindance"], cost: 5,
        effects: [{ kind: "SELL_TOP_OF_DECK", count: 1 }, { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "FRIENDLY_GIGS_EVEN_AND_ODD" }, count: 2 }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
/** Any effect sell or its parity condition routes here first, so no other gate can admit what it does not read. */
export function hasSellTopEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.conditions.some(c => c.kind === "FRIENDLY_GIGS_EVEN_AND_ODD")
        || a.effects.some(e => e.kind === "SELL_TOP_OF_DECK" || e.kind === "CONDITIONAL_DRAW" && e.condition.kind === "FRIENDLY_GIGS_EVEN_AND_ODD")));
}
export function supportsSellTopProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !SELL_PROGRAM_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_SELL_PROGRAM", "Complete reviewed printed Program with an exact effect sell required");
    return success(null);
}
/** Effect-sold Eddies exist only where the content admits a reviewed effect-sell Program. */
export function effectSellAdmitted(context: EngineContext) {
    return context.content.cards.some(c => hasSellTopEffect(c) && supportsSellTopProgram(c, context).ok);
}
