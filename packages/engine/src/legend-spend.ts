import { canonicalSerialize, failure, hashCanonical, success, type CardInstanceId, type GameState, type GigInstanceId, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { friendlyValuePairs, supportsLegendSpendCard } from "./legend-spend-support";
import { swapGigs } from "./gig-transfer";
import { activationEffectId, playChoice } from "./play-state";
import { offerPlayChoice } from "./play";
import { powerTargets } from "./react-queries";
import { friendlyFieldUnits } from "./fight-power-grant";
import { changeGigValue, gigSetSources } from "./gig-value";
import { listSpendUnitTargets } from "./targeted-spend-queries";

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
    const called = ability?.trigger === "WHEN_CALLED" && Boolean(ability.choose), spend = ability?.activation?.timing === "MAIN" && !ability.trigger;
    const window = called ? r.returnTo?.kind === "MAIN" && state.timing.combat.stage === "NONE" && c.actorId === state.timing.activePlayer || r.returnTo?.kind === "RIVAL_REACT" && state.timing.combat.stage === "RIVAL_REACT" && c.actorId !== state.timing.combat.attackingPlayerId
        : r.returnTo?.kind === "MAIN" && state.timing.combat.stage === "NONE" && c.actorId === state.timing.activePlayer;
    if (!supportsLegendSpendCard(revision, context).ok || !source || !ability || !(called || spend) || !window || c.remainingCost !== 0 || c.selectedSources.length || c.actorId !== state.timing.actingPlayer
        || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId || source.zone.zone !== "LEGENDS" || source.face !== "UP" || spend && source.readiness !== "SPENT"
        || state.setup || state.match.outcome || r.stage !== "CHOICE" || r.searchContinuation || r.callContinuation || r.triggerContinuation || r.legendEntryContinuation || r.targetedDefeatContinuation || r.defeatContinuation || r.gigStealContinuation || r.discovered.length
        || c.trashedIds || c.bottomDecked || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM"))
        return failure("INVALID_LEGEND_ACTIVATION", "A paused Legend ability needs its face-up Legend (spent for {Spend}), its window and no other work");
    if (c.phase === "MODE") {
        if (!called || current || r.pending.length || c.chosenEffect !== undefined || c.effectIndex !== 0 || c.targetGigId || state.timing.step !== "TARGET_SELECTION") return failure("INVALID_LEGEND_ACTIVATION", "Only a Called Legend pauses for its mode");
    } else {
        const index = called ? c.chosenEffect : 0;
        if (c.phase !== "EFFECT" || index === undefined || c.effectIndex !== index || called !== (c.chosenEffect !== undefined) || !current || current.id !== activationEffectId(state, c.actorId, c.sourceId, ability.id, index) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || current.trigger || current.primitiveIndex !== undefined
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
        } else if (e.kind === "SPEND_UNIT") {
            if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || listSpendUnitTargets(state, c.actorId, e.target, context).length < 2) return failure("INVALID_LEGEND_ACTIVATION", "A spend mode pauses only for a strategic rival-Unit choice");
        } else if (e.kind === "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE") {
            const target = c.targetGigId ? state.objects.gigs[c.targetGigId] : undefined;
            if (state.timing.step !== "TARGET_SELECTION" || (c.targetGigId ? !target || target.location.zone !== "GIGS" || target.roll.kind !== "ROLLED" || crossSetSources(state, c.targetGigId).length < 2 : crossSetTargets(state).length < 2))
                return failure("INVALID_LEGEND_ACTIVATION", "A cross-player Gig set pauses only for a strategic Gig choice");
        } else if (e.kind === "ADJUST_GIG_UP_TO") {
            if (state.timing.step !== (c.targetGigId ? "AMOUNT_SELECTION" : "TARGET_SELECTION") || c.targetGigId && (!held || held.location.zone !== "GIGS" || held.roll.kind !== "ROLLED")) return failure("INVALID_LEGEND_ACTIVATION", "A Gig adjustment pauses for its Gig, then its amount");
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
