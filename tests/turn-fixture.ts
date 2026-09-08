import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { fixtureContext, player, rival } from "./contract-fixture";
import { engineIdentity } from "../scripts/engine-identity";
import ruleSource from "./fixtures/turn-rules.v1.json";
export function turnContext() {
    const base = fixtureContext();
    const legends = base.content.cards.filter(c => c.type === "LEGEND").map(c => CardRevisionSnapshotSchema.parse({ ...c, mechanics: { keywords: [], modifiers: [], abilities: [{ id: "synthetic-call-draw", trigger: "WHEN_CALLED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }] } }));
    const unit = base.content.cards.find(c => c.type === "UNIT")!;
    const units = Array.from({ length: 14 }, (_, i) => CardRevisionSnapshotSchema.parse({ ...unit, id: `slice-card-${i}`, name: `Slice Card ${i}`, displayName: `Slice Card ${i}`, deckbuildingIdentity: `slice-card-${i}`, sellProfile: { allowed: i !== 13, baseEddieValue: 1 }, printings: [{ ...unit.printings[0], id: `slice-print-${i}` }], provenance: { ...unit.provenance, source: "Synthetic turn-slice fixture", sourceHash: hashCanonical({ fixture: i }), reviewed: true } }));
    const rules = RulesetSchema.parse({ ...base.content.ruleset, version: "turn-slice-1", formats: { ...base.content.ruleset.formats, CONSTRUCTED: { mainDeck: { min: 40, max: 50 }, legendCount: 3, maxCopies: 3, legendUniqueness: "DECKBUILDING_IDENTITY" } }, gameplay: { ...base.content.ruleset.gameplay, initialization: "TURN_SLICE_V1", openingHand: 6, legendPaymentValue: 1, turnSlice: { schemaVersion: 1, rulesSourceHash: ruleSource.sha256, drawPerTurn: 1, callLimitPerTurn: 1, callCost: 1, readyZones: ["LEGENDS", "BATTLEFIELD", "EDDIES"], firstTurnSpentLegendsStaySpent: true, d20Eligibility: "ORIGINAL_OTHER_DICE_ROLLED", emptyFixer: "SKIP", emptyDraw: "LOSE", startTurnGigWinCount: 7, setup: "AGREED_FIRST_PLAYER_DECLINED_MULLIGANS_AND_CUTS", callEffects: "SINGLE_UNCONDITIONAL_DRAW", overtime: "UNSUPPORTED" } } });
    return { content: createContentBundle(rules, [...legends, ...units], engineIdentity()) };
}
export function turnInput(seed = "turn-slice-seed") {
    return { matchId: "00000000-0000-4000-8000-000000000002", players: [player, rival], seed, format: "CONSTRUCTED" as const, setup: { firstPlayerSeat: 0, mulligans: "DECLINED" as const, cuts: "DECLINED" as const }, decks: [player, rival].map(() => ({ legends: ["dev-legend-red", "dev-legend-blue", "dev-legend-green"], main: Array.from({ length: 14 }, (_, i) => Array.from({ length: 3 }, () => `slice-card-${i}`)).flat() })) };
}
