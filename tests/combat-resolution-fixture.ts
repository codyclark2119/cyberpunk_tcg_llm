import { RulesetSchema, createContentBundle } from "@tcg/domain";
import { reactContext } from "./react-fixture";
export function resolutionContext() {
    const base = reactContext();
    const ruleset = RulesetSchema.parse({ ...base.content.ruleset, version: "combat-resolution-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice,
        combatResolution: { version: "COMBAT_RESOLUTION_V1", negativeReferences: "ZERO", temporaryModifierIdentity: "PHYSICAL_CARD_UNTIL_HIDDEN_OR_TURN_END", gigSteal: { nonPositive: 0, positiveDivisor: 10, positiveBase: 1 } }
    } } });
    return { content: createContentBundle(ruleset, base.content.cards, base.content.manifest.engine) };
}
