import { validateLegendReplacement } from "./legend-defeat-replacement";
import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type DefeatInstruction, type PlayerId } from "@tcg/domain";
import { isPlayedInBatch } from "./effect-play";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { targetedDefeatEnabled, supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { testCondition } from "./conditions";
import { defeatBatch } from "./defeat";
import { defeatOrderChoice } from "./combat-outcome-queries";
import { allOtherDefeatTargets, eachDefeatChoice, eachDefeatPlayers, listDefeatTargets, ownDefeatTargets, secondDefeatChoice, secondDefeatTargets, targetedDefeatChoice, thenDefeatChoice, thenDefeatTargets } from "./targeted-defeat-queries";
import { supportsTargetedGearDefeatCard } from "./targeted-gear-defeat-support";
import { reactEnabled } from "./react-support";
import { attackSourceValid, listAttackTargets } from "./combat-queries";
import { supportsQuickActivationCard } from "./quick-activation-support";
import { attachmentHost } from "./attachments";

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
/** Batch V98: the defender's committed React Step, as for the Gear-defeat capability, whoever now chooses. */
function validReactActivation(state: GameState, controllerId: PlayerId, context: EngineContext) {
    const c = state.timing.combat;
    return reactEnabled(context) && !state.setup && !state.match.outcome && c.stage === "RIVAL_REACT" && c.attackingPlayerId === state.timing.activePlayer
        && controllerId === state.match.playerOrder.find(id => id !== c.attackingPlayerId) && attackSourceValid(state, c.attackingPlayerId, c.attackerId, context)
        && state.objects.cards[c.attackerId].readiness === "SPENT" && listAttackTargets(state, c.attackerId, c.attackingPlayerId, context).some(target => canonicalSerialize(target) === canonicalSerialize(c.target));
}
/** Batch V98: the source is an equipped Gear whose host inherits its pinned paid {Quick} defeat. */
function gearActivation(state: GameState, sourceId: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, sourceId, context), host = attachmentHost(state, sourceId);
    return r?.type === "GEAR" && supportsQuickActivationCard(r, context).ok && Boolean(host) && ["BATTLEFIELD", "LEGENDS"].includes(state.objects.cards[sourceId].zone.zone);
}
/** Batch V90: the registered defeat an armed end-of-turn binding resolves, compared in place of the printed effect list. */
function registeredDefeat(e: CurrentEffect, revision: NonNullable<ReturnType<typeof cardRevision>>) {
    const first = revision.mechanics.abilities[0].effects[0];
    return e.trigger?.kind === "DELAYED_END_TURN_DEFEAT" && first?.kind === "EQUIPPED_UNIT_POWER_PER_GEAR_THIS_TURN" ? first.ifStealsOrFights.effect : undefined;
}
/** Main keeps the historical active-player noncombat origin. The Gear capability adds exactly one
 * bounded defender-React origin: the caster is the non-active acting player, owns the paused Program
 * continuation and the saved React return, and is not the attacking player. No other non-active
 * source is admitted merely because combat is in the React stage. */
