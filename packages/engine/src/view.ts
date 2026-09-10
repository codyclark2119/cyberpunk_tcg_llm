import { listDefeatableUnits, controlledGigValuesByDieType } from "./targeted-defeat-queries";
import type { DefeatUnitTarget } from "@tcg/domain";
import { getDelayedEffectsForTurn } from "./delayed-effects";
import { readyableEddieSlots } from "./eddie-ready";
import { getDiscardableCards } from "./discard";
import { effectiveCapabilities, effectiveKeywords } from "./capabilities";
import { supportsCapabilityGear } from "./capability-support";
import { effectiveTriggeredAbilities } from "./trigger-queries";
import { getAttackRestrictions, canBeBlocked } from "./combat-permissions";
import { applicableFightPreventions } from "./fight-prevention";
import { getGigStealAllowance } from "./combat-resolution-policy";
import { listStealableGigs } from "./combat-outcome-queries";
import { isReactDecision } from "./react-support";
import { isBlockerEligible } from "./react-queries";
import { canPlay } from "./play-support";
import { supportsAttackingAuraLegend } from "./attacking-aura-support";
import { isAttacking, hasClassification, applicablePowerModifiers, effectiveCardTypes, effectivePower } from "./characteristics";
import { isAttackEligible, isUnitForGameplay, listAttackTargets } from "./combat-queries";
import { attachedGear, attachmentHost, gearEnabled, legalEquipHosts } from "./attachments";
import { testCondition } from "./conditions";
import { supportsCall } from "./effect-support";
import { paymentSources, paymentValue, paymentCandidates, validatePayment } from "./payment";
import { numericCost, referencedCost } from "./cost-value";
import { listSpendUnitTargets } from "./targeted-spend-queries";
import type { SpendUnitTarget } from "@tcg/domain";
import { type GameState, type PlayerId, type CardInstanceId, type GigInstanceId, type Condition, type TargetSelector, type PaymentSource, type Cost, type Keyword } from "@tcg/domain";
import { type EngineContext, validateState, freeze } from "./state";
/** Construct from a validated/frozen state. Selectors never mutate authoritative objects. */
export class RulesView {
    readonly state: GameState;
    readonly context: EngineContext;
    constructor(state: GameState, context: EngineContext) {
        const valid = validateState(state, context);
        if (!valid.ok)
            throw new Error(JSON.stringify(valid.errors));
        this.state = valid.value;
        this.context = freeze(structuredClone(context));
    }
    getDelayedEffectsForTurn() { return getDelayedEffectsForTurn(this.state); }
    getReadyableEddieSlots(id: PlayerId) { return readyableEddieSlots(this.state, id); }
    getDiscardableCards(id: PlayerId) { return getDiscardableCards(this.state, id); }
    getPlayer(id: PlayerId) { return this.state.players[id]; }
    getCard(id: CardInstanceId) { return this.state.objects.cards[id]; }
    getGig(id: GigInstanceId) { return this.state.objects.gigs[id]; }
    getRevision(id: CardInstanceId) { const c = this.getCard(id); return this.context.content.cards.find(p => p.id === c?.cardId && p.revision === c.revision); }
    getZone(id: PlayerId, zone: keyof GameState["players"][PlayerId]["zones"]) { return this.getPlayer(id).zones[zone] ?? []; }
    getControlledGigs(id: PlayerId) { return Object.values(this.state.objects.gigs).filter(g => g.controllerId === id && g.location.zone === "GIGS").sort((a, b) => a.id < b.id ? -1 : 1); }
    hasControlledGigWithCurrentValueAtLeast(id: PlayerId, minimum: number) { return this.testCondition(id, { kind: "GIG_VALUE_AT_LEAST", minimum }); }
    isStreetCredEven(id: PlayerId) { return this.testCondition(id, { kind: "STREET_CRED_IS_EVEN" }); }
    listDefeatableUnits(id: PlayerId, target: DefeatUnitTarget) { return listDefeatableUnits(this.state, id, target, this.context); }
    getNumericCost(id: CardInstanceId) { return numericCost(this.state, id, this.context); }
    getReferencedCost(id: CardInstanceId) { return referencedCost(this.state, id, this.context); }
    listSpendUnitTargets(actor: PlayerId, target: SpendUnitTarget) { return listSpendUnitTargets(this.state, actor, target, this.context); }
    getControlledD20Values(id: PlayerId) { return controlledGigValuesByDieType(this.state, id, "D20"); }
    getStreetCred(id: PlayerId) { return this.getControlledGigs(id).reduce((n, g) => n + (g.roll.kind === "ROLLED" ? g.roll.currentValue : 0), 0); }
    testCondition(id: PlayerId, condition: Condition, sourceId?: CardInstanceId): boolean {
        return testCondition(this.state, id, condition, this.context, sourceId);
    }
    isAttacking(id: CardInstanceId) { return isAttacking(this.state, id); }
    hasClassification(id: CardInstanceId, classification: string) { return hasClassification(this.state, id, classification, this.context); }
    getEffectiveCardTypes(id: CardInstanceId) { return effectiveCardTypes(this.state, id, this.context); }
    isUnitForGameplay(id: CardInstanceId) { return isUnitForGameplay(this.state, id, this.context); }
    isAttackEligible(actor: PlayerId, id: CardInstanceId) { return isAttackEligible(this.state, actor, id, this.context); }
    listAttackers(actor: PlayerId) { return Object.values(this.state.objects.cards).filter(c => this.isAttackEligible(actor, c.id)).map(c => c.id).sort(); }
    listAttackTargets(id: CardInstanceId, actor: PlayerId) { return listAttackTargets(this.state, id, actor, this.context); }
    getCombatAttacker() { const c = this.state.timing.combat; return c.stage === "NONE" ? null : this.getCard(c.attackerId); }
    isBlockerEligible(actor: PlayerId, id: CardInstanceId) { return isBlockerEligible(this.state, actor, id, this.context); }
    listBlockers(actor: PlayerId) { return Object.values(this.state.objects.cards).filter(c => this.isBlockerEligible(actor, c.id)).map(c => c.id).sort(); }
    listQuickCards(actor: PlayerId) { return Object.values(this.state.objects.cards).filter(c => this.getRevision(c.id)?.mechanics.keywords.includes("QUICK") && canPlay(this.state, actor, c.id, this.context)).map(c => c.id).sort(); }
    getGigStealAllowance(id: CardInstanceId) { const power = this.getEffectivePower(id); return power === null ? null : getGigStealAllowance(power, this.context); }
    listStealableGigs(defender: PlayerId) { return listStealableGigs(this.state, defender); }
    getControlledGigCount(id: PlayerId) { return this.getControlledGigs(id).length; }
    getFightDefender() { const target = this.getCombatTarget(); return target?.kind === "CARD" ? this.getCard(target.cardInstanceId) : null; }
    getEffectiveTriggeredAbilities(id: CardInstanceId) { return effectiveTriggeredAbilities(this.state, id, this.context); }
    getApplicableCharacteristicModifiers(id: CardInstanceId) { return applicablePowerModifiers(this.state, id, this.context); }
    getTurnEventSummary() { return this.state.turnHistory ?? null; }
    getAttackRestrictions(id: CardInstanceId) { return getAttackRestrictions(this.state, id, this.context); }
    canBeBlocked(id: CardInstanceId) { return canBeBlocked(this.state, id, this.context); }
    getApplicableFightPreventions() { return applicableFightPreventions(this.state); }
    getCombatTarget() { const c = this.state.timing.combat; return "target" in c ? c.target : null; }
    getAttachedGear(hostId: CardInstanceId) { return attachedGear(this.state, hostId, this.context); }
    getEquippedGearCount(hostId: CardInstanceId) { return this.getAttachedGear(hostId).length; }
    getAttachmentHost(gearId: CardInstanceId) { return attachmentHost(this.state, gearId); }
    getEffectivePower(id: CardInstanceId) { return effectivePower(this.state, id, this.context); }
    getEffectiveCapabilities(id: CardInstanceId) { return effectiveCapabilities(this.state, id, this.context); }
    getCapabilitySources(id: CardInstanceId, keyword: Keyword) { return this.getEffectiveCapabilities(id).find(c => c.keyword === keyword)?.sources ?? []; }
    getEffectiveKeywords(id: CardInstanceId) { return this.getKeywords(id); }
    getKeywords(id: CardInstanceId) {
        if (this.getRevision(id)?.mechanics.modifiers.some(m => m.kind !== "POWER_PER_EQUIPPED_GEAR_DURING_OWN_TURN" && !(m.kind === "FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER" && supportsAttackingAuraLegend(this.getRevision(id), this.context).ok) && !(m.kind === "GRANT_KEYWORD_TO_HOST" && supportsCapabilityGear(this.getRevision(id), this.context).ok) && !(gearEnabled(this.context) && m.kind === "GRANT_PRINTED_POWER_TO_HOST" && this.getRevision(id)?.type === "GEAR"))) throw new Error("UNSUPPORTED_CONTINUOUS_MODIFIERS");
        return effectiveKeywords(this.state, id, this.context);
    }
    getLegalTargets(source: CardInstanceId, target: TargetSelector) {
        const controller = this.getCard(source)?.controllerId;
        if (!controller)
            return [];
        if (target.kind === "FRIENDLY_UNIT_OR_FACE_UP_LEGEND") return legalEquipHosts(this.state, source, this.context);
        if (target.kind === "SELF")
            return [source];
        const relation = (id: PlayerId) => target.relation === "ANY" || (target.relation === "CONTROLLED" ? id === controller : id !== controller);
        if (target.kind === "GIGS")
            return Object.values(this.state.objects.gigs).filter(g => g.location.zone === "GIGS" && relation(g.controllerId)).map(g => g.id).sort();
        return Object.values(this.state.objects.cards).filter(c => c.zone.zone === target.zone && relation(c.controllerId) && (!target.keyword || this.getKeywords(c.id).includes(target.keyword))).map(c => c.id).sort();
    }
    canSellCard(actor: PlayerId, id: CardInstanceId) {
        const c = this.getCard(id), p = this.getPlayer(actor), rules = this.context.content.ruleset.gameplay;
        return Boolean(c && p && rules && this.state.resolution.stage === "DECISION" && this.state.timing.window === "MAIN" && this.state.timing.combat.stage === "NONE" && this.state.timing.activePlayer === actor && this.state.timing.actingPlayer === actor && c.controllerId === actor && c.zone.playerId === actor && c.zone.zone === "HAND" && this.getRevision(id)?.type !== "LEGEND" && this.getRevision(id)?.sellProfile.allowed && !c.statuses.includes("CANNOT_SELL") && !p.statuses.includes("CANNOT_SELL") && p.economy.sellsThisTurn < rules.sellLimitPerTurn);
    }
    getReadyEddies(actor: PlayerId) { return Object.values(this.state.objects.cards).filter(c => c.zone.zone === "EDDIES" && c.controllerId === actor && c.readiness === "READY").sort((a, b) => a.id < b.id ? -1 : 1); }
    listPaymentSources(actor: PlayerId) { return paymentSources(this.state, actor, this.context); }
    getPaymentValue(source: PaymentSource) { return paymentValue(this.state, this.context, source); }
    getAvailablePaymentValue(actor: PlayerId) { return this.listPaymentSources(actor).reduce((n, s) => n + this.getPaymentValue(s), 0); }
    canPayCost(actor: PlayerId, cost: Cost) { return cost.kind === "NONE" || (cost.kind === "EDDIES" && this.getAvailablePaymentValue(actor) >= cost.amount); }
    validatePaymentChoice(actor: PlayerId, sources: PaymentSource[], cost: Cost) {
        return validatePayment(this.state, actor, this.context, sources, cost);
    }
    faceDownLegends(actor: PlayerId) { return this.getZone(actor, "LEGENDS").map(id => this.getCard(id)).filter(c => c.face === "DOWN" && c.controllerId === actor); }
    callEffectSupport(id: CardInstanceId) {
        return supportsCall(this.getRevision(id), this.context);
    }
    canCallLegend(actor: PlayerId, id: CardInstanceId) {
        const policy = this.context.content.ruleset.gameplay?.turnSlice, card = this.getCard(id);
        return Boolean(policy && card && ((this.state.timing.window === "MAIN" && this.state.timing.combat.stage === "NONE" && this.state.timing.actingPlayer === actor && this.state.timing.activePlayer === actor) || isReactDecision(this.state, actor, this.context)) && this.state.resolution.stage === "DECISION" && card.zone.playerId === actor && card.zone.zone === "LEGENDS" && card.face === "DOWN" && card.controllerId === actor && (this.getPlayer(actor).economy.callsThisTurn ?? 0) < policy.callLimitPerTurn && (policy.callCost === 0 || this.paymentCandidates(actor, policy.callCost, []).length));
    }
    paymentCandidates(actor: PlayerId, remaining: number, selected: readonly PaymentSource[]) { return paymentCandidates(this.state, actor, this.context, remaining, selected); }
    listRollableFixerDice(actor: PlayerId) {
        const original = Object.values(this.state.objects.gigs).filter(g => g.ownerId === actor);
        const pool = original.filter(g => g.controllerId === actor && g.location.zone === "FIXER");
        return pool.filter(g => g.roll.kind === "UNROLLED" && (g.dieType !== "D20" || original.filter(x => x.dieType !== "D20").every(x => x.roll.kind === "ROLLED"))).map(g => g.id).sort();
    }
}
