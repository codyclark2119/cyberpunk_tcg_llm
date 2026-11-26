import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PendingChoice, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes } from "./characteristics";
import { moveCardLocation } from "./card-movement";
import { supportsPlay } from "./play-support";
import { triggersEnabled } from "./trigger-support";
import { activateTriggerBatch, prepareTriggerBatch, recordPlayedCard } from "./trigger-resolution";
import { discoverTriggers } from "./trigger-queries";
import { recordQualifyingPlay } from "./free-play";
import { finishAction } from "./action-return";

type Step = (m: TurnMutation) => Result<null>;
type Option = PendingChoice["options"][number];
const KIND = "PLAY_TRASH_UNITS_FREE", ALTERNATIVE = "ALTERNATIVE_PLAY_COST_IF_RIVAL_GIG_LEAD";
/** Batch V96+: Programs that play Units from their controller's trash for free, each pinned whole. */
const TRASH_UNITS_SHAPES = [
    // Batch V96: We Gotta Live Together. "If a Rival controls at least 2 more Gigs than you, play this Program for 3 €$. Play up to 2
    // Units with cost 3 or less from your trash for free."
    { colors: ["GREEN"], ram: { GREEN: 2 }, tags: ["Aldecado", "Nomad"], cost: 5, modifiers: [{ kind: ALTERNATIVE, minimum: 2, amount: 3 }], effects: [{ kind: KIND, count: 2, maxCost: 3 }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
/** The trash-Unit play and its alternative cost route here first, so no other gate can admit what it does not read. */
export function hasTrashUnitsPlay(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.modifiers.some(m => m.kind === ALTERNATIVE) || card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === KIND)));
}
export function supportsTrashUnitsProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || !triggersEnabled(context) || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !TRASH_UNITS_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount, modifiers: m.modifiers,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_TRASH_UNITS_PLAY", "Complete reviewed printed Program with an exact trash-Unit play required");
    return success(null);
}
export function trashUnitsPlayEnabled(context: EngineContext) {
    return context.content.cards.some(r => hasTrashUnitsPlay(r) && supportsTrashUnitsProgram(r, context).ok);
}
/** "If a Rival controls at least 2 more Gigs than you, play this Program for 3 €$": the alternative amount, while the lead holds. */
export function trashUnitsAlternativeCost(state: GameState, actor: PlayerId, card: DeepReadonly<CardRevisionSnapshot>, context: EngineContext): number | null {
    const alternative = card.mechanics.modifiers.find(m => m.kind === ALTERNATIVE);
    const gigs = (id: string) => Object.values(state.objects.gigs).filter(g => g.controllerId === id && g.location.zone === "GIGS").length;
    return alternative?.kind === ALTERNATIVE && supportsTrashUnitsProgram(card, context).ok && state.match.playerOrder.some(id => id !== actor && gigs(id) - gigs(actor) >= alternative.minimum) ? alternative.amount : null;
}
/** "Units with cost 3 or less from your trash": the controller's face-up trash Units with that printed cost (3.11.1.2) that the engine
 * can play, in id order. A card it cannot play is not a target (fail-closed). */
export function trashUnitTargets(state: GameState, context: EngineContext): CardInstanceId[] {
    const current = state.resolution.current, e = current?.effect;
    if (e?.kind !== KIND || state.resolution.playContinuation?.kind !== "PLAY" || !state.players[current!.controllerId]) return [];
    return state.players[current!.controllerId].zones.TRASH.filter(id => {
        const c = state.objects.cards[id], r = cardRevision(state, id, context);
        return c.face === "UP" && c.ownerId === current!.controllerId && r?.type === "UNIT" && r.printedCost.kind === "EDDIES" && r.printedCost.amount <= e.maxCost && supportsPlay(r, context).ok;
    }).sort();
}
/** "Up to 2": stop, or the next Unit to play. */
export function trashUnitsOptions(state: GameState, context: EngineContext): Option[] {
    const targets = trashUnitTargets(state, context);
    return targets.length ? [{ kind: "CONFIRM", confirmed: false }, ...targets.map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))] : [];
}
/** With no eligible Unit nothing is played; otherwise the controller chooses, since every play is optional. */
export function resolveTrashUnits(m: TurnMutation, offer: Step): Result<null> {
    return trashUnitTargets(m.state, m.context).length ? offer(m) : success(null);
}
/** 11.11.4: a chosen Unit is played without paying: it enters the field ready and lagging. Its {Play} triggers wait for the Program to
 * resolve. Returns true while another Unit may still be chosen. */
