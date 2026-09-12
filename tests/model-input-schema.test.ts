import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ModelInputV2Schema } from "@tcg/engine/public-actions";

test("checked-in model input v2 JSON Schema matches the runtime contract", () => {
    const expected = z.toJSONSchema(ModelInputV2Schema, { io: "input" });
    const actual = JSON.parse(readFileSync("packages/wire/schemas/modelInput.v2.json", "utf8"));
    assert.deepEqual(actual, expected);
});
