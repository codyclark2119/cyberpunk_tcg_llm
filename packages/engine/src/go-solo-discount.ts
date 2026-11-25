import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { supportsModalProgram } from "./modal-program-support";

/** Batch V83: content holding the reviewed Program whose mode grants "a friendly Legend may use {Go Solo} for -2 €$ this turn". */
export function goSoloDiscountEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.effects.some(e => e.kind === "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN")) && supportsModalProgram(r, context).ok);
}
/** One grant per resolved mode, kept in this turn's history until a friendly {Go Solo} uses it. */
export function grantGoSoloDiscount(m: TurnMutation): Result<null> {
    const current = m.state.resolution.current, h = m.state.turnHistory;
    if (current?.effect.kind !== "FRIENDLY_GO_SOLO_DISCOUNT_THIS_TURN" || !h || current.controllerId !== m.state.timing.activePlayer || h.goSoloDiscounts?.includes(current.id))
        return failure("INVALID_GO_SOLO_DISCOUNT", "A current reviewed Go Solo discount in its controller's turn is required");
    h.goSoloDiscounts = [...(h.goSoloDiscounts ?? []), current.id];
    m.emit({ kind: "GO_SOLO_DISCOUNT_GRANTED", effectId: current.id, playerId: current.controllerId });
    return success(null);
}
/** "-2 €$, to a minimum of 1 €$": the next {Go Solo} of the active player this turn, after any increase (a minimum caps only the reduction). */
export function discountedGoSoloAmount(state: GameState, actor: PlayerId, amount: number) {
    return actor === state.timing.activePlayer && state.turnHistory?.goSoloDiscounts?.length ? Math.max(Math.min(amount, 1), amount - 2) : amount;
}
/** The completed {Go Solo} uses the earliest grant. */
export function spendGoSoloDiscount(m: TurnMutation, actor: PlayerId, legendId: CardInstanceId) {
    const h = m.state.turnHistory;
    if (actor !== m.state.timing.activePlayer || !h?.goSoloDiscounts?.length) return;
    const [effectId, ...rest] = h.goSoloDiscounts;
    if (rest.length) h.goSoloDiscounts = rest; else delete h.goSoloDiscounts;
    m.emit({ kind: "GO_SOLO_DISCOUNT_USED", cardInstanceId: legendId, effectId });
}
export function validateGoSoloDiscounts(state: GameState, context: EngineContext) {
    const grants = state.turnHistory?.goSoloDiscounts;
    if (grants && (!goSoloDiscountEnabled(context) || new Set(grants).size !== grants.length)) return failure("INVALID_TURN_HISTORY", "Go Solo discounts need their reviewed Program and distinct grants");
    return success(null);
}
