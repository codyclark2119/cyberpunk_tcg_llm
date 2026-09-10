import { writeFileSync } from "node:fs";
import { demoSetupReplay } from "../tests/demo-setup-replay";
const replay = demoSetupReplay();
writeFileSync("tests/fixtures/demo-setup-replay.v1.json", JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, turn: replay.finalState.timing.turn, stop: replay.finalState.timing.step, rolls: replay.initialized.state.firstPlayerRolls, finalStateHash: replay.finalStateHash }) + "\n");
