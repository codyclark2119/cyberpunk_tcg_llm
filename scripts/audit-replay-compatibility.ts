import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ContentBundleSchema, GameActionSchema, GameEventSchema, GameStateSchema, LegalActionSchema, PlayerIdSchema, canonicalSerialize, createContentBundle, type GameState, type LegalAction, type Result } from "@tcg/domain";
import { CreateGameInputSchema, PlayerObservationSchema, applyAction, createGameWithEvents, listLegalActions, observe, type ActionResult } from "@tcg/engine";
import { demoStarterContext } from "../tests/demo-starter-fixture";
import { engineIdentity } from "./engine-identity";
/** Audit untouched pre-milestone payloads. Regenerated hashes cannot prove compatibility.
 * Usage: node --import tsx scripts/audit-replay-compatibility.ts /path/to/preserved-replays
 */
const baseline = process.argv[2];
if (!baseline) throw new Error("A directory of preserved original replay JSON files is required");
const files = readdirSync(baseline).filter(n => n.endsWith("-replay.v1.json")).sort();
assert.ok(files.length > 0, "No original replay families found");
const schema = z.object({ content: ContentBundleSchema, initialization: CreateGameInputSchema,
    initialized: z.object({ state: GameStateSchema, events: z.array(GameEventSchema) }),
    steps: z.array(z.object({ actorId: PlayerIdSchema, action: GameActionSchema, legalActions: z.array(LegalActionSchema), observation: PlayerObservationSchema, events: z.array(GameEventSchema) })), finalState: GameStateSchema });
function unwrap<T>(r: Result<T>): T { if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.value; }
const semanticActions = (actions: LegalAction[]) => actions.map(({ actorId, action, descriptor }) => ({ actorId, action, descriptor })).sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
let decisions = 0;
for (const name of files) {
    const original = schema.parse(JSON.parse(readFileSync(resolve(baseline, name), "utf8")));
    const originalContext = { content: createContentBundle(original.content.ruleset, original.content.cards, engineIdentity()) };
    const contexts = name === "demo-setup-replay.v1.json" ? [originalContext, demoStarterContext()] : [originalContext];
    for (const [policyIndex, context] of contexts.entries()) {
        const repin = (s: GameState) => ({ ...s, match: { ...s.match, rulesetVersion: context.content.ruleset.version, rulesetHash: context.content.manifest.ruleset.hash, engineVersion: context.content.manifest.engine.version, engineArtifactHash: context.content.manifest.engine.artifactHash, contentManifestHash: context.content.manifestHash } });
        const initialized = unwrap(createGameWithEvents(original.initialization, context)); let state: GameState = initialized.state;
        assert.deepEqual(state, repin(original.initialized.state), `${name}: initial state`);
        assert.deepEqual(initialized.events, original.initialized.events, `${name}: initial events`);
        for (const [i, step] of original.steps.entries()) {
            assert.deepEqual(semanticActions(unwrap(listLegalActions(state, step.actorId, context))), semanticActions(step.legalActions), `${name}: legal actions/descriptors ${i}`);
            assert.deepEqual(unwrap(observe(state, step.actorId, context)), step.observation, `${name}: observation ${i}`);
            const next: ActionResult = unwrap(applyAction(state, step.action, context)); assert.deepEqual(next.events, step.events, `${name}: events ${i}`); state = next.state; if (policyIndex === 0) decisions++;
        }
        assert.deepEqual(state, repin(original.finalState), `${name}: final state`);
        process.stdout.write(`${name}: ${original.steps.length} original decisions preserved${policyIndex ? " also under current supported Demo overtime policy" : ""}\n`);
    }
}
process.stdout.write(`PASS: ${files.length} original families, ${decisions} original decisions; semantic legal actions/descriptors, observations, events and final states unchanged under new pins\n`);
