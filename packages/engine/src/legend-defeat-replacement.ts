import { canonicalSerialize, failure, hashCanonical, success, type CardInstanceId, type GameState, type PendingChoice, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { gearDefeatReplacement } from "./defeat";
import { hasLegendDefeatReplacement, supportsDefeatReplacementLegend } from "./defeat-replacement-support";
import { paymentCandidates } from "./payment";
import { noteSpent } from "./spend-triggers";

/** Batch V100 (10.24-10.29): "If a friendly Unit would be defeated, you may spend 1 €$ to defeat this Legend instead. (Remove it from
 * the game.)" An optional replacement, offered to the Unit's controller once per declared defeat, in declaration order and before any
 * owner order, while they control a face-up pinned Legend (in their Legends area, or on the field after Go Solo) and can pay. A
 * mandatory replacement (Deadman Transmitter) applies first (10.26), after which no Unit would be defeated. A Legend replaces at most one
 * defeat, never its own, and not while it is being defeated itself. With several such Legends, they are identical copies, so the lowest
 * id is taken. */
export const LEGEND_REPLACEMENT_PROTOCOL = "legend-defeat-replacement@1";
const COST = 1;
type Offer = { readonly targetId: CardInstanceId; readonly legendId: CardInstanceId };
/** The player's face-up pinned Legends, in id order. */
export function legendReplacementSources(state: GameState, player: PlayerId, context: EngineContext): CardInstanceId[] {
    return [...state.players[player].zones.LEGENDS, ...state.players[player].zones.BATTLEFIELD].filter(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return c?.face === "UP" && c.controllerId === player && c.zone.playerId === player && hasLegendDefeatReplacement(r) && supportsDefeatReplacementLegend(r, context).ok;
    }).sort();
}
/** A declared defeat its controller could replace now, ignoring whether it was already answered. */
function offerFor(state: GameState, targetId: CardInstanceId, context: EngineContext): Offer | undefined {
    const d = state.resolution.defeatContinuation, c = state.objects.cards[targetId];
    if (!d || !c || c.zone.zone !== "BATTLEFIELD" || c.face !== "UP" || !effectiveCardTypes(state, targetId, context).includes("UNIT") || gearDefeatReplacement(state, targetId, context)) return undefined;
    const targets = d.defeats.map(x => x.targetId), used = (d.legendReplacement?.replaced ?? []).map(x => x.legendId);
    const legendId = legendReplacementSources(state, c.controllerId, context).find(id => !targets.includes(id) && !used.includes(id));
    return legendId && paymentCandidates(state, c.controllerId, context, COST, []).length ? { targetId, legendId } : undefined;
}
/** The next unanswered declared defeat that may be replaced, before any owner order has begun. */
export function nextLegendReplacement(state: GameState, context: EngineContext): Offer | undefined {
    const d = state.resolution.defeatContinuation, answered = d?.legendReplacement?.answered ?? [];
    if (!d || d.orders.some(o => o.cardIds.length)) return undefined;
    for (const { targetId } of d.defeats) {
        if (answered.includes(targetId)) continue;
        const offer = offerFor(state, targetId, context);
        if (offer) return offer;
    }
    return undefined;
}
/** The decline, then each exact way to spend 1 €$; the Unit's controller chooses. */
export function legendReplacementChoice(state: GameState, offer: Offer, context: EngineContext): PendingChoice {
    const player = state.objects.cards[offer.targetId].controllerId;
    return { id: hashCanonical({ protocol: LEGEND_REPLACEMENT_PROTOCOL, turn: state.timing.turn, targetId: offer.targetId, legendId: offer.legendId }), actorId: player, kind: "TARGET", min: 1, max: 1, ordered: false, continuationId: LEGEND_REPLACEMENT_PROTOCOL,
        options: [{ kind: "CONFIRM", confirmed: false }, ...paymentCandidates(state, player, context, COST, []).map(source => ({ kind: "PAYMENT" as const, source }))] };
}
/** Pauses for the offer, in the defeat-order step. */
export function offerLegendReplacement(m: TurnMutation, offer: Offer) {
    const s = m.state, choice = legendReplacementChoice(s, offer, m.context);
    s.resolution.choice = choice; s.resolution.stage = "CHOICE"; s.timing.actingPlayer = choice.actorId;
    s.timing.step = "DEFEAT_ORDER_SELECTION"; s.timing.window = "DEFEAT_ORDER_SELECTION";
}
/** Answers the current offer: decline, or spend the chosen source, after which the Legend will be defeated instead. */
export function answerLegendReplacement(m: TurnMutation, option: PendingChoice["options"][number] | undefined): Result<null> {
    const s = m.state, d = s.resolution.defeatContinuation, offer = nextLegendReplacement(s, m.context);
    if (!d || !offer) return failure("INVALID_DEFEAT_REPLACEMENT", "A current Legend replacement offer required");
    const player = s.objects.cards[offer.targetId].controllerId;
    if (option?.kind === "CONFIRM" && !option.confirmed) {
        s.resolution.choice = null;
        d.legendReplacement = { answered: [...(d.legendReplacement?.answered ?? []), offer.targetId], replaced: [...(d.legendReplacement?.replaced ?? [])] };
        m.emit({ kind: "DEFEAT_REPLACEMENT_DECLINED", cardInstanceId: offer.targetId, legendId: offer.legendId, playerId: player });
        return success(null);
    }
    if (option?.kind !== "PAYMENT" || !paymentCandidates(s, player, m.context, COST, []).some(p => canonicalSerialize(p) === canonicalSerialize(option.source)))
        return failure("INVALID_DEFEAT_REPLACEMENT", "Spend exactly 1 €$ from an eligible source, or decline");
    s.resolution.choice = null;
    d.legendReplacement = { answered: [...(d.legendReplacement?.answered ?? []), offer.targetId], replaced: [...(d.legendReplacement?.replaced ?? []), offer] };
    s.objects.cards[option.source.cardInstanceId].readiness = "SPENT"; noteSpent(m, option.source.cardInstanceId); // Batch V69.
    m.emit({ kind: "PAYMENT_MADE", sources: [option.source] });
    return success(null);
}
/** The recorded answers are coherent; with an offer open, it is the exact next one, before any owner order. "OFFER" while it is open. */
export function validateLegendReplacement(state: GameState, context: EngineContext): Result<"OFFER" | "NONE"> {
    const r = state.resolution, d = r.defeatContinuation, lr = d?.legendReplacement;
    if (!d) return success("NONE");
    const targets = d.defeats.map(x => x.targetId);
    if (lr) {
        const legends = lr.replaced.map(x => x.legendId);
        if (new Set(lr.answered).size !== lr.answered.length || lr.answered.some(id => !targets.includes(id)) || new Set(lr.replaced.map(x => x.targetId)).size !== lr.replaced.length || new Set(legends).size !== legends.length
            || lr.replaced.some(x => { const c = state.objects.cards[x.targetId]; return !lr.answered.includes(x.targetId) || !c || targets.includes(x.legendId) || !legendReplacementSources(state, c.controllerId, context).includes(x.legendId)
                || c.zone.zone !== "BATTLEFIELD" || c.face !== "UP" || !effectiveCardTypes(state, x.targetId, context).includes("UNIT") || Boolean(gearDefeatReplacement(state, x.targetId, context)); }))
            return failure("INVALID_DEFEAT_REPLACEMENT", "Distinct answered declared defeats, each replaced by a distinct current face-up pinned Legend of its controller");
    }
    const next = nextLegendReplacement(state, context);
    if (!next) return success("NONE");
    const index = targets.indexOf(next.targetId);
    if ((lr?.answered ?? []).some(id => targets.indexOf(id) > index) || state.timing.step !== "DEFEAT_ORDER_SELECTION" || !r.choice || canonicalSerialize(r.choice) !== canonicalSerialize(legendReplacementChoice(state, next, context)) || state.timing.actingPlayer !== r.choice.actorId)
        return failure("INVALID_DEFEAT_REPLACEMENT", "Answers in declaration order and the exact offer for the next replaceable defeat required");
    return success("OFFER");
}
