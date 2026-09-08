import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { WireRequestSchema, WireResponseSchema } from "@tcg/wire";
import { TrainingPositionSchema, TrainingAttemptSchema } from "@tcg/training-harness";
mkdirSync("packages/wire/schemas", { recursive: true });
for (const [name, schema] of Object.entries({ request: WireRequestSchema, response: WireResponseSchema, trainingPosition: TrainingPositionSchema, trainingAttempt: TrainingAttemptSchema }))
    writeFileSync(`packages/wire/schemas/${name}.v1.json`, JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2) + "\n");
// JSON Schema covers structural checks. Zod/engine checks enforce hashes and cross references.
