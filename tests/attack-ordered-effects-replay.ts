import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { orderedContext, orderedInput, EVELYN } from "./attack-ordered-effects-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Constructed setup and actual enumerated player actions only. No state/RNG edits. */
export function orderedReplay(seed: string, collectPositions = true) {
    const context = orderedContext(), initialization = orderedInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing ordered-effect action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `ordered-${steps.length}`)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) { const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0; take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    roll("D12");
    take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === EVELYN);
    while (state.resolution.choice) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    take(a => a.action.kind === "END_TURN"); roll("D4"); take(a => a.action.kind === "END_TURN"); roll("D10");
    take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === EVELYN);
    if (state.timing.step !== "DISCARD_SELECTION") throw new Error("Seed must produce the true-condition strategic discard");
    take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    take(a => a.action.kind === "PASS_REACT");
    return { schemaVersion: 1, note: "Private authoritative replay, not model input or human gold. Complete Evelyn in synthetic constructed lists: legal play/payment/Lag/attack/draw/conditional own-hand discard/React/zero-power steal/MAIN; no patches; not demo legality.", content: context.content, initialization, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state), finalStreetCred: state.match.playerOrder.map(id => new RulesView(state, context).getStreetCred(id)) };
}
export const evelynReplay = () => orderedReplay("ordered-0");
