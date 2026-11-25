import { canonicalSerialize, failure, success, type CardInstanceId, type FightPowerGrant, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { isUnitSpendSubject } from "./unit-spend";
import { supportsFightPowerProgram } from "./fight-power-grant-support";
import { supportsGigChangeTriggerCard } from "./gig-change-trigger-support";

/** Batch V58: the controller's face-up field Units, the choices for "a friendly Unit". */
export function friendlyFieldUnits(state: GameState, actor: PlayerId, context: EngineContext) {
    return Object.values(state.objects.cards).filter(c => c.controllerId === actor && c.zone.playerId === actor && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && effectiveCardTypes(state, c.id, context).includes("UNIT")).map(c => c.id).sort();
}
/** "Each friendly face-up Legend": Legends-area and field Legends alike, counted whenever the fight is calculated. */
export function friendlyFaceUpLegends(state: GameState, actor: PlayerId, context: EngineContext) {
    return [...state.players[actor].zones.LEGENDS, ...state.players[actor].zones.BATTLEFIELD].filter(id => { const c = state.objects.cards[id]; return c.controllerId === actor && c.face === "UP" && cardRevision(state, id, context)?.type === "LEGEND"; }).length;
}
/** 11.4.2.1: "while fighting" power, applied before the fight's power comparison; the opposing Unit is always a rival's. Batch V88: a
 * pinned field Unit's "+2 power while fighting a Legend" also counts when the opposing card is a Legend (one on the field). */
export function whileFightingBonus(state: GameState, id: CardInstanceId, opposingId: CardInstanceId, context: EngineContext) {
    const grants = (state.fightPowerGrants ?? []).filter(x => x.targetId === id), c = state.objects.cards[id], r = cardRevision(state, id, context);
    const legend = Boolean(c && r && c.face === "UP" && c.zone.zone === "BATTLEFIELD" && cardRevision(state, opposingId, context)?.type === "LEGEND" && supportsGigChangeTriggerCard(r, context).ok);
    return grants.reduce((n, x) => n + x.amount * friendlyFaceUpLegends(state, x.controllerId, context), 0)
        + (legend ? r!.mechanics.modifiers.reduce((n, x) => n + (x.kind === "POWER_WHILE_FIGHTING_LEGEND" ? x.amount : 0), 0) : 0);
}
function compare(a: FightPowerGrant, b: FightPowerGrant) { return a.origin.effectId < b.origin.effectId ? -1 : a.origin.effectId > b.origin.effectId ? 1 : 0; }
export function applyFightPowerGrant(m: TurnMutation, targetId: CardInstanceId, forced: boolean) {
    const s = m.state, current = s.resolution.current, effect = current?.effect;
    if (!current?.sourceId || effect?.kind !== "FIGHT_POWER_PER_FRIENDLY_LEGEND_THIS_TURN" || !friendlyFieldUnits(s, current.controllerId, m.context).includes(targetId))
        return failure("INVALID_FIGHT_POWER", "Choose a current friendly field Unit for the reviewed Program");
    if (s.fightPowerGrants?.some(x => x.origin.effectId === current.id)) return failure("DUPLICATE_FIGHT_POWER", "A resolved occurrence cannot be applied twice");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    (s.fightPowerGrants ??= []).push({ kind: "FIGHT_POWER_GRANT", targetId, sourceId: current.sourceId, controllerId: current.controllerId, amount: effect.amount, createdTurn: s.timing.turn, origin: { effectId: current.id } });
    s.fightPowerGrants.sort(compare);
    return success(null);
}
export function expireFightPowerGrants(m: TurnMutation) { delete m.state.fightPowerGrants; }
export function expireFightPowerGrantsOnDeparture(m: TurnMutation, targetId: CardInstanceId) {
    if (!m.state.fightPowerGrants) return;
    m.state.fightPowerGrants = m.state.fightPowerGrants.filter(x => x.targetId !== targetId);
    if (!m.state.fightPowerGrants.length) delete m.state.fightPowerGrants;
}
export function validateFightPowerGrants(state: GameState, context: EngineContext) {
    const all = state.fightPowerGrants;
    if (!all) return success(null);
    if (new Set(all.map(x => x.origin.effectId)).size !== all.length || canonicalSerialize(all) !== canonicalSerialize([...all].sort(compare))) return failure("INVALID_FIGHT_POWER", "Unique, ordered grant occurrences required");
    for (const x of all) {
        const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context);
        if (!source || !target || x.createdTurn !== state.timing.turn || !supportsFightPowerProgram(r, context).ok || source.ownerId !== x.controllerId || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone)
            || !isUnitSpendSubject(state, x.targetId, context) || target.controllerId !== x.controllerId)
            return failure("INVALID_FIGHT_POWER", "A grant needs its reviewed played Program, the current turn and a friendly field Unit target");
    }
    return success(null);
}
