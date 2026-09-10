import { writeFileSync } from "node:fs";
import { attackConditionPowerReplay } from "../tests/attack-condition-power-replay";
const r = attackConditionPowerReplay();
writeFileSync("tests/fixtures/attack-condition-power-replay.v1.json", JSON.stringify(r, null, 2) + "\n");
process.stdout.write(`Attack condition power: ${r.steps.length} actions, ${r.positions.length} positions\n`);
