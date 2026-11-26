import { playedProgramFaceOk, playedProgramZone } from "./played-program";
import { canonicalSerialize, failure, hashCanonical, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type EndTurnDefeat, type GameState, type Result, type TemporaryPowerModifier, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { attachedGear } from "./attachments";
import { compareTemporaryPower } from "./temporary-power";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { endTurnEnabled } from "./end-turn-support";
import { delayedEffectsEnabled } from "./delayed-effect-support";

type GearPower = Extract<TemporaryPowerModifier, { scaled: "PROGRAM_PER_EQUIPPED_GEAR" }>;
/** Batch V90: the pinned Program's ability whose effect is the per-Gear power with its registered end-of-turn defeat, or undefined. */
function registeringAbility(r: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    return r && r.type === "PROGRAM" && supportsTargetedDefeatCard(r, context).ok ? r.mechanics.abilities.find(a => a.trigger === "WHEN_PLAYED" && a.effects[0]?.kind === "EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN") : undefined;
}
/** "An equipped Unit": any player's face-up field Unit with at least one attached Gear, in id order. */
export function equippedUnitTargets(state: GameState, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.zone.zone === "BATTLEFIELD" && c.face === "UP" && c.zone.playerId === c.controllerId && effectiveCardTypes(state, c.id, context).includes("UNIT")
        && attachedGear(state, c.id, context).length > 0).map(c => c.id).sort();
}
export function currentEquippedTargets(state: GameState, context: EngineContext) {
    return state.resolution.current?.effect.kind === "EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN" ? equippedUnitTargets(state, context) : [];
}
export function endTurnDefeatId(effectId: string) { return hashCanonical({ protocol: "end-turn-defeat@1", effectId }); }
const byId = (a: EndTurnDefeat, b: EndTurnDefeat) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/** "+3 power this turn for each of its equipped Gears", counted as it resolves; then "If that Unit steals or fights, defeat it at the
 * end of this turn" is registered on that Unit, unarmed. A lone target is taken without a choice. */
export function applyEquippedGearPower(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, source = current?.sourceId ? s.objects.cards[current.sourceId] : undefined, h = s.turnHistory;
    const ability = source && registeringAbility(cardRevision(s, source.id, m.context), m.context);
    if (current?.effect.kind !== "EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN" || !source || !ability || !h || s.resolution.playContinuation?.kind !== "PLAY" || !equippedUnitTargets(s, m.context).includes(targetId))
        return failure("INVALID_POWER_TARGET", "Choose a current equipped field Unit for the reviewed Program");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: source.id, targetId, controllerId: current.controllerId, forced });
    const modifier: GearPower = { kind: "POWER", sourceId: source.id, targetId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, amount: current.effect.amount * attachedGear(s, targetId, m.context).length, scaled: "PROGRAM_PER_EQUIPPED_GEAR", origin: { effectId: current.id } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    const record: EndTurnDefeat = { id: endTurnDefeatId(current.id), effectId: current.id, sourceId: source.id, source: { cardId: source.cardId, revision: source.revision }, abilityId: ability.id, controllerId: current.controllerId, subjectId: targetId, armed: false };
    if (h.endTurnDefeats?.some(d => d.id === record.id)) return failure("DUPLICATE_END_TURN_DEFEAT", "A resolved effect registers once");
    h.endTurnDefeats = [...(h.endTurnDefeats ?? []), record].sort(byId);
    m.emit({ kind: "END_TURN_DEFEAT_REGISTERED", record });
    return success(null);
}
/** "If that Unit steals or fights": called as each named Unit fights (both sides, as the fight starts) or steals a Gig. */
export function armEndTurnDefeats(m: TurnMutation, ids: readonly CardInstanceId[], by: "FIGHT" | "STEAL") {
    for (const d of m.state.turnHistory?.endTurnDefeats ?? []) {
        if (d.armed || !ids.includes(d.subjectId)) continue;
        d.armed = true;
        m.emit({ kind: "END_TURN_DEFEAT_ARMED", recordId: d.id, subjectId: d.subjectId, by });
    }
}
/** A Unit that leaves the field is a new object (2.4); its record does not follow it. Inside the END_TURN batch the records stay, for
 * the bindings already made from them. */
