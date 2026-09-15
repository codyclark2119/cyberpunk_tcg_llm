import { type GameState } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation } from "@tcg/engine";
import { generatePosition } from "@tcg/training-harness";
import { reviewedContext, reviewedInput } from "./reviewed-card-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
export function reviewedReplay() {
    const context = reviewedContext(), initialization = reviewedInput(), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps = [], positions = [];
    for (let i = 0; i < 12; i++) {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), observation = unwrap(observe(state, actorId, context));
        if (legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `reviewed-${i}`)));
        const selected = state.setup ? selectReplayAction(legalActions, a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === (state.setup!.stage === "MULLIGAN" && state.setup!.completed === 0 ? 1 : 0))!
            : state.timing.step === "CHOOSE_GIG" ? selectReplayAction(legalActions, a => a.action.kind === "ROLL_GIG")!
            : state.resolution.searchContinuation ? selectReplayAction(legalActions, a => a.action.kind === "CHOOSE" && state.resolution.choice!.options[a.action.optionIndices[0]].kind === "CARD")!
            : selectReplayAction(legalActions, a => a.action.kind === "CALL_LEGEND" && state.objects.cards[a.action.cardInstanceId].cardId === "viktor-vektor-sit-down-and-relax")!;
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
        if (result.events.some(e => e.payload.kind === "EFFECT_RESOLVED")) break;
    }
    return { schemaVersion: 1, note: "Captured setup and reviewed Viktor CALL; synthetic support deck, private replay, not gold training data", content: context.content, initialization, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state) };
}
