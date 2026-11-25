import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { testCondition } from "./conditions";
import { friendlyFieldUnits } from "./fight-power-grant";
import { compareTemporaryPower } from "./temporary-power";
import { rivalOf } from "./rival-reveal";

type UnitGrantPower = Extract<TemporaryPowerModifier, { scaled: "PROGRAM_UNIT_GRANT" }>;
/** Batch V79+: Programs that give a friendly Unit a ready-Unit attack and power, each pinned whole. Anything not listed is absent. */
const UNIT_GRANT_SHAPES = [
    // Batch V79: Gunpoint Diplomacy. "Give a friendly Unit these effects. If you have less Street Cred than a Rival, they instead choose
    // one effect for you. The next time this Unit attacks this turn, it may attack ready Units. // Give this Unit +3 power this turn."
    { colors: ["RED"], ram: { RED: 3 }, tags: ["Ganger", "Plan"], cost: 4, effects: [{ kind: "FRIENDLY_UNIT_READY_ATTACK_AND_POWER", power: 3, rivalChoosesOneIf: "STREET_CRED_LESS_THAN_RIVAL" }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
export const READY_ATTACK_MODE = "READY_ATTACK", POWER_MODE = "POWER";
/** The Unit grant routes here first, so no other gate can admit what it does not read. */
export function hasUnitGrantEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "FRIENDLY_UNIT_READY_ATTACK_AND_POWER")));
}
export function supportsUnitGrantProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "combatTriggers") || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !UNIT_GRANT_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_UNIT_GRANT", "Complete reviewed printed Program with an exact friendly-Unit grant required");
    return success(null);
}
function unitGrantEnabled(context: EngineContext) {
    return context.content.cards.some(r => hasUnitGrantEffect(r) && supportsUnitGrantProgram(r, context).ok);
}
/** "If you have less Street Cred than a Rival", read as the effect resolves. */
export function rivalChoosesGrant(state: GameState, controller: PlayerId, context: EngineContext) {
    return testCondition(state, controller, { kind: "STREET_CRED_LESS_THAN_RIVAL" }, context);
}
/** Whether this Unit's attack (pending or declared) may target ready rival Units. */
export function readyUnitAttack(state: GameState, id: CardInstanceId) {
    const grant = state.turnHistory?.readyUnitAttackGrants?.find(g => g.unitId === id), c = state.timing.combat;
    return Boolean(grant && (!grant.inAttack || c.stage !== "NONE" && c.attackerId === id));
}
/** Called exactly after ATTACK_DECLARED: this is the "next time this Unit attacks"; the grant lasts until that attack ends. */
export function markReadyUnitAttackInUse(m: TurnMutation, attackerId: CardInstanceId) {
    const grant = m.state.turnHistory?.readyUnitAttackGrants?.find(g => g.unitId === attackerId);
    if (grant) grant.inAttack = true;
}
function dropGrants(m: TurnMutation, keep: (g: { unitId: CardInstanceId; inAttack: boolean }) => boolean) {
    const h = m.state.turnHistory, grants = h?.readyUnitAttackGrants?.filter(keep);
    if (!h?.readyUnitAttackGrants) return;
    if (grants!.length) h.readyUnitAttackGrants = grants; else delete h.readyUnitAttackGrants;
}
/** Called as an attack ends, however it ends. */
export function endReadyUnitAttack(m: TurnMutation) { dropGrants(m, g => !g.inAttack); }
/** A Unit that leaves the field is a new object (2.4); its grant does not follow it. */
export function expireReadyUnitAttackOnDeparture(m: TurnMutation, id: CardInstanceId) { dropGrants(m, g => g.unitId !== id); }

