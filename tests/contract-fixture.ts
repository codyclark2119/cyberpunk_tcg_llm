import { CardRevisionSnapshotSchema, RulesetSchema, defaultRuleset, hashCanonical, createContentBundle, PlayerIdSchema } from "@tcg/domain";
import { cards } from "@tcg/domain/fixtures";
import { createGame } from "@tcg/engine";
import { engineIdentity } from "../scripts/engine-identity";
export const player = PlayerIdSchema.parse("00000000-0000-4000-8000-000000000001");
export const rival = PlayerIdSchema.parse("00000000-0000-4000-8000-000000000004");
export function fixtureContext() {
    const revised = cards.map(c => CardRevisionSnapshotSchema.parse({ ...c, schemaVersion: 2, revision: 2, deckbuildingIdentity: c.id, subtitle: "", displayName: c.name, printedCost: c.cost === undefined ? { kind: "DASH" } : { kind: "EDDIES", amount: c.cost }, sellProfile: { allowed: c.type !== "LEGEND", baseEddieValue: 1 }, sourceMarkup: c.rulesText, mechanics: { keywords: c.type === "LEGEND" ? ["GO_SOLO"] : [], abilities: [], modifiers: [] }, printings: [{ id: `${c.id}-printing`, setCode: c.setCode, collectorNumber: c.cardNumber, source: "development fixture" }], provenance: { source: "development fixture", sourceHash: hashCanonical(c), effectiveAt: "2026-09-07", errata: [], reviewed: true } }));
    const rules = RulesetSchema.parse({ ...defaultRuleset, schemaVersion: 2, version: "contracts-fixture-1", formats: { CONSTRUCTED: { mainDeck: { min: 1, max: 50 }, legendCount: 3, maxCopies: 3, legendUniqueness: "DECKBUILDING_IDENTITY" }, SEALED_LIMITED: { mainDeck: { min: 1, max: 50 }, legendCount: 3, maxCopies: 10, legendUniqueness: "CARD_ID" } }, gameplay: { initialization: "ORDERED_FIXTURE", firstPlayerSpentLegends: 2, openingHand: 1, sellLimitPerTurn: 1, legendPaymentValue: null, gigValueBounds: { min: 0, max: 100 }, triggerOrdering: "UNSUPPORTED", win: "UNSUPPORTED" } });
    return { content: createContentBundle(rules, revised, engineIdentity()) };
}
export function fixtureState(context = fixtureContext(), players = [player, rival]) {
    const result = createGame({ matchId: "00000000-0000-4000-8000-000000000002", players, seed: "fixture-seed", decks: players.map(() => ({ legends: context.content.cards.filter(c => c.type === "LEGEND").map(c => c.id), main: ["dev-unit-red", "dev-unit-red"] })) }, context);
    if (!result.ok)
        throw new Error(JSON.stringify(result.errors));
    return result.value;
}
