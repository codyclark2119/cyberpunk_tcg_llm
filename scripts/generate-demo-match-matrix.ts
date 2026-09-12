import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { hashCanonical } from "@tcg/domain";
import { DEMO_MATRIX_CONFIG, matrixCoordinates, coordinateId } from "../tests/demo-matrix-config";
import { demoMatrixReplay } from "../tests/demo-matrix-replay";
import { summarizeMatrixTrace, aggregateMatrix, type MatrixSummary } from "../tests/demo-matrix-metrics";
import { demoStarterContext } from "../tests/demo-starter-fixture";
const directory="/tmp/tcg-reboot-model-a-traces";mkdirSync(directory,{recursive:true});
const check=process.argv.includes("--check");
const policyHash=hashCanonical(["tests/demo-match-policy.ts","tests/demo-matrix-policy.ts"].map(p=>readFileSync(p,"utf8")));
const summaries:MatrixSummary[]=[],runtimeMetrics: {coordinate:string;elapsedMs:number;actionsPerSecond:number;rssBytes:number}[]=[];
const promotions:{family:string;coordinate:string;purpose:string;actions:number;bytes:number}[]=[],gaps=new Map<string,number>();let stopped=false;
const context=demoStarterContext(),bundleBefore=hashCanonical(context.content);
function artifact(path:string,value:unknown) {const serialized=JSON.stringify(value)+"\n";if(check)assert.equal(readFileSync(path,"utf8"),serialized,path);else writeFileSync(path,serialized);return Buffer.byteLength(serialized);}
function promote(family:string,trace:ReturnType<typeof demoMatrixReplay>,purpose:string) {
    if(promotions.some(p=>p.family===family))return;
    const bytes=artifact(`tests/fixtures/${family}.v1.json`,trace);promotions.push({family,coordinate:coordinateId(trace.coordinate),purpose,actions:trace.steps.length,bytes});
}
for(const branch of ["base","variant"] as const) {
    if(stopped)break;
    for(const coordinate of matrixCoordinates(branch)) {
        const start=performance.now(),trace=demoMatrixReplay(coordinate,{context}),elapsedMs=performance.now()-start;
        const summary=summarizeMatrixTrace(trace);summaries.push(summary);
        runtimeMetrics.push({coordinate:coordinateId(coordinate),elapsedMs,actionsPerSecond:trace.steps.length/(elapsedMs/1000),rssBytes:process.memoryUsage().rss});
        writeFileSync(`${directory}/${coordinateId(coordinate)}.json`,JSON.stringify(trace));
        console.log(JSON.stringify({coordinate:coordinateId(coordinate),status:summary.status,actions:summary.actions,positions:summary.positions,turn:summary.turns,terminal:summary.terminal?.reason,failure:summary.failure?.code,elapsedMs}));
        if(summary.terminal?.reason==="EMPTY_DRAW")promote("demo-matrix-empty-draw-replay",trace,"First exact matrix empty-draw terminal");
        if(summary.terminal?.reason==="OVERTIME_GIGS")promote("demo-matrix-overtime-replay",trace,"First exact matrix overtime terminal; also reversed seats");
        if(summary.failure)promote("demo-matrix-successor-gap-replay",trace,"First successor matrix gap; preserve diagnostic prefix without bypassing it");
        if(trace.failure){const code=trace.failure.code;gaps.set(code,(gaps.get(code)??0)+1);if(trace.failure.classification!=="KNOWN_UNSUPPORTED"||(gaps.get(code)??0)>=DEMO_MATRIX_CONFIG.stop.sameKnownGapConfirmations){stopped=true;break;}}
    }
    if(branch==="base"&&summaries.some(r=>r.status!=="SUPPORTED_TERMINAL"))stopped=true;
}
assert.equal(hashCanonical(context.content),bundleBefore);
// Bounded setup contract checks are separate from match completion statistics. They do not continue beyond setup when expansion is blocked.
const setupAudit=matrixCoordinates("variant").filter(c=>c.seed===DEMO_MATRIX_CONFIG.setupAudit.seed).map(coordinate=>{
    const trace=demoMatrixReplay(coordinate,{setupOnly:true,context});assert.equal(trace.failure,null);assert.equal(trace.finalState.setup,undefined);
    const summary=summarizeMatrixTrace(trace);assert.equal(summary.setup.actualFirstSeat,coordinate.chooseFirstOrSecond==="FIRST"?summary.setup.chooserSeat:1-summary.setup.chooserSeat!);
    for(const e of summary.setup.mulligans)if(e.kind==="MULLIGAN_DECLARED")assert.equal(e.accepted,coordinate.mulligan[trace.finalState.players[e.playerId].seat]);
    if(coordinate.seats==="B"&&coordinate.chooseFirstOrSecond==="SECOND"&&coordinate.mulligan.every(Boolean))promote("demo-matrix-second-setup-replay",trace,"SECOND chooser, reversed seats, both mulligan; bounded setup-only contract audit");
    return {coordinate,setup:summary.setup,actions:summary.actions,finalHash:summary.finalHash};
});
const records=summaries.map(({samples,...summary})=>{ void samples; return {...summary,policyHash}; });
const coverage=aggregateMatrix(summaries);
const identity={schemaVersion:1,config:DEMO_MATRIX_CONFIG,policyHash,records,setupAudit,promotions,unattempted:{base:64-summaries.filter(s=>s.coordinate.branch==="base").length,variant:128-summaries.filter(s=>s.coordinate.branch==="variant").length,reason:stopped?"STOP_RULE_REACHED; no skipped attempted coordinates":null}};
const matrix={...identity,matrixHash:hashCanonical(identity)};
artifact("tests/fixtures/demo-match-matrix-reboot.v1.json",matrix);artifact("tests/fixtures/demo-match-coverage-reboot.v1.json",coverage);
// Nondeterministic measurements stay separate from canonical identities and exact regeneration gates.
writeFileSync(`${directory}/runtime.json`,JSON.stringify(runtimeMetrics,null,2)+"\n");
console.log(JSON.stringify({attempted:coverage.attempted,completed:coverage.completed,classifications:coverage.classifications,matrixHash:matrix.matrixHash,setupAudits:setupAudit.length,promotions}));
