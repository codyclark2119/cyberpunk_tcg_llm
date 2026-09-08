import { createContentBundle, RulesetSchema } from "@tcg/domain";
import { turnContext, turnInput } from "./turn-fixture";
export function setupContext() {
    const base = turnContext();
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "engine-setup-1", gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice!, setup: "ENGINE_SETUP_V1" } } });
    return { content: createContentBundle(rules, base.content.cards, base.content.manifest.engine) };
}
export function setupInput(seed = "setup-replay-1") {
    const { setup: external, ...input } = turnInput(seed);
    void external;
    return input;
}
