// Offline JSONL transport. No application bootstrap, environment loader or infrastructure imports.
import { createInterface } from "node:readline";
import { handleRequest } from "@tcg/wire";
import { engineIdentity } from "./engine-identity";
const identity = engineIdentity();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", line => {
    try {
        const input: unknown = JSON.parse(line);
        // Bundle pins cannot impersonate the actual running worker artifact.
        if (typeof input === "object" && input !== null && "content" in input) {
            const content = input.content as {
                manifest?: {
                    engine?: {
                        artifactHash?: string;
                        version?: string;
                    };
                };
            };
            if (content?.manifest?.engine?.artifactHash !== identity.artifactHash || content?.manifest?.engine?.version !== identity.version) {
                const requestId = "requestId" in input && typeof input.requestId === "string" ? input.requestId : "";
                process.stdout.write(JSON.stringify({ schemaVersion: 1, requestId, ok: false, errors: [{ code: "ENGINE_ARTIFACT_MISMATCH", message: "Bundle must pin this worker artifact" }] }) + "\n");
                return;
            }
        }
        process.stdout.write(JSON.stringify(handleRequest(input)) + "\n");
    }
    catch (error) {
        process.stderr.write(String(error) + "\n");
        process.stdout.write(JSON.stringify({ schemaVersion: 1, requestId: "", ok: false, errors: [{ code: "INVALID_JSON", message: "Invalid JSON or unsupported request" }] }) + "\n");
    }
});
