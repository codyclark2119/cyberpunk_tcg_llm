import type { GameState, LegalAction } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { noncombatContext, noncombatInput, AFTERPARTY, KERRY } from "./noncombat-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Every state is reached by real legal actions; seed fixes opening draws, not a mutation of a shuffled deck. */
export function noncombatReplay() {
    const context = noncombatContext(), initialization = noncombatInput("noncombat-play-34"), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), observation = unwrap(observe(state, actorId, context));
        const selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing noncombat replay action at ${state.timing.turn}/${state.timing.step}`);
        if (legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `noncombat-${steps.length}`)));
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) {
        const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0;
        take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    const play = (cardId: string) => take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === cardId);
    roll("D12"); sell(); end();
    roll("D4"); end();
    roll("D8"); sell(); play(AFTERPARTY);
    take(a => a.action.kind === "CHOOSE" && state.resolution.choice!.options[a.action.optionIndices[0]].kind === "PAYMENT" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "PAYMENT" && o.source.kind === "EDDIE"; })());
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "GIG" && o.gigInstanceId === "p0-D8"; })());
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "MODE" && o.mode === "INCREASE_1"; })());
    play(KERRY);
    while (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE");
    end(); roll("D6"); end(); roll("D4");
    take(a => a.action.kind === "ACTIVATE_ABILITY");
    return { schemaVersion: 1, note: "Reviewed Afterparty and Kerry; full engine-owned setup and legal normal turns, synthetic support Gears/third Legend; private replay, not gold data", content: context.content, initialization, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state) };
}
