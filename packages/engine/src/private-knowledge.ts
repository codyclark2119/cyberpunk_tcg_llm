import { canonicalSerialize, failure, success, type CardInstanceId, type GameState, type PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { privateInformationEnabled } from "./private-look-support";

export function privateLookTargets(state: GameState, viewer: PlayerId, context: EngineContext) {
    return (state.players[viewer]?.zones.LEGENDS ?? []).flatMap((id, slot) => {
        const c = state.objects.cards[id];
        return c?.face === "DOWN" && c.controllerId === viewer && c.zone.zone === "LEGENDS" && context.content.cards.some(r => r.id === c.cardId && r.revision === c.revision && r.type === "LEGEND") ? [slot] : [];
    });
}
function knowledgeKey(state: GameState, k: NonNullable<GameState["privateKnowledge"]>[number]) { return `${state.players[k.viewerId].seat}:${k.cardInstanceId}`; }
/** Internal effect operation. Slot is public; immutable learned content is only in authoritative state. */
export function grantLegendKnowledge(m: TurnMutation, viewer: PlayerId, slot: number) {
    if (!privateInformationEnabled(m.context) || !privateLookTargets(m.state, viewer, m.context).includes(slot)) return failure("INVALID_LOOK_TARGET", "Choose a friendly face-down Legend slot");
    const id = m.state.players[viewer].zones.LEGENDS[slot], c = m.state.objects.cards[id];
    const entries = m.state.privateKnowledge ?? [];
    if (!entries.some(k => k.viewerId === viewer && k.cardInstanceId === id)) entries.push({ kind: "LOOKED_AT_LEGEND", viewerId: viewer, cardInstanceId: id, content: { cardId: c.cardId, revision: c.revision } });
    m.state.privateKnowledge = entries.sort((a, b) => knowledgeKey(m.state, a) < knowledgeKey(m.state, b) ? -1 : 1);
    m.emit({ kind: "LEGEND_LOOKED_AT", viewerId: viewer, legendSeat: m.state.players[viewer].seat, slot });
    return success(null);
}
/** Reveal/departure ends the hidden-object record; turn changes and tracked physical rearrangements do not. */
export function forgetLegendKnowledge(m: TurnMutation, id: CardInstanceId) {
    if (!m.state.privateKnowledge) return;
    const remaining = m.state.privateKnowledge.filter(k => k.cardInstanceId !== id);
    if (remaining.length) m.state.privateKnowledge = remaining;
    else delete m.state.privateKnowledge;
}
export function validatePrivateKnowledge(state: GameState, context: EngineContext) {
    const entries = state.privateKnowledge;
    if (!entries) return success(null);
    if (!privateInformationEnabled(context) || state.setup) return failure("INVALID_PRIVATE_KNOWLEDGE", "Knowledge requires the private-look scope and never exists during setup");
    for (const k of entries) {
        const c = state.objects.cards[k.cardInstanceId];
        if (!state.players[k.viewerId] || !c || c.controllerId !== k.viewerId || c.zone.playerId !== k.viewerId || c.zone.zone !== "LEGENDS" || c.face !== "DOWN" || !context.content.cards.some(r => r.id === c.cardId && r.revision === c.revision && r.type === "LEGEND") || c.cardId !== k.content.cardId || c.revision !== k.content.revision)
            return failure("INVALID_PRIVATE_KNOWLEDGE", "Remembered viewer, physical hidden Legend and immutable identity must agree; stale knowledge is not repaired");
    }
    const keys = entries.map(k => knowledgeKey(state, k));
    if (new Set(keys).size !== keys.length || canonicalSerialize(keys) !== canonicalSerialize([...keys].sort())) return failure("INVALID_PRIVATE_KNOWLEDGE", "Knowledge records must be unique and in canonical seat/object order");
    return success(null);
}
