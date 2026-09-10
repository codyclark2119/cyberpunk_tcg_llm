import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { targetedContext, targetedInput, MINOTAUR, OVER_THE_EDGE } from "./targeted-defeat-fixture";
import { unwrap } from "./turn-replay";
export function targetedDefeatReplay(seed: string, mode: "MINOTAUR" | "OVER_THE_EDGE", record = true) {
    const context = targetedContext(), initialization = targetedInput(seed), initialized = unwrap(createGameWithEvents(initialization, context)); let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), selected = legalActions.find(predicate);
        if (!selected) throw new Error("Missing targeted replay action at " + state.timing.turn + "/" + state.timing.step);
        const observation = record ? unwrap(observe(state, actorId, context)) : null;
        if (record && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, mode + "-" + steps.length)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        if (observation) steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const choose = (i = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === i);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const actor = state.match.playerOrder[0], rival = state.match.playerOrder[1], afterSetup = state;
    const find = (cardId: string, owner = state.timing.activePlayer, zone = "BATTLEFIELD") => Object.values(state.objects.cards).find(c => c.controllerId === owner && c.cardId === cardId && c.zone.zone === zone);
    const play = (id: string) => take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === id);
    const pay = () => { while (state.resolution.choice?.kind === "PAYMENT") { const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(Math.max(i, 0)); } };
    const finish = () => { let n = 0; while (state.resolution.choice) {
        if (++n > 30) throw new Error("Unfinished setup effect");
        const c = state.resolution.choice;
        const i = c.kind === "PAYMENT" ? c.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE") : c.options.findIndex(o => o.kind === "MODE" && o.mode === "KEEP");
        choose(Math.max(i, 0));
    } };
    const lastTurn = mode === "MINOTAUR" ? 7 : 11;
    while (true) {
        const own = state.timing.activePlayer === actor, index = Math.floor((state.timing.turn - 1) / 2), die = (own ? ["D12", "D10", "D8", "D6", "D4", "D20"] : ["D4", "D6", "D8", "D10", "D12", "D20"])[index];
        take(a => a.action.kind === "ROLL_GIG" && a.action.gigInstanceId.endsWith(die));
        take(a => a.action.kind === "SELL_CARD" && ![MINOTAUR, OVER_THE_EDGE, "field-operator", "mandibular-upgrade"].includes(state.objects.cards[a.action.cardInstanceId].cardId));
        if (!own && state.timing.turn === 2) { play("dexter-deshawn-one-last-chance"); finish(); }
        if (!own && state.timing.turn === 4) { play("swordwise-huscle"); finish(); }
        if (!own && state.timing.turn === 6) {
            play("mandibular-upgrade"); pay(); const host = find("dexter-deshawn-one-last-chance", rival)!;
            choose(state.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host.id));
        }
        if (state.timing.turn === lastTurn) break;
        take(a => a.action.kind === "END_TURN");
    }
    const beforePlay = state, target = find("dexter-deshawn-one-last-chance", rival)!;
    if (!target?.attachments.length || new RulesView(state, context).getStreetCred(actor) - new RulesView(state, context).getStreetCred(rival) < 10) throw new Error("Frozen seed needs equipped Dexter and Street Cred difference10+");
    if (mode === "OVER_THE_EDGE") {
        const values = new RulesView(state, context).getControlledD20Values(actor);
        if (!values.some(v => v >= 4)) throw new Error("Frozen D20 must permit multiple Unit targets");
        play("field-operator"); finish();
    }
    const playedId = mode === "MINOTAUR" ? MINOTAUR : OVER_THE_EDGE;
    const beforeSource = state; play(playedId); const pendingPayment = state; pay(); const pendingTarget = state;
    if (state.resolution.choice?.kind !== "TARGET" || state.resolution.choice.options.length < 2) throw new Error("Expected strategic Unit defeat target");
    const source = Object.values(state.objects.cards).find(c => c.cardId === playedId && c.controllerId === actor && (c.zone.zone === "BATTLEFIELD" || c.zone.zone === "RESOLVING_PROGRAM"))!;
    choose(state.resolution.choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === target.id)); const pendingOrder = state;
    if (state.timing.actingPlayer !== rival || state.timing.step !== "DEFEAT_ORDER_SELECTION") throw new Error("Owner order must switch actor to the rival");
    finish();
    if (String(state.timing.step) !== "MAIN" || state.timing.actingPlayer !== actor || state.resolution.choice || state.objects.cards[target.id].zone.zone !== "TRASH") throw new Error("Unfinished targeted defeat");
    return { schemaVersion: 1, note: "Complete reviewed targeted defeat; legal constructed setup/rolls/sells/plays only. Rival equips real Dexter, source defeats through owner-order and DEFEATED draw; no state/RNG patches. Existing synthetic support revisions, not human gold.", content: context.content, initialization, initialized, steps, positions, actor, rival, mode, source: source.id, target: target.id, gear: target.attachments[0], afterSetup, beforePlay, beforeSource, pendingPayment, pendingTarget, pendingOrder, finalState: state, finalStateHash: hashReplayState(state) };
}

export function minotaurReplay() { return targetedDefeatReplay("defeat-0", "MINOTAUR"); }
export function overTheEdgeReplay() { return targetedDefeatReplay("defeat-145", "OVER_THE_EDGE"); }
