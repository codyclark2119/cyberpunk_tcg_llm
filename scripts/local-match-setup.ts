// Print a local match setup as one JSON line: the reviewed content bundle, a
// createGame initialization and the running engine identity.
// games/cyberpunk/local_match.py reads this. With no flags it is the two fixed
// Demo decks. With --decks <file> (two decks, {decks:[{legends, main}]}) it is a
// CONSTRUCTED game with those decks; the engine's createGame validates them.
// With --content it prints only the reviewed content bundle and the engine
// identity (games/cyberpunk/assistant/engine_scenario.py composes from it).
// It only reads existing fixtures and files; it admits nothing.
import { resolve } from "node:path";
import { demoStarterContext, demoStarterInput } from "../tests/demo-starter-fixture";
import { constructedContext, constructedInput, readDeckFile } from "../tests/constructed-format-fixture";
import { engineIdentity } from "./engine-identity";

function arg(name: string) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const decks = arg("--decks");
if (process.argv.includes("--content")) {
    const { content } = constructedContext();
    console.log(JSON.stringify({ schemaVersion: 1, content, engine: engineIdentity() }));
} else if (decks) {
    const { content } = constructedContext();
    const initialization = constructedInput(arg("--seed") ?? "local-match-0", readDeckFile(resolve(decks)));
    console.log(JSON.stringify({ schemaVersion: 1, content, initialization, engine: engineIdentity() }));
} else {
    const { content } = demoStarterContext();
    console.log(JSON.stringify({ schemaVersion: 1, content, initialization: demoStarterInput("local-match-0"), engine: engineIdentity() }));
}
