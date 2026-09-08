// Only stable synthetic gameplay decision positions; full replay records stay private.
import { turnReplay } from "../tests/turn-replay";
import { exportPositions } from "@tcg/training-harness";
process.stdout.write(exportPositions(turnReplay().positions));
