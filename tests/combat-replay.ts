import type { GameState, LegalAction } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { combatContext, combatInput, SWORDWISE } from "./combat-fixture";
import { KERRY } from "./noncombat-fixture";
import { MANTIS } from "./gear-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Normal setup, real Unit/Lag/equip turns and one unresolved attack. No state/RNG patches. */
export function combatReplay(seed = "combat-attack-46") {
    const context = combatContext(), initialization = combatInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), observation = unwrap(observe(state, actorId, context));
        const selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing combat replay action at ${state.timing.turn}/${state.timing.step}`);
        if (legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `combat-${steps.length}`)));
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
    roll("D8"); take(a => a.action.kind === "ACTIVATE_ABILITY"); end();
    roll("D8"); sell(); play(SWORDWISE); play(MANTIS);
    const attacker = Object.values(state.objects.cards).find(c => c.controllerId === state.timing.activePlayer && c.cardId === SWORDWISE && c.zone.zone === "BATTLEFIELD")!.id;
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && o.cardInstanceId === attacker; })());
    end(); roll("D6"); take(a => a.action.kind === "ACTIVATE_ABILITY"); end(); roll("D10");
    const attackPower = new RulesView(state, context).getEffectivePower(attacker);
    take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker);
    take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "CARD"; })());
    return { schemaVersion: 1, note: "Reviewed Swordwise ATTACK with Mantis power condition; real Kerry play/Lag/Spend supplies rival Unit target; legal setup/turns, synthetic support deck, not gold data; stops at unsupported Rival React", content: context.content, initialization, initialized, steps, positions, attackerId: attacker, attackPower, finalState: state, finalStateHash: hashReplayState(state) };
}
