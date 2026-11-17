import { canonicalSerialize, failure, success, type GameState, type DefeatInstruction, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { targetedDefeatEnabled, supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { testCondition } from "./conditions";
import { defeatBatch } from "./defeat";
import { defeatOrderChoice } from "./combat-outcome-queries";
import { allOtherDefeatTargets, listDefeatTargets, targetedDefeatChoice } from "./targeted-defeat-queries";
import { supportsTargetedGearDefeatCard } from "./targeted-gear-defeat-support";
import { reactEnabled } from "./react-support";
import { attackSourceValid, listAttackTargets } from "./combat-queries";

type CurrentEffect = NonNullable<GameState["resolution"]["current"]>;
/** Only the reviewed Gear capability may use the defender-React origin. */
function gearCapability(effect: CurrentEffect, revision: ReturnType<typeof cardRevision> | null, context: EngineContext) {
    return effect.effect.kind === "DEFEAT_UNIT" && effect.effect.target.kind === "GEAR" && supportsTargetedGearDefeatCard(revision ?? undefined, context).ok;
}
/** Combat validation delegates targeted-defeat pauses here. Recheck the committed attack
 * for both target selection and Gear aftermath instead of trusting the React stage alone. */
function validGearReactOrigin(state: GameState, controllerId: PlayerId, context: EngineContext) {
    const c = state.timing.combat;
    return reactEnabled(context) && !state.setup && !state.match.outcome && c.stage === "RIVAL_REACT"
        && c.attackingPlayerId === state.timing.activePlayer
        && controllerId === state.match.playerOrder.find(id => id !== c.attackingPlayerId)
        && controllerId === state.timing.actingPlayer
        && attackSourceValid(state, c.attackingPlayerId, c.attackerId, context)
        && state.objects.cards[c.attackerId].readiness === "SPENT"
        && listAttackTargets(state, c.attackerId, c.attackingPlayerId, context)
            .some(target => canonicalSerialize(target) === canonicalSerialize(c.target));
}
/** Main keeps the historical active-player noncombat origin. The Gear capability adds exactly one
 * bounded defender-React origin: the caster is the non-active acting player, owns the paused Program
 * continuation and the saved React return, and is not the attacking player. No other non-active
 * source is admitted merely because combat is in the React stage. */
function validDefeatOrigin(state: GameState, effect: CurrentEffect, revision: ReturnType<typeof cardRevision> | null, context: EngineContext) {
    const r = state.resolution, c = state.timing.combat;
    if (effect.controllerId === state.timing.activePlayer && c.stage === "NONE") return true;
    return gearCapability(effect, revision, context) && validGearReactOrigin(state, effect.controllerId, context)
        && r.returnTo?.kind === "RIVAL_REACT" && r.playContinuation?.actorId === effect.controllerId;
}
/** Post-movement aftermath keeps the same origin rule, evaluated from the effect source. */
function validAftermathOrigin(state: GameState, controllerId: PlayerId, revision: ReturnType<typeof cardRevision> | null, context: EngineContext) {
    if (supportsTargetedGearDefeatCard(revision ?? undefined, context).ok) {
        return state.timing.combat.stage === "NONE"
            ? controllerId === state.timing.activePlayer
            : validGearReactOrigin(state, controllerId, context);
    }
    // Preserve the historical Unit-defeat source rule after checking the Gear origin.
    return controllerId === state.timing.activePlayer;
}
export function validateTargetedDefeatState(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.targetedDefeatContinuation, e = r.current;
    if (!c) return e?.effect.kind === "DEFEAT_UNIT" ? failure("ORPHAN_TARGETED_DEFEAT", "Current defeat primitive needs its exact target/order continuation") : success(null);
    const source = e?.sourceId && state.objects.cards[e.sourceId], revision = source && cardRevision(state, source.id, context);
    if (!targetedDefeatEnabled(context) || !e || e.effect.kind !== "DEFEAT_UNIT" || !source || !(supportsTargetedDefeatCard(revision || undefined, context).ok || supportsTargetedGearDefeatCard(revision || undefined, context).ok) || source.controllerId !== e.controllerId || !validDefeatOrigin(state, e, revision, context) || state.setup || state.match.outcome || r.stage !== "CHOICE" || !r.choice || r.callContinuation || r.searchContinuation || r.legendEntryContinuation || r.gigStealContinuation || r.discovered.length || canonicalSerialize(e.effect) !== canonicalSerialize(revision!.mechanics.abilities[0].effects[revision!.type === "PROGRAM" ? r.playContinuation?.effectIndex ?? -1 : 0]))
        return failure("INVALID_TARGETED_DEFEAT", "Exact current reviewed source/effect and exclusive noncombat decision required");
    if (revision!.type === "PROGRAM" ? !r.playContinuation || r.playContinuation.phase !== "EFFECT" || r.triggerContinuation || e.trigger || source.zone.zone !== "RESOLVING_PROGRAM" : r.playContinuation || !r.triggerContinuation || r.triggerContinuation.origin.kind !== "PLAY" || r.triggerContinuation.origin.subjectId !== source.id || r.triggerContinuation.phase !== "TARGET" || r.triggerContinuation.effectDefeats || e.trigger?.kind !== "WHEN_PLAYED" || source.zone.zone !== "BATTLEFIELD")
        return failure("INVALID_TARGETED_DEFEAT_SOURCE", "Program and Unit PLAY retain their own original continuations");
    if (e.effect.when && !testCondition(state, e.controllerId, e.effect.when.condition, context, e.sourceId)) return failure("INVALID_DEFEAT_CONDITION", "A false condition cannot retain a target or owner-order choice");
    if (c.phase === "TARGET") {
        const expected = targetedDefeatChoice(state, context);
        if (r.defeatContinuation || state.timing.step !== "TARGET_SELECTION" || expected.options.length < 2 || canonicalSerialize(expected) !== canonicalSerialize(r.choice)) return failure("INVALID_DEFEAT_TARGET", "Only exact current strategic targets may pause");
    } else {
        const d = r.defeatContinuation, all = allOtherDefeatTargets(state, e, context);
        // "All other Units" must hold exactly the current eligible set; a single target must remain eligible.
        if (!d || d.fightResult || d.appliedPrevention || d.appliedPreventions || (all ? !all.length || canonicalSerialize(d.defeats.map(x => x.targetId)) !== canonicalSerialize(all) : d.defeats.length !== 1 || !listDefeatTargets(state, e.controllerId, e.effect.target, context).includes(d.defeats[0].targetId)) || d.orders.length !== d.defeats.length || d.defeats.some((x, i) => x.defeatedBy !== source.id || d.orders[i].targetId !== x.targetId)) return failure("INVALID_EFFECT_DEFEAT", "Exact still-eligible selected Unit(s) and effect source required; no fight/prevention metadata");
        // Orders finish in sequence: complete orders, then the one paused order, then untouched orders.
        const current = d.orders.findIndex(o => o.cardIds.length < defeatBatch(state, o.targetId).length);
        if (current < 0 || d.orders.some((o, i) => { const batch = defeatBatch(state, o.targetId); return new Set(o.cardIds).size !== o.cardIds.length || o.cardIds.some(id => !batch.includes(id)) || (i < current ? o.cardIds.length !== batch.length : i > current ? o.cardIds.length !== 0 : batch.length - o.cardIds.length < 2); }) || state.timing.step !== "DEFEAT_ORDER_SELECTION" || canonicalSerialize(defeatOrderChoice(state)) !== canonicalSerialize(r.choice)) return failure("INVALID_DEFEAT_ORDER", "Exact owner prefix and strategic shared Trash-order choice required");
    }
    return success(null);
}
/** Additional bounded post-movement proof for effect-caused DEFEATED work; no inferred combat. */
export function validateEffectDefeatFacts(state: GameState, context: EngineContext) {
    const c = state.resolution.triggerContinuation;
    if (!c) return success(null);
    const origin = c.origin, program = origin.kind === "DEFEAT" ? origin.effectSource : undefined, defeats: readonly DefeatInstruction[] | undefined = program && origin.kind === "DEFEAT" ? origin.defeated : c.effectDefeats;
    if (!defeats) return success(null);
    const sourceId = program ?? (origin.kind === "PLAY" ? origin.subjectId : null), source = sourceId && state.objects.cards[sourceId], revision = source && cardRevision(state, source.id, context);
    if (!targetedDefeatEnabled(context) || !source || !(supportsTargetedDefeatCard(revision || undefined, context).ok || supportsTargetedGearDefeatCard(revision || undefined, context).ok) || (defeats.length !== 1 && !(revision?.type === "UNIT" && revision.mechanics.abilities[0].effects.some(e => e.kind === "DEFEAT_UNIT" && e.target.kind === "UNITS" && e.target.all === "OTHER_THAN_SOURCE"))) || !validAftermathOrigin(state, source.controllerId, revision, context) || (program ? revision!.type !== "PROGRAM" || source.zone.zone !== "TRASH" || c.effectDefeats : revision!.type !== "UNIT" || source.zone.zone !== "BATTLEFIELD") || defeats.some(d => d.defeatedBy !== source.id || !state.objects.cards[d.targetId] || !["TRASH", "REMOVED"].includes(state.objects.cards[d.targetId].zone.zone)))
        return failure("INVALID_EFFECT_DEFEAT_FACT", "Bounded source and declared post-movement target identities required");
    const expected = defeats.flatMap(d => { const r = cardRevision(state, d.targetId, context)!; return r.mechanics.abilities.filter(a => a.trigger === "WHEN_DEFEATED").map(a => ({ sourceId: d.targetId, subjectId: d.targetId, controllerId: state.objects.cards[d.targetId].controllerId, source: { cardId: r.id, revision: r.revision }, abilityId: a.id, kind: "WHEN_DEFEATED" })); });
    const actual = c.bindings.filter(b => b.kind === "WHEN_DEFEATED");
    if (canonicalSerialize(expected) !== canonicalSerialize(actual)) return failure("INVALID_EFFECT_DEFEAT_BATCH", "Every admitted DEFEATED source must be captured exactly once after movement");
    return success(null);
}
