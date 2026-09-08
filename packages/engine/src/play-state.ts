import { powerTargets } from "./react-queries";
import { legalEquipHosts } from "./attachments";
import { canonicalSerialize, hashCanonical, failure, success, type GameState, type PendingChoice } from "@tcg/domain";
import type { EngineContext } from "./state";
import { revisionOf, supportsPlay } from "./play-support";
import { paymentCandidates, paymentSources, paymentValue, forcedPaymentSources } from "./payment";

export function playIdentity(state: GameState) {
    const c = state.resolution.playContinuation!;
    return hashCanonical({ protocol: "noncombat-play@1", turn: state.timing.turn, actorSeat: state.players[c.actorId].seat, sourceId: c.sourceId, kind: c.kind, abilityId: c.abilityId ?? null });
}
export function playEffectId(state: GameState, index = state.resolution.playContinuation!.effectIndex) { return hashCanonical({ continuation: playIdentity(state), index }); }
/** Afterparty says 'a Gig', without a friendly restriction: either player's controlled rolled Gig. */
export function adjustmentTargets(state: GameState) {
    return Object.values(state.objects.gigs).filter(g => g.location.zone === "GIGS" && g.roll.kind === "ROLLED").map(g => g.id).sort();
}
export function playChoice(state: GameState, context: EngineContext): PendingChoice {
    const c = state.resolution.playContinuation!;
    let kind: PendingChoice["kind"], options: PendingChoice["options"];
    if (c.phase === "PAYMENT") {
        kind = "PAYMENT";
        options = paymentCandidates(state, c.actorId, context, c.remainingCost, c.selectedSources).map(source => ({ kind: "PAYMENT", source }));
    } else if (c.phase === "EQUIP") {
        kind = "TARGET";
        options = legalEquipHosts(state, c.sourceId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN") {
        kind = "TARGET";
        options = powerTargets(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (!c.targetGigId) {
        kind = "TARGET";
        options = adjustmentTargets(state).map(gigInstanceId => ({ kind: "GIG", gigInstanceId }));
    } else {
        kind = "AMOUNT";
        const gig = state.objects.gigs[c.targetGigId];
        const value = gig?.roll.kind === "ROLLED" ? gig.roll.currentValue : 0;
        // Direction plus magnitude; 10.31.3 requires a chosen number to be nonnegative.
        options = [ ...(value > 1 ? [{ kind: "MODE" as const, mode: "DECREASE_1" }] : []), { kind: "MODE", mode: "KEEP" }, ...(value < Number(gig?.dieType.slice(1)) ? [{ kind: "MODE" as const, mode: "INCREASE_1" }] : []) ];
    }
    return { id: hashCanonical({ continuation: playIdentity(state), phase: c.phase, index: c.effectIndex, selected: c.selectedSources, target: c.targetGigId ?? null }), actorId: c.actorId, kind, options, min: 1, max: 1, ordered: false, continuationId: "noncombat-play@1" };
}
export function validatePlayState(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation, current = state.resolution.current;
    const resolving = Object.values(state.objects.cards).filter(c => c.zone.zone === "RESOLVING_PROGRAM");
    if (!c) return resolving.length || state.timing.step === "AMOUNT_SELECTION" ? failure("INVALID_PLAY_CONTINUATION", "Resolving Programs and amount choices require a continuation") : success(null);
    const source = state.objects.cards[c.sourceId], revision = revisionOf(state, c.sourceId, context), ability = revision?.mechanics.abilities[0];
    if (!supportsPlay(revision, context).ok || !source || c.kind !== "PLAY" || c.actorId !== state.timing.actingPlayer || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId || source.face !== "UP" || ability?.id !== c.abilityId || state.setup || (state.timing.combat.stage !== "NONE" && (state.timing.combat.stage !== "RIVAL_REACT" || revision?.type !== "PROGRAM" || !revision.mechanics.keywords.includes("QUICK"))) || state.match.outcome || state.resolution.searchContinuation || state.resolution.callContinuation || state.resolution.discovered.length || state.resolution.stage !== "CHOICE")
        return failure("INVALID_PLAY_CONTINUATION", "Play source, scope, actor or exclusive decision state invalid");
    const cost = revision!.printedCost;
    if (cost.kind !== "EDDIES" || new Set(c.selectedSources.map(p => p.cardInstanceId)).size !== c.selectedSources.length || c.selectedSources.reduce((n, p) => n + paymentValue(state, context, p), 0) + c.remainingCost !== cost.amount)
        return failure("INVALID_PLAY_PAYMENT", "Exact cost and unique selected sources must match the printed cost");
    if (c.phase === "PAYMENT") {
        const available = paymentSources(state, c.actorId, context).map(canonicalSerialize);
        if (state.timing.step !== "PAYMENT_SELECTION" || source.zone.zone !== "HAND" || c.remainingCost <= 0 || c.effectIndex !== 0 || c.targetGigId || resolving.length || current || state.resolution.pending.length || forcedPaymentSources(state, c.actorId, context, c.remainingCost, c.selectedSources) || c.selectedSources.some(p => !available.includes(canonicalSerialize(p))))
            return failure("INVALID_PLAY_PAYMENT", "Payment must retain the revealed hand source and eligible unspent payment selections");
    } else if (c.phase === "EQUIP") {
        if (revision!.type !== "GEAR" || source.readiness !== "READY" || source.zone.zone !== "HAND" || c.remainingCost !== 0 || c.effectIndex !== 0 || c.abilityId || c.targetGigId || current || state.resolution.pending.length || resolving.length || state.timing.step !== "TARGET_SELECTION" || !legalEquipHosts(state, c.sourceId, context).length)
            return failure("INVALID_EQUIP_CONTINUATION", "Paid Gear, source area, current host set and target decision must agree");
    } else {
        if (revision!.type !== "PROGRAM" || source.zone.zone !== "RESOLVING_PROGRAM" || resolving.length !== 1 || c.remainingCost !== 0 || c.effectIndex !== 0 || (current?.effect.kind !== "ADJUST_GIG_UP_TO" && current?.effect.kind !== "POWER_UNTIL_END_OF_TURN") || current.id !== playEffectId(state) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || canonicalSerialize(current.effect) !== canonicalSerialize(ability!.effects[0]) || state.resolution.pending.length !== ability!.effects.length - 1)
            return failure("INVALID_PROGRAM_EFFECT", "Resolving Program and current primitive must match its pinned ordered ability");
        for (const [index, effect] of state.resolution.pending.entries()) {
            if (effect.id !== playEffectId(state, index + 1) || effect.sourceId !== c.sourceId || effect.controllerId !== c.actorId || effect.causedBySequence !== current.causedBySequence || canonicalSerialize(effect.effect) !== canonicalSerialize(ability!.effects[index + 1])) return failure("INVALID_PROGRAM_EFFECT", "Remaining primitive chain differs from the pinned ability");
        }
        if (current.effect.kind === "POWER_UNTIL_END_OF_TURN") {
            if (c.targetGigId || powerTargets(state, c.actorId, context).length < 2 || state.timing.step !== "TARGET_SELECTION") return failure("INVALID_POWER_TARGET", "Only strategic current rival-Unit choices pause the power primitive");
        } else {
            const targets = adjustmentTargets(state);
            if (!targets.length || (c.targetGigId && !targets.includes(c.targetGigId)) || state.timing.step !== (c.targetGigId ? "AMOUNT_SELECTION" : "TARGET_SELECTION")) return failure("INVALID_GIG_TARGET", "Gig target and decision step must remain eligible");
        }
    }
    if (c.phase !== "PAYMENT") {
        for (const p of c.selectedSources) {
            const paid = state.objects.cards[p.cardInstanceId], r = revisionOf(state, p.cardInstanceId, context);
            if (!paid || paid.controllerId !== c.actorId || paid.zone.playerId !== c.actorId || paid.readiness !== "SPENT" || (p.kind === "EDDIE" ? paid.zone.zone !== "EDDIES" : paid.zone.zone !== "LEGENDS" || r?.type !== "LEGEND" || (paid.face === "UP" && !r?.sellProfile.allowed))) return failure("INVALID_PLAY_PAYMENT", "Paid sources must remain the eligible spent objects");
        }
    }
    if (revision?.type === "GEAR" && !legalEquipHosts(state, c.sourceId, context).length) return failure("NO_EQUIP_HOST", "Gear play requires an eligible host throughout payment");
    const expected = playChoice(state, context);
    if (!expected.options.length || canonicalSerialize(expected) !== canonicalSerialize(state.resolution.choice)) return failure("INVALID_PLAY_CHOICE", "Choice must exactly match current engine targets, amounts or payment sources");
    return success(null);
}
