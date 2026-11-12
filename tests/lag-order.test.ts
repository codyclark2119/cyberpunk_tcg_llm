import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hashCanonical, type GameEvent } from "@tcg/domain";
import { canonicalLagOrder, eventsMatchHashUpToLagOrder } from "../scripts/lib/lag-order";

// Preserved-replay and frozen-reproducer checks compare LAG_REMOVED runs as sets
// (scripts/lib/lag-order.ts). Prove that is the only relaxation.
type Payload = GameEvent["payload"];
const lag = (id: string) => ({ kind: "LAG_REMOVED", cardInstanceId: id }) as Payload;
const ended = { kind: "TURN_ENDED", playerId: "00000000-0000-4000-8000-000000000003", turn: 4 } as Payload;
const phase = { kind: "PHASE_CHANGED", step: "TURN_END" } as Payload;
const events = (...payloads: Payload[]) => payloads.map((payload, i) => ({ sequence: 100 + i, payload })) as GameEvent[];

const original = events(phase, lag("p0-c4"), lag("p1-c9"), lag("p0-c22"), ended);
const same = (actual: GameEvent[], expected: GameEvent[]) =>
    hashCanonical(canonicalLagOrder(actual)) === hashCanonical(canonicalLagOrder(expected));

test("LAG_REMOVED order inside one contiguous run is accepted", () => {
    const sorted = events(phase, lag("p0-c22"), lag("p0-c4"), lag("p1-c9"), ended);
    assert.ok(same(sorted, original));
    assert.deepEqual(canonicalLagOrder(original), sorted, "code-unit card-id order; sequences stay in place");
    assert.ok(eventsMatchHashUpToLagOrder(sorted, hashCanonical(original)));
    assert.ok(eventsMatchHashUpToLagOrder(original, hashCanonical(original)));
});

test("every other event difference is still rejected", () => {
    const changed: [string, GameEvent[]][] = [
        ["missing LAG_REMOVED", events(phase, lag("p0-c4"), lag("p1-c9"), ended)],
        ["extra LAG_REMOVED", events(phase, lag("p0-c4"), lag("p1-c9"), lag("p0-c22"), lag("p0-c5"), ended)],
        ["LAG_REMOVED for another card", events(phase, lag("p0-c4"), lag("p1-c9"), lag("p0-c23"), ended)],
        ["LAG_REMOVED moved outside its run", events(phase, lag("p0-c4"), lag("p1-c9"), ended, lag("p0-c22"))],
        ["LAG_REMOVED moved before another event", events(lag("p0-c22"), phase, lag("p0-c4"), lag("p1-c9"), ended)],
        ["other events reordered", events(lag("p0-c4"), lag("p1-c9"), lag("p0-c22"), phase, ended)],
        ["other event changed", events(phase, lag("p0-c4"), lag("p1-c9"), lag("p0-c22"), { ...ended, turn: 5 } as Payload)],
        ["sequence changed", original.map((e, i) => i === 2 ? { ...e, sequence: 999 } : e) as GameEvent[]],
    ];
    for (const [name, actual] of changed) {
        assert.equal(same(actual, original), false, name);
        assert.equal(eventsMatchHashUpToLagOrder(actual, hashCanonical(original)), false, name);
    }
    // Two runs separated by another event are compared independently, not merged.
    const split = events(lag("p0-c4"), phase, lag("p0-c22"), ended);
    assert.equal(same(events(lag("p0-c22"), phase, lag("p0-c4"), ended), split), false);
    assert.equal(eventsMatchHashUpToLagOrder(events(lag("p0-c22"), phase, lag("p0-c4"), ended), hashCanonical(split)), false);
});

test("frozen Reboot reproducer evidence is byte-identical", () => {
    const bytes = readFileSync("tests/fixtures/reboot-multiplicity-reproducers.v1.json");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), "a9f93f9696296e2aa9f69063be9ea17790eba089bd9b2adfab7e65a864e8ef96");
});
