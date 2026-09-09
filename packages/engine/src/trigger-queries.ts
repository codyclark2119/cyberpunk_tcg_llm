import { getDiscardableCards } from "./discard";
import { privateLookTargets } from "./private-knowledge";
import { hashCanonical, type GameState, type CardInstanceId, type TriggerBinding, type TriggerOrigin, type PendingChoice, type PendingEffect } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { attachedGear } from "./attachments";
import { supportsEffectiveTriggerSource, triggersEnabled } from "./trigger-support";

/** Physical ability source, inherited subject and trigger-time controller are distinct identities. */
export function effectiveTriggeredAbilities(state: GameState, subjectId: CardInstanceId, context: EngineContext): TriggerBinding[] {
    const subject = state.objects.cards[subjectId];
    if (!triggersEnabled(context) || !subject || subject.face !== "UP" || !["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone)) return [];
    const sources = [subject, ...attachedGear(state, subjectId, context)];
    return sources.flatMap(source => {
        const r = cardRevision(state, source.id, context);
        if (!supportsEffectiveTriggerSource(r, context) || !r) return [];
        return r.mechanics.abilities.flatMap(a => {
            if (!a.trigger || (source.id !== subjectId) !== (a.inherited === "EQUIPPED_HOST") || !(a.trigger === "WHEN_FIGHT_WON" || a.trigger === "WHEN_DEFEATED" || a.trigger === "WHEN_PLAYED" || a.trigger === "WHEN_ATTACKING" || a.trigger === "WHEN_CARD_PLAYED")) return [];
            return [{ sourceId: source.id, subjectId, controllerId: subject.controllerId, source: { cardId: r.id, revision: r.revision }, abilityId: a.id, kind: a.trigger }];
        });
    }).sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.abilityId < b.abilityId ? -1 : a.abilityId > b.abilityId ? 1 : 0);
}
export function discoverTriggers(state: GameState, origin: TriggerOrigin, context: EngineContext): TriggerBinding[] {
    if (origin.kind === "FIGHT") return origin.result.winnerId ? effectiveTriggeredAbilities(state, origin.result.winnerId, context).filter(b => b.kind === "WHEN_FIGHT_WON") : [];
    if (origin.kind === "DEFEAT") return origin.defeated.flatMap(d => effectiveTriggeredAbilities(state, d.targetId, context).filter(b => b.kind === "WHEN_DEFEATED")); // Capture before movement; enqueue after.
    const own = effectiveTriggeredAbilities(state, origin.subjectId, context).filter(b => b.kind === (origin.kind === "PLAY" ? "WHEN_PLAYED" : "WHEN_ATTACKING"));
    if (origin.kind !== "PLAY") return own;
    const played = state.objects.cards[origin.subjectId], revision = cardRevision(state, origin.subjectId, context)!;
    if (!["UNIT", "GEAR"].includes(revision.type) || !revision.colors.includes("BLUE") || state.turnHistory?.blueUnitOrGearPlays[played.controllerId] !== 1) return own;
    return [...own, ...state.players[played.controllerId].zones.LEGENDS.flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_CARD_PLAYED"))];
}
export function triggerId(state: GameState, binding: TriggerBinding, ordinal: number) {
    return hashCanonical({ protocol: "reviewed-trigger@1", turn: state.timing.turn, ordinal, sourceId: binding.sourceId, subjectId: binding.subjectId, source: binding.source, abilityId: binding.abilityId, kind: binding.kind, controllerSeat: state.players[binding.controllerId].seat });
}
export function pendingTrigger(state: GameState, binding: TriggerBinding, ordinal: number, sequence: number, context: EngineContext, primitiveIndex: 0 | 1 = 0): PendingEffect {
    const a = context.content.cards.find(c => c.id === binding.source.cardId && c.revision === binding.source.revision)!.mechanics.abilities.find(a => a.id === binding.abilityId)!;
    const { sourceId, controllerId, ...trigger } = binding;
    return { id: triggerId(state, binding, ordinal), sourceId, controllerId, causedBySequence: sequence, effect: a.effects[primitiveIndex], ...(primitiveIndex === 1 ? { primitiveIndex } : {}), trigger: { ...trigger, ordinal, turn: state.timing.turn } };
}
export function nextTriggerGroup(state: GameState) {
    const pending = state.resolution.pending;
    const actor = pending.some(e => e.controllerId === state.timing.activePlayer) ? state.timing.activePlayer : state.match.playerOrder.find(id => pending.some(e => e.controllerId === id));
    return pending.filter(e => e.controllerId === actor).sort((a, b) => a.sourceId! < b.sourceId! ? -1 : a.sourceId! > b.sourceId! ? 1 : a.id < b.id ? -1 : 1);
}
export function triggerGigTargets(state: GameState) {
    const current = state.resolution.current!;
    return Object.values(state.objects.gigs).filter(g => g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && (current.effect.kind !== "OPTIONAL_DECREASE_FRIENDLY_GIG_THEN_DRAW_IF_MIN" || g.controllerId === current.controllerId)).map(g => g.id).sort();
}
export function triggerChoice(state: GameState, context: EngineContext): PendingChoice {
    const c = state.resolution.triggerContinuation!, current = state.resolution.current;
    let actorId = current?.controllerId ?? nextTriggerGroup(state)[0].controllerId;
    let kind: PendingChoice["kind"], options: PendingChoice["options"];
    if (c.phase === "SELECT") { const group = nextTriggerGroup(state); actorId = group[0].controllerId; kind = "ORDER"; options = group.map(e => ({ kind: "EFFECT", effectId: e.id })); }
    else if (c.phase === "DISCARD") { kind = "DISCARD"; options = getDiscardableCards(state, actorId).map(cardInstanceId => ({ kind: "CARD", cardInstanceId })); }
    else if (c.phase === "OPTIONAL") { kind = "OPTIONAL"; options = [{ kind: "CONFIRM", confirmed: true }, { kind: "CONFIRM", confirmed: false }]; }
    else if (c.phase === "TARGET") { kind = "TARGET"; options = current?.effect.kind === "LOOK_AT_FRIENDLY_FACE_DOWN_LEGEND" ? privateLookTargets(state, actorId, context).map(slot => ({ kind: "LEGEND_SLOT", slot })) : triggerGigTargets(state).map(gigInstanceId => ({ kind: "GIG", gigInstanceId })); }
    else {
        kind = "AMOUNT"; const g = state.objects.gigs[c.targetGigId!], value = g.roll.kind === "ROLLED" ? g.roll.currentValue : 0;
        options = current?.effect.kind === "ADJUST_GIG_UP_TO"
            ? [...(value > 1 ? [{ kind: "MODE" as const, mode: "DECREASE_1" }] : []), { kind: "MODE", mode: "KEEP" }, ...(value < Number(g.dieType.slice(1)) ? [{ kind: "MODE" as const, mode: "INCREASE_1" }] : [])]
            : Array.from({ length: Math.min(2, value - 1) + 1 }, (_, amount) => ({ kind: "AMOUNT", amount }));
    }
    return { id: hashCanonical({ protocol: "trigger-choice@1", turn: state.timing.turn, ordinal: c.ordinal, resolved: c.resolvedIds, current: current?.id ?? null, phase: c.phase, ...(current?.primitiveIndex === 1 ? { primitiveIndex: 1 } : {}), target: c.targetGigId ?? null }), actorId, kind, options, min: 1, max: 1, ordered: false, continuationId: "reviewed-trigger@1" };
}
