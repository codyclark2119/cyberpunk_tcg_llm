import { PendingEffectSchema, TriggerBindingSchema, failure, success, type CardInstanceId, type GameState, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { moveCardLocation } from "./card-movement";
import { bottomDeck } from "./bottom-deck";
import { supportsPlay } from "./play-support";
import { discoverTriggers, pendingTrigger } from "./trigger-queries";

/** Batch V48: the public Units in the controller's trash with cost 9 or less (3.11.1.2: printed cost value), other than the
 * trigger subject. A card the engine cannot play is not a target (fail-closed; a reviewed deck holds no such card).
 * Batch V50: "from your hand or trash" adds the controller's hand cards, with cost 4 or less and no exclusion. */
export function freePlayTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const current = state.resolution.current, e = current?.effect;
    if (e?.kind !== "PLAY_UNIT_FREE" || !current?.trigger || !state.players[current.controllerId]) return [];
    const zones = state.players[current.controllerId].zones, ids = e.from === "HAND_OR_TRASH" ? [...zones.HAND, ...zones.TRASH] : zones.TRASH;
    return ids.filter(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return !(e.exclude === "SUBJECT" && id === current.trigger!.subjectId) && (c.face === "UP" || c.zone.zone === "HAND") && c.ownerId === current.controllerId && r?.type === "UNIT" && r.printedCost.kind === "EDDIES" && r.printedCost.amount <= e.maxCost && supportsPlay(r, context).ok;
    }).sort();
}
/** 4.x/11.11.4: the chosen Unit is played without paying: it enters the field ready and lagging, a blue Unit counts toward
 * the first-blue-play history, and its {Play} triggers (and a first-blue-play observer) join this batch. */
export function resolveFreePlay(m: TurnMutation, id: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.triggerContinuation!;
    if (!freePlayTargets(s, m.context).includes(id)) return failure("INVALID_FREE_PLAY", "Choose another Unit with cost 9 or less in your trash");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    if (s.objects.cards[id].zone.zone === "HAND") { s.objects.cards[id].face = "UP"; m.emit({ kind: "CARD_REVEALED", cardInstanceId: id }); } // Batch V50.
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: id });
    moveCardLocation(m, id, "BATTLEFIELD");
    const card = s.objects.cards[id];
    card.readiness = "READY"; card.statuses.push("LAG");
    // Batch V50: "It can attack rival Units this turn" (lagging, so rival Units only, as for Batch V30).
    if (current.effect.kind === "PLAY_UNIT_FREE" && current.effect.grant) { const h = s.turnHistory!; h.rivalUnitAttackGrants = [...(h.rivalUnitAttackGrants ?? []), id].sort(); }
    const ordinal = recordQualifyingPlay(m, id);
    (c.effectPlays ??= []).push({ subjectId: id, ...(ordinal ? { qualifyingOrdinal: ordinal } : {}) });
    const sequence = s.match.eventSequence;
    for (const b of discoverTriggers(s, { kind: "PLAY", subjectId: id }, m.context)) {
        c.bindings.push(TriggerBindingSchema.parse(b));
        const e = PendingEffectSchema.parse(pendingTrigger(s, b, c.ordinal, sequence, m.context));
        s.resolution.pending.push(e); m.emit({ kind: "EFFECT_PENDING", effectId: e.id, sourceId: e.sourceId! });
    }
    return success(null);
}
/** "Then, bottom-deck this Unit": the trigger subject, only while it is still in its owner's trash (11.23.3: its Gear stays). */
export function bottomDeckSubject(m: TurnMutation): Result<null> {
    const e = m.state.resolution.current!.effect;
    if (e.kind !== "PLAY_UNIT_FREE" || e.then !== "BOTTOM_DECK_SUBJECT") return success(null); // Batch V50: only when printed.
    const subject = m.state.objects.cards[m.state.resolution.current!.trigger!.subjectId];
    return subject?.zone.zone === "TRASH" ? bottomDeck(m, subject.id, true) : success(null);
}
/** The first-blue-play history a played blue Unit or Gear records (shared with an ordinary play). */
export function recordQualifyingPlay(m: TurnMutation, id: CardInstanceId): number | undefined {
    const c = m.state.objects.cards[id], r = cardRevision(m.state, id, m.context)!;
    if (!r.colors.includes("BLUE") || !effectiveCardTypes(m.state, id, m.context).some(t => t === "UNIT" || t === "GEAR")) return undefined;
    const ordinal = ++m.state.turnHistory!.blueUnitOrGearPlays[c.controllerId];
    m.emit({ kind: "QUALIFYING_PLAY_RECORDED", playerId: c.controllerId, cardInstanceId: id, ordinal });
    return ordinal;
}
