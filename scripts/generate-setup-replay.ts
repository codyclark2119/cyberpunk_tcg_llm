import { writeFileSync } from "node:fs";
import { setupReplay } from "../tests/setup-replay";
const replay = setupReplay();
writeFileSync("tests/fixtures/setup-replay.v1.json", JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, finalStateHash: replay.finalStateHash }) + "\n");
