import { writeFileSync } from "node:fs";
import { reviewedReplay } from "../tests/reviewed-replay";
const replay = reviewedReplay();
writeFileSync("tests/fixtures/reviewed-replay.v1.json", JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, finalStateHash: replay.finalStateHash }) + "\n");
