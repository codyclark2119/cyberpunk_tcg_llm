import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects: a.effects });
/** Batch V88+: cards that observe a Rival's adjust or swap of their controller's Gigs (6.4, 6.7), or fight Legends harder, each pinned
 * whole. Anything not listed is absent. */
const GIG_CHANGE_TRIGGER_SHAPES = [
    // Batch V88: Meredith Stout: Stone Cold Corpo. "{Blocker} This Unit has +2 power while fighting a Legend. When a Rival adjusts or
    // swaps 1 or more friendly Gigs, you may add a card from your trash to your hand."
    { type: "UNIT", sell: false, power: 5, equip: null, keywords: ["BLOCKER"], modifiers: [{ kind: "POWER_WHILE_FIGHTING_LEGEND", amount: 2 }],
        colors: ["RED"], ram: { RED: 1 }, tags: ["Corpo", "Militech"], cost: 4,
        abilities: [ability({ trigger: "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS", effects: [{ kind: "MAY_RETURN_TRASH_CARD_TO_HAND" }] })] }
].map(shape => canonicalSerialize({ restrictions: [], ...shape }));
/** Any Rival-change trigger, trash-card return or Legend-fight power routes here first, so no other gate can admit what it does not read. */
export function hasGigChangeTriggerMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    const m = card?.mechanics;
    return Boolean(m && (m.abilities.some(a => a.trigger === "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS" || a.effects.some(e => e.kind === "MAY_RETURN_TRASH_CARD_TO_HAND"))
        || m.modifiers.some(x => x.kind === "POWER_WHILE_FIGHTING_LEGEND")));
}
export function supportsGigChangeTriggerCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !turnSliceAllows(g?.turnSlice, "combat") || !turnSliceAllows(g?.turnSlice, "react")
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m
        || !GIG_CHANGE_TRIGGER_SHAPES.includes(canonicalSerialize({ keywords: m.keywords, restrictions: m.restrictions ?? [], type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, equip: m.equip ?? null, modifiers: m.modifiers,
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_GIG_CHANGE_TRIGGER", "Complete reviewed printed card with an exact Rival Gig-change trigger required");
    return success(null);
}
