import assert from "node:assert/strict";
import { CardIdSchema, CardRevisionSnapshotSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardRevisionSnapshot } from "@tcg/domain";
import { engineIdentity } from "../scripts/engine-identity";
import { batchV5Context, batchV5Input } from "./api-admission-batch-v5-fixture";
import { V6_SOURCE_COMMIT } from "../scripts/lib/api-admission-batch-v6-source";
import source from "./fixtures/api-admission-batch-v6-trust-no-one-source.v1.json";

export const TRUST_NO_ONE = CardIdSchema.parse("trust-no-one");

/** Immutable reviewed revision. Source records are evidence only; mechanics are authored here. */
export const trustNoOne = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: TRUST_NO_ONE, revision: 1, status: "ACTIVE",
    cardNumber: source.print_number, name: source.name, subtitle: source.subname ?? "",
    displayName: source.display_name, deckbuildingIdentity: source.name,
    type: "PROGRAM", colors: ["BLUE"], ram: { BLUE: source.ram },
    setCode: source.set.code, setName: source.set.name,
    printedCost: { kind: "EDDIES", amount: source.cost },
    sellProfile: { allowed: source.is_eddiable, baseEddieValue: 1 },
    rulesText: source.rules_text, sourceMarkup: source.rules_text,
    tags: source.classifications, keywords: [],
    execution: { scope: "MIN_GIG_PROGRAM_V1", status: "SUPPORTED" },
    mechanics: { keywords: [], modifiers: [], abilities: [{
        id: "trust-no-one-decrease-then-min-draw@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
        effects: [
            { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 3, direction: "DECREASE" },
            { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE", value: 1 }, count: 1 }
        ]
    }] },
    printings: source.printings.map(p => ({
        id: p.id, setCode: p.set.code, collectorNumber: p.collector_number,
        source: `data/raw/cards/trust-no-one.json@${V6_SOURCE_COMMIT}`
    })),
    provenance: {
        source: `data/raw/cards/trust-no-one.json@${V6_SOURCE_COMMIT} (Batch V6 implementation review; source evidence is not executable authority)`,
        sourceHash: hashCanonical(source), effectiveAt: "2026-09-22", errata: [], reviewed: true
    }
});

export function batchV6Context(engine?: Parameters<typeof createContentBundle>[2]) {
    const selectedEngine = engine ?? engineIdentity();
    const base = batchV5Context(selectedEngine), cards = new Map<string, CardRevisionSnapshot>();
    for (const card of [...base.content.cards, trustNoOne]) {
        const key = `${card.id}@${card.revision}`, previous = cards.get(key);
        if (previous) assert.equal(canonicalSerialize(previous), canonicalSerialize(card), `Conflicting immutable revision ${key}`);
        else cards.set(key, CardRevisionSnapshotSchema.parse(card));
    }
    const ruleset = RulesetSchema.parse({
        ...base.content.ruleset, version: "api-admission-batch-v6-1",
        gameplay: { ...base.content.ruleset.gameplay, turnSlice: { ...base.content.ruleset.gameplay!.turnSlice, minGigProgram: "MIN_GIG_PROGRAM_V1" } }
    });
    return { content: createContentBundle(ruleset, [...cards.values()], selectedEngine) };
}

export function batchV6Input(seed: string) {
    const base = batchV5Input(seed);
    return { ...base, decks: base.decks.map(deck => ({
        ...deck,
        // Only the existing Blue-supported constructed deck receives Trust No One.
        // Do not invent or replace Legend capacity merely to admit this card.
        main: deck.legends.includes("restriction-blue-support")
            ? deck.main.map(id => id === "slice-card-6" ? TRUST_NO_ONE : id)
            : deck.main
    })) };
}
