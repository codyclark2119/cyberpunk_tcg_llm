import { failure, success, type CardInstanceId, type DeepReadonly, type DefeatInstruction, type GameState, type PlayerId, type Result, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { attachedGear, legalEquipHosts } from "./attachments";
import { attachPlayedGear } from "./card-movement";
import { supportsPlay } from "./play-support";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { recordCyberwareGearPlay } from "./play-cost-support";

type Step = (m: TurnMutation) => Result<null>;
const GUARD = "FRIENDLY_EQUIPPED_UNIT_DEFEATED";
/** Batch V92: content holding the reviewed Legend that plays a hand Gear for free or observes friendly equipped defeats. */
export function handGearPlayEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.type === "LEGEND" && r.mechanics.abilities.some(a => a.guard === GUARD || a.effects.some(e => e.kind === "PLAY_GEAR_FROM_HAND_FREE")) && supportsLegendSpendCard(r, context).ok);
}
/** "A Gear with cost 2 or less from your hand": the player's hand Gear (3.11.1.2: printed cost) the engine can play, with a legal host.
 * None in the snapshot has a {Play} ability; one would be refused (fail-closed). */
export function handGearTargets(state: GameState, actor: PlayerId, maxCost: number, context: EngineContext): CardInstanceId[] {
    return (state.players[actor]?.zones.HAND ?? []).filter(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return c?.ownerId === actor && c.controllerId === actor && r?.type === "GEAR" && r.printedCost.kind === "EDDIES" && r.printedCost.amount <= maxCost && supportsPlay(r, context).ok
            && !r.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED") && legalEquipHosts(state, id, context).length > 0;
    }).sort();
}
export function currentHandGearTargets(state: GameState, context: EngineContext) {
    const e = state.resolution.current;
    return e?.effect.kind === "PLAY_GEAR_FROM_HAND_FREE" ? handGearTargets(state, e.controllerId, e.effect.maxCost, context) : [];
}
/** The current pause's options: the hand Gear, then (holding it) its hosts. */
export function handGearOptions(state: GameState, context: EngineContext) {
    const held = state.resolution.playContinuation?.handGearId;
    return held ? legalEquipHosts(state, held, context) : currentHandGearTargets(state, context);
}
/** "Play a Gear ... for free": with none nothing is played; a lone Gear or lone host is taken without a choice. */
export function beginHandGearPlay(m: TurnMutation, offer: Step): Result<null> {
    const gears = currentHandGearTargets(m.state, m.context);
    if (!gears.length) return success(null);
    return gears.length > 1 ? offer(m) : selectHandGear(m, gears[0], offer);
}
export function selectHandGear(m: TurnMutation, gearId: CardInstanceId, offer: Step): Result<null> {
    const c = m.state.resolution.playContinuation!;
    if (!currentHandGearTargets(m.state, m.context).includes(gearId)) return failure("INVALID_FREE_GEAR_PLAY", "Choose a Gear with cost 2 or less from your hand");
    const hosts = legalEquipHosts(m.state, gearId, m.context);
    if (hosts.length > 1) { c.handGearId = gearId; return offer(m); }
    return playHandGear(m, gearId, hosts[0]);
}
/** 11.20.2: the Gear is played without paying once it is equipped; its play batch follows this ability (finishPlay). */
export function playHandGear(m: TurnMutation, gearId: CardInstanceId, hostId: CardInstanceId): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, current = s.resolution.current!;
    if (!currentHandGearTargets(s, m.context).includes(gearId) || !legalEquipHosts(s, gearId, m.context).includes(hostId)) return failure("INVALID_FREE_GEAR_PLAY", "Choose a current host for the chosen hand Gear");
    delete c.handGearId;
    s.objects.cards[gearId].face = "UP";
    m.emit({ kind: "CARD_REVEALED", cardInstanceId: gearId });
    const attached = attachPlayedGear(m, gearId, hostId);
    if (!attached.ok) return attached;
    s.objects.cards[gearId].readiness = "READY";
    recordCyberwareGearPlay(m, current.controllerId, gearId);
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: gearId });
    c.playedGearId = gearId;
    return success(null);
}
/** A held Gear exists only while its host is chosen among two or more; a played Gear never survives to a decision. */
export function validateHandGearPlay(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation, current = state.resolution.current;
    if (!c?.handGearId && !c?.playedGearId) return success(null);
    if (c.playedGearId || current?.effect.kind !== "PLAY_GEAR_FROM_HAND_FREE" || c.kind !== "ACTIVATE" || current.sourceId !== c.sourceId || !currentHandGearTargets(state, context).includes(c.handGearId!)
        || legalEquipHosts(state, c.handGearId!, context).length < 2)
        return failure("INVALID_FREE_GEAR_PLAY", "A held hand Gear belongs to its Legend's current free play while a host is chosen");
    return success(null);
}
/** A face-up field Unit with an attached Gear, just before it is defeated. */
function equippedUnit(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return Boolean(c && c.face === "UP" && c.zone.zone === "BATTLEFIELD" && effectiveCardTypes(state, id, context).includes("UNIT") && attachedGear(state, id, context).length);
}
/** Called with each defeat batch before its cards move (as Batch V50 records its first ARASAKA defeat). */
export function recordEquippedDefeats(m: TurnMutation, ids: readonly CardInstanceId[]) {
    const h = m.state.turnHistory, equipped = ids.filter(id => equippedUnit(m.state, id, m.context));
    if (!h || !equipped.length || !handGearPlayEnabled(m.context)) return;
    h.equippedDefeats = [...new Set([...(h.equippedDefeats ?? []), ...equipped])].sort();
}
/** "When a friendly equipped Unit is defeated": each face-up Legend of the Unit's controller with the pinned trigger, once per defeated
 * equipped Unit; the binding's subject is that Unit. Captured before movement. */
