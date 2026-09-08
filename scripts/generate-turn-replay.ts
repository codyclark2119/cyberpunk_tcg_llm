import { writeFileSync } from "node:fs";
import { turnReplay } from "../tests/turn-replay";
const replay = turnReplay();
writeFileSync("tests/fixtures/turn-replay.v1.json", JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.map(p => p.positionId), finalStateHash: replay.finalStateHash }) + "\n");
