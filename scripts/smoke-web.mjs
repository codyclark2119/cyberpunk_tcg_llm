import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const mode = process.argv[2] ?? "fixture";
if (!["fixture", "mongo", "unavailable"].includes(mode)) throw new Error("Use fixture, mongo or unavailable mode");
if (mode === "mongo" && !process.env.MONGODB_URI) throw new Error("Mongo smoke test requires MONGODB_URI");
const port = "3011";
const url = `http://127.0.0.1:${port}/api/graphql`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "apps/web", "--port", port], {
  stdio: "inherit", env: { ...process.env, MONGODB_URI: mode === "unavailable" ? "mongodb://127.0.0.1:1" : mode === "fixture" ? "" : process.env.MONGODB_URI, GRAPHQL_INTERNAL_URL: url }
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Smoke server exited before becoming ready");
    try { await fetch(url); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, "Smoke server did not start");
  async function query(query, variables) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    return response.json();
  }
  if (mode === "unavailable") {
    const failed = await query("{cards{edges{node{id}}}}");
    assert.match(failed.errors[0].message, /MongoDB connection failed while MONGODB_URI is configured/);
    assert.equal(failed.data, null);
    console.log("unavailable: configured Mongo failure is visible; no fixture fallback");
  } else {
  const operation = "query($after:String){cards(first:2,after:$after){edges{cursor node{id}} pageInfo{endCursor hasNextPage}}}";
  const first = await query(operation); assert.ok(!first.errors, JSON.stringify(first));
  assert.equal(first.data.cards.edges.length, 2); assert.equal(first.data.cards.pageInfo.hasNextPage, true);
  const second = await query(operation, { after: first.data.cards.pageInfo.endCursor });
  assert.ok(!second.errors, JSON.stringify(second));
  assert.equal(new Set([...first.data.cards.edges, ...second.data.cards.edges].map(e => e.node.id)).size, 4);
  const search = await query('{cards(filter:{search:"red"}){edges{node{id}}}}');
  assert.ok(!search.errors, JSON.stringify(search)); assert.equal(search.data.cards.edges.length, 2);
  const invalid = await query(operation, { after: "invalid" }); assert.equal(invalid.errors[0].extensions.code, "BAD_USER_INPUT");
  const deck = await query('mutation{validateDeck(input:{name:"Development Deck",legendIds:["dev-legend-red","dev-legend-blue","dev-legend-green"],cards:[{cardId:"dev-unit-red",quantity:3}]}){legal mainDeckCount issues{code}}}');
  assert.ok(!deck.errors, JSON.stringify(deck)); assert.equal(deck.data.validateDeck.mainDeckCount, 3);
  assert.deepEqual(deck.data.validateDeck.issues, [{ code: "MAIN_DECK_SIZE" }]);
  const get = await fetch(url + "?query=" + encodeURIComponent("{apiVersion}"), { headers: { "Apollo-Require-Preflight": "true" } });
  assert.ok((await get.json()).data.apiVersion);
  for (const path of ["/", "/cards", "/decks/new"]) assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 200);
  console.log(`${mode}: GET/POST, pagination, filtering, invalid cursor, deck validation and pages passed`);
  }
} finally {
  server.kill("SIGTERM");
  if (server.exitCode === null) await new Promise(resolve => server.once("exit", resolve));
}
