import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, hasClassification } from "./characteristics";
/** Batch V52+: Units that win fights by an effect (11.4.1.4) or ready on their first fight win each turn, each pinned whole. */
const FIGHT_WIN_SHAPES = [
    // Batch V52: Johnny Silverhand: Never Stop Fighting. "The first time this Unit wins a fight each turn, ready it. This Unit wins
    // all fights against CORPO Units."
    { type: "UNIT", sell: false, power: 8, colors: ["RED"], ram: { RED: 2 }, tags: ["Merc", "Rocker", "Samurai"], cost: 6,
        modifiers: [{ kind: "WINS_FIGHTS_AGAINST_CLASSIFICATION", classification: "Corpo" }],
        abilities: [{ trigger: "WHEN_FIGHT_WON", inherited: null, guard: "FIRST_FIGHT_WIN_PER_TURN", activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null,
            effects: [{ kind: "READY_UNIT", target: { kind: "SOURCE" } }] }] }
].map(shape => canonicalSerialize({ keywords: [], restrictions: [], equip: null, ...shape }));
/** Any fight-win override or first-win guard routes here first. */
export function hasFightWinMetadata(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(x => x.kind === "WINS_FIGHTS_AGAINST_CLASSIFICATION") || card?.mechanics.abilities.some(a => a.guard === "FIRST_FIGHT_WIN_PER_TURN"));
}
export function supportsFightWinUnit(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !turnSliceAllows(g?.turnSlice, "combatResolution") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "COMBAT_TRIGGERS_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !FIGHT_WIN_SHAPES.includes(canonicalSerialize({ keywords: m.keywords, restrictions: m.restrictions ?? [], equip: m.equip ?? null, modifiers: m.modifiers,
            type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_FIGHT_WIN", "Complete reviewed printed Unit with an exact fight-win override and first-win ready required");
    return success(null);
}
/** 11.4.1.4: the Unit that wins this fight by its pinned printed text, or undefined. A Unit wins against an opponent with the
 * named classification; if both would, neither override applies. */
export function forcedFightWinner(state: GameState, attackerId: CardInstanceId, defenderId: CardInstanceId, context: EngineContext) {
    const wins = (id: CardInstanceId, other: CardInstanceId) => { const r = cardRevision(state, id, context); return Boolean(r && supportsFightWinUnit(r, context).ok && r.mechanics.modifiers.some(x => x.kind === "WINS_FIGHTS_AGAINST_CLASSIFICATION" && hasClassification(state, other, x.classification, context))); };
    const a = wins(attackerId, defenderId), d = wins(defenderId, attackerId);
    return a === d ? undefined : a ? attackerId : defenderId;
}
/** The first-win history exists only for content holding a reviewed card that reads it. */
export function fightWinHistoryEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.guard === "FIRST_FIGHT_WIN_PER_TURN") && supportsFightWinUnit(r, context).ok);
}
/** Batch V52: counted when the fight result is decided, before its trigger window, for each winner whose own reviewed printed text reads it. */
export function recordFightWin(m: TurnMutation, winnerId: CardInstanceId | null) {
    const h = m.state.turnHistory, r = winnerId ? cardRevision(m.state, winnerId, m.context) : undefined;
    if (!h || !winnerId || !r?.mechanics.abilities.some(a => a.guard === "FIRST_FIGHT_WIN_PER_TURN") || !supportsFightWinUnit(r, m.context).ok) return;
    h.fightWins = { ...(h.fightWins ?? {}), [winnerId]: (h.fightWins?.[winnerId] ?? 0) + 1 };
}
/** A guarded fight-won binding fires only on the subject's first win this turn (the win is already counted). */
export function fightWinGuardAllows(state: GameState, sourceId: CardInstanceId, subjectId: CardInstanceId, abilityId: string, context: EngineContext) {
    const a = cardRevision(state, sourceId, context)?.mechanics.abilities.find(a => a.id === abilityId);
    return a?.guard !== "FIRST_FIGHT_WIN_PER_TURN" || sourceId === subjectId && state.turnHistory?.fightWins?.[subjectId] === 1;
}
export function validateFightWinHistory(state: GameState, context: EngineContext) {
    const h = state.turnHistory, wins = h?.fightWins;
    if (wins === undefined) return success(null);
    if (!fightWinHistoryEnabled(context) || state.setup || h!.turn !== state.timing.turn || !Object.keys(wins).length || Object.keys(wins).some(id => { const r = cardRevision(state, id as CardInstanceId, context); return !r || !r.mechanics.abilities.some(a => a.guard === "FIRST_FIGHT_WIN_PER_TURN"); }))
        return failure("INVALID_FIGHT_WIN_HISTORY", "Fight wins need their reviewed reader, the current turn and Units whose printed text reads them");
    return success(null);
}
