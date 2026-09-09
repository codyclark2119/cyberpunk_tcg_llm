import { writeFileSync } from "node:fs";
import { satoriReplay, defeatedReplay, firstBlueReplay } from "../tests/combat-triggers-replay";
for (const [name, replay] of [["satori-replay", satoriReplay()], ["defeated-replay", defeatedReplay()], ["first-blue-replay", firstBlueReplay()]] as const) {
    writeFileSync(new URL(`../tests/fixtures/${name}.v1.json`, import.meta.url), JSON.stringify(replay, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ name, actions: replay.steps.length, positions: replay.positions.length, events: replay.initialized.events.length + replay.steps.reduce((n, s) => n + s.events.length, 0), finalStateHash: replay.finalStateHash, step: replay.finalState.timing.step }) + "\n");
}
