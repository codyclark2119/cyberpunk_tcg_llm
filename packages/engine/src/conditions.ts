import { combatResolutionEnabled, referencedPower } from "./combat-resolution-policy";
import { effectivePower, effectiveCardTypes } from "./characteristics";
import type { EngineContext } from "./state";
import type { Condition, GameState, PlayerId, CardInstanceId } from "@tcg/domain";
/** Queries the supplied state now; caller explicitly owns condition timing. */
export function testCondition(state: GameState, actor: PlayerId, condition: Condition, context?: EngineContext, sourceId?: CardInstanceId | null, lastValidTypes?: readonly ["LEGEND", "UNIT"]): boolean {
    const gigs = Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED");
    const values = gigs.flatMap(g => g.roll.kind === "ROLLED" ? [g.roll.currentValue] : []);
    switch (condition.kind) {
        case "SUBJECT_IS_UNIT_NAMED": {
            const c = sourceId && state.objects.cards[sourceId], r = c && context?.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
            return Boolean(r && context && c && (effectiveCardTypes(state, c.id, context).includes("UNIT") || c.zone.zone === "REMOVED" && lastValidTypes?.includes("UNIT")) && r.deckbuildingIdentity === condition.identity);
        }
        case "SUBJECT_STOLE_GIG_THIS_TURN": return Boolean(sourceId && state.turnHistory?.turn === state.timing.turn && (state.turnHistory.gigsStolenByUnit?.[sourceId] ?? 0) > 0);
        case "STREET_CRED_DIFFERENCE_AT_LEAST": {
            if (!values.length) return false; // Null cannot participate in numeric subtraction (2.10.2).
            const own = values.reduce((a, b) => a + b, 0);
            return state.match.playerOrder.some(id => {
                if (id === actor) return false;
                const rival = Object.values(state.objects.gigs).filter(g => g.controllerId === id && g.location.zone === "GIGS" && g.roll.kind === "ROLLED");
                return rival.length > 0 && Math.abs(own - rival.reduce((n, g) => n + (g.roll.kind === "ROLLED" ? g.roll.currentValue : 0), 0)) >= condition.minimum;
            });
        }
        case "STREET_CRED_GREATER_THAN_RIVAL":
            // Inverse of the existing Null-aware comparison, not subtraction or a stored counter.
            return state.match.playerOrder.some(id => id !== actor && testCondition(state, id, { kind: "STREET_CRED_LESS_THAN_RIVAL" }, context));
        case "STREET_CRED_LESS_THAN_RIVAL": {
            // 5.11.4: Null is below numeric values; two Null areas are not less than each other.
            const own = values.length ? values.reduce((a, b) => a + b, 0) : null;
            return state.match.playerOrder.some(id => {
                if (id === actor) return false;
                const rival = Object.values(state.objects.gigs).filter(g => g.controllerId === id && g.location.zone === "GIGS" && g.roll.kind === "ROLLED");
                if (!rival.length) return false;
                const sum = rival.reduce((n, g) => n + (g.roll.kind === "ROLLED" ? g.roll.currentValue : 0), 0);
                return own === null || own < sum;
            });
        }
        case "SOURCE_POWER_AT_LEAST": { const power = context && sourceId ? effectivePower(state, sourceId, context) : null; return power !== null && (context && combatResolutionEnabled(context) ? referencedPower(power) : power) >= condition.minimum; }
        case "GIG_COUNT": return gigs.length >= condition.minimum;
        case "DISTINCT_GIG_DIE_TYPES": return new Set(gigs.map(g => g.dieType)).size >= condition.minimum;
        case "DISTINCT_GIG_VALUES": return new Set(values).size >= condition.minimum;
        case "STREET_CRED": return values.reduce((a, b) => a + b, 0) >= condition.minimum;
        case "GIG_VALUE": return values.includes(condition.value);
        case "GIG_VALUE_AT_LEAST": return values.some(value => value >= condition.minimum);
    }
}
