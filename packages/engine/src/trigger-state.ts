import { isSearchEffect } from "./search-state";
import { supportsGigSearchUnit } from "./gig-search-support";
import { validateProgramDiscard } from "./program-discard";
import { programPlayHistoryEnabled } from "./restriction-support";
import { supportsEndTurnCard } from "./end-turn-support";
import { attackConditionPowerEnabled } from "./attack-condition-power-support";
import { validateEffectDefeatFacts } from "./targeted-defeat-state";
import { effectiveCardTypes } from "./characteristics";
import { delayedEffectsEnabled, supportsDelayedAttackGear } from "./delayed-effect-support";
import { delayedBinding } from "./delayed-effects";
import { delayedSubjectTypes } from "./delayed-effects";
import { readyableEddieSlots } from "./eddie-ready";
import { endTurnEnabled } from "./end-turn-support";
import { firstAttackHistoryEnabled, supportsFirstAttackLegend } from "./first-attack-support";
import { isFirstArasakaAttack } from "./first-attack-history";
import { supportsOrderedTriggerSource } from "./ordered-effects-support";
import { supportsFriendlyPlayPowerUnit } from "./friendly-play-power-support";
import { friendlyValuePairCount, testCondition } from "./conditions";
import { friendlyUnitReadyTargets, stolenGigReadyTargets, taggedLegendReadyTargets } from "./ready-unit";
import { supportsAttackingReadyUnit } from "./attacking-ready-support";
import { canonicalSerialize, failure, success, type GameState, type FightResult, type TriggerBinding } from "@tcg/domain";
import { supportsAttackSearchUnit } from "./attack-search-support";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { keywordGrantTargets, validateTrashProgramPause } from "./play-pin-effects";
import { supportsPinnedPlayUnit } from "./play-pin-support";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import { supportsEffectiveTriggerSource, supportsTriggerCard, triggersEnabled } from "./trigger-support";
import { supportsLegendStealTrigger } from "./legend-steal-support";
import { supportsLegendReveal } from "./legend-reveal-support";
import { discardingPlayer, discoverTriggers, nextTriggerGroup, pendingTrigger, stealerIsLegend, stolenGigParity, swapSidesAvailable, triggerChoice, triggerGigTargets, triggerId } from "./trigger-queries";
import { discardedCostMatchesFriendlyGig } from "./discard";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";

