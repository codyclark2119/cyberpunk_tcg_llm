import { canonicalSerialize, failure, hashCanonical, success, type CardInstanceId, type GameState, type GigInstanceId, type PlayerId, type Result } from "@tcg/domain";
import { friendlyGearTargets } from "./gear-legend";
import { trashedTopProgram } from "./braindance-legend";
import { blockerGrantTargets } from "./blocker-grant";
import { rockerGrantTargets } from "./rocker-grant";
import { sourceGear, unequippedUnits } from "./gear-move";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { friendlyValuePairs, supportsLegendSpendCard } from "./legend-spend-support";
import { swapGigs } from "./gig-transfer";
import { activationEffectId, playChoice } from "./play-state";
import { beginActivationEffects, offerPlayChoice } from "./play";
import { supportsCallTrashProgram } from "./call-trash-program-support";
import { trashProgramTargets } from "./trash-program";
import { powerTargets } from "./react-queries";
import { friendlyFieldUnits } from "./fight-power-grant";
import { changeGigValue, gigSetSources } from "./gig-value";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import { mustAttackTargets } from "./must-attack";
import { startedQueuedCall } from "./free-call-effect";
import { activationPaymentAmount } from "./quick-activation-support";
import { forcedPaymentSources, paymentValue } from "./payment";

function rolledGigs(state: GameState, player: PlayerId, friendly: boolean) {
    return Object.values(state.objects.gigs).filter(g => g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && (g.controllerId === player) === friendly).map(g => g.id).sort();
}
/** Batch V59: a mandatory swap chooses the friendly Gig first, then the rival Gig (holding the first in `held`). */
export function swapChoiceGigs(state: GameState, actor: PlayerId, held: GigInstanceId | undefined) {
    return held ? rolledGigs(state, actor, false) : rolledGigs(state, actor, true);
}
export function mandatorySwapAvailable(state: GameState, actor: PlayerId) { return rolledGigs(state, actor, true).length > 0 && rolledGigs(state, actor, false).length > 0; }
/** Advances the swap: a lone option on a side is taken without a choice; returns "CHOICE" when a strategic choice remains. */
export function advanceMandatorySwap(m: TurnMutation, actor: PlayerId, held: GigInstanceId | undefined): Result<"CHOICE" | "DONE"> {
    const current = m.state.resolution.current!;
    if (!held) {
        const friendly = swapChoiceGigs(m.state, actor, undefined);
        if (friendly.length !== 1) return success("CHOICE");
        held = friendly[0]; m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: held });
    }
    const rival = swapChoiceGigs(m.state, actor, held);
    if (rival.length !== 1) { m.state.resolution.playContinuation!.targetGigId = held; return success("CHOICE"); }
    m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: rival[0] });
    const swapped = swapGigs(m, current.id, held, rival[0]);
    return swapped.ok ? success("DONE") : swapped;
}
/** 8.6.2.2: the active player's face-up start-of-turn Legends resolve, in card id order; each has no choice. */
export function resolveStartTurnLegends(m: TurnMutation): Result<null> {
    const s = m.state, actor = s.timing.activePlayer;
    for (const id of [...s.players[actor].zones.LEGENDS].sort()) {
        const c = s.objects.cards[id], r = cardRevision(s, id, m.context);
        if (c.face !== "UP" || c.controllerId !== actor || !supportsLegendSpendCard(r, m.context).ok) continue;
        for (const a of r!.mechanics.abilities.filter(a => a.trigger === "WHEN_OWN_TURN_STARTS")) {
            const effectId = hashCanonical({ protocol: "start-turn-legend@1", turn: s.timing.turn, sourceId: id, abilityId: a.id });
            m.emit({ kind: "EFFECT_PENDING", effectId, sourceId: id });
            for (const e of a.effects) if (e.kind === "DRAW_PER_FRIENDLY_VALUE_PAIR") {
                const pairs = friendlyValuePairs(s, actor);
                if (pairs) { const drawn = m.draw(actor, pairs * e.count); if (!drawn.ok) return drawn; }
            }
            m.emit({ kind: "EFFECT_RESOLVED", effectId });
            if (s.match.outcome) return success(null);
        }
    }
    return success(null);
}
export function legendStartTurnEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.trigger === "WHEN_OWN_TURN_STARTS") && supportsLegendSpendCard(r, context).ok);
}
/** Batch V59, V60: a pinned Legend's continuation pauses only for its Call mode, a strategic power target, a swap Gig (2 or more on
 * the side being chosen), or its Gig adjustment's target and amount. */
