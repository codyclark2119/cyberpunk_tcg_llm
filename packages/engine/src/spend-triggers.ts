import { PendingEffectSchema, TriggerBindingSchema, type CardInstanceId, type DeepReadonly, type GameState, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { effectiveTriggeredAbilities, pendingTrigger } from "./trigger-queries";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { attachedGear } from "./attachments";
import { supportsSpendTriggerCard } from "./spend-trigger-support";

/** Batch V69 (3.7, 10.16.1): a card "is spent" when a ready card is turned spent, for any reason (attacking, using {Blocker},
 * paying a cost or a {Spend} cost, an effect). A card that enters spent was never turned, so it never triggers. These are the
 * "when spent" bindings of a face-up card on the field or in the Legends area, its own and its Gear's. */
export function spendBindings(state: GameState, id: CardInstanceId, context: EngineContext): TriggerBinding[] {
    return [...effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_SPENT" && !isEquippedSpendObserver(state, b, context)), ...equippedSpendBindings(state, id, context)]
        .sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : a.abilityId < b.abilityId ? -1 : a.abilityId > b.abilityId ? 1 : 0);
}
const EQUIPPED_GUARD = "FRIENDLY_EQUIPPED_UNIT_OR_LEGEND_SPENT";
export function isEquippedSpendObserver(state: GameState, b: DeepReadonly<TriggerBinding>, context: EngineContext) {
    return b.kind === "WHEN_SPENT" && cardRevision(state, b.sourceId, context)?.mechanics.abilities.find(a => a.id === b.abilityId)?.guard === EQUIPPED_GUARD;
}
/** A face-up equipped Unit on the field, or a face-up equipped Legend (Legends area or field). */
export function equippedSpender(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], types = c ? effectiveCardTypes(state, id, context) : [];
    return Boolean(c && c.face === "UP" && (c.zone.zone === "BATTLEFIELD" && (types.includes("UNIT") || types.includes("LEGEND")) || c.zone.zone === "LEGENDS" && types.includes("LEGEND")) && attachedGear(state, id, context).length);
}
/** Batch V99: "When a friendly equipped Unit or Legend is spent": each face-up field observer of the spent card's controller (the card
 * itself included), once per spend; the binding's subject is the spent card. */
function equippedSpendBindings(state: GameState, id: CardInstanceId, context: EngineContext): TriggerBinding[] {
    const spent = state.objects.cards[id];
    if (!spent || !equippedSpender(state, id, context)) return [];
    return [...state.players[spent.controllerId].zones.BATTLEFIELD].sort().flatMap(sourceId => {
        const source = state.objects.cards[sourceId], r = cardRevision(state, sourceId, context);
        if (!source || !r || source.face !== "UP" || source.controllerId !== spent.controllerId || !supportsSpendTriggerCard(r, context).ok) return [];
        return r.mechanics.abilities.filter(a => a.trigger === "WHEN_SPENT" && a.guard === EQUIPPED_GUARD)
            .map(a => ({ sourceId, subjectId: id, controllerId: spent.controllerId, source: { cardId: r.id, revision: r.revision }, abilityId: a.id, kind: "WHEN_SPENT" as const }));
    });
}
/** Call right after a ready card is turned spent. Inside a trigger batch its bindings join that batch at once; otherwise they wait
 * for the action's next batch, or for its end (a SPEND batch). Bindings are captured now, so a later departure keeps them pending. */
export function noteSpent(m: TurnMutation, id: CardInstanceId) {
    let bindings = spendBindings(m.state, id, m.context);
    if (!bindings.length) return;
    // Batch V72: "The first time this Unit is spent each turn" binds only on the card's first spend this turn.
    const first = (b: TriggerBinding) => cardRevision(m.state, b.sourceId, m.context)?.mechanics.abilities.find(a => a.id === b.abilityId)?.guard === "FIRST_SPEND_PER_TURN";
    // Batch V99: the equipped spend is recorded for the observer bindings it created.
    if (bindings.some(b => isEquippedSpendObserver(m.state, b, m.context))) { const h = m.state.turnHistory!; if (!(h.equippedSpends ?? []).includes(id)) h.equippedSpends = [...(h.equippedSpends ?? []), id]; }
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
