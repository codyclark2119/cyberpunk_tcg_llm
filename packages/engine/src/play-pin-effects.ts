import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type PendingEffect, type Result, type TemporaryKeywordGrant } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { moveCardLocation } from "./card-movement";
import { supportsPinnedPlayUnit } from "./play-pin-support";
import { triggerId } from "./trigger-queries";

/** Batch V20: Programs among exactly the cards this {Play} trashed that are still public in its controller's trash. */
export function trashedProgramTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const c = state.resolution.triggerContinuation, current = state.resolution.current;
    if (!c?.trashedIds || current?.effect.kind !== "TRASH_THEN_RETURN_PROGRAM") return [];
    const trash = state.players[current.controllerId].zones.TRASH;
    return c.trashedIds.filter(id => trash.includes(id) && state.objects.cards[id].face === "UP" && cardRevision(state, id, context)?.type === "PROGRAM").sort();
}
function returnProgram(m: TurnMutation, id: CardInstanceId, forced: boolean) {
    const current = m.state.resolution.current!;
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    moveCardLocation(m, id, "HAND");
    delete m.state.resolution.triggerContinuation!.trashedIds;
}
/** 11.10.2.1.1: trash the top card individually, up to 3 times; an empty deck stops trashing without a loss (only drawing loses, 1.14).
 * Returns true when a strategic choice between 2+ Programs must pause. */
export function beginTrashProgram(m: TurnMutation): boolean {
    const s = m.state, current = s.resolution.current!, c = s.resolution.triggerContinuation!, deck = s.players[current.controllerId].zones.DECK, trashed: CardInstanceId[] = [];
    if (current.effect.kind !== "TRASH_THEN_RETURN_PROGRAM") return false;
    for (let i = 0; i < current.effect.count && deck.length; i++) { const id = deck[0]; moveCardLocation(m, id, "TRASH"); trashed.push(id); }
    if (!trashed.length) return false;
    c.trashedIds = trashed;
    const targets = trashedProgramTargets(s, m.context);
    if (targets.length > 1) return true;
    if (targets.length === 1) returnProgram(m, targets[0], true);
    delete c.trashedIds;
    return false;
}
export function chooseTrashedProgram(m: TurnMutation, id: CardInstanceId): Result<null> {
    if (!trashedProgramTargets(m.state, m.context).includes(id)) return failure("INVALID_TRASH_TARGET", "Choose a Program among the trashed cards");
    returnProgram(m, id, false);
    return success(null);
}
/** A pause holds exactly the trashed top of the trash (fewer than 3 only from an empty deck) and 2+ Programs to choose from. */
export function validateTrashProgramPause(state: GameState, context: EngineContext) {
    const r = state.resolution, c = r.triggerContinuation, current = r.current, ids = c?.trashedIds ?? [];
    if (current?.effect.kind !== "TRASH_THEN_RETURN_PROGRAM") return c?.trashedIds ? failure("INVALID_TRASH_RETURN", "Trashed cards belong only to the current trash-return primitive") : success(null);
    const source = current.sourceId ? state.objects.cards[current.sourceId] : undefined, trash = state.players[current.controllerId].zones.TRASH;
    if (!c || c.phase !== "TARGET" || c.origin.kind !== "PLAY" || current.trigger?.kind !== "WHEN_PLAYED" || current.primitiveIndex !== undefined || !source || c.origin.subjectId !== source.id
        || !supportsPinnedPlayUnit(cardRevision(state, source.id, context), context).ok || !ids.length || ids.length > current.effect.count
        || (ids.length < current.effect.count && state.players[current.controllerId].zones.DECK.length) || canonicalSerialize(trash.slice(-ids.length)) !== canonicalSerialize(ids)
        || ids.some(id => state.objects.cards[id].ownerId !== current.controllerId) || trashedProgramTargets(state, context).length < 2 || state.timing.step !== "TARGET_SELECTION")
        return failure("INVALID_TRASH_RETURN", "Exact trashed top cards, an empty deck for a short trash, and a strategic Program choice required");
    return success(null);
}

