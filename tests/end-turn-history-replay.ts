import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { endTurnContext, endTurnInput, DELAMAIN } from "./end-turn-history-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Legal setup/player actions only, including paying with actual sold Eddies. */
export function endTurnReplay(seed: string, collectPositions = true) {
    const context = endTurnContext(), initialization = endTurnInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing end-turn action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `end-turn-${steps.length}`)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) { const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0; take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD");
    const play = () => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === DELAMAIN);
        while (state.resolution.choice) {
            const options = state.resolution.choice.options;
            const i = options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
            take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === Math.max(0, i));
        }
    };
    roll("D4"); sell(); end(); roll("D12"); end(); roll("D6"); sell(); play(); end(); roll("D10"); end(); roll("D8");
    take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === DELAMAIN);
    take(a => a.action.kind === "PASS_REACT");
    while (state.resolution.choice) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    play();
    const beforeEndTurn = state; end(); const pendingEndTurn = state;
    if (state.timing.step !== "EDDIE_READY_SELECTION") throw new Error("Headline requires strategic Eddie readiness");
    take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    return { schemaVersion: 1, note: "Private authoritative replay, not model input or human gold: two actual Delamain plays, this-Unit combat steal, own-turn end ready1 selection and next TURN_START. Constructed synthetic support, no state/RNG patches; Dying Night unadmitted.", content: context.content, initialization, initialized, steps, positions, beforeEndTurn, pendingEndTurn, finalState: state, finalStateHash: hashReplayState(state) };
}
export const delamainReplay = () => endTurnReplay("end-turn-8");
