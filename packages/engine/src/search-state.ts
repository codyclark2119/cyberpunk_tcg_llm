import { supportsCall } from "./effect-support";
import { isPlayedInBatch } from "./effect-play";
import { turnSliceAllows, canonicalSerialize, hashCanonical, failure, success, type GameState, type PendingChoice, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { supportsAttackSearchUnit } from "./attack-search-support";
import { supportsGigSearchUnit } from "./gig-search-support";
import { supportsProgramSearch } from "./program-search-support";
type Effect = NonNullable<GameState["resolution"]["current"]>["effect"];
/** The reviewed deck searches: the V19 Gear search and the V35 cost-matching search. */
export function isSearchEffect(effect: Effect | undefined): effect is Extract<Effect, { kind: "SEARCH_GEAR" | "SEARCH_COST_MATCHING_GIGS" }> {
    return effect?.kind === "SEARCH_GEAR" || effect?.kind === "SEARCH_COST_MATCHING_GIGS";
}
/** How many looked-at cards may be taken: the Gear search's bound, or "any number" (all of them). */
/** Batch V36: the resolving Program search ("Add 1 to your hand. You may add 1 more for each friendly min Gig"). */
export function isProgramSearchEffect(effect: Effect | undefined): effect is Extract<Effect, { kind: "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG" }> {
    return effect?.kind === "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG";
}
/** 6.3.1: a min Gig is a die at its lowest value, 1 for every Gig die; only the controller's own rolled Gigs are friendly. */
export function programSearchMaxTake(state: GameState, controllerId: PlayerId) {
    return 1 + Object.values(state.objects.gigs).filter(g => g.controllerId === controllerId && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue === 1).length;
}
export function searchMaxTake(effect: Extract<Effect, { kind: "SEARCH_GEAR" | "SEARCH_COST_MATCHING_GIGS" }>) {
    return effect.kind === "SEARCH_GEAR" ? effect.maxTake : effect.count;
}
/** Pure selector usable during structural validation, without recursively constructing RulesView. */
export function searchTargets(state: GameState, context: EngineContext) {
    const current = state.resolution.current, continuation = state.resolution.searchContinuation;
    if (!current || !(isSearchEffect(current.effect) || isProgramSearchEffect(current.effect)) || !continuation) return [];
    const effect = current.effect;
    // Batch V35: "cost equal to any friendly Gig values": printed Eddie costs against the controller's own rolled Gigs (6.1.2).
    const values = new Set(Object.values(state.objects.gigs).flatMap(g => g.controllerId === current.controllerId && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" ? [g.roll.currentValue] : []));
    return continuation.looked.filter(id => {
        const instance = state.objects.cards[id], revision = context.content.cards.find(c => c.id === instance?.cardId && c.revision === instance?.revision);
        if (instance?.zone.zone !== "DECK" || instance.zone.playerId !== current.controllerId || !revision) return false;
        if (effect.kind === "SEARCH_TAKE_ONE_PLUS_PER_MIN_GIG") return true; // "Add 1": any looked-at card.
        if (effect.kind === "SEARCH_COST_MATCHING_GIGS") return revision.printedCost.kind === "EDDIES" && values.has(revision.printedCost.amount);
        return revision.type === "GEAR" && (effect.maxCost === undefined || revision.printedCost.kind === "EDDIES" && revision.printedCost.amount <= effect.maxCost);
    });
}
export function searchChoice(state: GameState, context: EngineContext): PendingChoice {
    const current = state.resolution.current!, continuation = state.resolution.searchContinuation!, actorId = current.controllerId;
    return { id: hashCanonical({ kind: "search@1", turn: state.timing.turn, actorSeat: state.players[actorId].seat, sourceId: current.sourceId, selected: continuation.selected }), actorId, kind: "TARGET", options: [...(isProgramSearchEffect(current.effect) && !continuation.selected.length ? [] : [{ kind: "MODE" as const, mode: "DONE" as const }]), ...searchTargets(state, context).filter(id => !continuation.selected.includes(id)).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))], min: 1, max: 1, ordered: false, continuationId: "search@1" };
}
export function validateSearchState(state: GameState, context: EngineContext) {
    const c = state.resolution.searchContinuation, current = state.resolution.current;
    // Batch V70: the top-card keep-or-trash search is validated by the trigger state.
    if (state.resolution.triggerContinuation) return c && current?.effect.kind !== "SEARCH_TOP_MAY_TRASH" && current?.effect.kind !== "SEARCH_TOP_TRASH_ONE" ? validateAttackSearch(state, context) : success(null);
    if (state.resolution.playContinuation) return c || isProgramSearchEffect(current?.effect) ? validateProgramSearch(state, context) : success(null);
    if ((state.timing.step === "TARGET_SELECTION" && !state.resolution.playContinuation) !== Boolean(c)) return failure("INVALID_SEARCH_STATE", "Search step and continuation must agree");
    if (!c) return success(null);
    if (!turnSliceAllows(context.content.ruleset.gameplay?.turnSlice, "callEffects") || current?.effect.kind !== "SEARCH_GEAR" || !current.sourceId || state.resolution.pending.length || state.resolution.discovered.length || state.resolution.callContinuation)
        return failure("INVALID_SEARCH_STATE", "Search requires a supported single pending CALL effect");
    const actor = current.controllerId, source = state.objects.cards[current.sourceId], revision = context.content.cards.find(r => r.id === source?.cardId && r.revision === source?.revision);
    const ability = revision?.mechanics.abilities[0];
    if (!supportsCall(revision, context).ok || state.players[actor].economy.callsThisTurn! < 1 || source?.zone.playerId !== actor || source?.face !== "UP" || source.zone.zone !== "LEGENDS" || source.controllerId !== actor || state.timing.actingPlayer !== actor || ability?.trigger !== "WHEN_CALLED" || ability.effects.length !== 1 || canonicalSerialize(ability.effects[0]) !== canonicalSerialize(current.effect))
        return failure("INVALID_SEARCH_SOURCE", "Pending search must match the revealed Legend's pinned ability");
    const targets = searchTargets(state, context);
    if (canonicalSerialize(c.looked) !== canonicalSerialize(state.players[actor].zones.DECK.slice(0, current.effect.count)) || new Set(c.selected).size !== c.selected.length || c.selected.length >= current.effect.maxTake || c.selected.some(id => !targets.includes(id)) || !targets.some(id => !c.selected.includes(id)) || canonicalSerialize(state.resolution.choice) !== canonicalSerialize(searchChoice(state, context)))
        return failure("INVALID_SEARCH_TARGETS", "Looked cards, selected cards and remaining choices must match current legal targets");
    return success(null);
}
/** Batch V19: the reviewed [Attack] search pauses its own trigger batch, for the attacking Unit's controller only.
 * Batch V35: the reviewed {Play} cost-matching search likewise, in its own PLAY batch. */
function validateAttackSearch(state: GameState, context: EngineContext) {
    const c = state.resolution.searchContinuation!, t = state.resolution.triggerContinuation!, current = state.resolution.current;
    const play = current?.effect.kind === "SEARCH_COST_MATCHING_GIGS";
    if (!current || !isSearchEffect(current.effect) || !current.sourceId || current.primitiveIndex !== undefined || current.trigger?.kind !== (play ? "WHEN_PLAYED" : "WHEN_ATTACKING") || t.phase !== "TARGET" || current.sourceId !== current.trigger.subjectId
        // Batch V48: a {Play} search also runs for a Unit an effect played inside another batch.
        || !(play ? isPlayedInBatch(t, current.trigger.subjectId) : t.origin.kind === "ATTACK" && current.trigger.subjectId === t.origin.subjectId))
        return failure("INVALID_SEARCH_STATE", "Trigger search requires its own current WHEN_ATTACKING or WHEN_PLAYED primitive");
    const actor = current.controllerId, source = state.objects.cards[current.sourceId], revision = context.content.cards.find(r => r.id === source?.cardId && r.revision === source?.revision);
    if (!(play ? supportsGigSearchUnit(revision, context) : supportsAttackSearchUnit(revision, context)).ok || source?.zone.zone !== "BATTLEFIELD" || source.face !== "UP" || source.controllerId !== actor || state.timing.actingPlayer !== actor || (actor !== state.timing.activePlayer && !(play && t.effectPlays?.some(p => p.subjectId === current.sourceId))) || state.timing.step !== "TARGET_SELECTION" || canonicalSerialize(current.effect) !== canonicalSerialize(revision!.mechanics.abilities[0].effects[0]))
        return failure("INVALID_SEARCH_SOURCE", "Pending attack search must match the attacking Unit's pinned ability");
    const targets = searchTargets(state, context);
    if (canonicalSerialize(c.looked) !== canonicalSerialize(state.players[actor].zones.DECK.slice(0, current.effect.count)) || new Set(c.selected).size !== c.selected.length || c.selected.length >= searchMaxTake(current.effect) || c.selected.some(id => !targets.includes(id)) || !targets.some(id => !c.selected.includes(id)))
        return failure("INVALID_SEARCH_TARGETS", "Looked cards, selected cards and remaining choices must match current legal targets");
    return success(null);
}
/** Batch V36: the resolving Program's search pauses its own play continuation; one card must be taken before stopping. */
function validateProgramSearch(state: GameState, context: EngineContext) {
    const c = state.resolution.searchContinuation, p = state.resolution.playContinuation!, current = state.resolution.current;
    if (!c || !current || !isProgramSearchEffect(current.effect) || !current.sourceId || current.sourceId !== p.sourceId || current.controllerId !== p.actorId || current.trigger || current.primitiveIndex !== undefined)
        return failure("INVALID_SEARCH_STATE", "A Program search requires its own current resolving primitive and looked-at cards");
    const actor = current.controllerId, source = state.objects.cards[current.sourceId], revision = context.content.cards.find(r => r.id === source?.cardId && r.revision === source?.revision);
    if (!supportsProgramSearch(revision, context).ok || source?.zone.zone !== "RESOLVING_PROGRAM" || source.zone.playerId !== actor || source.controllerId !== actor || state.timing.actingPlayer !== actor || actor !== state.timing.activePlayer || state.timing.step !== "TARGET_SELECTION")
        return failure("INVALID_SEARCH_SOURCE", "A Program search must match the resolving Program's pinned ability");
    const targets = searchTargets(state, context), remaining = targets.filter(id => !c.selected.includes(id));
    if (canonicalSerialize(c.looked) !== canonicalSerialize(state.players[actor].zones.DECK.slice(0, current.effect.count)) || new Set(c.selected).size !== c.selected.length || c.selected.length >= programSearchMaxTake(state, actor) || c.selected.some(id => !targets.includes(id)) || !remaining.length || (!c.selected.length && remaining.length < 2) || canonicalSerialize(state.resolution.choice) !== canonicalSerialize(searchChoice(state, context)))
        return failure("INVALID_SEARCH_TARGETS", "Looked cards, taken cards and remaining choices must match the current bound; a lone mandatory card is taken without a choice");
    return success(null);
}
