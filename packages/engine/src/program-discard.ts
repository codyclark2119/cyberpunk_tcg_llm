import { failure, success, type CardInstanceId, type GameState, type PendingEffect, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { moveCardLocation } from "./card-movement";
import { getDiscardableCards } from "./discard";
import { bottomDeckTargets } from "./bottom-deck";
import { supportsProgramDiscardUnit } from "./program-discard-support";

/** Batch V32: Programs in the player's own hand, the only cards "discard N Programs" may discard. */
export function handPrograms(state: GameState, player: PlayerId, context: EngineContext): CardInstanceId[] {
    return getDiscardableCards(state, player).filter(id => cardRevision(state, id, context)?.type === "PROGRAM");
}
/** "If you do, bottom-deck a rival Unit": public rival Units on the field (11.15); "unequipped" (V33) excludes any Unit with Gear attached. */
export function programBottomDeckTargets(state: GameState, current: PendingEffect, context: EngineContext): CardInstanceId[] {
    if (current.effect.kind !== "DISCARD_PROGRAMS_THEN_BOTTOM_DECK") return [];
    const unequipped = current.effect.then.unequipped;
    return bottomDeckTargets(state, current.controllerId, { relation: current.effect.then.relation }, context).filter(id => !unequipped || !state.objects.cards[id].attachments.length);
}
/** The controller discards one chosen own-hand Program; trash is public. */
export function discardProgram(m: TurnMutation, current: PendingEffect, cardInstanceId: CardInstanceId, forced: boolean): Result<null> {
    if (current.effect.kind !== "DISCARD_PROGRAMS_THEN_BOTTOM_DECK" || !current.sourceId || !handPrograms(m.state, current.controllerId, m.context).includes(cardInstanceId))
        return failure("INVALID_DISCARD", "Choose a Program in your own hand");
    moveCardLocation(m, cardInstanceId, "TRASH");
    m.emit({ kind: "CARD_DISCARDED", cardInstanceId, playerId: current.controllerId, sourceId: current.sourceId, effectId: current.id, forced });
    return success(null);
}
/** The pinned {Play}/{Attack} discard pauses in its own batch: to choose a Program (or decline before the first), then, with every
 * Program discarded and held as proof, for 2+ rival Units to bottom-deck. */
export function validateProgramDiscard(state: GameState, context: EngineContext): Result<null> {
    const r = state.resolution, c = r.triggerContinuation!, e = r.current!, effect = e.effect, held = c.discardedPrograms ?? [];
    const source = e.sourceId ? state.objects.cards[e.sourceId] : undefined, subject = "subjectId" in c.origin ? c.origin.subjectId : undefined;
    const origin = c.origin.kind === "PLAY" && e.trigger?.kind === "WHEN_PLAYED" || c.origin.kind === "ATTACK" && e.trigger?.kind === "WHEN_ATTACKING";
    if (effect.kind !== "DISCARD_PROGRAMS_THEN_BOTTOM_DECK" || !origin || e.primitiveIndex !== undefined || !source || subject !== source.id || e.trigger?.subjectId !== source.id
        || !supportsProgramDiscardUnit(cardRevision(state, source.id, context), context).ok || new Set(held).size !== held.length
        || held.some(id => { const x = state.objects.cards[id]; return !x || x.zone.zone !== "TRASH" || x.ownerId !== e.controllerId || cardRevision(state, id, context)?.type !== "PROGRAM"; })
        || (c.phase === "DISCARD" ? held.length >= effect.count || handPrograms(state, e.controllerId, context).length < effect.count - held.length
            : c.phase === "TARGET" ? held.length !== effect.count || programBottomDeckTargets(state, e, context).length < 2 : true))
        return failure("INVALID_PROGRAM_DISCARD_CONTINUATION", "Only the reviewed Program discard pauses: for a hand Program, then with its discards held, for 2+ rival Units");
    return success(null);
}
