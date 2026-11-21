import { effectiveTriggeredAbilities } from "./trigger-queries";
import { canonicalSerialize, failure, hashCanonical, success, type CardInstanceId, type FightOutcome, type FightOutcomeEffect, type FightResult, type GameState, type PlayerId, type TriggerBinding } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { supportsFightStealProgram } from "./fight-steal-support";
import { triggersEnabled } from "./trigger-support";

/** Batch V46: "The next time a friendly Unit loses a fight this turn, ..." A resolved Program registers the effect for the
 * rest of the turn. The first fight this turn in which one of its controller's Units loses fires it; the effect is consumed
 * then, becomes pending, and resolves after the fight ends with the fight's DEFEATED triggers (11.4.2.2.1, 11.4.3). */
export function fightOutcomeId(state: GameState, sourceId: CardInstanceId, controller: PlayerId, turn: number) {
    return hashCanonical({ protocol: "next-fight-outcome@1", sourceId, controllerSeat: state.players[controller].seat, turn });
}
const byId = (a: FightOutcomeEffect, b: FightOutcomeEffect) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
/** The reviewed registering ability of the effect's source revision, or undefined. */
export function registration(state: GameState, e: FightOutcomeEffect, context: EngineContext) {
    const r = context.content.cards.find(c => c.id === e.source.cardId && c.revision === e.source.revision), a = r?.mechanics.abilities.find(a => a.id === e.abilityId);
    return r && a?.trigger === "WHEN_PLAYED" && a.effects[0]?.kind === "REGISTER_NEXT_FIGHT_OUTCOME" && (supportsTargetedDefeatCard(r, context).ok || supportsFightStealProgram(r, context).ok) ? a.effects[0] : undefined;
}
export function validFightOutcomeEffect(state: GameState, e: FightOutcomeEffect, context: EngineContext) {
    const source = state.objects.cards[e.sourceId];
    return triggersEnabled(context) && Boolean(source && state.players[e.controllerId] && source.cardId === e.source.cardId && source.revision === e.source.revision && source.ownerId === e.controllerId && registration(state, e, context))
        && e.createdTurn === state.timing.turn && e.expires.turn === e.createdTurn && e.id === fightOutcomeId(state, e.sourceId, e.controllerId, e.createdTurn);
}
export function createFightOutcomeEffect(m: TurnMutation) {
    const current = m.state.resolution.current, source = current?.sourceId ? m.state.objects.cards[current.sourceId] : undefined, ability = source && cardRevision(m.state, source.id, m.context)?.mechanics.abilities[0];
    if (!current?.sourceId || !source || !ability || current.effect.kind !== "REGISTER_NEXT_FIGHT_OUTCOME" || source.zone.zone !== "RESOLVING_PROGRAM") return failure("INVALID_FIGHT_OUTCOME", "Expected the reviewed resolving Program primitive");
    if (m.state.fightOutcomeEffects?.some(e => e.sourceId === current.sourceId)) return failure("DUPLICATE_FIGHT_OUTCOME", "One physical Program play cannot register twice");
    const effect: FightOutcomeEffect = { kind: "NEXT_FIGHT_OUTCOME", id: fightOutcomeId(m.state, source.id, current.controllerId, m.state.timing.turn), sourceId: source.id, source: { cardId: source.cardId, revision: source.revision },
        abilityId: ability.id, controllerId: current.controllerId, createdTurn: m.state.timing.turn, expires: { kind: "END_OF_TURN", turn: m.state.timing.turn } };
    if (!validFightOutcomeEffect(m.state, effect, m.context)) return failure("INVALID_FIGHT_OUTCOME", "Reviewed source and current-turn registration required");
    m.state.fightOutcomeEffects = [...(m.state.fightOutcomeEffects ?? []), effect].sort(byId);
    m.emit({ kind: "FIGHT_OUTCOME_EFFECT_CREATED", effect });
    return success(null);
}
/** The friendly Unit whose outcome in this fight matches the registration, with the opposing Unit, or undefined. */
function matchFight(state: GameState, e: FightOutcomeEffect, result: FightResult, context: EngineContext) {
    const on = registration(state, e, context)?.on, winner = result.winnerId, margin = Math.abs(result.attackerComparisonPower - result.defenderComparisonPower);
    // Batch V47: "wins a fight by 3+ power": the winner's comparison power exceeds the loser's by at least 3.
    const subjectId = on === "FRIENDLY_UNIT_LOSES" ? result.loserIds.find(id => state.objects.cards[id]?.controllerId === e.controllerId)
        : on === "FRIENDLY_UNIT_WINS_BY_3" && winner && state.objects.cards[winner]?.controllerId === e.controllerId && margin >= 3 ? winner : undefined;
    return subjectId ? { subjectId, opposingId: subjectId === result.attackerId ? result.defenderId : result.attackerId } : undefined;
}
/** Fires every matching registration on this fight, in id order; each is consumed once. */
export function fireFightOutcomes(m: TurnMutation, result: FightResult): FightOutcome[] {
    const fired: FightOutcome[] = [], remaining: FightOutcomeEffect[] = [];
    for (const effect of m.state.fightOutcomeEffects ?? []) {
        const match = matchFight(m.state, effect, result, m.context);
        if (!match) { remaining.push(effect); continue; }
        fired.push({ effect, ...match });
        m.emit({ kind: "FIGHT_OUTCOME_EFFECT_FIRED", effectId: effect.id, ...match });
    }
    if (remaining.length) m.state.fightOutcomeEffects = remaining; else delete m.state.fightOutcomeEffects;
    return fired;
}
/** Batch V51: "When this Unit loses a fight": each losing Unit's own printed binding, captured before it moves, naming the opposing
 * Unit. It resolves in the post-fight batch with the fight's DEFEATED triggers (11.4.2.3, 11.4.3), as a fired outcome does. */
