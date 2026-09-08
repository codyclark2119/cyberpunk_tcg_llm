import { z } from "zod";
import { CardReferenceSchema, TurnStepSchema, ObservationHashSchema, PlayerIdSchema, ZoneSchema, GigInstanceStateSchema, hashCanonical, failure, success, type GameState, type PlayerId } from "@tcg/domain";
import { validateState, freeze, type EngineContext } from "./state";
import { RulesView } from "./view";
const visibleCard = z.strictObject({ publicId: z.string(), zone: ZoneSchema, ownerSeat: z.number().int(), controllerSeat: z.number().int(), face: z.enum(["UP", "DOWN"]), readiness: z.enum(["READY", "SPENT"]), content: CardReferenceSchema.optional(), damage: z.number().int(), counters: z.record(z.string(), z.number().int()) });
export const PlayerObservationSchema = z.strictObject({ schemaVersion: z.literal(1), viewerSeat: z.number().int(), turn: z.number().int(), activeSeat: z.number().int(), actingSeat: z.number().int(), window: z.enum(["SETUP", "MAIN", "CHOOSE_GIG", "PAYMENT_SELECTION", "RIVAL_REACT", "RESOLVING", "FINISHED"]), resolutionStage: z.string(), step: TurnStepSchema.optional(), outcome: z.strictObject({ winnerSeat: z.number().int(), reason: z.enum(["EMPTY_DRAW", "START_TURN_GIGS"]) }).optional(),
    players: z.array(z.strictObject({ seat: z.number().int(), counts: z.record(ZoneSchema, z.number().int().nonnegative()), streetCred: z.number().int(), cards: z.array(visibleCard), gigs: z.array(z.strictObject({ id: GigInstanceStateSchema.shape.id, dieType: GigInstanceStateSchema.shape.dieType, roll: GigInstanceStateSchema.shape.roll }).extend({ ownerSeat: z.number().int(), controllerSeat: z.number().int(), zone: z.enum(["FIXER", "GIGS"]) })) })),
    // Choice options are exposed through legal actions only after their handler can enforce visibility.
    choice: z.strictObject({ id: z.string(), actorSeat: z.number().int(), kind: z.string(), min: z.number().int(), max: z.number().int() }).nullable()
});
export type PlayerObservation = z.infer<typeof PlayerObservationSchema>;
export function observe(state: GameState, actor: PlayerId, context: EngineContext) {
    const valid = validateState(state, context);
    if (!valid.ok)
        return valid;
    if (!PlayerIdSchema.safeParse(actor).success || !state.players[actor])
        return failure("UNKNOWN_PLAYER", "Viewer is not in match");
    const view = new RulesView(valid.value, context), seat = (id: PlayerId) => state.players[id].seat;
    const players = state.match.playerOrder.map(id => {
        const p = state.players[id];
        const cards = Object.entries(p.zones).flatMap(([zone, refs]) => {
            if (zone === "DECK" || (zone === "HAND" && id !== actor))
                return [];
            return refs.map((cid, index) => {
                const c = state.objects.cards[cid];
                // Face-down public IDs are zone slots, never content-bearing instance IDs.
                const known = c.face === "UP" || (zone === "HAND" && id === actor);
                return { publicId: known ? cid : `seat:${p.seat}:${zone}:${index}`, zone: c.zone.zone, ownerSeat: seat(c.ownerId), controllerSeat: seat(c.controllerId), face: c.face, readiness: c.readiness, ...(known ? { content: { cardId: c.cardId, revision: c.revision } } : {}), damage: c.damage, counters: c.counters };
            });
        });
        return { seat: p.seat, counts: Object.fromEntries(Object.entries(p.zones).map(([k, v]) => [k, v.length])), streetCred: view.getStreetCred(id), cards, gigs: Object.values(state.objects.gigs).filter(g => g.location.playerId === id).sort((a, b) => a.id < b.id ? -1 : 1).map(g => ({ id: g.id, dieType: g.dieType, roll: g.roll, ownerSeat: seat(g.ownerId), controllerSeat: seat(g.controllerId), zone: g.location.zone })) };
    });
    const c = state.resolution.choice;
    return success(freeze(PlayerObservationSchema.parse({ schemaVersion: 1, viewerSeat: seat(actor), turn: state.timing.turn, activeSeat: seat(state.timing.activePlayer), actingSeat: seat(state.timing.actingPlayer), window: state.timing.window, resolutionStage: state.resolution.stage, ...(state.timing.step ? { step: state.timing.step } : {}), ...(state.match.outcome ? { outcome: { winnerSeat: seat(state.match.outcome.winnerId), reason: state.match.outcome.reason } } : {}), players, choice: c ? { id: c.id, actorSeat: seat(c.actorId), kind: c.kind, min: c.min, max: c.max } : null })));
}
export function hashObservation(observation: unknown) { return ObservationHashSchema.parse(hashCanonical(PlayerObservationSchema.parse(observation))); }
