import { isLegendCallPower, playPowerTargets } from "./legend-spend";
import { validateGearPower } from "./gear-legend";
import { validateProgramPlayPower } from "./braindance-legend";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { supportsAttackConditionPowerCard } from "./attack-condition-power-support";
import { isPlayedInBatch } from "./effect-play";
import { triggerId } from "./trigger-queries";
import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes, effectivePower } from "./characteristics";
import { reactEnabled, supportsReactPlay } from "./react-support";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { supportsFieldLegend } from "./field-legend-support";
import { powerTargets } from "./react-queries";
import { friendlyPowerTargets } from "./friendly-play-power-queries";
import { supportsFriendlyPlayPowerUnit, validateFriendlyPlayPowerMetadata } from "./friendly-play-power-support";
import { supportsGigParityUnit } from "./gig-parity-support";
import { supportsLegendReveal } from "./legend-reveal-support";
import { supportsModalProgram } from "./modal-program-support";
import { supportsQuickActivationCard } from "./quick-activation-support";
import { activationEffectId } from "./play-state";
import { validateBlockerBonus } from "./blocker-grant";
import { validateUnitGrantPower } from "./ready-attack-grant";
function removedFieldLegend(state: GameState, id: CardInstanceId, context: EngineContext) {
    const target = state.objects.cards[id];
    return target?.face === "UP" && target.zone.zone === "REMOVED" && supportsFieldLegend(cardRevision(state, id, context), context).ok;
}