/** Chooses the friendly Unit: with none nothing happens, a lone Unit is chosen without a choice, otherwise the controller chooses. */
export function resolveUnitGrant(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, current = s.resolution.current!, units = friendlyFieldUnits(s, current.controllerId, m.context);
    if (current.effect.kind !== "FRIENDLY_UNIT_READY_ATTACK_AND_POWER" || s.resolution.playContinuation?.kind !== "PLAY") return failure("INVALID_UNIT_GRANT", "A Unit grant resolves only from its played Program");
    if (!units.length) return success(null);
    if (units.length === 1) return selectGrantUnit(m, units[0], true, offer);
    return offer(m);
}
/** The chosen Unit gets both effects, or, with less Street Cred than a Rival, the Rival chooses one (and the choice pauses). */
export function selectGrantUnit(m: TurnMutation, targetId: CardInstanceId, forced: boolean, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.playContinuation!, controller = current.controllerId;
    if (current.effect.kind !== "FRIENDLY_UNIT_READY_ATTACK_AND_POWER" || c.grantTargetId || !friendlyFieldUnits(s, controller, m.context).includes(targetId)) return failure("INVALID_GRANT_TARGET", "Choose a current friendly field Unit");
    s.resolution.choice = null;
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId, controllerId: controller, forced });
    if (rivalChoosesGrant(s, controller, m.context)) {
        c.grantTargetId = targetId;
        s.timing.actingPlayer = rivalOf(s, controller);
        return offer(m);
    }
    const granted = grantReadyAttack(m, targetId);
    return granted.ok ? grantPower(m, targetId) : granted;
}
/** The Rival's choice of one effect for the held Unit. */
export function chooseGrantMode(m: TurnMutation, mode: string): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.playContinuation!, targetId = c.grantTargetId, rival = rivalOf(s, current.controllerId);
    if (current.effect.kind !== "FRIENDLY_UNIT_READY_ATTACK_AND_POWER" || !targetId || s.timing.actingPlayer !== rival || (mode !== READY_ATTACK_MODE && mode !== POWER_MODE)) return failure("INVALID_GRANT_MODE", "Choose one effect for the Unit");
    s.resolution.choice = null;
    delete c.grantTargetId;
    s.timing.actingPlayer = current.controllerId;
    m.emit({ kind: "EFFECT_MODE_CHOSEN", sourceId: current.sourceId!, playerId: rival, effectIndex: mode === READY_ATTACK_MODE ? 0 : 1 });
    if (mode === READY_ATTACK_MODE) return grantReadyAttack(m, targetId);
    return grantPower(m, targetId);
}
function grantReadyAttack(m: TurnMutation, targetId: CardInstanceId): Result<null> {
    const h = m.state.turnHistory, current = m.state.resolution.current!;
    if (!h) return failure("UNSUPPORTED_READY_ATTACK_GRANT", "A ready-Unit attack grant needs turn history");
    const grants = (h.readyUnitAttackGrants ?? []).filter(g => g.unitId !== targetId);
    h.readyUnitAttackGrants = [...grants, { unitId: targetId, inAttack: false }].sort((a, b) => a.unitId < b.unitId ? -1 : 1);
    m.emit({ kind: "READY_UNIT_ATTACK_GRANTED", effectId: current.id, targetId });
    return success(null);
}
function grantPower(m: TurnMutation, targetId: CardInstanceId): Result<null> {
    const s = m.state, current = s.resolution.current!;
    if (current.effect.kind !== "FRIENDLY_UNIT_READY_ATTACK_AND_POWER") return failure("INVALID_UNIT_GRANT", "Current Unit grant required");
    const modifier: UnitGrantPower = { kind: "POWER", sourceId: current.sourceId!, targetId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, amount: current.effect.power, scaled: "PROGRAM_UNIT_GRANT", origin: { effectId: current.id } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
/** Exact pause: the controller's strategic Unit choice, or the Rival's effect choice for a held current friendly Unit. */
export function validateUnitGrantPause(state: GameState, controller: PlayerId, context: EngineContext) {
    const c = state.resolution.playContinuation!, units = friendlyFieldUnits(state, controller, context);
    const ok = state.timing.step === "TARGET_SELECTION" && (c.grantTargetId
        ? units.includes(c.grantTargetId) && rivalChoosesGrant(state, controller, context) && state.timing.actingPlayer === rivalOf(state, controller)
        : units.length >= 2 && state.timing.actingPlayer === controller);
    return ok ? success(null) : failure("INVALID_UNIT_GRANT", "A Unit grant pauses only for a strategic friendly-Unit choice or the Rival's effect choice for the held Unit");
}
/** Current-turn grants on distinct face-up field Units of the active player, sorted; `inAttack` only for the current attacker. */
export function validateReadyUnitAttackGrants(state: GameState, context: EngineContext) {
    const h = state.turnHistory, grants = h?.readyUnitAttackGrants;
    if (!grants) return success(null);
    const ids = grants.map(g => g.unitId), combat = state.timing.combat;
    if (!unitGrantEnabled(context) || state.setup || h!.turn !== state.timing.turn || new Set(ids).size !== ids.length || ids.some((id, i) => i > 0 && ids[i - 1] >= id)
        || grants.some(g => { const card = state.objects.cards[g.unitId]; return !card || card.face !== "UP" || card.zone.zone !== "BATTLEFIELD" || card.controllerId !== state.timing.activePlayer || card.zone.playerId !== card.controllerId || !effectiveCardTypes(state, g.unitId, context).includes("UNIT") || g.inAttack && (combat.stage === "NONE" || combat.attackerId !== g.unitId); }))
        return failure("INVALID_READY_ATTACK_GRANT", "Ready-Unit attack grants need their reviewed Program, the current turn and distinct sorted friendly field Units");
    return success(null);
}
/** The +3 on a friendly public Unit from the pinned Program, this turn. */
export function validateUnitGrantPower(state: GameState, x: UnitGrantPower, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId];
    if (!source || !target || !supportsUnitGrantProgram(cardRevision(state, x.sourceId, context), context).ok || !["TRASH", "RESOLVING_PROGRAM"].includes(source.zone.zone) || source.face !== "UP"
        || x.expires.turn !== state.timing.turn || target.controllerId !== source.controllerId || !publicUnit(x.targetId))
        return failure("INVALID_TEMPORARY_POWER", "A Unit grant's power needs its reviewed played Program, a friendly public Unit and the current turn");
    return success(null);
}
