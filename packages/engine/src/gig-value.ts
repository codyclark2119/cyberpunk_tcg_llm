import { failure, success, type GigInstanceId, type GameEvent } from "@tcg/domain";
import type { DraftState } from "./turn";
import type { EngineContext } from "./state";
/** Shared trusted primitive for public low-level API and effect composition. No version bump here. */
export function changeGigValue(state: DraftState, id: GigInstanceId, delta: number, context: EngineContext) {
    const policy = context.content.ruleset.gameplay?.gigValueBounds;
    if (!policy || policy === "UNSUPPORTED") return failure("UNSUPPORTED_GIG_BOUNDS", "Reviewed Gig bounds policy required");
    const gig = state.objects.gigs[id];
    if (!gig || gig.roll.kind !== "ROLLED" || !Number.isSafeInteger(delta) || (policy === "DIE_FACES_V1" && gig.location.zone !== "GIGS"))
        return failure("INVALID_GIG_CHANGE", "A controlled rolled Gig and integer delta are required");
    const bounds = policy === "DIE_FACES_V1" ? { min: 1, max: Number(gig.dieType.slice(1)) } : policy;
    const previous = gig.roll.currentValue, current = previous + delta;
    if (!Number.isSafeInteger(current) || current < bounds.min || current > bounds.max)
        return failure("GIG_VALUE_OUT_OF_BOUNDS", "Rule 6.4.4: no such die face; adjustment fails without clamping");
    if (policy === "DIE_FACES_V1" && delta === 0) return failure("GIG_VALUE_UNCHANGED", "Rule 6.4.5: unchanged value is not an adjustment; up-to zero is a separate decline");
    gig.roll.currentValue = current;
    return success<GameEvent["payload"]>({ kind: "GIG_VALUE_CHANGED", gigInstanceId: id, previous, current });
}
