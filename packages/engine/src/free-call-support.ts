import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
/** A free-Call ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, effects: a.effects });
/** Batch V66+: printed Units that let their controller Call a Legend for free, each pinned whole. */
const FREE_CALL_SHAPES = [
    // Batch V66: Panam Palmer: Strength Through Family. "During your turn, you may Call a Legend for free. {Attack} Discard 1. If you
    // do, draw 1 for each friendly face-up Legend."
    { colors: ["GREEN"], ram: { GREEN: 4 }, tags: ["Aldecado", "Merc", "Nomad"], cost: 6, power: 6, modifiers: [{ kind: "FREE_CALL_DURING_OWN_TURN" }], abilities: [
        ability({ trigger: "WHEN_ATTACKING", effects: [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", thenDraw: "PER_FRIENDLY_FACE_UP_LEGEND" }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, keywords: [], equip: null, restrictions: [], ...shape }));
export function hasFreeCallMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(x => x.kind === "FREE_CALL_DURING_OWN_TURN") || card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "DISCARD_CARDS" && e.thenDraw)));
}
export function supportsFreeCallUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !FREE_CALL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, effects: a.effects })) })))
        return failure("UNSUPPORTED_FREE_CALL", "Complete reviewed printed Unit with an exact free Call required");
    return success(null);
}
/** Batch V66: the Call cost `actor` pays now: 0 in their own turn while they control a face-up field Unit with the pinned free Call. */
export function effectiveCallCost(state: GameState, actor: PlayerId, context: EngineContext) {
    const base = context.content.ruleset.gameplay?.turnSlice?.callCost ?? 0;
    const free = state.timing.activePlayer === actor && state.players[actor].zones.BATTLEFIELD.some(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return c.controllerId === actor && c.face === "UP" && r?.mechanics.modifiers.some(x => x.kind === "FREE_CALL_DURING_OWN_TURN") && supportsFreeCallUnit(r, context).ok;
    });
    return free ? 0 : base;
}
