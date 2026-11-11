import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashCanonical } from "@tcg/domain";
import { coordinateId, type MatrixCoordinate } from "../tests/demo-matrix-config";
import type { MatrixTrace } from "../tests/demo-matrix-metrics";
import { compactArtifactWriter, matrixTracePath, repoPath } from "./lib/generated-artifacts";
// Run after test:matrix. The trusted temporary traces must match each recorded final hash.
const matrix:{matrixHash:string;records:{coordinate:MatrixCoordinate;finalHash:string}[]}=JSON.parse(readFileSync(repoPath("tests/fixtures/demo-match-matrix-reboot.v1.json"),"utf8"));
const examples:{coordinate:string;turn:number;label:string;count:number}[]=[],distinctPublicUnitChoices:{coordinate:string;turn:number;label:string;publicOptions:{id:string;power:number|null|undefined;attachments:readonly string[]}[]}[]=[];
let positionsWithDuplicateDescriptors=0,duplicateGroups=0,overtimePositions=0;
for(const record of matrix.records){
    const trace:MatrixTrace=JSON.parse(readFileSync(matrixTracePath(coordinateId(record.coordinate)),"utf8"));
    assert.equal(trace.finalStateHash,record.finalHash);
    for(const position of trace.positions){
        if(position.state.match.overtime)overtimePositions++;
        const groups=new Map<string,typeof position.legalActions>();
        for(const a of position.legalActions){const key=JSON.stringify(a.descriptor),group=groups.get(key)??[];group.push(a);groups.set(key,group);}
        const duplicates=[...groups.values()].filter(g=>g.length>1);
        if(duplicates.length){positionsWithDuplicateDescriptors++;duplicateGroups+=duplicates.length;}
        for(const actions of duplicates){
            const descriptor=actions[0].descriptor;
            if(examples.length<3)examples.push({coordinate:coordinateId(record.coordinate),turn:position.state.timing.turn,label:descriptor.label,count:actions.length});
            if(descriptor.kind!=="DECLARE_ATTACK")continue;
            const visible=actions.flatMap(a=>{const action=a.action;return action.kind==="DECLARE_ATTACK"?position.observation.players.flatMap(p=>p.cards).filter(c=>c.publicId===action.cardInstanceId):[];});
            if(new Set(visible.map(c=>JSON.stringify([c.effectivePower,c.attachments]))).size>1&&distinctPublicUnitChoices.length<3)
                distinctPublicUnitChoices.push({coordinate:coordinateId(record.coordinate),turn:position.state.timing.turn,label:descriptor.label,publicOptions:visible.map(c=>({id:c.publicId,power:c.effectivePower??null,attachments:c.attachments??[]}))});
        }
    }
}
const result={matrixHash:matrix.matrixHash,positionsWithDuplicateDescriptors,duplicateGroups,overtimePositions,examples,distinctPublicUnitChoices};
const artifact={...result,reviewHash:hashCanonical(result)};
compactArtifactWriter(process.argv.includes("--check"))("tests/fixtures/demo-matrix-position-review-reboot.v1.json",artifact);
console.log(JSON.stringify(artifact));
