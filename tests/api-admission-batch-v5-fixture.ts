import assert from "node:assert/strict";
import { CardIdSchema, CardRevisionSnapshotSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardRevisionSnapshot } from "@tcg/domain";
import { batchV4Context } from "./api-admission-batch-v4-fixture";
import { targetedContext, targetedInput } from "./targeted-defeat-fixture";
import { DETONATE_SOURCE_PIN } from "../scripts/lib/api-admission-batch-v5-evidence";
import source from "./fixtures/api-admission-batch-v5-detonate-source.v1.json";

export const DETONATE = CardIdSchema.parse("detonate");
export { DETONATE_SOURCE_PIN };
/** Explicit immutable revision authored after implementation review. Source keyword hints
 * remain evidence; QUICK and the Gear effect below are deliberate mechanics, not parsed text. */
export const detonate = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2, id: DETONATE, revision: 1, status: "ACTIVE",
    cardNumber: source.print_number, name: source.name, subtitle: source.subname ?? "",
    displayName: source.display_name, deckbuildingIdentity: source.name,
    type: "PROGRAM", colors: ["RED"], ram: { RED: source.ram },
    setCode: source.set.code, setName: source.set.name,
    printedCost: { kind: "EDDIES", amount: source.cost },
    sellProfile: { allowed: source.is_eddiable, baseEddieValue: 1 },
    rulesText: source.rules_text, sourceMarkup: source.rules_text,
    tags: source.classifications, keywords: [],
    execution: { scope: "TARGETED_GEAR_DEFEAT_V1", status: "SUPPORTED" },
    mechanics: { keywords: ["QUICK"], modifiers: [], abilities: [{
        id: "detonate-rival-gear-defeat@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [],
        effects: [{ kind: "DEFEAT_UNIT", target: { kind: "GEAR", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 } } }]
    }] },
    printings: source.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number,
        source: `${DETONATE_SOURCE_PIN.repository}/${DETONATE_SOURCE_PIN.path}@${DETONATE_SOURCE_PIN.commit}` })),
    provenance: { source: `${DETONATE_SOURCE_PIN.repository}/${DETONATE_SOURCE_PIN.path}@${DETONATE_SOURCE_PIN.commit} (Batch V5 implementation review; Gear destination is REVIEWED_INFERENCE)`,
        sourceHash: hashCanonical(source), effectiveAt: "2026-09-18", errata: [], reviewed: true }
});

/** Test/admission bundle only: preserve every prior snapshot and opt in explicitly.
 * No production catalog, Demo deck or previous ruleset is modified. */
export function batchV5Context(engine?: Parameters<typeof createContentBundle>[2]) {
    const prior = batchV4Context(engine), targeted = targetedContext();
    const cards = new Map<string, CardRevisionSnapshot>();
    for (const card of [...prior.content.cards, ...targeted.content.cards, detonate]) {
        const key = `${card.id}@${card.revision}`, previous = cards.get(key);
        if (previous) assert.equal(canonicalSerialize(card), canonicalSerialize(previous), `Conflicting immutable revision ${key}`);
        else cards.set(key, CardRevisionSnapshotSchema.parse(card));
    }
    const inherited = targeted.content.ruleset.gameplay!.turnSlice!, previous = prior.content.ruleset.gameplay!.turnSlice!;
    for (const key of Object.keys(previous) as (keyof typeof previous)[]) {
        if (key in inherited) assert.equal(canonicalSerialize(previous[key]), canonicalSerialize(inherited[key]), `Conflicting prior policy ${key}`);
    }
    const ruleset = RulesetSchema.parse({ ...targeted.content.ruleset, version: "api-admission-batch-v5-1",
        gameplay: { ...targeted.content.ruleset.gameplay, turnSlice: { ...inherited, ...previous, targetedGearDefeat: "TARGETED_GEAR_DEFEAT_V1" } } });
    return { content: createContentBundle(ruleset, [...cards.values()], engine ?? prior.content.manifest.engine) };
}
export function batchV5Input(seed: string) {
    const base = targetedInput(seed);
    // Three Detonate copies replace a synthetic filler identity on each legal 42-card deck.
    return { ...base, decks: base.decks.map(deck => ({ ...deck, main: deck.main.map(id => id === "slice-card-4" ? DETONATE : id) })) };
}
