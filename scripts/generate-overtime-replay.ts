import { writeFileSync } from "node:fs";
import { overtimeReplay } from "../tests/overtime-replay";
const replay = overtimeReplay();
writeFileSync("tests/fixtures/overtime-replay.v1.json", JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, turn: replay.finalState.timing.turn, overtime: replay.finalState.match.overtime, outcome: replay.finalState.match.outcome, finalStateHash: replay.finalStateHash }) + "\n");
