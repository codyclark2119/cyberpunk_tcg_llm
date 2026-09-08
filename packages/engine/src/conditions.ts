import { effectivePower } from "./characteristics";
import type { EngineContext } from "./state";
import type { Condition, GameState, PlayerId, CardInstanceId } from "@tcg/domain";
/** Queries the supplied state now; caller explicitly owns condition timing. */
export function testCondition(state: GameState, actor: PlayerId, condition: Condition, context?: EngineContext, sourceId?: CardInstanceId | null): boolean {
    const gigs = Object.values(state.objects.gigs).filter(g => g.controllerId === actor && g.location.zone === "GIGS" && g.roll.kind === "ROLLED");
    const values = gigs.flatMap(g => g.roll.kind === "ROLLED" ? [g.roll.currentValue] : []);
    switch (condition.kind) {
        case "SOURCE_POWER_AT_LEAST": { const power = context && sourceId ? effectivePower(state, sourceId, context) : null; return power !== null && power >= condition.minimum; }
        case "GIG_COUNT": return gigs.length >= condition.minimum;
        case "DISTINCT_GIG_DIE_TYPES": return new Set(gigs.map(g => g.dieType)).size >= condition.minimum;
        case "DISTINCT_GIG_VALUES": return new Set(values).size >= condition.minimum;
        case "STREET_CRED": return values.reduce((a, b) => a + b, 0) >= condition.minimum;
        case "GIG_VALUE": return values.includes(condition.value);
        case "GIG_VALUE_AT_LEAST": return values.some(value => value >= condition.minimum);
    }
}
