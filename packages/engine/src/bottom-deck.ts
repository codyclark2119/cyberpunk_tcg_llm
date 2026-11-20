import { failure, success, type BottomDeckTarget, type CardInstanceId, type GameState, type PlayerId, type Result } from "@tcg/domain";
import { expireMustAttackOnDeparture } from "./must-attack";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { drawDeterministicInteger } from "./rng";
import { isUnitSpendSubject } from "./unit-spend";
import { moveCardLocation } from "./card-movement";
import { forgetLegendKnowledge } from "./private-knowledge";
import { expirePowerOnHiddenEntry } from "./temporary-power";
import { expireKeywordGrantsOnDeparture } from "./play-pin-effects";
import { expireReadyLocksOnDeparture } from "./ready-lock";
import { cardRevision, effectivePower } from "./characteristics";

/** Batch V15: public effective Units on the field, filtered by relation and readiness; "lowest-power" keeps every tied minimum. */
export function bottomDeckTargets(state: GameState, actor: PlayerId, target: BottomDeckTarget, context: EngineContext): CardInstanceId[] {
    const candidates = Object.values(state.objects.cards).filter(c => isUnitSpendSubject(state, c.id, context)
        && (target.relation === "RIVAL" ? c.controllerId !== actor : c.controllerId === actor)
        && (target.readiness === undefined || c.readiness === target.readiness)
        // Batch V44: "with power 0" reads the referenced power, so a negative value counts as 0 (2.10.1).
        && (target.power === undefined || (effectivePower(state, c.id, context) ?? 1) <= 0)).map(c => c.id).sort();
    if (!target.lowestPower) return candidates;
    const powers = candidates.map(id => [id, effectivePower(state, id, context)] as const).filter((p): p is readonly [CardInstanceId, number] => p[1] !== null);
    const lowest = Math.min(...powers.map(p => p[1]));
    return powers.filter(p => p[1] === lowest).map(p => p[0]);
}
/** The target set of the current phase: the first clause, or the "if you do" clause once its first Unit is bottom-decked. */
export function currentBottomDeckTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const c = state.resolution.playContinuation, current = state.resolution.current;
    if (!c || current?.effect.kind !== "BOTTOM_DECK_UNIT") return [];
    const target = c.bottomDecked ? current.effect.then : current.effect.target;
    return target ? bottomDeckTargets(state, current.controllerId, target, context) : [];
}
/** 11.15.1: the owner places the Unit and its equipped Gear (4.12.3, 11.15.1.3) on the bottom of their deck in a random
 * order, face down. A Legend in the deck is in an invalid area and is then removed from the game (4.4, 4.4.2). */
export function bottomDeck(m: TurnMutation, id: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current!, host = s.objects.cards[id], owner = host.ownerId, gearIds = [...host.attachments].sort();
    const batch = [id, ...gearIds];
    if (batch.some(cid => s.objects.cards[cid].ownerId !== owner)) return failure("UNSUPPORTED_MULTI_OWNER_ORDER", "Bottom-decking cards of different owners together needs a reviewed protocol");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    for (const gearId of gearIds) m.emit({ kind: "GEAR_DETACHED", gearInstanceId: gearId, hostInstanceId: id, reason: "HOST_LEFT_AREA" });
    host.attachments = [];
    const order = [...batch];
    for (let i = order.length - 1; i > 0; i--) {
        const r = drawDeterministicInteger(s.rng, i + 1);
        s.rng = r.rng;
        [order[i], order[r.rawValue - 1]] = [order[r.rawValue - 1], order[i]];
    }
    for (const cid of order) {
        expirePowerOnHiddenEntry(m, cid);
        expireKeywordGrantsOnDeparture(m, cid);
        expireReadyLocksOnDeparture(m, cid);
        expireMustAttackOnDeparture(m, cid);
        forgetLegendKnowledge(m, cid);
        const card = s.objects.cards[cid], from = { ...card.zone }, refs = s.players[from.playerId].zones[from.zone]!;
        refs.splice(refs.indexOf(cid), 1);
        card.controllerId = owner;
        card.zone = { playerId: owner, zone: "DECK" };
        card.face = "DOWN";
        card.readiness = "READY";
        card.statuses = [];
        s.players[owner].zones.DECK.push(cid);
        m.emit({ kind: "CARD_MOVED", cardInstanceId: cid, from, to: card.zone });
    }
    if (cardRevision(s, id, m.context)?.type === "LEGEND") moveCardLocation(m, id, "REMOVED");
    return success(null);
}
/** Bottom-deck one Unit of the current phase; a single eligible Unit is forced and none ends the primitive. */
function advance(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, current = s.resolution.current!;
    if (current.effect.kind !== "BOTTOM_DECK_UNIT") return failure("INVALID_BOTTOM_DECK", "Expected the bottom-deck primitive");
    for (;;) {
        const targets = currentBottomDeckTargets(s, m.context);
        if (targets.length > 1) return offer(m);
        if (!targets.length) { delete c.bottomDecked; return success(null); }
        const moved = bottomDeck(m, targets[0], true);
        if (!moved.ok) return moved;
        if (c.bottomDecked || !current.effect.then) { delete c.bottomDecked; return success(null); }
        c.bottomDecked = targets[0]; // "If you do": the second clause now applies.
    }
}
export function resolveBottomDeck(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    return advance(m, offer);
}
/** The player's chosen Unit; an "if you do" clause may then pause again. Clears the answered choice first. */
export function chooseBottomDeck(m: TurnMutation, id: CardInstanceId, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, current = s.resolution.current!;
    if (current.effect.kind !== "BOTTOM_DECK_UNIT" || !currentBottomDeckTargets(s, m.context).includes(id)) return failure("INVALID_BOTTOM_DECK_TARGET", "Choose a current qualifying Unit");
    s.resolution.choice = null;
    const moved = bottomDeck(m, id, false);
    if (!moved.ok) return moved;
    if (c.bottomDecked || !current.effect.then) { delete c.bottomDecked; return success(null); }
    c.bottomDecked = id;
    return advance(m, offer);
}
/** A pause holds a strategic choice of 2+ Units; the second clause also holds the first Unit, already in its owner's deck. */
export function validateBottomDeck(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, current = state.resolution.current;
    if (current?.effect.kind !== "BOTTOM_DECK_UNIT") return c.bottomDecked ? failure("INVALID_BOTTOM_DECK", "A bottom-decked Unit belongs only to the current bottom-deck primitive") : success(null);
    const first = c.bottomDecked ? state.objects.cards[c.bottomDecked] : undefined;
    if (c.targetGigId || state.timing.step !== "TARGET_SELECTION" || currentBottomDeckTargets(state, context).length < 2 || state.resolution.targetedDefeatContinuation || state.resolution.defeatContinuation || state.resolution.triggerContinuation
        || (c.bottomDecked && (!current.effect.then || !first || !(first.zone.zone === "DECK" && first.zone.playerId === first.ownerId || first.zone.zone === "REMOVED" && cardRevision(state, first.id, context)?.type === "LEGEND"))))
        return failure("INVALID_BOTTOM_DECK", "A strategic Unit choice, and for the second clause its bottom-decked first Unit, required");
    return success(null);
}
