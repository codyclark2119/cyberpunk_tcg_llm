// Regenerate or check the independent replay fixtures listed in
// scripts/lib/replay-registry.ts.
//
// Usage:
//   npm run replays:generate                       # write every fixture
//   npm run replays:generate -- turn-replay ...    # write the named fixtures
//   npm run replays:generate -- --check [names]    # regenerate in memory, fail on any byte difference
//   npm run replays:generate -- --list             # print names and output paths
//
// --check never writes. It builds every selected fixture, then exits 1 and
// names each file whose committed bytes differ from (or are missing for) the
// regenerated output.
import { REPLAY_FIXTURES, type ReplayFixture } from "./lib/replay-registry";
import { displayPath, prettyJson, readCommitted, writeOrCheckArtifact } from "./lib/generated-artifacts";

function usage(): string {
    return "Usage: generate-replays.ts [--check] [--list] [name ...]\nNames: " + REPLAY_FIXTURES.map(f => f.name).join(", ");
}

function parseArgs(argv: readonly string[]) {
    let check = false, list = false;
    const names: string[] = [];
    for (const arg of argv) {
        if (arg === "--check") check = true;
        else if (arg === "--list") list = true;
        else if (arg === "-h" || arg === "--help") { console.log(usage()); process.exit(0); }
        else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}\n${usage()}`);
        else names.push(arg);
    }
    return { check, list, names };
}

function select(names: readonly string[]): ReplayFixture[] {
    if (!names.length) return [...REPLAY_FIXTURES];
    const unknown = names.filter(name => !REPLAY_FIXTURES.some(f => f.name === name));
    if (unknown.length) throw new Error(`Unknown fixture name(s): ${unknown.join(", ")}\n${usage()}`);
    return REPLAY_FIXTURES.filter(f => names.includes(f.name));
}

function summarize(value: unknown) {
    const v = value as { steps?: unknown[]; positions?: unknown[]; finalStateHash?: string } | null;
    return {
        ...(Array.isArray(v?.steps) ? { actions: v.steps.length } : {}),
        ...(Array.isArray(v?.positions) ? { positions: v.positions.length } : {}),
        ...(typeof v?.finalStateHash === "string" ? { finalStateHash: v.finalStateHash } : {})
    };
}

function main() {
    const { check, list, names } = parseArgs(process.argv.slice(2));
    const selected = select(names);
    if (list) {
        for (const f of selected) console.log(`${f.name}\t${f.output}`);
        return;
    }
    const differing: string[] = [];
    for (const f of selected) {
        const value = f.build(), serialized = prettyJson(value);
        let status: "written" | "matches" | "differs" | "missing";
        if (check) {
            const committed = readCommitted(f.output);
            status = committed === null ? "missing" : committed === serialized ? "matches" : "differs";
            if (status !== "matches") differing.push(displayPath(f.output));
        } else {
            writeOrCheckArtifact(f.output, serialized, false);
            status = "written";
        }
        console.log(JSON.stringify({ name: f.name, output: f.output, status, bytes: Buffer.byteLength(serialized), ...summarize(value) }));
    }
    if (differing.length) {
        console.error(`generate-replays --check: ${differing.length} of ${selected.length} fixture(s) differ from the committed bytes:`);
        for (const path of differing) console.error(`  ${path}`);
        process.exitCode = 1;
    } else if (check) {
        console.log(`generate-replays --check: all ${selected.length} fixture(s) match the committed bytes`);
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
