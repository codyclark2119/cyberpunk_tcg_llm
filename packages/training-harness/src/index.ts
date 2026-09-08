import { z } from "zod";
import { GameStateSchema, LegalActionSchema, ModelChoiceSchema, HashSchema, ContentBundleManifestSchema, canonicalSerialize, hashCanonical, failure, success, type GameState, type PlayerId } from "@tcg/domain";
import { listLegalActions, resolveActionId, applyAction, observe, PlayerObservationSchema, hashReplayState, hashPosition, hashObservation, type EngineContext } from "@tcg/engine";
export const TrainingPositionSchema = z.strictObject({
    schemaVersion: z.literal(2), positionId: z.string().min(1), engineVersion: z.string(), engineArtifactHash: HashSchema,
    manifest: ContentBundleManifestSchema, contentManifestHash: HashSchema, state: GameStateSchema, stateHash: HashSchema,
    observation: PlayerObservationSchema, observationHash: HashSchema, actingSeat: z.number().int().nonnegative(), legalActions: z.array(LegalActionSchema), positionHash: HashSchema,
    provenance: z.strictObject({ generator: z.string().min(1), revision: z.string().min(1), seed: z.string().min(1) })
}).superRefine((p, ctx) => {
    if (hashReplayState(p.state) !== p.stateHash || hashPosition(p.state) !== p.positionHash || hashObservation(p.observation) !== p.observationHash || hashCanonical(p.manifest) !== p.contentManifestHash || p.state.match.contentManifestHash !== p.contentManifestHash || p.engineArtifactHash !== p.manifest.engine.artifactHash || p.engineVersion !== p.manifest.engine.version || p.actingSeat !== p.observation.viewerSeat || p.provenance.seed !== p.state.rng.seed)
        ctx.addIssue({ code: "custom", message: "Position hashes/context mismatch" });
});
export const TrainingAttemptSchema = z.strictObject({
    schemaVersion: z.literal(1), attemptId: z.string().min(1), positionId: z.string().min(1), rawModelOutput: z.string(), parsedChoice: ModelChoiceSchema.nullable(),
    validation: z.strictObject({ ok: z.boolean(), codes: z.array(z.string()) }), resultingStateHash: HashSchema.nullable(),
    modelRevision: z.string().min(1), tokenizerRevision: z.string().min(1), adapterRevision: z.string().min(1), promptFingerprint: HashSchema,
    decoding: z.strictObject({ temperature: z.number().nonnegative(), topP: z.number().min(0).max(1), maxTokens: z.number().int().positive(), seed: z.number().int().nullable() }),
    elapsedMs: z.number().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative()
});
export type TrainingPosition = z.infer<typeof TrainingPositionSchema>;
export type TrainingAttempt = z.infer<typeof TrainingAttemptSchema>;
export function generatePosition(state: GameState, actor: PlayerId, context: EngineContext, positionId: string, provenance = { generator: "manual-fixture", revision: "1", seed: state.rng.seed }) {
    if (actor !== state.timing.actingPlayer)
        return failure("INVALID_ACTOR", "Position actor must own the decision");
    const legal = listLegalActions(state, actor, context);
    if (!legal.ok)
        return legal;
    if (!legal.value.length) return failure("NO_PLAYER_DECISION", "Training positions require a stable nonempty legal action set");
    const observation = observe(state, actor, context);
    if (!observation.ok)
        return observation;
    return success(TrainingPositionSchema.parse({ schemaVersion: 2, positionId, engineVersion: state.match.engineVersion, engineArtifactHash: state.match.engineArtifactHash, manifest: context.content.manifest, contentManifestHash: context.content.manifestHash, state, stateHash: hashReplayState(state), observation: observation.value, observationHash: hashObservation(observation.value), actingSeat: state.players[actor].seat, legalActions: legal.value, positionHash: hashPosition(state), provenance }));
}
export function evaluateCandidate(position: TrainingPosition, choice: unknown, context: EngineContext) {
    const parsed = ModelChoiceSchema.safeParse(choice);
    if (!parsed.success)
        return failure("INVALID_MODEL_OUTPUT", parsed.error.message);
    const actor = position.state.match.playerOrder[position.actingSeat];
    const action = resolveActionId(position.state, actor, parsed.data.actionId, context);
    if (!action.ok)
        return action;
    return applyAction(position.state, action.value, context);
}
export function importPositions(jsonl: string): TrainingPosition[] { return jsonl.split("\n").filter(l => l.trim()).map(l => TrainingPositionSchema.parse(JSON.parse(l))); }
export function exportPositions(positions: readonly TrainingPosition[]): string {
    const unique = new Map<string, TrainingPosition>();
    for (const input of positions) {
        const p = TrainingPositionSchema.parse(input), existing = unique.get(p.positionId);
        if (existing && canonicalSerialize(existing) !== canonicalSerialize(p))
            throw new Error("Conflicting position ID");
        unique.set(p.positionId, p);
    }
    return [...unique.values()].map(canonicalSerialize).join("\n") + (unique.size ? "\n" : "");
}
export function exportAttempts(attempts: readonly TrainingAttempt[]): string {
    const ids = new Set<string>();
    return attempts.map(input => { const a = TrainingAttemptSchema.parse(input); if (ids.has(a.attemptId))
        throw new Error("Duplicate attempt ID"); ids.add(a.attemptId); return canonicalSerialize(a); }).join("\n") + (attempts.length ? "\n" : "");
}
/** The only model-facing training payload. Full positions are private replay artifacts. */
export function modelInput(position: TrainingPosition) { return { observation: position.observation, legalActions: position.legalActions.map(a => ({ actionId: a.actionId, descriptor: a.descriptor })) }; }

/** Revalidate imported positions against the actual bundle before using labels or prompts. */
export function validateTrainingPosition(input: unknown, context: EngineContext) {
    const parsed = TrainingPositionSchema.safeParse(input);
    if (!parsed.success) return failure("INVALID_POSITION", parsed.error.message);
    const p = parsed.data;
    const actor = p.state.match.playerOrder[p.actingSeat];
    if (!actor) return failure("INVALID_ACTING_SEAT", "Position seat is not in match");
    const rebuilt = generatePosition(p.state, actor, context, p.positionId, p.provenance);
    if (!rebuilt.ok) return rebuilt;
    if (canonicalSerialize(rebuilt.value) !== canonicalSerialize(p)) return failure("POSITION_DERIVATION_MISMATCH", "Observation and legal actions must match authoritative derivation");
    return rebuilt;
}
