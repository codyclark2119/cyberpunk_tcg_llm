// Print the default local match setup as one JSON line: the fixed Demo content
// bundle, a createGame initialization for the two fixed Demo decks, and the
// running engine identity. games/cyberpunk/local_match.py reads this when no
// setup file is supplied. It only reads existing fixtures; it admits nothing,
// and other formats or decks are passed to the runner as a setup file instead.
import { demoStarterContext, demoStarterInput } from "../tests/demo-starter-fixture";
import { engineIdentity } from "./engine-identity";

const { content } = demoStarterContext();
console.log(JSON.stringify({ schemaVersion: 1, content, initialization: demoStarterInput("local-match-0"), engine: engineIdentity() }));
