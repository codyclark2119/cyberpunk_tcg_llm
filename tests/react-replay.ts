import type { GameState, LegalAction } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { SWORDWISE } from "./combat-fixture";
import { reactContext, reactInput, FLOOR_IT, BOMBUS, VIKTOR } from "./react-fixture";
import { KERRY } from "./noncombat-fixture";
import { MANTIS } from "./gear-fixture";
import { unwrap } from "./turn-replay";
/** Normal setup, real Unit/Lag/equip turns and one unresolved attack. No state/RNG patches. */
export function reactReplay(seed = "combat-attack-46", context = reactContext(), branch: "REACT" | "FIGHT" | "GIG" = "REACT") {
    const initialization = reactInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), observation = unwrap(observe(state, actorId, context));
        const selected = legalActions.find(predicate);
        if (!selected) throw new Error(`Missing React replay action at ${state.timing.turn}/${state.timing.step}: hand ${state.players[actorId].zones.HAND.map(id => state.objects.cards[id].cardId).join(", ")}`);
        if (legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `react-${steps.length}`)));
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) {
        const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0;
        take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    const play = (cardId: string) => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === cardId);
        while (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE");
    };
    roll("D4"); sell(); end();
    roll("D12"); sell(); play(KERRY); end();
    roll("D6"); sell(); play(KERRY); end();
    roll("D8"); take(a => a.action.kind === "ACTIVATE_ABILITY"); play(BOMBUS); end();
    roll("D8"); sell(); play(SWORDWISE); play(MANTIS);
    const attacker = Object.values(state.objects.cards).find(c => c.controllerId === state.timing.activePlayer && c.cardId === SWORDWISE && c.zone.zone === "BATTLEFIELD")!.id;
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && o.cardInstanceId === attacker; })());
    end(); roll("D6"); take(a => a.action.kind === "ACTIVATE_ABILITY"); end(); roll("D10");
    const attackPower = new RulesView(state, context).getEffectivePower(attacker);
    take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker);
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === (branch === "GIG" ? "GIG_AREA" : "CARD"); })());
    if (branch !== "GIG") {
    take(a => a.action.kind === "CALL_LEGEND" && state.objects.cards[a.action.cardInstanceId].cardId === VIKTOR);
    while (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE");
    while (state.resolution.searchContinuation) take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD"; })());
    play(FLOOR_IT);
    if (state.timing.step === "TARGET_SELECTION") take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && o.cardInstanceId === attacker; })());
    take(a => a.action.kind === "DECLARE_BLOCKER");
    }
    take(a => a.action.kind === "PASS_REACT");
    while (state.resolution.gigStealContinuation || state.resolution.defeatContinuation) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    return { schemaVersion: 1, note: branch === "GIG" ? "Legal normal turns and strategic Gig steal to MAIN; reviewed real cards in synthetic constructed support deck, not demo/gold" : branch === "FIGHT" ? "React trace extended through automatic Swordwise vs Bombus fight, semantic defeat and MAIN; no position patches" : "Legal setup/normal turns, Swordwise ATTACK, defender Viktor CALL/search, Floor It, Secondhand Bombus, explicit PASS; synthetic support deck with reviewed real cards, not demo deck or gold data; stops before combat resolution", content: context.content, initialization, initialized, steps, positions, attackerId: attacker, attackPower, finalState: state, finalStateHash: hashReplayState(state) };
}
