import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { valueContext, valueInput, INDUSTRIAL, FIELD_OPERATOR } from "./value-conditions-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Constructed legal actions only; ODD is a fully legal alternative choice path used in focused/persistence tests. */
export function valueConditionsReplay(seed = "value-46", mode: "EVEN" | "ODD" = "EVEN", collectPositions = true) {
    const context = valueContext(), initialization = valueInput(seed), initialized = unwrap(createGameWithEvents(initialization, context)); let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error("Missing value replay action at " + state.timing.turn + "/" + state.timing.step);
        const observation = unwrap(observe(state, actorId, context)); if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, "value-" + steps.length)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const choose = (i = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === i);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const actor = state.timing.activePlayer, rival = state.match.playerOrder.find(p => p !== actor)!;
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card-"));
    const play = (card: string) => take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === card);
    const pay = () => { while (state.resolution.choice?.kind === "PAYMENT") { const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(Math.max(0, i)); } };
    roll("D8"); sell(); end(); roll("D4"); end(); roll("D4"); sell();
    const beforeIndustrial = state, gig = Object.values(state.objects.gigs).find(g => g.controllerId === actor && g.dieType === "D8")!;
    if (gig.roll.kind !== "ROLLED" || ![5, 7].includes(gig.roll.currentValue) || new RulesView(state, context).isStreetCredEven(actor)) throw new Error("Frozen seed needs D8 five/seven and odd total before increase");
    const amount = 8 - gig.roll.currentValue - (mode === "ODD" ? 1 : 0);
    play(INDUSTRIAL); const pendingPayment = state; pay(); const pendingTarget = state;
    choose(state.resolution.choice!.options.findIndex(o => o.kind === "GIG" && o.gigInstanceId === gig.id)); const pendingAmount = state;
    choose(state.resolution.choice!.options.findIndex(o => o.kind === "AMOUNT" && o.amount === amount)); const afterIndustrial = state;
    play(FIELD_OPERATOR); const pendingOperatorPayment = state; pay();
    const operator = Object.values(state.objects.cards).find(c => c.controllerId === actor && c.cardId === FIELD_OPERATOR && c.zone.zone === "BATTLEFIELD")!;
    if (!operator || new RulesView(state, context).isStreetCredEven(actor) !== (mode === "EVEN")) throw new Error("Unexpected final live parity");
    return { schemaVersion: 1, note: "Complete Industrial + Field Operator, constructed42-main/three real Legends with existing synthetic Gear fillers. Setup and legal turns only; Industrial chooses a Gig and bounded increase, checks current controlled8+ after adjustment, then Field Operator PLAY consumes current parity. No state/RNG patches; private replay, not human gold.", content: context.content, initialization, initialized, steps, positions, actor, rival, gig: gig.id, operator: operator.id, beforeIndustrial, pendingPayment, pendingTarget, pendingAmount, afterIndustrial, pendingOperatorPayment, finalState: state, finalStateHash: hashReplayState(state), mode };
}
