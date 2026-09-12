import { writeFileSync } from "node:fs";
import { demoMatchDiagnostics } from "../tests/demo-match-audit";
import { demoMatchReplay } from "../tests/demo-match-replay";
const replay=demoMatchReplay();
writeFileSync("tests/fixtures/exact-demo-match-replay.v1.json",JSON.stringify(replay,null,2)+"\n");
writeFileSync("tests/fixtures/exact-demo-match-diagnostics.v1.json",JSON.stringify(demoMatchDiagnostics(replay),null,2)+"\n");
process.stdout.write(JSON.stringify({seed:replay.policy.seed,policy:replay.policy.id,actions:replay.steps.length,positions:replay.positions.length,events:replay.finalState.match.eventSequence,turn:replay.finalState.timing.turn,outcome:replay.finalState.match.outcome,hash:replay.finalStateHash})+"\n");
