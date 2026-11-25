import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A Program's one resolving modal ability as pinned: anything not listed is absent. */
const ability = (a: { choose: unknown; effects: unknown[] }) => ({ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: a.choose, effects: a.effects });
/** Batch V44+: printed "Choose one effect. If <condition>, choose both instead." Programs (V83: or plain "Choose one effect."), each pinned whole. */
const MODAL_PROGRAM_SHAPES = [
    // Batch V44: Pyramid Song. "Choose one effect. If a friendly d4 is a min Gig, choose both instead. Give a rival Unit -5 power
    // this turn. // Bottom-deck a rival Unit with power 0."
    { colors: ["BLUE"], ram: { BLUE: 3 }, tags: ["Braindance"], cost: 3, abilities: [ability({ choose: { count: 1, allInstead: { kind: "FRIENDLY_GIG_IS_MIN", dieType: "D4" } },
        effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "RIVAL_UNIT" }, amount: -5 }, { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", power: 0 } }] })] },
    // Batch V54: Towerfall. "Choose one effect. If you have less ☆ (Street Cred) than a Rival, choose both instead. Give all rival
    // Units -5 power this turn. // Bottom-deck all rival Units with power 0."
    { colors: ["BLUE"], ram: { BLUE: 4 }, tags: ["Braindance"], cost: 6, abilities: [ability({ choose: { count: 1, allInstead: { kind: "STREET_CRED_LESS_THAN_RIVAL" } },
        effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "ALL_RIVAL_UNITS" }, amount: -5 }, { kind: "BOTTOM_DECK_UNIT", target: { relation: "RIVAL", power: 0, all: true } }] })] },
    // Batch V83: Nocturne Op55 N1. "If your fixer area is empty, play this Program for 1 €$. Choose one effect. Draw 2. // A Unit can't
    // attack until your next turn. // A friendly Legend may use {Go Solo} for -2 €$ this turn, to a minimum of 1 €$." Always one mode.
    { colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Arasaka", "Plan"], cost: 3, modifiers: [{ kind: "ALTERNATIVE_PLAY_COST_IF_FIXER_EMPTY", amount: 1 }],
        abilities: [ability({ choose: { count: 1 }, effects: [{ kind: "DRAW", count: 2 }, { kind: "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN" }, { kind: "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN", amount: 2, minimum: 1 }] })] }
].map(shape => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape }));
/** Any modal ability routes here first, so no other gate can admit a `choose` it does not read. */
export function hasModalChoice(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.choose));
}
export function supportsModalProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "react") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !MODAL_PROGRAM_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_MODAL_PROGRAM", "Complete reviewed printed Program with an exact modal ability required");
    return success(null);
}