/** Validate the historical comparison, not a new comparison using post-trigger power. */
export function validFightFact(state: GameState, f: FightResult) {
    const c = state.timing.combat, a = Math.max(0, f.attackerPower), d = Math.max(0, f.defenderPower);
    return "target" in c && c.target?.kind === "CARD" && f.attackerId === c.attackerId && f.defenderId === c.target.cardInstanceId && f.attackerComparisonPower === a && f.defenderComparisonPower === d && f.winnerId === (a === d ? null : a > d ? f.attackerId : f.defenderId) && canonicalSerialize(f.loserIds) === canonicalSerialize([...(a <= d ? [f.attackerId] : []), ...(d <= a ? [f.defenderId] : [])]);
}
function validBinding(state: GameState, b: TriggerBinding, context: EngineContext) {
    const c = state.resolution.triggerContinuation!, source = state.objects.cards[b.sourceId], subject = state.objects.cards[b.subjectId], r = cardRevision(state, b.sourceId, context);
    const ability = r?.mechanics.abilities.find(a => a.id === b.abilityId);
    if (!source || !subject || !state.players[b.controllerId] || b.controllerId !== subject.controllerId || b.controllerId !== source.controllerId || !supportsEffectiveTriggerSource(r, context) || source.cardId !== b.source.cardId || source.revision !== b.source.revision || !ability || (b.delayedId ? ability.trigger !== "WHEN_ATTACKING" : ability.trigger !== b.kind) || (b.sourceId !== b.subjectId) !== (ability.inherited === "EQUIPPED_HOST")) return false;
    const origin = c.origin;
    if (b.kind === "WHEN_DEFEATED" && c.effectDefeats) return c.effectDefeats.some(d => d.targetId === b.subjectId) && !["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone);
    if (b.delayedId || b.kind === "DELAYED_END_TURN") {
        const d = origin.kind === "END_TURN" && origin.delayedEffects?.find(d => d.id === b.delayedId);
        return Boolean(d && supportsDelayedAttackGear(r, context).ok && canonicalSerialize(b) === canonicalSerialize(delayedBinding(d)));
    }
    if (origin.kind === "END_TURN") return b.kind === "WHEN_OWN_TURN_ENDS" && (b.sourceId === b.subjectId || r?.type === "GEAR" && ability.inherited === "EQUIPPED_HOST" && supportsEndTurnCard(r, context).ok) && b.controllerId === origin.playerId && ability.conditions.every(c => testCondition(state, b.controllerId, c, context, b.subjectId));
    if (origin.kind === "FIGHT") return b.kind === "WHEN_FIGHT_WON" && b.subjectId === origin.result.winnerId && validFightFact(state, origin.result);
    if (origin.kind === "DEFEAT") return b.kind === "WHEN_DEFEATED" && origin.defeated.some(d => d.targetId === b.subjectId) && !["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone);
    if (origin.kind === "BLOCK") return b.kind === "WHEN_BLOCKER_USED" && b.sourceId === b.subjectId && b.subjectId === origin.subjectId && supportsTriggerCard(r, context).ok;
    // Batch V24: a steal trigger binding names one Gig its subject stole in this Steal Step; no other binding names a Gig.
    if ((origin.kind === "STEAL") !== (b.gigInstanceId !== undefined)) return false;
    if (origin.kind === "STEAL") return b.sourceId === b.subjectId && origin.gigInstanceIds.includes(b.gigInstanceId!) && supportsTriggerCard(r, context).ok
        && (b.kind === "WHEN_GIG_STOLEN" ? b.subjectId === origin.subjectId
            // Batch V26: a friendly field Unit observing a stolen d6.
            : b.kind === "WHEN_FRIENDLY_UNIT_STEALS_GIG" && ability.guard === "STOLEN_GIG_IS_D6" && state.objects.gigs[b.gigInstanceId!]?.dieType === "D6" && subject.zone.zone === "BATTLEFIELD" && b.controllerId === state.objects.cards[origin.subjectId]?.controllerId
            // Batch V40: a face-up friendly field or Legends-area source observing a stealing friendly Legend.
            || b.kind === "WHEN_FRIENDLY_UNIT_STEALS_GIG" && ability.guard === "STEALER_IS_LEGEND" && stealerIsLegend(state, origin.subjectId, context) && ["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone) && b.controllerId === state.objects.cards[origin.subjectId]?.controllerId);
    if (origin.kind === "ATTACK") {
        if (b.kind === "WHEN_UNIT_ATTACKS") return b.sourceId === b.subjectId && source.face === "UP" && source.zone.zone === "LEGENDS" && supportsFirstAttackLegend(r, context).ok && state.objects.cards[origin.subjectId]?.controllerId === b.controllerId && isFirstArasakaAttack(state, origin.subjectId, context);
        return b.kind === "WHEN_ATTACKING" && b.subjectId === origin.subjectId;
    }
    if (b.kind === "WHEN_PLAYED") return b.subjectId === origin.subjectId;
    const played = state.objects.cards[origin.subjectId], revision = cardRevision(state, origin.subjectId, context);
    return b.kind === "WHEN_CARD_PLAYED" && ability.guard === "FIRST_BLUE_UNIT_OR_GEAR_PLAY_PER_TURN" && r?.type === "LEGEND" && played?.controllerId === b.controllerId && revision?.colors.includes("BLUE") && effectiveCardTypes(state, played.id, context).some(t => t === "UNIT" || t === "GEAR") && state.turnHistory!.blueUnitOrGearPlays[b.controllerId] === 1;
}
export function validateTriggerState(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.triggerContinuation, history = state.turnHistory, enabled = triggersEnabled(context);
    const all = [...r.pending, ...(r.current ? [r.current] : []), ...r.discovered];
    if (!enabled && (c || history || all.some(e => e.trigger))) return failure("UNSUPPORTED_TRIGGER_POLICY", "Trigger/history data require the bounded policy");
    if (enabled && (!context.content.ruleset.gameplay?.turnSlice?.combatRestrictions || (!state.setup && (!history || history.turn !== state.timing.turn || canonicalSerialize(Object.keys(history.blueUnitOrGearPlays).sort()) !== canonicalSerialize([...state.match.playerOrder].sort()))))) return failure("INVALID_TURN_HISTORY", "Current turn, exact player counters and prior combat policy required");
    if (state.setup && history) return failure("INVALID_TURN_HISTORY", "Turn history starts with the first actual turn");
    if (history && (programPlayHistoryEnabled(context) ? !history.programPlays || canonicalSerialize(Object.keys(history.programPlays).sort()) !== canonicalSerialize([...state.match.playerOrder].sort()) : history.programPlays)) return failure("INVALID_TURN_HISTORY", "Program-play counters exist exactly for each player under the reviewed policy");
    if (!c) return all.some(e => e.trigger || e.primitiveIndex !== undefined) || state.timing.combat.stage === "TRIGGER_RESOLUTION" || ["EDDIE_READY_SELECTION", "DISCARD_SELECTION", "TRIGGER_ORDER_SELECTION", "OPTIONAL_TRIGGER_SELECTION"].includes(state.timing.step ?? "") ? failure("ORPHAN_TRIGGER", "Pending trigger metadata requires its continuation") : success(null);
    if (!enabled || state.setup || state.match.outcome || r.returnTo || r.legendEntryContinuation || r.playContinuation || r.callContinuation || (r.searchContinuation && !isSearchEffect(r.current?.effect)) || r.gigStealContinuation || (r.defeatContinuation && !r.targetedDefeatContinuation) || r.discovered.length || r.stage !== "CHOICE" || !r.choice || c.ordinal !== history?.triggeredBatches || Object.values(state.objects.cards).some(c => c.zone.zone === "RESOLVING_PROGRAM")) return failure("INVALID_TRIGGER_CONTINUATION", "Exclusive player-choice trigger batch required");
    const combat = state.timing.combat;
    if (c.origin.kind === "END_TURN" && (!(endTurnEnabled(context) || delayedEffectsEnabled(context)) || c.origin.playerId !== state.timing.activePlayer || c.origin.turn !== state.timing.turn)) return failure("INVALID_END_TURN_RETURN", "Current active player/global turn and supported end-turn policy required");
    if (c.origin.kind === "PLAY" || c.origin.kind === "END_TURN" || c.origin.kind === "DEFEAT" && c.origin.effectSource ? combat.stage !== "NONE" : combat.stage !== "TRIGGER_RESOLUTION" || combat.attackingPlayerId !== state.timing.activePlayer) return failure("INVALID_TRIGGER_COMBAT", "Trigger batch must pause its original combat stage");
    if (combat.stage === "TRIGGER_RESOLUTION") {
        const attacker = state.objects.cards[combat.attackerId];
        const targetValid = combat.target.kind === "CARD" ? state.objects.cards[combat.target.cardInstanceId]?.controllerId !== combat.attackingPlayerId && Boolean(state.objects.cards[combat.target.cardInstanceId]) : Boolean(state.players[combat.target.playerId]) && combat.target.playerId !== combat.attackingPlayerId;
        if (!attacker || attacker.controllerId !== combat.attackingPlayerId || !targetValid) return failure("INVALID_TRIGGER_COMBAT", "Historical participants must retain valid identity/controller references");
        if (c.origin.kind !== "DEFEAT" && (attacker.zone.zone !== "BATTLEFIELD" || (combat.target.kind === "CARD" && state.objects.cards[combat.target.cardInstanceId].zone.zone !== "BATTLEFIELD"))) return failure("UNSUPPORTED_TRIGGER_DEPARTURE", "Admitted pending primitives cannot move combat participants");
    }
    if (c.origin.kind === "ATTACK" && (combat.stage !== "TRIGGER_RESOLUTION" || combat.attackerId !== c.origin.subjectId || state.objects.cards[combat.attackerId].readiness !== "SPENT")) return failure("INVALID_ATTACK_TRIGGER", "Committed attacking subject required");
    // Batch V17: the blocking Unit is the spent defending Unit of the paused attack, and every Blocker-used
    // binding it had at declaration is captured once (its primitives cannot move or reveal sources).
    if (c.origin.kind === "BLOCK") {
        const subject = state.objects.cards[c.origin.subjectId];
        if (combat.stage !== "TRIGGER_RESOLUTION" || combat.target.kind !== "CARD" || combat.target.cardInstanceId !== c.origin.subjectId || !subject || subject.zone.zone !== "BATTLEFIELD" || subject.readiness !== "SPENT" || subject.controllerId === combat.attackingPlayerId)
            return failure("INVALID_BLOCK_TRIGGER", "The spent blocking Unit must be the current defending Unit");
        if (canonicalSerialize(discoverTriggers(state, c.origin, context).map(b => canonicalSerialize(b)).sort()) !== canonicalSerialize(c.bindings.map(b => canonicalSerialize(b)).sort()))
            return failure("INVALID_TRIGGER_BATCH", "Every Blocker-used ability must be captured once");
    }
    // Batch V24: the stolen Gigs are distinct, rolled and now in the attacking player's Gig area; the steal
    // subject is the attacker of the paused Gig-area attack, and every steal binding is captured once.
    if (c.origin.kind === "STEAL") {
        const ids = c.origin.gigInstanceIds, subject = state.objects.cards[c.origin.subjectId];
        if (combat.stage !== "TRIGGER_RESOLUTION" || combat.target.kind !== "GIG_AREA" || combat.attackerId !== c.origin.subjectId || !subject || subject.zone.zone !== "BATTLEFIELD"
            || new Set(ids).size !== ids.length || canonicalSerialize([...ids].sort()) !== canonicalSerialize(ids)
            || ids.some(id => { const g = state.objects.gigs[id]; return !g || g.controllerId !== combat.attackingPlayerId || g.location.zone !== "GIGS" || g.roll.kind !== "ROLLED"; }))
            return failure("INVALID_STEAL_TRIGGER", "Steal triggers need the current Gig-area attacker and the distinct Gigs it stole");
        if (canonicalSerialize(discoverTriggers(state, c.origin, context).map(b => canonicalSerialize(b)).sort()) !== canonicalSerialize(c.bindings.map(b => canonicalSerialize(b)).sort()))
            return failure("INVALID_TRIGGER_BATCH", "Every steal trigger must be captured once per stolen Gig");
    }
    if (c.origin.kind === "DEFEAT" && (new Set(c.origin.defeated.map(d => d.targetId)).size !== c.origin.defeated.length || c.origin.defeated.some(d => !state.objects.cards[d.defeatedBy] || !state.objects.cards[d.targetId] || ["BATTLEFIELD", "LEGENDS"].includes(state.objects.cards[d.targetId].zone.zone)))) return failure("INVALID_DEFEATED_TRIGGER", "Defeat declaration and movement must precede the pending batch");
    const effectDefeats = validateEffectDefeatFacts(state, context); if (!effectDefeats.ok) return effectDefeats;
    if (c.bindings.some(b => !validBinding(state, b, context))) return failure("INVALID_TRIGGER_SOURCE", "Immutable source, inherited subject, trigger-time controller and origin must match reviewed text");
    if (c.origin.kind === "ATTACK" && (firstAttackHistoryEnabled(context) || attackConditionPowerEnabled(context))) {
        // These admitted attack primitives cannot remove/reveal sources. The complete captured
        // batch must therefore match declaration-time discovery, including already resolved bindings.
        const expected = discoverTriggers(state, c.origin, context).map(b => canonicalSerialize(b)).sort();
        if (canonicalSerialize(expected) !== canonicalSerialize(c.bindings.map(b => canonicalSerialize(b)).sort()))
            return failure("INVALID_TRIGGER_BATCH", "Every eligible attack source must be captured once");
    }
    const ids = c.bindings.map(b => triggerId(state, b, c.ordinal)), remaining = all.map(e => e.id), partition = [...remaining, ...c.resolvedIds];
    if (new Set(ids).size !== ids.length || new Set(partition).size !== partition.length || canonicalSerialize([...partition].sort()) !== canonicalSerialize([...ids].sort())) return failure("INVALID_TRIGGER_BATCH", "Every captured independent trigger must be exactly pending, current or resolved");
    for (const e of all) {
        if (e.primitiveIndex !== undefined && (e !== r.current || e.primitiveIndex !== 1 || !(supportsOrderedTriggerSource(cardRevision(state, e.sourceId!, context), context) || e.trigger?.kind === "WHEN_ATTACKING" && supportsDelayedAttackGear(cardRevision(state, e.sourceId!, context), context).ok))) return failure("INVALID_PRIMITIVE_INDEX", "Only the current reviewed ordered ability may advance to its second primitive");
        const binding = c.bindings.find(b => triggerId(state, b, c.ordinal) === e.id);
        if (!binding || canonicalSerialize(e) !== canonicalSerialize(pendingTrigger(state, binding, c.ordinal, e.causedBySequence, context, e.primitiveIndex ?? 0))) return failure("INVALID_PENDING_TRIGGER", "Pending effect must equal its immutable ability and semantic origin");
    }
    const activeIds = c.bindings.filter(b => b.controllerId === state.timing.activePlayer).map(b => triggerId(state, b, c.ordinal));
    const rivalHasResolved = c.resolvedIds.some(id => !activeIds.includes(id));
    if ((r.current && r.current.controllerId !== state.timing.activePlayer || rivalHasResolved) && activeIds.some(id => !c.resolvedIds.includes(id))) return failure("INVALID_TRIGGER_PRIORITY", "Turn player's pending effects precede the rival's");
    if (c.phase === "SELECT" ? Boolean(r.current) || nextTriggerGroup(state).length < 2 : !r.current) return failure("INVALID_TRIGGER_PHASE", "Ordering is strategic only with multiple eligible effects; effect choices require a current effect");
    if (c.phase !== "SELECT" && (!r.current || !["DEFEAT_UNIT", "READY_EDDIES", "DISCARD_CARDS", "DECREASE_GIG_UP_TO", "ADJUST_GIG_UP_TO", "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN", "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND", "POWER_UNTIL_END_OF_TURN", "SPEND_UNIT", "READY_UNIT", "RETURN_TRASH_UNIT_TO_HAND", "SEARCH_GEAR", "SEARCH_COST_MATCHING_GIGS", "TRASH_THEN_RETURN_PROGRAM", "GRANT_KEYWORD_UNTIL_END_OF_TURN", "PREVENT_UNIT_READY", "SWAP_GIGS", "READY_LEGENDS_UP_TO", "READY_UNITS_UP_TO", "SPEND_UNITS_PER_VALUE_PAIR", "DISCARD_PROGRAMS_THEN_BOTTOM_DECK", "STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD"].includes(r.current.effect.kind))) return failure("INVALID_TRIGGER_PHASE", "Only reviewed adjustment/look/discard/ready/power/spend/trash-return primitives pause for choices");
    // Batch V19: the reviewed [Attack] Gear search pauses only for its own looked-at cards (search-state owns the details).
    if (isSearchEffect(r.current?.effect) !== Boolean(r.searchContinuation) || r.current?.effect.kind === "SEARCH_GEAR" && (c.phase !== "TARGET" || c.origin.kind !== "ATTACK" || r.current.trigger?.kind !== "WHEN_ATTACKING" || !supportsAttackSearchUnit(cardRevision(state, r.current.sourceId!, context), context).ok)) return failure("INVALID_SEARCH_CONTINUATION", "Only the reviewed attack search pauses for its looked-at cards");
    // Batch V35: the pinned {Play} cost-matching search pauses only in its own PLAY batch.
    if (r.current?.effect.kind === "SEARCH_COST_MATCHING_GIGS" && (c.phase !== "TARGET" || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED" || !supportsGigSearchUnit(cardRevision(state, r.current.sourceId!, context), context).ok)) return failure("INVALID_SEARCH_CONTINUATION", "Only the reviewed {Play} cost-matching search pauses for its looked-at cards");
    // Batch V20: the pinned {Play} trash-3 Program pick and Adrenaline grant pause only for their own strategic targets.
    const trashed = validateTrashProgramPause(state, context); if (!trashed.ok) return trashed;
    if (r.current?.effect.kind === "GRANT_KEYWORD_UNTIL_END_OF_TURN") {
        const source = r.current.sourceId ? state.objects.cards[r.current.sourceId] : undefined;
        if (c.phase !== "TARGET" || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED" || r.current.primitiveIndex !== undefined || !source || source.face !== "UP" || source.zone.zone !== "BATTLEFIELD"
            || c.origin.subjectId !== source.id || r.current.trigger.subjectId !== source.id || !supportsPinnedPlayUnit(cardRevision(state, source.id, context), context).ok || keywordGrantTargets(state, r.current, context).length < 2)
            return failure("INVALID_KEYWORD_GRANT_CONTINUATION", "Only the reviewed {Play} Adrenaline grant pauses, for 2+ eligible friendly Units");
    }
    // Batch V22: the pinned {Play} ready lock pauses only after its condition held, for 2+ current rival Units.
    if (r.current?.effect.kind === "PREVENT_UNIT_READY") {
        const e = r.current.effect, source = r.current.sourceId ? state.objects.cards[r.current.sourceId] : undefined;
        if (c.phase !== "TARGET" || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED" || r.current.primitiveIndex !== undefined || !source
            || c.origin.subjectId !== source.id || r.current.trigger.subjectId !== source.id || !supportsPinnedPlayUnit(cardRevision(state, source.id, context), context).ok
            || e.when && !testCondition(state, r.current.controllerId, e.when.condition, context, source.id) || listSpendUnitTargets(state, r.current.controllerId, e.target, context).length < 2)
            return failure("INVALID_READY_LOCK_CONTINUATION", "Only the reviewed {Play} ready lock pauses, after its condition, for 2+ rival Units");
    }
    // Batch V13: the reviewed Unit DEFEATED trash return pauses only for its own target.
    if (r.current?.effect.kind === "RETURN_TRASH_UNIT_TO_HAND" && (c.phase !== "TARGET" || c.origin.kind !== "DEFEAT" || r.current.trigger?.kind !== "WHEN_DEFEATED" || r.current.primitiveIndex !== undefined || !supportsTriggerCard(cardRevision(state, r.current.sourceId!, context), context).ok)) return failure("INVALID_TRASH_RETURN_CONTINUATION", "Only the reviewed DEFEATED trash return may pause for a trash Unit");
    // Batch V8: the Unit PLAY rival spend pauses only as its ordered second primitive; the
    // Legend ready pauses only in its own-turn end batch.
    if (r.current?.effect.kind === "SPEND_UNIT" && (c.phase !== "TARGET" || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED" || r.current.primitiveIndex !== 1)) return failure("INVALID_SPEND_CONTINUATION", "Only the reviewed ordered PLAY spend may pause for a rival Unit");
    // Batch V29: the value-pair Legend ready pauses only in its own attack batch, while its condition holds, holding at most one
    // already-readied Legend, with another eligible Legend still to choose.
    if (c.readiedLegends && r.current?.effect.kind !== "READY_LEGENDS_UP_TO") return failure("INVALID_READY_SELECTION", "Readied Legends belong only to the current tagged Legend ready");
    if (r.current?.effect.kind === "READY_LEGENDS_UP_TO") {
        const e = r.current.effect, source = r.current.sourceId ? state.objects.cards[r.current.sourceId] : undefined, all = taggedLegendReadyTargets(state, r.current.controllerId, e.tag, context);
        if (c.phase !== "TARGET" || c.origin.kind !== "ATTACK" || r.current.trigger?.kind !== "WHEN_ATTACKING" || r.current.primitiveIndex !== undefined || !source
            || c.origin.subjectId !== source.id || r.current.trigger.subjectId !== source.id || !supportsTriggerCard(cardRevision(state, source.id, context), context).ok
            || !testCondition(state, r.current.controllerId, e.when.condition, context, source.id)
            || (c.readiedLegends ?? []).some(id => !all.includes(id)) || (c.readiedLegends?.length ?? 0) >= e.maximum || !all.some(id => !c.readiedLegends?.includes(id)))
            return failure("INVALID_READY_LEGENDS_CONTINUATION", "Only the reviewed value-pair Legend ready pauses, with an eligible Legend left to choose");
    }
    // Batch V38: the own-turn end Unit ready pauses only in its own END_TURN batch, holding at most 2 already-readied Units, with
    // another friendly Unit still to choose.
    if (c.readiedUnits && r.current?.effect.kind !== "READY_UNITS_UP_TO") return failure("INVALID_READY_SELECTION", "Readied Units belong only to the current friendly Unit ready");
    if (r.current?.effect.kind === "READY_UNITS_UP_TO") {
        const e = r.current.effect, source = r.current.sourceId ? state.objects.cards[r.current.sourceId] : undefined, all = friendlyUnitReadyTargets(state, r.current.controllerId, context);
        if (c.phase !== "TARGET" || c.origin.kind !== "END_TURN" || r.current.trigger?.kind !== "WHEN_OWN_TURN_ENDS" || r.current.primitiveIndex !== undefined || !source
            || r.current.trigger.subjectId !== source.id || source.controllerId !== r.current.controllerId || !supportsAttackingReadyUnit(cardRevision(state, source.id, context), context).ok
            || (c.readiedUnits ?? []).some(id => !all.includes(id)) || (c.readiedUnits?.length ?? 0) >= e.maximum || !all.some(id => !c.readiedUnits?.includes(id)))
            return failure("INVALID_READY_UNITS_CONTINUATION", "Only the reviewed own-turn end Unit ready pauses, with a friendly Unit left to choose");
    }
    // Batch V30: the per-value-pair rival spend pauses only in its own PLAY batch, with 1 to (pairs) spends left and 2+ rival Units.
    if (c.discardedCardId && (c.phase !== "DISCARD" || r.current?.effect.kind !== "DISCARD_CARDS" || !r.current.effect.more)) return failure("INVALID_DISCARD_CONTINUATION", "A held discarded card belongs only to the current \"discards 1 more\"");
    if (c.spendsRemaining !== undefined && r.current?.effect.kind !== "SPEND_UNITS_PER_VALUE_PAIR") return failure("INVALID_SPEND_COUNT", "Remaining spends belong only to the current per-value-pair spend");
    if (r.current?.effect.kind === "SPEND_UNITS_PER_VALUE_PAIR") {
        const source = r.current.sourceId ? state.objects.cards[r.current.sourceId] : undefined;
        if (c.phase !== "TARGET" || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED" || r.current.primitiveIndex !== undefined || !source
            || c.origin.subjectId !== source.id || r.current.trigger.subjectId !== source.id || !supportsTriggerCard(cardRevision(state, source.id, context), context).ok
            || !c.spendsRemaining || c.spendsRemaining > friendlyValuePairCount(state, r.current.controllerId) || listSpendUnitTargets(state, r.current.controllerId, r.current.effect.target, context).length < 2)
            return failure("INVALID_SPEND_CONTINUATION", "Only the reviewed per-value-pair PLAY spend pauses, with spends left, for 2+ rival Units");
    }
    // Batch V32: the pinned Program discard holds its discarded Programs only while it is current.
    if (c.discardedPrograms && r.current?.effect.kind !== "DISCARD_PROGRAMS_THEN_BOTTOM_DECK") return failure("INVALID_PROGRAM_DISCARD_CONTINUATION", "Discarded Programs belong only to the current Program discard");
    if (r.current?.effect.kind === "DISCARD_PROGRAMS_THEN_BOTTOM_DECK") { const v = validateProgramDiscard(state, context); if (!v.ok) return v; }
    // Batch V25: the steal-trigger ready of another friendly Unit pauses only in its steal batch, for its eligible Units.
    if (r.current?.effect.kind === "READY_UNIT" && (c.phase !== "TARGET" || (r.current.effect.target.kind === "ANOTHER_FRIENDLY_UNIT"
        ? c.origin.kind !== "STEAL" || r.current.trigger?.kind !== "WHEN_GIG_STOLEN" || !r.current.trigger.gigInstanceId || !stolenGigReadyTargets(state, r.current, context).length || !supportsTriggerCard(cardRevision(state, r.current.sourceId!, context), context).ok
        : c.origin.kind !== "END_TURN" || r.current.effect.target.kind !== "FRIENDLY_FACE_UP_LEGEND"))) return failure("INVALID_READY_UNIT_CONTINUATION", "Only the reviewed own-turn end Legend ready and steal-trigger Unit ready may pause for a target");
    if (r.current?.effect.kind === "POWER_UNTIL_END_OF_TURN") {
        const source = r.current.sourceId && state.objects.cards[r.current.sourceId];
        if (c.phase !== "TARGET" || r.current.effect.target.kind !== "FRIENDLY_UNIT" || r.current.effect.amount !== 2
            || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED"
            || !source || source.face !== "UP" || source.zone.zone !== "BATTLEFIELD"
            || c.origin.subjectId !== source.id || r.current.trigger.subjectId !== source.id
            || !supportsFriendlyPlayPowerUnit(cardRevision(state, source.id, context), context).ok)
            return failure("INVALID_POWER_CONTINUATION", "Only the reviewed friendly+2 PLAY trigger may pause for a Unit target");
    }
    if ((c.phase === "READY" || r.current?.effect.kind === "READY_EDDIES") && (c.phase !== "READY" || r.current?.effect.kind !== "READY_EDDIES" || c.origin.kind !== "END_TURN")) return failure("INVALID_READY_CONTINUATION", "Ready choices require their pending end-turn ability");
    if (c.selectedEddieSlots && (c.phase !== "READY" || r.current?.effect.kind !== "READY_EDDIES" || r.current.effect.count !== 2 || c.selectedEddieSlots.some(slot => !readyableEddieSlots(state, r.current!.controllerId).includes(slot))))
        return failure("INVALID_READY_SELECTION", "Only a count2 ready choice may hold one still-spent public slot");
    if (c.phase === "READY" && r.current?.effect.kind === "READY_EDDIES") {
        const e = r.current.effect, selected = c.selectedEddieSlots ?? [], available = readyableEddieSlots(state, r.current.controllerId).filter(slot => !selected.includes(slot));
        if (available.length <= e.count - selected.length || e.when && !testCondition(state, r.current.controllerId, e.when.condition, context, r.current.trigger!.subjectId, delayedSubjectTypes(state)))
            return failure("INVALID_READY_CONTINUATION", "Only a true-condition strategic selection may remain pending; forced cases resolve automatically");
    }
    if (r.current?.effect.kind === "DISCARD_CARDS" && r.current.effect.player === "RIVAL") {
        // Batch V17: the unconditional rival discard pauses only for the rival's own hand card.
        const e = r.current, when = e.effect.kind === "DISCARD_CARDS" ? e.effect.when : undefined;
        const blocker = c.conditionMet === undefined && !when && c.origin.kind === "BLOCK" && e.trigger?.kind === "WHEN_BLOCKER_USED";
        // Batch V24: the steal-trigger rival discard pauses only after its resolution-time "if it's equipped" held.
        const steal = c.conditionMet === true && when?.condition.kind === "SUBJECT_IS_EQUIPPED" && c.origin.kind === "STEAL" && e.trigger?.kind === "WHEN_GIG_STOLEN" && testCondition(state, e.controllerId, when.condition, context, e.sourceId);
        // Batch V31: the defeated rival discard, and its "1 more" only after a discarded card whose cost matched a friendly Gig.
        const more = e.effect.kind === "DISCARD_CARDS" ? e.effect.more : undefined, first = c.discardedCardId ? state.objects.cards[c.discardedCardId] : undefined;
        const defeated = c.conditionMet === undefined && !when && Boolean(more) && c.origin.kind === "DEFEAT" && e.trigger?.kind === "WHEN_DEFEATED" && supportsTargetedDefeatCard(cardRevision(state, e.sourceId!, context), context).ok
            && (!c.discardedCardId || Boolean(first) && first!.zone.zone === "TRASH" && first!.ownerId === discardingPlayer(state, e) && discardedCostMatchesFriendlyGig(state, e.controllerId, first!.id, context));
        // Batch V41: the Go Solo Legend's plain {Defeated} rival discard.
        const legend = c.conditionMet === undefined && !when && !more && c.origin.kind === "DEFEAT" && e.trigger?.kind === "WHEN_DEFEATED" && supportsLegendReveal(cardRevision(state, e.sourceId!, context), context).ok;
        if (c.phase !== "DISCARD" || e.effect.kind !== "DISCARD_CARDS" || e.primitiveIndex !== undefined || !(blocker || steal || defeated || legend) || !(defeated || supportsTriggerCard(cardRevision(state, e.sourceId!, context), context).ok))
            return failure("INVALID_DISCARD_CONTINUATION", "Only the reviewed Blocker-used, steal-trigger and defeated rival discards pause");
    }
    // Batch V40: the parity branch pauses only for the rival's discard, in its friendly-Legend STEAL batch, while the stolen Gig is odd.
    else if (r.current?.effect.kind === "STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD") {
        const e = r.current;
        if (c.phase !== "DISCARD" || c.conditionMet !== undefined || e.primitiveIndex !== undefined || c.origin.kind !== "STEAL" || e.trigger?.kind !== "WHEN_FRIENDLY_UNIT_STEALS_GIG" || stolenGigParity(state, e) !== "ODD"
            || !supportsLegendStealTrigger(cardRevision(state, e.sourceId!, context), context).ok)
            return failure("INVALID_DISCARD_CONTINUATION", "Only the reviewed friendly-Legend steal parity branch pauses for an odd Gig's rival discard");
    }
    else if (c.phase === "DISCARD" && r.current?.effect.kind !== "DISCARD_PROGRAMS_THEN_BOTTOM_DECK" || r.current?.effect.kind === "DISCARD_CARDS" || c.conditionMet !== undefined) {
        const e = r.current;
        // No admitted primitive can change Gigs while paused here. Historical true and current
        // true must agree; advancing an index cannot manufacture a false-condition discard.
        if (c.phase !== "DISCARD" || e?.effect.kind !== "DISCARD_CARDS" || e.primitiveIndex !== 1 || c.conditionMet !== true || !e.effect.when || !testCondition(state, e.controllerId, e.effect.when.condition, context, e.sourceId)) return failure("INVALID_DISCARD_CONTINUATION", "Post-draw true condition and exact current second primitive required");
    }
    if (r.current?.effect.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND" && c.phase !== "TARGET") return failure("INVALID_TRIGGER_PHASE", "Private look pauses only for a target");
    if (c.phase === "OPTIONAL" && r.current?.effect.kind !== "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN" && r.current?.effect.kind !== "SWAP_GIGS") return failure("INVALID_OPTIONAL_TRIGGER", "Only the printed may effect offers acceptance");
    // Batch V23: the pinned {Play} swap pauses to accept, then for its friendly Gig, then (holding that Gig) for the rival Gig.
    if (r.current?.effect.kind === "SWAP_GIGS") {
        const source = r.current.sourceId ? state.objects.cards[r.current.sourceId] : undefined, held = c.targetGigId ? state.objects.gigs[c.targetGigId] : undefined;
        if (!(c.phase === "OPTIONAL" || c.phase === "TARGET") || c.origin.kind !== "PLAY" || r.current.trigger?.kind !== "WHEN_PLAYED" || r.current.primitiveIndex !== undefined || !source
            || c.origin.subjectId !== source.id || r.current.trigger.subjectId !== source.id || !supportsPinnedPlayUnit(cardRevision(state, source.id, context), context).ok
            || !swapSidesAvailable(state, r.current.controllerId) || c.targetGigId && (c.phase !== "TARGET" || !held || held.controllerId !== r.current.controllerId || held.location.zone !== "GIGS" || held.roll.kind !== "ROLLED"))
            return failure("INVALID_GIG_SWAP_CONTINUATION", "Only the reviewed {Play} swap pauses, holding at most its chosen friendly Gig");
    }
    else if (c.phase === "AMOUNT" ? !c.targetGigId || !triggerGigTargets(state).includes(c.targetGigId) : Boolean(c.targetGigId)) return failure("INVALID_TRIGGER_TARGET", "Exact target required only during amount selection");
    if (r.targetedDefeatContinuation) return success(null); // Current target/owner order has its bounded validator.
    const expectedStep = c.phase === "READY" ? "EDDIE_READY_SELECTION" : c.phase === "DISCARD" ? "DISCARD_SELECTION" : c.phase === "SELECT" ? "TRIGGER_ORDER_SELECTION" : c.phase === "OPTIONAL" ? "OPTIONAL_TRIGGER_SELECTION" : c.phase === "TARGET" ? "TARGET_SELECTION" : "AMOUNT_SELECTION";
    if (state.timing.step !== expectedStep || state.timing.window !== expectedStep || canonicalSerialize(r.choice) !== canonicalSerialize(triggerChoice(state, context)) || r.choice.options.length < 2) return failure("INVALID_TRIGGER_CHOICE", "Only exact strategic current options may pause automatic resolution");
    return success(null);
}
