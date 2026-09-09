import { writeFileSync } from "node:fs";
import { saburoReplay } from "../tests/saburo-replay";
const r = saburoReplay();
writeFileSync(new URL("../tests/fixtures/saburo-replay.v1.json", import.meta.url), JSON.stringify(r, null, 2) + "\n");
process.stdout.write(JSON.stringify({ actions: r.steps.length, positions: r.positions.length, events: r.initialized.events.length + r.steps.reduce((n, s) => n + s.events.length, 0), step: r.finalState.timing.step, hash: r.finalStateHash }) + "\n");
