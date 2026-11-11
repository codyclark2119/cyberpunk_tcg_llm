// Shared plumbing for the baseline writers: repository-anchored paths, the
// Demo matrix trace directory, and one write-or-check implementation so every
// generator compares committed bytes the same way.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Absolute path for a repository-relative path, independent of the caller's cwd. */
export function repoPath(path: string): string {
    return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

/** Repository-relative spelling of a path, for messages. */
export function displayPath(path: string): string {
    return relative(REPO_ROOT, repoPath(path)) || ".";
}

export const DEFAULT_MATRIX_TRACE_DIR = "/tmp/tcg-reboot-model-a-traces";

/** Directory holding full Demo matrix traces; override with DEMO_MATRIX_TRACE_DIR. */
export function matrixTraceDir(options: { create?: boolean } = {}): string {
    const directory = resolve(process.env.DEMO_MATRIX_TRACE_DIR || DEFAULT_MATRIX_TRACE_DIR);
    if (options.create) mkdirSync(directory, { recursive: true });
    return directory;
}

export function matrixTracePath(id: string): string {
    return `${matrixTraceDir()}/${id}.json`;
}

export function readCommitted(path: string): string | null {
    try {
        return readFileSync(repoPath(path), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

export class ArtifactMismatchError extends Error {
    constructor(readonly paths: readonly string[]) {
        super(`Regenerated output differs from the committed file: ${paths.join(", ")}`);
        this.name = "ArtifactMismatchError";
    }
}

/**
 * Write `serialized` to `path`, or in check mode compare it with the committed
 * bytes and throw an ArtifactMismatchError naming the file. Returns the byte length.
 */
export function writeOrCheckArtifact(path: string, serialized: string, check: boolean): number {
    if (check) {
        if (readCommitted(path) !== serialized) throw new ArtifactMismatchError([displayPath(path)]);
    } else {
        writeFileSync(repoPath(path), serialized);
    }
    return Buffer.byteLength(serialized);
}

/** Compact one-line JSON artifacts, as the matrix and review fixtures use. */
export const compactJson = (value: unknown) => JSON.stringify(value) + "\n";
/** Indented JSON artifacts, as the ordinary replay fixtures use. */
export const prettyJson = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

/** The `artifact(path, value)` helper the matrix-family writers share. */
export function compactArtifactWriter(check: boolean) {
    return (path: string, value: unknown) => writeOrCheckArtifact(path, compactJson(value), check);
}
