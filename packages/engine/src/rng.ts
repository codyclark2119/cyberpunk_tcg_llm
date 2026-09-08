import { hashCanonical, type GameState } from "@tcg/domain";
export function drawDeterministicInteger(rng: GameState["rng"], faces: number) {
    if (!Number.isSafeInteger(faces) || faces < 2 || faces > 1000000)
        throw new Error("Unsupported die");
    let counter = rng.counter, value: number;
    const limit = Math.floor(0x100000000 / faces) * faces;
    do {
        if (!Number.isSafeInteger(counter + 1))
            throw new Error("RNG counter exhausted");
        value = parseInt(hashCanonical({ algorithm: rng.algorithm, seed: rng.seed, counter: counter++ }).slice(0, 8), 16);
    } while (value >= limit);
    return { rawValue: value % faces + 1, rng: { ...rng, counter } };
}
export const drawDeterministicDie = drawDeterministicInteger;
