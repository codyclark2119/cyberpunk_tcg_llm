import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
/** A free-Call ability as pinned: anything not listed is absent. */
const ability = (a: { trigger: string; effects: unknown[] }) => ({ trigger: a.trigger, inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects: a.effects });
/** Batch V66+: printed cards that let their controller Call a Legend for free (Batch V84: as an effect; Batch V85: from a Program), each
 * pinned whole with its execution scope. */
const FREE_CALL_SHAPES = [
    // Batch V66: Panam Palmer: Strength Through Family. "During your turn, you may Call a Legend for free. {Attack} Discard 1. If you
    // do, draw 1 for each friendly face-up Legend."
    { colors: ["GREEN"], ram: { GREEN: 4 }, tags: ["Aldecado", "Merc", "Nomad"], cost: 6, power: 6, modifiers: [{ kind: "FREE_CALL_DURING_OWN_TURN" }], abilities: [
        ability({ trigger: "WHEN_ATTACKING", effects: [{ kind: "DISCARD_CARDS", player: "CONTROLLER", count: 1, selection: "CHOSEN_BY_AFFECTED_PLAYER", thenDraw: "PER_FRIENDLY_FACE_UP_LEGEND" }] })] },
    // Batch V84: Tyger's Whisper. "{Play} You may Call a Legend for free. (You can only Call a Legend once per turn.)"
    { colors: ["GREEN"], ram: { GREEN: 1 }, tags: ["Fixer", "Tyger Claws"], cost: 2, power: 0, modifiers: [], abilities: [ability({ trigger: "WHEN_PLAYED", effects: [{ kind: "MAY_CALL_LEGEND_FREE" }] })] },
    // Batch V85: Chrome Reverie. "A rival Unit can't attack until your next turn. If you control a min Gig, you may Call a Legend for
    // free. (You can only Call a Legend once per turn.)"
    { type: "PROGRAM", sell: true, power: null, scope: "NONCOMBAT_PLAY_V1", colors: ["BLUE"], ram: { BLUE: 1 }, tags: ["Braindance"], cost: 3, modifiers: [], abilities: [ability({ trigger: "WHEN_PLAYED", effects: [
        { kind: "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN", target: "RIVAL_UNIT" }, { kind: "MAY_CALL_LEGEND_FREE", condition: { kind: "FRIENDLY_GIG_IS_MIN" } }] })] }
].map(shape => canonicalSerialize({ type: "UNIT", sell: false, scope: "COMBAT_TRIGGERS_V1", keywords: [], equip: null, restrictions: [], ...shape }));
export function hasFreeCallMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(x => x.kind === "FREE_CALL_DURING_OWN_TURN") || card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "DISCARD_CARDS" && e.thenDraw || e.kind === "MAY_CALL_LEGEND_FREE")));
}
export function supportsFreeCallUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !FREE_CALL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, scope: card.execution.scope, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power ?? null,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_FREE_CALL", "Complete reviewed printed card with an exact free Call required");
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
