import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { delayedContext, delayedInput, DYING_NIGHT } from "./delayed-effects-fixture";
import { DELAMAIN } from "./end-turn-history-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Real reviewed non-V host; named-V positive branches belong only to trusted focused tests. */
export function delayedReplay(seed: string, collectPositions = true) {
    const context = delayedContext(), initialization = delayedInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing delayed action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `delayed-${steps.length}`)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const currentChoice = () => state.resolution.choice;
    const choose = (index = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId !== DYING_NIGHT);
    const play = (id: string) => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === id);
        while (state.resolution.choice) {
            const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(Math.max(0, i));
        }
    };
    roll("D4"); sell(); end(); roll("D12"); end(); roll("D6"); sell(); play(DELAMAIN); end(); roll("D10"); end(); roll("D8"); play(DYING_NIGHT);
    const beforeAttack = state;
    take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === DELAMAIN);
    const pendingAttack = state;
    if (state.timing.step !== "TARGET_SELECTION") throw new Error("Expected Dying Night Gig target choice");
    const target = state.resolution.choice!.options.findIndex(o => { if (o.kind !== "GIG") return false; const roll = state.objects.gigs[o.gigInstanceId].roll; return roll.kind === "ROLLED" && roll.currentValue >= 3; });
    if (target < 0) throw new Error("Seed needs a legal decrease2 target");
    choose(target);
    const amount = state.resolution.choice!.options.findIndex(o => o.kind === "AMOUNT" && o.amount === 2); choose(amount);
    const registeredDuringReact = state;
    take(a => a.action.kind === "PASS_REACT");
    while (state.resolution.choice) choose();
    const registeredDuringMain = state;
    sell();
    const beforeEndTurn = state; end(); const pendingEndTurn = state;
    while (currentChoice()) {
        const i = currentChoice()!.options.findIndex(o => o.kind === "EFFECT" && state.resolution.pending.some(e => e.id === o.effectId && e.trigger?.delayedId)); choose(Math.max(0, i));
    }
    return { schemaVersion: 1, note: "Private authoritative replay, not model input or human gold. Real Delamain hosts Dying Night: legal payment/equip/attack/decrease2/registration/React/steal/MAIN/end-turn false V condition; independent Delamain ready1 and next turn. No state/RNG patches or real V admission.", content: context.content, initialization, initialized, steps, positions, beforeAttack, pendingAttack, registeredDuringReact, registeredDuringMain, beforeEndTurn, pendingEndTurn, finalState: state, finalStateHash: hashReplayState(state) };
}
export const dyingNightReplay = () => delayedReplay("delayed-2");
