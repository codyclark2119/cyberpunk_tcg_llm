import type { CardInstanceId, GameState, LegalAction } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, observe, hashReplayState, hashPosition, hashObservation, RulesView } from "@tcg/engine";
import { generatePosition, type TrainingPosition } from "@tcg/training-harness";
import { gearContext, gearInput, MANTIS, VIKTOR, ROYCE } from "./gear-fixture";
import { unwrap } from "./turn-replay";
export function gearReplay() {
    const context = gearContext(), initialization = gearInput("gear-equip-44"), initialized = unwrap(createGameWithEvents(initialization, context));
    let state: GameState = initialized.state;
    const steps: ReturnType<typeof import("./turn-replay").turnReplay>["steps"] = [], positions: TrainingPosition[] = [], searchedGear: CardInstanceId[] = [];
    const take = (predicate: (a: LegalAction) => boolean) => {
        const actorId = state.timing.actingPlayer, legalActions = unwrap(listLegalActions(state, actorId, context)), observation = unwrap(observe(state, actorId, context));
        const selected = legalActions.find(predicate);
        if (!selected) throw new Error(`Missing Gear replay action at ${state.timing.turn}/${state.timing.step}`);
        if (legalActions.length > 1) positions.push(unwrap(generatePosition(state, actorId, context, `gear-${steps.length}`)));
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
    const call = (slug: string) => take(a => a.action.kind === "CALL_LEGEND" && state.objects.cards[a.action.cardInstanceId].cardId === slug);
    const pay = (kind: "EDDIE" | "LEGEND") => {
        if (state.timing.step === "PAYMENT_SELECTION") take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "PAYMENT" && o.source.kind === kind; })());
    };
    roll("D4");
    take(a => a.action.kind === "SELL_CARD" && state.objects.cards[a.action.cardInstanceId].cardId.startsWith("slice-card"));
    call(VIKTOR); pay("EDDIE");
    for (let i = 0; i < 2; i++) {
        take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && state.objects.cards[o.cardInstanceId].cardId === MANTIS; })());
    }
    // Authoritative movement facts identify the physical search results, not a replacement or new instance.
    for (const e of steps.at(-1)!.events) if (e.payload.kind === "CARD_MOVED" && e.payload.to.zone === "HAND" && state.objects.cards[e.payload.cardInstanceId].cardId === MANTIS) searchedGear.push(e.payload.cardInstanceId);
    if (searchedGear.length !== 2) throw new Error("Viktor did not take two real Gear instances");
    end(); roll("D4"); end(); roll("D6"); call(ROYCE); pay("EDDIE");
    const host = Object.values(state.objects.cards).find(c => c.controllerId === state.timing.actingPlayer && c.cardId === ROYCE)!.id;
    const power = [new RulesView(state, context).getEffectivePower(host)];
    for (const id of searchedGear) {
        take(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id); pay("LEGEND");
        take(a => a.action.kind === "CHOOSE" && (() => { const o = state.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "CARD" && o.cardInstanceId === host; })());
        power.push(new RulesView(state, context).getEffectivePower(host));
    }
    return { schemaVersion: 1, note: "Reviewed Mantis Blades searched by Viktor, then the same two instances played and equipped to Royce; legal engine-owned setup/turns; synthetic support deck, not gold data", content: context.content, initialization, initialized, steps, positions, searchedGear, royceId: host, roycePower: power, finalState: state, finalStateHash: hashReplayState(state) };
}
