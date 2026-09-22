import type { CardInstanceId, GameAction, GameEvent, GameState, LegalAction } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashReplayState, listLegalActions, validateState, type EngineContext } from "@tcg/engine";
import { DETONATE, batchV5Context, batchV5Input } from "./api-admission-batch-v5-fixture";
import { must } from "./api-admission-batch-v4-replay";
import { selectReplayAction } from "./replay-selection";

export type BatchV5Mode = "MAIN" | "REACT";
export type BatchV5Step = { before: GameState; after: GameState; action: GameAction; actionId: string; legalActions: LegalAction[]; events: GameEvent[] };
const HOST = "swordwise-huscle", GEAR = ["mantis-blades", "satori-sword-of-saburo"];
const SEEDS = { MAIN: "legal-v5-5", REACT: "legal-v5-3" } as const;

/** Legal initialization, normal turns, selling, paid plays and equips only.
 * The immutable real Detonate revision is used with existing constructed support.
 * Semantic action selection never depends on opaque actionId ordering.
 * Reloading the genuine two-target pause is part of the trajectory itself. */
export function batchV5Replay(mode: BatchV5Mode, seed: string = SEEDS[mode], context: EngineContext = batchV5Context(),
    options: { actionOrder?: "ENGINE" | "REVERSED" } = {}) {
    const initialization = batchV5Input(seed), initialized = must(createGameWithEvents(initialization, context));
    let state = initialized.state;
    const steps: BatchV5Step[] = [];
    const legal = () => {
        const actions = must(listLegalActions(state, state.timing.actingPlayer, context));
        // Test-only order perturbation: preserve every authoritative action/token and never mutate the engine list.
        return options.actionOrder === "REVERSED" ? [...actions].reverse() : actions;
    };
    const available = (predicate: (a: LegalAction) => boolean) => legal().some(predicate);
    const take = (predicate: (a: LegalAction) => boolean) => {
        const before = state, legalActions = legal(), selected = selectReplayAction(legalActions, predicate);
        if (!selected) throw new Error(`Missing Batch V5 ${mode} action at ${state.timing.turn}/${state.timing.step}`);
        const action = { actorId: selected.actorId, action: selected.action }, result = must(applyAction(state, action, context));
        state = result.state;
        const step = { before, after: state, action, actionId: selected.actionId, legalActions, events: result.events };
        steps.push(step);
        return step;
    };
    const choose = (index: number) => take(a => a.action.kind === "CHOOSE" && a.action.optionIndices[0] === index);
    const pay = () => {
        while (state.resolution.choice?.kind === "PAYMENT") {
            const index = state.resolution.choice.options.findIndex(o => o.kind === "PAYMENT" && o.source.kind === "EDDIE");
            choose(Math.max(index, 0));
        }
    };
    const settle = (hostId?: CardInstanceId) => {
        for (let count = 0; state.resolution.choice; count++) {
            if (count >= 40) throw new Error("Batch V5 choice guard exhausted");
            const choice = state.resolution.choice;
            if (choice.kind === "PAYMENT") { pay(); continue; }
            let index = hostId ? choice.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === hostId) : -1;
            if (index < 0) index = choice.options.findIndex(o => o.kind === "MODE" && o.mode === "KEEP");
            choose(Math.max(index, 0));
        }
    };
    while (state.setup) choose(state.setup.stage === "FIRST_PLAYER" && state.timing.actingPlayer !== state.match.playerOrder[0] ? 1 : 0);
    const [actor, rival] = state.match.playerOrder;
    const owner = mode === "MAIN" ? rival : actor, caster = mode === "MAIN" ? actor : rival;
    const play = (cardId: string) => (a: LegalAction) => a.action.kind === "PLAY_CARD" && state.objects.cards[a.action.cardInstanceId].cardId === cardId;
    const host = () => Object.values(state.objects.cards).find(c => c.controllerId === owner && c.cardId === HOST && c.zone.zone === "BATTLEFIELD");
    const sell = (a: LegalAction) => a.action.kind === "SELL_CARD" && ![DETONATE, HOST, ...GEAR].includes(state.objects.cards[a.action.cardInstanceId].cardId);
    const cast = () => {
        const beforeSource = state, sourceStep = take(play(DETONATE)), pendingPayment = state;
        const sourceAction = sourceStep.action.action;
        if (sourceAction.kind !== "PLAY_CARD") throw new Error("Expected Detonate PLAY_CARD");
        const sourceId = sourceAction.cardInstanceId;
        pay();
        const pausedTarget = state, equipped = host();
        if (!equipped || pausedTarget.resolution.choice?.kind !== "TARGET" || pausedTarget.resolution.choice.options.length !== 2)
            throw new Error("V5 legal replay must reach exactly two attached rival Gear targets");
        const hostId = equipped.id;
        const chosenId = equipped.attachments.find(id => state.objects.cards[id].cardId === GEAR[0]);
        const siblingId = equipped.attachments.find(id => state.objects.cards[id].cardId === GEAR[1]);
        if (!chosenId || !siblingId) throw new Error("V5 legal replay requires paid Mantis and Satori equips");
        state = must(validateState(JSON.parse(JSON.stringify(pausedTarget)), context));
        const resumedTarget = state;
        const index = state.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === chosenId);
        if (index < 0) throw new Error("Mantis is absent from real Detonate target enumeration");
        const resolvedStep = choose(index);
        return { mode, seed, context, initialization, initialized, steps, actor, rival, owner, caster, hostId, sourceId, chosenId, siblingId,
            beforeSource, pendingPayment, pausedTarget, resumedTarget, resolvedStep, finalState: state, finalStateHash: hashReplayState(state) };
    };
    for (let turns = 0; turns < 12 && !state.match.outcome; turns++) {
        take(a => a.action.kind === "ROLL_GIG"); settle();
        if (available(sell)) take(sell);
        if (state.timing.activePlayer === owner) {
            if (!host() && available(play(HOST))) { take(play(HOST)); settle(); }
            for (const gearId of GEAR) {
                const equipped = host();
                if (equipped && !equipped.attachments.some(id => state.objects.cards[id].cardId === gearId) && available(play(gearId))) {
                    take(play(gearId)); settle(equipped.id);
                }
            }
        }
        const equipped = host();
        if (equipped?.attachments.length === 2) {
            if (mode === "MAIN" && state.timing.activePlayer === caster && available(play(DETONATE))) return cast();
            const attack = (a: LegalAction) => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === equipped.id;
            if (mode === "REACT" && state.timing.activePlayer === owner && available(attack)
                && state.players[caster].zones.HAND.some(id => state.objects.cards[id].cardId === DETONATE)) {
                take(attack); settle();
                if (state.timing.combat.stage !== "RIVAL_REACT" || state.timing.actingPlayer !== caster)
                    throw new Error("Expected the defender's legal React decision");
                return cast();
            }
        }
        take(a => a.action.kind === "END_TURN");
    }
    throw new Error(`Batch V5 ${mode} seed did not reach a paid two-target Detonate play`);
}
