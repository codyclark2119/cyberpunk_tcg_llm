import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, RulesetSchema, canonicalSerialize, createContentBundle, type CardRevisionSnapshot } from "@tcg/domain";
import { batchV6Context } from "./api-admission-batch-v6-fixture";
import { attackPowerContext } from "./attack-condition-power-fixture";
import { demoStarterContext } from "./demo-starter-fixture";
import { batchV51Context } from "./api-admission-batch-v51-fixture";

// Every reviewed executable revision of a real catalog card, under one ruleset with every
// reviewed turn-slice gate on. The admission chains (batchV6Context: V2-V6 and the linear
// fixture chain; attackPowerContext: targeted spend and Losing His Way) each carry part of
// the reviewed set; no gate requires another to be off, so their union is consistent.
// Synthetic test cards (slice-card-*, dev-*, support Legends) are left out: only slugs in
// the engine-candidate catalog are real cards. Not for Demo games, which require exactly
// the 29 reference revisions; Demo keeps demoStarterContext().

const catalog = new URL("../data/engine-candidates/card-catalog.v1.jsonl", import.meta.url);
export function catalogSlugs(): Set<string> {
    return new Set(readFileSync(catalog, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).sourceCardSlug as string));
}

export function reviewedUnionContext() {
    const demo = demoStarterContext().content, sources = [batchV6Context(demo.manifest.engine).content, attackPowerContext().content, batchV51Context().content, demo];
    const real = catalogSlugs(), cards = new Map<string, CardRevisionSnapshot>();
    for (const card of sources.flatMap(s => s.cards)) {
        if (card.schemaVersion !== 2 || !card.provenance.reviewed || card.execution?.status !== "SUPPORTED" || !real.has(card.id)) continue;
        const key = `${card.id}@${card.revision}`, previous = cards.get(key);
        if (previous) assert.equal(canonicalSerialize(card), canonicalSerialize(previous), `Conflicting immutable revision ${key}`);
        else cards.set(key, CardRevisionSnapshotSchema.parse(card));
    }
    const turnSlice: Record<string, unknown> = {};
    for (const source of sources) {
        for (const [key, value] of Object.entries(source.ruleset.gameplay!.turnSlice!)) {
            // rulesSourceHash is free text; overtime is taken from the Demo ruleset, the only
            // one that reviewed STANDARD_OVERTIME_V1 (the others predate it as UNSUPPORTED).
            if (key === "rulesSourceHash" || key === "overtime") continue;
            if (key in turnSlice) assert.equal(canonicalSerialize(turnSlice[key]), canonicalSerialize(value), `Conflicting turn-slice policy ${key}`);
            else turnSlice[key] = value;
        }
    }
    turnSlice.rulesSourceHash = demo.ruleset.gameplay!.turnSlice!.rulesSourceHash;
    turnSlice.overtime = demo.ruleset.gameplay!.turnSlice!.overtime;
    const ruleset = RulesetSchema.parse({ ...demo.ruleset, version: "reviewed-union-1", gameplay: { ...demo.ruleset.gameplay, turnSlice } });
    return { content: createContentBundle(ruleset, [...cards.values()].sort((a, b) => a.id.localeCompare(b.id) || a.revision - b.revision), demo.manifest.engine) };
}
