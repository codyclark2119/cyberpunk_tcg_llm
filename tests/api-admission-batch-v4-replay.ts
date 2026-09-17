import type { GameAction, GameEvent, GameState, LegalAction, Result } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashReplayState, listLegalActions } from "@tcg/engine";
import { selectReplayAction } from "./replay-selection";
import { JONIN, batchV4Context, batchV4Input } from "./api-admission-batch-v4-fixture";

export function must<T>(result: Result<T>): T {
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.value;
}
export type BatchV4Step = { before: GameState; after: GameState; action: GameAction; actionId: string; legalActions: LegalAction[]; events: GameEvent[] };
/** Legal initialization, payment and choices only. No state/RNG patch and no actionId-based tie breaking. */
export function batchV4Replay(seed = "api-admission-batch-v4-1", context = batchV4Context()) {
    const initialization = batchV4Input(seed), initialized = must(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: BatchV4Step[] = [];
    const legal = () => must(listLegalActions(state, state.timing.actingPlayer, context));
    const available = (predicate: (a: LegalAction) => boolean) => legal().some(predicate);
    const take = (predicate: (a: LegalAction) => boolean) => {
        const before = state, legalActions = legal(), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing Batch V4 action at ${state.timing.turn}/${state.timing.step}`);
        const action = { actorId: selected.actorId, action: selected.action }, result = must(applyAction(state, action, context));
        state = result.state;
        steps.push({ before, after: state, action, actionId: selected.actionId, legalActions, events: result.events });
    };
    const settle = () => {
        for (let i = 0; state.resolution.choice && !state.match.outcome; i++) {
            if (i >= 100) throw new Error("Batch V4 choice guard exhausted");
            take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
        }
    };
    settle();
    for (let turns = 0; turns < 12 && !state.match.outcome; turns++) {
        if (available(a => a.action.kind === "ROLL_GIG")) take(a => a.action.kind === "ROLL_GIG");
        settle();
        if (state.match.outcome) break;
        const actor = state.timing.actingPlayer;
        const sell = (a: LegalAction) => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card");
        if (available(sell)) take(sell);
        // Establish a second friendly Unit before casting Jonin, where legally affordable.
        if (!Object.values(state.objects.cards).some(c => c.controllerId === actor && c.zone.zone === "BATTLEFIELD")) {
            const body = (a: LegalAction) => a.action.kind === "PLAY_CARD" && ["corpo-security", "swordwise-huscle", "emergency-atlus"].includes(state.objects.cards[a.action.cardInstanceId].cardId);
            if (available(body)) { take(body); settle(); }
        }
        const play = (a: LegalAction) => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === JONIN;
        while (!state.match.outcome && available(play)) { take(play); settle(); }
        if (!state.match.outcome) take(a => a.action.kind === "END_TURN");
        const chosePower = steps.some(s => s.before.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN" && s.before.resolution.current.effect.target.kind === "FRIENDLY_UNIT");
        const expired = steps.some(s => s.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED" && e.payload.reason === "TURN_END"));
        if (chosePower && expired) break;
    }
    return { seed, initialization, initialized, steps, finalState: state, finalStateHash: hashReplayState(state) };
}
