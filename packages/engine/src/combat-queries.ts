import { laggingGigAreaAttack, readyBlockerAttack } from "./attack-permission-support";
import { readyUnitAttack } from "./ready-attack-grant";
import { hasRivalUnitAttackGrant } from "./arasaka-defeat";
import { canonicalSerialize, type AttackTarget, type CardInstanceId, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { currentCombatRestrictions, getAttackRestrictions } from "./combat-permissions";
import { combatEnabled } from "./attack-support";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { supportsPlay } from "./play-support";
import { adrenalineEnabled } from "./restriction-support";
import { effectiveKeywords } from "./capabilities";
import { laggingUnitAttackOnly } from "./value-pair-support";
export function isUnitForGameplay(state: GameState, id: CardInstanceId, context: EngineContext) { return effectiveCardTypes(state, id, context).includes("UNIT"); }
/** 11.23.2: Units with [ADRENALINE] may attack while lagging; Lag itself and every other attack criterion still apply. */
export function laggingAttackPermitted(state: GameState, id: CardInstanceId, context: EngineContext) { return adrenalineEnabled(context) && effectiveKeywords(state, id, context).includes("ADRENALINE"); }
export function attackSourceValid(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return Boolean(combatEnabled(context) && c && c.controllerId === actor && c.zone.playerId === actor && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && isUnitForGameplay(state, id, context) && supportsPlay(cardRevision(state, id, context), context).ok && (!c.statuses.includes("LAG") || c.statuses.includes("GO_SOLO") || laggingAttackPermitted(state, id, context) || laggingUnitAttackOnly(cardRevision(state, id, context), context) || hasRivalUnitAttackGrant(state, id) || laggingGigAreaAttack(state, id, context)) && !getAttackRestrictions(state, id, context).length);
}
/** 9.3.2: target the nonempty area, never a die to steal. No readiness requirement on the attacker here. */
export function listAttackTargets(state: GameState, attackerId: CardInstanceId, actor: PlayerId, context: EngineContext): AttackTarget[] {
    const source = state.objects.cards[attackerId];
    if (!combatEnabled(context) || !source || source.controllerId !== actor || source.zone.zone !== "BATTLEFIELD" || !isUnitForGameplay(state, attackerId, context)) return [];
    const rival = state.match.playerOrder.find(id => id !== actor);
    if (!rival) return [];
    // Batch V64: a lag-limited Unit attacks rival Units only with a rival-Unit permission, and the Gig area only with a Gig-area one.
    const lagLimited = source.statuses.includes("LAG") && !source.statuses.includes("GO_SOLO") && !laggingAttackPermitted(state, attackerId, context);
    const unitGrant = laggingUnitAttackOnly(cardRevision(state, attackerId, context), context) || hasRivalUnitAttackGrant(state, attackerId), gigGrant = laggingGigAreaAttack(state, attackerId, context);
    const readyBlockers = readyBlockerAttack(state, attackerId, context), readyUnits = readyUnitAttack(state, attackerId); // Batch V65, V79.
    const cards: AttackTarget[] = lagLimited && !unitGrant && gigGrant ? [] : Object.values(state.objects.cards).filter(c => c.controllerId === rival && c.zone.playerId === rival && c.zone.zone === "BATTLEFIELD" && c.face === "UP" && (c.readiness === "SPENT" || readyUnits || readyBlockers && effectiveKeywords(state, c.id, context).includes("BLOCKER")) && isUnitForGameplay(state, c.id, context)).map(c => ({ kind: "CARD", cardInstanceId: c.id }));
    // 9.3.2.3: a printed restriction removes the Gig area from this Unit's valid targets; rival Units remain valid.
    // Batch V30: attacking only because "it can attack rival Units the turn it's played" keeps the Gig area closed.
    const unitsOnly = lagLimited && unitGrant && !gigGrant; // Batch V50: a free play's grant too.
    if (!unitsOnly && !currentCombatRestrictions(state, attackerId, context).some(x => x.kind === "CANNOT_ATTACK_GIG_AREA") && Object.values(state.objects.gigs).some(g => g.controllerId === rival && g.location.playerId === rival && g.location.zone === "GIGS" && g.roll.kind === "ROLLED")) cards.push({ kind: "GIG_AREA", playerId: rival });
    return cards.sort((a, b) => canonicalSerialize(a) < canonicalSerialize(b) ? -1 : 1);
}
export function isAttackEligible(state: GameState, actor: PlayerId, id: CardInstanceId, context: EngineContext) {
    return !state.setup && !state.match.outcome && state.timing.activePlayer === actor && state.timing.actingPlayer === actor && state.timing.window === "MAIN" && state.resolution.stage === "DECISION" && state.timing.combat.stage === "NONE" && attackSourceValid(state, actor, id, context) && state.objects.cards[id].readiness === "READY" && listAttackTargets(state, id, actor, context).length > 0;
}
