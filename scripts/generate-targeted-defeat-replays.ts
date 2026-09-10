import { writeFileSync } from "node:fs";
import { minotaurReplay, overTheEdgeReplay } from "../tests/targeted-defeat-replay";
for (const [name, trace] of [["minotaur", minotaurReplay()], ["over-the-edge", overTheEdgeReplay()]] as const) {
    writeFileSync(`tests/fixtures/${name}-replay.v1.json`, JSON.stringify(trace, null, 2) + "\n");
    process.stdout.write(`${name}: ${trace.steps.length} actions, ${trace.positions.length} positions\n`);
}
