import { failure, success, type CardInstanceId, type GameState, type PlayerId, type Result, type TemporaryPowerModifier } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { moveCardLocation } from "./card-movement";
import { friendlyFieldUnits } from "./fight-power-grant";
import { supportsLegendSpendCard } from "./legend-spend-support";
import { compareTemporaryPower } from "./temporary-power";
import { triggerId } from "./trigger-queries";

type ProgramPlayPower = Extract<TemporaryPowerModifier, { scaled: "PROGRAM_PLAY_TRIGGER" }>;
/** Batch V76: a played BRAINDANCE Program, the subject of a "When you play a BRAINDANCE Program" trigger. */
export function isBraindanceProgram(state: GameState, id: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, id, context);
    return r?.type === "PROGRAM" && r.tags.includes("Braindance");
}
/** The pinned Legend's "When you play a BRAINDANCE Program" ability, by id. */
export function programPlayAbility(state: GameState, sourceId: CardInstanceId, abilityId: string, context: EngineContext) {
    const r = cardRevision(state, sourceId, context);
    const a = supportsLegendSpendCard(r, context).ok ? r!.mechanics.abilities.find(a => a.id === abilityId) : undefined;
    return a?.trigger === "WHEN_CARD_PLAYED" && a.guard === "FRIENDLY_BRAINDANCE_PROGRAM_PLAYED" && a.effects[0]?.kind === "PROGRAM_PLAY_FRIENDLY_POWER_THIS_TURN" ? a : undefined;
}
/** "Trash the top card of your deck. If it's a Program, you may add it to your hand": the card this effect just trashed, while it is
 * the newest card in the trash and a face-up Program. */
export function trashedTopProgram(state: GameState, actor: PlayerId, context: EngineContext): CardInstanceId | undefined {
    const current = state.resolution.current, c = state.resolution.playContinuation, trash = state.players[actor]?.zones.TRASH ?? [];
    if (current?.effect.kind !== "TRASH_TOP_MAY_ADD_PROGRAM" || c?.kind !== "ACTIVATE" || !trash.length) return undefined;
    const id = trash[trash.length - 1], card = state.objects.cards[id];
    return card?.face === "UP" && card.ownerId === actor && cardRevision(state, id, context)?.type === "PROGRAM" ? id : undefined;
}
/** An empty deck trashes nothing (and draws nothing, so no loss); a non-Program stays in the trash. */
export function resolveTrashTop(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const actor = m.state.resolution.current!.controllerId, deck = m.state.players[actor].zones.DECK;
    if (!deck.length) return success(null);
    moveCardLocation(m, deck[0], "TRASH");
    return trashedTopProgram(m.state, actor, m.context) ? offer(m) : success(null);
}
/** The choice: add the trashed Program to hand, or leave it in the trash. */
export function chooseTrashedTopProgram(m: TurnMutation, id: CardInstanceId | undefined): Result<null> {
    const current = m.state.resolution.current!, program = trashedTopProgram(m.state, current.controllerId, m.context);
    if (!program || id !== undefined && id !== program) return failure("INVALID_TRASH_TARGET", "Choose the Program this effect trashed, or leave it");
    m.state.resolution.choice = null;
    if (id === undefined) { m.emit({ kind: "OPTIONAL_TRIGGER_DECLINED", effectId: current.id, controllerId: current.controllerId }); return success(null); }
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId!, targetId: id, controllerId: current.controllerId, forced: false });
    moveCardLocation(m, id, "HAND");
    return success(null);
}
/** "Give a friendly Unit +1 power this turn", once per trigger occurrence. */
export function applyProgramPlayPower(m: TurnMutation, targetId: CardInstanceId, forced: boolean): Result<null> {
    const s = m.state, current = s.resolution.current, t = current?.trigger;
    if (current?.effect.kind !== "PROGRAM_PLAY_FRIENDLY_POWER_THIS_TURN" || !current.sourceId || t?.kind !== "WHEN_CARD_PLAYED" || !programPlayAbility(s, current.sourceId, t.abilityId, m.context))
        return failure("INVALID_POWER_SOURCE", "Current reviewed BRAINDANCE play trigger required");
    if (!friendlyFieldUnits(s, current.controllerId, m.context).includes(targetId)) return failure("INVALID_POWER_TARGET", "Choose a current friendly field Unit");
    m.emit({ kind: "CARD_TARGET_SELECTED", effectId: current.id, sourceId: current.sourceId, targetId, controllerId: current.controllerId, forced });
    const modifier: ProgramPlayPower = { kind: "POWER", sourceId: current.sourceId, targetId, expires: { kind: "END_OF_TURN", turn: s.timing.turn }, amount: 1, scaled: "PROGRAM_PLAY_TRIGGER", origin: { effectId: current.id, abilityId: t.abilityId, ordinal: t.ordinal } };
    if (s.temporaryModifiers?.some(x => compareTemporaryPower(x, modifier) === 0)) return failure("DUPLICATE_POWER_OCCURRENCE", "A resolved power occurrence cannot be applied twice");
    (s.temporaryModifiers ??= []).push(modifier);
    s.temporaryModifiers.sort(compareTemporaryPower);
    m.emit({ kind: "POWER_MODIFIER_APPLIED", modifier });
    return success(null);
}
/** A resolved current-turn occurrence of the pinned face-up Legend's trigger, on a friendly public Unit. */
export function validateProgramPlayPower(state: GameState, x: ProgramPlayPower, context: EngineContext, publicUnit: (id: CardInstanceId) => boolean) {
    const source = state.objects.cards[x.sourceId], target = state.objects.cards[x.targetId], r = cardRevision(state, x.sourceId, context), a = programPlayAbility(state, x.sourceId, x.origin.abilityId, context), continuation = state.resolution.triggerContinuation;
    if (!source || !target || !r || !a || source.face !== "UP" || source.zone.zone !== "LEGENDS" || x.expires.turn !== state.timing.turn || target.controllerId !== source.controllerId || !publicUnit(x.targetId)
        || x.origin.ordinal > (state.turnHistory?.triggeredBatches ?? 0)
        || x.origin.effectId !== triggerId(state, { sourceId: source.id, subjectId: source.id, source: { cardId: r.id, revision: r.revision }, controllerId: source.controllerId, abilityId: a.id, kind: "WHEN_CARD_PLAYED" }, x.origin.ordinal)
        || continuation?.ordinal === x.origin.ordinal && !continuation.resolvedIds.includes(x.origin.effectId))
        return failure("INVALID_TEMPORARY_POWER", "A BRAINDANCE play power needs its reviewed face-up Legend's resolved current-turn trigger and a friendly public Unit");
    return success(null);
}
