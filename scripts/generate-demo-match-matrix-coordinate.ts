import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { hashCanonical } from "@tcg/domain";
import { demoStarterContext } from "../tests/demo-starter-fixture";
import { coordinateId, type MatrixCoordinate } from "../tests/demo-matrix-config";
import { demoMatrixReplay } from "../tests/demo-matrix-replay";

const raw=process.argv[2];
if(!raw)throw new Error("Matrix coordinate JSON is required");
const coordinate=JSON.parse(raw) as MatrixCoordinate;
const directory=process.env.DEMO_MATRIX_TRACE_DIR??"/tmp/tcg-reboot-model-a-traces";
mkdirSync(directory,{recursive:true});
const context=demoStarterContext(),before=hashCanonical(context.content),start=performance.now();
const trace=demoMatrixReplay(coordinate,{context}),elapsedMs=performance.now()-start;
assert.equal(hashCanonical(context.content),before);
const id=coordinateId(coordinate);
writeFileSync(`${directory}/${id}.json`,JSON.stringify(trace));
writeFileSync(`${directory}/${id}.runtime.json`,JSON.stringify({elapsedMs,rssBytes:process.memoryUsage().rss,actions:trace.steps.length}));
