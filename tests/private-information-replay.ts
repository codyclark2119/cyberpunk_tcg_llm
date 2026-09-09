import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { privateContext, privateInput, KIROSHI } from "./private-information-fixture";
import { PSYCHO } from "./combat-restrictions-fixture";
import { unwrap } from "./turn-replay";
/** Actual setup and legal actions, with deterministic semantic choices. Never patches state or RNG. */
export function privateReplay(seed: string, collectPositions = true, callAfter = true) {
    const context = privateContext(), initialization = privateInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = legalActions.find(predicate);
        if (!selected) throw new Error(`Missing private-look action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `private-look-${steps.length}`)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) { const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0; take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    const play = (card: string) => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === card);
        while (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    };
    roll("D4"); sell(); end(); roll("D12"); end(); roll("D6"); sell(); play(PSYCHO); play(KIROSHI);
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && state.objects.cards[o.cardInstanceId].cardId === PSYCHO; })());
    end(); roll("D10"); end(); roll("D8");
    take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === PSYCHO);
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "LEGEND_SLOT" && o.slot === 0; })());
    const learned = state.privateKnowledge![0];
    take(a => a.action.kind === "PASS_REACT");
    while (state.resolution.choice) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    const afterCombat = state;
    if (callAfter) {
        take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === learned.cardInstanceId);
        while (state.resolution.choice) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    }
    return { schemaVersion: 1, note: "Private authoritative replay, NOT model input: Kiroshi full-card review in synthetic constructed support lists; legal setup/equip/attack/look/React/CALL, no patches, not demo legality or human gold", content: context.content, initialization, initialized, steps, positions, learned, afterCombat, finalState: state, finalStateHash: hashReplayState(state), finalStreetCred: state.match.playerOrder.map(id => new RulesView(state, context).getStreetCred(id)) };
}
export const kiroshiReplay = () => privateReplay("private-look-16");