function validDefeatOrigin(state: GameState, effect: CurrentEffect, revision: ReturnType<typeof cardRevision> | null, context: EngineContext) {
    const r = state.resolution, c = state.timing.combat;
    // Batch V46: the post-fight batch of the paused attack, whichever player controls the fired effect.
    // Batch V51: so does a printed "loses a fight" defeat.
    if (effect.trigger?.kind === "DELAYED_FIGHT_OUTCOME" || effect.trigger?.kind === "WHEN_FIGHT_LOST") return c.stage === "TRIGGER_RESOLUTION" && r.triggerContinuation?.origin.kind === "DEFEAT" && Boolean(r.triggerContinuation.origin.fight);
    // Batch V90: an armed end-of-turn defeat, in the END_TURN batch, whichever player controls it.
    if (effect.trigger?.kind === "DELAYED_END_TURN_DEFEAT") return c.stage === "NONE" && r.triggerContinuation?.origin.kind === "END_TURN";
    // Batch V48: the {Play} defeat of a Unit an effect played inside this batch, whichever player controls it and whenever.
    if (effect.trigger?.kind === "WHEN_PLAYED" && r.triggerContinuation?.effectPlays?.some(p => p.subjectId === effect.trigger!.subjectId)) return true;
    // Batch V98: an inherited Gear activation, in its controller's Main Phase or React Step (the owner-order pause hands the choice
    // to the defeated Unit's owner).
    if (revision?.type === "GEAR" && effect.sourceId && gearActivation(state, effect.sourceId, context))
        return c.stage === "NONE" ? effect.controllerId === state.timing.activePlayer && r.returnTo?.kind === "MAIN"
            : validReactActivation(state, effect.controllerId, context) && r.returnTo?.kind === "RIVAL_REACT" && r.playContinuation?.actorId === effect.controllerId
                && (r.targetedDefeatContinuation?.phase === "ORDER" || state.timing.actingPlayer === effect.controllerId);
    if (effect.controllerId === state.timing.activePlayer && c.stage === "NONE") return true;
    return gearCapability(effect, revision, context) && validGearReactOrigin(state, effect.controllerId, context)
        && r.returnTo?.kind === "RIVAL_REACT" && r.playContinuation?.actorId === effect.controllerId;
}
/** Post-movement aftermath keeps the same origin rule, evaluated from the effect source. */
function validAftermathOrigin(state: GameState, controllerId: PlayerId, revision: ReturnType<typeof cardRevision> | null, context: EngineContext) {
    // Batch V98: an inherited Gear activation's DEFEAT batch, in the Main Phase or pausing the attack its React Step interrupted.
    if (revision?.type === "GEAR" && supportsQuickActivationCard(revision, context).ok) {
        const c = state.timing.combat;
        return c.stage === "NONE" ? controllerId === state.timing.activePlayer : c.stage === "TRIGGER_RESOLUTION" && c.attackingPlayerId === state.timing.activePlayer && controllerId !== c.attackingPlayerId;
    }
    if (supportsTargetedGearDefeatCard(revision ?? undefined, context).ok) {
        return state.timing.combat.stage === "NONE"
            ? controllerId === state.timing.activePlayer
            : validGearReactOrigin(state, controllerId, context);
    }
    // Preserve the historical Unit-defeat source rule after checking the Gear origin.
    return controllerId === state.timing.activePlayer;
}
/** Replays "each player" selection: the declared defeats must be exactly the forced or chosen prefix, in turn
 * order from the controller. Returns the player now choosing (null when complete), or undefined when invalid. */
