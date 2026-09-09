import { writeFileSync } from "node:fs";
import { evelynReplay } from "../tests/attack-ordered-effects-replay";
const replay = evelynReplay();
writeFileSync(new URL("../tests/fixtures/evelyn-replay.v1.json", import.meta.url), JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ actions: replay.steps.length, positions: replay.positions.length, events: replay.initialized.events.length + replay.steps.reduce((n, s) => n + s.events.length, 0), finalStateHash: replay.finalStateHash, step: replay.finalState.timing.step }) + "\n");
