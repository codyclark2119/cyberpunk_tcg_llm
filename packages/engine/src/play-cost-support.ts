import type { TurnMutation } from "./turn";
import { supportsModalProgram } from "./modal-program-support";
import { triggersEnabled } from "./trigger-support";
import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type ContinuousModifier, type DeepReadonly, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectiveCardTypes } from "./characteristics";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";

type Reduction = Extract<ContinuousModifier, { kind: "SELF_PLAY_COST_REDUCTION" }>;
export function playCostReductionEnabled(context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.turnSlice;
    return turnSliceAllows(policy, "cardPlay") && turnSliceAllows(policy, "combat") && turnSliceAllows(policy, "playCostReduction");
}
/** Batch V11 exact pins: each admitted card's complete printed shape and its only modifier, literally. */
const COST_REDUCTION_SHAPES = [
    // Octant: "Play this Unit for -1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$."
    { colors: ["RED"], ram: { RED: 4 }, tags: ["Drone", "Militech", "Zetatech"], cost: 7, power: 8, sell: false, modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "FRIENDLY_GIG_VALUE_AT_LEAST_8", amount: 1, minimum: 1 }] },
    // Trauma Team Operatives: "Play this Unit for -1 €$ for each Unit in your trash, to a minimum of 1 €$."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Medtech", "Trauma Team"], cost: 6, power: 7, sell: false, modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "FRIENDLY_TRASH_UNIT", amount: 1, minimum: 1 }] },
    // MaxTac Heavy: "Play this Unit for -1 €$ for each of a Rival's Units, to a minimum of 1 €$."
    { colors: ["GREEN"], ram: { GREEN: 3 }, tags: ["NCPD"], cost: 7, power: 8, sell: false, modifiers: [{ kind: "SELF_PLAY_COST_REDUCTION", per: "RIVAL_UNIT", amount: 1, minimum: 1 }] },
    // Batch V53: Viktor Vektor: Drop Your Illusions. "Play your first CYBERWARE Gear each turn for -3 €$, to a minimum of 1 €$."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Ripperdoc"], cost: 5, power: 5, sell: false, modifiers: [{ kind: "FIRST_GEAR_PLAY_COST_REDUCTION", classification: "Cyberware", amount: 3, minimum: 1 }] }
].map(shape => canonicalSerialize(shape));
/** Batch V16 Zetatech Berserk: "Play this Gear for -1 €$ for each friendly face-up Legend, to a minimum of 1 €$." The whole Gear, literally. */
const GEAR_REDUCTION_SHAPES = [
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Cyberware", "Zetatech"], cost: 6, power: 3, sell: true, equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" },
        modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }, { kind: "SELF_PLAY_COST_REDUCTION", per: "FRIENDLY_FACE_UP_LEGEND", amount: 1, minimum: 1 }] }
].map(shape => canonicalSerialize(shape));

export function hasPlayCostReductionMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.execution?.scope === "PLAY_COST_REDUCTION_V1" || card.mechanics.modifiers.some(m => m.kind === "SELF_PLAY_COST_REDUCTION" || m.kind === "FIRST_GEAR_PLAY_COST_REDUCTION");
}
/** Complete reviewed card carrying a self play-cost reduction: a vanilla Unit (V11), a pinned Gear (V16), or a
 * Program whose whole shape, reduction included, is pinned by the targeted-defeat gate (V16). */
