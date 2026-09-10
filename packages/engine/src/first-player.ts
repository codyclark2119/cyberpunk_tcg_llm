import type { GameState } from "@tcg/domain";
import { drawDeterministicInteger } from "./rng";

/** Setup-only randomness; seat 0 then seat 1, rerolling BOTH on every tie.
 * No arbitrary reroll limit. The shared RNG already rejects exhausted counters. */
export function selectOpposedD20(initial: GameState["rng"]) {
    let rng = initial;
    const rounds: [number, number][] = [];
    while (true) {
        const a = drawDeterministicInteger(rng, 20), b = drawDeterministicInteger(a.rng, 20);
        rng = b.rng;
        rounds.push([a.rawValue, b.rawValue]);
        if (a.rawValue !== b.rawValue) return { rounds, rng, decidingSeat: a.rawValue > b.rawValue ? 0 : 1 };
    }
}
