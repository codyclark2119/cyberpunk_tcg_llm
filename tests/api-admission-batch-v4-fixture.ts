import { CardIdSchema, CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { batchV3Context, batchV3Input } from "./api-admission-batch-v3-fixture";
import source from "./fixtures/api-admission-batch-v4-jonin-source.v1.json";

export const JONIN = CardIdSchema.parse("japantown-jonin");
export const JONIN_SOURCE_PIN = {
    repository: "codyclark2119/cyberpunk_tcg_ai",
    commit: "af9e0e1dd93b7eb77db5883bdd18809c8446d856",
    path: "data/raw/cards/japantown-jonin.json",
    gitBlob: "25f4fb476d26e611290516892b915398a5c6933a",
    rawSha256: "97837cab5849a76922492b3b3e2a42cb73e4f96c92df4dbad679aae2c0393585",
    recordHash: "dc383b1c512492ca22ee5d811677f8c6a27d28e3c33b6d382dde9326f3fe1365",
    catalogSha256: "b96ca8d583ab087148c9ed3563379e6c42fd9e729188a042215bb503a8879c3d",
    processedErrataSha256: "16304146074363480e2c22639c9799b9d4302118c669e85e9f475b4a1bf6a340"
} as const;

/** Implementation-reviewed capture, not human-certified gold or production catalog publication. */
export const jonin = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: JONIN, revision: 1, status: "ACTIVE",
    cardNumber: source.print_number, name: source.name, subtitle: source.subname ?? "",
    displayName: source.display_name, deckbuildingIdentity: source.name,
    type: "UNIT", colors: ["RED"], ram: { RED: source.ram }, power: source.power,
    setCode: source.set.code, setName: source.set.name,
    printedCost: { kind: "EDDIES", amount: source.cost },
    sellProfile: { allowed: source.is_eddiable, baseEddieValue: 1 },
    rulesText: source.rules_text, sourceMarkup: source.rules_text,
    tags: source.classifications, keywords: [],
    execution: { scope: "COMBAT_TRIGGERS_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{
        id: "jonin-friendly-play-power@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
        effects: [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "FRIENDLY_UNIT" }, amount: 2 }]
    }] },
    printings: source.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: `${JONIN_SOURCE_PIN.repository}/${JONIN_SOURCE_PIN.path}@${JONIN_SOURCE_PIN.commit}` })),
    provenance: { source: `${JONIN_SOURCE_PIN.repository}/${JONIN_SOURCE_PIN.path}@${JONIN_SOURCE_PIN.commit} (Batch V4 implementation review)`, sourceHash: hashCanonical(source), effectiveAt: "2026-09-17", errata: [], reviewed: true }
});
export function batchV4Context(engine?: Parameters<typeof createContentBundle>[2]) {
    const base = batchV3Context(engine);
    const ruleset = RulesetSchema.parse({ ...base.content.ruleset, version: "api-admission-batch-v4-1",
        gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, friendlyPlayPower: "FRIENDLY_PLAY_POWER_V1" } } });
    return { content: createContentBundle(ruleset, [...base.content.cards, jonin], engine ?? base.content.manifest.engine) };
}
export function batchV4Input(seed: string) {
    const input = batchV3Input(seed);
    // Keep 42 main cards, three copies per identity, and the existing synthetic RED RAM 3 support.
    return { ...input, decks: input.decks.map(deck => ({ ...deck, main: deck.main.map(id => id === "slice-card-3" ? JONIN : id) })) };
}
