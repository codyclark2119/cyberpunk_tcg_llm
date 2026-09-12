import type { DeepReadonly } from "@tcg/domain";
import type { PlayerObservation } from "@tcg/engine";
import { chooseDemoMatchAction, type PolicyAction } from "./demo-match-policy";
export type DemoPolicyConfig = { chooseFirstOrSecond: "FIRST" | "SECOND"; mulligan: readonly [boolean, boolean] };
/** Setup preferences only. Gameplay priorities remain the frozen headline policy. */
export function createDemoMatchPolicy(config: DemoPolicyConfig) {
    const first = config.chooseFirstOrSecond, mulligan = [...config.mulligan];
    return (observation: DeepReadonly<PlayerObservation>, legalActions: readonly PolicyAction[]) => {
        const label = observation.step === "CHOOSE_FIRST_PLAYER" ? (first === "FIRST" ? "Go first" : "Go second")
            : observation.step === "MULLIGAN_DECISION" ? (mulligan[observation.viewerSeat] ? "Mulligan the entire opening hand" : "Keep the opening hand") : undefined;
        if (label) {
            const selected = legalActions.find(a => a.descriptor.label === label);
            if (!selected) throw new Error(`POLICY_SETUP_OPTION_MISSING ${label}`);
            return selected.actionId;
        }
        return chooseDemoMatchAction(observation, legalActions);
    };
}
