import { hashCanonical, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState, type GigInstanceId, type PendingChoice, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { numericCost } from "./cost-value";
import { moveCardLocation } from "./card-movement";
import { supportsSpendTriggerCard } from "./spend-trigger-support";

/** Batch V99 (10.24-10.29): "When a rival Unit would steal a Gig, you may discard 1 with cost equal to that Gig's value. If you do, the
 * Gig isn't stolen." An optional replacement of each single Gig a rival Unit would steal (in combat or by an effect), offered to the
 * Gig's controller once per Gig, before it moves, while they control a face-up pinned source and hold a card of that cost. One offer
 * per Gig whatever the number of sources: a second one would replace nothing more. */
export function hasStealPrevention(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === "MAY_DISCARD_GIG_VALUE_COST_TO_PREVENT_RIVAL_STEAL"));
}
/** The defending player's first face-up field source of the replacement, by id. */
export function preventionSource(state: GameState, defender: PlayerId, context: EngineContext): CardInstanceId | undefined {
    return [...(state.players[defender]?.zones.BATTLEFIELD ?? [])].sort().find(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return c?.face === "UP" && c.controllerId === defender && hasStealPrevention(r) && supportsSpendTriggerCard(r, context).ok;
    });
}
/** The defending player's hand cards whose printed cost equals the Gig's current value. */
export function preventionCards(state: GameState, gigId: GigInstanceId, context: EngineContext): CardInstanceId[] {
    const g = state.objects.gigs[gigId];
    if (!g || g.roll.kind !== "ROLLED") return [];
    const value = g.roll.currentValue;
    return [...state.players[g.controllerId].zones.HAND].filter(id => numericCost(state, id, context) === value).sort();
}
/** The next Gig, in id order and not yet answered, that a rival Unit (`stealerId`) would steal and its controller may now prevent. */
export function nextPreventableGig(state: GameState, stealerId: CardInstanceId, gigIds: readonly GigInstanceId[], answered: readonly GigInstanceId[], context: EngineContext) {
    const stealer = state.objects.cards[stealerId];
    if (!stealer || !effectiveCardTypes(state, stealerId, context).includes("UNIT")) return undefined;
    return [...gigIds].sort().find(id => {
        const g = state.objects.gigs[id];
        return !answered.includes(id) && g && g.controllerId !== stealer.controllerId && g.location.zone === "GIGS" && Boolean(preventionSource(state, g.controllerId, context)) && preventionCards(state, id, context).length > 0;
    });
}
/** The decline, then each hand card of the Gig's value; the Gig's controller chooses. */
export function stealPreventionChoice(state: GameState, gigId: GigInstanceId, stealerId: CardInstanceId, context: EngineContext): PendingChoice {
    return { id: hashCanonical({ protocol: "steal-prevention@1", turn: state.timing.turn, gigId, stealerId }), actorId: state.objects.gigs[gigId].controllerId, kind: "TARGET", min: 1, max: 1, ordered: false, continuationId: "steal-prevention@1",
        options: [{ kind: "CONFIRM", confirmed: false }, ...preventionCards(state, gigId, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))] };
}
/** Pauses for the Gig's controller. */
export function offerStealPrevention(m: TurnMutation, gigId: GigInstanceId, stealerId: CardInstanceId, step: "GIG_STEAL_SELECTION" | "TARGET_SELECTION"): Result<null> {
    const s = m.state, choice = stealPreventionChoice(s, gigId, stealerId, m.context);
    s.resolution.choice = choice; s.resolution.stage = "CHOICE"; s.timing.actingPlayer = choice.actorId;
    if (step === "TARGET_SELECTION") { s.timing.step = step; s.timing.window = step; m.emit({ kind: "PHASE_CHANGED", step }); }
    return success(null);
}
/** Answers the offer: true when the discard prevented the steal. */
export function answerStealPrevention(m: TurnMutation, gigId: GigInstanceId, stealerId: CardInstanceId, option: PendingChoice["options"][number] | undefined): Result<boolean> {
    const s = m.state, defender = s.objects.gigs[gigId]?.controllerId, source = defender && preventionSource(s, defender, m.context);
    if (!defender || !source) return failure("INVALID_STEAL_PREVENTION", "A current prevention source and Gig required");
    s.resolution.choice = null;
    if (option?.kind === "CONFIRM" && !option.confirmed) { m.emit({ kind: "GIG_STEAL_PREVENTION_DECLINED", gigInstanceId: gigId, stealerId, playerId: defender }); return success(false); }
    if (option?.kind !== "CARD" || !preventionCards(s, gigId, m.context).includes(option.cardInstanceId)) return failure("INVALID_STEAL_PREVENTION", "Choose a hand card with cost equal to the Gig's value, or decline");
    moveCardLocation(m, option.cardInstanceId, "TRASH");
    m.emit({ kind: "GIG_STEAL_PREVENTED", gigInstanceId: gigId, stealerId, playerId: defender, sourceId: source, discardedId: option.cardInstanceId });
    return success(true);
}
