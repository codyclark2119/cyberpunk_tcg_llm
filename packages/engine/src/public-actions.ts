import { z } from "zod";
import {
    ModelLegalActionV2Schema,
    PublicActionDescriptorV2Schema,
    PublicChoiceOptionV2Schema,
    failure,
    success,
    type GameState,
    type LegalAction,
    type PlayerId
} from "@tcg/domain";
import { listLegalActions } from "./index";
import { observe, PlayerObservationSchema, type PlayerObservation } from "./observation";
import type { EngineContext } from "./state";

export const ModelInputV2Schema = z.strictObject({
    schemaVersion: z.literal(2),
    observation: PlayerObservationSchema,
    legalActions: z.array(ModelLegalActionV2Schema)
});
export type ModelInputV2 = z.infer<typeof ModelInputV2Schema>;

function observedCards(observation: PlayerObservation) {
    return observation.players.flatMap(player => player.cards);
}
function cardRef(observation: PlayerObservation, cardInstanceId: string) {
    const card = observedCards(observation).find(candidate => candidate.publicId === cardInstanceId);
    return card ? success({ kind: "CARD" as const, publicId: card.publicId }) : failure("UNPROJECTABLE_PUBLIC_ACTION", "Card action source is not public to this viewer");
}
function zoneSlotRef(state: GameState, observation: PlayerObservation, cardInstanceId: string, zone: "EDDIES" | "LEGENDS") {
    const card = state.objects.cards[cardInstanceId];
    if (!card || card.zone.zone !== zone) return failure("UNPROJECTABLE_PUBLIC_ACTION", `Expected ${zone} source`);
    const player = state.players[card.zone.playerId];
    if (!player) return failure("UNPROJECTABLE_PUBLIC_ACTION", `Missing ${zone} owner`);
    const slot = player.zones[zone].indexOf(cardInstanceId);
    if (slot < 0) return failure("UNPROJECTABLE_PUBLIC_ACTION", `Missing ${zone} slot`);
    const publicId = `seat:${player.seat}:${zone}:${slot}`;
    if (!observedCards(observation).some(candidate => candidate.publicId === publicId)) return failure("UNPROJECTABLE_PUBLIC_ACTION", `${zone} slot is not public to this viewer`);
    return success({ kind: "ZONE_SLOT" as const, seat: player.seat, zone, slot });
}
function gigRef(observation: PlayerObservation, gigId: string) {
    const visible = observation.players.some(player => player.gigs.some(gig => gig.id === gigId));
    return visible ? success({ kind: "GIG" as const, gigId }) : failure("UNPROJECTABLE_PUBLIC_ACTION", "Gig is not public to this viewer");
}
function paymentRef(state: GameState, observation: PlayerObservation, cardInstanceId: string, kind: "EDDIE" | "LEGEND") {
    if (kind === "EDDIE") return zoneSlotRef(state, observation, cardInstanceId, "EDDIES");
    const visible = cardRef(observation, cardInstanceId);
    return visible.ok ? visible : zoneSlotRef(state, observation, cardInstanceId, "LEGENDS");
}
function slotChoice(observation: PlayerObservation, zone: "EDDIES" | "LEGENDS", slot: number) {
    const viewer = observation.players.find(player => player.seat === observation.viewerSeat);
    if (!viewer || viewer.counts[zone] <= slot) return failure("UNPROJECTABLE_PUBLIC_ACTION", `${zone} slot is outside the public zone count`);
    return success({ kind: "ZONE_SLOT" as const, seat: observation.viewerSeat, zone, slot });
}
function projectChoiceOption(state: GameState, observation: PlayerObservation, action: LegalAction) {
    if (action.action.kind !== "CHOOSE") return failure("UNPROJECTABLE_PUBLIC_ACTION", "Expected CHOOSE action");
    const choice = state.resolution.choice, index = action.action.optionIndices[0];
    if (!choice || index === undefined || index < 0 || index >= choice.options.length) return failure("UNPROJECTABLE_PUBLIC_ACTION", "Choice option is not available");
    const option = choice.options[index];
    switch (option.kind) {
        case "ATTACK_TARGET": {
            if (option.target.kind === "CARD") return cardRef(observation, option.target.cardInstanceId);
            const target = state.players[option.target.playerId];
            return target ? success({ kind: "GIG_AREA" as const, seat: target.seat }) : failure("UNPROJECTABLE_PUBLIC_ACTION", "Gig-area target player is missing");
        }
        case "CARD":
            if (observation.inspectedCards?.some(card => card.instanceId === option.cardInstanceId)) return success({ kind: "INSPECTED_CARD" as const, inspectedId: option.cardInstanceId });
            return cardRef(observation, option.cardInstanceId);
        case "GIG": return gigRef(observation, option.gigInstanceId);
        case "EDDIE_SLOT": return slotChoice(observation, "EDDIES", option.slot);
        case "LEGEND_SLOT": return slotChoice(observation, "LEGENDS", option.slot);
        case "MODE": return success({ kind: "MODE" as const, value: option.mode });
        case "AMOUNT": return success({ kind: "AMOUNT" as const, value: option.amount });
        case "CONFIRM": return success({ kind: "CONFIRM" as const, value: option.confirmed });
        case "EFFECT":
            return observation.pendingTriggers?.some(effect => effect.id === option.effectId)
                ? success({ kind: "EFFECT" as const, effectId: option.effectId })
                : failure("UNPROJECTABLE_PUBLIC_ACTION", "Effect choice is not present in the public trigger projection");
        case "PAYMENT": return paymentRef(state, observation, option.source.cardInstanceId, option.source.kind);
    }
}

