import { writeFileSync } from "node:fs";
import { noncombatReplay } from "../tests/noncombat-replay";
const replay = noncombatReplay();
writeFileSync(new URL("../tests/fixtures/noncombat-replay.v1.json", import.meta.url), JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, finalStateHash: replay.finalStateHash }) + "\n");
