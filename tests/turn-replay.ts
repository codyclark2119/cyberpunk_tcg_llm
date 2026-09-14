import { type GameState, type GameAction, type Result } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashObservation, hashPosition } from "@tcg/engine";
import { generatePosition } from "@tcg/training-harness";
import { turnContext, turnInput } from "./turn-fixture";
import { selectReplayAction } from "./replay-selection";
export function unwrap<T>(r: Result<T>): T { if (!r.ok)
    throw new Error(JSON.stringify(r.errors)); return r.value; }
export function turnReplay() {
    const context = turnContext(), input = turnInput(), initialized = unwrap(createGameWithEvents(input, context));
    let state: GameState = initialized.state;
    const positions = [unwrap(generatePosition(state, state.timing.actingPlayer, context, "slice-gig-choice"))];
    const sequence: GameAction["action"]["kind"][] = ["ROLL_GIG", "SELL_CARD", "CALL_LEGEND", "CHOOSE", "END_TURN", "ROLL_GIG", "END_TURN"];
    const steps = sequence.map((kind, index) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), observation = unwrap(observe(state, actorId, context));
        const selected = selectReplayAction(legalActions, a => {
            if (a.action.kind !== kind)
                return false;
            if (index === 0 && (a.action.kind !== "ROLL_GIG" || !a.action.gigInstanceId.endsWith("D8")))
                return false;
            if (a.action.kind === "CHOOSE") {
                const option = state.resolution.choice?.options[a.action.optionIndices[0]];
                return option?.kind === "PAYMENT" && option.source.kind === "EDDIE";
            }
            return true;
        });
        if (!selected)
            throw new Error(`Missing replay action ${kind}`);
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        if (index === 0 || index === 2)
            positions.push(unwrap(generatePosition(state, actorId, context, index === 0 ? "slice-main-choice" : "slice-payment-choice")));
        return { actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step };
    });
    return { schemaVersion: 1, note: "Synthetic gameplay slice regression; private replay data, not model input or gold training data", content: context.content, initialization: input, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state) };
}