function eachProgress(state: GameState, e: CurrentEffect, defeats: readonly DefeatInstruction[], context: EngineContext): PlayerId | null | undefined {
    let i = 0;
    for (const player of eachDefeatPlayers(state, e)) {
        const options = ownDefeatTargets(state, player, e, context);
        if (!options.length) continue;
        if (i < defeats.length) { if (!options.includes(defeats[i].targetId)) return undefined; i++; continue; }
        if (options.length === 1) return undefined; // A forced pick is never left pending.
        return player;
    }
    return i === defeats.length ? null : undefined;
}
/** The declared defeat set for each reviewed Unit-target form, checked against the current state. */
function validDefeatSet(state: GameState, e: CurrentEffect, defeats: readonly DefeatInstruction[], context: EngineContext, then = false) {
    if (e.effect.kind !== "DEFEAT_UNIT") return false;
    if (then) return defeats.length === 1 && thenDefeatTargets(state, e, context).includes(defeats[0].targetId); // Batch V55.
    const ids = defeats.map(x => x.targetId), all = allOtherDefeatTargets(state, e, context), target = e.effect.target;
    if (all) return all.length > 0 && canonicalSerialize(ids) === canonicalSerialize(all);
    if (target.kind === "UNITS" && target.each) return ids.length > 0 && eachProgress(state, e, defeats, context) === null;
    const eligible = listDefeatTargets(state, e.controllerId, target, context);
    if (ids.length === 2 && target.kind === "UNITS" && target.second) return ids[0] !== ids[1] && eligible.includes(ids[0]) && secondDefeatTargets(state, e, ids[0], context).includes(ids[1]);
    return ids.length === 1 && eligible.includes(ids[0]);
}
export function validateTargetedDefeatState(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.targetedDefeatContinuation, e = r.current;
    if (!c) return e?.effect.kind === "DEFEAT_UNIT" ? failure("ORPHAN_TARGETED_DEFEAT", "Current defeat primitive needs its exact target/order continuation") : success(null);
    const source = e?.sourceId && state.objects.cards[e.sourceId], revision = source && cardRevision(state, source.id, context);
    if (!targetedDefeatEnabled(context) || !e || e.effect.kind !== "DEFEAT_UNIT" || !source || !(supportsTargetedDefeatCard(revision || undefined, context).ok || supportsTargetedGearDefeatCard(revision || undefined, context).ok) || source.controllerId !== e.controllerId || !validDefeatOrigin(state, e, revision, context) || state.setup || state.match.outcome || r.stage !== "CHOICE" || !r.choice || r.callContinuation || r.searchContinuation || r.legendEntryContinuation || r.gigStealContinuation || r.discovered.length || canonicalSerialize(e.effect) !== canonicalSerialize(registeredDefeat(e, revision!) ?? revision!.mechanics.abilities[0].effects[revision!.type === "PROGRAM" || revision!.type === "GEAR" ? r.playContinuation?.effectIndex ?? -1 : 0]))
        return failure("INVALID_TARGETED_DEFEAT", "Exact current reviewed source/effect and exclusive noncombat decision required");
    // Batch V46: a fired next-fight-outcome defeat resolves in its post-fight batch, away from its trashed Program.
    if (e.trigger?.kind === "DELAYED_FIGHT_OUTCOME" || e.trigger?.kind === "WHEN_FIGHT_LOST" || e.trigger?.kind === "DELAYED_END_TURN_DEFEAT" ? r.playContinuation || !r.triggerContinuation || r.triggerContinuation.phase !== "TARGET" : revision!.type === "GEAR" ? r.playContinuation?.kind !== "ACTIVATE" || r.playContinuation.phase !== "EFFECT" || r.playContinuation.sourceId !== source.id || r.triggerContinuation || e.trigger || !gearActivation(state, source.id, context) : revision!.type === "PROGRAM" ? !r.playContinuation || r.playContinuation.phase !== "EFFECT" || r.triggerContinuation || e.trigger || source.zone.zone !== "RESOLVING_PROGRAM" : r.playContinuation || !r.triggerContinuation || !isPlayedInBatch(r.triggerContinuation, source.id) || r.triggerContinuation.phase !== "TARGET" || e.trigger?.kind !== "WHEN_PLAYED" || source.zone.zone !== "BATTLEFIELD")
        return failure("INVALID_TARGETED_DEFEAT_SOURCE", "Program and Unit PLAY retain their own original continuations");
    if (e.effect.when && !testCondition(state, e.controllerId, e.effect.when.condition, context, e.sourceId)) return failure("INVALID_DEFEAT_CONDITION", "A false condition cannot retain a target or owner-order choice");
    // Batch V55: the "if you do" clause exists only after its first defeat: a Gear this source defeated in this batch.
    if (c.then && (!e.effect.then || !(c.phase === "THEN" || c.phase === "ORDER") || !r.triggerContinuation?.effectDefeats?.some(d => d.defeatedBy === source.id && ["TRASH", "REMOVED"].includes(state.objects.cards[d.targetId]?.zone.zone) && cardRevision(state, d.targetId, context)?.type === "GEAR"))
        || c.phase === "THEN" && !c.then) return failure("INVALID_DEFEAT_TARGET", "The second clause needs its source's completed first defeat");
    if (c.phase === "THEN") {
        if (r.defeatContinuation || state.timing.step !== "TARGET_SELECTION" || thenDefeatTargets(state, e, context).length < 2 || canonicalSerialize(thenDefeatChoice(state, context)) !== canonicalSerialize(r.choice)) return failure("INVALID_DEFEAT_TARGET", "Only exact current strategic targets may pause");
    } else if (c.phase === "TARGET") {
        const expected = targetedDefeatChoice(state, context);
        if (r.defeatContinuation || state.timing.step !== "TARGET_SELECTION" || expected.options.length < 2 || canonicalSerialize(expected) !== canonicalSerialize(r.choice)) return failure("INVALID_DEFEAT_TARGET", "Only exact current strategic targets may pause");
    } else if (c.phase === "SECOND" || c.phase === "EACH") {
        const d = r.defeatContinuation ?? (c.phase === "EACH" ? { defeats: [], orders: [] } : undefined), unordered = d && !("fightResult" in d && d.fightResult) && !d.appliedPrevention && !d.appliedPreventions && !("legendReplacement" in d && d.legendReplacement) && d.orders.length === d.defeats.length && d.defeats.every((x, i) => x.defeatedBy === source.id && d.orders[i].targetId === x.targetId && !d.orders[i].cardIds.length);
        if (!d || !unordered || state.timing.step !== "TARGET_SELECTION") return failure("INVALID_DEFEAT_TARGET", "Selected targets carry no order or fight metadata while a target choice is open");
        if (c.phase === "SECOND") {
            const target = e.effect.target, first = d.defeats[0]?.targetId;
            if (target.kind !== "UNITS" || !target.second || d.defeats.length !== 1 || !listDefeatTargets(state, e.controllerId, target, context).includes(first) || !secondDefeatTargets(state, e, first, context).length || canonicalSerialize(secondDefeatChoice(state, context, first)) !== canonicalSerialize(r.choice))
                return failure("INVALID_DEFEAT_TARGET", "The optional second target needs one still-eligible first target, a true condition and the exact current choice");
        } else {
            const chooser = eachProgress(state, e, d.defeats, context);
            if (!chooser || canonicalSerialize(eachDefeatChoice(state, context, chooser)) !== canonicalSerialize(r.choice) || state.timing.actingPlayer !== chooser)
                return failure("INVALID_DEFEAT_TARGET", "Each player picks one own Unit in turn order; only the current strategic choice may pause");
        }
    } else {
        const d = r.defeatContinuation;
        // The declared set must match its reviewed form against the current state (all, each, optional second, single).
        if (!d || d.fightResult || d.appliedPrevention || d.appliedPreventions || !validDefeatSet(state, e, d.defeats, context, Boolean(c.then)) || d.orders.length !== d.defeats.length || d.defeats.some((x, i) => x.defeatedBy !== source.id || d.orders[i].targetId !== x.targetId)) return failure("INVALID_EFFECT_DEFEAT", "Exact still-eligible selected Unit(s) and effect source required; no fight/prevention metadata");
        // Batch V100: a Legend replacement offer comes before any owner order.
        const replacement = validateLegendReplacement(state, context);
        if (!replacement.ok) return replacement;
        if (replacement.value === "OFFER") return d.orders.some(o => o.cardIds.length) ? failure("INVALID_DEFEAT_REPLACEMENT", "Offers precede owner orders") : success(null);
        // Orders finish in sequence: complete orders, then the one paused order, then untouched orders.
        const current = d.orders.findIndex(o => o.cardIds.length < defeatBatch(state, o.targetId, context).length);
        if (current < 0 || d.orders.some((o, i) => { const batch = defeatBatch(state, o.targetId, context); return new Set(o.cardIds).size !== o.cardIds.length || o.cardIds.some(id => !batch.includes(id)) || (i < current ? o.cardIds.length !== batch.length : i > current ? o.cardIds.length !== 0 : batch.length - o.cardIds.length < 2); }) || state.timing.step !== "DEFEAT_ORDER_SELECTION" || canonicalSerialize(defeatOrderChoice(state, context)) !== canonicalSerialize(r.choice)) return failure("INVALID_DEFEAT_ORDER", "Exact owner prefix and strategic shared Trash-order choice required");
    }
    return success(null);
}
/** Additional bounded post-movement proof for effect-caused DEFEATED work; no inferred combat. Each source's defeats are one
 * group: a DEFEAT origin's resolved Program, a fired next-fight-outcome Program (batch V46), the PLAY origin's Unit, or a Unit an
 * effect played in this batch (batch V48). Every DEFEATED binding of an effect-defeated card is captured exactly once. */
