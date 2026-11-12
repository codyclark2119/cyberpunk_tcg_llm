// Cross-language check for training records written outside TypeScript (scripts/test_training_records.py).
// Reads TrainingPosition/TrainingAttempt JSONL through the TS contract, reports per-line verdicts as JSON,
// and re-exports accepted records with exportPositions/exportAttempts so Python can read TS output back.
// Usage: node --import tsx scripts/check-training-records.ts <positions.jsonl> <attempts.jsonl> <outDir> [content.json]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ContentBundleSchema } from "@tcg/domain";
import { importPositions, exportPositions, exportAttempts, TrainingAttemptSchema, validateTrainingPosition, type TrainingAttempt, type TrainingPosition } from "@tcg/training-harness";

const [positionsPath, attemptsPath, outDir, contentPath] = process.argv.slice(2);
if (!positionsPath || !attemptsPath || !outDir) {
    process.stderr.write("usage: check-training-records.ts <positions.jsonl> <attempts.jsonl> <outDir> [content.json]\n");
    process.exit(2);
}
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter(l => l.trim());
const verdict = <T>(parse: () => T) => { try { return { ok: true as const, value: parse() }; } catch (error) { return { ok: false as const, error: String(error instanceof Error ? error.message : error).slice(0, 300) }; } };

// importPositions is the public reader; run it per line so one bad record does not hide the verdict on the rest.
const positions = lines(positionsPath).map(line => verdict(() => importPositions(line)[0] as TrainingPosition));
const attempts = lines(attemptsPath).map(line => verdict(() => TrainingAttemptSchema.parse(JSON.parse(line)) as TrainingAttempt));
const whole = verdict(() => importPositions(readFileSync(positionsPath, "utf8")).length);
const context = contentPath ? { content: ContentBundleSchema.parse(JSON.parse(readFileSync(contentPath, "utf8")).content) } : undefined;
const derivation = context ? positions.map(p => p.ok ? validateTrainingPosition(p.value, context).ok : false) : [];

mkdirSync(outDir, { recursive: true });
const accepted = positions.every(p => p.ok) && attempts.every(a => a.ok);
if (accepted) {
    writeFileSync(join(outDir, "positions.ts.jsonl"), exportPositions(positions.map(p => p.value!)));
    writeFileSync(join(outDir, "attempts.ts.jsonl"), exportAttempts(attempts.map(a => a.value!)));
}
process.stdout.write(JSON.stringify({
    importPositions: whole.ok ? { ok: true, count: whole.value } : whole,
    positions: positions.map(p => p.ok ? { ok: true, positionId: p.value.positionId } : p),
    attempts: attempts.map(a => a.ok ? { ok: true, attemptId: a.value.attemptId } : a),
    derivationMatches: derivation,
    exported: accepted
}) + "\n");
