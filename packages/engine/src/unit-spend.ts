import { failure, success, type CardInstanceId, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { effectiveCardTypes } from "./characteristics";
/** Public effective Unit subject; Lag/attack/Spend-icon costs are unrelated to this effect. */
export function isUnitSpendSubject(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return Boolean(c && c.zone.zone === "BATTLEFIELD" && c.zone.playerId === c.controllerId && c.face === "UP" && effectiveCardTypes(state, id, context).includes("UNIT"));
}
/** Semantic effect-caused transition only. Existing payment/attack/Blocker/ability paths retain
 * their event protocols. Future WHEN_SPENT discovery belongs at this actual-transition boundary,
 * with timing reviewed per cause; selecting an already-spent card must never trigger it again. */
export function spendUnitForEffect(m: TurnMutation, targetId: CardInstanceId, sourceId: CardInstanceId, effectId: string) {
    if (!m.state.objects.cards[sourceId] || !effectId || !isUnitSpendSubject(m.state, targetId, m.context)) return failure("INVALID_SPEND_SUBJECT", "Effect source and public effective Unit required");
    const target = m.state.objects.cards[targetId];
    if (target.readiness === "SPENT") return success({ changed: false });
    target.readiness = "SPENT";
    m.emit({ kind: "CARD_SPENT", cardInstanceId: targetId, cause: { kind: "EFFECT", sourceId, effectId } });
    return success({ changed: true });
}
