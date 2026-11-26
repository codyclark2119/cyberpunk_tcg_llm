import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type Effect, type GameState, type PendingChoice, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { legalEquipHosts } from "./attachments";
import { attachPlayedGear, moveCardLocation } from "./card-movement";
import { supportsPlay } from "./play-support";
import { recordCyberwareGearPlay } from "./play-cost-support";
import { triggersEnabled } from "./trigger-support";

type TrashGear = Extract<Effect, { kind: "TRASH_THEN_ADD_GEAR_MAY_PLAY_IF_GIG_COST" }>;
type Step = (m: TurnMutation) => Result<null>;
type Option = PendingChoice["options"][number];
const KIND = "TRASH_THEN_ADD_GEAR_MAY_PLAY_IF_GIG_COST";
/** Batch V93+: Programs that trash cards, add a Gear from among them and may play it instead, each pinned whole. */
const TRASH_GEAR_SHAPES = [
    // Batch V93: The Heist. "Trash 4. Add a Gear from among them to your hand. If that Gear's cost equals the value of a friendly Gig,
    // you may play it for free instead."
    { colors: ["YELLOW"], ram: { YELLOW: 2 }, tags: ["Merc"], cost: 2, effects: [{ kind: KIND, count: 4 }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
/** The trash-and-add-Gear effect routes here first, so no other gate can admit what it does not read. */
export function hasTrashGearEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === KIND)));
}
export function supportsTrashGearProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !turnSliceAllows(g?.turnSlice, "gear") || !triggersEnabled(context) || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !TRASH_GEAR_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_TRASH_GEAR", "Complete reviewed printed Program with an exact trash-and-add-Gear effect required");
    return success(null);
}
/** "A Gear from among them": the Gear this effect trashed, still face up in its controller's trash, in id order. */
export function trashedGearTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const c = state.resolution.playContinuation;
    if (!c?.trashedIds || state.resolution.current?.effect.kind !== KIND) return [];
    const trash = state.players[c.actorId].zones.TRASH;
    return c.trashedIds.filter(id => trash.includes(id) && state.objects.cards[id].face === "UP" && cardRevision(state, id, context)?.type === "GEAR").sort();
}
/** "If that Gear's cost equals the value of a friendly Gig, you may play it for free instead": its printed cost (3.11.1.2) is a current
 * value of one of the controller's rolled Gigs, and the engine can play it onto a legal host. None in the snapshot has a {Play} ability;
 * one could only be added to hand (fail-closed). */
export function mayPlayTrashedGear(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.resolution.playContinuation, r = cardRevision(state, id, context);
    if (!c || r?.type !== "GEAR" || r.printedCost.kind !== "EDDIES" || !supportsPlay(r, context).ok || r.mechanics.abilities.some(a => a.trigger === "WHEN_PLAYED")) return false;
    const cost = r.printedCost.amount;
    return state.players[c.actorId].gigs.GIGS.some(g => { const gig = state.objects.gigs[g]; return gig.controllerId === c.actorId && gig.roll.kind === "ROLLED" && gig.roll.currentValue === cost; })
        && legalEquipHosts(state, id, context).length > 0;
}
/** The current pause's options: the trashed Gear; then, holding one that may be played, "add it to your hand" or each host. */
export function trashGearOptions(state: GameState, context: EngineContext): Option[] {
    const held = state.resolution.playContinuation?.trashedGearId;
    return held ? [{ kind: "CONFIRM", confirmed: false }, ...legalEquipHosts(state, held, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]
        : trashedGearTargets(state, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }));
}
/** 11.10.2.1.1: trash each card individually; an empty deck stops trashing. With no Gear nothing is added; a lone Gear is taken. */
export function resolveTrashGear(m: TurnMutation, effect: TrashGear, offer: Step): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, deck = s.players[c.actorId].zones.DECK, trashed: CardInstanceId[] = [];
    for (let i = 0; i < effect.count && deck.length; i++) { const id = deck[0]; moveCardLocation(m, id, "TRASH"); trashed.push(id); }
    if (!trashed.length) return success(null);
    c.trashedIds = trashed;
    const targets = trashedGearTargets(s, m.context);
    if (targets.length > 1) return offer(m);
    if (targets.length === 1) return selectTrashedGear(m, targets[0], true, offer);
    delete c.trashedIds;
    return success(null);
}
/** The chosen Gear goes to its controller's hand, unless it may be played: then the controller chooses hand or a host. */
export function selectTrashedGear(m: TurnMutation, id: CardInstanceId, forced: boolean, offer: Step): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, current = s.resolution.current!;
    if (!trashedGearTargets(s, m.context).includes(id)) return failure("INVALID_TRASH_TARGET", "Choose a Gear among the trashed cards");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced });
    if (!mayPlayTrashedGear(s, id, m.context)) return addGear(m, id);
    c.trashedGearId = id;
    return offer(m);
}
function addGear(m: TurnMutation, id: CardInstanceId): Result<null> {
    const c = m.state.resolution.playContinuation!;
    moveCardLocation(m, id, "HAND");
    delete c.trashedGearId; delete c.trashedIds;
    return success(null);
}
/** "Add it to your hand", or "play it for free instead" (11.20.2): equipped to the chosen host, ready, and counted as played; its play
 * batch follows the Program. */
export function chooseTrashedGearDestination(m: TurnMutation, option: Option): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, id = c.trashedGearId;
    if (!id || !mayPlayTrashedGear(s, id, m.context)) return failure("INVALID_TRASH_TARGET", "A Gear that may be played is held");
    if (option.kind === "CONFIRM" && !option.confirmed) return addGear(m, id);
    if (option.kind !== "CARD" || !legalEquipHosts(s, id, m.context).includes(option.cardInstanceId)) return failure("INVALID_EQUIP_TARGET", "Add the Gear to your hand or choose a current host");
    const attached = attachPlayedGear(m, id, option.cardInstanceId);
    if (!attached.ok) return attached;
    s.objects.cards[id].readiness = "READY";
    recordCyberwareGearPlay(m, c.actorId, id);
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: id });
    delete c.trashedGearId; delete c.trashedIds;
    c.playedGearId = id;
    return success(null);
}
/** A pause holds exactly the trashed top of the trash (fewer than four only from an empty deck), and either 2+ Gear to choose from or a
 * held Gear that may be played. */
export function validateTrashGear(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, current = state.resolution.current, ids = c.trashedIds ?? [];
    if (current?.effect.kind !== KIND) return c.trashedGearId ? failure("INVALID_TRASH_GEAR", "A held trashed Gear belongs only to its current effect") : success(null);
    const trash = state.players[c.actorId].zones.TRASH;
    if (!ids.length || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || ids.length > current.effect.count || (ids.length < current.effect.count && state.players[c.actorId].zones.DECK.length)
        || canonicalSerialize(trash.slice(-ids.length)) !== canonicalSerialize(ids) || ids.some(id => state.objects.cards[id].ownerId !== c.actorId)
        || (c.trashedGearId ? !trashedGearTargets(state, context).includes(c.trashedGearId) || !mayPlayTrashedGear(state, c.trashedGearId, context) : trashedGearTargets(state, context).length < 2)
        || state.resolution.targetedDefeatContinuation || state.resolution.defeatContinuation || state.resolution.triggerContinuation)
        return failure("INVALID_TRASH_GEAR", "Exact trashed top cards, an empty deck for a short trash, and a strategic Gear or destination choice required");
    return success(null);
}
