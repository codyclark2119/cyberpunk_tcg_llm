import { writeFileSync } from "node:fs";
import { valueConditionsReplay } from "../tests/value-conditions-replay";
const r = valueConditionsReplay();
writeFileSync(new URL("../tests/fixtures/value-conditions-replay.v1.json", import.meta.url), JSON.stringify(r, null, 2) + "\n");
process.stdout.write(JSON.stringify({ actions: r.steps.length, positions: r.positions.length, events: r.initialized.events.length + r.steps.flatMap(s => s.events).length, step: r.finalState.timing.step, hash: r.finalStateHash }) + "\n");
