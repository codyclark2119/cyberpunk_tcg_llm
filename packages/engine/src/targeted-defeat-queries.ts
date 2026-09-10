import { hashCanonical, type DefeatUnitTarget, type GameState, type PendingChoice, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { effectivePower } from "./characteristics";
import { referencedPower } from "./combat-resolution-policy";
import { defeatSupport } from "./defeat";
import { targetedDefeatEnabled } from "./targeted-defeat-support";
/** Friendly means current control, and Fixer dice have no usable friendly value. */
export function controlledGigValuesByDieType(state: GameState, actor: PlayerId, dieType: "D20") {
    return Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.dieType === dieType).flatMap(g => g.roll.kind === "ROLLED" ? [g.roll.currentValue] : []);
}
/** Uses the same characteristics as RulesView, without recursively validating a pending state. */
export function listDefeatableUnits(state: GameState, actor: PlayerId, target: DefeatUnitTarget, context: EngineContext) {
    if (!targetedDefeatEnabled(context)) return [];
    const values = target.power.kind === "AT_MOST" ? [target.power.value] : controlledGigValuesByDieType(state, actor, target.power.dieType);
    if (!values.length) return []; // Absence is not a zero-valued D20.
    return Object.values(state.objects.cards).filter(c => {
        if (target.relation === "RIVAL" && c.controllerId === actor || target.relation === "CONTROLLED" && c.controllerId !== actor || !defeatSupport(state, c.id, context).ok) return false;
        const power = effectivePower(state, c.id, context);
        return power !== null && values.some(value => referencedPower(power) <= value);
    }).map(c => c.id).sort();
}
export function targetedDefeatChoice(state: GameState, context: EngineContext): PendingChoice {
    const e = state.resolution.current!;
    if (e.effect.kind !== "DEFEAT_UNIT") throw new Error("Expected a targeted defeat effect");
    return { id: hashCanonical({ protocol: "targeted-defeat@1", turn: state.timing.turn, sourceId: e.sourceId, effectId: e.id }), actorId: e.controllerId, kind: "TARGET", min: 1, max: 1, ordered: false, continuationId: "targeted-defeat@1", options: listDefeatableUnits(state, e.controllerId, e.effect.target, context).map(cardInstanceId => ({ kind: "CARD", cardInstanceId })) };
}
