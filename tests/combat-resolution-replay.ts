import { reactReplay } from "./react-replay";
import { resolutionContext } from "./combat-resolution-fixture";
export function fightReplay() { return reactReplay("combat-attack-46", resolutionContext(), "FIGHT"); }
export function gigStealReplay() { return reactReplay("combat-attack-46", resolutionContext(), "GIG"); }
