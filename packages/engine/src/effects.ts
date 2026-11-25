import { applyMustAttack, mustAttackTargets } from "./must-attack";
import { applyGearPower, friendlyGearTargets, resolveGearDefeatDraw } from "./gear-legend";
import { resolveTrashTop } from "./braindance-legend";
import { resolveRivalReveal } from "./rival-reveal";
import { resolveHandReset } from "./hand-reset";
import { resolveUnitGrant } from "./ready-attack-grant";
import { applyBlockerGrant, blockerGrantTargets } from "./blocker-grant";
import { applyRockerGrant, rockerGrantTargets } from "./rocker-grant";
import { beginGearMove } from "./gear-move";
import { applyAttackLock, currentLockTargets } from "./attack-lock";
import { applyEquippedGearPower, currentEquippedTargets } from "./end-turn-defeat";
import { beginProgramFreeCall } from "./free-call-effect";
import { grantGoSoloDiscount } from "./go-solo-discount";
import { applyFightDefeatImmunity } from "./fight-immunity";
import { advanceCrossSet, advanceMandatorySwap, isLegendCallPower, mandatorySwapAvailable, playPowerTargets } from "./legend-spend";
import { applyFightPowerGrant, friendlyFieldUnits } from "./fight-power-grant";
import { applyStealReduction } from "./steal-reduction";
import { beginTargetedSpend } from "./targeted-spend";
import { resolveRevealTopGainPower } from "./legend-reveal";
import { beginTargetedDefeat } from "./targeted-defeat";
import { createFightPrevention } from "./fight-prevention";
import { powerTargets } from "./react-queries";
import { applyTemporaryPower } from "./temporary-power";
import { testCondition } from "./conditions";
import { adjustmentTargets } from "./play-state";
import { offerPlayChoice } from "./play";
import { failure, success, type Effect, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { isProgramSearchEffect, programSearchMaxTake, searchChoice, searchTargets } from "./search-state";
import { drawDeterministicInteger } from "./rng";
import { isUnitSpendSubject, spendUnitForEffect } from "./unit-spend";
import { resolveTrashThenReturn } from "./trash-return";
import { resolveTrashThenAddProgram } from "./trash-program";
import { resolveBottomDeck } from "./bottom-deck";
import { resolveDrawPerFriendlyGig, resolvePowerPerFriendlyGig } from "./gig-parity";
import { gigSetTargets } from "./gig-value";
import { resolveSellTopOfDeck } from "./program-sell";
import { createFightOutcomeEffect } from "./fight-outcome";

type Primitive<K extends Effect["kind"]> = Extract<Effect, { kind: K }>;
/** Handwritten, typed primitive registry; metadata cannot install arbitrary handlers. */
export class HandlerRegistry {
    readonly primitives = {
    POWER_UNTIL_END_OF_TURN: (m: TurnMutation): Result<null> => {
        const current = m.state.resolution.current!;
        if (current.effect.kind === "POWER_UNTIL_END_OF_TURN" && current.effect.target.kind === "FRIENDLY_UNIT" && !isLegendCallPower(m.state, m.context))
            return failure("INVALID_POWER_CONTINUATION", "Friendly PLAY power targets are resolved by the trigger scheduler, never a Program continuation");
        if (current.effect.kind === "POWER_UNTIL_END_OF_TURN" && current.effect.target.kind === "SOURCE_SUBJECT") {
            const source = current.sourceId && m.context.content.cards.find(c => c.id === m.state.objects.cards[current.sourceId!].cardId && c.revision === m.state.objects.cards[current.sourceId!].revision);
            const a = source?.mechanics.abilities.find(a => a.id === current.trigger?.abilityId);
            if (!a || !current.trigger) return failure("INVALID_POWER_SOURCE", "Self power requires its captured ATTACK binding");
            const met = a.conditions.every(c => testCondition(m.state, current.controllerId, c, m.context, current.trigger!.subjectId));
            m.emit({ kind: "CONDITION_EVALUATED", effectId: current.id, met });
            return met ? applyTemporaryPower(m, current.trigger.subjectId) : success(null);
        }
        const targets = playPowerTargets(m.state, m.state.timing.actingPlayer, m.context); // Batch V60: a Called Legend's friendly Unit.
        // Batch V54: "all rival Units": each Unit there as the effect resolves, with no choice.
        if (current.effect.kind === "POWER_UNTIL_END_OF_TURN" && current.effect.target.kind === "ALL_RIVAL_UNITS") {
            for (const id of targets) { const applied = applyTemporaryPower(m, id, true); if (!applied.ok) return applied; }
            return success(null);
        }
        return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyTemporaryPower(m, targets[0], true) : success(null);
    },
    ADJUST_GIG_UP_TO: (m: TurnMutation): Result<null> => adjustmentTargets(m.state).length ? offerPlayChoice(m) : success(null),
    CONDITIONAL_DRAW: (m: TurnMutation, effect: Primitive<"CONDITIONAL_DRAW">): Result<null> => {
        const met = testCondition(m.state, m.state.timing.actingPlayer, effect.condition, m.context, m.state.resolution.current?.sourceId);
        m.emit({ kind: "CONDITION_EVALUATED", effectId: m.state.resolution.current!.id, met });
        return met ? this.primitives.DRAW(m, { kind: "DRAW", count: effect.count }) : success(null);
    },
    DRAW: (m: TurnMutation, effect: Primitive<"DRAW">) => m.draw(m.state.timing.actingPlayer, effect.count),
    SEARCH_GEAR: (m: TurnMutation, effect: Primitive<"SEARCH_GEAR">): Result<null> => {
        const s = m.state, actor = s.timing.actingPlayer;
        s.resolution.searchContinuation = { looked: [...s.players[actor].zones.DECK.slice(0, effect.count)], selected: [] };
        return offerSearch(m);
    },
    // Batch V36: the resolving Program's search; its choices pause the play continuation.
    SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG: (m: TurnMutation, effect: Primitive<"SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG">): Result<null> => {
        const s = m.state, actor = s.resolution.current!.controllerId;
        s.resolution.searchContinuation = { looked: [...s.players[actor].zones.DECK.slice(0, effect.count)], selected: [] };
        return offerSearch(m);
    }
    };
    resolve(m: TurnMutation, effect: Effect): Result<null> {
        if (effect.kind === "FORCE_RIVAL_UNIT_ATTACK") { // Batch V63: a Legend's {Spend}; a lone rival Unit is forced and none does nothing.
            const targets = mustAttackTargets(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyMustAttack(m, targets[0], true) : success(null);
        }
        if (effect.kind === "SET_GIG_TO_ANOTHER_PLAYERS_GIG_VALUE") { // Batch V62: mandatory; with no settable pair it does nothing.
            const advanced = advanceCrossSet(m, undefined, undefined);
            return !advanced.ok ? advanced : advanced.value === "CHOICE" ? offerPlayChoice(m) : success(null);
        }
        if (effect.kind === "SWAP_GIGS" && !effect.optional) { // Batch V59: a mandatory swap; with no Gig on either side it does nothing.
            const actor = m.state.resolution.current!.controllerId;
            if (!mandatorySwapAvailable(m.state, actor)) return success(null);
            const advanced = advanceMandatorySwap(m, actor, undefined);
            return !advanced.ok ? advanced : advanced.value === "CHOICE" ? offerPlayChoice(m) : success(null);
        }
        if (effect.kind === "FIGHT_DEFEAT_IMMUNITY_THIS_TURN") { // Batch V61: one friendly Unit; a lone Unit is forced and none does nothing.
            const targets = friendlyFieldUnits(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyFightDefeatImmunity(m, targets[0], true) : success(null);
        }
        if (effect.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH") return resolveRivalReveal(m, offerPlayChoice); // Batch V77: the Rival chooses.
        if (effect.kind === "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW") return resolveHandReset(m, offerPlayChoice); // Batch V78: each player chooses in turn.
        if (effect.kind === "FRIENDLY_UNIT_READY_ATTACK_AND_POWER") return resolveUnitGrant(m, offerPlayChoice); // Batch V79.
        if (effect.kind === "TRASH_TOP_MAY_ADD_PROGRAM") return resolveTrashTop(m, offerPlayChoice); // Batch V76: a trashed Program pauses for the take-or-leave.
        if (effect.kind === "MAY_DEFEAT_FRIENDLY_GEAR_THEN_DRAW") // Batch V75: with a friendly Gear, a defeat or the decline; with none, draw 1.
            return friendlyGearTargets(m.state, m.state.resolution.current!.controllerId, m.context).length ? offerPlayChoice(m) : resolveGearDefeatDraw(m, undefined, true);
        if (effect.kind === "POWER_PER_EQUIPPED_GEAR_THIS_TURN") { // Batch V75: one friendly Unit; a lone Unit is forced and none does nothing.
            const targets = friendlyFieldUnits(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyGearPower(m, targets[0], true) : success(null);
        }
        if (effect.kind === "EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN") { // Batch V90: any equipped Unit; a lone Unit is forced and none does nothing.
            const targets = currentEquippedTargets(m.state, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyEquippedGearPower(m, targets[0], true) : success(null);
        }
        if (effect.kind === "MOVE_SOURCE_GEAR_TO_UNEQUIPPED_UNIT_THEN_READY") return beginGearMove(m, offerPlayChoice); // Batch V82.
        if (effect.kind === "UNIT_CANNOT_ATTACK_UNTIL_YOUR_NEXT_TURN") { // Batch V83: any face-up field Unit; a lone Unit is forced and none does nothing.
            const targets = currentLockTargets(m.state, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyAttackLock(m, targets[0], true) : success(null);
        }
        if (effect.kind === "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN") return grantGoSoloDiscount(m); // Batch V83.
        if (effect.kind === "MAY_CALL_LEGEND_FREE") return beginProgramFreeCall(m, offerPlayChoice); // Batch V85.
        if (effect.kind === "FRIENDLY_UNIT_ATTACK_RIVAL_UNITS_THE_TURN_PLAYED") { // Batch V80: one friendly Unit; a lone Unit is forced and none does nothing.
            const targets = rockerGrantTargets(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyRockerGrant(m, targets[0], true) : success(null);
        }
        if (effect.kind === "GRANT_BLOCKER_THIS_TURN") { // Batch V74: one friendly Unit with cost 4 or less; a lone Unit is forced and none does nothing.
            const targets = blockerGrantTargets(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyBlockerGrant(m, targets[0], true) : success(null);
        }
        if (effect.kind === "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN") { // Batch V58: one friendly Unit; a lone Unit is forced and none does nothing.
            const targets = friendlyFieldUnits(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyFightPowerGrant(m, targets[0], true) : success(null);
        }
        if (effect.kind === "STEAL_FEWER_THIS_TURN") { // Batch V57: one rival Unit; a lone Unit is forced and none does nothing.
            const targets = powerTargets(m.state, m.state.resolution.current!.controllerId, m.context);
            return targets.length > 1 ? offerPlayChoice(m) : targets.length === 1 ? applyStealReduction(m, targets[0], true) : success(null);
        }
        if (effect.kind === "SPEND_UNIT") return beginTargetedSpend(m);
        if (effect.kind === "DEFEAT_UNIT") return beginTargetedDefeat(m);
        if (effect.kind === "SPEND_ALL_UNITS") return spendAllRivalUnits(m);
        if (effect.kind === "CREATE_NEXT_RIVAL_FIGHT_PREVENTION") return createFightPrevention(m);
        if (effect.kind === "REGISTER_NEXT_FIGHT_OUTCOME") return createFightOutcomeEffect(m); // Batch V46.
        if (effect.kind === "POWER_UNTIL_END_OF_TURN") return this.primitives.POWER_UNTIL_END_OF_TURN(m);
        if (effect.kind === "ADJUST_GIG_UP_TO") return this.primitives.ADJUST_GIG_UP_TO(m);
        if (effect.kind === "CONDITIONAL_DRAW") return this.primitives.CONDITIONAL_DRAW(m, effect);
        if (effect.kind === "DRAW") return this.primitives.DRAW(m, effect);
        if (effect.kind === "POWER_PER_FRIENDLY_GIG") return resolvePowerPerFriendlyGig(m);
        if (effect.kind === "DRAW_PER_FRIENDLY_GIG") return resolveDrawPerFriendlyGig(m);
        if (effect.kind === "REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST") return resolveRevealTopGainPower(m);
        if (effect.kind === "SEARCH_GEAR") return this.primitives.SEARCH_GEAR(m, effect);
        // Batch V37: the optional Gig set offers its targets and a decline; with no settable Gig it does nothing.
        if (effect.kind === "SET_GIG_TO_ANOTHER_GIG_VALUE") return gigSetTargets(m.state).length ? offerPlayChoice(m) : success(null);
        if (effect.kind === "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG") return this.primitives.SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG(m, effect);
        if (effect.kind === "TRASH_THEN_RETURN_UNIT") return resolveTrashThenReturn(m, effect, offerPlayChoice);
        if (effect.kind === "TRASH_THEN_ADD_TRASH_PROGRAM") return resolveTrashThenAddProgram(m, effect, offerPlayChoice); // Batch V73.
        if (effect.kind === "BOTTOM_DECK_UNIT") return resolveBottomDeck(m, offerPlayChoice);
        if (effect.kind === "SELL_TOP_OF_DECK") return resolveSellTopOfDeck(m); // Batch V45.
        return failure("UNSUPPORTED_CALL_EFFECT", "No registered typed CALL primitive");
    }
}
/** Batch V9 "Spend all rival Units": one simultaneous mass spend in instance-id order; already spent Units change nothing. */
function spendAllRivalUnits(m: TurnMutation): Result<null> {
    const current = m.state.resolution.current!, actor = current.controllerId;
    const targets = Object.values(m.state.players).filter(p => p.id !== actor).flatMap(p => p.zones.BATTLEFIELD).filter(id => isUnitSpendSubject(m.state, id, m.context)).sort();
    for (const id of targets) { const spent = spendUnitForEffect(m, id, current.sourceId!, current.id); if (!spent.ok) return spent; }
    return success(null);
}
const callHandlers = new HandlerRegistry();
export function resolveCallPrimitive(m: TurnMutation, effect: Effect): Result<null> {
    return callHandlers.resolve(m, effect);
}
export function finishSearch(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.searchContinuation!, actor = current.controllerId, p = s.players[actor];
    const selected = new Set(c.selected), reveal = !isProgramSearchEffect(current.effect); // V36 says "add", not "reveal": taken cards stay hidden.
    p.zones.DECK.splice(0, c.looked.length);
    for (const id of c.selected) {
        const card = s.objects.cards[id], from = { ...card.zone };
        if (reveal) m.emit({ kind: "CARD_REVEALED", cardInstanceId: id });
        card.zone = { playerId: actor, zone: "HAND" };
        p.zones.HAND.push(id);
        m.emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: card.zone });
    }
    const remainder = c.looked.filter(id => !selected.has(id)), rngCounter = s.rng.counter;
    for (let i = remainder.length - 1; i > 0; i--) {
        const r = drawDeterministicInteger(s.rng, i + 1);
        s.rng = r.rng;
        [remainder[i], remainder[r.rawValue - 1]] = [remainder[r.rawValue - 1], remainder[i]];
    }
    p.zones.DECK.push(...remainder);
    m.emit({ kind: "SEARCH_REMAINDER_BOTTOMED", playerId: actor, order: remainder, rngCounter });
    delete s.resolution.searchContinuation;
    s.resolution.choice = null;
    s.resolution.stage = "STATE_BASED_CHECKS";
    return success(null);
}
function offerSearch(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.searchContinuation!;
    if (current.effect.kind !== "SEARCH_GEAR" && !isProgramSearchEffect(current.effect)) return failure("INVALID_SEARCH_STATE", "Expected search primitive");
    const max = current.effect.kind === "SEARCH_GEAR" ? current.effect.maxTake : programSearchMaxTake(s, current.controllerId), remaining = searchTargets(s, m.context).filter(id => !c.selected.includes(id));
    if (c.selected.length >= max || !remaining.length) return finishSearch(m);
    s.resolution.choice = searchChoice(s, m.context);
    // Batch V36: "Add 1" is mandatory, so a lone looked-at card is taken without a choice.
    if (s.resolution.choice.options.length === 1) { c.selected.push(remaining[0]); s.resolution.choice = null; return offerSearch(m); }
    s.resolution.stage = "CHOICE";
    s.timing.step = "TARGET_SELECTION";
    s.timing.window = "TARGET_SELECTION";
    m.emit({ kind: "PHASE_CHANGED", step: "TARGET_SELECTION" });
    return success(null);
}
export function continueSearch(m: TurnMutation, index: number): Result<null> {
    const c = m.state.resolution.searchContinuation!, option = m.state.resolution.choice!.options[index];
    if (option.kind === "MODE" && option.mode === "DONE") return finishSearch(m);
    if (option.kind !== "CARD" || c.selected.includes(option.cardInstanceId) || !searchTargets(m.state, m.context).includes(option.cardInstanceId)) return failure("INVALID_SEARCH_TARGET", "Chosen Gear is no longer eligible");
    c.selected.push(option.cardInstanceId);
    return offerSearch(m);
}
