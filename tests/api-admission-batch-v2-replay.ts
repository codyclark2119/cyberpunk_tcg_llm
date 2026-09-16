import type { CardInstanceId, GameEvent, GameState, LegalAction, PlayerId } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe } from "@tcg/engine";
import { selectReplayAction } from "./replay-selection";
import { unwrap } from "./turn-replay";
import { ANIMALS_WRECKER, RIDING_NOMAD, ROCKN_ROCKERBOY, batchV2Context, batchV2Input } from "./api-admission-batch-v2-fixture";

export const BATCH_V2_UNITS = [ANIMALS_WRECKER, ROCKN_ROCKERBOY, RIDING_NOMAD] as const;
export type BatchV2Step = { before: GameState; actorId: PlayerId; action: { actorId: PlayerId; action: LegalAction["action"] }; actionId: string; legalActions: LegalAction[]; events: GameEvent[]; stateHash: string; positionHash: string; observationHash: string };

/** Legal setup and turns only, no state/RNG patches. Broad choices resolve through canonical replay selection, never actionId order. */
export function batchV2Replay(seed = "api-admission-batch-v2-1", context = batchV2Context()) {
    const initialization = batchV2Input(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: BatchV2Step[] = [], steals: { cardId: string; attackerId: CardInstanceId; power: number; allowance: number; turn: number }[] = [];
    const legal = () => unwrap(listLegalActions(state, state.timing.actingPlayer, context));
    const available = (predicate: (a: LegalAction) => boolean) => legal().some(predicate);
    const take = (label: string, predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = legal(), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing Batch V2 ${label} action at ${state.timing.turn}/${state.timing.step}`);
        const before = state, action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context));
        state = next.state;
        for (const e of next.events) if (e.payload.kind === "GIG_STEAL_STARTED") {
            const cardId = state.objects.cards[e.payload.attackerId].cardId;
            if ((BATCH_V2_UNITS as readonly string[]).includes(cardId)) steals.push({ cardId, attackerId: e.payload.attackerId, power: e.payload.power, allowance: e.payload.allowance, turn: before.timing.turn });
        }
        steps.push({ before, actorId, action, actionId: selected.actionId, legalActions, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))) });
    };
    const first = (a: LegalAction) => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0;
    const settle = () => { while (!state.match.outcome && state.resolution.choice) take("choice", first); };
    while (state.setup) {
        const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0;
        take("setup", a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    }
    const playable = (card: string) => (a: LegalAction) => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === card;
    const attacker = (card: string) => (a: LegalAction) => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === card;
    const target = (kind: "GIG_AREA" | "CARD") => (a: LegalAction) => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === kind; })();
    const done = () => BATCH_V2_UNITS.every(card => steals.some(s => s.cardId === card));
    for (let turn = 0; turn < 60 && !state.match.outcome && !done(); turn++) {
        settle();
        if (available(a => a.action.kind === "ROLL_GIG")) take("roll", a => a.action.kind === "ROLL_GIG");
        settle();
        if (state.match.outcome) break;
        if (available(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card")))
            take("sell", a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
        for (const card of BATCH_V2_UNITS) if (!state.match.outcome && available(playable(card))) {
            take(`play ${card}`, playable(card));
            while (state.timing.step === "PAYMENT_SELECTION") take("payment", first);
            settle();
        }
        for (const card of BATCH_V2_UNITS) while (!state.match.outcome && available(attacker(card))) {
            take(`attack ${card}`, attacker(card));
            if (state.timing.step === "ATTACK_TARGET_SELECTION") take("attack target", available(target("GIG_AREA")) ? target("GIG_AREA") : target("CARD"));
            if (state.timing.step === "RIVAL_REACT") take("pass react", a => a.action.kind === "PASS_REACT");
            settle();
        }
        if (!state.match.outcome && available(a => a.action.kind === "END_TURN")) take("end", a => a.action.kind === "END_TURN");
    }
    return { seed, initialization, initialized, steps, steals, finalState: state, finalStateHash: hashReplayState(state) };
}
