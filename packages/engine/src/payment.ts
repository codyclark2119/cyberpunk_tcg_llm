import { type GameState, type PlayerId, type PaymentSource, type Cost, canonicalSerialize, failure, success } from "@tcg/domain";
import { type EngineContext } from "./state";
export function paymentValue(state: GameState, context: EngineContext, source: PaymentSource) {
    const card = state.objects.cards[source.cardInstanceId];
    const revision = context.content.cards.find(c => c.id === card?.cardId && c.revision === card.revision);
    return source.kind === "EDDIE" ? revision?.sellProfile.baseEddieValue ?? 0 : context.content.ruleset.gameplay?.legendPaymentValue ?? 0;
}
export function paymentSources(state: GameState, actor: PlayerId, context: EngineContext): PaymentSource[] {
    return Object.values(state.objects.cards).filter(c => c.controllerId === actor && c.zone.playerId === actor && c.readiness === "READY").flatMap<PaymentSource>(c => {
        if (c.zone.zone === "EDDIES")
            return [{ kind: "EDDIE" as const, cardInstanceId: c.id }];
        const revision = context.content.cards.find(p => p.id === c.cardId && p.revision === c.revision);
        if (c.zone.zone === "LEGENDS" && revision?.type === "LEGEND" && context.content.ruleset.gameplay?.legendPaymentValue != null && (c.face === "DOWN" || revision?.sellProfile.allowed))
            return [{ kind: "LEGEND" as const, cardInstanceId: c.id }];
        return [];
    }).sort((a, b) => a.cardInstanceId < b.cardInstanceId ? -1 : 1);
}
export function paymentCandidates(state: GameState, actor: PlayerId, context: EngineContext, remaining: number, selected: readonly PaymentSource[]) {
    const sources = paymentSources(state, actor, context).filter(s => !selected.some(p => p.cardInstanceId === s.cardInstanceId) && paymentValue(state, context, s) > 0);
    const payable = (target: number, available: PaymentSource[]) => {
        const sums = new Set([0]);
        for (const source of available)
            for (const sum of [...sums]) {
                const next = sum + paymentValue(state, context, source);
                if (next <= target)
                    sums.add(next);
            }
        return sums.has(target);
    };
    return sources.filter(s => paymentValue(state, context, s) <= remaining && payable(remaining - paymentValue(state, context, s), sources.filter(other => other.cardInstanceId !== s.cardInstanceId)));
}
/** Candidates are the union of all exact solutions. If their total equals the remainder,
 * every candidate is required: source ordering is not a strategic payment choice. */
export function forcedPaymentSources(state: GameState, actor: PlayerId, context: EngineContext, remaining: number, selected: readonly PaymentSource[]) {
    const candidates = paymentCandidates(state, actor, context, remaining, selected);
    return candidates.reduce((sum, source) => sum + paymentValue(state, context, source), 0) === remaining ? candidates : null;
}

/** Shared exact payment validation for CALL, ordinary play and future PAYMENT_COST. */
export function validatePayment(state: GameState, actor: PlayerId, context: EngineContext, sources: PaymentSource[], cost: Cost) {
    const available = paymentSources(state, actor, context).map(canonicalSerialize);
    if (new Set(sources.map(s => s.cardInstanceId)).size !== sources.length || sources.some(s => !available.includes(canonicalSerialize(s))))
        return failure("INVALID_PAYMENT", "Payment sources must be distinct eligible instances");
    if (cost.kind === "DASH" || sources.reduce((n, s) => n + paymentValue(state, context, s), 0) !== (cost.kind === "EDDIES" ? cost.amount : 0))
        return failure("UNSUPPORTED_PAYMENT", "Exact payment required; dash is not zero");
    return success(sources);
}
