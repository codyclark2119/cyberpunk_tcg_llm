import { canonicalSerialize, type LegalAction } from "@tcg/domain";

/**
 * Replay generators may intentionally use broad predicates (for example,
 * "sell any synthetic slice card"). Legal actions are ordered by actionId,
 * and actionId includes the current position hash, so an engine identity bump
 * can reorder otherwise identical choices. Select among predicate matches by
 * semantic action payload instead so replay trajectories do not depend on
 * actionId ordering.
 */
export function selectReplayAction(
    legalActions: readonly LegalAction[],
    predicate: (action: LegalAction) => boolean
): LegalAction | undefined {
    const matches = legalActions.filter(predicate);
    if (matches.length < 2) return matches[0];
    return [...matches].sort((left, right) =>
        canonicalSerialize({ actorId: left.actorId, action: left.action }).localeCompare(
            canonicalSerialize({ actorId: right.actorId, action: right.action })
        )
    )[0];
}
