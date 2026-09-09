import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { hashCanonical } from "@tcg/domain";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
function files(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(path, e.name)) : [resolve(path, e.name)]); }
export function engineIdentity() {
    const paths = [...files(resolve(root, "packages/domain/src")), ...files(resolve(root, "packages/engine/src")), ...files(resolve(root, "packages/wire/src")), resolve(root, "scripts/engine-worker.ts"), resolve(root, "scripts/engine-identity.ts"), resolve(root, "package-lock.json")].sort();
    return { version: "0.4.0-delayed-effects-1", artifactHash: hashCanonical(paths.map(p => ({ path: relative(root, p), source: readFileSync(p, "utf8") }))) };
}
