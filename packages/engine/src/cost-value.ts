import type { CardInstanceId, GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
/** 3.11.1.2: changes to payment do not alter the card's immutable cost value. */
export function numericCost(state: GameState, id: CardInstanceId, context: EngineContext): number | null {
    const cost = cardRevision(state, id, context)?.printedCost;
    return cost?.kind === "EDDIES" ? cost.amount : null;
}
/** 3.11.2.3 is an explicit Legend-only exception for references, not payable cost.
 * DASH remains stored as DASH. No generic Null-to-zero coercion or cost modifiers. */
export function referencedCost(state: GameState, id: CardInstanceId, context: EngineContext): number | null {
    const r = cardRevision(state, id, context);
    return r?.type === "LEGEND" && r.printedCost.kind === "DASH" ? 0 : numericCost(state, id, context);
}
