import { parseArgs } from "node:util";
import { captureV5Evidence, DETONATE_SOURCE_PIN } from "./lib/api-admission-batch-v5-evidence";

// Read-only source verification. No mechanics or revision is inferred from a source record.
const { values } = parseArgs({ options: { "ai-root": { type: "string" } } });
if (!values["ai-root"]) throw new Error("Usage: node --import tsx scripts/verify-api-admission-batch-v5-source.ts --ai-root PATH");
const { card, rules } = captureV5Evidence(values["ai-root"]);
console.log(JSON.stringify({ schemaVersion: 1, result: "SOURCE_MATCH", sourceCardSlug: "detonate",
    sourceCommit: DETONATE_SOURCE_PIN.commit, rawSha256: card.rawSha256, rawRecordHash: card.rawRecordHash,
    processedRecordHash: card.processedRecordHash, candidateHash: card.candidateHash,
    catalogSha256: card.manifest.catalogSha256, matchingErrata: card.matchingErrata,
    exactRules: rules.rules.length, authoredDecisions: rules.decisions.length,
    note: "Read-only source verification. Source facts and parser hints remain evidence; authored decisions are separate from exact rule text." }, null, 2));
