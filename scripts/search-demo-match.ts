import { writeFileSync } from "node:fs";
import { demoMatchReplay, DEMO_MATCH_LIMITS } from "../tests/demo-match-replay";
// Explicit bounded search. Any real engine/admission gap stops search rather than selecting another seed.
const attempts:unknown[]=[];
for(let i=0;i<16;i++){
    const seed=`exact-demo-match-${i}`;
    try{
        const r=demoMatchReplay(seed,false);const result={seed,status:"TERMINATED",actions:r.steps.length,turn:r.finalState.timing.turn,outcome:r.finalState.match.outcome};attempts.push(result);
        writeFileSync("/tmp/tcg-demo-match-search.json",JSON.stringify({bounds:{seeds:16,...DEMO_MATCH_LIMITS},attempts},null,2)+"\n");
        process.stdout.write(JSON.stringify(result)+"\n");break;
    }catch(error){
        const message=error instanceof Error?error.message:String(error),cap=message.startsWith("POLICY_CAP");attempts.push({seed,status:cap?"POLICY_CAP":"BLOCKED",message});
        writeFileSync("/tmp/tcg-demo-match-search.json",JSON.stringify({bounds:{seeds:16,...DEMO_MATCH_LIMITS},attempts},null,2)+"\n");
        if(!cap)throw error;if(i===15)throw new Error("No complete match within seed search bounds");
    }
}
