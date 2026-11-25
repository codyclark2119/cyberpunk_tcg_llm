import { trashProgramTargets } from "./trash-program";
import { friendlyGearTargets } from "./gear-legend";
import { trashedTopProgram } from "./braindance-legend";
import { revealedTop, rivalOf } from "./rival-reveal";
import { blockerGrantTargets } from "./blocker-grant";
import { mustAttackTargets } from "./must-attack";
import { crossSetSources, crossSetTargets, legendContinuationAbility, playPowerTargets, swapChoiceGigs, validateLegendActivationState } from "./legend-spend";
import { friendlyFieldUnits } from "./fight-power-grant";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import { playPaymentAmount } from "./play-cost-support";
import { gigAdjustmentOptions, gigSetSources, gigSetTargets } from "./gig-value";
import { powerTargets } from "./react-queries";
import { legalEquipHosts } from "./attachments";
import { canonicalSerialize, hashCanonical, failure, success, type GameState, type PendingChoice, type PlayerId, type CardInstanceId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { revisionOf, supportsPlay } from "./play-support";
import { paymentCandidates, paymentSources, paymentValue, forcedPaymentSources } from "./payment";
import { trashedUnitTargets, validateTrashReturn } from "./trash-return";
import { currentBottomDeckTargets, validateBottomDeck } from "./bottom-deck";
import { testCondition } from "./conditions";
import { validateActivationState } from "./quick-activation";

function playIdentity(state: GameState) {
    const c = state.resolution.playContinuation!;
    return identity(state, c.actorId, c.sourceId, c.kind, c.abilityId);
}
function identity(state: GameState, actorId: PlayerId, sourceId: CardInstanceId, kind: "PLAY" | "ACTIVATE", abilityId: string | undefined) {
    return hashCanonical({ protocol: "noncombat-play@1", turn: state.timing.turn, actorSeat: state.players[actorId].seat, sourceId, kind, abilityId: abilityId ?? null });
}
/** Batch V49: the effect id an activation's printed effect had this turn, for history that outlives the continuation. */
export function activationEffectId(state: GameState, actorId: PlayerId, sourceId: CardInstanceId, abilityId: string, index: number) {
    return hashCanonical({ continuation: identity(state, actorId, sourceId, "ACTIVATE", abilityId), index });
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
    } else if (c.phase === "MODE") {
        // Batch V44: each printed mode, named by its effect kind, in printed order.
        kind = "MODE";
        options = (legendContinuationAbility(state, context) ?? revisionOf(state, c.sourceId, context)!.mechanics.abilities[0]).effects.map(e => ({ kind: "MODE", mode: e.kind }));
    } else if (c.phase === "EQUIP") {
        kind = "TARGET";
        options = legalEquipHosts(state, c.sourceId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "SPEND_UNIT") {
        kind = "TARGET";
        options = listSpendUnitTargets(state, c.actorId, state.resolution.current.effect.target, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "TRASH_THEN_RETURN_UNIT") {
        kind = "TARGET";
        options = trashedUnitTargets(state, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "TRASH_THEN_ADD_TRASH_PROGRAM") { // Batch V73.
        kind = "TARGET";
        options = trashProgramTargets(state, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "BOTTOM_DECK_UNIT") {
        kind = "TARGET";
        options = currentBottomDeckTargets(state, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "SET_GIG_TO_ANOTHER_GIG_VALUE") {
        // Batch V37: first the Gig to set (or the decline), then the other Gig whose value it takes.
        kind = "TARGET";
        options = c.targetGigId ? gigSetSources(state, c.targetGigId).map(gigInstanceId => ({ kind: "GIG", gigInstanceId })) : [{ kind: "CONFIRM", confirmed: false }, ...gigSetTargets(state).map(gigInstanceId => ({ kind: "GIG" as const, gigInstanceId }))];
    } else if (state.resolution.current?.effect.kind === "FORCE_RIVAL_UNIT_ATTACK") { // Batch V63.
        kind = "TARGET";
        options = mustAttackTargets(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE") { // Batch V62: the Gig to set, then the other player's Gig.
        kind = "TARGET";
        options = (c.targetGigId ? crossSetSources(state, c.targetGigId) : crossSetTargets(state)).map(gigInstanceId => ({ kind: "GIG", gigInstanceId }));
    } else if (state.resolution.current?.effect.kind === "SWAP_GIGS") { // Batch V59: the friendly Gig, then (holding it) the rival Gig.
        kind = "TARGET";
        options = swapChoiceGigs(state, c.actorId, c.targetGigId).map(gigInstanceId => ({ kind: "GIG", gigInstanceId }));
    } else if (state.resolution.current?.effect.kind === "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN" || state.resolution.current?.effect.kind === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN") { // Batch V58, V61.
        kind = "TARGET";
        options = friendlyFieldUnits(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH") { // Batch V77: the Rival sends them to hand or trash.
        kind = "MODE";
        options = [{ kind: "MODE", mode: "HAND" }, { kind: "MODE", mode: "TRASH" }];
    } else if (state.resolution.current?.effect.kind === "TRASH_TOP_MAY_ADD_PROGRAM") { // Batch V76: leave it, or add the trashed Program.
        kind = "TARGET";
        const program = trashedTopProgram(state, c.actorId, context);
        options = [{ kind: "CONFIRM", confirmed: false }, ...(program ? [{ kind: "CARD" as const, cardInstanceId: program }] : [])];
    } else if (state.resolution.current?.effect.kind === "MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW") { // Batch V75: the decline, then each friendly Gear.
        kind = "TARGET";
        options = [{ kind: "CONFIRM", confirmed: false }, ...friendlyGearTargets(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))];
    } else if (state.resolution.current?.effect.kind === "POWER_PER_EQUIPPED_GEAR_THIS_TURN") { // Batch V75.
        kind = "TARGET";
        options = friendlyFieldUnits(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "GRANT_BLOCKER_THIS_TURN") { // Batch V74.
        kind = "TARGET";
        options = blockerGrantTargets(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (state.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN" || state.resolution.current?.effect.kind === "STEAL_FEWER_THIS_TURN") {
        kind = "TARGET";
        options = playPowerTargets(state, c.actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }));
    } else if (!c.targetGigId) {
        kind = "TARGET";
        options = adjustmentTargets(state).map(gigInstanceId => ({ kind: "GIG", gigInstanceId }));
    } else {
        kind = "AMOUNT";
        const gig = state.objects.gigs[c.targetGigId];
        const effect = state.resolution.current!.effect;
        options = effect.kind === "ADJUST_GIG_UP_TO" ? gigAdjustmentOptions(gig, effect) : [];
    }
    return { id: hashCanonical({ continuation: playIdentity(state), phase: c.phase, index: c.effectIndex, selected: c.selectedSources, target: c.targetGigId ?? null, ...(c.bottomDecked ? { bottomDecked: c.bottomDecked } : {}) }), actorId: state.resolution.current?.effect.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH" ? rivalOf(state, c.actorId) : c.actorId, kind, options, min: 1, max: 1, ordered: false, continuationId: "noncombat-play@1" };
}
export function validatePlayState(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation, current = state.resolution.current;
    const resolving = Object.values(state.objects.cards).filter(c => c.zone.zone === "RESOLVING_PROGRAM");
    if (!c) return resolving.length || (state.timing.step === "AMOUNT_SELECTION" && !state.resolution.triggerContinuation) ? failure("INVALID_PLAY_CONTINUATION", "Resolving Programs and amount choices require a continuation") : success(null);
    if (c.kind === "ACTIVATE") return revisionOf(state, c.sourceId, context)?.type === "LEGEND" ? validateLegendActivationState(state, context) : validateActivationState(state, context); // Batch V49, V59.
    const source = state.objects.cards[c.sourceId], revision = revisionOf(state, c.sourceId, context), ability = revision?.mechanics.abilities[0];
    if (!supportsPlay(revision, context).ok || !source || c.kind !== "PLAY" || c.actorId !== (state.resolution.targetedDefeatContinuation?.phase === "ORDER" || state.resolution.targetedDefeatContinuation?.phase === "EACH" || current?.effect.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH" ? state.timing.activePlayer : state.timing.actingPlayer) || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId || source.face !== "UP" || (revision?.type === "GEAR" ? undefined : ability?.id) !== c.abilityId || state.setup || (state.timing.combat.stage !== "NONE" && (state.timing.combat.stage !== "RIVAL_REACT" || revision?.type !== "PROGRAM" || !revision.mechanics.keywords.includes("QUICK"))) || state.match.outcome || (state.resolution.searchContinuation && current?.effect.kind !== "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG") || state.resolution.callContinuation || state.resolution.discovered.length || state.resolution.stage !== "CHOICE")
        return failure("INVALID_PLAY_CONTINUATION", "Play source, scope, actor or exclusive decision state invalid");
    const cost = revision!.printedCost, amount = playPaymentAmount(state, c.actorId, c.sourceId, context);
    if (cost.kind !== "EDDIES" || new Set(c.selectedSources.map(p => p.cardInstanceId)).size !== c.selectedSources.length || c.selectedSources.reduce((n, p) => n + paymentValue(state, context, p), 0) + c.remainingCost !== amount)
        return failure("INVALID_PLAY_PAYMENT", "Exact cost and unique selected sources must match the printed cost");
    if (c.phase === "PAYMENT") {
        const available = paymentSources(state, c.actorId, context).map(canonicalSerialize);
        if (state.timing.step !== "PAYMENT_SELECTION" || source.zone.zone !== "HAND" || c.remainingCost <= 0 || c.effectIndex !== 0 || c.targetGigId || resolving.length || current || state.resolution.pending.length || forcedPaymentSources(state, c.actorId, context, c.remainingCost, c.selectedSources) || c.selectedSources.some(p => !available.includes(canonicalSerialize(p))))
            return failure("INVALID_PLAY_PAYMENT", "Payment must retain the revealed hand source and eligible unspent payment selections");
    } else if (c.phase === "EQUIP") {
        if (revision!.type !== "GEAR" || source.readiness !== "READY" || source.zone.zone !== "HAND" || c.remainingCost !== 0 || c.effectIndex !== 0 || c.abilityId || c.targetGigId || current || state.resolution.pending.length || resolving.length || state.timing.step !== "TARGET_SELECTION" || !legalEquipHosts(state, c.sourceId, context).length)
            return failure("INVALID_EQUIP_CONTINUATION", "Paid Gear, source area, current host set and target decision must agree");
    } else if (c.phase === "MODE") {
        // Batch V44: the mode choice holds no primitive; it exists only while the "both instead" condition is unmet.
        if (revision!.type !== "PROGRAM" || source.zone.zone !== "RESOLVING_PROGRAM" || resolving.length !== 1 || c.remainingCost !== 0 || !ability?.choose || c.effectIndex !== 0 || c.chosenEffect !== undefined || c.targetGigId || c.bottomDecked || c.trashedIds
            || current || state.resolution.pending.length || state.timing.step !== "TARGET_SELECTION" || !ability.choose.allInstead || testCondition(state, c.actorId, ability.choose.allInstead, context, c.sourceId))
            return failure("INVALID_MODE", "A modal Program's mode choice needs its resolving source and an unmet both-instead condition");
    } else {
        // Batch V44: a modal Program resolves only its chosen mode, or every mode while the condition holds; the printed index is kept.
        const order = ability?.choose ? (c.chosenEffect === undefined ? ability.effects.map((_, i) => i) : [c.chosenEffect]) : ability?.effects.map((_, i) => i) ?? [], position = order.indexOf(c.effectIndex);
        if (ability?.choose && (c.chosenEffect === undefined) !== Boolean(ability.choose.allInstead && testCondition(state, c.actorId, ability.choose.allInstead, context, c.sourceId))) return failure("INVALID_MODE", "Every mode resolves exactly while the both-instead condition holds");
        if (!ability?.choose && c.chosenEffect !== undefined) return failure("INVALID_MODE", "Only a modal Program has a chosen mode");
        if (revision!.type !== "PROGRAM" || source.zone.zone !== "RESOLVING_PROGRAM" || resolving.length !== 1 || c.remainingCost !== 0 || !ability || position < 0 || (position !== 0 && !ability.choose && current?.effect.kind !== "DEFEAT_UNIT") || (current?.effect.kind !== "SPEND_UNIT" && current?.effect.kind !== "DEFEAT_UNIT" && current?.effect.kind !== "ADJUST_GIG_UP_TO" && current?.effect.kind !== "POWER_UNTIL_END_OF_TURN" && current?.effect.kind !== "STEAL_FEWER_THIS_TURN" && current?.effect.kind !== "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN" && current?.effect.kind !== "TRASH_THEN_RETURN_UNIT" && current?.effect.kind !== "BOTTOM_DECK_UNIT" && current?.effect.kind !== "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG" && current?.effect.kind !== "SET_GIG_TO_ANOTHER_GIG_VALUE" && current?.effect.kind !== "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH") || current.id !== playEffectId(state, c.effectIndex) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || canonicalSerialize(current.effect) !== canonicalSerialize(ability.effects[c.effectIndex]) || state.resolution.pending.length !== order.length - 1 - position)
            return failure("INVALID_PROGRAM_EFFECT", "Resolving Program and current primitive must match its pinned ordered ability");
        for (const [index, effect] of state.resolution.pending.entries()) {
            const printed = order[position + index + 1];
            if (effect.id !== playEffectId(state, printed) || effect.sourceId !== c.sourceId || effect.controllerId !== c.actorId || effect.causedBySequence !== current.causedBySequence || canonicalSerialize(effect.effect) !== canonicalSerialize(ability!.effects[printed])) return failure("INVALID_PROGRAM_EFFECT", "Remaining primitive chain differs from the pinned ability");
        }
        if (current.effect.kind === "SPEND_UNIT") {
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || listSpendUnitTargets(state, c.actorId, current.effect.target, context).length < 2 || state.resolution.targetedDefeatContinuation || state.resolution.defeatContinuation || state.resolution.gigStealContinuation || state.resolution.triggerContinuation || state.resolution.legendEntryContinuation)
                return failure("INVALID_SPEND_CONTINUATION", "Only current strategic Unit targets and the original Program continuation may pause; no defeat work");
        } else if (current.effect.kind === "DEFEAT_UNIT") {
            if (!state.resolution.targetedDefeatContinuation || c.targetGigId) return failure("INVALID_TARGETED_DEFEAT", "Program defeat needs its bounded continuation");
        } else if (current.effect.kind === "TRASH_THEN_RETURN_UNIT") {
            const trashed = validateTrashReturn(state, context); if (!trashed.ok) return trashed;
        } else if (current.effect.kind === "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG") {
            // Batch V36: the dedicated search validator checks the looked-at cards, the bound and the exact choice.
            if (c.targetGigId || !state.resolution.searchContinuation) return failure("INVALID_SEARCH_STATE", "A Program search pauses only with its looked-at cards");
        } else if (current.effect.kind === "SET_GIG_TO_ANOTHER_GIG_VALUE") {
            // A lone source is applied without a choice, so a held target always has 2 or more.
            if (state.timing.step !== "TARGET_SELECTION" || !gigSetTargets(state).length || (c.targetGigId && (!gigSetTargets(state).includes(c.targetGigId) || gigSetSources(state, c.targetGigId).length < 2)))
                return failure("INVALID_GIG_TARGET", "The Gig to set and its source choices must remain eligible");
        } else if (current.effect.kind === "BOTTOM_DECK_UNIT") {
            const bottomed = validateBottomDeck(state, context); if (!bottomed.ok) return bottomed;
        } else if (current.effect.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH") { // Batch V77: the Rival holds the choice over revealed cards.
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || !revealedTop(state, c.actorId).length || state.timing.actingPlayer !== rivalOf(state, c.actorId)) return failure("INVALID_RIVAL_REVEAL", "A reveal pauses only for the Rival's hand-or-trash choice over revealed cards");
        } else if (current.effect.kind === "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN") { // Batch V58.
            if (c.targetGigId || friendlyFieldUnits(state, c.actorId, context).length < 2 || state.timing.step !== "TARGET_SELECTION" || state.fightPowerGrants?.some(x => x.origin.effectId === current.id)) return failure("INVALID_FIGHT_POWER", "Only strategic current friendly-Unit choices pause the grant");
        } else if (current.effect.kind === "STEAL_FEWER_THIS_TURN") { // Batch V57.
            if (c.targetGigId || powerTargets(state, c.actorId, context).length < 2 || state.timing.step !== "TARGET_SELECTION" || state.stealReductions?.some(x => x.origin.effectId === current.id)) return failure("INVALID_STEAL_REDUCTION", "Only strategic current rival-Unit choices pause the steal reduction");
        } else if (current.effect.kind === "POWER_UNTIL_END_OF_TURN") {
            if (c.targetGigId || current.effect.target.kind === "ALL_RIVAL_UNITS" || powerTargets(state, c.actorId, context).length < 2 || state.timing.step !== "TARGET_SELECTION") return failure("INVALID_POWER_TARGET", "Only strategic current rival-Unit choices pause the power primitive");
        } else {
            const targets = adjustmentTargets(state);
            if (!targets.length || (c.targetGigId && !targets.includes(c.targetGigId)) || state.timing.step !== (c.targetGigId ? "AMOUNT_SELECTION" : "TARGET_SELECTION")) return failure("INVALID_GIG_TARGET", "Gig target and decision step must remain eligible");
        }
    }
    if (c.chosenEffect !== undefined && c.phase !== "EFFECT") return failure("INVALID_MODE", "A chosen mode belongs only to a resolving modal Program");
    if (c.trashedIds && current?.effect.kind !== "TRASH_THEN_RETURN_UNIT") return failure("INVALID_TRASH_RETURN", "Trashed cards belong only to the current trash-return primitive");
    if (c.bottomDecked && current?.effect.kind !== "BOTTOM_DECK_UNIT") return failure("INVALID_BOTTOM_DECK", "A bottom-decked Unit belongs only to the current bottom-deck primitive");
    if (c.phase !== "PAYMENT") {
        for (const p of c.selectedSources) {
            const paid = state.objects.cards[p.cardInstanceId], r = revisionOf(state, p.cardInstanceId, context);
            if (!paid || paid.controllerId !== c.actorId || paid.zone.playerId !== c.actorId || paid.readiness !== "SPENT" || (p.kind === "EDDIE" ? paid.zone.zone !== "EDDIES" : paid.zone.zone !== "LEGENDS" || r?.type !== "LEGEND" || (paid.face === "UP" && !r?.sellProfile.allowed))) return failure("INVALID_PLAY_PAYMENT", "Paid sources must remain the eligible spent objects");
        }
    }
    if (revision?.type === "GEAR" && !legalEquipHosts(state, c.sourceId, context).length) return failure("NO_EQUIP_HOST", "Gear play requires an eligible host throughout payment");
    if (state.resolution.targetedDefeatContinuation || state.resolution.searchContinuation) return success(null); // Dedicated validators check the exact current targets and choice.
    const expected = playChoice(state, context);
    if (!expected.options.length || (current?.effect.kind === "ADJUST_GIG_UP_TO" && current.effect.direction !== undefined && expected.options.length < 2) || canonicalSerialize(expected) !== canonicalSerialize(state.resolution.choice)) return failure("INVALID_PLAY_CHOICE", "Choice must exactly match current engine targets, amounts or payment sources");
    return success(null);
}
