import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { saburoContext, saburoInput, SABURO } from "./saburo-fixture";
import { YORINOBU } from "./yorinobu-fixture";
import { GORO } from "./goro-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Setup and legal actions only. CALLs choose public slots 1, 2 and 3 without inspecting hidden identities. */
export function saburoReplay(seed = "saburo-1", collectPositions = true) {
    // Reviewed scenario dice, one Gig roll per turn. Pinned so canonical selection cannot change the trajectory.
    const SABURO_DICE = ["D8", "D6", "D6", "D12", "D10", "D10", "D12"] as const;
    const context = saburoContext(), initialization = saburoInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error("Missing Saburo replay action at " + state.timing.turn + "/" + state.timing.step);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, "saburo-" + steps.length)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const choose = (index = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const actor = state.timing.activePlayer, rival = state.match.playerOrder.find(p => p !== actor)!;
    const legend = state.players[actor].zones.LEGENDS[0], host = state.players[actor].zones.LEGENDS[1], yorinobu = state.players[actor].zones.LEGENDS[2];
    const choice = () => state.resolution.choice;
    const roll = () => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith("-" + SABURO_DICE[state.timing.turn - 1]));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId !== "mantis-blades");
    const pay = (preferSaburo = false) => { while (choice()?.kind === "PAYMENT") {
        const preferred = preferSaburo ? choice()!.options.findIndex(o => o.kind === "PAYMENT" && o.source.cardInstanceId === legend) : -1;
        const eddie = choice()!.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(preferred >= 0 ? preferred : Math.max(0, eddie));
    } };
    roll(); sell(); take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === legend); pay();
    if (state.objects.cards[legend].cardId !== SABURO) throw new Error("Frozen seed requires blind slot1 CALL to reveal Saburo");
    const calledLegend = state;
    end(); roll(); end(); roll(); sell(); take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === host); pay();
    if (state.objects.cards[host].cardId !== GORO) throw new Error("Frozen seed requires blind slot2 CALL to reveal Goro");
    take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === "mantis-blades"); pay(true);
    choose(choice()!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host)); const preEquipped = state;
    end(); roll(); end(); roll(); sell(); take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === yorinobu); pay();
    if (state.objects.cards[yorinobu].cardId !== YORINOBU) throw new Error("Frozen seed requires blind slot3 CALL to reveal Yorinobu");
    end(); roll(); end(); roll(); sell(); const beforeGoSolo = state;
    take(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === host); const pendingEntry = state; pay(true); const beforeAttack = state;
    take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === host);
    if (state.timing.step === "ATTACK_TARGET_SELECTION") choose(choice()!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"));
    const pendingAttack = state; while (choice()) choose(); const beforeReact = state;
    take(a => a.action.kind === "PASS_REACT"); const pendingSteal = state;
    if (state.timing.step !== "GIG_STEAL_SELECTION") throw new Error("Headline requires strategic two-Gig selection from at least three Gigs");
    choose(); const selectedFirst = state; while (choice()) choose();
    return { schemaVersion: 1, note: "Private authoritative replay, not model input or human gold. Constructed42-main/three real Legends, existing synthetic Gear fillers. Blind CALL slots1/2/3 reveal Saburo/Goro/Yorinobu. Pre-equip real Mantis, spend face-up Saburo for legal payment, Go Solo Goro, Yorinobu first-attack draw/conditional discard, persistent Saburo power9→10 through React and actual allowance2 steal, strategic selections, cleanup power9. No state/RNG patches or physical teaching-deck padding.", content: context.content, initialization, initialized, steps, positions, actor, rival, legend, host, yorinobu, calledLegend, preEquipped, beforeGoSolo, pendingEntry, beforeAttack, pendingAttack, beforeReact, pendingSteal, selectedFirst, finalState: state, finalStateHash: hashReplayState(state) };
}
