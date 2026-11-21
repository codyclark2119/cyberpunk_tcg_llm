import { isFirstHostSteal } from "./gear-steal-support";
import { fightWinGuardAllows } from "./fight-win-support";
import { belowPowerStealFires } from "./below-power-steal";
import { handPrograms, programBottomDeckTargets } from "./program-discard";
import { mustAttackTargets } from "./must-attack";
import { REVEAL_TYPES } from "./type-reveal-support";
import { gigAdjustmentOptions } from "./gig-value";
import { isFirstArasakaAttack } from "./first-attack-history";
import { effectiveCardTypes } from "./characteristics";
import { delayedBinding } from "./delayed-effects";
import { fightOutcomeBinding } from "./fight-outcome";
import { effectStealTargets } from "./fight-steal";
import { readyableEddieSlots } from "./eddie-ready";
import { testCondition } from "./conditions";
import { getDiscardableCards } from "./discard";
import { privateLookTargets } from "./private-knowledge";
import { friendlyPowerTargets } from "./friendly-play-power-queries";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import { friendlyUnitReadyTargets, readyLegendTargets, stolenGigReadyTargets, taggedLegendReadyTargets } from "./ready-unit";
import { hashCanonical, type GameState, type CardInstanceId, type PlayerId, type TriggerBinding, type TriggerOrigin, type PendingChoice, type PendingEffect } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { attachedGear } from "./attachments";
import { freeGearHosts, freeGearTargets, freePlayTargets } from "./free-play";
import { supportsEffectiveTriggerSource, triggersEnabled } from "./trigger-support";
import { searchTargets } from "./search-state";
import { keywordGrantTargets, trashedProgramTargets } from "./play-pin-effects";

