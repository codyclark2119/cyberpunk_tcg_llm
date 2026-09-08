import { type GameState } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation } from "@tcg/engine";
import { generatePosition } from "@tcg/training-harness";
import { setupContext, setupInput } from "./setup-fixture";
import { unwrap } from "./turn-replay";
export function setupReplay() {
    const context = setupContext(), input = setupInput(), initialized = unwrap(createGameWithEvents(input, context));
    let state: GameState = initialized.state;
    const positions = [], steps = [];
    // First/second, two main cuts, two Legend cuts, first mulligan yes, second no.
    for (const [i, optionIndex] of [1, 5, 0, 1, 0, 1, 0].entries()) {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context));
        const observation = unwrap(observe(state, actorId, context));
        positions.push(unwrap(generatePosition(state, actorId, context, `setup-${i}`)));
        const selected = legalActions.find(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === optionIndex)!;
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    }
    for (const kind of ["ROLL_GIG", "CALL_LEGEND", "END_TURN"] as const) {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context));
        const observation = unwrap(observe(state, actorId, context));
        const selected = legalActions.find(a => a.action.kind === kind)!;
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    }
    return { schemaVersion: 1, note: "Real captured setup policy; synthetic card mechanics regression, not official card coverage or gold training data", content: context.content, initialization: input, initialized, positions, steps, finalState: state, finalStateHash: hashReplayState(state) };
}
