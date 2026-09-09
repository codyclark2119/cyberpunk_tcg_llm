import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { triggersContext, triggersInput, SATORI, DEXTER, JACKIE } from "./combat-triggers-fixture";
import { PSYCHO } from "./combat-restrictions-fixture";
import { SWORDWISE } from "./combat-fixture";
import { unwrap } from "./turn-replay";
export type TriggerReplayKind = "SATORI" | "DEFEATED" | "FIRST_BLUE";
/** Legal setup/turns only, pinned seeds. Synthetic constructed support decks, never padded demo lists. */
export function triggerReplay(kind: TriggerReplayKind, seed: string, collectPositions = true) {
    const context = triggersContext(), initialization = triggersInput(seed, kind === "FIRST_BLUE"), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context));
        const selected = legalActions.find(predicate);
        if (!selected) throw new Error(`Missing ${kind} action at ${state.timing.turn}/${state.timing.step}`);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `${kind.toLowerCase()}-${steps.length}`)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    while (state.setup) { const index = state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0; take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index); }
    const roll = (die: string) => take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
    const end = () => take(a => a.action.kind === "END_TURN");
    const sell = () => take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    const choose = (predicate: (o: NonNullable<GameState["resolution"]["choice"]>["options"][number]) => boolean) => take(a => a.action.kind === "CHOOSE" && predicate(state.resolution.choice!.options[a.action.optionIndices[0]]));
    const resolveAdjust = () => {
        while (state.resolution.triggerContinuation) {
            if (state.resolution.triggerContinuation.phase === "TARGET") choose(o => o.kind === "GIG" && state.objects.gigs[o.gigInstanceId].controllerId === state.timing.actingPlayer);
            else if (state.resolution.triggerContinuation.phase === "AMOUNT") { const options = state.resolution.choice!.options; choose(o => o.kind === "MODE" && o.mode === (options.some(o => o.kind === "MODE" && o.mode === "INCREASE_1") ? "INCREASE_1" : "KEEP")); }
            else choose(o => o.kind === "EFFECT");
        }
    };
    const play = (card: string) => {
        take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === card);
        while (state.timing.step === "PAYMENT_SELECTION") choose(o => o.kind === "PAYMENT");
        if (state.resolution.playContinuation?.phase === "EQUIP") choose(o => o.kind === "CARD" && state.objects.cards[o.cardInstanceId].cardId === SWORDWISE);
        if (card === DEXTER) resolveAdjust();
    };
    const attack = (card: string, target: "CARD" | "GIG_AREA") => {
        take(a => a.action.kind === "DECLARE_ATTACK" && state.objects.cards[a.action.cardInstanceId].cardId === card);
        if (state.timing.step === "ATTACK_TARGET_SELECTION") choose(o => o.kind === "ATTACK_TARGET" && o.target.kind === target);
        if (card === DEXTER) resolveAdjust();
    };
    const finish = () => {
        take(a => a.action.kind === "PASS_REACT");
        while (state.resolution.choice) {
            // This headline needs the original D6 steal to establish Dexter's >=10 difference.
            // Select the gameplay intent explicitly; artifact-dependent actionId ordering is not a fixture policy.
            if (kind === "DEFEATED" && state.resolution.gigStealContinuation) choose(o => o.kind === "GIG" && o.gigInstanceId === "p0-D6");
            else choose(() => true);
        }
    };
    roll("D4"); sell();
    if (kind === "FIRST_BLUE") {
        take(a => a.action.kind === "CALL_LEGEND" && state.objects.cards[a.action.cardInstanceId].cardId === JACKIE);
        while (state.timing.step === "PAYMENT_SELECTION") choose(o => o.kind === "PAYMENT");
        end(); roll("D12"); sell(); end(); roll("D6"); sell(); play(PSYCHO);
        choose(o => o.kind === "CONFIRM" && o.confirmed);
        if (state.resolution.triggerContinuation?.phase === "TARGET") choose(o => o.kind === "GIG" && (() => { const g = state.objects.gigs[o.gigInstanceId]; return g.roll.kind === "ROLLED" && g.roll.currentValue > 1 && g.roll.currentValue <= 3; })());
        const gig = state.objects.gigs[state.resolution.triggerContinuation!.targetGigId!];
        if (gig.roll.kind !== "ROLLED" || gig.roll.currentValue <= 1 || gig.roll.currentValue > 3) throw new Error("Seed needs an actual decrease to minimum");
        choose(o => o.kind === "AMOUNT" && o.amount === (gig.roll.kind === "ROLLED" ? gig.roll.currentValue - 1 : -1));
    } else {
        end(); roll("D12"); sell(); play(DEXTER); end();
        roll("D6"); sell(); play(kind === "SATORI" ? SWORDWISE : PSYCHO);
        if (kind === "SATORI") play(SATORI);
        end(); roll("D10"); sell(); attack(DEXTER, "GIG_AREA"); finish(); end(); roll("D8"); sell();
        if (kind === "SATORI") play(SATORI);
        attack(kind === "SATORI" ? SWORDWISE : PSYCHO, "CARD"); finish();
        if (kind === "DEFEATED" && !steps.some(s => s.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && e.payload.met))) throw new Error("Seed needs actual DEFEATED draw");
    }
    return { schemaVersion: 1, note: `${kind}: complete reviewed cards in synthetic constructed support decks; legal setup/turns, no state/RNG patches, not human gold`, content: context.content, initialization, initialized, steps, positions, finalState: state, finalStateHash: hashReplayState(state), finalStreetCred: state.match.playerOrder.map(id => new RulesView(state, context).getStreetCred(id)) };
}

export const satoriReplay = () => triggerReplay("SATORI", "triggers-60");
export const defeatedReplay = () => triggerReplay("DEFEATED", "triggers-31");
export const firstBlueReplay = () => triggerReplay("FIRST_BLUE", "triggers-0");
