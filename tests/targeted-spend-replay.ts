import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { spendContext, spendInput, SURVEILLANCE } from "./targeted-spend-fixture";
import { DEXTER } from "./combat-triggers-fixture";
import { selectReplayAction } from "./replay-selection";
import { unwrap } from "./turn-replay";
/** Complete legal setup/actions only. Trusted arrangement helpers are never imported. */
export function targetedSpendReplay(seed = "defeat-0") {
    const context = spendContext(), initialization = spendInput(seed), initialized = unwrap(createGameWithEvents(initialization, context)); let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error("Missing spend replay action at " + state.timing.turn + "/" + state.timing.step);
        const observation = unwrap(observe(state, actorId, context));
        if (legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, "targeted-spend-" + steps.length)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const choose = (i = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === i);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const actor = state.match.playerOrder[0], rival = state.match.playerOrder[1], afterSetup = state;
    const play = (id: string) => take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === id);
    const pay = () => { while (state.resolution.choice?.kind === "PAYMENT") { const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(Math.max(i, 0)); } };
    const finish = () => { let n = 0; while (state.resolution.choice) {
        if (++n > 30) throw new Error("Unfinished replay setup effect");
        const c = state.resolution.choice, i = c.kind === "PAYMENT" ? c.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE") : c.options.findIndex(o => o.kind === "MODE" && o.mode === "KEEP"); choose(Math.max(i, 0));
    } };
    while (true) {
        const own = state.timing.activePlayer === actor, index = Math.floor((state.timing.turn - 1) / 2), die = (own ? ["D12", "D10", "D8", "D6"] : ["D4", "D6", "D8"])[index];
        take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
        take(a => a.action.kind === "SELL_CARD" && ![SURVEILLANCE, "over-the-edge", "field-operator", "mandibular-upgrade"].includes(state.objects.cards[a.action.cardInstanceId].cardId));
        if (!own && state.timing.turn === 2) { play(DEXTER); finish(); }
        if (!own && state.timing.turn === 4) { play("swordwise-huscle"); finish(); }
        if (!own && state.timing.turn === 6) {
            play("mandibular-upgrade"); pay(); const host = Object.values(state.objects.cards).find(c => c.cardId === DEXTER && c.controllerId === rival && c.zone.zone === "BATTLEFIELD")!;
            choose(state.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host.id));
        }
        if (state.timing.turn === 7) break;
        take(a => a.action.kind === "END_TURN");
    }
    const beforeSource = state, target = Object.values(state.objects.cards).find(c => c.cardId === DEXTER && c.controllerId === rival && c.zone.zone === "BATTLEFIELD")!;
    play(SURVEILLANCE); const pendingPayment = state; pay(); const pendingTarget = state;
    if (state.resolution.choice?.kind !== "TARGET" || state.resolution.choice.options.length < 2 || !target.attachments.length) throw new Error("Headline needs equipped Dexter and a strategic target choice");
    const source = state.resolution.current!.sourceId!;
    choose(state.resolution.choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === target.id));
    if (state.timing.step !== "MAIN" || state.timing.actingPlayer !== actor || state.resolution.choice || state.objects.cards[target.id].zone.zone !== "BATTLEFIELD" || state.objects.cards[target.id].readiness !== "SPENT") throw new Error("Unfinished targeted spend");
    return { schemaVersion: 1, note: "Complete reviewed Corporate Surveillance; legal constructed setup/rolls/sells/plays only. Equipped real Dexter becomes SPENT, stays FIELD, and has no DEFEATED trigger. Existing synthetic support, not human gold; no state/RNG patches.", content: context.content, initialization, initialized, steps, positions, actor, rival, source, target: target.id, gear: target.attachments[0], afterSetup, beforeSource, pendingPayment, pendingTarget, finalState: state, finalStateHash: hashReplayState(state) };
}
