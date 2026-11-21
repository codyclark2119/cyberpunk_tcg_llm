import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; inherited?: string; guard?: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects: a.effects });
/** Batch V69+: cards with a "when ... is spent" trigger (3.7, 10.16.1), each pinned whole. Anything not listed is absent. */
const SPEND_TRIGGER_SHAPES = [
    // Batch V69: NetWatch Netdriver. "(Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, draw 1."
    { type: "GEAR", sell: true, power: 2, equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Cyberware", "Netrunner", "Netwatch"], cost: 3,
        abilities: [ability({ trigger: "WHEN_SPENT", inherited: "EQUIPPED_HOST", effects: [{ kind: "DRAW", count: 1 }] })] },
    // Batch V70: Tetratronic Rippler. "(Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, search the top
    // card of your deck. You may trash it. (Otherwise, keep it on the top of your deck.)"
    { type: "GEAR", sell: true, power: 1, equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Cyberware"], cost: 1,
        abilities: [ability({ trigger: "WHEN_SPENT", inherited: "EQUIPPED_HOST", effects: [{ kind: "SEARCH_TOP_MAY_TRASH", count: 1 }] })] },
    // Batch V71: Zetatech Faceplate. "(Equip to a friendly Unit or face-up Legend.) When this Unit or Legend is spent, adjust a Gig by
    // up to 1. Then, if you control 3 or more Gigs with different values, draw 1."
    { type: "GEAR", sell: true, power: 2, equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" }, modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }],
        colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Cyberware", "Zetatech"], cost: 2,
        abilities: [ability({ trigger: "WHEN_SPENT", inherited: "EQUIPPED_HOST", effects: [{ kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 1,
            then: { kind: "DRAW_IF_DISTINCT_FRIENDLY_GIG_VALUES", minimum: 3, count: 1 } }] })] },
    // Batch V72: Rita Wheeler: No Stupid Questions. "{Blocker} The first time this Unit is spent each turn, draw 1, then discard 1."
    { type: "UNIT", sell: false, power: 4, equip: null, modifiers: [], keywords: ["BLOCKER"], colors: ["BLUE"], ram: { BLUE: 2 }, tags: ["Ganger", "Mox"], cost: 4,
        abilities: [ability({ trigger: "WHEN_SPENT", guard: "FIRST_SPEND_PER_TURN", effects: [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", drawFirst: 1 }] })] }
].map(shape => canonicalSerialize({ keywords: [], restrictions: [], ...shape }));
/** Any "when spent" trigger routes here first, so no other gate can admit what it does not read. */
export function hasSpendTrigger(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.trigger === "WHEN_SPENT"));
}
export function supportsSpendTriggerCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !turnSliceAllows(g?.turnSlice, "gear") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !SPEND_TRIGGER_SHAPES.includes(canonicalSerialize({ keywords: m.keywords, restrictions: m.restrictions ?? [], type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, equip: m.equip ?? null, modifiers: m.modifiers,
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_SPEND_TRIGGER", "Complete reviewed printed card with an exact \"when spent\" trigger required");
    return success(null);
}
