import { fieldLegendsEnabled } from "./field-legend-support";
import { capabilitiesEnabled } from "./capability-support";
import { currentCombatRestrictions } from "./combat-permissions";
import { restrictionsEnabled } from "./restriction-support";
import { combatResolutionEnabled } from "./combat-resolution-policy";
import { reactEnabled } from "./react-support";
import { gearEnabled } from "./attachments";
import { z } from "zod";
import { KeywordSchema, FightResultSchema, TriggerBindingSchema, CardReferenceSchema, TemporaryPowerModifierSchema, TurnStepSchema, ObservationHashSchema, PlayerIdSchema, ZoneSchema, GigInstanceStateSchema, hashCanonical, failure, success, type GameState, type PlayerId } from "@tcg/domain";
import { validateState, freeze, type EngineContext } from "./state";
import { RulesView } from "./view";
const visibleCard = z.strictObject({
    effectiveTypes: z.array(z.enum(["LEGEND", "UNIT", "GEAR", "PROGRAM"])).optional(), goSolo: z.literal(true).optional(),
    knownToSeats: z.array(z.number().int().nonnegative()).optional(),
    rememberedContent: CardReferenceSchema.optional(), effectiveKeywords: z.array(KeywordSchema).optional(), restrictions: z.array(z.enum(["CANNOT_ATTACK", "CANNOT_BE_BLOCKED"])).optional(), publicId: z.string(), zone: ZoneSchema, ownerSeat: z.number().int(), controllerSeat: z.number().int(), face: z.enum(["UP", "DOWN"]), readiness: z.enum(["READY", "SPENT"]), lagging: z.boolean().optional(), attachments: z.array(z.string()).optional(), effectivePower: z.number().int().nullable().optional(), content: CardReferenceSchema.optional(), damage: z.number().int(), counters: z.record(z.string(), z.number().int()) });
