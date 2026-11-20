import { hashCanonical, type DefeatGearTarget, type DefeatTarget, type GameState, type PendingChoice, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectiveCardTypes, effectivePower } from "./characteristics";
import { referencedPower } from "./combat-resolution-policy";
import { defeatSupport, gearDefeatSupport } from "./defeat";
import { targetedGearDefeatPolicyComplete } from "./targeted-gear-defeat-support";
import { targetedDefeatEnabled } from "./targeted-defeat-support";
import { testCondition } from "./conditions";
import { referencedCost } from "./cost-value";
/** Friendly means current control, and Fixer dice have no usable friendly value. */
export function controlledGigValuesByDieType(state: GameState, actor: PlayerId, dieType: "D20") {
    return Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.dieType === dieType).flatMap(g => g.roll.kind === "ROLLED" ? [g.roll.currentValue] : []);
}
/** Batch V16 "less power than a friendly Unit": strictly below the highest current power among the actor's face-up
 * field Units (field Legends included); no friendly Unit means no bound and so no target. */
function strongestFriendlyBound(state: GameState, actor: PlayerId, context: EngineContext) {
    const powers = state.players[actor].zones.BATTLEFIELD.filter(id => { const c = state.objects.cards[id]; return c.controllerId === actor && c.face === "UP" && effectiveCardTypes(state, id, context).includes("UNIT"); })
        .flatMap(id => { const p = effectivePower(state, id, context); return p === null ? [] : [referencedPower(p)]; });
    return powers.length ? [Math.max(...powers) - 1] : [];
}
/** Uses the same characteristics as RulesView, without recursively validating a pending state. */
/** 3.17.3.2/3.17.3.3: a Gear's own power, never its host's. Both active areas are eligible (4.10.2). */
function listDefeatableGear(state: GameState, actor: PlayerId, target: DefeatGearTarget, context: EngineContext) {
    if (!targetedGearDefeatPolicyComplete(context)) return [];
    return Object.values(state.objects.cards).filter(c => {
        if (target.relation === "RIVAL" && c.controllerId === actor || c.face !== "UP" || !["BATTLEFIELD", "LEGENDS"].includes(c.zone.zone)) return false;
        if (!gearDefeatSupport(state, c.id, context).ok) return false;
        if (!target.power) return true; // Batch V34: "a Gear", any power.
        const power = effectivePower(state, c.id, context);
        return power !== null && referencedPower(power) <= target.power.value;
    }).map(c => c.id).sort();
}
/** The single typed dispatcher used by choice construction, resolution and continuation revalidation. */
export function listDefeatTargets(state: GameState, actor: PlayerId, target: DefeatTarget, context: EngineContext) {
    return target.kind === "GEAR" ? listDefeatableGear(state, actor, target, context) : listDefeatableUnits(state, actor, target, context);
}
export function listDefeatableUnits(state: GameState, actor: PlayerId, target: DefeatTarget, context: EngineContext) {
    // Unit-only by construction; Gear targets are dispatched to listDefeatableGear.
    if (target.kind !== "UNITS" || !targetedDefeatEnabled(context)) return [];
    // "Instead" bounds are queried against the current state at every listing (choice, resolution, revalidation).
    const atMost = target.power.kind === "AT_MOST" ? (target.instead && testCondition(state, actor, target.instead.condition, context) ? target.instead.power.value : target.power.value) : null;
    const values = target.power.kind === "ANY" ? [Infinity] : atMost !== null ? [atMost] : target.power.kind === "CONTROLLED_GIG_VALUE" ? controlledGigValuesByDieType(state, actor, target.power.dieType) : target.power.kind === "LESS_THAN_FRIENDLY_UNIT" ? strongestFriendlyBound(state, actor, context) : [];
    if (!values.length) return []; // Absence is not a zero-valued D20.
    return Object.values(state.objects.cards).filter(c => {
        if (target.relation === "RIVAL" && c.controllerId === actor || target.relation === "CONTROLLED" && c.controllerId !== actor || !defeatSupport(state, c.id, context).ok) return false;
        if (target.readiness && c.readiness !== target.readiness) return false;
        if (target.cost) { const cost = referencedCost(state, c.id, context); if (cost === null || cost > target.cost.value) return false; }
        const power = effectivePower(state, c.id, context);
        return power !== null && values.some(value => referencedPower(power) <= value);
    }).map(c => c.id).sort();
}
/** "Defeat all other Units": the whole current eligible set minus the effect source, sorted; no target choice. */
export function allOtherDefeatTargets(state: GameState, e: NonNullable<GameState["resolution"]["current"]>, context: EngineContext) {
    if (e.effect.kind !== "DEFEAT_UNIT" || e.effect.target.kind !== "UNITS" || e.effect.target.all !== "OTHER_THAN_SOURCE") return null;
    return listDefeatTargets(state, e.controllerId, e.effect.target, context).filter(id => id !== e.sourceId);
}
/** Batch V12 Bonnie and Clyde: some Rival controls at least `minimum` more Gigs (in the Gig area) than `actor`. */
export function rivalGigCountLead(state: GameState, actor: PlayerId, minimum: number) {
    const count = (id: PlayerId) => Object.values(state.objects.gigs).filter(g => g.controllerId === id && g.location.zone === "GIGS").length;
    return state.match.playerOrder.some(id => id !== actor && count(id) - count(actor) >= minimum);
}
type Current = NonNullable<GameState["resolution"]["current"]>;
/** The optional second target: remaining eligible Units after the first pick, while the condition holds now. */
export function secondDefeatTargets(state: GameState, e: Current, firstId: string, context: EngineContext) {
    if (e.effect.kind !== "DEFEAT_UNIT" || e.effect.target.kind !== "UNITS" || !e.effect.target.second || !rivalGigCountLead(state, e.controllerId, e.effect.target.second.condition.minimum)) return [];
    return listDefeatTargets(state, e.controllerId, e.effect.target, context).filter(id => id !== firstId);
}
export function secondDefeatChoice(state: GameState, context: EngineContext, firstId: string): PendingChoice {
    const e = state.resolution.current!;
    return { id: hashCanonical({ protocol: "targeted-defeat-second@1", turn: state.timing.turn, sourceId: e.sourceId, effectId: e.id, firstId }), actorId: e.controllerId, kind: "TARGET", min: 1, max: 1, ordered: false, continuationId: "targeted-defeat-second@1",
        options: [...secondDefeatTargets(state, e, firstId, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId })), { kind: "CONFIRM" as const, confirmed: false }] };
}
/** "Each player defeats one of their Units": players in turn order from the effect controller. */
export function eachDefeatPlayers(state: GameState, e: Current) {
    const order = state.match.playerOrder, start = order.indexOf(e.controllerId);
    return [...order.slice(start), ...order.slice(0, start)];
}
export function ownDefeatTargets(state: GameState, player: PlayerId, e: Current, context: EngineContext) {
    if (e.effect.kind !== "DEFEAT_UNIT" || e.effect.target.kind !== "UNITS" || e.effect.target.each !== "PLAYER_CHOOSES_OWN") return [];
    return listDefeatTargets(state, player, e.effect.target, context);
}
export function eachDefeatChoice(state: GameState, context: EngineContext, player: PlayerId): PendingChoice {
    const e = state.resolution.current!;
    return { id: hashCanonical({ protocol: "targeted-defeat-each@1", turn: state.timing.turn, sourceId: e.sourceId, effectId: e.id, player }), actorId: player, kind: "TARGET", min: 1, max: 1, ordered: false, continuationId: "targeted-defeat-each@1",
        options: ownDefeatTargets(state, player, e, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId })) };
}
export function targetedDefeatChoice(state: GameState, context: EngineContext): PendingChoice {
    const e = state.resolution.current!;
    if (e.effect.kind !== "DEFEAT_UNIT") throw new Error("Expected a targeted defeat effect");
    const targets = listDefeatTargets(state, e.controllerId, e.effect.target, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }));
    // Batch V34: an optional defeat with a target also offers the decline.
    return { id: hashCanonical({ protocol: "targeted-defeat@1", turn: state.timing.turn, sourceId: e.sourceId, effectId: e.id }), actorId: e.controllerId, kind: "TARGET", min: 1, max: 1, ordered: false, continuationId: "targeted-defeat@1", options: e.effect.optional && targets.length ? [...targets, { kind: "CONFIRM", confirmed: false }] : targets };
}
