import { GameStateSchema, defaultRuleset } from "@tcg/domain";
import { generatePosition, exportPositions } from "@tcg/training-harness";
const player = "00000000-0000-4000-8000-000000000001";
const state = GameStateSchema.parse({ schemaVersion: 1, matchId: "00000000-0000-4000-8000-000000000002", version: 0, eventSequence: 0, rulesetId: defaultRuleset.id, rulesetVersion: defaultRuleset.version, players: [player], actingPlayer: player, cards: [], phase: "UNIMPLEMENTED" });
const position = generatePosition(state, state.actingPlayer, { ruleset: defaultRuleset });
if (!position.ok) { console.error(position.errors); process.exitCode = 1; }
else process.stdout.write(exportPositions([position.value]));
