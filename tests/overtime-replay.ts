import { type GameState, type LegalAction } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { overtimeContext, overtimeInput } from "./overtime-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
/** Constructed support only. Every transition comes from legal enumeration; no state/RNG/card patches. */
export function overtimeReplay() {
    const context = overtimeContext(), input = overtimeInput(), initialized = unwrap(createGameWithEvents(input, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [], boundaries: Record<string, GameState> = {};
    const actions = () => unwrap(listLegalActions(state, state.timing.actingPlayer, context));
    function take(predicate: (a: LegalAction) => boolean) {
        const actorId = state.timing.actingPlayer, legalActions = actions(), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Expected legal overtime action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (!state.setup || state.setup.stage === "FIRST_PLAYER" || state.setup.stage === "MULLIGAN")
            positions.push(unwrap(generatePosition(state, actorId, context, `overtime-${steps.length}`)));
        const action = { actorId, action: selected.action }, result = unwrap(applyAction(state, action, context));
        state = result.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: result.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    }
    while (state.setup) {
        const index = state.setup.stage === "FIRST_PLAYER" && state.setup.decidingSeat !== 0 ? 1 : 0;
        take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    }
    const p0 = state.match.playerOrder[0];
    for (let guard = 0; !state.match.outcome; guard++) {
        if (guard > 120 || state.timing.turn > 32) throw new Error("Bounded overtime script failed: " + JSON.stringify({ turn: state.timing.turn, overtime: state.match.overtime, eddies: state.players[p0].zones.EDDIES.length, unitZones: Object.values(state.objects.cards).filter(c => c.cardId === "emergency-atlus" && c.ownerId === p0).map(c => c.zone.zone) }));
        if (state.timing.step === "CHOOSE_GIG") take(a => a.action.kind === "ROLL_GIG");
        if (state.timing.step !== "MAIN") throw new Error("Expected ordinary main phase");
        if (state.timing.emptyFixerStarts === 0) boundaries.progress0 ??= state;
        if (state.timing.emptyFixerStarts === 1) boundaries.progress1 ??= state;
        if (state.timing.emptyFixerStarts === 2) boundaries.entryPending ??= state;
        if (state.match.overtime) boundaries.active ??= state;
        const mine = state.timing.activePlayer === p0;
        let unit = state.players[p0].zones.BATTLEFIELD.find(id => state.objects.cards[id].cardId === "emergency-atlus");
        if (mine && !unit) {
            if (state.players[p0].zones.EDDIES.length < 3 && actions().some(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId !== "emergency-atlus"))
                take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId !== "emergency-atlus");
            if (actions().some(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === "emergency-atlus")) {
                take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === "emergency-atlus");
                while (state.resolution.choice) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
                unit = state.players[p0].zones.BATTLEFIELD.find(id => state.objects.cards[id].cardId === "emergency-atlus");
            }
        }
        if (mine && state.match.overtime && unit && actions().some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit)) {
            boundaries.beforeAttack = state;
            take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === unit);
            if ((state as GameState).timing.step === "ATTACK_TARGET_SELECTION")
                take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"; })());
            take(a => a.action.kind === "PASS_REACT");
            boundaries.beforeSteal = state;
            while (state.resolution.gigStealContinuation) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
            if (!state.match.outcome) throw new Error("Seventh Gig must end overtime immediately");
        } else take(a => a.action.kind === "END_TURN");
    }
    return { schemaVersion: 1, note: "Bounded standard overtime contract replay using existing constructed support and Emergency Atlus. No exact Demo gameplay, new revisions, state/RNG patches or human gold.", content: context.content, initialization: input, initialized, positions, steps, boundaries, finalState: state, finalStateHash: hashReplayState(state) };
}