export function fightLostBindings(state: GameState, result: FightResult, context: EngineContext): TriggerBinding[] {
    if (!triggersEnabled(context)) return [];
    return [...result.loserIds].sort().flatMap(id => effectiveTriggeredAbilities(state, id, context).filter(b => b.kind === "WHEN_FIGHT_LOST" && b.sourceId === b.subjectId)
        .map(b => ({ ...b, opposingId: id === result.attackerId ? result.defenderId : result.attackerId })));
}
export function fightOutcomeBinding(o: FightOutcome): TriggerBinding {
    return { sourceId: o.effect.sourceId, subjectId: o.subjectId, controllerId: o.effect.controllerId, source: o.effect.source, abilityId: o.effect.abilityId, kind: "DELAYED_FIGHT_OUTCOME", delayedId: o.effect.id, opposingId: o.opposingId };
}
/** A fired set is exactly the registrations this fight matched, valid and in id order, and none still active matches it. */
export function validFightOutcomes(state: GameState, result: FightResult, outcomes: readonly FightOutcome[], context: EngineContext) {
    if (outcomes.some((o, i) => i > 0 && byId(outcomes[i - 1].effect, o.effect) >= 0)) return false;
    if (outcomes.some(o => !validFightOutcomeEffect(state, o.effect, context) || canonicalSerialize(matchFight(state, o.effect, result, context)) !== canonicalSerialize({ subjectId: o.subjectId, opposingId: o.opposingId }))) return false;
    return !(state.fightOutcomeEffects ?? []).some(e => matchFight(state, e, result, context) || outcomes.some(o => o.effect.id === e.id));
}
export function validateFightOutcomeEffects(state: GameState, context: EngineContext) {
    const active = state.fightOutcomeEffects;
    if (!active) return success(null);
    if (new Set(active.map(e => e.sourceId)).size !== active.length || active.some((e, i) => i > 0 && byId(active[i - 1], e) >= 0) || active.some(e => !validFightOutcomeEffect(state, e, context)))
        return failure("INVALID_FIGHT_OUTCOME", "Distinct reviewed current-turn registrations in id order required");
    return success(null);
}
export function expireFightOutcomeEffects(m: TurnMutation) {
    for (const e of m.state.fightOutcomeEffects ?? []) m.emit({ kind: "FIGHT_OUTCOME_EFFECT_EXPIRED", effectId: e.id, reason: "TURN_END" });
    delete m.state.fightOutcomeEffects;
}
/** Batch V46: "defeat the opposing rival Unit": the fight's opposing Unit, while it is still a face-up rival field Unit. */
export function opposingDefeatTargets(state: GameState, e: NonNullable<GameState["resolution"]["current"]>, eligible: (id: CardInstanceId) => boolean) {
    const id = e.trigger?.kind === "DELAYED_FIGHT_OUTCOME" || e.trigger?.kind === "WHEN_FIGHT_LOST" ? e.trigger.opposingId : undefined, c = id ? state.objects.cards[id] : undefined;
    return id && c && c.face === "UP" && c.zone.zone === "BATTLEFIELD" && c.controllerId !== e.controllerId && eligible(id) ? [id] : [];
}