export function validateLegendActivationState(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, r = state.resolution, source = state.objects.cards[c.sourceId], revision = cardRevision(state, c.sourceId, context);
    const ability = revision?.mechanics.abilities.find(a => a.id === c.abilityId), current = r.current, held = c.targetGigId ? state.objects.gigs[c.targetGigId] : undefined;
    // Batch V73: a Called trash-then-add-Program Legend resolves its one printed effect here too (no mode).
    // Batch V75: so does a pinned Legend's single non-modal {Call} effect.
    const trashCall = ability?.trigger === "WHEN_CALLED" && !ability.choose && (supportsCallTrashProgram(revision, context).ok || supportsLegendSpendCard(revision, context).ok);
    // Batch V74: a {Quick} Legend ability is a {Spend} ability also usable in its controller's React Step (11.30.2).
    const modal = ability?.trigger === "WHEN_CALLED" && Boolean(ability.choose), called = modal || trashCall, quick = ability?.activation?.timing === "QUICK" && !ability.trigger, spend = (ability?.activation?.timing === "MAIN" || quick) && !ability?.trigger;
    const main = r.returnTo?.kind === "MAIN" && state.timing.combat.stage === "NONE" && c.actorId === state.timing.activePlayer;
    // Batch V86: a queued free Call's {Call} ability resolves in the Main Phase for its controller, who may be the non-active player.
    const queued = startedQueuedCall(state), queuedWindow = called && queued?.legendId === c.sourceId && queued.playerId === c.actorId && r.returnTo?.kind === "MAIN" && state.timing.combat.stage === "NONE";
    const window = queuedWindow || (called || quick ? main || r.returnTo?.kind === "RIVAL_REACT" && state.timing.combat.stage === "RIVAL_REACT" && c.actorId !== state.timing.combat.attackingPlayerId : main);
    const amount = activationPaymentAmount(ability, state, c.actorId);
    if (!(supportsLegendSpendCard(revision, context).ok || trashCall) || !source || !ability || !(called || spend) || !window || called && amount || c.actorId !== state.timing.actingPlayer
        || new Set(c.selectedSources.map(p => p.cardInstanceId)).size !== c.selectedSources.length || c.selectedSources.reduce((n, p) => n + paymentValue(state, context, p), 0) + c.remainingCost !== amount
        || c.selectedSources.some(p => { const paid = state.objects.cards[p.cardInstanceId]; return !paid || p.cardInstanceId === source?.id || paid.controllerId !== c.actorId || paid.zone.playerId !== c.actorId || paid.readiness !== (c.phase === "PAYMENT" ? "READY" : "SPENT"); }) // Batch V80: a 2 €$ cost pauses with a source chosen, not yet spent.
        || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId || source.zone.zone !== "LEGENDS" || source.face !== "UP" || spend && source.readiness !== "SPENT"
        || state.setup || state.match.outcome || r.stage !== "CHOICE" || r.searchContinuation || r.callContinuation || r.triggerContinuation || r.legendEntryContinuation || r.targetedDefeatContinuation || r.defeatContinuation || r.gigStealContinuation || r.discovered.length
        || c.trashedIds || c.bottomDecked || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM"))
        return failure("INVALID_LEGEND_ACTIVATION", "A paused Legend ability needs its face-up Legend (spent for {Spend}), its window and no other work");
    if (c.phase === "PAYMENT") {
        // Batch V63: a paid {Spend} pauses for its Eddie payment after the Legend is spent (it cannot pay for itself).
        if (!spend || state.timing.step !== "PAYMENT_SELECTION" || c.remainingCost <= 0 || current || r.pending.length || c.effectIndex !== 0 || c.targetGigId || c.chosenEffect !== undefined || forcedPaymentSources(state, c.actorId, context, c.remainingCost, c.selectedSources))
            return failure("INVALID_PLAY_PAYMENT", "A Legend's paid {Spend} pauses only for a strategic Eddie payment");
    } else if (c.phase === "MODE") {
        if (!modal || current || r.pending.length || c.chosenEffect !== undefined || c.effectIndex !== 0 || c.targetGigId || state.timing.step !== "TARGET_SELECTION") return failure("INVALID_LEGEND_ACTIVATION", "Only a Called Legend pauses for its mode");
    } else {
        const index = modal ? c.chosenEffect : 0;
        if (c.phase !== "EFFECT" || c.remainingCost !== 0 || index === undefined || c.effectIndex !== index || modal !== (c.chosenEffect !== undefined) || !current || current.id !== activationEffectId(state, c.actorId, c.sourceId, ability.id, index) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || current.trigger || current.primitiveIndex !== undefined
            || canonicalSerialize(current.effect) !== canonicalSerialize(ability.effects[index]) || r.pending.length)
            return failure("INVALID_LEGEND_ACTIVATION", "A paused Legend effect must be its current printed or chosen effect");
        const e = current.effect;
        if (e.kind === "SWAP_GIGS") {
            if (state.timing.step !== "TARGET_SELECTION" || c.targetGigId && (!held || held.controllerId !== c.actorId || held.location.zone !== "GIGS" || held.roll.kind !== "ROLLED") || swapChoiceGigs(state, c.actorId, c.targetGigId).length < 2)
                return failure("INVALID_LEGEND_ACTIVATION", "A swap pauses only for a strategic Gig choice");
        } else if (e.kind === "POWER_UNTIL_END_OF_TURN") {
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || playPowerTargets(state, c.actorId, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A power mode pauses only for a strategic Unit choice");
        } else if (e.kind === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN") {
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || friendlyFieldUnits(state, c.actorId, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "An immunity mode pauses only for a strategic friendly-Unit choice");
        } else if (e.kind === "FORCE_RIVAL_UNIT_ATTACK") {
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || mustAttackTargets(state, c.actorId, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A must-attack pauses only for a strategic rival-Unit choice");
        } else if (e.kind === "SPEND_UNIT") {
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || listSpendUnitTargets(state, c.actorId, e.target, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A spend mode pauses only for a strategic rival-Unit choice");
        } else if (e.kind === "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE") {
            const target = c.targetGigId ? state.objects.gigs[c.targetGigId] : undefined;
            if (state.timing.step !== "TARGET_SELECTION" || (c.targetGigId ? !target || target.location.zone !== "GIGS" || target.roll.kind !== "ROLLED" || crossSetSources(state, c.targetGigId).length < 2 : crossSetTargets(state).length < 2))
                return failure("INVALID_LEGEND_ACTIVATION", "A cross-player Gig set pauses only for a strategic Gig choice");
        } else if (e.kind === "ADJUST_GIG_UP_TO") {
            if (state.timing.step !== (c.targetGigId ? "AMOUNT_SELECTION" : "TARGET_SELECTION") || c.targetGigId && (!held || held.location.zone !== "GIGS" || held.roll.kind !== "ROLLED")) return failure("INVALID_LEGEND_ACTIVATION", "A Gig adjustment pauses for its Gig, then its amount");
        } else if (e.kind === "TRASH_TOP_MAY_ADD_PROGRAM") { // Batch V76.
            if (!spend || quick || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || !trashedTopProgram(state, c.actorId, context)) return failure("INVALID_LEGEND_ACTIVATION", "A trash-top pauses only to add or leave the Program it trashed");
        } else if (e.kind === "MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW") { // Batch V75.
            if (!trashCall || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || !friendlyGearTargets(state, c.actorId, context).length) return failure("INVALID_LEGEND_ACTIVATION", "A Gear defeat pauses only for a defeat or decline with a friendly Gear");
        } else if (e.kind === "POWER_PER_EQUIPPED_GEAR_THIS_TURN") { // Batch V75.
            if (!quick || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || friendlyFieldUnits(state, c.actorId, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A per-Gear power pauses only for a strategic friendly-Unit choice");
        } else if (e.kind === "MOVE_SOURCE_GEAR_TO_UNEQUIPPED_UNIT_THEN_READY") { // Batch V82.
            const gears = sourceGear(state, c.sourceId, context), units = unequippedUnits(state, c.actorId, context);
            if (!spend || quick || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || !units.length || (c.movedGearId ? !gears.includes(c.movedGearId) || units.length < 2 : gears.length < 2))
                return failure("INVALID_LEGEND_ACTIVATION", "A Gear move pauses only for a strategic Gear or unequipped-Unit choice");
        } else if (e.kind === "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED") { // Batch V80.
            if (!spend || quick || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || rockerGrantTargets(state, c.actorId, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A rival-Unit attack grant pauses only for a strategic friendly-Unit choice");
        } else if (e.kind === "GRANT_BLOCKER_THIS_TURN") { // Batch V74.
            if (!quick || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || blockerGrantTargets(state, c.actorId, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A Blocker grant pauses only for a strategic friendly-Unit choice");
        } else if (e.kind === "TRASH_THEN_ADD_TRASH_PROGRAM") { // Batch V73.
            if (!trashCall || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || trashProgramTargets(state, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A trash-then-add pauses only for a strategic Program choice");
        } else return failure("INVALID_LEGEND_ACTIVATION", "Only reviewed Legend effects pause");
    }
    if (canonicalSerialize(playChoice(state, context)) !== canonicalSerialize(r.choice)) return failure("INVALID_PLAY_CHOICE", "Choice must exactly match the current engine options");
    return success(null);
}
/** Batch V60: "{Call} Choose one effect." resolves through the activation continuation, starting with its mode choice. */
export function beginLegendCallChoice(m: TurnMutation, legendId: CardInstanceId, actorId: PlayerId, abilityId: string): Result<null> {
    m.phase("CALL_EFFECT");
    m.state.resolution.stage = "DISCOVER_TRIGGERS";
    m.state.resolution.playContinuation = { kind: "ACTIVATE", sourceId: legendId, actorId, abilityId, phase: "MODE", remainingCost: 0, selectedSources: [], effectIndex: 0 };
    return offerPlayChoice(m);
}
/** Batch V73: a Called Legend's single {Call} effect resolves through the activation continuation, so it can pause for a choice. */
export function beginLegendCallEffects(m: TurnMutation, legendId: CardInstanceId, actorId: PlayerId, abilityId: string): Result<null> {
    m.phase("CALL_EFFECT");
    m.state.resolution.stage = "DISCOVER_TRIGGERS";
    m.state.resolution.playContinuation = { kind: "ACTIVATE", sourceId: legendId, actorId, abilityId, phase: "EFFECT", remainingCost: 0, selectedSources: [], effectIndex: 0 };
    return beginActivationEffects(m);
}
/** The ability a pinned Legend's continuation resolves, when it is one. */
export function legendContinuationAbility(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation, r = c ? cardRevision(state, c.sourceId, context) : undefined;
    return c?.kind === "ACTIVATE" && r?.type === "LEGEND" && supportsLegendSpendCard(r, context).ok ? r.mechanics.abilities.find(a => a.id === c.abilityId) : undefined;
}
/** Batch V60: the current effect is a Called Legend's chosen power mode. */
export function isLegendCallPower(state: GameState, context: EngineContext) {
    return state.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN" && legendContinuationAbility(state, context)?.trigger === "WHEN_CALLED";
}
/** Rival Units for "a rival Unit"; the controller's field Units for a Called Legend's "a friendly Unit". */
export function playPowerTargets(state: GameState, actor: PlayerId, context: EngineContext) {
    const e = state.resolution.current?.effect;
    return e?.kind === "POWER_UNTIL_END_OF_TURN" && e.target.kind === "FRIENDLY_UNIT" && isLegendCallPower(state, context) ? friendlyFieldUnits(state, actor, context) : powerTargets(state, actor, context);
}
/** Batch V62: a Gig whose value another player's Gig can set (6.4.3, 6.5.1: a different value on the target's faces). */
export function crossSetSources(state: GameState, targetId: GigInstanceId) {
    const target = state.objects.gigs[targetId];
    return gigSetSources(state, targetId).filter(id => state.objects.gigs[id].controllerId !== target.controllerId);
}
export function crossSetTargets(state: GameState) {
    return Object.values(state.objects.gigs).filter(g => g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && crossSetSources(state, g.id).length).map(g => g.id).sort();
}
/** Batch V62: the Gig to set, then the other player's Gig whose value it takes; a lone option is taken without a choice. */
export function advanceCrossSet(m: TurnMutation, held: GigInstanceId | undefined, from: GigInstanceId | undefined): Result<"CHOICE" | "DONE"> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.playContinuation!;
    if (!held) {
        const targets = crossSetTargets(s);
        if (!targets.length) return success("DONE");
        if (targets.length > 1) return success("CHOICE");
        held = targets[0]; m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: held });
    }
    if (!from) {
        const sources = crossSetSources(s, held);
        if (sources.length !== 1) { c.targetGigId = held; return success("CHOICE"); }
        from = sources[0]; m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: from });
    }
    const target = s.objects.gigs[held], source = s.objects.gigs[from];
    if (target.roll.kind !== "ROLLED" || source.roll.kind !== "ROLLED") return failure("INVALID_GIG_TARGET", "Both Gigs must be rolled");
    const changed = changeGigValue(s, held, source.roll.currentValue - target.roll.currentValue, m.context);
    if (!changed.ok) return changed;
    m.emit(changed.value);
    delete c.targetGigId;
    return success("DONE");
}
