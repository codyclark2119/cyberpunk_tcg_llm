import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly } from "@tcg/domain";
import type { EngineContext } from "./state";
/** A triggered ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects: a.effects });
/** Batch V91+: Units whose attack trigger may be paid for, each pinned whole. Anything not listed is absent. */
const PAID_ATTACK_POWER_SHAPES = [
    // Batch V91: El Sombrerón: La Venganza Lenta. "{Attack} You may pay 2 €$. If you do, this Unit gains power equal to a friendly max
    // Gig this turn."
    { type: "UNIT", sell: false, power: 4, equip: null, keywords: [], modifiers: [], colors: ["RED"], ram: { RED: 4 }, tags: ["Ganger", "Valentino"], cost: 5,
        abilities: [ability({ trigger: "WHEN_ATTACKING", effects: [{ kind: "MAY_PAY_FOR_POWER_EQUAL_TO_FRIENDLY_MAX_GIG", cost: 2 }] })] }
].map(shape => canonicalSerialize({ restrictions: [], ...shape }));
/** Any paid max-Gig power routes here first, so no other gate can admit what it does not read. */
export function hasPaidAttackPower(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "MAY_PAY_FOR_POWER_EQUAL_TO_FRIENDLY_MAX_GIG")));
}
export function supportsPaidAttackPowerUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !turnSliceAllows(g?.turnSlice, "combat") || g?.gigValueBounds !== "DIE_FACES_V1"
        || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED" || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m
        || !PAID_ATTACK_POWER_SHAPES.includes(canonicalSerialize({ keywords: m.keywords, restrictions: m.restrictions ?? [], type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, equip: m.equip ?? null, modifiers: m.modifiers,
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_PAID_ATTACK_POWER", "Complete reviewed printed Unit with an exact paid attack power required");
    return success(null);
}
