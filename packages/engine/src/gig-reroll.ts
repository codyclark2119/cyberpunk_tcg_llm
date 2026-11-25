import { canonicalSerialize, failure, success, type GameState, type GigInstanceId, type PendingChoice, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { drawDeterministicInteger } from "./rng";

type RollModifierKind = "MAY_REROLL_FIXER_GIG_ONCE" | "DRAW_ON_EXTREME_GIG_ROLL";
/** Batch V81: content holding the reviewed Legend whose roll riders apply to its controller's own start-of-turn roll. */
export function gigRerollEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.type === "LEGEND" && r.mechanics.modifiers.some(m => m.kind === "MAY_REROLL_FIXER_GIG_ONCE") && supportsLegendSpendCard(r, context).ok);
}
/** The player's face-up Legends-area cards carrying the pinned roll rider; a face-down Legend has no ability (11.1). */
function rollRiders(state: GameState, player: PlayerId, kind: RollModifierKind, context: EngineContext) {
    return [...state.players[player].zones.LEGENDS].sort().filter(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return c.face === "UP" && c.controllerId === player && supportsLegendSpendCard(r, context).ok && r!.mechanics.modifiers.some(m => m.kind === kind);
    });
}
function rerollChoice(state: GameState, player: PlayerId, gigInstanceId: GigInstanceId): PendingChoice {
    return { id: `gig-reroll:${state.timing.turn}:${gigInstanceId}`, actorId: player, kind: "OPTIONAL", min: 1, max: 1, ordered: false, continuationId: "gig-reroll@1",
        options: [{ kind: "CONFIRM", confirmed: true }, { kind: "CONFIRM", confirmed: false }] };
}
/** After the Gig is rolled in and placed (8.6.5.2-3) and no overtime win ended the game: "you may ignore the result and reroll it once". */
export function offerGigReroll(m: TurnMutation, player: PlayerId, gigInstanceId: GigInstanceId) {
    if (!rollRiders(m.state, player, "MAY_REROLL_FIXER_GIG_ONCE", m.context).length) return false;
    m.state.resolution.gigRerollContinuation = { gigInstanceId };
    m.state.resolution.stage = "CHOICE";
    m.state.resolution.choice = rerollChoice(m.state, player, gigInstanceId);
    return true;
}
/** CONFIRM true ignores the result and rolls the same die again; the ignored result is gone and never counts as rolled for the draw. */
export function continueGigReroll(m: TurnMutation, optionIndex: number) {
    const s = m.state, gigInstanceId = s.resolution.gigRerollContinuation!.gigInstanceId, option = s.resolution.choice!.options[optionIndex];
    if (option?.kind !== "CONFIRM") return failure("INVALID_GIG_REROLL", "Choose whether to reroll the Gig");
    const gig = s.objects.gigs[gigInstanceId];
    delete s.resolution.gigRerollContinuation;
    s.resolution.choice = null;
    m.emit({ kind: "GIG_REROLL_CHOSEN", gigInstanceId, reroll: option.confirmed });
    if (option.confirmed) {
        const rolled = drawDeterministicInteger(s.rng, Number(gig.dieType.slice(1))), counter = s.rng.counter;
        s.rng = rolled.rng;
        gig.roll = { kind: "ROLLED", initialValue: rolled.rawValue, currentValue: rolled.rawValue };
        m.emit({ kind: "GIG_DIE_ROLLED", gigInstanceId, dieType: gig.dieType, rawValue: rolled.rawValue, rngCounter: counter });
    }
    return finishGigRoll(m, s.timing.activePlayer, gigInstanceId);
}
/** "When you roll a min or max value on a Gig, draw 1. If it's a d20, draw 3 instead." Once per face-up rider, on the kept roll only. */
export function finishGigRoll(m: TurnMutation, player: PlayerId, gigInstanceId: GigInstanceId) {
    const gig = m.state.objects.gigs[gigInstanceId], faces = Number(gig.dieType.slice(1)), value = gig.roll.kind === "ROLLED" ? gig.roll.currentValue : 0;
    if (value === 1 || value === faces)
        for (const id of rollRiders(m.state, player, "DRAW_ON_EXTREME_GIG_ROLL", m.context)) {
            const rider = cardRevision(m.state, id, m.context)!.mechanics.modifiers.flatMap(x => x.kind === "DRAW_ON_EXTREME_GIG_ROLL" ? [x] : [])[0];
            const drawn = m.draw(player, gig.dieType === "D20" ? rider.d20Count : rider.count);
            if (!drawn.ok) return drawn;
            if (m.state.match.outcome) return success(null);
        }
    m.phase("MAIN");
    return success(null);
}
/** The reroll choice is exclusive: the active player's own just-rolled, unmodified Gig in the roll step, under a face-up rider. */
export function validateGigReroll(state: GameState, context: EngineContext) {
    const c = state.resolution.gigRerollContinuation, r = state.resolution;
    if (!c) return state.timing.step === "ROLL_GIG" && r.stage === "CHOICE" ? failure("ORPHAN_GIG_REROLL", "A roll-step choice needs its reroll continuation") : success(null);
    const gig = state.objects.gigs[c.gigInstanceId], player = state.timing.activePlayer;
    if (!gigRerollEnabled(context) || !gig || state.setup || state.match.outcome || state.timing.step !== "ROLL_GIG" || r.stage !== "CHOICE" || state.timing.actingPlayer !== player
        || state.timing.combat.stage !== "NONE" || r.current || r.pending.length || r.discovered.length || r.returnTo || r.triggerContinuation || r.targetedDefeatContinuation || r.gigStealContinuation
        || r.defeatContinuation || r.legendEntryContinuation || r.playContinuation || r.searchContinuation || r.callContinuation
        || gig.controllerId !== player || gig.location.zone !== "GIGS" || gig.roll.kind !== "ROLLED" || gig.roll.initialValue !== gig.roll.currentValue
        || !rollRiders(state, player, "MAY_REROLL_FIXER_GIG_ONCE", context).length || canonicalSerialize(r.choice) !== canonicalSerialize(rerollChoice(state, player, c.gigInstanceId)))
        return failure("INVALID_GIG_REROLL", "Exclusive reroll choice for the active player's just-rolled Gig under a face-up rider required");
    return success(null);
}
