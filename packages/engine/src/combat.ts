import { effectiveTriggeredAbilities } from "./trigger-queries";
import { beginTriggers } from "./trigger-resolution";
import { canonicalSerialize, EffectSchema, hashCanonical, failure, success, type AttackTarget, type CardInstanceId, type PlayerId, type Result } from "@tcg/domain";
import { TurnMutation } from "./turn";
import { HandlerRegistry } from "./effects";
import { cardRevision } from "./characteristics";
import { attackChoice } from "./combat-state";
import { attackSourceValid, isAttackEligible, listAttackTargets } from "./combat-queries";
/** Trusted post-effect boundary; no external malformed state is repaired. All supported pending work is complete. */
export function finishAttackEffects(m: TurnMutation): Result<null> {
    const s = m.state, c = s.timing.combat;
    if ((c.stage !== "ATTACK_EFFECTS" && c.stage !== "RIVAL_REACT") || s.resolution.returnTo || s.resolution.playContinuation || s.resolution.callContinuation || s.resolution.searchContinuation || s.resolution.current || s.resolution.pending.length || s.resolution.discovered.length || s.resolution.choice) return failure("INVALID_ATTACK_RESOLUTION", "Finish the current and pending attack effects first");
    s.resolution.stage = "STATE_BASED_CHECKS";
    const attackerValid = attackSourceValid(s, c.attackingPlayerId, c.attackerId, m.context);
    const targetValid = listAttackTargets(s, c.attackerId, c.attackingPlayerId, m.context).some(t => canonicalSerialize(t) === canonicalSerialize(c.target));
    if (!attackerValid || !targetValid) {
        m.emit({ kind: "ATTACK_ENDED", attackerId: c.attackerId, reason: !attackerValid ? "ATTACKER_INVALID" : "TARGET_INVALID" });
        s.timing.combat = { stage: "NONE" };
        s.timing.actingPlayer = s.timing.activePlayer;
        m.phase("MAIN");
        return success(null);
    }
    s.timing.combat = { ...c, stage: "RIVAL_REACT" };
    s.timing.actingPlayer = s.match.playerOrder.find(id => id !== c.attackingPlayerId)!;
    s.resolution.stage = "DECISION";
    s.timing.step = "RIVAL_REACT"; s.timing.window = "RIVAL_REACT";
    m.emit({ kind: "RIVAL_REACT_OPENED", defendingPlayerId: s.timing.actingPlayer });
    return success(null);
}
function lockAndDeclare(m: TurnMutation, actor: PlayerId, attackerId: CardInstanceId, target: AttackTarget): Result<null> {
    const s = m.state;
    if (!attackSourceValid(s, actor, attackerId, m.context) || s.objects.cards[attackerId].readiness !== "READY" || !listAttackTargets(s, attackerId, actor, m.context).some(t => canonicalSerialize(t) === canonicalSerialize(target))) return failure("INVALID_ATTACK_TARGET", "Attacker and selected target must still be legal");
    s.resolution.choice = null;
    s.timing.combat = { stage: "ATTACK_EFFECTS", attackingPlayerId: actor, attackerId, target };
    s.timing.step = "ATTACK_EFFECTS"; s.timing.window = "RESOLVING";
    m.emit({ kind: "ATTACK_TARGET_SELECTED", attackerId, target });
    s.objects.cards[attackerId].readiness = "SPENT";
    m.emit({ kind: "ATTACKER_SPENT", attackerId });
    const causedBySequence = s.match.eventSequence; // 11.21.2: spending to declare is the trigger, not Spend activation.
    m.emit({ kind: "ATTACK_DECLARED", attackerId, attackingPlayerId: actor, target });
    if (cardRevision(s, attackerId, m.context)?.execution?.scope === "COMBAT_TRIGGERS_V1" || effectiveTriggeredAbilities(s, attackerId, m.context).some(b => b.kind === "WHEN_ATTACKING" && b.sourceId !== attackerId)) return beginTriggers(m, { kind: "ATTACK", subjectId: attackerId });
    const ability = cardRevision(s, attackerId, m.context)!.mechanics.abilities.find(a => a.trigger === "WHEN_ATTACKING");
    if (ability) {
        s.resolution.stage = "DISCOVER_TRIGGERS";
        const pending = { id: hashCanonical({ protocol: "combat-attack@1", turn: s.timing.turn, attackerId, target, abilityId: ability.id }), controllerId: actor, sourceId: attackerId, effect: EffectSchema.parse(ability.effects[0]), causedBySequence };
        s.resolution.pending = [pending];
        m.emit({ kind: "EFFECT_PENDING", effectId: pending.id, sourceId: attackerId });
        s.resolution.current = s.resolution.pending.shift()!;
        s.resolution.stage = "RESOLVE_EFFECT";
        const resolved = new HandlerRegistry().resolve(m, pending.effect);
        if (!resolved.ok) return resolved;
        m.emit({ kind: "EFFECT_RESOLVED", effectId: pending.id });
        if (s.match.outcome) return success(null);
        s.resolution.current = null;
    }
    return finishAttackEffects(m);
}
export function startAttack(m: TurnMutation, actor: PlayerId, attackerId: CardInstanceId): Result<null> {
    const s = m.state;
    if (!isAttackEligible(s, actor, attackerId, m.context)) return failure("INELIGIBLE_ATTACKER", "Choose a ready, non-Lag supported friendly field Unit with a legal target");
    const targets = listAttackTargets(s, attackerId, actor, m.context);
    if (targets.length === 1) return lockAndDeclare(m, actor, attackerId, targets[0]);
    s.timing.combat = { stage: "ATTACK_TARGET_SELECTION", attackerId, attackingPlayerId: actor, target: null };
    s.resolution.stage = "CHOICE"; s.resolution.choice = attackChoice(s, m.context);
    s.timing.step = "ATTACK_TARGET_SELECTION"; s.timing.window = "ATTACK_TARGET_SELECTION";
    m.emit({ kind: "PHASE_CHANGED", step: "ATTACK_TARGET_SELECTION" });
    return success(null);
}
export function continueAttack(m: TurnMutation, index: number): Result<null> {
    const c = m.state.timing.combat, o = m.state.resolution.choice?.options[index];
    return c.stage === "ATTACK_TARGET_SELECTION" && o?.kind === "ATTACK_TARGET" ? lockAndDeclare(m, c.attackingPlayerId, c.attackerId, o.target) : failure("INVALID_ATTACK_CHOICE", "Choose a current engine-enumerated attack target");
}
