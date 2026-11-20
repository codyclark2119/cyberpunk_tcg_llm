import { supportsFieldLegend } from "./field-legend-support";
import type { CardInstanceId, CardReference, GameState, Keyword, PlayerId } from "@tcg/domain";
import type { EngineContext } from "./state";
import { cardRevision } from "./characteristics";
import { attachedGear } from "./attachments";
import { capabilitiesEnabled, supportsCapabilityGear } from "./capability-support";
import { testCondition } from "./conditions";
export type CapabilitySource = { sourceId: CardInstanceId; subjectId: CardInstanceId; controllerId: PlayerId; source: CardReference; origin: "PRINTED" | "EQUIPPED_HOST" | "EFFECT" };
export type EffectiveCapability = { keyword: Keyword; sources: CapabilitySource[] };
/** Printed keyword identity plus reviewed inherited sources. Legality separately checks type, area, readiness and restrictions.
 * Duplicate BLOCKER text is retained as distinct sources of one equivalent host spend/redirect action (9.9/11.24).
 * No general rule about stacking other keywords or triggered effects is inferred. */
export function effectiveCapabilities(state: GameState, id: CardInstanceId, context: EngineContext): EffectiveCapability[] {
    const host = state.objects.cards[id], revision = cardRevision(state, id, context);
    if (!host || !revision) return [];
    const groups = new Map<Keyword, CapabilitySource[]>();
    const add = (keyword: Keyword, sourceId: CardInstanceId, origin: CapabilitySource["origin"]) => {
        const r = cardRevision(state, sourceId, context)!;
        const source = { sourceId, subjectId: id, controllerId: host.controllerId, source: { cardId: r.id, revision: r.revision }, origin };
        groups.set(keyword, [...(groups.get(keyword) ?? []), source]);
    };
    for (const keyword of new Set(revision.mechanics.keywords)) add(keyword, id, "PRINTED");
    if (capabilitiesEnabled(context) && host.face === "UP" && host.zone.playerId === host.controllerId && ((revision.type === "UNIT" && host.zone.zone === "BATTLEFIELD") || (revision.type === "LEGEND" && (host.zone.zone === "LEGENDS" || host.zone.zone === "BATTLEFIELD" && supportsFieldLegend(revision, context).ok))))
        for (const gear of attachedGear(state, id, context)) {
            if (gear.face !== "UP" || gear.controllerId !== host.controllerId || gear.zone.playerId !== host.zone.playerId || gear.zone.zone !== host.zone.zone || !supportsCapabilityGear(cardRevision(state, gear.id, context), context).ok) continue;
            for (const modifier of cardRevision(state, gear.id, context)!.mechanics.modifiers) {
                if (modifier.kind === "GRANT_KEYWORD_TO_HOST") add(modifier.keyword, gear.id, "EQUIPPED_HOST");
                // Batch V39: the condition is read live from the host controller's view ("you"), whenever the keyword is consulted.
                if (modifier.kind === "GRANT_KEYWORD_TO_HOST_IF" && testCondition(state, host.controllerId, modifier.condition, context)) add(modifier.keyword, gear.id, "EQUIPPED_HOST");
            }
        }
    // Batch V20: a keyword granted "this turn" applies only while its target remains a face-up field Unit.
    if (host.face === "UP" && host.zone.zone === "BATTLEFIELD")
        for (const grant of state.temporaryKeywords ?? []) if (grant.targetId === id && grant.expires.turn === state.timing.turn) add(grant.keyword, grant.sourceId, "EFFECT");
    return [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([keyword, sources]) => ({ keyword, sources: sources.sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0) }));
}
export function effectiveKeywords(state: GameState, id: CardInstanceId, context: EngineContext) { return effectiveCapabilities(state, id, context).map(c => c.keyword); }
