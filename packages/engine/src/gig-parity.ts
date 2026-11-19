import { failure, success, type GameState, type PlayerId, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsGigParityUnit } from "./gig-parity-support";
import { compareTemporaryPower } from "./temporary-power";

/** Batch V28: rolled Gigs in the player's Gig area whose current value has the parity. Only the player's own Gigs are friendly. */
export function friendlyGigsWithParity(state: GameState, player: PlayerId, parity: "EVEN" | "ODD") {
    return state.players[player].gigs.GIGS.filter(id => {
        const g = state.objects.gigs[id];
        return g?.controllerId === player && g.roll.kind === "ROLLED" && g.roll.currentValue % 2 === (parity === "EVEN" ? 0 : 1);
    }).length;
}
/** "{Attack} Give this Unit +2 power this turn for each friendly Gig with an even value": counted once, when the effect resolves.
 * No even Gig gives nothing. The modifier tracks the attacker like any "this turn" power (5.3.2.2). */
export function resolvePowerPerFriendlyGig(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, t = current.trigger, c = s.resolution.triggerContinuation, e = current.effect;
    if (e.kind !== "POWER_PER_FRIENDLY_GIG" || !t || t.kind !== "WHEN_ATTACKING" || !current.sourceId || t.subjectId !== current.sourceId || c?.origin.kind !== "ATTACK" || c.origin.subjectId !== current.sourceId
        || current.primitiveIndex !== undefined || !supportsGigParityUnit(cardRevision(s, current.sourceId, m.context), m.context).ok)
        return failure("INVALID_POWER_SOURCE", "Gig-parity power requires its reviewed self ATTACK occurrence");
    const subject = s.objects.cards[t.subjectId], count = friendlyGigsWithParity(s, current.controllerId, e.parity);
    if (!count || subject?.face !== "UP" || subject.zone.zone !== "BATTLEFIELD") return success(null);
    const modifier: TemporaryPowerModifier = { kind: "POWER", sourceId: current.sourceId, targetId: subject.id, expires: { kind: "END_OF_TURN", turn: s.timing.turn },
        amount: e.amount * count, scaled: "FRIENDLY_EVEN_GIGS", origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
/** "{Defeated} Draw 1 for each friendly Gig with an odd value": counted when the effect resolves, after the Unit has left the field. */
export function resolveDrawPerFriendlyGig(m: TurnMutation): Result<null> {
    const s = m.state, current = s.resolution.current!, e = current.effect;
    if (e.kind !== "DRAW_PER_FRIENDLY_GIG" || current.trigger?.kind !== "WHEN_DEFEATED" || !current.sourceId || current.primitiveIndex !== undefined
        || !supportsGigParityUnit(cardRevision(s, current.sourceId, m.context), m.context).ok)
        return failure("INVALID_DRAW_SOURCE", "Gig-parity draw requires its reviewed DEFEATED occurrence");
    const count = friendlyGigsWithParity(s, current.controllerId, e.parity) * e.count;
    return count ? m.draw(current.controllerId, count) : success(null);
}