export function compareTemporaryPower(a: TemporaryPowerModifier, b: TemporaryPowerModifier) {
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
    const occurrence = (x: TemporaryPowerModifier) => "origin" in x ? x.origin.effectId : "";
    // Batch V49: repeated activations share an effect id and differ by their activation sequence.
    const sequence = (x: TemporaryPowerModifier) => "scaled" in x && (x.scaled === "SOURCE_POWER" || x.scaled === "BLOCKER_GRANT_BONUS" || x.scaled === "PER_EQUIPPED_GEAR") ? x.origin.sequence : -1; // Batch V74: so does the Blocker grant's +1.
    // Batch V54: one "all rival Units" effect makes one modifier per target.
    return occurrence(a) < occurrence(b) ? -1 : occurrence(a) > occurrence(b) ? 1 : sequence(a) !== sequence(b) ? sequence(a) - sequence(b) : a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0;
}
export function applyTemporaryPower(m: TurnMutation, targetId: CardInstanceId, forced = false) {
    const current = m.state.resolution.current;
    if (current?.effect.kind !== "POWER_UNTIL_END_OF_TURN" || !current.sourceId) return failure("INVALID_POWER_TARGET", "Current power effect source required");
    const base = { kind: "POWER" as const, sourceId: current.sourceId, targetId, expires: { kind: "END_OF_TURN" as const, turn: m.state.timing.turn } };
    let modifier: TemporaryPowerModifier;
    if (isLegendCallPower(m.state, m.context)) {
        // Batch V60: a Called Legend's chosen "-2 to a rival Unit" or "+2 to a friendly Unit" mode.
        const amount = current.effect.amount;
        if (amount !== -2 && amount !== 2 || current.effect.target.kind !== (amount === 2 ? "FRIENDLY_UNIT" : "RIVAL_UNIT") || !playPowerTargets(m.state, current.controllerId, m.context).includes(targetId))
            return failure("INVALID_POWER_TARGET", "Choose a currently eligible Unit for the Called Legend's mode");
        modifier = { ...base, amount, scaled: "LEGEND_CALL", origin: { effectId: current.id } };
    } else if (current.effect.target.kind === "SOURCE_SUBJECT") {
        const t = current.trigger, c = m.state.resolution.triggerContinuation, subject = m.state.objects.cards[targetId];
        if (current.effect.amount !== 5 || !t || t.kind !== "WHEN_ATTACKING" || t.subjectId !== targetId || current.sourceId !== targetId || !c || c.origin.kind !== "ATTACK" || c.origin.subjectId !== targetId || !subject || subject.face !== "UP" || subject.zone.zone !== "BATTLEFIELD" || !supportsAttackConditionPowerCard(cardRevision(m.state, targetId, m.context), m.context).ok) return failure("INVALID_POWER_SOURCE", "Reviewed self ATTACK source, subject and occurrence required");
        modifier = { ...base, amount: 5, origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    } else if (current.effect.target.kind === "FRIENDLY_UNIT") {
        const t = current.trigger, c = m.state.resolution.triggerContinuation;
        const source = m.state.objects.cards[current.sourceId], revision = cardRevision(m.state, current.sourceId, m.context);
        const binding = c?.bindings.find(b => b.sourceId === current.sourceId && b.abilityId === t?.abilityId && b.kind === "WHEN_PLAYED");
        if (current.effect.amount !== 2 || !t || !c || !source || !revision || !binding
            || !supportsFriendlyPlayPowerUnit(revision, m.context).ok || current.primitiveIndex !== undefined
            || !isPlayedInBatch(c, source.id)
            || t.kind !== "WHEN_PLAYED" || t.subjectId !== source.id || binding.subjectId !== source.id
            || t.turn !== m.state.timing.turn || t.ordinal !== c.ordinal
            || current.controllerId !== source.controllerId || binding.controllerId !== current.controllerId
            || source.face !== "UP" || source.zone.zone !== "BATTLEFIELD"
            || current.id !== triggerId(m.state, binding, c.ordinal) || c.resolvedIds.includes(current.id)
            || canonicalSerialize(current.effect) !== canonicalSerialize(revision.mechanics.abilities[0].effects[0]))
            return failure("INVALID_POWER_SOURCE", "Friendly+2 requires its reviewed current PLAY source and unresolved occurrence");
        if (!friendlyPowerTargets(m.state, current.controllerId, m.context).includes(targetId))
            return failure("INVALID_POWER_TARGET", "Choose a currently eligible friendly field Unit");
        modifier = { ...base, amount: 2, origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    } else if (current.effect.scale === "SOURCE_POWER") {
        // Batch V49: the source's power as the activation resolves; a source with no positive power makes no modifier.
        const c = m.state.resolution.playContinuation, source = m.state.objects.cards[current.sourceId];
        if (c?.kind !== "ACTIVATE" || c.sourceId !== current.sourceId || !source || source.face !== "UP" || source.zone.zone !== "BATTLEFIELD" || !supportsQuickActivationCard(cardRevision(m.state, current.sourceId, m.context), m.context).ok
            || !powerTargets(m.state, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a currently eligible rival Unit for the reviewed activation");
        const power = effectivePower(m.state, current.sourceId, m.context) ?? 0;
        m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
        if (power <= 0) return success(null);
        modifier = { ...base, amount: -power, scaled: "SOURCE_POWER", origin: { effectId: current.id, sequence: current.causedBySequence } };
    } else if (current.effect.amount === -5 && current.effect.target.kind === "ALL_RIVAL_UNITS") {
        // Batch V54: Towerfall's "-5 power this turn" to every rival Unit, applied while it resolves.
        const c = m.state.resolution.playContinuation;
        if (!c || c.sourceId !== current.sourceId || m.state.objects.cards[current.sourceId]?.zone.zone !== "RESOLVING_PROGRAM" || !supportsModalProgram(cardRevision(m.state, current.sourceId, m.context), m.context).ok
            || !powerTargets(m.state, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Each current rival Unit for the reviewed resolving Program");
        modifier = { ...base, amount: -5, scaled: "ALL_RIVAL_UNITS", origin: { effectId: current.id } };
    } else if (current.effect.amount === -5) {
        // Batch V44: the modal Program's "-5 power this turn", applied while it resolves.
        const c = m.state.resolution.playContinuation;
        if (!c || c.sourceId !== current.sourceId || m.state.objects.cards[current.sourceId]?.zone.zone !== "RESOLVING_PROGRAM" || !supportsModalProgram(cardRevision(m.state, current.sourceId, m.context), m.context).ok
            || !powerTargets(m.state, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a currently eligible rival Unit for the reviewed resolving Program");
        modifier = { ...base, amount: -5, origin: { effectId: current.id } };
    } else {
        if (current.effect.amount !== -1 || !powerTargets(m.state, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a currently eligible rival Unit");
        modifier = { ...base, amount: -1 };
    }
    if (m.state.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    if (modifier.amount === 2 || "scaled" in modifier && modifier.scaled === "LEGEND_CALL") m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    (m.state.temporaryModifiers ??= []).push(modifier);
    m.state.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
export function expireTemporaryPower(m: TurnMutation) {
    const modifiers = m.state.temporaryModifiers;
    if (!modifiers) return;
    for (const modifier of modifiers) m.emit({ kind: "POWER_MODIFIER_EXPIRED", sourceId: modifier.sourceId, targetId: modifier.targetId, reason: "TURN_END", ...("origin" in modifier ? { effectId: modifier.origin.effectId } : {}) });
    delete m.state.temporaryModifiers;
}
/** 5.3.2.2: duration tracks the physical card until hidden entry, independent of combat. */
export function expirePowerOnHiddenEntry(m: TurnMutation, targetId: CardInstanceId) {
    if (!combatResolutionEnabled(m.context) || !m.state.temporaryModifiers) return;
    for (const x of m.state.temporaryModifiers.filter(x => x.targetId === targetId))
        m.emit({ kind: "POWER_MODIFIER_EXPIRED", sourceId: x.sourceId, targetId, reason: "HIDDEN_AREA", ...("origin" in x ? { effectId: x.origin.effectId } : {}) });
    m.state.temporaryModifiers = m.state.temporaryModifiers.filter(x => x.targetId !== targetId);
    if (!m.state.temporaryModifiers.length) delete m.state.temporaryModifiers;
}
export function validateTemporaryPower(state: GameState, context: EngineContext) {
    const metadata = validateFriendlyPlayPowerMetadata(state, context);
    if (!metadata.ok) return metadata;
    const modifiers = state.temporaryModifiers;
    if (!modifiers) return success(null);
    if (!reactEnabled(context) || !modifiers.length || new Set(modifiers.map(x => canonicalSerialize([x.sourceId, "origin" in x ? x.origin.effectId : null, "scaled" in x && (x.scaled === "SOURCE_POWER" || x.scaled === "BLOCKER_GRANT_BONUS" || x.scaled === "PER_EQUIPPED_GEAR") ? x.origin.sequence : null, "scaled" in x && x.scaled === "ALL_RIVAL_UNITS" ? x.targetId : null]))).size !== modifiers.length || canonicalSerialize(modifiers) !== canonicalSerialize([...modifiers].sort(compareTemporaryPower))) return failure("INVALID_TEMPORARY_POWER", "Nonempty canonical reviewed modifiers with distinct source/occurrences required");
    for (const x of modifiers) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        // Batch V41: the revealed card's printed cost, on the Go Solo Legend that revealed it during a resolved current-turn ATTACK occurrence.
        if ("scaled" in x && x.scaled === "REVEALED_CARD_COST") {
            const origin = x.origin, a = r?.mechanics.abilities.find(a => a.id === origin.abilityId), continuation = state.resolution.triggerContinuation, cost = cardRevision(state, x.revealedCardId, context)?.printedCost;
            if (!source || !r || !a || a.trigger !== "WHEN_ATTACKING" || a.effects[0]?.kind !== "REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST" || x.sourceId !== x.targetId || !supportsLegendReveal(r, context).ok
                || source.face !== "UP" || !["BATTLEFIELD", "REMOVED"].includes(source.zone.zone) || x.expires.turn !== state.timing.turn
                || cost?.kind !== "EDDIES" || x.amount !== cost.amount || origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0)
                || origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_ATTACKING" }, origin.ordinal)
                || continuation?.ordinal === origin.ordinal && !continuation.resolvedIds.includes(origin.effectId))
                return failure("INVALID_TEMPORARY_POWER", "Revealed-cost power needs its reviewed public Legend, the revealed card's cost and a resolved current-turn ATTACK occurrence");
            continue;
        }
        // Batch V60: a Called Legend's chosen power mode, on a public Unit of the mode's relation, this turn.
        if ("scaled" in x && x.scaled === "LEGEND_CALL") {
            const a = r?.mechanics.abilities.find(a => a.trigger === "WHEN_CALLED" && a.choose), index = a ? a.effects.findIndex(e => e.kind === "POWER_UNTIL_END_OF_TURN") : -1, effect = a?.effects[index];
            if (!source || !target || !r || !a || !supportsLegendSpendCard(r, context).ok || effect?.kind !== "POWER_UNTIL_END_OF_TURN" || effect.amount !== x.amount || source.face !== "UP" || source.zone.zone !== "LEGENDS"
                || target.face !== "UP" || !["BATTLEFIELD", "TRASH", "REMOVED"].includes(target.zone.zone) || !(effectiveCardTypes(state, x.targetId, context).includes("UNIT") || removedFieldLegend(state, x.targetId, context))
                || (target.controllerId === source.controllerId) !== (effect.target.kind === "FRIENDLY_UNIT") || x.expires.turn !== state.timing.turn
                || x.origin.effectId !== activationEffectId(state, source.controllerId, source.id, a.id, index) || state.resolution.current?.id === x.origin.effectId)
                return failure("INVALID_TEMPORARY_POWER", "A Called Legend's power needs its reviewed face-up Legend, a public Unit of the mode's relation and its resolved current-turn mode");
            continue;
        }
        // Batch V49: "A rival Unit loses power equal to this Unit's power this turn", from the pinned Quick activation's resolved effect.
        if ("scaled" in x && x.scaled === "SOURCE_POWER") {
            const a = r?.mechanics.abilities.find(a => a.activation?.timing === "QUICK"), c = state.resolution.playContinuation;
            if (!source || !target || !r || !a || !supportsQuickActivationCard(r, context).ok || x.sourceId === x.targetId || source.face !== "UP" || !["BATTLEFIELD", "TRASH", "REMOVED"].includes(source.zone.zone)
                || target.face !== "UP" || !["BATTLEFIELD", "TRASH", "REMOVED"].includes(target.zone.zone) || !(effectiveCardTypes(state, x.targetId, context).includes("UNIT") || removedFieldLegend(state, x.targetId, context))
                || target.controllerId === source.controllerId || x.expires.turn !== state.timing.turn || x.origin.sequence >= state.match.eventSequence
                || x.origin.effectId !== activationEffectId(state, source.controllerId, source.id, a.id, 0) || c?.kind === "ACTIVATE" && c.sourceId === source.id && state.resolution.current?.id === x.origin.effectId)
                return failure("INVALID_TEMPORARY_POWER", "Source-power loss needs its reviewed public Unit, a rival public Unit target and a resolved current-turn activation");
            continue;
        }
        // Batch V74: the +1 a Legend's Blocker grant also gave, with a friendly value-pair of Gigs as it resolved.
        if ("scaled" in x && (x.scaled === "BLOCKER_GRANT_BONUS" || x.scaled === "PER_EQUIPPED_GEAR" || x.scaled === "PROGRAM_PLAY_TRIGGER" || x.scaled === "PROGRAM_UNIT_GRANT")) { // Batch V79: and a Program's Unit grant. // Batch V75: and a Legend's per-Gear power. Batch V76: and its BRAINDANCE play power.
            const valid = (x.scaled === "BLOCKER_GRANT_BONUS" ? validateBlockerBonus : x.scaled === "PER_EQUIPPED_GEAR" ? validateGearPower : x.scaled === "PROGRAM_UNIT_GRANT" ? validateUnitGrantPower : validateProgramPlayPower)(state, x as never, context, id => { const t = state.objects.cards[id]; return t?.face === "UP" && (["BATTLEFIELD", "TRASH", "REMOVED"].includes(t.zone.zone) && effectiveCardTypes(state, id, context).includes("UNIT") || removedFieldLegend(state, id, context)); });
            if (!valid.ok) return valid;
            continue;
        }
        // Batch V54: Towerfall's "-5 power this turn" to each rival Unit there as it resolved.
        if ("scaled" in x && x.scaled === "ALL_RIVAL_UNITS") {
            const effect = r?.mechanics.abilities[0]?.effects.find(e => e.kind === "POWER_UNTIL_END_OF_TURN");
            if (x.expires.turn !== state.timing.turn || !source || !target || !supportsModalProgram(r, context).ok || effect?.kind !== "POWER_UNTIL_END_OF_TURN" || effect.target.kind !== "ALL_RIVAL_UNITS" || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone)
                || target.controllerId === source.controllerId || !["BATTLEFIELD", "TRASH", "REMOVED"].includes(target.zone.zone) || target.face !== "UP" || !(effectiveCardTypes(state, x.targetId, context).includes("UNIT") || removedFieldLegend(state, x.targetId, context)))
                return failure("INVALID_TEMPORARY_POWER", "All-rival power needs its reviewed played Program, a public rival Unit target and the current turn");
            continue;
        }
        // Batch V28: the scaled self power of a resolved current-turn ATTACK occurrence; at most +2 for every Gig in the game.
        if ("scaled" in x) {
            const origin = x.origin, a = r?.mechanics.abilities.find(a => a.id === origin.abilityId), continuation = state.resolution.triggerContinuation;
            if (!source || !r || !a || a.trigger !== "WHEN_ATTACKING" || a.effects[0]?.kind !== "POWER_PER_FRIENDLY_GIG" || x.sourceId !== x.targetId || !supportsGigParityUnit(r, context).ok
                || source.face !== "UP" || !["BATTLEFIELD", "TRASH"].includes(source.zone.zone) || x.expires.turn !== state.timing.turn
                || x.amount > a.effects[0].amount * Object.keys(state.objects.gigs).length || origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0)
                || origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_ATTACKING" }, origin.ordinal)
                || continuation?.ordinal === origin.ordinal && !continuation.resolvedIds.includes(origin.effectId))
                return failure("INVALID_TEMPORARY_POWER", "Gig-parity power needs its reviewed public Unit and resolved current-turn ATTACK occurrence");
            continue;
        }
        if (x.amount === 5) {
            const origin = x.origin, a = r?.mechanics.abilities.find(a => a.id === origin.abilityId), continuation = state.resolution.triggerContinuation;
            if (!source || !target || x.sourceId !== x.targetId || !supportsAttackConditionPowerCard(r, context).ok || !a || !r || source.face !== "UP" || !["BATTLEFIELD", "TRASH"].includes(source.zone.zone) || x.expires.turn !== state.timing.turn || origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0) || origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_ATTACKING" }, origin.ordinal) || continuation?.ordinal === origin.ordinal && !continuation.resolvedIds.includes(origin.effectId)) return failure("INVALID_TEMPORARY_POWER", "Self+5 needs a reviewed public Unit and resolved current-turn ATTACK occurrence");
            continue;
        }
        // Public removal does not expire a duration (5.3.2.2). A reviewed field Legend
        // loses its effective Unit type in Removed; the existing modifier still tracks
        // that physical card until turn end. This does not make it a new Unit target.
        const removed = removedFieldLegend(state, x.targetId, context);
        if (x.amount === 2) {
            const origin = x.origin, a = r?.mechanics.abilities.find(a => a.id === origin.abilityId), continuation = state.resolution.triggerContinuation;
            if (!source || !target || !r || !a || !supportsFriendlyPlayPowerUnit(r, context).ok
                || source.face !== "UP" || !["BATTLEFIELD", "TRASH"].includes(source.zone.zone)
                || target.face !== "UP" || !["BATTLEFIELD", "TRASH", "REMOVED"].includes(target.zone.zone)
                || !(effectiveCardTypes(state, target.id, context).includes("UNIT") || removed)
                || target.controllerId !== source.controllerId || x.expires.turn !== state.timing.turn
                || origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0)
                || origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_PLAYED" }, origin.ordinal)
                || continuation?.ordinal === origin.ordinal && !continuation.resolvedIds.includes(origin.effectId))
                return failure("INVALID_TEMPORARY_POWER", "Friendly+2 requires a resolved current-turn PLAY occurrence and a public friendly target");
            continue;
        }
        if (x.expires.turn !== state.timing.turn || !source || !(x.amount === -5 ? supportsModalProgram(r, context) : supportsReactPlay(r, context)).ok || r?.type !== "PROGRAM" || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone) || !target || !(combatResolutionEnabled(context) ? ["BATTLEFIELD", "TRASH", "REMOVED"] : ["BATTLEFIELD"]).includes(target.zone.zone) || !(effectiveCardTypes(state, x.targetId, context).includes("UNIT") || removed)) return failure("INVALID_TEMPORARY_POWER", "Modifier must reference a played reviewed Program, current public Unit under the reviewed zone lifecycle and current turn");
    }
    return success(null);
}
