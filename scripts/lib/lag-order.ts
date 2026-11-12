// Comparison of one transition's events up to the order of LAG_REMOVED events.
//
// Before engine 0.4.2, finishEndTurn emitted LAG_REMOVED in the insertion order of
// state.objects.cards, which canonical state hashes ignore. Since 0.4.2 it emits them
// by card instance id. Preserved replays and frozen reproducer hashes recorded the old
// order, so their checks compare events with each contiguous LAG_REMOVED run in a
// canonical order (approved by Cody, 2026-11-12). Nothing else is relaxed: every other
// event, every sequence number, and the length and position of each run must match
// exactly, so a missing, extra or displaced LAG_REMOVED is still a difference.
import { hashCanonical, type GameEvent } from "@tcg/domain";

type Payload = GameEvent["payload"];
const isLag = (p: Payload) => p.kind === "LAG_REMOVED";
const lagId = (p: Payload) => (p.kind === "LAG_REMOVED" ? p.cardInstanceId : "");
const byCardId = (a: Payload, b: Payload) => (lagId(a) < lagId(b) ? -1 : lagId(a) > lagId(b) ? 1 : 0);

/** Maximal runs of adjacent LAG_REMOVED events, as [start, end) index pairs. */
function lagRuns(events: readonly GameEvent[]): [number, number][] {
    const runs: [number, number][] = [];
    for (let i = 0; i < events.length; i++) {
        if (!isLag(events[i].payload)) continue;
        let end = i + 1;
        while (end < events.length && isLag(events[end].payload)) end++;
        if (end - i > 1) runs.push([i, end]);
        i = end - 1;
    }
    return runs;
}

/** A copy of events with each contiguous LAG_REMOVED run's payloads sorted by card
 * instance id (code-unit order). Sequence numbers and all other events stay in place. */
export function canonicalLagOrder(events: readonly GameEvent[]): GameEvent[] {
    const out = events.map(e => ({ ...e }));
    for (const [start, end] of lagRuns(events)) {
        const sorted = events.slice(start, end).map(e => e.payload).sort(byCardId);
        sorted.forEach((payload, k) => { out[start + k] = { ...out[start + k], payload }; });
    }
    return out;
}

const MAX_ORDERINGS = 40320; // 8! — far above any real end-of-turn LAG count.

/** True when events, with some reordering of payloads inside each contiguous LAG_REMOVED
 * run, hash to expectedHash. This is the same comparison as canonicalLagOrder on both
 * sides, for frozen evidence that kept only the hash of the original events. */
export function eventsMatchHashUpToLagOrder(events: readonly GameEvent[], expectedHash: string): boolean {
    if (hashCanonical(events) === expectedHash) return true;
    const runs = lagRuns(events);
    if (!runs.length) return false;
    const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
    if (runs.reduce((total, [s, e]) => total * factorial(e - s), 1) > MAX_ORDERINGS)
        throw new Error("Too many LAG_REMOVED orderings to compare against a frozen hash");
    const permutations = <T>(items: T[]): T[][] => items.length <= 1 ? [items]
        : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(p => [x, ...p]));
    const candidate = events.map(e => ({ ...e }));
    const search = (r: number): boolean => {
        if (r === runs.length) return hashCanonical(candidate) === expectedHash;
        const [start, end] = runs[r];
        for (const order of permutations(events.slice(start, end).map(e => e.payload))) {
            order.forEach((payload, k) => { candidate[start + k] = { ...candidate[start + k], payload }; });
            if (search(r + 1)) return true;
        }
        return false;
    };
    return search(0);
}
