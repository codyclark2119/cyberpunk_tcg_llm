import { failure, success, type GameState, type GigInstanceId, type Result } from "@tcg/domain";
import { belowPowerStealerPower, recordBelowPowerSteal } from "./below-power-steal";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { effectiveCardTypes, effectivePower } from "./characteristics";
import { getGigStealAllowance } from "./combat-resolution-policy";
import { stealableGigsFor } from "./combat-outcome-queries";
import { transferGigs } from "./gig-transfer";
import { endTurnEnabled } from "./end-turn-support";
import { discoverTriggers, pendingTrigger } from "./trigger-queries";
import { PendingEffectSchema, TriggerBindingSchema } from "@tcg/domain";

/** Batch V47: "it also steals a Gig." The fired effect's subject (the fight's winner) is the actor (11.5.1.1.2): while it is
 * still a face-up friendly field Unit that can steal, it steals one rival Gig its steal restrictions permit. */
export function effectStealTargets(state: GameState, context: EngineContext): GigInstanceId[] {
    const current = state.resolution.current, subjectId = current?.trigger?.kind === "DELAYED_FIGHT_OUTCOME" ? current.trigger.subjectId : undefined, subject = subjectId ? state.objects.cards[subjectId] : undefined;
    if (current?.effect.kind !== "STEAL_GIG" || !subject || subject.face !== "UP" || subject.zone.zone !== "BATTLEFIELD" || subject.controllerId !== current.controllerId || !effectiveCardTypes(state, subject.id, context).includes("UNIT")) return [];
    const power = effectivePower(state, subject.id, context), rival = state.match.playerOrder.find(p => p !== current.controllerId);
    if (power === null || !rival || getGigStealAllowance(power, context) < 1) return [];
    return stealableGigsFor(state, context, rival, subject.id).map(g => g.id).sort();
}
/** Moves the chosen Gig, records the stolen fact, and appends the steal triggers to this batch (11.5.1.7). */
export function resolveEffectSteal(m: TurnMutation, gigId: GigInstanceId): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.triggerContinuation!, subjectId = current.trigger!.subjectId;
    if (!effectStealTargets(s, m.context).includes(gigId)) return failure("INVALID_EFFECT_STEAL", "Choose a rival Gig the subject may steal");
    const from = s.objects.gigs[gigId].controllerId, power = belowPowerStealerPower(s, subjectId, m.context);
    m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: gigId });
    const moved = transferGigs(m, [gigId], current.controllerId, () => {
        const g = s.objects.gigs[gigId];
        if (g.roll.kind !== "ROLLED") throw new Error("Validated transfer must contain rolled Gigs");
        m.emit({ kind: "GIG_STOLEN", gigInstanceId: gigId, fromPlayer: from, toPlayer: current.controllerId, currentValue: g.roll.currentValue, attackerId: subjectId });
        if (endTurnEnabled(m.context)) { const steals = s.turnHistory!.gigsStolenByUnit ??= {}; steals[subjectId] = (steals[subjectId] ?? 0) + 1; }
    });
    if (!moved.ok) return moved;
    recordBelowPowerSteal(m, subjectId, [gigId], power); // Batch V49.
    if (s.match.outcome) return moved;
    const stolen = { kind: "STEAL" as const, subjectId, gigInstanceIds: [gigId] }, bindings = discoverTriggers(s, stolen, m.context);
    if (!bindings.length) return success(null);
    (c.effectSteals ??= []).push({ subjectId, gigInstanceIds: [gigId] });
    const sequence = s.match.eventSequence;
    for (const b of bindings) {
        c.bindings.push(TriggerBindingSchema.parse(b));
        const e = PendingEffectSchema.parse(pendingTrigger(s, b, c.ordinal, sequence, m.context));
        s.resolution.pending.push(e); m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
    }
    return success(null);
}
