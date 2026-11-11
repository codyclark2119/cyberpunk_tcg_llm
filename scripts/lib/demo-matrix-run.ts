// The Demo matrix stop rule and attempt accounting, shared by the serial and
// parallel paths of scripts/generate-demo-match-matrix.ts so both decide when
// to stop, and what was left unattempted, in exactly one place.
import { DEMO_MATRIX_CONFIG, matrixCoordinates, type MatrixCoordinate } from "../../tests/demo-matrix-config";
import type { MatrixFailure } from "../../tests/demo-matrix-replay";

export const MATRIX_BRANCHES = ["base", "variant"] as const satisfies readonly MatrixCoordinate["branch"][];

/**
 * Applies DEMO_MATRIX_CONFIG.stop in coordinate order: stop at once on any
 * failure that is not KNOWN_UNSUPPORTED, or when the same known gap code has
 * been confirmed `sameKnownGapConfirmations` times; run variants only if every
 * base coordinate reached a supported terminal.
 */
export class MatrixStopRule {
    private readonly gaps = new Map<string, number>();
    private stoppedFlag = false;

    get stopped(): boolean {
        return this.stoppedFlag;
    }

    /** Record one attempted coordinate's failure (or null); true means stop now. */
    afterCoordinate(failure: Pick<MatrixFailure, "classification" | "code"> | null): boolean {
        if (!failure) return false;
        const count = (this.gaps.get(failure.code) ?? 0) + 1;
        this.gaps.set(failure.code, count);
        if (failure.classification !== "KNOWN_UNSUPPORTED" || count >= DEMO_MATRIX_CONFIG.stop.sameKnownGapConfirmations) this.stoppedFlag = true;
        return this.stoppedFlag;
    }

    /** Record the end of a branch; true means no further branch may run. */
    afterBranch(branch: MatrixCoordinate["branch"], statuses: readonly string[]): boolean {
        if (branch === "base" && statuses.some(status => status !== "SUPPORTED_TERMINAL")) this.stoppedFlag = true;
        return this.stoppedFlag;
    }
}

/** Coordinates of each branch that were never attempted, derived from the matrix itself. */
export function unattemptedCounts(attempted: readonly Pick<MatrixCoordinate, "branch">[], stopped: boolean) {
    const remaining = (branch: MatrixCoordinate["branch"]) =>
        matrixCoordinates(branch).length - attempted.filter(c => c.branch === branch).length;
    return { base: remaining("base"), variant: remaining("variant"), reason: stopped ? "STOP_RULE_REACHED; no skipped attempted coordinates" : null };
}
