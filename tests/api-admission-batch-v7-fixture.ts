import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { targetedContext, targetedInput } from "./targeted-defeat-fixture";

// Batch V7 (plan section 6, scope 3b): the first cards admitted on the shared Unit-defeat filter
// (power bound, ANY power, SPENT readiness, conditional "instead" bound) and the existing PLAY
// draw scheduler. Source records are evidence only; mechanics are authored here and each card's
// complete shape is pinned literally in its engine gate (exact per-card check).
export const V7_SOURCE_COMMIT = "3eaadb3eeb42b2aeb39435abaf330a837e0a824c";
export const ROYCE_SIMON = "royce-don-t-call-me-simon", WILD_STREETS = "wild-in-the-streets", DELAMAIN = "delamain-rideshare-ai";
export const V7_SLUGS = [ROYCE_SIMON, WILD_STREETS, DELAMAIN] as const;

type RawPrinting = { id: string; collector_number: string; set: { code: string; name: string } };
type RawCard = {
    slug: string; name: string; subname: string | null; display_name: string; card_type: string; color: string;
    cost: number; power: number | null; ram: number; is_eddiable: boolean; classifications: string[];
    rules_text: string; print_number: string; set: { code: string; name: string }; printings: RawPrinting[];
};
export function v7Source(slug: string): RawCard {
    return JSON.parse(readFileSync(new URL(`../data/raw/cards/${slug}.json`, import.meta.url), "utf8"));
}
const SCOPE = { [ROYCE_SIMON]: "TARGETED_DEFEAT_V1", [WILD_STREETS]: "TARGETED_DEFEAT_V1", [DELAMAIN]: "COMBAT_TRIGGERS_V1" } as const;
const ABILITY = {
    [ROYCE_SIMON]: { id: "royce-simon-play-rival-defeat@1", effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 }, instead: { condition: { kind: "STREET_CRED_GREATER_THAN_RIVAL" }, power: { kind: "AT_MOST", value: 3 } } } }] },
    [WILD_STREETS]: { id: "wild-streets-defeat-spent-unit@1", effects: [{ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "ANY", power: { kind: "ANY" }, readiness: "SPENT" } }] },
    [DELAMAIN]: { id: "delamain-play-draw@1", effects: [{ kind: "DRAW", count: 2 }] }
} as const;

/** Immutable reviewed revisions. */
export const batchV7Cards = V7_SLUGS.map(slug => {
    const r = v7Source(slug), color = r.color.toUpperCase(), origin = `data/raw/cards/${slug}.json@${V7_SOURCE_COMMIT}`;
    return CardRevisionSnapshotSchema.parse({
        schemaVersion: 2, id: r.slug, revision: 1, status: "ACTIVE", cardNumber: r.print_number,
        name: r.name, subtitle: r.subname ?? "", displayName: r.display_name, deckbuildingIdentity: r.name,
        type: r.card_type.toUpperCase(), colors: [color], ram: { [color]: r.ram }, setCode: r.set.code, setName: r.set.name,
        printedCost: { kind: "EDDIES", amount: r.cost }, ...(r.power === null ? {} : { power: r.power }),
        sellProfile: { allowed: r.is_eddiable, baseEddieValue: 1 },
        rulesText: r.rules_text, sourceMarkup: r.rules_text, tags: r.classifications, keywords: [],
        execution: { scope: SCOPE[slug], status: "SUPPORTED" },
        mechanics: { keywords: [], modifiers: [], abilities: [{ id: ABILITY[slug].id, trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: ABILITY[slug].effects }] },
        printings: r.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: origin })),
        provenance: { source: `${origin} (Batch V7 implementation review; source evidence is not executable authority)`, sourceHash: hashCanonical(r), effectiveAt: "2026-11-15", errata: [], reviewed: true }
    });
});

/** Focused-test bundle: the targeted-defeat fixture chain plus the V7 revisions. */
export function batchV7Context() {
    const base = targetedContext().content;
    const ruleset = RulesetSchema.parse({ ...base.ruleset, version: "api-admission-batch-v7-1" });
    return { content: createContentBundle(ruleset, [...base.cards, ...batchV7Cards], base.manifest.engine) };
}
export function batchV7Input(seed: string) { return targetedInput(seed); }
