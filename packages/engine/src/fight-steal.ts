import { armEndTurnDefeats } from "./end-turn-defeat";
import { reducedAllowance } from "./steal-reduction";
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
    // Batch V67: or the stealing host of a first-steal Gear trigger.
    const current = state.resolution.current, t = current?.trigger, subjectId = t?.kind === "DELAYED_FIGHT_OUTCOME" || t?.kind === "WHEN_GIG_STOLEN" && current?.effect.kind === "STEAL_GIG" && current.effect.valueNotSharedByFriendly ? t.subjectId : undefined, subject = subjectId ? state.objects.cards[subjectId] : undefined;
    if (current?.effect.kind !== "STEAL_GIG" || !subject || subject.face !== "UP" || subject.zone.zone !== "BATTLEFIELD" || subject.controllerId !== current.controllerId || !effectiveCardTypes(state, subject.id, context).includes("UNIT")) return [];
    const power = effectivePower(state, subject.id, context), rival = state.match.playerOrder.find(p => p !== current.controllerId);
    if (power === null || !rival || reducedAllowance(state, subject.id, getGigStealAllowance(power, context)) < 1) return []; // Batch V57: less any reduction.
    const friendly = new Set(Object.values(state.objects.gigs).filter(g => g.controllerId === current.controllerId && g.location.zone === "GIGS" && g.roll.kind === "ROLLED").map(g => g.roll.kind === "ROLLED" ? g.roll.currentValue : 0));
    return stealableGigsFor(state, context, rival, subject.id).filter(g => !(current.effect.kind === "STEAL_GIG" && current.effect.valueNotSharedByFriendly) || g.roll.kind === "ROLLED" && !friendly.has(g.roll.currentValue)).map(g => g.id).sort();
}
/** Moves the chosen Gig, records the stolen fact, and appends the steal triggers to this batch (11.5.1.7). */
export function resolveEffectSteal(m: TurnMutation, gigId: GigInstanceId, selected = false): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.triggerContinuation!, subjectId = current.trigger!.subjectId;
    if (!effectStealTargets(s, m.context).includes(gigId)) return failure("INVALID_EFFECT_STEAL", "Choose a rival Gig the subject may steal");
    const from = s.objects.gigs[gigId].controllerId, power = belowPowerStealerPower(s, subjectId, m.context);
    if (!selected) m.emit({ kind: "GIG_TARGET_SELECTED", effectId: current.id, gigInstanceId: gigId }); // Batch V99: emitted before a prevention offer.
    const moved = transferGigs(m, [gigId], current.controllerId, () => {
        const g = s.objects.gigs[gigId];
        if (g.roll.kind !== "ROLLED") throw new Error("Validated transfer must contain rolled Gigs");
        m.emit({ kind: "GIG_STOLEN", gigInstanceId: gigId, fromPlayer: from, toPlayer: current.controllerId, currentValue: g.roll.currentValue, attackerId: subjectId });
        armEndTurnDefeats(m, [subjectId], "STEAL"); // Batch V90.
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