/** "Another friendly Unit with cost 5 or less": face-up field Units the controller controls, other than the {Play} source. Ready, spent and Lag do not matter. */
export function keywordGrantTargets(state: GameState, current: PendingEffect, context: EngineContext): CardInstanceId[] {
    if (current.effect.kind !== "GRANT_KEYWORD_UNTIL_END_OF_TURN") return [];
    const limit = current.effect.target.costAtMost;
    return Object.values(state.objects.cards).filter(card => card.id !== current.sourceId && card.controllerId === current.controllerId && card.zone.playerId === current.controllerId
        && card.zone.zone === "BATTLEFIELD" && card.face === "UP" && effectiveCardTypes(state, card.id, context).includes("UNIT")
        && (r => r?.printedCost.kind === "EDDIES" && r.printedCost.amount <= limit)(cardRevision(state, card.id, context))).map(card => card.id).sort();
}
function compareGrants(a: TemporaryKeywordGrant, b: TemporaryKeywordGrant) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
export function applyKeywordGrant(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, t = current?.trigger;
    if (current?.effect.kind !== "GRANT_KEYWORD_UNTIL_END_OF_TURN" || !current.sourceId || !t) return failure("INVALID_KEYWORD_GRANT", "Current reviewed grant required");
    if (!keywordGrantTargets(s, current, m.context).includes(targetId)) return failure("INVALID_KEYWORD_TARGET", "Choose another current friendly Unit with cost 5 or less");
    const grant: TemporaryKeywordGrant = { kind: "KEYWORD", keyword: current.effect.keyword, sourceId: current.sourceId, targetId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    if (s.temporaryKeywords?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_KEYWORD_GRANT", "A resolved grant occurrence cannot be applied twice");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    (s.temporaryKeywords ??= []).push(grant);
    s.temporaryKeywords.sort(compareGrants);
    m.emit({ kind: "KEYWORD_GRANTED", grant });
    return success(null);
}
export function expireKeywordGrants(m: TurnMutation) {
    for (const x of m.state.temporaryKeywords ?? []) m.emit({ kind: "KEYWORD_GRANT_EXPIRED", sourceId: x.sourceId, targetId: x.targetId, effectId: x.origin.effectId, reason: "TURN_END" });
    delete m.state.temporaryKeywords;
}
/** A card that leaves the field is a new object when it returns, so the grant ends with the departure. */
export function expireKeywordGrantsOnDeparture(m: TurnMutation, targetId: CardInstanceId) {
    const grants = m.state.temporaryKeywords;
    if (!grants?.some(x => x.targetId === targetId)) return;
    for (const x of grants.filter(x => x.targetId === targetId)) m.emit({ kind: "KEYWORD_GRANT_EXPIRED", sourceId: x.sourceId, targetId, effectId: x.origin.effectId, reason: "LEFT_FIELD" });
    m.state.temporaryKeywords = grants.filter(x => x.targetId !== targetId);
    if (!m.state.temporaryKeywords.length) delete m.state.temporaryKeywords;
}
export function validateKeywordGrants(state: GameState, context: EngineContext) {
    const grants = state.temporaryKeywords;
    if (!grants) return success(null);
    if (new Set(grants.map(x => x.origin.effectId)).size !== grants.length || canonicalSerialize(grants) !== canonicalSerialize([...grants].sort(compareGrants)))
        return failure("INVALID_KEYWORD_GRANT", "Unique, ordered grant occurrences required");
    const continuation = state.resolution.triggerContinuation;
    for (const x of grants) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context), a = r?.mechanics.abilities.find(a => a.id === x.origin.abilityId);
        const effect = a?.effects[0], targetRevision = cardRevision(state, x.targetId, context);
        if (!source || !target || !r || !a || !supportsPinnedPlayUnit(r, context).ok || effect?.kind !== "GRANT_KEYWORD_UNTIL_END_OF_TURN" || effect.keyword !== x.keyword
            || source.face !== "UP" || !["BATTLEFIELD", "TRASH", "REMOVED"].includes(source.zone.zone) || x.sourceId === x.targetId
            || target.face !== "UP" || target.zone.zone !== "BATTLEFIELD" || target.controllerId !== source.controllerId || !effectiveCardTypes(state, target.id, context).includes("UNIT")
            || targetRevision?.printedCost.kind !== "EDDIES" || targetRevision.printedCost.amount > effect.target.costAtMost
            || x.expires.turn !== state.timing.turn || x.origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0)
            || x.origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_PLAYED" }, x.origin.ordinal)
            || continuation?.ordinal === x.origin.ordinal && !continuation.resolvedIds.includes(x.origin.effectId))
            return failure("INVALID_KEYWORD_GRANT", "A grant needs its resolved current-turn PLAY occurrence and a face-up friendly field Unit target");
    }
    return success(null);
}
