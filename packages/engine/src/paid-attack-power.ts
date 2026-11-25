import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type GigInstanceId, type PaymentSource, type PendingChoice, type PlayerId, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { forcedPaymentSources, paymentCandidates, paymentSources, paymentValue } from "./payment";
import { noteSpent } from "./spend-triggers";
import { compareTemporaryPower } from "./temporary-power";
import { supportsPaidAttackPowerUnit } from "./paid-attack-power-support";

type PaidPower = Extract<TemporaryPowerModifier, { scaled: "PAID_MAX_GIG" }>;
type Current = NonNullable<GameState["resolution"]["current"]>;
type Step = (m: TurnMutation) => Result<null>;
type Option = PendingChoice["options"][number];
const KIND = "MAY_PAY_FOR_POWER_EQUAL_TO_FRIENDLY_MAX_GIG";
const cost = (e: Current) => e.effect.kind === KIND ? e.effect.cost : 0;

/** Batch V91, 6.3.2: the player's rolled Gigs in their Gig area at their die's top face, in id order. */
export function friendlyMaxGigs(state: GameState, player: PlayerId): GigInstanceId[] {
    return Object.values(state.objects.gigs).filter(g => g.controllerId === player && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue === Number(g.dieType.slice(1))).map(g => g.id).sort();
}
const value = (state: GameState, id: GigInstanceId) => { const roll = state.objects.gigs[id].roll; return roll.kind === "ROLLED" ? roll.currentValue : 0; };
/** "A friendly max Gig" is a choice only when the max Gigs differ in value. */
const distinctValues = (state: GameState, ids: readonly GigInstanceId[]) => new Set(ids.map(id => value(state, id))).size;
/** "This Unit": the attacking Unit, while it is still a face-up field Unit. */
function subjectOnField(state: GameState, e: Current) {
    const c = e.trigger ? state.objects.cards[e.trigger.subjectId] : undefined;
    return Boolean(c && c.face === "UP" && c.zone.zone === "BATTLEFIELD");
}
function remaining(state: GameState, context: EngineContext, e: Current, selected: readonly PaymentSource[]) {
    return cost(e) - selected.reduce((n, p) => n + paymentValue(state, context, p), 0);
}
/** The pinned Unit's own {Attack} binding resolving this effect. */
function validSource(state: GameState, e: Current, context: EngineContext) {
    return e.effect.kind === KIND && e.trigger?.kind === "WHEN_ATTACKING" && e.sourceId === e.trigger.subjectId && e.primitiveIndex === undefined && supportsPaidAttackPowerUnit(cardRevision(state, e.sourceId, context), context).ok;
}
/** Effect start: with no way to pay, nothing happens; otherwise the controller accepts or declines. */
export function beginPaidPower(m: TurnMutation, offer: Step, completed: Step): Result<null> {
    const e = m.state.resolution.current!, c = m.state.resolution.triggerContinuation!;
    if (!validSource(m.state, e, m.context)) return failure("INVALID_PAID_POWER", "The reviewed attack trigger's paid power required");
    if (!paymentCandidates(m.state, e.controllerId, m.context, cost(e), []).length) return completed(m);
    c.phase = "OPTIONAL"; return offer(m);
}
/** The controller's answer in each pause: accept or decline, then each payment source, then the max Gig. */
export function continuePaidPower(m: TurnMutation, option: Option, forced: boolean, offer: Step, completed: Step): Result<null> {
    const s = m.state, e = s.resolution.current!, c = s.resolution.triggerContinuation!;
    if (c.phase === "OPTIONAL") {
        if (option.kind !== "CONFIRM") return failure("INVALID_OPTIONAL_TRIGGER", "Accept or decline explicitly");
        m.emit({ kind: option.confirmed ? "OPTIONAL_TRIGGER_ACCEPTED" : "OPTIONAL_TRIGGER_DECLINED", effectId: e.id, controllerId: e.controllerId });
        if (!option.confirmed) return completed(m);
        const all = forcedPaymentSources(s, e.controllerId, m.context, cost(e), []);
        if (all) return pay(m, all, offer, completed);
        c.phase = "PAYMENT"; return offer(m);
    }
    if (c.phase === "PAYMENT") {
        if (option.kind !== "PAYMENT") return failure("INVALID_PAYMENT", "Expected a payment source");
        const selected = [...(c.paymentSelected ?? []), option.source], rest = forcedPaymentSources(s, e.controllerId, m.context, remaining(s, m.context, e, selected), selected);
        if (rest) { delete c.paymentSelected; return pay(m, [...selected, ...rest], offer, completed); }
        c.paymentSelected = selected; return offer(m);
    }
    if (c.phase === "TARGET") {
        if (option.kind !== "GIG" || !c.paid || !friendlyMaxGigs(s, e.controllerId).includes(option.gigInstanceId)) return failure("INVALID_TRIGGER_TARGET", "Choose a friendly max Gig");
        return gainPower(m, option.gigInstanceId, forced, completed);
    }
    return failure("INVALID_PAID_POWER", "A paid power pauses only to accept, pay or choose its Gig");
}
/** "If you do": the sources are spent at once; then the Unit gains a max Gig's value, chosen only among different values. */
function pay(m: TurnMutation, sources: PaymentSource[], offer: Step, completed: Step): Result<null> {
    const s = m.state, e = s.resolution.current!, c = s.resolution.triggerContinuation!;
    for (const p of sources) { s.objects.cards[p.cardInstanceId].readiness = "SPENT"; noteSpent(m, p.cardInstanceId); } // Batch V69.
    m.emit({ kind: "PAYMENT_MADE", sources });
    const gigs = friendlyMaxGigs(s, e.controllerId);
    if (!gigs.length || !subjectOnField(s, e)) return completed(m);
    if (distinctValues(s, gigs) === 1) return gainPower(m, gigs[0], true, completed);
    c.paid = sources; c.phase = "TARGET"; return offer(m);
}
function gainPower(m: TurnMutation, gigId: GigInstanceId, forced: boolean, completed: Step): Result<null> {
    const s = m.state, e = s.resolution.current!, c = s.resolution.triggerContinuation!;
    if (!forced) m.emit({ kind: "GIG_TARGET_SELECTED", effectId: e.id, gigInstanceId: gigId });
    const modifier: PaidPower = { kind: "POWER", sourceId: e.sourceId!, targetId: e.trigger!.subjectId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, amount: value(s, gigId), scaled: "PAID_MAX_GIG", origin: { effectId: e.id } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    delete c.paid;
    return completed(m);
}
/** The current pause's options: the payment sources that still complete an exact payment, or the max Gigs. */
export function paidPowerOptions(state: GameState, context: EngineContext): Option[] {
    const e = state.resolution.current!, c = state.resolution.triggerContinuation!, selected = c.paymentSelected ?? [];
    if (c.phase === "PAYMENT") return paymentCandidates(state, e.controllerId, context, remaining(state, context, e, selected), selected).map(source => ({ kind: "PAYMENT" as const, source }));
    return friendlyMaxGigs(state, e.controllerId).map(gigInstanceId => ({ kind: "GIG" as const, gigInstanceId }));
}
/** Exact pauses: accepting needs a possible payment; a payment holds unspent distinct sources short of an exact forced remainder; the Gig
 * choice holds the spent sources and two or more different max-Gig values. Outside this effect neither field exists. */
export function validatePaidPowerContinuation(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.triggerContinuation, e = r.current;
    if (!c) return success(null);
    if (!e || e.effect.kind !== KIND) return c.paymentSelected || c.paid || c.phase === "PAYMENT" ? failure("INVALID_PAID_POWER", "Payment fields belong to a current paid power") : success(null);
    if (c.phase === "SELECT") return success(null);
    const selected = c.paymentSelected ?? [], ready = paymentSources(state, e.controllerId, context).map(p => canonicalSerialize(p));
    const ok = validSource(state, e, context) && (
        c.phase === "OPTIONAL" ? !c.paymentSelected && !c.paid && paymentCandidates(state, e.controllerId, context, cost(e), []).length > 0
        : c.phase === "PAYMENT" ? !c.paid && new Set(selected.map(p => p.cardInstanceId)).size === selected.length && selected.every(p => ready.includes(canonicalSerialize(p)))
            && remaining(state, context, e, selected) > 0 && !forcedPaymentSources(state, e.controllerId, context, remaining(state, context, e, selected), selected)
        : c.phase === "TARGET" ? !c.paymentSelected && Boolean(c.paid?.every(p => state.objects.cards[p.cardInstanceId]?.readiness === "SPENT")) && distinctValues(state, friendlyMaxGigs(state, e.controllerId)) >= 2 && subjectOnField(state, e)
        : false);
    return ok ? success(null) : failure("INVALID_PAID_POWER", "A paid power pauses only to accept a possible payment, for an exact payment, or for a max Gig of differing values");
}
/** The paid power on its own pinned attacking Unit, this turn; at most the largest die face. */
export function validatePaidPower(state: GameState, x: PaidPower, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId];
    if (!source || x.sourceId !== x.targetId || !supportsPaidAttackPowerUnit(cardRevision(state, x.sourceId, context), context).ok || x.expires.turn !== state.timing.turn || !publicUnit(x.targetId) || x.amount > 20)
        return failure("INVALID_TEMPORARY_POWER", "A paid max-Gig power needs its reviewed public Unit, itself as target and the current turn");
    return success(null);
}
