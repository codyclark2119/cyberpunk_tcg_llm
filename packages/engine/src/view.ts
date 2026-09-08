import { paymentSources, paymentValue, paymentCandidates } from "./payment";
import { type GameState, type PlayerId, type CardInstanceId, type GigInstanceId, type Condition, type TargetSelector, type PaymentSource, type Cost, canonicalSerialize, failure, success } from "@tcg/domain";
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
    getPlayer(id: PlayerId) { return this.state.players[id]; }
    getCard(id: CardInstanceId) { return this.state.objects.cards[id]; }
    getGig(id: GigInstanceId) { return this.state.objects.gigs[id]; }
    getRevision(id: CardInstanceId) { const c = this.getCard(id); return this.context.content.cards.find(p => p.id === c?.cardId && p.revision === c.revision); }
    getZone(id: PlayerId, zone: keyof GameState["players"][PlayerId]["zones"]) { return this.getPlayer(id).zones[zone]; }
    getControlledGigs(id: PlayerId) { return Object.values(this.state.objects.gigs).filter(g => g.controllerId === id && g.location.zone === "GIGS").sort((a, b) => a.id < b.id ? -1 : 1); }
    getStreetCred(id: PlayerId) { return this.getControlledGigs(id).reduce((n, g) => n + (g.roll.kind === "ROLLED" ? g.roll.currentValue : 0), 0); }
    testCondition(id: PlayerId, condition: Condition): boolean {
        const gigs = this.getControlledGigs(id), values = gigs.flatMap(g => g.roll.kind === "ROLLED" ? [g.roll.currentValue] : []);
        switch (condition.kind) {
            case "GIG_COUNT": return gigs.length >= condition.minimum;
            case "DISTINCT_GIG_DIE_TYPES": return new Set(gigs.map(g => g.dieType)).size >= condition.minimum;
            case "DISTINCT_GIG_VALUES": return new Set(values).size >= condition.minimum;
            case "STREET_CRED": return this.getStreetCred(id) >= condition.minimum;
            case "GIG_VALUE": return values.includes(condition.value);
        }
    }
    getEffectiveCardTypes(id: CardInstanceId) { const c = this.getCard(id), p = this.getRevision(id); return p ? [...new Set([p.type, ...(p.type === "LEGEND" && p.mechanics.keywords.includes("GO_SOLO") && c.statuses.includes("GO_SOLO") ? ["UNIT" as const] : [])])] : []; }
    getEffectivePower(id: CardInstanceId) {
        if (this.context.content.cards.some(c => c.mechanics.modifiers.length))
            throw new Error("UNSUPPORTED_CONTINUOUS_MODIFIERS");
        return this.getRevision(id)?.power ?? null;
    }
    getKeywords(id: CardInstanceId) {
        if (this.context.content.cards.some(c => c.mechanics.modifiers.length))
            throw new Error("UNSUPPORTED_CONTINUOUS_MODIFIERS");
        return this.getRevision(id)?.mechanics.keywords ?? [];
    }
    getLegalTargets(source: CardInstanceId, target: TargetSelector) {
        const controller = this.getCard(source)?.controllerId;
        if (!controller)
            return [];
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
        const available = this.listPaymentSources(actor).map(canonicalSerialize);
        if (new Set(sources.map(s => s.cardInstanceId)).size !== sources.length || sources.some(s => !available.includes(canonicalSerialize(s))))
            return failure("INVALID_PAYMENT", "Payment sources must be distinct eligible instances");
        // Exact payment only; overpayment/refund semantics have not been approved.
        if (cost.kind === "DASH" || sources.reduce((n, s) => n + this.getPaymentValue(s), 0) !== (cost.kind === "EDDIES" ? cost.amount : 0))
            return failure("UNSUPPORTED_PAYMENT", "Exact payment required; dash is not zero");
        return success(sources);
    }
    faceDownLegends(actor: PlayerId) { return this.getZone(actor, "LEGENDS").map(id => this.getCard(id)).filter(c => c.face === "DOWN" && c.controllerId === actor); }
    callEffectSupport(id: CardInstanceId) {
        const card = this.getRevision(id);
        if (!card || card.mechanics.modifiers.length || card.mechanics.abilities.some(a => a.trigger !== "WHEN_CALLED") || card.mechanics.abilities.length > 1)
            return failure("UNSUPPORTED_CALL_EFFECT", "Only a single unconditional CALL/DRAW ability is supported");
        const ability = card.mechanics.abilities[0];
        if (ability && (ability.cost.kind !== "NONE" || ability.conditions.length || ability.effects.length !== 1 || ability.effects[0].kind !== "DRAW"))
            return failure("UNSUPPORTED_CALL_EFFECT", "Only a single unconditional CALL/DRAW ability is supported");
        return success(null);
    }
    canCallLegend(actor: PlayerId, id: CardInstanceId) {
        const policy = this.context.content.ruleset.gameplay?.turnSlice, card = this.getCard(id);
        return Boolean(policy && card && this.state.timing.window === "MAIN" && this.state.timing.actingPlayer === actor && this.state.timing.activePlayer === actor && this.state.resolution.stage === "DECISION" && card.zone.playerId === actor && card.zone.zone === "LEGENDS" && card.face === "DOWN" && card.controllerId === actor && (this.getPlayer(actor).economy.callsThisTurn ?? 0) < policy.callLimitPerTurn && (policy.callCost === 0 || this.paymentCandidates(actor, policy.callCost, []).length));
    }
    paymentCandidates(actor: PlayerId, remaining: number, selected: readonly PaymentSource[]) { return paymentCandidates(this.state, actor, this.context, remaining, selected); }
    listRollableFixerDice(actor: PlayerId) {
        const original = Object.values(this.state.objects.gigs).filter(g => g.ownerId === actor);
        const pool = original.filter(g => g.controllerId === actor && g.location.zone === "FIXER");
        return pool.filter(g => g.roll.kind === "UNROLLED" && (g.dieType !== "D20" || original.filter(x => x.dieType !== "D20").every(x => x.roll.kind === "ROLLED"))).map(g => g.id).sort();
    }
}
