import type { DemoPolicyConfig } from "./demo-matrix-policy";
// Fixed before observing any matrix result. Seed-major, then A/B; no outcome-driven seed selection.
export const DEMO_MATRIX_CONFIG = {
    version: 1, seedPrefix: "demo-matrix-", baseSeedCount: 32, variantSeedCount: 8,
    seats: ["A", "B"], firstOrSecond: ["FIRST", "SECOND"],
    mulligans: [[false, false], [true, false], [false, true], [true, true]],
    setupAudit: { seed: "demo-matrix-000", scope: "SETUP_ONLY_ALL_16_PREFERENCES_EVEN_IF_MATCH_EXPANSION_BLOCKED" },
    limits: { actions: 1500, turns: 120 },
    stop: { sameKnownGapConfirmations: 3, engineError: "IMMEDIATE", variants: "ONLY_IF_ALL_64_BASE_COMPLETE" }
} as const;
export type MatrixCoordinate = DemoPolicyConfig & { seed: string; seats: "A" | "B"; branch: "base" | "variant" };
export function matrixCoordinates(branch: MatrixCoordinate["branch"]): MatrixCoordinate[] {
    const result: MatrixCoordinate[] = [];
    for (let i = 0; i < (branch === "base" ? 32 : 8); i++) for (const seats of DEMO_MATRIX_CONFIG.seats)
        for (const chooseFirstOrSecond of branch === "base" ? ["FIRST"] as const : DEMO_MATRIX_CONFIG.firstOrSecond)
            for (const mulligan of branch === "base" ? [DEMO_MATRIX_CONFIG.mulligans[0]] : DEMO_MATRIX_CONFIG.mulligans)
                result.push({ seed: `demo-matrix-${String(i).padStart(3, "0")}`, seats, branch, chooseFirstOrSecond, mulligan });
    return result;
}
export const coordinateId = (c: MatrixCoordinate) => `${c.branch}-${c.seed}-${c.seats}-${c.chooseFirstOrSecond}-${c.mulligan.map(m => m ? "M" : "K").join("")}`;
