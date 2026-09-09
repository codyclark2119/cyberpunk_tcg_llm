import { failure, success, type GigInstanceId, type GameEvent, type GameState, type Effect, type PendingChoice } from "@tcg/domain";
import type { DraftState } from "./turn";
import type { EngineContext } from "./state";
type ChoiceOption = PendingChoice["options"][number];
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

/** Enumerate choices, never clamp a requested adjustment. Zero is a decline, not a value change. */
export function gigAdjustmentOptions(gig: GameState["objects"]["gigs"][GigInstanceId], effect: Extract<Effect, { kind: "ADJUST_GIG_UP_TO" }>): ChoiceOption[] {
    if (gig.roll.kind !== "ROLLED") return [];
    const value = gig.roll.currentValue, maximum = Number(gig.dieType.slice(1));
    if (effect.direction === "INCREASE") return Array.from({ length: Math.min(effect.maximum, maximum - value) + 1 }, (_, amount) => ({ kind: "AMOUNT", amount }));
    return [...(value > 1 ? [{ kind: "MODE" as const, mode: "DECREASE_1" }] : []), { kind: "MODE", mode: "KEEP" }, ...(value < maximum ? [{ kind: "MODE" as const, mode: "INCREASE_1" }] : [])];
}
export function gigAdjustmentDelta(effect: Extract<Effect, { kind: "ADJUST_GIG_UP_TO" }>, option: ChoiceOption): number | null {
    if (effect.direction === "INCREASE") return option.kind === "AMOUNT" && Number.isInteger(option.amount) && option.amount >= 0 && option.amount <= effect.maximum ? option.amount : null;
    return option.kind === "MODE" ? option.mode === "KEEP" ? 0 : option.mode === "DECREASE_1" ? -1 : option.mode === "INCREASE_1" ? 1 : null : null;
}
