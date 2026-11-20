import { failure, success, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { moveCardLocation } from "./card-movement";
import { supportsLegendReveal } from "./legend-reveal-support";
import { compareTemporaryPower } from "./temporary-power";

/** Batch V41: "{Attack} Reveal the top card of your deck and add it to your hand. This Unit gains power equal to that card's cost
 * this turn." An empty deck reveals nothing (it is not a draw). A cost of 0, or no numeric cost, gives nothing. The power tracks the
 * attacker like any "this turn" power (5.3.2.2), and only while it is still a public field card. */
export function resolveRevealTopGainPower(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, t = current.trigger, c = s.resolution.triggerContinuation, e = current.effect;
    if (e.kind !== "REVEAL_TOP_TO_HAND_GAIN_POWER_EQUAL_COST" || !t || t.kind !== "WHEN_ATTACKING" || !current.sourceId || t.subjectId !== current.sourceId || c?.origin.kind !== "ATTACK" || c.origin.subjectId !== current.sourceId
        || current.primitiveIndex !== undefined || !supportsLegendReveal(cardRevision(s, current.sourceId, m.context), m.context).ok)
        return failure("INVALID_REVEAL_SOURCE", "The reveal requires its reviewed self ATTACK occurrence");
    const top = s.players[current.controllerId].zones.DECK[0];
    if (!top) return success(null);
    m.emit({ kind: "CARD_REVEALED", cardInstanceId: top });
    moveCardLocation(m, top, "HAND");
    const cost = cardRevision(s, top, m.context)?.printedCost, amount = cost?.kind === "EDDIES" ? cost.amount : 0, subject = s.objects.cards[t.subjectId];
    if (!amount || subject?.face !== "UP" || subject.zone.zone !== "BATTLEFIELD") return success(null);
    const modifier: TemporaryPowerModifier = { kind: "POWER", sourceId: current.sourceId, targetId: subject.id, expires: { kind: "END_OF_TURN", turn: s.timing.turn },
        amount, scaled: "REVEALED_CARD_COST", revealedCardId: top, origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
