import { rockerGrantEnabled } from "./rocker-grant";
import { failure, success, type CardInstanceId, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes, hasClassification } from "./characteristics";
import { supportsFieldLegend } from "./field-legend-support";
import { supportsFreePlayCard } from "./free-play-support";

/** Batch V50: the history exists only for content holding a reviewed card that reads it. */
export function arasakaDefeatHistoryEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.guard === "FIRST_ARASAKA_UNIT_DEFEAT_PER_TURN") && supportsFreePlayCard(r, context).ok);
}
export function rivalUnitAttackGrantsEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.mechanics.abilities.some(a => a.effects.some(e => e.kind === "PLAY_UNIT_FREE" && e.grant)) && supportsFreePlayCard(r, context).ok) || rockerGrantEnabled(context); // Batch V80.
}
/** Called with each defeat batch before its cards move: the turn's first face-up ARASAKA Unit to be defeated, by either player.
 * Simultaneous defeats take the lowest card id, so the one first-time event belongs to exactly one card. */
export function recordArasakaDefeat(m: TurnMutation, ids: readonly CardInstanceId[]) {
    const h = m.state.turnHistory;
    if (!h || h.firstArasakaDefeat || !arasakaDefeatHistoryEnabled(m.context)) return;
    const first = [...ids].sort().find(id => { const c = m.state.objects.cards[id]; return c?.face === "UP" && c.zone.zone === "BATTLEFIELD" && effectiveCardTypes(m.state, id, m.context).includes("UNIT") && hasClassification(m.state, id, "Arasaka", m.context); });
    if (first) h.firstArasakaDefeat = first;
}
export function hasRivalUnitAttackGrant(state: GameState, id: CardInstanceId) {
    return Boolean(state.turnHistory?.rivalUnitAttackGrants?.includes(id));
}
export function validateArasakaDefeatHistory(state: GameState, context: EngineContext) {
    const h = state.turnHistory, first = h?.firstArasakaDefeat, grants = h?.rivalUnitAttackGrants;
    if (first !== undefined) {
        const c = state.objects.cards[first], r = cardRevision(state, first, context);
        if (!arasakaDefeatHistoryEnabled(context) || state.setup || h!.turn !== state.timing.turn || !c || !r || !r.tags.includes("Arasaka") || !(r.type === "UNIT" || r.type === "LEGEND" && supportsFieldLegend(r, context).ok))
            return failure("INVALID_ARASAKA_DEFEAT_HISTORY", "The first defeated ARASAKA Unit needs its reviewed reader, the current turn and a physical ARASAKA Unit");
    }
    if (grants !== undefined) {
        if (!rivalUnitAttackGrantsEnabled(context) || state.setup || h!.turn !== state.timing.turn || new Set(grants).size !== grants.length || canonicalOrder(grants) || grants.some(id => cardRevision(state, id, context)?.type !== "UNIT"))
            return failure("INVALID_ATTACK_GRANT", "Rival-Unit attack grants need their reviewed free play, the current turn and distinct sorted Units");
    }
    return success(null);
}
function canonicalOrder(ids: readonly CardInstanceId[]) { return ids.some((id, i) => i > 0 && ids[i - 1] >= id); }