export function equippedDefeatBindings(state: GameState, defeated: readonly DeepReadonly<DefeatInstruction>[], context: EngineContext): TriggerBinding[] {
    return defeated.flatMap(d => {
        const unit = state.objects.cards[d.targetId];
        if (!unit || !equippedUnit(state, unit.id, context)) return [];
        return [...state.players[unit.controllerId].zones.LEGENDS].sort().flatMap(id => {
            const legend = state.objects.cards[id], r = cardRevision(state, id, context);
            if (!legend || !r || legend.face !== "UP" || legend.controllerId !== unit.controllerId || !supportsLegendSpendCard(r, context).ok) return [];
            return r.mechanics.abilities.filter(a => a.trigger === "WHEN_UNIT_DEFEATED" && a.guard === GUARD)
                .map(a => ({ sourceId: id, subjectId: unit.id, controllerId: unit.controllerId, source: { cardId: r.id, revision: r.revision }, abilityId: a.id, kind: "WHEN_UNIT_DEFEATED" as const }));
        });
    });
}
export function isEquippedDefeatBinding(state: GameState, b: DeepReadonly<TriggerBinding>, context: EngineContext) {
    return b.kind === "WHEN_UNIT_DEFEATED" && cardRevision(state, b.sourceId, context)?.mechanics.abilities.find(a => a.id === b.abilityId)?.guard === GUARD;
}
/** The bound Legend is face-up in its controller's Legends area; the Unit, of the same controller, was recorded equipped and is one of
 * this batch's defeats, now off the field. */
export function validEquippedDefeatBinding(state: GameState, b: DeepReadonly<TriggerBinding>, defeatedIds: readonly CardInstanceId[], context: EngineContext) {
    const source = state.objects.cards[b.sourceId], subject = state.objects.cards[b.subjectId], r = cardRevision(state, b.sourceId, context), a = r?.mechanics.abilities.find(a => a.id === b.abilityId);
    return Boolean(source && subject && r && a?.trigger === "WHEN_UNIT_DEFEATED" && a.guard === GUARD && r.type === "LEGEND" && supportsLegendSpendCard(r, context).ok && b.sourceId !== b.subjectId
        && source.face === "UP" && source.zone.zone === "LEGENDS" && source.controllerId === b.controllerId && subject.controllerId === b.controllerId && source.cardId === b.source.cardId && source.revision === b.source.revision
        && defeatedIds.includes(b.subjectId) && !["BATTLEFIELD", "LEGENDS"].includes(subject.zone.zone) && state.turnHistory?.equippedDefeats?.includes(b.subjectId)
        && b.gigInstanceId === undefined && !b.delayedId && b.opposingId === undefined && b.changeEffectId === undefined);
}
export function validateEquippedDefeats(state: GameState, context: EngineContext) {
    const h = state.turnHistory, ids = h?.equippedDefeats;
    if (!ids) return success(null);
    if (!handGearPlayEnabled(context) || state.setup || h!.turn !== state.timing.turn || ids.some((id, i) => !state.objects.cards[id] || i > 0 && ids[i - 1] >= id))
        return failure("INVALID_TURN_HISTORY", "Equipped defeats need their reviewed reader, the current turn and distinct sorted cards");
    return success(null);
}
