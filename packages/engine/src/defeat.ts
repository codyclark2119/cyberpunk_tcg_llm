import { recordEquippedDefeats } from "./hand-gear-play";
import { recordArasakaDefeat } from "./arasaka-defeat";
import { effectiveCardTypes } from "./characteristics";
import { discoverTriggers } from "./trigger-queries";
import { triggersEnabled, supportsTriggerCard } from "./trigger-support";
import { supportsTargetedDefeatCard } from "./targeted-defeat-support";
import { failure, success, type CardInstanceId, type DefeatInstruction, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { processDeparture } from "./card-movement";
import { supportsPlay } from "./play-support";
import { supportsGear, attachmentHost } from "./attachments";
import { hasDefeatReplacement, supportsDefeatReplacementGear } from "./defeat-replacement-support";

/** Batch V89 (10.24-10.29): the Gear whose mandatory replacement applies if this field Unit would be defeated: a face-up attached Gear
 * of the Unit's controller with the pinned replacement. With several (10.28.1 lets the controller choose), they are identical copies,
 * so the lowest id is taken. The replacing Gear's own defeat is a new process this replacement cannot apply to again (10.29.1). */
export function defeatReplacement(state: GameState, id: CardInstanceId, context: EngineContext): CardInstanceId | undefined {
    const c = state.objects.cards[id];
    if (!c || c.zone.zone !== "BATTLEFIELD" || c.face !== "UP" || !effectiveCardTypes(state, id, context).includes("UNIT")) return undefined;
    return [...c.attachments].sort().find(g => { const gear = state.objects.cards[g], r = cardRevision(state, g, context);
        return gear?.face === "UP" && gear.controllerId === c.controllerId && hasDefeatReplacement(r) && supportsDefeatReplacementGear(r, context).ok; });
}
/** The cards one defeat moves to the trash, in an owner-chosen order: the Unit and its Gear, or (Batch V89) its replacing Gear alone. */
export function defeatBatch(state: GameState, id: CardInstanceId, context: EngineContext): CardInstanceId[] {
    const replaced = defeatReplacement(state, id, context);
    return replaced ? [replaced] : [id, ...state.objects.cards[id].attachments].sort();
}
export function defeatSupport(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!c || c.zone.zone !== "BATTLEFIELD" || c.face !== "UP" || !revision || !effectiveCardTypes(state, id, context).includes("UNIT") || !supportsPlay(revision, context).ok || (revision.mechanics.abilities.some(a => a.trigger === "WHEN_DEFEATED") && !supportsTriggerCard(revision, context).ok && !(revision.mechanics.abilities.length > 1 && supportsTargetedDefeatCard(revision, context).ok)))
        return failure("UNSUPPORTED_DEFEAT", "Defeat requires a reviewed effective field Unit with fully supported DEFEATED effects");
    if (defeatBatch(state, id, context).some(cid => state.objects.cards[cid].ownerId !== c.ownerId || state.objects.cards[cid].controllerId !== c.ownerId))
        return failure("UNSUPPORTED_DEFEAT_OWNERSHIP", "Cross-owner card/Gear movement requires a separately reviewed destination and ordering protocol");
    return success(null);
}
/** Reviewed Gear as an effect-defeat target: face-up, in an active area, attached, supported Gear.
 * Deliberately separate from defeatSupport so the fight path keeps its strictly Unit-only predicate. */
export function gearDefeatSupport(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!c || c.face !== "UP" || !["BATTLEFIELD", "LEGENDS"].includes(c.zone.zone) || !revision || revision.type !== "GEAR" || !supportsGear(revision, context).ok || !attachmentHost(state, id))
        return failure("UNSUPPORTED_GEAR_DEFEAT", "Effect defeat requires a reviewed attached face-up Gear in an active area");
    if (c.ownerId !== c.controllerId || c.attachments.length)
        return failure("UNSUPPORTED_GEAR_DEFEAT_OWNERSHIP", "Cross-owner or nested Gear movement requires a separately reviewed protocol");
    return success(null);
}
/** Effect defeat admits reviewed Units and, under the Gear capability, reviewed attached Gear. */
function effectDefeatSupport(state: GameState, id: CardInstanceId, context: EngineContext) {
    const unit = defeatSupport(state, id, context);
    return unit.ok ? unit : gearDefeatSupport(state, id, context);
}
/** Trusted semantic operation, reusable by future effect handlers; not a player action.
 * All instructions/orders are checked before mutation. All defeat facts precede shared movement.
 * 11.19.2 pending creation belongs AFTER declaration AND movement; bindings retain last-valid source identity.
 */
export function defeatCards(m: TurnMutation, defeats: readonly DefeatInstruction[], orders: readonly { readonly targetId: CardInstanceId; readonly cardIds: readonly CardInstanceId[] }[], allowGear = false) {
    if (new Set(defeats.map(d => d.targetId)).size !== defeats.length || orders.length !== defeats.length)
        return failure("INVALID_DEFEAT_BATCH", "Distinct targets and one owner order per defeat required");
    for (const d of defeats) {
        const supported = allowGear ? effectDefeatSupport(m.state, d.targetId, m.context) : defeatSupport(m.state, d.targetId, m.context);
        if (!supported.ok) return supported;
        const order = orders.find(o => o.targetId === d.targetId)?.cardIds, batch = defeatBatch(m.state, d.targetId, m.context);
        if (!m.state.objects.cards[d.defeatedBy] || !order || order.length !== batch.length || new Set(order).size !== batch.length || order.some(id => !batch.includes(id)))
            return failure("INVALID_DEFEAT_ORDER", "Exact owner order and existing defeat source required");
    }
    // Batch V89 (10.25): a replaced defeat does not occur at all; its replacing Gear is defeated instead, by the same source.
    const actual = defeats.map(d => { const gear = defeatReplacement(m.state, d.targetId, m.context); return { instruction: gear ? { targetId: gear, defeatedBy: d.defeatedBy } : d, replaced: gear ? d.targetId : undefined, order: orders.find(o => o.targetId === d.targetId)!.cardIds }; });
    const defeated = actual.map(a => a.instruction);
    if (triggersEnabled(m.context)) recordArasakaDefeat(m, defeated.map(d => d.targetId)); // Batch V50: before discovery and movement.
    if (triggersEnabled(m.context)) recordEquippedDefeats(m, defeated.map(d => d.targetId)); // Batch V92: likewise.
    const triggered = triggersEnabled(m.context) ? discoverTriggers(m.state, { kind: "DEFEAT", defeated: [...defeated] }, m.context) : [];
    for (const a of actual) if (a.replaced) m.emit({ kind: "DEFEAT_REPLACED", cardInstanceId: a.replaced, replacementId: a.instruction.targetId, defeatedBy: a.instruction.defeatedBy });
    for (const d of defeated) m.emit({ kind: "CARD_DEFEATED", cardInstanceId: d.targetId, defeatedBy: d.defeatedBy });
    for (const a of actual) {
        const moved = processDeparture(m, a.instruction.targetId, "TRASH", a.order);
        if (!moved.ok) return moved;
    }
    m.state.resolution.stage = "DISCOVER_TRIGGERS";
    // Immutable source/subject bindings captured while active; enqueue only after all movement (11.19.2). `defeated` is what was
    // actually defeated (Batch V89: after replacements), for the DEFEAT origin.
    return success({ triggered, defeated });
}
