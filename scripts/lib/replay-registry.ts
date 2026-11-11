// The registry of independent replay fixture writers: each entry pairs a
// builder from tests/ with the committed fixture it reproduces. The Demo
// matrix, its trace-backed reviews and the Reboot multiplicity replays depend
// on matrix traces and keep their own scripts.
import { handleRequest } from "@tcg/wire";
import { listLegalActions } from "@tcg/engine";
import { attackConditionPowerReplay } from "../../tests/attack-condition-power-replay";
import { evelynReplay } from "../../tests/attack-ordered-effects-replay";
import { combatReplay } from "../../tests/combat-replay";
import { fightReplay, gigStealReplay } from "../../tests/combat-resolution-replay";
import { preventionReplay, permissionsReplay, vanillaReplay } from "../../tests/combat-restrictions-replay";
import { satoriReplay, defeatedReplay, firstBlueReplay } from "../../tests/combat-triggers-replay";
import { fixtureContext, fixtureState, player } from "../../tests/contract-fixture";
import { dyingNightReplay } from "../../tests/delayed-effects-replay";
import { demoMatchDiagnostics } from "../../tests/demo-match-audit";
import { demoMatchReplay } from "../../tests/demo-match-replay";
import { demoSetupReplay } from "../../tests/demo-setup-replay";
import { delamainReplay } from "../../tests/end-turn-history-replay";
import { vDyingNightReplay } from "../../tests/field-legends-replay";
import { mandibularReplay } from "../../tests/gear-capabilities-replay";
import { gearReplay } from "../../tests/gear-replay";
import { goroReplay } from "../../tests/goro-replay";
import { noncombatReplay } from "../../tests/noncombat-replay";
import { overtimeReplay } from "../../tests/overtime-replay";
import { kiroshiReplay } from "../../tests/private-information-replay";
import { reactReplay } from "../../tests/react-replay";
import { reviewedReplay } from "../../tests/reviewed-replay";
import { saburoReplay } from "../../tests/saburo-replay";
import { setupReplay } from "../../tests/setup-replay";
import { minotaurReplay, overTheEdgeReplay } from "../../tests/targeted-defeat-replay";
import { targetedSpendReplay } from "../../tests/targeted-spend-replay";
import { turnReplay } from "../../tests/turn-replay";
import { valueConditionsReplay } from "../../tests/value-conditions-replay";
import { yorinobuReplay } from "../../tests/yorinobu-replay";

export interface ReplayFixture {
    /** Unique CLI name: the fixture file's stem. */
    readonly name: string;
    /** Repository-relative output path. */
    readonly output: string;
    /** Builds the fixture value; serialized as indented JSON plus a newline. */
    readonly build: () => unknown;
}

function once<T>(build: () => T): () => T {
    let cached: { value: T } | undefined;
    return () => (cached ??= { value: build() }).value;
}

function wireGolden() {
    const content = fixtureContext().content, state = fixtureState({ content });
    const legal = listLegalActions(state, player, { content });
    if (!legal.ok || !legal.value.length) throw new Error("Golden fixture must exercise an action");
    const cases = ["validateState", "observe", "hash", "listLegalActions", "validateAction", "applyAction"].map(op => ({ schemaVersion: 1, requestId: op, op, content, state, actorId: player, ...(["validateAction", "applyAction"].includes(op) ? { actionId: legal.value[0].actionId } : {}) }));
    cases.push({ ...cases[4], requestId: "unknown-action", actionId: "0".repeat(64) });
    return { schemaVersion: 1, note: "Synthetic contract fixtures, not reviewed game positions or gold training data", cases: cases.map(request => ({ request, response: handleRequest(request) })) };
}

const demoMatch = once(demoMatchReplay);
const fixture = (name: string, build: () => unknown): ReplayFixture => ({ name, output: `tests/fixtures/${name}.v1.json`, build });

export const REPLAY_FIXTURES: readonly ReplayFixture[] = [
    fixture("attack-condition-power-replay", attackConditionPowerReplay),
    fixture("evelyn-replay", evelynReplay),
    fixture("combat-attack-replay", combatReplay),
    fixture("fight-replay", fightReplay),
    fixture("gig-steal-replay", gigStealReplay),
    fixture("prevention-replay", preventionReplay),
    fixture("permissions-replay", permissionsReplay),
    fixture("vanilla-replay", vanillaReplay),
    fixture("satori-replay", satoriReplay),
    fixture("defeated-replay", defeatedReplay),
    fixture("first-blue-replay", firstBlueReplay),
    fixture("dying-night-replay", dyingNightReplay),
    fixture("exact-demo-match-replay", demoMatch),
    fixture("exact-demo-match-diagnostics", () => demoMatchDiagnostics(demoMatch())),
    fixture("demo-setup-replay", demoSetupReplay),
    fixture("delamain-replay", delamainReplay),
    fixture("field-legends-replay", vDyingNightReplay),
    fixture("mandibular-replay", mandibularReplay),
    fixture("gear-replay", gearReplay),
    fixture("goro-replay", goroReplay),
    fixture("noncombat-replay", noncombatReplay),
    fixture("overtime-replay", overtimeReplay),
    fixture("kiroshi-replay", kiroshiReplay),
    fixture("react-replay", reactReplay),
    fixture("reviewed-replay", reviewedReplay),
    fixture("saburo-replay", saburoReplay),
    fixture("setup-replay", setupReplay),
    fixture("minotaur-replay", minotaurReplay),
    fixture("over-the-edge-replay", overTheEdgeReplay),
    fixture("targeted-spend-replay", targetedSpendReplay),
    fixture("turn-replay", turnReplay),
    fixture("value-conditions-replay", valueConditionsReplay),
    fixture("wire-golden", wireGolden),
    fixture("yorinobu-replay", yorinobuReplay)
];
