import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { capabilitiesContext, capabilitiesInput, MANDIBULAR } from "./gear-capabilities-fixture";
import { PSYCHO } from "./combat-restrictions-fixture";
import { SWORDWISE } from "./combat-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Legal setup/actions only. Synthetic constructed support lists, never patched state/RNG or padded demo lists. */
export function capabilityReplay(seed: string, collectPositions = true) {
    const context = capabilitiesContext(), initialization = capabilitiesInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing capability action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `capability-${steps.length}`)));
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
    roll("D4"); sell(); end(); roll("D12"); sell(); play(PSYCHO); end();
    roll("D6"); sell(); play(SWORDWISE); end(); roll("D10"); sell(); play(MANDIBULAR);
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && state.objects.cards[o.cardInstanceId].cardId === PSYCHO; })());
    end(); roll("D8");
    take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === SWORDWISE);
    if (state.timing.step === "ATTACK_TARGET_SELECTION") take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"; })());
    const reaction = unwrap(listLegalActions(state, state.timing.actingPlayer, context));
    if (!["DECLARE_BLOCKER", "CALL_LEGEND", "PLAY_CARD", "PASS_REACT"].every(kind => reaction.some(a => a.action.kind === kind))) throw new Error("Seed needs inherited Blocker, Quick, CALL and PASS choices");
    take(a => a.action.kind === "DECLARE_BLOCKER" && state.objects.cards[a.action.cardInstanceId].cardId === PSYCHO);
    take(a => a.action.kind === "PASS_REACT");
    while (state.resolution.choice) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    return { schemaVersion: 1, note: "Mandibular: complete reviewed Gear in synthetic constructed support lists; legal setup/turns/equip/Blocker/fight, no state/RNG patches, not demo legality or human gold", content: context.content, initialization, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state), finalStreetCred: state.match.playerOrder.map(id => new RulesView(state, context).getStreetCred(id)) };
}

export const mandibularReplay = () => capabilityReplay("capabilities-59");