export const PlayerObservationSchema = z.strictObject({ schemaVersion: z.literal(1), viewerSeat: z.number().int(), turn: z.number().int(), activeSeat: z.number().int(), actingSeat: z.number().int(), window: z.enum(["EDDIE_READY_SELECTION", "DISCARD_SELECTION", "TRIGGER_ORDER_SELECTION", "OPTIONAL_TRIGGER_SELECTION","GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION", "SETUP", "MAIN", "CHOOSE_GIG", "PAYMENT_SELECTION", "TARGET_SELECTION", "AMOUNT_SELECTION", "ATTACK_TARGET_SELECTION", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING", "RESOLVING", "FINISHED"]), resolutionStage: z.string(), step: TurnStepSchema.optional(), outcome: z.strictObject({ winnerSeat: z.number().int(), reason: z.enum(["EMPTY_DRAW", "START_TURN_GIGS"]) }).optional(),
    combat: z.strictObject({ stage: z.enum(["TRIGGER_RESOLUTION","ATTACK_TARGET_SELECTION", "RIVAL_REACT", "COMBAT_RESOLUTION_PENDING", "GIG_STEAL_SELECTION", "DEFEAT_ORDER_SELECTION"]), attackerId: z.string(), attackingSeat: z.number().int(), defendingSeat: z.number().int(), target: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("CARD"), cardInstanceId: z.string() }), z.strictObject({ kind: z.literal("GIG_AREA"), playerSeat: z.number().int() })]).nullable() }).optional(),
    unsupportedCapabilities: z.array(z.enum(["UNSUPPORTED_RIVAL_REACT", "UNSUPPORTED_COMBAT_RESOLUTION"])).optional(),
    gigSteal: z.strictObject({ selectedIds: z.array(z.string()), remaining: z.number().int().positive() }).optional(),
    fightPreventions: z.array(z.strictObject({ id: z.string(), kind: z.literal("PREVENT_NEXT_RIVAL_FIGHT_DEFEAT"), sourceId: z.string(), controllerSeat: z.number().int(), createdTurn: z.number().int(), expiresTurn: z.number().int() })).optional(),
    pendingTriggers: z.array(z.strictObject({ id: z.string(), sourceId: z.string(), subjectId: z.string(), source: CardReferenceSchema, controllerSeat: z.number().int(), kind: TriggerBindingSchema.shape.kind })).optional(),
    fightResult: FightResultSchema.optional(),
    delayedEffects: z.array(z.strictObject({ sourceId: z.string(), source: CardReferenceSchema, subjectId: z.string(), controllerSeat: z.number().int(), createdTurn: z.number().int(), timing: z.literal("END_OF_TURN"), condition: z.literal("SUBJECT_IS_UNIT_NAMED_V"), readyCount: z.literal(2) })).optional(),
    selectedEddieSlots: z.array(z.number().int().nonnegative()).optional(),
    gigSteals: z.array(z.strictObject({ attackerId: z.string(), count: z.number().int().positive() })).optional(),
    turnAttacks: z.array(z.strictObject({ seat: z.number().int(), arasakaUnitAttacks: z.number().int().nonnegative() })).optional(),
    turnPlays: z.array(z.strictObject({ seat: z.number().int(), blueUnitOrGearPlays: z.number().int().nonnegative() })).optional(),
    temporaryModifiers: z.array(TemporaryPowerModifierSchema).optional(),
    inspectedCards: z.array(z.strictObject({ instanceId: z.string(), content: CardReferenceSchema })).optional(),
    players: z.array(z.strictObject({ seat: z.number().int(), counts: z.strictObject({ DECK: z.number().int().nonnegative(), HAND: z.number().int().nonnegative(), BATTLEFIELD: z.number().int().nonnegative(), TRASH: z.number().int().nonnegative(), EDDIES: z.number().int().nonnegative(), LEGENDS: z.number().int().nonnegative(), REMOVED: z.number().int().nonnegative(), RESOLVING_PROGRAM: z.number().int().nonnegative().optional() }), streetCred: z.number().int(), cards: z.array(visibleCard), gigs: z.array(z.strictObject({ id: GigInstanceStateSchema.shape.id, dieType: GigInstanceStateSchema.shape.dieType, roll: GigInstanceStateSchema.shape.roll }).extend({ ownerSeat: z.number().int(), controllerSeat: z.number().int(), zone: z.enum(["FIXER", "GIGS"]) })) })),
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
            if (zone === "DECK")
                return [];
            return (refs ?? []).flatMap((cid, index) => {
                const c = state.objects.cards[cid];
                const declaredPlay = (state.resolution.playContinuation?.phase === "PAYMENT" || state.resolution.playContinuation?.phase === "EQUIP") && state.resolution.playContinuation.sourceId === cid;
                if (zone === "HAND" && id !== actor && !declaredPlay) return [];
                // Face-down public IDs are zone slots, never content-bearing instance IDs.
                const known = c.face === "UP" || (zone === "HAND" && id === actor);
                const memories = (state.privateKnowledge ?? []).filter(k => k.cardInstanceId === cid);
                const remembered = memories.find(k => k.viewerId === actor);
                return { ...(fieldLegendsEnabled(context) && c.face === "UP" && view.getRevision(cid)?.type === "LEGEND" ? { effectiveTypes: view.getEffectiveCardTypes(cid), ...(c.statuses.includes("GO_SOLO") ? { goSolo: true as const } : {}) } : {}), ...(memories.length ? { knownToSeats: memories.map(k => seat(k.viewerId)).sort() } : {}), ...(remembered ? { rememberedContent: remembered.content } : {}), ...(capabilitiesEnabled(context) && c.face === "UP" && ["BATTLEFIELD", "LEGENDS"].includes(zone) ? { effectiveKeywords: view.getEffectiveKeywords(cid) } : {}), ...(restrictionsEnabled(context) && c.face === "UP" && c.zone.zone === "BATTLEFIELD" ? { restrictions: currentCombatRestrictions(state, cid, context).map(x => x.kind) } : {}), publicId: known ? cid : `seat:${p.seat}:${zone}:${index}`, zone: c.zone.zone, ownerSeat: seat(c.ownerId), controllerSeat: seat(c.controllerId), face: c.face, readiness: c.readiness, ...(c.statuses.includes("LAG") ? { lagging: true } : {}), ...(gearEnabled(context) && c.face === "UP" && ["BATTLEFIELD", "LEGENDS", ...(combatResolutionEnabled(context) ? ["TRASH", "REMOVED"] : [])].includes(zone) ? { attachments: view.getAttachedGear(cid).map(g => g.id), effectivePower: view.getEffectivePower(cid) } : {}), ...(known ? { content: { cardId: c.cardId, revision: c.revision } } : {}), damage: c.damage, counters: c.counters };
            });
        });
        return { seat: p.seat, counts: Object.fromEntries(Object.entries(p.zones).map(([k, v]) => [k, v?.length ?? 0])), streetCred: view.getStreetCred(id), cards, gigs: Object.values(state.objects.gigs).filter(g => (!state.setup || state.setup.stage === "MULLIGAN") && g.location.playerId === id).sort((a, b) => a.id < b.id ? -1 : 1).map(g => ({ id: g.id, dieType: g.dieType, roll: g.roll, ownerSeat: seat(g.ownerId), controllerSeat: seat(g.controllerId), zone: g.location.zone })) };
    });
    const c = state.resolution.choice, combat = state.timing.combat;
    const combatObservation = combat.stage === "TRIGGER_RESOLUTION" || combat.stage === "ATTACK_TARGET_SELECTION" || combat.stage === "RIVAL_REACT" || combat.stage === "COMBAT_RESOLUTION_PENDING" || combat.stage === "GIG_STEAL_SELECTION" || combat.stage === "DEFEAT_ORDER_SELECTION" ? { combat: { stage: combat.stage, attackerId: combat.attackerId, attackingSeat: seat(combat.attackingPlayerId), defendingSeat: seat(state.match.playerOrder.find(id => id !== combat.attackingPlayerId)!), target: combat.target?.kind === "GIG_AREA" ? { kind: "GIG_AREA", playerSeat: seat(combat.target.playerId) } : combat.target }, ...(combat.stage === "COMBAT_RESOLUTION_PENDING" && !combatResolutionEnabled(context) ? { unsupportedCapabilities: ["UNSUPPORTED_COMBAT_RESOLUTION"] } : combat.stage === "RIVAL_REACT" && !reactEnabled(context) ? { unsupportedCapabilities: ["UNSUPPORTED_RIVAL_REACT"] } : {}) } : {};
    const inspectedCards = state.resolution.searchContinuation && state.timing.actingPlayer === actor ? state.resolution.searchContinuation.looked.map(id => ({ instanceId: id, content: { cardId: state.objects.cards[id].cardId, revision: state.objects.cards[id].revision } })) : undefined;
    const triggerObservation = state.resolution.triggerContinuation ? {
        pendingTriggers: [...(state.resolution.current ? [state.resolution.current] : []), ...state.resolution.pending].map(e => ({ id: e.id, sourceId: e.sourceId!, subjectId: e.trigger!.subjectId, source: e.trigger!.source, controllerSeat: seat(e.controllerId), kind: e.trigger!.kind })),
        ...(state.resolution.triggerContinuation.origin.kind === "FIGHT" ? { fightResult: state.resolution.triggerContinuation.origin.result } : {})
    } : {};
    return success(freeze(PlayerObservationSchema.parse({ schemaVersion: 1, ...triggerObservation,
        ...(state.delayedEffects ? { delayedEffects: state.delayedEffects.map(d => ({ sourceId: d.sourceId, source: d.source, subjectId: d.subjectId, controllerSeat: seat(d.controllerId), createdTurn: d.createdTurn, timing: "END_OF_TURN", condition: "SUBJECT_IS_UNIT_NAMED_V", readyCount: 2 })) } : {}),
        ...(state.resolution.triggerContinuation?.selectedEddieSlots ? { selectedEddieSlots: state.resolution.triggerContinuation.selectedEddieSlots } : {}), ...(state.turnHistory?.gigsStolenByUnit ? { gigSteals: Object.entries(state.turnHistory.gigsStolenByUnit).sort(([a], [b]) => a < b ? -1 : 1).map(([attackerId, count]) => ({ attackerId, count })) } : {}), ...(state.turnHistory?.firstArasakaAttacks ? { turnAttacks: state.match.playerOrder.map(id => ({ seat: seat(id), arasakaUnitAttacks: state.turnHistory!.firstArasakaAttacks![id].count })) } : {}), ...(state.turnHistory ? { turnPlays: state.match.playerOrder.map(id => ({ seat: seat(id), blueUnitOrGearPlays: state.turnHistory!.blueUnitOrGearPlays[id] })) } : {}), ...combatObservation, ...(state.fightPreventions ? { fightPreventions: state.fightPreventions.map(e => ({ id: e.id, kind: e.kind, sourceId: e.sourceId, controllerSeat: seat(e.controllerId), createdTurn: e.createdTurn, expiresTurn: e.expires.turn })) } : {}), ...(state.resolution.gigStealContinuation ? { gigSteal: { selectedIds: state.resolution.gigStealContinuation.selected, remaining: state.resolution.gigStealContinuation.remaining } } : {}), ...(state.temporaryModifiers ? { temporaryModifiers: state.temporaryModifiers } : {}), viewerSeat: seat(actor), turn: state.timing.turn, activeSeat: seat(state.timing.activePlayer), actingSeat: seat(state.timing.actingPlayer), window: state.timing.window, resolutionStage: state.resolution.stage, ...(state.timing.step ? { step: state.timing.step } : {}), ...(state.match.outcome ? { outcome: { winnerSeat: seat(state.match.outcome.winnerId), reason: state.match.outcome.reason } } : {}), ...(inspectedCards ? { inspectedCards } : {}), players, choice: c ? { id: c.id, actorSeat: seat(c.actorId), kind: c.kind, min: c.min, max: c.max } : null })));
}
export function hashObservation(observation: unknown) { return ObservationHashSchema.parse(hashCanonical(PlayerObservationSchema.parse(observation))); }
