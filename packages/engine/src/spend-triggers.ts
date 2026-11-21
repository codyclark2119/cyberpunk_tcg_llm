import { PendingEffectSchema, TriggerBindingSchema, type CardInstanceId, type GameState, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { effectiveTriggeredAbilities, pendingTrigger } from "./trigger-queries";
import { cardRevision } from "./characteristics";

/** Batch V69 (3.7, 10.16.1): a card "is spent" when a ready card is turned spent, for any reason (attacking, using {Blocker},
 * paying a cost or a {Spend} cost, an effect). A card that enters spent was never turned, so it never triggers. These are the
 * "when spent" bindings of a face-up card on the field or in the Legends area, its own and its Gear's. */
export function spendBindings(state: GameState, id: CardInstanceId, context: EngineContext): TriggerBinding[] {
    return effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_SPENT");
}
/** Call right after a ready card is turned spent. Inside a trigger batch its bindings join that batch at once; otherwise they wait
 * for the action's next batch, or for its end (a SPEND batch). Bindings are captured now, so a later departure keeps them pending. */
export function noteSpent(m: TurnMutation, id: CardInstanceId) {
    let bindings = spendBindings(m.state, id, m.context);
    if (!bindings.length) return;
    // Batch V72: "The first time this Unit is spent each turn" binds only on the card's first spend this turn.
    const first = (b: TriggerBinding) => cardRevision(m.state, b.sourceId, m.context)?.mechanics.abilities.find(a => a.id === b.abilityId)?.guard === "FIRST_SPEND_PER_TURN";
    if (bindings.some(first)) {
        const h = m.state.turnHistory!;
        if ((h.firstSpends ?? []).includes(id)) bindings = bindings.filter(b => !first(b));
        else h.firstSpends = [...(h.firstSpends ?? []), id];
        if (!bindings.length) return;
    }
    const c = m.state.resolution.triggerContinuation;
    if (c) {
        c.effectSpends = [...(c.effectSpends ?? []), id];
        const sequence = m.state.match.eventSequence;
        for (const b of bindings) {
            c.bindings.push(TriggerBindingSchema.parse(b));
            const e = PendingEffectSchema.parse(pendingTrigger(m.state, b, c.ordinal, sequence, m.context));
            m.state.resolution.pending.push(e); m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
        }
        return;
    }
    const h = m.state.turnHistory!;
    h.spendTriggers = [...(h.spendTriggers ?? []), ...bindings.map(b => TriggerBindingSchema.parse(b))];
}
export function hasQueuedSpends(state: GameState) { return Boolean(state.turnHistory?.spendTriggers?.length); }
/** Removes the queued bindings, for the batch that takes them. */
export function takeQueuedSpends(m: TurnMutation): TriggerBinding[] {
    const h = m.state.turnHistory, queued = h?.spendTriggers ?? [];
    if (h) delete h.spendTriggers;
    return queued;
}
/** The distinct spent cards a list of bindings names, in first-binding order. */
export function spentSubjects(bindings: readonly TriggerBinding[]): CardInstanceId[] {
    return [...new Set(bindings.map(b => b.subjectId))];
}
