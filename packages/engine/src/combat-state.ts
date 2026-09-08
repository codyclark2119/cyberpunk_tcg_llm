import { validateCombatOutcome } from "./combat-outcome-state";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { reactEnabled } from "./react-support";
import { canonicalSerialize, hashCanonical, failure, success, type GameState, type PendingChoice } from "@tcg/domain";
import type { EngineContext } from "./state";
import { combatEnabled } from "./attack-support";
import { gearEnabled } from "./attachments";
import { playEnabled } from "./play-support";
import { attackSourceValid, listAttackTargets } from "./combat-queries";
export function attackChoice(state: GameState, context: EngineContext): PendingChoice {
    const c = state.timing.combat;
    if (c.stage !== "ATTACK_TARGET_SELECTION") throw new Error("Expected incomplete attack declaration");
    return { id: hashCanonical({ protocol: "combat-attack@1", turn: state.timing.turn, actorSeat: state.players[c.attackingPlayerId].seat, attackerId: c.attackerId }), actorId: c.attackingPlayerId, kind: "TARGET", options: listAttackTargets(state, c.attackerId, c.attackingPlayerId, context).map(target => ({ kind: "ATTACK_TARGET", target })), min: 1, max: 1, ordered: false, continuationId: "combat-attack@1" };
}
export function validateCombatState(state: GameState, context: EngineContext) {
    const c = state.timing.combat, r = state.resolution;
    if (reactEnabled(context) && !combatEnabled(context)) return failure("UNSUPPORTED_REACT_POLICY", "React requires reviewed attack initiation");
    if (combatEnabled(context) && (!gearEnabled(context) || !playEnabled(context) || context.content.ruleset.gameplay?.turnSlice?.callEffects !== "REVIEWED_CALL_V1")) return failure("UNSUPPORTED_COMBAT_POLICY", "Reviewed attack initiation requires the reviewed play, Gear and CALL policies");
    if (combatResolutionEnabled(context) && !reactEnabled(context)) return failure("UNSUPPORTED_COMBAT_RESOLUTION_POLICY", "Combat resolution requires reviewed React");
    const outcome = validateCombatOutcome(state, context);
    if (!outcome.ok) return outcome;
    if (c.stage === "GIG_STEAL_SELECTION" || c.stage === "DEFEAT_ORDER_SELECTION") return outcome;
    const combatTiming = ["GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION", "ATTACK_TARGET_SELECTION", "ATTACK_EFFECTS", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING"].includes(state.timing.step ?? "") || ["ATTACK_TARGET_SELECTION", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING"].includes(state.timing.window);
    if (c.stage === "NONE") return combatTiming ? failure("INVALID_COMBAT_TIMING", "Combat timing requires a combat state") : success(null);
    if (!combatEnabled(context)) return failure("UNSUPPORTED_COMBAT", "Combat requires an explicit reviewed ruleset policy");
    if (c.stage !== "ATTACK_TARGET_SELECTION" && c.stage !== "RIVAL_REACT" && c.stage !== "COMBAT_RESOLUTION_PENDING") return failure("UNSUPPORTED_COMBAT_STAGE", "Only target selection, React and resolution-pending are stable combat stages");
    if (c.stage === "COMBAT_RESOLUTION_PENDING" && !reactEnabled(context)) return failure("UNSUPPORTED_COMBAT_STAGE", "Closing React requires its reviewed policy");
    if (state.setup || state.match.outcome || state.timing.activePlayer !== c.attackingPlayerId || !attackSourceValid(state, c.attackingPlayerId, c.attackerId, context)) return failure("INVALID_COMBAT_STATE", "Combat requires a valid supported attacker and active player");
    const targets = listAttackTargets(state, c.attackerId, c.attackingPlayerId, context);
    const continuing = Boolean(r.callContinuation || r.playContinuation || r.searchContinuation);
    if (continuing) {
        if (c.stage !== "RIVAL_REACT" || !reactEnabled(context) || r.returnTo?.kind !== "RIVAL_REACT" || r.stage !== "CHOICE" || !r.choice || !["PAYMENT_SELECTION", "TARGET_SELECTION"].includes(state.timing.step ?? "")) return failure("INVALID_REACT_CONTINUATION", "One defender reaction must finish before any next reaction");
    } else {
        if (r.current || r.pending.length || r.discovered.length || r.returnTo || Object.values(state.objects.cards).some(x => x.zone.zone === "RESOLVING_PROGRAM")) return failure("INVALID_COMBAT_STATE", "Stable combat has no unfinished effect work");
        if (state.timing.step !== c.stage || state.timing.window !== c.stage) return failure("INVALID_COMBAT_TIMING", "Combat stage, step and window must agree");
    }
    if (c.stage === "ATTACK_TARGET_SELECTION") {
        if (state.timing.actingPlayer !== c.attackingPlayerId || state.objects.cards[c.attackerId].readiness !== "READY" || r.stage !== "CHOICE" || targets.length < 2 || canonicalSerialize(r.choice) !== canonicalSerialize(attackChoice(state, context))) return failure("INVALID_ATTACK_CHOICE", "Unspent attacker and exact current strategic target options are required");
    } else if (state.objects.cards[c.attackerId].readiness !== "SPENT" || state.timing.actingPlayer !== state.match.playerOrder.find(id => id !== c.attackingPlayerId) || (!continuing && (r.stage !== "DECISION" || r.choice)) || !targets.some(t => canonicalSerialize(t) === canonicalSerialize(c.target))) return failure("INVALID_LOCKED_ATTACK", "Committed attacker, valid locked target and defending actor are required");
    return success(null);
}