export function validateEffectDefeatFacts(state: GameState, context: EngineContext) {
    const c = state.resolution.triggerContinuation;
    if (!c) return success(null);
    const origin = c.origin, program = origin.kind === "DEFEAT" ? origin.effectSource : undefined;
    const groups = new Map<CardInstanceId, DefeatInstruction[]>();
    for (const d of c.effectDefeats ?? []) groups.set(d.defeatedBy, [...(groups.get(d.defeatedBy) ?? []), d]);
    type Group = [CardInstanceId, readonly DefeatInstruction[], boolean];
    const all: Group[] = [...(program && origin.kind === "DEFEAT" ? [[program, origin.defeated, true] as Group] : []), ...[...groups].map(([id, ds]) => [id, ds, false] as Group)];
    if (!all.length) return success(null);
    if (!targetedDefeatEnabled(context)) return failure("INVALID_EFFECT_DEFEAT_FACT", "Bounded source and declared post-movement target identities required");
    for (const [sourceId, defeats, isOrigin] of all) {
        const source = state.objects.cards[sourceId], revision = source && cardRevision(state, source.id, context);
        const fired = !isOrigin && origin.kind === "DEFEAT" && origin.fight ? c.bindings.find(b => (b.kind === "DELAYED_FIGHT_OUTCOME" || b.kind === "WHEN_FIGHT_LOST") && b.sourceId === sourceId && defeats.some(d => d.targetId === b.opposingId))
            // Batch V90: an end-of-turn defeat's own binding (its Unit, or the Gear defeated instead of it).
            : !isOrigin && origin.kind === "END_TURN" ? c.bindings.find(b => b.kind === "DELAYED_END_TURN_DEFEAT" && b.sourceId === sourceId) : undefined;
        const lost = fired?.kind === "WHEN_FIGHT_LOST"; // Batch V51: the losing Unit itself, wherever the fight left it.
        const played = !isOrigin && !fired && Boolean(c.effectPlays?.some(p => p.subjectId === sourceId));
        const ownPlay = !isOrigin && !fired && !played && origin.kind === "PLAY" && origin.subjectId === sourceId;
        if (!source || !(isOrigin || fired || played || ownPlay) || !(supportsTargetedDefeatCard(revision || undefined, context).ok || supportsTargetedGearDefeatCard(revision || undefined, context).ok)
            || (defeats.length !== 1 && !revision?.mechanics.abilities[0].effects.some(e => e.kind === "DEFEAT_UNIT" && (e.target.kind === "UNITS" && (revision.type === "UNIT" && e.target.all === "OTHER_THAN_SOURCE" || revision.type === "PROGRAM" && (e.target.each || e.target.second && defeats.length === 2))
                // Batch V55: a {Play} Gear defeat and its "if you do" Unit defeat.
                || revision.type === "UNIT" && e.then && defeats.length === 2)))
            || (lost ? revision!.type !== "UNIT" : isOrigin && revision!.type === "GEAR" ? !gearActivation(state, source.id, context) : isOrigin || fired ? revision!.type !== "PROGRAM" || source.zone.zone !== "TRASH" : revision!.type !== "UNIT" || (ownPlay && source.zone.zone !== "BATTLEFIELD"))
            || (!fired && !played && !validAftermathOrigin(state, source.controllerId, revision, context))
            || defeats.some(d => d.defeatedBy !== source.id || !state.objects.cards[d.targetId] || !["TRASH", "REMOVED"].includes(state.objects.cards[d.targetId].zone.zone)))
            return failure("INVALID_EFFECT_DEFEAT_FACT", "Bounded source and declared post-movement target identities required");
    }
    const targets = all.flatMap(([, defeats]) => defeats.map(d => d.targetId));
    const expected = all.flatMap(([, defeats]) => defeats).flatMap(d => { const r = cardRevision(state, d.targetId, context)!; return r.mechanics.abilities.filter(a => a.trigger === "WHEN_DEFEATED").map(a => canonicalSerialize({ sourceId: d.targetId, subjectId: d.targetId, controllerId: state.objects.cards[d.targetId].controllerId, source: { cardId: r.id, revision: r.revision }, abilityId: a.id, kind: "WHEN_DEFEATED" })); }).sort();
    const actual = c.bindings.filter(b => b.kind === "WHEN_DEFEATED" && targets.includes(b.subjectId)).map(b => canonicalSerialize(b)).sort();
    if (canonicalSerialize(expected) !== canonicalSerialize(actual)) return failure("INVALID_EFFECT_DEFEAT_BATCH", "Every admitted DEFEATED source must be captured exactly once after movement");
    return success(null);
}
