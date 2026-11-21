import { canonicalSerialize, failure, hashCanonical, success, type GameState, type GigInstanceId, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { friendlyValuePairs, supportsLegendSpendCard } from "./legend-spend-support";
import { swapGigs } from "./gig-transfer";
import { activationEffectId, playChoice } from "./play-state";

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
/** Batch V59: a Legend's {Spend} activation pauses only for a strategic swap Gig choice (2 or more on the side being chosen). */
export function validateLegendActivationState(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, r = state.resolution, source = state.objects.cards[c.sourceId], revision = cardRevision(state, c.sourceId, context);
    const ability = revision?.mechanics.abilities.find(a => a.id === c.abilityId), current = r.current, held = c.targetGigId ? state.objects.gigs[c.targetGigId] : undefined;
    if (!supportsLegendSpendCard(revision, context).ok || !source || !ability?.activation || ability.activation.timing !== "MAIN" || c.phase !== "EFFECT" || c.remainingCost !== 0 || c.selectedSources.length || c.actorId !== state.timing.activePlayer || c.actorId !== state.timing.actingPlayer
        || r.returnTo?.kind !== "MAIN" || state.timing.combat.stage !== "NONE" || source.controllerId !== c.actorId || source.zone.playerId !== c.actorId || source.zone.zone !== "LEGENDS" || source.face !== "UP" || source.readiness !== "SPENT"
        || state.setup || state.match.outcome || r.stage !== "CHOICE" || r.searchContinuation || r.callContinuation || r.triggerContinuation || r.legendEntryContinuation || r.targetedDefeatContinuation || r.defeatContinuation || r.gigStealContinuation || r.discovered.length
        || c.chosenEffect !== undefined || c.trashedIds || c.bottomDecked || c.effectIndex !== 0 || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM")
        || !current || current.id !== activationEffectId(state, c.actorId, c.sourceId, ability.id, 0) || current.sourceId !== c.sourceId || current.controllerId !== c.actorId || current.trigger || current.primitiveIndex !== undefined
        || canonicalSerialize(current.effect) !== canonicalSerialize(ability.effects[0]) || r.pending.length !== ability.effects.length - 1 || current.effect.kind !== "SWAP_GIGS" || state.timing.step !== "TARGET_SELECTION"
        || c.targetGigId && (!held || held.controllerId !== c.actorId || held.location.zone !== "GIGS" || held.roll.kind !== "ROLLED") || swapChoiceGigs(state, c.actorId, c.targetGigId).length < 2)
        return failure("INVALID_LEGEND_ACTIVATION", "A paused Legend activation needs its spent face-up Legend, the Main phase and a strategic swap choice");
    if (canonicalSerialize(playChoice(state, context)) !== canonicalSerialize(r.choice)) return failure("INVALID_PLAY_CHOICE", "Choice must exactly match the current swap Gigs");
    return success(null);
}
