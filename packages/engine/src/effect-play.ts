import type { CardInstanceId, DeepReadonly, GameState } from "@tcg/domain";
type TriggerContinuation = NonNullable<GameState["resolution"]["triggerContinuation"]>;
/** The played subject of a batch: its PLAY origin, or (batch V48) a Unit an effect played inside it, whose {Play} triggers joined it. */
export function isPlayedInBatch(c: DeepReadonly<TriggerContinuation> | undefined, subjectId: CardInstanceId | undefined) {
    return Boolean(c && subjectId !== undefined && (c.origin.kind === "PLAY" && c.origin.subjectId === subjectId || c.effectPlays?.some(p => p.subjectId === subjectId)));
}
