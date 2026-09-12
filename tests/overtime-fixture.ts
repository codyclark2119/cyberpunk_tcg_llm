import { RulesetSchema, ContentBundleSchema, createContentBundle } from "@tcg/domain";
import type { EngineContext } from "@tcg/engine";
import { attackPowerContext } from "./attack-condition-power-fixture";
import { turnInput } from "./turn-fixture";
export function overtimeContext(base: EngineContext = attackPowerContext()) {
    const b = ContentBundleSchema.parse(base.content);
    const rules = RulesetSchema.parse({ ...b.ruleset, version: `${b.ruleset.version}-overtime-1`, gameplay: { ...b.ruleset.gameplay,
        turnSlice: { ...b.ruleset.gameplay!.turnSlice, overtime: "STANDARD_OVERTIME_V1" } } });
    return { content: createContentBundle(rules, b.cards, b.manifest.engine) };
}
/** Existing constructed vanilla support, not the exact Demo pair; no new card revisions. */
export function overtimeInput(seed = "overtime-0") {
    const input = turnInput(seed);
    return { matchId: "00000000-0000-4000-8000-00000000e001", players: input.players, decks: input.decks.map(d => ({ ...d, main: d.main.map(id => id === "slice-card-13" ? "emergency-atlus" : id === "slice-card-0" ? "mantis-blades" : id) })), seed, format: "CONSTRUCTED" as const };
}
