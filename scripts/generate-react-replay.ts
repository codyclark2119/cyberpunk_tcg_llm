import { writeFileSync } from "node:fs";
import { reactReplay } from "../tests/react-replay";
const replay = reactReplay();
writeFileSync(new URL("../tests/fixtures/react-replay.v1.json", import.meta.url), JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, events: replay.initialized.events.length + replay.steps.reduce((n, s) => n + s.events.length, 0), combat: replay.finalState.timing.combat, finalStateHash: replay.finalStateHash }) + "\n");
