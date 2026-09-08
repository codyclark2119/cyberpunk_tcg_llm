import { writeFileSync } from "node:fs";
import { fixtureContext, fixtureState, player } from "../tests/contract-fixture";
import { handleRequest } from "@tcg/wire";
import { listLegalActions } from "@tcg/engine";
const content = fixtureContext().content, state = fixtureState({ content }), legal = listLegalActions(state, player, { content });
if (!legal.ok || !legal.value.length)
    throw new Error("Golden fixture must exercise an action");
const cases = ["validateState", "observe", "hash", "listLegalActions", "validateAction", "applyAction"].map(op => ({ schemaVersion: 1, requestId: op, op, content, state, actorId: player, ...(["validateAction", "applyAction"].includes(op) ? { actionId: legal.value[0].actionId } : {}) }));
cases.push({ ...cases[4], requestId: "unknown-action", actionId: "0".repeat(64) });
writeFileSync("tests/fixtures/wire-golden.v1.json", JSON.stringify({ schemaVersion: 1, note: "Synthetic contract fixtures, not reviewed game positions or gold training data", cases: cases.map(request => ({ request, response: handleRequest(request) })) }, null, 2) + "\n");
