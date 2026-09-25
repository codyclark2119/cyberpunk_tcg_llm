// Print the current engine identity as one JSON line. Kept separate from
// engine-identity.ts, which is itself an engine-hashed input.
import { engineIdentity } from "./engine-identity";

console.log(JSON.stringify(engineIdentity()));
