import { canonicalSerialize, failure, hashCanonical, success, type CardInstanceId, type GameState, type PaymentSource, type PendingChoice, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { supportsFieldLegend } from "./field-legend-support";
import { cardRevision } from "./characteristics";
import { forcedPaymentSources, paymentCandidates, paymentSources, paymentValue, validatePayment } from "./payment";
import { moveLegendToFieldWithAttachments } from "./card-movement";
import { recordPlayedCard } from "./trigger-resolution";
import { triggersEnabled } from "./trigger-support";
import { finishAction } from "./action-return";
export type LegendEntryMode = "GO_SOLO" | "PLAY";
function eligibleSource(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return Boolean(c && c.face === "UP" && c.zone.zone === "LEGENDS" && c.controllerId === actor && c.ownerId === actor && c.zone.playerId === actor && supportsFieldLegend(cardRevision(state, id, context), context).ok);
}
/** Readiness is deliberately not required: a spent Legend can Go Solo (official FAQ). */
export function canEnterField(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const cost = cardRevision(state, id, context)?.printedCost;
    return Boolean(!state.setup && !state.match.outcome && state.timing.activePlayer === actor && state.timing.actingPlayer === actor && state.timing.window === "MAIN" && state.resolution.stage === "DECISION" && state.timing.combat.stage === "NONE" && eligibleSource(state, actor, id, context) && cost?.kind === "EDDIES" && (cost.amount === 0 || paymentCandidates(state, actor, context, cost.amount, []).length));
}
export function legendEntryChoice(state: GameState, context: EngineContext): PendingChoice {
    const c = state.resolution.legendEntryContinuation!;
    return { id: hashCanonical({ protocol: "legend-entry@1", turn: state.timing.turn, actorSeat: state.players[c.actorId].seat, sourceId: c.sourceId, mode: c.mode, selected: c.selectedSources }), actorId: c.actorId, kind: "PAYMENT", options: paymentCandidates(state, c.actorId, context, c.remainingCost, c.selectedSources).map(source => ({ kind: "PAYMENT", source })), min: 1, max: 1, ordered: false, continuationId: "legend-entry@1" };
}
function offerPayment(m: TurnMutation) {
    m.state.resolution.choice = legendEntryChoice(m.state, m.context);
    m.state.resolution.stage = "CHOICE";
    m.state.timing.step = "PAYMENT_SELECTION"; m.state.timing.window = "PAYMENT_SELECTION";
    m.emit({ kind: "PHASE_CHANGED", step: "PAYMENT_SELECTION" });
    return success(null);
}
function completeEntry(m: TurnMutation, sources: PaymentSource[]): Result<null> {
    const c = m.state.resolution.legendEntryContinuation!;
    const paid = validatePayment(m.state, c.actorId, m.context, sources, cardRevision(m.state, c.sourceId, m.context)!.printedCost);
    if (!paid.ok) return paid;
    // Ordinary € payment, including the entering Legend itself, happens before entry readiness is determined.
    for (const source of sources) m.state.objects.cards[source.cardInstanceId].readiness = "SPENT";
    m.emit({ kind: "PAYMENT_MADE", sources });
    const moved = moveLegendToFieldWithAttachments(m, c.sourceId, c.mode);
    if (!moved.ok) return moved;
    if (c.mode === "GO_SOLO") m.emit({ kind: "GO_SOLO_ACTIVATED", cardInstanceId: c.sourceId });
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: c.sourceId });
    // 4.5/11.25 and official Jackie FAQ: both entry modes play a Unit; moving its Gear is not another play.
    return triggersEnabled(m.context) ? recordPlayedCard(m, c.sourceId) : finishAction(m);
}
export function startLegendEntry(m: TurnMutation, actorId: PlayerId, sourceId: CardInstanceId, mode: LegendEntryMode): Result<null> {
    if (!canEnterField(m.state, actorId, sourceId, m.context)) return failure("ILLEGAL_LEGEND_ENTRY", "Face-up reviewed Legend, open own MAIN and exact payable printed cost required");
    const cost = cardRevision(m.state, sourceId, m.context)!.printedCost;
    if (cost.kind !== "EDDIES") return failure("UNSUPPORTED_LEGEND_COST", "Numeric printed cost required");
    m.state.resolution.returnTo = { kind: "MAIN" };
    m.state.resolution.legendEntryContinuation = { actorId, sourceId, mode, remainingCost: cost.amount, selectedSources: [] };
    const forced = forcedPaymentSources(m.state, actorId, m.context, cost.amount, []);
    return forced ? completeEntry(m, forced) : offerPayment(m);
}
export function continueLegendEntry(m: TurnMutation, index: number): Result<null> {
    const c = m.state.resolution.legendEntryContinuation!, option = m.state.resolution.choice!.options[index];
    if (option.kind !== "PAYMENT") return failure("INVALID_LEGEND_PAYMENT", "Choose an enumerated payment source");
    const selected = [...c.selectedSources, option.source], remaining = c.remainingCost - paymentValue(m.state, m.context, option.source);
    const forced = forcedPaymentSources(m.state, c.actorId, m.context, remaining, selected);
    if (forced) return completeEntry(m, [...selected, ...forced]);
    c.selectedSources = selected; c.remainingCost = remaining;
    return offerPayment(m);
}
export function validateLegendEntryState(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.legendEntryContinuation;
    if (!c) return success(null);
    if (!eligibleSource(state, c.actorId, c.sourceId, context) || c.actorId !== state.timing.activePlayer || c.actorId !== state.timing.actingPlayer || state.setup || state.match.outcome || state.timing.combat.stage !== "NONE" || state.timing.step !== "PAYMENT_SELECTION" || r.stage !== "CHOICE" || r.returnTo?.kind !== "MAIN" || r.playContinuation || r.callContinuation || r.searchContinuation || r.triggerContinuation || r.gigStealContinuation || r.defeatContinuation || r.current || r.pending.length || r.discovered.length)
        return failure("INVALID_LEGEND_ENTRY", "Exclusive current player's Legend-entry payment must retain a public Legends-area source");
    const cost = cardRevision(state, c.sourceId, context)!.printedCost, available = paymentSources(state, c.actorId, context).map(canonicalSerialize);
    if (cost.kind !== "EDDIES" || new Set(c.selectedSources.map(p => p.cardInstanceId)).size !== c.selectedSources.length || c.selectedSources.some(p => !available.includes(canonicalSerialize(p))) || c.selectedSources.reduce((n, p) => n + paymentValue(state, context, p), 0) + c.remainingCost !== cost.amount || forcedPaymentSources(state, c.actorId, context, c.remainingCost, c.selectedSources)) return failure("INVALID_LEGEND_PAYMENT", "Unique eligible unspent selections and exact remaining cost required; forced payment cannot pause");
    const expected = legendEntryChoice(state, context);
    return expected.options.length && canonicalSerialize(expected) === canonicalSerialize(r.choice) ? success(null) : failure("INVALID_LEGEND_PAYMENT_CHOICE", "Choice must equal the current exact payment possibilities");
}
