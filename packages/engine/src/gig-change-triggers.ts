import { PendingEffectSchema, TriggerBindingSchema, type CardInstanceId, type GameState, type PlayerId, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { effectiveTriggeredAbilities, pendingTrigger } from "./trigger-queries";

/** Batch V88 (6.4, 6.7): "When a Rival adjusts or swaps 1 or more friendly Gigs". Call right after an effect adjusted a Gig (a real
 * change, never a decline or a set, 6.5) or swapped two, naming the players whose Gigs changed. Each face-up field observer of such a
 * player other than the effect's controller binds once per effect. Inside a trigger batch the bindings join it at once; otherwise
 * they wait for the action's next batch, or for its end (a GIG_CHANGE batch). */
export function noteRivalGigChange(m: TurnMutation, owners: readonly PlayerId[]) {
    const current = m.state.resolution.current, h = m.state.turnHistory;
    if (!current || !h) return;
    for (const owner of [...new Set(owners)].sort().filter(p => p !== current.controllerId && m.state.players[p])) {
        const c = m.state.resolution.triggerContinuation, seen = [...(c?.bindings ?? []), ...(h.gigChangeTriggers ?? [])];
        const bindings = [...m.state.players[owner].zones.BATTLEFIELD].sort().flatMap(id => effectiveTriggeredAbilities(m.state, id, m.context))
            .filter(b => b.kind === "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS" && b.sourceId === b.subjectId && b.controllerId === owner
                && !seen.some(x => x.kind === b.kind && x.subjectId === b.subjectId && x.abilityId === b.abilityId && x.changeEffectId === current.id))
            .map(b => TriggerBindingSchema.parse({ ...b, changeEffectId: current.id }));
        if (!bindings.length) continue;
        if (!c) { h.gigChangeTriggers = [...(h.gigChangeTriggers ?? []), ...bindings]; continue; }
        c.effectGigChanges = [...new Set([...(c.effectGigChanges ?? []), ...bindings.map(b => b.subjectId)])];
        const sequence = m.state.match.eventSequence;
        for (const b of bindings) {
            c.bindings.push(b);
            const e = PendingEffectSchema.parse(pendingTrigger(m.state, b, c.ordinal, sequence, m.context));
            m.state.resolution.pending.push(e); m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
        }
    }
}
/** Removes the queued bindings, for the batch that takes them. */
export function takeQueuedGigChanges(m: TurnMutation): TriggerBinding[] {
    const h = m.state.turnHistory, queued = h?.gigChangeTriggers ?? [];
    if (h) delete h.gigChangeTriggers;
    return queued;
}
/** The distinct observers a list of bindings names, in first-binding order. */
export function gigChangeSubjects(bindings: readonly TriggerBinding[]): CardInstanceId[] {
    return [...new Set(bindings.map(b => b.subjectId))];
}
/** A captured Rival-change binding of a pinned card: its own ability, naming the effect that changed the Gig. */
export function validGigChangeBinding(state: GameState, b: TriggerBinding, supported: boolean, context: EngineContext) {
    const source = state.objects.cards[b.sourceId], a = cardRevision(state, b.sourceId, context)?.mechanics.abilities.find(a => a.id === b.abilityId);
    return Boolean(supported && source && b.sourceId === b.subjectId && source.cardId === b.source.cardId && source.revision === b.source.revision && a?.trigger === "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS"
        && b.changeEffectId && b.gigInstanceId === undefined && b.delayedId === undefined && b.opposingId === undefined);
}
/** The non-active player chooses for their own Rival-change triggers in a batch outside combat (ordering them, or the trash return). */
export function rivalChangeTriggerActs(state: GameState) {
    const r = state.resolution, actor = state.timing.actingPlayer;
    return Boolean(r.triggerContinuation && [...r.pending, ...(r.current ? [r.current] : [])].some(e => e.trigger?.kind === "WHEN_RIVAL_CHANGES_FRIENDLY_GIGS" && e.controllerId === actor));
}
