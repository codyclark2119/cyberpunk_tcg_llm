import { RulesetSchema, createContentBundle, demoStarterPolicy, demoDeckPolicy } from "@tcg/domain";
import { demoReferenceContext, referenceInput } from "./demo-format-fixture";
export function demoStarterContext() {
    const base = demoReferenceContext().content;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, version: "demo-format-1", demoStarter: demoStarterPolicy,
        formats: { ...base.ruleset.formats, DEMO_STARTER_V1: demoDeckPolicy } });
    return { content: createContentBundle(ruleset, base.cards, base.manifest.engine) };
}
export function demoStarterInput(seed = "demo-setup-0") {
    return { ...referenceInput(), matchId: "00000000-0000-4000-a000-00000000d001", format: "DEMO_STARTER_V1" as const, seed };
}
