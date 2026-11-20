import { failure, success, type Result } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsSellTopProgram } from "./program-sell-support";
/** Batch V45: "Sell the top card of your deck." The card goes face-down and ready to the Eddies area without being seen and
 * needs no Sell tag (11.12.2.1). It counts as the turn's "Sell a Card" action (11.12.2.2), so the turn's sell is used up; a
 * sell made earlier this turn does not stop it. With an empty deck nothing is sold. */
export function resolveSellTopOfDeck(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, actor = current.controllerId, p = s.players[actor];
    if (current.effect.kind !== "SELL_TOP_OF_DECK" || !current.sourceId || s.objects.cards[current.sourceId]?.zone.zone !== "RESOLVING_PROGRAM" || !supportsSellTopProgram(cardRevision(s, current.sourceId, m.context), m.context).ok)
        return failure("INVALID_EFFECT_SELL", "A reviewed resolving effect-sell Program is required");
    const id = p.zones.DECK[0];
    if (!id) return success(null);
    const c = s.objects.cards[id], from = { ...c.zone };
    p.zones.DECK.shift();
    p.zones.EDDIES.push(id);
    c.zone = { playerId: actor, zone: "EDDIES" };
    c.face = "DOWN";
    c.readiness = "READY";
    c.statuses = [...c.statuses.filter(x => x !== "EFFECT_SOLD"), "EFFECT_SOLD"];
    p.economy.sellsThisTurn = Math.max(p.economy.sellsThisTurn, m.context.content.ruleset.gameplay!.sellLimitPerTurn);
    m.emit({ kind: "CARD_MOVED", cardInstanceId: id, from, to: c.zone });
    m.emit({ kind: "CARD_SOLD", cardInstanceId: id, value: cardRevision(s, id, m.context)!.sellProfile.baseEddieValue });
    return success(null);
}
