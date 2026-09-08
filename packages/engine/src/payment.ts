import { type GameState, type PlayerId, type PaymentSource } from "@tcg/domain";
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
        if (c.zone.zone === "LEGENDS" && context.content.ruleset.gameplay?.legendPaymentValue != null && (c.face === "DOWN" || revision?.sellProfile.allowed))
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
