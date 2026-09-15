import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { goroContext, goroInput, GORO } from "./goro-fixture";
import { V } from "./field-legends-fixture";
import { SATORI } from "./combat-triggers-fixture";
import { MANTIS } from "./gear-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Setup and legal actions only. Both CALLs choose public slot 1 without inspecting hidden identities. */
export function goroReplay(seed = "goro-26", collectPositions = true) {
    const context = goroContext(), initialization = goroInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error("Missing Goro replay action at " + state.timing.turn + "/" + state.timing.step);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, "goro-" + steps.length)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const choose = (index = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const actor = state.timing.activePlayer, rival = state.match.playerOrder.find(p => p !== actor)!;
    const legend = state.players[actor].zones.LEGENDS[0], enemy = state.players[rival].zones.LEGENDS[0];
    const roll = () => take(a => a.action.kind === "ROLL_GIG");
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId !== MANTIS);
    const pay = () => { while (state.resolution.choice?.kind === "PAYMENT") { const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(Math.max(0, i)); } };
    const equip = (host: typeof legend, cardId = MANTIS) => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === cardId); pay();
        if (state.resolution.choice?.kind !== "TARGET") throw new Error("Expected legal pre-equip choice");
        choose(state.resolution.choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host));
    };
    roll(); sell(); take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === legend); pay();
    if (state.objects.cards[legend].cardId !== GORO) throw new Error("Frozen seed requires blind slot 1 CALL to reveal Goro");
    const calledLegend = state;
    end(); roll(); sell(); take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === enemy); pay();
    if (state.objects.cards[enemy].cardId !== V) throw new Error("Frozen seed requires rival blind slot 1 CALL to reveal V");
    end(); roll(); sell(); equip(legend); const preEquippedLegend = state;
    end(); roll(); sell(); equip(enemy, SATORI);
    end(); roll(); sell(); const beforeGoSolo = state;
    take(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === legend); const pendingEntry = state; pay(); const fieldEntry = state;
    take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === legend);
    if (state.timing.step === "ATTACK_TARGET_SELECTION") choose(state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"));
    take(a => a.action.kind === "PASS_REACT"); while (state.resolution.choice) choose(); const afterAttack = state;
    end(); roll(); sell(); take(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === enemy); pay();
    end(); roll(); end(); roll();
    take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === enemy);
    if (state.timing.step === "ATTACK_TARGET_SELECTION") choose(state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"));
    const beforeBlocker = state;
    take(a => a.action.kind === "DECLARE_BLOCKER" && a.action.cardInstanceId === legend); const afterBlocker = state;
    take(a => a.action.kind === "PASS_REACT"); const pendingDefeat = state;
    while (state.resolution.choice) choose(); const afterDefeat = state;
    if (state.objects.cards[legend].zone.zone !== "REMOVED") throw new Error("Headline must finish Goro's Blocker defeat/removal");
    return { schemaVersion: 1, note: "Private authoritative replay, not model input or human gold. Legal constructed synthetic support decks, blind CALL slot1 for real Goro/V, pre-equip real Mantis/Satori in LEGENDS, Goro Go Solo and same-turn attack, rival V Go Solo, natural Goro readiness, printed Blocker redirect into stronger V, owner Trash order and Legend removal. No state/RNG patches. Not a teaching-deck match.", content: context.content, initialization, initialized, steps, positions, legend, enemy, calledLegend, preEquippedLegend, beforeGoSolo, pendingEntry, fieldEntry, afterAttack, beforeBlocker, afterBlocker, pendingDefeat, afterDefeat, finalState: state, finalStateHash: hashReplayState(state) };
}