/** Physical ability source, inherited subject and trigger-time controller are distinct identities. */
export function effectiveTriggeredAbilities(state: GameState, subjectId: CardInstanceId, context: EngineContext): TriggerBinding[] {
    const subject = state.objects.cards[subjectId];
    if (!triggersEnabled(context) || !subject || subject.face !== "UP" || !["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone)) return [];
    const sources = [subject, ...attachedGear(state, subjectId, context)];
    return sources.flatMap(source => {
        const r = cardRevision(state, source.id, context);
        if (!supportsEffectiveTriggerSource(r, context) || !r) return [];
        return r.mechanics.abilities.flatMap(a => {
            if (!a.trigger || (source.id !== subjectId) !== (a.inherited === "EQUIPPED_HOST") || !(a.trigger === "WHEN_FIGHT_WON" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_ATTACKING" || a.trigger === "WHEN_CARD_PLAYED" || a.trigger === "WHEN_OWN_TURN_ENDS" || a.trigger === "WHEN_UNIT_ATTACKS" || a.trigger === "WHEN_BLOCKER_USED" || a.trigger === "WHEN_GIG_STOLEN" || a.trigger === "WHEN_FRIENDLY_UNIT_STEALS_GIG" || a.trigger === "WHEN_UNIT_DEFEATED" || a.trigger === "WHEN_FIGHT_LOST")) return [];
            return [{ sourceId: source.id, subjectId, controllerId: subject.controllerId, source: { cardId: r.id, revision: r.revision }, abilityId: a.id, kind: a.trigger }];
        });
    }).sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.abilityId < b.abilityId ? -1 : a.abilityId > b.abilityId ? 1 : 0);
}
export function discoverTriggers(state: GameState, origin: TriggerOrigin, context: EngineContext): TriggerBinding[] {
    if (origin.kind === "END_TURN") return [...(origin.delayedEffects ?? []).map(delayedBinding), ...[...state.players[origin.playerId].zones.BATTLEFIELD, ...state.players[origin.playerId].zones.LEGENDS].flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => {
        const a = cardRevision(state, b.sourceId, context)!.mechanics.abilities.find(a => a.id === b.abilityId)!;
        return b.kind === "WHEN_OWN_TURN_ENDS" && b.controllerId === origin.playerId && a.conditions.every(c => testCondition(state, b.controllerId, c, context, b.subjectId));
    }))];
    if (origin.kind === "FIGHT") return origin.result.winnerId ? effectiveTriggeredAbilities(state, origin.result.winnerId, context).filter(b => b.kind === "WHEN_FIGHT_WON" && fightWinGuardAllows(state, b.sourceId, b.subjectId, b.abilityId, context)) : []; // Batch V52: first win only.
    if (origin.kind === "DEFEAT") return [...origin.defeated.flatMap(d => effectiveTriggeredAbilities(state, d.targetId, context).filter(b => b.kind === "WHEN_DEFEATED")), ...(origin.fight?.outcomes ?? []).map(fightOutcomeBinding),
        // Batch V50: "The first time an ARASAKA Unit is defeated each turn": each field observer of either player, the defeated included.
        ...(origin.defeated.some(d => d.targetId === state.turnHistory?.firstArasakaDefeat) ? state.match.playerOrder.flatMap(p => [...state.players[p].zones.BATTLEFIELD].sort()).flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_UNIT_DEFEATED" && b.sourceId === b.subjectId)) : [])]; // Capture before movement; enqueue after.
    // Batch V17: "When this Unit uses [Blocker]" belongs to the blocking Unit only (9.11).
    if (origin.kind === "BLOCK") return effectiveTriggeredAbilities(state, origin.subjectId, context).filter(b => b.kind === "WHEN_BLOCKER_USED" && b.sourceId === b.subjectId);
    // Batch V24 (10.16.3, 11.5.1.7): "When this Unit steals a Gig" is pending once per stolen Gig, after all have moved.
    // Batch V26: "When a friendly Unit steals a d6" belongs to each friendly field source, the stealing Unit included.
    // Batch V40: "When a friendly Legend steals a Gig" also belongs to a face-up friendly Legend in the Legends area.
    if (origin.kind === "STEAL") {
        const actor = state.objects.cards[origin.subjectId]?.controllerId, unit = Boolean(actor) && effectiveCardTypes(state, origin.subjectId, context).includes("UNIT");
        const observers = actor && unit ? [...state.players[actor].zones.BATTLEFIELD, ...state.players[actor].zones.LEGENDS].flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_FRIENDLY_UNIT_STEALS_GIG" && b.sourceId === b.subjectId)) : [];
        const guard = (b: TriggerBinding) => cardRevision(state, b.sourceId, context)!.mechanics.abilities.find(a => a.id === b.abilityId)!.guard;
        // Batch V67: the stealer's Gear "the first time this Unit steals 1 or more Gigs each turn": once, on its first stolen Gig.
        const first = [...origin.gigInstanceIds].sort()[0], firstSteal = isFirstHostSteal(state, origin.subjectId, origin.gigInstanceIds);
        return [...origin.gigInstanceIds].sort().flatMap(gigInstanceId => [
            ...effectiveTriggeredAbilities(state, origin.subjectId, context).filter(b => b.kind === "WHEN_GIG_STOLEN" && (b.sourceId === b.subjectId
                || gigInstanceId === first && firstSteal && cardRevision(state, b.sourceId, context)!.mechanics.abilities.find(a => a.id === b.abilityId)!.guard === "FIRST_HOST_STEAL_PER_TURN")),
            ...observers.filter(b => guard(b) === "STOLEN_GIG_IS_D6" && state.objects.gigs[gigInstanceId]?.dieType === "D6" || guard(b) === "STEALER_IS_LEGEND" && stealerIsLegend(state, origin.subjectId, context)
                // Batch V49: a friendly field Unit observing the turn's first below-power steal by another friendly Unit.
                || guard(b) === "FIRST_OTHER_FRIENDLY_STEAL_BELOW_POWER_PER_TURN" && state.objects.cards[b.sourceId].zone.zone === "BATTLEFIELD" && belowPowerStealFires(state, b.sourceId, origin.subjectId, gigInstanceId)
                // Batch V63: "steals 1 or more Gigs" is one occurrence per steal, bound to its first stolen Gig.
                || guard(b) === "FRIENDLY_CORPO_OR_GANGER_UNIT_STEALS" && gigInstanceId === [...origin.gigInstanceIds].sort()[0] && stealerIsCorpoOrGangerUnit(state, origin.subjectId, context))
        ].map(b => ({ ...b, gigInstanceId })));
    }
    const own = effectiveTriggeredAbilities(state, origin.subjectId, context).filter(b => {
        if (b.kind !== (origin.kind === "PLAY" ? "WHEN_PLAYED" : "WHEN_ATTACKING")) return false;
        // Losing His Way FAQ0c5b038a: becoming face-up after declaration does not create a trigger.
        const a = cardRevision(state, b.sourceId, context)!.mechanics.abilities.find(a => a.id === b.abilityId)!;
        return !a.conditions.some(c => c.kind === "ALL_FRIENDLY_LEGENDS_FACE_UP" && !testCondition(state, b.controllerId, c, context, b.subjectId));
    });
    if (origin.kind === "ATTACK") {
        if (!isFirstArasakaAttack(state, origin.subjectId, context)) return own;
        const actor = state.objects.cards[origin.subjectId].controllerId;
        return [...own, ...state.players[actor].zones.LEGENDS.flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_UNIT_ATTACKS" && b.controllerId === actor))];
    }
    const played = state.objects.cards[origin.subjectId], revision = cardRevision(state, origin.subjectId, context)!;
    if (!effectiveCardTypes(state, played.id, context).some(t => t === "UNIT" || t === "GEAR") || !revision.colors.includes("BLUE") || state.turnHistory?.blueUnitOrGearPlays[played.controllerId] !== 1) return own;
    return [...own, ...state.players[played.controllerId].zones.LEGENDS.flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_CARD_PLAYED"))];
}
/** Batch V40: a stealing Legend is a printed Legend on the field (a Go Solo Legend), never a Legend-area card. */
/** Batch V63: the stealing card is a CORPO or GANGER Unit (a field Legend counts as a Unit there). */
export function stealerIsCorpoOrGangerUnit(state: GameState, subjectId: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[subjectId], r = cardRevision(state, subjectId, context);
    return Boolean(c && c.zone.zone === "BATTLEFIELD" && effectiveCardTypes(state, subjectId, context).includes("UNIT") && r && (r.tags.includes("Corpo") || r.tags.includes("Ganger")));
}
export function stealerIsLegend(state: GameState, subjectId: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[subjectId];
    return Boolean(c && c.zone.zone === "BATTLEFIELD" && cardRevision(state, subjectId, context)?.type === "LEGEND");
}
export function triggerId(state: GameState, binding: TriggerBinding, ordinal: number) {
    if (binding.delayedId) return binding.delayedId;
    return hashCanonical({ protocol: "reviewed-trigger@1", turn: state.timing.turn, ordinal, sourceId: binding.sourceId, subjectId: binding.subjectId, source: binding.source, abilityId: binding.abilityId, kind: binding.kind, controllerSeat: state.players[binding.controllerId].seat, ...(binding.gigInstanceId ? { gigInstanceId: binding.gigInstanceId } : {}) });
}
export function pendingTrigger(state: GameState, binding: TriggerBinding, ordinal: number, sequence: number, context: EngineContext, primitiveIndex: 0 | 1 = 0): PendingEffect {
    const a = context.content.cards.find(c => c.id === binding.source.cardId && c.revision === binding.source.revision)!.mechanics.abilities.find(a => a.id === binding.abilityId)!;
    const registered = a.effects[1];
    // Batch V46: a fired next-fight-outcome binding resolves the registered effect, never the registration itself.
    const effect = binding.kind === "DELAYED_FIGHT_OUTCOME" && a.effects[0]?.kind === "REGISTER_NEXT_FIGHT_OUTCOME" ? a.effects[0].effect : binding.delayedId && registered?.kind === "REGISTER_END_TURN_EFFECT" ? registered.effect : a.effects[primitiveIndex];
    const { sourceId, controllerId, ...trigger } = binding;
    return { id: triggerId(state, binding, ordinal), sourceId, controllerId, causedBySequence: sequence, effect, ...(primitiveIndex === 1 ? { primitiveIndex } : {}), trigger: { ...trigger, ordinal, turn: state.timing.turn } };
}
export function nextTriggerGroup(state: GameState) {
    const pending = state.resolution.pending;
    const actor = pending.some(e => e.controllerId === state.timing.activePlayer) ? state.timing.activePlayer : state.match.playerOrder.find(id => pending.some(e => e.controllerId === id));
    return pending.filter(e => e.controllerId === actor).sort((a, b) => a.sourceId! < b.sourceId! ? -1 : a.sourceId! > b.sourceId! ? 1 : a.id < b.id ? -1 : 1);
}
/** 6.7: a swap needs a rolled friendly Gig and a rolled rival Gig, both in Gig areas. */
export function swapSidesAvailable(state: GameState, controllerId: PlayerId) {
    const gigs = Object.values(state.objects.gigs).filter(g => g.location.zone === "GIGS" && g.roll.kind === "ROLLED");
    return gigs.some(g => g.controllerId === controllerId) && gigs.some(g => g.controllerId !== controllerId);
}
export function triggerGigTargets(state: GameState, context?: EngineContext) {
    const current = state.resolution.current!, chosen = state.resolution.triggerContinuation?.targetGigId;
    // Batch V47: an effect steal offers the rival Gigs its subject may steal.
    if (current.effect.kind === "STEAL_GIG") return context ? effectStealTargets(state, context) : [];
    // Batch V27: "increase it" offers only the rolled Gig the steal trigger names, while it is in a Gig area.
    if (current.effect.kind === "ADJUST_GIG_UP_TO" && current.effect.target.kind === "STOLEN_GIG") {
        const g = current.trigger?.gigInstanceId ? state.objects.gigs[current.trigger.gigInstanceId] : undefined;
        return g && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" ? [g.id] : [];
    }
    // Batch V23: a swap chooses the friendly Gig first, then the rival Gig.
    const side = current.effect.kind === "SWAP_GIGS" ? (chosen ? "RIVAL" : "FRIENDLY") : current.effect.kind === "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN" ? "FRIENDLY" : "ANY";
    return Object.values(state.objects.gigs).filter(g => g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && (side === "ANY" || (g.controllerId === current.controllerId) === (side === "FRIENDLY"))).map(g => g.id).sort();
}
/** Batch V13: public Units in the controller's own trash, other than the trigger subject ("another Unit"). */
export function trashUnitTargets(state: GameState, current: PendingEffect, context: EngineContext): CardInstanceId[] {
    const actor = current.controllerId, subjectId = current.trigger?.subjectId;
    return state.players[actor].zones.TRASH.filter(id => id !== subjectId && state.objects.cards[id]?.ownerId === actor && state.objects.cards[id].face === "UP" && cardRevision(state, id, context)?.type === "UNIT").sort();
}
/** The affected player chooses their own discard (Batch V17: "a Rival discards 1"). */
export function discardingPlayer(state: GameState, current: PendingEffect) {
    return current.effect.kind === "DISCARD_CARDS" && current.effect.player === "RIVAL" || current.effect.kind === "STOLEN_GIG_PARITY_DRAW_OR_RIVAL_DISCARD" ? state.match.playerOrder.find(id => id !== current.controllerId)! : current.controllerId;
}
/** Batch V40: the parity of the Gig a steal trigger names, at its current value; an unrolled Gig has no parity. */
export function stolenGigParity(state: GameState, current: PendingEffect): "EVEN" | "ODD" | null {
    const roll = current.trigger?.gigInstanceId ? state.objects.gigs[current.trigger.gigInstanceId]?.roll : undefined;
    return roll?.kind !== "ROLLED" ? null : roll.currentValue % 2 === 0 ? "EVEN" : "ODD";
}
export function triggerChoice(state: GameState, context: EngineContext): PendingChoice {
    const c = state.resolution.triggerContinuation!, current = state.resolution.current;
    let actorId = current?.controllerId ?? nextTriggerGroup(state)[0].controllerId;
    let kind: PendingChoice["kind"], options: PendingChoice["options"];
    if (c.phase === "SELECT") { const group = nextTriggerGroup(state); actorId = group[0].controllerId; kind = "ORDER"; options = group.map(e => ({ kind: "EFFECT", effectId: e.id })); }
    else if (c.phase === "READY") { kind = "READY_EDDIE"; options = readyableEddieSlots(state, actorId).filter(slot => !c.selectedEddieSlots?.includes(slot)).map(slot => ({ kind: "EDDIE_SLOT", slot })); }
    // Batch V32: a Program discard offers only own-hand Programs, and declining only before the first discard.
    else if (c.phase === "DISCARD" && current?.effect.kind === "DISCARD_PROGRAMS_THEN_BOTTOM_DECK") { kind = "DISCARD"; options = [...(c.discardedPrograms ? [] : [{ kind: "MODE" as const, mode: "DONE" as const }]), ...handPrograms(state, actorId, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]; }
    else if (c.phase === "DISCARD") { if (current) actorId = discardingPlayer(state, current); kind = "DISCARD"; options = getDiscardableCards(state, actorId).map(cardInstanceId => ({ kind: "CARD", cardInstanceId })); }
    else if (c.phase === "OPTIONAL") { kind = "OPTIONAL"; options = [{ kind: "CONFIRM", confirmed: true }, { kind: "CONFIRM", confirmed: false }]; }
    // Batch V42: the card type to name.
    else if (c.phase === "TARGET" && current?.effect.kind === "CHOOSE_TYPE_REVEAL_TOP_ADD_AND_READY_EDDIE") { kind = "MODE"; options = REVEAL_TYPES.map(mode => ({ kind: "MODE", mode })); }
    else if (c.phase === "TARGET") {
        kind = "TARGET";
        options = current?.effect.kind === "SEARCH_GEAR" || current?.effect.kind === "SEARCH_COST_MATCHING_GIGS"
            ? [{ kind: "MODE", mode: "DONE" }, ...searchTargets(state, context).filter(id => !state.resolution.searchContinuation?.selected.includes(id)).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]
            : current?.effect.kind === "FORCE_RIVAL_UNIT_ATTACK"
            ? mustAttackTargets(state, actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "TRASH_THEN_RETURN_PROGRAM"
            ? trashedProgramTargets(state, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "GRANT_KEYWORD_UNTIL_END_OF_TURN"
            ? keywordGrantTargets(state, current, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "SPEND_UNIT" || current?.effect.kind === "PREVENT_UNIT_READY" || current?.effect.kind === "SPEND_UNITS_PER_VALUE_PAIR"
            ? listSpendUnitTargets(state, actorId, current.effect.target, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "DISCARD_PROGRAMS_THEN_BOTTOM_DECK"
            ? programBottomDeckTargets(state, current, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "READY_LEGENDS_UP_TO"
            ? [{ kind: "MODE", mode: "DONE" }, ...taggedLegendReadyTargets(state, actorId, current.effect.tag, context).filter(id => !c.readiedLegends?.includes(id)).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]
            : current?.effect.kind === "READY_UNITS_UP_TO"
            ? [{ kind: "MODE", mode: "DONE" }, ...friendlyUnitReadyTargets(state, actorId, context).filter(id => !c.readiedUnits?.includes(id)).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]
            : current?.effect.kind === "READY_UNIT"
            ? (current.effect.target.kind === "ANOTHER_FRIENDLY_UNIT" ? stolenGigReadyTargets(state, current, context) : readyLegendTargets(state, actorId, context)).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "PLAY_GEAR_FREE" // Batch V68: the Gear, then its host.
            ? (c.selectedGearId ? freeGearHosts(state, c.selectedGearId, context) : freeGearTargets(state, context)).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))
            : current?.effect.kind === "PLAY_UNIT_FREE"
            ? [...(current.effect.optional ? [{ kind: "CONFIRM" as const, confirmed: false }] : []), ...freePlayTargets(state, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]
            : current?.effect.kind === "RETURN_TRASH_UNIT_TO_HAND"
            ? trashUnitTargets(state, current, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
            : current?.effect.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND"
            ? privateLookTargets(state, actorId, context).map(slot => ({ kind: "LEGEND_SLOT", slot }))
            : current?.effect.kind === "POWER_UNTIL_END_OF_TURN" && current.effect.target.kind === "FRIENDLY_UNIT"
                ? friendlyPowerTargets(state, actorId, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId }))
                : triggerGigTargets(state, context).map(gigInstanceId => ({ kind: "GIG", gigInstanceId }));
    }
    else {
        kind = "AMOUNT"; const g = state.objects.gigs[c.targetGigId!], value = g.roll.kind === "ROLLED" ? g.roll.currentValue : 0;
        options = current?.effect.kind === "ADJUST_GIG_UP_TO"
            ? gigAdjustmentOptions(g, current.effect)
            : Array.from({ length: Math.min(2, value - 1) + 1 }, (_, amount) => ({ kind: "AMOUNT", amount }));
    }
    return { id: hashCanonical({ protocol: "trigger-choice@1", turn: state.timing.turn, ordinal: c.ordinal, resolved: c.resolvedIds, current: current?.id ?? null, phase: c.phase, ...(c.selectedEddieSlots ? { selectedEddieSlots: c.selectedEddieSlots } : {}), ...(c.readiedLegends ? { readiedLegends: c.readiedLegends } : {}), ...(c.readiedUnits ? { readiedUnits: c.readiedUnits } : {}), ...(c.spendsRemaining ? { spendsRemaining: c.spendsRemaining } : {}), ...(c.discardedCardId ? { discardedCardId: c.discardedCardId } : {}), ...(c.discardedPrograms ? { discardedPrograms: c.discardedPrograms } : {}), ...(current?.primitiveIndex === 1 ? { primitiveIndex: 1 } : {}), target: c.targetGigId ?? null }), actorId, kind, options, min: 1, max: 1, ordered: false, continuationId: "reviewed-trigger@1" };
}
