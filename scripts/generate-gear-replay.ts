import { writeFileSync } from "node:fs";
import { gearReplay } from "../tests/gear-replay";
const replay = gearReplay();
writeFileSync(new URL("../tests/fixtures/gear-replay.v1.json", import.meta.url), JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, searchedGear: replay.searchedGear, roycePower: replay.roycePower, finalStateHash: replay.finalStateHash }) + "\n");
