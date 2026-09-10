import { writeFileSync } from "node:fs";
import { targetedSpendReplay } from "../tests/targeted-spend-replay";
const replay = targetedSpendReplay();
writeFileSync("tests/fixtures/targeted-spend-replay.v1.json", JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(`Targeted spend: ${replay.steps.length} actions, ${replay.positions.length} positions\n`);
