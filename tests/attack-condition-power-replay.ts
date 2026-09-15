import type { GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashObservation, hashPosition, hashReplayState, listLegalActions, observe, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { attackPowerContext, attackPowerInput, LOSING } from "./attack-condition-power-fixture";
import { GORO } from "./goro-fixture";
import { selectReplayAction } from "./replay-selection";
import { unwrap } from "./turn-replay";
/** Legal setup/actions only, including blind CALL slots. No trusted state-arrangement imports. */
export function attackConditionPowerReplay(seed = "saburo-1", collectPositions = true) {
    const context = attackPowerContext(), initialization = attackPowerInput(seed), initialized = unwrap(createGameWithEvents(initialization, context)); let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [];
    const legal = () => unwrap(listLegalActions(state, state.timing.actingPlayer, context));
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = legal(), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error("Missing attack-power replay action at " + state.timing.turn + "/" + state.timing.step);
        const observation = unwrap(observe(state, actorId, context));
        if (collectPositions && legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, "attack-power-" + steps.length)));
        const action = { actorId, action: selected.action }, next = unwrap(applyAction(state, action, context)); state = next.state;
        steps.push({ actorId, action, actionId: selected.actionId, legalActions, observation, events: next.events, stateHash: hashReplayState(state), positionHash: hashPosition(state), observationHash: hashObservation(unwrap(observe(state, state.timing.actingPlayer, context))), step: state.timing.step });
    };
    const choose = (i = 0) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === i);
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const actor = state.match.playerOrder[0], rival = state.match.playerOrder[1], afterSetup = state, slots = [...state.players[actor].zones.LEGENDS];
    const pay = () => { while (state.resolution.choice?.kind === "PAYMENT") { const i = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE"); choose(Math.max(0, i)); } };
    const has = (id: string) => Object.values(state.objects.cards).find(c => c.controllerId === actor && c.cardId === id && c.zone.zone === "BATTLEFIELD");
    let played: GameState | undefined;
    while (state.timing.turn <= 9) {
        take(a => a.action.kind === "ROLL_GIG");
        if (state.timing.activePlayer === actor) {
            take(a => a.action.kind === "SELL_CARD" && ![LOSING, "mantis-blades"].includes(state.objects.cards[a.action.cardInstanceId].cardId));
            if (state.timing.turn <= 5) { const slot = slots[(state.timing.turn - 1) / 2]; take(a => a.action.kind === "CALL_LEGEND" && a.action.cardInstanceId === slot); pay(); }
            if (state.timing.turn >= 5 && !has(LOSING) && legal().some(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === LOSING)) {
                take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === LOSING); pay(); played = state;
            }
            const host = has(LOSING);
            if (host && !host.attachments.length && legal().some(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === "mantis-blades")) {
                take(a => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === "mantis-blades"); pay();
                if (state.resolution.choice) choose(state.resolution.choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === host.id));
            }
            if (state.timing.turn === 9) break;
        }
        take(a => a.action.kind === "END_TURN");
    }
    const unit = has(LOSING), fieldLegend = slots.find(id => state.objects.cards[id].cardId === GORO)!;
    if (!played || !unit?.attachments.length || unit.statuses.includes("LAG")) throw new Error("Headline needs legally played ready Losing His Way with Mantis before turn9");
    const source = unit.id, gear = unit.attachments[0], beforeEntry = state;
    take(a => a.action.kind === "GO_SOLO" && a.action.cardInstanceId === fieldLegend); pay(); const beforeAttack = state;
    take(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === source);
    if (state.timing.step === "ATTACK_TARGET_SELECTION") choose(state.resolution.choice!.options.findIndex(o => o.kind === "ATTACK_TARGET" && o.target.kind === "GIG_AREA"));
    const pendingAttack = state;
    const first = state.resolution.choice?.options.findIndex(o => o.kind === "EFFECT" && state.resolution.pending.some(e => e.id === o.effectId && e.sourceId === source));
    if (first !== undefined && first >= 0) choose(first);
    const boosted = state;
    let guard = 0; while (state.resolution.choice) { if (++guard > 30) throw new Error("Unfinished ATTACK effects"); choose(); }
    const beforeReact = state;
    if (new RulesView(state, context).getEffectivePower(source) !== 12) throw new Error("Expected base4+Mantis2+Losing5+Saburo1 during attack");
    take(a => a.action.kind === "PASS_REACT"); const pendingSteal = state;
    if (state.timing.step !== "GIG_STEAL_SELECTION" || new RulesView(state, context).getGigStealAllowance(source) !== 2) throw new Error("Headline requires actual boosted two-Gig allowance");
    while (state.resolution.choice) choose(); const afterAttack = state;
    if (new RulesView(state, context).getEffectivePower(source) !== 11) throw new Error("This-turn+5 must outlive attacking-only+1");
    take(a => a.action.kind === "END_TURN");
    if (state.temporaryModifiers || new RulesView(state, context).getEffectivePower(source) !== 6) throw new Error("Turn cleanup must expire+5 while preserving Mantis");
    return { schemaVersion: 1, note: "Legal constructed setup, blind CALL slots1/2/3 and ordinary plays; real Saburo/Yorinobu/Hands Unclean. Losing His Way with Mantis attacks after all Legends reveal and Hands Unclean goes to field. Shared ATTACK ordering, actual two-Gig steal, post-attack+5, end-turn expiry. Existing synthetic support only; no state/RNG patches or human-gold claim.", content: context.content, initialization, initialized, steps, positions, actor, rival, source, gear, fieldLegend, afterSetup, played, beforeEntry, beforeAttack, pendingAttack, boosted, beforeReact, pendingSteal, afterAttack, finalState: state, finalStateHash: hashReplayState(state) };
}
