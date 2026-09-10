import { type GameState } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation } from "@tcg/engine";
import { generatePosition } from "@tcg/training-harness";
import { demoStarterContext, demoStarterInput } from "./demo-starter-fixture";
import { unwrap } from "./turn-replay";
export function demoSetupReplay() {
    const context = demoStarterContext(), input = demoStarterInput("demo-setup-14"), initialized = unwrap(createGameWithEvents(input, context));
    let state: GameState = initialized.state;
    // Only the genuine FIRST/SECOND strategic decision is a contract TrainingPosition.
    // This fixture is never promoted to training data or human gold.
    const positions = [unwrap(generatePosition(state, state.timing.actingPlayer, context, "demo-setup-first-second"))], steps = [];
    // SECOND; rival main cuts; rival Legend cuts; first player's whole-hand mulligan.
    // Stop at second player's mulligan: completing it would automatically start turn 1.
    for (const optionIndex of [1, 5, 0, 1, 0, 1]) {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context));
        const observation = unwrap(observe(state, actorId, context));
        const selected = legalActions.find(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === optionIndex);
        if (!selected) throw new Error("Expected setup action absent");
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        if (state.timing.turn !== 0 || !state.setup) throw new Error("Demo setup fixture must stop before gameplay");
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    }
    return { schemaVersion: 1, note: "demo-setup ONLY: exact real fixed pair; application-selected Comprehensive setup order and opposed d20. Stops before normal gameplay. Engine contract fixture, not gameplay/training/gold.", content: context.content, initialization: input, initialized, positions, steps, finalState: state, finalStateHash: hashReplayState(state) };
}
