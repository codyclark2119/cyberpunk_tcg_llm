import { writeFileSync } from "node:fs";
import { combatReplay } from "../tests/combat-replay";
const replay = combatReplay();
writeFileSync(new URL("../tests/fixtures/combat-attack-replay.v1.json", import.meta.url), JSON.stringify(replay, null, 2) + "\n");
process.stdout.write(JSON.stringify({ steps: replay.steps.length, positions: replay.positions.length, attackPower: replay.attackPower, combat: replay.finalState.timing.combat, finalStateHash: replay.finalStateHash }) + "\n");