export function supportsPlayCostReduction(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics;
    if (card?.type === "PROGRAM" && card.execution?.scope === "TARGETED_DEFEAT_V1") {
        if (!playCostReductionEnabled(context) || !m?.modifiers.length || m.modifiers.some(x => x.kind !== "SELF_PLAY_COST_REDUCTION")) return failure("UNSUPPORTED_PLAY_COST_REDUCTION", "A Program reduction needs its reviewed policy and only reduction modifiers");
        return supportsTargetedDefeatCard(card, context);
    }
    if (card?.type === "GEAR") {
        if (!playCostReductionEnabled(context) || !turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "gear") || !card.provenance.reviewed || card.execution?.scope !== "PLAY_COST_REDUCTION_V1" || card.execution.status !== "SUPPORTED" || card.printedCost.kind !== "EDDIES" || card.power === undefined || card.keywords.length || !m || m.keywords.length || m.restrictions?.length || m.abilities.length)
            return failure("UNSUPPORTED_PLAY_COST_REDUCTION", "Complete reviewed Gear with only a pinned self play-cost reduction required");
        const gear = canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power, sell: card.sellProfile.allowed, equip: m.equip ?? null, modifiers: m.modifiers });
        return GEAR_REDUCTION_SHAPES.includes(gear) ? success(null) : failure("UNSUPPORTED_PLAY_COST_REDUCTION", "Card does not match a pinned Batch V16 Gear cost-reduction shape");
    }
    if (!playCostReductionEnabled(context) || !card?.provenance.reviewed || card.execution?.scope !== "PLAY_COST_REDUCTION_V1" || card.execution.status !== "SUPPORTED" || card.type !== "UNIT" || card.printedCost.kind !== "EDDIES" || card.power === undefined || card.keywords.length || !m || m.equip || m.keywords.length || m.restrictions?.length || m.abilities.length)
        return failure("UNSUPPORTED_PLAY_COST_REDUCTION", "Complete reviewed Unit with only a pinned self play-cost reduction required");
    // Batch V53: the first-Gear reduction reads the turn's play history, which exists only with reviewed triggers.
    if (m.modifiers.some(x => x.kind === "FIRST_GEAR_PLAY_COST_REDUCTION") && !triggersEnabled(context)) return failure("UNSUPPORTED_PLAY_COST_REDUCTION", "A first-Gear reduction needs the reviewed turn history");
    const actual = canonicalSerialize({ colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, power: card.power, sell: card.sellProfile.allowed, modifiers: m.modifiers });
    return COST_REDUCTION_SHAPES.includes(actual) ? success(null) : failure("UNSUPPORTED_PLAY_COST_REDUCTION", "Card does not match a pinned Batch V11 cost-reduction shape");
}
function reductionCount(state: GameState, actor: PlayerId, modifier: DeepReadonly<Reduction>, context: EngineContext) {
    switch (modifier.per) {
        case "FRIENDLY_GIG_VALUE_AT_LEAST_8":
            return Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue >= 8).length;
        case "FRIENDLY_TRASH_UNIT":
            return state.players[actor].zones.TRASH.filter(id => context.content.cards.find(r => r.id === state.objects.cards[id].cardId && r.revision === state.objects.cards[id].revision)?.type === "UNIT").length;
        case "RIVAL_UNIT": // "a Rival": the most favorable single Rival; one Rival in two-player games.
            return Math.max(0, ...state.match.playerOrder.filter(id => id !== actor).map(rival =>
                state.players[rival].zones.BATTLEFIELD.filter(id => state.objects.cards[id].controllerId === rival && effectiveCardTypes(state, id, context).includes("UNIT")).length));
        case "FRIENDLY_FACE_UP_LEGEND": // Legends-area and field Legends alike (4.4: both are valid Legend areas).
            return [...state.players[actor].zones.LEGENDS, ...state.players[actor].zones.BATTLEFIELD].filter(id => { const c = state.objects.cards[id]; return c.controllerId === actor && c.face === "UP" && effectiveCardTypes(state, id, context).includes("LEGEND"); }).length;
    }
}
/** 3.11.1.2: the amount `actor` pays to play `id` now. The card's cost value stays its printed cost. */
export function playPaymentAmount(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext): number | null {
    const c = state.objects.cards[id], r = context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
    if (r?.printedCost.kind !== "EDDIES") return null;
    const printed = r.printedCost.amount, reductions = r.mechanics.modifiers.filter((m): m is DeepReadonly<Reduction> => m.kind === "SELF_PLAY_COST_REDUCTION");
    const own = !reductions.length || !supportsPlayCostReduction(r, context).ok ? printed : reductions.reduce((amount, m) => Math.max(Math.min(amount, m.minimum), amount - m.amount * reductionCount(state, actor, m, context)), printed);
    const paid = firstGearReductions(state, actor, id, context).reduce((amount, m) => Math.max(Math.min(amount, m.minimum), amount - m.amount), own);
    // Batch V83: "If your fixer area is empty, play this Program for 1 €$": the lower amount, read whenever the amount is computed.
    const alternative = r.mechanics.modifiers.find(m => m.kind === "ALTERNATIVE_PLAY_COST_IF_FIXER_EMPTY");
    return alternative?.kind === "ALTERNATIVE_PLAY_COST_IF_FIXER_EMPTY" && supportsModalProgram(r, context).ok && !state.players[actor]?.gigs.FIXER.length ? Math.min(paid, alternative.amount) : paid;
}
type FirstGearReduction = Extract<ContinuousModifier, { kind: "FIRST_GEAR_PLAY_COST_REDUCTION" }>;
/** Batch V53: each face-up friendly field Unit's pinned reduction applies to the actor's first CYBERWARE Gear play this turn. The
 * recorded first play stays reduced while its own payment is validated, so the amount never changes mid-play. */