export function chooseTrashUnit(m: TurnMutation, option: Option): Result<boolean> {
    const s = m.state, c = s.resolution.playContinuation!, current = s.resolution.current!;
    if (current.effect.kind !== KIND) return failure("INVALID_TRASH_UNIT_PLAY", "A trash-Unit play is required");
    s.resolution.choice = null;
    if (option.kind === "CONFIRM" && !option.confirmed) return success(false);
    if (option.kind !== "CARD" || !trashUnitTargets(s, m.context).includes(option.cardInstanceId)) return failure("INVALID_TRASH_UNIT_PLAY", "Choose a Unit with cost 3 or less in your trash, or stop");
    const id = option.cardInstanceId;
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced: false });
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: id });
    moveCardLocation(m, id, "BATTLEFIELD");
    s.objects.cards[id].readiness = "READY"; s.objects.cards[id].statuses.push("LAG");
    c.trashPlayedIds = [...(c.trashPlayedIds ?? []), id];
    return success(c.trashPlayedIds.length < current.effect.count && trashUnitTargets(s, m.context).length > 0);
}
/** A pause holds fewer than 2 played Units, each still on its controller's field, and a Unit left to choose. */
export function validateTrashUnitsPause(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, current = state.resolution.current, ids = c.trashPlayedIds ?? [];
    if (current?.effect.kind !== KIND || c.targetGigId || state.timing.step !== "TARGET_SELECTION" || ids.length >= current.effect.count || !trashUnitTargets(state, context).length
        || ids.some(id => { const u = state.objects.cards[id]; return u?.zone.zone !== "BATTLEFIELD" || u.controllerId !== c.actorId || cardRevision(state, id, context)?.type !== "UNIT"; })
        || state.resolution.targetedDefeatContinuation || state.resolution.defeatContinuation || state.resolution.triggerContinuation)
        return failure("INVALID_TRASH_UNIT_PLAY", "A trash-Unit play pauses only with a Unit left to choose and fewer than 2 played");
    return success(null);
}
/** The effect play a resolved trash-Unit Program justifies in its Units' play batch: the Program in its owner's trash, its origin Unit
 * and one effect-played Unit, each a Unit of that owner with cost 3 or less. */
export function validFreePlaySource(state: GameState, context: EngineContext) {
    const c = state.resolution.triggerContinuation, id = c?.freePlaySource;
    if (!c || !id) return true;
    const program = state.objects.cards[id], r = cardRevision(state, id, context), plays = c.effectPlays ?? [];
    const ok = (unit: CardInstanceId) => { const u = state.objects.cards[unit], ur = cardRevision(state, unit, context); return u?.ownerId === program?.ownerId && ur?.printedCost.kind === "EDDIES" && ur.printedCost.amount <= 3 && effectiveCardTypes(state, unit, context).includes("UNIT"); };
    return Boolean(program && program.zone.zone === "TRASH" && program.face === "UP" && supportsTrashUnitsProgram(r, context).ok && c.origin.kind === "PLAY" && plays.length === 1 && plays[0].subjectId !== c.origin.subjectId && ok(c.origin.subjectId) && ok(plays[0].subjectId));
}
/** The played Units' {Play} triggers become pending together once the Program has resolved: the first is the batch's origin, the
 * second (if any) its effect play; each records a first-blue-play ordinal in play order. With no binding the action finishes. */
export function beginTrashUnitsBatch(m: TurnMutation, programId: CardInstanceId, ids: readonly CardInstanceId[]): Result<null> {
    const [first, second] = ids;
    if (!second) return recordPlayedCard(m, first);
    recordQualifyingPlay(m, first);
    const bindings = discoverTriggers(m.state, { kind: "PLAY", subjectId: first }, m.context);
    const ordinal = recordQualifyingPlay(m, second);
    bindings.push(...discoverTriggers(m.state, { kind: "PLAY", subjectId: second }, m.context));
    const batch = prepareTriggerBatch(m, { kind: "PLAY", subjectId: first }, bindings);
    if (!batch) return finishAction(m);
    batch.effectPlays = [{ subjectId: second, ...(ordinal ? { qualifyingOrdinal: ordinal } : {}) }]; batch.freePlaySource = programId;
    return activateTriggerBatch(m, batch);
}
