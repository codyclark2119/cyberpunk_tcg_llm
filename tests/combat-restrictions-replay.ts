import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { restrictionsContext, restrictionsInput, REBOOT, CORPO, FLATHEAD, PSYCHO, ATLUS } from "./combat-restrictions-fixture";
import { unwrap } from "./turn-replay";
import { selectReplayAction } from "./replay-selection";
export type RestrictionReplayKind = "PREVENTION" | "PREVENTION_EXPIRATION" | "RESTRICTION" | "VANILLA";
/** Fully legal setup and ordinary turns. Seed authoring is deterministic; no position/RNG patching. */
export function restrictionReplay(kind: RestrictionReplayKind, seed: string, collectPositions = true) {
    const context = restrictionsContext(), initialization = restrictionsInput(seed), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context));
        const selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing ${kind} action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `${kind.toLowerCase()}-${steps.length}`)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context));
        state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) {
        const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0;
        take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    const play = (card: string) => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === card);
        while (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    };
    const attack = (card: string, target: "CARD" | "GIG_AREA") => {
        take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === card);
        if (state.timing.step === "ATTACK_TARGET_SELECTION") take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === target; })());
    };
    const finish = () => {
        take(a => a.action.kind === "PASS_REACT");
        while (state.resolution.gigStealContinuation || state.resolution.defeatContinuation) take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    };
    roll("D4"); sell(); end();
    roll("D12"); sell(); play(kind === "VANILLA" ? ATLUS : CORPO); end();
    roll("D6"); sell(); play(kind === "RESTRICTION" ? FLATHEAD : PSYCHO); end();
    roll("D10"); sell();
    if (kind === "VANILLA") { attack(ATLUS, "GIG_AREA"); finish(); }
    end(); roll("D8");
    attack(kind === "RESTRICTION" ? FLATHEAD : PSYCHO, kind === "VANILLA" ? "CARD" : "GIG_AREA");
    if (kind === "PREVENTION" || kind === "PREVENTION_EXPIRATION") play(REBOOT);
    if (kind === "PREVENTION") take(a => a.action.kind === "DECLARE_BLOCKER");
    if (kind === "RESTRICTION") {
        const actions = unwrap(listLegalActions(state, state.timing.actingPlayer, context));
        if (actions.some(a => a.action.kind === "DECLARE_BLOCKER") || !["CALL_LEGEND", "PLAY_CARD", "PASS_REACT"].every(k => actions.some(a => a.action.kind === k))) throw new Error("Seed must exercise unblockability with other reactions available");
        take(a => a.action.kind === "CALL_LEGEND");
        while (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === 0);
    }
    finish();
    if (kind === "PREVENTION_EXPIRATION") { end(); take(a => a.action.kind === "ROLL_GIG"); }
    return { schemaVersion: 1, note: `${kind}: reviewed real cards in synthetic constructed support decks, not demo legality or human gold; legal setup/turns, no state/RNG patches`, content: context.content, initialization, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state), finalStreetCred: state.match.playerOrder.map(id => new RulesView(state, context).getStreetCred(id)) };
}
export const preventionReplay = () => restrictionReplay("PREVENTION", "restrictions-13");
export const preventionExpirationReplay = () => restrictionReplay("PREVENTION_EXPIRATION", "restrictions-13", false);
export const permissionsReplay = () => restrictionReplay("RESTRICTION", "restrictions-28");
export const vanillaReplay = () => restrictionReplay("VANILLA", "restrictions-13");
