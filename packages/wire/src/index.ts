// Trusted local engine transport: transition/state/event payloads are authoritative private replay data.
// UI/model consumers must use observe/modelInput projections, never forward raw transitions.
import { z } from "zod";
import { ContentBundleSchema, GameStateSchema, PlayerIdSchema, HashSchema, LegalActionSchema, GameEventSchema, GameActionSchema, failure } from "@tcg/domain";
import { createGameWithEvents, CreateGameInputSchema, validateState, listLegalActions, resolveActionId, validateAction, applyAction, observe, hashReplayState, hashPosition, hashObservation, PlayerObservationSchema } from "@tcg/engine";
import { buildModelInputV2, ModelInputV2Schema } from "@tcg/engine/public-actions";
const StateRequestSchema = z.strictObject({ schemaVersion: z.literal(1), requestId: z.string().min(1), op: z.enum(["validateState", "listLegalActions", "validateAction", "applyAction", "observe", "hash", "modelInput"]), content: ContentBundleSchema, state: GameStateSchema, actorId: PlayerIdSchema, actionId: HashSchema.optional() });
export const WireRequestSchema = z.discriminatedUnion("op", [StateRequestSchema, z.strictObject({ schemaVersion: z.literal(1), requestId: z.string().min(1), op: z.literal("createGame"), content: ContentBundleSchema, initialization: CreateGameInputSchema })]);
const ErrorSchema = z.strictObject({ code: z.string(), message: z.string(), path: z.string().optional() });
export const WireResponseSchema = z.discriminatedUnion("ok", [
    z.strictObject({ schemaVersion: z.literal(1), requestId: z.string(), ok: z.literal(false), errors: z.array(ErrorSchema) }),
    z.strictObject({ schemaVersion: z.literal(1), requestId: z.string(), ok: z.literal(true), value: z.union([
            z.strictObject({ kind: z.literal("state"), state: GameStateSchema }),
            z.strictObject({ kind: z.literal("actions"), actions: z.array(LegalActionSchema) }),
            z.strictObject({ kind: z.literal("action"), action: GameActionSchema }),
            z.strictObject({ kind: z.literal("transition"), state: GameStateSchema, events: z.array(GameEventSchema), stateHash: HashSchema }),
            z.strictObject({ kind: z.literal("observation"), observation: PlayerObservationSchema }),
            z.strictObject({ kind: z.literal("modelInput"), modelInput: ModelInputV2Schema }),
            z.strictObject({ kind: z.literal("hashes"), stateHash: HashSchema, positionHash: HashSchema, observationHash: HashSchema })
        ]) })
]);
export function handleRequest(input: unknown) {
    const parsed = WireRequestSchema.safeParse(input);
    const requestId = typeof input === "object" && input !== null && "requestId" in input && typeof input.requestId === "string" ? input.requestId : "";
    const envelope = { schemaVersion: 1 as const, requestId };
    if (!parsed.success)
        return WireResponseSchema.parse({ ...envelope, ...failure("INVALID_REQUEST", parsed.error.message) });
    const r = parsed.data, context = { content: r.content };
    if (r.op === "createGame") {
        const created = createGameWithEvents(r.initialization, context);
        return WireResponseSchema.parse({ ...envelope, ...(created.ok ? { ok: true, value: { kind: "transition", ...created.value, stateHash: hashReplayState(created.value.state) } } : created) });
    }
    const valid = validateState(r.state, context);
    if (!valid.ok)
        return { ...envelope, ...valid };
    let result: unknown;
    switch (r.op) {
        case "validateState":
            result = { ok: true, value: { kind: "state", state: valid.value } };
            break;
        case "listLegalActions": {
            const a = listLegalActions(valid.value, r.actorId, context);
            result = a.ok ? { ok: true, value: { kind: "actions", actions: a.value } } : a;
            break;
        }
        case "observe": {
            const o = observe(valid.value, r.actorId, context);
            result = o.ok ? { ok: true, value: { kind: "observation", observation: o.value } } : o;
            break;
        }
        case "modelInput": {
            const m = buildModelInputV2(valid.value, r.actorId, context);
            result = m.ok ? { ok: true, value: { kind: "modelInput", modelInput: m.value } } : m;
            break;
        }
        case "hash": {
            const o = observe(valid.value, r.actorId, context);
            result = o.ok ? { ok: true, value: { kind: "hashes", stateHash: hashReplayState(valid.value), positionHash: hashPosition(valid.value), observationHash: hashObservation(o.value) } } : o;
            break;
        }
        case "validateAction":
        case "applyAction": {
            const a = resolveActionId(valid.value, r.actorId, r.actionId ?? "", context);
            if (!a.ok) {
                result = a;
                break;
            }
            if (r.op === "validateAction") {
                const v = validateAction(valid.value, a.value, context);
                result = v.ok ? { ok: true, value: { kind: "action", action: v.value } } : v;
            }
            else {
                const v = applyAction(valid.value, a.value, context);
                result = v.ok ? { ok: true, value: { kind: "transition", ...v.value, stateHash: hashReplayState(v.value.state) } } : v;
            }
            break;
        }
    }
    return WireResponseSchema.parse({ ...envelope, ...(result as object) });
}