function firstGearReductions(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext): DeepReadonly<FirstGearReduction>[] {
    const c = state.objects.cards[id], r = context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision), first = state.turnHistory?.firstCyberwareGearPlays?.[actor];
    if (r?.type !== "GEAR" || !r.tags.includes("Cyberware") || !state.turnHistory || first !== undefined && first !== id) return [];
    return [...state.players[actor].zones.BATTLEFIELD].sort().flatMap(sourceId => {
        const s = state.objects.cards[sourceId], sr = context.content.cards.find(x => x.id === s.cardId && x.revision === s.revision);
        if (s.controllerId !== actor || s.face !== "UP" || !sr || !effectiveCardTypes(state, sourceId, context).includes("UNIT") || !supportsPlayCostReduction(sr, context).ok) return [];
        return sr.mechanics.modifiers.filter((m): m is DeepReadonly<FirstGearReduction> => m.kind === "FIRST_GEAR_PLAY_COST_REDUCTION" && r.tags.includes(m.classification));
    });
}
export function firstGearHistoryEnabled(context: EngineContext) {
    return triggersEnabled(context) && context.content.cards.some(r => r.mechanics.modifiers.some(m => m.kind === "FIRST_GEAR_PLAY_COST_REDUCTION") && supportsPlayCostReduction(r, context).ok);
}
/** Called when a played Gear is equipped (11.20.2: only then is it played). */
export function recordCyberwareGearPlay(m: TurnMutation, actor: PlayerId, id: CardInstanceId) {
    const h = m.state.turnHistory, c = m.state.objects.cards[id], r = m.context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
    if (!h || r?.type !== "GEAR" || !r.tags.includes("Cyberware") || h.firstCyberwareGearPlays?.[actor] !== undefined || !firstGearHistoryEnabled(m.context)) return;
    h.firstCyberwareGearPlays = { ...(h.firstCyberwareGearPlays ?? {}), [actor]: id };
}
export function validateFirstGearHistory(state: GameState, context: EngineContext) {
    const h = state.turnHistory, plays = h?.firstCyberwareGearPlays;
    if (plays === undefined) return success(null);
    if (!firstGearHistoryEnabled(context) || state.setup || h!.turn !== state.timing.turn || !Object.keys(plays).length || Object.entries(plays).some(([player, id]) => {
        const c = state.objects.cards[id], r = context.content.cards.find(r => r.id === c?.cardId && r.revision === c?.revision);
        return !state.match.playerOrder.includes(player as PlayerId) || !c || c.ownerId !== player || r?.type !== "GEAR" || !r.tags.includes("Cyberware");
    })) return failure("INVALID_FIRST_GEAR_HISTORY", "First CYBERWARE Gear plays need their reviewed reader, the current turn and each player's own CYBERWARE Gear");
    return success(null);
}
/** Hidden sources are validated too; an external state cannot carry an unpinned reduction. */
export function validatePlayCostReductionMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasPlayCostReductionMetadata(r)) { const supported = supportsPlayCostReduction(r, context); if (!supported.ok) return supported; }
    }
    return success(null);
}