export function expireEndTurnDefeatsOnDeparture(m: TurnMutation, id: CardInstanceId) {
    const h = m.state.turnHistory;
    if (!h?.endTurnDefeats || m.state.resolution.triggerContinuation?.origin.kind === "END_TURN") return;
    h.endTurnDefeats = h.endTurnDefeats.filter(d => d.subjectId !== id);
    if (!h.endTurnDefeats.length) delete h.endTurnDefeats;
}
export function endTurnDefeatBinding(d: EndTurnDefeat): TriggerBinding {
    return { sourceId: d.sourceId, subjectId: d.subjectId, controllerId: d.controllerId, source: d.source, abilityId: d.abilityId, kind: "DELAYED_END_TURN_DEFEAT", delayedId: d.id };
}
/** 8.16.1: the armed records become pending in the END_TURN batch, whichever player controls them. */
export function armedEndTurnDefeatBindings(state: GameState) {
    return (state.turnHistory?.endTurnDefeats ?? []).filter(d => d.armed).map(endTurnDefeatBinding);
}
export function validEndTurnDefeatBinding(state: GameState, b: TriggerBinding, context: EngineContext) {
    const d = state.turnHistory?.endTurnDefeats?.find(d => d.id === b.delayedId);
    return Boolean(d?.armed && registeringAbility(cardRevision(state, d.sourceId, context), context) && canonicalSerialize(b) === canonicalSerialize(endTurnDefeatBinding(d)));
}
/** "defeat it": the bound Unit while it is still a face-up field Unit, whichever player controls it; never a choice. */
export function endTurnDefeatTargets(state: GameState, e: NonNullable<GameState["resolution"]["current"]>, eligible: (id: CardInstanceId) => boolean) {
    const id = e.trigger?.kind === "DELAYED_END_TURN_DEFEAT" ? e.trigger.subjectId : undefined, c = id ? state.objects.cards[id] : undefined;
    return id && c && c.face === "UP" && c.zone.zone === "BATTLEFIELD" && eligible(id) ? [id] : [];
}
/** Distinct current-turn records of the pinned Program, each made by its own resolved effect; outside the END_TURN batch the Unit is
 * still a face-up field Unit. */
export function validateEndTurnDefeats(state: GameState, context: EngineContext) {
    const all = state.turnHistory?.endTurnDefeats;
    if (!all) return success(null);
    const inBatch = state.resolution.triggerContinuation?.origin.kind === "END_TURN";
    if (!(endTurnEnabled(context) || delayedEffectsEnabled(context)) || new Set(all.map(d => d.id)).size !== all.length || all.some((d, i) => i > 0 && byId(all[i - 1], d) >= 0))
        return failure("INVALID_END_TURN_DEFEAT", "Distinct sorted records and reviewed end-of-turn support required");
    for (const d of all) {
        const source = state.objects.cards[d.sourceId], subject = state.objects.cards[d.subjectId], a = registeringAbility(cardRevision(state, d.sourceId, context), context);
        if (!source || !subject || !a || a.id !== d.abilityId || !state.players[d.controllerId] || source.ownerId !== d.controllerId || canonicalSerialize(d.source) !== canonicalSerialize({ cardId: source.cardId, revision: source.revision })
            || d.id !== endTurnDefeatId(d.effectId)
            || !inBatch && !(subject.face === "UP" && subject.zone.zone === "BATTLEFIELD" && effectiveCardTypes(state, d.subjectId, context).includes("UNIT")))
            return failure("INVALID_END_TURN_DEFEAT", "A record needs its reviewed played Program, its own resolved effect and a face-up field Unit");
    }
    return success(null);
}
/** The per-Gear power of the pinned Program on a public Unit, this turn; bounded by the Gear in the game. */
export function validateEquippedGearPower(state: GameState, x: GearPower, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId], a = registeringAbility(cardRevision(state, x.sourceId, context), context);
    const gear = Object.values(state.objects.cards).filter(c => cardRevision(state, c.id, context)?.type === "GEAR").length;
    if (!source || !a || !playedProgramZone(source) || !playedProgramFaceOk(source) || x.expires.turn !== state.timing.turn || !publicUnit(x.targetId) || x.amount > 3 * gear)
        return failure("INVALID_TEMPORARY_POWER", "Per-Gear power needs its reviewed played Program, a public Unit and the current turn");
    return success(null);
}
