import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
/** Batch V47+: Programs whose next-fight-outcome effect makes the winning Unit steal, each pinned whole. Anything not listed is absent. */
const FIGHT_STEAL_SHAPES = [
    // Batch V47: Appetite for Destruction. "The next time a friendly Unit wins a fight by 3+ power this turn, it also steals a Gig."
    { colors: ["RED"], ram: { RED: 4 }, tags: ["Ganger"], cost: 3,
        effects: [{ kind: "REGISTER_NEXT_FIGHT_OUTCOME", on: "FRIENDLY_UNIT_WINS_BY_3", effect: { kind: "STEAL_GIG", actor: "TRIGGER_SUBJECT", count: 1 } }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
/** Any effect steal routes here first, so no other gate can admit what it does not read. */
export function hasFightStealEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "STEAL_GIG" || e.kind === "REGISTER_NEXT_FIGHT_OUTCOME" && e.effect.kind === "STEAL_GIG")));
}
export function supportsFightStealProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !combatResolutionEnabled(context) || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !FIGHT_STEAL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_FIGHT_STEAL", "Complete reviewed printed Program with an exact next-fight steal required");
    return success(null);
}