export function projectPublicLegalActionsV2(state: GameState, observation: PlayerObservation, legalActions: readonly LegalAction[]) {
    const projected: z.infer<typeof ModelLegalActionV2Schema>[] = [];
    for (const action of legalActions) {
        const label = action.descriptor.label;
        let descriptor: unknown;
        switch (action.action.kind) {
            case "SELL_CARD":
            case "PLAY_CARD":
            case "GO_SOLO":
            case "DECLARE_ATTACK":
            case "DECLARE_BLOCKER": {
                const source = cardRef(observation, action.action.cardInstanceId);
                if (!source.ok) return source;
                descriptor = { schemaVersion: 2, kind: action.action.kind, label, source: source.value };
                break;
            }
            case "ACTIVATE_ABILITY": {
                const source = cardRef(observation, action.action.sourceInstanceId);
                if (!source.ok) return source;
                descriptor = { schemaVersion: 2, kind: action.action.kind, label, source: source.value, abilityId: action.action.abilityId };
                break;
            }
            case "ROLL_GIG": {
                const source = gigRef(observation, action.action.gigInstanceId);
                if (!source.ok) return source;
                descriptor = { schemaVersion: 2, kind: action.action.kind, label, source: source.value };
                break;
            }
            case "CALL_LEGEND": {
                const source = zoneSlotRef(state, observation, action.action.cardInstanceId, "LEGENDS");
                if (!source.ok) return source;
                descriptor = { schemaVersion: 2, kind: action.action.kind, label, source: source.value };
                break;
            }
            case "CHOOSE": {
                const option = projectChoiceOption(state, observation, action);
                if (!option.ok) return option;
                descriptor = { schemaVersion: 2, kind: action.action.kind, label, choiceKind: state.resolution.choice!.kind, option: PublicChoiceOptionV2Schema.parse(option.value) };
                break;
            }
            case "PASS_REACT":
            case "END_TURN": descriptor = { schemaVersion: 2, kind: action.action.kind, label }; break;
        }
        projected.push(ModelLegalActionV2Schema.parse({ actionId: action.actionId, descriptor: PublicActionDescriptorV2Schema.parse(descriptor) }));
    }
    return success(projected);
}

export function buildModelInputV2(state: GameState, actor: PlayerId, context: EngineContext) {
    const observation = observe(state, actor, context);
    if (!observation.ok) return observation;
    const legal = listLegalActions(state, actor, context);
    if (!legal.ok) return legal;
    const projected = projectPublicLegalActionsV2(state, observation.value, legal.value);
    if (!projected.ok) return projected;
    return success(ModelInputV2Schema.parse({ schemaVersion: 2, observation: observation.value, legalActions: projected.value }));
}
