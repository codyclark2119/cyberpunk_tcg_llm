import { canonicalSerialize, failure, success, type CardInstanceId, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision, effectiveCardTypes, hasClassification } from "./characteristics";
import { firstAttackHistoryEnabled } from "./first-attack-support";
import { supportsFieldLegend } from "./field-legend-support";
/** Per global turn and per controller, regardless of which effect sources are face-up or present. */
export function initialFirstAttackHistory(state: GameState) { return Object.fromEntries(state.match.playerOrder.map(id => [id, { count: 0, first: null }])); }
export function qualifiesArasakaAttack(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id];
    return Boolean(c && c.face === "UP" && c.zone.zone === "BATTLEFIELD" && c.zone.playerId === c.controllerId && effectiveCardTypes(state, id, context).includes("UNIT") && hasClassification(state, id, "Arasaka", context));
}
/** Called exactly after authoritative ATTACK_DECLARED, never during enumeration or target selection. */
export function recordQualifyingAttack(m: TurnMutation, id: CardInstanceId) {
    if (!firstAttackHistoryEnabled(m.context) || !qualifiesArasakaAttack(m.state, id, m.context)) return;
    const c = m.state.objects.cards[id], h = m.state.turnHistory!.firstArasakaAttacks![c.controllerId];
    h.first ??= { attackerId: id, attacker: { cardId: c.cardId, revision: c.revision } };
    h.count++;
}
export function isFirstArasakaAttack(state: GameState, id: CardInstanceId, context: EngineContext) {
    const c = state.objects.cards[id], h = c && state.turnHistory?.firstArasakaAttacks?.[c.controllerId];
    return firstAttackHistoryEnabled(context) && qualifiesArasakaAttack(state, id, context) && h?.count === 1 && h.first?.attackerId === id;
}
export function validateFirstAttackHistory(state: GameState, context: EngineContext) {
    const h = state.turnHistory?.firstArasakaAttacks, enabled = firstAttackHistoryEnabled(context);
    if (!enabled) return h ? failure("UNSUPPORTED_FIRST_ATTACK_HISTORY", "First-attack history requires its explicit ruleset policy") : success(null);
    if (context.content.ruleset.gameplay?.turnSlice?.combatTriggers !== "COMBAT_TRIGGERS_V1") return failure("UNSUPPORTED_FIRST_ATTACK_HISTORY", "Reviewed trigger policy required");
    if (state.setup) return h ? failure("INVALID_FIRST_ATTACK_HISTORY", "No turn history during setup") : success(null);
    if (!h || state.turnHistory?.turn !== state.timing.turn || canonicalSerialize(Object.keys(h).sort()) !== canonicalSerialize([...state.match.playerOrder].sort())) return failure("INVALID_FIRST_ATTACK_HISTORY", "Current global turn and exact per-player coverage required");
    const seen = new Set<string>();
    for (const [controllerId, summary] of Object.entries(h)) {
        if ((summary.count === 0) !== (summary.first === null)) return failure("INVALID_FIRST_ATTACK_HISTORY", "One retained first occurrence for every positive count");
        if (!summary.first) continue;
        const f = summary.first, c = state.objects.cards[f.attackerId], r = cardRevision(state, f.attackerId, context);
        // Departed cards remain physical objects (including REMOVED). No current FIELD/type requirement.
        // This scope has no control-change mechanic; a future one must preserve trigger-time control explicitly.
        if (!c || !r || c.controllerId !== controllerId || c.cardId !== f.attacker.cardId || c.revision !== f.attacker.revision || !r.tags.includes("Arasaka") || !(r.type === "UNIT" || r.type === "LEGEND" && supportsFieldLegend(r, context).ok) || seen.has(f.attackerId))
            return failure("INVALID_FIRST_ATTACK_HISTORY", "Distinct historical physical attacker and immutable qualifying revision required");
        seen.add(f.attackerId);
    }
    const combat = state.timing.combat;
    if ("target" in combat && combat.target && qualifiesArasakaAttack(state, combat.attackerId, context)) {
        const current = h[state.objects.cards[combat.attackerId].controllerId];
        if (!current.count || current.count === 1 && current.first?.attackerId !== combat.attackerId)
            return failure("INVALID_FIRST_ATTACK_HISTORY", "An already declared qualifying attack must be represented in current turn history");
    }
    return success(null);
}
